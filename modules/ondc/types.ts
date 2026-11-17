// The neutral shapes the mapping reads: what a shop's catalogue, order, booking and supplier purchase order hold, in plain words and whole paise, with no template's name
// for anything. Each template turns its own store and settings into these in its own small `src/ondc.ts`; this folder never imports a template (modules/README.md).
//
// Why neutral types and not the templates' own: Orders, Bookings and Stock orders each have their own states, their own money in rupees or paise, and their own ids. The mapping
// is written once against these, so a fourth template (or a different ONDC contract) costs one view function, not another mapping. Three rules shape them:
//  - Money is whole paise, always. The views convert (whole rupees x 100, Stock orders' own `paise()`).
//  - Nothing here is a customer's phone number or address. A customer is a `ref` (a digest). What ONDC needs of a buyer (a name, a phone, an address) is handed in by the
//    caller for one message (`Buyer` in outbound.ts), never read from our store, so it cannot leave by accident.
//  - Nothing is invented. `OndcFacts` holds what ONDC wants and no shop holds today; every field is optional, the views leave it out, and the mapping reports each absence as a
//    typed gap (gaps.ts) instead of writing a made-up value.

export type Paise = number;
export type Language = "en" | "hi" | "ml" | "kn";

/** What ONDC wants that our shops' settings do not hold today. Meant to become one `ondc` block of the settings; until then no view fills it, and each missing piece is a gap. */
export interface OndcFacts {
  /** The retail domain: "ONDC:RET10" (grocery) or "ONDC:RET11" (food and beverage); for services "ONDC:SRV10", "ONDC:SRV11" or "ONDC:SRV12". */
  domain?: string;
  cityCode?: string; // "std:080"
  gps?: string; // "12.967555,77.749666"
  address?: { building?: string; locality?: string; city?: string; state?: string; areaCode?: string };
  gstin?: string;
  pan?: string;
  fssai?: string; // mandatory for food and beverage
  phone?: string; // the shop's public number, for consumer care (never the owner's private number)
  email?: string;
  description?: string;
  logoUrl?: string;
  imageUrls?: string[];
  rating?: string; // "4"
  serviceRadiusKm?: number;
  /** ISO 8601 durations: how long a food order takes to be ready, how long a delivery or pickup takes, the return window. */
  timeToShip?: string;
  tat?: string;
  returnPolicy?: { returnable: boolean; window: string; sellerPicksUp: boolean };
  /** The shop's own bank account, for ONDC's settlement details. */
  bank?: { accountNo: string; ifsc: string; beneficiary: string; bankName: string; branchName: string };
  /** The buyer app's finder fee (agreed with a buyer app, never by the shop). */
  finderFee?: { type: "percent" | "amount"; value: string };
  /** Per item: what the catalogue needs to show it. */
  items?: Record<string, { description?: string; imageUrl?: string; category?: string; vegetarian?: boolean }>;
  /** A shop's menu groups (a food shop's sections), as ONDC lists them. */
  categories?: { id: string; name: string; description: string }[];
  /** A services shop's category ids (SRV) and seller credentials. */
  serviceCategoryIds?: string[];
  creds?: { id: string; type: string }[];
}

/** The shop as a party to an ONDC message. `id` is a stable id of the client (the provider id, the buyer's id). */
export interface Party {
  id: string;
  name: string;
  /** Free text, as the shop's settings hold it ("14 Temple Road, Kakkanad, Kochi"). */
  address?: string;
  timezone: string;
  ondc?: OndcFacts;
}

export interface Slot { id: string; mode: "pickup" | "delivery"; from: string; to: string }

/** One thing for sale: a menu item (goods) or a service. */
export interface CatalogueItem {
  id: string;
  name: string;
  pricePaise: Paise;
  kind: "goods" | "service";
  /** Goods: how many can still be taken (the most the shop makes in a day, less what is held). Services: how many can run at once on its resource. */
  available: number;
  /** The most one order may hold. */
  maxPerOrder: number;
  /** Services: how long one booking takes, in minutes, and the resource it uses up. */
  durationMinutes?: number;
  resource?: string;
}

