// A listings-only shop's settings: the shop's name, its place, the trade in the Operator's words, the languages it shows, and the owner. Nothing else: no services, prices,
// hours, deposits or limits, because this shop takes no booking, no order and no fee and holds no money. What it keeps is its LISTINGS, in the shop's own store
// (modules/listings), and those are the owner's to write from their app.
//
// Two things the validator always makes true, because the rest of the system quietly switches the product off without them (go/internal/runtime drops listings for a
// shop with no `assistant` or no `owner`; go/internal/runtime drops the owner's sign-in without an `owner`):
//   - `assistant` is always there (an empty block turns the shop's assistant on with its defaults);
//   - `owner.whatsapp` is always a string. An owner who gave NO number gets the marker NO_NUMBER: it names the owner inside the store (cards, the record) and is never dialled,
//     because this shop has no WhatsApp at all. The owner signs in with a passkey on the Operator's one-use code (README.md, "The first sign-in").
// The validator is written by hand and says what is wrong in plain words, so a builder can fix the file without a manual.
import { LANGUAGES, LANGUAGE_NAMES } from "../../../../modules/language/languages.ts";
import type { Language } from "../../../../modules/language/languages.ts";
import { readAssistantSettings } from "../../../../modules/assistant/settings.ts";
import type { AssistantSettings } from "../../../../modules/assistant/settings.ts";
import { isValidTimeZone } from "../../../../modules/core/time.ts";

/** What stands for "the owner" in the store when the owner gave no number. Not a number anyone has: a plus and eleven zeros. */
export const NO_NUMBER = "+00000000000";
const PHONE = /^\+[1-9]\d{7,14}$/u;
const PINCODE = /^[1-9]\d{5}$/u;
export const MAX_NAME = 60;

export interface Settings {
  name: string;
  /** Where the shop is: shown on its page and used by "near me". The owner can change it in their app. */
  place: { town: string; pincode?: string };
  /** What the shop sells, in the Operator's own words ("pets", "second-hand cycles"). A label for the Operator and the shop's page; never an instruction. */
  trade?: string;
  timezone: string;
  /** The languages the shop shows. The first is the default. */
  languages: Language[];
  owner: { whatsapp: string; language: Language; /** True when the owner gave no number: whatsapp is NO_NUMBER. */ noNumber?: true };
  assistant: AssistantSettings;
}

export type SettingsResult = { ok: true; settings: Settings } | { ok: false; errors: string[] };
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const languageList = () => LANGUAGES.map((l) => `"${l}" (${LANGUAGE_NAMES[l]})`).join(", ");
/** One short line: no control characters or line breaks (it is shown on the shop's page and written in the record's notes). */
const oneLine = (v: unknown, max: number): v is string => typeof v === "string" && v.trim() !== "" && v.trim().length <= max && !/[\p{Cc}]/u.test(v);

function unknownKeys(obj: Obj, known: string[], where: string, errors: string[]): void {
  for (const k of Object.keys(obj)) if (!known.includes(k)) errors.push(`${where} has "${k}", which I do not know. Known: ${known.map((n) => `"${n}"`).join(", ")}.`);
}

/** Check a settings object (usually parsed from JSON), fill in the defaults and say what is wrong in plain words. */
export function validateSettings(input: unknown): SettingsResult {
  const errors: string[] = [];
  if (!isObj(input)) return { ok: false, errors: ["The settings must be an object with the shop's name, place, languages and owner."] };
  unknownKeys(input, ["name", "place", "trade", "timezone", "languages", "owner", "assistant", "address"], "the settings", errors);

  if (!oneLine(input.name, MAX_NAME)) errors.push(`Add the shop's name ("name"): one short line, at most ${MAX_NAME} characters.`);
  const timezone = input.timezone ?? "Asia/Kolkata";
  if (typeof timezone !== "string" || !isValidTimeZone(timezone)) errors.push(`The time zone ${JSON.stringify(timezone)} is not one I know. Use a name like "Asia/Kolkata".`);

  let place: Settings["place"] | undefined;
  if (!isObj(input.place)) errors.push('Add the shop\'s place ("place": {"town": "Thrissur", "pincode": "680001"}).');
  else {
    unknownKeys(input.place, ["town", "pincode"], '"place"', errors);
    if (!oneLine(input.place.town, 60)) errors.push('The town ("place.town") is one short line, at most 60 characters.');
    if (input.place.pincode !== undefined && (typeof input.place.pincode !== "string" || !PINCODE.test(input.place.pincode))) errors.push('The pincode ("place.pincode") is six digits, not starting with 0.');
    if (oneLine(input.place.town, 60)) place = { town: (input.place.town as string).trim().replace(/\s+/gu, " "), ...(typeof input.place.pincode === "string" && PINCODE.test(input.place.pincode) ? { pincode: input.place.pincode } : {}) };
  }
  if (input.trade !== undefined && !oneLine(input.trade, 60)) errors.push('The trade ("trade") is a few words in the Operator\'s own language, one short line.');
  if (input.address !== undefined && typeof input.address !== "string") errors.push('The address ("address") must be text.');

  const languages: Language[] = [];
  if (!Array.isArray(input.languages) || input.languages.length === 0) errors.push(`List the languages ("languages"), for example ["en", "hi"]. Known: ${languageList()}.`);
  else for (const l of input.languages) {
    if (!LANGUAGES.includes(l as Language)) errors.push(`The language ${JSON.stringify(l)} is not one I know. Known: ${languageList()}.`);
    else if (!languages.includes(l as Language)) languages.push(l as Language);
  }

  let owner: Settings["owner"] | undefined;
  if (!isObj(input.owner)) errors.push('Add the owner ("owner": their language, and their phone number if they gave one).');
  else {
    unknownKeys(input.owner, ["whatsapp", "language"], '"owner"', errors);
    const language = input.owner.language ?? languages[0];
    if (!LANGUAGES.includes(language as Language)) errors.push(`The owner's language ("owner.language") must be one of ${languageList()}.`);
    // the number is optional here, and only here: with none the owner is "no number" and signs in with the Operator's one-use code
    if (input.owner.whatsapp !== undefined && (typeof input.owner.whatsapp !== "string" || !PHONE.test(input.owner.whatsapp))) errors.push('The owner\'s phone number ("owner.whatsapp") must look like +919812345678, or be left out.');
    if (LANGUAGES.includes(language as Language)) {
      const given = typeof input.owner.whatsapp === "string" && PHONE.test(input.owner.whatsapp) ? input.owner.whatsapp : undefined;
      owner = given ? { whatsapp: given, language: language as Language } : { whatsapp: NO_NUMBER, language: language as Language, noNumber: true };
    }
  }
  // an empty block turns the assistant on with its defaults; the shop always has one (the listings are the assistant's)
  const assistant = readAssistantSettings(input.assistant ?? {}, errors);

  if (errors.length > 0 || !place || !owner || !assistant) return { ok: false, errors };
  return { ok: true, settings: { name: (input.name as string).trim(), place, ...(typeof input.trade === "string" ? { trade: input.trade.trim() } : {}), timezone: timezone as string, languages, owner, assistant } };
}

/** Parse settings, throwing the plain-words problems as one error. For code that holds settings it wrote itself (the tests). */
export function parseSettings(input: unknown): Settings {
  const r = validateSettings(input);
  if (!r.ok) throw new Error(`The settings need fixing:\n- ${r.errors.join("\n- ")}`);
  return r.settings;
}
