// What the shop's assistant says (item 11e), in English, Hindi, Malayalam and Kannada: its answers to the owner, its cards, the morning line, and the two lines it sends a
// customer when the owner closes or reopens a day. Used by conversation.ts and morning.ts, through modules/messaging/say.ts (the one way a message leaves an agent).
//
// Every value is written through a `Writer`, which formats it AND notes it for the outgoing check (language/check.ts). So the check reads exactly the values the words
// state, and they come from the record (the skill's reads, a card's saved fields), never from a model. A stray number in a translation fails the check and is not sent.
// The three messages that may go outside the 24-hour window (the morning line, a day closed, a day open) are WhatsApp templates: their text is the template's body
// filled in, so what is checked is what Meta approved (templates.ts). The Hindi, Malayalam and Kannada are machine-written like the rest of the packs and are on the
// review list (item 12) before anything is submitted to Meta.
import { addDays, localParts, zonedToMs } from "../core/time.ts";
import type { LocalDate } from "../core/time.ts";
import { formatDate, formatInr, formatSlot, formatTime } from "../language/format.ts";
import type { CheckFacts } from "../language/check.ts";
import type { Language } from "../language/languages.ts";
import type { DayRow, MoveRefusal, OpenRow, OweRow, PrepareRefusal } from "./skill.ts";

/** Formats values in one language and remembers each one for the outgoing check. */
export class Writer {
  readonly language: Language;
  readonly timeZone: string;
  readonly facts: { language: Language; timeZone: string; amountsInr: number[]; counts: number[]; momentsMs: number[]; links: string[]; literals: string[] };
  constructor(language: Language, timeZone: string) {
    this.language = language;
    this.timeZone = timeZone;
    this.facts = { language, timeZone, amountsInr: [], counts: [], momentsMs: [], links: [], literals: [] };
  }
  /** An amount in paise, as rupees ("₹1,200"). */
  inr(paise: number): string { const rupees = paise / 100; this.facts.amountsInr.push(rupees); return formatInr(rupees); }
  /** A calendar date ("Sun 16 Nov"). Noted as noon that day, so the check knows the date (and no other). */
  date(d: LocalDate): string { this.facts.momentsMs.push(zonedToMs(d, { hour: 12, minute: 0 }, this.timeZone)); return formatDate(d, this.language); }
  /** A date and time ("Sun 16 Nov, 4:00 pm"). */
  slot(ms: number): string { this.facts.momentsMs.push(ms); return formatSlot(ms, this.timeZone, this.language); }
  /** A time of day ("4:00 pm"). */
  time(ms: number): string { this.facts.momentsMs.push(ms); return formatTime(localParts(ms, this.timeZone), this.language); }
  /** A count ("3"). */
  n(count: number): string { this.facts.counts.push(count); return String(count); }
  /** A name, a reference, a code or words the message repeats as they are. */
  lit(text: string): string { this.facts.literals.push(text); return text; }
  /** The facts as the outgoing check takes them. */
  check(): CheckFacts { return this.facts; }
}

/** One row of a list, "4:00 pm Haircut, Priya (b-14)", the same shape in every language. */
const dayRow = (w: Writer, r: DayRow) => `${w.time(r.startMs)} ${w.lit(r.what)}, ${w.lit(r.who)} (${w.lit(r.case)})`;
const oweRow = (w: Writer, r: OweRow) => `${w.lit(r.who)}, ${w.lit(r.what)}: ${w.inr(r.amountPaise)} (${w.lit(r.case)})`;
const openRow = (w: Writer, r: OpenRow) => `${w.lit(r.who)}, ${w.lit(r.what)}: ${w.inr(r.amountPaise)} (${w.lit(r.case)})`;

/** How many rows a list shows; the rest are counted ("and 4 more"). A WhatsApp text has room for more, but a phone screen does not. */
export const LIST_ROWS = 12;

/** The data each message is written from. */
export interface MessageData {
  day_list: { date: LocalDate; rows: DayRow[]; closed: boolean };
  owes_list: { rows: OweRow[] };
  open_list: { rows: OpenRow[] };
  waiting_head: { count: number };
  money_in: { date: LocalDate; paise: number; payments: number };
  closed: { date: LocalDate; booked: number; missed: { case: string; who: string }[] };
  already_closed: { date: LocalDate };
  weekday_closed: { date: LocalDate };
  not_closed: { date: LocalDate };
  reopened: { date: LocalDate; told: number };
  past_day: { date: LocalDate };
  undo_none: Record<string, never>;
  need_ref: { kind: "cancel" | "refund" | "message" | "move"; rows: DayRow[] };
  need_when: { ref: string };
  moved: { ref: string; toMs: number };
  moved_back: { ref: string; toMs: number };
  move_failed: { ref: string; why: MoveRefusal; toMs?: number };
  need_date: { kind: "close_day" | "reopen_day" };
  need_words: { ref: string };
  refusal: { why: PrepareRefusal; ref: string; who?: string; paidPaise?: number };
  card: { kind: string; itemKind?: string; who: string; ref: string; what: string; amountPaise: number; words?: string; aboveLimit?: boolean; code: string; hasNo: boolean };
  done: { note: "cancelled" | "refund_sent" | "held_by_guard" | "owed_by_owner" | "sent" | "answered" | "failed" | "not_sent"; who: string; ref: string; amountPaise: number };
  refused: Record<string, never>;
  refused_before: { atMs: number };
  card_changed: Record<string, never>;
  card_closed: Record<string, never>;
  card_expired: Record<string, never>;
  card_unknown: Record<string, never>;
  limit_no: Record<string, never>;
  help: { name: string; shop: string; kinds: readonly string[] };
  not_understood: { kinds: readonly string[] };
  not_offered: Record<string, never>;
  voice_unheard: Record<string, never>;
  owner_words: { shop: string; words: string };
}
export type MessageId = keyof MessageData;

type Words = { [K in MessageId]: (d: MessageData[K], w: Writer) => string };

/** "and 4 more" after a cut list. */
const more = (w: Writer, total: number, l: Record<Language, (n: string) => string>) => (total > LIST_ROWS ? `\n${l[w.language](w.n(total - LIST_ROWS))}` : "");
const MORE: Record<Language, (n: string) => string> = { en: (n) => `and ${n} more`, hi: (n) => `और ${n} और`, ml: (n) => `കൂടാതെ ${n} എണ്ണം കൂടി`, kn: (n) => `ಇನ್ನೂ ${n}` };

/** The short list of things to say, used by help and "didn't get that": only what this shop's skills offer. */
const EXAMPLES: Record<Language, Record<string, string>> = {
  en: { day: "tomorrow", waiting: "what needs me", money: "money today", close_day: "close Sunday", cancel: "cancel b-14", message: "message b-14 Running 15 minutes late", move: "move b-14 to 5pm", owes: "who owes fees", open_orders: "open orders", undo: "undo" },
  hi: { day: "कल", waiting: "मेरे लिए क्या है", money: "आज कितना आया", close_day: "रविवार बंद", cancel: "b-14 रद्द करो", message: "b-14 को बोलो 15 मिनट देर होगी", move: "b-14 शिफ्ट शाम 5 बजे", owes: "किसकी फीस बाकी है", open_orders: "ऑर्डर", undo: "वापस लो" },
  ml: { day: "നാളെ", waiting: "എനിക്ക് എന്താണ് ബാക്കി", money: "ഇന്ന് എത്ര കിട്ടി", close_day: "ഞായറാഴ്ച അടച്ചിടുക", cancel: "b-14 റദ്ദാക്കുക", message: "b-14 നോട് പറയുക 15 മിനിറ്റ് വൈകും", move: "b-14 വൈകുന്നേരം 5-ലേക്ക് മാറ്റുക", owes: "ആരുടെ ഫീസ് ബാക്കി", open_orders: "ഓർഡറുകൾ", undo: "പഴയപടി" },
  kn: { day: "ನಾಳೆ", waiting: "ನನಗೆ ಏನು ಬಾಕಿ", money: "ಇಂದು ಎಷ್ಟು ಬಂತು", close_day: "ಭಾನುವಾರ ಮುಚ್ಚಿ", cancel: "b-14 ರದ್ದು", message: "b-14 ಗೆ ಹೇಳಿ 15 ನಿಮಿಷ ತಡ", move: "b-14 ಸಂಜೆ 5 ಕ್ಕೆ ಶಿಫ್ಟ್", owes: "ಯಾರ ಫೀಸ್ ಬಾಕಿ", open_orders: "ಆರ್ಡರ್‌ಗಳು", undo: "ಹಿಂದಿನಂತೆ" },
};
/** The examples for the kinds offered, each on its own line. Their digits are part of the example, so they are literals. */
const examples = (w: Writer, kinds: readonly string[]) => Object.entries(EXAMPLES[w.language]).filter(([k]) => kinds.includes(k)).map(([, e]) => `• ${w.lit(e)}`).join("\n");

