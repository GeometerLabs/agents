// The phone setup for an Orders shop (a tiffin service, a bakery, a caterer): what its two steps take from the form (the shop with its menu; then the rules: cut-off, slots,
// advance and limits), what they refuse in the person's own language, and how they become the settings a builder would write. Languages, accounts and checks are the same steps
// as Bookings' and Fees' (setup.ts). The form is plain: one box with an item on each line, a box of slots for pickup and one for delivery, and the numbers. `validateSettings` of
// the Orders pathway is the last gate on everything. The shop's runtime.json is the one a Fees centre has (payments and messaging, no calendar): fees.ts `runtimeForFees`.
import type { Language } from "../../modules/language/languages.ts";
import { DEFAULT_CAPS } from "../../modules/payments/guard-limits.ts";
import { payeeProblem, vpaProblem } from "../../modules/payments/upi/link.ts";
import { limitLinesOf, limitsOf } from "../../templates/commerce/orders/report/certificate.ts";
import { itemName, validateSettings } from "../../templates/commerce/orders/src/settings.ts";
import type { Settings, Slot } from "../../templates/commerce/orders/src/settings.ts";
import { idsFrom } from "./fees.ts";
import { newPayment, paymentBlock, paymentFromSettings } from "./setup.ts";
import type { Body, Built, Draft, StepResult } from "./setup.ts";
import type { ShopMeta } from "./shops.ts";
import type { Template } from "./templates.ts";
import type { Words } from "./words.ts";

/** A phone form with room for this many menu items. A shop with more is set up by a builder, who can write the file. */
export const MAX_ITEMS = 30;
/** And this many slots in a list, and places in the delivery area. */
export const MAX_SLOTS = 8;
export const MAX_PLACES = 30;

/** What the Orders form shows and sends back. Every value is text, as typed. */
export interface OrdersForm {
  address: string;
  /** One item on each line: name, price, daily stock. */
  menu: string;
  cutoffDays: string; cutoffTime: string;
  /** One slot on each line: "12:00-13:00", then optionally ", a name such as lunch". */
  pickup: string; delivery: string;
  /** Places, separated by commas or lines. Empty: the shop does not deliver. */
  area: string;
  advanceMode: "full" | "part"; advancePercent: string; holdMinutes: string;
  maxPerDay: string; maxItems: string; daysAhead: string; windowHours: string; refund: string; approveOver: string;
  /** Kept from a shop being changed, so its orders still find their items and slots: the id a name had ("i:veg thali", "p:lunch", "d:lunch"), and a slot's own cut-off by id. Never typed. */
  keep?: { ids: Record<string, string>; cutoffs: Record<string, { daysBefore: number; time: string }> };
}

const text = (v: string | undefined, max = 120) => (v ?? "").trim().slice(0, max);
const WHOLE = /^\d{1,9}$/u;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/u;
const SLOT = /^(\d{1,2}:\d{2})\s*(?:-|–|—|to)\s*(\d{1,2}:\d{2})(?:\s*,\s*(.*))?$/iu;

const padClock = (t: string): string => (/^\d:\d{2}$/u.test(t) ? `0${t}` : t);
const whole = (v: string, min: number, max: number) => WHOLE.test(v) && Number(v) >= min && Number(v) <= max;
const lines = (v: string): string[] => v.split(/\r?\n/u).map((l) => l.trim()).filter((l) => l !== "");
const ordersOf = (draft: Draft): OrdersForm => draft.orders as OrdersForm;

/** The same blank form shape Fees' draft has: the shared steps read the shop's name from `form.name`. */
const emptyShopForm = (): Draft["form"] => ({ name: "", language: "en", services: [], deposit: "", opens: "", closes: "", days: [] });

/** One menu line as typed: the last two comma-separated parts are the price and the stock, so a name may hold a comma. */
export function menuLine(line: string): { name: string; price: string; stock: string } | undefined {
  const parts = line.split(",").map((p) => p.trim());
  if (parts.length < 3) return undefined;
  const stock = parts[parts.length - 1];
  const price = parts[parts.length - 2].replace(/^₹\s*/u, "");
  const name = parts.slice(0, -2).join(", ");
  return name === "" ? undefined : { name, price, stock };
}

/** One slot line as typed, with its clock times made two-digit; undefined when it is not a window of one day. */
export function slotLine(line: string): { from: string; to: string; name: string } | undefined {
  const m = SLOT.exec(line);
  if (!m) return undefined;
  const from = padClock(m[1]);
  const to = padClock(m[2]);
  if (!CLOCK.test(from) || !CLOCK.test(to) || to <= from) return undefined;
  return { from, to, name: (m[3] ?? "").trim().slice(0, 40) };
}

