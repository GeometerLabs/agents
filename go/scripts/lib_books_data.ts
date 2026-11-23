// The shop records the books' vectors are made from (gen_books_vectors.ts): each WORLD is a short story of one shop, told as steps the Go test can replay. A "post" step goes through
// createAccounting.post with a template's line written by a callback (how it is written, `mode`, can be made wrong on purpose to reach the read-back errors); a "raw" step appends a line as it
// is (an older line with no money refs, a malformed one, a restore). Times are ISO text so a reader can follow the story; the shop is in India (Asia/Kolkata, +5:30), where the financial year
// ends 31 March 18:30 UTC.
import type { LegacyMap } from "../../modules/accounting/journal.ts";
import { BOOKINGS_LEGACY } from "../../templates/commerce/bookings/src/accounting.ts";
import type { Step } from "./lib_books_worlds.ts";

/** A step as written here: `at` is ISO text, `label` names the entry it writes so a later step can point at its number (`seq`). */
export interface StepDef {
  at: string;
  op: "post" | "raw";
  label?: string;
  event?: (seq: (label: string) => number) => Record<string, unknown>;
  line: Step["line"];
}

export interface WorldDef {
  name: string;
  timezone: string;
  status?: "unregistered" | "composition";
  legacy: LegacyMap;
  steps: StepDef[];
  /** The moments the owner's page is read at, and (for the figures) the ranges asked about. */
  nows: string[];
  /** The record's own old-due marks (Fees): seq of a label -> month. */
  oldDue?: Record<string, string>;
  /** Some worlds also run the settlement job. */
  jobs?: JobDef[];
}

export interface RowDef {
  entityId: string; type: string; paymentId: string | null; amount: number; fee: number; tax: number; debit: number; credit: number;
  onHold: boolean; settled: boolean; settlementId: string | null; utr: string | null; settledAt: number | null;
}
/** One tick of the job: the time, and for each day the rows the provider gives (or the error it throws). */
export interface JobDef { nowIso: string; days: Record<string, RowDef[] | { error: string }>; /** The payments adapter has no settlement read at all (a UPI shop's). */ noRead?: boolean }

export const FEES_LEGACY: LegacyMap = { received: [{ action: "record_payment", outcome: "confirmed", for: "fee" }], feeCharged: "open_fee", lateFee: "add_late_fee", discount: "waive_fee" };

const money = (kind: string, extra: Record<string, unknown>) => ({ kind, ...extra });
const post = (at: string, event: StepDef["event"], line: Step["line"], label?: string): StepDef => ({ at, op: "post", event, line, label });
const raw = (at: string, line: Step["line"], label?: string): StepDef => ({ at, op: "raw", line, label });
const L = (action: string, outcome: Step["line"]["outcome"], booking: string | null, refs: Record<string, string> = {}, extra: Partial<Step["line"]> = {}): Step["line"] => ({ action, outcome, booking, refs, ...extra });

/** Epoch seconds of an ISO time, as the provider's rows carry them. */
const secs = (iso: string): number => Math.floor(Date.parse(iso) / 1000);
const row = (o: Partial<RowDef> & { entityId: string; amount: number }): RowDef =>
  ({ type: "payment", paymentId: null, fee: 0, tax: 0, debit: 0, credit: 0, onHold: false, settled: true, settlementId: "setl_1", utr: "UTR0001", settledAt: secs("2026-11-10T04:00:00Z"), ...o });

