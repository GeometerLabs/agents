// The required fields of each message the mapping writes, as lists written by hand from reading the contracts, and the check that holds a built message to them.
//
// Why lists of our own: the contracts are CC BY-NC-SA, CC BY-ND or unlicensed (sources.ts), so no sheet or schema file is copied here; each list is the set of paths the
// attribute sheet marks Required (and, where the sheet is silent, the ones the contract's own examples always carry), curated: a "Required" child of an optional parent, or
// a sheet's junk row ("billing.billing"), is left out. Every path is put in exactly one bucket, and the check enforces the bucket:
//   "r"       from our record: it must be in the message.
//   "c"       from the caller: the buyer's own details and the message's context are echoed from the request the adapter got, never read from our store. It must be in the
//             message whenever the caller gave it (the check is told which).
//   a GapKey  something our shops do not hold (gaps.ts): it is in the message when the shop's facts supply it, and the gap is reported when they do not. Never both missing and unreported.
// A path runs through arrays: "items.id" means every item has an id.
import type { GapKey } from "./gaps.ts";

export type Source = "r" | "c" | GapKey;
export type Spec = readonly (readonly [string, Source])[];

const at = (prefix: string, rows: Spec): Spec => rows.map(([p, s]) => [`${prefix}${p}`, s] as const);

// ---- retail B2C (ONDC-RET draft-b2c-1.2.5) --------------------------------------------------------------------------------------------------

export const RETAIL_CONTEXT: Spec = [
  ["context.domain", "retail_domain"], ["context.country", "r"], ["context.action", "r"], ["context.core_version", "r"], ["context.city", "c"], ["context.bap_id", "c"], ["context.bap_uri", "c"],
  ["context.bpp_id", "c"], ["context.bpp_uri", "c"], ["context.transaction_id", "c"], ["context.message_id", "c"], ["context.timestamp", "c"],
];

const P = "message.catalog.bpp/providers.";
export const retailOnSearch = (domain: string | undefined): Spec => [
  ...RETAIL_CONTEXT,
  ...at("message.catalog.", [
    ["bpp/fulfillments.id", "r"], ["bpp/fulfillments.type", "r"], ["bpp/descriptor.name", "r"], ["bpp/descriptor.symbol", "shop_images"], ["bpp/descriptor.short_desc", "shop_description"],
    ["bpp/descriptor.long_desc", "shop_description"], ["bpp/descriptor.images", "shop_images"],
  ]),
  ...at(P, [
    ["id", "r"], ["descriptor.name", "r"], ["descriptor.symbol", "shop_images"], ["descriptor.short_desc", "shop_description"], ["descriptor.long_desc", "shop_description"], ["descriptor.images", "shop_images"],
    ["ttl", "r"], ["rating", "shop_rating"], ["fulfillments.id", "r"], ["fulfillments.type", "r"], ["time.label", "r"], ["time.timestamp", "r"],
    ["locations.id", "r"], ["locations.gps", "shop_gps"], ["locations.address.locality", "shop_address_parts"], ["locations.address.city", "shop_address_parts"], ["locations.address.state", "shop_address_parts"],
    ["locations.address.area_code", "shop_address_parts"], ["locations.time.label", "r"], ["locations.time.timestamp", "r"], ["locations.time.range.start", "r"],
    ["categories.id", "menu_categories"], ["categories.descriptor.name", "menu_categories"], ["categories.descriptor.short_desc", "menu_categories"], ["categories.descriptor.long_desc", "menu_categories"],
    ["items.id", "r"], ["items.descriptor.name", "r"], ["items.descriptor.symbol", "item_images"], ["items.descriptor.short_desc", "item_description"], ["items.descriptor.long_desc", "item_description"],
    ["items.descriptor.images", "item_images"], ["items.price.currency", "r"], ["items.price.value", "r"], ["items.price.maximum_value", "r"],
    ["items.quantity.unitized.measure.unit", "r"], ["items.quantity.unitized.measure.value", "r"], ["items.quantity.unitized.count", "r"], ["items.quantity.available.count", "r"],
    ["items.quantity.maximum.count", "r"], ["items.quantity.minimum.count", "r"], ["items.category_id", "retail_category"], ["items.fulfillment_id", "r"], ["items.location_id", "r"],
    ["items.@ondc/org/returnable", "return_policy"], ["items.@ondc/org/return_window", "return_policy"], ["items.@ondc/org/seller_pickup_return", "return_policy"],
    ["items.replacement_terms.replace_within.duration", "return_policy"], ["items.rating", "shop_rating"], ["items.@ondc/org/cancellable", "r"], ["items.@ondc/org/available_on_cod", "r"],
    ["items.@ondc/org/time_to_ship", "prep_time"], ["items.@ondc/org/contact_details_consumer_care", "shop_phone"], ["items.time.timestamp", "r"],
    ...(domain === "ONDC:RET10" ? [] : ([["@ondc/org/fssai_license_no", "fssai"]] as Spec)),
  ]),
];

