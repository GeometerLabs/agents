// The shop's monthly AI allowance and button mode. Pure functions over the store's `ai` state (any store with an `ai` field), so the agent, the runtime's status and the
// tests all read one set of rules.
//
// A shop is in BUTTON MODE, and the agent reads with the rules only and answers with buttons and lists, when any of these holds (checked in this order):
//   override   the shop's config says `ai: "buttons"` (the bundle writes it from fleet's heartbeat answer: a partner's balance ran out, or the plan has no AI)
//   allowance  this month's messages handled by the decision and language models, or their estimated cost, have reached the allowance
//   fault      a model step failed (an error, a timeout, an answer it could not use) in the last few minutes
// None of this changes a limit. Guard and the template's own checks hold exactly as before; only the reading of free text is done without a model.
//
// THE AI CAP is smaller than button mode too. The shop's config says `model: "off"` (the bundle writes it from fleet's heartbeat answer once the month's model spend
// reaches the plan's cap, price list `ai.cap`): the language model (step 2) is left out until fleet says "normal" again, on the 1st. The rules and the decision
// model (step 1) keep answering; a message neither can read gets what button mode sends for that turn (the menu). The shop stays in AI mode.
//
// A STEP PAUSE is smaller than button mode. When only the decision model (step 1) is down and the language model (step 2) answers, every message would wait out
// the decision model's timeout and then pay step 2 anyway. So after a few failures in a short time the decision model is left out for a while and step 2 reads the
// message at once; one message after the pause tries it again. The shop stays in AI mode; the record says so (an `ai_mode` line) and so does the status.
import { MINUTE, localParts } from "../core/time.ts";

/** The steps a pause can be put on: the decision model. (The language model has the fault pause: when it fails with nothing after it, the shop moves to buttons.) */
export const BREAKER_STEPS = ["decision"] as const;
export type BreakerStep = (typeof BREAKER_STEPS)[number];

/** When to pause a step: after `failures` failures within `windowMinutes`, for `pauseMinutes`. Placeholders until a real Laya or Jev has been watched. */
export interface BreakerPolicy { failures?: number; windowMinutes?: number; pauseMinutes?: number }
export const DEFAULT_BREAKER = { failures: 3, windowMinutes: 15, pauseMinutes: 10 } as const;

/** How one step has been doing. Moments only, never a word of a message. */
export interface StepHealth {
  /** When it failed lately (ms), oldest first, only those inside the window. */
  fails?: number[];
  /** Set from the moment the step is paused until it answers again. While it is in the future the step is left out; once it has passed, the next message is the try. */
  pausedUntilMs?: number;
  /** What the record has not been told yet, once each (reader.ts says it and takes it off). */
  announce?: ("paused" | "resumed")[];
}

/**
 * What the shop has spent on understanding messages this month, and whether it is in button mode. Kept in the template's store, so it survives a restart and a
 * step that runs again. Counts and amounts only, never a word of a message.
 */
export interface AiState {
  /** The shop's local month these counts are for, "2026-11". They start again at zero in a new month. */
  month: string;
  /** Messages understood at each step this month. The allowance counts `decision` + `model`. */
  rules: number;
  decision: number;
  model: number;
  /** Estimated cost this month in micro-rupees, from the dated rate table: calls with a price only. */
  costMicroInr: number;
  /**
   * Voice (plan B29): voice notes listened to and replies spoken this month, as counts. Their cost is in `costMicroInr` above, so the allowance and fleet's cap see it as
   * model spend and a runaway voice bill cannot hide. Left out until the first voice note (and in a store saved before it), so a shop with voice off saves the same bytes.
   */
  speech?: { notes: number; replies: number; /** The shop's local day the `today` count is for, and how many notes were listened to that day: the day's limit survives a restart because it is kept here. */ day?: string; today?: number };
  /** Calls this month whose provider and model have no price in the table (their cost is not in the total). */
  unpriced: number;
  /** A model step failed: until this moment the agent reads with buttons and the rules only. */
  pausedUntilMs?: number;
  /** How each paused-able step has been doing. Left out until a step first fails, and in a store saved before this existed. */
  steps?: Partial<Record<BreakerStep, StepHealth>>;
  /**
   * The notices already sent, so each is sent once: the month the allowance notice was sent for; whether the outside switch was announced; the day (local) of the last fault
   * notice; the month the record was told the AI cap left the language model out.
   */
  told: { allowance?: string; override?: boolean; fault?: string; modelOff?: string };
}

