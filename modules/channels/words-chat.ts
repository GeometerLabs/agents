// The words of the chat on the shop's page (W1, 17 Nov 2026), in four languages: the page's own lines, the three quick taps of each template, and the commands those taps
// stand for. Hindi, Malayalam and Kannada are machine-written and wait for a native reader (they are on the review sheets: bundle/panel/review.ts chatFlat), like every
// other line a customer reads here.
//
// Plain and warm, in the shop's own voice where it is small talk (the greeting itself comes from the character's personality, assistant/personality.ts, so no model is
// asked to say hello). The one quiet note says what a customer may rely on: the replies are written by the shop's assistant, and a booking or a payment counts only when
// the shop's own record says so. It never says "bot", never promises anything, never says "safe" or "guaranteed".
//
// A tuition centre is not a shop (18 Nov 2026): on a Fees chat every line below that says "shop" says "centre" instead, through ONE small per-kind noun table (NOUN, with the
// few case forms Malayalam and Kannada need), applied by `forKind` to any word table; the sentences are never copied per kind. Bookings, Orders and listings keep "shop".
import type { Language } from "../language/languages.ts";

export interface ChatWords {
  /** The page's title and the composer. */
  title: string; placeholder: string; send: string; label: string; back: string;
  /** What the guest sees of their own send: sending, sent, and the failure that is tapped to try again. */
  sending: string; sent: string; failed: string; retry: string;
  /** Calm states: offline banner, a slow reply, the sending limit, the day's typed-answer limit (the buttons still work), a thread that was cleared. */
  offline: string; slow: string; rate: string; capped: string; closed: (hours: string) => string; paused: string; empty: string; gone: string;
  /** The greeting's second line, spoken by the character after its personality's own greeting. */
  help: string;
  /** The quiet note under the thread, the retention line, and the screen-reader names of each side. */
  note: string; kept: (days: number) => string; you: string; shop: string; thread: string;
  /** Alerts are offered after the first answer. */
  alertsHead: string;
  /** The quiet foot line on the Streetlist pages domain only ("on Streetlist"), beside the awning mark. */
  onStreetlist: string;
}

