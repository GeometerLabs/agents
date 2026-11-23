// Writes the TEST VECTORS of the Go Bookings monthly report (go/internal/bookingsreport/testdata/vectors.json), made by RUNNING the TypeScript on Node: templates/commerce/bookings/report/*
// on several Bookings shop records, the way a month's report is made and sent. For each case: the report as the sealed envelope file (so the tree, its digest, code and signature are
// compared byte for byte), the report page, the owner's texts, the monthly certificate (file, page, text), the signed summary links and the TypeScript verifier's reading of them
// (`checkSummaryLink`), and the WhatsApp message (text and template) in all four languages. Besides the cases: the policy digest and the "not tested" list of several settings, the
// ledger head (`headOf`) on several records and tenants, the go-live certificates the report reads (good, on the example settings, on other settings, skipped situations, and every way
// to be untrusted), `writeClientReport`'s files, and `createMonthlyReport` (the job's wiring over a scripted messaging: the folder, the files, the claim and ending entries).
//
// The shop records are made by RUNNING the TypeScript: the busy month of the Bookings example (report/example-month.ts, the harness with stand-in services; a gateway shop), and records
// built here with the real record (`createRecord`) and the real `createAccounting.post`, so the money lines carry the refs the books wrote: a UPI shop (the owner's marks, a refund
// owed and marked sent or kept, a claim never marked), a gateway shop with every rule of the counting (limits at their stop sites and not elsewhere, owner decisions, messages by
// language, unconfirmed steps settled later, a refund a person settled by their word, a payment made twice), a financial year end, a wind-down month, a quiet month and an empty one.
// The signing key is a TEST VALUE made from a fixed 32-byte seed (so Ed25519's deterministic signatures can be compared); it signs nothing real. The vectors name the Node that made them.
// Run from the repository root:  node go/scripts/gen_bookings_report_vectors.ts   (--check only compares; the test words-fresh fails when it was not run after a change to the report)
import { createPrivateKey } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LANGUAGES } from "../../modules/language/languages.ts";
import type { Language } from "../../modules/language/languages.ts";
import { createRecord } from "../../modules/record/record.ts";
import type { Outcome, RecordEntry } from "../../modules/record/record.ts";
import { fakeClock } from "../../modules/core/clock.ts";
import { zonedToMs } from "../../modules/core/time.ts";
import { createAccounting } from "../../modules/accounting/post.ts";
import { headOf } from "../../modules/record/ledger.ts";
import { envelopeFile, keyIdOf, publicKeyHex, seal } from "../../modules/report/sign.ts";
import { checkSummaryLink, summaryLinkFor } from "../../modules/report/summary-sign.ts";
import type { ListedSigner } from "../../modules/report/summary-sign.ts";
import { languagesOf } from "../../modules/report/text.ts";
import { monthRange } from "../../modules/report/months.ts";
import { BOOKINGS_LEGACY } from "../../templates/commerce/bookings/src/accounting.ts";
import { glowSalon } from "../../templates/commerce/bookings/src/harness.ts";
import { parseSettings, validateSettings } from "../../templates/commerce/bookings/src/settings.ts";
import type { Settings } from "../../templates/commerce/bookings/src/settings.ts";
import { buildMonthlyReport, checkedPolicyDigest, policyDigest } from "../../templates/commerce/bookings/report/data.ts";
import type { GoLiveFinding } from "../../templates/commerce/bookings/report/data.ts";
import { buildGoLiveCertificate, buildMonthlyCertificate, monthlyCertificatePage, monthlyCertificateText } from "../../templates/commerce/bookings/report/certificate.ts";
import { reportPage } from "../../templates/commerce/bookings/report/html.ts";
import { ownerText } from "../../templates/commerce/bookings/report/text.ts";
import { monthlyReportMessage } from "../../templates/commerce/bookings/report/whatsapp.ts";
import { certificateSummaryFields, reportSummaryFields } from "../../templates/commerce/bookings/report/summary.ts";
import { writeClientReport } from "../../templates/commerce/bookings/report/run.ts";
import { createMonthlyReport } from "../../templates/commerce/bookings/report/monthly-job.ts";
import { readGoLive, readSettings } from "../../templates/commerce/bookings/report/cli.ts";
import { readGoLiveCertificate } from "../../templates/commerce/bookings/report/go-live.ts";
import { notTestedOf } from "../../templates/commerce/bookings/crash-test/not-tested.ts";
import { runBusyMonth } from "../../templates/commerce/bookings/report/example-month.ts";
import { capabilitiesOf } from "../../modules/payments/providers/index.ts";
import { ApiError } from "../../modules/core/faults.ts";
import { newRecord } from "./lib_books_worlds.ts";

const here = dirname(fileURLToPath(import.meta.url));
const INTERNAL = join(here, "..", "internal");
export const OUT = INTERNAL;

// ---- the test keys: fixed seeds, never real keys ----
const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const keyFromSeed = (seed: Buffer): KeyObject => createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, seed]), format: "der", type: "pkcs8" });
const KEY = keyFromSeed(Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 7 + 3) & 255)));
const KEY2 = keyFromSeed(Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 13 + 9) & 255)));
const PUB = publicKeyHex(KEY);
const SIGNER: ListedSigner = { key_id: keyIdOf(PUB), public_key: PUB, kind: "builder", name: "Test builder", since: "2026-01-01" };

const trial = <T>(fn: () => T): { ok: T } | { error: string } => { try { return { ok: fn() }; } catch (e) { return { error: (e as Error).message }; } };
const sha = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");
const TZ = "Asia/Kolkata";
const at = (month: number, day: number, hour: number, minute = 0, year = 2026): number => zonedToMs({ year, month, day }, { hour, minute }, TZ);

// ---- the shops' settings: the example shop (a gateway shop), a UPI shop, an agent with its own gateway module (neither), other time zones ----
const gateway: Settings = glowSalon();
const rawGlow = JSON.parse(readFileSync(new URL("../../templates/commerce/bookings/settings/glow-salon.example.json", import.meta.url), "utf8"));
const upiSettings: Settings = parseSettings({ ...rawGlow, payment: { module: "upi", upi: { id: "glowsalon@okicici", payee: "Glow Salon" } } });
const ownApiSettings: Settings = (() => { const r = validateSettings({ ...rawGlow, payment: { module: "own-api" } }, { ownApi: true }); if (!r.ok) throw new Error(r.errors.join("; ")); return r.settings; })();
const nyc: Settings = parseSettings({ ...rawGlow, name: "  Brooklyn Cuts  ", timezone: "America/New_York", owner: { whatsapp: "+12125550100", language: "en" } });
const auckland: Settings = parseSettings({ ...rawGlow, name: "ग्लो सैलून", timezone: "Pacific/Auckland", languages: ["en", "hi", "ml", "kn"], owner: { whatsapp: "+6491234567", language: "hi" } });
const asJson = <T>(v: T): T => JSON.parse(JSON.stringify(v));

