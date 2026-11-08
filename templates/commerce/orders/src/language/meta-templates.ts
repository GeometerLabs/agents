// The WhatsApp templates in the form Meta approves them: fixed wording, with numbered {{1}}, {{2}} ... for values that come from the record.
//
// Why these exist: outside the customer's (or the owner's) 24-hour window WhatsApp only carries a pre-approved template, and what the agent tells the owner about a new
// order, a cancellation or a refund to send is not a reply, so it nearly always goes out in a closed window. Each template below is the wording of ONE message of
// language/templates.ts, with the record's values as parameters. The wording is NOT written a second time: it is read out of the message itself, by writing the message once
// with stand-in values and turning the stand-ins into {slots}. So what the owner receives is always what the outgoing check read, and the Hindi, Malayalam and Kannada
// wording that a native speaker reviews exists in one place. The mechanism is shared (modules/language/meta-templates.ts); a test checks every body starts and ends with fixed
// words (Meta rejects a body that starts or ends with a parameter) and fills back into the very text.
//
// A message whose wording changes with the order (a delivery that names an address, a UPI shop's "the owner has confirmed", a full advance that leaves nothing to pay) has
// one template for the usual wording and a message of its own for the other (owner_delivery_confirmed, upi_order_confirmed); a customer's confirmation that differs again
// goes as the generic name, and inside the window as free text, which is when it is sent (Deferred.md).
import { formatDate, formatInr } from "../../../../../modules/language/format.ts";
import { LANGUAGES } from "../../../../../modules/language/languages.ts";
import type { Language } from "../../../../../modules/language/languages.ts";
import { META_LANGUAGE, createMetaCatalogue, fillBody, metaBody } from "../../../../../modules/language/meta-templates.ts";
import type { MetaTemplate } from "../../../../../modules/language/meta-templates.ts";
import { localParts, zonedToMs } from "../../../../../modules/core/time.ts";
import { itemName } from "../settings.ts";
import type { Settings } from "../settings.ts";
import { cutAt, day, how, inr, need, render, when } from "./templates.ts";
import type { MessageFacts, TemplateId } from "./templates.ts";

/** The record values a template can use, and where each comes from. */
export type Slot = "business" | "items" | "when" | "day" | "cutoff" | "how" | "address" | "total" | "advance" | "balance" | "refund" | "marked" | "left" | "ref" | "phone" | "code" | "hours" | "upiCode" | "window" | "partner" | "upcoming" | "open" | "until";
const VALUE: Record<Slot, (f: MessageFacts) => string> = {
  business: (f) => f.businessName,
  items: (f) => need(f, "itemsText"),
  when: (f) => when(f),
  day: (f) => day(f),
  cutoff: (f) => cutAt(f),
  how: (f) => how(f),
  address: (f) => need(f, "address"),
  total: (f) => inr(f, "totalInr"),
  advance: (f) => inr(f, "advanceInr"),
  balance: (f) => inr(f, "balanceInr"),
  refund: (f) => inr(f, "refundInr"),
  marked: (f) => inr(f, "markedInr"),
  left: (f) => inr(f, "leftInr"),
  ref: (f) => need(f, "orderRef"),
  phone: (f) => need(f, "customerPhone"),
  code: (f) => need(f, "approvalCode"),
  hours: (f) => String(need(f, "approvalHours")),
  upiCode: (f) => need(f, "upiCode"),
  window: (f) => String(need(f, "windowHours")),
  partner: (f) => need(f, "partner"),
  upcoming: (f) => String(need(f, "upcomingCount")),
  open: (f) => String(need(f, "openCount")),
  until: (f) => formatDate(localParts(need(f, "licenceDateMs"), f.timeZone), f.language),
};