// ---- Bookings: deposits, a second payment, refunds in every way, marks by hand, a person's word, a kept deposit, corrections, and the read-back errors ----
const bookings: WorldDef = {
  name: "bookings", timezone: "Asia/Kolkata", legacy: BOOKINGS_LEGACY,
  nows: ["2026-04-20T05:00:00Z", "2026-05-12T05:00:00Z", "2026-06-30T10:00:00Z"],
  steps: [
    post("2026-04-06T05:00:00Z", () => money("received", { case: "b-1", paymentId: "pay_1", amountPaise: 50000, method: "gateway", evidence: "provider", for: "advance" }), L("record_deposit", "confirmed", "b-1", { paymentId: "pay_1" }), "b1-dep"),
    post("2026-04-06T05:05:00Z", () => money("received", { case: "b-1", paymentId: "pay_1", amountPaise: 50000, method: "gateway", evidence: "provider", for: "advance" }), L("deposit_repeat", "confirmed", "b-1")),
    post("2026-04-06T06:00:00Z", () => money("received", { case: "b-1", paymentId: "pay_2", amountPaise: 30000, method: "gateway", evidence: "provider", for: "extra" }), L("record_deposit", "blocked", "b-1", { paymentId: "pay_2" })),
    post("2026-04-06T06:10:00Z", () => money("refund_owed", { case: "b-1", owed: "b-1:pay_2", paymentId: "pay_2", amountPaise: 30000 }), L("refund", "held_for_owner", "b-1"), "b1-owed"),
    post("2026-04-06T06:11:00Z", () => money("refund_owed", { case: "b-1", owed: "b-1:pay_2", paymentId: "pay_2", amountPaise: 30000 }), L("refund_again", "held_for_owner", "b-1")),
    post("2026-04-07T04:00:00Z", () => money("refund_made", { case: "b-1", owed: "b-1:pay_2", paymentId: "pay_2", amountPaise: 30000, method: "gateway", evidence: "provider", refundId: "rf_1" }), L("refund", "confirmed", "b-1", { paymentId: "pay_2", refundId: "rf_1" })),
    post("2026-04-07T04:01:00Z", () => money("refund_made", { case: "b-1", owed: "b-1:pay_2", paymentId: "pay_2", amountPaise: 30000, method: "gateway", evidence: "provider", refundId: "rf_1" }), L("refund_again", "confirmed", "b-1")),
    post("2026-04-08T05:00:00Z", () => money("applied", { case: "b-1", amountPaise: 50000, service: "haircut" }), L("complete_booking", "confirmed", "b-1")),
    post("2026-04-08T05:01:00Z", () => money("applied", { case: "b-1", amountPaise: 50000, service: "haircut" }), L("complete_again", "confirmed", "b-1")),
    // b-2: a refund owed, then cancelled (the owner said no), then cancelled again
    post("2026-04-09T05:00:00Z", () => money("received", { case: "b-2", paymentId: "pay_3", amountPaise: 20000, method: "gateway", evidence: "provider", for: "advance" }), L("record_deposit", "confirmed", "b-2", { paymentId: "pay_3" })),
    post("2026-04-09T06:00:00Z", () => money("refund_owed", { case: "b-2", owed: "b-2:pay_3", paymentId: "pay_3", amountPaise: 20000 }), L("refund", "held_for_owner", "b-2")),
    post("2026-04-09T07:00:00Z", () => money("refund_cancelled", { case: "b-2", owed: "b-2:pay_3", why: "owner_said_no" }), L("refund", "blocked", "b-2")),
    post("2026-04-09T07:01:00Z", () => money("refund_cancelled", { case: "b-2", owed: "b-2:pay_3", why: "expired" }), L("refund_again", "blocked", "b-2")),
    post("2026-04-10T05:00:00Z", () => money("applied", { case: "b-2", amountPaise: 20000, service: "colour" }), L("complete_booking", "confirmed", "b-2")),
    // b-3: a refund held for days, then done; the owed key is used again afterwards (owed, made, owed again keeps its place)
    post("2026-04-10T05:00:00Z", () => money("received", { case: "b-3", paymentId: "pay_4", amountPaise: 10000, method: "gateway", evidence: "provider", for: "advance" }), L("record_deposit", "confirmed", "b-3", { paymentId: "pay_4" })),
    post("2026-04-10T05:30:00Z", () => money("refund_owed", { case: "b-3", owed: "b-3:pay_4", paymentId: "pay_4", amountPaise: 10000 }), L("refund", "held_for_owner", "b-3")),
    post("2026-04-14T09:30:00Z", () => money("refund_made", { case: "b-3", owed: "b-3:pay_4", paymentId: "pay_4", amountPaise: 10000, method: "gateway", evidence: "provider", refundId: "rf_2" }), L("refund", "confirmed", "b-3", { paymentId: "pay_4", refundId: "rf_2" })),
    // a UPI deposit marked by hand, a refund the owner pays by UPI and marks done
    post("2026-04-11T05:00:00Z", () => money("received", { case: "b-4", paymentId: "upi-1", amountPaise: 15000, method: "upi", evidence: "owner_mark", for: "advance" }), L("owner_marked_paid", "confirmed", "b-4", { paymentId: "upi-1", requestId: "upi-1", amountPaise: "15000", markedBy: "owner" })),
    post("2026-04-11T08:00:00Z", () => money("refund_owed", { case: "b-4", owed: "upr-1", paymentId: "upi-1", amountPaise: 15000 }), L("upi_refund_owed", "held_for_owner", "b-4", { refundId: "upr-1" })),
    post("2026-04-12T08:00:00Z", () => money("refund_made", { case: "b-4", owed: "upr-1", paymentId: "upi-1", amountPaise: 15000, method: "upi", evidence: "owner_mark", refundId: "upr-1" }), L("upi_refund_marked_done", "confirmed", "b-4", { refundId: "upr-1" })),
    // cash and bank marks
    post("2026-04-12T09:00:00Z", () => money("received", { case: "b-5", paymentId: "cash-1", amountPaise: 8000, method: "cash", evidence: "owner_mark", for: "advance" }), L("owner_marked_paid", "confirmed", "b-5", { requestId: "upi-2", via: "cash", amountPaise: "8000" })),
    post("2026-04-12T09:30:00Z", () => money("received", { case: "b-6", paymentId: "bank-1", amountPaise: 9000, method: "bank", evidence: "owner_mark", for: "advance" }), L("owner_marked_paid", "confirmed", "b-6", { requestId: "upi-3", amountPaise: "9000" })),
    // a person's word: a refund settled by Guard's already_done, no refund id
    post("2026-04-13T05:00:00Z", () => money("received", { case: "b-7", paymentId: "pay_7", amountPaise: 12000, method: "gateway", evidence: "provider", for: "advance" }), L("record_deposit", "confirmed", "b-7", { paymentId: "pay_7" })),
    post("2026-04-13T07:00:00Z", () => money("refund_made", { case: "b-7", owed: "b-7:pay_7", paymentId: "pay_7", amountPaise: 12000, method: "gateway", evidence: "person_word" }), L("refund", "confirmed", "b-7", { paymentId: "pay_7", confirmedBy: "caller" })),
    post("2026-04-13T07:01:00Z", () => money("refund_made", { case: "b-7", owed: "b-7:pay_7", paymentId: "pay_7", amountPaise: 12000, method: "gateway", evidence: "person_word" }), L("refund_again", "confirmed", "b-7")),
    // a late cancellation the owner keeps; a refund owed the owner keeps (the amount is not in the event and not needed: it posts; the second keep is a repeat)
    post("2026-04-14T05:00:00Z", () => money("received", { case: "b-8", paymentId: "pay_8", amountPaise: 40000, method: "gateway", evidence: "provider", for: "advance" }), L("record_deposit", "confirmed", "b-8", { paymentId: "pay_8" })),
    post("2026-04-14T06:00:00Z", () => money("kept", { case: "b-8", amountPaise: 40000, why: "late_cancellation" }), L("cancel_booking", "confirmed", "b-8"), "b8-kept"),
    post("2026-04-14T06:01:00Z", () => money("kept", { case: "b-8", amountPaise: 40000, why: "late_cancellation" }), L("cancel_again", "confirmed", "b-8")),
    post("2026-04-15T05:00:00Z", () => money("received", { case: "b-9", paymentId: "pay_9", amountPaise: 25000, method: "gateway", evidence: "provider", for: "advance" }), L("record_deposit", "confirmed", "b-9", { paymentId: "pay_9" })),
    post("2026-04-15T06:00:00Z", () => money("refund_owed", { case: "b-9", owed: "b-9:pay_9", paymentId: "pay_9", amountPaise: 25000 }), L("refund", "held_for_owner", "b-9")),
    post("2026-04-15T07:00:00Z", () => money("kept", { case: "b-9", owed: "b-9:pay_9", why: "late_mark_kept" }), L("upi_refund_kept", "confirmed", "b-9")),
    post("2026-04-15T08:00:00Z", () => money("kept", { case: "b-9", owed: "b-9:pay_9", why: "late_mark_kept" }), L("upi_refund_kept", "confirmed", "b-9", { amountPaise: "25000" })),
    post("2026-04-16T05:00:00Z", () => money("received", { case: "b-10", paymentId: "pay_10", amountPaise: 25000, method: "gateway", evidence: "provider", for: "advance" }), L("record_deposit", "confirmed", "b-10", { paymentId: "pay_10" })),
    post("2026-04-16T06:00:00Z", () => money("refund_owed", { case: "b-10", owed: "b-10:pay_10", paymentId: "pay_10", amountPaise: 25000 }), L("refund", "held_for_owner", "b-10")),
    post("2026-04-16T07:00:00Z", () => money("kept", { case: "b-10", owed: "b-10:pay_10", why: "late_mark_kept" }), L("upi_refund_kept", "confirmed", "b-10", { amountPaise: "25000" })),
    // corrections: of a kept line (works), again (a repeat), of a received line (refused), of an entry that is not there (refused)
    post("2026-04-17T05:00:00Z", (seq) => money("correction", { case: "b-8", reverses: seq("b8-kept"), why: "owner" }), L("correct", "confirmed", "b-8")),
    post("2026-04-17T05:01:00Z", (seq) => money("correction", { case: "b-8", reverses: seq("b8-kept"), why: "owner" }), L("correct", "confirmed", "b-8")),
    post("2026-04-17T05:02:00Z", (seq) => money("correction", { case: "b-1", reverses: seq("b1-dep"), why: "accountant" }), L("correct", "confirmed", "b-1")),
    post("2026-04-17T05:03:00Z", () => money("correction", { case: null, reverses: 999, why: "owner" }), L("correct", "confirmed", null)),
    // refused before anything is written
    post("2026-04-18T05:00:00Z", () => money("received", { case: "b-11", paymentId: "pay_11", amountPaise: 0, method: "gateway", evidence: "provider", for: "advance" }), L("record_deposit", "confirmed", "b-11")),
    post("2026-04-18T05:01:00Z", () => money("received", { case: "b-11", paymentId: "pay_11", amountPaise: -50, method: "gateway", evidence: "provider", for: "advance" }), L("record_deposit", "confirmed", "b-11")),
    post("2026-04-18T05:02:00Z", () => money("applied", { case: "b-11", amountPaise: 100, service: "Bad Service" }), L("complete_booking", "confirmed", "b-11")),
    post("2026-04-18T05:03:00Z", () => money("applied", { case: "b-11", amountPaise: 100, service: "orders" }), L("complete_booking", "confirmed", "b-11")), // more than the case holds
    // the read-back errors: nothing written, written twice, the wrong case, a dropped ref, one altered ref, two altered refs
    post("2026-04-19T05:00:00Z", () => money("received", { case: "b-12", paymentId: "pay_12", amountPaise: 1000, method: "gateway", evidence: "provider", for: "advance" }), L("record_deposit", "confirmed", "b-12", {}, { mode: "none" })),
    post("2026-04-19T05:01:00Z", () => money("received", { case: "b-12", paymentId: "pay_12", amountPaise: 1000, method: "gateway", evidence: "provider", for: "advance" }), L("record_deposit", "confirmed", "b-12", {}, { mode: "twice" })),
    post("2026-04-19T05:02:00Z", () => money("received", { case: "b-12", paymentId: "pay_13", amountPaise: 1000, method: "gateway", evidence: "provider", for: "advance" }), L("record_deposit", "confirmed", "b-12", {}, { mode: "wrongCase" })),
    post("2026-04-19T05:03:00Z", () => money("received", { case: "b-12", paymentId: "pay_14", amountPaise: 1000, method: "gateway", evidence: "provider", for: "advance" }), L("record_deposit", "confirmed", "b-12", {}, { mode: "drop:evidence" })),
    post("2026-04-19T05:04:00Z", () => money("received", { case: "b-12", paymentId: "pay_15", amountPaise: 1000, method: "gateway", evidence: "provider", for: "advance" }), L("record_deposit", "confirmed", "b-12", {}, { mode: "alter:method" })),
    post("2026-04-19T05:05:00Z", () => money("received", { case: "b-12", paymentId: "pay_16", amountPaise: 1000, method: "gateway", evidence: "provider", for: "advance" }), L("record_deposit", "confirmed", "b-12", {}, { mode: "alter:paymentId,amountPaise" })),
    post("2026-04-19T05:06:00Z", () => money("received", { case: "b-12", paymentId: "pay_17", amountPaise: 1000, method: "gateway", evidence: "provider", for: "advance" }), L("record_deposit", "confirmed", "b-12", {}, { mode: "alter:for,money" })),
    post("2026-04-19T05:07:00Z", () => money("received", { case: "b-12", paymentId: "pay_18", amountPaise: 1000, method: "gateway", evidence: "provider", for: "advance" }), L("record_deposit", "confirmed", "b-12", {}, { mode: "drop:doc" })),
    // a refund with nothing owed first (made without being owed), and a cancel of one that was never owed
    post("2026-04-20T05:00:00Z", () => money("refund_made", { case: "b-12", owed: "b-12:pay_12", paymentId: "pay_12", amountPaise: 400, method: "gateway", evidence: "provider", refundId: "rf_9" }), L("refund", "confirmed", "b-12", { refundId: "rf_9" })),
    post("2026-04-20T05:01:00Z", () => money("refund_cancelled", { case: "b-12", owed: "b-12:none", why: "refused" }), L("refund", "blocked", "b-12")),
    post("2026-04-20T05:02:00Z", () => money("kept", { case: "b-12", owed: "b-12:none", why: "late_mark_kept" }), L("upi_refund_kept", "confirmed", "b-12")),
    // another refund_made on b-12 without a refund id (identity from the owed key and the evidence), then again
    post("2026-04-20T05:03:00Z", () => money("refund_made", { case: "b-12", owed: "b-12:x", paymentId: "pay_x", amountPaise: 100, method: "cash", evidence: "owner_mark" }), L("refund", "confirmed", "b-12")),
    post("2026-04-20T05:04:00Z", () => money("refund_made", { case: "b-12", owed: "b-12:x", paymentId: "pay_x", amountPaise: 100, method: "cash", evidence: "owner_mark" }), L("refund", "confirmed", "b-12")),
  ],
};