const O = "message.order.";
const FULFILMENT_START: Spec = [
  ["fulfillments.start.location.id", "r"], ["fulfillments.start.location.descriptor.name", "r"], ["fulfillments.start.location.gps", "shop_gps"], ["fulfillments.start.location.address.locality", "shop_address_parts"],
  ["fulfillments.start.location.address.city", "shop_address_parts"], ["fulfillments.start.location.address.area_code", "shop_address_parts"], ["fulfillments.start.location.address.state", "shop_address_parts"],
  ["fulfillments.start.contact.phone", "shop_phone"], ["fulfillments.start.contact.email", "shop_phone"],
];
const FULFILMENT_BASE: Spec = [
  ["fulfillments.id", "r"], ["fulfillments.type", "r"], ["fulfillments.@ondc/org/provider_name", "r"], ["fulfillments.tracking", "r"], ["fulfillments.@ondc/org/TAT", "tat"], ["fulfillments.state.descriptor.code", "r"],
];
const QUOTE: Spec = [
  ["quote.price.currency", "r"], ["quote.price.value", "r"], ["quote.ttl", "r"], ["quote.breakup.title", "r"], ["quote.breakup.@ondc/org/title_type", "r"], ["quote.breakup.@ondc/org/item_id", "r"],
  ["quote.breakup.@ondc/org/item_quantity.count", "r"], ["quote.breakup.price.currency", "r"], ["quote.breakup.price.value", "r"], ["quote.breakup.item.price.currency", "r"], ["quote.breakup.item.price.value", "r"],
];
const ITEMS: Spec = [["provider.id", "r"], ["provider.locations.id", "r"], ["items.id", "r"], ["items.quantity.count", "r"], ["items.fulfillment_id", "r"]];
const BILLING: Spec = [
  ["billing.name", "c"], ["billing.phone", "c"], ["billing.email", "c"], ["billing.address.building", "c"], ["billing.address.locality", "c"], ["billing.address.city", "c"], ["billing.address.state", "c"],
  ["billing.address.country", "c"], ["billing.address.area_code", "c"],
];
const END_BUYER: Spec = [["fulfillments.end.person.name", "c"], ["fulfillments.end.contact.phone", "c"], ["fulfillments.end.contact.email", "c"]];
const END_ADDRESS: Spec = [
  ["fulfillments.end.location.gps", "c"], ["fulfillments.end.location.address.name", "c"], ["fulfillments.end.location.address.building", "c"], ["fulfillments.end.location.address.locality", "c"],
  ["fulfillments.end.location.address.city", "c"], ["fulfillments.end.location.address.state", "c"], ["fulfillments.end.location.address.country", "c"], ["fulfillments.end.location.address.area_code", "c"],
];
const PAYMENT: Spec = [
  ["payment.type", "r"], ["payment.status", "r"], ["payment.collected_by", "r"], ["payment.tl_method", "c"], ["payment.uri", "c"], ["payment.params.amount", "r"], ["payment.params.currency", "r"],
  ["payment.params.transaction_id", "r"], ["payment.@ondc/org/buyer_app_finder_fee_type", "finder_fee"], ["payment.@ondc/org/buyer_app_finder_fee_amount", "finder_fee"],
  ["payment.@ondc/org/settlement_details.settlement_counterparty", "settlement_account"], ["payment.@ondc/org/settlement_details.settlement_phase", "settlement_account"],
  ["payment.@ondc/org/settlement_details.settlement_type", "settlement_account"], ["payment.@ondc/org/settlement_details.settlement_bank_account_no", "settlement_account"],
  ["payment.@ondc/org/settlement_details.settlement_ifsc_code", "settlement_account"], ["payment.@ondc/org/settlement_details.beneficiary_name", "settlement_account"],
  ["payment.@ondc/org/settlement_details.bank_name", "settlement_account"], ["payment.@ondc/org/settlement_details.branch_name", "settlement_account"],
];