/** The stand-in values a message is written once with, and the slot each becomes. Each is unlike anything a template says on its own. */
const STAND_IN_TEXT: Partial<Record<Slot, string>> = { business: "§business§", items: "§items§", address: "§address§", ref: "§ref§", phone: "§phone§", code: "§code§", upiCode: "§upicode§", partner: "§partner§" };
const STAND_IN_AMOUNT: Partial<Record<Slot, number>> = { total: 7_000_001, advance: 7_000_002, balance: 7_000_003, refund: 7_000_004, marked: 7_000_005, left: 7_000_006 };
const STAND_IN_DAY_MS = Date.UTC(2030, 5, 14, 0, 0); // a date no message of ours would state (Fri 14 Jun 2030)
const STAND_IN_FROM_MS = Date.UTC(2030, 5, 14, 10, 17);
const STAND_IN_TO_MS = Date.UTC(2030, 5, 14, 11, 43);
const STAND_IN_CUTOFF_MS = Date.UTC(2030, 5, 13, 19, 29); // Thu 13 Jun 2030
const STAND_IN_UNTIL_MS = Date.UTC(2031, 6, 15, 0, 0); // another date no message of ours would state (Tue 15 Jul 2031)
const STAND_IN_COUNT: Partial<Record<Slot, number>> = { hours: 7_000_009, window: 7_000_012, upcoming: 7_000_010, open: 7_000_011 };

function standInFacts(language: Language, mode: "pickup" | "delivery"): MessageFacts {
  return {
    language, timeZone: "UTC", businessName: STAND_IN_TEXT.business!, menu: [],
    itemsText: STAND_IN_TEXT.items, address: STAND_IN_TEXT.address, orderRef: STAND_IN_TEXT.ref, customerPhone: STAND_IN_TEXT.phone, approvalCode: STAND_IN_TEXT.code, upiCode: STAND_IN_TEXT.upiCode, partner: STAND_IN_TEXT.partner,
    totalInr: STAND_IN_AMOUNT.total, advanceInr: STAND_IN_AMOUNT.advance, balanceInr: STAND_IN_AMOUNT.balance, refundInr: STAND_IN_AMOUNT.refund, markedInr: STAND_IN_AMOUNT.marked, leftInr: STAND_IN_AMOUNT.left,
    dateMs: STAND_IN_DAY_MS, slotFromMs: STAND_IN_FROM_MS, slotToMs: STAND_IN_TO_MS, cutoffMs: STAND_IN_CUTOFF_MS,
    mode, area: "§area§",
    approvalHours: STAND_IN_COUNT.hours, windowHours: STAND_IN_COUNT.window, upcomingCount: STAND_IN_COUNT.upcoming, openCount: STAND_IN_COUNT.open, licenceDateMs: STAND_IN_UNTIL_MS,
  };
}

/** The message written once with stand-ins, and each stand-in turned into its {slot}: the wording of the template, in a language. */
function bodyOf(id: TemplateId, language: Language, mode: "pickup" | "delivery"): string {
  const facts = standInFacts(language, mode);
  let text = render(id, facts);
  for (const [slot, stand] of Object.entries(STAND_IN_TEXT)) text = text.split(stand!).join(`{${slot}}`);
  for (const [slot, n] of Object.entries(STAND_IN_AMOUNT)) text = text.split(formatInr(n)).join(`{${slot}}`);
  // the composites first: the window and the cut-off contain the day
  text = text.split(when(facts)).join("{when}");
  text = text.split(cutAt(facts)).join("{cutoff}");
  text = text.split(day(facts)).join("{day}");
  if (mode === "delivery") text = text.split(how(facts)).join("{how}"); // a pickup template says "pickup" in fixed words
  text = text.split(formatDate(localParts(STAND_IN_UNTIL_MS, "UTC"), language)).join("{until}");
  for (const [slot, n] of Object.entries(STAND_IN_COUNT)) text = text.split(String(n)).join(`{${slot}}`);
  return text;
}

function template(name: string, usedFor: TemplateId, audience: "customer" | "owner", mode: "pickup" | "delivery" = "pickup"): MetaTemplate<TemplateId> {
  return { name, usedFor, audience, bodies: Object.fromEntries(LANGUAGES.map((l) => [l, bodyOf(usedFor, l, mode)])) as Record<Language, string> };
}

/**
 * The messages that go out on the agent's own, so often outside the 24-hour window: what the owner is told or asked, and the customer's word about their money. The answers to
 * what a customer just wrote are inside the window, and go as plain text.
 */
