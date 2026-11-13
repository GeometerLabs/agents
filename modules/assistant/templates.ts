// The shop's assistant's WhatsApp templates (item 11e): the messages it may send outside a person's 24-hour window. Used by morning.ts (the morning line to the
// owner) and conversation.ts (a closed or reopened day, to the customers booked that day); the template ids and bodies go to Meta with item 12's submission.
// Item 11i: the morning line is one template per personality (personality.ts: only its opening and sign-off differ), and each has an image header that carries the
// shop's mood picture (the character's PNG, served by the shop's own server), so the morning line shows the mood outside the 24-hour window too.
//
// The text sent is ALWAYS the template's body filled in (`render`), inside the window as well, so what the outgoing check reads is what Meta approved, word for word
// (modules/language/meta-templates.ts insists on it). Each value goes through the Writer (words.ts), so it is checked against the record's values. The bodies start
// and end with fixed words, as Meta's review wants. Hindi, Malayalam and Kannada are machine-written and on the review list before submission.
import { createMetaCatalogue, fillBody, metaBody } from "../language/meta-templates.ts";
import { LANGUAGES } from "../language/languages.ts";
import { PERSONALITIES, SMALL_TALK } from "./personality.ts";
import type { Personality } from "./personality.ts";
import type { MetaTemplate } from "../language/meta-templates.ts";
import type { CheckFacts } from "../language/check.ts";
import type { Language } from "../language/languages.ts";
import type { TemplateMessage } from "../messaging/messaging.ts";
import type { LocalDate } from "../core/time.ts";
import { Writer } from "./words.ts";

export type AssistantTemplateId = "morning" | "morning_cheerful" | "morning_brief" | "day_closed" | "day_open";
type Slot = "shop" | "date" | "time" | "today" | "money" | "waiting";

/** The middle of the morning line, the same for every personality: the values, with fixed words around each. */
const MORNING_MIDDLE: Record<Language, string> = {
  en: "Today, {date}: {today}. Recorded yesterday: {money}. Waiting for you: {waiting}.",
  hi: "आज, {date}: {today}। कल दर्ज: {money}। आपके लिए बाकी: {waiting}।",
  ml: "ഇന്ന്, {date}: {today}. ഇന്നലെ രേഖപ്പെടുത്തിയത്: {money}. നിങ്ങൾക്കായി കാത്തിരിക്കുന്നവ: {waiting}.",
  kn: "ಇಂದು, {date}: {today}. ನಿನ್ನೆ ದಾಖಲಾದದ್ದು: {money}. ನಿಮಗಾಗಿ ಕಾಯುತ್ತಿರುವವು: {waiting}.",
};

/**
 * Each personality's morning template (personality.ts): its opening, the middle and its sign-off. The warm one keeps the template name `owner_morning` and its words,
 * less the character's name (owner, 14 Nov: a character has a name only when the partner gives it one, and a template cannot leave a value out).
 */
export const MORNING_TEMPLATE_OF: Record<Personality, AssistantTemplateId> = { warm: "morning", cheerful: "morning_cheerful", brief: "morning_brief" };
const morningTemplate = (p: Personality): MetaTemplate<AssistantTemplateId> => ({
  name: p === "warm" ? "owner_morning" : `owner_morning_${p}`, usedFor: MORNING_TEMPLATE_OF[p], audience: "owner",
  // item 11i: the morning line carries the shop's mood picture as an image header, so the owner sees it outside the 24-hour window too (character.ts)
  header: "image",
  bodies: Object.fromEntries(LANGUAGES.map((l) => [l, `${SMALL_TALK[p][l].morningOpening} ${MORNING_MIDDLE[l]} ${SMALL_TALK[p][l].morningSignOff}`])) as Record<Language, string>,
});

