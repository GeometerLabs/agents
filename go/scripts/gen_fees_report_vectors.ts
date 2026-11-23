// Writes the TEST VECTORS of the Go Fees monthly report (go/internal/feesreport/testdata/vectors.json.gz), made by RUNNING the TypeScript on Node: templates/education/fees/report/* on several
// Fees centre records, the way a month's report is made and sent. For each case: the report as the sealed envelope file (so the tree, its digest, code and signature are compared byte for
// byte), the report page and the owner's text in every language asked for, the signed summary link and the TypeScript verifier's reading of it (`checkSummaryLink`), and the WhatsApp message
// (text and template) in all four languages. Besides the cases: the policy digest and the "not tested" list of several settings (each as the raw settings FILE too, so the Go test runs
// fees.ReadSettings and Settings.ReportTree on it and compares the digest), the go-live certificates the report reads (every status and every way to be untrusted, made by the
// TypeScript's own `buildGoLiveCertificate`), `writeFeesReport`'s files, and `createMonthlyReport` (the job's wiring over a scripted messaging: the folder, the files, the claim and ending).
//
// Fees has no monthly record certificate (report/certificate.ts is the go-live certificate), so no vector holds one.
//
// The TypeScript is given the REAL fees (the conversation store's `Due` values); Go is given only a small projection of them (`dues` in each case: month, state, how many payments, what is
// left in paise), made here by `project`, so the test shows the projection is all the report reads. STUDENTS' NAMES: the settings and the record's notes of every case NAME students (the
// harness writes "the fee for Rohan Mehta, 2026-11, is open"); the Go test scans every file and message it makes for each name and number the case holds, so a report that carried one fails.
//
// The centre records are made by RUNNING the TypeScript: the busy month of the Fees example (report/example-month.ts, the harness with stand-in services), and records built here with the
// real record (`createRecord`) and the real `createAccounting.post`, so the money lines carry the refs the books wrote: a gateway centre with every rule of the counting (limits at their
// stop sites and not elsewhere, reminders and receipts by template, waivers by the owner and within the limit, old dues, a refund a person settled by their word, Classes), a UPI centre, a
// financial year end, a wind-down month, a quiet month and an empty one. The signing key is a TEST VALUE made from a fixed 32-byte seed (so Ed25519's deterministic signatures can be
// compared); it signs nothing real. The vectors name the Node that made them.
// Run from the repository root:  node go/scripts/gen_fees_report_vectors.ts   (--check only compares; the test words-fresh fails when it was not run after a change to the report)
import { createPrivateKey, createHash } from "node:crypto";
import type { KeyObject } from "node:crypto";
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
import { envelopeFile, keyIdOf, publicKeyHex, seal } from "../../modules/report/sign.ts";
import { checkSummaryLink, summaryLinkFor } from "../../modules/report/summary-sign.ts";
import type { ListedSigner } from "../../modules/report/summary-sign.ts";
import { languagesOf } from "../../modules/report/text.ts";
import { monthRange } from "../../modules/report/months.ts";
import { capabilitiesOf } from "../../modules/payments/providers/index.ts";
import { ApiError } from "../../modules/core/faults.ts";
import { FEES_LEGACY } from "../../templates/education/fees/src/accounting.ts";
import { brightTuition } from "../../templates/education/fees/src/harness.ts";
import { parseSettings } from "../../templates/education/fees/src/settings.ts";
import type { Settings } from "../../templates/education/fees/src/settings.ts";
import { balancePaise } from "../../templates/education/fees/src/due.ts";
import type { Due } from "../../templates/education/fees/src/due.ts";
import { buildFeesReport, checkedPolicyDigest, policyDigest } from "../../templates/education/fees/report/data.ts";
import type { GoLiveFinding } from "../../templates/education/fees/report/data.ts";
import { buildGoLiveCertificate } from "../../templates/education/fees/report/certificate.ts";
import { reportPage } from "../../templates/education/fees/report/html.ts";
import { ownerText } from "../../templates/education/fees/report/text.ts";
import { monthlyReportMessage } from "../../templates/education/fees/report/whatsapp.ts";
import { reportSummaryFields } from "../../templates/education/fees/report/summary.ts";
import { writeFeesReport } from "../../templates/education/fees/report/run.ts";
import { createMonthlyReport } from "../../templates/education/fees/report/monthly-job.ts";
import { readGoLive } from "../../templates/education/fees/report/cli.ts";
import { readGoLiveCertificate } from "../../templates/education/fees/report/go-live.ts";
import { notTestedOf } from "../../templates/education/fees/crash-test/not-tested.ts";
import { runBusyMonth } from "../../templates/education/fees/report/example-month.ts";
import { newRecord } from "./lib_books_worlds.ts";

const here = dirname(fileURLToPath(import.meta.url));
const INTERNAL = join(here, "..", "internal");
export const OUT = INTERNAL;
const FEES = new URL("../../templates/education/fees/", import.meta.url);

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
const asJson = <T>(v: T): T => JSON.parse(JSON.stringify(v));

// ---- the centres' settings: the example centre (Razorpay), the same centre on UPI, with Classes, another centre, other time zones ----
const rawFile = (name: string): string => readFileSync(new URL(`settings/${name}`, FEES), "utf8");
const RAW: Record<string, string> = { gateway: rawFile("bright-tuition.example.json"), upi: rawFile("bright-tuition-upi.example.json"), classes: rawFile("bright-tuition-classes.example.json"), maths: rawFile("maths-circle.example.json") };
const gateway: Settings = brightTuition();
const upiSettings: Settings = parseSettings(JSON.parse(RAW.upi));
const classesSettings: Settings = parseSettings(JSON.parse(RAW.classes));
const maths: Settings = parseSettings(JSON.parse(RAW.maths));
const rawGateway = JSON.parse(RAW.gateway);
const RAW_NYC = { ...rawGateway, name: "  Brooklyn Tuition  ", timezone: "America/New_York" };
const RAW_AUCKLAND = { ...rawGateway, name: "ब्राइट ट्यूशन", timezone: "Pacific/Auckland", owner: { ...rawGateway.owner, language: "hi" } };
// the owner's rules written differently: a rule for a part month, the late fee and the reminders set, an unsorted list of days, no address, a student with an earlier unpaid month
const RAW_RULES: Record<string, unknown> = { ...rawGateway, joiningMidMonth: "prorata", lateFeeInr: 100, reminders: { daysFromDue: [5, -3, 0], hour: 11 }, partPayments: { allowed: false }, waiver: { limitInr: 100 },
  students: rawGateway.students.map((x: Record<string, unknown>, i: number) => (i === 0 ? { ...x, joined: "2026-11-18", backDues: [{ month: "2026-09", amountInr: 500 }] } : x)) };
