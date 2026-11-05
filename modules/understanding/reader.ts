// Reading a customer's message for an agent, for every template: ask the parser, check what it says, keep the cost in the month's totals, and move the shop to
// button mode (and tell the owner, once) when the allowance is used up, the shop was switched to buttons from outside, or a model failed.
//
// The parser is the router (router.ts) or the rule parser alone. Whether a message may spend at all is decided here, from the store's AI state
// (ai-state.ts): in button mode the parser is asked to read with the rules only, and a decision model that keeps failing is left out for a while (`skipSteps`).
import type { Language } from "../language/languages.ts";
import type { Clock } from "../core/clock.ts";
import { MINUTE } from "../core/time.ts";
import type { Action, Outcome } from "../record/record.ts";
import { DEFAULT_BREAKER, DEFAULT_PAUSE_MINUTES, dayLocal, modeOf, noteStep, pausedSteps, stateFor, takeAnnouncements } from "./ai-state.ts";
import type { AiPolicy, AiStore, ButtonReason } from "./ai-state.ts";
import { RULES } from "./model.ts";
import type { IntentBase, IntentParser, ParseOptionsBase, Understood } from "./model.ts";

export interface ReaderDeps<I extends IntentBase, C, O extends ParseOptionsBase> {
  parser: IntentParser<I, C, O>;
  /** What a parser is told about the shop (Bookings: its services and languages). */
  context: C;
  /** Check that what the parser returned is really an intent of the template; null when it is not. */
  coerce(raw: unknown, context: C): I | null;
  policy: AiPolicy;
  store: AiStore;
  clock: Clock;
  timeZone: string;
  /** The record entry the builder or partner reads when the agent moves to buttons. */
  log(action: Action, outcome: Outcome, inputs: unknown, more: { notes: string; refs: Record<string, string> }): void;
  /** Tell the owner, once, why. The ids are the template's three notices. */
  tellOwner(notice: "allowance" | "override" | "fault"): Promise<unknown>;
}

