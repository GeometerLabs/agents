// Outbound, retail B2B, the BUYER's side (ONDC retail 2.0.x): a Stock orders purchase order as the `select`, `init` and `confirm` requests the shop would send a supplier.
// Pure. Here the shop is the buyer app's principal and the supplier the seller, so the messages are REQUESTS, not catalogue or order responses.
//
// The honest limits: a supplier of ours is a name and a WhatsApp number, not a seller on the network, so the supplier's provider, location, item and fulfillment ids (which a
// select must carry, from the supplier's own catalogue) are a gap (`supplier_ondc_ids`) unless the neutral input has them. The shop's own GSTIN is a gap too: a B2B order's
// billing needs it. We never pay anyone through this (the owner pays outside), so the payment is "ON-FULFILLMENT" collected by the supplier, with status PAID only after the owner
// said they paid. The supplier's WhatsApp number never appears in any message. Quote and terms in `confirm` are what the supplier's `on_init` said (handed in by the caller);
// we only add our own expectation of the quote (price x quantity) so the adapter can compare.
import { rupees, price } from "./money.ts";
import { purchaseStatus } from "./states.ts";
import { clean, factsOf, finish, iso, newContext, sTag } from "./common.ts";
import type { Caller, Flag, Out } from "./common.ts";
import { collector } from "./gaps.ts";
import type { PurchaseIn } from "./types.ts";

export type B2BStage = "select" | "init" | "confirm";

/** A purchase order as one request. Null for `confirm` when the order has not (or never will have) gone to the supplier; select and init are previews and are always built. */
export function purchaseRequest(po: PurchaseIn, stage: B2BStage, c: Caller): Out | null {
  const status = purchaseStatus(po);
  if (stage === "confirm" && status.stage === "none") return null;
  const g = collector();
  const f = factsOf(po.buyer);
  const flags: Flag[] = [];
  const domain = g.need("retail_domain", f.domain);
  g.need("city_code", f.cityCode);
  const ids = g.need("supplier_ondc_ids", po.supplier.ondc);
  if (po.unitPaise * po.qty !== po.totalPaise) flags.push({ kind: "record_total_mismatch", detail: `${po.qty} x ${rupees(po.unitPaise)} is ${rupees(po.unitPaise * po.qty)} but the record says ${rupees(po.totalPaise)}` });
  const a = f.address;
  const parts = a?.city && a.state && a.areaCode ? a : undefined;
  g.need("shop_address_parts", parts);
  const gps = g.need("shop_gps", f.gps);
  const phone = stage === "select" ? undefined : g.need("shop_phone", f.phone);
  const gst = stage === "select" ? undefined : g.need("gstin", f.gstin);
  const fulfillment = {
    id: ids?.fulfillmentId, type: "Delivery",
    stops: [{ type: "end", location: { gps, address: po.buyer.address, city: { name: parts?.city }, country: { code: "IND" }, area_code: parts?.areaCode, state: { name: parts?.state } }, contact: { phone } }],
  };
  if (stage === "confirm") g.need("record_times", po.createdMs);
  const paid = po.paidOutside;
  const order = {
    id: stage === "confirm" ? po.ref : undefined,
    state: stage === "confirm" ? "Created" : undefined, // the buyer's request creates the order; the supplier's answers move it (states.ts purchaseStatus)
    provider: { id: ids?.providerId, locations: [{ id: ids?.locationId }] },
    items: [{
      id: ids?.itemId, location_ids: ids ? [ids.locationId] : undefined, fulfillment_ids: ids ? [ids.fulfillmentId] : undefined, quantity: { selected: { count: po.qty } },
      tags: stage === "confirm" ? [sTag("BUYER_TERMS", { ITEM_REQ: `${po.item.name}, by the ${po.item.unit}` })] : undefined,
    }],
    billing: stage === "select" ? undefined : { name: po.buyer.name, address: po.buyer.address, state: { name: parts?.state }, city: { name: parts?.city }, tax_id: gst, phone },
    fulfillments: [fulfillment],
    payments: stage === "select" ? undefined : [{ type: "ON-FULFILLMENT", collected_by: "BPP", ...(stage === "confirm" ? { status: paid ? "PAID" : "NOT-PAID", params: { currency: "INR", amount: rupees(po.totalPaise) } } : {}) }],
    quote: stage === "confirm" ? { price: price(po.totalPaise), breakup: [{ title: po.item.name, price: price(po.unitPaise * po.qty), item: { price: price(po.unitPaise) }, "@ondc/org/item_id": ids?.itemId, "@ondc/org/item_quantity": { count: po.qty }, "@ondc/org/title_type": "item" }] } : undefined,
    cancellation_terms: stage === "confirm" ? c.supplierTerms?.cancellation_terms : undefined,
    tags: [
      stage === "select" || !gst ? undefined : sTag("buyer_id", { buyer_id_code: "gst", buyer_id_no: gst }),
      ...(stage === "confirm" && Array.isArray(c.supplierTerms?.tags) ? (c.supplierTerms.tags as unknown[]) : []),
    ],
    created_at: stage === "confirm" ? iso(po.createdMs) : undefined,
    updated_at: stage === "confirm" ? iso(po.nowMs) : undefined,
  };
  return finish(stage, newContext(stage, c, domain, "b2b"), { order: clean(order) }, g, flags);
}
