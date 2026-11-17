// What the assistant says about the shop's memory and about the owner's talk, in English, Hindi, Malayalam and Kannada (block M, decision 58). Kept apart from words.ts so that
// file does not grow by a whole feature; words.ts's `write` reads this table for these ids, through the same Writer, so every value is noted for the outgoing check (a note's
// words are the owner's own and are "literals": the check lets the owner's words repeat, like a message the owner asked to send). The Hindi, Malayalam and Kannada are
// machine-written and are on the review sheets (bundle/panel/review.ts, "shop memory").
import type { Language } from "../language/languages.ts";
import type { Writer } from "./words.ts";

export interface NoteListed { id: string; text: string; kind: string; audience: "owner" | "everyone"; untilMs?: number }

/** The data each of these messages is written from. */
export interface MemoryMessageData {
  /** A note was saved (said in passing, undoable for a day, or after a tap on Remember). */
  note_saved: { id: string; text: string; audience: "owner" | "everyone"; undoable: boolean };
  /** A note the assistant proposes: the buttons Remember / No go with it. */
  note_proposal: { text: string; audience: "owner" | "everyone" };
  note_declined: Record<string, never>;
  notes_list: { notes: NoteListed[] };
  note_forgotten: { id: string };
  note_undone: { id: string };
  note_unknown: { id: string };
  note_full: { max: number };
  note_too_long: { max: number };
  note_need_words: Record<string, never>;
  /** A rule that maps to no declared limit is kept as a note: Guard does not enforce it. */
  note_not_a_limit: { id: string };
  /** The owner's talk failed a check, or the model could not answer: the fixed line with the shop's real numbers. */
  talk_fallback: { waiting: number; today?: number };
  /** The talk is off (button mode, AI cap, no model): what the owner can say. */
  talk_off: Record<string, never>;
}
export type MemoryMessageId = keyof MemoryMessageData;
type Words = { [K in MemoryMessageId]: (d: MemoryMessageData[K], w: Writer) => string };

const who = (a: "owner" | "everyone", l: Record<"owner" | "everyone", string>) => l[a];