export const CHAT: Record<Language, ChatWords> = {
  en: {
    title: "Chat", placeholder: "Write a message", send: "Send", label: "Your message", back: "Shop page",
    sending: "Sending", sent: "Sent", failed: "Not sent. Tap to send again.", retry: "Send again",
    offline: "You are offline. Messages will go when you are back.", slow: "Writing back", rate: "That was a lot at once. Wait a minute, then send again.",
    capped: "That is enough typed answers for today. The buttons below still work.", closed: (h) => `The shop is closed now. You can still ask. ${h}`, paused: "The shop is not taking new work just now. You can still ask questions.", empty: "No messages yet.", gone: "Messages older than the keeping time are cleared.",
    help: "What would you like to do?",
    note: "The shop's assistant replies here. A booking or a payment counts once the shop's record shows it.", kept: (d) => `The shop keeps this chat for ${d} days.`, you: "You", shop: "Shop", thread: "Conversation",
    alertsHead: "Want a buzz when the shop answers?", onStreetlist: "on Streetlist",
  },
  hi: {
    title: "चैट", placeholder: "संदेश लिखें", send: "भेजें", label: "आपका संदेश", back: "दुकान का पेज",
    sending: "भेज रहे हैं", sent: "भेज दिया", failed: "गया नहीं। फिर से भेजने के लिए दबाएँ।", retry: "फिर से भेजें",
    offline: "आप ऑफ़लाइन हैं। वापस आते ही संदेश चले जाएँगे।", slow: "जवाब लिख रहे हैं", rate: "एक साथ बहुत हो गया। एक मिनट रुकिए, फिर कोशिश करें।",
    capped: "आज के लिए लिखे जवाब बस इतने। नीचे के बटन अब भी चलते हैं।", closed: (h) => `दुकान अभी बंद है। आप फिर भी पूछ सकते हैं। ${h}`, paused: "दुकान अभी नया काम नहीं ले रही। आप सवाल पूछ सकते हैं।", empty: "अभी कोई संदेश नहीं।", gone: "रखने के समय से पुराने संदेश हटा दिए जाते हैं।",
    help: "आप क्या करना चाहेंगे?",
    note: "दुकान का असिस्टेंट यहाँ जवाब देता है। बुकिंग या भुगतान तभी गिना जाता है जब दुकान के रिकॉर्ड में दिखे।", kept: (d) => `दुकान यह चैट ${d} दिन रखती है।`, you: "आप", shop: "दुकान", thread: "बातचीत",
    alertsHead: "दुकान जवाब दे तो फ़ोन बजे?", onStreetlist: "Streetlist पर",
  },
  ml: {
    title: "ചാറ്റ്", placeholder: "സന്ദേശം എഴുതൂ", send: "അയയ്ക്കൂ", label: "നിങ്ങളുടെ സന്ദേശം", back: "കടയുടെ പേജ്",
    sending: "അയയ്ക്കുന്നു", sent: "അയച്ചു", failed: "പോയില്ല. വീണ്ടും അയയ്ക്കാൻ തൊടൂ.", retry: "വീണ്ടും അയയ്ക്കൂ",
    offline: "നിങ്ങൾ ഓഫ്‌ലൈനാണ്. തിരിച്ചെത്തുമ്പോൾ സന്ദേശങ്ങൾ പോകും.", slow: "മറുപടി എഴുതുന്നു", rate: "ഒറ്റയടിക്ക് കൂടുതലായി. ഒരു മിനിറ്റ് കാത്തിരുന്ന് വീണ്ടും ശ്രമിക്കൂ.",
    capped: "ഇന്നത്തേക്ക് ടൈപ്പ് ചെയ്ത മറുപടികൾ ഇത്രയും. താഴത്തെ ബട്ടണുകൾ ഇപ്പോഴും പ്രവർത്തിക്കും.", closed: (h) => `കട ഇപ്പോൾ അടഞ്ഞിരിക്കുന്നു. എങ്കിലും ചോദിക്കാം. ${h}`, paused: "കട ഇപ്പോൾ പുതിയ ജോലി എടുക്കുന്നില്ല. ചോദ്യങ്ങൾ ചോദിക്കാം.", empty: "ഇതുവരെ സന്ദേശങ്ങളില്ല.", gone: "സൂക്ഷിക്കുന്ന സമയത്തിലും പഴയ സന്ദേശങ്ങൾ നീക്കം ചെയ്യും.",
    help: "നിങ്ങൾക്ക് എന്താണ് ചെയ്യേണ്ടത്?",
    note: "കടയുടെ അസിസ്റ്റന്റ് ഇവിടെ മറുപടി നൽകും. ബുക്കിംഗോ പേയ്‌മെന്റോ കടയുടെ രേഖയിൽ കാണുമ്പോൾ മാത്രം കണക്കാകും.", kept: (d) => `കട ഈ ചാറ്റ് ${d} ദിവസം സൂക്ഷിക്കും.`, you: "നിങ്ങൾ", shop: "കട", thread: "സംഭാഷണം",
    alertsHead: "കട മറുപടി തന്നാൽ ഫോൺ അറിയിക്കണോ?", onStreetlist: "Streetlist-ൽ",
  },
  kn: {
    title: "ಚಾಟ್", placeholder: "ಸಂದೇಶ ಬರೆಯಿರಿ", send: "ಕಳುಹಿಸಿ", label: "ನಿಮ್ಮ ಸಂದೇಶ", back: "ಅಂಗಡಿಯ ಪುಟ",
    sending: "ಕಳುಹಿಸಲಾಗುತ್ತಿದೆ", sent: "ಕಳುಹಿಸಿದೆ", failed: "ಹೋಗಲಿಲ್ಲ. ಮತ್ತೆ ಕಳುಹಿಸಲು ಒತ್ತಿ.", retry: "ಮತ್ತೆ ಕಳುಹಿಸಿ",
    offline: "ನೀವು ಆಫ್‌ಲೈನ್ ಇದ್ದೀರಿ. ನೀವು ಮರಳಿದಾಗ ಸಂದೇಶಗಳು ಹೋಗುತ್ತವೆ.", slow: "ಉತ್ತರ ಬರೆಯಲಾಗುತ್ತಿದೆ", rate: "ಒಮ್ಮೆಲೇ ಬಹಳ ಆಯಿತು. ಒಂದು ನಿಮಿಷ ಕಾದು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.",
    capped: "ಇಂದಿಗೆ ಟೈಪ್ ಮಾಡಿದ ಉತ್ತರಗಳು ಇಷ್ಟೇ. ಕೆಳಗಿನ ಬಟನ್‌ಗಳು ಇನ್ನೂ ಕೆಲಸ ಮಾಡುತ್ತವೆ.", closed: (h) => `ಅಂಗಡಿ ಈಗ ಮುಚ್ಚಿದೆ. ಆದರೂ ಕೇಳಬಹುದು. ${h}`, paused: "ಅಂಗಡಿ ಈಗ ಹೊಸ ಕೆಲಸ ತೆಗೆದುಕೊಳ್ಳುತ್ತಿಲ್ಲ. ಪ್ರಶ್ನೆಗಳನ್ನು ಕೇಳಬಹುದು.", empty: "ಇನ್ನೂ ಸಂದೇಶಗಳಿಲ್ಲ.", gone: "ಇಡುವ ಸಮಯಕ್ಕಿಂತ ಹಳೆಯ ಸಂದೇಶಗಳನ್ನು ತೆಗೆಯಲಾಗುತ್ತದೆ.",
    help: "ನೀವು ಏನು ಮಾಡಲು ಬಯಸುತ್ತೀರಿ?",
    note: "ಅಂಗಡಿಯ ಅಸಿಸ್ಟೆಂಟ್ ಇಲ್ಲಿ ಉತ್ತರಿಸುತ್ತದೆ. ಬುಕಿಂಗ್ ಅಥವಾ ಪಾವತಿ ಅಂಗಡಿಯ ದಾಖಲೆಯಲ್ಲಿ ಕಂಡಾಗ ಮಾತ್ರ ಲೆಕ್ಕಕ್ಕೆ ಬರುತ್ತದೆ.", kept: (d) => `ಅಂಗಡಿ ಈ ಚಾಟ್ ಅನ್ನು ${d} ದಿನ ಇಟ್ಟುಕೊಳ್ಳುತ್ತದೆ.`, you: "ನೀವು", shop: "ಅಂಗಡಿ", thread: "ಮಾತುಕತೆ",
    alertsHead: "ಅಂಗಡಿ ಉತ್ತರಿಸಿದಾಗ ಫೋನ್ ತಿಳಿಸಬೇಕೆ?", onStreetlist: "Streetlist ನಲ್ಲಿ",
  },
};

