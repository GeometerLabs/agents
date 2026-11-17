// Send once, for a message that COMMITS someone (17 Nov 2026): Stock orders' purchase order to a supplier and its reminder first. A repeat of an ordinary message is a nuisance;
// a repeat of a purchase order can mean goods delivered twice. A step saves only at its end (modules/runtime/core.ts), so a step that sends inside itself can die after WhatsApp
// took the message and before the save, and then runs again and sends it again. This file is the way out, and it is the same protocol the monthly report
// (modules/report/monthly-job.ts) and the owner's morning line (modules/assistant/morning.ts) already follow, applied to a message a step asks for:
//
//   1. THE STEP DOES NOT SEND. It records an INTENT in the store: the message's id, who it goes to, the templates and the values, and the case. The step is saved whole.
//   2. AFTER THAT SAVE the runtime runs `runSendOnce`: it writes the CLAIM (`claimed`, a record line `attempted`) and SAVES it; then it sends; then it writes the ENDING
//      (`confirmed`, `unconfirmed`, `failed`, `blocked`) and saves that.
//   3. A claim with no ending is NEVER sent again. If the process died between the claim and the send, or between the send and the ending, the next run finds a claim with
//      no ending and cannot tell which: it writes `unconfirmed` ("may or may not have gone out") and sends nothing. The case's own code then asks the owner (a to-do item).
//   4. Only `failed` (the provider or Guard said no BEFORE taking it: `nothingWasSent`) is tried again: after an hour, three tries in all, then `gave_up` and a person decides.
//   5. A person's "Send it again" on an unconfirmed message is a NEW intent (a fresh claim), made by the person's own press, never by the machine. "They got it" settles the
//      old one without sending. Either way the unconfirmed intent is marked `resolved`, so it leaves the owner's list.
//
// The state is the store's own (`SendOnceState`, kept with the cases and saved with them), so a claim and the case it is about are written in one transaction, and the order's
// state machine is one machine: the intent's ending is what moves the case (`settle`), not a second flag. The record gets its lines too (`attempted`, then the ending that
// `say` writes), so the report, the cost meter and the page of evidence see the same facts as for the report job.
//
// What is the same as the other two jobs (one implementation of the rules, not a third copy): RETRY_AFTER_MS, MAX_TRIES and `nothingWasSent` live HERE and the report and
// morning jobs import them. What those two keep to themselves is WHEN a message may go (a day, a month, an opening hour, a closed day) and their memory (the record keyed by
// the date), because they build the message at send time from the day's facts; moving them onto the intent queue would change what they save and when (Explanation.md,
// "Send once", says why they were left). No disk, no node: the browser demo's agent imports this.
import { ApiError, GuardUnavailableError, NotSentError } from "../core/faults.ts";
import { HOUR } from "../core/time.ts";
import type { SaidOutcome } from "./say.ts";

/** After a refusal, how long before the next try, and how many tries in all. The report job and the morning line use the same numbers. */
export const RETRY_AFTER_MS = HOUR;
export const MAX_TRIES = 3;

/**
 * Did WhatsApp (or Guard in front of it) say no before anything was sent? Only then may the same message be sent again. A 5xx or a reply that is not understood can come
 * after the message was taken, so those are never "nothing was sent".
 */
export function nothingWasSent(e: unknown): boolean {
  if (e instanceof NotSentError || e instanceof GuardUnavailableError) return true;
  return e instanceof ApiError && e.status >= 400 && e.status < 500;
}

/**
 * Where an intent stands. `queued`: asked for, not claimed. `claimed`: the claim is saved, the send may have started (an intent that is found like this is an unknown
 * outcome). `confirmed`: the provider took it. `unconfirmed`: it may or may not have gone out; never sent again by itself. `failed`: nothing went out; tried again when due.
 * `gave_up`: failed on every try. `blocked`: a gate held it back (opted out, did not match the record); trying again would be held back the same way.
 */
