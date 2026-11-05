// Understanding a customer's message in three steps, cheapest first, for any template. Each message stops at the first step that is sure:
//
//   0. rules      the template's rule parser (and, in the agent, button and list replies): a price of nothing, no model. What the rules are sure of is the
//                 template's call (`reading.sure`): "STOP", "yes", "no", a greeting, and whatever else needs no help.
//   1. decision   a System One decision model (Laya on the shop server, or Jev hosted). It answers CHOICE questions with probabilities: what the
//                 customer wants, and the few options the shop's own record offers. Below the confidence threshold, or for a language it is not trusted
//                 with, it is "unsure" and the message goes on. The questions are the template's (`reading.decision`).
//   2. model      a small language model over the OpenAI-compatible wire (model-llm.ts), for what the decision model was unsure of. It returns
//                 structured fields only.
//
// No model ever writes to a customer. Every answer becomes an intent that the template's `coerce` checks, and templates write every reply. Phone numbers and
// names are taken out of the message before steps 1 and 2 (redact.ts). The shop's system prompt for step 2 is the same text for every message and
// comes first, so a provider's prompt cache applies.
//
// What each message cost is returned with the intent (`understood`), and the agent writes it to the record. The router keeps no state between messages,
// so a restart forgets nothing that matters; whether a shop may still spend (the monthly allowance, button mode) is the agent's decision, passed in
// as `options.rulesOnly`.
import type { Language } from "../language/languages.ts";
import type { IntentBase, IntentParser, ParseOptionsBase, ParseResult, Reading, Step, TokenUsage, Understood } from "./model.ts";
import type { ModelParser } from "./model-llm.ts";
import { costMicroInr, dayOf, rateFor } from "./rates.ts";
import type { Rate } from "./rates.ts";
import { redact } from "./redact.ts";
import { SystemOneError } from "./system-one.ts";
import type { ChoiceAnswer, SystemOne } from "./system-one.ts";

export interface DecisionStep {
  client: SystemOne;
  /** How likely the chosen option must be, or the message is "unsure" and goes to the language model. Default 0.75; the eval is how to tune it. */
  threshold?: number;
  /** The languages this decision model is trusted with. A message in another goes straight to the language model. Default Hindi and English: Laya's card does not
   * mention Malayalam or Kannada (economics note, section 3.2), so those go to step 2 until they pass the eval. */
  languages?: readonly Language[];
}

export interface ModelStep<I extends IntentBase = IntentBase, C = unknown> {
  parser: ModelParser<I, C>;
  /** Who the provider is, for the record and the rate table ("deepinfra"). */
  provider: string;
  /** The model id, as the provider calls it. */
  model: string;
}

export interface RouterOptions<I extends IntentBase, C, O extends ParseOptionsBase> {
  /** What is particular to the template: its rules, its intents, its questions (modules/understanding/model.ts). */
  reading: Reading<I, C, O>;
  decision?: DecisionStep;
  model?: ModelStep<I, C>;
  /** Names to take out of messages before a model sees them, besides the ones the router finds by how people introduce themselves. */
  names?: readonly string[];
  /** The time, to date the price. Default: the system clock. */
  now?: () => number;
  /** The price list. Default: rates.ts. */
  rates?: readonly Rate[];
}

export const DEFAULT_THRESHOLD = 0.75;
export const DEFAULT_DECISION_LANGUAGES: readonly Language[] = ["hi", "en"];

interface Spend { step: Step; provider: string; model: string; usage: TokenUsage }

export const chosenProbability = (a: ChoiceAnswer): number => a.probabilities[a.choice] ?? 0;