delete RAW_RULES.address;
const nyc: Settings = parseSettings(RAW_NYC);
const auckland: Settings = parseSettings(RAW_AUCKLAND);
const rules: Settings = parseSettings(RAW_RULES);

// ---- records built here: the real record and the real post() ----
type Ex = { refs?: Record<string, string>; decisions?: { ruleId: string; verdict: string; reason: string }[]; language?: Language; notes?: string; conversation?: string };
function world(settings: Settings, startIso = "2026-10-01T00:00:00Z") {
  const r = newRecord(Date.parse(startIso));
  const acc = createAccounting({ record: { entries: r.entries }, shop: { timezone: settings.timezone }, legacy: FEES_LEGACY, clock: r.clock });
  const add = (when: string, action: string, outcome: Outcome, booking: string | null, ex: Ex = {}): RecordEntry => r.append(Date.parse(when), { action, outcome, booking, ...ex } as never);
  const pay = (when: string, event: Record<string, unknown>, action: string, outcome: Outcome, booking: string | null, ex: Ex = {}): void => {
    r.clock.set(Date.parse(when));
    acc.post(event as never, (money) => { r.append(Date.parse(when), { action, outcome, booking, ...ex, refs: { ...(ex.refs ?? {}), ...money } } as never); });
  };
  return { r, add, pay, entries: (): RecordEntry[] => [...r.entries()] };
}
const block = (ruleId: string) => ({ ruleId, verdict: "block", reason: `${ruleId} said no` });
const allow = (ruleId: string) => ({ ruleId, verdict: "allow", reason: "fine" });
const D = (d: number, h = 10, m = 0, mo = 11) => `2026-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`;
const received = (fee: string, id: string, paise: number, extra: Record<string, unknown> = {}) => ({ kind: "received", case: fee, paymentId: id, amountPaise: paise, method: "gateway", evidence: "provider", for: "fee", ...extra });
const marked = (fee: string, id: string, paise: number, via: string) => ({ kind: "received", case: fee, paymentId: id, amountPaise: paise, method: via, evidence: "owner_mark", for: "fee" });
const feeLine = (w: ReturnType<typeof world>, when: string, fee: string, student: string, paise: number, month = "2026-11", back = false) =>
  w.pay(when, { kind: "fee_charged", case: fee, amountPaise: paise }, "open_fee", "confirmed", fee, { refs: { month, amountPaise: String(paise), ...(back ? { backDue: "true" } : {}) }, notes: `the fee for ${student}, ${month}, is open`, conversation: "919811111111" });

/** A fee as the conversation store keeps it, with the members the report does not read filled in. */
function due(o: Partial<Due> & { id: string; month: string; state: Due["state"] }): Due {
  return { studentName: "Aarav Sharma", batchId: "class-8", customer: "+919811111111", language: "en", dueMs: 0, feeInr: 1500, lateFeeInr: 0, waivedInr: 0, links: [], payments: [], reminders: [], pending: [], ...o } as unknown as Due;
}
const pays = (...amounts: number[]) => amounts.map((a, i) => ({ id: `pay_${i}`, amountPaise: a })) as never;
/** What the Go report is given of a fee: the members the report reads, as plain JSON. No name, no number. */
const project = (d: Due) => ({ month: d.month, state: d.state, payments: d.payments.length, balancePaise: balancePaise(d) });