// ---- a composition shop: the bill of supply, refund notes citing receipts, and a restore that moves the numbers on ----
const composition: WorldDef = {
  name: "composition", timezone: "Asia/Kolkata", status: "composition", legacy: BOOKINGS_LEGACY,
  nows: ["2026-11-09T05:00:00Z", "2026-11-14T05:00:00Z", "2026-11-15T07:00:00Z", "2026-11-16T05:00:00Z"],
  steps: [
    post("2026-11-02T05:00:00Z", () => money("received", { case: "b-1", paymentId: "pay_1", amountPaise: 45050, method: "gateway", evidence: "provider", for: "advance" }), L("record_deposit", "confirmed", "b-1", { paymentId: "pay_1" })),
    post("2026-11-02T09:00:00Z", () => money("received", { case: "b-2", paymentId: "pay_2", amountPaise: 100, method: "upi", evidence: "owner_mark", for: "advance" }), L("owner_marked_paid", "confirmed", "b-2", { paymentId: "pay_2", requestId: "upi-1", amountPaise: "100" })),
    post("2026-11-03T05:00:00Z", () => money("applied", { case: "b-1", amountPaise: 45050, service: "haircut" }), L("complete_booking", "confirmed", "b-1")),
    post("2026-11-03T05:30:00Z", () => money("applied", { case: "b-2", amountPaise: 100, service: "orders" }), L("complete_booking", "confirmed", "b-2")),
    post("2026-11-04T05:00:00Z", () => money("received", { case: "b-3", paymentId: "pay_3", amountPaise: 123456789, method: "gateway", evidence: "provider", for: "advance" }), L("record_deposit", "confirmed", "b-3", { paymentId: "pay_3" })),
    post("2026-11-04T06:00:00Z", () => money("refund_owed", { case: "b-3", owed: "b-3:pay_3", paymentId: "pay_3", amountPaise: 99999 }), L("refund", "held_for_owner", "b-3")),
    post("2026-11-04T08:00:00Z", () => money("refund_made", { case: "b-3", owed: "b-3:pay_3", paymentId: "pay_3", amountPaise: 99999, method: "gateway", evidence: "provider", refundId: "rf_1" }), L("refund", "confirmed", "b-3", { paymentId: "pay_3", refundId: "rf_1" })),
    raw("2026-11-05T05:00:00Z", L("restored", "confirmed", null, {})),
    post("2026-11-06T05:00:00Z", () => money("received", { case: "b-4", paymentId: "pay_4", amountPaise: 20000, method: "gateway", evidence: "provider", for: "advance" }), L("record_deposit", "confirmed", "b-4", { paymentId: "pay_4" })),
    post("2026-11-06T06:00:00Z", () => money("refund_owed", { case: "b-4", owed: "b-4:pay_4", paymentId: "pay_4", amountPaise: 5000 }), L("refund", "held_for_owner", "b-4")),
    post("2026-11-06T07:00:00Z", () => money("refund_made", { case: "b-4", owed: "b-4:pay_4", paymentId: "pay_4", amountPaise: 5000, method: "gateway", evidence: "provider", refundId: "rf_2" }), L("refund", "confirmed", "b-4", { paymentId: "pay_4", refundId: "rf_2" })),
    post("2026-11-07T05:00:00Z", () => money("applied", { case: "b-4", amountPaise: 15000, service: "colour" }), L("complete_booking", "confirmed", "b-4")),
    post("2026-11-07T05:30:00Z", () => money("refund_made", { case: "b-4", owed: "b-4:pay_zzz", paymentId: "pay_zzz", amountPaise: 700, method: "gateway", evidence: "provider", refundId: "rf_3" }), L("refund", "confirmed", "b-4", { paymentId: "pay_zzz", refundId: "rf_3" })), // a refund note with no receipt
  ],
};