/** The places of a delivery area, one each, in the order given (a place written twice is kept once). */
export const placesOf = (area: string): string[] => {
  const seen = new Set<string>();
  return area.split(/[,\n]/u).map((p) => p.trim().slice(0, 40)).filter((p) => p !== "" && !seen.has(p.toLowerCase()) && (seen.add(p.toLowerCase()), true)).slice(0, MAX_PLACES);
};

/** The settings of the template's example, as the form's starting point: its rules are the template's defaults; the shop, menu and slots are the partner's own. */
export function newOrdersDraft(id: string, accountId: string, template: Template, example: Settings, now: string): Draft {
  return {
    id, accountId, template: template.id, createdAt: now, editing: false, saved: false,
    form: emptyShopForm(), windowHours: "", primaryLanguage: example.languages[0], otherLanguages: [], ownerLanguage: example.owner.language, ownerNumber: "",
    whatsapp: { businessNumber: "", numberId: "" }, calendar: { id: "" }, razorpay: { mode: "live", keyId: "" }, payment: newPayment(), expectedBookings: "", done: 0,
    orders: {
      address: "", menu: "", cutoffDays: String(example.cutoff.daysBefore), cutoffTime: example.cutoff.time, pickup: "", delivery: "", area: "",
      advanceMode: example.advance.mode, advancePercent: String(example.advance.mode === "part" ? example.advance.percent : 50), holdMinutes: String(example.advance.holdMinutes),
      maxPerDay: String(example.orders.maxPerDay), maxItems: String(example.orders.maxItemsPerOrder), daysAhead: String(example.orders.daysAhead), windowHours: String(example.cancellation.windowHours),
      refund: String(example.refund.limitInr), approveOver: String(example.owner.approveOverInr),
    } satisfies OrdersForm,
  };
}

/** A draft for a shop that already exists, so changing its settings is the same five steps. */
export function ordersDraftFromShop(id: string, accountId: string, templateId: string, shopId: string, s: Settings, runtime: Record<string, any> | undefined, meta: ShopMeta, now: string): Draft {
  const first = s.languages[0];
  const ids: Record<string, string> = {};
  const cutoffs: Record<string, { daysBefore: number; time: string }> = {};
  const slotText = (slots: Slot[], mode: "p" | "d") => slots.map((x) => {
    const name = x.names?.[first]?.[0] ?? x.names?.en?.[0] ?? x.id; // a slot with no name keeps its id as its name, so the id is made again
    ids[`${mode}:${name.toLowerCase()}`] = x.id;
    if (x.cutoff) cutoffs[x.id] = { ...x.cutoff };
    return `${x.from}-${x.to}, ${name}`;
  }).join("\n");
  const menu = s.menu.map((i) => { const n = itemName(i, first); ids[`i:${n.toLowerCase()}`] = i.id; return `${n}, ${i.priceInr}, ${i.dailyStock}`; }).join("\n");
  return {
    id, accountId, template: templateId, createdAt: now, shopId, editing: true, saved: true, form: { ...emptyShopForm(), name: s.name }, windowHours: "",
    primaryLanguage: first, otherLanguages: s.languages.slice(1), ownerLanguage: s.owner.language, ownerNumber: s.owner.whatsapp,
    whatsapp: { businessNumber: meta.whatsapp?.businessNumber ?? "", numberId: String(runtime?.services?.messaging?.phoneNumberId ?? "") },
    calendar: { id: "" }, razorpay: { mode: meta.razorpay?.mode ?? "live", keyId: meta.razorpay?.keyId ?? "" }, payment: paymentFromSettings(s.payment), expectedBookings: "", done: Number.MAX_SAFE_INTEGER,
    orders: {
      address: s.address ?? "", menu, cutoffDays: String(s.cutoff.daysBefore), cutoffTime: s.cutoff.time, pickup: slotText(s.pickup.slots, "p"), delivery: slotText(s.delivery?.slots ?? [], "d"), area: (s.delivery?.area ?? []).join(", "),
      advanceMode: s.advance.mode, advancePercent: String(s.advance.mode === "part" ? s.advance.percent : 50), holdMinutes: String(s.advance.holdMinutes),
      maxPerDay: String(s.orders.maxPerDay), maxItems: String(s.orders.maxItemsPerOrder), daysAhead: String(s.orders.daysAhead), windowHours: String(s.cancellation.windowHours),
      refund: String(s.refund.limitInr), approveOver: String(s.owner.approveOverInr), keep: { ids, cutoffs },
    } satisfies OrdersForm,
  };
}

// ---- step 1: the shop and its menu ------------------------------------------------------------------------------------------------

