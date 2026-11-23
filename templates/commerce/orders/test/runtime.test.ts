// The Orders runtime keeps the agent honest across restarts: steps are saved whole and picked up again after a restart, and the order store round-trips. The shared parts (the
// queue, the retries) are tried through Bookings and Fees; what is Orders' own is tried here: a store of orders, the stock worked out from them, and the status counts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeClock } from "../../../../modules/core/clock.ts";
import { LANGUAGES } from "../../../../modules/language/languages.ts";
import { createFakeMessaging } from "../../../../modules/messaging/messaging.ts";
import { createGuardModel } from "../../../../modules/payments/guard-model.ts";
import { createFakePayments } from "../../../../modules/payments/payments.ts";
import { createRuleParser } from "../src/adapters/rule-parser.ts";
import { AMIT, HARNESS_GUARD, annapurnaRazorpay, createWorld } from "../src/harness.ts";
import { gatewayLimitsSpec } from "../src/guard-limits.ts";
import { META_TEMPLATE_NAMES } from "../src/language/meta-templates.ts";
import { TEMPLATE_NAMES } from "../src/language/templates.ts";
import { compactFinishedOrders, takenOf } from "../src/order.ts";
import { openStore } from "../server/store.ts";
import { parseStore, serializeStore } from "../server/snapshot.ts";
import { zonedToMs } from "../../../../modules/core/time.ts";

const settings = annapurnaRazorpay();
const START = zonedToMs({ year: 2026, month: 11, day: 9 }, { hour: 10, minute: 0 }, settings.timezone);

test("the order store round-trips every field, and a UPI shop's ledger with it", async () => {
  const w = createWorld();
  await w.say("2 veg thali 10 nov 12:00 pm pickup");
  const again = parseStore(serializeStore(w.store));
  assert.deepEqual(JSON.parse(JSON.stringify([...again.orders])), JSON.parse(JSON.stringify([...w.store.orders])), "every field a saved order has comes back");
  assert.equal(again.nextOrder, w.store.nextOrder);
  assert.deepEqual(again.upi, w.store.upi);
});

test("a delivery address, as the customer wrote it, is taken off an order that is over and whose slot ended before the cutoff; its place on the list stays", () => {
  const order = (id: string, state: string, slotEndMs: number | undefined) => ({ id, customer: AMIT, language: "en", state, lines: [], dateNeedsConfirmation: false, awaitingAddress: false, handledPayments: [], pending: [], area: "Indiranagar", address: "12, 3rd Cross, Indiranagar", ...(slotEndMs !== undefined ? { slotEndMs } : {}) });
  const store = { orders: new Map([["o-1", order("o-1", "completed", 1_000)], ["o-2", order("o-2", "confirmed", 1_000)], ["o-3", order("o-3", "cancelled", 5_000)], ["o-4", order("o-4", "expired", 1_000)], ["o-5", order("o-5", "completed", undefined)]]) } as never;
  assert.equal(compactFinishedOrders(store, 2_000), 2);
  const left = [...(store as { orders: Map<string, { id: string; address?: string; area?: string }> }).orders.values()].map((o) => [o.id, o.address !== undefined, o.area]);
  assert.deepEqual(left, [["o-1", false, "Indiranagar"], ["o-2", true, "Indiranagar"], ["o-3", true, "Indiranagar"], ["o-4", false, "Indiranagar"], ["o-5", true, "Indiranagar"]], "an order still being done, one whose slot is recent, and one with no slot keep it");
  assert.equal(compactFinishedOrders(store, 2_000), 0, "nothing twice");
});

// Item 11h touched the refund context (a page order names the number its customer typed): every field the approvals relay words its ask with must still be there.