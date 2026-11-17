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
import { checkWords, ownerReply, prepareGuestMessage } from "../../../../modules/assistant/wire.ts";
import type { DayNotice, DayRow, Executed, OwnerSkill, Prepared, Proposal, WaitingItem } from "../../../../modules/assistant/skill.ts";
import type { CardAction } from "../../../../modules/assistant/state.ts";
import { markButtonId } from "../../../../modules/payments/owner-marked/owner.ts";
import type { InboundMessage } from "../../../../modules/messaging/messaging.ts";
import type { RecordEntry } from "../../../../modules/record/record.ts";
import type { RefundResult } from "../../../../modules/payments/refunds.ts";
import { LIVE_STATES, latestBooking } from "./booking.ts";
import type { Booking, Store } from "./booking.ts";
import { WEEKDAY_KEYS, hoursOn, serviceName } from "./settings.ts";
import { ownerItems } from "./channel.ts";
import type { OwnerItem } from "./channel.ts";
import type { Settings } from "./settings.ts";
import { formatInr, formatSlot } from "../../../../modules/language/format.ts";
import type { PublicContext, TalkSource } from "../../../../modules/assistant/talk-types.ts";
import { guestLabel } from "../../../../modules/channels/chat-guest.ts";
import { isChatConversation } from "../../../../modules/channels/conversation.ts";
import { isClosedDay } from "../../../../modules/assistant/conversation.ts";

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


const DAY_MS = 86_400_000;
const WEEKDAY_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** What a customer is told about their own booking, in words that state how things stand and do not say that something was done (the talk may not say "booked" or "confirmed"). */
const STATE_WORDS: Partial<Record<Booking["state"], string>> = {
  enquiry: "still being arranged, no time agreed yet", confirming_details: "waiting for the customer's yes to the time", awaiting_deposit: "waiting for the deposit to hold the time", needs_owner: "waiting for the owner to look at it",
  confirmed: "in the shop's book for that time",
};

/**
 * The reads the shop's talk rests on (block M), kept with the other reads: pure over the store, no customer's name or number in what the OWNER's talk gets (counts only), and in
 * what a CUSTOMER's talk gets only the shop's public settings, free times from the shop's own bookings, and that customer's own live booking.
 */
