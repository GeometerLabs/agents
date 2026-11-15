// booksFaults (invariants.ts): a record posted through post() holds; a document number skipped with no restore, a customer's number or a student's name in refs, and a
// restore's jump are each told apart. The templates' crash tests run the same check on every world they make (test/accounting-figures.test.ts in each template).
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeClock } from "../../core/clock.ts";
import { zonedToMs } from "../../core/time.ts";
import { createRecord } from "../../record/record.ts";
import type { Outcome } from "../../record/record.ts";
import type { LegacyMap } from "../journal.ts";
import { RESTORED_ACTION } from "../numbers.ts";
import { createAccounting } from "../post.ts";
import type { MoneyEvent } from "../post.ts";
import { booksFaults } from "../invariants.ts";

const TZ = "Asia/Kolkata";
const PHONE = "+919800000001";
const LEGACY: LegacyMap = { received: [{ action: "record_deposit", outcome: "confirmed", for: "advance" }] };

function world() {
  const clock = fakeClock(zonedToMs({ year: 2026, month: 11, day: 3 }, { hour: 10, minute: 0 }, TZ));
  const record = createRecord(clock);
  const acc = createAccounting({ record, shop: { timezone: TZ }, legacy: LEGACY, clock });
  const raw = (action: string, refs: Record<string, string>, outcome: Outcome = "confirmed", c: string | null = "b-1") =>
    record.append({ conversation: PHONE, booking: c, action, inputs: {}, outcome, language: "en", refs });
  const post = (event: MoneyEvent, action: string, outcome: Outcome = "confirmed") => acc.post(event, (refs) => raw(action, refs, outcome, "case" in event ? event.case : null));
  return { record, post, raw };
}
const gw = (c: string, id: string, amountPaise: number): MoneyEvent => ({ kind: "received", case: c, paymentId: id, amountPaise, method: "gateway", evidence: "provider", for: "advance" });

test("a record posted through post() holds, with a double tap, a refund owed, made and a second owed then cancelled", () => {
  const w = world();
  w.post(gw("b-1", "pay_1", 20_000), "record_deposit");
  w.post(gw("b-1", "pay_1", 20_000), "record_deposit"); // the double tap: posts nothing
  w.post({ kind: "refund_owed", case: "b-1", owed: "b-1:pay_1", paymentId: "pay_1", amountPaise: 20_000 }, "refund", "attempted");
  w.post({ kind: "refund_made", case: "b-1", owed: "b-1:pay_1", paymentId: "pay_1", refundId: "rfnd_1", amountPaise: 20_000, method: "gateway", evidence: "provider" }, "refund");
  w.post(gw("b-2", "pay_2", 10_000), "record_deposit");
  w.post({ kind: "refund_owed", case: "b-2", owed: "b-2:pay_2", paymentId: "pay_2", amountPaise: 10_000 }, "refund", "held_for_owner");
  w.post({ kind: "refund_cancelled", case: "b-2", owed: "b-2:pay_2", why: "owner_said_no" }, "refund", "refused");
  assert.deepEqual(booksFaults(w.record.entries(), LEGACY), []);
});

test("a number skipped with no restore is a fault; the same jump after a restore is not", () => {
  const w = world();
  w.post(gw("b-1", "pay_1", 20_000), "record_deposit"); // RCT/26-27/0001
  w.raw("record_deposit", { money: "received", amountPaise: "5000", paymentId: "pay_9", method: "gateway", evidence: "provider", for: "advance", doc: "RCT/26-27/0004" }, "confirmed", "b-9");
  assert.deepEqual(booksFaults(w.record.entries(), LEGACY), ["RCT/26-27: numbers 2 to 3 are missing and no restore explains it"]);

  const r = world();
  r.post(gw("b-1", "pay_1", 20_000), "record_deposit");
  r.raw(RESTORED_ACTION, {}, "confirmed", null);
  r.post(gw("b-2", "pay_2", 20_000), "record_deposit"); // the series jumps on after the restore
  assert.deepEqual(booksFaults(r.record.entries(), LEGACY), []);
});

test("a customer's number or a student's name in a record entry's refs is a fault; times and a bank's 12-digit reference are not", () => {
  const w = world();
  w.post(gw("b-1", "pay_1", 20_000), "record_deposit");
  w.raw("note", { atMs: "1794687824305", settledAt: "1794687824", utr: "123456789012" }, "confirmed");
  assert.deepEqual(booksFaults(w.record.entries(), LEGACY, { privateText: ["Asha Rao"] }), []);
  w.raw("note", { to: "9800000001", who: "Asha Rao" }, "confirmed");
  assert.deepEqual(booksFaults(w.record.entries(), LEGACY, { privateText: ["Asha Rao"] }), ["entry 3: refs.to carries a customer's phone number", "entry 3: refs.who carries a private name"]);
});