export function applyOrdersBusiness(draft: Draft, body: Body, w: Words): StepResult {
  const s = w.setup.problems;
  const o = w.setup.orders.problems;
  const problems: string[] = [];
  const name = text(body.name, 80);
  const address = text(body.address, 120);
  const menu = (body.menu ?? "").slice(0, 20_000);
  if (name === "") problems.push(s.nameEmpty);
  // Kept even when something is wrong, so the form comes back as it was typed.
  draft.form = { ...draft.form, name };
  draft.orders = { ...ordersOf(draft), address, menu };
  const rows = lines(menu);
  if (rows.length === 0) problems.push(o.noItems);
  else if (rows.length > MAX_ITEMS) problems.push(o.tooManyItems(MAX_ITEMS));
  else {
    const seen = new Set<string>();
    rows.forEach((line, i) => {
      const item = menuLine(line);
      if (!item || item.name.length > 60) { problems.push(o.itemBad(i + 1)); return; }
      if (!whole(item.price, 1, 100_000)) problems.push(o.priceBad(i + 1));
      if (!whole(item.stock, 1, 10_000)) problems.push(o.stockBad(i + 1));
      if (seen.has(item.name.toLowerCase())) problems.push(o.itemTwice(i + 1, item.name));
      seen.add(item.name.toLowerCase());
    });
  }
  return { problems };
}

// ---- step 2: the rules -------------------------------------------------------------------------------------------------------------

export function applyOrdersRules(draft: Draft, body: Body, w: Words): StepResult {
  const o = w.setup.orders.problems;
  const problems: string[] = [];
  const next: OrdersForm = {
    ...ordersOf(draft),
    cutoffDays: text(body.cutoffDays, 2), cutoffTime: text(body.cutoffTime, 5), pickup: (body.pickup ?? "").slice(0, 2000), delivery: (body.delivery ?? "").slice(0, 2000), area: (body.area ?? "").slice(0, 2000),
    advanceMode: body.advanceMode === "full" ? "full" : "part", advancePercent: text(body.advancePercent, 3), holdMinutes: text(body.holdMinutes, 4),
    maxPerDay: text(body.maxPerDay, 5), maxItems: text(body.maxItems, 3), daysAhead: text(body.daysAhead, 2), windowHours: text(body.windowHours, 3), refund: text(body.refund, 9), approveOver: text(body.approveOver, 9),
  };
  if (!whole(next.cutoffDays, 0, 7)) problems.push(o.cutoffDaysBad);
  if (!CLOCK.test(padClock(next.cutoffTime))) problems.push(o.cutoffTimeBad);
  else next.cutoffTime = padClock(next.cutoffTime);
  const slots = (list: string, bad: (row: number) => string, none: string | undefined) => {
    const rows = lines(list);
    if (rows.length === 0) { if (none) problems.push(none); return; }
    if (rows.length > MAX_SLOTS) { problems.push(o.tooManySlots(MAX_SLOTS)); return; }
    rows.forEach((line, i) => { if (!slotLine(line)) problems.push(bad(i + 1)); });
  };
  slots(next.pickup, o.pickupBad, o.noPickup);
  slots(next.delivery, o.deliveryBad, undefined);
  const places = placesOf(next.area);
  if (lines(next.delivery).length > 0 && places.length === 0) problems.push(o.deliveryNeedsArea);
  if (lines(next.delivery).length === 0 && places.length > 0) problems.push(o.areaNeedsSlots);
  if (next.advanceMode === "part" && !whole(next.advancePercent, 1, 99)) problems.push(o.percentBad);
  if (!whole(next.holdMinutes, 5, 1440)) problems.push(o.holdBad);
  if (!whole(next.maxPerDay, 1, 10_000)) problems.push(o.perDayBad);
  if (!whole(next.maxItems, 1, 100)) problems.push(o.perOrderBad);
  if (!whole(next.daysAhead, 0, 60)) problems.push(o.daysAheadBad);
  if (!whole(next.windowHours, 0, 336)) problems.push(o.windowBad);
  if (!whole(next.refund, 0, 1_000_000)) problems.push(o.refundBad);
  if (!whole(next.approveOver, 0, 10_000_000)) problems.push(o.approveBad);
  // The pathway refuses an order that could come to more than can be refunded in a day: said here in the person's language, with the numbers.
  const dearest = Math.max(0, ...lines(ordersOf(draft).menu).map((l) => menuLine(l)).flatMap((m) => (m && whole(m.price, 1, 100_000) ? [Number(m.price)] : [])));
  if (whole(next.maxItems, 1, 100) && dearest > 0 && Number(next.maxItems) * dearest * 100 > DEFAULT_CAPS.refundPaisePerDay) {
    problems.push(o.orderTooBig(`₹${(Number(next.maxItems) * dearest).toLocaleString("en-IN")}`, `₹${(DEFAULT_CAPS.refundPaisePerDay / 100).toLocaleString("en-IN")}`));
  }
  draft.orders = next;
  return { problems };
}