export interface Catalogue {
  seller: Party;
  items: CatalogueItem[];
  /** The ways to get it: pickup and delivery slots for goods; for a service, none (the customer comes to the shop; times come from `hours`). */
  slots: Slot[];
  /** Delivery: the places delivered to, as the settings name them. */
  areas?: string[];
  /** Services: the weekly opening hours, "1".."7" (Monday first) to [open, close] "HH:MM", or null when closed. */
  hours?: Record<string, [string, string] | null>;
  /** Services: the grid bookings start on, and how long a booking is held for its deposit. */
  slotMinutes?: number;
  cancellationWindowHours: number;
  nowMs: number;
}

export interface Line { itemId: string; name: string; qty: number; unitPaise: Paise }

export type PayerRoute = "provider" | "owner-marked" | "cash";
/** One part of what is paid: the advance (a deposit) or the balance. `paid` is true only when the record says it was received. */
export interface PaymentPart {
  kind: "advance" | "balance";
  amountPaise: Paise;
  paid: boolean;
  /** Provider-confirmed (a gateway), marked by the owner (UPI), or cash. Kept for the record; ONDC has no field for it. */
  by?: PayerRoute;
  /** A way to pay now: a UPI link or a gateway's link, and the reference it carries. */
  uri?: string;
  method?: "upi" | "http/get";
  reference?: string;
}

/** Why an order or booking ended, in our words (states.ts maps each to ONDC's cancellation code). */
export type CancelReason = "customer_cancelled" | "owner_declined" | "advance_expired" | "item_unavailable" | "area_not_served" | "customer_unreachable";
export interface Cancellation { reason: CancelReason; by: "buyer" | "seller"; refundPaise?: Paise }

export interface OrderIn {
  seller: Party;
  /** Our id ("o-12"). */
  ref: string;
  /** The order id the buyer app gave, once it is known; our own id is used until then. */
  networkId?: string;
  /** The template's own state name (states.ts maps it). */
  state: string;
  lines: Line[];
  /** The total as the record holds it, in paise. The quote is built from the lines; a difference is flagged, never hidden. */
  totalPaise: Paise;
  mode?: "pickup" | "delivery";
  slot?: { id: string; fromMs: number; toMs: number };
  area?: string;
  payments: PaymentPart[];
  /** How long a held order waits for its advance, as ISO 8601 ("PT30M"): the quote's life. */
  holdIso: string;
  cancellationWindowHours: number;
  createdMs?: number;
  cancel?: Cancellation;
  nowMs: number;
}

export interface BookingIn {
  seller: Party;
  ref: string;
  networkId?: string;
  state: string;
  service: { id: string; name: string; pricePaise: Paise; durationMinutes: number; resource?: string };
  startMs: number;
  endMs: number;
  payments: PaymentPart[];
  holdIso: string;
  cancellationWindowHours: number;
  createdMs?: number;
  cancel?: Cancellation;
  nowMs: number;
}

/** Stock orders: the shop is the BUYER. A purchase order has three separate questions (accepted? arrived? paid?) and ONDC's order has one state, so all three come in. */
export interface PurchaseIn {
  buyer: Party;
  ref: string;
  state: string;
  ack: "none" | "accepted" | "declined";
  receipt: "none" | "part" | "full" | "wrong_item";
  paidOutside: boolean;
  /** The supplier as we know it: a name. Its ONDC ids are the supplier's own, and no shop holds them today. */
  supplier: { id: string; name: string; ondc?: { providerId: string; locationId: string; itemId: string; fulfillmentId: string } };
  item: { id: string; name: string; unit: string };
  qty: number;
  receivedQty: number;
  unitPaise: Paise;
  totalPaise: Paise;
  createdMs: number;
  nowMs: number;
}