// ---- records built here: the real record and the real post() ----
type Ex = { refs?: Record<string, string>; decisions?: { ruleId: string; verdict: string; reason: string }[]; language?: Language; notes?: string; conversation?: string };
function world(settings: Settings, startIso = "2026-10-01T00:00:00Z") {
  const r = newRecord(Date.parse(startIso));
  const acc = createAccounting({ record: { entries: r.entries }, shop: { timezone: settings.timezone }, legacy: BOOKINGS_LEGACY, clock: r.clock });
  const add = (when: string, action: string, outcome: Outcome, booking: string | null, ex: Ex = {}): RecordEntry => r.append(Date.parse(when), { action, outcome, booking, ...ex } as never);
  const pay = (when: string, event: Record<string, unknown>, action: string, outcome: Outcome, booking: string | null, ex: Ex = {}): void => {
    r.clock.set(Date.parse(when));
    acc.post(event as never, (money) => { r.append(Date.parse(when), { action, outcome, booking, ...ex, refs: { ...(ex.refs ?? {}), ...money } } as never); });
  };
  return { r, add, pay, entries: (): RecordEntry[] => [...r.entries()] };
}
const block = (ruleId: string) => ({ ruleId, verdict: "block", reason: `${ruleId} said no` });
const received = (b: string, id: string, paise: number, extra: Record<string, unknown> = {}) => ({ kind: "received", case: b, paymentId: id, amountPaise: paise, method: "gateway", evidence: "provider", for: "advance", ...extra });

/** A UPI shop's November: the owner's marks are the payment record. */
function upiWorld(): RecordEntry[] {
  const w = world(upiSettings);
  const D = (d: number, h = 10, m = 0) => `2026-11-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`;
  for (const b of ["b-1", "b-2", "b-3", "b-4", "b-5", "b-6", "b-7"]) w.add(D(2), "hold_slot", "confirmed", b, { language: "hi" });
  // b-1: claimed, marked, booked, done
  w.add(D(2, 11), "upi_paid_claim", "confirmed", "b-1", { refs: { requestId: "upi-1" } });
  w.pay(D(2, 12), { kind: "received", case: "b-1", paymentId: "upi-1", amountPaise: 20000, method: "upi", evidence: "owner_mark", for: "advance" }, "owner_marked_paid", "confirmed", "b-1", { refs: { requestId: "upi-1", amountPaise: "20000" } });
  w.add(D(2, 13), "confirm_booking", "confirmed", "b-1", { language: "hi" });
  // b-2: the customer says they paid, nobody marked it
  w.add(D(3, 9), "upi_paid_claim", "confirmed", "b-2", { refs: { requestId: "upi-2" } });
  // b-3: paid by hand (cash), cancelled, the refund owed then marked sent
  w.add(D(4, 9), "upi_paid_claim", "confirmed", "b-3", { refs: { requestId: "upi-3" } });
  w.pay(D(4, 10), { kind: "received", case: "b-3", paymentId: "cash-3", amountPaise: 15000, method: "cash", evidence: "owner_mark", for: "advance" }, "owner_marked_paid", "confirmed", "b-3", { refs: { requestId: "upi-3", via: "cash", amountPaise: "15000" } });
  w.add(D(4, 11), "confirm_booking", "confirmed", "b-3");
  w.add(D(5, 9), "cancel_booking", "confirmed", "b-3");
  w.pay(D(5, 9, 5), { kind: "refund_owed", case: "b-3", owed: "upr-3", paymentId: "cash-3", amountPaise: 15000 }, "upi_refund_owed", "held_for_owner", "b-3", { refs: { refundId: "upr-3" } });
  w.pay(D(6, 9), { kind: "refund_made", case: "b-3", owed: "upr-3", paymentId: "cash-3", amountPaise: 15000, method: "cash", evidence: "owner_mark", refundId: "upr-3" }, "upi_refund_marked_done", "confirmed", "b-3", { refs: { refundId: "upr-3" } });
  // b-4: paid, cancelled, the refund owed and still not marked
  w.pay(D(6, 10), { kind: "received", case: "b-4", paymentId: "upi-4", amountPaise: 30000, method: "upi", evidence: "owner_mark", for: "advance" }, "owner_marked_paid", "confirmed", "b-4", { refs: { requestId: "upi-4", amountPaise: "30000" } });
  w.add(D(6, 11), "confirm_booking", "confirmed", "b-4");
  w.add(D(7, 9), "cancel_booking", "confirmed", "b-4");
  w.pay(D(7, 9, 5), { kind: "refund_owed", case: "b-4", owed: "upr-4", paymentId: "upi-4", amountPaise: 30000 }, "upi_refund_owed", "held_for_owner", "b-4", { refs: { refundId: "upr-4" } });
  // b-5: a claim, then the request closed
  w.add(D(8, 9), "upi_paid_claim", "confirmed", "b-5");
  w.add(D(8, 10), "upi_request_closed", "confirmed", "b-5");
  // b-6: paid by bank, the owner keeps the deposit after a late cancellation
  w.pay(D(9, 10), { kind: "received", case: "b-6", paymentId: "bank-6", amountPaise: 12000, method: "bank", evidence: "owner_mark", for: "advance" }, "owner_marked_paid", "confirmed", "b-6", { refs: { requestId: "upi-6", via: "bank", amountPaise: "12000" } });
  w.add(D(9, 11), "confirm_booking", "confirmed", "b-6");
  w.add(D(10, 9), "cancel_booking", "confirmed", "b-6");
  w.pay(D(10, 9, 5), { kind: "refund_owed", case: "b-6", owed: "upr-6", paymentId: "bank-6", amountPaise: 12000 }, "upi_refund_owed", "held_for_owner", "b-6", { refs: { refundId: "upr-6" } });
  w.pay(D(11, 9), { kind: "kept", case: "b-6", owed: "upr-6", why: "late_mark_kept" }, "upi_refund_kept", "confirmed", "b-6", { refs: { refundId: "upr-6", amountPaise: "12000" } });
  // b-8: a refund owed and marked sent, neither line naming a refund id (undefined is undefined); b-9: the same, the mark naming one that is not the same
  w.add(D(11, 12), "upi_refund_owed", "held_for_owner", "b-8");
  w.add(D(11, 13), "upi_refund_marked_done", "confirmed", "b-8");
  w.add(D(11, 14), "upi_refund_owed", "held_for_owner", "b-9", { refs: { refundId: "upr-9" } });
  w.add(D(11, 15), "upi_refund_marked_done", "confirmed", "b-9", { refs: { refundId: "upr-other" } });
  // b-7: the owner answers a refund by hand, a message to the owner and one to the customer
  w.add(D(12, 9), "owner_decision", "confirmed", "b-7", { refs: { command: "approve" } });
  w.add(D(12, 10), "send_message", "confirmed", null, { refs: { to: "owner" }, language: "hi" });
  w.add(D(12, 11), "send_message", "confirmed", "b-7", { refs: { to: "customer" }, language: "ml" });
  return w.entries();
}

