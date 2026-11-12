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
