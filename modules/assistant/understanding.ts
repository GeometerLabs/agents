// The owner's model steps for the shop's assistant (item 11e), built ONCE at a runtime's start: the owner's router (rules, then the decision model, then the small
// language model, through modules/understanding/router.ts with intents.ts's reading) and the hooks modules/runtime/start.ts `buildUnderstanding` takes. Used by each
// template's server/start.ts, which hands the result to its agent as `ownerParser`.
//
// Kept apart from reading.ts (what the agent itself imports) on purpose: the router and the model parser read the dated price tables (understanding/rates.ts) from
// disk, and an agent's own import graph must not, so Bookings' browser demo can be built from the agent as it runs live (scripts/build-web-demo.ts). The customers'
// router is built the same way, at start, never imported by an agent.
import { createRouter } from "../understanding/router.ts";
import type { RouterOptions } from "../understanding/router.ts";
import { createModelParser } from "../understanding/model-llm.ts";
import type { ModelConfig } from "../understanding/model-llm.ts";
import type { ParseOptionsBase } from "../understanding/model.ts";
import type { Clock } from "../core/clock.ts";
import type { ParserConfig } from "../runtime/config.ts";
import { parserArguments } from "../runtime/start.ts";
import { RATES, dayOf, selfHostedRate } from "../understanding/rates.ts";
import { createTalkModel } from "../understanding/talk.ts";
import type { TalkModel } from "../understanding/talk.ts";
import { ownerReading } from "./intents.ts";
import type { OwnerContext, OwnerIntent } from "./intents.ts";
import { ownerRulesParser } from "./reading.ts";
import type { OwnerParser } from "./reading.ts";

/** The owner's router over the shop's model steps (the same decision model and language model the customers' router has, from runtime.json). */
export const ownerRouter = (options: Omit<RouterOptions<OwnerIntent, OwnerContext, ParseOptionsBase>, "reading">): OwnerParser => createRouter({ ...options, reading: ownerReading });

/**
 * The hooks modules/runtime/start.ts `buildUnderstanding` takes, for the owner: the same runtime.json steps (and keys, and credential for the model's Guard) as the
 * customers', with the owner's reading. A template's start calls it once more with these when the shop has an assistant.
 */
export const OWNER_UNDERSTANDING = {
  createRuleParser: (): OwnerParser => ownerRulesParser,
  createModelParser: (config: ModelConfig, fetchFn?: typeof fetch) => createModelParser(config, ownerReading, fetchFn),
  createRouter: ownerRouter,
};

/**
 * The shop's talk model (block M), built ONCE at a runtime's start and handed to the agent as `talker`: runtime.json's `talk` block, or the parser's model when it has none
 * (the talk's model is then the shop's language model). Same credentials as the parser's: this agent's token for the model Guard, or a provider key from the environment
 * variable `keyEnv` names; never a key in runtime.json. Nothing is asked of a provider whose key is not in the environment (the talk is then off, with a line saying so). A
 * builder's own price for a model they host is added to the rate table for this runtime only, as the router does. Undefined when the shop has no model at all.
 */
export function buildTalker(client: { runtime: { talk?: ParserConfig; parser?: ParserConfig } }, deps: { clock: Clock; env?: Record<string, string | undefined>; log: (line: string) => void }): TalkModel | undefined {
  const env = deps.env ?? process.env;
  const cfg = client.runtime.talk ?? client.runtime.parser;
  if (!cfg) return undefined;
  if (cfg.keyEnv && !env[cfg.keyEnv]?.trim()) { deps.log(`The talk is off: ${cfg.keyEnv} is not set, so nothing is sent to ${cfg.provider ?? new URL(cfg.baseUrl).hostname}.`); return undefined; }
  const [config, fetchFn] = parserArguments(cfg, env);
  const rates = cfg.rate ? [...RATES, selfHostedRate(cfg.model, cfg.rate, dayOf(deps.clock.now()))] : undefined;
  return createTalkModel({ config, provider: cfg.provider ?? new URL(cfg.baseUrl).hostname, now: () => deps.clock.now(), ...(rates ? { rates } : {}), ...(fetchFn ? { fetchFn } : {}) });
}
