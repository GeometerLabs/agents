// The model seam, for every template: turn one customer message into an Intent. Messages going OUT are templates only, so a model (when there is one) only
// reads. What the intents ARE belongs to each template (Bookings has "book", "cancel"; Fees has "pay", "paid", "discount"). What is the same for all:
// the cost of reading a message, the three steps, and `Reading`, the few things a template tells the shared readers (router.ts, model-llm.ts).
import type { Language } from "../language/languages.ts";
import type { ChoiceAnswer, ChoiceQuestion } from "./system-one.ts";

/** Tokens a model call reported, for cost. `cachedInputTokens`: the part of the input the provider read from its prompt cache, when it says. */
export interface TokenUsage { inputTokens: number; outputTokens: number; cachedInputTokens?: number }

/** Which step of the three read a message: the rules, a System One decision model, or a small language model. */
export type Step = "rules" | "decision" | "model";

/**
 * What it cost to understand one message. Written to the record (see templates/commerce/bookings/Explanation.md, "Understanding record fields (for the cost meter)").
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
  /** The steps left out on purpose because they were paused after failing again and again (ai-state.ts). Left out of the object when none was. */
  skipped?: Step[];
}

/** What it costs to read a message with the rules alone: nothing. A parser that is not a router says nothing about cost, and it is the rules. */
export const RULES: Understood = { step: "rules", provider: "rules", model: "rule-parser", inputTokens: 0, outputTokens: 0, costMicroInr: 0, rateDate: null, tried: ["rules"], failed: [] };

/** What every template's intent has: its kind, the language the customer wrote in when it is clear, and whether the message tried to change the rules. */
export interface IntentBase {
  kind: string;
  /** The language the customer wrote in, when it is clear (a bare "yes" says nothing). */
  language?: Language;
  /** The message tried to change the rules ("ignore your rules"). It is treated as ordinary text and changes nothing. */
  overrideAttempt?: boolean;
}

/** What a parser can say besides the intent. */
export interface ParseResult<I extends IntentBase = IntentBase> {
  intent: I;
  /** Set when the model could not be used: why, in a few plain words ("no answer within 8000 ms"). The intent then came from the rule parser. */
  fallbackReason?: string;
  /** What the model call reported, when it answered at all (a call whose answer was unusable still cost tokens). */
  usage?: TokenUsage;
  /** How long the model call took, in milliseconds. */
  latencyMs?: number;
  /** Which step answered, and what it cost. A parser that is not a router leaves it out and the agent records the rules. */
  understood?: Understood;
}

/** What the agent tells a parser about this one message. Templates add to it (Bookings adds the free times a decision model may pick from). */
export interface ParseOptionsBase {
  /** Read it with the rules only: the shop is in button mode (allowance used up, switched off from outside, or a model is down). */
  rulesOnly?: boolean;
  /**
   * Steps not to ask this time because they keep failing and are paused (ai-state.ts). The reader sets it. The router honours it only for a step with another step
   * after it, so a message is never left with nobody to read it except the rules because of a pause.
   */
  skipSteps?: readonly Step[];
}

export interface IntentParser<I extends IntentBase = IntentBase, C = unknown, O extends ParseOptionsBase = ParseOptionsBase> {
  parse(text: string, context: C): Promise<I>;
  /**
   * Optional. The same reading, plus why a fallback was used. The agent uses it when a parser has it, so the record can
   * note it. It lives beside `parse` because coerceIntent keeps only an intent's own fields, so a reason cannot ride on one.
   */
  parseDetailed?(text: string, context: C, options?: O): Promise<ParseResult<I>>;
}

export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** How likely the decision model thought the option it chose was, 0 to 1. Here and not in the router, so a template's reading can use it without the router, the price table and the HTTP code coming with it (the browser demo has none of them). */
export const chosenProbability = (a: ChoiceAnswer): number => a.probabilities[a.choice] ?? 0;

/** What the decision model is asked for one message, and how its answers become an intent. `read` gives null when the model is not sure. */
export interface DecisionPlan<I extends IntentBase> {
  questions: Record<string, ChoiceQuestion>;
  read(answers: Record<string, ChoiceAnswer>, threshold: number): I | null;
}

/**
 * What a template tells the shared readers. The router and the language-model parser do the same work for every template (the three steps, the HTTP
 * wires, the cost, the fallback to the rules); this is the part that is about THIS template's intents.
 */
export interface Reading<I extends IntentBase, C, O extends ParseOptionsBase = ParseOptionsBase> {
  /** Step 0, and what is used when a model cannot be: the deterministic parser. */
  rules(text: string, context: C): I;
  /** Check that something a parser returned is really an intent of this template. Anything else (null, nonsense) is not. */
  coerce(raw: unknown, context: C): I | null;
  /** The system prompt for the language model. The same text for every message of a shop, so a provider can cache it. */
  prompt(context: C): string;
  /** The JSON schema of the model's answer. */
  schema(context: C): Record<string, unknown>;
  /** The model's JSON answer with its nulls taken out, in the shape `coerce` expects. */
  shape(answer: unknown): unknown;
  /** Is the rules' reading enough on its own? Then no model is asked. */
  sure(ruled: I): boolean;
  /** The questions for a decision model, and how to read its answers. Left out: the template has no decision step. */
  decision?(context: C, ruled: I, options: O): Promise<DecisionPlan<I>>;
  /** After the language model answered: put back what the rules read and the model may have missed. */
  merge?(modelIntent: I, ruled: I): I;
}
