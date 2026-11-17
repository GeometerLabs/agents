// The ONDC mapping on neutral fixtures: money exact, states total, gaps typed, every outbound message holding its contract's required fields (or reporting why not), quotes that add
// up, enums that are ONDC's, and inbound requests read as claims with mismatches flagged. The real example shops go through the same checks in each template's test/ondc.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { b2b, retail, services } from "../index.ts";
import { rupees, paiseOf } from "../money.ts";
import { BOOKINGS_STATES, CANCEL_CODES, ORDERS_STATES, STOCK_ORDERS_STATES, purchaseStatus, reasonOfCode, statesOf, statusOf } from "../states.ts";
import { GAPS } from "../gaps.ts";
import { b2bRequest, retailOnSearch, retailOrder, servicesOnSearch, servicesOrder } from "../contract.ts";
import { audit, SAMPLE_CALLER } from "../verify.ts";
import { readRequest } from "../inbound.ts";
import { FILLED, LUNCH, SUPPLIER_IDS, booking, catalogue, order, purchase } from "./fixtures.ts";

const keys = (o: { gaps: { missing: string }[] }) => o.gaps.map((g) => g.missing);
const clean = (a: ReturnType<typeof audit>) => ({ missing: a.missing, money: a.money, sums: a.sums, enums: a.enums });
const ok = { missing: [], money: [], sums: true, enums: [] };

test("money: paise to ONDC's string and back is exact, with no float anywhere", () => {
  for (const [p, s] of [[0, "0"], [22900, "229"], [17550, "175.50"], [325765, "3257.65"], [5, "0.05"], [-1005, "-10.05"], [-100000, "-1000"]] as const) { assert.equal(rupees(p), s); assert.equal(paiseOf(s), p); }
  for (let p = -3000; p <= 30000; p += 7) assert.equal(paiseOf(rupees(p)), p);
  assert.equal(paiseOf("229.0"), 22900);
  for (const bad of ["1.234", "", ".5", "1e3", "12,5", "abc", "--1", " ", undefined, 5]) assert.equal(paiseOf(bad), undefined, String(bad));
  assert.throws(() => rupees(1.5));
});

test("state mapping is total, and a name it does not know is refused, not guessed", () => {
  assert.deepEqual([...statesOf("orders")], [...ORDERS_STATES]);
  assert.deepEqual([...statesOf("bookings")], [...BOOKINGS_STATES]);
  assert.deepEqual([...statesOf("stock-orders")], [...STOCK_ORDERS_STATES]);
  for (const t of ["orders", "bookings", "stock-orders"] as const) for (const s of statesOf(t)) assert.ok(statusOf(t, s).stage, `${t} ${s}`);
  assert.throws(() => statusOf("orders", "teleported"), /no ONDC mapping/u);
  assert.equal(statusOf("orders", "enquiry").stage, "none");
  assert.equal(statusOf("orders", "awaiting_advance").order, "Created");
  assert.equal(statusOf("orders", "confirmed").order, "Accepted");
  assert.equal(statusOf("orders", "completed", "delivery").fulfillment, "Order-delivered");
  assert.equal(statusOf("orders", "completed", "pickup").fulfillment, "Order-picked-up");
  assert.equal(statusOf("orders", "expired").cancelled, "advance_expired");
  assert.equal(statusOf("bookings", "needs_owner").order, "Created");
});

test("a purchase order's three questions fold into one ONDC state", () => {
  assert.equal(purchaseStatus({ state: "awaiting_approval", ack: "none", receipt: "none" }).stage, "none");
  assert.equal(purchaseStatus({ state: "sent", ack: "none", receipt: "none" }).order, "Created");
  assert.equal(purchaseStatus({ state: "sent", ack: "accepted", receipt: "none" }).order, "Accepted");
  assert.equal(purchaseStatus({ state: "sent", ack: "accepted", receipt: "part" }).order, "In-progress");
  assert.equal(purchaseStatus({ state: "sent", ack: "accepted", receipt: "full" }).order, "Completed");
  assert.equal(purchaseStatus({ state: "sent", ack: "declined", receipt: "none" }).order, "Cancelled");
  assert.equal(purchaseStatus({ state: "supplier_declined", ack: "declined", receipt: "none" }).order, "Cancelled");
});

