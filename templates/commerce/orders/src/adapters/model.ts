// The Orders intents: what a customer can mean when they write to a shop that takes pre-orders, and the check that something a parser returned is really one of them.
// The seam itself (the cost of reading a message, the parser types, what a template tells the shared readers) is modules/understanding/model.ts.
import { LANGUAGES } from "../../../../../modules/language/languages.ts";
import type { Language } from "../../../../../modules/language/languages.ts";
import type { DatePhrase, TimePhrase } from "../../../../../modules/language/dates.ts";
import { isObj } from "../../../../../modules/understanding/model.ts";
import type { IntentParser as Parser, ParseOptionsBase, ParseResult as Result } from "../../../../../modules/understanding/model.ts";
import type { MenuItem } from "../settings.ts";

/**
 *  - order:   wants something: items, a day, a slot, pickup or delivery (any of these may be missing; the agent asks for what is)
 *  - cancel:  wants to cancel (`ask` when it came from the "Cancel order" button, which asks "are you sure" first)
 *  - refund:  asks for money back (treated as a request to cancel)
 *  - paid:    says they have paid
 *  - keep:    "No, keep it" after a cancel question
 *  - owner:   asks to talk to the owner or to a person
 */
export type IntentKind = "order" | "cancel" | "refund" | "paid" | "keep" | "owner" | "yes" | "no" | "stop" | "greeting" | "unknown";
export const KINDS: IntentKind[] = ["order", "cancel", "refund", "paid", "keep", "owner", "yes", "no", "stop", "greeting", "unknown"];
/** What a language model may answer: it reads the kind and the language and a price named; the items, day and slot come from the rules. */
export const MODEL_KINDS: IntentKind[] = KINDS.filter((k) => k !== "keep");

export interface IntentLine { itemId: string; qty: number }

export interface Intent {
  kind: IntentKind;
  /** The language the customer wrote in, when it is clear (a bare "yes" says nothing). */
  language?: Language;
  items?: IntentLine[];
  date?: DatePhrase;
  time?: TimePhrase;
  /** A slot named by a tap on the slot list. */
  slotId?: string;
  mode?: "pickup" | "delivery";
  /** A price the customer proposed. The agent never accepts one below the menu price. */
  offerInr?: number;
  ask?: boolean;
  /** The message tried to change the rules ("ignore your rules"). It is treated as ordinary text and changes nothing. */
  overrideAttempt?: boolean;
}

export interface ParseContext { menu: MenuItem[]; languages: Language[] }

export type ParseOptions = ParseOptionsBase;
export type ParseResult = Result<Intent>;
export type IntentParser = Parser<Intent, ParseContext, ParseOptions>;

const isWhole = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

/** Check that something a parser returned is really an Intent. Anything else (null, nonsense) is not an Intent. */
export function coerceIntent(raw: unknown, context: ParseContext): Intent | null {
  if (!isObj(raw) || !KINDS.includes(raw.kind as IntentKind)) return null;
  const intent: Intent = { kind: raw.kind as IntentKind };
  if (raw.language !== undefined) {
    if (!LANGUAGES.includes(raw.language as Language)) return null;
    intent.language = raw.language as Language;
  }
  if (raw.offerInr !== undefined) {
    if (!isWhole(raw.offerInr) || raw.offerInr < 0 || raw.offerInr > 1_000_000) return null;
    intent.offerInr = raw.offerInr;
  }
  if (raw.items !== undefined) {
    if (!Array.isArray(raw.items)) return null;
    const lines: IntentLine[] = [];
    for (const l of raw.items) {
      if (!isObj(l) || typeof l.itemId !== "string" || !context.menu.some((i) => i.id === l.itemId) || !isWhole(l.qty) || l.qty < 1 || l.qty > 1000) return null;
      lines.push({ itemId: l.itemId, qty: l.qty });
    }
    intent.items = lines;
  }
  if (raw.date !== undefined) intent.date = raw.date as DatePhrase;
  if (raw.time !== undefined) intent.time = raw.time as TimePhrase;
  if (raw.slotId !== undefined) { if (typeof raw.slotId !== "string" || !/^[a-z0-9-]{1,60}$/u.test(raw.slotId)) return null; intent.slotId = raw.slotId; }
  if (raw.mode !== undefined) { if (raw.mode !== "pickup" && raw.mode !== "delivery") return null; intent.mode = raw.mode; }
  if (raw.ask !== undefined) intent.ask = raw.ask === true;
  if (raw.overrideAttempt !== undefined) intent.overrideAttempt = raw.overrideAttempt === true;
  return intent;
}
