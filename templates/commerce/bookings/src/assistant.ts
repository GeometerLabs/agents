// Bookings as a skill of the shop's assistant (item 11e; modules/assistant/skill.ts). The reads and `prepare` are pure over the store, so the morning line can read them
// with no agent (`bookingsSkill` with no `acts`). The acts are the agent's own paths (src/agent.ts hands them in as `acts`): cancelling releases the slot and refunds the
// deposit through the same refund path, limits and Guard as the owner's "approve b-3"; answering something waiting sends the very fixed reply the owner could type
// ("approve b-3", "retry b-3", or the UPI mark's button with its code). Nothing here decides a refund's size beyond what was paid, or moves money another way.
//
// A closed day (the owner's "close Sunday"): the date is in the assistant's closed days, which the free times and the within-hours limit read (src/agent.ts, src/limits.ts),
// and each customer booked that day is told through the assistant's template and stays booked. Nothing is cancelled or refunded by closing a day.
import { addDays, localParts, weekdayOf, zonedToMs } from "../../../../modules/core/time.ts";
import { resolveTime } from "../../../../modules/language/dates.ts";
import type { Decision } from "../../../../modules/limits/limits.ts";
import type { LocalDate } from "../../../../modules/core/time.ts";
import { checkWords, ownerReply } from "../../../../modules/assistant/wire.ts";
import type { DayNotice, DayRow, Executed, OwnerSkill, Prepared, Proposal, WaitingItem } from "../../../../modules/assistant/skill.ts";
import type { CardAction } from "../../../../modules/assistant/state.ts";
import { markButtonId } from "../../../../modules/payments/owner-marked/owner.ts";
import { leftOn } from "../../../../modules/payments/owner-marked/ledger.ts";
import type { InboundMessage } from "../../../../modules/messaging/messaging.ts";
import type { RecordEntry } from "../../../../modules/record/record.ts";
import type { RefundResult } from "../../../../modules/payments/refunds.ts";
import { LIVE_STATES, latestBooking } from "./booking.ts";
import type { Booking, Store } from "./booking.ts";
import { hoursOn, serviceName } from "./settings.ts";
import type { Settings } from "./settings.ts";
import { formatSlot } from "../../../../modules/language/format.ts";

/** The agent's own paths the skill's acts use. Each is the function the agent already runs for the same thing; the skill adds no other way to act. */
export interface BookingsActs {
  /** The fixed reply the owner could type or tap, handled by the agent exactly as if they had (`onOwnerMessage`). */
  answer(msg: InboundMessage): Promise<void>;
  /**
   * Release the slot of a paid booking and mark it cancelled by the owner, then refund exactly `amountInr` (the card's amount: the deposit less what already went
   * back) the way the agent refunds (Guard holds it above the limit; a UPI shop's owner owes it).
   */
  cancelPaid(b: Booking, amountInr: number, why: string): Promise<RefundResult | "owed">;
  /** Cancel a booking still waiting for its deposit: the hold and the link end, nothing was paid. */
  cancelWaiting(b: Booking, why: string): Promise<void>;
  /** Refund part or all of a paid deposit, the way "approve b-3" does. */
  refund(b: Booking, paymentId: string, amountInr: number, why: string): Promise<RefundResult | "owed">;
  /** The two slot rules for a time (within the hours, closed days included; not on top of another booking), without telling anyone (`slotRules`). */
  slotRules(b: Booking, startMs: number, endMs: number): Promise<{ hours: Decision; clash: Decision }>;
  /** Move a confirmed booking to this time through the agent's own reschedule (the calendar, the customer's "rescheduled" message), as the customer's own yes does. */
  applyMove(b: Booking, startMs: number, endMs: number): Promise<void>;
  /** The customer's line after the owner cancelled ("cancelled_no_deposit" when nothing was paid). */
  tellCancelled(b: Booking): Promise<boolean>;
  owner: string;
  /** A UPI shop: the owner pays refunds back from their own app. */
  ownerRefunds: boolean;
}

export interface BookingsSkillDeps {
  settings: Settings;
  store: Store;
  nowMs: () => number;
  /** The record as it is in this step: what was already refunded on a payment. */
  entries: () => readonly RecordEntry[];
  optedOut: (phone: string) => boolean;
  /** Left out: a read-only skill (the morning line, the owner's app). */
  acts?: BookingsActs;
}

/** How the owner knows a customer: a name when a channel gave one (item 11d), else the number. */
const whoOf = (b: Booking): string => (b as Booking & { contact?: { name?: string } }).contact?.name ?? b.customer;