/** A gateway shop's November that exercises every rule of the counting. */
function rulesWorld(): { entries: RecordEntry[]; bookings: { id: string; state: string; pending: number }[] } {
  const w = world(gateway);
  const D = (d: number, h = 10, m = 0, mo = 11) => `2026-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`;
  // October: b-1 confirmed (so its cancel in November is a cancel), b-30 confirmed
  w.add(D(30, 5, 0, 10), "hold_slot", "confirmed", "b-30");
  w.pay(D(30, 6, 0, 10), received("b-30", "pay_30", 20000), "record_deposit", "confirmed", "b-30", { refs: { paymentId: "pay_30" } });
  w.add(D(30, 7, 0, 10), "confirm_booking", "confirmed", "b-30");
  // b-1: made in November, moved twice, cancelled, the deposit refunded
  w.add(D(1, 5), "hold_slot", "confirmed", "b-1");
  w.add(D(1, 5, 5), "create_deposit_link", "confirmed", "b-1");
  w.pay(D(1, 6), received("b-1", "pay_1", 20000), "record_deposit", "confirmed", "b-1", { refs: { paymentId: "pay_1" } });
  w.add(D(1, 6, 5), "confirm_booking", "confirmed", "b-1");
  w.add(D(2, 5), "reschedule_booking", "confirmed", "b-1");
  w.add(D(2, 6), "reschedule_booking", "confirmed", "b-1");
  w.add(D(3, 5), "cancel_booking", "confirmed", "b-1");
  w.pay(D(3, 5, 5), { kind: "refund_owed", case: "b-1", owed: "b-1:pay_1", paymentId: "pay_1", amountPaise: 20000 }, "refund", "held_for_owner", "b-1", { refs: { paymentId: "pay_1" } });
  w.pay(D(3, 6), { kind: "refund_made", case: "b-1", owed: "b-1:pay_1", paymentId: "pay_1", amountPaise: 20000, method: "gateway", evidence: "provider", refundId: "rf_1" }, "refund", "confirmed", "b-1", { refs: { paymentId: "pay_1", refundId: "rf_1" } });
  // b-30 cancelled in November: a cancel of a booking made in October
  w.add(D(4, 5), "cancel_booking", "confirmed", "b-30");
  // b-2: stopped by limits at their stop sites (and one that is not a stop site, and one the report does not list)
  w.add(D(5, 5), "hold_slot", "blocked", "b-2", { decisions: [block("within-hours")] });
  w.add(D(5, 5, 5), "hold_slot", "blocked", "b-2", { decisions: [block("no-double-booking"), block("within-hours")] });
  w.add(D(5, 6), "send_message", "blocked", "b-2", { decisions: [block("price-at-or-above-list"), block("opt-out")], refs: { to: "customer" } });
  w.add(D(5, 7), "send_message", "blocked", "b-2", { decisions: [block("no-double-booking")], refs: { to: "customer" } }); // not its stop site: not counted as a limit
  w.add(D(5, 8), "send_message", "blocked", "b-2", { decisions: [block("no-message-after-stop"), block("opt-out"), block("opt-out")], refs: { to: "customer" } });
  w.add(D(5, 9), "send_message", "blocked", "b-2", { decisions: [block("subscription_suspended")], refs: { to: "owner" } }); // the licence's rule: never a limit that held
  w.add(D(5, 9, 30), "send_message", "blocked", "b-2", { decisions: [block("constructor"), block("toString")], refs: { to: "owner" } }); // a rule id that is an Object.prototype member: an unknown rule (data.ts threw before 22 Nov)
  w.add(D(5, 10), "send_message", "confirmed", "b-2", { decisions: [{ ruleId: "opt-out", verdict: "allow", reason: "fine" }], refs: { to: "customer" }, language: "en" });
  w.add(D(5, 11), "record_deposit", "blocked", "b-2", { decisions: [block("one-deposit-per-booking")] });
  w.add(D(5, 12), "refund", "blocked", "b-2", { decisions: [block("refund-limit")] });
  w.add(D(5, 13), "voice_note_reply", "blocked", "b-2", { decisions: [block("confirm-only-when-recorded"), block("message-matches-record")], refs: { to: "customer" } });
  // b-3: a step never confirmed; b-4: unconfirmed, settled by a later confirmed step
  w.add(D(6, 5), "hold_slot", "confirmed", "b-3");
  w.add(D(6, 6), "confirm_booking", "unconfirmed", "b-3");
  w.add(D(6, 7), "hold_slot", "confirmed", "b-4");
  w.add(D(6, 8), "confirm_booking", "unconfirmed", "b-4");
  w.add(D(6, 9), "confirm_booking", "confirmed", "b-4");
  // b-5: refunds: one unconfirmed and settled by another payment's refund (not settled), one unconfirmed and settled by a person's word, one failed with nothing after
  w.pay(D(7, 5), received("b-5", "pay_5", 30000), "record_deposit", "confirmed", "b-5", { refs: { paymentId: "pay_5" } });
  w.pay(D(7, 5, 5), received("b-5", "pay_5b", 10000, { for: "extra" }), "record_deposit", "blocked", "b-5", { refs: { paymentId: "pay_5b" } });
  w.add(D(7, 6), "confirm_booking", "confirmed", "b-5");
  w.add(D(7, 7), "refund", "unconfirmed", "b-5", { refs: { paymentId: "pay_5" } });
  w.pay(D(7, 8), { kind: "refund_owed", case: "b-5", owed: "b-5:pay_5b", paymentId: "pay_5b", amountPaise: 10000 }, "refund", "held_for_owner", "b-5", { refs: { paymentId: "pay_5b" } });
  w.pay(D(7, 9), { kind: "refund_made", case: "b-5", owed: "b-5:pay_5b", paymentId: "pay_5b", amountPaise: 10000, method: "gateway", evidence: "provider", refundId: "rf_5b" }, "refund", "confirmed", "b-5", { refs: { paymentId: "pay_5b", refundId: "rf_5b" } });
  w.pay(D(8, 5), received("b-6", "pay_6", 25000), "record_deposit", "confirmed", "b-6", { refs: { paymentId: "pay_6" } });
  w.add(D(8, 6), "confirm_booking", "confirmed", "b-6");
  w.add(D(8, 7), "refund", "unconfirmed", "b-6", { refs: { paymentId: "pay_6" } });
  w.pay(D(8, 8), { kind: "refund_owed", case: "b-6", owed: "b-6:pay_6", paymentId: "pay_6", amountPaise: 25000 }, "refund", "held_for_owner", "b-6", { refs: { paymentId: "pay_6" } });
  w.pay(D(8, 9), { kind: "refund_made", case: "b-6", owed: "b-6:pay_6", paymentId: "pay_6", amountPaise: 25000, method: "gateway", evidence: "person_word" }, "refund", "confirmed", "b-6", { refs: { paymentId: "pay_6", confirmedBy: "operator:asha" } });
  // more settled by word: the same person again, another with no amount, one with a long and a many-line name
  w.pay(D(9, 5), received("b-7", "pay_7", 15000), "record_deposit", "confirmed", "b-7", { refs: { paymentId: "pay_7" } });
  w.pay(D(9, 6), { kind: "refund_owed", case: "b-7", owed: "b-7:pay_7", paymentId: "pay_7", amountPaise: 15000 }, "refund", "held_for_owner", "b-7", { refs: { paymentId: "pay_7" } });
  w.pay(D(9, 7), { kind: "refund_made", case: "b-7", owed: "b-7:pay_7", paymentId: "pay_7", amountPaise: 15000, method: "gateway", evidence: "person_word" }, "refund", "confirmed", "b-7", { refs: { paymentId: "pay_7", confirmedBy: "operator:asha" } });
  w.add(D(9, 8), "refund", "confirmed", "b-7", { refs: { paymentId: "pay_x1", confirmedBy: "operator:ravi" } }); // no amount written down
  w.add(D(9, 9), "refund", "confirmed", "b-7", { refs: { paymentId: "pay_x2", confirmedBy: "a very long name that goes on and on for far more than forty characters of text", amountPaise: "5000" } });
  w.add(D(9, 10), "refund", "confirmed", "b-7", { refs: { paymentId: "pay_x3", confirmedBy: "line one\nline two", amountPaise: "700" } });
  w.add(D(9, 11), "refund", "confirmed", "b-7", { refs: { paymentId: "pay_x3", confirmedBy: "line one\nline two", amountPaise: "700" } }); // the same payment again: counted once
  // a failed step with nothing after, a message that did not confirm, a delivery report that failed
  w.add(D(10, 5), "record_deposit", "failed", "b-8");
  w.add(D(10, 6), "send_message", "unconfirmed", "b-8", { refs: { to: "customer" } });
  w.add(D(10, 7), "voice_note_reply", "unconfirmed", null, { refs: { to: "customer" } });
  w.add(D(10, 8), "message_status", "failed", "b-8");
  w.add(D(10, 9), "message_status", "unconfirmed", null);
  w.add(D(10, 10), "reschedule_booking", "unconfirmed", "b-8");
  // refunds asked of the owner: the same payment twice (once), no payment id (each by its own number)
  w.add(D(11, 5), "refund", "held_for_owner", "b-9", { refs: { paymentId: "pay_9" } });
  w.add(D(11, 6), "refund", "held_for_owner", "b-9", { refs: { paymentId: "pay_9" } });
  w.add(D(11, 7), "refund", "held_for_owner", "b-9");
  w.add(D(11, 8), "refund", "held_for_owner", "b-9");
  w.add(D(11, 9), "refund", "held_for_owner", null, { refs: { paymentId: "pay_n" } });
  // the owner's answers: approve, approve, deny, retry, a command not known, none at all
  w.add(D(12, 5), "owner_decision", "confirmed", "b-9", { refs: { command: "approve" } });
  w.add(D(12, 6), "owner_decision", "confirmed", "b-10", { refs: { command: "approve" } });
  w.add(D(12, 7), "owner_decision", "confirmed", "b-11", { refs: { command: "deny" } });
  w.add(D(12, 8), "owner_decision", "confirmed", "b-12", { refs: { command: "retry" } });
  w.add(D(12, 9), "owner_decision", "confirmed", "b-13", { refs: { command: "whatever" } });
  w.add(D(12, 10), "owner_decision", "confirmed", "b-14");
  w.add(D(12, 11), "owner_decision", "failed", "b-15", { refs: { command: "approve" } });
  // messages: to customers and to the owner in each language, one with no recipient, one to someone else, a reply to a voice note
  for (const [i, l] of LANGUAGES.entries()) w.add(D(13, 5 + i), "send_message", "confirmed", `b-${20 + i}`, { refs: { to: "customer" }, language: l });
  w.add(D(13, 10), "send_message", "confirmed", null, { refs: { to: "owner" }, language: "hi" });
  w.add(D(13, 11), "send_message", "confirmed", null, { refs: { to: "owner" }, language: "en" });
  w.add(D(13, 12), "send_message", "confirmed", "b-24", { language: "kn" });
  w.add(D(13, 13), "send_message", "confirmed", "b-24", { refs: { to: "nobody" }, language: "kn" });
  w.add(D(13, 14), "voice_note_reply", "confirmed", "b-24", { refs: { to: "customer" }, language: "ml" });
  w.add(D(13, 15), "voice_note_reply", "unconfirmed", "b-24", { refs: { to: "customer" }, language: "en" });
  // a payment made twice (a second payment on a link goes back), a booking id of every odd shape, the record's restore and a licence line
  w.pay(D(14, 5), received("b-9", "pay_9", 20000), "record_deposit", "confirmed", "b-9", { refs: { paymentId: "pay_9" } });
  w.pay(D(14, 6), received("b-9", "pay_9x", 20000, { for: "extra" }), "record_deposit", "blocked", "b-9", { refs: { paymentId: "pay_9x" } });
  for (const [i, id] of ["b-10", "b-2", "x-5", "b-1e2", "b-0x10", "q", "b-", "b-0", "b-007"].entries()) w.add(D(15, 5 + i), "hold_slot", "confirmed", id);
  w.add(D(16, 5), "restored", "confirmed", null);
  w.add(D(16, 6), "licence", "confirmed", null, { refs: { state: "grace" } });
  // a refund with no payment id is settled by a later one with none (undefined is undefined); an empty payment id is not "none"
  w.add(D(17, 5), "refund", "unconfirmed", "b-16");
  w.add(D(17, 6), "refund", "confirmed", "b-16");
  w.add(D(17, 7), "refund", "unconfirmed", "b-17", { refs: { paymentId: "" } });
  w.add(D(17, 8), "refund", "confirmed", "b-17");
  // after the month: December
  w.add(D(1, 5, 0, 12), "hold_slot", "confirmed", "b-90");
  w.add(D(1, 6, 0, 12), "confirm_booking", "confirmed", "b-90");
  return { entries: w.entries(), bookings: [{ id: "b-3", state: "needs_owner", pending: 0 }, { id: "b-8", state: "holding", pending: 2 }, { id: "b-77", state: "holding", pending: 1 }, { id: "b-78", state: "done", pending: 0 }] };
}