export function createReader<I extends IntentBase, C, O extends ParseOptionsBase>(deps: ReaderDeps<I, C, O>) {
  const { parser, context, policy, store, clock, timeZone } = deps;

  async function readIntent(text: string, options: O): Promise<{ intent: I; note?: string; understood: Understood }> {
    try {
      // A step that keeps failing is left out for a while: the parser is told, and the next step reads the message at once.
      const skipSteps = pausedSteps(store, clock.now(), timeZone);
      const asked = skipSteps.length > 0 ? { ...options, skipSteps } : options;
      // A parser that can say why it fell back (the model parser) gets that said in the record.
      const read = parser.parseDetailed ? await parser.parseDetailed(text, context, asked) : { intent: await parser.parse(text, context), fallbackReason: undefined, understood: undefined };
      const intent = deps.coerce(read.intent, context);
      const note = read.fallbackReason ? `the model could not be used (${read.fallbackReason}), so the rule parser read the message` : undefined;
      const understood = read.understood ?? RULES;
      return intent ? { intent, note, understood } : { intent: { kind: "unknown" } as I, note: "the parser's answer was not a valid intent, so the message was treated as not understood", understood };
    } catch (e) {
      return { intent: { kind: "unknown" } as I, note: `the parser failed (${(e as Error).message}), so the message was treated as not understood`, understood: RULES };
    }
  }

  /** The cost of one message as the record keeps it (every value a string, as the record's refs are). The field names are listed in pathways/bookings/Explanation.md. */
  function understandingRefs(u: Understood, via?: "button" | "list"): Record<string, string> {
    return {
      step: u.step, provider: u.provider, model: u.model,
      inputTokens: String(u.inputTokens), outputTokens: String(u.outputTokens),
      ...(u.costMicroInr !== null ? { costMicroInr: String(u.costMicroInr) } : {}),
      ...(u.rateDate !== null ? { rateDate: u.rateDate } : {}),
      tried: u.tried.join("+"),
      ...(u.failed.length > 0 ? { failed: u.failed.join("+") } : {}),
      ...(u.skipped?.length ? { skipped: u.skipped.join("+") } : {}),
      ...(via ? { via } : {}),
    };
  }

  /** Count this message in the month's totals. A model step that was asked and could not answer starts a pause: for a few minutes the rules and buttons do the reading. */
  function countUnderstood(u: Understood): void {
    const state = stateFor(store, clock.now(), timeZone);
    state[u.step] += 1;
    if (u.costMicroInr === null) state.unpriced += 1; else state.costMicroInr += u.costMicroInr;
    if (u.step === "rules" && u.failed.length > 0) state.pausedUntilMs = clock.now() + (policy.pauseMinutes ?? DEFAULT_PAUSE_MINUTES) * MINUTE;
    // The decision model's pause: it answering (even "unsure") ends an outage; it failing counts only when the language model was asked after it AND answered, because
    // only then did something take over, and the pause says the language model reads each message. With nothing after it, or with that down too, a failure is the fault above.
    if (u.tried.includes("decision")) {
      const failed = u.failed.includes("decision");
      if (!failed || (u.tried.includes("model") && !u.failed.includes("model"))) noteStep(store, "decision", !failed, clock.now(), timeZone, policy.breaker);
    }
  }

  /** Put the pauses and resumptions of a step in the record, once each. No customer and no owner is told: nothing they see changes, and the builder reads the record. */
  function announceSteps(): void {
    const month = stateFor(store, clock.now(), timeZone).month;
    const b = { ...DEFAULT_BREAKER, ...policy.breaker };
    for (const e of takeAnnouncements(store, clock.now(), timeZone)) {
      if (e.event === "paused") {
        deps.log("ai_mode", "confirmed", { step: e.step, event: "paused", month }, {
          notes: `The decision model (step 1) failed ${b.failures} times in ${b.windowMinutes} minutes, so for ${b.pauseMinutes} minutes the agent skips it and the language model (step 2) reads each message at once. A message costs the language model's price, as it did while the decision model failed, but does not wait for it. Then one message tries the decision model again. Every limit still holds. No customer or owner is told.`,
          refs: { mode: "step_paused", step: e.step, reason: "failures", month, ...(e.untilMs !== undefined ? { until: new Date(e.untilMs).toISOString() } : {}) },
        });
      } else {
        deps.log("ai_mode", "confirmed", { step: e.step, event: "resumed", month }, {
          notes: "The decision model (step 1) answered again, so the agent asks it first again.",
          refs: { mode: "step_resumed", step: e.step, month },
        });
      }
    }
  }

  /** Is the shop in button mode right now, and why? */
  const mode = () => modeOf(store, policy, clock.now(), timeZone);

  /**
   * Tell the owner, once, that the agent now answers with buttons and lists, and why; and put a line in the record that the builder or partner reads
   * (the runtime's status and the heartbeat carry it on). Once means once per month for the allowance, once per switch for the outside switch, and once a day for a
   * failing model. Customers are never told: they simply get buttons.
   */
  async function announceButtonMode(): Promise<void> {
    announceSteps();
    const now = mode();
    if (!now.buttons) return;
    const state = stateFor(store, clock.now(), timeZone);
    const today = dayLocal(clock.now(), timeZone);
    const reason: ButtonReason = now.reason;
    if (reason === "allowance") { if (state.told.allowance === state.month) return; state.told.allowance = state.month; }
    else if (reason === "override") { if (state.told.override) return; state.told.override = true; }
    else { if (state.told.fault === today) return; state.told.fault = today; }
    const spent = `${state.decision + state.model} messages and about ₹${(state.costMicroInr / 1_000_000).toFixed(2)} so far this month (${state.month})`;
    const notes = reason === "allowance"
      ? `This shop's monthly AI allowance is used up (${spent}). The agent reads with the rules only and answers with buttons and lists until the month ends. Every limit still holds. The owner has been told once.`
      : reason === "override"
        ? "The shop's config says ai: buttons (set from outside, for example when the plan or the partner's balance has no AI left). The agent reads with the rules only and answers with buttons and lists until that is changed. Every limit still holds. The owner has been told once."
        : `A model step failed, so for ${policy.pauseMinutes ?? DEFAULT_PAUSE_MINUTES} minutes the agent reads with the rules only and answers with buttons and lists, then tries the AI again. Every limit still holds. The owner is told once a day.`;
    deps.log("ai_mode", "confirmed", { reason, month: state.month }, { notes, refs: { mode: "buttons", reason, month: state.month } });
    await deps.tellOwner(reason);
  }

  return { readIntent, understandingRefs, countUnderstood, mode, announceButtonMode };
}

