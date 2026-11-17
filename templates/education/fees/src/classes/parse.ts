// What a contact (a parent, or an adult student) and the teacher can say about classes, read by fixed word lists. No model is asked and nothing is guessed: a tap is read by
// its button id, a few words by these lists, and anything else is left to the rest of the agent (the fee reading), exactly as before.
//
// Why a reader of its own and not new kinds in the fee reader (src/adapters/rule-parser.ts): a centre without Classes must read every message exactly as it did, so these
// words are looked at ONLY when the centre has the `classes` block, and only for words that cannot be a fee ("class link", "notes", "doubt"). STOP is never taken here.
// Machine-written lists for Hindi, Malayalam and Kannada (and the Latin-letter forms people type) wait for a native reader (the review sheets list them).
import { canon } from "../../../../../modules/language/format.ts";
import { wordRe } from "../../../../../modules/language/dates.ts";
import { NO_RE, YES_RE, isStop } from "../../../../../modules/understanding/rules.ts";

const NEXT_WORDS = [
  "next class", "class time", "class timing", "class timings", "when is the class", "when is class", "when is the next class", "timetable", "time table", "class schedule", "class link", "meet link", "zoom link", "join link",
  "अगली क्लास", "क्लास कब", "कक्षा कब", "क्लास का समय", "क्लास का लिंक", "क्लास लिंक", "समय सारणी", "टाइम टेबल", "agli class", "class kab", "class ka link", "class timing kya",
  "അടുത്ത ക്ലാസ്", "ക്ലാസ് എപ്പോൾ", "ക്ലാസ്സ് എപ്പോൾ", "ക്ലാസ് ലിങ്ക്", "ക്ലാസ് സമയം", "ടൈം ടേബിൾ", "adutha class", "class eppol", "class eppozha", "class link",
  "ಮುಂದಿನ ತರಗತಿ", "ತರಗತಿ ಯಾವಾಗ", "ಕ್ಲಾಸ್ ಯಾವಾಗ", "ಕ್ಲಾಸ್ ಲಿಂಕ್", "ತರಗತಿ ಸಮಯ", "ಟೈಮ್ ಟೇಬಲ್", "munde class", "class yavaga", "class yavag",
];
const MATERIAL_WORDS = [
  "notes", "study material", "reading material", "material", "worksheet", "worksheets", "pdf", "handout",
  "नोट्स", "सामग्री", "पढ़ने की सामग्री", "मटेरियल", "वर्कशीट", "notes bhejo", "material bhejo",
  "നോട്സ്", "നോട്ട്സ്", "സാമഗ്രി", "പഠന സാമഗ്രികൾ", "മെറ്റീരിയൽ", "notes ayakku", "material ayakku",
  "ನೋಟ್ಸ್", "ಸಾಮಗ್ರಿ", "ಓದುವ ಸಾಮಗ್ರಿ", "ಮೆಟೀರಿಯಲ್", "notes kalisi", "material kalisi",
];
const DOUBT_WORDS = [
  "doubt", "doubts", "doubt hai", "i have a doubt", "have a doubt",
  "डाउट", "संदेह", "शंका", "डाउट है", "doubt hai", "sandeh",
  "ഡൗട്ട്", "സംശയം", "സംശയങ്ങൾ", "samshayam", "samshayam undu",
  "ಡೌಟ್", "ಸಂದೇಹ", "ಸಂಶಯ", "sandeha", "doubt ide",
];
const NEXT_RE = wordRe(NEXT_WORDS);
const MATERIAL_RE = wordRe(MATERIAL_WORDS);
const DOUBT_RE = wordRe(DOUBT_WORDS);
const DOUBT_ANYCASE_RE = wordRe(DOUBT_WORDS, "giu"); // to cut the word out of the text as the parent typed it (case kept: a doubt may be a formula)

/** The class words, by what they mean, for the review sheets (every language's words are in each list, with the Latin-letter forms people type). */
export const CLASS_WORDS = { next: NEXT_WORDS, material: MATERIAL_WORDS, doubt: DOUBT_WORDS } as const;

