// Outbound, retail B2C (ONDC retail 1.2.x, the Beckn dialect with `bpp/providers`, `start` and `end`, one `payment` and `@ondc/org/*` extensions): our catalogue as
// `on_search`, and our order as `on_select`, `on_init`, `on_confirm`, `on_status` and `on_cancel`. Pure: it reads neutral input (types.ts) and writes JSON.
//
// What it will not do: invent. A field the shop's record cannot supply (a GSTIN, a picture, a return window, a pincode) is left out and named in `gaps` (gaps.ts); a buyer's
// own details come from the caller's request (common.ts), not our store. Money goes through money.ts only. The quote is built from the order's lines, and its total is checked
// against the total the record holds: a difference is a flag, never smoothed over.
//
// How the odd parts map (and what does not): a slot is the fulfillment's time range, at the shop's `start` for a pickup (the buyer collects) and at the buyer's `end` for a
// delivery. Pickup is ONDC's "Self-Pickup". ONDC's retail order carries ONE payment, so an advance with a balance due later is NOT-PAID as a whole with type ON-FULFILLMENT, and the
// split is written in a payment tag of ours (`advance_split`) that no buyer app is known to read: it is the one place this file goes beyond the contract, and it is marked so.
// Whether the owner marked a payment or a gateway confirmed it has no ONDC field and stays in the neutral input.
import { rupees, price } from "./money.ts";
import { CANCEL_CODES, partStatus, statusOf, wholeStatus } from "./states.ts";
import { clean, factsOf, finish, hhmm, iso, retailContext, rTag } from "./common.ts";
import type { Caller, Flag, Out } from "./common.ts";
import { collector } from "./gaps.ts";
import type { Gaps } from "./gaps.ts";
import { localParts } from "../core/time.ts";
import type { Catalogue, CatalogueItem, OrderIn, Party, Slot } from "./types.ts";

const LOCATION = (p: Party) => `${p.id}-L1`;
const FULFILMENT: Record<Slot["mode"], { id: string; type: "Delivery" | "Self-Pickup" }> = { delivery: { id: "F-delivery", type: "Delivery" }, pickup: { id: "F-pickup", type: "Self-Pickup" } };

/** The shop's one location, with its opening window from the slots it serves. */
function location(g: Gaps, seller: Party, slots: readonly Slot[], nowMs: number) {
  const f = factsOf(seller);
  const a = f.address;
  const whole = a?.locality && a.city && a.state && a.areaCode ? a : undefined;
  g.need("shop_address_parts", whole);
  const gps = g.need("shop_gps", f.gps);
  g.need("city_code", f.cityCode);
  const from = slots.map((s) => s.from).sort()[0];
  const to = slots.map((s) => s.to).sort().reverse()[0];
  return clean({
    id: LOCATION(seller), gps,
    address: whole ? { locality: whole.locality, city: whole.city, state: whole.state, area_code: whole.areaCode, ...(whole.building ? { building: whole.building } : {}) } : undefined,
    time: { label: "enable", timestamp: iso(nowMs), days: "1,2,3,4,5,6,7", schedule: { holidays: [] }, range: from && to ? { start: hhmm(from), end: hhmm(to) } : undefined },
    circle: gps && f.serviceRadiusKm !== undefined ? { gps, radius: { unit: "km", value: String(f.serviceRadiusKm) } } : undefined,
  });
}

