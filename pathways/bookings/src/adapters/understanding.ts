// Understanding a customer's message in three steps, cheapest first. Each message stops at the first step that is sure:
//
//   0. rules      the rule parser (and, in the agent, button and list replies): a price of nothing, no model. Sure of "STOP", "yes", "no", "cancel",
//                 a greeting, a move with a day or a time, and a booking that names a service, a day and a time.
//   1. decision   a System One decision model (Laya on the shop server, or Jev hosted). It answers CHOICE questions with probabilities: what the
//                 customer wants, which of the shop's own services, and which of a few free times taken from the calendar. Below the confidence
//                 threshold, or for a language it is not trusted with, it is "unsure" and the message goes on.
//   2. model      a small language model over the OpenAI-compatible wire (model-llm.ts), for what the decision model was unsure of. It returns
//                 structured fields only.
//
// No model ever writes to a customer. Every answer becomes an Intent that coerceIntent checks, and templates write every reply. Phone numbers and
// names are taken out of the message before steps 1 and 2 (redact.ts). The shop's system prompt for step 2 is the same text for every message and
// comes first (model-prompt.ts), so a provider's prompt cache applies.
//
// What each message cost is returned with the intent (`understood`), and the agent writes it to the record. The router keeps no state between messages,
// so a restart forgets nothing that matters; whether a shop may still spend (the monthly allowance, button mode) is the agent's decision, passed in
// as `options.rulesOnly`.
import type { Language } from "../settings.ts";
import { parseIntent } from "./rule-parser.ts";
import type { CandidateSlot, Intent, IntentKind, IntentParser, ParseContext, ParseOptions, ParseResult, Step, TokenUsage, Understood } from "./model.ts";
import type { ModelParser } from "./model-llm.ts";
import { costMicroInr, dayOf, rateFor } from "./rates.ts";
import type { Rate } from "./rates.ts";
import { redact } from "./redact.ts";
import { SystemOneError } from "./system-one.ts";
import type { ChoiceAnswer, ChoiceQuestion, SystemOne } from "./system-one.ts";

export interface DecisionStep {
  client: SystemOne;
  /** How likely the chosen option must be, or the message is "unsure" and goes to the language model. Default 0.75; the eval is how to tune it. */
  threshold?: number;
  /** The languages this decision model is trusted with. A message in another goes straight to the language model. Default Hindi and English: Laya's card does not
   * mention Malayalam or Kannada (economics note, section 3.2), so those go to step 2 until they pass the eval. */
  languages?: readonly Language[];
}

export interface ModelStep {
  parser: ModelParser;
  /** Who the provider is, for the record and the rate table ("deepinfra"). */
  provider: string;
  /** The model id, as the provider calls it. */
  model: string;
}

export interface RouterOptions {
  decision?: DecisionStep;
  model?: ModelStep;
  /** Names to take out of messages before a model sees them, besides the ones the router finds by how people introduce themselves. */
  names?: readonly string[];
  /** The time, to date the price. Default: the system clock. */
  now?: () => number;
  /** The price list. Default: rates.ts. */
  rates?: readonly Rate[];
}

export const DEFAULT_THRESHOLD = 0.75;
export const DEFAULT_DECISION_LANGUAGES: readonly Language[] = ["hi", "en"];

const INTENT_LABELS: Record<string, string> = {
  book: "wants to book an appointment, or asks about a service, a price or a time",
  cancel: "wants to cancel a booking",
  reschedule: "wants a different day or time for a booking they already have",
  yes: "agrees, confirms, or says yes",
  no: "declines, or says no, or says something is wrong",
  greeting: "only says hello",
  owner: "asks to talk to the owner or to a person",
  other: "anything else",
};
const NO_SERVICE = "no_service"; // a label with an underscore: a service id never has one
const NO_SLOT = "no_slot";

const WHAT = "A customer wrote this WhatsApp message to a small shop that takes bookings, in Hindi, English, Malayalam or Kannada (in their own script or in Latin letters). ";

/** Is the rule parser's reading enough on its own? A booking with no service or no time is not: the next step may know. */
export function rulesAreSure(i: Intent): boolean {
  if (i.overrideAttempt) return true; // a trick is answered by the rules; paying for a model to read it helps nobody
  switch (i.kind) {
    case "stop": case "yes": case "no": case "cancel": case "greeting": case "owner": case "keep": return true;
    case "reschedule": return i.date !== undefined || i.time !== undefined;
    case "book": return i.serviceId !== undefined && i.date !== undefined && i.time !== undefined;
    default: return false;
  }
}

interface Spend { step: Step; provider: string; model: string; usage: TokenUsage }