/** What a contact's message asks about classes, or null when it is not about classes (then the fee reading goes on exactly as before). */
export type ContactAsk =
  | { kind: "next" }
  | { kind: "material" }
  /** `text` is the doubt when it came with the word ("doubt: how do I solve this"); left out, the agent asks for it and takes the next message. */
  | { kind: "doubt"; text?: string }
  | { kind: "consent"; answer: "yes" | "no" };

/** A doubt written with the word needs at least this much besides it; shorter is just the word, and the next message is the doubt. */
const MIN_DOUBT_CHARS = 8;

export function readContactWords(text: string, state: { consentPending: boolean }): ContactAsk | null {
  const t = canon(text);
  if (isStop(t)) return null; // STOP is the fee reading's: opt-out, as ever
  if (state.consentPending) {
    const tokens = t.trim().split(/\s+/u).filter(Boolean).length;
    if (tokens <= 3 && NO_RE.test(t) && !YES_RE.test(t)) return { kind: "consent", answer: "no" };
    if (tokens <= 3 && YES_RE.test(t)) return { kind: "consent", answer: "yes" };
  }
  if (DOUBT_RE.test(t)) {
    const cut = (source: string) => source.replace(DOUBT_ANYCASE_RE, " ").replace(/^[\s:,.\-–—]+|[\s:,.\-–—]+$/gu, "").replace(/\s+/gu, " ");
    const typed = cut(text);
    const rest = typed.length < text.trim().length ? typed : cut(t); // the word was found in the text as typed; if only the plain form matches, cut from that
    return rest.length >= MIN_DOUBT_CHARS ? { kind: "doubt", text: rest } : { kind: "doubt" };
  }
  if (NEXT_RE.test(t)) return { kind: "next" };
  if (MATERIAL_RE.test(t)) return { kind: "material" };
  return null;
}

// ---- the teacher's commands (the owner's number; English words, like "approve q-3") ---------------------------------------------------------------------------------

export type TeacherCommand =
  | { kind: "link"; batch: string; which: "batch" | "next"; url: string }
  | { kind: "present" }
  | { kind: "absent"; numbers: number[] }
  | { kind: "class" }
  | { kind: "doubts" }
  | { kind: "answered"; id: string }
  | { kind: "share"; batch: string }
  /** It starts like a class command but cannot be read (a link with no batch, "absent" with no numbers): the teacher is told what to write. */
  | { kind: "bad" };

/** The address the teacher pastes: https, a real host and a path, no spaces, and short. It is the one shape the outgoing check can allow as a link (it needs a path). */
const URL_ONLY = /^https:\/\/(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d{2,5})?\/[^\s()<>"']+$/iu;
export const isClassLink = (text: string): boolean => text.length <= 300 && URL_ONLY.test(text) && !/[.,;:!?]$/u.test(text); // not ending in punctuation: the check reads a link up to it

/** The teacher's words, or null when they are not a class command (the owner's message then goes on as before). */
export function readTeacherCommand(text: string): TeacherCommand | null {
  const t = text.trim();
  let m = /^link\s+(.+?)\s+(?:(next|today)\s+)?(https:\/\/\S+)$/iu.exec(t);
  if (m) return isClassLink(m[3]) ? { kind: "link", batch: m[1].trim(), which: m[2] ? "next" : "batch", url: m[3] } : { kind: "bad" };
  if (/^link(\s|$)/iu.test(t)) return { kind: "bad" };
  if (/^present$/iu.test(t)) return { kind: "present" };
  m = /^absent((?:[\s,]+\d{1,3})+)$/iu.exec(t);
  if (m) return { kind: "absent", numbers: [...new Set((m[1].match(/\d{1,3}/gu) ?? []).map(Number))] };
  if (/^absent(\s|$)/iu.test(t)) return { kind: "bad" };
  if (/^(?:class|classes)$/iu.test(t)) return { kind: "class" };
  if (/^doubts?$/iu.test(t)) return { kind: "doubts" };
  m = /^answered\s+(d-\d{1,6})$/iu.exec(t);
  if (m) return { kind: "answered", id: m[1].toLowerCase() };
  m = /^share\s+(.+)$/iu.exec(t);
  if (m) return { kind: "share", batch: m[1].trim() };
  return null;
}