test("every cancel reason has an ONDC code that ONDC's list has, and the code reads back", () => {
  const ondcList = ["001", "002", "003", "005", "006", "007", "008", "009", "010", "011", "012", "013", "014", "015", "016", "017", "018", "019", "020", "021", "022", "023", "999"];
  for (const [reason, { code }] of Object.entries(CANCEL_CODES)) { assert.ok(ondcList.includes(code), reason); assert.equal(reasonOfCode(code), reason); }
  assert.equal(reasonOfCode("999"), undefined);
});

test("the gaps table names the setting each gap needs", () => {
  for (const [k, g] of Object.entries(GAPS)) { assert.ok(g.setting.length > 3 && g.fields.length > 0 && g.what.length > 10, k); assert.ok(["required", "expected"].includes(g.severity)); }
});

test("retail on_search of a shop that holds no ONDC facts: its required fields are present or their gap is reported, and the gaps are exactly these", () => {
  const out = retail.onSearch(catalogue(), SAMPLE_CALLER);
  assert.deepEqual(clean(audit(out, retailOnSearch(undefined), true)), { ...ok, sums: null });
  assert.deepEqual(keys(out), ["fssai", "item_description", "item_images", "menu_categories", "prep_time", "retail_category", "retail_domain", "return_policy", "serviceability_radius", "shop_address_parts", "shop_description", "shop_gps", "shop_images", "shop_phone", "shop_rating", "tax_breakup", "veg_nonveg"].sort());
  const item = ((out.message.catalog as any)["bpp/providers"][0].items as any[])[0];
  assert.deepEqual(item.price, { currency: "INR", value: "120", maximum_value: "120" });
  assert.deepEqual(item.quantity.available, { count: "12" });
  assert.equal(((out.message.catalog as any)["bpp/providers"][0].items as any[])[1].price.value, "20.50");
  assert.equal(((out.message.catalog as any)["bpp/providers"][0].items as any[])[1].quantity.maximum.count, "1"); // sold out: a maximum below 1 is not valid
  assert.deepEqual(out.body.context.action, "on_search");
  assert.ok(!("domain" in out.body.context)); // never guessed
});

test("with the ONDC facts filled in, the gaps close and the values flow into the message", () => {
  const out = retail.onSearch(catalogue(FILLED), SAMPLE_CALLER);
  assert.deepEqual(clean(audit(out, retailOnSearch("ONDC:RET11"), true)), { ...ok, sums: null });
  assert.deepEqual(keys(out), ["tax_breakup"]);
  const p = (out.message.catalog as any)["bpp/providers"][0];
  assert.equal(p["@ondc/org/fssai_license_no"], "11111111111111");
  assert.equal(p.items[0].category_id, "F&B");
  assert.equal(p.locations[0].gps, "10.0158,76.3419");
  assert.equal(out.body.context.domain, "ONDC:RET11");
  const c = order("confirmed", {}, FILLED);
  for (const stage of ["on_select", "on_init", "on_confirm", "on_status", "on_cancel"] as const) {
    const o = retail.orderMessage(stage === "on_cancel" ? order("cancelled", { cancel: { reason: "customer_cancelled", by: "buyer" } }, FILLED) : c, stage, SAMPLE_CALLER)!;
    assert.deepEqual(clean(audit(o, retailOrder(stage, "pickup", true), true)), ok, stage);
    assert.deepEqual(keys(o), ["tax_breakup"], stage);
  }
});