export type RetailStage = "on_select" | "on_init" | "on_confirm" | "on_status" | "on_cancel";

/** The required paths of one retail order message. `mode` drops the delivery address of a pickup; `slot` adds the slot's time range where the contract asks for it. */
export function retailOrder(stage: RetailStage, mode: "pickup" | "delivery", slot: boolean): Spec {
  const base: Spec = [...RETAIL_CONTEXT, ...at(O, [...ITEMS, ...FULFILMENT_BASE, ...QUOTE, ["fulfillments.@ondc/org/category", "r"]])];
  if (stage === "on_select") return base;
  const withBuyer = [...BILLING, ...(mode === "delivery" ? END_ADDRESS : []), ...END_BUYER];
  if (stage === "on_init") return [...base, ...at(O, [...withBuyer, ...PAYMENT])];
  const full: Spec = at(O, [
    ["id", "r"], ["state", "r"], ["created_at", "record_times"], ["updated_at", "record_times"], ["billing.created_at", "c"], ["billing.updated_at", "c"], ["fulfillments.provider_id", "r"],
    ...withBuyer, ...FULFILMENT_START, ...PAYMENT,
  ]);
  const side = mode === "delivery" ? "end" : "start"; // the slot is when the buyer receives (delivery) or collects (pickup)
  const times: Spec = slot ? at(O, [[`fulfillments.${side}.time.range.start`, "r"], [`fulfillments.${side}.time.range.end`, "r"]]) : [];
  const cancel: Spec = stage === "on_cancel" ? at(O, [["cancellation.cancelled_by", "r"], ["cancellation.reason.id", "r"]]) : [];
  return [...base, ...full, ...(stage === "on_confirm" ? [] : times), ...cancel];
}

// ---- services (ONDC-SRV draft-services, 2.0.0) -------------------------------------------------------------------------------------------