/** The financial year end: lines either side of 31 March 18:30 UTC (midnight in India), a restore. */
function fyendWorld(): RecordEntry[] {
  const w = world(gateway, "2027-03-01T00:00:00Z");
  w.add("2027-03-30T05:00:00Z", "hold_slot", "confirmed", "b-1");
  w.pay("2027-03-30T06:00:00Z", received("b-1", "pay_1", 25000), "record_deposit", "confirmed", "b-1", { refs: { paymentId: "pay_1" } });
  w.add("2027-03-30T06:05:00Z", "confirm_booking", "confirmed", "b-1");
  w.add("2027-03-31T18:29:59.999Z", "hold_slot", "confirmed", "b-2");
  w.pay("2027-03-31T18:29:59.999Z", received("b-2", "pay_2", 30000), "record_deposit", "confirmed", "b-2", { refs: { paymentId: "pay_2" } });
  w.add("2027-03-31T18:30:00.000Z", "confirm_booking", "confirmed", "b-2");
  w.pay("2027-03-31T18:30:00.000Z", received("b-3", "pay_3", 35000), "record_deposit", "confirmed", "b-3", { refs: { paymentId: "pay_3" } });
  w.add("2027-04-01T05:00:00Z", "restored", "confirmed", null);
  w.pay("2027-04-02T05:00:00Z", { kind: "refund_owed", case: "b-2", owed: "b-2:pay_2", paymentId: "pay_2", amountPaise: 30000 }, "refund", "held_for_owner", "b-2", { refs: { paymentId: "pay_2" } });
  w.pay("2027-04-02T06:00:00Z", { kind: "refund_made", case: "b-2", owed: "b-2:pay_2", paymentId: "pay_2", amountPaise: 30000, method: "gateway", evidence: "provider", refundId: "rf_2" }, "refund", "confirmed", "b-2", { refs: { paymentId: "pay_2", refundId: "rf_2" } });
  return w.entries();
}

/** A wind-down month: the licence's lines and its rule, and nothing else the shop did. */
function windDownWorld(): RecordEntry[] {
  const w = world(gateway);
  w.add("2026-11-05T05:00:00Z", "licence", "confirmed", null, { refs: { state: "wound_down" } });
  w.add("2026-11-05T05:00:01Z", "send_message", "confirmed", null, { refs: { to: "owner", licence: "notice" }, language: "en" });
  w.add("2026-11-06T05:00:00Z", "send_message", "blocked", "b-1", { decisions: [block("subscription_suspended")], refs: { to: "customer" } });
  w.add("2026-11-07T05:00:00Z", "hold_slot", "blocked", "b-2", { decisions: [block("subscription_suspended")] });
  return w.entries();
}