test("retail order messages, every stage, pickup and delivery: required fields, exact money, a quote that adds up, ONDC's enums", () => {
  for (const mode of ["pickup", "delivery"] as const) for (const stage of ["on_select", "on_init", "on_confirm", "on_status"] as const) {
    const o = retail.orderMessage(order("confirmed", { mode }), stage, SAMPLE_CALLER)!;
    assert.deepEqual(clean(audit(o, retailOrder(stage, mode, true), true)), ok, `${mode} ${stage}`);
    assert.equal((o.message.order as any).quote.price.value, "260.50");
    assert.equal(o.flags.length, 0);
  }
  const confirm = retail.orderMessage(order("confirmed", { mode: "delivery" }), "on_confirm", SAMPLE_CALLER)!.message.order as any;
  assert.equal(confirm.state, "Accepted");
  assert.equal(confirm.fulfillments[0].type, "Delivery");
  assert.equal(confirm.fulfillments[0]["@ondc/org/category"], "Next Day Delivery"); // the slot is the next day
  assert.deepEqual(confirm.fulfillments[0].end.time.range, { start: "2026-11-18T06:30:00.000Z", end: "2026-11-18T07:30:00.000Z" });
  assert.equal(confirm.payment.status, "NOT-PAID"); // the advance is paid, the balance is not: not paid as a whole
  assert.equal(confirm.payment.type, "ON-FULFILLMENT");
  assert.equal(confirm.payment.collected_by, "BPP");
  assert.equal(confirm.payment.tags[0].list.find((t: any) => t.code === "advance_status").value, "PAID");
  const pick = retail.orderMessage(order("confirmed", { mode: "pickup" }), "on_confirm", SAMPLE_CALLER)!.message.order as any;
  assert.equal(pick.fulfillments[0].type, "Self-Pickup");
  assert.deepEqual(pick.fulfillments[0].start.time.range, { start: "2026-11-18T06:30:00.000Z", end: "2026-11-18T07:30:00.000Z" });
  const full = retail.orderMessage(order("confirmed", { payments: [{ kind: "advance", amountPaise: 26050, paid: true, by: "provider" }] }), "on_confirm", SAMPLE_CALLER)!.message.order as any;
  assert.deepEqual([full.payment.status, full.payment.type, full.payment.tags], ["PAID", "ON-ORDER", undefined]);
});

test("an order that is not yet an ONDC order says nothing; a cancelled one carries ONDC's reason code, or says the record keeps none", () => {
  for (const s of ["enquiry", "awaiting_owner"]) assert.equal(retail.orderMessage(order(s), "on_confirm", SAMPLE_CALLER), null);
  const reasons = { customer_cancelled: "012", owner_declined: "005", advance_expired: "022", item_unavailable: "002", area_not_served: "018", customer_unreachable: "011" } as const;
  for (const [reason, code] of Object.entries(reasons)) {
    const o = retail.orderMessage(order("cancelled", { cancel: { reason: reason as keyof typeof reasons, by: "seller" } }), "on_cancel", SAMPLE_CALLER)!.message.order as any;
    assert.equal(o.state, "Cancelled"); assert.equal(o.cancellation.reason.id, code); assert.equal(o.cancellation.cancelled_by, "seller.example");
  }
  const expired = retail.orderMessage(order("expired"), "on_cancel", SAMPLE_CALLER)!;
  assert.equal((expired.message.order as any).cancellation.reason.id, "022"); // its own state carries its own reason
  const unknown = retail.orderMessage(order("cancelled"), "on_cancel", SAMPLE_CALLER)!;
  assert.ok(keys(unknown).includes("cancel_reason")); // never invented
  assert.equal((unknown.message.order as any).cancellation, undefined);
});

test("a record whose total disagrees with its lines is flagged, not smoothed over", () => {
  const o = retail.orderMessage(order("confirmed", { totalPaise: 26000 }), "on_confirm", SAMPLE_CALLER)!;
  assert.equal(o.flags[0]?.kind, "record_total_mismatch");
  assert.equal((o.message.order as any).quote.price.value, "260.50"); // the quote is the lines' sum, and the flag says the record differs
});

test("the buyer's details come from the caller only: without them nothing of a customer is in the message", () => {
  const { buyer: _b, pay: _p, ...bare } = SAMPLE_CALLER;
  const o = retail.orderMessage(order("confirmed"), "on_confirm", bare)!;
  const text = JSON.stringify(o.body);
  assert.ok(!text.includes("9000000000") && !text.includes("Test Buyer"));
  assert.equal((o.message.order as any).billing, undefined);
  assert.deepEqual(audit(o, retailOrder("on_confirm", "pickup", true), true, false).missing, []);
});

