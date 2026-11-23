// Writes the TEST VECTORS of the Go Orders monthly report (go/internal/ordersreport/testdata/vectors.json.gz), made by RUNNING the TypeScript on Node: templates/commerce/orders/report/*
// and src/plans/report.ts on several Orders shop records, the way a month's report is made and sent. For each case: the report as the sealed envelope file (so the tree, its digest, code
// and signature are compared byte for byte), the report page and the owner's text in every language asked for, the signed summary link and the TypeScript verifier's reading of it
// (`checkSummaryLink`), and the WhatsApp message (text and template) in all four languages. Besides the cases: the policy digest and the "not tested" list of several settings, the
// go-live certificates the report reads (every status and every way to be untrusted, made by the TypeScript's own `buildGoLiveCertificate`), `writeOrdersReport`'s files, and
// `createMonthlyReport` (the job's wiring over a scripted messaging: the folder, the files, the claim and ending entries).
//
// Orders has no monthly record certificate (report/summary.ts says so) and its go-live certificate is the CLI's and the deployer's, so no vector holds a monthly certificate.
//
// The TypeScript is given the REAL orders (the conversation store's `Order` values); Go is given only a small projection of them (`orders` in each case: id, state, pending, day, way,
// lines, total, advance, whether the balance was marked received), made here by `project`, so the test shows the projection is all the report reads.
//
// The shop records are made by RUNNING the TypeScript: the busy month of the Orders example (report/example-month.ts, the harness with stand-in services; a UPI shop), and records built here
// with the real record (`createRecord`) and the real `createAccounting.post`, so the money lines carry the refs the books wrote: a gateway shop with every rule of the counting (limits at
// their stop sites and not elsewhere, the check-and-message pairs, owner decisions, balances, a refund a person settled by their word, a payment made twice), a plans shop, a financial
// year end, a wind-down month, a quiet month and an empty one. The signing key is a TEST VALUE made from a fixed 32-byte seed (so Ed25519's deterministic signatures can be compared); it
// signs nothing real. The vectors name the Node that made them.
// Run from the repository root:  node go/scripts/gen_orders_report_vectors.ts   (--check only compares; the test words-fresh fails when it was not run after a change to the report)
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
import { ORDERS_LEGACY } from "../../templates/commerce/orders/src/accounting.ts";
import { annapurna, annapurnaPlans, annapurnaRazorpay, sweetCrumbs } from "../../templates/commerce/orders/src/harness.ts";
import { parseSettings } from "../../templates/commerce/orders/src/settings.ts";
import type { Settings } from "../../templates/commerce/orders/src/settings.ts";
import type { Order } from "../../templates/commerce/orders/src/order.ts";
import { buildOrdersReport, checkedPolicyDigest, policyDigest } from "../../templates/commerce/orders/report/data.ts";
import type { GoLiveFinding } from "../../templates/commerce/orders/report/data.ts";
import { buildGoLiveCertificate } from "../../templates/commerce/orders/report/certificate.ts";
import { reportPage } from "../../templates/commerce/orders/report/html.ts";
import { ownerText } from "../../templates/commerce/orders/report/text.ts";
import { monthlyReportMessage } from "../../templates/commerce/orders/report/whatsapp.ts";
import { reportSummaryFields } from "../../templates/commerce/orders/report/summary.ts";
import { writeOrdersReport } from "../../templates/commerce/orders/report/run.ts";
import { createMonthlyReport } from "../../templates/commerce/orders/report/monthly-job.ts";
import { readGoLive } from "../../templates/commerce/orders/report/cli.ts";
import { readGoLiveCertificate } from "../../templates/commerce/orders/report/go-live.ts";
import { notTestedOf } from "../../templates/commerce/orders/crash-test/not-tested.ts";
import { runBusyMonth } from "../../templates/commerce/orders/report/example-month.ts";
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
const asJson = <T>(v: T): T => JSON.parse(JSON.stringify(v));

// ---- the shops' settings: the example shop (a UPI shop), the same shop on Razorpay (a gateway shop), with plans, another menu, other time zones ----
const upiSettings: Settings = annapurna();
const gateway: Settings = annapurnaRazorpay();
const plansSettings: Settings = annapurnaPlans();
const sweet: Settings = sweetCrumbs();
const rawAnnapurna = JSON.parse(readFileSync(new URL("../../templates/commerce/orders/settings/annapurna-tiffins-razorpay.example.json", import.meta.url), "utf8"));
const nyc: Settings = parseSettings({ ...rawAnnapurna, name: "  Brooklyn Tiffins  ", timezone: "America/New_York" });
const auckland: Settings = parseSettings({ ...rawAnnapurna, name: "अन्नपूर्णा टिफिन्स", timezone: "Pacific/Auckland", owner: { ...rawAnnapurna.owner, language: "hi" } });
// a menu with names only in English for a shop that writes in English (the name falls back to English in the other three languages), one Malayalam name, and an empty list of Hindi names
const oddMenu: Settings = parseSettings({ ...rawAnnapurna, languages: ["en"], menu: [
  { id: "veg-thali", names: { en: ["veg thali"] }, priceInr: 120, dailyStock: 12 },
  { id: "chicken-meal", names: { en: ["chicken meal"], ml: ["ചിക്കൻ ഊണ്"] }, priceInr: 160, dailyStock: 8 },
  { id: "curd", names: { en: ["curd"], hi: [] }, priceInr: 20, dailyStock: 30 },
] });;

// ---- records built here: the real record and the real post() ----
type Ex = { refs?: Record<string, string>; decisions?: { ruleId: string; verdict: string; reason: string }[]; language?: Language; notes?: string; conversation?: string };
function world(settings: Settings, startIso = "2026-10-01T00:00:00Z") {
  const r = newRecord(Date.parse(startIso));
  const acc = createAccounting({ record: { entries: r.entries }, shop: { timezone: settings.timezone }, legacy: ORDERS_LEGACY, clock: r.clock });
  const add = (when: string, action: string, outcome: Outcome, booking: string | null, ex: Ex = {}): RecordEntry => r.append(Date.parse(when), { action, outcome, booking, ...ex } as never);
  const pay = (when: string, event: Record<string, unknown>, action: string, outcome: Outcome, booking: string | null, ex: Ex = {}): void => {
    r.clock.set(Date.parse(when));
    acc.post(event as never, (money) => { r.append(Date.parse(when), { action, outcome, booking, ...ex, refs: { ...(ex.refs ?? {}), ...money } } as never); });
  };
  return { r, add, pay, entries: (): RecordEntry[] => [...r.entries()] };
}
const block = (ruleId: string) => ({ ruleId, verdict: "block", reason: `${ruleId} said no` });
const allow = (ruleId: string) => ({ ruleId, verdict: "allow", reason: "fine" });
const received = (o: string, id: string, paise: number, extra: Record<string, unknown> = {}) => ({ kind: "received", case: o, paymentId: id, amountPaise: paise, method: "gateway", evidence: "provider", for: "advance", ...extra });
const D = (d: number, h = 10, m = 0, mo = 11) => `2026-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`;

/** An order as the conversation store keeps it, with the members the report does not read filled in. */
function order(o: Partial<Order> & { id: string }): Order {
  return { customer: "+919810000001", language: "en", state: "confirmed", lines: [], dateNeedsConfirmation: false, awaitingAddress: false, handledPayments: [], pending: [], ...o } as Order;
}
/** What the Go report is given of an order: the members the report reads, as plain JSON. */
const project = (o: Order) => ({ id: o.id, state: o.state, pending: o.pending.length, date: o.date ?? null, mode: o.mode ?? "", lines: o.lines.map((l) => ({ itemId: l.itemId, qty: l.qty })), totalInr: o.totalInr ?? 0, advanceInr: o.advanceInr ?? 0, balancePaid: o.balance?.paid !== undefined });
type Projected = ReturnType<typeof project>;

