// The approvals relay: the owner approves a refund Guard is holding, on WhatsApp, through a process that is not the runtime.
// It is the same for every template. What differs is the words it says to the owner, and the facts those words are written from: the template gives
// them as a `voice` (Bookings: templates/commerce/bookings/approvals/relay.ts).
//
// Why it is separate, and what each constraint is for (the longer version is templates/commerce/bookings/Explanation.md, "Approvals on WhatsApp"):
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
//
// Several named people (B37, Guard's ADR-0061; the contract is the monorepo's Deferred D82). A shop may have other people who approve (`approvers`). Then a
// held refund that Guard marks as needing several approvals, or as asked for by someone, carries `may_still_decide`, and the relay asks EXACTLY those
// people it has a number for: one ask per (approval, person), each with its own fresh code, accepted only from that person's number, and each answer
// signed with that person's own secret. A 200 "pending" is a vote: the person is told how many more are needed, and the runtime is not told. "approved"
// or "denied" is the decision: the runtime is told, the others are told their ask is closed, and on a no the person who asked is told too. The person
// who asked never gets an ask, whether Guard or the runtime named them. A request without those keys is the owner's alone, handled exactly as above.
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
import type { GuardClient, Held, Notified, RefundContext, RuntimeClient } from "./clients.ts";
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
  /**
   * The ids: the request to approve, and the answers to the owner's reply. B37: `waiting` (this person's approval is in, N more are needed), `closed` (the others
   * approved it, so this person's answer is not needed) and `refused` (one person said no).
   */
  ids: { ask: string; expired: string; failed: string; done: string; denied: string; waiting: string; closed: string; refused: string };
}

/** B37: a person besides the owner who may approve, by their id in Guard's approver directory. Their secret is the Guard client's (`secretOf`). */
export interface RelayPerson { id: string; whatsapp: string; language: Language }

