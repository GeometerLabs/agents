// Outbound, services (ONDC services 2.0.0: `providers`, `stops`, `payments[]`, `status`, tags written under `descriptor`): a booking shop's services as `on_search`, and one
// booking as `on_select`, `on_init`, `on_confirm`, `on_status` and `on_cancel`, with a scheduled fulfillment (the stop's time range is the booking's start and end).
//
// What is a reading and not a fact: the services repository's examples show only Home-Service orders with a start and an end stop; a visit to the shop appears there only as the
// fulfillment type "Store-Service" in an on_search example. So a booking at the shop is written as Store-Service with ONE stop (type "start", the shop, the booking's range). That
// is the nearest the contract allows and must be confirmed against a services buyer app before it is relied on. The deposit is the `PRE-FULFILLMENT` payment and what is left a
// second `ON-FULFILLMENT` one: unlike retail, services carry `payments[]`, so the advance and the balance each have their own status. A refund is a negative `refund` line in the
// quote, as services' enum has. Gaps are recorded, never filled (gaps.ts).
import { rupees, price } from "./money.ts";
import { CANCEL_CODES, partStatus, srvStatus, statusOf } from "./states.ts";
import { clean, factsOf, finish, hhmm, iso, newContext, sTag } from "./common.ts";
import type { Caller, Flag, Out } from "./common.ts";
import { collector } from "./gaps.ts";
import type { BookingIn, Catalogue, Party } from "./types.ts";

const LOCATION = (p: Party) => `${p.id}-L1`;
const FID = "F1";

const cancellationTerms = (hours: number) => [{ fulfillment_state: { descriptor: { code: "Pending" } }, reason_required: false, cancel_by: { duration: `PT${hours}H` }, cancellation_fee: { amount: { currency: "INR", value: "0" } } }];

function locationOf(g: ReturnType<typeof collector>, s: Party) {
  const f = factsOf(s);
  const a = f.address;
  const parts = a?.city && a.state && a.areaCode ? a : undefined;
  g.need("shop_address_parts", parts);
  return { id: LOCATION(s), gps: g.need("shop_gps", f.gps), address: s.address, city: { code: f.cityCode, name: parts?.city }, country: { code: "IND" }, state: parts && { code: parts.state }, area_code: parts?.areaCode };
}

/** `on_search`: the shop's services as one provider, each with its duration, its cancellation terms and its bookable times. */
export function onSearch(cat: Catalogue, c: Caller): Out {
  const g = collector();
  const s = cat.seller;
  const f = factsOf(s);
  const domain = g.need("service_domain", f.domain);
  g.need("city_code", f.cityCode);
  const desc = g.need("shop_description", f.description);
  const creds = g.need("service_creds", f.creds);
  const cats = g.need("service_category", f.serviceCategoryIds);
  const open = Object.entries(cat.hours ?? {}).filter(([, h]) => h !== null) as [string, [string, string]][];
  const days = open.map(([d]) => d).join(",");
  const start = open.map(([, h]) => h[0]).sort()[0];
  const end = open.map(([, h]) => h[1]).sort().reverse()[0];
  const frequency = `PT${cat.slotMinutes ?? 30}M`;
  const validity = { label: "validity", range: { start: iso(cat.nowMs), end: iso(cat.nowMs + 86_400_000) }, days, schedule: { frequency, holidays: [] } };
  const message = {
    catalog: {
      descriptor: { name: s.name, short_desc: desc },
      fulfillments: [{ id: FID, type: "Store-Service" }],
      payments: [{ id: "1", type: "PRE-FULFILLMENT" }, { id: "2", type: "ON-FULFILLMENT" }],
      providers: [{
        id: s.id,
        descriptor: { name: s.name, short_desc: desc },
        time: { label: "enable", range: start && end ? { start: hhmm(start), end: hhmm(end) } : undefined, days, schedule: { frequency, holidays: [] } },
        locations: [locationOf(g, s)],
        categories: cats?.map((id) => ({ id })),
        creds: creds?.map((x) => ({ id: x.id, type: x.type })),
        items: cat.items.map((it) => ({
          id: it.id,
          descriptor: { name: it.name, images: (() => { const u = g.need("item_images", f.items?.[it.id]?.imageUrl); return u ? [{ url: u }] : undefined; })() },
          price: { currency: "INR", value: rupees(it.pricePaise) },
          quantity: { unitized: { measure: { unit: "minutes", value: String(it.durationMinutes ?? 0) } } },
          category_ids: cats,
          fulfillment_ids: [FID],
          location_ids: [LOCATION(s)],
          payment_ids: ["1", "2"],
          cancellation_terms: cancellationTerms(cat.cancellationWindowHours),
          time: validity,
        })),
      }],
    },
  };
  return finish("on_search", newContext("on_search", c, domain, "services"), message, g, []);
}

export type ServiceStage = "on_select" | "on_init" | "on_confirm" | "on_status" | "on_cancel";