// ---- the settings, and the folder ---------------------------------------------------------------------------------------------------------

/** The form, the languages and the owner become the Orders settings; `validateSettings` is the last word. */
export function buildOrdersSettings(draft: Draft, example: Settings): Built {
  const f = ordersOf(draft);
  const languages: Language[] = [draft.primaryLanguage as Language, ...(draft.otherLanguages as Language[])];
  const named = (n: string) => Object.fromEntries(languages.map((l) => [l, [n]]));
  const keep = f.keep ?? { ids: {}, cutoffs: {} };
  const items = lines(f.menu).map((l) => menuLine(l)).flatMap((m) => (m ? [m] : []));
  const itemIds = idsFrom(items.map((m) => m.name), "item", items.map((m) => keep.ids[`i:${m.name.toLowerCase()}`]));
  const pickup = lines(f.pickup).map((l) => slotLine(l)).flatMap((m) => (m ? [m] : []));
  const delivery = lines(f.delivery).map((l) => slotLine(l)).flatMap((m) => (m ? [m] : []));
  // one id for each slot across both lists: the pathway wants a slot's id to be its own, pickup or delivery
  const all = [...pickup, ...delivery];
  const slotIds = idsFrom(all.map((m) => m.name), "slot", all.map((m, i) => keep.ids[`${i < pickup.length ? "p" : "d"}:${m.name.toLowerCase()}`]));
  const slotOf = (m: (typeof all)[number], i: number) => ({ id: slotIds[i], from: m.from, to: m.to, ...(m.name !== "" ? { names: named(m.name) } : {}), ...(keep.cutoffs[slotIds[i]] ? { cutoff: keep.cutoffs[slotIds[i]] } : {}) });
  const places = placesOf(f.area);
  const n = (v: string) => (WHOLE.test(v) ? Number(v) : Number.NaN);
  // The rules step shows the shop's limits before the accounts step has asked for the UPI ID: until it is given, the lines are worked out as for Razorpay (they do not depend on it).
  // The save cannot be reached before the accounts step has checked the UPI ID.
  const upi = draft.payment?.module === "upi";
  const payment = upi && (vpaProblem(draft.payment?.upiId) !== null || payeeProblem(draft.payment?.payee) !== null) ? { module: "razorpay" } : paymentBlock(draft, true);
  const raw = {
    name: draft.form.name, ...(f.address !== "" ? { address: f.address } : {}), timezone: example.timezone, languages,
    menu: items.map((m, i) => ({ id: itemIds[i], names: named(m.name), priceInr: n(m.price), dailyStock: n(m.stock) })),
    orders: { maxPerDay: n(f.maxPerDay), maxItemsPerOrder: n(f.maxItems), daysAhead: n(f.daysAhead) },
    cutoff: { daysBefore: n(f.cutoffDays), time: f.cutoffTime },
    pickup: { slots: pickup.map((m, i) => slotOf(m, i)) },
    ...(delivery.length > 0 || places.length > 0 ? { delivery: { slots: delivery.map((m, i) => slotOf(m, pickup.length + i)), area: places } } : {}),
    advance: f.advanceMode === "full" ? { mode: "full", holdMinutes: n(f.holdMinutes) } : { mode: "part", percent: n(f.advancePercent), holdMinutes: n(f.holdMinutes) },
    cancellation: { windowHours: n(f.windowHours) }, refund: { limitInr: n(f.refund) },
    payment,
    owner: { whatsapp: draft.ownerNumber, language: draft.ownerLanguage, approveOverInr: n(f.approveOver) },
  };
  const checked = validateSettings(raw);
  // `raw` is the shape a builder writes (and `shop add --template orders` takes), with the form's own ids kept.
  return checked.ok ? ({ ok: true, settings: checked.settings as never, raw } as Built) : { ok: false, errors: checked.errors };
}

/** The shop's limits as one sentence each, in the person's language: the same lines the go-live certificate prints. From the draft when it builds, nothing when it does not yet. */
export function ordersLimitLines(draft: Draft, example: Settings, language: Language, saved?: Settings): string[] {
  // The owner's number comes in a later step than the rules, and the lines do not show it: until it is given, the example's stands in so the lines can be shown with the rules.
  const asked = draft.ownerNumber === "" ? { ...draft, ownerNumber: example.owner.whatsapp } : draft;
  const settings = saved ?? (() => { const built = buildOrdersSettings(asked, example); return built.ok ? (built.settings as unknown as Settings) : undefined; })();
  return settings ? limitLinesOf(limitsOf(settings), language) : [];
}
