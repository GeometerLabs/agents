// The approvals relay: the owner approves a refund Guard is holding, on WhatsApp, through a process that is not the runtime.
// It is the same for every template. What differs is the words it says to the owner, and the facts those words are written from: the template gives
// them as a `voice` (Bookings: pathways/bookings/approvals/relay.ts).
//
// Why it is separate, and what each constraint is for (the longer version is pathways/bookings/Explanation.md, "Approvals on WhatsApp"):
//   1. It holds the owner's approver secret. The runtime never does, so the runtime can never approve anything, even if it is taken over.
//   2. It finds held refunds by READING GUARD (the held calls an approver may see). What the owner is asked to approve, the payment and the amount,
//      comes from Guard's held call and from nowhere else. The runtime only adds context (who, which service, which slot), and if its view
//      disagrees with Guard's the owner is not asked: the builder is told.
//   3. Every ask has a fresh random one-use code. The owner's reply carries the code and not the booking reference, so a reply cannot be
//      guessed from anything the runtime or a customer knows.
//   4. The owner's reply reaches this process straight from the inbox, never through the runtime. It is accepted only from the owner's number, with
//      a live code, once. (With a provider that does not sign its webhooks, the code is what stands between a leaked callback URL and a forged approval.)
//   5. On "approve <code>" it gives Guard the owner's signed answer, then tells the runtime, then tells the owner what happens next. Guard releases the
//      refund only when the runtime sends the identical call again. On "deny <code>", the same with a no.
//   6. A reply that is not a code it issued is ignored without a word. A reply to a code that has run out is answered once, plainly.
//   7. A hold with no approval to give (an uncertain outcome) is never shown to the owner; the builder is told.
import { randomUUID } from "node:crypto";
import { newCode, parseCodeReply } from "./code.ts";
import { ApiError, mayHaveHappened } from "../core/faults.ts";
import { WindowClosedError } from "../core/faults.ts";
import type { Messaging } from "../messaging/messaging.ts";
import type { Clock } from "../core/clock.ts";
import type { Language } from "../language/languages.ts";
import type { CheckResult } from "../language/check.ts";
import type { TemplateMessage } from "../messaging/messaging.ts";
import { HOUR } from "../core/time.ts";
import { readHeld } from "./clients.ts";
import type { GuardClient, Held, RefundContext, RuntimeClient } from "./clients.ts";
import { hashCode } from "./store.ts";
import type { Ask, AskState, RelayStore } from "./store.ts";

/**
 * What the relay says to the owner, in the template's words. `Facts` is what the template writes its messages from; the relay builds them from Guard's held call and the
 * runtime's context (`factsFor`) and never from anything a customer typed. The ids name the messages the relay sends.
 */
export interface RelayVoice<Facts extends { language: Language } = any> {
  /** The message for these ids, written from the facts. Throws if the facts lack something a message needs. */
  render(ids: string[], facts: Facts): string;
  /** The outgoing check: the final text against the facts. A message that fails it is not sent. */
  check(text: string, facts: Facts): CheckResult;
  /** The WhatsApp template that carries this text once the owner's 24-hour window has closed. */
  templateMessage(a: { ids: string[]; language: Language; facts: Facts; text: string; generic: string }): TemplateMessage;
  /** The generic template name for a message to the owner. */
  ownerTemplate: string;
  /** The facts of one ask, from the runtime's context and Guard's amount. */
  factsFor(ask: Ask, context: RefundContext): Facts;
  /** The ids: the request to approve, and the answers to the owner's reply. */
  ids: { ask: string; expired: string; failed: string; done: string; denied: string };
}

export interface RelayOptions {
  /** The words the relay says to the owner. */
  voice: RelayVoice;
  clock: Clock;
  guard: GuardClient;
  runtime: RuntimeClient;
  /** The relay's own principal at the WhatsApp Guard (its own base URL and credential): it sends the owner's messages, and nothing the runtime can reach. */
  messaging: Messaging;
  store: RelayStore;
  /** The owner's number: the only sender whose replies count. */
  ownerWhatsapp: string;
  /** If given, a hold made by any other agent is not shown to the owner. */
  expectedAgent?: string;
  /** How long a hold may wait for the runtime to show the booking before the builder is told. Default 2 minutes. */
  contextGraceMs?: number;
  /** A code stops working this long before Guard's approval does: Guard needs time to spare when the call is sent again. Default 60 seconds. */
  codeMarginMs?: number;
  /** Messages that definitely did not go out are tried again this many times. Default 5. */
  maxSendTries?: number;
  /** Replies with a code that matches nothing, per hour, before every code reply is ignored until the hour is up. Default 10. */
  wrongGuessLimit?: number;
  /** One plain line at a time: no code, no phone number, no message text. */
  log?: (line: string) => void;
}