/** Lines the job itself wrote, and nothing else: a quiet month. */
function quietWorld(): RecordEntry[] {
  const w = world(gateway);
  w.add("2026-10-30T05:00:00Z", "hold_slot", "confirmed", "b-1");
  w.add("2026-11-01T05:00:00Z", "send_message", "confirmed", null, { refs: { to: "owner", report: "2026-10", code: "7K2M-9QXD" } });
  return w.entries();
}

// The busy month of the example (the harness with stand-in services): a gateway shop with a month of real steps.
const busy = await runBusyMonth();
const busyEntries: RecordEntry[] = [...busy.world.record.entries()];
const busyBookings = [...busy.world.store.bookings.values()].map((b) => ({ id: b.id, state: b.state, pending: b.pending.length }));

const rules = rulesWorld();
const upiEntries = upiWorld();
const fyendEntries = fyendWorld();
const windDownEntries = windDownWorld();
const quietEntries = quietWorld();
/** The shop records the vectors share, written once (a case or a ledger set names one). */
/** E1, the discount authority (24 Nov 2026): a month with every kind of discount line (given by the agent, asked of the owner and approved, refused by the rule and by the owner). */
function discountWorld(): RecordEntry[] {
  const w = world(gateway);
  const refs = (offered: number, discount: number, code: string, by?: string) => ({ refs: { rule: "discount-authority", item: "haircut", qty: "1", listInr: "450", offeredInr: String(offered), discountInr: String(discount), totalInr: String(offered), code, ...(by ? { by } : {}) } });
  w.add("2026-11-03T05:00:00Z", "discount", "confirmed", "b-1", refs(440, 10, "ABCDEF", "agent"));
  w.add("2026-11-04T05:00:00Z", "discount", "held_for_owner", "b-2", refs(420, 30, "GHJKMN"));
  w.add("2026-11-04T06:00:00Z", "discount", "confirmed", "b-2", refs(420, 30, "GHJKMN", "owner"));
  w.add("2026-11-05T05:00:00Z", "discount", "blocked", "b-3", refs(1, 449, "PQRSTU", "rule"));
  w.add("2026-11-06T05:00:00Z", "discount", "held_for_owner", "b-4", refs(410, 40, "VWXYZ2"));
  w.add("2026-11-06T06:00:00Z", "discount", "blocked", "b-4", refs(410, 40, "VWXYZ2", "owner"));
  w.add("2026-10-30T05:00:00Z", "discount", "confirmed", "b-9", refs(445, 5, "ABCDE2", "agent")); // October: not this month's
  return w.entries();
}
const discountEntries = discountWorld();
const RECORDS: Record<string, readonly RecordEntry[]> = { busy: busyEntries, rules: rules.entries, upi: upiEntries, fyend: fyendEntries, winddown: windDownEntries, quiet: quietEntries, discounts: discountEntries, empty: [] };
const recordRef = (entries: readonly RecordEntry[]): string | RecordEntry[] => Object.entries(RECORDS).find(([, v]) => v === entries)?.[0] ?? asJson(entries);

// ---- the cases ----
interface Case {
  name: string; settings: Settings; entries: readonly RecordEntry[]; bookings: { id: string; state: string; pending: number }[];
  month?: string; range?: [number, number]; source: "stand-in" | "test-mode" | "live"; madeAt: number; certAt: number;
  preparedBy: string | null; innovator?: boolean; goLive?: GoLiveFinding; pathway?: { name: string; version: string }; tenant?: string; cost?: { microInr: number; basis: string };
  signed: boolean; pages: ("en" | "hi" | "ml" | "kn" | "both")[];
}
const FINDING_OWN: GoLiveFinding = { status: "own", code: "AB12-CD34", signedBy: "key:" + "ab".repeat(32), issuedOn: { year: 2026, month: 10, day: 20 }, held: 14, total: 14, failed: 0, notRun: 0, notTested: 14 };
const FINDING_SKIPS: GoLiveFinding = { ...FINDING_OWN, held: 12, total: 13, failed: 1, notRun: 2 } as GoLiveFinding;
const FINDING_EXAMPLE: GoLiveFinding = { status: "example", code: "EF56-GH78", signedBy: "key:" + "cd".repeat(32), issuedOn: { year: 2026, month: 9, day: 3 } };
const FINDING_DIFFERENT: GoLiveFinding = { status: "different", code: "JK90-LM12", signedBy: "key:" + "ef".repeat(32), issuedOn: { year: 2026, month: 11, day: 30 } };
const COST = { microInr: 41_300_001, basis: "WhatsApp messages and the model at the price list of 1 November 2026, in rupees" };
const NOW = at(12, 1, 9, 30);
const base = { source: "stand-in" as const, madeAt: NOW, certAt: NOW + 60_000, signed: true, pages: ["en"] as Case["pages"], bookings: [] as Case["bookings"] };
const longName = (n: number) => ({ ...gateway, name: "Glow Salon " + "ग्लो सैलून नगर ".repeat(Math.ceil(n / 14)).slice(0, n) }) as Settings;