/** A gateway shop's November that exercises every rule of the counting. */
function rulesWorld(): { entries: RecordEntry[]; orders: Order[] } {
  const w = world(gateway);
  const conv = (n: number) => ({ conversation: `91981000${String(n).padStart(4, "0")}` });
  // October: o-30 confirmed (so its cancel in November is a cancel), o-31 paid in October
  w.add(D(30, 5, 0, 10), "hold_stock", "confirmed", "o-30", conv(30));
  w.pay(D(30, 6, 0, 10), received("o-30", "pay_30", 20000), "record_payment", "confirmed", "o-30", { refs: { paymentId: "pay_30" }, ...conv(30) });
  w.add(D(30, 7, 0, 10), "confirm_order", "confirmed", "o-30", conv(30));
  // o-1: taken, paid, completed, then a refund held for the owner and given back
  w.add(D(1, 5), "hold_stock", "confirmed", "o-1", conv(1));
  w.pay(D(1, 6), received("o-1", "pay_1", 24000), "record_payment", "confirmed", "o-1", { refs: { paymentId: "pay_1" }, ...conv(1) });
  w.add(D(1, 6, 5), "confirm_order", "confirmed", "o-1", conv(1));
  w.add(D(1, 6, 5), "confirm_order", "confirmed", "o-1", conv(1)); // the same order again: counted once
  w.pay(D(2, 5), { kind: "applied", case: "o-1", amountPaise: 24000, service: "orders" }, "complete_order", "confirmed", "o-1", conv(1));
  w.add(D(2, 6), "complete_order", "confirmed", "o-1", conv(1));
  w.add(D(3, 5), "cancel_order", "confirmed", "o-1", conv(1)); // a late cancellation of an order taken: counted as cancelled
  w.add(D(3, 5, 1), "cancel_order", "confirmed", "o-2", conv(2)); // never confirmed: not an order taken
  w.add(D(3, 5, 2), "cancel_order", "confirmed", null, conv(2)); // no order id at all
  w.add(D(3, 5, 3), "cancel_order", "confirmed", "", conv(2)); // an empty order id is not one
  w.pay(D(3, 5, 5), { kind: "refund_owed", case: "o-1", owed: "o-1:pay_1", paymentId: "pay_1", amountPaise: 24000 }, "refund", "held_for_owner", "o-1", { refs: { paymentId: "pay_1" }, ...conv(1) });
  w.pay(D(3, 6), { kind: "refund_made", case: "o-1", owed: "o-1:pay_1", paymentId: "pay_1", amountPaise: 24000, method: "gateway", evidence: "provider", refundId: "rf_1" }, "refund", "confirmed", "o-1", { refs: { paymentId: "pay_1", refundId: "rf_1" }, ...conv(1) });
  // o-30 cancelled in November: a cancel of an order taken in October
  w.add(D(4, 5), "cancel_order", "confirmed", "o-30", conv(30));
  // holds that ran out, in the month and out of it
  w.add(D(4, 6), "release_stock", "confirmed", "o-3", conv(3));
  w.add(D(4, 7), "release_stock", "confirmed", "o-3", conv(3));
  w.add(D(4, 8), "release_stock", "unconfirmed", "o-4", conv(4));
  w.add(D(4, 9), "release_stock", "confirmed", "o-5", conv(5));
  // limits at their stop sites. A check and the message that tells the customer carry the same decision: one stop.
  w.add(D(5, 5), "check_order", "blocked", "o-6", { decisions: [block("within-stock")], ...conv(6) });
  w.add(D(5, 5, 1), "send_message", "blocked", "o-6", { decisions: [block("within-stock")], refs: { to: "customer" }, ...conv(6) }); // the pair: counted once
  w.add(D(5, 6), "check_order", "blocked", "o-7", { decisions: [block("before-cutoff"), block("within-day-cap")], ...conv(7) });
  w.add(D(5, 6, 1), "voice_note_reply", "blocked", "o-7", { decisions: [block("before-cutoff")], refs: { to: "customer" }, ...conv(7) }); // before-cutoff paired, within-day-cap not repeated: one stop
  w.add(D(5, 7), "send_message", "blocked", "o-8", { decisions: [block("within-stock")], refs: { to: "customer" }, ...conv(8) }); // a message with no check before it: a stop
  w.add(D(5, 8), "check_order", "blocked", "o-9", { decisions: [block("within-stock")], ...conv(9) });
  w.add(D(5, 8, 1), "hold_stock", "confirmed", "o-9", conv(9)); // another entry in between: the check is no longer pending
  w.add(D(5, 8, 2), "send_message", "blocked", "o-9", { decisions: [block("within-stock")], refs: { to: "customer" }, ...conv(9) }); // so this message is its own stop
  w.add(D(5, 9), "check_order", "blocked", "o-10", { decisions: [block("within-stock")], ...conv(10) });
  w.add(D(5, 9, 1), "send_message", "blocked", "o-10", { decisions: [block("within-stock")], refs: { to: "customer" }, ...conv(11) }); // a message of another conversation: a stop of its own
  w.add(D(5, 10), "check_address", "blocked", "o-12", { decisions: [block("within-delivery-area")], ...conv(12) });
  w.add(D(5, 10, 1), "send_message", "blocked", "o-12", { decisions: [block("within-delivery-area"), block("price-at-or-above-menu")], refs: { to: "customer" }, ...conv(12) }); // the area is the pair, the price is new
  w.add(D(5, 11), "check_order", "unconfirmed", "o-13", { decisions: [block("within-stock")], ...conv(13) }); // a check entry whose outcome is not "blocked" still carries its block
  w.add(D(5, 11, 1), "send_message", "blocked", "o-13", { decisions: [block("within-stock"), block("order-size")], refs: { to: "customer" }, ...conv(13) });
  w.add(D(5, 12), "check_order", "blocked", "o-14", { decisions: [block("price-at-or-above-menu"), block("subscription_suspended")], ...conv(14) }); // a price at a check: not its site; a rule not listed
  w.add(D(5, 13), "send_message", "blocked", "o-14", { decisions: [block("confirm-only-when-recorded"), block("message-matches-record"), block("opt-out"), block("opt-out")], refs: { to: "customer" }, ...conv(14) });
  w.add(D(5, 14), "send_message", "blocked", "o-14", { decisions: [allow("message-matches-record")], refs: { to: "customer" }, ...conv(14) }); // an allow is not a stop, but the message was held back
  w.add(D(5, 15), "send_message", "blocked", "o-14", { decisions: [block("one-advance-per-order")], refs: { to: "customer" }, ...conv(14) }); // not its stop site
  w.add(D(5, 16), "record_payment", "blocked", "o-15", { decisions: [block("one-advance-per-order")], ...conv(15) });
  w.add(D(5, 17), "refund", "blocked", "o-15", { decisions: [block("refund-limit")], ...conv(15) });
  w.add(D(5, 18), "owner_decision", "blocked", "o-15", { decisions: [block("refund-limit")], ...conv(15) });
  w.add(D(5, 19), "send_message", "blocked", "o-15", { decisions: [block("refund-limit")], refs: { to: "customer" }, ...conv(15) }); // not its stop site
  w.add(D(5, 20), "send_message", "blocked", "o-15", { decisions: [block("subscription_suspended")], refs: { to: "owner" }, ...conv(15) }); // the licence's rule: never a limit that held
  // an order paid twice (a second payment on a link goes back), and a balance paid when collected
  w.pay(D(6, 5), received("o-16", "pay_16", 36000), "record_payment", "confirmed", "o-16", { refs: { paymentId: "pay_16" }, ...conv(16) });
  w.pay(D(6, 6), received("o-16", "pay_16x", 36000, { for: "extra" }), "record_payment", "blocked", "o-16", { refs: { paymentId: "pay_16x" }, ...conv(16) });
  w.add(D(6, 7), "confirm_order", "confirmed", "o-16", conv(16));
  w.add(D(6, 8), "record_balance", "confirmed", "o-16", { refs: { balancePaise: "12000" }, ...conv(16) });
  w.add(D(6, 9), "record_balance", "confirmed", "o-17", { refs: { balancePaise: "5050" }, ...conv(17) });
  w.add(D(6, 10), "record_balance", "confirmed", "o-18", conv(18)); // no amount written down: counted, adds nothing
  w.add(D(6, 11), "record_balance", "confirmed", "o-19", { refs: { balancePaise: "not a number" }, ...conv(19) });
  w.add(D(6, 12), "record_balance", "failed", "o-20", { refs: { balancePaise: "9900" }, ...conv(20) });
  // refunds: one unconfirmed and settled by another payment's refund, one settled by a person's word, more settled by word (the same person, no amount, a long and a many-line name)
  w.pay(D(7, 5), received("o-21", "pay_21", 30000), "record_payment", "confirmed", "o-21", { refs: { paymentId: "pay_21" }, ...conv(21) });
  w.add(D(7, 7), "refund", "unconfirmed", "o-21", { refs: { paymentId: "pay_21" }, ...conv(21) });
  w.pay(D(7, 8), received("o-22", "pay_22", 25000), "record_payment", "confirmed", "o-22", { refs: { paymentId: "pay_22" }, ...conv(22) });
  w.pay(D(7, 9), { kind: "refund_owed", case: "o-22", owed: "o-22:pay_22", paymentId: "pay_22", amountPaise: 25000 }, "refund", "held_for_owner", "o-22", { refs: { paymentId: "pay_22" }, ...conv(22) });
  w.pay(D(7, 10), { kind: "refund_made", case: "o-22", owed: "o-22:pay_22", paymentId: "pay_22", amountPaise: 25000, method: "gateway", evidence: "person_word" }, "refund", "confirmed", "o-22", { refs: { paymentId: "pay_22", confirmedBy: "operator:asha" }, ...conv(22) });
  w.add(D(7, 11), "refund", "confirmed", "o-22", { refs: { paymentId: "pay_x1", confirmedBy: "operator:ravi" }, ...conv(22) });
  w.add(D(7, 12), "refund", "confirmed", "o-22", { refs: { paymentId: "pay_x2", confirmedBy: "a very long name that goes on and on for far more than forty characters of text", amountPaise: "5000" }, ...conv(22) });
  w.add(D(7, 13), "refund", "confirmed", "o-22", { refs: { paymentId: "pay_x3", confirmedBy: "line one\nline two", amountPaise: "700" }, ...conv(22) });
  // asked of the owner: a big order (twice for one order: counted by its own entry key), a late cancellation, the same refund twice, no payment id (by its own number), no order
  w.add(D(8, 5), "ask_owner", "held_for_owner", "o-23", conv(23));
  w.add(D(8, 6), "ask_owner", "held_for_owner", "o-23", conv(23)); // another entry of the same request has another number: counted again
  w.add(D(8, 7), "refund", "held_for_owner", "o-24", { refs: { paymentId: "pay_24" }, ...conv(24) });
  w.add(D(8, 8), "refund", "held_for_owner", "o-24", { refs: { paymentId: "pay_24" }, ...conv(24) }); // the same payment: once
  w.add(D(8, 9), "refund", "held_for_owner", null, { refs: { paymentId: "pay_n" }, ...conv(25) });
  w.add(D(8, 10), "ask_owner", "unconfirmed", "o-26", conv(26)); // not held for the owner
  w.add(D(8, 11), "send_message", "held_for_owner", "o-26", conv(26)); // not a request
  // the owner's answers: approve, approve, deny, a command not known, none at all, a failed one
  w.add(D(9, 5), "owner_decision", "confirmed", "o-23", { refs: { command: "approve" }, ...conv(23) });
  w.add(D(9, 6), "owner_decision", "confirmed", "o-24", { refs: { command: "approve" }, ...conv(24) });
  w.add(D(9, 7), "owner_decision", "confirmed", "o-25", { refs: { command: "deny" }, ...conv(25) });
  w.add(D(9, 8), "owner_decision", "confirmed", "o-27", { refs: { command: "retry" }, ...conv(27) });
  w.add(D(9, 9), "owner_decision", "confirmed", "o-28", conv(28));
  w.add(D(9, 10), "owner_decision", "failed", "o-29", { refs: { command: "approve" }, ...conv(29) });
  // customers who sent STOP: one twice, one other, one whose stop did not confirm
  w.add(D(10, 5), "opt_out", "confirmed", null, conv(40));
  w.add(D(10, 6), "opt_out", "confirmed", null, conv(40));
  w.add(D(10, 7), "opt_out", "confirmed", null, conv(41));
  w.add(D(10, 8), "opt_out", "unconfirmed", null, conv(42));
  // messages: to the owner (a reply to a voice note is not one), to a customer, one held back for not matching the record
  w.add(D(11, 5), "send_message", "confirmed", null, { refs: { to: "owner" }, language: "hi", ...conv(43) });
  w.add(D(11, 6), "send_message", "unconfirmed", null, { refs: { to: "owner" }, ...conv(43) });
  w.add(D(11, 7), "send_message", "confirmed", "o-44", { refs: { to: "customer" }, ...conv(44) });
  w.add(D(11, 8), "voice_note_reply", "confirmed", "o-44", { refs: { to: "owner" }, ...conv(44) });
  w.add(D(11, 9), "send_message", "blocked", "o-44", { decisions: [block("message-matches-record")], refs: { to: "owner" }, ...conv(44) });
  // left unconfirmed or failed: a payment step, a message (not counted), a reply to a voice note (counted), a delivery report (not counted)
  w.add(D(12, 5), "record_payment", "failed", "o-45", conv(45));
  w.add(D(12, 6), "send_message", "unconfirmed", "o-45", { refs: { to: "customer" }, ...conv(45) });
  w.add(D(12, 7), "voice_note_reply", "unconfirmed", null, { refs: { to: "customer" }, ...conv(45) });
  w.add(D(12, 8), "message_status", "failed", "o-45", conv(45));
  w.add(D(12, 9), "message_status", "unconfirmed", null, conv(45));
  w.add(D(12, 10), "check_order", "failed", "o-45", conv(45));
  // the record's own lines and an odd one
  w.add(D(16, 5), "restored", "confirmed", null, conv(46));
  w.add(D(16, 6), "licence", "confirmed", null, { refs: { state: "grace" }, ...conv(46) });
  // after the month: December
  w.add(D(1, 5, 0, 12), "hold_stock", "confirmed", "o-90", conv(90));
  w.add(D(1, 6, 0, 12), "confirm_order", "confirmed", "o-90", conv(90));
  const orders = [
    order({ id: "o-1", state: "completed", date: { year: 2026, month: 11, day: 2 }, mode: "pickup", lines: [{ itemId: "veg-thali", qty: 2 }, { itemId: "curd", qty: 1 }] as never, totalInr: 260, advanceInr: 260 }),
    order({ id: "o-16", state: "confirmed", date: { year: 2026, month: 11, day: 20 }, mode: "delivery", lines: [{ itemId: "chicken-meal", qty: 3 }, { itemId: "veg-thali", qty: 1 }] as never, totalInr: 600, advanceInr: 360 }),
    order({ id: "o-17", state: "confirmed", date: { year: 2026, month: 11, day: 21 }, mode: "pickup", lines: [{ itemId: "veg-thali", qty: 4 }] as never, totalInr: 480, advanceInr: 480 }), // nothing left to collect
    order({ id: "o-18", state: "confirmed", date: { year: 2026, month: 11, day: 22 }, mode: "pickup", lines: [{ itemId: "chicken-meal", qty: 1 }] as never, totalInr: 160, advanceInr: 60, balance: { amountInr: 100, paid: { by: "cash", atMs: 1 } } }), // balance already received
    order({ id: "o-19", state: "confirmed", date: { year: 2026, month: 11, day: 30 }, lines: [{ itemId: "curd", qty: 5 }] as never, totalInr: 100 }), // no way fixed, no advance
    order({ id: "o-20", state: "confirmed", date: { year: 2026, month: 11, day: 1 }, mode: "pickup", lines: [{ itemId: "unknown-item", qty: 2 }, { itemId: "veg-thali", qty: 0 }] as never, totalInr: 0, advanceInr: 5 }), // an item not on the menu; more paid than the total
    order({ id: "o-21", state: "cancelled", date: { year: 2026, month: 11, day: 5 }, mode: "pickup", lines: [{ itemId: "veg-thali", qty: 9 }] as never, totalInr: 1080, advanceInr: 0 }), // not sold
    order({ id: "o-22", state: "holding", date: { year: 2026, month: 11, day: 6 }, mode: "pickup", lines: [{ itemId: "veg-thali", qty: 9 }] as never, totalInr: 1080 }),
    order({ id: "o-23", state: "confirmed", date: { year: 2026, month: 12, day: 1 }, mode: "pickup", lines: [{ itemId: "veg-thali", qty: 7 }] as never, totalInr: 840, advanceInr: 840 }), // December
    order({ id: "o-24", state: "confirmed", date: { year: 2026, month: 10, day: 31 }, mode: "pickup", lines: [{ itemId: "veg-thali", qty: 7 }] as never, totalInr: 840, advanceInr: 840 }), // October
    order({ id: "o-25", state: "completed", mode: "delivery", lines: [{ itemId: "veg-thali", qty: 7 }] as never, totalInr: 840 }), // no day
    order({ id: "o-26", state: "confirmed", date: { year: 2026, month: 11, day: 8 }, mode: "delivery", lines: [{ itemId: "curd", qty: 2 }] as never, totalInr: 40, advanceInr: 40, pending: [{}] as never }),
  ];
  return { entries: w.entries(), orders };
}