/** A gateway centre's November that exercises every rule of the counting. */
function rulesWorld(): { entries: RecordEntry[]; dues: Due[] } {
  const w = world(gateway);
  const conv = (n: number) => ({ conversation: `91981000${String(n).padStart(4, "0")}` });
  // October: f-30 opened and an old due f-31 (opened as a back due when the agent started)
  feeLine(w, D(2, 5, 0, 10), "f-30", "Meera Nair", 120000, "2026-10");
  feeLine(w, D(2, 5, 1, 10), "f-31", "Kiran Gowda", 90000, "2026-08", true);
  // November: five fees opened, one of them an old due carried in
  feeLine(w, D(2, 5), "f-1", "Rohan Mehta", 150000);
  feeLine(w, D(2, 5, 1), "f-2", "Aarav Sharma", 180000);
  feeLine(w, D(2, 5, 2), "f-3", "Anaya Sharma", 180000);
  feeLine(w, D(2, 5, 3), "f-4", "Kiran Gowda", 120000);
  feeLine(w, D(2, 5, 4), "f-5", "Meera Nair", 120000);
  feeLine(w, D(2, 5, 5), "f-6", "Kiran Gowda", 90000, "2026-09", true);
  // payments: paid in full, part paid, an old due paid (old dues collected), a second payment on one link (goes back), an old due paid in October (not this month's)
  w.pay(D(3, 6), received("f-1", "pay_1", 150000), "record_payment", "confirmed", "f-1", { refs: { paymentId: "pay_1" }, ...conv(1) });
  w.pay(D(3, 7), received("f-2", "pay_2", 180000), "record_payment", "confirmed", "f-2", { refs: { paymentId: "pay_2" }, ...conv(2) });
  w.pay(D(3, 8), received("f-5", "pay_5", 60000), "record_payment", "confirmed", "f-5", { refs: { paymentId: "pay_5" }, ...conv(5) });
  w.pay(D(3, 9), received("f-6", "pay_6", 90000), "record_payment", "confirmed", "f-6", { refs: { paymentId: "pay_6" }, ...conv(4) });
  w.pay(D(3, 10), received("f-1", "pay_1x", 150000, { for: "extra" }), "record_payment", "blocked", "f-1", { refs: { paymentId: "pay_1x" }, ...conv(1) });
  w.pay(D(30, 6, 0, 10), received("f-31", "pay_31", 90000), "record_payment", "confirmed", "f-31", { refs: { paymentId: "pay_31" }, ...conv(4) });
  // a late fee, and waivers: by the owner, within the limit, one with no amount written, one with an amount that is not a number, one that did not confirm
  w.pay(D(11, 5), { kind: "late_fee", case: "f-3", amountPaise: 10000 }, "add_late_fee", "confirmed", "f-3", { refs: { amountPaise: "10000" }, ...conv(3) });
  w.pay(D(4, 5), { kind: "discount", case: "f-4", amountPaise: 10000 }, "waive_fee", "confirmed", "f-4", { refs: { amountPaise: "10000", by: "agent" }, ...conv(4) });
  w.pay(D(4, 6), { kind: "discount", case: "f-3", amountPaise: 30000 }, "waive_fee", "confirmed", "f-3", { refs: { amountPaise: "30000", by: "owner" }, ...conv(3) });
  w.add(D(4, 7), "waive_fee", "confirmed", "f-3", { refs: { by: "owner" }, ...conv(3) });
  w.add(D(4, 8), "waive_fee", "confirmed", "f-3", { refs: { by: "agent", amountPaise: "lots" }, ...conv(3) });
  w.add(D(4, 9), "waive_fee", "failed", "f-3", { refs: { by: "owner", amountPaise: "5000" }, ...conv(3) });
  // asked of the owner: a waiver (twice for one request: counted once by its request id), a refund (twice for one payment: once), a refund with no payment id (by its own number), no fee
  w.add(D(4, 10), "waiver_request", "held_for_owner", "f-3", { refs: { request: "q-1" }, ...conv(3) });
  w.add(D(4, 11), "waiver_request", "held_for_owner", "f-3", { refs: { request: "q-1" }, ...conv(3) });
  w.add(D(5, 5), "refund", "held_for_owner", "f-1", { refs: { paymentId: "pay_1" }, ...conv(1) });
  w.add(D(5, 6), "refund", "held_for_owner", "f-1", { refs: { paymentId: "pay_1" }, ...conv(1) });
  w.add(D(5, 7), "refund", "held_for_owner", "f-2", conv(2));
  w.add(D(5, 8), "refund", "held_for_owner", null, { refs: { paymentId: "pay_n" }, ...conv(25) });
  w.add(D(5, 9), "waiver_request", "unconfirmed", "f-3", { refs: { request: "q-9" }, ...conv(3) }); // not held for the owner
  // the owner's answers: approve, approve, deny, a command not known, none, a failed one
  w.add(D(6, 5), "owner_decision", "confirmed", "f-3", { refs: { command: "approve" }, ...conv(3) });
  w.add(D(6, 6), "owner_decision", "confirmed", "f-1", { refs: { command: "approve" }, ...conv(1) });
  w.add(D(6, 7), "owner_decision", "confirmed", "f-2", { refs: { command: "deny" }, ...conv(2) });
  w.add(D(6, 8), "owner_decision", "confirmed", "f-2", { refs: { command: "retry" }, ...conv(2) });
  w.add(D(6, 9), "owner_decision", "confirmed", "f-2", conv(2));
  w.add(D(6, 10), "owner_decision", "failed", "f-2", { refs: { command: "approve" }, ...conv(2) });
  // refunds: given back, one settled by a person's word, more settled by word (the same person, a long and a many-line name)
  w.pay(D(7, 5), { kind: "refund_owed", case: "f-1", owed: "f-1:pay_1", paymentId: "pay_1", amountPaise: 40000 }, "refund", "held_for_owner", "f-1", { refs: { paymentId: "pay_1" }, ...conv(1) });
  w.pay(D(7, 6), { kind: "refund_made", case: "f-1", owed: "f-1:pay_1", paymentId: "pay_1", amountPaise: 40000, method: "gateway", evidence: "provider", refundId: "rf_1" }, "refund", "confirmed", "f-1", { refs: { paymentId: "pay_1", refundId: "rf_1" }, ...conv(1) });
  w.pay(D(7, 7), received("f-2", "pay_2b", 25000), "record_payment", "confirmed", "f-2", { refs: { paymentId: "pay_2b" }, ...conv(2) });
  w.pay(D(7, 8), { kind: "refund_owed", case: "f-2", owed: "f-2:pay_2b", paymentId: "pay_2b", amountPaise: 25000 }, "refund", "held_for_owner", "f-2", { refs: { paymentId: "pay_2b" }, ...conv(2) });
  w.pay(D(7, 9), { kind: "refund_made", case: "f-2", owed: "f-2:pay_2b", paymentId: "pay_2b", amountPaise: 25000, method: "gateway", evidence: "person_word" }, "refund", "confirmed", "f-2", { refs: { paymentId: "pay_2b", confirmedBy: "operator:asha" }, ...conv(2) });
  w.add(D(7, 10), "refund", "confirmed", "f-2", { refs: { paymentId: "pay_x1", confirmedBy: "operator:ravi" }, ...conv(2) });
  w.add(D(7, 11), "refund", "confirmed", "f-2", { refs: { paymentId: "pay_x2", confirmedBy: "a very long name that goes on and on for far more than forty characters of text", amountPaise: "5000" }, ...conv(2) });
  w.add(D(7, 12), "refund", "confirmed", "f-2", { refs: { paymentId: "pay_x3", confirmedBy: "line one\nline two", amountPaise: "700" }, ...conv(2) });
  // limits at their stop sites. A block is counted at ONE entry, under the rule that blocked it, once; no pairing of a check and its message in Fees.
  w.add(D(8, 5), "refund", "blocked", "f-2", { decisions: [block("refund-limit")], ...conv(2) });
  w.add(D(8, 6), "owner_decision", "blocked", "f-2", { decisions: [block("refund-limit"), block("one-refund-per-payment")], ...conv(2) });
  w.add(D(8, 7), "refund", "blocked", "f-2", { decisions: [block("one-refund-per-payment"), block("one-refund-per-payment")], ...conv(2) }); // the same rule twice: one
  w.add(D(8, 8), "send_message", "blocked", "f-2", { decisions: [block("refund-limit")], refs: { to: "customer" }, ...conv(2) }); // not its site
  w.add(D(8, 9), "waiver_request", "blocked", "f-3", { decisions: [block("waiver-limit")], ...conv(3) });
  w.add(D(8, 10), "ask_owner", "blocked", "f-3", { decisions: [block("waiver-limit")], ...conv(3) });
  w.add(D(8, 11), "send_message", "blocked", "f-3", { decisions: [block("waiver-limit")], refs: { to: "customer" }, ...conv(3) }); // not its site
  w.add(D(8, 12), "create_fee_link", "blocked", "f-4", { decisions: [block("fee-link-matches-record")], ...conv(4) });
  w.add(D(8, 13), "send_message", "blocked", "f-4", { decisions: [block("fee-link-matches-record")], refs: { to: "customer" }, ...conv(4) }); // not its site
  for (const [i, rule] of ["no-reminder-once-paid", "reminder-cap", "paid-only-when-recorded", "message-matches-record", "opt-out"].entries()) {
    w.add(D(9, 5 + i), "send_message", "blocked", "f-1", { decisions: [block(rule)], refs: { to: "customer" }, ...conv(1) });
    w.add(D(9, 12 + i), "voice_note_reply", "blocked", "f-1", { decisions: [block(rule)], refs: { to: "customer" }, ...conv(1) });
  }
  w.add(D(9, 20), "send_message", "blocked", "f-1", { decisions: [block("reminder-cap"), block("opt-out"), block("opt-out"), allow("message-matches-record")], refs: { to: "customer" }, ...conv(1) }); // two rules, one stop
  w.add(D(9, 21), "send_message", "blocked", "f-1", { decisions: [block("subscription_suspended")], refs: { to: "owner" }, ...conv(1) }); // the licence's rule: never a limit that held
  w.add(D(9, 22), "send_message", "blocked", "f-1", { decisions: [allow("message-matches-record")], refs: { to: "customer" }, ...conv(1) }); // an allow is not a stop, but the message was held back
  // reminders and receipts: by template and language, a joined template name, a template of another kind, to the owner
  const toParent = (d: number, h: number, language: Language, templates: string, who = 1) => w.add(D(d, h), "send_message", "confirmed", "f-1", { language, refs: { to: "customer", templates }, ...conv(who) });
  toParent(10, 5, "en", "fee_reminder"); toParent(10, 6, "hi", "fee_reminder_family"); toParent(10, 7, "ml", "fee_reminder_family_page"); toParent(10, 8, "kn", "fee_overdue"); toParent(10, 9, "en", "fee_overdue_late", 2);
  toParent(10, 10, "en", "fee_reminder+fee_received"); toParent(10, 11, "hi", "fee_received"); toParent(10, 12, "ml", "fee_part_received"); toParent(10, 13, "kn", "fee_menu"); toParent(10, 14, "en", "");
  w.add(D(10, 15), "send_message", "confirmed", "f-1", { language: "en", refs: { to: "customer" }, ...conv(1) }); // no template written
  w.add(D(10, 16), "send_message", "unconfirmed", "f-1", { language: "en", refs: { to: "customer", templates: "fee_reminder" }, ...conv(1) }); // not confirmed: not counted
  w.add(D(10, 17), "send_message", "confirmed", null, { language: "hi", refs: { to: "owner" }, ...conv(43) });
  w.add(D(10, 18), "send_message", "unconfirmed", null, { refs: { to: "owner" }, ...conv(43) });
  w.add(D(10, 19), "voice_note_reply", "confirmed", "f-1", { refs: { to: "owner" }, ...conv(44) });
  // parents who sent STOP: one twice, one other, one whose stop did not confirm
  w.add(D(11, 5), "opt_out", "confirmed", null, conv(40));
  w.add(D(11, 6), "opt_out", "confirmed", null, conv(40));
  w.add(D(11, 7), "opt_out", "confirmed", null, conv(41));
  w.add(D(11, 8), "opt_out", "unconfirmed", null, conv(42));
  // left unconfirmed or failed: a payment step, a message (not counted), a reply to a voice note (counted), a delivery report (not counted)
  w.add(D(12, 5), "record_payment", "failed", "f-4", conv(4));
  w.add(D(12, 6), "send_message", "unconfirmed", "f-4", { refs: { to: "customer" }, ...conv(4) });
  w.add(D(12, 7), "voice_note_reply", "unconfirmed", null, { refs: { to: "customer" }, ...conv(45) });
  w.add(D(12, 8), "message_status", "failed", "f-4", conv(4));
  w.add(D(12, 9), "message_status", "unconfirmed", null, conv(4));
  w.add(D(12, 10), "create_fee_link", "failed", "f-4", conv(4));
  // the record's own lines and an odd one, then December
  w.add(D(16, 5), "restored", "confirmed", null, conv(46));
  w.add(D(16, 6), "licence", "confirmed", null, { refs: { state: "grace" }, ...conv(46) });
  w.add(D(1, 5, 0, 12), "open_fee", "confirmed", "f-90", { refs: { month: "2026-12" }, notes: "the fee for Rohan Mehta, 2026-12, is open", ...conv(90) });
  const dues = [
    due({ id: "f-1", month: "2026-11", state: "paid", feeInr: 1500, payments: pays(150000) }),
    due({ id: "f-2", month: "2026-11", state: "open", feeInr: 1800, payments: pays(180000, 25000) }), // more paid than owed: nothing to collect
    due({ id: "f-3", month: "2026-11", state: "open", feeInr: 1800, lateFeeInr: 100, waivedInr: 300 }),
    due({ id: "f-4", month: "2026-11", state: "open", feeInr: 1200, waivedInr: 100 }),
    due({ id: "f-5", month: "2026-11", state: "open", feeInr: 1200, payments: pays(60000) }), // part paid
    due({ id: "f-6", month: "2026-09", state: "paid", feeInr: 900, payments: pays(90000) }),
    due({ id: "f-30", month: "2026-10", state: "open", feeInr: 1200 }),
    due({ id: "f-7", month: "2026-11", state: "cancelled" as never, feeInr: 1200 }), // neither open nor paid
    due({ id: "f-8", month: "2026-12", state: "open", feeInr: 1200 }),
  ];
  return { entries: w.entries(), dues };
}

