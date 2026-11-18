// One talk turn, for both sides (block M): decide whether a model may be asked at all, ask it, count what it cost in the month's AI spend, run the grounding checks
// (talk-check.ts), and write the `talk` line of the record. The owner's talk (conversation.ts) and a customer's talk (talk-customer.ts) both come through here, so the
// switches, the metering and the record are the same for both.
//
// The talk is OFF, and nobody pays for a model call, when: the shop has no talk model; it is in button mode (the allowance is used up, it was switched to buttons from outside,
// or a model failed lately); it is at the AI cap (`model: "off"`) or its own month budget is used up (budget/budget.ts); or this feature's daily cap is reached. Everyone then gets today's fixed answers. A reply that fails a check is never sent; the caller sends
// the owner a fixed line with the real numbers, or a customer the template's menu, and the record says which check failed (never what the customer wrote).
//
// A model call that FAILS (no answer in time, an HTTP error, a reply that is not JSON) moves the shop to buttons for a few minutes, as every other model step does
// (understanding/reader.ts), so a model that is down is not waited for on every message.
import type { Clock } from "../core/clock.ts";
import { MINUTE } from "../core/time.ts";
import type { Language } from "../language/languages.ts";
import type { Outcome } from "../record/record.ts";
import { gate, modelOff, record } from "../budget/budget.ts";
import type { Feature } from "../budget/budget.ts";
import { DEFAULT_PAUSE_MINUTES, modeOf, stateFor } from "../understanding/ai-state.ts";
import type { AiPolicy, AiStore } from "../understanding/ai-state.ts";
import type { JsonCall } from "../understanding/model-llm.ts";
import { checkTalk } from "./talk-check.ts";
import type { CheckFacts } from "../language/check.ts";
import type { TalkModel } from "../understanding/talk.ts";
import { readTalkAnswer } from "./talk-types.ts";
import type { TalkAnswer, TalkSource } from "./talk-types.ts";

export interface TalkEnv {
  /** The talk model, built at the runtime's start. Left out: the talk is off. */
  model?: TalkModel;
  clock: Clock;
  timeZone: string;
  store: AiStore;
  policy: AiPolicy;
  log(caseId: string | null, conversation: string, action: string, outcome: Outcome, inputs: unknown, more: { notes?: string; refs?: Record<string, string>; language?: Language }): void;
}

export type TalkOffReason = "no_model" | "buttons" | "cap" | "budget" | "day" | "again";

/**
 * Why this feature may not ask a model right now, or null when it may. "cap": fleet's AI cap. "budget": the shop's own month budget is used up. "day": this feature's daily
 * cap is reached. "again": `key` (the owner's message) was already paid for. The model is asked only when this says null, so a feature over a cap costs nothing and falls back.
 */
export function talkOff(env: TalkEnv, feature: Feature, key?: string): TalkOffReason | null {
  if (!env.model) return "no_model";
  const now = env.clock.now();
  if (modeOf(env.store, env.policy, now, env.timeZone).buttons) return "buttons";
  const off = modelOff(env.store, env.policy, now, env.timeZone);
  if (off) return off === "fleet" ? "cap" : "budget";
  const g = gate(env.store, env.policy.budget, feature, now, env.timeZone, key);
  return g.ok ? null : g.why === "month" ? "budget" : g.why;
}

export interface TalkTurn {
  role: "owner" | "customer";
  /** The record's conversation: the customer's number, or the owner's. */
  conversation: string;
  language: Language;
  system: string;
  schema: Record<string, unknown>;
  /** The speaker's words as the model gets them (a customer's redacted first). */
  user: string;
  /** The speaker's own words, for the language check only. */
  speakerText: string;
  /** What a model call of this turn is counted as against the budget: the owner's talk or a customer's. */
  feature: Extract<Feature, "owner_talk" | "customer_talk">;
  /** The owner's message id, so the same message is never paid for twice (budget.ts `gate`). Left out for a customer. */
  key?: string;
  scope: readonly TalkSource[];
  links: readonly string[];
  literals: readonly string[];
  maxChars: number;
}