export const MEMORY_WORDS: Record<Language, Words> = {
  en: {
    note_saved: (d, w) => `Remembered (${w.lit(d.id)}): "${w.lit(d.text)}". ${who(d.audience, { owner: "Only I use it, when I talk with you.", everyone: "Customers' answers may use it too." })}${d.undoable ? ` Say "undo" within a day, or "forget ${w.lit(d.id)}".` : ""}`,
    note_proposal: (d, w) => `Shall I remember this? "${w.lit(d.text)}" ${who(d.audience, { owner: "(only for our talks)", everyone: "(customers may be told it)" })}`,
    note_declined: () => "Alright, I will not remember that.",
    notes_list: (d, w) => (d.notes.length === 0 ? `I do not remember anything yet. Say, for example: ${w.lit("remember we close at 6 on Saturdays")}.` : `I remember ${w.n(d.notes.length)}:\n${d.notes.map((n) => `• ${w.lit(n.id)} ${who(n.audience, { owner: "[you only]", everyone: "[customers too]" })} ${w.lit(n.text)}`).join("\n")}\nSay "${w.lit("forget n-3")}" to remove one.`),
    note_forgotten: (d, w) => `Forgotten: ${w.lit(d.id)}. The words are gone from the shop's store; backups age out on their own schedule.`,
    note_undone: (d, w) => `Undone: I no longer remember ${w.lit(d.id)}.`,
    note_unknown: (d, w) => `I have no note ${w.lit(d.id)}. Say "what do you remember?" to see them.`,
    note_full: (d, w) => `I can keep ${w.n(d.max)} notes open. Forget one first.`,
    note_too_long: (d, w) => `That is too long for one note (at most ${w.n(d.max)} characters). Please say it shorter.`,
    note_need_words: (_d, w) => `What shall I remember? For example: ${w.lit("remember we close at 6 on Saturdays")}.`,
    note_not_a_limit: (d, w) => `I saved this as a note (${w.lit(d.id)}), not as a limit Guard enforces. I will follow it when I talk, but it does not stop anything by itself.`,
    talk_fallback: (d, w) => `I could not answer that just now.${d.today !== undefined ? ` Today: ${w.n(d.today)}.` : ""} Waiting for you: ${w.n(d.waiting)}. Say "help" to see what I can do.`,
    talk_off: () => "I can only answer set requests right now. Say \"help\" to see them.",
  },
  hi: {
    note_saved: (d, w) => `याद रखा (${w.lit(d.id)}): "${w.lit(d.text)}"। ${who(d.audience, { owner: "इसे सिर्फ़ मैं आपसे बात करते समय इस्तेमाल करूँगा।", everyone: "ग्राहकों के जवाब में भी यह काम आ सकता है।" })}${d.undoable ? ` एक दिन के अंदर "undo" कहें, या "forget ${w.lit(d.id)}"।` : ""}`,
    note_proposal: (d, w) => `क्या मैं यह याद रखूँ? "${w.lit(d.text)}" ${who(d.audience, { owner: "(सिर्फ़ हमारी बातचीत के लिए)", everyone: "(ग्राहकों को बताया जा सकता है)" })}`,
    note_declined: () => "ठीक है, मैं यह याद नहीं रखूँगा।",
    notes_list: (d, w) => (d.notes.length === 0 ? `मुझे अभी कुछ याद नहीं है। जैसे कहें: ${w.lit("याद रखना शनिवार को 6 बजे बंद होता है")}।` : `मुझे ${w.n(d.notes.length)} बातें याद हैं:\n${d.notes.map((n) => `• ${w.lit(n.id)} ${who(n.audience, { owner: "[सिर्फ़ आप]", everyone: "[ग्राहक भी]" })} ${w.lit(n.text)}`).join("\n")}\nकिसी को हटाने के लिए "${w.lit("forget n-3")}" कहें।`),
    note_forgotten: (d, w) => `भूल गया: ${w.lit(d.id)}। शब्द दुकान के स्टोर से हट गए हैं; बैकअप अपने समय पर पुराने होकर हटते हैं।`,
    note_undone: (d, w) => `वापस ले लिया: अब मुझे ${w.lit(d.id)} याद नहीं है।`,
    note_unknown: (d, w) => `${w.lit(d.id)} नाम का कोई नोट नहीं है। "क्या याद है?" कहकर देखें।`,
    note_full: (d, w) => `मैं ${w.n(d.max)} नोट रख सकता हूँ। पहले कोई एक भूलने को कहें।`,
    note_too_long: (d, w) => `यह एक नोट के लिए बहुत लंबा है (अधिकतम ${w.n(d.max)} अक्षर)। कृपया छोटा करके कहें।`,
    note_need_words: (_d, w) => `क्या याद रखूँ? जैसे: ${w.lit("याद रखना शनिवार को 6 बजे बंद होता है")}।`,
    note_not_a_limit: (d, w) => `मैंने इसे नोट (${w.lit(d.id)}) के रूप में रखा है, Guard की लागू की हुई सीमा के रूप में नहीं। बातचीत में मैं इसे मानूँगा, पर यह अपने आप कुछ नहीं रोकता।`,
    talk_fallback: (d, w) => `मैं अभी इसका जवाब नहीं दे सका।${d.today !== undefined ? ` आज: ${w.n(d.today)}।` : ""} आपके इंतज़ार में: ${w.n(d.waiting)}। मैं क्या कर सकता हूँ, यह देखने के लिए "help" कहें।`,
    talk_off: () => "अभी मैं सिर्फ़ तय अनुरोधों का जवाब दे सकता हूँ। उन्हें देखने के लिए \"help\" कहें।",
  },
  ml: {
    note_saved: (d, w) => `ഓർത്തുവെച്ചു (${w.lit(d.id)}): "${w.lit(d.text)}". ${who(d.audience, { owner: "ഞാൻ നിങ്ങളോട് സംസാരിക്കുമ്പോൾ മാത്രം ഇത് ഉപയോഗിക്കും.", everyone: "ഉപഭോക്താക്കൾക്കുള്ള മറുപടിയിലും ഇത് ഉപയോഗിച്ചേക്കാം." })}${d.undoable ? ` ഒരു ദിവസത്തിനുള്ളിൽ "undo" എന്ന് പറയുക, അല്ലെങ്കിൽ "forget ${w.lit(d.id)}".` : ""}`,
    note_proposal: (d, w) => `ഇത് ഞാൻ ഓർത്തുവെക്കട്ടെ? "${w.lit(d.text)}" ${who(d.audience, { owner: "(നമ്മുടെ സംസാരത്തിന് മാത്രം)", everyone: "(ഉപഭോക്താക്കളോട് പറഞ്ഞേക്കാം)" })}`,
    note_declined: () => "ശരി, ഞാൻ ഇത് ഓർത്തുവെക്കില്ല.",
    notes_list: (d, w) => (d.notes.length === 0 ? `ഇതുവരെ ഒന്നും ഓർമ്മയിലില്ല. ഉദാഹരണം: ${w.lit("remember ശനിയാഴ്ച 6-ന് അടയ്ക്കും")}.` : `എന്റെ ഓർമ്മയിൽ ${w.n(d.notes.length)} കാര്യങ്ങളുണ്ട്:\n${d.notes.map((n) => `• ${w.lit(n.id)} ${who(n.audience, { owner: "[നിങ്ങൾ മാത്രം]", everyone: "[ഉപഭോക്താക്കളും]" })} ${w.lit(n.text)}`).join("\n")}\nഒന്ന് നീക്കാൻ "${w.lit("forget n-3")}" എന്ന് പറയുക.`),
    note_forgotten: (d, w) => `മറന്നു: ${w.lit(d.id)}. വാക്കുകൾ കടയുടെ സ്റ്റോറിൽ നിന്ന് നീക്കി; ബാക്കപ്പുകൾ അവയുടെ സമയത്ത് ഇല്ലാതാകും.`,
    note_undone: (d, w) => `തിരിച്ചെടുത്തു: ${w.lit(d.id)} ഇനി ഓർമ്മയിലില്ല.`,
    note_unknown: (d, w) => `${w.lit(d.id)} എന്ന കുറിപ്പ് ഇല്ല. "എന്താണ് ഓർമ്മയുള്ളത്?" എന്ന് ചോദിച്ച് നോക്കുക.`,
    note_full: (d, w) => `ഞാൻ ${w.n(d.max)} കുറിപ്പുകൾ വരെ സൂക്ഷിക്കും. ആദ്യം ഒന്ന് മറക്കാൻ പറയുക.`,
    note_too_long: (d, w) => `ഒരു കുറിപ്പിന് ഇത് വളരെ നീളമുള്ളതാണ് (പരമാവധി ${w.n(d.max)} അക്ഷരം). ചുരുക്കി പറയുക.`,
    note_need_words: (_d, w) => `എന്താണ് ഓർത്തുവെക്കേണ്ടത്? ഉദാഹരണം: ${w.lit("remember ശനിയാഴ്ച 6-ന് അടയ്ക്കും")}.`,
    note_not_a_limit: (d, w) => `ഇത് ഒരു കുറിപ്പായി (${w.lit(d.id)}) സൂക്ഷിച്ചു, Guard നടപ്പാക്കുന്ന പരിധിയായിട്ടല്ല. സംസാരിക്കുമ്പോൾ ഞാൻ ഇത് പാലിക്കും, പക്ഷേ ഇത് സ്വയം ഒന്നും തടയില്ല.`,
    talk_fallback: (d, w) => `എനിക്ക് ഇപ്പോൾ ഇതിന് മറുപടി നൽകാനായില്ല.${d.today !== undefined ? ` ഇന്ന്: ${w.n(d.today)}.` : ""} നിങ്ങളുടെ മറുപടി കാത്തിരിക്കുന്നത്: ${w.n(d.waiting)}. എനിക്ക് എന്ത് ചെയ്യാമെന്ന് കാണാൻ "help" എന്ന് പറയുക.`,
    talk_off: () => "ഇപ്പോൾ നിശ്ചിത അഭ്യർത്ഥനകൾക്ക് മാത്രമേ മറുപടി നൽകാനാകൂ. അവ കാണാൻ \"help\" എന്ന് പറയുക.",
  },
  kn: {
    note_saved: (d, w) => `ನೆನಪಿಟ್ಟುಕೊಂಡೆ (${w.lit(d.id)}): "${w.lit(d.text)}". ${who(d.audience, { owner: "ನಿಮ್ಮೊಂದಿಗೆ ಮಾತನಾಡುವಾಗ ಮಾತ್ರ ನಾನು ಇದನ್ನು ಬಳಸುತ್ತೇನೆ.", everyone: "ಗ್ರಾಹಕರಿಗೆ ಕೊಡುವ ಉತ್ತರಗಳಲ್ಲೂ ಇದನ್ನು ಬಳಸಬಹುದು." })}${d.undoable ? ` ಒಂದು ದಿನದೊಳಗೆ "undo" ಎನ್ನಿ, ಅಥವಾ "forget ${w.lit(d.id)}".` : ""}`,
    note_proposal: (d, w) => `ಇದನ್ನು ನಾನು ನೆನಪಿಟ್ಟುಕೊಳ್ಳಲೇ? "${w.lit(d.text)}" ${who(d.audience, { owner: "(ನಮ್ಮ ಮಾತುಕತೆಗೆ ಮಾತ್ರ)", everyone: "(ಗ್ರಾಹಕರಿಗೆ ಹೇಳಬಹುದು)" })}`,
    note_declined: () => "ಸರಿ, ಇದನ್ನು ನೆನಪಿಟ್ಟುಕೊಳ್ಳುವುದಿಲ್ಲ.",
    notes_list: (d, w) => (d.notes.length === 0 ? `ಇನ್ನೂ ಏನೂ ನೆನಪಿಲ್ಲ. ಉದಾಹರಣೆಗೆ: ${w.lit("remember ಶನಿವಾರ 6ಕ್ಕೆ ಮುಚ್ಚುತ್ತೇವೆ")}.` : `ನನಗೆ ${w.n(d.notes.length)} ವಿಷಯ ನೆನಪಿದೆ:\n${d.notes.map((n) => `• ${w.lit(n.id)} ${who(n.audience, { owner: "[ನೀವು ಮಾತ್ರ]", everyone: "[ಗ್ರಾಹಕರೂ]" })} ${w.lit(n.text)}`).join("\n")}\nಒಂದನ್ನು ತೆಗೆಯಲು "${w.lit("forget n-3")}" ಎನ್ನಿ.`),
    note_forgotten: (d, w) => `ಮರೆತೆ: ${w.lit(d.id)}. ಪದಗಳು ಅಂಗಡಿಯ ಸ್ಟೋರ್‌ನಿಂದ ಹೋಗಿವೆ; ಬ್ಯಾಕಪ್‌ಗಳು ತಮ್ಮ ಸಮಯದಲ್ಲಿ ಇಲ್ಲವಾಗುತ್ತವೆ.`,
    note_undone: (d, w) => `ಹಿಂತೆಗೆದುಕೊಂಡೆ: ${w.lit(d.id)} ಇನ್ನು ನೆನಪಿಲ್ಲ.`,
    note_unknown: (d, w) => `${w.lit(d.id)} ಎಂಬ ಟಿಪ್ಪಣಿ ಇಲ್ಲ. "ಏನು ನೆನಪಿದೆ?" ಎಂದು ಕೇಳಿ ನೋಡಿ.`,
    note_full: (d, w) => `ನಾನು ${w.n(d.max)} ಟಿಪ್ಪಣಿಗಳವರೆಗೆ ಇಟ್ಟುಕೊಳ್ಳುತ್ತೇನೆ. ಮೊದಲು ಒಂದನ್ನು ಮರೆಯಲು ಹೇಳಿ.`,
    note_too_long: (d, w) => `ಒಂದು ಟಿಪ್ಪಣಿಗೆ ಇದು ತುಂಬಾ ಉದ್ದ (ಗರಿಷ್ಠ ${w.n(d.max)} ಅಕ್ಷರ). ಚಿಕ್ಕದಾಗಿ ಹೇಳಿ.`,
    note_need_words: (_d, w) => `ಏನನ್ನು ನೆನಪಿಟ್ಟುಕೊಳ್ಳಲಿ? ಉದಾಹರಣೆಗೆ: ${w.lit("remember ಶನಿವಾರ 6ಕ್ಕೆ ಮುಚ್ಚುತ್ತೇವೆ")}.`,
    note_not_a_limit: (d, w) => `ಇದನ್ನು ಟಿಪ್ಪಣಿಯಾಗಿ (${w.lit(d.id)}) ಇಟ್ಟಿದ್ದೇನೆ, Guard ಜಾರಿಗೊಳಿಸುವ ಮಿತಿಯಾಗಿ ಅಲ್ಲ. ಮಾತನಾಡುವಾಗ ನಾನು ಇದನ್ನು ಪಾಲಿಸುತ್ತೇನೆ, ಆದರೆ ಇದು ತಾನಾಗಿ ಏನನ್ನೂ ತಡೆಯುವುದಿಲ್ಲ.`,
    talk_fallback: (d, w) => `ನನಗೆ ಈಗ ಇದಕ್ಕೆ ಉತ್ತರಿಸಲಾಗಲಿಲ್ಲ.${d.today !== undefined ? ` ಇಂದು: ${w.n(d.today)}.` : ""} ನಿಮಗಾಗಿ ಕಾಯುತ್ತಿರುವುದು: ${w.n(d.waiting)}. ನಾನು ಏನು ಮಾಡಬಲ್ಲೆ ಎಂದು ನೋಡಲು "help" ಎನ್ನಿ.`,
    talk_off: () => "ಈಗ ನಾನು ನಿಗದಿತ ವಿನಂತಿಗಳಿಗೆ ಮಾತ್ರ ಉತ್ತರಿಸಬಲ್ಲೆ. ಅವನ್ನು ನೋಡಲು \"help\" ಎನ್ನಿ.",
  },
};

/** The two buttons of a proposed note: Remember and No. */
export const NOTE_LABELS: Record<Language, { yes: string; no: string }> = {
  en: { yes: "Remember", no: "No" },
  hi: { yes: "याद रखें", no: "नहीं" },
  ml: { yes: "ഓർത്തുവെക്കൂ", no: "വേണ്ട" },
  kn: { yes: "ನೆನಪಿಡಿ", no: "ಬೇಡ" },
};