/** Bookings' words for the router: a message with these is for Bookings in a shop of several skills. */
const ROUTING_WORDS = {
  en: ["book", "booking", "appointment", "slot"], hi: ["बुक", "बुकिंग", "अपॉइंटमेंट", "booking"], ml: ["ബുക്ക്", "ബുക്കിംഗ്", "അപ്പോയിന്റ്മെന്റ്"], kn: ["ಬುಕ್", "ಬುಕಿಂಗ್", "ಅಪಾಯಿಂಟ್ಮೆಂಟ್"],
} as const;

/** The states whose customer expects to come: told when their day is closed, and again if it opens. */
const COMING: Booking["state"][] = ["confirmed", "needs_owner", "awaiting_deposit"];

export function bookingsSkill(deps: BookingsSkillDeps): OwnerSkill {
  const { settings, store } = deps;
  const tz = settings.timezone;
  const lang = settings.owner.language;
  const what = (b: Booking): string => {
    const service = settings.services.find((s) => s.id === b.serviceId);
    return [service ? serviceName(service, lang) : "", b.startMs !== undefined ? formatSlot(b.startMs, tz, lang) : ""].filter(Boolean).join(", ");
  };
  const onDate = (b: Booking, date: LocalDate): boolean => {
    if (b.startMs === undefined) return false;
    const from = zonedToMs(date, { hour: 0, minute: 0 }, tz);
    return b.startMs >= from && b.startMs < zonedToMs(addDays(date, 1), { hour: 0, minute: 0 }, tz);
  };
  /** Money already going back on a payment: refunds the record confirmed, and UPI refunds owed or marked sent. One with an unclear outcome or held by Guard makes the booking busy (below). */
  const alreadyBack = (paymentId: string): number => {
    let paise = 0;
    for (const e of deps.entries()) if (e.action === "refund" && e.refs.paymentId === paymentId && e.outcome === "confirmed") paise += Number(e.refs.amountPaise ?? 0) || 0;
    for (const r of store.upi?.refunds ?? []) if (r.paymentId === paymentId && r.state !== "kept") paise += r.amountPaise;
    return paise;
  };
  const busy = (b: Booking): boolean => b.pending.some((p) => p.kind === "guard_hold" || p.kind === "refund_retry") || (b.refundIssues ?? []).length > 0;
  const aboveLimit = (paise: number): boolean => !deps.acts?.ownerRefunds && paise > settings.cancellation.refundLimitInr * 100;
  const requestOf = (b: Booking) => store.upi?.requests.find((r) => r.reference === b.id && r.id === b.linkId);

  /** What waits for the owner on one booking, as a card can show it (and the fields its digest is over). */
  function waitingOn(b: Booking): (WaitingItem & { fields: Record<string, string | number | boolean>; reply: { id: string } | string })[] {
    const out: (WaitingItem & { fields: Record<string, string | number | boolean>; reply: { id: string } | string })[] = [];
    const p = b.pending[0];
    if (p?.kind === "refund") out.push({ case: b.id, kind: "late_refund", amountPaise: p.amountInr * 100, who: whoOf(b), what: what(b), money: true, yes: "approve", no: "deny", fields: { paymentId: p.paymentId, amountPaise: p.amountInr * 100 }, reply: "approve" });
    else if (p?.kind === "calendar" && b.depositInr !== undefined) out.push({ case: b.id, kind: "calendar", amountPaise: b.depositInr * 100, who: whoOf(b), what: what(b), money: true, yes: "retry", fields: { paymentId: b.depositPaymentId ?? "", startMs: b.startMs ?? 0, amountPaise: b.depositInr * 100 }, reply: "retry" });
    // A deposit to mark only when there is a reason to think it came (the customer said so, or part is marked), as the unfinished-work list reads it.
    const r = requestOf(b);
    if (b.state === "awaiting_deposit" && r?.code && (r.status === "partially_paid" || b.claimTellAtMs !== undefined)) {
      out.push({ case: b.id, kind: "deposit", amountPaise: leftOn(r), who: whoOf(b), what: what(b), money: true, yes: "received", fields: { request: r.id, amountPaise: leftOn(r), marks: r.marks.length, used: r.usedCodes.length }, reply: { id: markButtonId("received", r.code) } });
    }
    for (const o of store.upi?.refunds ?? []) {
      if (o.caseId !== b.id || o.state !== "owed" || !o.code) continue;
      out.push({ case: b.id, kind: "refund_owed", amountPaise: o.amountPaise, who: whoOf(b), what: what(b), money: true, yes: "refunded", fields: { refund: o.id, amountPaise: o.amountPaise, used: o.usedCodes.length }, reply: { id: markButtonId("refunded", o.code) } });
    }
    return out;
  }

  const action = (kind: string, b: Booking, fields: CardAction["fields"]): CardAction => ({ kind, skill: "bookings", case: b.id, fields: { who: whoOf(b), ...fields } });

  function prepare(p: Proposal): Prepared {
    const b = store.bookings.get(p.case);
    if (!b) return { ok: false, why: "no_case" };
    if (p.kind === "answer") {
      const item = waitingOn(b).find((i) => i.kind === p.itemKind);
      if (!item) return { ok: false, why: "nothing_waiting" };
      return { ok: true, action: action("answer", b, { itemKind: item.kind, answer: p.answer, ...item.fields }), shown: { who: item.who, what: item.what, amountPaise: item.amountPaise } };
    }
    if (p.kind === "message") {
      // The owner's words go as typed; an amount in them must be one this booking has (its deposit or its service's price). Money back is a refund, with its own card.
      const service = settings.services.find((s) => s.id === b.serviceId);
      const refused = checkWords(p.words, { optedOut: deps.optedOut(b.customer), amountsPaise: [b.depositInr, service?.priceInr, settings.deposit.amountInr].map((v) => (v === undefined ? undefined : v * 100)) });
      if (refused) return { ok: false, why: refused };
      return { ok: true, action: action("message", b, { phone: b.customer, words: p.words }), shown: { who: whoOf(b), what: what(b), amountPaise: 0, words: p.words } };
    }
    if (busy(b)) return { ok: false, why: "busy" };
    if (p.kind === "cancel") {
      if (b.state === "awaiting_deposit") return { ok: true, action: action("cancel", b, { state: b.state, startMs: b.startMs ?? 0, amountPaise: 0 }), shown: { who: whoOf(b), what: what(b), amountPaise: 0 } };
      if (b.state !== "confirmed" && b.state !== "needs_owner") return { ok: false, why: b.state === "enquiry" || b.state === "confirming_details" ? "not_booked" : "not_live" };
      const back = b.depositPaymentId && b.depositInr !== undefined ? Math.max(0, b.depositInr * 100 - alreadyBack(b.depositPaymentId)) : 0;
      if (back === 0) return { ok: false, why: "already_back" };
      return { ok: true, action: action("cancel", b, { state: b.state, startMs: b.startMs ?? 0, paymentId: b.depositPaymentId ?? "", amountPaise: back }), shown: { who: whoOf(b), what: what(b), amountPaise: back }, ...(aboveLimit(back) ? { aboveLimit: true } : {}) };
    }
    // a refund: of what was paid on this booking's deposit, less what is already going back; only once the booking no longer stands (a booking that stands is cancelled, with its own card)
    if (b.state === "confirmed" || b.state === "needs_owner") return { ok: false, why: "cancel_first" };
    if (!b.depositPaymentId || b.depositInr === undefined) return { ok: false, why: "nothing_paid" };
    const available = Math.max(0, b.depositInr * 100 - alreadyBack(b.depositPaymentId));
    if (available === 0) return { ok: false, why: "nothing_paid" };
    const amount = p.amountPaise ?? available;
    if (amount > available) return { ok: false, why: "too_much" };
    if (amount % 100 !== 0) return { ok: false, why: "too_much" }; // refunds go in whole rupees, as the shop's settings are
    return { ok: true, action: action("refund", b, { paymentId: b.depositPaymentId, amountPaise: amount, availablePaise: available }), shown: { who: whoOf(b), what: what(b), amountPaise: amount }, ...(aboveLimit(amount) ? { aboveLimit: true } : {}) };
  }

  async function execute(a: CardAction): Promise<Executed> {
    const acts = deps.acts;
    const b = store.bookings.get(a.case);
    if (!acts || !b) return { ok: false, note: "failed" };
    const ofRefund = (r: RefundResult | "owed"): Executed => (r === "owed" ? { ok: true, note: "owed_by_owner" } : r === "done" ? { ok: true, note: "done" } : r === "held" ? { ok: true, note: "held_by_guard" } : { ok: false, note: "failed" });
    if (a.kind === "answer") {
      const item = waitingOn(b).find((i) => i.kind === a.fields.itemKind);
      if (!item) return { ok: false, note: "failed" };
      const no = a.fields.answer === "no";
      // The same reply the owner could give: typed for the agent's own asks, the mark's button (with its code) for a UPI mark.
      await acts.answer(ownerReply(acts.owner, deps.nowMs(), b.id, typeof item.reply === "string" ? { text: `${no && item.no ? item.no : item.reply} ${b.id}` } : { buttonId: item.reply.id }));
      return { ok: true, note: "done" };
    }
    if (a.kind === "cancel") {
      if (b.state === "awaiting_deposit") { await acts.cancelWaiting(b, "cancelled by the owner through the shop's assistant"); await acts.tellCancelled(b); return { ok: true, note: "done" }; }
      return ofRefund(await acts.cancelPaid(b, Number(a.fields.amountPaise) / 100, "cancelled by the owner through the shop's assistant"));
    }
    if (a.kind === "refund") return ofRefund(await acts.refund(b, String(a.fields.paymentId), Number(a.fields.amountPaise) / 100, "refunded by the owner through the shop's assistant"));
    return { ok: false, note: "failed" };
  }

  return {
    name: "bookings",
    routing: {
      refs: /^b-\d{1,6}$/u,
      buttonPrefixes: ["svc:", "slot:", "yes", "no", "cancel", "keep", "owner", "menu", "paid"],
      words: ROUTING_WORDS,
      liveCaseOf: (phone) => latestBooking(store, phone, LIVE_STATES)?.id,
    },
    day(date) {
      const rows: DayRow[] = [];
      for (const b of store.bookings.values()) {
        if ((b.state !== "confirmed" && b.state !== "needs_owner") || !onDate(b, date)) continue;
        const service = settings.services.find((s) => s.id === b.serviceId);
        rows.push({ case: b.id, startMs: b.startMs!, what: service ? serviceName(service, lang) : "", who: whoOf(b), state: b.state });
      }
      return rows.sort((x, y) => x.startMs - y.startMs);
    },
    waiting: () => [...store.bookings.values()].flatMap((b) => waitingOn(b).map(({ fields: _f, reply: _r, ...item }) => item)),
    problems: () => [...store.bookings.values()].reduce((n, b) => n + (b.refundIssues ?? []).length, 0),
    hours: (date) => hoursOn(settings, weekdayOf(date)),
    async closeDay(date, notify: DayNotice) {
      const booked: { case: string; who: string }[] = [];
      const told: string[] = [];
      for (const b of store.bookings.values()) {
        if (!COMING.includes(b.state) || !onDate(b, date)) continue;
        booked.push({ case: b.id, who: whoOf(b) }); // every booking that day, told or not: the owner calls the ones the message could not reach
        if (!deps.optedOut(b.customer) && (await notify({ case: b.id, phone: b.customer, startMs: b.startMs! }))) told.push(b.id);
      }
      return { booked, told };
    },
    async reopenDay(date, asked, notify: DayNotice) {
      const told: string[] = [];
      for (const id of asked) {
        const b = store.bookings.get(id);
        // only those still on that day and still coming: one who moved or cancelled has their own news already
        if (!b || !COMING.includes(b.state) || !onDate(b, date) || deps.optedOut(b.customer)) continue;
        if (await notify({ case: b.id, phone: b.customer, startMs: b.startMs! })) told.push(b.id);
      }
      return { told };
    },
    moveTarget(caseId, to) {
      const b = store.bookings.get(caseId);
      if (!b) return { ok: false, why: "no_case" };
      if (b.state !== "confirmed" || b.startMs === undefined) return { ok: false, why: "not_live" };
      const was = localParts(b.startMs, tz);
      const date = to.date ?? { year: was.year, month: was.month, day: was.day };
      const time = to.time ? resolveTime(to.time, hoursOn(settings, weekdayOf(date))).time : { hour: was.hour, minute: was.minute };
      return { ok: true, startMs: zonedToMs(date, time, tz) };
    },
    async move(caseId, startMs) {
      const acts = deps.acts;
      const b = store.bookings.get(caseId);
      if (!acts || !b) return { ok: false, why: "no_case" };
      if (b.state !== "confirmed" || b.startMs === undefined || b.endMs === undefined) return { ok: false, why: "not_live" };
      const fromMs = b.startMs;
      const endMs = startMs + (b.endMs - b.startMs);
      if (startMs <= deps.nowMs()) return { ok: false, why: "past" };
      // checked first without a word to anyone, so a time that cannot be had never reaches the customer as "that time is not free"
      const { hours, clash } = await acts.slotRules(b, startMs, endMs);
      if (hours.verdict === "block") return { ok: false, why: "outside_hours" };
      if (clash.verdict === "block") return { ok: false, why: "taken" };
      await acts.applyMove(b, startMs, endMs);
      return b.startMs === startMs ? { ok: true, fromMs, toMs: startMs } : { ok: false, why: "failed" };
    },
    prepare,
    execute,
  };
}