const CASES: Case[] = [
  { ...base, name: "busy-both-signed", settings: gateway, entries: busyEntries, bookings: busyBookings, month: "2026-11", preparedBy: "Divya, Sri Sai Digital", innovator: true, goLive: FINDING_OWN, tenant: "glow-salon", cost: COST, pages: ["both", "ml"], source: "live" },
  { ...base, name: "busy-unsigned-hi", settings: gateway, entries: busyEntries, bookings: busyBookings, month: "2026-11", preparedBy: "Divya", goLive: FINDING_EXAMPLE, signed: false, pages: ["hi", "kn"] },
  { ...base, name: "busy-october-untrusted", settings: gateway, entries: busyEntries, bookings: [], month: "2026-10", preparedBy: "Ravi & Sons <Digital>", goLive: { status: "untrusted" }, pages: ["ml"], source: "test-mode" },
  { ...base, name: "busy-december-different", settings: gateway, entries: busyEntries, bookings: busyBookings, month: "2026-12", preparedBy: "Divya", goLive: FINDING_DIFFERENT, tenant: "glow-salon", pages: ["kn", "en"] },
  { ...base, name: "busy-custom-range", settings: gateway, entries: busyEntries, bookings: busyBookings, range: [at(11, 3, 0), at(11, 10, 0)], preparedBy: "Divya", goLive: FINDING_SKIPS, cost: { microInr: 1, basis: "" }, pages: ["en", "hi"] },
  { ...base, name: "upi-hi-both", settings: upiSettings, entries: upiEntries, bookings: [{ id: "b-2", state: "holding", pending: 1 }], month: "2026-11", preparedBy: "Asha", innovator: true, tenant: "glow-upi", pages: ["both", "kn"] },
  { ...base, name: "upi-unsigned-ml", settings: upiSettings, entries: upiEntries, bookings: [], month: "2026-11", preparedBy: "Asha", signed: false, goLive: FINDING_OWN, pages: ["ml", "en"] },
  { ...base, name: "own-api-neither", settings: ownApiSettings, entries: rules.entries, bookings: rules.bookings, month: "2026-11", preparedBy: "Dev", goLive: FINDING_SKIPS, pages: ["en"] },
  { ...base, name: "rules-gateway", settings: gateway, entries: rules.entries, bookings: rules.bookings, month: "2026-11", preparedBy: "Meena", innovator: true, tenant: "Glow Salon", pages: ["en", "ml", "both"] },
  { ...base, name: "rules-no-cost-no-completed", settings: gateway, entries: rules.entries, bookings: rules.bookings, month: "2026-10", preparedBy: "Meena", cost: COST, pages: ["hi"] },
  { ...base, name: "fyend-march", settings: gateway, entries: fyendEntries, bookings: [], month: "2027-03", preparedBy: "Meena", tenant: "fy-end", pages: ["en", "hi"], madeAt: at(4, 1, 9, 30, 2027), certAt: at(4, 1, 9, 31, 2027) },
  { ...base, name: "fyend-april", settings: gateway, entries: fyendEntries, bookings: [], month: "2027-04", preparedBy: "Meena", tenant: "fy-end", pages: ["en"], madeAt: at(5, 1, 9, 30, 2027), certAt: at(5, 1, 9, 31, 2027) },
  { ...base, name: "wind-down", settings: gateway, entries: windDownEntries, bookings: [], month: "2026-11", preparedBy: "Divya", pages: ["en", "kn"] },
  { ...base, name: "discounts", settings: gateway, entries: discountEntries, bookings: [], month: "2026-11", preparedBy: "Divya", tenant: "discounts", pages: ["en", "hi", "ml", "kn"] },
  { ...base, name: "quiet", settings: gateway, entries: quietEntries, bookings: [], month: "2026-11", preparedBy: "Divya", tenant: "quiet", pages: ["en"] },
  { ...base, name: "empty-record", settings: gateway, entries: RECORDS.empty, bookings: [], month: "2026-11", preparedBy: "Divya", tenant: "empty", pages: ["en", "hi"], innovator: true },
  { ...base, name: "no-prepared-by", settings: gateway, entries: quietEntries, bookings: [], month: "2026-11", preparedBy: null, pages: ["en"] },
  { ...base, name: "blank-prepared-by", settings: gateway, entries: quietEntries, bookings: [], month: "2026-11", preparedBy: "  \n ", pages: ["en"] },
  { ...base, name: "other-zone-newyork", settings: nyc, entries: rules.entries, bookings: [], month: "2026-11", preparedBy: "Sam", pages: ["en"], madeAt: zonedToMs({ year: 2026, month: 12, day: 1 }, { hour: 9, minute: 30 }, "America/New_York") },
  { ...base, name: "other-zone-auckland", settings: auckland, entries: rules.entries, bookings: [], month: "2026-11", preparedBy: "तारा", pages: ["hi", "ml"], madeAt: zonedToMs({ year: 2026, month: 12, day: 1 }, { hour: 9, minute: 30 }, "Pacific/Auckland") },
  { ...base, name: "other-pathway", settings: gateway, entries: quietEntries, bookings: [], month: "2026-11", preparedBy: "Divya", pathway: { name: "own-agent", version: "0.3.1" }, pages: ["en"] },
  // the message must fit WhatsApp's 1024 characters: a long shop name pushes the signed summary link out, then the #digest link, then the #code link is used
  { ...base, name: "long-name-180", settings: longName(180), entries: rules.entries, bookings: [], month: "2026-11", preparedBy: "Meena", pages: ["en"] },
  { ...base, name: "long-name-300", settings: longName(300), entries: rules.entries, bookings: [], month: "2026-11", preparedBy: "Meena", pages: ["hi"] },
  { ...base, name: "long-name-420", settings: longName(420), entries: rules.entries, bookings: [], month: "2026-11", preparedBy: "Meena", pages: ["ml"] },
  { ...base, name: "long-name-600", settings: longName(600), entries: rules.entries, bookings: [], month: "2026-11", preparedBy: "Meena", pages: ["kn"] },
  { ...base, name: "long-name-unsigned", settings: longName(500), entries: rules.entries, bookings: [], month: "2026-11", preparedBy: "Meena", signed: false, pages: [] },
  // the owner's marks on a gateway shop: the books count them, the rows above do not, and the page says why (booksOnly)
  { ...base, name: "gateway-with-owner-marks", settings: gateway, entries: upiEntries, bookings: [], month: "2026-11", preparedBy: "Asha", pages: ["en", "hi"] },
  // text that reaches the page and the message is escaped or put on one line
  { ...base, name: "escapes", settings: { ...gateway, name: "Glow & <b>Salon</b> \"A's\"\n  line two" } as Settings, entries: rules.entries, bookings: [], month: "2026-11", preparedBy: "Meena\n  S\t<x>&", innovator: true, pages: ["en", "kn"] },
  // a record that is not a chain: the report cannot be anchored, and says why
  { ...base, name: "ledger-gap", settings: gateway, entries: rules.entries.filter((e) => e.seq !== 5), bookings: [], month: "2026-11", preparedBy: "Divya", tenant: "gap", pages: [] },
  { ...base, name: "ledger-bad-time", settings: gateway, entries: rules.entries.map((e) => (e.seq === 3 ? { ...e, time: "not a time" } : e)), bookings: [], month: "2026-11", preparedBy: "Divya", tenant: "bad-time", pages: [] },
  { ...base, name: "ledger-bad-tenant", settings: gateway, entries: quietEntries, bookings: [], month: "2026-11", preparedBy: "Divya", tenant: "!!!", pages: [] },
  { ...base, name: "period-backwards", settings: gateway, entries: quietEntries, bookings: [], range: [at(11, 10, 0), at(11, 3, 0)], preparedBy: "Divya", pages: [] },
];
const BAD_SOURCE: Case = { ...base, name: "unknown-source", settings: gateway, entries: [], source: "paper" as never, month: "2026-11", preparedBy: "Divya", pages: [] };

const LINK = (c: Case, l: string) => `https://reports.example.com/r/3f9a1c7d2b8e4f60/report-${c.month ?? "range"}-${l}.html`;
const checkOf = (link: string | undefined) => {
  if (!link) return null;
  const r = checkSummaryLink(link, [SIGNER]);
  if (r.status !== "genuine") return { status: r.status };
  const s = r.summary;
  return { status: r.status, layout: s.layout, source: s.source, ownerMarked: s.ownerMarked, period: s.period, pathway: s.pathway, shop: s.shop, by: s.by, figures: s.figures, digest: s.digest, signer: r.signer.key_id };
};

function derive(c: Case): unknown {
  const settingsJson = asJson(c.settings);
  const { from, to } = c.range ? { from: c.range[0], to: c.range[1] } : monthRange(c.month!, c.settings.timezone);
  const input = {
    settings: c.settings, entries: c.entries, bookings: c.bookings.map((b) => ({ ...b, pending: Array(b.pending).fill({}) })) as never, from, to, source: c.source, madeAt: c.madeAt,
    ...(c.preparedBy !== null ? { preparedBy: c.preparedBy } : {}), ...(c.innovator ? { innovator: true } : {}), ...(c.goLive ? { goLive: c.goLive } : {}), ...(c.pathway ? { pathway: c.pathway } : {}),
    ...(c.tenant !== undefined ? { ledger: { tenant: c.tenant } } : {}), ...(c.cost ? { cost: c.cost } : {}),
  };
  const head = { name: c.name, settings: settingsJson, entries: recordRef(c.entries), bookings: c.bookings, month: c.month ?? null, range: c.range ?? null, from, to, source: c.source, madeAt: c.madeAt, certAt: c.certAt,
    preparedBy: c.preparedBy, innovator: c.innovator === true, goLive: c.goLive ?? null, pathway: c.pathway ?? null, tenant: c.tenant ?? null, cost: c.cost ?? null, signed: c.signed };
  const built = trial(() => buildMonthlyReport(input));
  if ("error" in built) return { ...head, error: built.error };
  const report = built.ok;
  const key = c.signed ? KEY : undefined;
  const sealed = seal(report, key);
  const certificate = seal(buildMonthlyCertificate(sealed, c.certAt), key);
  const reportCheck = summaryLinkFor(sealed, reportSummaryFields(report), key);
  const certCheck = summaryLinkFor(certificate, certificateSummaryFields(certificate.document), key);
  const pages = Object.fromEntries(c.pages.map((l) => [l, { report: reportPage(sealed, l, reportCheck), certificate: monthlyCertificatePage(certificate, l, certCheck) }]));
  const owner = Object.fromEntries(LANGUAGES.map((l) => [l, ownerText(report, l)]));
  const certText = Object.fromEntries(LANGUAGES.map((l) => [l, monthlyCertificateText(certificate, l, certCheck)]));
  const messages = Object.fromEntries(LANGUAGES.map((l) => [l, trial(() => monthlyReportMessage(sealed, l, { link: LINK(c, l), ...(reportCheck ? { check: reportCheck } : {}) }))]));
  return {
    ...head, report: envelopeFile(sealed), certificate: envelopeFile(certificate), check: reportCheck ?? null, certificateCheck: certCheck ?? null, checked: checkOf(reportCheck), certificateChecked: checkOf(certCheck),
    pages, owner, certificateText: certText, messages,
  };
}