/** The part of a template's store that button mode needs. */
export interface AiStore {
  /** The month's AI spend and button-mode notices. Left out until the first message. */
  ai?: AiState;
}

export type ButtonReason = "override" | "allowance" | "fault";

export interface AiPolicy {
  /** "buttons" turns the model steps off. Asked on every message and every tick, so a change made while the agent runs takes effect at once. Left out: "auto". */
  override?: () => "auto" | "buttons";
  /** The AI cap: "off" leaves the language model (step 2) out; the rules and the decision model keep answering. Asked on every message, like `override`. Left out: "normal". */
  model?: () => "normal" | "off";
  /** The monthly allowance for steps 1 and 2. Either limit reached puts the shop in button mode for the rest of the month. Left out: no limit. */
  allowance?: { messages?: number; costMicroInr?: number };
  /** How long button mode lasts after a model step fails. Default 5 minutes. */
  pauseMinutes?: number;
  /** When a failing decision model is paused (see DEFAULT_BREAKER). */
  breaker?: BreakerPolicy;
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
export function stateFor(store: AiStore, nowMs: number, timeZone: string): AiState {
  const month = monthOf(nowMs, timeZone);
  const now = store.ai;
  if (!now) return (store.ai = { month, rules: 0, decision: 0, model: 0, costMicroInr: 0, unpriced: 0, told: {} });
  if (now.month !== month) {
    // A new month: the counts and the allowance notice start again. A pause in force, a step's pause, and the switch and fault notices (which are about the outside switch and the day), carry over.
    store.ai = { month, rules: 0, decision: 0, model: 0, costMicroInr: 0, unpriced: 0, told: { override: now.told.override, fault: now.told.fault }, ...(now.pausedUntilMs !== undefined ? { pausedUntilMs: now.pausedUntilMs } : {}), ...(now.steps ? { steps: now.steps } : {}) };
  }
  return store.ai!;
}

/**
 * Count a voice note listened to (`notes`) or a reply spoken (`replies`) and what it cost, in the month's AI spend. A cost is always known here: voice does not run
 * without the builder's rate (runtime.json speech.rate), so nothing is added as unpriced.
 */
export function addSpeech(store: AiStore, nowMs: number, timeZone: string, kind: "notes" | "replies", costMicroInr: number): void {
  const s = stateFor(store, nowMs, timeZone);
  const day = dayLocal(nowMs, timeZone);
  s.speech = { ...s.speech, notes: s.speech?.notes ?? 0, replies: s.speech?.replies ?? 0 };
  s.speech[kind] += 1;
  if (kind === "notes") { s.speech.today = (s.speech.day === day ? s.speech.today ?? 0 : 0) + 1; s.speech.day = day; }
  s.costMicroInr += costMicroInr;
}

/** Voice notes listened to today (the shop's local day), from saved state. Read before each note so the day's limit holds across restarts. */
export function speechNotesToday(store: AiStore, nowMs: number, timeZone: string): number {
  const sp = store.ai?.speech;
  return sp?.day === dayLocal(nowMs, timeZone) ? sp.today ?? 0 : 0;
}

/** Messages handled by a model this month (steps 1 and 2): what the allowance counts. */
export const aiMessages = (s: AiState): number => s.decision + s.model;

// Either the message count or the cost budget ends the allowance, whichever comes first; an unset allowance means no limit.
export function usedUp(s: AiState, allowance: AiPolicy["allowance"]): boolean {
  if (!allowance) return false;
  return (allowance.messages !== undefined && aiMessages(s) >= allowance.messages) || (allowance.costMicroInr !== undefined && s.costMicroInr >= allowance.costMicroInr);
}

export type Mode = { buttons: false } | { buttons: true; reason: ButtonReason };

/** Is the shop in button mode right now, and why? Also notes whether the outside switch is still on, so a later switch-off and switch-on is announced again. */
export function modeOf(store: AiStore, policy: AiPolicy, nowMs: number, timeZone: string): Mode {
  const s = stateFor(store, nowMs, timeZone);
  const overridden = policy.override?.() === "buttons";
  if (!overridden) delete s.told.override;
  if (overridden) return { buttons: true, reason: "override" };
  if (usedUp(s, policy.allowance)) return { buttons: true, reason: "allowance" };
  if (s.pausedUntilMs !== undefined && s.pausedUntilMs > nowMs) return { buttons: true, reason: "fault" };
  return { buttons: false };
}

// ---- the pause on a step that keeps failing --------------------------------------------------------------------------------------

/** The steps to leave out of the next message because their pause is running. */
export function pausedSteps(store: AiStore, nowMs: number, timeZone: string): BreakerStep[] {
  const steps = stateFor(store, nowMs, timeZone).steps;
  return BREAKER_STEPS.filter((step) => (steps?.[step]?.pausedUntilMs ?? 0) > nowMs);
}

/**
 * A step was asked and answered (`ok`, even if it was unsure) or failed. Enough failures close together pause it; after the pause the next message is a try, and a try
 * that fails pauses it again at once, without a new line in the record, while one that answers ends the outage. The caller counts a failure only when another step
 * was there to take over (reader.ts).
 */
export function noteStep(store: AiStore, step: BreakerStep, ok: boolean, nowMs: number, timeZone: string, policy: BreakerPolicy = {}): void {
  const s = stateFor(store, nowMs, timeZone);
  const b = { ...DEFAULT_BREAKER, ...policy };
  const was = s.steps?.[step] ?? {};
  const pending = was.announce ?? [];
  let next: StepHealth;
  if (ok) {
    const announce: StepHealth["announce"] = was.pausedUntilMs !== undefined ? [...pending, "resumed"] : pending;
    next = announce.length > 0 ? { announce } : {};
  } else {
    const fails = [...(was.fails ?? []).filter((t) => nowMs - t < b.windowMinutes * MINUTE), nowMs].slice(-20);
    const tried = was.pausedUntilMs !== undefined; // paused before, so this was the try after the pause
    if (tried || fails.length >= b.failures) {
      const announce: StepHealth["announce"] = tried ? pending : [...pending, "paused"];
      next = { fails, pausedUntilMs: nowMs + b.pauseMinutes * MINUTE, ...(announce.length > 0 ? { announce } : {}) };
    } else next = { fails, ...(pending.length > 0 ? { announce: pending } : {}) };
  }
  s.steps = { ...s.steps, [step]: next };
}

export interface StepEvent { step: BreakerStep; event: "paused" | "resumed"; /** When the pause ends, for "paused". */ untilMs?: number }

/** What the record has not been told yet about the paused steps. Taking it clears it, so each is said once. */
export function takeAnnouncements(store: AiStore, nowMs: number, timeZone: string): StepEvent[] {
  const s = stateFor(store, nowMs, timeZone);
  const out: StepEvent[] = [];
  for (const step of BREAKER_STEPS) {
    const health = s.steps?.[step];
    if (!health?.announce?.length) continue;
    for (const event of health.announce) out.push({ step, event, ...(event === "paused" && health.pausedUntilMs !== undefined ? { untilMs: health.pausedUntilMs } : {}) });
    const { announce: _taken, ...rest } = health;
    s.steps = { ...s.steps, [step]: rest };
  }
  return out;
}

/** Counts only, for the runtime's status and so for a heartbeat: never a word of a message. */
export interface AiSummary {
  month: string;
  /** Messages understood at each step this month. */
  messages: { rules: number; decision: number; model: number };
  costMicroInr: number;
  unpriced: number;
  /** A step that is being left out because it kept failing, and until when (an ISO time); null when it is being asked. The shop is still in "ai" mode. */
  paused: Record<BreakerStep, string | null>;
  allowance: { messages: number | null; costMicroInr: number | null };
  mode: "ai" | "buttons";
  reason: ButtonReason | null;
}

// One read for the status page and the heartbeat so what the owner sees and what fleet is told are the same numbers.
export function summaryOf(store: AiStore, policy: AiPolicy, nowMs: number, timeZone: string): AiSummary {
  const s = stateFor(store, nowMs, timeZone);
  const mode = modeOf(store, policy, nowMs, timeZone);
  return {
    month: s.month, messages: { rules: s.rules, decision: s.decision, model: s.model }, costMicroInr: s.costMicroInr, unpriced: s.unpriced,
    paused: Object.fromEntries(BREAKER_STEPS.map((step) => { const until = s.steps?.[step]?.pausedUntilMs; return [step, until !== undefined && until > nowMs ? new Date(until).toISOString() : null]; })) as AiSummary["paused"],
    allowance: { messages: policy.allowance?.messages ?? null, costMicroInr: policy.allowance?.costMicroInr ?? null },
    mode: mode.buttons ? "buttons" : "ai", reason: mode.buttons ? mode.reason : null,
  };
}
