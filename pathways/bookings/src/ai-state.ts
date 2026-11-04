// The shop's monthly AI allowance and button mode. Pure functions over the store's `ai` state (booking.ts), so the agent, the runtime's status and the
// tests all read one set of rules.
//
// A shop is in BUTTON MODE, and the agent reads with the rules only and answers with buttons and lists, when any of these holds (checked in this order):
//   override   the shop's config says `ai: "buttons"` (the bundle writes it from fleet's heartbeat answer: a partner's balance ran out, or the plan has no AI)
//   allowance  this month's messages handled by the decision and language models, or their estimated cost, have reached the allowance
//   fault      a model step failed (an error, a timeout, an answer it could not use) in the last few minutes
// None of this changes a limit. Guard and the template's own checks hold exactly as before; only the reading of free text is done without a model.
import type { AiState, Store } from "./booking.ts";
import { localParts } from "./time.ts";

export type ButtonReason = "override" | "allowance" | "fault";

export interface AiPolicy {
  /** "buttons" turns the model steps off. Asked on every message and every tick, so a change made while the agent runs takes effect at once. Left out: "auto". */
  override?: () => "auto" | "buttons";
  /** The monthly allowance for steps 1 and 2. Either limit reached puts the shop in button mode for the rest of the month. Left out: no limit. */
  allowance?: { messages?: number; costMicroInr?: number };
  /** How long button mode lasts after a model step fails. Default 5 minutes. */
  pauseMinutes?: number;
}

export const DEFAULT_PAUSE_MINUTES = 5;

/** "2026-11": the shop's local month. */
export function monthOf(nowMs: number, timeZone: string): string {
  const p = localParts(nowMs, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}`;
}

/** "2026-11-05": the shop's local day. */
export function dayLocal(nowMs: number, timeZone: string): string {
  const p = localParts(nowMs, timeZone);
  return `${monthOf(nowMs, timeZone)}-${String(p.day).padStart(2, "0")}`;
}

/** The store's AI state for this month. A new month starts the counts again; a pause and an announced switch carry over. Created on first use. */
export function stateFor(store: Store, nowMs: number, timeZone: string): AiState {
  const month = monthOf(nowMs, timeZone);
  const now = store.ai;
  if (!now) return (store.ai = { month, rules: 0, decision: 0, model: 0, costMicroInr: 0, unpriced: 0, told: {} });
  if (now.month !== month) {
    // A new month: the counts and the allowance notice start again. A pause in force, and the switch and fault notices (which are about the outside switch and the day), carry over.
    store.ai = { month, rules: 0, decision: 0, model: 0, costMicroInr: 0, unpriced: 0, told: { override: now.told.override, fault: now.told.fault }, ...(now.pausedUntilMs !== undefined ? { pausedUntilMs: now.pausedUntilMs } : {}) };
  }
  return store.ai!;
}

/** Messages handled by a model this month (steps 1 and 2): what the allowance counts. */
export const aiMessages = (s: AiState): number => s.decision + s.model;

export function usedUp(s: AiState, allowance: AiPolicy["allowance"]): boolean {
  if (!allowance) return false;
  return (allowance.messages !== undefined && aiMessages(s) >= allowance.messages) || (allowance.costMicroInr !== undefined && s.costMicroInr >= allowance.costMicroInr);
}

export type Mode = { buttons: false } | { buttons: true; reason: ButtonReason };

/** Is the shop in button mode right now, and why? Also notes whether the outside switch is still on, so a later switch-off and switch-on is announced again. */
export function modeOf(store: Store, policy: AiPolicy, nowMs: number, timeZone: string): Mode {
  const s = stateFor(store, nowMs, timeZone);
  const overridden = policy.override?.() === "buttons";
  if (!overridden) delete s.told.override;
  if (overridden) return { buttons: true, reason: "override" };
  if (usedUp(s, policy.allowance)) return { buttons: true, reason: "allowance" };
  if (s.pausedUntilMs !== undefined && s.pausedUntilMs > nowMs) return { buttons: true, reason: "fault" };
  return { buttons: false };
}

/** Counts only, for the runtime's status and so for a heartbeat: never a word of a message. */
export interface AiSummary {
  month: string;
  /** Messages understood at each step this month. */
  messages: { rules: number; decision: number; model: number };
  costMicroInr: number;
  unpriced: number;
  allowance: { messages: number | null; costMicroInr: number | null };
  mode: "ai" | "buttons";
  reason: ButtonReason | null;
}

export function summaryOf(store: Store, policy: AiPolicy, nowMs: number, timeZone: string): AiSummary {
  const s = stateFor(store, nowMs, timeZone);
  const mode = modeOf(store, policy, nowMs, timeZone);
  return {
    month: s.month, messages: { rules: s.rules, decision: s.decision, model: s.model }, costMicroInr: s.costMicroInr, unpriced: s.unpriced,
    allowance: { messages: policy.allowance?.messages ?? null, costMicroInr: policy.allowance?.costMicroInr ?? null },
    mode: mode.buttons ? "buttons" : "ai", reason: mode.buttons ? mode.reason : null,
  };
}