function item(g: Gaps, cat: Catalogue, it: CatalogueItem, fulfillmentId: string) {
  const f = factsOf(cat.seller);
  const own = f.items?.[it.id];
  const domain = g.need("retail_domain", f.domain);
  const category = g.need("retail_category", own?.category ?? (domain === "ONDC:RET11" ? "F&B" : undefined));
  const description = g.need("item_description", own?.description);
  const image = g.need("item_images", own?.imageUrl);
  const rp = g.need("return_policy", f.returnPolicy);
  const care = g.need("shop_phone", f.phone ? [f.phone, f.email].filter(Boolean).join(", ") : undefined);
  const rating = g.need("shop_rating", f.rating);
  const shipTime = g.need("prep_time", f.timeToShip);
  if (domain === "ONDC:RET11") g.need("veg_nonveg", own?.vegetarian);
  else if (domain === undefined) g.need("veg_nonveg", undefined);
  return {
    id: it.id,
    time: { label: "enable", timestamp: iso(cat.nowMs) },
    descriptor: { name: it.name, symbol: image, short_desc: description, long_desc: description, images: image ? [image] : undefined },
    quantity: {
      unitized: { measure: { unit: "unit", value: "1" }, count: 1 }, // ONDC's counts are strings in its catalogue examples
      available: { count: String(it.available) },
      // a maximum below 1 is not valid, so a sold-out item still says 1 while its available count says 0
      maximum: { count: String(Math.max(1, Math.min(it.maxPerOrder, it.available))) },
      minimum: { count: "1" },
    },
    price: { currency: "INR", value: rupees(it.pricePaise), maximum_value: rupees(it.pricePaise) },
    category_id: category,
    location_id: LOCATION(cat.seller),
    fulfillment_id: fulfillmentId,
    "@ondc/org/returnable": rp?.returnable,
    "@ondc/org/seller_pickup_return": rp?.sellerPicksUp,
    "@ondc/org/return_window": rp?.window,
    replacement_terms: rp ? [{ replace_within: { duration: rp.window } }] : undefined,
    "@ondc/org/cancellable": true, // the shop's cancellation rule (settings) applies to every item
    "@ondc/org/available_on_cod": false, // the advance is paid first; no order is paid wholly on delivery
    "@ondc/org/time_to_ship": shipTime,
    "@ondc/org/contact_details_consumer_care": care,
    rating,
    tags: domain === "ONDC:RET11" && own?.vegetarian !== undefined ? [rTag("veg_nonveg", { [own.vegetarian ? "veg" : "non_veg"]: "yes" })] : undefined,
  };
}

/** `on_search`: the shop's catalogue as one provider with its items, its fulfillment types and its one location. */
export function onSearch(cat: Catalogue, c: Caller): Out {
  const g = collector();
  const s = cat.seller;
  const f = factsOf(s);
  const domain = g.need("retail_domain", f.domain);
  const modes = (["delivery", "pickup"] as const).filter((m) => cat.slots.some((x) => x.mode === m));
  const fulfillments = modes.map((m) => ({ ...FULFILMENT[m] }));
  const image = g.need("shop_images", f.logoUrl);
  const desc = g.need("shop_description", f.description);
  g.need("shop_rating", f.rating);
  if (domain !== "ONDC:RET10") g.need("fssai", f.fssai);
  g.need("menu_categories", f.categories);
  if (modes.includes("delivery")) g.need("serviceability_radius", f.serviceRadiusKm);
  g.need("tax_breakup", undefined); // our prices are tax-inclusive and keep no rate
  const first = fulfillments[0]?.id ?? "";
  const loc = location(g, s, cat.slots, cat.nowMs);
  const from = cat.slots.map((x) => x.from).sort()[0];
  const to = cat.slots.map((x) => x.to).sort().reverse()[0];
  const message = {
    catalog: {
      "bpp/fulfillments": fulfillments,
      "bpp/descriptor": { name: s.name, symbol: image, short_desc: desc, long_desc: desc, images: image ? [image] : undefined },
      "bpp/providers": [{
        id: s.id,
        descriptor: { name: s.name, symbol: image, short_desc: desc, long_desc: desc, images: image ? [image] : undefined },
        "@ondc/org/fssai_license_no": domain !== "ONDC:RET10" ? f.fssai : undefined,
        ttl: "P1D", // stock is counted per day, so a catalogue is good for a day
        time: { label: "enable", timestamp: iso(cat.nowMs) },
        rating: f.rating,
        fulfillments,
        locations: [loc],
        categories: f.categories?.map((x) => ({ id: x.id, descriptor: { name: x.name, short_desc: x.description, long_desc: x.description } })),
        items: cat.items.map((it) => item(g, cat, it, first)),
        tags: [
          from && to ? rTag("timing", { type: "All", location: LOCATION(s), day_from: "1", day_to: "7", time_from: hhmm(from), time_to: hhmm(to) }) : undefined,
          modes.includes("delivery") && f.serviceRadiusKm !== undefined ? rTag("serviceability", { location: LOCATION(s), category: domain === "ONDC:RET11" ? "F&B" : undefined, type: "10", unit: "km", val: String(f.serviceRadiusKm) }) : undefined,
        ],
      }],
    },
  };
  return finish("on_search", retailContext("on_search", c, domain), message, g, []);
}