export type TalkResult =
  | { ok: true; text: string; facts: CheckFacts; answer: TalkAnswer }
  | { ok: false; why: "no_answer" | "check"; check?: number; detail: string };

/**
 * One model call and what it cost, counted in the month's AI spend whether or not the answer is usable (a call whose answer was unusable still cost tokens). The shared first
 * half of every model step of the assistant: the talk (below) and a listing's draft (listing-draft.ts) both come through here, so the metering is the same for both. The call is
 * also counted against its feature's daily cap and the shop's month budget (budget/budget.ts), whatever came of it.
 */
export async function askMetered(env: TalkEnv, call: JsonCall, feature: Feature, key?: string): Promise<{ got: Awaited<ReturnType<TalkModel["ask"]>>; meter: Record<string, string>; month: ReturnType<typeof stateFor> }> {
  const got = await env.model!.ask(call);
  const month = stateFor(env.store, env.clock.now(), env.timeZone);
  month.model += 1;
  if (got.costMicroInr === null) month.unpriced += 1; else month.costMicroInr += got.costMicroInr;
  record(env.store, env.policy.budget, feature, { costMicroInr: got.costMicroInr, ...(key !== undefined ? { key } : {}) }, env.clock.now(), env.timeZone);
  const meter: Record<string, string> = {
    step: "model", provider: got.provider, model: got.model, inputTokens: String(got.usage.inputTokens), outputTokens: String(got.usage.outputTokens),
    ...(got.costMicroInr !== null ? { costMicroInr: String(got.costMicroInr) } : {}), ...(got.rateDate !== null ? { rateDate: got.rateDate } : {}),
  };
  return { got, meter, month };
}

/** Ask, meter, check, record. Never throws, and never sends anything: the caller sends `text` (through the outgoing check) when `ok`. */
export async function runTalk(env: TalkEnv, t: TalkTurn): Promise<TalkResult> {
  const call: JsonCall = { system: t.system, user: t.user, schema: t.schema, name: "talk" };
  const { got, meter, month } = await askMetered(env, call, t.feature, t.key);
  const line = (result: string, reply: string | null, notes: string, check?: number) =>
    env.log(null, t.conversation, "talk", "confirmed", { reply }, { language: t.language, notes, refs: { role: t.role, result, ...(check !== undefined ? { check: String(check) } : {}), ...meter } });

  if (got.reason !== undefined || got.answer === undefined) {
    month.pausedUntilMs = env.clock.now() + (env.policy.pauseMinutes ?? DEFAULT_PAUSE_MINUTES) * MINUTE;
    line("no_answer", null, `the talk model could not be used (${got.reason ?? "no answer"}); the fixed answer was used`);
    return { ok: false, why: "no_answer", detail: got.reason ?? "no answer" };
  }
  const answer = readTalkAnswer(got.answer, t.role);
  if (!answer) { line("refused", null, "the talk model's answer was not the shape asked for; the fixed answer was used", 1); return { ok: false, why: "check", check: 1, detail: "the answer was not sentences with sources" }; }
  const checked = checkTalk({ role: t.role, answer, scope: t.scope, speakerText: t.speakerText, speakerLanguage: t.language, timeZone: env.timeZone, links: t.links, literals: t.literals, maxChars: t.maxChars });
  if (!checked.ok) {
    // a customer's turn names only the check: the reason can quote what the model wrote, which can echo the customer's words
    line("refused", null, `the talk reply failed check ${checked.check} and was not sent${t.role === "owner" ? `: ${checked.why}` : ""}`, checked.check);
    return { ok: false, why: "check", check: checked.check, detail: checked.why };
  }
  line("checked", checked.text, "the talk reply passed the five checks; it goes out through the outgoing check, and the record keeps only its digest");
  return { ok: true, text: checked.text, facts: checked.facts, answer };
}