test("services: a booking's scheduled fulfillment, deposit and balance as payments[], a refund as a negative line, status in capitals", () => {
  const cat = services.onSearch({ ...catalogue(), items: [{ id: "haircut", name: "Haircut", pricePaise: 45000, kind: "service", available: 2, maxPerOrder: 1, durationMinutes: 45 }], slots: [], hours: { "1": ["10:00", "20:00"], "7": null }, slotMinutes: 30 }, SAMPLE_CALLER);
  assert.deepEqual(clean(audit(cat, servicesOnSearch, false)), { ...ok, sums: null });
  assert.ok(keys(cat).includes("service_domain") && keys(cat).includes("service_creds"));
  for (const stage of ["on_select", "on_init", "on_confirm", "on_status"] as const) {
    const o = services.bookingMessage(booking("confirmed"), stage, SAMPLE_CALLER)!;
    assert.deepEqual(clean(audit(o, servicesOrder(stage), false)), ok, stage);
  }
  const o = services.bookingMessage(booking("confirmed"), "on_confirm", SAMPLE_CALLER)!.message.order as any;
  assert.equal(o.status, "ACCEPTED");
  assert.deepEqual(o.fulfillments[0].stops[0].time.range, { start: "2026-11-18T05:00:00.000Z", end: "2026-11-18T05:45:00.000Z" });
  assert.deepEqual(o.payments.map((p: any) => [p.type, p.status, p.params.amount]), [["PRE-FULFILLMENT", "PAID", "200"], ["ON-FULFILLMENT", "NOT-PAID", "250"]]);
  assert.equal(o.cancellation_terms[0].cancel_by.duration, "PT24H");
  const pending = services.bookingMessage(booking("awaiting_deposit"), "on_confirm", SAMPLE_CALLER)!.message.order as any;
  assert.deepEqual([pending.status, pending.payments[0].status], ["CREATED", "NOT-PAID"]);
  const cancelled = services.bookingMessage(booking("cancelled", { cancel: { reason: "customer_cancelled", by: "buyer", refundPaise: 20000 } }), "on_cancel", SAMPLE_CALLER)!;
  const c = cancelled.message.order as any;
  assert.deepEqual([c.status, c.cancellation.reason.descriptor.code, c.cancellation.cancelled_by], ["CANCELLED", "012", "CONSUMER"]);
  assert.equal(c.quote.breakup[1].price.value, "-200");
  assert.equal(c.quote.price.value, "250");
  assert.equal(cancelled.flags.length, 0);
  assert.equal(services.bookingMessage(booking("enquiry"), "on_confirm", SAMPLE_CALLER), null);
});

test("B2B buyer side: select, init and confirm; supplier ids and our GSTIN are gaps; the supplier's number never appears", () => {
  for (const stage of ["select", "init", "confirm"] as const) {
    const o = b2b.purchaseRequest(purchase("sent"), stage, SAMPLE_CALLER)!;
    assert.deepEqual(clean(audit(o, b2bRequest(stage), false)), { ...ok, sums: stage === "confirm" ? true : null }, stage);
    assert.ok(keys(o).includes("supplier_ondc_ids"));
    assert.ok(!JSON.stringify(o.body).includes("whatsapp"));
  }
  assert.equal(b2b.purchaseRequest(purchase("awaiting_approval"), "confirm", SAMPLE_CALLER), null);
  assert.ok(b2b.purchaseRequest(purchase("awaiting_approval"), "select", SAMPLE_CALLER)); // a preview of what would be asked
  const full = b2b.purchaseRequest(purchase("sent", { paidOutside: true, supplier: { id: "ravi", name: "Ravi Traders", ondc: SUPPLIER_IDS } }, FILLED), "confirm", SAMPLE_CALLER)!;
  assert.deepEqual(keys(full), ["settlement_account"].sort()); // the one thing a buyer never needs, left as a note
  const order = full.message.order as any;
  assert.deepEqual([order.payments[0].status, order.payments[0].params.amount, order.quote.price.value, order.items[0].quantity.selected.count, order.billing.tax_id], ["PAID", "4500", "4500", 10, "32AAAAA0000A1Z5"]);
  assert.equal(b2b.purchaseRequest(purchase("sent", { totalPaise: 1 }), "confirm", SAMPLE_CALLER)!.flags[0].kind, "record_total_mismatch");
});