/** A UPI centre's November: the owner's marks (UPI, cash, bank) are the payment record. */
function upiWorld(): { entries: RecordEntry[]; dues: Due[] } {
  const w = world(upiSettings);
  for (const [i, s] of ["Rohan Mehta", "Aarav Sharma", "Anaya Sharma", "Meera Nair", "Kiran Gowda"].entries()) feeLine(w, D(2, 5, i), `f-${i + 1}`, s, 150000);
  w.add(D(2, 11), "upi_request", "confirmed", "f-1", { refs: { requestId: "upi-1" } });
  w.pay(D(2, 12), marked("f-1", "upi-1", 150000, "upi"), "owner_marked_paid", "confirmed", "f-1", { refs: { requestId: "upi-1", amountPaise: "150000", markedBy: "owner" } });
  w.pay(D(4, 10), marked("f-3", "cash-3", 160000, "cash"), "owner_marked_paid", "confirmed", "f-3", { refs: { requestId: "upi-3", via: "cash", amountPaise: "160000", markedBy: "owner" } });
  w.pay(D(6, 10), marked("f-4", "bank-4", 120000, "bank"), "owner_marked_paid", "confirmed", "f-4", { refs: { requestId: "upi-4", via: "bank", amountPaise: "120000", markedBy: "owner" } });
  w.pay(D(7, 9), { kind: "refund_owed", case: "f-3", owed: "upr-3", paymentId: "cash-3", amountPaise: 160000 }, "upi_refund_owed", "held_for_owner", "f-3", { refs: { refundId: "upr-3" } });
  w.pay(D(8, 9), { kind: "refund_made", case: "f-3", owed: "upr-3", paymentId: "cash-3", amountPaise: 160000, method: "cash", evidence: "owner_mark", refundId: "upr-3" }, "upi_refund_marked_done", "confirmed", "f-3", { refs: { refundId: "upr-3" } });
  w.pay(D(9, 9), { kind: "discount", case: "f-5", amountPaise: 20000 }, "waive_fee", "confirmed", "f-5", { refs: { amountPaise: "20000", by: "owner" } });
  w.add(D(9, 10), "send_message", "confirmed", "f-2", { language: "ml", refs: { to: "customer", templates: "fee_reminder_family" } });
  w.add(D(12, 9), "owner_decision", "confirmed", "f-5", { refs: { command: "approve" } });
  const dues = [due({ id: "f-1", month: "2026-11", state: "paid", payments: pays(150000) }), due({ id: "f-2", month: "2026-11", state: "open" }), due({ id: "f-3", month: "2026-11", state: "open", payments: pays(160000), feeInr: 1500 })];
  return { entries: w.entries(), dues };
}