export function createRouter<I extends IntentBase, C, O extends ParseOptionsBase>(options: RouterOptions<I, C, O>): IntentParser<I, C, O> & { parseDetailed(text: string, context: C, options?: O): Promise<ParseResult<I>> } {
  const { reading } = options;
  const now = options.now ?? Date.now;
  const table = options.rates;

  /** Add up what was spent. A call with no price makes the total unknown (null): a missing price is never a free call. */
  function understood(handled: Spend, spends: Spend[], tried: Step[], failed: Step[]): Understood {
    let micro: number | null = 0;
    let rateDate: string | null = null;
    for (const s of spends) {
      if (s.provider === "rules") continue; // the rule parser runs inside the agent: it costs nothing on any date
      const rate = rateFor(s.provider, s.model, dayOf(now()), table);
      const cost = costMicroInr(rate, s.usage);
      if (cost === null) micro = null; else if (micro !== null) micro += cost;
      if (rate && (s === handled || rateDate === null)) rateDate = rate.from;
    }
    return {
      step: handled.step, provider: handled.provider, model: handled.model,
      inputTokens: spends.reduce((n, s) => n + s.usage.inputTokens, 0), outputTokens: spends.reduce((n, s) => n + s.usage.outputTokens, 0),
      costMicroInr: micro, rateDate: micro === null ? null : rateDate, tried, failed,
    };
  }

  async function parseDetailed(text: string, context: C, parseOptions: O = {} as O): Promise<ParseResult<I>> {
    const ruled = reading.rules(text, context);
    const rules: Spend = { step: "rules", provider: "rules", model: "rule-parser", usage: { inputTokens: 0, outputTokens: 0 } };
    const tried: Step[] = ["rules"];
    const failed: Step[] = [];
    const spends: Spend[] = [];
    const finish = (intent: I, handled: Spend, reason?: string): ParseResult<I> => ({ intent, ...(reason ? { fallbackReason: reason } : {}), understood: understood(handled, handled === rules ? [rules, ...spends] : [...spends], tried, failed) });

    if (parseOptions.rulesOnly || reading.sure(ruled) || (!options.decision && !options.model)) return finish(ruled, rules);

    const stripped = redact(text, options.names).text; // numbers and names do not leave the machine
    let reason: string | undefined;

    // ---- step 1: a decision model ----
    const step1 = options.decision;
    const trusted = step1 && reading.decision && (ruled.language === undefined || (step1.languages ?? DEFAULT_DECISION_LANGUAGES).includes(ruled.language));
    if (step1 && trusted) {
      tried.push("decision");
      const spend: Spend = { step: "decision", provider: step1.client.kind, model: step1.client.model, usage: { inputTokens: 0, outputTokens: 0 } };
      try {
        const plan = await reading.decision!(context, ruled, parseOptions);
        const decision = await step1.client.decide(stripped, plan.questions);
        spend.usage = decision.usage;
        spends.push(spend);
        const read = plan.read(decision.answers as Record<string, ChoiceAnswer>, step1.threshold ?? DEFAULT_THRESHOLD);
        if (read) return finish(read, spend);
      } catch (e) {
        spends.push(spend);
        failed.push("decision");
        reason = e instanceof SystemOneError ? e.message : "the decision model could not be used";
      }
    }

    // ---- step 2: a small language model ----
    const step2 = options.model;
    if (step2) {
      tried.push("model");
      const result = await step2.parser.parseDetailed(stripped, context);
      const spend: Spend = { step: "model", provider: step2.provider, model: step2.model, usage: result.usage ?? { inputTokens: 0, outputTokens: 0 } };
      spends.push(spend);
      if (result.fallbackReason === undefined) {
        let intent = { ...result.intent };
        if (ruled.overrideAttempt) intent.overrideAttempt = true;
        if (reading.merge) intent = reading.merge(intent, ruled);
        return finish(intent, spend);
      }
      failed.push("model");
      reason = result.fallbackReason;
    }
    // Nothing could read it better than the rules did (a step was unsure with nothing after it, or every step asked failed): the rules' reading stands.
    return finish(ruled, rules, failed.length > 0 ? reason : undefined);
  }

  return { parse: async (text, context) => (await parseDetailed(text, context)).intent, parseDetailed };
}

