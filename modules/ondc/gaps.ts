// The gaps: what ONDC's contracts require that our shops do not hold today, as a typed list the mapping RETURNS ("missing: gstin") instead of writing a made-up value.
//
// Why: a mapping that fills a blank with a plausible string (a placeholder GSTIN, a guessed pincode, "PT30M" for a food shop that never said how long it takes) produces messages
// that pass a schema check and are wrong in the network. Here a builder asks `gaps.need(key, value)`: a present value is used, an absent one is left out of the message and
// recorded. The adapter that comes later turns this list into "what the shop must tell us first", and each entry names the setting that would hold the answer (the future
// `ondc` block of a shop's settings, OndcFacts in types.ts), so closing a gap is adding a setting, never changing the mapping.
//
// `severity`: "required" means a sheet of the contract marks the field Required; "expected" means the contract's examples and tags carry it and the network checks it, though the
// attribute sheet does not mark it. Written by hand from reading ONDC-RET draft-b2c-1.2.5, release-2.0.2 and ONDC-SRV draft-services (sources.ts); nothing is copied.
export type GapKey =
  | "retail_domain" | "service_domain" | "city_code" | "shop_gps" | "shop_address_parts" | "shop_phone" | "shop_description" | "shop_images" | "shop_rating"
  | "gstin" | "pan" | "fssai" | "serviceability_radius" | "item_description" | "item_images" | "retail_category" | "veg_nonveg" | "menu_categories"
  | "return_policy" | "prep_time" | "tat" | "settlement_account" | "finder_fee" | "tax_breakup" | "record_times" | "service_creds" | "service_form" | "service_category"
  | "supplier_ondc_ids";

export interface GapInfo { severity: "required" | "expected"; what: string; fields: string[]; setting: string }

