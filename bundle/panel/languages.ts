// The four word sets, by language code, and which of them are machine-written and still waiting for a native reader.
import type { Language } from "../../pathways/bookings/src/settings.ts";
import { en } from "./words.ts";
import type { Words } from "./words.ts";
import { hi } from "./words.hi.ts";
import { kn } from "./words.kn.ts";
import { ml } from "./words.ml.ts";

export const WORDS: Record<Language, Words> = { en, hi, ml, kn };

/**
 * REVIEW MARKERS. English is the source. Hindi, Malayalam and Kannada are machine-written, so each is marked "machine-written" until a native reader has
 * read every line (Malayalam and Kannada on the REVIEW sheets, section 7; Hindi by a native reader outside the sheets, as before). The page says so in
 * a line at the foot (`draftNote`) for as long as the marker stays. Change a marker only when a named reader has signed the sheet.
 */
export const REVIEW_STATE: Record<Language, "source" | "machine-written"> = { en: "source", hi: "machine-written", ml: "machine-written", kn: "machine-written" };
export const isDraftLanguage = (l: string): boolean => REVIEW_STATE[l as Language] === "machine-written";
