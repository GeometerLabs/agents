// Orders through the ONDC mapping (modules/ondc): the example shops' real menus and orders, turned into neutral types by src/ondc.ts and then into ONDC's retail messages. It is here
// and not in modules/ondc/test because a module test may not import a template (modules/test/boundary.test.ts). What it holds: every outbound message has every field the contract
// marks required (or reports why not), exact money strings, a quote that adds up; every one of Orders' states maps (read from order.ts, so a state added there fails here first);
// our own on_confirm read back as a confirm request gives the same lines and slot; and the gaps are exactly what these shops do not hold.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { retail } from "../../../../modules/ondc/index.ts";
import { retailOnSearch, retailOrder } from "../../../../modules/ondc/contract.ts";
import { readRequest } from "../../../../modules/ondc/inbound.ts";
import { statesOf, statusOf } from "../../../../modules/ondc/states.ts";
import { audit, SAMPLE_CALLER } from "../../../../modules/ondc/verify.ts";
import { annapurna, annapurnaPlans, annapurnaRazorpay, sweetCrumbs } from "../src/harness.ts";
import { fixSlot, newDraft, createStore, register } from "../src/order.ts";
import type { Order, OrderState } from "../src/order.ts";
import { catalogueOf, orderIn } from "../src/ondc.ts";
import type { Settings } from "../src/settings.ts";

const NOW = Date.UTC(2026, 10, 17, 6, 30);
const SHOPS: [string, () => Settings][] = [["annapurna (UPI)", annapurna], ["annapurna (Razorpay)", annapurnaRazorpay], ["sweet crumbs (pickup only, whole advance)", sweetCrumbs]];
const keys = (o: { gaps: { missing: string }[] }) => o.gaps.map((g) => g.missing);

const stateNames = (): string[] => [...readFileSync(new URL("../src/order.ts", import.meta.url), "utf8").match(/export type OrderState =([^;]+);/u)![1].matchAll(/"([a-z_]+)"/gu)].map((m) => m[1]);

function make(settings: Settings, state: OrderState, mode: "pickup" | "delivery"): Order {
  const store = createStore();
  const o = register(store, newDraft("+919800000009", "en"));
  o.state = state;
  o.lines = [{ itemId: settings.menu[0].id, qty: 2 }, { itemId: settings.menu[1]?.id ?? settings.menu[0].id, qty: 1 }].filter((l, i, a) => a.findIndex((x) => x.itemId === l.itemId) === i);
  o.date = { year: 2026, month: 11, day: 18 };
  o.slotId = (mode === "pickup" ? settings.pickup.slots : settings.delivery!.slots)[0].id;
  fixSlot(settings, o);
  return o;
}

test("every state of Orders maps to ONDC, and the list of states is read from order.ts so a new one fails here", () => {
  assert.deepEqual([...statesOf("orders")].sort(), stateNames().sort());
  for (const s of stateNames()) assert.ok(statusOf("orders", s).stage);
});

test("the example shops' catalogues map: required fields, exact money, and exactly the gaps these shops have", () => {
  for (const [name, load] of SHOPS) {
    const settings = load();
    const cat = catalogueOf(settings, createStore(), "client-1", NOW);
    const out = retail.onSearch(cat, SAMPLE_CALLER);
    const a = audit(out, retailOnSearch(undefined), true);
    assert.deepEqual({ missing: a.missing, money: a.money }, { missing: [], money: [] }, name);
    const expected = ["fssai", "item_description", "item_images", "menu_categories", "prep_time", "retail_category", "retail_domain", "return_policy", "shop_address_parts", "shop_description", "shop_gps", "shop_images", "shop_phone", "shop_rating", "tax_breakup", "veg_nonveg", ...(settings.delivery ? ["serviceability_radius"] : [])].sort();
    assert.deepEqual(keys(out), expected, name);
    const items = (out.message.catalog as any)["bpp/providers"][0].items as any[];
    assert.deepEqual(items.map((i) => i.price.value), settings.menu.map((m) => String(m.priceInr)), name); // whole rupees stay whole, as strings
    assert.deepEqual(items.map((i) => i.quantity.available.count), settings.menu.map((m) => String(m.dailyStock)), name); // nothing is held on an empty store
  }
});

test("every state, both ways, every stage: required fields, exact money, a quote that adds up, ONDC's enums; states with no order say nothing", () => {
  for (const [name, load] of SHOPS) {
    const settings = load();
    const modes = settings.delivery ? (["pickup", "delivery"] as const) : (["pickup"] as const);
    for (const state of stateNames() as OrderState[]) for (const mode of modes) {
      const view = orderIn(settings, make(settings, state, mode), "client-1", NOW)!;
      const none = statusOf("orders", state).stage === "none";
      const stages = state === "cancelled" || state === "expired" ? (["on_cancel"] as const) : (["on_select", "on_init", "on_confirm", "on_status"] as const);
      for (const stage of stages) {
        const out = retail.orderMessage(view, stage, SAMPLE_CALLER);
        if (none) { assert.equal(out, null, `${name} ${state}`); continue; }
        const a = audit(out!, retailOrder(stage, mode, true), true);
        assert.deepEqual({ missing: a.missing, money: a.money, sums: a.sums, enums: a.enums, flags: out!.flags }, { missing: [], money: [], sums: true, enums: [], flags: [] }, `${name} ${state} ${mode} ${stage}`);
        const o = out!.message.order as any;
        assert.equal(o.quote.price.value, String(view.totalPaise / 100).replace(/\.0+$/u, ""));
      }
    }
  }
});