// ---- the gateway settlements, read by the job, with every kind of row ----
const settlements: WorldDef = {
  name: "settlements", timezone: "Asia/Kolkata", legacy: BOOKINGS_LEGACY,
  nows: ["2026-11-10T05:00:00Z", "2026-11-12T05:00:00Z", "2026-11-14T05:00:00Z", "2026-11-17T05:00:00Z", "2026-11-18T05:00:00Z", "2026-11-23T05:00:00Z"],
  steps: [
    ...[["b-1", "pay_a", 50000], ["b-2", "pay_b", 20000], ["b-3", "pay_c", 100000], ["b-4", "pay_d", 15000], ["b-5", "pay_e", 7000], ["b-6", "pay_f", 3000], ["b-7", "pay_g", 8000], ["b-10", "pay_h", 4000], ["b-11", "pay_i", 6000], ["b-12", "pay_j", 2500], ["b-13", "pay_k", 3500]].map(([c, p, a], i) =>
      post(`2026-11-0${(i % 7) + 1}T05:${10 + i}:00Z`, () => money("received", { case: c, paymentId: p, amountPaise: a, method: "gateway", evidence: "provider", for: "advance" }), L("record_deposit", "confirmed", c as string, { paymentId: p as string }))),
    post("2026-11-09T05:00:00Z", () => money("refund_owed", { case: "b-3", owed: "b-3:pay_c", paymentId: "pay_c", amountPaise: 30000 }), L("refund", "held_for_owner", "b-3")),
    post("2026-11-09T06:00:00Z", () => money("refund_made", { case: "b-3", owed: "b-3:pay_c", paymentId: "pay_c", amountPaise: 30000, method: "gateway", evidence: "provider", refundId: "rf_c" }), L("refund", "confirmed", "b-3", { paymentId: "pay_c", refundId: "rf_c" })),
    // a UPI claim the owner has not marked: a request, then the customer's claim
    raw("2026-11-09T07:00:00Z", L("upi_request", "confirmed", "b-8", { requestId: "upi-9", amountPaise: "6000" })),
    raw("2026-11-09T07:30:00Z", L("upi_paid_claim", "unconfirmed", "b-8", { requestId: "upi-9", via: "button" })),
    raw("2026-11-09T08:00:00Z", L("upi_refund_owed", "held_for_owner", "b-9", { refundId: "upr-4", paymentId: "upi-x", amountPaise: "2500" })),
  ],
  jobs: [
    // a payments adapter that cannot read settlements (a UPI shop's): the one sentence, nothing written, nothing asked
    { nowIso: "2026-11-09T05:00:00Z", days: {}, noRead: true },
    // Tuesday 10 November, 10:30 in India: yesterday is Monday the 9th (the first read: only yesterday). The settlement ids tie on the day and differ in case, "_" and "-".
    { nowIso: "2026-11-10T05:00:00Z", days: { "2026-11-09": [
      row({ entityId: "pay_a", amount: 50000, fee: 1180, tax: 212, credit: 48608, paymentId: null }),
      row({ entityId: "pay_b", amount: 20000, fee: 1392, tax: 252, credit: 18608, settlementId: "setl_B", utr: "UTR0B" }), // fee with GST
      row({ entityId: "rf_c", type: "refund", paymentId: "pay_c", amount: 30000, debit: 30000, settlementId: "setl_b", utr: "UTR0b" }),
      row({ entityId: "pay_d", amount: 15000, onHold: true, settled: false, settlementId: null, utr: null, fee: 0, credit: 0 }),
      row({ entityId: "pay_unknown", amount: 9000, fee: 200, tax: 36, credit: 8764 }),
      row({ entityId: "adj_1", type: "adjustment", amount: 500, debit: 500 }),
      row({ entityId: "tr_1", type: "transfer", amount: 700 }),
      row({ entityId: "pay_e", amount: 7000, fee: 100, tax: 18, credit: 5000 }), // fits neither way
      row({ entityId: "pay_f", amount: 3000, settlementId: null, utr: null, credit: 3000 }),
      row({ entityId: "pay_g", amount: 8000, fee: 0, tax: 0, credit: 8000, settledAt: null, settlementId: "setl-1", utr: "UTR0g" }), // no settled time: the record's own time stands in
    ] } },
    // the same day read again by a later tick (already read: nothing), then Wednesday's tick finds Tuesday's rows with a repeat of one row
    { nowIso: "2026-11-10T09:00:00Z", days: { "2026-11-09": [] } },
    { nowIso: "2026-11-11T05:00:00Z", days: { "2026-11-10": [
      row({ entityId: "pay_a", amount: 50000, fee: 1180, tax: 212, credit: 48608, settlementId: "setl_2", utr: "UTR0002", settledAt: secs("2026-11-11T04:00:00Z") }), // repeats pay_a under another settlement
      row({ entityId: "pay_d", amount: 15000, fee: 300, tax: 54, credit: 14646, settlementId: "setl_10", utr: "UTR0010", settledAt: secs("2026-11-11T04:00:00Z") }), // the held row, now settled
      row({ entityId: "pay_i", amount: 6000, fee: 118, tax: 18, credit: 5864, settlementId: "setl_9", utr: "UTR0009", settledAt: secs("2026-11-11T04:00:00Z") }), // ties with setl_10 on the day
      row({ entityId: "pay_h", amount: 4000, onHold: true, settled: false, settlementId: null, utr: null, fee: 0, credit: 0 }), // held, and never settled
      row({ entityId: "pay_j", amount: 2500, fee: 59, tax: 9, credit: 2432, settlementId: "setl_oct", utr: "UTR0oct", settledAt: secs("2026-10-31T18:29:59Z") }), // the last second of October in India
      row({ entityId: "pay_k", amount: 3500, fee: 82, tax: 15, credit: 3403, settlementId: "setl_nov", utr: "UTR0nov", settledAt: secs("2026-10-31T18:30:00Z") }), // the first of November
      row({ entityId: "adj_1", type: "adjustment", amount: 500, debit: 500 }), // listed once only
    ] } },
    // the agent was off for days: the next tick reads the missed ones (Thursday to Sunday), and Saturday fails first
    { nowIso: "2026-11-15T05:00:00Z", days: { "2026-11-11": [], "2026-11-12": [], "2026-11-13": { error: "the provider said 503" }, "2026-11-14": [] } },
    { nowIso: "2026-11-15T06:00:00Z", days: { "2026-11-11": [], "2026-11-12": [], "2026-11-13": [row({ entityId: "pay_f", amount: 3000, fee: 59, tax: 11, credit: 2930, settlementId: "setl_3", utr: "UTR0003", settledAt: secs("2026-11-14T05:00:00Z") })], "2026-11-14": [], "2026-11-15": [] } },
  ],
};