function talkReads(deps: BookingsSkillDeps, whoOf: (b: Booking) => string): Pick<OwnerSkill, "facts" | "publicContext"> {
  const { settings, store } = deps;
  const tz = settings.timezone;
  const lang = settings.owner.language;
  const stands = (b: Booking) => b.state === "confirmed" || b.state === "needs_owner" || b.state === "completed";
  return {
    facts(nowMs) {
      const out: TalkSource[] = [];
      const start = zonedToMs(localParts(nowMs, tz), { hour: 0, minute: 0 }, tz);
      const inDay = (b: Booking, from: number, to: number) => b.startMs !== undefined && b.startMs >= from && b.startMs < to;
      const all = [...store.bookings.values()];
      const today = all.filter((b) => stands(b) && inDay(b, start, start + DAY_MS));
      out.push({ id: "r:today", kind: "record", text: `Bookings today: ${today.length}${today[0]?.startMs !== undefined ? `, the first at ${formatSlot(Math.min(...today.map((b) => b.startMs!)), tz, lang)}` : ""}.`, momentsMs: today.map((b) => b.startMs!) });
      const week = (from: number, to: number) => all.filter((b) => stands(b) && inDay(b, from, to)).length;
      out.push({ id: "r:week", kind: "record", text: `Bookings in the last 7 days: ${week(start - 7 * DAY_MS, start)}. In the next 7 days: ${week(start, start + 7 * DAY_MS)}.` });
      const weekdays = new Array<number>(7).fill(0);
      for (const b of all) if (stands(b) && b.startMs !== undefined && b.startMs >= start - 28 * DAY_MS && b.startMs < start) weekdays[weekdayOf(localParts(b.startMs, tz))] += 1;
      out.push({ id: "r:weekdays", kind: "record", text: `Bookings by weekday over the last 28 days: ${WEEKDAY_EN.map((d, i) => `${d} ${weekdays[i]}`).join(", ")}.` });
      const bySvc = new Map<string, number>();
      for (const b of all) if (stands(b) && b.serviceId && b.startMs !== undefined && b.startMs >= start - 28 * DAY_MS) bySvc.set(b.serviceId, (bySvc.get(b.serviceId) ?? 0) + 1);
      const top = [...bySvc.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([id, n]) => ({ name: serviceName(settings.services.find((v) => v.id === id) ?? { id, names: {}, priceInr: 0, durationMinutes: 0 }, lang), n }));
      out.push({ id: "r:top", kind: "record", text: top.length ? `Top services over the last 28 days: ${top.map((t) => `${t.name} ${t.n}`).join(", ")}.` : "No bookings in the last 28 days.", literals: top.map((t) => t.name) });
      out.push({ id: "r:cancelled", kind: "record", text: `Cancelled bookings over the last 28 days: ${all.filter((b) => b.state === "cancelled" && b.startMs !== undefined && b.startMs >= start - 28 * DAY_MS).length}. Waiting for the owner now: ${all.filter((b) => b.state === "needs_owner").length}.` });
      return out;
    },
    publicContext(phone, nowMs) {
      const language = store.customers.get(phone)?.language ?? settings.languages[0] ?? lang;
      const sources: TalkSource[] = [{ id: "s:shop", kind: "setting", text: `${settings.name}${settings.address ? `, ${settings.address}` : ""}. Bookings are made on WhatsApp.`, literals: [settings.name, ...(settings.address ? [settings.address] : [])] }];
      for (const svc of settings.services) { const name = serviceName(svc, language); sources.push({ id: `s:svc:${svc.id}`, kind: "setting", text: `${name}: ${formatInr(svc.priceInr)}, ${svc.durationMinutes} minutes.`, amountsInr: [svc.priceInr], literals: [name] }); }
      const hours = WEEKDAY_KEYS.map((k, i) => { const h = settings.openingHours[k]; return `${WEEKDAY_EN[i]} ${h ? `${h.open} to ${h.close}` : "closed"}`; });
      sources.push({ id: "s:hours", kind: "setting", text: `Opening hours: ${hours.join(", ")}.` });
      sources.push({ id: "s:deposit", kind: "setting", text: `A deposit of ${formatInr(settings.deposit.amountInr)} holds a time for ${settings.deposit.holdMinutes} minutes. The deposit is refundable if the booking is cancelled at least ${settings.cancellation.windowHours} hours before it; later, the owner decides.`, amountsInr: [settings.deposit.amountInr] });
      // the next free times, from the shop's own bookings (the same list the agent's own free-time finder reads), a few days ahead
      const minutes = Math.min(...settings.services.map((v) => v.durationMinutes));
      const busy = [...store.bookings.values()].filter((b) => ["awaiting_deposit", "needs_owner", "confirmed"].includes(b.state) && b.startMs !== undefined && b.endMs !== undefined).map((b) => [b.startMs!, b.endMs! + settings.bufferMinutes * 60_000] as const);
      const free: number[] = [];
      for (let d = 0; d < 4 && free.length < 6; d++) {
        const date = addDays(localParts(nowMs, tz), d);
        const h = hoursOn(settings, weekdayOf(date));
        if (!h || isClosedDay(store.assistant, date)) continue;
        for (let m = h.open; m + minutes <= h.close && free.length < 6; m += settings.slotMinutes) {
          const at = zonedToMs(date, { hour: Math.floor(m / 60), minute: m % 60 }, tz);
          if (at <= nowMs + 30 * 60_000 || busy.some(([a, z]) => at < z && at + minutes * 60_000 > a)) continue;
          free.push(at);
        }
      }
      sources.push({ id: "r:free", kind: "record", text: free.length ? `Next free times: ${free.map((ms) => formatSlot(ms, tz, language)).join("; ")}.` : "No free time in the next few days.", momentsMs: free });
      const mine = latestBooking(store, phone, LIVE_STATES);
      if (mine) {
        const svc = settings.services.find((v) => v.id === mine.serviceId);
        sources.push({ id: "r:case", kind: "record", text: `This customer's own booking ${mine.id}: ${svc ? serviceName(svc, language) : "a service"}${mine.startMs !== undefined ? `, ${formatSlot(mine.startMs, tz, language)}` : ""}, ${STATE_WORDS[mine.state] ?? mine.state}.`, literals: [mine.id, ...(svc ? [serviceName(svc, language)] : [])], ...(mine.startMs !== undefined ? { momentsMs: [mine.startMs] } : {}) });
      }
      void whoOf;
      return { sources, links: [] } satisfies PublicContext;
    },
  };
}

