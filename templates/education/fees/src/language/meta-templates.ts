// The WhatsApp templates in the form Meta approves them: fixed wording, with numbered {{1}}, {{2}} ... for values that come from the record.
//
// Why these exist: outside the parent's 24-hour window WhatsApp only carries a pre-approved template, and a fee reminder is sent by the agent, not as a reply, so
// it nearly always goes out in a closed window. Each template below is the wording of ONE message of language/templates.ts, with the record's values as
// parameters. The wording is NOT written a second time: it is read out of the message itself, by writing the message once with stand-in values and turning the
// stand-ins into {slots}. So what the parent receives is always what the outgoing check read, and the Hindi, Malayalam and Kannada wording that a native
// speaker reviews exists in one place. The mechanism is shared (modules/language/meta-templates.ts); a test checks every body starts and ends with fixed words
// (Meta rejects a body that starts or ends with a parameter) and fills back into the very text.
import { formatDate, formatInr } from "../../../../../modules/language/format.ts";
import { LANGUAGES } from "../../../../../modules/language/languages.ts";
import type { Language } from "../../../../../modules/language/languages.ts";
import { META_LANGUAGE, createMetaCatalogue, fillBody, metaBody } from "../../../../../modules/language/meta-templates.ts";
import type { MetaTemplate } from "../../../../../modules/language/meta-templates.ts";
import { localParts } from "../../../../../modules/core/time.ts";
import { monthLabel } from "../due.ts";
import { batchName } from "../settings.ts";
import type { Settings } from "../settings.ts";
import { dueDate, inr, need, payTo, render } from "./templates.ts";
import type { MessageFacts, TemplateId } from "./templates.ts";

/** The record values a template can use, and where each comes from. */
export type Slot = "business" | "student" | "batch" | "month" | "fee" | "late" | "balance" | "paid" | "received" | "waiver" | "refund" | "limit" | "date" | "link" | "phone" | "ref" | "req" | "code" | "hours" | "upiCode";
const VALUE: Record<Slot, (f: MessageFacts) => string> = {
  business: (f) => f.businessName,
  student: (f) => need(f, "studentName"),
  batch: (f) => need(f, "batchName"),
  month: (f) => need(f, "monthLabel"),
  fee: (f) => inr(f, "feeInr"),
  late: (f) => inr(f, "lateFeeInr"),
  balance: (f) => inr(f, "balanceInr"),
  paid: (f) => inr(f, "paidInr"),
  received: (f) => inr(f, "receivedInr"),
  waiver: (f) => inr(f, "waiverInr"),
  refund: (f) => inr(f, "refundInr"),
  limit: (f) => inr(f, "waiverLimitInr"),
  date: (f) => dueDate(f),
  link: (f) => payTo(f),
  phone: (f) => need(f, "customerPhone"),
  ref: (f) => need(f, "dueRef"),
  req: (f) => need(f, "requestRef"),
  code: (f) => need(f, "approvalCode"),
  hours: (f) => String(need(f, "approvalHours")),
  upiCode: (f) => need(f, "upiCode"),
};

/** The stand-in values a message is written once with, and the slot each becomes. Each is unlike anything a template says on its own. */
const STAND_IN_TEXT: Partial<Record<Slot, string>> = { business: "§business§", student: "§student§", batch: "§batch§", month: "§month§", link: "§link§", phone: "§phone§", ref: "§ref§", req: "§req§", code: "§code§", upiCode: "§upicode§" };
const STAND_IN_AMOUNT: Partial<Record<Slot, number>> = { fee: 7_000_001, late: 7_000_002, balance: 7_000_003, paid: 7_000_004, received: 7_000_005, waiver: 7_000_006, refund: 7_000_007, limit: 7_000_008 };
const STAND_IN_DUE_MS = Date.UTC(2030, 5, 14, 0, 0); // a date no message of ours would state (Fri 14 Jun 2030)
const STAND_IN_HOURS = 7_000_009;

function standInFacts(language: Language): MessageFacts {
  const facts: MessageFacts = { language, timeZone: "UTC", businessName: STAND_IN_TEXT.business!, dueMs: STAND_IN_DUE_MS, approvalHours: STAND_IN_HOURS };
  const set = facts as unknown as Record<string, unknown>;
  const names: Partial<Record<Slot, string>> = { student: "studentName", batch: "batchName", month: "monthLabel", link: "link", phone: "customerPhone", ref: "dueRef", req: "requestRef", code: "approvalCode", upiCode: "upiCode" };
  for (const [slot, key] of Object.entries(names)) set[key] = STAND_IN_TEXT[slot as Slot];
  const amounts: Partial<Record<Slot, string>> = { fee: "feeInr", late: "lateFeeInr", balance: "balanceInr", paid: "paidInr", received: "receivedInr", waiver: "waiverInr", refund: "refundInr", limit: "waiverLimitInr" };
  for (const [slot, key] of Object.entries(amounts)) set[key] = STAND_IN_AMOUNT[slot as Slot];
  return facts;
}