export const SERVICES_CONTEXT: Spec = [
  ["context.domain", "service_domain"], ["context.location.city.code", "c"], ["context.location.country.code", "r"], ["context.action", "r"], ["context.version", "r"], ["context.bap_id", "c"], ["context.bap_uri", "c"],
  ["context.bpp_id", "c"], ["context.bpp_uri", "c"], ["context.transaction_id", "c"], ["context.message_id", "c"], ["context.timestamp", "c"], ["context.ttl", "r"],
];
const SL = "message.catalog.providers.";
export const servicesOnSearch: Spec = [
  ...SERVICES_CONTEXT,
  ...at("message.catalog.", [["fulfillments.id", "r"], ["fulfillments.type", "r"], ["payments.id", "r"], ["payments.type", "r"], ["descriptor.name", "r"], ["descriptor.short_desc", "shop_description"]]),
  ...at(SL, [
    ["id", "r"], ["descriptor.name", "r"], ["time.label", "r"], ["time.range.start", "r"], ["time.range.end", "r"], ["time.schedule.frequency", "r"], ["locations.id", "r"], ["locations.gps", "shop_gps"],
    ["locations.address", "r"], ["locations.area_code", "shop_address_parts"], ["categories.id", "service_category"], ["creds.id", "service_creds"], ["creds.type", "service_creds"],
    ["items.id", "r"], ["items.descriptor.name", "r"], ["items.descriptor.images", "item_images"], ["items.price.currency", "r"], ["items.price.value", "r"],
    ["items.quantity.unitized.measure.unit", "r"], ["items.quantity.unitized.measure.value", "r"], ["items.cancellation_terms.cancellation_fee", "r"],
    ["items.category_ids", "service_category"], ["items.fulfillment_ids", "r"], ["items.location_ids", "r"], ["items.time.range.start", "r"], ["items.time.range.end", "r"], ["items.time.schedule.frequency", "r"],
  ]),
];
export const servicesOrder = (stage: "on_select" | "on_init" | "on_confirm" | "on_status" | "on_cancel"): Spec => [
  ...SERVICES_CONTEXT,
  ...at(O, [
    ["status", "r"], ["provider.id", "r"], ["items.id", "r"], ["items.location_ids", "r"], ["items.fulfillment_ids", "r"], ["items.quantity.selected.count", "r"], ["items.category_ids", "service_category"],
    ["fulfillments.type", "r"], ["fulfillments.id", "r"], ["fulfillments.state.descriptor.code", "r"], ["fulfillments.tracking", "r"], ["fulfillments.rateable", "r"], ["fulfillments.stops.type", "r"],
    ["fulfillments.stops.location.id", "r"], ["fulfillments.stops.location.descriptor.name", "r"], ["fulfillments.stops.location.gps", "shop_gps"], ["fulfillments.stops.location.address", "r"],
    ["fulfillments.stops.location.city.name", "shop_address_parts"], ["fulfillments.stops.location.country.code", "r"], ["fulfillments.stops.location.area_code", "shop_address_parts"],
    ["fulfillments.stops.location.state.name", "shop_address_parts"], ["fulfillments.stops.contact.phone", "shop_phone"], ["fulfillments.stops.time.label", "r"],
    ["fulfillments.stops.time.range.start", "r"], ["fulfillments.stops.time.range.end", "r"],
    ["quote.price.currency", "r"], ["quote.price.value", "r"], ["quote.breakup.title", "r"], ["quote.breakup.price.currency", "r"], ["quote.breakup.price.value", "r"], ["quote.breakup.item.id", "r"],
    ["quote.breakup.item.quantity.selected.count", "r"], ["quote.breakup.tags.list.value", "r"], ["quote.ttl", "r"],
    ...(stage === "on_select" ? [] : ([
      ["billing.phone", "c"], ["billing.state.name", "c"], ["billing.city.name", "c"],
      ["payments.id", "r"], ["payments.type", "r"], ["payments.collected_by", "r"], ["payments.status", "r"], ["payments.params.amount", "r"], ["payments.params.currency", "r"], ["payments.params.transaction_id", "r"],
      ["payments.params.bank_account_number", "settlement_account"], ["payments.tags.list.value", "finder_fee"],
    ] as Spec)),
    ...(stage === "on_select" || stage === "on_init" ? [] : ([["id", "r"], ["created_at", "record_times"], ["updated_at", "record_times"], ["cancellation_terms.cancellation_fee", "r"], ["xinput.form.url", "service_form"]] as Spec)),
    ...(stage === "on_cancel" ? ([["cancellation.cancelled_by", "r"], ["cancellation.reason.descriptor.code", "r"]] as Spec) : []),
  ]),
];

// ---- B2B buyer side (ONDC-RET release-2.0.2): what WE send as the buyer --------------------------------------------------------------------