const REFUSAL: Record<Language, Record<PrepareRefusal, (w: Writer, d: MessageData["refusal"]) => string>> = {
  en: {
    no_case: (w, d) => `Nothing has the number ${w.lit(d.ref)}.`, not_yours: (w, d) => `${w.lit(d.ref)} is not something this assistant handles.`,
    already_back: (w, d) => `The deposit on ${w.lit(d.ref)} is already going back, so I can't cancel it from here. Please tell the customer yourself.`,
    cancel_first: (w, d) => `${w.lit(d.ref)} is still booked. To give the deposit back, cancel it: ${w.lit(`cancel ${d.ref}`)}.`,
    not_here: (w, d) => `That can't be done from the chat for ${w.lit(d.ref)} in this version. Use the message I sent you about it, or ask your partner.`,
    not_booked: (w, d) => `${w.lit(d.ref)} is not booked yet, so there is nothing to cancel.`,
    not_live: (w, d) => `${w.lit(d.ref)} is already cancelled, done or expired.`, nothing_paid: (w, d) => `Nothing was paid on ${w.lit(d.ref)}, so there is nothing to refund.`,
    too_much: (w, d) => `That is more than was paid on ${w.lit(d.ref)} (${w.inr(d.paidPaise ?? 0)}).`, nothing_waiting: (w, d) => `Nothing on ${w.lit(d.ref)} is waiting for you.`,
    no_window: (w, d) => `${w.lit(d.who ?? d.ref)} has not written in the last ${w.n(24)} hours, so WhatsApp lets the shop send only approved messages. Please call them.`,
    opted_out: (w, d) => `${w.lit(d.who ?? d.ref)} asked for no more messages (STOP).`,
    amount_not_on_record: (w, d) => `I can only send amounts that are on ${w.lit(d.ref)}. To give money back, say: refund ${w.lit(d.ref)}.`,
    busy: (w, d) => `${w.lit(d.ref)} is in the middle of something (a refund being checked). Try again a little later.`,
  },
  hi: {
    no_case: (w, d) => `${w.lit(d.ref)} नंबर का कुछ नहीं मिला।`, not_yours: (w, d) => `${w.lit(d.ref)} यह असिस्टेंट नहीं संभालता।`,
    already_back: (w, d) => `${w.lit(d.ref)} की जमा राशि पहले से वापस जा रही है, इसलिए मैं इसे यहाँ से रद्द नहीं कर सकता। कृपया ग्राहक को ख़ुद बताएँ।`,
    cancel_first: (w, d) => `${w.lit(d.ref)} अभी बुक है। जमा राशि लौटाने के लिए इसे रद्द करें: ${w.lit(`cancel ${d.ref}`)}।`,
    not_here: (w, d) => `इस वर्शन में ${w.lit(d.ref)} के लिए यह चैट से नहीं हो सकता। इसके बारे में भेजे मेरे मैसेज का इस्तेमाल करें, या अपने पार्टनर से कहें।`,
    not_booked: (w, d) => `${w.lit(d.ref)} अभी बुक नहीं हुई है, इसलिए रद्द करने को कुछ नहीं है।`,
    not_live: (w, d) => `${w.lit(d.ref)} पहले ही रद्द, पूरा या ख़त्म हो चुका है।`, nothing_paid: (w, d) => `${w.lit(d.ref)} पर कुछ भी नहीं चुकाया गया, तो वापस करने को कुछ नहीं है।`,
    too_much: (w, d) => `यह ${w.lit(d.ref)} पर चुकाए गए पैसे (${w.inr(d.paidPaise ?? 0)}) से ज़्यादा है।`, nothing_waiting: (w, d) => `${w.lit(d.ref)} पर आपके लिए कुछ बाकी नहीं है।`,
    no_window: (w, d) => `${w.lit(d.who ?? d.ref)} ने पिछले ${w.n(24)} घंटे में मैसेज नहीं किया, इसलिए WhatsApp दुकान से सिर्फ़ मंज़ूर किए गए मैसेज भेजने देता है। कृपया उन्हें फ़ोन करें।`,
    opted_out: (w, d) => `${w.lit(d.who ?? d.ref)} ने और मैसेज न भेजने को कहा है (STOP)।`,
    amount_not_on_record: (w, d) => `मैं सिर्फ़ वही रकम भेज सकता हूँ जो ${w.lit(d.ref)} पर दर्ज है। पैसे लौटाने के लिए कहें: refund ${w.lit(d.ref)}।`,
    busy: (w, d) => `${w.lit(d.ref)} पर अभी कुछ चल रहा है (एक रिफंड की जाँच)। थोड़ी देर बाद फिर कोशिश करें।`,
  },
  ml: {
    no_case: (w, d) => `${w.lit(d.ref)} എന്ന നമ്പറിൽ ഒന്നുമില്ല.`, not_yours: (w, d) => `${w.lit(d.ref)} ഈ അസിസ്റ്റന്റ് കൈകാര്യം ചെയ്യുന്നതല്ല.`,
    already_back: (w, d) => `${w.lit(d.ref)}-ന്റെ ഡെപ്പോസിറ്റ് ഇതിനകം തിരികെ പോകുന്നു, അതിനാൽ എനിക്ക് ഇവിടെ നിന്ന് റദ്ദാക്കാനാകില്ല. ദയവായി ഉപഭോക്താവിനോട് നേരിട്ട് പറയുക.`,
    cancel_first: (w, d) => `${w.lit(d.ref)} ഇപ്പോഴും ബുക്ക് ചെയ്തിരിക്കുന്നു. ഡെപ്പോസിറ്റ് തിരികെ നൽകാൻ അത് റദ്ദാക്കുക: ${w.lit(`cancel ${d.ref}`)}.`,
    not_here: (w, d) => `ഈ പതിപ്പിൽ ${w.lit(d.ref)}-ന് ഇത് ചാറ്റിൽ നിന്ന് ചെയ്യാനാകില്ല. ഇതിനെക്കുറിച്ച് ഞാൻ അയച്ച സന്ദേശം ഉപയോഗിക്കുക, അല്ലെങ്കിൽ നിങ്ങളുടെ പാർട്ണറോട് ചോദിക്കുക.`,
    not_booked: (w, d) => `${w.lit(d.ref)} ഇതുവരെ ബുക്ക് ചെയ്തിട്ടില്ല, അതിനാൽ റദ്ദാക്കാൻ ഒന്നുമില്ല.`,
    not_live: (w, d) => `${w.lit(d.ref)} ഇതിനകം റദ്ദാക്കിയതോ പൂർത്തിയായതോ കാലഹരണപ്പെട്ടതോ ആണ്.`, nothing_paid: (w, d) => `${w.lit(d.ref)}-ൽ ഒന്നും അടച്ചിട്ടില്ല, അതിനാൽ തിരികെ നൽകാൻ ഒന്നുമില്ല.`,
    too_much: (w, d) => `ഇത് ${w.lit(d.ref)}-ൽ അടച്ചതിനേക്കാൾ (${w.inr(d.paidPaise ?? 0)}) കൂടുതലാണ്.`, nothing_waiting: (w, d) => `${w.lit(d.ref)}-ൽ നിങ്ങൾക്കായി ഒന്നും കാത്തിരിക്കുന്നില്ല.`,
    no_window: (w, d) => `${w.lit(d.who ?? d.ref)} കഴിഞ്ഞ ${w.n(24)} മണിക്കൂറിൽ സന്ദേശം അയച്ചിട്ടില്ല, അതിനാൽ അംഗീകരിച്ച സന്ദേശങ്ങൾ മാത്രമേ WhatsApp അനുവദിക്കൂ. ദയവായി അവരെ വിളിക്കുക.`,
    opted_out: (w, d) => `${w.lit(d.who ?? d.ref)} ഇനി സന്ദേശങ്ങൾ വേണ്ടെന്ന് പറഞ്ഞു (STOP).`,
    amount_not_on_record: (w, d) => `${w.lit(d.ref)}-ൽ രേഖപ്പെടുത്തിയ തുകകൾ മാത്രമേ എനിക്ക് അയയ്ക്കാനാകൂ. പണം തിരികെ നൽകാൻ പറയുക: refund ${w.lit(d.ref)}.`,
    busy: (w, d) => `${w.lit(d.ref)}-ൽ ഇപ്പോൾ ഒരു കാര്യം നടക്കുന്നു (ഒരു റീഫണ്ട് പരിശോധന). അൽപം കഴിഞ്ഞ് വീണ്ടും ശ്രമിക്കുക.`,
  },
  kn: {
    no_case: (w, d) => `${w.lit(d.ref)} ಸಂಖ್ಯೆಯಲ್ಲಿ ಏನೂ ಇಲ್ಲ.`, not_yours: (w, d) => `${w.lit(d.ref)} ಅನ್ನು ಈ ಸಹಾಯಕ ನೋಡಿಕೊಳ್ಳುವುದಿಲ್ಲ.`,
    already_back: (w, d) => `${w.lit(d.ref)} ನ ಠೇವಣಿ ಈಗಾಗಲೇ ಹಿಂತಿರುಗುತ್ತಿದೆ, ಹಾಗಾಗಿ ನಾನು ಇಲ್ಲಿಂದ ರದ್ದು ಮಾಡಲಾಗದು. ದಯವಿಟ್ಟು ಗ್ರಾಹಕರಿಗೆ ನೀವೇ ತಿಳಿಸಿ.`,
    cancel_first: (w, d) => `${w.lit(d.ref)} ಇನ್ನೂ ಬುಕ್ ಆಗಿದೆ. ಠೇವಣಿ ಹಿಂತಿರುಗಿಸಲು ಅದನ್ನು ರದ್ದು ಮಾಡಿ: ${w.lit(`cancel ${d.ref}`)}.`,
    not_here: (w, d) => `ಈ ಆವೃತ್ತಿಯಲ್ಲಿ ${w.lit(d.ref)} ಗೆ ಇದನ್ನು ಚಾಟ್‌ನಿಂದ ಮಾಡಲಾಗದು. ಅದರ ಬಗ್ಗೆ ನಾನು ಕಳುಹಿಸಿದ ಸಂದೇಶ ಬಳಸಿ, ಅಥವಾ ನಿಮ್ಮ ಪಾರ್ಟ್‌ನರ್ ಅವರನ್ನು ಕೇಳಿ.`,
    not_booked: (w, d) => `${w.lit(d.ref)} ಇನ್ನೂ ಬುಕ್ ಆಗಿಲ್ಲ, ರದ್ದು ಮಾಡಲು ಏನೂ ಇಲ್ಲ.`,
    not_live: (w, d) => `${w.lit(d.ref)} ಈಗಾಗಲೇ ರದ್ದಾಗಿದೆ, ಮುಗಿದಿದೆ ಅಥವಾ ಅವಧಿ ಮೀರಿದೆ.`, nothing_paid: (w, d) => `${w.lit(d.ref)} ಮೇಲೆ ಏನೂ ಪಾವತಿಯಾಗಿಲ್ಲ, ಹಿಂತಿರುಗಿಸಲು ಏನೂ ಇಲ್ಲ.`,
    too_much: (w, d) => `ಇದು ${w.lit(d.ref)} ಮೇಲೆ ಪಾವತಿಸಿದ್ದಕ್ಕಿಂತ (${w.inr(d.paidPaise ?? 0)}) ಹೆಚ್ಚು.`, nothing_waiting: (w, d) => `${w.lit(d.ref)} ಮೇಲೆ ನಿಮಗಾಗಿ ಏನೂ ಕಾಯುತ್ತಿಲ್ಲ.`,
    no_window: (w, d) => `${w.lit(d.who ?? d.ref)} ಕಳೆದ ${w.n(24)} ಗಂಟೆಗಳಲ್ಲಿ ಸಂದೇಶ ಕಳುಹಿಸಿಲ್ಲ, ಹಾಗಾಗಿ WhatsApp ಅನುಮೋದಿತ ಸಂದೇಶಗಳನ್ನು ಮಾತ್ರ ಬಿಡುತ್ತದೆ. ದಯವಿಟ್ಟು ಅವರಿಗೆ ಕರೆ ಮಾಡಿ.`,
    opted_out: (w, d) => `${w.lit(d.who ?? d.ref)} ಇನ್ನು ಸಂದೇಶ ಬೇಡ ಎಂದಿದ್ದಾರೆ (STOP).`,
    amount_not_on_record: (w, d) => `${w.lit(d.ref)} ನಲ್ಲಿ ದಾಖಲಾದ ಮೊತ್ತಗಳನ್ನು ಮಾತ್ರ ನಾನು ಕಳುಹಿಸಬಹುದು. ಹಣ ಹಿಂತಿರುಗಿಸಲು ಹೇಳಿ: refund ${w.lit(d.ref)}.`,
    busy: (w, d) => `${w.lit(d.ref)} ನಲ್ಲಿ ಈಗ ಒಂದು ಕೆಲಸ ನಡೆಯುತ್ತಿದೆ (ಒಂದು ರೀಫಂಡ್ ಪರಿಶೀಲನೆ). ಸ್ವಲ್ಪ ಸಮಯದ ನಂತರ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.`,
  },
};