export interface RelayOptions {
  /** The words the relay says to the owner. */
  voice: RelayVoice;
  clock: Clock;
  guard: GuardClient;
  runtime: RuntimeClient;
  /** The relay's own principal at the WhatsApp Guard (its own base URL and credential): it sends the owner's messages, and nothing the runtime can reach. */
  messaging: Messaging;
  store: RelayStore;
  /** The owner's number: the only sender whose replies count (with `approvers`, each of them too, for their own asks). */
  ownerWhatsapp: string;
  /**
   * B37: the other people who may approve, each answering from their own number. Left out (or empty): the owner alone, exactly as before. With them, `ownerApproverId`
   * is the owner's id in Guard's directory (the id the Guard client signs the owner's answers with), so the relay can tell the owner apart in `may_still_decide`.
   */
  approvers?: RelayPerson[];
  ownerApproverId?: string;
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

const digitsOf = (s: string) => s.replace(/\D/gu, "");
const sameNumber = (a: string, b: string) => digitsOf(a) === digitsOf(b);
/** The meta key that keeps when a number last wrote (WhatsApp's 24-hour window). The owner's is the one it always was. */
export const lastInboundKey = (phone: string, owner: string): string => (sameNumber(phone, owner) ? "owner_last_inbound" : `last_inbound:${digitsOf(phone)}`);

export function createRelay(options: RelayOptions): Relay {
  const { clock, guard, runtime, messaging, store, voice } = options;
  const log = options.log ?? (() => undefined);
  const graceMs = options.contextGraceMs ?? 120_000;
  const marginMs = options.codeMarginMs ?? 60_000;
  const maxTries = options.maxSendTries ?? 5;
  const guessLimit = options.wrongGuessLimit ?? 10;
  const owner = options.ownerWhatsapp;
  // B37: the people besides the owner, by their Guard id, and the owner's own id among them
  const people = new Map((options.approvers ?? []).map((p) => [p.id, p]));
  const ownerId = options.ownerApproverId;
  if (people.size > 0 && !ownerId) throw new Error("The approvals relay needs the owner's approver id (ownerApproverId) when other people approve too.");

  const counters = { uncertain: 0, notFromOwner: 0, reused: 0, whileLocked: 0, guardReadFailures: 0, lastPollAt: null as number | null };
  const seenUncertain = new Set<string>();

  // ---- one thing at a time ------------------------------------------------------------------------------------------------------
  let chain: Promise<void> = Promise.resolve();
  const serial = (fn: () => Promise<void>): Promise<void> => { const run = chain.then(fn, fn); chain = run.then(() => undefined, () => undefined); return run; };

  // ---- who an ask is for -----------------------------------------------------------------------------------------------------------
  /** A group ask names a person; "" is the owner's single ask, as every ask was before B37. */
  const isGroup = (ask: Ask) => ask.approver !== "";
  /** The number an ask goes to and its answer must come from. Undefined for an id the relay has no number for (it is never asked). */
  const phoneOf = (approver: string): string | undefined => (approver === "" || approver === ownerId ? owner : people.get(approver)?.whatsapp);
  /** The approver whose number this is: "" for the owner (signing as the relay's own id), a person's id, or undefined for a stranger. */
  const whoIs = (from: string): string | undefined => {
    if (sameNumber(from, owner)) return "";
    for (const p of people.values()) if (sameNumber(from, p.whatsapp)) return p.id;
    return undefined;
  };
  /** The id an answer is signed as. The owner's single ask signs as the Guard client's own id, as before. */
  const signer = (ask: Ask): string | undefined => (isGroup(ask) ? ask.approver : undefined);

  // ---- the builder is told ------------------------------------------------------------------------------------------------------
  function alert(approval: string, kind: string, note: string): void {
    if (store.addAlert(approval, kind, note, clock.now())) log(`ALERT [${kind}] ${note}`);
  }
  /** Not asking the owner about this one, and saying why to the builder. */
  function stop(approval: string, kind: string, note: string): void {
    store.moveAsk(approval, ["waiting_context", "sending", "asked", "deciding"], "alerted", { code: null });
    alert(approval, kind, `${note} The owner was not asked about approval ${approval}.`);
  }
  /** The same for one person's ask of a refund that needs several: the others are left as they are. */
  function stopOne(ask: Ask, kind: string, note: string): void {
    store.moveAsk(ask, ["waiting_context", "sending", "asked", "deciding"], "alerted", { code: null });
    alert(ask.approval, `${kind}:${ask.approver}`, `${note} ${ask.approver} was not asked about approval ${ask.approval}.`);
  }

  // ---- WhatsApp -----------------------------------------------------------------------------------------------------------------
  /** "sent" went, or may have (a lost reply is not sent again); "not_sent" definitely did not. */
  async function send(ids: string[], facts: { language: Language }, asTemplate: boolean, to: string = owner): Promise<"sent" | "not_sent"> {
    const text = voice.render(ids, facts);
    const verdict = voice.check(text, facts);
    if (!verdict.ok) throw new Error(`the message did not match its record: ${verdict.problems.join(" ")}`);
    const asTemplateMessage = () => messaging.sendTemplate(to, voice.templateMessage({ ids, language: facts.language, facts, text, generic: voice.ownerTemplate }));
    try {
      if (asTemplate || !(await messaging.isWindowOpen(to))) await asTemplateMessage();
      else await messaging.sendText(to, text);
      return "sent";
    } catch (e) {
      if (e instanceof WindowClosedError && !asTemplate) { try { await asTemplateMessage(); return "sent"; } catch (e2) { return mayHaveHappened(e2) ? "sent" : "not_sent"; } }
      if (mayHaveHappened(e)) return "sent"; // it may have gone out, and sending it again could ask twice
      if (e instanceof ApiError) return "not_sent";
      throw e;
    }
  }

  /** The facts of an ask, in the language of the person it is for (the owner's, on the owner's single ask, as before), and how many more approvals it waits for. */
  const factsFor = (ask: Ask, c: RefundContext) => {
    const facts = voice.factsFor(ask, isGroup(ask) && ask.language ? { ...c, ownerLanguage: ask.language as RefundContext["ownerLanguage"] } : c);
    return ask.approvalsLeft !== null ? { ...facts, approvalsLeft: ask.approvalsLeft } : facts;
  };
  const contextOf = (ask: Ask): RefundContext | undefined => { try { return ask.context ? JSON.parse(ask.context) as RefundContext : undefined; } catch { return undefined; } };

  // ---- asking ---------------------------------------------------------------------------------------------------------------------
  /** Asks sent (or tried) during this pass, so the leftovers step does not try the same one a second time in the same pass. */
  const triedThisPass = new Set<string>();
  const passKey = (ask: Ask) => `${ask.approval}\u0000${ask.approver}`;

  async function sendAsk(ask: Ask): Promise<void> {
    triedThisPass.add(passKey(ask));
    const c = contextOf(ask);
    const to = phoneOf(ask.approver);
    const halt = (kind: string, note: string) => (isGroup(ask) ? stopOne(ask, kind, note) : stop(ask.approval, kind, note));
    if (!c || !ask.code || !to) { halt("lost_context", "The relay lost what it needs to word the request."); return; }
    let result: "sent" | "not_sent";
    try { result = await send([voice.ids.ask], factsFor(ask, c), false, to); } catch (e) { halt("message_check", (e as Error).message); return; }
    if (result === "sent") {
      store.moveAsk(ask, ["sending"], "asked", { askedAtMs: clock.now(), code: null });
      log(isGroup(ask) ? `Asked ${ask.approver} about approval ${ask.approval}.` : `Asked the owner about approval ${ask.approval}.`);
      return;
    }
    const tries = ask.sendTries + 1;
    if (tries >= maxTries) { halt("send_failed", `The request could not be sent ${isGroup(ask) ? `to ${ask.approver}` : "to the owner"} after ${tries} tries.`); return; }
    store.updateAsk(ask, { sendTries: tries }); // the same code goes again next pass: one request, one code
  }

  /** How long the owner has, in whole hours (at least 1): Guard's own expiry less the time of the hold, never a number written here. */
  const hoursOf = (held: Held): number => Math.max(1, Math.round((held.expiresAtMs - held.requestedAtMs) / HOUR));

  /** A fresh code no live ask already has. */
  const freshCode = (): string => {
    let code = newCode();
    for (let tries = 0; store.askByCode(code) && tries < 20; tries++) code = newCode();
    return code;
  };

  /** A held refund Guard shows, and what to do about it. */
  async function consider(held: Held): Promise<void> {
    if (held.group) return considerGroup(held, held.group);
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

    const code = freshCode();
    const approvalHours = hoursOf(held);
    const moved = store.moveAsk(held.id, ["waiting_context"], "sending", {
      code, codeHash: hashCode(code), codeExpiresAtMs: held.expiresAtMs - marginMs, guardExpiresAtMs: held.expiresAtMs, booking: c.booking, customerPhone: c.customerPhone,
      language: c.ownerLanguage, context: JSON.stringify(c), approvalHours,
    });
    if (moved) await sendAsk(store.ask(held.id)!);
  }

  // ---- B37: a refund that needs several people, or that someone asked for ----------------------------------------------------------
  /**
   * The same checks as the owner's single ask (the agent, the receipt, the time left, the runtime's booking and that it agrees with Guard), done once per refund,
   * then one ask per person in `may_still_decide` whom the relay can reach: never one who asked for it, whether Guard names them or the runtime does.
   * Someone who appears later (Guard escalated to their role) is asked then. Votes already given are Guard's; nothing here counts them.
   */
  async function considerGroup(held: Held, group: NonNullable<Held["group"]>): Promise<void> {
    const now = clock.now();
    const firstKey = `first_seen:${held.id}`;
    if (!store.getMeta(firstKey)) store.setMeta(firstKey, String(now));
    const firstSeenMs = Number(store.getMeta(firstKey));
    const halt = (kind: string, note: string) => { for (const a of store.asksOf(held.id)) store.moveAsk(a, ["waiting_context", "sending", "asked", "deciding"], "alerted", { code: null }); alert(held.id, kind, `${note} Nobody was asked about approval ${held.id}.`); };
    if (store.outcome(held.id)) return; // decided here already; Guard may not have caught up in its queue
    if (options.expectedAgent && held.agent !== options.expectedAgent) return halt("other_agent", `Guard shows a refund held for "${held.agent}", not for this client's agent.`);
    if (!held.receipt) return halt("no_receipt", "The held refund has no receipt, so it cannot be matched to a booking.");
    if (held.expiresAtMs - marginMs <= now) return;

    const found = await runtime.context(held.receipt);
    const waited = now - firstSeenMs;
    if (found.kind !== "found") {
      if (waited > graceMs) halt(found.kind === "missing" ? "no_booking" : "runtime_unreachable", found.kind === "missing" ? "The runtime shows no booking holding this refund." : `The runtime could not be asked (${found.error}).`);
      return;
    }
    const c = found.context;
    if (c.paymentId !== held.paymentId || c.amountPaise !== held.amountPaise) return halt("disagree", "The runtime's booking is for a different payment or amount than the one Guard holds.");
    if (c.approval !== held.id) {
      if (waited > graceMs) halt("stale", "The runtime holds a different approval for this booking than the one Guard shows.");
      return;
    }
    // The person who asked never approves. Guard enforces whom it was told; the runtime's case is checked against that, and the builder told if they differ.
    const named = new Set(group.requestedBy);
    const unnamed = (c.requestedBy ?? []).filter((r) => !named.has(r));
    if (unnamed.length > 0) alert(held.id, "requester_not_named", `The runtime says ${unnamed.join(", ")} asked for approval ${held.id}, but Guard does not list them as asking. They are not asked to approve it; check that the runtime sends Geo-Requested-By.`);
    const requesters = new Set([...group.requestedBy, ...(c.requestedBy ?? [])]);
    const context = JSON.stringify({ ...c, requestedBy: [...requesters].sort() });
    const targets = group.mayStillDecide.filter((id) => !requesters.has(id) && phoneOf(id) !== undefined && !store.ask(held.id, id));
    if (targets.length === 0) {
      if (store.asksOf(held.id).length === 0) alert(held.id, "nobody_to_ask", `Guard holds approval ${held.id} for ${group.needed} approval(s), but none of the people who may still decide it (${group.mayStillDecide.join(", ") || "nobody"}) has a WhatsApp number here, apart from anyone who asked for it. Nobody was asked.`);
      return;
    }
    const approvalHours = hoursOf(held);
    for (const id of targets) {
      const code = freshCode();
      const language = id === ownerId ? c.ownerLanguage : people.get(id)!.language;
      store.insertAsk({
        approval: held.id, approver: id, state: "sending", receipt: held.receipt, paymentId: held.paymentId, amountPaise: held.amountPaise, firstSeenMs, guardExpiresAtMs: held.expiresAtMs, approvalHours,
        code, codeHash: hashCode(code), codeExpiresAtMs: held.expiresAtMs - marginMs, booking: c.booking, customerPhone: c.customerPhone, language, context,
      });
      await sendAsk(store.ask(held.id, id)!);
    }
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
    for (const ask of store.asks(["waiting_context", "sending"])) if (ask.guardExpiresAtMs - marginMs <= clock.now()) store.moveAsk(ask, ["waiting_context", "sending"], "expired", { code: null });
    for (const ask of store.asks(["asked"])) if (ask.codeExpiresAtMs !== null && ask.codeExpiresAtMs <= clock.now()) store.moveAsk(ask, ["asked"], "expired");
  }

  // ---- the owner's answers --------------------------------------------------------------------------------------------------------
  const locked = () => store.guessesSince(clock.now() - HOUR) >= guessLimit;

  /** Tell the person an ask is for (the owner, on the owner's single ask) one of the relay's answers. */
  async function tellOwner(ask: Ask, id: string): Promise<boolean> {
    const c = contextOf(ask);
    const to = phoneOf(ask.approver);
    if (!c || !to) return true;
    try { return (await send([id], factsFor(ask, c), false, to)) === "sent"; } catch { return true; } // a reply that cannot be worded is not tried again
  }

  async function lateReply(ask: Ask): Promise<void> {
    if (ask.lateReplied) return;
    store.updateAsk(ask, { lateReplied: true }); // once, whatever happens next
    await tellOwner(ask, voice.ids.expired);
  }

  /** The owner's answer is in hand (the code is used up). Give it to Guard, then the runtime, then the owner. Safe to run again after a crash. */
  async function finishDecision(ask: Ask): Promise<void> {
    if (isGroup(ask)) return finishVote(ask);
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
        case "requester":
        case "refused":
          alert(ask.approval, `guard_refused_${told.kind === "refused" ? told.status : 403}`, `Guard did not accept the owner's signed answer (${told.kind === "refused" ? told.status : 403}: ${told.error}). Check the approver id and secret.`);
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

  // ---- B37: one person's answer to a refund that needs several -----------------------------------------------------------------------
  /**
   * One person's answer, signed with their own secret. A vote on a request that is still pending is recorded and the person told how many more are needed;
   * the decision (approved, or denied by any one no) goes to the runtime once, and the others are told how it ended. It can run again after a crash: Guard's
   * 409 says whether this person's earlier answer, or the decision, is already in.
   */
  async function finishVote(ask: Ask): Promise<void> {
    const decision = ask.decision!;
    const told: Notified = await guard.notify(ask.approval, decision, signer(ask));
    const back = () => store.moveAsk(ask, ["deciding"], "asked", { decision: null }); // the code was not used up: Guard never recorded the answer
    switch (told.kind) {
      case "recorded": {
        const state = told.state ?? (decision === "approve" ? "approved" : "denied");
        if (state === "pending") return voted(ask, left(told.needed, told.given));
        if (state === "approved" || state === "denied") return decided(ask, state === "approved" ? "approve" : "deny", true);
        back();
        alert(ask.approval, `odd_state:${ask.approver}`, `Guard answered ${ask.approver}'s answer for approval ${ask.approval} with the state "${state}". Nothing more was done.`);
        await tellOwner(ask, voice.ids.failed);
        return;
      }
      case "already": {
        if (told.by !== undefined) {
          // this person's own earlier answer, on a request still waiting for others: a try of ours that got through, or a change of mind, which is not a second answer
          if (told.by === ask.approver && told.state === (decision === "approve" ? "approved" : "denied")) return voted(ask, left(told.needed, told.given));
          store.moveAsk(ask, ["deciding"], "alerted");
          alert(ask.approval, `conflict:${ask.approver}`, `Guard already has ${told.by}'s answer "${told.state}" for approval ${ask.approval}, not ${ask.approver}'s "${decision}". Each person answers once; nothing more was done.`);
          await tellOwner(ask, voice.ids.failed);
          return;
        }
        // the request is decided already (by others, or by this answer on an earlier try): it left Guard's queue, so its state is the word in the 409
        if (told.state === "approved" || told.state === "consumed") return decided(ask, "approve", told.state === "approved" && decision === "approve");
        if (told.state === "denied") return decided(ask, "deny", decision === "deny");
        back();
        alert(ask.approval, `odd_state:${ask.approver}`, `Guard says approval ${ask.approval} is already "${told.state}". Nothing more was done.`);
        await tellOwner(ask, voice.ids.failed);
        return;
      }
      case "expired": store.moveAsk(ask, ["deciding"], "expired"); await lateReply(store.ask(ask.approval, ask.approver)!); return;
      case "missing": stopOne(ask, "guard_forgot", "Guard has no such approval any more."); await tellOwner(ask, voice.ids.failed); return;
      case "requester":
        // a relay bug: the person who asked for the call was asked to approve it
        store.moveAsk(ask, ["deciding"], "alerted");
        alert(ask.approval, `requester_asked:${ask.approver}`, `Guard refused ${ask.approver}'s answer for approval ${ask.approval} because ${ask.approver} asked for this call (${told.error}). The relay should not have asked them: this is a fault in the relay.`);
        await tellOwner(ask, voice.ids.failed);
        return;
      case "refused":
        alert(ask.approval, `guard_refused_${told.status}:${ask.approver}`, `Guard did not accept ${ask.approver}'s signed answer (${told.status}: ${told.error}). Check that person's approver id, role and secret.`);
        back();
        await tellOwner(ask, voice.ids.failed);
        return;
      case "unreachable":
        back();
        await tellOwner(ask, voice.ids.failed);
        return;
    }
  }

  /** How many more approvals a pending request waits for, from Guard's counts (at least one: it is pending). */
  const left = (needed?: number, given?: number): number => (needed !== undefined && given !== undefined ? Math.max(1, needed - given) : 1);

  /** The vote is in and the request still waits for others: tell this person how many more, and not the runtime. */
  async function voted(ask: Ask, more: number): Promise<void> {
    store.moveAsk(ask, ["deciding"], "decided", { guardTold: true, runtimeTold: true, approvalsLeft: more }); // runtimeTold: the runtime hears only the decision, never a vote
    const now = store.ask(ask.approval, ask.approver)!;
    if (!now.ownerTold && await tellOwner(now, voice.ids.waiting)) store.updateAsk(now, { ownerTold: true });
  }

  /**
   * Guard decided the request. Record it once, tell the runtime once, tell this person what happens next (`answered`: it was their answer that did it, or theirs
   * agrees with it), and close every other ask of it, so each is told how it ended and no code stays live.
   */
  async function decided(ask: Ask, outcome: "approve" | "deny", answered: boolean): Promise<void> {
    store.setOutcome({ approval: ask.approval, decision: outcome, guardExpiresAtMs: ask.guardExpiresAtMs, atMs: clock.now() });
    if (answered) store.moveAsk(ask, ["deciding"], "decided", { guardTold: true, runtimeTold: true });
    else store.moveAsk(ask, ["deciding"], "closed", { code: null, ownerTold: false });
    closeOthers(ask.approval, ask.approver);
    await finishOutcome(ask.approval);
    const now = store.ask(ask.approval, ask.approver)!;
    if (now.state === "decided" && !now.ownerTold && await tellOwner(now, outcome === "approve" ? voice.ids.done : voice.ids.denied)) store.updateAsk(now, { ownerTold: true });
    await tellClosed(ask.approval);
  }

  /** Every other ask of a decided request is closed: no code stays live. The person who asked gets one too, on a no, so they are told. */
  function closeOthers(approval: string, except: string): void {
    for (const other of store.asksOf(approval)) {
      if (other.approver === except) continue;
      // a vote already given is closed too (its person is told the end of it, not "waiting" any more); one expired or set aside stays as it is
      store.moveAsk(other, ["waiting_context", "sending", "asked", "decided"], "closed", { code: null, ownerTold: false });
    }
    const outcome = store.outcome(approval);
    const sample = store.asksOf(approval)[0];
    if (outcome?.decision !== "deny" || !sample) return;
    const c = contextOf(sample);
    for (const r of c?.requestedBy ?? []) {
      if (phoneOf(r) === undefined || store.ask(approval, r)) continue;
      const language = r === ownerId ? c!.ownerLanguage : people.get(r)!.language;
      store.insertAsk({ ...sample, approver: r, state: "closed", code: null, codeHash: null, language, decision: null, guardTold: false, runtimeTold: true, ownerTold: false, lateReplied: false, sendTries: 0, approvalsLeft: null });
    }
  }

  /** The runtime hears the decision once: approve (it then sends the identical call again) or deny. */
  async function finishOutcome(approval: string): Promise<void> {
    const o = store.outcome(approval);
    if (!o || o.runtimeTold) return;
    if (await runtime.decided(approval, o.decision, randomUUID())) store.markRuntimeTold(approval);
  }

  /** Each closed ask's person is told how it ended, once: approved by the others, or refused (a vote of theirs that was then refused hears that too). */
  async function tellClosed(approval: string): Promise<void> {
    const o = store.outcome(approval);
    if (!o) return;
    for (const a of store.asksOf(approval)) {
      if (a.state !== "closed" || a.ownerTold) continue;
      const id = o.decision === "deny" ? voice.ids.refused : a.decision === "approve" ? voice.ids.done : voice.ids.closed;
      if (await tellOwner(a, id)) store.updateAsk(a, { ownerTold: true });
    }
  }

  async function onOwnerMessage(m: { from: string; text: string; timestamp: number }): Promise<void> {
    const who = whoIs(m.from);
    if (who === undefined) { counters.notFromOwner++; return; } // only the owner's number (and the other approvers'), whatever the words
    const now = clock.now();
    store.setMeta(lastInboundKey(m.from, owner), String(Math.min(Number.isFinite(m.timestamp) && m.timestamp > 0 ? m.timestamp : now, now)));
    const reply = parseCodeReply(m.text);
    if (!reply) return; // not an answer to the relay: the agent reads it
    if (locked()) { counters.whileLocked++; return; }
    const ask = store.askByCode(reply.code);
    if (!ask) {
      store.addGuess(now);
      if (locked()) alert("relay", `lockout-${Math.floor(now / HOUR)}`, `${guessLimit} replies in an hour carried a code the relay never issued. Codes are ignored for the rest of the hour. If nobody at the shop did this, someone may be guessing.`);
      return;
    }
    // a code is accepted only from the number of the person it was sent to: the owner's single ask from the owner, a person's ask from that person
    const to = phoneOf(ask.approver);
    if (!to || !sameNumber(m.from, to)) { counters.notFromOwner++; return; }
    if (ask.state === "asked") {
      if (ask.codeExpiresAtMs !== null && now >= ask.codeExpiresAtMs) { store.moveAsk(ask, ["asked"], "expired"); await lateReply(store.ask(ask.approval, ask.approver)!); return; }
      if (!store.moveAsk(ask, ["asked"], "deciding", { decision: reply.decision })) return; // the one use of a code
      await finishDecision(store.ask(ask.approval, ask.approver)!);
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
    for (const ask of store.asks(["sending"])) if (!triedThisPass.has(passKey(ask))) await sendAsk(ask);
    for (const ask of store.asks(["deciding"])) await finishDecision(ask); // work is one thing at a time, so a "deciding" found here was cut short
    for (const ask of store.asks(["decided"])) {
      if (isGroup(ask)) { // a vote, or the answer that decided it: what is left is telling its person
        const o = store.outcome(ask.approval);
        const id = !o ? voice.ids.waiting : o.decision === "approve" ? voice.ids.done : voice.ids.denied;
        if (!ask.ownerTold && await tellOwner(ask, id)) store.updateAsk(ask, { ownerTold: true });
        continue;
      }
      if (!ask.runtimeTold && clock.now() > ask.guardExpiresAtMs + HOUR) { // the agent cannot use the approval any more, whatever it is told
        store.updateAsk(ask.approval, { runtimeTold: true });
        alert(ask.approval, "runtime_never_told", `The runtime could not be told what the owner decided about approval ${ask.approval} before it ran out.`);
      }
      const now = store.ask(ask.approval)!;
      if (!now.runtimeTold || !now.ownerTold) await finishNotices(now);
    }
    // B37: a decision the runtime has not heard yet, and closed asks whose people have not been told
    for (const o of store.outcomes()) {
      if (!o.runtimeTold && clock.now() > o.guardExpiresAtMs + HOUR) {
        store.markRuntimeTold(o.approval);
        alert(o.approval, "runtime_never_told", `The runtime could not be told how approval ${o.approval} was decided before it ran out.`);
      }
      await finishOutcome(o.approval);
      await tellClosed(o.approval);
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
      for (const a of alerts) { const kind = a.kind.replace(/-\d+$/u, "").replace(/:.*$/u, ""); byKind[kind] = (byKind[kind] ?? 0) + 1; }
      return {
        asks, decided: { approve, deny }, uncertainHolds: counters.uncertain, alerts: { total: alerts.length, byKind },
        ignored: { notFromOwner: counters.notFromOwner, reusedOrUnknownCode: counters.reused, whileLocked: counters.whileLocked },
        wrongGuessesLastHour: store.guessesSince(clock.now() - HOUR), locked: locked(), guardReadFailures: counters.guardReadFailures,
        lastPollAt: counters.lastPollAt === null ? null : new Date(counters.lastPollAt).toISOString(), messagesWaiting: store.unprocessed().length,
      };
    },
  };
}