// ---- the files writeClientReport writes ----
function filesOf(c: Case, language: "en" | "hi" | "ml" | "kn" | "both"): unknown {
  const out = mkdtempSync(join(tmpdir(), "bookings-report-"));
  try {
    const made = writeClientReport({
      settings: c.settings, entries: c.entries, bookings: c.bookings.map((b) => ({ ...b, pending: Array(b.pending).fill({}) })) as never, month: c.month!, language, out, source: c.source,
      ...(c.signed ? { key: KEY } : {}), ...(c.preparedBy !== null ? { preparedBy: c.preparedBy } : {}), ...(c.innovator ? { innovator: true } : {}), ...(c.goLive ? { goLive: c.goLive } : {}),
      now: c.madeAt, ...(c.tenant ? { tenant: c.tenant } : {}), ...(c.cost ? { cost: c.cost } : {}),
    });
    const names = readdirSync(out).sort();
    return { name: c.name, language, written: made.files.map((f) => f.slice(out.length + 1)), sha: Object.fromEntries(names.map((n) => [n, sha(readFileSync(join(out, n), "utf8"))])), ownerTexts: made.ownerTexts, code: made.code, certificateCode: made.certificateCode, check: made.check ?? null };
  } finally { rmSync(out, { recursive: true, force: true }); }
}

// ---- the go-live certificates the report reads ----
function goLiveReadings(): unknown {
  const handCheck = { held: 14, total: 14, checks: 120, failedTitles: [] as string[] };
  const cert = (settings: Settings, hc: { held: number; total: number; checks: number; failedTitles: string[]; ranOn?: string; notRun?: string[] }, key: KeyObject | undefined = KEY, mutate?: (d: Record<string, unknown>) => void): string => {
    const doc = buildGoLiveCertificate({ settings, handCheck: hc, issuedAt: at(10, 20, 11), preparedBy: "Divya" }) as unknown as Record<string, unknown>;
    mutate?.(doc);
    return envelopeFile(seal(doc, key));
  };
  const cases: { name: string; settings: Settings; text: string }[] = [
    { name: "own", settings: gateway, text: cert(gateway, { ...handCheck, ranOn: policyDigest(gateway) }) },
    { name: "own-skipped", settings: gateway, text: cert(gateway, { ...handCheck, held: 12, total: 13, failedTitles: ["x"], ranOn: policyDigest(gateway), notRun: ["a", "b"] }) },
    { name: "own-upi", settings: upiSettings, text: cert(upiSettings, { ...handCheck, ranOn: policyDigest(upiSettings) }) },
    { name: "example", settings: upiSettings, text: cert(upiSettings, handCheck) },
    { name: "example-for-gateway", settings: gateway, text: cert(gateway, handCheck) },
    { name: "different", settings: gateway, text: cert(gateway, { ...handCheck, ranOn: policyDigest(upiSettings) }) },
    { name: "other-key", settings: gateway, text: cert(gateway, { ...handCheck, ranOn: policyDigest(gateway) }, KEY2) },
    { name: "unsigned", settings: gateway, text: cert(gateway, { ...handCheck, ranOn: policyDigest(gateway) }, undefined) },
    { name: "changed", settings: gateway, text: cert(gateway, { ...handCheck, ranOn: policyDigest(gateway) }).replace("\"held\":14", "\"held\":15") },
    { name: "not-json", settings: gateway, text: "this is not a certificate" },
    { name: "empty", settings: gateway, text: "" },
    { name: "a monthly report", settings: gateway, text: envelopeFile(seal({ format: "geometer-monthly-report/1", anchor: null }, KEY)) },
    { name: "other-template", settings: gateway, text: cert(gateway, { ...handCheck, ranOn: policyDigest(gateway) }, KEY, (d) => { d.pathway = { name: "fees", version: "0.1.0" }; }) },
    { name: "own-agent-template", settings: gateway, text: cert(gateway, { ...handCheck, ranOn: policyDigest(gateway) }, KEY, (d) => { d.pathway = { name: "own-agent", version: "0.1.0" }; }) },
    { name: "no-pathway", settings: gateway, text: cert(gateway, { ...handCheck, ranOn: policyDigest(gateway) }, KEY, (d) => { delete d.pathway; }) },
    { name: "bad-counts", settings: gateway, text: cert(gateway, { ...handCheck, ranOn: policyDigest(gateway) }, KEY, (d) => { (d.checks as Record<string, unknown>).held = -1; }) },
  ];
  const missing = "/nonexistent/go-live-certificate.json"; // a fixed path that is not there: the vectors must not carry a machine's own paths
  return {
    cases: cases.map((c) => ({ name: c.name, settings: asJson(c.settings), text: c.text, reading: readGoLiveCertificate(c.text, c.settings) })),
    paths: { none: readGoLive(undefined, gateway), empty: readGoLive("", gateway), missing: { path: missing, reading: readGoLive(missing, gateway) } },
  };
}

// ---- the policy digest, what is not tested, and the ledger head ----
function policies(): unknown {
  const named: [string, Settings][] = [["gateway", gateway], ["upi", upiSettings], ["own-api", ownApiSettings], ["newyork", nyc], ["auckland", auckland], ["long", longName(300)]];
  const rows = named.map(([name, s]) => {
    const validated = asJson(s);
    const roundTripDigest = policyDigest(validated as Settings);
    if (roundTripDigest !== policyDigest(s)) throw new Error(`the policy digest of ${name} changes when the settings go through JSON: the Go report would digest another tree than the TypeScript`);
    return { name, settings: validated, digest: policyDigest(s), confirmsAutomatically: capabilitiesOf(s.payment).confirmsAutomatically, notTested: notTestedOf(s).map((n) => n.id) };
  });
  // a settings file as the owner might write it, before validateSettings fills the defaults in: the digest the TypeScript takes is the validated one (Go must be handed that)
  const raw = { ...rawGlow, name: "  Glow Salon  ", bufferMinutes: undefined };
  const rawText = JSON.stringify(raw);
  const validated = parseSettings(JSON.parse(rawText));
  const noPayment = { ...asJson(gateway) } as Record<string, unknown>; delete noPayment.payment;
  return {
    rows, checkedPolicyDigest: checkedPolicyDigest(),
    raw: { text: rawText, validated: asJson(validated), validatedDigest: policyDigest(validated), rawDigest: policyDigest(JSON.parse(rawText) as Settings) },
    noPayment: { settings: noPayment, digest: policyDigest(noPayment as unknown as Settings), confirmsAutomatically: capabilitiesOf(undefined).confirmsAutomatically, notTested: notTestedOf(noPayment as never).map((n) => n.id) },
  };
}

