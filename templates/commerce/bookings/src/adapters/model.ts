// The Bookings intents: what a customer can mean in a booking conversation, and the check that something a parser returned is really one of them.
// The seam itself (the cost of reading a message, the parser types, what a template tells the shared readers) is modules/understanding/model.ts.
// The deterministic parser in rule-parser.ts is what the tests and the hand check use; model-llm.ts asks a real model over HTTP and falls back to the rule parser.
import { LANGUAGES } from "../../../../../modules/language/languages.ts";
import type { Language } from "../../../../../modules/language/languages.ts";
import type { DatePhrase, TimePhrase } from "../../../../../modules/language/dates.ts";
import { isObj } from "../../../../../modules/understanding/model.ts";
import type { IntentParser as Parser, ParseOptionsBase, ParseResult as Result } from "../../../../../modules/understanding/model.ts";
import type { Service } from "../settings.ts";

export type IntentKind = "book" | "cancel" | "reschedule" | "yes" | "no" | "stop" | "greeting" | "owner" | "keep" | "unknown";
export const KINDS: IntentKind[] = ["book", "cancel", "reschedule", "yes", "no", "stop", "greeting", "owner", "keep", "unknown"];
/**
 * What a model is asked to tell apart. "keep" (leave my booking as it is) only ever comes from a button, so a model is not offered it.
 * "owner" is a customer asking for a person: the agent tells the owner and the customer, and decides nothing else.
 */
export const MODEL_KINDS: IntentKind[] = KINDS.filter((k) => k !== "keep");

export interface Intent {
  kind: IntentKind;
  /** The language the customer wrote in, when it is clear (a bare "yes" says nothing). */
  language?: Language;
  serviceId?: string;
  /** A price the customer proposed, in rupees. "Free" is 0. The agent never accepts it; it only has to answer it. */
  offerInr?: number;
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
  if (raw.date !== undefined) {
    const d = raw.date;
    const ok = isObj(d) && (
      (d.kind === "relative" && (d.offsetDays === 0 || d.offsetDays === 1 || d.offsetDays === 2))
      || (d.kind === "weekday" && Number.isInteger(d.weekday) && (d.weekday as number) >= 0 && (d.weekday as number) <= 6 && ["next", "this", "plain"].includes(d.which as string))
      || (d.kind === "calendar" && Number.isInteger(d.day) && (d.day as number) >= 1 && (d.day as number) <= 31 && Number.isInteger(d.month) && (d.month as number) >= 1 && (d.month as number) <= 12));
    if (!ok) return null;
    intent.date = d as unknown as DatePhrase;
  }
  if (raw.time !== undefined) {
    const t = raw.time;
    const ok = isObj(t) && Number.isInteger(t.hour) && (t.hour as number) >= 0 && (t.hour as number) <= 23
      && Number.isInteger(t.minute) && (t.minute as number) >= 0 && (t.minute as number) <= 59
      && (t.period === undefined || ((t.period === "am" || t.period === "pm") && (t.hour as number) >= 1 && (t.hour as number) <= 12)); // "18:00 pm" would be hour 30
    if (!ok) return null;
    intent.time = t as unknown as TimePhrase;
  }
  if (raw.overrideAttempt !== undefined) intent.overrideAttempt = raw.overrideAttempt === true;
  if (raw.ask !== undefined) intent.ask = raw.ask === true;
  return intent;
}