/** The question a card asks, by what it does. `itemKind` words an answer to something already waiting. */
const CARD_ASK: Record<Language, (w: Writer, d: MessageData["card"]) => string> = {
  en: (w, d) => {
    const who = w.lit(d.who); const ref = w.lit(d.ref);
    if (d.kind === "cancel") return d.amountPaise > 0 ? `Cancel ${ref} (${who}, ${w.lit(d.what)}) and refund the ${w.inr(d.amountPaise)} deposit?` : `Cancel ${ref} (${who}, ${w.lit(d.what)})? No deposit was paid.`;
    if (d.kind === "refund") return `Refund ${w.inr(d.amountPaise)} to ${who} for ${ref}?`;
    if (d.kind === "message") return `Send this to ${who} (${ref})?\n“${w.lit(d.words ?? "")}”`;
    if (d.itemKind === "late_refund") return `${who} cancelled ${ref} late. Refund the ${w.inr(d.amountPaise)} deposit?`;
    if (d.itemKind === "calendar") return `The calendar would not confirm ${ref} (${who}, ${w.lit(d.what)}, paid ${w.inr(d.amountPaise)}). Try the calendar again?`;
    if (d.itemKind === "deposit") return `Did ${w.inr(d.amountPaise)} from ${who} for ${ref} reach your UPI?`;
    if (d.itemKind === "refund_owed") return `Did you send ${w.inr(d.amountPaise)} back to ${who} for ${ref}?`;
    if (d.itemKind === "refund_request") return `${who} asked for ${w.inr(d.amountPaise)} back (${w.lit(d.what)}, ${ref}). Refund it?`;
    if (d.itemKind === "waiver") return `Waive ${w.inr(d.amountPaise)} of ${who}'s fee (${w.lit(d.what)}, ${ref})?`;
    if (d.itemKind === "big_order") return `Accept order ${ref} from ${who} (${w.lit(d.what)}, ${w.inr(d.amountPaise)})?`;
    return `${ref}: ${who}, ${w.lit(d.what)}, ${w.inr(d.amountPaise)}. Go ahead?`;
  },
  hi: (w, d) => {
    const who = w.lit(d.who); const ref = w.lit(d.ref);
    if (d.kind === "cancel") return d.amountPaise > 0 ? `${ref} (${who}, ${w.lit(d.what)}) रद्द करें और ${w.inr(d.amountPaise)} जमा राशि लौटाएँ?` : `${ref} (${who}, ${w.lit(d.what)}) रद्द करें? कोई जमा राशि नहीं दी गई थी।`;
    if (d.kind === "refund") return `${ref} के लिए ${who} को ${w.inr(d.amountPaise)} लौटाएँ?`;
    if (d.kind === "message") return `यह ${who} (${ref}) को भेजें?\n“${w.lit(d.words ?? "")}”`;
    if (d.itemKind === "late_refund") return `${who} ने ${ref} देर से रद्द की। ${w.inr(d.amountPaise)} जमा राशि लौटाएँ?`;
    if (d.itemKind === "calendar") return `कैलेंडर ने ${ref} (${who}, ${w.lit(d.what)}, ${w.inr(d.amountPaise)} दिए) पक्की नहीं की। कैलेंडर फिर से आज़माएँ?`;
    if (d.itemKind === "deposit") return `क्या ${ref} के लिए ${who} के ${w.inr(d.amountPaise)} आपके UPI में आ गए?`;
    if (d.itemKind === "refund_owed") return `क्या आपने ${ref} के लिए ${who} को ${w.inr(d.amountPaise)} लौटा दिए?`;
    if (d.itemKind === "refund_request") return `${who} ने ${w.inr(d.amountPaise)} वापस माँगे हैं (${w.lit(d.what)}, ${ref})। लौटाएँ?`;
    if (d.itemKind === "waiver") return `${who} की फीस (${w.lit(d.what)}, ${ref}) में ${w.inr(d.amountPaise)} की छूट दें?`;
    if (d.itemKind === "big_order") return `${who} का ऑर्डर ${ref} (${w.lit(d.what)}, ${w.inr(d.amountPaise)}) स्वीकार करें?`;
    return `${ref}: ${who}, ${w.lit(d.what)}, ${w.inr(d.amountPaise)}। आगे बढ़ें?`;
  },
  ml: (w, d) => {
    const who = w.lit(d.who); const ref = w.lit(d.ref);
    if (d.kind === "cancel") return d.amountPaise > 0 ? `${ref} (${who}, ${w.lit(d.what)}) റദ്ദാക്കി ${w.inr(d.amountPaise)} ഡെപ്പോസിറ്റ് തിരികെ നൽകണോ?` : `${ref} (${who}, ${w.lit(d.what)}) റദ്ദാക്കണോ? ഡെപ്പോസിറ്റ് അടച്ചിട്ടില്ല.`;
    if (d.kind === "refund") return `${ref}-ന് ${who}-ക്ക് ${w.inr(d.amountPaise)} തിരികെ നൽകണോ?`;
    if (d.kind === "message") return `ഇത് ${who}-ക്ക് (${ref}) അയയ്ക്കണോ?\n“${w.lit(d.words ?? "")}”`;
    if (d.itemKind === "late_refund") return `${who} ${ref} വൈകി റദ്ദാക്കി. ${w.inr(d.amountPaise)} ഡെപ്പോസിറ്റ് തിരികെ നൽകണോ?`;
    if (d.itemKind === "calendar") return `കലണ്ടർ ${ref} (${who}, ${w.lit(d.what)}, ${w.inr(d.amountPaise)} അടച്ചു) ഉറപ്പാക്കിയില്ല. കലണ്ടർ വീണ്ടും ശ്രമിക്കണോ?`;
    if (d.itemKind === "deposit") return `${ref}-ന് ${who} അയച്ച ${w.inr(d.amountPaise)} നിങ്ങളുടെ UPI-യിൽ എത്തിയോ?`;
    if (d.itemKind === "refund_owed") return `${ref}-ന് ${who}-ക്ക് ${w.inr(d.amountPaise)} തിരികെ അയച്ചോ?`;
    if (d.itemKind === "refund_request") return `${who} ${w.inr(d.amountPaise)} തിരികെ ചോദിച്ചു (${w.lit(d.what)}, ${ref}). തിരികെ നൽകണോ?`;
    if (d.itemKind === "waiver") return `${who}-ന്റെ ഫീസിൽ (${w.lit(d.what)}, ${ref}) ${w.inr(d.amountPaise)} ഇളവ് നൽകണോ?`;
    if (d.itemKind === "big_order") return `${who}-ന്റെ ഓർഡർ ${ref} (${w.lit(d.what)}, ${w.inr(d.amountPaise)}) സ്വീകരിക്കണോ?`;
    return `${ref}: ${who}, ${w.lit(d.what)}, ${w.inr(d.amountPaise)}. തുടരണോ?`;
  },
  kn: (w, d) => {
    const who = w.lit(d.who); const ref = w.lit(d.ref);
    if (d.kind === "cancel") return d.amountPaise > 0 ? `${ref} (${who}, ${w.lit(d.what)}) ರದ್ದು ಮಾಡಿ ${w.inr(d.amountPaise)} ಠೇವಣಿ ಹಿಂತಿರುಗಿಸಬೇಕೆ?` : `${ref} (${who}, ${w.lit(d.what)}) ರದ್ದು ಮಾಡಬೇಕೆ? ಠೇವಣಿ ಪಾವತಿಯಾಗಿಲ್ಲ.`;
    if (d.kind === "refund") return `${ref} ಗಾಗಿ ${who} ಅವರಿಗೆ ${w.inr(d.amountPaise)} ಹಿಂತಿರುಗಿಸಬೇಕೆ?`;
    if (d.kind === "message") return `ಇದನ್ನು ${who} (${ref}) ಅವರಿಗೆ ಕಳುಹಿಸಬೇಕೆ?\n“${w.lit(d.words ?? "")}”`;
    if (d.itemKind === "late_refund") return `${who} ${ref} ತಡವಾಗಿ ರದ್ದು ಮಾಡಿದ್ದಾರೆ. ${w.inr(d.amountPaise)} ಠೇವಣಿ ಹಿಂತಿರುಗಿಸಬೇಕೆ?`;
    if (d.itemKind === "calendar") return `ಕ್ಯಾಲೆಂಡರ್ ${ref} (${who}, ${w.lit(d.what)}, ${w.inr(d.amountPaise)} ಪಾವತಿ) ಖಚಿತಪಡಿಸಲಿಲ್ಲ. ಕ್ಯಾಲೆಂಡರ್ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಬೇಕೆ?`;
    if (d.itemKind === "deposit") return `${ref} ಗಾಗಿ ${who} ಅವರ ${w.inr(d.amountPaise)} ನಿಮ್ಮ UPI ಗೆ ಬಂತೆ?`;
    if (d.itemKind === "refund_owed") return `${ref} ಗಾಗಿ ${who} ಅವರಿಗೆ ${w.inr(d.amountPaise)} ಹಿಂತಿರುಗಿಸಿದಿರಾ?`;
    if (d.itemKind === "refund_request") return `${who} ಅವರು ${w.inr(d.amountPaise)} ಹಿಂತಿರುಗಿಸಲು ಕೇಳಿದ್ದಾರೆ (${w.lit(d.what)}, ${ref}). ಹಿಂತಿರುಗಿಸಬೇಕೆ?`;
    if (d.itemKind === "waiver") return `${who} ಅವರ ಫೀಸ್‌ನಲ್ಲಿ (${w.lit(d.what)}, ${ref}) ${w.inr(d.amountPaise)} ರಿಯಾಯಿತಿ ನೀಡಬೇಕೆ?`;
    if (d.itemKind === "big_order") return `${who} ಅವರ ಆರ್ಡರ್ ${ref} (${w.lit(d.what)}, ${w.inr(d.amountPaise)}) ಸ್ವೀಕರಿಸಬೇಕೆ?`;
    return `${ref}: ${who}, ${w.lit(d.what)}, ${w.inr(d.amountPaise)}. ಮುಂದುವರಿಯಬೇಕೆ?`;
  },
};