// ---- Fees: a bill, a late fee, a waiver, a write-off, an old due, payments for fees, in the older words too ----
const fees: WorldDef = {
  name: "fees", timezone: "Asia/Kolkata", legacy: FEES_LEGACY,
  nows: ["2026-07-10T05:00:00Z", "2026-08-31T20:00:00Z"],
  oldDue: { "fee-f1": "2026-05", "fee-f3": "2026-06" },
  steps: [
    post("2026-07-01T05:00:00Z", () => money("fee_charged", { case: "f-1", amountPaise: 150000 }), L("open_fee", "confirmed", "f-1"), "fee-f1"),
    post("2026-07-01T05:01:00Z", () => money("fee_charged", { case: "f-1", amountPaise: 150000 }), L("open_fee_again", "confirmed", "f-1")),
    post("2026-07-01T05:05:00Z", () => money("fee_charged", { case: "f-2", amountPaise: 200000 }), L("open_fee", "confirmed", "f-2")),
    post("2026-07-01T05:10:00Z", () => money("fee_charged", { case: "f-3", amountPaise: 100000 }), L("open_fee", "confirmed", "f-3"), "fee-f3"),
    post("2026-07-05T05:00:00Z", () => money("received", { case: "f-1", paymentId: "pay_f1", amountPaise: 150000, method: "gateway", evidence: "provider", for: "fee" }), L("record_payment", "confirmed", "f-1", { paymentId: "pay_f1" })),
    post("2026-07-05T06:00:00Z", () => money("received", { case: "f-2", paymentId: "pay_f2", amountPaise: 120000, method: "upi", evidence: "owner_mark", for: "fee" }), L("owner_marked_paid", "confirmed", "f-2", { paymentId: "pay_f2", requestId: "upi-5", amountPaise: "120000" })),
    post("2026-07-08T05:00:00Z", () => money("late_fee", { case: "f-2", amountPaise: 10000 }), L("add_late_fee", "confirmed", "f-2")),
    post("2026-07-08T05:01:00Z", () => money("late_fee", { case: "f-2", amountPaise: 10000 }), L("add_late_fee_again", "confirmed", "f-2")),
    post("2026-07-09T05:00:00Z", () => money("discount", { case: "f-3", amountPaise: 25000 }), L("waive_fee", "confirmed", "f-3"), "fee-disc"),
    post("2026-07-09T06:00:00Z", () => money("write_off", { case: "f-3", amountPaise: 5000 }), L("write_off", "confirmed", "f-3")),
    // a parent paid beyond the fee, and it is given back (the money comes from what it paid beyond)
    post("2026-07-09T07:00:00Z", () => money("received", { case: "f-4", paymentId: "pay_f4", amountPaise: 50000, method: "cash", evidence: "owner_mark", for: "fee" }), L("owner_marked_paid", "confirmed", "f-4", { requestId: "upi-6", via: "cash", amountPaise: "50000" })),
    post("2026-07-09T08:00:00Z", () => money("refund_owed", { case: "f-4", owed: "upr-2", paymentId: "pay_f4", amountPaise: 50000 }), L("upi_refund_owed", "held_for_owner", "f-4", { refundId: "upr-2" })),
    post("2026-07-09T09:00:00Z", () => money("refund_cancelled", { case: "f-4", owed: "upr-2", why: "failed" }), L("refund", "blocked", "f-4")),
    // the older words: an older fee, late fee and waiver
    raw("2026-08-01T05:00:00Z", L("open_fee", "confirmed", "f-5", { amountPaise: "90000" })),
    raw("2026-08-01T05:01:00Z", L("open_fee", "confirmed", "f-5", { amountPaise: "90000" })),
    raw("2026-08-02T05:00:00Z", L("add_late_fee", "confirmed", "f-5", { amountPaise: "1000" })),
    raw("2026-08-03T05:00:00Z", L("waive_fee", "confirmed", "f-5", { amountPaise: "500" })),
    raw("2026-08-04T05:00:00Z", L("record_payment", "confirmed", "f-5", { paymentId: "pay_old", amountPaise: "50000" })),
    raw("2026-08-05T05:00:00Z", L("open_fee", "confirmed", "f-6", {})),
    raw("2026-08-05T06:00:00Z", L("open_fee", "failed", "f-6", { amountPaise: "5" })),
    raw("2026-08-31T18:29:59Z", L("open_fee", "confirmed", "f-7", { amountPaise: "70000" })),
  ],
};