function ledgers(): unknown {
  const sets: [string, readonly RecordEntry[]][] = [["busy", busyEntries], ["busy-first-5", busyEntries.slice(0, 5)], ["rules", rules.entries], ["upi", upiEntries], ["fyend", fyendEntries], ["empty", RECORDS.empty],
    ["gap", rules.entries.filter((e) => e.seq !== 7)], ["repeat", [...rules.entries.slice(0, 4), rules.entries[3]]], ["bad-time", rules.entries.map((e) => (e.seq === 2 ? { ...e, time: "yesterday" } : e))],
    ["negative-time", rules.entries.slice(0, 3).map((e) => (e.seq === 2 ? { ...e, time: "1969-12-31T23:59:59.000Z" } : e))], ["unsorted", [...rules.entries.slice(0, 6)].reverse()]];
  const tenants = ["glow-salon", "Glow Salon!", "!!!", "Ñandú Café", "x y", "a".repeat(250), "A-b_c.d", "", "ക", "shop:1@2+3"];
  return sets.flatMap(([name, entries]) => (name === "busy" || name === "rules" ? tenants : ["glow-salon", "Glow Salon!"]).map((tenant) => ({ name, tenant, entries: recordRef(entries), out: trial(() => headOf(entries, tenant)) })));
}

// ---- createMonthlyReport: the job's wiring over a scripted messaging ----
const job = await (async () => {
  const runs: unknown[] = [];
  for (const mode of ["template", "text", "document-refused", "no-activity"] as const) {
    const clock = fakeClock(at(12, 1, 10, 30));
    const entries = mode === "no-activity" ? quietEntries : rules.entries;
    const record = createRecord(clock, entries);
    const dir = mkdtempSync(join(tmpdir(), "bookings-job-"));
    const sent: unknown[] = [];
    let nextId = 0;
    const messaging = {
      isWindowOpen: async () => mode !== "template",
      sendText: async (to: string, text: string) => { sent.push({ kind: "text", to, text }); return { id: `wamid.${++nextId}`, to, text, status: "sent" } as never; },
      sendTemplate: async (to: string, template: unknown) => { sent.push({ kind: "template", to, template }); return { id: `wamid.${++nextId}`, to } as never; },
      sendDocument: async (to: string, doc: unknown) => { sent.push({ kind: "document", to, doc }); if (mode === "document-refused") { throw new ApiError(400, "document refused"); } return { id: `wamid.${++nextId}`, to } as never; },
      getMessage: async (id: string) => ({ id }) as never,
    };
    const saves: number[] = [];
    const logs: string[] = [];
    const setup = { source: "stand-in" as const, pages: { dir, baseUrl: "https://reports.example.com/r" }, options: () => ({ preparedBy: "Divya, Sri Sai Digital", innovator: mode === "text" }), key: KEY, goLive: () => FINDING_OWN, token: () => "0123456789abcdef0123456789abcdef", tenant: "glow-salon" };
    const jobRun = createMonthlyReport(setup);
    const ctx = { settings: gateway, clock, messaging: messaging as never, record, save: () => saves.push(record.entries().length), log: (l: string) => logs.push(l), store: { bookings: new Map(rules.bookings.map((b) => [b.id, { ...b, pending: Array(b.pending).fill({}) }])) } as never };
    const before = record.entries().length;
    const result = await jobRun.run(ctx);
    const written = record.entries().slice(before).map((e) => ({ seq: e.seq, time: e.time, action: e.action, outcome: e.outcome, booking: e.booking, language: e.language, notes: e.notes, refs: e.refs }));
    const files: Record<string, string> = {};
    for (const d of readdirSync(dir)) for (const f of readdirSync(join(dir, d))) files[`${d}/${f}`] = sha(readFileSync(join(dir, d, f), "utf8"));
    runs.push({ mode, entries: recordRef(entries), bookings: rules.bookings, now: at(12, 1, 10, 30), result, sent, written, saves, logs, files });
    rmSync(dir, { recursive: true, force: true });
  }
  return runs;
})();

const stamp = (v: unknown): string => JSON.stringify({ node: process.version, ...(v as object) }) + "\n";

/** Which check link each message chose: the signed summary, the #digest link or the #code link (so the cases hold all three). */
function checkKinds(derived: unknown[]): string[] {
  const kinds = new Set<string>();
  for (const d of derived as { messages?: Record<string, { ok?: { template: { parameters: string[] } } }> }[]) {
    for (const m of Object.values(d.messages ?? {})) {
      const p = m.ok?.template.parameters.find((x) => x.startsWith("https://geometer.dev/verify/"));
      if (p) kinds.add(p.includes("#s1.") ? "summary" : /#sha256:/.test(p) ? "digest" : "code");
    }
  }
  return [...kinds].sort();
}

function vectors(): unknown {
  const cases = CASES.map(derive);
  const kinds = checkKinds(cases);
  if (kinds.join() !== "code,digest,summary") throw new Error(`the cases must make messages with each kind of check link (summary, digest, code); they make: ${kinds.join(", ")}`);
  const fileRuns = [filesOf(CASES[0], "both"), filesOf(CASES[1], "hi"), filesOf(CASES[5], "en"), filesOf(CASES[6], "ml"), filesOf(CASES[10], "kn"), filesOf(CASES[14], "en")];
  const badSource = trial(() => buildMonthlyReport({ settings: gateway, entries: [], bookings: [], from: 0, to: 1, source: BAD_SOURCE.source, madeAt: 0 }));
  const noSettings = trial(() => readSettings(undefined));
  return {
    signer: SIGNER, publicKey: PUB, languages: LANGUAGES, records: asJson(RECORDS), cases, files: fileRuns, badSource, noSettings,
    policies: policies(), ledgers: ledgers(), goLive: goLiveReadings(), job,
    sizes: { busyEntries: busyEntries.length, rulesEntries: rules.entries.length, upiEntries: upiEntries.length },
    templateLanguages: languagesOf("both"),
  };
}

/** Packed (gzip, level 9): the pages repeat their style sheet and the shop records repeat, so the file is a tenth of its text. */
export function generate(): Map<string, Buffer> { return new Map([["bookingsreport/testdata/vectors.json.gz", gzipSync(Buffer.from(stamp(vectors())), { level: 9 })]]); }

/** The text of a vector file without its `node` member, so a newer Node that writes the same figures is not reported stale. */
const withoutNode = (packed: Buffer): string => { const o = JSON.parse(gunzipSync(packed).toString("utf8")); delete o.node; return JSON.stringify(o); };

export function staleFiles(root = INTERNAL): string[] {
  return [...generate()].filter(([name, data]) => !existsSync(join(root, name)) || withoutNode(readFileSync(join(root, name))) !== withoutNode(data)).map(([name]) => name);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--check")) {
    const stale = staleFiles();
    if (stale.length) { console.error(`out of date: ${stale.join(", ")}  (run node go/scripts/gen_bookings_report_vectors.ts)`); process.exit(1); }
  } else {
    for (const [name, data] of generate()) { mkdirSync(dirname(join(INTERNAL, name)), { recursive: true }); writeFileSync(join(INTERNAL, name), data); }
    console.log(`written with Node ${process.version}`);
  }
}