export const B2B_CONTEXT: Spec = [
  ["context.domain", "retail_domain"], ["context.location.city.code", "city_code"], ["context.location.country.code", "r"], ["context.action", "r"], ["context.version", "r"], ["context.bap_id", "c"], ["context.bap_uri", "c"],
  ["context.bpp_id", "c"], ["context.bpp_uri", "c"], ["context.transaction_id", "c"], ["context.message_id", "c"], ["context.timestamp", "c"], ["context.ttl", "r"],
];
const B2B_ITEMS: Spec = [
  ["provider.id", "supplier_ondc_ids"], ["provider.locations.id", "supplier_ondc_ids"], ["items.id", "supplier_ondc_ids"], ["items.location_ids", "supplier_ondc_ids"], ["items.fulfillment_ids", "supplier_ondc_ids"],
  ["items.quantity.selected.count", "r"], ["fulfillments.id", "supplier_ondc_ids"], ["fulfillments.type", "r"], ["fulfillments.stops.type", "r"], ["fulfillments.stops.location.gps", "shop_gps"],
  ["fulfillments.stops.location.area_code", "shop_address_parts"],
];
const B2B_BUYER: Spec = [
  ["billing.name", "r"], ["billing.phone", "shop_phone"], ["billing.tax_id", "gstin"], ["billing.state.name", "shop_address_parts"], ["billing.city.name", "shop_address_parts"],
  ["fulfillments.stops.location.address", "r"], ["fulfillments.stops.location.city.name", "shop_address_parts"], ["fulfillments.stops.location.country.code", "r"],
  ["fulfillments.stops.location.state.name", "shop_address_parts"], ["fulfillments.stops.contact.phone", "shop_phone"],
];
export const b2bRequest = (stage: "select" | "init" | "confirm"): Spec => [
  ...B2B_CONTEXT,
  ...at(O, [
    ...B2B_ITEMS,
    ...(stage === "select" ? [] : B2B_BUYER),
    ...(stage === "select" ? [] : ([["payments.type", "r"], ["payments.collected_by", "r"]] as Spec)),
    ...(stage !== "confirm" ? [] : ([
      ["id", "r"], ["state", "r"], ["created_at", "r"], ["updated_at", "r"], ["quote.price.currency", "r"], ["quote.price.value", "r"], ["quote.breakup.title", "r"], ["quote.breakup.price.value", "r"],
      ["payments.status", "r"], ["payments.params.currency", "r"], ["payments.params.amount", "r"], ["cancellation_terms.cancellation_fee", "c"], ["tags.list.value", "c"],
    ] as Spec)),
  ]),
];

// ---- the check ---------------------------------------------------------------------------------------------------------------------------

type Json = unknown;
function present(node: Json, parts: string[]): boolean {
  if (Array.isArray(node)) return node.length > 0 && node.every((n) => present(n, parts));
  if (parts.length === 0) return node !== undefined && node !== null && node !== "";
  if (typeof node !== "object" || node === null) return false;
  return present((node as Record<string, Json>)[parts[0]], parts.slice(1));
}
export const hasPath = (msg: unknown, path: string): boolean => present(msg, path.split("."));

export interface Problem { path: string; why: "missing from our record" | "missing but the caller gave it" | "missing and its gap is not reported" }

/** Hold a built message to its list. `callerGave` says whether the caller handed in the context and buyer details the "c" paths echo. */
export function checkRequired(msg: unknown, spec: Spec, gapKeys: readonly GapKey[], callerGave: boolean): Problem[] {
  const out: Problem[] = [];
  for (const [path, source] of spec) {
    const there = hasPath(msg, path);
    if (source === "r") { if (!there) out.push({ path, why: "missing from our record" }); }
    else if (source === "c") { if (!there && callerGave) out.push({ path, why: "missing but the caller gave it" }); }
    else if (!there && !gapKeys.includes(source)) out.push({ path, why: "missing and its gap is not reported" });
  }
  return out;
}