import type { RetailStage } from "./contract.ts";
export type { RetailStage };

/** Same day or the next, in the shop's own time zone: the two delivery categories ONDC's enum has for a slotted delivery. */
function deliveryCategory(timezone: string, slotMs: number, nowMs: number): string {
  const a = localParts(slotMs, timezone);
  const b = localParts(nowMs, timezone);
  return a.year === b.year && a.month === b.month && a.day === b.day ? "Same Day Delivery" : "Next Day Delivery";
}

/** The quote: one `item` line per order line, from our own unit prices. Returns the lines and their sum so the caller can compare it with the record. */
export function quoteOf(o: Pick<OrderIn, "lines" | "holdIso">) {
  const breakup = o.lines.map((l) => ({
    "@ondc/org/item_id": l.itemId,
    "@ondc/org/item_quantity": { count: l.qty },
    title: l.name,
    "@ondc/org/title_type": "item",
    price: price(l.unitPaise * l.qty),
    item: { price: price(l.unitPaise) },
  }));
  const sum = o.lines.reduce((n, l) => n + l.unitPaise * l.qty, 0);
  return { quote: { price: price(sum), breakup, ttl: o.holdIso }, sum };
}

/** The order as one retail message. Returns null when the order's state has no ONDC order yet (an enquiry, one waiting for the owner): there is nothing to say on the network. */
export function orderMessage(o: OrderIn, stage: RetailStage, c: Caller): Out | null {
  const status = statusOf("orders", o.state, o.mode);
  if (status.stage === "none") return null;
  const g = collector();
  const s = o.seller;
  const f = factsOf(s);
  const flags: Flag[] = [];
  const domain = g.need("retail_domain", f.domain);
  const { quote, sum } = quoteOf(o);
  g.need("tax_breakup", undefined);
  if (sum !== o.totalPaise) flags.push({ kind: "record_total_mismatch", detail: `the lines add up to ${rupees(sum)} but the record says ${rupees(o.totalPaise)}` });
  const mode = o.mode ?? "pickup";
  const fid = FULFILMENT[mode].id;
  const withBuyer = stage !== "on_select";
  const b = withBuyer ? c.buyer : undefined;
  const a = b?.address;
  const slot = stage === "on_select" || stage === "on_init" ? undefined : o.slot && { range: { start: iso(o.slot.fromMs), end: iso(o.slot.toMs) } };
  const startAddress = (() => { const w = f.address?.locality && f.address.city && f.address.state && f.address.areaCode ? f.address : undefined; g.need("shop_address_parts", w); return w && { locality: w.locality, city: w.city, state: w.state, area_code: w.areaCode }; })();
  const shopGps = g.need("shop_gps", f.gps);
  const care = g.need("shop_phone", f.phone);
  const fulfillment = {
    id: fid,
    type: FULFILMENT[mode].type,
    "@ondc/org/provider_name": s.name,
    provider_id: stage === "on_select" || stage === "on_init" ? undefined : s.id,
    tracking: false,
    "@ondc/org/category": mode === "pickup" ? "Takeaway" : o.slot ? deliveryCategory(s.timezone, o.slot.fromMs, o.nowMs) : undefined,
    "@ondc/org/TAT": g.need("tat", f.tat),
    state: { descriptor: { code: status.fulfillment } },
    start: stage === "on_select" || stage === "on_init" ? undefined : {
      location: { id: LOCATION(s), descriptor: { name: s.name }, gps: shopGps, address: startAddress },
      contact: { phone: care, email: f.email },
      time: mode === "pickup" ? slot : undefined,
    },
    end: !withBuyer ? undefined : {
      person: b && { name: b.name },
      contact: b && { phone: b.phone, email: b.email },
      location: mode === "delivery" && b && a ? { gps: b.gps, address: { name: a.name, building: a.building, locality: a.locality, city: a.city, state: a.state, country: a.country, area_code: a.areaCode } } : undefined,
      time: mode === "delivery" ? slot : undefined,
    },
  };
  // the payment: one object. Paid only when every part is paid; a balance still due makes it pay-on-fulfilment.
  const parts = o.payments;
  const advanceOnly = parts.every((p) => p.kind === "advance");
  const first = parts[0];
  const pay = c.pay;
  const bank = f.bank;
  if (withBuyer) { g.need("finder_fee", f.finderFee); g.need("settlement_account", bank); }
  const payment = !withBuyer ? undefined : {
    uri: first?.uri ?? pay?.uri,
    tl_method: first?.method ?? pay?.method,
    params: { amount: rupees(o.totalPaise), currency: "INR", transaction_id: first?.reference ?? pay?.reference ?? o.ref },
    status: wholeStatus(parts),
    type: advanceOnly ? "ON-ORDER" : "ON-FULFILLMENT",
    collected_by: "BPP", // the shop's own account collects; a gateway or the owner's UPI is the shop's
    "@ondc/org/buyer_app_finder_fee_type": f.finderFee?.type,
    "@ondc/org/buyer_app_finder_fee_amount": f.finderFee?.value,
    "@ondc/org/settlement_details": bank ? [{ settlement_counterparty: "buyer-app", settlement_phase: "sale-amount", settlement_type: "neft", settlement_bank_account_no: bank.accountNo, settlement_ifsc_code: bank.ifsc, beneficiary_name: bank.beneficiary, bank_name: bank.bankName, branch_name: bank.branchName }] : undefined,
    // ours, not ONDC's: the advance and balance a one-payment order cannot say (see the file's head)
    tags: parts.length > 1 ? [rTag("advance_split", Object.fromEntries(parts.flatMap((p) => [[`${p.kind}_amount`, rupees(p.amountPaise)], [`${p.kind}_status`, partStatus(p)]])))] : undefined,
  };
  if (stage !== "on_select" && stage !== "on_init") { g.need("record_times", o.createdMs); }
  const cancel = stage === "on_cancel" ? (o.cancel ?? (status.cancelled ? { reason: status.cancelled, by: "seller" as const } : undefined)) : undefined;
  const gst = g.need("gstin", f.gstin);
  const pan = g.need("pan", f.pan);
  const order = {
    id: stage === "on_select" || stage === "on_init" ? undefined : (o.networkId ?? o.ref),
    state: stage === "on_select" || stage === "on_init" ? undefined : stage === "on_cancel" ? "Cancelled" : status.order,
    provider: { id: s.id, locations: [{ id: LOCATION(s) }] },
    items: o.lines.map((l) => ({ id: l.itemId, quantity: { count: l.qty }, fulfillment_id: fid })),
    billing: !b || !a ? undefined : { name: b.name, address: { name: a.name, building: a.building, locality: a.locality, city: a.city, state: a.state, country: a.country, area_code: a.areaCode }, phone: b.phone, email: b.email, created_at: b.at, updated_at: b.at },
    fulfillments: [fulfillment],
    quote,
    payment,
    cancellation: cancel ? { cancelled_by: cancel.by === "buyer" ? c.bapId : c.bppId, reason: { id: CANCEL_CODES[cancel.reason].code } } : undefined,
    tags: gst || pan ? [rTag("bpp_terms", { tax_number: gst, provider_tax_number: pan })] : undefined,
    created_at: o.createdMs === undefined || stage === "on_select" || stage === "on_init" ? undefined : iso(o.createdMs),
    updated_at: stage === "on_select" || stage === "on_init" ? undefined : iso(o.nowMs), // the moment of this message: no record keeps its own last-change time
  };
  return finish(stage, retailContext(stage, c, domain), { order }, g, flags);
}
