import { test } from "node:test";
import assert from "node:assert/strict";
import type { RecordEntry } from "../../record/record.ts";
import { BUILT_IN } from "../builtin.ts";
import { DEFAULT_OPTIONS, countsByKind, createObligationRegistry } from "../registry.ts";
import type { CaseLike, Obligation } from "../registry.ts";
import { obligations } from "../index.ts";

const NOW = Date.parse("2026-11-04T10:00:00+05:30");
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
let seq = 0;
const entry = (booking: string, action: string, outcome: RecordEntry["outcome"], at: number): RecordEntry =>
  ({ seq: ++seq, time: iso(at), conversation: "c-1", booking, action, inputsDigest: "0", outcome, decisions: [], language: "en", notes: "", refs: {} });
const detect = (template: string, cases: CaseLike[], entries: RecordEntry[] = [], options = DEFAULT_OPTIONS) => createObligationRegistry(BUILT_IN).detect({ template, cases, entries, nowMs: NOW, options });
const kinds = (found: Obligation[]) => found.map((o) => `${o.kind}:${o.caseId}`);

const booking = (o: Partial<CaseLike> & { id: string; state: string }): CaseLike => ({ pending: [], ...o });

test("a deposit received with no confirmed booking is listed, with the recovery actions that fit it", () => {
  const stuck = booking({ id: "b-1", state: "needs_owner", depositPaymentId: "pmt_1", depositInr: 200, pending: [{ kind: "calendar" }] });
  const done = booking({ id: "b-2", state: "confirmed", depositPaymentId: "pmt_2", depositInr: 200 });
  const { found } = detect("bookings", [stuck, done], [entry("b-1", "record_deposit", "confirmed", NOW - 2 * HOUR), entry("b-2", "record_deposit", "confirmed", NOW - 2 * HOUR)]);
  const deposit = found.filter((o) => o.kind === "deposit_no_booking");
  assert.deepEqual(deposit.map((o) => o.caseId), ["b-1"]);
  assert.deepEqual(deposit[0].facts, { case: "b-1", amountInr: 200 });
  assert.deepEqual([...deposit[0].actions], ["retry_booking", "recheck_payment", "ask_owner_again"]);
  assert.equal(deposit[0].sinceMs, NOW - 2 * HOUR);
});

test("a thing the agent is still working on (a deposit a minute old) is not listed yet", () => {
  const fresh = booking({ id: "b-1", state: "needs_owner", depositPaymentId: "pmt_1", depositInr: 200 });
  assert.deepEqual(detect("bookings", [fresh], [entry("b-1", "record_deposit", "confirmed", NOW - 60_000)]).found, []);
});

test("an answer from the owner that waited too long is listed once, as that, and not also as a refund on its way", () => {
  const late = booking({ id: "b-3", state: "cancelled", pending: [{ kind: "guard_hold", amountInr: 800, paymentId: "pmt_3", heldAtMs: NOW - 13 * HOUR }] });
  const recent = booking({ id: "b-4", state: "cancelled", pending: [{ kind: "guard_hold", amountInr: 800, paymentId: "pmt_4", heldAtMs: NOW - 1 * HOUR }] });
  const { found } = detect("bookings", [late, recent]);
  assert.deepEqual(kinds(found), ["approval_waiting_long:b-3", "refund_waiting:b-4"]);
  assert.equal(found[0].facts.hours, 13);
  assert.deepEqual([...found[0].actions], [], "a refund Guard holds is asked by the approvals relay, once: nothing to send again from here");
  assert.equal(found[1].facts.holder, "owner");
});

test("the wait before an answer is 'too long' is a setting with a default of 12 hours", () => {
  assert.equal(DEFAULT_OPTIONS.approvalWaitMs, 12 * HOUR);
  const c = booking({ id: "b-3", state: "cancelled", pending: [{ kind: "guard_hold", amountInr: 800, paymentId: "p", heldAtMs: NOW - 3 * HOUR }] });
  assert.deepEqual(kinds(detect("bookings", [c]).found), ["refund_waiting:b-3"]);
  assert.deepEqual(kinds(detect("bookings", [c], [], { ...DEFAULT_OPTIONS, approvalWaitMs: 2 * HOUR }).found), ["approval_waiting_long:b-3"]);
});