function questionsFor(context: ParseContext, ruled: Intent, slots: CandidateSlot[]): Record<string, ChoiceQuestion> {
  const questions: Record<string, ChoiceQuestion> = {
    intent: { type: "choice", instructions: `${WHAT}What does the customer want?`, criteria: INTENT_LABELS },
    service: {
      type: "choice", instructions: `${WHAT}Which of the shop's services does the customer mean?`,
      criteria: {
        ...Object.fromEntries(context.services.map((s) => [s.id, Object.values(s.names).flat().join(" / ")])),
        [NO_SERVICE]: "no service is named or meant",
      },
    },
  };
  if (slots.length > 0) {
    questions.slot = {
      type: "choice", instructions: `${WHAT}Which of these free times does the customer mean? Answer ${NO_SLOT} unless the message points at one of them.`,
      criteria: { ...Object.fromEntries(slots.map((s, i) => [`slot_${i + 1}`, s.label])), [NO_SLOT]: "none of these times" },
    };
  }
  return questions;
}

const chosenProbability = (a: ChoiceAnswer): number => a.probabilities[a.choice] ?? 0;

/** The decision model's reading, or null when it is unsure. */
function readDecision(answers: Record<string, ChoiceAnswer>, ruled: Intent, slots: CandidateSlot[], threshold: number): Intent | null {
  const intent = answers.intent;
  if (chosenProbability(intent) < threshold) return null;
  const kind: IntentKind = intent.choice === "other" ? "unknown" : (intent.choice as IntentKind);
  const read: Intent = { kind };
  if (ruled.language) read.language = ruled.language;
  if (ruled.offerInr !== undefined) read.offerInr = ruled.offerInr;
  if (ruled.overrideAttempt) read.overrideAttempt = true;
  const wantsDetails = kind === "book" || kind === "reschedule";

  // The service: the rules' own match wins (it is exact); otherwise what the decision model is sure of.
  const service = answers.service;
  if (ruled.serviceId) read.serviceId = ruled.serviceId;
  else if (wantsDetails && kind === "book") {
    if (chosenProbability(service) < threshold) return null;
    if (service.choice !== NO_SERVICE) read.serviceId = service.choice;
  }

  // The time: the rules' date and time win; otherwise a candidate slot the decision model is sure of.
  if (ruled.date) read.date = ruled.date;
  if (ruled.time) read.time = ruled.time;
  const slot = answers.slot;
  if (wantsDetails && slot && !(ruled.date && ruled.time)) {
    if (chosenProbability(slot) < threshold) return null;
    const picked = slot.choice === NO_SLOT ? undefined : slots[Number(slot.choice.slice("slot_".length)) - 1];
    if (picked) { read.date = ruled.date ?? picked.date; read.time = ruled.time ?? picked.time; }
  }
  return read;
}

export function createRouter(options: RouterOptions): IntentParser & { parseDetailed(text: string, context: ParseContext, options?: ParseOptions): Promise<ParseResult> } {
  const now = options.now ?? Date.now;
  const table = options.rates;

  /** Add up what was spent. A call with no price makes the total unknown (null): a missing price is never a free call. */
  function understood(handled: Spend, spends: Spend[], tried: Step[], failed: Step[]): Understood {
    let micro: number | null = 0;
    let rateDate: string | null = null;
    for (const s of spends) {
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

  async function parseDetailed(text: string, context: ParseContext, parseOptions: ParseOptions = {}): Promise<ParseResult> {
    const ruled = parseIntent(text, context);
    const rules: Spend = { step: "rules", provider: "rules", model: "rule-parser", usage: { inputTokens: 0, outputTokens: 0 } };
    const tried: Step[] = ["rules"];
    const failed: Step[] = [];
    const spends: Spend[] = [];
    const finish = (intent: Intent, handled: Spend, reason?: string): ParseResult => ({ intent, ...(reason ? { fallbackReason: reason } : {}), understood: understood(handled, handled === rules ? [rules, ...spends] : [...spends], tried, failed) });

    if (parseOptions.rulesOnly || rulesAreSure(ruled) || (!options.decision && !options.model)) return finish(ruled, rules);

    const stripped = redact(text, options.names).text; // numbers and names do not leave the machine
    let reason: string | undefined;

    // ---- step 1: a decision model ----
    const step1 = options.decision;
    const trusted = step1 && (ruled.language === undefined || (step1.languages ?? DEFAULT_DECISION_LANGUAGES).includes(ruled.language));
    if (step1 && trusted) {
      tried.push("decision");
      const spend: Spend = { step: "decision", provider: step1.client.kind, model: step1.client.model, usage: { inputTokens: 0, outputTokens: 0 } };
      try {
        const slots = !(ruled.date && ruled.time) && parseOptions.slots ? await parseOptions.slots().catch(() => []) : [];
        const questions = questionsFor(context, ruled, slots);
        const decision = await step1.client.decide(stripped, questions);
        spend.usage = decision.usage;
        spends.push(spend);
        const read = readDecision(decision.answers as Record<string, ChoiceAnswer>, ruled, slots, step1.threshold ?? DEFAULT_THRESHOLD);
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
        const intent = { ...result.intent };
        if (ruled.overrideAttempt) intent.overrideAttempt = true;
        if (!intent.serviceId && ruled.serviceId) intent.serviceId = ruled.serviceId;
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