export function bookingsSkill(deps: BookingsSkillDeps): OwnerSkill {
  const { settings, store } = deps;
  const tz = settings.timezone;
  const lang = settings.owner.language;
  // a chat guest is "Chat guest 3" in the owner's cards and lists (chat-guest.ts), never "chat:..."
  const whoOf = (b: Booking): string => (b as Booking & { contact?: { name?: string } }).contact?.name ?? (isChatConversation(b.customer) ? guestLabel(store.channel, b.customer, lang) : b.customer);
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

  /**
   * What waits for the owner, as a card can show it (and the fields its digest is over). Read from the owner page's own list (channel.ts ownerItems, integration of
   * items 11d and 11e), so "what needs me", the morning line's count, the mood and the owner's page always show the same things. The card's fields carry the page
   * item's digest, which covers exactly what is shown (the amount, the marks made, the codes used): a change there changes the card's digest, so a card made before
   * a part was marked is void on its tap, as on the page.
   */
  type Waiting = WaitingItem & { fields: Record<string, string | number | boolean>; reply: { id: string } | string };
  const ANSWERS: Record<OwnerItem["kind"], { yes: string; no?: string }> = { late_refund: { yes: "approve", no: "deny" }, calendar: { yes: "retry" }, deposit: { yes: "received" }, late_deposit: { yes: "received" }, refund_owed: { yes: "refunded" } };
  // late_deposit (a hold that ended where money may have come anyway, channel.ts ownerItems) is answered with the same "received" mark and its one-use code. It was
  // missing here until 17 Nov 2026, so "what needs me" threw as soon as one was listed with the assistant on (found while finishing Orders, which had the same item).
  function waitingNow(): Waiting[] {
    return ownerItems(settings, store, deps.nowMs()).items.map((i): Waiting => {
      const b = store.bookings.get(i.case);
      const a = ANSWERS[i.kind];
      // a UPI mark is the same button the owner's WhatsApp message carries (with its one-use code); the agent's own asks are the typed "approve b-3" and the like
      const reply = i.code && (i.kind === "deposit" || i.kind === "late_deposit" || i.kind === "refund_owed") ? { id: markButtonId(i.kind === "refund_owed" ? "refunded" : "received", i.code) } : a.yes;
      return {
        case: i.case, kind: i.kind === "late_deposit" ? "deposit" : i.kind, amountPaise: i.amountPaise, who: b ? whoOf(b) : i.customer.name ?? i.customer.phone, what: b ? what(b) : "", money: true,
        yes: a.yes, ...(a.no ? { no: a.no } : {}), fields: { pageDigest: i.digest, amountPaise: i.amountPaise }, reply,
      };
    });
  }
  const waitingOn = (b: Booking): Waiting[] => waitingNow().filter((i) => i.case === b.id);

  const action = (kind: string, b: Booking, fields: CardAction["fields"]): CardAction => ({ kind, skill: "bookings", case: b.id, fields: { who: whoOf(b), ...fields } });

  function prepare(p: Proposal): Prepared {
    const guest = prepareGuestMessage(p, { skill: "bookings", channel: store.channel, language: lang, optedOut: deps.optedOut }); // a chat guest ("g-3") has no case: only a message to them
    if (guest) return guest;
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
      refs: /^[bg]-\d{1,6}$/u,
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
    waiting: () => waitingNow().map(({ fields: _f, reply: _r, ...item }) => item),
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
    ...talkReads(deps, whoOf),
    prepare,
    execute,
  };
}
