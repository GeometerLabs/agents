// The Fees intents: what a parent can mean when they write about a fee, and the check that something a parser returned is really one of them.
// The seam itself (the cost of reading a message, the parser types, what a template tells the shared readers) is modules/understanding/model.ts.
import { LANGUAGES } from "../../../../../modules/language/languages.ts";
import type { Language } from "../../../../../modules/language/languages.ts";
import { isObj } from "../../../../../modules/understanding/model.ts";
import type { IntentParser as Parser, ParseOptionsBase, ParseResult as Result } from "../../../../../modules/understanding/model.ts";

/**
 *  - pay:      wants the payment link (or the way to pay)
 *  - paid:     says they have already paid
 *  - discount: asks for the fee to be lowered or waived (`amountInr` when they name how much)
 *  - refund:   asks for money back (`amountInr` when they name how much)
 *  - owner:    asks to talk to the owner or to a person
 */
export type IntentKind = "pay" | "paid" | "discount" | "refund" | "owner" | "yes" | "no" | "stop" | "greeting" | "unknown";
export const KINDS: IntentKind[] = ["pay", "paid", "discount", "refund", "owner", "yes", "no", "stop", "greeting", "unknown"];
export const MODEL_KINDS: IntentKind[] = KINDS;

export interface Intent {
  kind: IntentKind;
  /** The language the parent wrote in, when it is clear (a bare "yes" says nothing). */
  language?: Language;
  /** An amount in rupees the parent named with a discount or a refund. The agent never accepts it as it stands; it only has to answer it. */
  amountInr?: number;
  /** Which fee a button belongs to ("f-3"): the buttons carry it, so a parent with two children is not asked "which one?". Never from typed words. */
  dueId?: string;
  /** The message tried to change the rules ("ignore your rules"). It is treated as ordinary text and changes nothing. */
  overrideAttempt?: boolean;
}

export interface ParseContext { languages: Language[] }

export type ParseOptions = ParseOptionsBase;
export type ParseResult = Result<Intent>;
export type IntentParser = Parser<Intent, ParseContext, ParseOptions>;

/** Check that something a parser returned is really an Intent. Anything else (null, nonsense) is not an Intent. */
export function coerceIntent(raw: unknown, _context: ParseContext): Intent | null {
  if (!isObj(raw) || !KINDS.includes(raw.kind as IntentKind)) return null;
  const intent: Intent = { kind: raw.kind as IntentKind };
  if (raw.language !== undefined) {
    if (!LANGUAGES.includes(raw.language as Language)) return null;
    intent.language = raw.language as Language;
  }
  if (raw.amountInr !== undefined) {
    if (typeof raw.amountInr !== "number" || !Number.isInteger(raw.amountInr) || raw.amountInr < 1 || raw.amountInr > 1_000_000) return null;
    intent.amountInr = raw.amountInr;
  }
  if (raw.dueId !== undefined) {
    if (typeof raw.dueId !== "string" || !/^f-\d{1,9}$/u.test(raw.dueId)) return null;
    intent.dueId = raw.dueId;
  }
  if (raw.overrideAttempt !== undefined) intent.overrideAttempt = raw.overrideAttempt === true;
  return intent;
}