export interface RelayStatus {
  asks: Partial<Record<AskState, number>>;
  decided: { approve: number; deny: number };
  /** Holds Guard showed with no approval to give. They are for the builder. */
  uncertainHolds: number;
  alerts: { total: number; byKind: Record<string, number> };
  ignored: { notFromOwner: number; reusedOrUnknownCode: number; whileLocked: number };
  wrongGuessesLastHour: number;
  locked: boolean;
  guardReadFailures: number;
  lastPollAt: string | null;
  messagesWaiting: number;
}

export interface Relay {
  /** The owner's messages from the inbox: saved at once (so the inbox can be answered), handled right after. */
  receive(messages: { id: string; from: string; text: string; timestamp: number }[]): { saved: number; duplicates: number };
  /** One pass: the owner's messages, then Guard's held calls, then whatever is left to tell Guard, the runtime or the owner. */
  poll(): Promise<void>;
  /** Resolves when everything started has been handled. */
  idle(): Promise<void>;
  start(everyMs: number): void;
  stop(): Promise<void>;
  status(): RelayStatus;
}

const sameNumber = (a: string, b: string) => a.replace(/\D/gu, "") === b.replace(/\D/gu, "");

export function createRelay(options: RelayOptions): Relay {
  const { clock, guard, runtime, messaging, store, voice } = options;
  const log = options.log ?? (() => undefined);
  const graceMs = options.contextGraceMs ?? 120_000;
  const marginMs = options.codeMarginMs ?? 60_000;
  const maxTries = options.maxSendTries ?? 5;
  const guessLimit = options.wrongGuessLimit ?? 10;
  const owner = options.ownerWhatsapp;

  const counters = { uncertain: 0, notFromOwner: 0, reused: 0, whileLocked: 0, guardReadFailures: 0, lastPollAt: null as number | null };
  const seenUncertain = new Set<string>();

  // ---- one thing at a time ------------------------------------------------------------------------------------------------------
  let chain: Promise<void> = Promise.resolve();
  const serial = (fn: () => Promise<void>): Promise<void> => { const run = chain.then(fn, fn); chain = run.then(() => undefined, () => undefined); return run; };

  // ---- the builder is told ------------------------------------------------------------------------------------------------------
  function alert(approval: string, kind: string, note: string): void {
    if (store.addAlert(approval, kind, note, clock.now())) log(`ALERT [${kind}] ${note}`);
  }
  /** Not asking the owner about this one, and saying why to the builder. */
  function stop(approval: string, kind: string, note: string): void {
    store.moveAsk(approval, ["waiting_context", "sending", "asked", "deciding"], "alerted", { code: null });
    alert(approval, kind, `${note} The owner was not asked about approval ${approval}.`);
  }

  // ---- WhatsApp -----------------------------------------------------------------------------------------------------------------
  /** "sent" went, or may have (a lost reply is not sent again); "not_sent" definitely did not. */
  async function send(ids: string[], facts: { language: Language }, asTemplate: boolean): Promise<"sent" | "not_sent"> {
    const text = voice.render(ids, facts);
    const verdict = voice.check(text, facts);
    if (!verdict.ok) throw new Error(`the message did not match its record: ${verdict.problems.join(" ")}`);
    const asTemplateMessage = () => messaging.sendTemplate(owner, voice.templateMessage({ ids, language: facts.language, facts, text, generic: voice.ownerTemplate }));
    try {
      if (asTemplate || !(await messaging.isWindowOpen(owner))) await asTemplateMessage();
      else await messaging.sendText(owner, text);
      return "sent";
    } catch (e) {
      if (e instanceof WindowClosedError && !asTemplate) { try { await asTemplateMessage(); return "sent"; } catch (e2) { return mayHaveHappened(e2) ? "sent" : "not_sent"; } }
      if (mayHaveHappened(e)) return "sent"; // it may have gone out, and sending it again could ask twice
      if (e instanceof ApiError) return "not_sent";
      throw e;
    }
  }

  const factsFor = (ask: Ask, c: RefundContext) => voice.factsFor(ask, c);
  const contextOf = (ask: Ask): RefundContext | undefined => { try { return ask.context ? JSON.parse(ask.context) as RefundContext : undefined; } catch { return undefined; } };

  // ---- asking ---------------------------------------------------------------------------------------------------------------------
  /** Asks sent (or tried) during this pass, so the leftovers step does not try the same one a second time in the same pass. */
  const triedThisPass = new Set<string>();

  async function sendAsk(ask: Ask): Promise<void> {
    triedThisPass.add(ask.approval);
    const c = contextOf(ask);
    if (!c || !ask.code) { stop(ask.approval, "lost_context", "The relay lost what it needs to word the request."); return; }
    let result: "sent" | "not_sent";
    try { result = await send([voice.ids.ask], factsFor(ask, c), false); } catch (e) { stop(ask.approval, "message_check", (e as Error).message); return; }
    if (result === "sent") {
      store.moveAsk(ask.approval, ["sending"], "asked", { askedAtMs: clock.now(), code: null });
      log(`Asked the owner about approval ${ask.approval}.`);
      return;
    }
    const tries = ask.sendTries + 1;
    if (tries >= maxTries) { stop(ask.approval, "send_failed", `The request could not be sent to the owner after ${tries} tries.`); return; }
    store.updateAsk(ask.approval, { sendTries: tries }); // the same code goes again next pass: one request, one code
  }

  /** How long the owner has, in whole hours (at least 1): Guard's own expiry less the time of the hold, never a number written here. */
  const hoursOf = (held: Held): number => Math.max(1, Math.round((held.expiresAtMs - held.requestedAtMs) / HOUR));

  /** A held refund Guard shows, and what to do about it. */
  async function consider(held: Held): Promise<void> {
    const now = clock.now();
    let ask = store.ask(held.id);
    if (ask && ask.state !== "waiting_context") return; // already asked, answered, expired or set aside
    if (!ask) {
      store.insertAsk({ approval: held.id, state: "waiting_context", receipt: held.receipt ?? "", paymentId: held.paymentId, amountPaise: held.amountPaise, firstSeenMs: now, guardExpiresAtMs: held.expiresAtMs, approvalHours: hoursOf(held) });
      ask = store.ask(held.id)!;
    }
    if (held.youMayDecide !== true) return stop(held.id, "cannot_decide", "The reading credential is not an approver who may decide this refund, so an answer from the owner could not be recorded.");
    if (options.expectedAgent && held.agent !== options.expectedAgent) return stop(held.id, "other_agent", `Guard shows a refund held for "${held.agent}", not for this client's agent.`);
    if (!held.receipt) return stop(held.id, "no_receipt", "The held refund has no receipt, so it cannot be matched to a booking.");
    if (held.expiresAtMs - marginMs <= now) { store.moveAsk(held.id, ["waiting_context"], "expired"); return; }

    const found = await runtime.context(held.receipt);
    const waited = now - ask.firstSeenMs;
    if (found.kind !== "found") {
      // the runtime saves its side after Guard has held the call, so a short wait is normal
      if (waited > graceMs) stop(held.id, found.kind === "missing" ? "no_booking" : "runtime_unreachable", found.kind === "missing" ? "The runtime shows no booking holding this refund." : `The runtime could not be asked (${found.error}).`);
      return;
    }
    const c = found.context;
    if (c.paymentId !== held.paymentId || c.amountPaise !== held.amountPaise) {
      return stop(held.id, "disagree", "The runtime's booking is for a different payment or amount than the one Guard holds.");
    }
    if (c.approval !== held.id) {
      if (waited > graceMs) stop(held.id, "stale", "The runtime holds a different approval for this booking than the one Guard shows.");
      return;
    }

    let code = newCode();
    for (let tries = 0; store.askByCode(code) && tries < 20; tries++) code = newCode();
    const approvalHours = hoursOf(held);
    const moved = store.moveAsk(held.id, ["waiting_context"], "sending", {
      code, codeHash: hashCode(code), codeExpiresAtMs: held.expiresAtMs - marginMs, guardExpiresAtMs: held.expiresAtMs, booking: c.booking, customerPhone: c.customerPhone,
      language: c.ownerLanguage, context: JSON.stringify(c), approvalHours,
    });
    if (moved) await sendAsk(store.ask(held.id)!);
  }

  async function readHolds(): Promise<void> {
    const reviews = await guard.reviews();
    counters.lastPollAt = clock.now();
    if (!reviews.ok) {
      counters.guardReadFailures++;
      if (reviews.credential) alert("relay", `read-credential-${Math.floor(clock.now() / HOUR)}`, `${reviews.error}. No refund can be asked about until a new reading credential is issued.`);
      else log(`Could not read Guard's held calls: ${reviews.error}.`);
      return;
    }
    for (const item of reviews.items) {
      const parsed = readHeld(item);
      if (parsed.ok) { await consider(parsed.held); continue; }
      if (!parsed.id) {
        // a hold with no approval to give: only a person at the server can settle it, so it is the builder's
        const key = JSON.stringify(item).slice(0, 200);
        if (!seenUncertain.has(key)) { seenUncertain.add(key); counters.uncertain++; log("Guard shows a held call that cannot be approved on WhatsApp. It is for the builder, not the owner."); }
      } else if (/not a refund on razorpay/u.test(parsed.reason)) continue; // not ours to ask about
      else alert(parsed.id, "unreadable", `Guard holds refund ${parsed.id}, but ${parsed.reason}.`);
    }
    // waiting for the runtime, and the code that ran out
    for (const ask of store.asks(["waiting_context", "sending"])) if (ask.guardExpiresAtMs - marginMs <= clock.now()) store.moveAsk(ask.approval, ["waiting_context", "sending"], "expired", { code: null });
    for (const ask of store.asks(["asked"])) if (ask.codeExpiresAtMs !== null && ask.codeExpiresAtMs <= clock.now()) store.moveAsk(ask.approval, ["asked"], "expired");
  }

  // ---- the owner's answers --------------------------------------------------------------------------------------------------------
  const locked = () => store.guessesSince(clock.now() - HOUR) >= guessLimit;

  async function tellOwner(ask: Ask, id: string): Promise<boolean> {
    const c = contextOf(ask);
    if (!c) return true;
    try { return (await send([id], factsFor(ask, c), false)) === "sent"; } catch { return true; } // a reply that cannot be worded is not tried again
  }

  async function lateReply(ask: Ask): Promise<void> {
    if (ask.lateReplied) return;
    store.updateAsk(ask.approval, { lateReplied: true }); // once, whatever happens next
    await tellOwner(ask, voice.ids.expired);
  }

  /** The owner's answer is in hand (the code is used up). Give it to Guard, then the runtime, then the owner. Safe to run again after a crash. */
  async function finishDecision(ask: Ask): Promise<void> {
    const decision = ask.decision!;
    if (!ask.guardTold) {
      const told = await guard.notify(ask.approval, decision);
      switch (told.kind) {
        case "recorded": break;
        case "already": {
          if (told.state === (decision === "approve" ? "approved" : "denied")) break; // an earlier try of ours did get through
          store.moveAsk(ask.approval, ["deciding"], "alerted");
          alert(ask.approval, "conflict", `Guard already has the answer "${told.state}" for approval ${ask.approval}, not the owner's "${decision}". Nothing more was done.`);
          await tellOwner(ask, voice.ids.failed);
          return;
        }
        case "expired": store.moveAsk(ask.approval, ["deciding"], "expired"); await lateReply(store.ask(ask.approval)!); return;
        case "missing": stop(ask.approval, "guard_forgot", "Guard has no such approval any more."); await tellOwner(ask, voice.ids.failed); return;
        case "refused":
          alert(ask.approval, `guard_refused_${told.status}`, `Guard did not accept the owner's signed answer (${told.status}: ${told.error}). Check the approver id and secret.`);
          store.moveAsk(ask.approval, ["deciding"], "asked", { decision: null }); // the code was not used up: Guard never recorded the answer
          await tellOwner(ask, voice.ids.failed);
          return;
        case "unreachable":
          store.moveAsk(ask.approval, ["deciding"], "asked", { decision: null });
          await tellOwner(ask, voice.ids.failed);
          return;
      }
      store.updateAsk(ask.approval, { guardTold: true });
    }
    store.moveAsk(ask.approval, ["deciding"], "decided");
    await finishNotices(store.ask(ask.approval)!);
  }

  /** What is left to tell the runtime and the owner once Guard has the answer. */
  async function finishNotices(ask: Ask): Promise<void> {
    if (!ask.runtimeTold && await runtime.decided(ask.approval, ask.decision!, randomUUID())) store.updateAsk(ask.approval, { runtimeTold: true });
    const now = store.ask(ask.approval)!;
    if (!now.ownerTold && await tellOwner(now, ask.decision === "approve" ? voice.ids.done : voice.ids.denied)) store.updateAsk(ask.approval, { ownerTold: true });
  }

  async function onOwnerMessage(m: { from: string; text: string; timestamp: number }): Promise<void> {
    if (!sameNumber(m.from, owner)) { counters.notFromOwner++; return; } // only the owner's number, whatever the words
    const now = clock.now();
    store.setMeta("owner_last_inbound", String(Math.min(Number.isFinite(m.timestamp) && m.timestamp > 0 ? m.timestamp : now, now)));
    const reply = parseCodeReply(m.text);
    if (!reply) return; // not an answer to the relay: the agent reads it
    if (locked()) { counters.whileLocked++; return; }
    const ask = store.askByCode(reply.code);
    if (!ask) {
      store.addGuess(now);
      if (locked()) alert("relay", `lockout-${Math.floor(now / HOUR)}`, `${guessLimit} replies in an hour carried a code the relay never issued. Codes are ignored for the rest of the hour. If nobody at the shop did this, someone may be guessing.`);
      return;
    }
    if (ask.state === "asked") {
      if (ask.codeExpiresAtMs !== null && now >= ask.codeExpiresAtMs) { store.moveAsk(ask.approval, ["asked"], "expired"); await lateReply(store.ask(ask.approval)!); return; }
      if (!store.moveAsk(ask.approval, ["asked"], "deciding", { decision: reply.decision })) return; // the one use of a code
      await finishDecision(store.ask(ask.approval)!);
      return;
    }
    if (ask.state === "expired") { await lateReply(ask); return; }
    counters.reused++; // answered already, or set aside: no word
  }

  async function processMessages(): Promise<void> {
    for (const m of store.unprocessed()) {
      try { await onOwnerMessage(m); } catch (e) { log(`An owner message could not be handled this time (${(e as Error).message}); it is tried again.`); return; }
      store.markProcessed(m.id);
    }
  }

  /** Whatever a crash or a failure left half done. */
  async function finishLeftovers(): Promise<void> {
    for (const ask of store.asks(["sending"])) if (!triedThisPass.has(ask.approval)) await sendAsk(ask);
    for (const ask of store.asks(["deciding"])) await finishDecision(ask); // work is one thing at a time, so a "deciding" found here was cut short
    for (const ask of store.asks(["decided"])) {
      if (!ask.runtimeTold && clock.now() > ask.guardExpiresAtMs + HOUR) { // the agent cannot use the approval any more, whatever it is told
        store.updateAsk(ask.approval, { runtimeTold: true });
        alert(ask.approval, "runtime_never_told", `The runtime could not be told what the owner decided about approval ${ask.approval} before it ran out.`);
      }
      const now = store.ask(ask.approval)!;
      if (!now.runtimeTold || !now.ownerTold) await finishNotices(now);
    }
  }

  let timer: ReturnType<typeof setInterval> | undefined;
  const poll = () => serial(async () => {
    triedThisPass.clear();
    await processMessages();
    await readHolds();
    await finishLeftovers();
    await processMessages();
  });

  return {
    receive(messages) {
      const result = store.saveMessages(messages, clock.now());
      void serial(processMessages).catch(() => undefined);
      return result;
    },
    poll,
    idle: () => chain,
    start(everyMs) { if (!timer) { timer = setInterval(() => { void poll().catch((e) => log(`A pass failed: ${(e as Error).message}`)); }, everyMs); timer.unref?.(); } },
    async stop() { if (timer) clearInterval(timer); timer = undefined; await chain; },
    status() {
      const asks: Partial<Record<AskState, number>> = {};
      let approve = 0; let deny = 0;
      for (const a of store.asks()) { asks[a.state] = (asks[a.state] ?? 0) + 1; if (a.state === "decided") { if (a.decision === "approve") approve++; else deny++; } }
      const alerts = store.alerts();
      const byKind: Record<string, number> = {};
      for (const a of alerts) { const kind = a.kind.replace(/-\d+$/u, ""); byKind[kind] = (byKind[kind] ?? 0) + 1; }
      return {
        asks, decided: { approve, deny }, uncertainHolds: counters.uncertain, alerts: { total: alerts.length, byKind },
        ignored: { notFromOwner: counters.notFromOwner, reusedOrUnknownCode: counters.reused, whileLocked: counters.whileLocked },
        wrongGuessesLastHour: store.guessesSince(clock.now() - HOUR), locked: locked(), guardReadFailures: counters.guardReadFailures,
        lastPollAt: counters.lastPollAt === null ? null : new Date(counters.lastPollAt).toISOString(), messagesWaiting: store.unprocessed().length,
      };
    },
  };
}