/** The line under every card: how to answer without the buttons. The code is the card's own; it is a literal (its digits are not a value). */
const CARD_FOOT: Record<Language, (w: Writer, d: MessageData["card"]) => string> = {
  en: (w, d) => `${d.aboveLimit ? "It is above your limit, so you will be asked to approve it once more. " : ""}Tap a button, or reply yes ${w.lit(d.code)}${d.hasNo ? ` or no ${w.lit(d.code)}` : ""}.`,
  hi: (w, d) => `${d.aboveLimit ? "यह आपकी सीमा से ऊपर है, इसलिए आपसे एक बार और मंज़ूरी माँगी जाएगी। " : ""}बटन दबाएँ, या जवाब दें yes ${w.lit(d.code)}${d.hasNo ? ` या no ${w.lit(d.code)}` : ""}।`,
  ml: (w, d) => `${d.aboveLimit ? "ഇത് നിങ്ങളുടെ പരിധിക്ക് മുകളിലാണ്, അതിനാൽ ഒരിക്കൽ കൂടി അംഗീകാരം ചോദിക്കും. " : ""}ഒരു ബട്ടൺ അമർത്തുക, അല്ലെങ്കിൽ മറുപടി നൽകുക yes ${w.lit(d.code)}${d.hasNo ? ` അല്ലെങ്കിൽ no ${w.lit(d.code)}` : ""}.`,
  kn: (w, d) => `${d.aboveLimit ? "ಇದು ನಿಮ್ಮ ಮಿತಿಗಿಂತ ಹೆಚ್ಚು, ಹಾಗಾಗಿ ಇನ್ನೊಮ್ಮೆ ಅನುಮೋದನೆ ಕೇಳಲಾಗುತ್ತದೆ. " : ""}ಬಟನ್ ಒತ್ತಿ, ಅಥವಾ ಉತ್ತರಿಸಿ yes ${w.lit(d.code)}${d.hasNo ? ` ಅಥವಾ no ${w.lit(d.code)}` : ""}.`,
};

/** The card's two buttons. A message's are Send / Don't send; every other card's are Approve / Refuse (the owner's own words for it, 12 Nov). */
export const CARD_LABELS: Record<Language, { approve: string; refuse: string; send: string; dontSend: string }> = {
  en: { approve: "Approve", refuse: "Refuse", send: "Send", dontSend: "Don't send" },
  hi: { approve: "मंज़ूर करें", refuse: "मना करें", send: "भेजें", dontSend: "न भेजें" },
  ml: { approve: "അനുവദിക്കുക", refuse: "നിരസിക്കുക", send: "അയയ്ക്കുക", dontSend: "അയയ്ക്കേണ്ട" },
  kn: { approve: "ಅನುಮೋದಿಸಿ", refuse: "ನಿರಾಕರಿಸಿ", send: "ಕಳುಹಿಸಿ", dontSend: "ಕಳುಹಿಸಬೇಡಿ" },
};

const DONE: Record<Language, (w: Writer, d: MessageData["done"]) => string> = {
  en: (w, d) => ({
    cancelled: `Cancelled ${w.lit(d.ref)}.`, refund_sent: `Done: ${w.inr(d.amountPaise)} is on its way back to ${w.lit(d.who)} (${w.lit(d.ref)}).`,
    held_by_guard: `The refund of ${w.inr(d.amountPaise)} for ${w.lit(d.ref)} is above your limit: approve it on the card that follows.`,
    owed_by_owner: `Please send ${w.inr(d.amountPaise)} back to ${w.lit(d.who)} (${w.lit(d.ref)}) from your UPI app, then tap Sent on the message I send you.`,
    sent: `Sent to ${w.lit(d.who)} (${w.lit(d.ref)}).`, answered: `Done for ${w.lit(d.ref)}.`,
    failed: `That did not go through for ${w.lit(d.ref)}. It is on your partner's list.`, not_sent: `The message to ${w.lit(d.who)} (${w.lit(d.ref)}) could not be sent.`,
  })[d.note],
  hi: (w, d) => ({
    cancelled: `${w.lit(d.ref)} रद्द कर दी गई।`, refund_sent: `हो गया: ${w.inr(d.amountPaise)} ${w.lit(d.who)} (${w.lit(d.ref)}) को वापस जा रहे हैं।`,
    held_by_guard: `${w.lit(d.ref)} का ${w.inr(d.amountPaise)} रिफंड आपकी सीमा से ऊपर है: अगले कार्ड पर मंज़ूर करें।`,
    owed_by_owner: `कृपया अपने UPI ऐप से ${w.lit(d.who)} (${w.lit(d.ref)}) को ${w.inr(d.amountPaise)} लौटाएँ, फिर मेरे भेजे मैसेज पर Sent दबाएँ।`,
    sent: `${w.lit(d.who)} (${w.lit(d.ref)}) को भेज दिया।`, answered: `${w.lit(d.ref)} के लिए हो गया।`,
    failed: `${w.lit(d.ref)} के लिए यह नहीं हो पाया। यह आपके पार्टनर की सूची में है।`, not_sent: `${w.lit(d.who)} (${w.lit(d.ref)}) को मैसेज नहीं जा सका।`,
  })[d.note],
  ml: (w, d) => ({
    cancelled: `${w.lit(d.ref)} റദ്ദാക്കി.`, refund_sent: `ചെയ്തു: ${w.inr(d.amountPaise)} ${w.lit(d.who)}-ക്ക് (${w.lit(d.ref)}) തിരികെ പോകുന്നു.`,
    held_by_guard: `${w.lit(d.ref)}-ന്റെ ${w.inr(d.amountPaise)} റീഫണ്ട് നിങ്ങളുടെ പരിധിക്ക് മുകളിലാണ്: അടുത്ത കാർഡിൽ അംഗീകരിക്കുക.`,
    owed_by_owner: `ദയവായി നിങ്ങളുടെ UPI ആപ്പിൽ നിന്ന് ${w.lit(d.who)}-ക്ക് (${w.lit(d.ref)}) ${w.inr(d.amountPaise)} തിരികെ അയയ്ക്കുക, എന്നിട്ട് ഞാൻ അയയ്ക്കുന്ന സന്ദേശത്തിൽ Sent അമർത്തുക.`,
    sent: `${w.lit(d.who)}-ക്ക് (${w.lit(d.ref)}) അയച്ചു.`, answered: `${w.lit(d.ref)}-ന് ചെയ്തു.`,
    failed: `${w.lit(d.ref)}-ന് ഇത് നടന്നില്ല. ഇത് നിങ്ങളുടെ പാർട്ണറുടെ പട്ടികയിലുണ്ട്.`, not_sent: `${w.lit(d.who)}-ക്ക് (${w.lit(d.ref)}) സന്ദേശം അയയ്ക്കാനായില്ല.`,
  })[d.note],
  kn: (w, d) => ({
    cancelled: `${w.lit(d.ref)} ರದ್ದಾಗಿದೆ.`, refund_sent: `ಆಗಿದೆ: ${w.inr(d.amountPaise)} ${w.lit(d.who)} (${w.lit(d.ref)}) ಅವರಿಗೆ ಹಿಂತಿರುಗುತ್ತಿದೆ.`,
    held_by_guard: `${w.lit(d.ref)} ನ ${w.inr(d.amountPaise)} ರೀಫಂಡ್ ನಿಮ್ಮ ಮಿತಿಗಿಂತ ಹೆಚ್ಚು: ಮುಂದಿನ ಕಾರ್ಡ್‌ನಲ್ಲಿ ಅನುಮೋದಿಸಿ.`,
    owed_by_owner: `ದಯವಿಟ್ಟು ನಿಮ್ಮ UPI ಆ್ಯಪ್‌ನಿಂದ ${w.lit(d.who)} (${w.lit(d.ref)}) ಅವರಿಗೆ ${w.inr(d.amountPaise)} ಹಿಂತಿರುಗಿಸಿ, ನಂತರ ನಾನು ಕಳುಹಿಸುವ ಸಂದೇಶದಲ್ಲಿ Sent ಒತ್ತಿ.`,
    sent: `${w.lit(d.who)} (${w.lit(d.ref)}) ಅವರಿಗೆ ಕಳುಹಿಸಲಾಗಿದೆ.`, answered: `${w.lit(d.ref)} ಗೆ ಆಗಿದೆ.`,
    failed: `${w.lit(d.ref)} ಗೆ ಇದು ಆಗಲಿಲ್ಲ. ಇದು ನಿಮ್ಮ ಪಾರ್ಟ್‌ನರ್ ಪಟ್ಟಿಯಲ್ಲಿದೆ.`, not_sent: `${w.lit(d.who)} (${w.lit(d.ref)}) ಅವರಿಗೆ ಸಂದೇಶ ಕಳುಹಿಸಲಾಗಲಿಲ್ಲ.`,
  })[d.note],
};

