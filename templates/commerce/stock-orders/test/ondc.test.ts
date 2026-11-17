// Stock orders through the ONDC mapping (modules/ondc): a purchase order is the BUYER's side, so the mapping writes the select, init and confirm REQUESTS a shop would send a
// supplier. The Glow Salon example's catalogue is used for the orders. Here and not in modules/ondc/test because a module test may not import a template. It holds: every Stock
// orders state maps (read from order.ts so a new state fails here), the three questions (accepted, arrived, paid) fold into one ONDC state, the required fields are present or their
// gap is reported, the money is exact (prices like 175.50 included), and the supplier's WhatsApp number never appears.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { b2b } from "../../../../modules/ondc/index.ts";
import { b2bRequest } from "../../../../modules/ondc/contract.ts";
import { purchaseStatus, statesOf } from "../../../../modules/ondc/states.ts";
import { audit, SAMPLE_CALLER } from "../../../../modules/ondc/verify.ts";
import { glowSalon, KUMAR, MEENA, RAVI } from "../src/harness.ts";
import { createStore, totalOfPaise, unitPaiseOf } from "../src/order.ts";
import type { OrderState, PurchaseOrder } from "../src/order.ts";
import { purchaseIn } from "../src/ondc.ts";
import type { Settings } from "../src/settings.ts";

const NOW = Date.UTC(2026, 10, 17, 6, 30);
const keys = (o: { gaps: { missing: string }[] }) => o.gaps.map((g) => g.missing);
const stateNames = (): string[] => { const src = readFileSync(new URL("../src/order.ts", import.meta.url), "utf8"); return [...src.slice(src.indexOf("export type OrderState ="), src.indexOf("export type Ack")).matchAll(/\|\s*"([a-z_]+)"/gu)].map((m) => m[1]); };

function make(settings: Settings, state: OrderState, lineIndex = 0, qty = 10): PurchaseOrder {
  const line = settings.catalogue[lineIndex];
  const unitPaise = unitPaiseOf(line);
  return { id: "po-1", requestId: "r-1", lowStock: false, supplier: line.supplier, line: `${line.item}~${line.supplier}~${line.unit}`, item: line.item, unit: line.unit, qty, unitPaise, totalPaise: totalOfPaise(unitPaise, qty), state, createdMs: NOW - 3_600_000, ack: "none", receipt: "none", receivedQty: 0, asks: [] };
}

test("every Stock orders state maps to ONDC, read from order.ts so a new state fails here", () => {
  assert.deepEqual([...statesOf("stock-orders")].sort(), stateNames().sort());
});

test("every state: requests that never reached a supplier have no confirm; the rest hold their required fields or report the gap", () => {
  const settings = glowSalon();
  for (const state of stateNames() as OrderState[]) {
    const view = purchaseIn(settings, make(settings, state), "client-1", NOW);
    const sent = purchaseStatus(view).stage === "order";
    for (const stage of ["select", "init", "confirm"] as const) {
      const out = b2b.purchaseRequest(view, stage, SAMPLE_CALLER);
      if (stage === "confirm" && !sent) { assert.equal(out, null, state); continue; }
      const a = audit(out!, b2bRequest(stage), false);
      assert.deepEqual({ missing: a.missing, money: a.money, sums: a.sums, flags: out!.flags }, { missing: [], money: [], sums: stage === "confirm" ? true : null, flags: [] }, `${state} ${stage}`);
      assert.ok(!JSON.stringify(out!.body).includes(RAVI) && !JSON.stringify(out!.body).includes(MEENA) && !JSON.stringify(out!.body).includes(KUMAR));
    }
  }
});

test("the gaps of the Glow Salon's purchase request are exactly these: no supplier of ours is on the network, and the shop holds no GSTIN, phone or position", () => {
  const settings = glowSalon();
  const view = purchaseIn(settings, make(settings, "sent"), "client-1", NOW);
  assert.deepEqual(keys(b2b.purchaseRequest(view, "select", SAMPLE_CALLER)!), ["city_code", "retail_domain", "shop_address_parts", "shop_gps", "supplier_ondc_ids"].sort());
  assert.deepEqual(keys(b2b.purchaseRequest(view, "confirm", SAMPLE_CALLER)!), ["city_code", "gstin", "retail_domain", "shop_address_parts", "shop_gps", "shop_phone", "supplier_ondc_ids"].sort());
});

test("money is exact: 175.50 a bottle, twelve bottles, is 2106", () => {
  const settings = glowSalon();
  const i = settings.catalogue.findIndex((l) => l.priceInr === 175.5);
  const view = purchaseIn(settings, make(settings, "sent", i, 12), "client-1", NOW);
  assert.deepEqual([view.unitPaise, view.totalPaise], [17550, 210600]);
  const o = b2b.purchaseRequest(view, "confirm", SAMPLE_CALLER)!.message.order as any;
  assert.deepEqual([o.quote.price.value, o.quote.breakup[0].item.price.value, o.quote.breakup[0].price.value, o.payments[0].params.amount], ["2106", "175.50", "2106", "2106"]);
});

test("accepted, arrived and paid are three questions and ONDC's one state follows the supplier's yes and the goods", () => {
  const settings = glowSalon();
  const at = (patch: Partial<PurchaseOrder>) => b2b.purchaseRequest(purchaseIn(settings, { ...make(settings, "sent"), ...patch }, "client-1", NOW), "confirm", SAMPLE_CALLER)!;
  assert.deepEqual([purchaseStatus(purchaseIn(settings, make(settings, "sent"), "c", NOW)).order, purchaseStatus(purchaseIn(settings, { ...make(settings, "sent"), ack: "accepted" }, "c", NOW)).order, purchaseStatus(purchaseIn(settings, { ...make(settings, "sent"), ack: "accepted", receipt: "part" }, "c", NOW)).order, purchaseStatus(purchaseIn(settings, { ...make(settings, "sent"), ack: "accepted", receipt: "full" }, "c", NOW)).order], ["Created", "Accepted", "In-progress", "Completed"]);
  assert.equal((at({}).message.order as any).payments[0].status, "NOT-PAID");
  assert.equal((at({ paidOutsideMs: NOW }).message.order as any).payments[0].status, "PAID"); // "received" is not "paid": paid is its own fact
  assert.equal((at({ receipt: "full", ack: "accepted" }).message.order as any).payments[0].status, "NOT-PAID");
});