test("a cancellation waiting for the owner's call on a refund takes its time from the record, and the agent's own ask can be sent again", () => {
  const c = booking({ id: "b-5", state: "cancelled", pending: [{ kind: "refund", amountInr: 200, paymentId: "pmt_5", reason: "late_cancellation" }] });
  const early = detect("bookings", [c], [entry("b-5", "refund", "held_for_owner", NOW - 30 * 60_000)]).found;
  assert.deepEqual(kinds(early), ["refund_waiting:b-5"]);
  assert.deepEqual([...early[0].actions], ["ask_owner_again"]);
  const late = detect("bookings", [c], [entry("b-5", "refund", "held_for_owner", NOW - 20 * HOUR)]).found;
  assert.deepEqual(kinds(late), ["approval_waiting_long:b-5"]);
  assert.deepEqual([...late[0].actions], ["ask_owner_again"]);
});

test("asking the owner again starts the wait again", () => {
  const c = booking({ id: "b-5", state: "cancelled", pending: [{ kind: "refund", amountInr: 200, paymentId: "pmt_5" }] });
  const held = entry("b-5", "refund", "held_for_owner", NOW - 20 * HOUR);
  assert.deepEqual(kinds(detect("bookings", [c], [held]).found), ["approval_waiting_long:b-5"]);
  const again = { ...entry("b-5", "recovery", "confirmed", NOW - HOUR), refs: { action: "ask_owner_again", recovery: "r-2" } };
  const after = detect("bookings", [c], [held, again]).found;
  assert.deepEqual(kinds(after), ["refund_waiting:b-5"]);
  assert.equal(after[0].sinceMs, NOW - HOUR);
});

test("a refund being sent again by the agent is waiting on the agent, not on the owner", () => {
  const c = booking({ id: "b-6", state: "cancelled", pending: [{ kind: "refund_retry", amountInr: 200, paymentId: "p", tries: 1, retryAtMs: NOW + 60_000 }] });
  const { found } = detect("bookings", [c]);
  assert.deepEqual(kinds(found), ["refund_waiting:b-6"]);
  assert.equal(found[0].facts.holder, "agent");
});

test("a refund whose outcome is unknown, and one that failed for good, are two kinds; only a refund that may have gone can be looked for again", () => {
  const c = booking({ id: "b-7", state: "cancelled", refundIssues: [{ paymentId: "p1", kind: "unknown", note: "n", atMs: NOW - HOUR }, { paymentId: "p2", kind: "refused", note: "n", atMs: NOW - 2 * HOUR }] });
  const { found } = detect("bookings", [c]);
  assert.deepEqual(kinds(found).sort(), ["refund_failed:b-7", "refund_unknown:b-7"]);
  assert.deepEqual([...found.find((o) => o.kind === "refund_unknown")!.actions], ["recheck_refund"]);
  assert.deepEqual([...found.find((o) => o.kind === "refund_failed")!.actions], [], "Guard said no: there is nothing to look for");
  const lost = booking({ id: "b-8", state: "cancelled", refundIssues: [{ paymentId: "p", kind: "failed", note: "n", atMs: NOW - HOUR }] });
  assert.deepEqual([...detect("bookings", [lost]).found[0].actions], ["recheck_refund"], "a refund that failed after retries may still have landed");
});

test("Fees: a payment that came but did not update the fee is listed until a later payment line is confirmed", () => {
  const due = { id: "f-1", state: "open", pending: [] } as CaseLike;
  const bad = entry("f-1", "record_payment", "failed", NOW - 3 * HOUR);
  assert.deepEqual(kinds(detect("fees", [due], [bad]).found), ["payment_unrecorded:f-1"]);
  assert.deepEqual(detect("fees", [due], [bad, entry("f-1", "record_payment", "confirmed", NOW - HOUR)]).found, []);
  const looked = { ...entry("f-1", "recovery", "confirmed", NOW - HOUR), seq: bad.seq + 1, refs: { action: "recheck_payment", recovery: "r-1" } };
  assert.deepEqual(detect("fees", [due], [bad, looked]).found, [], "a look at the payments service that read its list whole settles it");
  const early = { ...looked, seq: bad.seq - 1 };
  assert.deepEqual(kinds(detect("fees", [due], [early, bad]).found), ["payment_unrecorded:f-1"], "a look before the failure does not");
  assert.deepEqual(detect("fees", [{ ...due, state: "paid" }], [bad]).found, [], "a fee that is paid is not unfinished");
  assert.deepEqual(detect("bookings", [due], [bad]).found, [], "the kind is Fees' own");
});