/** Why a move did not happen, in each language. */
const MOVE_WHY: Record<Language, Record<MoveRefusal, string>> = {
  en: { no_case: "no booking has that number", not_live: "only a confirmed booking can be moved", outside_hours: "the shop is closed then", taken: "that time is taken", past: "that time has passed", failed: "the calendar did not take the change (the customer was told it could not be moved)" },
  hi: { no_case: "उस नंबर की कोई बुकिंग नहीं है", not_live: "सिर्फ़ पक्की बुकिंग ही बदली जा सकती है", outside_hours: "उस समय दुकान बंद है", taken: "वह समय पहले से भरा है", past: "वह समय बीत चुका है", failed: "कैलेंडर ने बदलाव नहीं लिया (ग्राहक को बताया गया कि बदलाव नहीं हो सका)" },
  ml: { no_case: "ആ നമ്പറിൽ ബുക്കിംഗ് ഇല്ല", not_live: "ഉറപ്പായ ബുക്കിംഗ് മാത്രമേ മാറ്റാനാകൂ", outside_hours: "ആ സമയം കട അടച്ചിരിക്കും", taken: "ആ സമയം ഇതിനകം എടുത്തു", past: "ആ സമയം കഴിഞ്ഞുപോയി", failed: "കലണ്ടർ മാറ്റം സ്വീകരിച്ചില്ല (മാറ്റാനായില്ലെന്ന് ഉപഭോക്താവിനോട് പറഞ്ഞു)" },
  kn: { no_case: "ಆ ಸಂಖ್ಯೆಯ ಬುಕಿಂಗ್ ಇಲ್ಲ", not_live: "ಖಚಿತ ಬುಕಿಂಗ್ ಮಾತ್ರ ಬದಲಾಯಿಸಬಹುದು", outside_hours: "ಆ ಸಮಯದಲ್ಲಿ ಅಂಗಡಿ ಮುಚ್ಚಿರುತ್ತದೆ", taken: "ಆ ಸಮಯ ಈಗಾಗಲೇ ತೆಗೆದುಕೊಳ್ಳಲಾಗಿದೆ", past: "ಆ ಸಮಯ ಕಳೆದಿದೆ", failed: "ಕ್ಯಾಲೆಂಡರ್ ಬದಲಾವಣೆ ತೆಗೆದುಕೊಳ್ಳಲಿಲ್ಲ (ಬದಲಾಯಿಸಲಾಗಲಿಲ್ಲ ಎಂದು ಗ್ರಾಹಕರಿಗೆ ತಿಳಿಸಲಾಗಿದೆ)" },
};

const NEED_REF: Record<Language, Record<MessageData["need_ref"]["kind"], string>> = {
  en: { cancel: "Which one? Reply like this: cancel b-14.", refund: "Which one? Reply like this: refund b-14.", message: "Which customer? Reply like this: message b-14 Running 15 minutes late.", move: "Which booking? Reply like this: move b-14 to 5pm." },
  hi: { cancel: "कौन-सी? ऐसे जवाब दें: cancel b-14।", refund: "कौन-सी? ऐसे जवाब दें: refund b-14।", message: "किस ग्राहक को? ऐसे जवाब दें: message b-14 15 मिनट देर होगी।", move: "कौन-सी बुकिंग? ऐसे जवाब दें: move b-14 to 5pm।" },
  ml: { cancel: "ഏതാണ്? ഇങ്ങനെ മറുപടി നൽകുക: cancel b-14.", refund: "ഏതാണ്? ഇങ്ങനെ മറുപടി നൽകുക: refund b-14.", message: "ഏത് ഉപഭോക്താവിന്? ഇങ്ങനെ മറുപടി നൽകുക: message b-14 15 മിനിറ്റ് വൈകും.", move: "ഏത് ബുക്കിംഗ്? ഇങ്ങനെ മറുപടി നൽകുക: move b-14 to 5pm." },
  kn: { cancel: "ಯಾವುದು? ಹೀಗೆ ಉತ್ತರಿಸಿ: cancel b-14.", refund: "ಯಾವುದು? ಹೀಗೆ ಉತ್ತರಿಸಿ: refund b-14.", message: "ಯಾವ ಗ್ರಾಹಕರಿಗೆ? ಹೀಗೆ ಉತ್ತರಿಸಿ: message b-14 15 ನಿಮಿಷ ತಡ.", move: "ಯಾವ ಬುಕಿಂಗ್? ಹೀಗೆ ಉತ್ತರಿಸಿ: move b-14 to 5pm." },
};