/** The message written once with stand-ins, and each stand-in turned into its {slot}: the wording of the template, in a language. */
function bodyOf(id: TemplateId, language: Language): string {
  let text = render(id, standInFacts(language));
  for (const [slot, stand] of Object.entries(STAND_IN_TEXT)) text = text.split(stand!).join(`{${slot}}`);
  for (const [slot, n] of Object.entries(STAND_IN_AMOUNT)) text = text.split(formatInr(n)).join(`{${slot}}`);
  text = text.split(formatDate(localParts(STAND_IN_DUE_MS, "UTC"), language)).join("{date}");
  return text.split(String(STAND_IN_HOURS)).join("{hours}");
}

function template(name: string, usedFor: TemplateId, audience: "customer" | "owner"): MetaTemplate<TemplateId> {
  return { name, usedFor, audience, bodies: Object.fromEntries(LANGUAGES.map((l) => [l, bodyOf(usedFor, l)])) as Record<Language, string> };
}

/**
 * The messages that go out on the agent's own, so often outside the 24-hour window: the reminders and the receipts to parents, and what the owner is told
 * or asked. The answers to what a parent just wrote are inside the window, and go as plain text.
 */
export const META_TEMPLATES: readonly MetaTemplate<TemplateId>[] = [
  template("fee_reminder", "fee_reminder", "customer"),
  template("fee_overdue", "fee_overdue", "customer"),
  template("fee_overdue_late", "fee_overdue_late", "customer"),
  template("fee_received", "fee_received", "customer"),
  template("fee_part_received", "fee_part_received", "customer"),
  template("owner_waiver_asks", "owner_waiver_request", "owner"),
  template("owner_waiver_done", "owner_waiver_applied", "owner"),
  template("owner_refund_asks", "owner_refund_request", "owner"),
  template("owner_discount_asked", "owner_discount_note", "owner"),
  template("owner_payment_claimed", "owner_payment_claim", "owner"),
  template("owner_fee_overpaid", "owner_overpayment", "owner"),
  template("owner_fee_link_failed", "owner_link_failed", "owner"),
  template("owner_parent_wants_you", "owner_wants_to_talk", "owner"),
  template("owner_parent_stopped", "owner_opted_out", "owner"),
  template("owner_fee_approval_request", "owner_refund_needs_approval", "owner"),
  // UPI centres (B33): what the owner is asked to look for or send back, and what the parent hears about a refund, which can come days later
  template("owner_fee_upi_check", "owner_fee_upi_expected", "owner"),
  template("owner_fee_upi_parent_says_paid", "owner_fee_upi_claim", "owner"),
  template("owner_fee_upi_refund_to_send", "owner_fee_upi_refund_owed", "owner"),
  template("owner_fee_upi_refund_reminder", "owner_fee_upi_refund_reminder", "owner"),
  template("fee_upi_refund_coming", "fee_upi_refund_owed", "customer"),
  template("fee_upi_refund_marked_sent", "fee_upi_refund_sent", "customer"),
];

const catalogue = createMetaCatalogue<MessageFacts, TemplateId, Slot>({ templates: META_TEMPLATES, values: VALUE });

/** Every template name, for a provider (or the stand-in) to approve. */
export const META_TEMPLATE_NAMES: readonly string[] = catalogue.names;
export const slotsOf = catalogue.slotsOf;
export const parametersFor = catalogue.parametersFor;
export const templateMessage = catalogue.templateMessage;
export { META_LANGUAGE, fillBody, metaBody };

// ---- the list to submit ------------------------------------------------------------------------------------------------------

/** Example values for Meta's review: a believable fee of the example centre, in the template's own language. */
export function exampleFacts(settings: Settings, language: Language): MessageFacts {
  const batch = settings.batches[0];
  return {
    language, timeZone: settings.timezone, businessName: settings.name,
    studentName: settings.students[0].name, batchName: batchName(batch, language), monthLabel: monthLabel({ month: "2026-11" }, language),
    feeInr: batch.monthlyFeeInr, lateFeeInr: settings.lateFeeInr || 100, balanceInr: batch.monthlyFeeInr, paidInr: batch.monthlyFeeInr, receivedInr: batch.monthlyFeeInr,
    waiverInr: settings.waiver.limitInr || 100, refundInr: batch.monthlyFeeInr, waiverLimitInr: settings.waiver.limitInr,
    dueMs: Date.UTC(2026, 10, 4, 18, 30), // Thu 5 Nov 2026 at midnight in India
    link: "https://rzp.io/i/example", dueRef: "f-3", requestRef: "q-2", customerPhone: "+919811111111", approvalCode: "K7M2QX", approvalHours: 24, upiCode: "P4XR9T",
  };
}

/** One entry per template and language, in the body Meta's create-template call takes (POST /{waba-id}/message_templates). */
export const metaSubmissions = (settings: Settings) => catalogue.submissions((language) => exampleFacts(settings, language));