/** A UPI shop's November: the owner's marks are the payment record. */
function upiWorld(): { entries: RecordEntry[]; orders: Order[] } {
  const w = world(upiSettings);
  for (const b of ["o-1", "o-2", "o-3", "o-4", "o-5"]) w.add(D(2), "hold_stock", "confirmed", b, { language: "hi" });
  w.add(D(2, 11), "upi_paid_claim", "confirmed", "o-1", { refs: { requestId: "upi-1" } });
  w.pay(D(2, 12), { kind: "received", case: "o-1", paymentId: "upi-1", amountPaise: 12000, method: "upi", evidence: "owner_mark", for: "advance" }, "owner_marked_paid", "confirmed", "o-1", { refs: { requestId: "upi-1", amountPaise: "12000" } });
  w.add(D(2, 13), "confirm_order", "confirmed", "o-1", { language: "hi" });
  w.add(D(3, 9), "upi_paid_claim", "confirmed", "o-2", { refs: { requestId: "upi-2" } });
  w.pay(D(4, 10), { kind: "received", case: "o-3", paymentId: "cash-3", amountPaise: 16000, method: "cash", evidence: "owner_mark", for: "advance" }, "owner_marked_paid", "confirmed", "o-3", { refs: { requestId: "upi-3", via: "cash", amountPaise: "16000" } });
  w.add(D(4, 11), "confirm_order", "confirmed", "o-3");
  w.add(D(5, 9), "cancel_order", "confirmed", "o-3");
  w.pay(D(5, 9, 5), { kind: "refund_owed", case: "o-3", owed: "upr-3", paymentId: "cash-3", amountPaise: 16000 }, "upi_refund_owed", "held_for_owner", "o-3", { refs: { refundId: "upr-3" } });
  w.pay(D(6, 9), { kind: "refund_made", case: "o-3", owed: "upr-3", paymentId: "cash-3", amountPaise: 16000, method: "cash", evidence: "owner_mark", refundId: "upr-3" }, "upi_refund_marked_done", "confirmed", "o-3", { refs: { refundId: "upr-3" } });
  w.pay(D(6, 10), { kind: "received", case: "o-4", paymentId: "upi-4", amountPaise: 32000, method: "upi", evidence: "owner_mark", for: "advance" }, "owner_marked_paid", "confirmed", "o-4", { refs: { requestId: "upi-4", amountPaise: "32000" } });
  w.add(D(6, 11), "confirm_order", "confirmed", "o-4");
  w.add(D(7, 9), "cancel_order", "confirmed", "o-4");
  w.pay(D(7, 9, 5), { kind: "refund_owed", case: "o-4", owed: "upr-4", paymentId: "upi-4", amountPaise: 32000 }, "upi_refund_owed", "held_for_owner", "o-4", { refs: { refundId: "upr-4" } });
  w.pay(D(9, 10), { kind: "received", case: "o-5", paymentId: "bank-5", amountPaise: 12000, method: "bank", evidence: "owner_mark", for: "advance" }, "owner_marked_paid", "confirmed", "o-5", { refs: { requestId: "upi-5", via: "bank", amountPaise: "12000" } });
  w.add(D(9, 11), "confirm_order", "confirmed", "o-5");
  w.add(D(10, 9), "cancel_order", "confirmed", "o-5");
  w.pay(D(10, 9, 5), { kind: "refund_owed", case: "o-5", owed: "upr-5", paymentId: "bank-5", amountPaise: 12000 }, "upi_refund_owed", "held_for_owner", "o-5", { refs: { refundId: "upr-5" } });
  w.pay(D(11, 9), { kind: "kept", case: "o-5", owed: "upr-5", why: "late_mark_kept" }, "upi_refund_kept", "confirmed", "o-5", { refs: { refundId: "upr-5", amountPaise: "12000" } });
  w.add(D(11, 12), "record_balance", "confirmed", "o-1", { refs: { balancePaise: "24000" } });
  w.add(D(12, 9), "owner_decision", "confirmed", "o-1", { refs: { command: "approve" } });
  w.add(D(12, 10), "send_message", "confirmed", null, { refs: { to: "owner" }, language: "hi" });
  const orders = [
    order({ id: "o-1", state: "completed", date: { year: 2026, month: 11, day: 3 }, mode: "pickup", lines: [{ itemId: "veg-thali", qty: 2 }, { itemId: "chicken-meal", qty: 1 }] as never, totalInr: 400, advanceInr: 120, balance: { amountInr: 280, paid: { by: "upi", atMs: 1 } } }),
    order({ id: "o-4", state: "confirmed", date: { year: 2026, month: 11, day: 25 }, mode: "delivery", lines: [{ itemId: "chicken-meal", qty: 2 }] as never, totalInr: 320, advanceInr: 320 }),
  ];
  return { entries: w.entries(), orders };
}

