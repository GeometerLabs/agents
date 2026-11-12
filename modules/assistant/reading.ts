// How a template reads the owner's words for its assistant (item 11e): the owner's router (rules, then the decision model, then the small language model, through
// modules/understanding/router.ts with intents.ts's reading) wrapped in the shared reader (understanding/reader.ts), over the SAME store and policy as the customers'
// reader. So the owner's messages count in the same month's AI spend and allowance, and in button mode they are read by the rules alone. Used by each template's agent
// (which hands the result to conversation.ts as `read`) and by its start (which builds the owner's router from runtime.json's steps, `ownerRouter`).
import type { Clock } from "../core/clock.ts";
import type { Action, Outcome } from "../record/record.ts";
import type { AiPolicy, AiStore } from "../understanding/ai-state.ts";
import type { IntentParser, ParseOptionsBase } from "../understanding/model.ts";
import { createReader } from "../understanding/reader.ts";
import { createRouter } from "../understanding/router.ts";
import type { RouterOptions } from "../understanding/router.ts";
import { ownerReading, readOwnerRules } from "./intents.ts";
import type { OwnerContext, OwnerIntent, OwnerKind } from "./intents.ts";
import type { OwnerRead } from "./conversation.ts";

export type OwnerParser = IntentParser<OwnerIntent, OwnerContext, ParseOptionsBase>;

/** The rules alone, as a parser: what a shop with no model steps uses, and what button mode comes to. */
export const ownerRulesParser: OwnerParser = { parse: async (text, context) => readOwnerRules(text, context) };

/** The owner's router over the shop's model steps (the same decision model and language model the customers' router has, from runtime.json). */
export const ownerRouter = (options: Omit<RouterOptions<OwnerIntent, OwnerContext, ParseOptionsBase>, "reading">): OwnerParser => createRouter({ ...options, reading: ownerReading });

export interface OwnerReaderDeps {
  /** The owner's router, or left out for the rules alone. */
  parser?: OwnerParser;
  kinds: readonly OwnerKind[];
  policy: AiPolicy;
  /** The template's store: its AI counts are shared with the customers' reader. */
  store: AiStore;
  clock: Clock;
  timeZone: string;
  log(action: Action, outcome: Outcome, inputs: unknown, more: { notes: string; refs: Record<string, string> }): void;
  tellOwner(notice: "allowance" | "override" | "fault"): Promise<unknown>;
}

/** `read(text)`: the owner's intent, what it cost (counted in the month), and a note when a model could not be used. In button mode the rules alone read it. */
export function createOwnerReader(deps: OwnerReaderDeps): (text: string) => Promise<OwnerRead> {
  const context: OwnerContext = { kinds: deps.kinds };
  const reader = createReader<OwnerIntent, OwnerContext, ParseOptionsBase>({
    parser: deps.parser ?? ownerRulesParser, context, coerce: ownerReading.coerce, policy: deps.policy, store: deps.store, clock: deps.clock, timeZone: deps.timeZone, log: deps.log, tellOwner: deps.tellOwner,
  });
  return async (text) => {
    const { intent, note, understood } = await reader.readIntent(text, { rulesOnly: reader.mode().buttons });
    reader.countUnderstood(understood);
    return { intent, ...(note ? { note } : {}), refs: reader.understandingRefs(understood) };
  };
}