export const GAPS: Record<GapKey, GapInfo> = {
  retail_domain: { severity: "required", what: "which ONDC retail domain the shop sells in (grocery or food and beverage)", fields: ["context.domain", "items.category_id"], setting: "ondc.domain: \"ONDC:RET10\" or \"ONDC:RET11\"" },
  service_domain: { severity: "required", what: "which ONDC services domain the shop is in", fields: ["context.domain"], setting: "ondc.domain: \"ONDC:SRV10\", \"ONDC:SRV11\" or \"ONDC:SRV12\"" },
  city_code: { severity: "required", what: "the ONDC city code of the shop's city", fields: ["locations.city", "context.city"], setting: "ondc.cityCode: \"std:080\"" },
  shop_gps: { severity: "required", what: "the shop's map position", fields: ["locations.gps", "fulfillments.start.location.gps"], setting: "ondc.gps" },
  shop_address_parts: { severity: "required", what: "the shop's address split into locality, city, state and pincode (we keep one line of text)", fields: ["locations.address", "fulfillments.start.location.address.*", "billing.address.*"], setting: "ondc.address" },
  shop_phone: { severity: "required", what: "the shop's public phone for consumer care (never the owner's private number)", fields: ["items.@ondc/org/contact_details_consumer_care", "fulfillments.start.contact.phone"], setting: "ondc.phone and ondc.email" },
  shop_description: { severity: "required", what: "a short and a long description of the shop", fields: ["descriptor.short_desc", "descriptor.long_desc"], setting: "ondc.description" },
  shop_images: { severity: "required", what: "the shop's logo and a picture", fields: ["descriptor.symbol", "descriptor.images"], setting: "ondc.logoUrl and ondc.imageUrls" },
  shop_rating: { severity: "required", what: "the shop's rating, which only the network can give", fields: ["providers.rating"], setting: "ondc.rating" },
  gstin: { severity: "required", what: "the shop's GST number", fields: ["order.tags bpp_terms tax_number", "billing.tax_id (B2B)"], setting: "ondc.gstin" },
  pan: { severity: "expected", what: "the shop's PAN (the provider tax number in the order's seller terms)", fields: ["order.tags bpp_terms provider_tax_number"], setting: "ondc.pan" },
  fssai: { severity: "required", what: "the FSSAI licence number (mandatory for food and beverage)", fields: ["providers.@ondc/org/fssai_license_no"], setting: "ondc.fssai" },
  serviceability_radius: { severity: "expected", what: "how far the shop delivers, as a distance (we keep a list of place names)", fields: ["providers.locations.circle", "providers.tags serviceability"], setting: "ondc.serviceRadiusKm" },
  item_description: { severity: "required", what: "a short and a long description of each item", fields: ["items.descriptor.short_desc", "items.descriptor.long_desc"], setting: "ondc.items.<id>.description" },
  item_images: { severity: "required", what: "a picture of each item", fields: ["items.descriptor.symbol", "items.descriptor.images"], setting: "ondc.items.<id>.imageUrl" },
  retail_category: { severity: "required", what: "each item's ONDC category (food and beverage is \"F&B\"; grocery has its own list)", fields: ["items.category_id"], setting: "ondc.items.<id>.category" },
  veg_nonveg: { severity: "expected", what: "whether each food item is vegetarian", fields: ["items.tags veg_nonveg"], setting: "ondc.items.<id>.vegetarian" },
  menu_categories: { severity: "required", what: "the menu's sections, each with a name and a description", fields: ["providers.categories"], setting: "ondc.categories" },
  return_policy: { severity: "required", what: "whether an item can be returned, for how long, and who collects it", fields: ["items.@ondc/org/returnable", "items.@ondc/org/return_window", "items.@ondc/org/seller_pickup_return", "items.replacement_terms"], setting: "ondc.returnPolicy" },
  prep_time: { severity: "required", what: "how long an order takes to be ready (we keep a cut-off, not a preparation time)", fields: ["items.@ondc/org/time_to_ship"], setting: "ondc.timeToShip" },
  tat: { severity: "required", what: "the fulfillment turnaround time (we keep a slot, not a duration)", fields: ["fulfillments.@ondc/org/TAT"], setting: "ondc.tat" },
  settlement_account: { severity: "required", what: "the bank account the money settles to", fields: ["payment.@ondc/org/settlement_details"], setting: "ondc.bank" },
  finder_fee: { severity: "required", what: "the buyer app's finder fee, agreed with that app", fields: ["payment.@ondc/org/buyer_app_finder_fee_type", "payment.@ondc/org/buyer_app_finder_fee_amount"], setting: "ondc.finderFee" },
  tax_breakup: { severity: "expected", what: "the GST in each price (our prices are whole-rupee, tax-inclusive, with no rate kept)", fields: ["quote.breakup tax lines"], setting: "a GST rate per item" },
  record_times: { severity: "required", what: "when the order or booking was made and last changed (neither record keeps its creation time)", fields: ["order.created_at", "order.updated_at"], setting: "createdMs on the order and the booking" },
  service_creds: { severity: "required", what: "the provider's credentials as ONDC lists them", fields: ["providers.creds"], setting: "ondc.creds" },
  service_form: { severity: "required", what: "the form a services order carries (a checklist), which no shop of ours has", fields: ["order.xinput"], setting: "ondc.serviceForm" },
  service_category: { severity: "required", what: "the ONDC category ids of each service", fields: ["items.category_ids", "providers.categories"], setting: "ondc.serviceCategoryIds" },
  supplier_ondc_ids: { severity: "required", what: "the supplier's own ONDC provider, location, item and fulfillment ids (a supplier we order from by WhatsApp has none)", fields: ["provider.id", "provider.locations.id", "items.id", "items.fulfillment_ids"], setting: "supplier.ondc" },
};

export interface Gap extends GapInfo { missing: GapKey }
export const gapLabel = (key: GapKey): string => `missing: ${key}`;

/** A collector: `need` returns the value when there is one, otherwise records the gap and returns undefined. */
export function collector() {
  const seen = new Set<GapKey>();
  return {
    need<T>(key: GapKey, value: T | undefined | null | ""): T | undefined {
      if (value === undefined || value === null || value === "") { seen.add(key); return undefined; }
      return value;
    },
    list(): Gap[] { return [...seen].sort().map((missing) => ({ missing, ...GAPS[missing] })); },
    keys(): GapKey[] { return [...seen].sort(); },
  };
}
export type Gaps = ReturnType<typeof collector>;