const W: Record<Language, Words> = {
  en: {
    day_list: (d, w) => (d.rows.length === 0 ? `No bookings on ${w.date(d.date)}.` : `${w.date(d.date)}, bookings: ${w.n(d.rows.length)}\n${d.rows.slice(0, LIST_ROWS).map((r) => dayRow(w, r)).join("\n")}${more(w, d.rows.length, MORE)}`) + (d.closed ? "\nThe shop is closed that day." : ""),
    owes_list: (d, w) => (d.rows.length === 0 ? "Nobody owes a fee right now." : `Fees not paid yet: ${w.n(d.rows.length)}\n${d.rows.slice(0, LIST_ROWS).map((r) => oweRow(w, r)).join("\n")}${more(w, d.rows.length, MORE)}`),
    open_list: (d, w) => (d.rows.length === 0 ? "No orders are open." : `Open orders: ${w.n(d.rows.length)}\n${d.rows.slice(0, LIST_ROWS).map((r) => openRow(w, r)).join("\n")}${more(w, d.rows.length, MORE)}`),
    waiting_head: (d, w) => (d.count === 0 ? "Nothing needs you right now." : `Things that need you: ${w.n(d.count)}. Each one is below.`),
    money_in: (d, w) => (d.payments === 0 ? `Nothing recorded on ${w.date(d.date)} yet.` : `Recorded on ${w.date(d.date)}: ${w.inr(d.paise)} from payments: ${w.n(d.payments)}.`),
    closed: (d, w) => `Closed ${w.date(d.date)}. ${d.booked === 0 ? "No bookings that day." : `Bookings that day: ${w.n(d.booked)}. I've asked them to pick another day.`}${d.missed.length > 0 ? ` I could not reach these, please call them: ${d.missed.map((m) => `${w.lit(m.case)} (${w.lit(m.who)})`).join(", ")}.` : ""} Reply undo to open it again.`,
    already_closed: (d, w) => `${w.date(d.date)} is already closed.`,
    weekday_closed: (d, w) => `The shop is always closed on that weekday (${w.date(d.date)}). Your opening hours are set by your partner.`,
    not_closed: (d, w) => `${w.date(d.date)} is not closed.`,
    reopened: (d, w) => `Open again on ${w.date(d.date)}.${d.told > 0 ? ` I've told customers their booking stands: ${w.n(d.told)}.` : ""}`,
    past_day: (d, w) => `${w.date(d.date)} has already gone.`,
    undo_none: () => "There is nothing to undo.",
    need_ref: (d, w) => `${w.lit(NEED_REF.en[d.kind])}${d.rows.length > 0 ? `\n${d.rows.slice(0, LIST_ROWS).map((r) => `${w.slot(r.startMs)}: ${w.lit(r.what)}, ${w.lit(r.who)} (${w.lit(r.case)})`).join("\n")}` : ""}`,
    need_date: (d) => (d.kind === "close_day" ? "Which day? For example: close Sunday." : "Which day? For example: reopen Sunday."),
    need_when: (d, w) => `To when? For example: ${w.lit(`move ${d.ref} to 5pm`)}, or ${w.lit(`move ${d.ref} to Friday`)}.`,
    moved: (d, w) => `Moved ${w.lit(d.ref)} to ${w.slot(d.toMs)}. I've told the customer. Reply undo to move it back.`,
    moved_back: (d, w) => `${w.lit(d.ref)} is back at ${w.slot(d.toMs)}. I've told the customer.`,
    move_failed: (d, w) => `I couldn't move ${w.lit(d.ref)}${d.toMs !== undefined ? ` to ${w.slot(d.toMs)}` : ""}: ${MOVE_WHY.en[d.why]}.`,
    need_words: (d, w) => `What should I tell them? For example: ${w.lit(`message ${d.ref} Running 15 minutes late`)}.`,
    refusal: (d, w) => REFUSAL.en[d.why](w, d),
    card: (d, w) => `${CARD_ASK.en(w, d)}\n${CARD_FOOT.en(w, d)}`,
    done: (d, w) => DONE.en(w, d),
    refused: () => "OK. Nothing was changed.",
    refused_before: (d, w) => `You said no to this at ${w.time(d.atMs)}. I won't ask again until tomorrow.`,
    card_changed: () => "This changed since that card, so nothing was done. Here is the card as it is now:",
    card_closed: () => "That card was already answered.",
    card_expired: () => "That card ran out. Ask me again if you still want it.",
    card_unknown: () => "I have no card with that code.",
    limit_no: () => "Limits (refunds, deposits, caps) are changed by your partner from their panel. I can't change them from here in this version.",
    help: (d, w) => `I'm ${w.lit(d.name)}, ${w.lit(d.shop)}'s assistant. You can say, for example:\n${examples(w, d.kinds)}`,
    not_understood: (d, w) => `Sorry, I didn't get that. You can say, for example:\n${examples(w, d.kinds)}`,
    not_offered: () => "This shop's assistant doesn't handle that.",
    voice_unheard: () => "I couldn't make out that voice note. Please type it.",
    owner_words: (d, w) => `Message from ${w.lit(d.shop)}: ${w.lit(d.words)}`,
  },
  hi: {
    day_list: (d, w) => (d.rows.length === 0 ? `${w.date(d.date)} को कोई बुकिंग नहीं।` : `${w.date(d.date)}, बुकिंग: ${w.n(d.rows.length)}\n${d.rows.slice(0, LIST_ROWS).map((r) => dayRow(w, r)).join("\n")}${more(w, d.rows.length, MORE)}`) + (d.closed ? "\nउस दिन दुकान बंद है।" : ""),
    owes_list: (d, w) => (d.rows.length === 0 ? "अभी किसी की फीस बाकी नहीं है।" : `बाकी फीस: ${w.n(d.rows.length)}\n${d.rows.slice(0, LIST_ROWS).map((r) => oweRow(w, r)).join("\n")}${more(w, d.rows.length, MORE)}`),
    open_list: (d, w) => (d.rows.length === 0 ? "कोई ऑर्डर खुला नहीं है।" : `खुले ऑर्डर: ${w.n(d.rows.length)}\n${d.rows.slice(0, LIST_ROWS).map((r) => openRow(w, r)).join("\n")}${more(w, d.rows.length, MORE)}`),
    waiting_head: (d, w) => (d.count === 0 ? "अभी आपके लिए कुछ बाकी नहीं है।" : `आपके लिए बाकी काम: ${w.n(d.count)}। हर एक नीचे है।`),
    money_in: (d, w) => (d.payments === 0 ? `${w.date(d.date)} को अभी कुछ दर्ज नहीं हुआ।` : `${w.date(d.date)} को दर्ज: ${w.inr(d.paise)}, भुगतान: ${w.n(d.payments)}।`),
    closed: (d, w) => `${w.date(d.date)} बंद कर दिया। ${d.booked === 0 ? "उस दिन कोई बुकिंग नहीं।" : `उस दिन की बुकिंग: ${w.n(d.booked)}। मैंने उनसे दूसरा दिन चुनने को कहा है।`}${d.missed.length > 0 ? ` इन तक मैसेज नहीं पहुँचा, कृपया इन्हें फ़ोन करें: ${d.missed.map((m) => `${w.lit(m.case)} (${w.lit(m.who)})`).join(", ")}.` : ""} फिर से खोलने के लिए undo लिखें।`,
    already_closed: (d, w) => `${w.date(d.date)} पहले से बंद है।`,
    weekday_closed: (d, w) => `उस दिन (${w.date(d.date)}) दुकान हमेशा बंद रहती है। आपके खुलने का समय आपका पार्टनर तय करता है।`,
    not_closed: (d, w) => `${w.date(d.date)} बंद नहीं है।`,
    reopened: (d, w) => `${w.date(d.date)} फिर से खुला।${d.told > 0 ? ` मैंने ग्राहकों को बताया कि उनकी बुकिंग पक्की है: ${w.n(d.told)}।` : ""}`,
    past_day: (d, w) => `${w.date(d.date)} बीत चुका है।`,
    undo_none: () => "वापस लेने को कुछ नहीं है।",
    need_ref: (d, w) => `${w.lit(NEED_REF.hi[d.kind])}${d.rows.length > 0 ? `\n${d.rows.slice(0, LIST_ROWS).map((r) => `${w.slot(r.startMs)}: ${w.lit(r.what)}, ${w.lit(r.who)} (${w.lit(r.case)})`).join("\n")}` : ""}`,
    need_date: (d) => (d.kind === "close_day" ? "कौन-सा दिन? जैसे: रविवार बंद।" : "कौन-सा दिन? जैसे: रविवार फिर से खोल दो।"),
    need_when: (d, w) => `कब पर? जैसे: ${w.lit(`move ${d.ref} to 5pm`)}, या ${w.lit(`move ${d.ref} to Friday`)}।`,
    moved: (d, w) => `${w.lit(d.ref)} को ${w.slot(d.toMs)} पर कर दिया। ग्राहक को बता दिया। वापस करने के लिए undo लिखें।`,
    moved_back: (d, w) => `${w.lit(d.ref)} फिर से ${w.slot(d.toMs)} पर है। ग्राहक को बता दिया।`,
    move_failed: (d, w) => `${w.lit(d.ref)}${d.toMs !== undefined ? ` को ${w.slot(d.toMs)} पर` : ""} नहीं बदल सका: ${MOVE_WHY.hi[d.why]}।`,
    need_words: (d, w) => `उन्हें क्या बताऊँ? जैसे: ${w.lit(`message ${d.ref} 15 मिनट देर होगी`)}।`,
    refusal: (d, w) => REFUSAL.hi[d.why](w, d),
    card: (d, w) => `${CARD_ASK.hi(w, d)}\n${CARD_FOOT.hi(w, d)}`,
    done: (d, w) => DONE.hi(w, d),
    refused: () => "ठीक है। कुछ नहीं बदला।",
    refused_before: (d, w) => `आपने ${w.time(d.atMs)} पर इसके लिए मना किया था। कल तक मैं फिर नहीं पूछूँगा।`,
    card_changed: () => "उस कार्ड के बाद यह बदल गया, इसलिए कुछ नहीं किया। अभी का कार्ड यह है:",
    card_closed: () => "उस कार्ड का जवाब पहले ही दिया जा चुका है।",
    card_expired: () => "उस कार्ड का समय ख़त्म हो गया। अगर अब भी चाहिए तो फिर कहें।",
    card_unknown: () => "उस कोड का कोई कार्ड मेरे पास नहीं है।",
    limit_no: () => "सीमाएँ (रिफंड, जमा राशि, कैप) आपका पार्टनर अपने पैनल से बदलता है। इस वर्शन में मैं इन्हें यहाँ से नहीं बदल सकता।",
    help: (d, w) => `मैं ${w.lit(d.name)} हूँ, ${w.lit(d.shop)} का असिस्टेंट। आप ऐसे कह सकते हैं:\n${examples(w, d.kinds)}`,
    not_understood: (d, w) => `माफ़ कीजिए, समझ नहीं आया। आप ऐसे कह सकते हैं:\n${examples(w, d.kinds)}`,
    not_offered: () => "इस दुकान का असिस्टेंट यह काम नहीं करता।",
    voice_unheard: () => "वह वॉइस नोट समझ नहीं आया। कृपया लिखकर भेजें।",
    owner_words: (d, w) => `${w.lit(d.shop)} की ओर से संदेश: ${w.lit(d.words)}`,
  },
  ml: {
    day_list: (d, w) => (d.rows.length === 0 ? `${w.date(d.date)}-ന് ബുക്കിംഗുകൾ ഇല്ല.` : `${w.date(d.date)}, ബുക്കിംഗുകൾ: ${w.n(d.rows.length)}\n${d.rows.slice(0, LIST_ROWS).map((r) => dayRow(w, r)).join("\n")}${more(w, d.rows.length, MORE)}`) + (d.closed ? "\nആ ദിവസം കട അടച്ചിരിക്കും." : ""),
    owes_list: (d, w) => (d.rows.length === 0 ? "ഇപ്പോൾ ആരുടെയും ഫീസ് ബാക്കിയില്ല." : `അടയ്ക്കാത്ത ഫീസ്: ${w.n(d.rows.length)}\n${d.rows.slice(0, LIST_ROWS).map((r) => oweRow(w, r)).join("\n")}${more(w, d.rows.length, MORE)}`),
    open_list: (d, w) => (d.rows.length === 0 ? "തുറന്ന ഓർഡറുകൾ ഇല്ല." : `തുറന്ന ഓർഡറുകൾ: ${w.n(d.rows.length)}\n${d.rows.slice(0, LIST_ROWS).map((r) => openRow(w, r)).join("\n")}${more(w, d.rows.length, MORE)}`),
    waiting_head: (d, w) => (d.count === 0 ? "ഇപ്പോൾ നിങ്ങൾക്കായി ഒന്നും കാത്തിരിക്കുന്നില്ല." : `നിങ്ങൾക്കായി കാത്തിരിക്കുന്നവ: ${w.n(d.count)}. ഓരോന്നും താഴെ.`),
    money_in: (d, w) => (d.payments === 0 ? `${w.date(d.date)}-ന് ഇതുവരെ ഒന്നും രേഖപ്പെടുത്തിയിട്ടില്ല.` : `${w.date(d.date)}-ന് രേഖപ്പെടുത്തിയത്: ${w.inr(d.paise)}, പേയ്മെന്റുകൾ: ${w.n(d.payments)}.`),
    closed: (d, w) => `${w.date(d.date)} അടച്ചു. ${d.booked === 0 ? "ആ ദിവസം ബുക്കിംഗുകൾ ഇല്ല." : `ആ ദിവസത്തെ ബുക്കിംഗുകൾ: ${w.n(d.booked)}. മറ്റൊരു ദിവസം തിരഞ്ഞെടുക്കാൻ ഞാൻ അവരോട് പറഞ്ഞു.`}${d.missed.length > 0 ? ` ഇവരെ എനിക്ക് എത്തിക്കാനായില്ല, ദയവായി വിളിക്കുക: ${d.missed.map((m) => `${w.lit(m.case)} (${w.lit(m.who)})`).join(", ")}.` : ""} വീണ്ടും തുറക്കാൻ undo എന്ന് മറുപടി നൽകുക.`,
    already_closed: (d, w) => `${w.date(d.date)} ഇതിനകം അടച്ചിരിക്കുന്നു.`,
    weekday_closed: (d, w) => `ആ ആഴ്ചദിവസം (${w.date(d.date)}) കട എപ്പോഴും അടച്ചിരിക്കും. പ്രവർത്തന സമയം നിങ്ങളുടെ പാർട്ണറാണ് നിശ്ചയിക്കുന്നത്.`,
    not_closed: (d, w) => `${w.date(d.date)} അടച്ചിട്ടില്ല.`,
    reopened: (d, w) => `${w.date(d.date)} വീണ്ടും തുറന്നു.${d.told > 0 ? ` ബുക്കിംഗ് നിലനിൽക്കുമെന്ന് ഉപഭോക്താക്കളോട് പറഞ്ഞു: ${w.n(d.told)}.` : ""}`,
    past_day: (d, w) => `${w.date(d.date)} കഴിഞ്ഞുപോയി.`,
    undo_none: () => "പഴയപടിയാക്കാൻ ഒന്നുമില്ല.",
    need_ref: (d, w) => `${w.lit(NEED_REF.ml[d.kind])}${d.rows.length > 0 ? `\n${d.rows.slice(0, LIST_ROWS).map((r) => `${w.slot(r.startMs)}: ${w.lit(r.what)}, ${w.lit(r.who)} (${w.lit(r.case)})`).join("\n")}` : ""}`,
    need_date: (d) => (d.kind === "close_day" ? "ഏത് ദിവസം? ഉദാഹരണം: ഞായറാഴ്ച അടച്ചിടുക." : "ഏത് ദിവസം? ഉദാഹരണം: ഞായറാഴ്ച വീണ്ടും തുറക്കുക."),
    need_when: (d, w) => `എപ്പോഴേക്ക്? ഉദാഹരണം: ${w.lit(`move ${d.ref} to 5pm`)}, അല്ലെങ്കിൽ ${w.lit(`move ${d.ref} to Friday`)}.`,
    moved: (d, w) => `${w.lit(d.ref)} ${w.slot(d.toMs)}-ലേക്ക് മാറ്റി. ഉപഭോക്താവിനോട് പറഞ്ഞു. തിരികെ മാറ്റാൻ undo എന്ന് മറുപടി നൽകുക.`,
    moved_back: (d, w) => `${w.lit(d.ref)} വീണ്ടും ${w.slot(d.toMs)}-ന്. ഉപഭോക്താവിനോട് പറഞ്ഞു.`,
    move_failed: (d, w) => `${w.lit(d.ref)}${d.toMs !== undefined ? ` ${w.slot(d.toMs)}-ലേക്ക്` : ""} മാറ്റാനായില്ല: ${MOVE_WHY.ml[d.why]}.`,
    need_words: (d, w) => `അവരോട് എന്ത് പറയണം? ഉദാഹരണം: ${w.lit(`message ${d.ref} 15 മിനിറ്റ് വൈകും`)}.`,
    refusal: (d, w) => REFUSAL.ml[d.why](w, d),
    card: (d, w) => `${CARD_ASK.ml(w, d)}\n${CARD_FOOT.ml(w, d)}`,
    done: (d, w) => DONE.ml(w, d),
    refused: () => "ശരി. ഒന്നും മാറ്റിയിട്ടില്ല.",
    refused_before: (d, w) => `${w.time(d.atMs)}-ന് നിങ്ങൾ ഇതിന് വേണ്ടെന്ന് പറഞ്ഞു. നാളെ വരെ വീണ്ടും ചോദിക്കില്ല.`,
    card_changed: () => "ആ കാർഡിന് ശേഷം ഇത് മാറി, അതിനാൽ ഒന്നും ചെയ്തില്ല. ഇപ്പോഴത്തെ കാർഡ് ഇതാ:",
    card_closed: () => "ആ കാർഡിന് ഇതിനകം മറുപടി നൽകി.",
    card_expired: () => "ആ കാർഡിന്റെ സമയം കഴിഞ്ഞു. ഇപ്പോഴും വേണമെങ്കിൽ വീണ്ടും ചോദിക്കുക.",
    card_unknown: () => "ആ കോഡുള്ള കാർഡ് എന്റെ പക്കലില്ല.",
    limit_no: () => "പരിധികൾ (റീഫണ്ട്, ഡെപ്പോസിറ്റ്, ക്യാപ്) നിങ്ങളുടെ പാർട്ണർ അവരുടെ പാനലിൽ നിന്നാണ് മാറ്റുന്നത്. ഈ പതിപ്പിൽ എനിക്ക് ഇവിടെ നിന്ന് അവ മാറ്റാനാകില്ല.",
    help: (d, w) => `ഞാൻ ${w.lit(d.name)}, ${w.lit(d.shop)}-ന്റെ അസിസ്റ്റന്റ്. ഇങ്ങനെ പറയാം:\n${examples(w, d.kinds)}`,
    not_understood: (d, w) => `ക്ഷമിക്കണം, മനസ്സിലായില്ല. ഇങ്ങനെ പറയാം:\n${examples(w, d.kinds)}`,
    not_offered: () => "ഈ കടയുടെ അസിസ്റ്റന്റ് അത് ചെയ്യുന്നില്ല.",
    voice_unheard: () => "ആ വോയ്സ് നോട്ട് മനസ്സിലായില്ല. ദയവായി ടൈപ്പ് ചെയ്യുക.",
    owner_words: (d, w) => `${w.lit(d.shop)}-ൽ നിന്നുള്ള സന്ദേശം: ${w.lit(d.words)}`,
  },
  kn: {
    day_list: (d, w) => (d.rows.length === 0 ? `${w.date(d.date)} ರಂದು ಯಾವುದೇ ಬುಕಿಂಗ್ ಇಲ್ಲ.` : `${w.date(d.date)}, ಬುಕಿಂಗ್‌ಗಳು: ${w.n(d.rows.length)}\n${d.rows.slice(0, LIST_ROWS).map((r) => dayRow(w, r)).join("\n")}${more(w, d.rows.length, MORE)}`) + (d.closed ? "\nಆ ದಿನ ಅಂಗಡಿ ಮುಚ್ಚಿರುತ್ತದೆ." : ""),
    owes_list: (d, w) => (d.rows.length === 0 ? "ಈಗ ಯಾರ ಫೀಸ್ ಕೂಡ ಬಾಕಿ ಇಲ್ಲ." : `ಪಾವತಿಯಾಗದ ಫೀಸ್: ${w.n(d.rows.length)}\n${d.rows.slice(0, LIST_ROWS).map((r) => oweRow(w, r)).join("\n")}${more(w, d.rows.length, MORE)}`),
    open_list: (d, w) => (d.rows.length === 0 ? "ಯಾವುದೇ ಆರ್ಡರ್ ತೆರೆದಿಲ್ಲ." : `ತೆರೆದ ಆರ್ಡರ್‌ಗಳು: ${w.n(d.rows.length)}\n${d.rows.slice(0, LIST_ROWS).map((r) => openRow(w, r)).join("\n")}${more(w, d.rows.length, MORE)}`),
    waiting_head: (d, w) => (d.count === 0 ? "ಈಗ ನಿಮಗಾಗಿ ಏನೂ ಕಾಯುತ್ತಿಲ್ಲ." : `ನಿಮಗಾಗಿ ಕಾಯುತ್ತಿರುವವು: ${w.n(d.count)}. ಪ್ರತಿಯೊಂದೂ ಕೆಳಗಿದೆ.`),
    money_in: (d, w) => (d.payments === 0 ? `${w.date(d.date)} ರಂದು ಇನ್ನೂ ಏನೂ ದಾಖಲಾಗಿಲ್ಲ.` : `${w.date(d.date)} ರಂದು ದಾಖಲಾದದ್ದು: ${w.inr(d.paise)}, ಪಾವತಿಗಳು: ${w.n(d.payments)}.`),
    closed: (d, w) => `${w.date(d.date)} ಮುಚ್ಚಲಾಗಿದೆ. ${d.booked === 0 ? "ಆ ದಿನ ಯಾವುದೇ ಬುಕಿಂಗ್ ಇಲ್ಲ." : `ಆ ದಿನದ ಬುಕಿಂಗ್‌ಗಳು: ${w.n(d.booked)}. ಬೇರೆ ದಿನ ಆರಿಸಲು ಅವರನ್ನು ಕೇಳಿದ್ದೇನೆ.`}${d.missed.length > 0 ? ` ಇವರನ್ನು ತಲುಪಲಾಗಲಿಲ್ಲ, ದಯವಿಟ್ಟು ಕರೆ ಮಾಡಿ: ${d.missed.map((m) => `${w.lit(m.case)} (${w.lit(m.who)})`).join(", ")}.` : ""} ಮತ್ತೆ ತೆರೆಯಲು undo ಎಂದು ಉತ್ತರಿಸಿ.`,
    already_closed: (d, w) => `${w.date(d.date)} ಈಗಾಗಲೇ ಮುಚ್ಚಿದೆ.`,
    weekday_closed: (d, w) => `ಆ ವಾರದ ದಿನ (${w.date(d.date)}) ಅಂಗಡಿ ಯಾವಾಗಲೂ ಮುಚ್ಚಿರುತ್ತದೆ. ತೆರೆಯುವ ಸಮಯವನ್ನು ನಿಮ್ಮ ಪಾರ್ಟ್‌ನರ್ ನಿಗದಿಪಡಿಸುತ್ತಾರೆ.`,
    not_closed: (d, w) => `${w.date(d.date)} ಮುಚ್ಚಿಲ್ಲ.`,
    reopened: (d, w) => `${w.date(d.date)} ಮತ್ತೆ ತೆರೆದಿದೆ.${d.told > 0 ? ` ಬುಕಿಂಗ್ ಉಳಿದಿದೆ ಎಂದು ಗ್ರಾಹಕರಿಗೆ ತಿಳಿಸಿದ್ದೇನೆ: ${w.n(d.told)}.` : ""}`,
    past_day: (d, w) => `${w.date(d.date)} ಈಗಾಗಲೇ ಕಳೆದಿದೆ.`,
    undo_none: () => "ಹಿಂದಿನಂತೆ ಮಾಡಲು ಏನೂ ಇಲ್ಲ.",
    need_ref: (d, w) => `${w.lit(NEED_REF.kn[d.kind])}${d.rows.length > 0 ? `\n${d.rows.slice(0, LIST_ROWS).map((r) => `${w.slot(r.startMs)}: ${w.lit(r.what)}, ${w.lit(r.who)} (${w.lit(r.case)})`).join("\n")}` : ""}`,
    need_date: (d) => (d.kind === "close_day" ? "ಯಾವ ದಿನ? ಉದಾಹರಣೆಗೆ: ಭಾನುವಾರ ಮುಚ್ಚಿ." : "ಯಾವ ದಿನ? ಉದಾಹರಣೆಗೆ: ಭಾನುವಾರ ಮತ್ತೆ ತೆರೆ."),
    need_when: (d, w) => `ಯಾವಾಗಕ್ಕೆ? ಉದಾಹರಣೆಗೆ: ${w.lit(`move ${d.ref} to 5pm`)}, ಅಥವಾ ${w.lit(`move ${d.ref} to Friday`)}.`,
    moved: (d, w) => `${w.lit(d.ref)} ಅನ್ನು ${w.slot(d.toMs)} ಕ್ಕೆ ಬದಲಾಯಿಸಲಾಗಿದೆ. ಗ್ರಾಹಕರಿಗೆ ತಿಳಿಸಿದ್ದೇನೆ. ಹಿಂದಿನಂತೆ ಮಾಡಲು undo ಎಂದು ಉತ್ತರಿಸಿ.`,
    moved_back: (d, w) => `${w.lit(d.ref)} ಮತ್ತೆ ${w.slot(d.toMs)} ಕ್ಕೆ ಇದೆ. ಗ್ರಾಹಕರಿಗೆ ತಿಳಿಸಿದ್ದೇನೆ.`,
    move_failed: (d, w) => `${w.lit(d.ref)}${d.toMs !== undefined ? ` ಅನ್ನು ${w.slot(d.toMs)} ಕ್ಕೆ` : ""} ಬದಲಾಯಿಸಲಾಗಲಿಲ್ಲ: ${MOVE_WHY.kn[d.why]}.`,
    need_words: (d, w) => `ಅವರಿಗೆ ಏನು ಹೇಳಲಿ? ಉದಾಹರಣೆಗೆ: ${w.lit(`message ${d.ref} 15 ನಿಮಿಷ ತಡ`)}.`,
    refusal: (d, w) => REFUSAL.kn[d.why](w, d),
    card: (d, w) => `${CARD_ASK.kn(w, d)}\n${CARD_FOOT.kn(w, d)}`,
    done: (d, w) => DONE.kn(w, d),
    refused: () => "ಸರಿ. ಏನೂ ಬದಲಾಗಿಲ್ಲ.",
    refused_before: (d, w) => `${w.time(d.atMs)} ಕ್ಕೆ ನೀವು ಇದಕ್ಕೆ ಬೇಡ ಎಂದಿದ್ದೀರಿ. ನಾಳೆಯವರೆಗೆ ಮತ್ತೆ ಕೇಳುವುದಿಲ್ಲ.`,
    card_changed: () => "ಆ ಕಾರ್ಡ್ ನಂತರ ಇದು ಬದಲಾಗಿದೆ, ಹಾಗಾಗಿ ಏನೂ ಮಾಡಿಲ್ಲ. ಈಗಿನ ಕಾರ್ಡ್ ಇಲ್ಲಿದೆ:",
    card_closed: () => "ಆ ಕಾರ್ಡ್‌ಗೆ ಈಗಾಗಲೇ ಉತ್ತರಿಸಲಾಗಿದೆ.",
    card_expired: () => "ಆ ಕಾರ್ಡ್‌ನ ಸಮಯ ಮುಗಿದಿದೆ. ಇನ್ನೂ ಬೇಕಾದರೆ ಮತ್ತೆ ಕೇಳಿ.",
    card_unknown: () => "ಆ ಕೋಡ್‌ನ ಕಾರ್ಡ್ ನನ್ನ ಬಳಿ ಇಲ್ಲ.",
    limit_no: () => "ಮಿತಿಗಳನ್ನು (ರೀಫಂಡ್, ಠೇವಣಿ, ಕ್ಯಾಪ್) ನಿಮ್ಮ ಪಾರ್ಟ್‌ನರ್ ಅವರ ಪ್ಯಾನೆಲ್‌ನಿಂದ ಬದಲಾಯಿಸುತ್ತಾರೆ. ಈ ಆವೃತ್ತಿಯಲ್ಲಿ ನಾನು ಇಲ್ಲಿಂದ ಅವುಗಳನ್ನು ಬದಲಾಯಿಸಲಾಗದು.",
    help: (d, w) => `ನಾನು ${w.lit(d.name)}, ${w.lit(d.shop)} ನ ಸಹಾಯಕ. ನೀವು ಹೀಗೆ ಹೇಳಬಹುದು:\n${examples(w, d.kinds)}`,
    not_understood: (d, w) => `ಕ್ಷಮಿಸಿ, ಅರ್ಥವಾಗಲಿಲ್ಲ. ನೀವು ಹೀಗೆ ಹೇಳಬಹುದು:\n${examples(w, d.kinds)}`,
    not_offered: () => "ಈ ಅಂಗಡಿಯ ಸಹಾಯಕ ಅದನ್ನು ಮಾಡುವುದಿಲ್ಲ.",
    voice_unheard: () => "ಆ ವಾಯ್ಸ್ ನೋಟ್ ಅರ್ಥವಾಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಟೈಪ್ ಮಾಡಿ.",
    owner_words: (d, w) => `${w.lit(d.shop)} ಇಂದ ಸಂದೇಶ: ${w.lit(d.words)}`,
  },
};

/** One message written in a language: its text and the facts the outgoing check reads. Throws only on a programming error (a missing word). */
export function write<K extends MessageId>(id: K, data: MessageData[K], language: Language, timeZone: string): { text: string; facts: CheckFacts } {
  const w = new Writer(language, timeZone);
  const text = W[language][id](data, w);
  return { text, facts: w.check() };
}

/**
 * A card's question alone, without the line that says how to answer it by its code: what the owner's page shows beside the card's buttons (the page answers a card by
 * its id and digest, so its code is never on the page).
 */
export function cardQuestion(data: MessageData["card"], language: Language, timeZone: string): string {
  return CARD_ASK[language](new Writer(language, timeZone), data);
}

/** The date of `ms` plus `days`, in the shop's zone. Lists and the morning line name days by this. */
export const dayOf = (ms: number, timeZone: string, days = 0): LocalDate => addDays(localParts(ms, timeZone), days);