/** A Classes centre's November: classes held with attendance, links and notes sent, doubts (answered and not), and a class record on a centre WITHOUT Classes (counted nowhere). */
function classesWorld(): { entries: RecordEntry[]; dues: Due[] } {
  const w = world(classesSettings);
  feeLine(w, D(2, 5), "f-1", "Rohan Mehta", 150000);
  for (const d of [3, 5, 10]) {
    w.add(D(d, 11), "send_message", "confirmed", null, { language: "en", refs: { to: "customer", templates: "class_link" } });
    w.add(D(d, 12), "class_attendance", "confirmed", null, { refs: { batch: "class-10", present: "7", absent: "2" } });
  }
  w.add(D(11, 12), "class_attendance", "confirmed", null, { refs: { batch: "class-10", present: "5" } }); // no absent written
  w.add(D(12, 13), "class_attendance", "unconfirmed", null, { refs: { batch: "class-10", present: "9", absent: "9" } });
  w.add(D(13, 12), "send_message", "confirmed", null, { language: "ml", refs: { to: "customer", templates: "class_missed_note" } });
  w.add(D(13, 13), "send_message", "confirmed", null, { language: "ml", refs: { to: "customer", templates: "class_link+class_missed_note" } });
  w.add(D(14, 12), "class_doubt", "confirmed", null, { refs: { batch: "class-10" } });
  w.add(D(14, 13), "class_doubt", "confirmed", null, { refs: { batch: "class-10", answered: "yes" } });
  w.add(D(14, 14), "class_doubt", "confirmed", null, { refs: { batch: "class-10", answered: "" } }); // written, empty: answered
  w.add(D(14, 15), "class_doubt", "unconfirmed", null, { refs: { batch: "class-10" } });
  return { entries: w.entries(), dues: [due({ id: "f-1", month: "2026-11", state: "open", payments: pays(50000) })] };
}

/** The financial year end: lines either side of 31 March 18:30 UTC (midnight in India), a restore. */
function fyendWorld(): RecordEntry[] {
  const w = world(gateway, "2027-03-01T00:00:00Z");
  feeLine(w, "2027-03-30T05:00:00Z", "f-1", "Rohan Mehta", 150000, "2027-03");
  w.pay("2027-03-30T06:00:00Z", received("f-1", "pay_1", 150000), "record_payment", "confirmed", "f-1", { refs: { paymentId: "pay_1" } });
  w.pay("2027-03-31T18:29:59.999Z", received("f-2", "pay_2", 180000), "record_payment", "confirmed", "f-2", { refs: { paymentId: "pay_2" } });
  w.pay("2027-03-31T18:30:00.000Z", received("f-3", "pay_3", 120000), "record_payment", "confirmed", "f-3", { refs: { paymentId: "pay_3" } });
  w.add("2027-04-01T05:00:00Z", "restored", "confirmed", null);
  w.pay("2027-04-02T05:00:00Z", { kind: "refund_owed", case: "f-2", owed: "f-2:pay_2", paymentId: "pay_2", amountPaise: 30000 }, "refund", "held_for_owner", "f-2", { refs: { paymentId: "pay_2" } });
  w.pay("2027-04-02T06:00:00Z", { kind: "refund_made", case: "f-2", owed: "f-2:pay_2", paymentId: "pay_2", amountPaise: 30000, method: "gateway", evidence: "provider", refundId: "rf_2" }, "refund", "confirmed", "f-2", { refs: { paymentId: "pay_2", refundId: "rf_2" } });
  return w.entries();
}

/** A wind-down month: the licence's lines and its rule, and nothing else the centre did. */
function windDownWorld(): RecordEntry[] {
  const w = world(gateway);
  w.add("2026-11-05T05:00:00Z", "licence", "confirmed", null, { refs: { state: "wound_down" } });
  w.add("2026-11-05T05:00:01Z", "send_message", "confirmed", null, { refs: { to: "owner", licence: "notice" }, language: "en" });
  w.add("2026-11-06T05:00:00Z", "send_message", "blocked", "f-1", { decisions: [block("subscription_suspended")], refs: { to: "customer" } });
  return w.entries();
}

/** Lines the job itself wrote, and nothing else: a quiet month. */
function quietWorld(): RecordEntry[] {
  const w = world(gateway);
  w.add("2026-10-30T05:00:00Z", "open_fee", "confirmed", "f-1", { refs: { month: "2026-10" } });
  w.add("2026-11-01T05:00:00Z", "send_message", "confirmed", null, { refs: { to: "owner", report: "2026-10", code: "7K2M-9QXD" } });
  return w.entries();
}

// The busy month of the example (the harness with stand-in services): a centre with a month of real steps, its record naming every student in the notes.
const busy = await runBusyMonth();
const busyEntries: RecordEntry[] = [...busy.world.record.entries()];
const busyDues: Due[] = [...busy.world.store.dues.values()];

const rulesW = rulesWorld();
const upi = upiWorld();
const classes = classesWorld();
const fyendEntries = fyendWorld();
const windDownEntries = windDownWorld();
const quietEntries = quietWorld();
/** The centre records the vectors share, written once (a case or a job names one). */
const RECORDS: Record<string, readonly RecordEntry[]> = { busy: busyEntries, rules: rulesW.entries, upi: upi.entries, classes: classes.entries, fyend: fyendEntries, winddown: windDownEntries, quiet: quietEntries, empty: [] };
const recordRef = (entries: readonly RecordEntry[]): string | RecordEntry[] => Object.entries(RECORDS).find(([, v]) => v === entries)?.[0] ?? asJson(entries);

// ---- the cases ----
interface Case {
  name: string; settings: Settings; entries: readonly RecordEntry[]; dues: Due[];
  month?: string; range?: [number, number]; source: "stand-in" | "test-mode" | "live"; madeAt: number;
  preparedBy: string | null; innovator?: boolean; goLive?: GoLiveFinding; tenant?: string;
  signed: boolean; pages: ("en" | "hi" | "ml" | "kn" | "both")[];
}
const FINDING_OWN: GoLiveFinding = { status: "own", code: "AB12-CD34", signedBy: "key:" + "ab".repeat(32), issuedOn: { year: 2026, month: 10, day: 20 }, held: 14, total: 14, failed: 0, notRun: 0, notTested: 14 };
const FINDING_SKIPS: GoLiveFinding = { ...FINDING_OWN, held: 12, total: 13, failed: 1, notRun: 2 } as GoLiveFinding;
const FINDING_EXAMPLE: GoLiveFinding = { status: "example", code: "EF56-GH78", signedBy: "key:" + "cd".repeat(32), issuedOn: { year: 2026, month: 9, day: 3 } };
const FINDING_DIFFERENT: GoLiveFinding = { status: "different", code: "JK90-LM12", signedBy: "key:" + "ef".repeat(32), issuedOn: { year: 2026, month: 11, day: 30 } };
const NOW = at(12, 1, 9, 30);
const base = { source: "stand-in" as const, madeAt: NOW, signed: true, pages: ["en"] as Case["pages"], dues: [] as Due[] };
const longName = (n: number) => ({ ...gateway, name: "Bright Tuition " + "ब्राइट ट्यूशन नगर ".repeat(Math.ceil(n / 14)).slice(0, n) }) as Settings;