const TEMPLATES: readonly MetaTemplate<AssistantTemplateId>[] = [
  ...PERSONALITIES.map(morningTemplate),
  {
    name: "booking_day_closed", usedFor: "day_closed", audience: "customer",
    bodies: {
      en: "Sorry: {shop} is closed on {date}, so your booking at {time} cannot go ahead that day. Reply with another day and time to move it, or CANCEL to cancel it.",
      hi: "माफ़ कीजिए: {shop} {date} को बंद है, इसलिए {time} की आपकी बुकिंग उस दिन नहीं हो पाएगी। इसे बदलने के लिए दूसरा दिन और समय लिखें, या रद्द करने के लिए CANCEL लिखें।",
      ml: "ക്ഷമിക്കണം: {shop} {date}-ന് അടച്ചിരിക്കും, അതിനാൽ {time}-നുള്ള നിങ്ങളുടെ ബുക്കിംഗ് ആ ദിവസം നടക്കില്ല. മാറ്റാൻ മറ്റൊരു ദിവസവും സമയവും മറുപടി നൽകുക, അല്ലെങ്കിൽ റദ്ദാക്കാൻ CANCEL എന്ന് അയയ്ക്കുക.",
      kn: "ಕ್ಷಮಿಸಿ: {shop} {date} ರಂದು ಮುಚ್ಚಿರುತ್ತದೆ, ಹಾಗಾಗಿ {time} ರ ನಿಮ್ಮ ಬುಕಿಂಗ್ ಆ ದಿನ ನಡೆಯುವುದಿಲ್ಲ. ಬದಲಾಯಿಸಲು ಬೇರೆ ದಿನ ಮತ್ತು ಸಮಯ ಉತ್ತರಿಸಿ, ಅಥವಾ ರದ್ದು ಮಾಡಲು CANCEL ಎಂದು ಕಳುಹಿಸಿ.",
    },
  },
  {
    name: "booking_day_open", usedFor: "day_open", audience: "customer",
    bodies: {
      en: "Good news: {shop} is open on {date} after all. Your booking at {time} stands. Reply here if you have already made other plans.",
      hi: "अच्छी ख़बर: {shop} {date} को खुला रहेगा। {time} की आपकी बुकिंग पक्की है। अगर आपने कुछ और तय कर लिया है तो यहाँ जवाब दें।",
      ml: "സന്തോഷവാർത്ത: {shop} {date}-ന് തുറന്നിരിക്കും. {time}-നുള്ള നിങ്ങളുടെ ബുക്കിംഗ് നിലനിൽക്കും. മറ്റ് പദ്ധതികൾ ഇതിനകം ഉണ്ടെങ്കിൽ ഇവിടെ മറുപടി നൽകുക.",
      kn: "ಶುಭ ಸುದ್ದಿ: {shop} {date} ರಂದು ತೆರೆದಿರುತ್ತದೆ. {time} ರ ನಿಮ್ಮ ಬುಕಿಂಗ್ ಉಳಿದಿದೆ. ಬೇರೆ ಯೋಜನೆ ಮಾಡಿದ್ದರೆ ಇಲ್ಲಿ ಉತ್ತರಿಸಿ.",
    },
  },
];

/** What a template message is written from: its values already formatted, and the facts they were noted in. */
export interface TemplateFacts { language: Language; values: Partial<Record<Slot, string>>; check: CheckFacts }

const value = (slot: Slot) => (f: TemplateFacts): string => {
  const v = f.values[slot];
  if (v === undefined) throw new Error(`The template needs a value for {${slot}}.`);
  return v;
};

export const assistantCatalogue = createMetaCatalogue<TemplateFacts, AssistantTemplateId, Slot>({
  templates: TEMPLATES,
  values: { shop: value("shop"), date: value("date"), time: value("time"), today: value("today"), money: value("money"), waiting: value("waiting") },
});

/** The text of a template in a language with these values: the body filled in, exactly as Meta would show it. */
export function render(id: AssistantTemplateId, f: TemplateFacts): string {
  const t = TEMPLATES.find((x) => x.usedFor === id)!;
  return fillBody(metaBody(t.bodies[f.language]), assistantCatalogue.parametersFor(t, f.language, f));
}

/** The name a template is submitted and sent under (owner_morning, owner_morning_cheerful ...). */
export const templateNameOf = (id: AssistantTemplateId): string => TEMPLATES.find((t) => t.usedFor === id)!.name;

/** The template message for the same text (outside the window). Its text must equal `render`'s, or it goes under a name no provider knows and is refused. */
export const templateMessageFor = (id: AssistantTemplateId, f: TemplateFacts, text: string): TemplateMessage =>
  assistantCatalogue.templateMessage({ ids: [id], language: f.language, facts: f, text, generic: "assistant_no_template" });