// ---- older lines (no refs.money), through the Bookings map ----
const legacy: WorldDef = {
  name: "legacy", timezone: "Asia/Kolkata", legacy: BOOKINGS_LEGACY,
  nows: ["2026-02-10T05:00:00Z"],
  steps: [
    raw("2026-01-05T05:00:00Z", L("record_deposit", "confirmed", "b-1", { paymentId: "pay_1", amountPaise: "50000" })),
    raw("2026-01-05T05:01:00Z", L("record_deposit", "confirmed", "b-1", { paymentId: "pay_1", amountPaise: "50000" })),
    raw("2026-01-05T06:00:00Z", L("record_deposit", "blocked", "b-1", { paymentId: "pay_2", amountPaise: "30000" })),
    raw("2026-01-05T06:30:00Z", L("complete_booking", "confirmed", "b-1", {})),
    raw("2026-01-05T06:31:00Z", L("complete_booking", "confirmed", "b-1", {})),
    raw("2026-01-06T05:00:00Z", L("refund", "confirmed", "b-1", { paymentId: "pay_2", refundId: "rf_1", amountPaise: "30000" })),
    raw("2026-01-06T05:01:00Z", L("refund", "confirmed", "b-2", { paymentId: "pay_3", amountPaise: "1000", confirmedBy: "caller" })),
    raw("2026-01-06T05:02:00Z", L("refund", "confirmed", "b-2", { amountPaise: "1000" })),
    raw("2026-01-06T05:03:00Z", L("refund", "confirmed", "b-2", { paymentId: "pay_3" })),
    raw("2026-01-06T05:04:00Z", L("refund", "confirmed", "b-2", { paymentId: "pay_3", amountPaise: "1e3" })),
    raw("2026-01-07T05:00:00Z", L("upi_refund_owed", "held_for_owner", "b-3", { refundId: "upr-1", amountPaise: "5000" })),
    raw("2026-01-07T05:01:00Z", L("upi_refund_owed", "held_for_owner", "b-3", { refundId: "upr-1", amountPaise: "5000" })),
    raw("2026-01-07T05:02:00Z", L("upi_refund_owed", "held_for_owner", "b-3", { amountPaise: "5000" })),
    raw("2026-01-07T06:00:00Z", L("upi_refund_marked_done", "confirmed", "b-3", { refundId: "upr-1" })),
    raw("2026-01-07T06:01:00Z", L("upi_refund_marked_done", "confirmed", "b-3", { amountPaise: "2" })),
    raw("2026-01-07T06:02:00Z", L("upi_refund_marked_done", "confirmed", "b-3", { refundId: "upr-9", amountPaise: "" })),
    raw("2026-01-07T06:03:00Z", L("upi_refund_marked_done", "confirmed", "b-3", { refundId: "upr-9" })),
    raw("2026-01-08T05:00:00Z", L("upi_refund_owed", "held_for_owner", "b-4", { refundId: "upr-2", amountPaise: "700" })),
    raw("2026-01-08T06:00:00Z", L("upi_refund_kept", "confirmed", "b-4", { refundId: "upr-2" })),
    raw("2026-01-08T06:01:00Z", L("upi_refund_kept", "confirmed", "b-4", { refundId: "upr-2" })),
    raw("2026-01-08T06:02:00Z", L("upi_refund_kept", "confirmed", "b-4", {})),
    raw("2026-01-09T05:00:00Z", L("owner_marked_paid", "confirmed", "b-5", { paymentId: "upi-1", amountPaise: "9000" })),
    raw("2026-01-09T05:30:00Z", L("owner_marked_paid", "confirmed", "b-5", { paymentId: "cash-1", amountPaise: "9100", via: "cash" })),
    raw("2026-01-09T05:31:00Z", L("owner_marked_paid", "confirmed", "b-5", { amountPaise: "9100", via: "cash" })),
    raw("2026-01-09T06:00:00Z", L("complete_booking", "confirmed", null, {})),
    raw("2026-01-09T06:01:00Z", L("complete_booking", "failed", "b-5", {})),
    raw("2026-01-09T06:02:00Z", L("other_action", "confirmed", "b-5", { amountPaise: "1" })),
    raw("2026-01-10T05:00:00Z", L("record_deposit", "confirmed", "b-6", { paymentId: "pay_6", amountPaise: "0x10" })),
    raw("2026-01-10T05:01:00Z", L("record_deposit", "confirmed", "b-6", { paymentId: "pay_7", amountPaise: "05" })),
    raw("2026-01-10T05:02:00Z", L("record_deposit", "confirmed", "b-6", { paymentId: "pay_8", amountPaise: " 5" })),
    raw("2026-01-10T05:03:00Z", L("record_deposit", "confirmed", "b-6", { paymentId: "pay_9", amountPaise: "+5" })),
    raw("2026-01-10T05:04:00Z", L("record_deposit", "confirmed", "b-6", { paymentId: "pay_10", amountPaise: "-5" })),
    raw("2026-01-10T05:05:00Z", L("record_deposit", "confirmed", "b-6", { paymentId: "pay_11", amountPaise: "9007199254740993" })),
    raw("2026-01-10T05:06:00Z", L("record_deposit", "confirmed", "b-6", { paymentId: "pay_12", amountPaise: "12.5" })),
    raw("2026-01-10T05:07:00Z", L("record_deposit", "confirmed", "b-6", { paymentId: "pay_13", amountPaise: "ten" })),
  ],
};

