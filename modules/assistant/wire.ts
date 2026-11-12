// How a template's agent turns on the shop's assistant (item 11e), in one call, so Bookings, Fees and Orders wire it the same way: the owner's reader over the agent's own
// store and AI policy (reading.ts), and the conversation over the template's skill (conversation.ts). Used by each template's src/agent.ts. Returns nothing when the
// shop's settings have no "assistant" block: the agent then behaves exactly as before.
//
// Also the two pieces every skill's `prepare` and `execute` share: the owner's fixed reply a card's tap stands for, and the check on a message's words.
import type { Clock } from "../core/clock.ts";
import type { Language } from "../language/languages.ts";
import type { Decision } from "../limits/limits.ts";
import type { InboundMessage, Messaging } from "../messaging/messaging.ts";
import type { ActionRecord, Outcome } from "../record/record.ts";
import type { AiPolicy, AiStore } from "../understanding/ai-state.ts";
import { createAssistant, kindsOf } from "./conversation.ts";
import type { Assistant } from "./conversation.ts";
import { amountOf } from "./intents.ts";
import { createOwnerReader } from "./reading.ts";
import type { OwnerParser } from "./reading.ts";
import type { AssistantSettings } from "./settings.ts";
import type { OwnerSkill, PrepareRefusal } from "./skill.ts";
import type { AssistantState } from "./state.ts";

export interface AgentAssistantDeps {
  settings: { name: string; timezone: string; owner: { whatsapp: string; language: Language }; assistant?: AssistantSettings };
  store: { assistant?: AssistantState } & AiStore;
  skill: OwnerSkill;
  clock: Clock;
  messaging: Messaging;
  record: ActionRecord;
  policy: AiPolicy;
  ownerParser?: OwnerParser;
  /** The template's record writer, by case id. */
  log(caseId: string | null, phone: string, action: string, outcome: Outcome, inputs: unknown, more: { notes?: string; refs?: Record<string, string>; decisions?: Decision[]; language?: Language }): void;
  /** The template's own words to the owner when the AI allowance runs out or a model fails (the same notices its customers' reader sends). */
  ownerNotice(notice: "allowance" | "override" | "fault"): Promise<unknown>;
  languageOf(phone: string): Language;
  optedOut(phone: string): boolean;
}

/** The shop's assistant for this agent's step, or undefined when the shop has none. */
export function assistantForAgent(d: AgentAssistantDeps): Assistant | undefined {
  const s = d.settings;
  if (!s.assistant) return undefined;
  const owner = s.owner.whatsapp;
  return createAssistant({
    shop: { name: s.name, timezone: s.timezone, owner: s.owner, settings: s.assistant },
    store: d.store, skills: [d.skill], clock: d.clock, messaging: d.messaging,
    read: createOwnerReader({
      ...(d.ownerParser ? { parser: d.ownerParser } : {}), kinds: kindsOf([d.skill]), policy: d.policy, store: d.store, clock: d.clock, timeZone: s.timezone,
      log: (action, outcome, inputs, more) => d.log(null, owner, action, outcome, inputs, more),
      tellOwner: d.ownerNotice,
    }),
    log: d.log,
    entries: () => d.record.entries(),
    languageOf: d.languageOf,
    optedOut: d.optedOut,
  });
}

/**
 * The owner's own fixed reply that a card's yes (or no) stands for: typed ("approve q-3") or a UPI mark's button with its code. The agent handles it exactly as if the
 * owner had sent it, so a card adds no new way to act. The id is unique to the card's tap, so it is never taken for a delivery of another message.
 */
export function ownerReply(owner: string, nowMs: number, cardCase: string, reply: { text: string } | { buttonId: string }): InboundMessage {
  const base = { id: `assistant:${cardCase}:${nowMs}`, from: owner, timestamp: nowMs };
  return "text" in reply ? { ...base, text: reply.text } : { ...base, text: "", reply: { id: reply.buttonId, kind: "button" } };
}

/**
 * A message the owner asked to send a customer: refused when the customer sent STOP, or when the words state an amount the case does not have (money back is a refund,
 * with its own card). The words themselves go as typed.
 */
export function checkWords(words: string, a: { optedOut: boolean; amountsPaise: readonly (number | undefined)[] }): PrepareRefusal | null {
  if (a.optedOut) return "opted_out";
  const amount = amountOf(words);
  if (amount !== undefined && !a.amountsPaise.some((v) => v === amount)) return "amount_not_on_record";
  return null;
}