export const META_TEMPLATES: readonly MetaTemplate<TemplateId>[] = [
  template("order_confirmed", "order_confirmed", "customer"),
  template("order_confirmed_upi", "upi_order_confirmed", "customer"),
  template("order_hold_ended", "hold_expired", "customer"),
  template("owner_new_order", "owner_order_confirmed", "owner"),
  template("owner_new_delivery_order", "owner_delivery_confirmed", "owner", "delivery"),
  template("owner_big_order_asks", "owner_big_order", "owner"),
  template("owner_order_cancelled", "owner_order_cancelled", "owner"),
  template("owner_late_cancel_asks", "owner_late_cancellation", "owner"),
  template("owner_order_duplicate_paid", "owner_duplicate_payment", "owner"),
  template("owner_order_link_failed", "owner_link_failed", "owner"),
  template("owner_customer_wants_you", "owner_wants_to_talk", "owner"),
  template("owner_customer_stopped", "owner_opted_out", "owner"),
  template("owner_order_refund_approval", "owner_refund_needs_approval", "owner"),
  // UPI shops (B33): what the owner is asked to look for or send back, and what the customer hears about a refund, which can come days later
  template("owner_order_upi_check", "owner_upi_expected", "owner"),
  template("owner_order_upi_says_paid", "owner_upi_claim", "owner"),
  template("owner_order_upi_refund_to_send", "owner_upi_refund_owed", "owner"),
  template("owner_order_upi_refund_reminder", "owner_upi_refund_reminder", "owner"),
  template("order_upi_refund_coming", "upi_refund_owed", "customer"),
  template("order_upi_refund_marked_sent", "upi_refund_sent", "customer"),
  // the licence's service notices to the owner (B13): the one plain notice at the wind-down and at the final stop
  template("owner_order_service_paused", "owner_licence_paused", "owner"),
  template("owner_order_service_stopped", "owner_licence_stopped", "owner"),
];

const catalogue = createMetaCatalogue<MessageFacts, TemplateId, Slot>({ templates: META_TEMPLATES, values: VALUE });

/** Every template name, for a provider (or the stand-in) to approve. */
export const META_TEMPLATE_NAMES: readonly string[] = catalogue.names;
export const slotsOf = catalogue.slotsOf;
export const parametersFor = catalogue.parametersFor;
export const templateMessage = catalogue.templateMessage;
export { META_LANGUAGE, fillBody, metaBody };

// ---- the list to submit ------------------------------------------------------------------------------------------------------

/** Example values for Meta's review: a believable order of the example shop, in the template's own language. */
export function exampleFacts(settings: Settings, language: Language): MessageFacts {
  const item = settings.menu[0];
  const date = { year: 2026, month: 11, day: 12 };
  const slot = settings.pickup.slots[0];
  const at = (clock: string, d = date) => { const [h, m] = clock.split(":").map(Number); return zonedToMs(d, { hour: h, minute: m }, settings.timezone); };
  return {
    language, timeZone: settings.timezone, businessName: settings.name, menu: [],
    itemsText: `2 × ${itemName(item, language)}`, totalInr: item.priceInr * 2, advanceInr: Math.ceil((item.priceInr * 2 * settings.advance.percent) / 100), balanceInr: item.priceInr * 2 - Math.ceil((item.priceInr * 2 * settings.advance.percent) / 100), refundInr: Math.ceil((item.priceInr * 2 * settings.advance.percent) / 100), markedInr: Math.ceil((item.priceInr * 2 * settings.advance.percent) / 100), leftInr: 100,
    dateMs: at("00:00"), slotFromMs: at(slot.from), slotToMs: at(slot.to), cutoffMs: at(settings.cutoff.time, { year: 2026, month: 11, day: 11 }),
    mode: "pickup", area: settings.delivery?.area[0] ?? "Kakkanad", address: "Flat 4, Lake View Apartments, Kakkanad",
    link: "https://rzp.io/i/example", orderRef: "o-3", customerPhone: "+919811111111", approvalCode: "K7M2QX", approvalHours: 24, upiCode: "P4XR9T", payee: settings.name, windowHours: settings.cancellation.windowHours,
    partner: "Divya, local partner", upcomingCount: 4, openCount: 1, licenceDateMs: Date.UTC(2027, 2, 4, 18, 30), // Fri 5 Mar 2027 in India
  };
}

/** One entry per template and language, in the body Meta's create-template call takes (POST /{waba-id}/message_templates). */
export const metaSubmissions = (settings: Settings) => catalogue.submissions((language) => exampleFacts(settings, language));

