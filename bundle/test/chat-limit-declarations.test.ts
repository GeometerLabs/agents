// Each template's chat-limit declarations (templates/*/src/chat-limits.ts) against the settings they name: only limits that really exist, the right direction, the words in four
// languages. It lives here, not in modules/, because a shared module's tests import nothing from a template (modules/test/boundary.test.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { getAt } from "../../modules/limits/chat-limits.ts";
import { CHAT_LIMITS as BOOKINGS } from "../../templates/commerce/bookings/src/chat-limits.ts";
import { CHAT_LIMITS as FEES } from "../../templates/education/fees/src/chat-limits.ts";
import { CHAT_LIMITS as ORDERS } from "../../templates/commerce/orders/src/chat-limits.ts";
import { KINDS } from "../lib/kinds.ts";

test("each template declares only limits that are really in its settings, with the right direction", () => {
  const bookings = { cancellation: { refundLimitInr: 200 }, deposit: { amountInr: 200 } };
  const fees = { waiver: { limitInr: 0 }, refund: { limitInr: 500 }, batches: [{ monthlyFeeInr: 1500 }] };
  const orders = { owner: { approveOverInr: 0 }, refund: { limitInr: 500 }, orders: { maxPerDay: 30 } };
  for (const [declared, settings] of [[BOOKINGS, bookings], [FEES, fees], [ORDERS, orders]] as const) {
    assert.ok(declared.length > 0);
    for (const l of declared) {
      assert.equal(typeof getAt(settings, l.path), "number", `${l.id} is at ${l.path}`);
      assert.equal(l.tighter, "lower");
      for (const lang of ["en", "hi", "ml", "kn"] as const) { assert.ok(l.rule[lang].includes("{v}"), `${l.id} ${lang} rule has its value`); assert.ok(l.name[lang].length > 0); }
    }
  }
  assert.deepEqual(BOOKINGS.map((l) => l.id), ["refund_limit"]);
  assert.deepEqual(FEES.map((l) => l.id), ["waiver_limit", "refund_limit"]);
  assert.deepEqual(ORDERS.map((l) => l.id), ["big_order_limit", "refund_limit", "orders_per_day"]);
  assert.equal(FEES[0].bounds(fees).max, 1500, "a waiver is never more than the cheapest monthly fee");
});