// ---- malformed money lines: every refusal the fold has, as a Problem ----
const malformed: WorldDef = {
  name: "malformed", timezone: "Asia/Kolkata", legacy: BOOKINGS_LEGACY,
  nows: ["2026-05-20T05:00:00Z"],
  steps: [
    raw("2026-05-01T05:00:00Z", L("x", "confirmed", "b-1", { money: "bogus" })),
    raw("2026-05-01T05:01:00Z", L("x", "confirmed", "b-1", { money: "" })),
    raw("2026-05-01T05:02:00Z", L("x", "confirmed", "b-1", { money: "received", amountPaise: "abc", paymentId: "p1", method: "gateway", evidence: "provider", for: "advance" })),
    raw("2026-05-01T05:03:00Z", L("x", "confirmed", "b-1", { money: "received", paymentId: "p1", method: "gateway", evidence: "provider", for: "advance" })),
    raw("2026-05-01T05:04:00Z", L("x", "confirmed", "b-1", { money: "received", amountPaise: "100", method: "gateway", evidence: "provider", for: "advance" })),
    raw("2026-05-01T05:05:00Z", L("x", "confirmed", "b-1", { money: "received", amountPaise: "100", paymentId: "", method: "gateway", evidence: "provider", for: "advance" })),
    raw("2026-05-01T05:06:00Z", L("x", "confirmed", "b-1", { money: "received", amountPaise: "100", paymentId: "p1", method: "card", evidence: "provider", for: "advance" })),
    raw("2026-05-01T05:07:00Z", L("x", "confirmed", "b-1", { money: "received", amountPaise: "100", paymentId: "p1", method: "gateway", evidence: "hearsay", for: "advance" })),
    raw("2026-05-01T05:08:00Z", L("x", "confirmed", "b-1", { money: "received", amountPaise: "100", paymentId: "p1", method: "gateway", evidence: "provider", for: "tip" })),
    raw("2026-05-01T05:09:00Z", L("x", "confirmed", "b-1", { money: "received", amountPaise: "100", paymentId: "p1", method: "gateway", evidence: "provider", for: "advance", doc: "RCT/26-27/0001" }), "ok1"),
    raw("2026-05-01T05:10:00Z", L("x", "confirmed", "b-1", { money: "received", amountPaise: "100", paymentId: "p1", method: "gateway", evidence: "provider", for: "advance", doc: "RCT/26-27/0002" })), // double counting
    raw("2026-05-01T05:11:00Z", L("x", "confirmed", "b-2", { money: "received", amountPaise: "100", paymentId: "p2", method: "cash", evidence: "owner_mark", for: "advance", doc: "not-a-number" })),
    raw("2026-05-01T05:12:00Z", L("x", "confirmed", "b-2", { money: "applied", amountPaise: "500", service: "haircut", doc: "BILL/26-27/0001" })), // more than held
    raw("2026-05-01T05:13:00Z", L("x", "confirmed", "b-2", { money: "applied", amountPaise: "5", service: "BAD" })),
    raw("2026-05-01T05:14:00Z", L("x", "confirmed", "b-2", { money: "applied", amountPaise: "5" })),
    raw("2026-05-01T05:15:00Z", L("x", "confirmed", null, { money: "fee_charged", amountPaise: "700" })),
    raw("2026-05-01T05:16:00Z", L("x", "confirmed", null, { money: "fee_charged", amountPaise: "700" })),
    raw("2026-05-01T05:17:00Z", L("x", "confirmed", "b-3", { money: "refund_owed", amountPaise: "30", paymentId: "p3" })),
    raw("2026-05-01T05:18:00Z", L("x", "confirmed", "b-3", { money: "refund_made", amountPaise: "30", evidence: "provider", method: "gateway" })),
    raw("2026-05-01T05:19:00Z", L("x", "confirmed", "b-3", { money: "refund_made", amountPaise: "30", evidence: "provider", method: "gateway", owed: "k1" })),
    raw("2026-05-01T05:20:00Z", L("x", "confirmed", "b-3", { money: "refund_made", amountPaise: "30", evidence: "provider", method: "boat", owed: "k1" })),
    raw("2026-05-01T05:21:00Z", L("x", "confirmed", "b-3", { money: "refund_cancelled" })),
    raw("2026-05-01T05:22:00Z", L("x", "confirmed", "b-3", { money: "refund_cancelled", owed: "nothing" })),
    raw("2026-05-01T05:23:00Z", L("x", "confirmed", "b-3", { money: "kept", amountPaise: "5", owed: "nothing" })),
    raw("2026-05-01T05:24:00Z", L("x", "confirmed", "b-3", { money: "kept", amountPaise: "5" })),
    raw("2026-05-01T05:25:00Z", L("x", "confirmed", "b-3", { money: "correction" })),
    raw("2026-05-01T05:26:00Z", L("x", "confirmed", "b-3", { money: "correction", reverses: "abc" })),
    raw("2026-05-01T05:27:00Z", L("x", "confirmed", "b-3", { money: "correction", reverses: "9.5" })),
    raw("2026-05-01T05:28:00Z", L("x", "confirmed", "b-3", { money: "correction", reverses: " 16 " })), // entry 16 is the first fee: reversed by " 16 "
    raw("2026-05-01T05:29:00Z", L("x", "confirmed", "b-3", { money: "correction", reverses: "1.6e1" })), // the same entry, again
    raw("2026-05-01T05:30:00Z", L("x", "confirmed", "b-3", { money: "correction", reverses: "0x11" })), // 17: the second fee line is a problem and has no lines
    raw("2026-05-01T05:31:00Z", L("x", "confirmed", "b-3", { money: "correction", reverses: "1e400" })),
    raw("2026-05-01T05:32:00Z", L("x", "confirmed", "b-3", { money: "settled", amountPaise: "1000" })),
    raw("2026-05-01T05:33:00Z", L("x", "confirmed", "b-3", { money: "settled", amountPaise: "1000", rowType: "transfer" })),
    raw("2026-05-01T05:34:00Z", L("x", "confirmed", "b-3", { money: "settled", amountPaise: "1000", rowType: "payment", feePaise: "x", taxPaise: "0", creditPaise: "1000", debitPaise: "0" })),
    raw("2026-05-01T05:35:00Z", L("x", "confirmed", "b-3", { money: "settled", amountPaise: "1000", rowType: "payment", feePaise: "10", taxPaise: "2", creditPaise: "5", debitPaise: "0", feeBasis: "without_gst" })),
    raw("2026-05-01T05:36:00Z", L("x", "confirmed", "b-3", { money: "settled", amountPaise: "1000", rowType: "payment", feePaise: "10", taxPaise: "2", creditPaise: "988", debitPaise: "0", feeBasis: "with_gst" })),
    raw("2026-05-01T05:37:00Z", L("x", "confirmed", "b-3", { money: "settled", amountPaise: "1000", rowType: "payment", feePaise: "10", taxPaise: "2", creditPaise: "988", debitPaise: "0", feeBasis: "without_gst" })),
    raw("2026-05-01T05:38:00Z", L("x", "confirmed", "b-3", { money: "settled", amountPaise: "1000", rowType: "payment", feePaise: "10", taxPaise: "2", creditPaise: "988", debitPaise: "0", feeBasis: "without_gst", settlementId: "s1", entity: "e1" })),
    raw("2026-05-01T05:39:00Z", L("x", "confirmed", "b-3", { money: "settled", amountPaise: "1000", rowType: "payment", feePaise: "10", taxPaise: "2", creditPaise: "988", debitPaise: "0", feeBasis: "without_gst", settlementId: "s1", entity: "e1", utr: "u1" })),
    raw("2026-05-01T05:40:00Z", L("x", "confirmed", "b-3", { money: "settled", amountPaise: "1000", rowType: "payment", feePaise: "10", taxPaise: "2", creditPaise: "988", debitPaise: "0", feeBasis: "without_gst", settlementId: "s1", entity: "e1", utr: "u1" })), // twice
    raw("2026-05-01T05:41:00Z", L("x", "confirmed", "b-3", { money: "settled", amountPaise: "300", rowType: "refund", feePaise: "0", taxPaise: "0", creditPaise: "0", debitPaise: "300", feeBasis: "without_gst", settlementId: "s1", entity: "e2", utr: "u1" })),
    raw("2026-05-01T05:42:00Z", L("x", "confirmed", "b-3", { money: "settled", amountPaise: "300", rowType: "refund", feePaise: "0", taxPaise: "0", creditPaise: "0", debitPaise: "299", feeBasis: "without_gst", settlementId: "s1", entity: "e3", utr: "u1" })),
    raw("2026-05-01T05:43:00Z", L("x", "confirmed", "b-3", { money: "settled", amountPaise: "300", rowType: "refund", feePaise: "-1", taxPaise: "0", creditPaise: "0", debitPaise: "300", feeBasis: "without_gst", settlementId: "s1", entity: "e4", utr: "u1" })),
    raw("2026-05-02T05:00:00Z", L("x", "confirmed", "b-3", { money: "received", amountPaise: "100", paymentId: "phone", method: "gateway", evidence: "provider", for: "advance", note: "call 919876543210 now" }, { conversation: "919876543210" })),
    raw("2026-05-02T05:01:00Z", L("x", "confirmed", "b-3", { money: "discount", amountPaise: "7", whom: "Anita Sharma" }, { conversation: "919876500001" })),
  ],
};

