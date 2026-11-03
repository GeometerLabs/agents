// The WhatsApp templates in the form Meta approves them: fixed wording, with numbered {{1}}, {{2}} ... for values that come from the record.
//
// Why these exist: outside the customer's 24-hour window WhatsApp only carries a pre-approved template. Meta will not approve a template
// that is only a variable, and a parameter cannot hold line breaks, so "the whole rendered text" cannot be one parameter. Each template
// below has the wording of ONE message (the one in language/templates.ts that its `usedFor` names), with the record's values as parameters.
// The wording is the same in both places, so what the customer receives is what the outgoing check read; a test and a runtime guard
// (templateMessage below) both insist on it. A message with no template here (or one made of several templates) still goes out as free text
// inside the window, and outside it is refused by the provider, which fails closed. Which messages still need a template: Deferred.md.
//
// Rules kept (Meta's template overview, https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview):
// lowercase names with underscores, one language per submission, an example value for every parameter. Also kept, from Meta's template
// review: a body neither starts nor ends with a parameter. Every body below starts and ends with fixed words.
//
// Hindi, Malayalam and Kannada wording is machine-written like the rest of those packs. A native speaker must read it before it is submitted.
import { LANGUAGES, serviceName } from "../settings.ts";
import type { Language, Settings } from "../settings.ts";
import type { TemplateMessage } from "../adapters/messaging.ts";
import { inr, need, slot } from "./templates.ts";
import type { MessageFacts, TemplateId } from "./templates.ts";

/** Our languages as Meta's template language codes. */
export const META_LANGUAGE: Record<Language, string> = { en: "en", hi: "hi", ml: "ml", kn: "kn" };

/** The record values a template can use, and where each comes from. */
export type Slot = "business" | "service" | "slot" | "deposit" | "refund" | "hours" | "phone" | "ref";
const VALUE: Record<Slot, (f: MessageFacts) => string> = {
  business: (f) => f.businessName,
  service: (f) => need(f, "serviceName"),
  slot: (f) => slot(f),
  deposit: (f) => inr(f, "depositInr"),
  refund: (f) => inr(f, "refundInr"),
  hours: (f) => String(need(f, "windowHours")),
  phone: (f) => need(f, "customerPhone"),
  ref: (f) => need(f, "bookingRef"),
};

export interface MetaTemplate {
  /** The name registered with Meta (lowercase, underscores). */
  name: string;
  /** The message in language/templates.ts whose wording this carries. */
  usedFor: TemplateId;
  audience: "customer" | "owner";
  /** The wording per language, with {slot} where a record value goes (see Slot). Turned into {{n}} for Meta. */
  bodies: Record<Language, string>;
}