const CASES: Case[] = [
  { ...base, name: "busy-both-signed", settings: gateway, entries: busyEntries, dues: busyDues, month: "2026-11", preparedBy: "Divya, Sri Sai Digital", innovator: true, goLive: FINDING_OWN, tenant: "bright", pages: ["both", "ml"], source: "live" },
  { ...base, name: "busy-unsigned-hi", settings: gateway, entries: busyEntries, dues: busyDues, month: "2026-11", preparedBy: "Divya", goLive: FINDING_EXAMPLE, signed: false, pages: ["hi", "kn"] },
  { ...base, name: "busy-october-untrusted", settings: gateway, entries: busyEntries, month: "2026-10", preparedBy: "Ravi & Sons <Digital>", goLive: { status: "untrusted" }, pages: ["ml"], source: "test-mode" },
  { ...base, name: "busy-december-different", settings: gateway, entries: busyEntries, dues: busyDues, month: "2026-12", preparedBy: "Divya", goLive: FINDING_DIFFERENT, tenant: "bright", pages: ["kn", "en"] },
  { ...base, name: "busy-custom-range", settings: gateway, entries: busyEntries, dues: busyDues, range: [at(11, 3, 0), at(11, 10, 0)], preparedBy: "Divya", goLive: FINDING_SKIPS, pages: ["en", "hi"] },
  { ...base, name: "busy-no-golive", settings: gateway, entries: busyEntries, dues: busyDues, month: "2026-11", preparedBy: "Divya", pages: ["en"] },
  { ...base, name: "upi-world", settings: upiSettings, entries: upi.entries, dues: upi.dues, month: "2026-11", preparedBy: "Asha", innovator: true, tenant: "bright-upi", pages: ["both", "kn"] },
  { ...base, name: "upi-unsigned-ml", settings: upiSettings, entries: upi.entries, dues: upi.dues, month: "2026-11", preparedBy: "Asha", signed: false, goLive: FINDING_OWN, pages: ["ml", "en"] },
  { ...base, name: "rules-gateway", settings: gateway, entries: rulesW.entries, dues: rulesW.dues, month: "2026-11", preparedBy: "Meena", innovator: true, tenant: "Bright Tuition", pages: ["en", "ml", "both"] },
  { ...base, name: "rules-gateway-skips", settings: gateway, entries: rulesW.entries, dues: rulesW.dues, month: "2026-11", preparedBy: "Meena", goLive: FINDING_SKIPS, pages: ["hi", "kn"] },
  { ...base, name: "rules-october", settings: gateway, entries: rulesW.entries, dues: rulesW.dues, month: "2026-10", preparedBy: "Meena", pages: ["hi"] },
  { ...base, name: "rules-own-rules", settings: rules, entries: rulesW.entries, dues: rulesW.dues, month: "2026-11", preparedBy: "Meena", pages: ["en", "hi", "ml", "kn"] },
  { ...base, name: "rules-maths-circle", settings: maths, entries: rulesW.entries, dues: rulesW.dues, month: "2026-11", preparedBy: "Meena", pages: ["en"] },
  { ...base, name: "classes-centre", settings: classesSettings, entries: classes.entries, dues: classes.dues, month: "2026-11", preparedBy: "Kavya", innovator: true, tenant: "bright-classes", pages: ["en", "hi", "ml", "kn"] },
  { ...base, name: "classes-unsigned", settings: classesSettings, entries: classes.entries, dues: classes.dues, month: "2026-11", preparedBy: "Kavya", signed: false, pages: ["both"] },
  { ...base, name: "classes-record-without-classes-settings", settings: gateway, entries: classes.entries, dues: classes.dues, month: "2026-11", preparedBy: "Kavya", pages: ["en"] },
  { ...base, name: "fyend-march", settings: gateway, entries: fyendEntries, month: "2027-03", preparedBy: "Meena", tenant: "fy-end", pages: ["en", "hi"], madeAt: at(4, 1, 9, 30, 2027) },
  { ...base, name: "fyend-april", settings: gateway, entries: fyendEntries, month: "2027-04", preparedBy: "Meena", tenant: "fy-end", pages: ["en"], madeAt: at(5, 1, 9, 30, 2027) },
  { ...base, name: "wind-down", settings: gateway, entries: windDownEntries, month: "2026-11", preparedBy: "Divya", pages: ["en", "kn"] },
  { ...base, name: "quiet", settings: gateway, entries: quietEntries, month: "2026-11", preparedBy: "Divya", tenant: "quiet", pages: ["en"] },
  { ...base, name: "empty-record", settings: gateway, entries: RECORDS.empty, month: "2026-11", preparedBy: "Divya", tenant: "empty", pages: ["en", "hi"], innovator: true },
  { ...base, name: "no-prepared-by", settings: gateway, entries: quietEntries, month: "2026-11", preparedBy: null, pages: ["en"] },
  { ...base, name: "blank-prepared-by", settings: gateway, entries: quietEntries, month: "2026-11", preparedBy: "  \n ", pages: ["en"] },
  { ...base, name: "other-zone-newyork", settings: nyc, entries: rulesW.entries, dues: rulesW.dues, month: "2026-11", preparedBy: "Sam", pages: ["en"], madeAt: zonedToMs({ year: 2026, month: 12, day: 1 }, { hour: 9, minute: 30 }, "America/New_York") },
  { ...base, name: "other-zone-auckland", settings: auckland, entries: rulesW.entries, dues: rulesW.dues, month: "2026-11", preparedBy: "तारा", pages: ["hi", "ml"], madeAt: zonedToMs({ year: 2026, month: 12, day: 1 }, { hour: 9, minute: 30 }, "Pacific/Auckland") },
  // the message must fit WhatsApp's 1024 characters: a long centre name pushes the signed summary link out, then the #digest link, then the #code link is used
  { ...base, name: "long-name-180", settings: longName(180), entries: rulesW.entries, dues: rulesW.dues, month: "2026-11", preparedBy: "Meena", pages: ["en"] },
  { ...base, name: "long-name-300", settings: longName(300), entries: rulesW.entries, month: "2026-11", preparedBy: "Meena", pages: ["hi"] },
  { ...base, name: "long-name-420", settings: longName(420), entries: rulesW.entries, month: "2026-11", preparedBy: "Meena", pages: ["ml"] },
  { ...base, name: "long-name-600", settings: longName(600), entries: rulesW.entries, month: "2026-11", preparedBy: "Meena", pages: ["kn"] },
  { ...base, name: "long-name-unsigned", settings: longName(500), entries: rulesW.entries, month: "2026-11", preparedBy: "Meena", signed: false, pages: [] },
  // the owner's marks on a gateway centre: the books count them, the rows above do not, and the page says why (booksOnly)
  { ...base, name: "gateway-with-owner-marks", settings: gateway, entries: upi.entries, dues: upi.dues, month: "2026-11", preparedBy: "Asha", pages: ["en", "hi"] },
  // text that reaches the page and the message is escaped or put on one line
  { ...base, name: "escapes", settings: { ...gateway, name: "Bright & <b>Tuition</b> \"A's\"\n  line two" } as Settings, entries: rulesW.entries, dues: rulesW.dues, month: "2026-11", preparedBy: "Meena\n  S\t<x>&", innovator: true, pages: ["en", "kn"] },
  // a record that is not a chain: the report cannot be anchored, and says why
  { ...base, name: "ledger-gap", settings: gateway, entries: rulesW.entries.filter((e) => e.seq !== 5), month: "2026-11", preparedBy: "Divya", tenant: "gap", pages: [] },
  { ...base, name: "ledger-bad-time", settings: gateway, entries: rulesW.entries.map((e) => (e.seq === 3 ? { ...e, time: "not a time" } : e)), month: "2026-11", preparedBy: "Divya", tenant: "bad-time", pages: [] },
  { ...base, name: "ledger-bad-tenant", settings: gateway, entries: quietEntries, month: "2026-11", preparedBy: "Divya", tenant: "!!!", pages: [] },
  { ...base, name: "period-backwards", settings: gateway, entries: quietEntries, range: [at(11, 10, 0), at(11, 3, 0)], preparedBy: "Divya", pages: [] },
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

/** The students of a centre, as the Go test must never find them in a file: each name, each parent's number. */
const peopleOf = (s: Settings): { names: string[]; numbers: string[] } => ({ names: [...new Set(s.students.map((x) => x.name))], numbers: [...new Set(s.students.map((x) => x.parent))] });

function derive(c: Case): unknown {
  const settingsJson = asJson(c.settings);
  const { from, to } = c.range ? { from: c.range[0], to: c.range[1] } : monthRange(c.month!, c.settings.timezone);
  const input = {
    settings: c.settings, entries: c.entries, dues: c.dues, from, to, source: c.source, madeAt: c.madeAt,
    ...(c.preparedBy !== null ? { preparedBy: c.preparedBy } : {}), ...(c.innovator ? { innovator: true } : {}), ...(c.goLive ? { goLive: c.goLive } : {}),
    ...(c.tenant !== undefined ? { ledger: { tenant: c.tenant } } : {}),
  };
  const head = { name: c.name, settings: settingsJson, people: peopleOf(c.settings), entries: recordRef(c.entries), dues: c.dues.map(project), month: c.month ?? null, range: c.range ?? null, from, to, source: c.source, madeAt: c.madeAt,
    preparedBy: c.preparedBy, innovator: c.innovator === true, goLive: c.goLive ?? null, tenant: c.tenant ?? null, signed: c.signed };
  const built = trial(() => buildFeesReport(input));
  if ("error" in built) return { ...head, error: built.error };
  const report = built.ok;
  const key = c.signed ? KEY : undefined;
  const sealed = seal(report, key);
  const reportCheck = summaryLinkFor(sealed, reportSummaryFields(report), key);
  const pages = Object.fromEntries(c.pages.map((l) => [l, reportPage(sealed, l, reportCheck)]));
  const owner = Object.fromEntries(LANGUAGES.map((l) => [l, ownerText(report, l)]));
  const messages = Object.fromEntries(LANGUAGES.map((l) => [l, trial(() => monthlyReportMessage(sealed, l, { link: LINK(c, l), ...(reportCheck ? { check: reportCheck } : {}) }))]));
  return { ...head, report: envelopeFile(sealed), check: reportCheck ?? null, checked: checkOf(reportCheck), pages, owner, messages };
}

// ---- the files writeFeesReport writes ----
function filesOf(c: Case, language: "en" | "hi" | "ml" | "kn" | "both"): unknown {
  const out = mkdtempSync(join(tmpdir(), "fees-report-"));
  try {
    const made = writeFeesReport({
      settings: c.settings, entries: c.entries, dues: c.dues, month: c.month!, language, out, source: c.source,
      ...(c.signed ? { key: KEY } : {}), ...(c.preparedBy !== null ? { preparedBy: c.preparedBy } : {}), ...(c.innovator ? { innovator: true } : {}), ...(c.goLive ? { goLive: c.goLive } : {}),
      now: c.madeAt, ...(c.tenant ? { tenant: c.tenant } : {}),
    });
    const names = readdirSync(out).sort();
    return { name: c.name, language, written: made.files.map((f) => f.slice(out.length + 1)), sha: Object.fromEntries(names.map((n) => [n, sha(readFileSync(join(out, n), "utf8"))])), ownerTexts: made.ownerTexts, code: made.code, check: made.check ?? null };
  } finally { rmSync(out, { recursive: true, force: true }); }
}

// ---- the go-live certificates the report reads (made by the TypeScript's own builder) ----
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
    { name: "different", settings: gateway, text: cert(gateway, { ...handCheck, ranOn: policyDigest(maths) }) },
    { name: "other-key", settings: gateway, text: cert(gateway, { ...handCheck, ranOn: policyDigest(gateway) }, KEY2) },
    { name: "unsigned", settings: gateway, text: cert(gateway, { ...handCheck, ranOn: policyDigest(gateway) }, undefined) },
    { name: "changed", settings: gateway, text: cert(gateway, { ...handCheck, ranOn: policyDigest(gateway) }).replace("\"held\":14", "\"held\":15") },
    { name: "not-json", settings: gateway, text: "this is not a certificate" },
    { name: "empty", settings: gateway, text: "" },
    { name: "a monthly report", settings: gateway, text: envelopeFile(seal({ format: "geometer-fees-report/1", anchor: null }, KEY)) },
    { name: "other-template", settings: gateway, text: cert(gateway, { ...handCheck, ranOn: policyDigest(gateway) }, KEY, (d) => { d.pathway = { name: "orders", version: "0.1.0" }; }) },
    { name: "no-pathway", settings: gateway, text: cert(gateway, { ...handCheck, ranOn: policyDigest(gateway) }, KEY, (d) => { delete d.pathway; }) },
    { name: "bad-counts", settings: gateway, text: cert(gateway, { ...handCheck, ranOn: policyDigest(gateway) }, KEY, (d) => { (d.checks as Record<string, unknown>).held = -1; }) },
  ];
  const missing = "/nonexistent/go-live-certificate.json"; // a fixed path that is not there: the vectors must not carry a machine's own paths
  return {
    cases: cases.map((c) => ({ name: c.name, settings: asJson(c.settings), text: c.text, reading: readGoLiveCertificate(c.text, c.settings) })),
    paths: { none: readGoLive(undefined, gateway), empty: readGoLive("", gateway), missing: { path: missing, reading: readGoLive(missing, gateway) } },
  };
}