test("inbound: our on_confirm, read back as a confirm request, gives the same lines and slot; the contact stays a reference", () => {
  const cat = catalogue(FILLED);
  const out = retail.orderMessage(order("confirmed", {}, FILLED), "on_confirm", SAMPLE_CALLER)!;
  const request = { context: { ...out.body.context, action: "confirm" }, message: out.body.message };
  const intent = readRequest(request, cat);
  assert.deepEqual(intent.lines, [{ itemId: "thali", qty: 2 }, { itemId: "curd", qty: 1 }]);
  assert.deepEqual([intent.mode, intent.slot?.slotId, intent.slot?.date, intent.slot?.fromMs, intent.slot?.toMs], ["pickup", "lunch", "2026-11-18", LUNCH.fromMs, LUNCH.toMs]);
  assert.deepEqual(intent.flags, []);
  assert.equal(intent.ourTotalPaise, 26050);
  assert.equal(intent.claimedTotalPaise, 26050);
  assert.equal(intent.networkOrderId, "o-7");
  assert.equal(intent.contact?.phone, "9000000000");
  assert.match(intent.contactRef ?? "", /^[0-9a-f]{16}$/u);
  assert.ok(!JSON.stringify(intent.contactRef).includes("9000000000"));
  const delivery = readRequest({ context: { action: "confirm" }, message: { order: { ...(out.message.order as object), fulfillments: [{ type: "Delivery", end: { time: { range: { start: "2026-11-18T07:00:00.000Z", end: "2026-11-18T08:00:00.000Z" } } } }] } } }, cat);
  assert.deepEqual([delivery.mode, delivery.slot?.slotId], ["delivery", "lunch-home"]); // 12:30 to 13:30 IST
});

test("inbound: a total the message claims is never trusted; a mismatch, a wrong price, an unknown item, a bad quantity and a slot we do not offer are all flagged", () => {
  const cat = catalogue();
  const base = (over: Record<string, unknown>) => ({ context: { action: "confirm" }, message: { order: { provider: { id: "shop-1" }, items: [{ id: "thali", quantity: { count: 2 } }], quote: { price: { currency: "INR", value: "100" }, breakup: [{ "@ondc/org/item_id": "thali", "@ondc/org/title_type": "item", price: { value: "200" }, item: { price: { value: "100" } } }] }, ...over } } });
  const i = readRequest(base({}), cat);
  assert.equal(i.ourTotalPaise, 24000);
  assert.deepEqual(i.flags.map((f) => f.kind).sort(), ["line_price_mismatch", "total_mismatch"]);
  assert.deepEqual(i.flags.find((f) => f.kind === "total_mismatch"), { kind: "total_mismatch", claimedPaise: 10000, ourPaise: 24000 });
  assert.deepEqual(readRequest(base({ items: [{ id: "ghost", quantity: { count: 1 } }, { id: "curd", quantity: { count: 0 } }, { id: "curd", quantity: { count: 99 } }] }), cat).flags.map((f) => f.kind).filter((k) => k !== "total_mismatch"), ["unknown_item", "bad_quantity", "bad_quantity"]);
  assert.ok(readRequest(base({ provider: { id: "someone-else" } }), cat).flags.some((f) => f.kind === "wrong_provider"));
  assert.ok(readRequest(base({ fulfillments: [{ type: "Self-Pickup", start: { time: { range: { start: "2026-11-18T01:00:00.000Z", end: "2026-11-18T02:00:00.000Z" } } } }] }), cat).flags.some((f) => f.kind === "slot_not_offered"));
  assert.ok(readRequest(base({ quote: { price: { currency: "USD", value: "1.234" } } }), cat).flags.some((f) => f.kind === "bad_amount"));
  assert.equal(readRequest({ context: { action: "update" }, message: {} }, cat).action, "unknown");
  assert.equal(readRequest("nonsense", cat).flags[0].kind, "not_a_request");
});

test("inbound cancel: ONDC's code becomes our reason, an unknown code is flagged", () => {
  const cat = catalogue();
  const c = readRequest({ context: { action: "cancel" }, message: { order_id: "o-7", cancellation_reason_id: "012" } }, cat);
  assert.deepEqual([c.action, c.networkOrderId, c.cancel?.reason], ["cancel", "o-7", "customer_cancelled"]);
  assert.equal(readRequest({ context: { action: "cancel" }, message: { order_id: "o-7", cancellation_reason_id: "777" } }, cat).flags[0].kind, "unknown_cancel_code");
});