test("the gaps of a confirmed order are exactly these, and a cancelled one without a stored reason says so instead of inventing one", () => {
  const settings = annapurna();
  const c = retail.orderMessage(orderIn(settings, make(settings, "confirmed", "delivery"), "client-1", NOW)!, "on_confirm", SAMPLE_CALLER)!;
  assert.deepEqual(keys(c), ["finder_fee", "gstin", "pan", "record_times", "retail_domain", "settlement_account", "shop_address_parts", "shop_gps", "shop_phone", "tat", "tax_breakup"].sort());
  const x = retail.orderMessage(orderIn(settings, make(settings, "cancelled", "pickup"), "client-1", NOW)!, "on_cancel", SAMPLE_CALLER)!;
  assert.ok(keys(x).includes("cancel_reason"));
  const e = retail.orderMessage(orderIn(settings, make(settings, "expired", "pickup"), "client-1", NOW)!, "on_cancel", SAMPLE_CALLER)!;
  assert.equal((e.message.order as any).cancellation.reason.id, "022");
});

test("money: the advance, the balance and who collected, in exact strings", () => {
  const settings = annapurna(); // 50% advance
  const o = make(settings, "confirmed", "pickup"); // 2 x 120 + 1 x 160 = 400
  const view = orderIn(settings, o, "client-1", NOW)!;
  assert.deepEqual(view.payments.map((p) => [p.kind, p.amountPaise, p.paid, p.by]), [["advance", 20000, true, "owner-marked"], ["balance", 20000, false, undefined]]);
  const gw = orderIn(annapurnaRazorpay(), make(annapurnaRazorpay(), "confirmed", "pickup"), "client-1", NOW)!;
  assert.equal(gw.payments[0].by, "provider");
  const m = retail.orderMessage(view, "on_confirm", SAMPLE_CALLER)!.message.order as any;
  assert.deepEqual([m.quote.price.value, m.payment.params.amount, m.payment.status, m.payment.type], ["400", "400", "NOT-PAID", "ON-FULFILLMENT"]);
  const done = orderIn(settings, { ...o, state: "completed", balance: { amountInr: 200, paid: { by: "cash", atMs: NOW } } }, "client-1", NOW)!;
  assert.deepEqual(done.payments.map((p) => [p.paid, p.by]), [[true, "owner-marked"], [true, "cash"]]);
  assert.equal((retail.orderMessage(done, "on_status", SAMPLE_CALLER)!.message.order as any).payment.status, "PAID");
  const sweet = sweetCrumbs();
  assert.equal(orderIn(sweet, make(sweet, "confirmed", "pickup"), "client-1", NOW)!.payments.length, 1); // the whole order paid in advance: no balance part
});

test("a held order carries a way to pay: a UPI link for an owner-marked shop, the gateway's link for a gateway shop", () => {
  const upi = annapurna();
  const held = orderIn(upi, make(upi, "awaiting_advance", "pickup"), "client-1", NOW)!;
  assert.match(held.payments[0].uri ?? "", /^upi:\/\/pay\?/u);
  const gw = annapurnaRazorpay();
  const o = make(gw, "awaiting_advance", "pickup");
  o.linkUrl = "https://pay.example.invalid/l/abc";
  assert.equal(orderIn(gw, o, "client-1", NOW)!.payments[0].uri, "https://pay.example.invalid/l/abc");
});

test("a monthly plan's payment is not a meal order and has no ONDC counterpart", () => {
  const settings = annapurnaPlans();
  const o = make(settings, "confirmed", "pickup");
  o.plan = { id: "p-1", period: 1, typeId: "x" };
  assert.equal(orderIn(settings, o, "client-1", NOW), undefined);
});

test("round trip: our on_confirm read back as a confirm request gives the same lines, way and slot, and no mismatch", () => {
  for (const [name, load] of SHOPS) {
    const settings = load();
    const cat = catalogueOf(settings, createStore(), "client-1", NOW);
    for (const mode of settings.delivery ? (["pickup", "delivery"] as const) : (["pickup"] as const)) {
      const o = make(settings, "confirmed", mode);
      const out = retail.orderMessage(orderIn(settings, o, "client-1", NOW)!, "on_confirm", SAMPLE_CALLER)!;
      const intent = readRequest({ context: { ...out.body.context, action: "confirm" }, message: out.body.message }, cat);
      assert.deepEqual(intent.lines, o.lines, `${name} ${mode}`);
      assert.deepEqual([intent.mode, intent.slot?.slotId, intent.slot?.fromMs, intent.slot?.toMs, intent.flags], [mode, o.slotId, o.slotStartMs, o.slotEndMs, []], `${name} ${mode}`);
      assert.equal(intent.ourTotalPaise, intent.claimedTotalPaise);
      // a total tampered with on the way in is flagged
      const m = out.body.message as any;
      const tampered = readRequest({ context: { action: "confirm" }, message: { order: { ...m.order, quote: { ...m.order.quote, price: { currency: "INR", value: "1" } } } } }, cat);
      assert.ok(tampered.flags.some((f) => f.kind === "total_mismatch"));
    }
  }
});