/** The kinds of shop that have a chat. */
export type ChatKind = "bookings" | "orders" | "fees";

/**
 * The three quick taps of an empty chat, per kind: the words the guest sees (and the line their send shows), and the command the agent reads for it. The command is the
 * same short English word a WhatsApp customer would type, which every language's rules read, so a tap in Malayalam is understood without a model. A tap is sent as its
 * number (1 to 3), never as free text, so it cannot carry anything else.
 */
export const QUICK: Record<ChatKind, { command: [string, string, string]; label: Record<Language, [string, string, string]> }> = {
  bookings: {
    command: ["menu", "book", "where"],
    label: {
      en: ["See prices", "Book a time", "Where are you?"], hi: ["दाम देखें", "समय बुक करें", "आप कहाँ हैं?"],
      ml: ["വില കാണൂ", "സമയം ബുക്ക് ചെയ്യൂ", "നിങ്ങൾ എവിടെയാണ്?"], kn: ["ಬೆಲೆ ನೋಡಿ", "ಸಮಯ ಬುಕ್ ಮಾಡಿ", "ನೀವು ಎಲ್ಲಿದ್ದೀರಿ?"],
    },
  },
  orders: {
    command: ["menu", "order", "pickup times"],
    label: {
      en: ["Today's menu", "Order", "Pickup times"], hi: ["आज का मेन्यू", "ऑर्डर करें", "लेने का समय"],
      ml: ["ഇന്നത്തെ മെനു", "ഓർഡർ ചെയ്യൂ", "എടുക്കാനുള്ള സമയം"], kn: ["ಇಂದಿನ ಮೆನು", "ಆರ್ಡರ್ ಮಾಡಿ", "ತೆಗೆದುಕೊಳ್ಳುವ ಸಮಯ"],
    },
  },
  fees: {
    command: ["class timings", "fees", "talk to the owner"],
    label: {
      en: ["Class timings", "Fees", "Talk to the teacher"], hi: ["क्लास का समय", "फ़ीस", "टीचर से बात करें"],
      ml: ["ക്ലാസ് സമയം", "ഫീസ്", "ടീച്ചറോട് സംസാരിക്കൂ"], kn: ["ತರಗತಿಯ ಸಮಯ", "ಶುಲ್ಕ", "ಶಿಕ್ಷಕರೊಂದಿಗೆ ಮಾತನಾಡಿ"],
    },
  },
};