/** A plans shop's November: plans started, renewed, paused, credited, cancelled and lapsed, with some that began in October. */
function plansWorld(): { entries: RecordEntry[]; orders: Order[] } {
  const w = world(plansSettings);
  const plan = (id: string) => ({ plan: id });
  // October: p-1 started, p-2 started, p-3 started and cancelled
  w.add(D(2, 5, 0, 10), "plan_paid", "confirmed", null, { refs: { ...plan("p-1"), period: "0" } });
  w.add(D(3, 5, 0, 10), "plan_paid", "confirmed", null, { refs: { ...plan("p-2"), period: "0" } });
  w.add(D(4, 5, 0, 10), "plan_paid", "confirmed", null, { refs: { ...plan("p-3"), period: "0" } });
  w.add(D(20, 5, 0, 10), "plan_cancel", "confirmed", null, { refs: plan("p-3") });
  // November: p-1 renewed, p-2 renewed then cancelled, p-4 started, p-5 started and lapsed at its first period (not a lapse of a running plan), p-6 started, then a renewal that lapsed
  w.add(D(2, 5), "plan_paid", "confirmed", null, { refs: { ...plan("p-1"), period: "1" } });
  w.add(D(3, 5), "plan_paid", "confirmed", null, { refs: { ...plan("p-2"), period: "1" } });
  w.add(D(4, 5), "plan_paid", "confirmed", null, { refs: { ...plan("p-4"), period: "0" } });
  w.add(D(4, 6), "plan_paid", "confirmed", null, { refs: { ...plan("p-5"), period: "0" } });
  w.add(D(4, 7), "plan_lapse", "confirmed", null, { refs: { ...plan("p-5"), period: "0" } });
  w.add(D(4, 8), "plan_paid", "confirmed", null, { refs: { ...plan("p-6"), period: "0" } });
  w.add(D(4, 9), "plan_paid", "unconfirmed", null, { refs: { ...plan("p-7"), period: "0" } }); // not confirmed: not counted
  w.add(D(4, 10), "plan_paid", "confirmed", null, { refs: plan("p-8") }); // no period written: a renewal
  w.add(D(4, 11), "plan_paid", "confirmed", null, {}); // no plan written: counted, but never running
  w.add(D(10, 5), "plan_cancel", "confirmed", null, { refs: plan("p-2") });
  w.add(D(10, 6), "plan_cancel", "unconfirmed", null, { refs: plan("p-1") });
  w.add(D(11, 5), "plan_lapse", "confirmed", null, { refs: { ...plan("p-6"), period: "2" } });
  w.add(D(11, 6), "plan_lapse", "confirmed", null, { refs: plan("p-4") });
  w.add(D(11, 7), "plan_lapse", "failed", null, { refs: { ...plan("p-1"), period: "3" } });
  for (let d = 5; d <= 9; d++) { w.add(D(d, 12), "deliver_meal", "confirmed", null, { refs: plan("p-1") }); w.add(D(d, 13), "deliver_meal", "confirmed", null, { refs: plan("p-4") }); }
  w.add(D(9, 14), "deliver_meal", "failed", null, { refs: plan("p-4") });
  w.add(D(12, 5), "plan_credit", "confirmed", null, { refs: { ...plan("p-1"), kind: "carried", days: "3", amountPaise: "9000" } });
  w.add(D(12, 6), "plan_credit", "confirmed", null, { refs: { ...plan("p-4"), kind: "refunded", days: "2", amountPaise: "6000" } });
  w.add(D(12, 7), "plan_credit", "confirmed", null, { refs: { ...plan("p-4"), kind: "refunded", days: "1", amountPaise: "3000" } });
  w.add(D(12, 8), "plan_credit", "confirmed", null, { refs: { ...plan("p-4"), kind: "other", days: "4", amountPaise: "1" } }); // days count, no amount
  w.add(D(12, 9), "plan_credit", "confirmed", null, { refs: { ...plan("p-4"), kind: "carried" } }); // nothing written down
  w.add(D(12, 10), "plan_credit", "unconfirmed", null, { refs: { ...plan("p-4"), kind: "carried", days: "9", amountPaise: "9" } });
  // an order or two beside the plans
  w.pay(D(13, 5), received("o-1", "pay_1", 24000), "record_payment", "confirmed", "o-1", { refs: { paymentId: "pay_1" } });
  w.add(D(13, 6), "confirm_order", "confirmed", "o-1");
  return { entries: w.entries(), orders: [order({ id: "o-1", state: "confirmed", date: { year: 2026, month: 11, day: 14 }, mode: "pickup", lines: [{ itemId: "veg-thali", qty: 2 }] as never, totalInr: 240, advanceInr: 240 })] };
}