// ---- a financial year end: lines at 18:29:59.999 and 18:30 UTC on 31 March, a restore, and documents either side ----
const fyend: WorldDef = {
  name: "fyend", timezone: "Asia/Kolkata", legacy: BOOKINGS_LEGACY,
  nows: ["2027-03-31T18:29:59.999Z", "2027-03-31T18:30:00.000Z", "2027-04-02T05:00:00Z"],
  steps: [
    post("2027-03-20T05:00:00Z", () => money("received", { case: "b-1", paymentId: "pay_1", amountPaise: 10000, method: "gateway", evidence: "provider", for: "advance" }), L("record_deposit", "confirmed", "b-1", { paymentId: "pay_1" })),
    post("2027-03-31T18:29:59.999Z", () => money("received", { case: "b-2", paymentId: "pay_2", amountPaise: 20000, method: "gateway", evidence: "provider", for: "advance" }), L("record_deposit", "confirmed", "b-2", { paymentId: "pay_2" })),
    post("2027-03-31T18:30:00.000Z", () => money("received", { case: "b-3", paymentId: "pay_3", amountPaise: 30000, method: "gateway", evidence: "provider", for: "advance" }), L("record_deposit", "confirmed", "b-3", { paymentId: "pay_3" })),
    post("2027-04-01T05:00:00Z", () => money("received", { case: "b-4", paymentId: "pay_4", amountPaise: 40000, method: "upi", evidence: "owner_mark", for: "advance" }), L("owner_marked_paid", "confirmed", "b-4", { paymentId: "pay_4", requestId: "upi-1", amountPaise: "40000" })),
    post("2027-04-01T06:00:00Z", () => money("refund_owed", { case: "b-2", owed: "b-2:pay_2", paymentId: "pay_2", amountPaise: 5000 }), L("refund", "held_for_owner", "b-2")),
    post("2027-04-01T07:00:00Z", () => money("refund_made", { case: "b-2", owed: "b-2:pay_2", paymentId: "pay_2", amountPaise: 5000, method: "gateway", evidence: "provider", refundId: "rf_1" }), L("refund", "confirmed", "b-2", { paymentId: "pay_2", refundId: "rf_1" })),
    raw("2027-04-02T04:00:00Z", L("restored", "confirmed", null)),
    post("2027-04-02T05:00:00Z", () => money("received", { case: "b-5", paymentId: "pay_5", amountPaise: 50000, method: "gateway", evidence: "provider", for: "advance" }), L("record_deposit", "confirmed", "b-5", { paymentId: "pay_5" })),
    post("2027-04-02T05:10:00Z", () => money("refund_owed", { case: "b-5", owed: "b-5:pay_5", paymentId: "pay_5", amountPaise: 50000 }), L("refund", "held_for_owner", "b-5")),
    post("2027-04-02T05:20:00Z", () => money("refund_made", { case: "b-5", owed: "b-5:pay_5", paymentId: "pay_5", amountPaise: 50000, method: "gateway", evidence: "provider", refundId: "rf_5" }), L("refund", "confirmed", "b-5", { paymentId: "pay_5", refundId: "rf_5" })),
    // a document number a gap leaves: a number the record never had
    raw("2027-04-03T05:00:00Z", L("x", "confirmed", "b-6", { money: "received", amountPaise: "100", paymentId: "gap1", method: "gateway", evidence: "provider", for: "advance", doc: "RCT/27-28/0020" })),
    raw("2027-04-03T05:01:00Z", L("x", "confirmed", "b-6", { money: "received", amountPaise: "100", paymentId: "gap2", method: "gateway", evidence: "provider", for: "advance", doc: "RCT/27-28/0020" })),
    raw("2027-04-03T05:02:00Z", L("x", "confirmed", "b-6", { money: "received", amountPaise: "100", paymentId: "gap3", method: "gateway", evidence: "provider", for: "advance", doc: "RCT/27-28/0019" })),
  ],
};

export const WORLDS: WorldDef[] = [bookings, composition, settlements, fees, legacy, malformed, fyend];