// ---- the policy digest and what is not tested ----
/** A settings file as the owner writes it (raw text), the validated settings the TypeScript digests, and the digest: the Go test reads the TEXT with fees.ReadSettings, builds the tree and digests it. */
function policies(): unknown {
  const named: [string, string, Settings][] = [["gateway", RAW.gateway, gateway], ["upi", RAW.upi, upiSettings], ["classes", RAW.classes, classesSettings], ["maths", RAW.maths, maths],
    ["newyork", JSON.stringify(RAW_NYC), nyc], ["auckland", JSON.stringify(RAW_AUCKLAND), auckland], ["own-rules", JSON.stringify(RAW_RULES), rules]];
  const rows = named.map(([name, text, s]) => {
    const validated = asJson(s);
    if (policyDigest(validated as Settings) !== policyDigest(s)) throw new Error(`the policy digest of ${name} changes when the settings go through JSON: the Go report would digest another tree than the TypeScript`);
    return { name, text, settings: validated, digest: policyDigest(s), confirmsAutomatically: capabilitiesOf(s.payment).confirmsAutomatically, notTested: notTestedOf(s).map((n) => n.id) };
  });
  const noPayment = { ...asJson(gateway) } as Record<string, unknown>; delete noPayment.payment;
  const unknownModule = { ...asJson(gateway), payment: { module: "somewhere-else" } };
  return {
    rows, checkedPolicyDigest: checkedPolicyDigest(),
    noPayment: { settings: noPayment, confirmsAutomatically: capabilitiesOf(undefined).confirmsAutomatically, notTested: notTestedOf(noPayment as never).map((n) => n.id) },
    unknownModule: { settings: unknownModule, confirmsAutomatically: capabilitiesOf(unknownModule.payment as never).confirmsAutomatically, notTested: notTestedOf(unknownModule as never).map((n) => n.id) },
  };
}