export const META_TEMPLATES: readonly MetaTemplate[] = [
  {
    name: "booking_reminder", usedFor: "reminder", audience: "customer",
    bodies: {
      en: "Reminder: your {service} at {business} is on {slot}.",
      hi: "याद दिलाना: {business} में आपका {service} {slot} पर है।",
      ml: "ഓർമ്മപ്പെടുത്തൽ: {business}-ൽ നിങ്ങളുടെ {service} ബുക്കിംഗ് സമയം: {slot}.",
      kn: "ನೆನಪಿಸುವುದು: {business}-ನಲ್ಲಿ ನಿಮ್ಮ {service} ಬುಕಿಂಗ್ ಸಮಯ: {slot}.",
    },
  },
  {
    name: "booking_confirmed", usedFor: "booked", audience: "customer",
    bodies: {
      en: "Booked! {service} on {slot}. Your {deposit} deposit is received. Cancel at least {hours} hours before the start for a refund.",
      hi: "बुक हो गया! {service}, {slot}। आपका {deposit} जमा हो गया है। रिफंड के लिए शुरू होने से कम से कम {hours} घंटे पहले रद्द करें।",
      ml: "ബുക്ക് ആയി! {service}, {slot}. നിങ്ങളുടെ {deposit} അഡ്വാൻസ് ലഭിച്ചു. പണം തിരികെ വേണമെങ്കിൽ തുടങ്ങുന്നതിന് കുറഞ്ഞത് {hours} മണിക്കൂർ മുമ്പ് റദ്ദാക്കണം.",
      kn: "ಬುಕ್ ಆಗಿದೆ! {service}, {slot}. ನಿಮ್ಮ {deposit} ಮುಂಗಡ ಹಣ ಸಿಕ್ಕಿದೆ. ಹಣ ಮರಳಿ ಬೇಕಾದರೆ ಪ್ರಾರಂಭಕ್ಕೆ ಕನಿಷ್ಠ {hours} ಗಂಟೆ ಮೊದಲು ರದ್ದುಗೊಳಿಸಿ.",
    },
  },
  {
    name: "booking_not_confirmed", usedFor: "couldnt_confirm", audience: "customer",
    bodies: {
      en: "We received your {deposit} deposit, but I couldn't confirm {slot} in our calendar yet, so it is not booked. I've told the owner, who will contact you.",
      hi: "आपका {deposit} जमा मिल गया है, लेकिन {slot} को हमारे कैलेंडर में अभी पक्का नहीं कर पाया, इसलिए बुकिंग पक्की नहीं है। मैंने मालिक को बता दिया है, वे आपसे संपर्क करेंगे।",
      ml: "നിങ്ങളുടെ {deposit} അഡ്വാൻസ് ലഭിച്ചു, പക്ഷേ {slot} ഞങ്ങളുടെ കലണ്ടറിൽ ഇതുവരെ ഉറപ്പിക്കാൻ കഴിഞ്ഞില്ല, അതിനാൽ ബുക്കിംഗ് ആയിട്ടില്ല. ഉടമയെ അറിയിച്ചിട്ടുണ്ട്, അവർ നിങ്ങളെ ബന്ധപ്പെടും.",
      kn: "ನಿಮ್ಮ {deposit} ಮುಂಗಡ ಹಣ ಸಿಕ್ಕಿದೆ, ಆದರೆ {slot} ಸಮಯವನ್ನು ನಮ್ಮ ಕ್ಯಾಲೆಂಡರ್‌ನಲ್ಲಿ ಇನ್ನೂ ಖಚಿತಪಡಿಸಲು ಆಗಲಿಲ್ಲ, ಆದ್ದರಿಂದ ಬುಕಿಂಗ್ ಆಗಿಲ್ಲ. ಮಾಲೀಕರಿಗೆ ತಿಳಿಸಿದ್ದೇನೆ, ಅವರು ನಿಮ್ಮನ್ನು ಸಂಪರ್ಕಿಸುತ್ತಾರೆ.",
    },
  },
  {
    name: "booking_rescheduled", usedFor: "rescheduled", audience: "customer",
    bodies: {
      en: "Done. Your {service} is moved to {slot}.",
      hi: "हो गया। आपका {service} अब {slot} पर है।",
      ml: "മാറ്റിയിട്ടുണ്ട്. {service} പുതിയ സമയം: {slot}.",
      kn: "ಆಯಿತು. {service} ಹೊಸ ಸಮಯ: {slot}.",
    },
  },
  {
    name: "deposit_refund_approved", usedFor: "refund_approved", audience: "customer",
    bodies: {
      en: "The owner approved your refund. {refund} is on its way.",
      hi: "मालिक ने आपके रिफंड को मंज़ूरी दे दी है। {refund} आपको वापस भेजा जा रहा है।",
      ml: "ഉടമ നിങ്ങളുടെ റീഫണ്ട് അംഗീകരിച്ചു. {refund} തിരികെ വരുന്നുണ്ട്.",
      kn: "ಮಾಲೀಕರು ನಿಮ್ಮ ರೀಫಂಡ್ ಒಪ್ಪಿದ್ದಾರೆ. {refund} ಮರಳಿ ಬರುತ್ತಿದೆ.",
    },
  },
  {
    name: "deposit_paid_twice", usedFor: "duplicate_refund", audience: "customer",
    bodies: {
      en: "You paid the deposit twice. The extra {refund} is being refunded.",
      hi: "आपने जमा राशि दो बार भर दी। अतिरिक्त {refund} वापस किया जा रहा है।",
      ml: "നിങ്ങൾ അഡ്വാൻസ് രണ്ടു തവണ അടച്ചു. അധികമായി അടച്ച {refund} തിരികെ നൽകുന്നുണ്ട്.",
      kn: "ನೀವು ಮುಂಗಡ ಹಣವನ್ನು ಎರಡು ಬಾರಿ ಪಾವತಿಸಿದ್ದೀರಿ. ಹೆಚ್ಚುವರಿ {refund} ಮರಳಿ ಕೊಡಲಾಗುತ್ತಿದೆ.",
    },
  },
  {
    name: "owner_approval_request", usedFor: "owner_refund_needs_approval", audience: "owner",
    bodies: {
      en: 'Approval needed: refund {refund} for {phone} ({service}, {slot}). Reply "approve {ref}" or "deny {ref}".',
      hi: 'मंज़ूरी चाहिए: {phone} ({service}, {slot}) को {refund} का रिफंड। जवाब दें "approve {ref}" या "deny {ref}"।',
      ml: 'അനുമതി വേണം: {phone} ({service}, {slot}) എന്നവർക്ക് {refund} റീഫണ്ട്. "approve {ref}" അല്ലെങ്കിൽ "deny {ref}" എന്ന് മറുപടി അയയ്ക്കൂ.',
      kn: 'ಅನುಮತಿ ಬೇಕು: {phone} ({service}, {slot}) ಅವರಿಗೆ {refund} ರೀಫಂಡ್. "approve {ref}" ಅಥವಾ "deny {ref}" ಎಂದು ಉತ್ತರಿಸಿ.',
    },
  },
];