/** The financial year end: lines either side of 31 March 18:30 UTC (midnight in India), a restore. */
function fyendWorld(): RecordEntry[] {
  const w = world(gateway, "2027-03-01T00:00:00Z");
  w.add("2027-03-30T05:00:00Z", "hold_stock", "confirmed", "o-1");
  w.pay("2027-03-30T06:00:00Z", received("o-1", "pay_1", 25000), "record_payment", "confirmed", "o-1", { refs: { paymentId: "pay_1" } });
  w.add("2027-03-30T06:05:00Z", "confirm_order", "confirmed", "o-1");
  w.add("2027-03-31T18:29:59.999Z", "hold_stock", "confirmed", "o-2");
  w.pay("2027-03-31T18:29:59.999Z", received("o-2", "pay_2", 30000), "record_payment", "confirmed", "o-2", { refs: { paymentId: "pay_2" } });
  w.add("2027-03-31T18:30:00.000Z", "confirm_order", "confirmed", "o-2");
  w.pay("2027-03-31T18:30:00.000Z", received("o-3", "pay_3", 35000), "record_payment", "confirmed", "o-3", { refs: { paymentId: "pay_3" } });
  w.add("2027-04-01T05:00:00Z", "restored", "confirmed", null);
  w.pay("2027-04-02T05:00:00Z", { kind: "refund_owed", case: "o-2", owed: "o-2:pay_2", paymentId: "pay_2", amountPaise: 30000 }, "refund", "held_for_owner", "o-2", { refs: { paymentId: "pay_2" } });
  w.pay("2027-04-02T06:00:00Z", { kind: "refund_made", case: "o-2", owed: "o-2:pay_2", paymentId: "pay_2", amountPaise: 30000, method: "gateway", evidence: "provider", refundId: "rf_2" }, "refund", "confirmed", "o-2", { refs: { paymentId: "pay_2", refundId: "rf_2" } });
  return w.entries();
}

/** A wind-down month: the licence's lines and its rule, and nothing else the shop did. */
function windDownWorld(): RecordEntry[] {
  const w = world(gateway);
  w.add("2026-11-05T05:00:00Z", "licence", "confirmed", null, { refs: { state: "wound_down" } });
  w.add("2026-11-05T05:00:01Z", "send_message", "confirmed", null, { refs: { to: "owner", licence: "notice" }, language: "en" });
  w.add("2026-11-06T05:00:00Z", "send_message", "blocked", "o-1", { decisions: [block("subscription_suspended")], refs: { to: "customer" } });
  w.add("2026-11-07T05:00:00Z", "check_order", "blocked", "o-2", { decisions: [block("subscription_suspended")] });
  return w.entries();
}

/** Lines the job itself wrote, and nothing else: a quiet month. */
function quietWorld(): RecordEntry[] {
  const w = world(gateway);
  w.add("2026-10-30T05:00:00Z", "hold_stock", "confirmed", "o-1");
  w.add("2026-11-01T05:00:00Z", "send_message", "confirmed", null, { refs: { to: "owner", report: "2026-10", code: "7K2M-9QXD" } });
  return w.entries();
}

// The busy month of the example (the harness with stand-in services): a UPI shop with a month of real steps.
const busy = await runBusyMonth();
const busyEntries: RecordEntry[] = [...busy.world.record.entries()];
const busyOrders: Order[] = [...busy.world.store.orders.values()];

const rules = rulesWorld();
const upi = upiWorld();
const plans = plansWorld();
const fyendEntries = fyendWorld();
const windDownEntries = windDownWorld();
const quietEntries = quietWorld();
/** The shop records the vectors share, written once (a case or a job names one). */
/** E1, the discount authority (24 Nov 2026): a month with every kind of discount line (given by the agent, asked of the owner and approved, refused by the rule and by the owner). */
function discountWorld(): RecordEntry[] {
  const w = world(gateway);
  const refs = (offered: number, discount: number, code: string, by?: string) => ({ refs: { rule: "discount-authority", item: "veg-thali", qty: "1", listInr: "120", offeredInr: String(offered), discountInr: String(discount), totalInr: String(offered), code, ...(by ? { by } : {}) } });
  w.add("2026-11-03T05:00:00Z", "discount", "confirmed", "o-1", refs(110, 10, "ABCDEF", "agent"));
  w.add("2026-11-04T05:00:00Z", "discount", "held_for_owner", "o-2", refs(90, 30, "GHJKMN"));
  w.add("2026-11-04T06:00:00Z", "owner_decision", "confirmed", null, { refs: { command: "approve", kind: "discount" } }); // counted in the discounts block, not the owner's
  w.add("2026-11-04T06:00:00Z", "discount", "confirmed", "o-2", refs(90, 30, "GHJKMN", "owner"));
  w.add("2026-11-05T05:00:00Z", "discount", "blocked", "o-3", refs(1, 119, "PQRSTU", "rule"));
  w.add("2026-11-06T05:00:00Z", "discount", "held_for_owner", "o-4", refs(80, 40, "VWXYZ2"));
  w.add("2026-11-06T06:00:00Z", "discount", "blocked", "o-4", refs(80, 40, "VWXYZ2", "owner"));
  w.add("2026-10-30T05:00:00Z", "discount", "confirmed", "o-9", refs(115, 5, "ABCDE2", "agent")); // October: not this month's
  return w.entries();
}
const discountEntries = discountWorld();
/**
 * "Keep one for me", the pickup hold (24 Nov 2026): a month with every step of a hold (an enquiry each for o-1 to o-7, two of them counted twice by a retry's line, held,
 * collected (one late, after it expired), expired, cancelled, a blocked collection that counts nothing, and an October enquiry that is not this month's). Seven enquiries and
 * three collections make 30 / 7 = 4.29, so 4 per ten; the rounding of a half is exercised by holdHalf (one enquiry of two collected: 5).
 */
