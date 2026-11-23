// The talk call (block M): one JSON call to the shop's talk model, priced from the shared rate table. It uses the same transport as the intent parser (model-llm.ts askJson:
// both wires, no key, a timeout, never a throw), so a model behind the model Guard, a provider reached directly with a key from the environment, or a model the builder
// hosts all work the same way. What the model SAYS is not trusted here: the assistant's talk checks (modules/assistant/talk-check.ts) decide whether any of it is sent.
//
// Kept apart from the agents on purpose: it reads the dated price table (rates.ts) from disk, and an agent's own import graph must not, so the browser demo can still be built
// from the agent. It is built once at a runtime's start (go/internal/assistant) and handed to the agent as `talker`, the way the owner's router is; the agent
// imports only its types.
import { askJson } from "./model-llm.ts";
import type { JsonCall, ModelConfig } from "./model-llm.ts";
import type { TokenUsage } from "./model.ts";
import { costMicroInr, dayOf, rateFor } from "./rates.ts";
import type { Rate } from "./rates.ts";

/** What one talk call came to. `answer` is the model's JSON, untrusted; `reason` is why there is none. Tokens and cost are filled even when the answer was unusable. */
export interface TalkCallResult {
  answer?: unknown;
  reason?: string;
  usage: TokenUsage;
  /** Micro-rupees from the dated rate table; null when the table has no price for this provider and model (never 0). */
  costMicroInr: number | null;
  rateDate: string | null;
  provider: string;
  model: string;
  latencyMs: number;
}

/** The talk model as an agent sees it: ask once, get a result. */
export interface TalkModel { ask(call: JsonCall): Promise<TalkCallResult> }

/** The most the model may write for a talk turn: a reply of at most 600 characters in sentences with their sources, with room for models that think first. */
export const TALK_MAX_TOKENS = 1200;
/** The longest wait. The talk is a conversation, so it waits longer than reading an intent, but short of the runtime's own wait on a Guard. */
export const TALK_TIMEOUT_MS = 12_000;

export interface TalkModelOptions {
  config: ModelConfig;
  /** The provider's name as the rate table writes it ("deepinfra"), for pricing. */
  provider: string;
  now: () => number;
  /** The price list. Default: rates.ts (a builder's own rate for a self-hosted model is added to it by the caller). */
  rates?: readonly Rate[];
  /** How a credential is added (the runtime's agent token for the model Guard, or a provider key from the environment). */
  fetchFn?: typeof fetch;
}

export function createTalkModel(o: TalkModelOptions): TalkModel {
  const config: ModelConfig = { ...o.config, maxTokens: o.config.maxTokens ?? TALK_MAX_TOKENS, timeoutMs: o.config.timeoutMs ?? TALK_TIMEOUT_MS };
  return {
    async ask(call) {
      const got = await askJson(config, { ...call, name: call.name ?? "talk" }, o.fetchFn);
      const usage = got.usage ?? { inputTokens: 0, outputTokens: 0 };
      const rate = rateFor(o.provider, config.model, dayOf(o.now()), o.rates);
      return {
        ...(got.answer !== undefined ? { answer: got.answer } : {}), ...(got.reason !== undefined ? { reason: got.reason } : {}),
        usage, costMicroInr: got.usage ? costMicroInr(rate, usage) : 0, rateDate: rate && got.usage ? rate.from : null, provider: o.provider, model: config.model, latencyMs: got.latencyMs,
      };
    },
  };
}