/** Every template name, for a provider (or the stand-in) to approve. */
export const META_TEMPLATE_NAMES: readonly string[] = META_TEMPLATES.map((t) => t.name);

const SLOT_RE = /\{([a-z]+)\}/gu;

/** The slots of a body in the order they appear. The same value twice is two parameters, because a Meta parameter number is used once. */
export function slotsOf(body: string): Slot[] {
  return [...body.matchAll(SLOT_RE)].map((m) => {
    if (!(m[1] in VALUE)) throw new Error(`The template body has an unknown value {${m[1]}}.`);
    return m[1] as Slot;
  });
}

/** The body as Meta wants it: {slot} turned into {{1}}, {{2}} ... in order. */
export function metaBody(body: string): string {
  let n = 0;
  return body.replace(SLOT_RE, () => `{{${++n}}}`);
}

/** Fill a Meta body ({{1}} ...) with parameters: what the customer will read. */
export function fillBody(metaText: string, parameters: string[]): string {
  return metaText.replace(/\{\{(\d+)\}\}/gu, (_m, n: string) => parameters[Number(n) - 1] ?? "");
}

/** The parameter values for a template in a language, read from the record's facts. Throws if the record lacks one. */
export function parametersFor(template: MetaTemplate, language: Language, facts: MessageFacts): string[] {
  return slotsOf(template.bodies[language]).map((s) => VALUE[s](facts));
}

const BY_MESSAGE = new Map<TemplateId, MetaTemplate>(META_TEMPLATES.map((t) => [t.usedFor, t]));

/**
 * The template message for text that must go out as a template. A message that is exactly one of the templates above goes as that
 * template with its parameters, but only if filling it gives back the very text the outgoing check read. Anything else goes as the
 * generic name with no parameters, as before (a provider that knows only the real templates then refuses it).
 */
export function templateMessage(a: { ids: TemplateId[]; language: Language; facts: MessageFacts; text: string; generic: string }): TemplateMessage {
  const found = a.ids.length === 1 ? BY_MESSAGE.get(a.ids[0]) : undefined;
  if (found) {
    try {
      const parameters = parametersFor(found, a.language, a.facts);
      if (fillBody(metaBody(found.bodies[a.language]), parameters) === a.text) return { name: found.name, language: a.language, text: a.text, parameters };
    } catch { /* the record lacks a value: the message would not have been written either */ }
  }
  return { name: a.generic, language: a.language, text: a.text };
}

// ---- the list to submit ------------------------------------------------------------------------------------------------------

/** Example values for Meta's review: a believable Glow Salon booking, in the template's own language. */
export function exampleFacts(settings: Settings, language: Language): MessageFacts {
  return {
    language, timeZone: settings.timezone, businessName: settings.name,
    services: settings.services.map((s) => ({ name: serviceName(s, language), priceInr: s.priceInr })),
    serviceName: serviceName(settings.services[0], language), priceInr: settings.services[0].priceInr,
    depositInr: settings.deposit.amountInr, refundInr: settings.deposit.amountInr,
    slotMs: Date.UTC(2026, 10, 10, 12, 30), // Tue 10 Nov 2026, 6:00 pm in India
    link: "https://rzp.io/i/example", holdMinutes: settings.deposit.holdMinutes, windowHours: settings.cancellation.windowHours,
    bookingRef: "b-3", customerPhone: "+919811111111",
  };
}

export interface MetaSubmission {
  name: string; language: string; category: "UTILITY"; parameter_format: "positional";
  components: { type: "BODY"; text: string; example: { body_text: string[][] } }[];
}

/** One entry per template and language, in the body Meta's create-template call takes (POST /{waba-id}/message_templates). */
export function metaSubmissions(settings: Settings): MetaSubmission[] {
  return META_TEMPLATES.flatMap((t) => LANGUAGES.map((language) => ({
    name: t.name, language: META_LANGUAGE[language], category: "UTILITY", parameter_format: "positional",
    components: [{ type: "BODY", text: metaBody(t.bodies[language]), example: { body_text: [parametersFor(t, language, exampleFacts(settings, language))] } }],
  })));
}