function holdWorld(): RecordEntry[] {
  const w = world(upiSettings);
  const step = (s: string, more: Record<string, string> = {}) => ({ refs: { kind: "pickup_hold", step: s, ...more } });
  for (let i = 1; i <= 7; i++) w.add(`2026-11-0${i}T04:00:00Z`, "pickup_hold", "confirmed", `o-${i}`, step("enquiry", { from: i % 2 ? "photo" : "order" }));
  w.add("2026-11-01T04:30:00Z", "pickup_hold", "blocked", "o-1", step("enquiry", { from: "photo" })); // a retry: no second card, counts nothing
  for (const o of ["o-1", "o-2", "o-3", "o-4"]) w.add("2026-11-08T05:00:00Z", "pickup_hold", "confirmed", o, step("held", { until: "1794900000000" }));
  w.add("2026-11-08T06:00:00Z", "pickup_hold", "confirmed", "o-1", step("collected"));
  w.add("2026-11-08T07:00:00Z", "pickup_hold", "confirmed", "o-2", step("collected"));
  w.add("2026-11-08T13:30:00Z", "pickup_hold", "confirmed", "o-3", step("expired"));
  w.add("2026-11-08T14:00:00Z", "pickup_hold", "confirmed", "o-3", step("collected", { late: "true" }));
  w.add("2026-11-08T14:30:00Z", "pickup_hold", "confirmed", "o-4", step("cancelled"));
  w.add("2026-11-09T05:00:00Z", "pickup_hold", "blocked", null, step("collected")); // "collected o-9": no such hold
  w.add("2026-10-30T05:00:00Z", "pickup_hold", "confirmed", "o-0", step("enquiry", { from: "words" }));
  return w.entries();
}
const holdEntries = holdWorld();
function holdHalf(): RecordEntry[] {
  const w = world(upiSettings);
  w.add("2026-11-02T04:00:00Z", "pickup_hold", "confirmed", "o-1", { refs: { kind: "pickup_hold", step: "enquiry", from: "photo" } });
  w.add("2026-11-02T05:00:00Z", "pickup_hold", "confirmed", "o-2", { refs: { kind: "pickup_hold", step: "enquiry", from: "order" } });
  w.add("2026-11-02T06:00:00Z", "pickup_hold", "confirmed", "o-2", { refs: { kind: "pickup_hold", step: "collected" } });
  return w.entries();
}
const holdHalfEntries = holdHalf();
const RECORDS: Record<string, readonly RecordEntry[]> = { busy: busyEntries, rules: rules.entries, upi: upi.entries, plans: plans.entries, fyend: fyendEntries, winddown: windDownEntries, quiet: quietEntries, discounts: discountEntries, holds: holdEntries, holdHalf: holdHalfEntries, empty: [] };
const recordRef = (entries: readonly RecordEntry[]): string | RecordEntry[] => Object.entries(RECORDS).find(([, v]) => v === entries)?.[0] ?? asJson(entries);

// ---- the cases ----
interface Case {
  name: string; settings: Settings; entries: readonly RecordEntry[]; orders: Order[];
  month?: string; range?: [number, number]; source: "stand-in" | "test-mode" | "live"; madeAt: number;
  preparedBy: string | null; innovator?: boolean; goLive?: GoLiveFinding; tenant?: string;
  signed: boolean; pages: ("en" | "hi" | "ml" | "kn" | "both")[];
}
const FINDING_OWN: GoLiveFinding = { status: "own", code: "AB12-CD34", signedBy: "key:" + "ab".repeat(32), issuedOn: { year: 2026, month: 10, day: 20 }, held: 14, total: 14, failed: 0, notRun: 0, notTested: 14 };
const FINDING_SKIPS: GoLiveFinding = { ...FINDING_OWN, held: 12, total: 13, failed: 1, notRun: 2 } as GoLiveFinding;
const FINDING_EXAMPLE: GoLiveFinding = { status: "example", code: "EF56-GH78", signedBy: "key:" + "cd".repeat(32), issuedOn: { year: 2026, month: 9, day: 3 } };
const FINDING_DIFFERENT: GoLiveFinding = { status: "different", code: "JK90-LM12", signedBy: "key:" + "ef".repeat(32), issuedOn: { year: 2026, month: 11, day: 30 } };
const NOW = at(12, 1, 9, 30);
const base = { source: "stand-in" as const, madeAt: NOW, signed: true, pages: ["en"] as Case["pages"], orders: [] as Order[] };
const longName = (n: number) => ({ ...gateway, name: "Annapurna Tiffins " + "अन्नपूर्णा टिफिन नगर ".repeat(Math.ceil(n / 14)).slice(0, n) }) as Settings;