test("Fees: a waiver or a refund request that waited too long is listed with 'ask the owner again'", () => {
  const due = { id: "f-2", state: "open", pending: [{ kind: "waiver", id: "q-1", amountInr: 300, balanceAtAskInr: 1000, askedAtMs: NOW - 30 * HOUR }] } as CaseLike;
  const { found } = detect("fees", [due]);
  assert.deepEqual(kinds(found), ["approval_waiting_long:f-2"]);
  assert.equal(found[0].facts.what, "waiver");
  assert.deepEqual([...found[0].actions], ["ask_owner_again"]);
});

test("a list is oldest first, and what the facts hold is only ids, amounts and whole numbers", () => {
  const a = booking({ id: "b-1", state: "cancelled", refundIssues: [{ paymentId: "p", kind: "unknown", note: "Rohan Mehta, +919811111111", atMs: NOW - HOUR }] });
  const b = booking({ id: "b-2", state: "cancelled", refundIssues: [{ paymentId: "p", kind: "refused", note: "x", atMs: NOW - 5 * HOUR }] });
  const { found } = detect("bookings", [a, b]);
  assert.deepEqual(found.map((o) => o.caseId), ["b-2", "b-1"]);
  assert.ok(!JSON.stringify(found).includes("Rohan") && !JSON.stringify(found).includes("9811111111"), "an issue's note is never copied into a list");
});

test("the registry takes more kinds (the UPI module's), refuses a repeat or a badly named one, and one kind that breaks does not hide the others", () => {
  const r = createObligationRegistry(BUILT_IN);
  r.register({ id: "upi_unconfirmed", templates: ["bookings"], detect: ({ cases }) => cases.filter((c) => c.state === "awaiting_owner_mark").map((c) => ({ kind: "upi_unconfirmed", caseId: c.id, sinceMs: null, facts: { case: c.id }, actions: [] })) });
  assert.throws(() => r.register({ id: "upi_unconfirmed", templates: "all", detect: () => [] }), /already registered/u);
  assert.throws(() => r.register({ id: "Upi-Unconfirmed", templates: "all", detect: () => [] }), /lower_snake_case/u);
  r.register({ id: "broken_kind", templates: "all", detect: () => { throw new Error("boom"); } });
  const out = r.detect({ template: "bookings", cases: [booking({ id: "b-9", state: "awaiting_owner_mark" })], entries: [], nowMs: NOW, options: DEFAULT_OPTIONS });
  assert.deepEqual(kinds(out.found), ["upi_unconfirmed:b-9"]);
  assert.deepEqual(out.failed, ["broken_kind"]);
  assert.equal(r.detect({ template: "fees", cases: [booking({ id: "b-9", state: "awaiting_owner_mark" })], entries: [], nowMs: NOW, options: DEFAULT_OPTIONS }).found.length, 0, "a kind for Bookings does not run on Fees");
});

test("counts by kind carry no ids, names or numbers", () => {
  const counts = countsByKind([
    { kind: "refund_unknown", caseId: "b-1", sinceMs: 1, facts: { case: "b-1" }, actions: [] },
    { kind: "refund_unknown", caseId: "b-2", sinceMs: 1, facts: { case: "b-2" }, actions: [] },
    { kind: "deposit_no_booking", caseId: "b-3", sinceMs: 1, facts: { case: "b-3", amountInr: 200 }, actions: [] },
  ]);
  assert.deepEqual(counts, { refund_unknown: 2, deposit_no_booking: 1 });
  assert.ok(!JSON.stringify(counts).includes("b-"));
});

test("the shared registry has the six built-in kinds", () => {
  assert.deepEqual(obligations.ids().slice(0, 6), ["deposit_no_booking", "payment_unrecorded", "approval_waiting_long", "refund_waiting", "refund_unknown", "refund_failed"]);
});