/** One booking as a services message. Null when its state is not yet an order on the network (an enquiry, details being confirmed). */
export function bookingMessage(b: BookingIn, stage: ServiceStage, c: Caller): Out | null {
  const status = statusOf("bookings", b.state);
  if (status.stage === "none") return null;
  const g = collector();
  const s = b.seller;
  const f = factsOf(s);
  const flags: Flag[] = [];
  const domain = g.need("service_domain", f.domain);
  const cats = g.need("service_category", f.serviceCategoryIds);
  const late = stage === "on_confirm" || stage === "on_status" || stage === "on_cancel";
  const cancel = stage === "on_cancel" ? (b.cancel ?? (status.cancelled ? { reason: status.cancelled, by: "seller" as const } : undefined)) : undefined;

  if (stage === "on_cancel" && !cancel) g.need("cancel_reason", undefined);
  const lines = [{ title: b.service.name, paise: b.service.pricePaise, type: "item" }];
  if (cancel?.refundPaise) lines.push({ title: "refund", paise: -cancel.refundPaise, type: "refund" });
  const total = lines.reduce((n, l) => n + l.paise, 0);
  const paidSum = b.payments.reduce((n, p) => n + p.amountPaise, 0);
  if (paidSum !== b.service.pricePaise) flags.push({ kind: "record_total_mismatch", detail: `the payments add up to ${rupees(paidSum)} but the service costs ${rupees(b.service.pricePaise)}` });
  g.need("tax_breakup", undefined);
  const confirmed = status.order === "Accepted" || status.order === "In-progress" || status.order === "Completed";

  const bank = f.bank;
  g.need("settlement_account", bank);
  g.need("finder_fee", f.finderFee);
  const buyer = stage === "on_select" ? undefined : c.buyer;
  const care = g.need("shop_phone", f.phone);
  const fulfillment = {
    id: FID,
    type: "Store-Service",
    state: { descriptor: { code: status.fulfillment } },
    tracking: false,
    rateable: false,
    stops: [{
      type: "start",
      location: locationOf(g, s) && { ...locationOf(g, s), descriptor: { name: s.name } },
      contact: { phone: care, email: f.email },
      time: { label: confirmed ? "confirmed" : "selected", range: { start: iso(b.startMs), end: iso(b.endMs) } },
    }],
  };
  const payments = stage === "on_select" ? undefined : b.payments.map((p, i) => ({
    id: `P${i + 1}`,
    type: p.kind === "advance" ? "PRE-FULFILLMENT" : "ON-FULFILLMENT",
    collected_by: "BPP",
    status: partStatus(p),
    params: { amount: rupees(p.amountPaise), currency: "INR", transaction_id: p.reference ?? b.ref, bank_account_number: bank?.accountNo, virtual_payment_address: undefined },
    tags: [
      bank ? sTag("Settlement_Counterparty", { Counterparty: "BPP", Mode: "NEFT", Beneficiary_Name: bank.beneficiary, Bank_Account_No: bank.accountNo, Ifsc_Code: bank.ifsc }) : undefined,
      f.finderFee ? sTag("Buyer_Finder_Fee", { Buyer_finder_fee_percentage: f.finderFee.type === "percent" ? f.finderFee.value : undefined, Buyer_finder_fee_amount: f.finderFee.type === "amount" ? f.finderFee.value : undefined }) : undefined,
    ],
  }));
  if (late) g.need("record_times", b.createdMs);
  if (late) g.need("service_form", undefined);
  const order = {
    id: late ? (b.networkId ?? b.ref) : undefined,
    status: stage === "on_cancel" ? "CANCELLED" : srvStatus(status.order!),
    provider: { id: s.id, locations: [{ id: LOCATION(s) }] },
    items: [{ id: b.service.id, location_ids: [LOCATION(s)], category_ids: cats, fulfillment_ids: [FID], quantity: { selected: { count: 1 } } }],
    billing: buyer && { name: buyer.name, phone: buyer.phone, email: buyer.email, state: { name: buyer.address.state }, city: { name: buyer.address.city } },
    fulfillments: [fulfillment],
    quote: {
      price: price(total),
      breakup: lines.map((l) => ({ title: l.title, price: price(l.paise), item: { id: b.service.id, quantity: { selected: { count: 1 } }, price: price(l.paise) }, tags: [sTag("title", { type: l.type })] })),
      ttl: b.holdIso,
    },
    payments,
    cancellation_terms: late ? cancellationTerms(b.cancellationWindowHours) : undefined,
    cancellation: cancel ? { cancelled_by: cancel.by === "buyer" ? "CONSUMER" : "PRODUCER", reason: { descriptor: { code: CANCEL_CODES[cancel.reason].code } } } : undefined,
    created_at: late && b.createdMs !== undefined ? iso(b.createdMs) : undefined,
    updated_at: late ? iso(b.nowMs) : undefined,
  };
  return finish(stage, newContext(stage, c, domain, "services"), { order: clean(order) }, g, flags);
}
