// The WhatsApp templates in the form Meta approves them: fixed wording, with numbered {{1}}, {{2}} ... for the values that come from the record.
//
// Why these exist: a supplier almost never wrote to the shop in the last 24 hours, so the order itself and every ask after it go out as an approved template; and what the
// agent tells the owner when a supplier answers (or stays silent) is not a reply to anything the owner just wrote. Each template below is the wording of ONE message of
// templates.ts with the record's values as parameters. The wording is not written a second time: it is read out of the message itself, by writing the message once with
// stand-in values and turning the stand-ins into {slots} (the mechanism is shared: modules/language/meta-templates.ts). So what a supplier receives is always what the
// outgoing check read, and the Hindi, Malayalam and Kannada a native speaker reviews exist in one place. A test checks every body starts and ends with fixed words (Meta
// rejects a body that starts or ends with a parameter) and fills back into the very text.
import { LANGUAGES } from "../../../../../modules/language/languages.ts";
import type { Language } from "../../../../../modules/language/languages.ts";
import { META_LANGUAGE, createMetaCatalogue, fillBody, metaBody } from "../../../../../modules/language/meta-templates.ts";
import type { MetaTemplate } from "../../../../../modules/language/meta-templates.ts";
import { nameIn, paise, supplierOf, unitOf, itemOf } from "../settings.ts";
import type { Settings } from "../settings.ts";
import { inr, need, money, render } from "./templates.ts";
import type { MessageFacts, TemplateId } from "./templates.ts";

/** The record values a template can use. */
export type Slot = "business" | "supplier" | "item" | "unit" | "qty" | "price" | "total" | "ref" | "code" | "budget" | "reserved" | "left" | "hours";
const VALUE: Record<Slot, (f: MessageFacts) => string> = {
  business: (f) => f.businessName,
  supplier: (f) => need(f, "supplierName"),
  item: (f) => need(f, "itemName"),
  unit: (f) => need(f, "unitName"),
  qty: (f) => String(need(f, "qty")),
  price: (f) => inr(f, "unitPriceInr"),
  total: (f) => inr(f, "totalInr"),
  ref: (f) => need(f, "orderRef"),
  code: (f) => need(f, "code"),
  budget: (f) => inr(f, "budgetInr"),
  reserved: (f) => inr(f, "reservedInr"),
  left: (f) => inr(f, "leftInr"),
  hours: (f) => String(need(f, "hours")),
};

/** The stand-in values a message is written once with, and the slot each becomes. Each is unlike anything a template says on its own. */
const STAND_IN_TEXT: Partial<Record<Slot, string>> = { business: "§business§", supplier: "§supplier§", item: "§item§", unit: "§unit§", ref: "§ref§", code: "§code§" };
const STAND_IN_AMOUNT: Partial<Record<Slot, number>> = { price: 7_000_001, total: 7_000_002, budget: 7_000_003, reserved: 7_000_004, left: 7_000_005 };
const STAND_IN_COUNT: Partial<Record<Slot, number>> = { qty: 7_000_006, hours: 7_000_007 };

function standInFacts(language: Language): MessageFacts {
  return {
    language, timeZone: "UTC", businessName: STAND_IN_TEXT.business!, supplierName: STAND_IN_TEXT.supplier, itemName: STAND_IN_TEXT.item, unitName: STAND_IN_TEXT.unit,
    qty: STAND_IN_COUNT.qty, hours: STAND_IN_COUNT.hours, unitPriceInr: STAND_IN_AMOUNT.price, totalInr: STAND_IN_AMOUNT.total, budgetInr: STAND_IN_AMOUNT.budget,
    reservedInr: STAND_IN_AMOUNT.reserved, leftInr: STAND_IN_AMOUNT.left, orderRef: STAND_IN_TEXT.ref, code: STAND_IN_TEXT.code, monthLabel: "§month§", refs: ["§refs§"],
  };
}

/** The message written once with stand-ins, and each stand-in turned into its {slot}: the wording of the template, in a language. */
function bodyOf(id: TemplateId, language: Language): string {
  const facts = standInFacts(language);
  let text = render(id, facts);
  for (const [slot, stand] of Object.entries(STAND_IN_TEXT)) text = text.split(stand!).join(`{${slot}}`);
  for (const [slot, v] of Object.entries(STAND_IN_AMOUNT)) text = text.split(money(v)).join(`{${slot}}`);
  for (const [slot, v] of Object.entries(STAND_IN_COUNT)) text = text.split(String(v)).join(`{${slot}}`);
  return text;
}

const template = (name: string, usedFor: TemplateId, audience: "customer" | "owner"): MetaTemplate<TemplateId> =>
  ({ name, usedFor, audience, bodies: Object.fromEntries(LANGUAGES.map((l) => [l, bodyOf(usedFor, l)])) as Record<Language, string> });

/** The messages that go out on the agent's own, so usually outside the 24-hour window. "customer" is the supplier here: the person the order goes to. */
export const META_TEMPLATES: readonly MetaTemplate<TemplateId>[] = [
  template("stock_order_to_supplier", "supplier_order", "customer"),
  template("stock_order_reminder", "supplier_check", "customer"),
  template("stock_owner_approval_card", "card", "owner"),
  template("stock_owner_supplier_confirmed", "owner_supplier_accepted", "owner"),
  template("stock_owner_supplier_declined", "owner_supplier_declined", "owner"),
  template("stock_owner_supplier_silent", "owner_supplier_silent", "owner"),
];

const catalogue = createMetaCatalogue<MessageFacts, TemplateId, Slot>({ templates: META_TEMPLATES, values: VALUE });

/** Every template name, for a provider (or the stand-in) to approve. */
export const META_TEMPLATE_NAMES: readonly string[] = catalogue.names;
export const slotsOf = catalogue.slotsOf;
export const parametersFor = catalogue.parametersFor;
export const templateMessage = catalogue.templateMessage;
export { META_LANGUAGE, fillBody, metaBody };

/** Example values for Meta's review: a believable order of the example shop, in the template's own language. */
export function exampleFacts(settings: Settings, language: Language): MessageFacts {
  const line = settings.catalogue[0];
  const supplier = supplierOf(settings, line.supplier);
  const qty = line.reorderQty ?? 10;
  const unitPaise = paise(line.priceInr);
  const total = (unitPaise * qty) / 100;
  return {
    language, timeZone: settings.timezone, businessName: settings.name, supplierName: supplier.name, itemName: nameIn(itemOf(settings, line.item).names, language), unitName: nameIn(unitOf(settings, line.unit).names, language),
    qty, unitPriceInr: line.priceInr, totalInr: total, orderRef: "po-3", code: "K7M2QX", budgetInr: settings.limits.monthlyBudgetInr, reservedInr: 0, leftInr: Math.max(0, settings.limits.monthlyBudgetInr - total),
    hours: settings.followUpHours.at(-1) ?? 24, monthLabel: "Nov 2026", refs: ["po-3"],
  };
}

/** One entry per template and language, in the body Meta's create-template call takes (POST /{waba-id}/message_templates). */
export const metaSubmissions = (settings: Settings) => catalogue.submissions((language) => exampleFacts(settings, language));
