// The model seam: turn one customer message into an Intent. v0 messages going OUT are templates only, so the model
// (when there is one) only reads. The deterministic parser in rule-parser.ts is what the tests and the hand check use;
// model-llm.ts is the parser that asks a real model over HTTP, and falls back to the rule parser when it cannot.
import { LANGUAGES } from "../settings.ts";
import type { Language, Service } from "../settings.ts";
import type { DatePhrase, TimePhrase } from "../language/dates.ts";

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

/** Tokens a model call reported, for cost. `cachedInputTokens`: the part of the input the provider read from its prompt cache, when it says. */
export interface TokenUsage { inputTokens: number; outputTokens: number; cachedInputTokens?: number }

/** Which step of the three read a message: the rules, a System One decision model, or a small language model. */
export type Step = "rules" | "decision" | "model";

/**
 * What it cost to understand one message. Written to the record (see Explanation.md, "Understanding record fields (for the cost meter)").
 * `costMicroInr`: millionths of a rupee, from the dated rate table; null when the table has no price for that provider and model (never 0).
 */
export interface Understood {
  step: Step;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costMicroInr: number | null;
  /** Date of the rate that priced it ("2026-11-05"), or null when unpriced. */
  rateDate: string | null;
  /** The steps asked, in order: ["rules"], ["rules","decision"], ["rules","decision","model"]. */
  tried: Step[];
  /** The steps that were asked and could not answer (error, timeout, an answer that was not usable). The rules then read the message. */
  failed: Step[];
}

/** A time the shop could still be booked for, taken from the calendar, that the decision model may pick. */
export interface CandidateSlot { startMs: number; date: DatePhrase; time: TimePhrase; label: string }

/** What the agent tells a parser about this one message. */
export interface ParseOptions {
  /** Read it with the rules only: the shop is in button mode (allowance used up, switched off from outside, or a model is down). */
  rulesOnly?: boolean;
  /** The next few free times, asked for only if a decision model is going to be asked. */
  slots?: () => Promise<CandidateSlot[]>;
}

/** What a parser can say besides the intent. */
export interface ParseResult {
  intent: Intent;
  /** Set when the model could not be used: why, in a few plain words ("no answer within 8000 ms"). The intent then came from the rule parser. */
  fallbackReason?: string;
  /** What the model call reported, when it answered at all (a call whose answer was unusable still cost tokens). */
  usage?: TokenUsage;
  /** How long the model call took, in milliseconds. */
  latencyMs?: number;
  /** Which step answered, and what it cost. A parser that is not a router leaves it out and the agent records the rules. */
  understood?: Understood;
}

export interface IntentParser {
  parse(text: string, context: ParseContext): Promise<Intent>;
  /**
   * Optional. The same reading, plus why a fallback was used. The agent uses it when a parser has it, so the record can
   * note it. It lives beside `parse` because coerceIntent keeps only an intent's own fields, so a reason cannot ride on one.
   */
  parseDetailed?(text: string, context: ParseContext, options?: ParseOptions): Promise<ParseResult>;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

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