const CASES: Case[] = [
  { ...base, name: "busy-both-signed", settings: upiSettings, entries: busyEntries, orders: busyOrders, month: "2026-11", preparedBy: "Divya, Sri Sai Digital", innovator: true, goLive: FINDING_OWN, tenant: "annapurna", pages: ["both", "ml"], source: "live" },
  { ...base, name: "busy-unsigned-hi", settings: upiSettings, entries: busyEntries, orders: busyOrders, month: "2026-11", preparedBy: "Divya", goLive: FINDING_EXAMPLE, signed: false, pages: ["hi", "kn"] },
  { ...base, name: "busy-october-untrusted", settings: upiSettings, entries: busyEntries, orders: [], month: "2026-10", preparedBy: "Ravi & Sons <Digital>", goLive: { status: "untrusted" }, pages: ["ml"], source: "test-mode" },
  { ...base, name: "busy-december-different", settings: upiSettings, entries: busyEntries, orders: busyOrders, month: "2026-12", preparedBy: "Divya", goLive: FINDING_DIFFERENT, tenant: "annapurna", pages: ["kn", "en"] },
  { ...base, name: "busy-custom-range", settings: upiSettings, entries: busyEntries, orders: busyOrders, range: [at(11, 3, 0), at(11, 10, 0)], preparedBy: "Divya", goLive: FINDING_SKIPS, pages: ["en", "hi"] },
  { ...base, name: "busy-no-golive", settings: upiSettings, entries: busyEntries, orders: busyOrders, month: "2026-11", preparedBy: "Divya", pages: ["en"] },
  { ...base, name: "upi-world", settings: upiSettings, entries: upi.entries, orders: upi.orders, month: "2026-11", preparedBy: "Asha", innovator: true, tenant: "annapurna-upi", pages: ["both", "kn"] },
  { ...base, name: "upi-unsigned-ml", settings: upiSettings, entries: upi.entries, orders: upi.orders, month: "2026-11", preparedBy: "Asha", signed: false, goLive: FINDING_OWN, pages: ["ml", "en"] },
  { ...base, name: "rules-gateway", settings: gateway, entries: rules.entries, orders: rules.orders, month: "2026-11", preparedBy: "Meena", innovator: true, tenant: "Annapurna Tiffins", pages: ["en", "ml", "both"] },
  { ...base, name: "rules-gateway-skips", settings: gateway, entries: rules.entries, orders: rules.orders, month: "2026-11", preparedBy: "Meena", goLive: FINDING_SKIPS, pages: ["hi", "kn"] },
  { ...base, name: "rules-october", settings: gateway, entries: rules.entries, orders: rules.orders, month: "2026-10", preparedBy: "Meena", pages: ["hi"] },
  { ...base, name: "rules-odd-menu", settings: oddMenu, entries: rules.entries, orders: rules.orders, month: "2026-11", preparedBy: "Meena", pages: ["en", "hi", "ml", "kn"] },
  { ...base, name: "rules-sweet-crumbs", settings: sweet, entries: rules.entries, orders: rules.orders, month: "2026-11", preparedBy: "Meena", pages: ["en"] },
  { ...base, name: "plans-shop", settings: plansSettings, entries: plans.entries, orders: plans.orders, month: "2026-11", preparedBy: "Kavya", innovator: true, tenant: "annapurna-plans", pages: ["en", "hi", "ml", "kn"] },
  { ...base, name: "plans-shop-unsigned", settings: plansSettings, entries: plans.entries, orders: plans.orders, month: "2026-11", preparedBy: "Kavya", signed: false, pages: ["both"] },
  { ...base, name: "plans-record-without-plans-settings", settings: gateway, entries: plans.entries, orders: plans.orders, month: "2026-11", preparedBy: "Kavya", pages: ["en"] },
  { ...base, name: "plans-december", settings: plansSettings, entries: plans.entries, orders: [], month: "2026-12", preparedBy: "Kavya", pages: ["en"] },
  { ...base, name: "fyend-march", settings: gateway, entries: fyendEntries, month: "2027-03", preparedBy: "Meena", tenant: "fy-end", pages: ["en", "hi"], madeAt: at(4, 1, 9, 30, 2027) },
  { ...base, name: "fyend-april", settings: gateway, entries: fyendEntries, month: "2027-04", preparedBy: "Meena", tenant: "fy-end", pages: ["en"], madeAt: at(5, 1, 9, 30, 2027) },
  { ...base, name: "wind-down", settings: gateway, entries: windDownEntries, month: "2026-11", preparedBy: "Divya", pages: ["en", "kn"] },
  { ...base, name: "discounts", settings: gateway, entries: discountEntries, month: "2026-11", preparedBy: "Divya", tenant: "discounts", pages: ["en", "hi", "ml", "kn"] },
  { ...base, name: "pickup-holds", settings: upiSettings, entries: holdEntries, month: "2026-11", preparedBy: "Divya", tenant: "holds", pages: ["en", "hi", "ml", "kn", "both"] },
  { ...base, name: "pickup-holds-half", settings: upiSettings, entries: holdHalfEntries, month: "2026-11", preparedBy: "Divya", pages: ["en"] },
  { ...base, name: "pickup-holds-october", settings: upiSettings, entries: holdEntries, month: "2026-10", preparedBy: "Divya", pages: ["kn"] },
  { ...base, name: "quiet", settings: gateway, entries: quietEntries, month: "2026-11", preparedBy: "Divya", tenant: "quiet", pages: ["en"] },
  { ...base, name: "empty-record", settings: gateway, entries: RECORDS.empty, month: "2026-11", preparedBy: "Divya", tenant: "empty", pages: ["en", "hi"], innovator: true },
  { ...base, name: "no-prepared-by", settings: gateway, entries: quietEntries, month: "2026-11", preparedBy: null, pages: ["en"] },
  { ...base, name: "blank-prepared-by", settings: gateway, entries: quietEntries, month: "2026-11", preparedBy: "  \n ", pages: ["en"] },
  { ...base, name: "other-zone-newyork", settings: nyc, entries: rules.entries, orders: rules.orders, month: "2026-11", preparedBy: "Sam", pages: ["en"], madeAt: zonedToMs({ year: 2026, month: 12, day: 1 }, { hour: 9, minute: 30 }, "America/New_York") },
  { ...base, name: "other-zone-auckland", settings: auckland, entries: rules.entries, orders: rules.orders, month: "2026-11", preparedBy: "तारा", pages: ["hi", "ml"], madeAt: zonedToMs({ year: 2026, month: 12, day: 1 }, { hour: 9, minute: 30 }, "Pacific/Auckland") },
  // the message must fit WhatsApp's 1024 characters: a long shop name pushes the signed summary link out, then the #digest link, then the #code link is used
  { ...base, name: "long-name-180", settings: longName(180), entries: rules.entries, month: "2026-11", preparedBy: "Meena", pages: ["en"] },
  { ...base, name: "long-name-300", settings: longName(300), entries: rules.entries, month: "2026-11", preparedBy: "Meena", pages: ["hi"] },
  { ...base, name: "long-name-420", settings: longName(420), entries: rules.entries, month: "2026-11", preparedBy: "Meena", pages: ["ml"] },
  { ...base, name: "long-name-600", settings: longName(600), entries: rules.entries, month: "2026-11", preparedBy: "Meena", pages: ["kn"] },
  { ...base, name: "long-name-unsigned", settings: longName(500), entries: rules.entries, month: "2026-11", preparedBy: "Meena", signed: false, pages: [] },
  // the owner's marks on a gateway shop: the books count them, the rows above do not, and the page says why (booksOnly)
  { ...base, name: "gateway-with-owner-marks", settings: gateway, entries: upi.entries, orders: upi.orders, month: "2026-11", preparedBy: "Asha", pages: ["en", "hi"] },
  // text that reaches the page and the message is escaped or put on one line
  { ...base, name: "escapes", settings: { ...gateway, name: "Annapurna & <b>Tiffins</b> \"A's\"\n  line two" } as Settings, entries: rules.entries, orders: rules.orders, month: "2026-11", preparedBy: "Meena\n  S\t<x>&", innovator: true, pages: ["en", "kn"] },
  // a record that is not a chain: the report cannot be anchored, and says why
  { ...base, name: "ledger-gap", settings: gateway, entries: rules.entries.filter((e) => e.seq !== 5), month: "2026-11", preparedBy: "Divya", tenant: "gap", pages: [] },
  { ...base, name: "ledger-bad-time", settings: gateway, entries: rules.entries.map((e) => (e.seq === 3 ? { ...e, time: "not a time" } : e)), month: "2026-11", preparedBy: "Divya", tenant: "bad-time", pages: [] },
  { ...base, name: "ledger-bad-tenant", settings: gateway, entries: quietEntries, month: "2026-11", preparedBy: "Divya", tenant: "!!!", pages: [] },
  { ...base, name: "ledger-unicode-tenant", settings: gateway, entries: quietEntries, month: "2026-11", preparedBy: "Divya", tenant: "Ñandú Café", pages: [] },
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

function derive(c: Case): unknown {
  const settingsJson = asJson(c.settings);
  const { from, to } = c.range ? { from: c.range[0], to: c.range[1] } : monthRange(c.month!, c.settings.timezone);
  const input = {
    settings: c.settings, entries: c.entries, orders: c.orders, from, to, source: c.source, madeAt: c.madeAt,
    ...(c.preparedBy !== null ? { preparedBy: c.preparedBy } : {}), ...(c.innovator ? { innovator: true } : {}), ...(c.goLive ? { goLive: c.goLive } : {}),
    ...(c.tenant !== undefined ? { ledger: { tenant: c.tenant } } : {}),
  };
  const head = { name: c.name, settings: settingsJson, entries: recordRef(c.entries), orders: c.orders.map(project), month: c.month ?? null, range: c.range ?? null, from, to, source: c.source, madeAt: c.madeAt,
    preparedBy: c.preparedBy, innovator: c.innovator === true, goLive: c.goLive ?? null, tenant: c.tenant ?? null, signed: c.signed };
  const built = trial(() => buildOrdersReport(input));
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

// ---- the files writeOrdersReport writes ----
function filesOf(c: Case, language: "en" | "hi" | "ml" | "kn" | "both"): unknown {
  const out = mkdtempSync(join(tmpdir(), "orders-report-"));
  try {
    const made = writeOrdersReport({
      settings: c.settings, entries: c.entries, orders: c.orders, month: c.month!, language, out, source: c.source,
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
    { name: "different", settings: gateway, text: cert(gateway, { ...handCheck, ranOn: policyDigest(sweet) }) },
    { name: "other-key", settings: gateway, text: cert(gateway, { ...handCheck, ranOn: policyDigest(gateway) }, KEY2) },
    { name: "unsigned", settings: gateway, text: cert(gateway, { ...handCheck, ranOn: policyDigest(gateway) }, undefined) },
    { name: "changed", settings: gateway, text: cert(gateway, { ...handCheck, ranOn: policyDigest(gateway) }).replace("\"held\":14", "\"held\":15") },
    { name: "not-json", settings: gateway, text: "this is not a certificate" },
    { name: "empty", settings: gateway, text: "" },
    { name: "a monthly report", settings: gateway, text: envelopeFile(seal({ format: "geometer-orders-report/1", anchor: null }, KEY)) },
    { name: "other-template", settings: gateway, text: cert(gateway, { ...handCheck, ranOn: policyDigest(gateway) }, KEY, (d) => { d.pathway = { name: "fees", version: "0.1.0" }; }) },
    { name: "bookings-template", settings: gateway, text: cert(gateway, { ...handCheck, ranOn: policyDigest(gateway) }, KEY, (d) => { d.pathway = { name: "bookings", version: "0.1.0" }; }) },
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

// ---- the policy digest and what is not tested ----
function policies(): unknown {
  const named: [string, Settings][] = [["gateway", gateway], ["upi", upiSettings], ["plans", plansSettings], ["sweet", sweet], ["newyork", nyc], ["auckland", auckland], ["odd-menu", oddMenu], ["long", longName(300)]];
  const rows = named.map(([name, s]) => {
    const validated = asJson(s);
    const roundTripDigest = policyDigest(validated as Settings);
    if (roundTripDigest !== policyDigest(s)) throw new Error(`the policy digest of ${name} changes when the settings go through JSON: the Go report would digest another tree than the TypeScript`);
    return { name, settings: validated, digest: policyDigest(s), confirmsAutomatically: capabilitiesOf(s.payment).confirmsAutomatically, notTested: notTestedOf(s).map((n) => n.id) };
  });
  // a settings file as the owner might write it, before validateSettings fills the defaults in: the digest the TypeScript takes is the validated one (Go must be handed that)
  const raw = { ...rawAnnapurna, name: "  Annapurna Tiffins  " };
  const rawText = JSON.stringify(raw);
  const validated = parseSettings(JSON.parse(rawText));
  // a settings tree with no payment block (never a validated one): its policy digest names a null module (policyOf, 23 Nov 2026), the "not tested" list is Razorpay's
  const noPayment = { ...asJson(gateway) } as Record<string, unknown>; delete noPayment.payment;
  const unknownModule = { ...asJson(gateway), payment: { module: "somewhere-else" } };
  return {
    rows, checkedPolicyDigest: checkedPolicyDigest(),
    raw: { text: rawText, validated: asJson(validated), validatedDigest: policyDigest(validated), rawDigest: policyDigest(JSON.parse(rawText) as Settings) },
    noPayment: { settings: noPayment, digest: policyDigest(noPayment as never), confirmsAutomatically: capabilitiesOf(undefined).confirmsAutomatically, notTested: notTestedOf(noPayment as never).map((n) => n.id) },
    unknownModule: { settings: unknownModule, confirmsAutomatically: capabilitiesOf(unknownModule.payment as never).confirmsAutomatically, notTested: notTestedOf(unknownModule as never).map((n) => n.id) },
  };
}

// ---- createMonthlyReport: the job's wiring over a scripted messaging ----
const job = await (async () => {
  const runs: unknown[] = [];
  for (const mode of ["template", "text", "document-refused", "no-activity"] as const) {
    const clock = fakeClock(at(12, 1, 10, 30));
    const entries = mode === "no-activity" ? quietEntries : rules.entries;
    const record = createRecord(clock, entries);
    const dir = mkdtempSync(join(tmpdir(), "orders-job-"));
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
    const setup = { source: "stand-in" as const, pages: { dir, baseUrl: "https://reports.example.com/r" }, options: () => ({ preparedBy: "Divya, Sri Sai Digital", innovator: mode === "text" }), key: KEY, goLive: () => FINDING_OWN, token: () => "0123456789abcdef0123456789abcdef", tenant: "annapurna" };
    const jobRun = createMonthlyReport(setup);
    const ctx = { settings: gateway, clock, messaging: messaging as never, record, save: () => saves.push(record.entries().length), log: (l: string) => logs.push(l), store: { orders: new Map(rules.orders.map((o) => [o.id, o])) } as never };
    const before = record.entries().length;
    const result = await jobRun.run(ctx);
    const written = record.entries().slice(before).map((e) => ({ seq: e.seq, time: e.time, action: e.action, outcome: e.outcome, booking: e.booking, language: e.language, notes: e.notes, refs: e.refs }));
    const files: Record<string, string> = {};
    for (const d of readdirSync(dir)) for (const f of readdirSync(join(dir, d))) files[`${d}/${f}`] = sha(readFileSync(join(dir, d, f), "utf8"));
    runs.push({ mode, entries: recordRef(entries), orders: rules.orders.map(project), now: at(12, 1, 10, 30), result, sent, written, saves, logs, files });
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
  const fileRuns = [filesOf(CASES[0], "both"), filesOf(CASES[1], "hi"), filesOf(CASES[6], "en"), filesOf(CASES[7], "ml"), filesOf(CASES.find((c) => c.name === "plans-shop")!, "kn"), filesOf(CASES.find((c) => c.name === "quiet")!, "en")];
  const badSource = trial(() => buildOrdersReport({ settings: gateway, entries: [], orders: [], from: 0, to: 1, source: BAD_SOURCE.source, madeAt: 0 }));
  const text = JSON.stringify(cases);
  if (/\/Users\/|\/private\/|\/var\/folders|\/tmp\//.test(text)) throw new Error("a vector holds a path of this machine");
  return {
    signer: SIGNER, publicKey: PUB, languages: LANGUAGES, records: asJson(RECORDS), cases, files: fileRuns, badSource,
    policies: policies(), goLive: goLiveReadings(), job,
    sizes: { busyEntries: busyEntries.length, rulesEntries: rules.entries.length, upiEntries: upi.entries.length, plansEntries: plans.entries.length },
    templateLanguages: languagesOf("both"),
  };
}

/** Packed (gzip, level 9): the pages repeat their style sheet and the shop records repeat, so the file is a tenth of its text. */
export function generate(): Map<string, Buffer> { return new Map([["ordersreport/testdata/vectors.json.gz", gzipSync(Buffer.from(stamp(vectors())), { level: 9 })]]); }

/** The text of a vector file without its `node` member, so a newer Node that writes the same figures is not reported stale. */
const withoutNode = (packed: Buffer): string => { const o = JSON.parse(gunzipSync(packed).toString("utf8")); delete o.node; return JSON.stringify(o); };

export function staleFiles(root = INTERNAL): string[] {
  return [...generate()].filter(([name, data]) => !existsSync(join(root, name)) || withoutNode(readFileSync(join(root, name))) !== withoutNode(data)).map(([name]) => name);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--check")) {
    const stale = staleFiles();
    if (stale.length) { console.error(`out of date: ${stale.join(", ")}  (run node go/scripts/gen_orders_report_vectors.ts)`); process.exit(1); }
  } else {
    for (const [name, data] of generate()) { mkdirSync(dirname(join(INTERNAL, name)), { recursive: true }); writeFileSync(join(INTERNAL, name), data); }
    console.log(`written with Node ${process.version}`);
  }
}