/** The words of the morning line's parts, in each language. A part is a phrase inside the template (no line break, as Meta requires of a value). */
const MORNING_PARTS: Record<Language, { bookings: (n: string, first: string) => string; noBookings: string; owes: (n: string, amount: string) => string; open: (n: string) => string; nothing: string }> = {
  en: { bookings: (n, first) => `bookings: ${n}, the first at ${first}`, noBookings: "no bookings", owes: (n, amount) => `fees not paid: ${n} (${amount})`, open: (n) => `open orders: ${n}`, nothing: "nothing" },
  hi: { bookings: (n, first) => `बुकिंग: ${n}, पहली ${first}`, noBookings: "कोई बुकिंग नहीं", owes: (n, amount) => `बाकी फीस: ${n} (${amount})`, open: (n) => `खुले ऑर्डर: ${n}`, nothing: "कुछ नहीं" },
  ml: { bookings: (n, first) => `ബുക്കിംഗുകൾ: ${n}, ആദ്യത്തേത് ${first}`, noBookings: "ബുക്കിംഗുകൾ ഇല്ല", owes: (n, amount) => `അടയ്ക്കാത്ത ഫീസ്: ${n} (${amount})`, open: (n) => `തുറന്ന ഓർഡറുകൾ: ${n}`, nothing: "ഒന്നുമില്ല" },
  kn: { bookings: (n, first) => `ಬುಕಿಂಗ್‌ಗಳು: ${n}, ಮೊದಲನೆಯದು ${first}`, noBookings: "ಯಾವುದೇ ಬುಕಿಂಗ್ ಇಲ್ಲ", owes: (n, amount) => `ಪಾವತಿಯಾಗದ ಫೀಸ್: ${n} (${amount})`, open: (n) => `ತೆರೆದ ಆರ್ಡರ್‌ಗಳು: ${n}`, nothing: "ಏನೂ ಇಲ್ಲ" },
};

/** What today holds, by skill: a booking shop's day, a centre's unpaid fees, a shop's open orders. A shop with several skills has several parts. */
export type MorningToday = { bookings: number; firstMs?: number } | { owes: number; owedPaise: number } | { open: number };

/** The morning line's facts: what today holds, money recorded yesterday, and how many things wait. */
export function morningFacts(a: { language: Language; timeZone: string; shop: string; today: LocalDate; parts: MorningToday[]; moneyPaise: number; waiting: number }): TemplateFacts {
  const w = new Writer(a.language, a.timeZone);
  const p = MORNING_PARTS[a.language];
  const part = (t: MorningToday): string =>
    "bookings" in t ? (t.bookings > 0 && t.firstMs !== undefined ? p.bookings(w.n(t.bookings), w.time(t.firstMs)) : p.noBookings)
      : "owes" in t ? (t.owes > 0 ? p.owes(w.n(t.owes), w.inr(t.owedPaise)) : p.nothing) : t.open > 0 ? p.open(w.n(t.open)) : p.nothing;
  const values = {
    shop: w.lit(a.shop), date: w.date(a.today),
    today: a.parts.length > 0 ? a.parts.map(part).join(", ") : p.nothing,
    money: a.moneyPaise > 0 ? w.inr(a.moneyPaise) : p.nothing,
    waiting: a.waiting > 0 ? w.n(a.waiting) : p.nothing,
  };
  return { language: a.language, values, check: w.check() };
}

/** A closed or reopened day's facts, for one customer's booking. */
export function dayFacts(a: { language: Language; timeZone: string; shop: string; date: LocalDate; startMs: number }): TemplateFacts {
  const w = new Writer(a.language, a.timeZone);
  return { language: a.language, values: { shop: w.lit(a.shop), date: w.date(a.date), time: w.time(a.startMs) }, check: w.check() };
}

/** Every template in every language, in the body Meta's create-template call takes: for item 12's submission. */
export function assistantSubmissions() {
  return assistantCatalogue.submissions((language) => {
    const today = { year: 2026, month: 11, day: 12 };
    const facts = morningFacts({ language, timeZone: "Asia/Kolkata", shop: "Glow Salon", today, parts: [{ bookings: 6, firstMs: Date.UTC(2026, 10, 12, 4, 30) }], moneyPaise: 140_000, waiting: 2 });
    const day = dayFacts({ language, timeZone: "Asia/Kolkata", shop: "Glow Salon", date: today, startMs: Date.UTC(2026, 10, 12, 10, 30) });
    return { ...facts, values: { ...facts.values, time: day.values.time } };
  });
}