export type SendStatus = "queued" | "claimed" | "confirmed" | "unconfirmed" | "failed" | "gave_up" | "blocked";
/** How an intent ended, as the case's `settle` hears it. `failed` is not final (a retry is due); `gave_up` is. */
export type SendEnding = "confirmed" | "unconfirmed" | "failed" | "gave_up" | "blocked";
/** What a person did about an unconfirmed message. */
export type UnknownResolution = "owner_got_it" | "owner_send_again";

export interface SendIntent {
  /** "po-3:order:1": the case, the kind and the number of this ask. Unique in the state, so an intent is never queued twice. */
  id: string;
  /** What kind of message ("purchase_order", "supplier_check"): the case's code decides what the kind means. */
  kind: string;
  /** The case it is about ("po-3"). */
  caseId: string;
  /** Who it goes to: the recipient's WhatsApp number and the name the owner knows them by. */
  to: string;
  toName: string;
  /** The templates, in order, and the values they are written from (numbers and short names only: never a customer's words). */
  templates: string[];
  values: Record<string, string | number>;
  createdMs: number;
  status: SendStatus;
  /** How many times it has been claimed. */
  tries: number;
  lastTryMs?: number;
  endedMs?: number;
  /** Why it ended as it did (a refusal's words, or that the process stopped). */
  note?: string;
  /** An unconfirmed intent a person has dealt with: it is no longer asked about. */
  resolved?: UnknownResolution;
}

export interface SendOnceState { intents: SendIntent[] }

/** The state in a store, made when the first intent is queued. */
export const sendOnceOf = (store: { sendOnce?: SendOnceState }): SendOnceState => (store.sendOnce ??= { intents: [] });

/** The id the next intent of this kind for this case gets: "po-3:order:2" is the case's second purchase order message (the owner's "Send it again"). */
export const nextIntentId = (state: SendOnceState, caseId: string, kind: string): string => `${caseId}:${kind}:${state.intents.filter((i) => i.caseId === caseId && i.kind === kind).length + 1}`;

/** Record that a message is wanted. It is only a line in the store until the runtime sends it after the step's save. Returns undefined when the id is already there. */
export function queueSend(state: SendOnceState, intent: Omit<SendIntent, "status" | "tries">): SendIntent | undefined {
  if (state.intents.some((i) => i.id === intent.id)) return undefined;
  const made: SendIntent = { ...intent, status: "queued", tries: 0 };
  state.intents.push(made);
  return made;
}

/** The messages that may or may not have gone out and that nobody has dealt with yet: the owner's to-do list reads these. */
export const openUnknowns = (state: SendOnceState | undefined, kind?: string): SendIntent[] =>
  (state?.intents ?? []).filter((i) => i.status === "unconfirmed" && i.resolved === undefined && (kind === undefined || i.kind === kind));

/** A person's word on an unconfirmed message. Only an unconfirmed, unresolved intent can be resolved, and only once. It sends nothing: "send again" is a new `queueSend`. */
export function resolveUnknown(state: SendOnceState, id: string, how: UnknownResolution): SendIntent | undefined {
  const intent = state.intents.find((i) => i.id === id);
  if (!intent || intent.status !== "unconfirmed" || intent.resolved !== undefined) return undefined;
  intent.resolved = how;
  return intent;
}

export interface SendOnceDeps {
  state: SendOnceState;
  now(): number;
  /** The claim's record line (`attempted`), written before the claim is saved. */
  recordClaim(intent: SendIntent): void;
  /** An ending the sender did not write itself: a crash found, or a send that threw. (A send that returns has written its own line.) */
  recordEnding(intent: SendIntent, ending: "unconfirmed" | "failed", note: string): void;
  /** Send it, exactly as the case's one way out (`say`) does, and say how it ended. Must not throw for a refusal: that is `not_sent`. */
  deliver(intent: SendIntent): Promise<SaidOutcome>;
  /** The case moves on, synchronously, in the store (the order is `sent`, `send_unknown`, ...). Saved together with the ending. */
  settle(intent: SendIntent, ending: SendEnding): void;
  /** After the ending is saved: tell the owner. Best effort: a crash here costs a message, never a duplicate order. */
  notify?(intent: SendIntent, ending: SendEnding): Promise<void>;
  /** Save the store and the record as they are now: after every claim and every ending. */
  save(): void;
  log?(line: string): void;
}

