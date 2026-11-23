// The Bookings intents: what a customer can mean in a booking conversation, and the check that something a parser returned is really one of them.
// The seam itself (the cost of reading a message, the parser types, what a template tells the shared readers) is modules/understanding/model.ts.
// The deterministic parser in rule-parser.ts is what the tests and the hand check use; model-llm.ts asks a real model over HTTP and falls back to the rule parser.
import { LANGUAGES } from "../../../../../modules/language/languages.ts";
import type { Language } from "../../../../../modules/language/languages.ts";
import type { DatePhrase, TimePhrase } from "../../../../../modules/language/dates.ts";
import { isDatePhrase, isTimePhrase } from "../../../../../modules/language/dates.ts";
import { isObj } from "../../../../../modules/understanding/model.ts";
import type { IntentParser as Parser, ParseOptionsBase, ParseResult as Result } from "../../../../../modules/understanding/model.ts";
import type { Service } from "../settings.ts";

export type IntentKind = "book" | "cancel" | "reschedule" | "yes" | "no" | "stop" | "greeting" | "owner" | "keep" | "paid" | "unknown";
export const KINDS: IntentKind[] = ["book", "cancel", "reschedule", "yes", "no", "stop", "greeting", "owner", "keep", "paid", "unknown"];
/**
 * What a model is asked to tell apart. "keep" (leave my booking as it is) only ever comes from a button, so a model is not offered it; nor is "paid" ("I have
 * paid", a UPI shop's button, B33), which a UPI shop also reads from a few plain words before any model (agent.ts), and which never marks anything paid.
 * "owner" is a customer asking for a person: the agent tells the owner and the customer, and decides nothing else.
 */
export const MODEL_KINDS: IntentKind[] = KINDS.filter((k) => k !== "keep" && k !== "paid");

export interface Intent {
  kind: IntentKind;
  /** The language the customer wrote in, when it is clear (a bare "yes" says nothing). */
  language?: Language;
  serviceId?: string;
  /** A price the customer proposed, in rupees. "Free" is 0. The agent never accepts it; it only has to answer it. */
  offerInr?: number;
  /**
   * E1 (24 Nov 2026): the customer asks for a lower price WITHOUT naming one ("any discount?"); never set with offerInr (a named price wins). It decides nothing: a shop with
   * the discount authority answers with the price it may give alone, a shop without one as before.
   */
  askDiscount?: boolean;
  date?: DatePhrase;
  time?: TimePhrase;
  /** The message tried to change the rules ("ignore your rules"). It is treated as ordinary text and changes nothing. */
  overrideAttempt?: boolean;
  /** A cancel that came from the "Cancel booking" button: ask "are you sure?" first. Typed words cancel at once, as they always did. Only the buttons set it. */
  ask?: boolean;
}

export interface ParseContext { services: Service[]; languages: Language[] }

/** A time the shop could still be booked for, taken from the calendar, that the decision model may pick. */
export interface CandidateSlot { startMs: number; date: DatePhrase; time: TimePhrase; label: string }

/** What the agent tells a parser about this one message. */
export interface ParseOptions extends ParseOptionsBase {
  /** The next few free times, asked for only if a decision model is going to be asked. */
  slots?: () => Promise<CandidateSlot[]>;
}

/** What a parser can say besides the intent (modules/understanding/model.ts), for Bookings' intents. */
export type ParseResult = Result<Intent>;

export type IntentParser = Parser<Intent, ParseContext, ParseOptions>;

/** Check that something a parser returned is really an Intent. Anything else (null, nonsense) is not an Intent. */
export function coerceIntent(raw: unknown, context: ParseContext): Intent | null {
  if (!isObj(raw) || !KINDS.includes(raw.kind as IntentKind)) return null;
  const intent: Intent = { kind: raw.kind as IntentKind };
  if (raw.language !== undefined) {
    if (!LANGUAGES.includes(raw.language as Language)) return null;
    intent.language = raw.language as Language;
  }
  if (raw.serviceId !== undefined) {
    if (!context.services.some((s) => s.id === raw.serviceId)) return null;
    intent.serviceId = raw.serviceId as string;
  }
  if (raw.offerInr !== undefined) {
    if (typeof raw.offerInr !== "number" || !Number.isInteger(raw.offerInr) || raw.offerInr < 0) return null;
    intent.offerInr = raw.offerInr;
  }
  // a date and a time of the shapes dates.ts makes, or the answer is refused (the checks are shared with Orders since 23 Nov 2026)
  if (raw.date !== undefined) { if (!isDatePhrase(raw.date)) return null; intent.date = raw.date; }
  if (raw.time !== undefined) { if (!isTimePhrase(raw.time)) return null; intent.time = raw.time; }
  if (raw.askDiscount === true && intent.offerInr === undefined) intent.askDiscount = true; // E1: only a plain true, and never beside a named price
  if (raw.overrideAttempt !== undefined) intent.overrideAttempt = raw.overrideAttempt === true;
  if (raw.ask !== undefined) intent.ask = raw.ask === true;
  return intent;
}