// ---- createMonthlyReport: the job's wiring over a scripted messaging ----
const job = await (async () => {
  const runs: unknown[] = [];
  for (const mode of ["template", "text", "document-refused", "no-activity"] as const) {
    const clock = fakeClock(at(12, 1, 10, 30));
    const entries = mode === "no-activity" ? quietEntries : rulesW.entries;
    const record = createRecord(clock, entries);
    const dir = mkdtempSync(join(tmpdir(), "fees-job-"));
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
    const setup = { source: "stand-in" as const, pages: { dir, baseUrl: "https://reports.example.com/r" }, options: () => ({ preparedBy: "Divya, Sri Sai Digital", innovator: mode === "text" }), key: KEY, goLive: () => FINDING_OWN, token: () => "0123456789abcdef0123456789abcdef", tenant: "bright" };
    const jobRun = createMonthlyReport(setup);
    const ctx = { settings: gateway, clock, messaging: messaging as never, record, save: () => saves.push(record.entries().length), log: (l: string) => logs.push(l), store: { dues: new Map(rulesW.dues.map((d) => [d.id, d])) } as never };
    const before = record.entries().length;
    const result = await jobRun.run(ctx);
    const written = record.entries().slice(before).map((e) => ({ seq: e.seq, time: e.time, action: e.action, outcome: e.outcome, booking: e.booking, language: e.language, notes: e.notes, refs: e.refs }));
    const files: Record<string, string> = {};
    for (const d of readdirSync(dir)) for (const f of readdirSync(join(dir, d))) files[`${d}/${f}`] = sha(readFileSync(join(dir, d, f), "utf8"));
    runs.push({ mode, entries: recordRef(entries), dues: rulesW.dues.map(project), now: at(12, 1, 10, 30), result, sent, written, saves, logs, files });
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
  const fileRuns = [filesOf(CASES[0], "both"), filesOf(CASES[1], "hi"), filesOf(CASES[6], "en"), filesOf(CASES[7], "ml"), filesOf(CASES.find((c) => c.name === "classes-centre")!, "kn"), filesOf(CASES.find((c) => c.name === "quiet")!, "en")];
  const badSource = trial(() => buildFeesReport({ settings: gateway, entries: [], dues: [], from: 0, to: 1, source: BAD_SOURCE.source, madeAt: 0 }));
  const text = JSON.stringify(cases);
  if (/\/Users\/|\/private\/|\/var\/folders|\/tmp\//.test(text)) throw new Error("a vector holds a path of this machine");
  return {
    signer: SIGNER, publicKey: PUB, languages: LANGUAGES, records: asJson(RECORDS), cases, files: fileRuns, badSource,
    policies: policies(), goLive: goLiveReadings(), job,
    sizes: { busyEntries: busyEntries.length, rulesEntries: rulesW.entries.length, upiEntries: upi.entries.length, classesEntries: classes.entries.length },
    templateLanguages: languagesOf("both"),
  };
}

/** Packed (gzip, level 9): the pages repeat their style sheet and the centre records repeat, so the file is a tenth of its text. */
export function generate(): Map<string, Buffer> { return new Map([["feesreport/testdata/vectors.json.gz", gzipSync(Buffer.from(stamp(vectors())), { level: 9 })]]); }

/** The text of a vector file without its `node` member, so a newer Node that writes the same figures is not reported stale. */
const withoutNode = (packed: Buffer): string => { const o = JSON.parse(gunzipSync(packed).toString("utf8")); delete o.node; return JSON.stringify(o); };

export function staleFiles(root = INTERNAL): string[] {
  return [...generate()].filter(([name, data]) => !existsSync(join(root, name)) || withoutNode(readFileSync(join(root, name))) !== withoutNode(data)).map(([name]) => name);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--check")) {
    const stale = staleFiles();
    if (stale.length) { console.error(`out of date: ${stale.join(", ")}  (run node go/scripts/gen_fees_report_vectors.ts)`); process.exit(1); }
  } else {
    for (const [name, data] of generate()) { mkdirSync(dirname(join(INTERNAL, name)), { recursive: true }); writeFileSync(join(INTERNAL, name), data); }
    console.log(`written with Node ${process.version}`);
  }
}