/** The ending a send's outcome means. */
const endingOf: Record<SaidOutcome, "confirmed" | "unconfirmed" | "failed" | "blocked"> = { accepted: "confirmed", maybe: "unconfirmed", not_sent: "failed", held_back: "blocked" };

/** Is this intent waiting to be claimed: asked for and not tried, or refused and due again? */
function due(i: SendIntent, now: number): boolean {
  return i.status === "queued" || (i.status === "failed" && i.tries < MAX_TRIES && (i.lastTryMs ?? 0) + RETRY_AFTER_MS <= now);
}

/** Write an ending, move the case, save. Returns the ending the case heard (a third refusal is `gave_up`). */
function finish(d: SendOnceDeps, i: SendIntent, ending: "confirmed" | "unconfirmed" | "failed" | "blocked", note?: string): SendEnding {
  const heard: SendEnding = ending === "failed" && i.tries >= MAX_TRIES ? "gave_up" : ending;
  i.status = heard === "gave_up" ? "gave_up" : ending;
  i.endedMs = d.now();
  if (note) i.note = note;
  d.settle(i, heard);
  d.save();
  return heard;
}

/**
 * One pass: first the claims a dead process left (never sent again), then every intent that is due, each claimed and saved before it is sent and ended and saved after.
 * Called by the runtime after each saved step and each tick, so a message goes soon after its step, and a refusal is tried again when its hour is up.
 */
export async function runSendOnce(d: SendOnceDeps): Promise<void> {
  const told: { intent: SendIntent; ending: SendEnding }[] = [];
  const notify = async () => {
    const all = told.splice(0);
    for (const { intent, ending } of all) {
      try { await d.notify?.(intent, ending); } catch (e) { d.log?.(`The owner could not be told that ${intent.id} ended as ${ending} (${(e as Error).message}). It is on their list all the same.`); }
    }
    if (all.length > 0 && d.notify) d.save(); // the words to the owner are in the record: keep them with the rest
  };

  // ---- a claim with no ending: the process stopped somewhere between the claim and the ending. It may have gone out. It is never sent again. ----
  for (const i of d.state.intents.filter((x) => x.status === "claimed")) {
    const note = "The process stopped while this message was being sent, so it may or may not have reached them. It is not sent again.";
    d.recordEnding(i, "unconfirmed", note);
    told.push({ intent: i, ending: finish(d, i, "unconfirmed", note) });
    d.log?.(`The message ${i.id} was being sent when the process stopped. It may or may not have gone out, and it will not be sent again by itself.`);
  }

  // ---- the intents that are due, oldest first ----
  for (const i of d.state.intents.filter((x) => due(x, d.now()))) {
    // 1. claim, and save the claim before anything goes out
    i.status = "claimed";
    i.tries += 1;
    i.lastTryMs = d.now();
    d.recordClaim(i);
    d.save();
    // 2. send
    let ending: "confirmed" | "unconfirmed" | "failed" | "blocked";
    let note: string | undefined;
    try { ending = endingOf[await d.deliver(i)]; }
    catch (e) { // the sender writes its own line for what it catches; anything else that comes out of it is a send of unknown outcome unless it is a plain refusal
      ending = nothingWasSent(e) ? "failed" : "unconfirmed";
      note = (e as Error).message;
      d.recordEnding(i, ending, note);
    }
    // 3. the ending, saved
    told.push({ intent: i, ending: finish(d, i, ending, note) });
    if (ending === "failed") d.log?.(`The message ${i.id} could not be sent (${note ?? "the provider refused it"}). ${i.tries < MAX_TRIES ? `It is tried again in an hour (try ${i.tries} of ${MAX_TRIES}).` : "That was the last try."}`);
  }
  await notify();
}