/**
 * What a kind of place is called, per language, as ordered replacements of the shop noun (longest forms first, then the bare noun). Only a Fees chat has its own noun:
 * "centre" in English; in Hindi, Malayalam and Kannada the word the Fees chat's own lines already use (केंद्र, കേന്ദ്രം, ಕೇಂದ്ര). Malayalam and Kannada join their case
 * endings to the noun, so each ending the lines use has its own row. A match must start a word (never inside `{shop}`, the placeholder for a shop's name) and, for the bare
 * noun, end one. Hindi names a thing with a gender, and a centre is masculine where a shop is feminine, so the two verbs and the one "other" (दूसरी/दूसरा) the lines use around it change too.
 */
const NOUN: Partial<Record<ChatKind, Record<Language, Array<[string, string]>>>> = {
  fees: {
    en: [["Shop", "Centre"], ["shop", "centre"]],
    hi: [["दूसरी दुकान", "दूसरा केंद्र"], ["रखती है", "रखता है"], ["ले रही", "ले रहा"], ["दुकान", "केंद्र"]],
    ml: [["കടയുടേത", "കേന്ദ്രത്തിന്റേത"], ["കടയുടെ", "കേന്ദ്രത്തിന്റെ"], ["കടയുമായുള്ള", "കേന്ദ്രവുമായുള്ള"], ["കടയെ", "കേന്ദ്രത്തെ"], ["കട", "കേന്ദ്രം"]],
    kn: [["ಅಂಗಡಿಯದ", "ಕೇಂದ್ರದ್ದ"], ["ಅಂಗಡಿಯೊಂದಿಗೆ", "ಕೇಂದ್ರದೊಂದಿಗೆ"], ["ಅಂಗಡಿಯ", "ಕೇಂದ್ರದ"], ["ಅಂಗಡಿಗೆ", "ಕೇಂದ್ರಕ್ಕೆ"], ["ಅಂಗಡಿ", "ಕೇಂದ್ರ"]],
  },
};

const LETTER = "\\p{L}\\p{M}";
const rulesCache = new Map<string, Array<[RegExp, string]>>();
/** The rules of one kind and language as regular expressions: a match starts a word (no letter, mark or `{` before it) and, for the last rule (the bare noun), ends one. */
function rulesOf(kind: ChatKind, language: Language): Array<[RegExp, string]> {
  const key = `${kind}/${language}`;
  let rules = rulesCache.get(key);
  if (!rules) {
    const table = NOUN[kind]?.[language] ?? [];
    rules = table.map(([from, to], i) => [new RegExp(`(?<![${LETTER}{])${from}${i === table.length - 1 ? `(?![${LETTER}])` : ""}`, "gu"), to]);
    rulesCache.set(key, rules);
  }
  return rules;
}

const mapped = new WeakMap<object, Map<string, unknown>>();

/**
 * Any word table (strings, functions that return strings, and objects of both) for the place this kind is: the same table for a kind with no noun of its own, and for Fees a
 * copy in which the shop noun reads "centre". The copy is made once per table, kind and language. A function keeps its arguments and has its answer rewritten.
 */
export function forKind<T>(kind: ChatKind, language: Language, words: T): T {
  if (!NOUN[kind]) return words;
  const rules = rulesOf(kind, language);
  const text = (s: string): string => rules.reduce((t, [re, to]) => t.replace(re, to), s);
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return text(v);
    if (typeof v === "function") return (...args: unknown[]) => walk((v as (...a: unknown[]) => unknown)(...args));
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  const cacheKey = `${kind}/${language}`;
  let per = mapped.get(words as object);
  if (!per) mapped.set(words as object, (per = new Map()));
  if (!per.has(cacheKey)) per.set(cacheKey, walk(words));
  return per.get(cacheKey) as T;
}
