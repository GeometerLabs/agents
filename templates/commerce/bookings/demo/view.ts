// What the page shows, worked out from the world: the owner's plain-language summary and the action record in plain words.
// Every line here is counted from the stand-ins' own records and the agent's action record, never from message text.
import { formatInr, formatSlot } from "../../../../modules/language/format.ts";
import { LANGUAGES } from "../../../../modules/language/languages.ts";
import type { Language } from "../../../../modules/language/languages.ts";
import type { Outcome, RecordEntry, Verdict } from "../../../../modules/record/record.ts";
import { languageOptions, formFromSettings } from "./personalise.ts";
import type { ShopForm } from "./personalise.ts";
import { labelsOf } from "./strings.ts";
import type { Demo } from "./session.ts";

const fmtLanguage = (language: string): Language => ((LANGUAGES as readonly string[]).includes(language) ? language : "en") as Language;

export interface SummaryLine { kind: "ok" | "info" | "warn" | "muted"; text: string }
export interface WaitingCard { ref: string; title: string; detail: string; reason: string; buttons: { command: "approve" | "deny" | "retry"; label: string }[] }
export interface RecordRow {
  seq: number; time: string; who: string; action: string; outcome: Outcome; outcomeText: string; booking: string | null; notes: string;
  decisions: { rule: string; verdict: Verdict; reason: string }[];
  refs: [string, string][];
}

// ---- the owner's summary -----------------------------------------------------------------------------------------------

/** The mom test: outcomes only, in the shop's language, nothing to open. Built from the fakes and the record. */
export function summaryLines(demo: Demo): SummaryLine[] {
  const { world, settings, ui } = demo;
  const entries = world.record.entries();
  const lines: SummaryLine[] = [];
  const sentMessages = new Set(world.messaging.outbox().map((m) => m.id));
  const links = world.payments.links();
  const events = world.calendar.events();

  // 1. Every booking it told a customer about is on the calendar's own list, and the payment record has the deposit.
  const told = new Set<string>();
  for (const e of entries) {
    if (e.action === "send_message" && e.outcome === "confirmed" && e.booking && (e.refs.templates ?? "").split("+").includes("booked") && sentMessages.has(e.refs.messageId)) told.add(e.booking);
  }
  const live = [...told].map((id) => world.store.bookings.get(id)).filter((b) => b && (b.state === "confirmed" || b.state === "completed"));
  const checked = live.filter((b) => b
    && events.some((ev) => ev.bookingRef === b.id && ev.status === "confirmed" && ev.start === b.startMs)
    && (links.find((l) => l.reference_id === b.id)?.payments.length ?? 0) > 0);
  if (live.length > 0 && checked.length === live.length) lines.push({ kind: "ok", text: ui.bookingsOk(live.length) });
  else if (live.length > 0) lines.push({ kind: "warn", text: ui.bookingsMissing(checked.length, live.length) });
  // A booking it told a customer about that was cancelled since: it must be off the calendar's own list too.
  const gone = [...told].filter((id) => !live.some((b) => b?.id === id));
  const stillThere = gone.filter((id) => events.some((ev) => ev.bookingRef === id && ev.status === "confirmed"));
  if (gone.length > 0 && stillThere.length === 0) lines.push({ kind: "ok", text: ui.bookingsCancelled(gone.length) });
  else if (stillThere.length > 0) lines.push({ kind: "warn", text: ui.bookingsCancelledStill(stillThere.length) });
  if (told.size === 0) lines.push({ kind: "info", text: ui.bookingsNone });

  // 2. Deposits, from the payments record: what came in, what went back, what is kept.
  const payments = links.flatMap((l) => l.payments);
  const collectedPaise = payments.reduce((sum, p) => sum + p.amount, 0);
  const returnedPaise = payments.reduce((sum, p) => sum + p.amount_refunded, 0);
  const inr = (paise: number) => formatInr(paise / 100);
  if (payments.length === 0) lines.push({ kind: "info", text: ui.depositsNone });
  else if (returnedPaise === 0) lines.push({ kind: "ok", text: ui.deposits(inr(collectedPaise)) });
  else lines.push({ kind: "ok", text: ui.depositsReturned(inr(collectedPaise), inr(returnedPaise), inr(collectedPaise - returnedPaise)) });

  // 3. Discounts it refused: a price-list block that was shown to a customer.
  const sent = entries.filter((e) => e.action === "send_message");
  const offers = sent.flatMap((e) => e.decisions.filter((d) => d.ruleId === "price-at-or-above-list" && d.verdict === "block")
    .map((d) => Number((/^₹([\d,]+)/.exec(d.reason)?.[1] ?? "").replace(/,/g, ""))).filter((n) => Number.isFinite(n) && n > 0));
  lines.push(offers.length > 0 ? { kind: "ok", text: ui.discountRefused(offers) } : { kind: "info", text: ui.discountNone });

  // 4. Requests outside opening hours it turned down.
  const outside = sent.filter((e) => e.decisions.some((d) => d.ruleId === "within-hours" && d.verdict === "block")).length;
  if (outside > 0) lines.push({ kind: "ok", text: ui.outsideHours(outside) });

  // 5. Money given back: what it asked about, what it did alone, what was paid twice.
  const asked = entries.filter((e) => e.action === "refund" && e.outcome === "held_for_owner");
  const askedBookings = new Set(asked.map((e) => e.booking));
  const owner = (paymentId: string) => links.find((l) => l.payments.some((p) => p.id === paymentId));
  let autoPaise = 0;
  let extraPaise = 0;
  for (const r of world.payments.refunds()) {
    const link = owner(r.payment_id);
    const booking = link ? world.store.bookings.get(link.reference_id) : undefined;
    if (!booking || askedBookings.has(booking.id)) continue;
    if (booking.depositPaymentId === r.payment_id) autoPaise += r.amount;
    else extraPaise += r.amount;
  }
  if (asked.length > 0) lines.push({ kind: "ok", text: ui.refundAsked(asked.length) });
  else lines.push({ kind: "info", text: ui.refundRule(formatInr(settings.cancellation.refundLimitInr)) });
  if (autoPaise > 0) lines.push({ kind: "ok", text: ui.refundAuto(formatInr(autoPaise / 100), formatInr(settings.cancellation.refundLimitInr)) });
  if (extraPaise > 0) lines.push({ kind: "ok", text: ui.paidTwice(formatInr(extraPaise / 100)) });

  lines.push({ kind: "muted", text: ui.notChecked });
  lines.push({ kind: "muted", text: ui.demoNote });
  return lines;
}

/** What is waiting for the owner's answer, with the buttons that send the owner's command to the agent. */
export function waitingCards(demo: Demo): WaitingCard[] {
  const { world, settings, ui } = demo;
  const when = (ms: number | undefined) => (ms === undefined ? "" : formatSlot(ms, settings.timezone, fmtLanguage(demo.uiLanguage)));
  const cards: WaitingCard[] = [];
  for (const b of world.store.bookings.values()) {
    const pending = b.pending[0]; // the agent answers the first thing waiting on a booking
    if (!pending) continue;
    const service = settings.services.find((s) => s.id === b.serviceId);
    const detail = [service?.names[demo.uiLanguage as Language]?.[0] ?? service?.names.en?.[0] ?? "", when(b.startMs), b.customer].filter(Boolean).join(" · ");
    if (pending.kind === "calendar") {
      cards.push({ ref: b.id, title: ui.askCalendar, detail, reason: "", buttons: [{ command: "retry", label: ui.retry }, { command: "approve", label: ui.cancelAndRefund }] });
    } else if (pending.kind === "refund") {
      // Only a late cancellation within the limit is the agent's own question. A refund above the limit is Guard's: the approvals relay asks the owner
      // by WhatsApp with a code, so there is no card for it (the demo's limit is never below the deposit, so it does not come up here).
      const reason = ui.reasonLate(settings.cancellation.windowHours);
      cards.push({ ref: b.id, title: ui.askRefund(formatInr(pending.amountInr)), detail, reason, buttons: [{ command: "approve", label: ui.approve }, { command: "deny", label: ui.deny }] });
    }
  }
  return cards;
}

// ---- the record, in plain words (the "Show what we did" layer; English, for the person showing the demo) ----------------

const ACTION_WORDS: Record<RecordEntry["action"], string> = {
  receive_message: "Customer message received (kept as a fingerprint only)", receive_payment_event: "Payment notice received",
  send_message: "Message sent", ask_owner: "Asked the owner", opt_out: "Customer opted out (STOP)", owner_decision: "Owner's answer",
  hold_slot: "Held the slot in the calendar", release_slot: "Released the slot", create_deposit_link: "Made the deposit link",
  cancel_deposit_link: "Closed the deposit link", record_deposit: "Recorded the deposit", confirm_booking: "Confirmed the booking in the calendar",
  reschedule_booking: "Moved the booking", cancel_booking: "Cancelled the booking", complete_booking: "Marked the booking done", refund: "Refunded the deposit",
  voice_note_reply: "Answered a voice note (asked the customer to type)",
  ai_mode: "Moved to buttons and lists, with no AI",
};
/** The other `ai_mode` lines: a step of the AI that kept failing is left out for a while, and is asked again; the month's AI cap leaves the language model out. The shop stays in AI mode. */
const STEP_WORDS = { step_paused: "Left out a failing step of the AI for a while", step_resumed: "Asked that step of the AI again", model_off: "Left out the language model for the rest of the month (the AI cap)" } as const;
const OUTCOME_WORDS: Record<Outcome, string> = {
  confirmed: "confirmed (read back from the service's own record)", attempted: "tried (checked in the next step)", unconfirmed: "NOT confirmed",
  failed: "failed", blocked: "stopped", held_for_owner: "waiting for the owner",
};
const RULE_WORDS: Record<string, string> = {
  "price-at-or-above-list": "Price list", "within-hours": "Opening hours", "no-double-booking": "One customer per slot", "confirm-only-when-recorded": "Say booked only when recorded",
  "one-deposit-per-booking": "One deposit per booking", "refund-limit": "Refund limit", "no-message-after-stop": "No message after cancel or STOP",
  "message-matches-record": "Message matches the record", "opt-out": "STOP is final",
};

export function recordRows(demo: Demo, limit = 250): RecordRow[] {
  const { world, settings } = demo;
  return world.record.entries().slice(-limit).reverse().map((e) => ({
    seq: e.seq,
    time: formatSlot(Date.parse(e.time), settings.timezone, "en"),
    who: e.action === "receive_payment_event" ? "Payments" : e.conversation === world.owner ? "Owner" : "Customer",
    action: e.action === "ai_mode" && Object.hasOwn(STEP_WORDS, e.refs.mode ?? "") ? STEP_WORDS[e.refs.mode as keyof typeof STEP_WORDS] : ACTION_WORDS[e.action] ?? e.action,
    outcome: e.outcome,
    outcomeText: OUTCOME_WORDS[e.outcome],
    booking: e.booking,
    notes: e.notes,
    decisions: e.decisions.map((d) => ({ rule: RULE_WORDS[d.ruleId] ?? d.ruleId, verdict: d.verdict, reason: d.reason })),
    refs: Object.entries(e.refs),
  }));
}

export function workDone(demo: Demo): string {
  const entries = demo.world.record.entries();
  const count = (outcome: Outcome) => entries.filter((e) => e.outcome === outcome).length;
  const stopped = entries.filter((e) => e.decisions.some((d) => d.verdict === "block" && d.ruleId !== "opt-out") || e.outcome === "blocked").length;
  return `Work done for you: ${entries.length} actions recorded. ${count("confirmed")} confirmed against the services' own records, `
    + `${stopped} touched by a rule that said no, ${count("held_for_owner")} held for the owner. Test money only; nothing real was contacted.`;
}

/** What the stand-in services hold right now: the evidence the summary is counted from. */
export function fakesView(demo: Demo) {
  const { world, settings } = demo;
  const at = (ms: number) => formatSlot(ms, settings.timezone, "en");
  return {
    calendar: world.calendar.events().map((e) => ({ id: e.id, bookingRef: e.bookingRef, status: e.status, start: at(e.start), end: at(e.end) })),
    payments: world.payments.links().map((l) => ({
      id: l.id, bookingRef: l.reference_id, amountInr: l.amount / 100, status: l.status,
      paid: l.payments.map((p) => ({ id: p.id, amountInr: p.amount / 100, refundedInr: p.amount_refunded / 100 })),
    })),
    refunds: world.payments.refunds().map((r) => ({ id: r.id, paymentId: r.payment_id, amountInr: r.amount / 100 })),
    messages: { toCustomer: demo.customerLog.filter((b) => b.who === "agent").length, toOwner: demo.ownerLog.filter((b) => b.who === "agent").length },
  };
}

// ---- the whole screen ----------------------------------------------------------------------------------------------------

export interface DemoState {
  shop: { name: string; language: string; depositInr: number; refundLimitInr: number; windowHours: number; services: { name: string; priceInr: number }[] };
  ui: Record<string, string | string[]>;
  clock: string;
  customer: { messages: DemoBubble[]; canPay: boolean; canPayTwice: boolean; canCancel: boolean; payLabel: string; chips: string[] };
  owner: { messages: DemoBubble[]; waiting: WaitingCard[]; summary: SummaryLine[] };
  record: { workDone: string; rows: RecordRow[]; fakes: ReturnType<typeof fakesView> };
  form: ShopForm;
  languages: { code: string; label: string }[];
  notice?: string;
}
type DemoBubble = Demo["customerLog"][number];

export function buildState(demo: Demo, notice?: string): DemoState {
  const { settings, ui, world } = demo;
  const target = demo.payTarget();
  const state: DemoState = {
    shop: {
      name: settings.name, language: demo.uiLanguage, depositInr: settings.deposit.amountInr, refundLimitInr: settings.cancellation.refundLimitInr,
      windowHours: settings.cancellation.windowHours,
      services: settings.services.map((s) => ({ name: s.names[demo.uiLanguage as Language]?.[0] ?? s.names.en?.[0] ?? s.id, priceInr: s.priceInr })),
    },
    ui: labelsOf(ui),
    clock: formatSlot(world.clock.now(), settings.timezone, fmtLanguage(demo.uiLanguage)),
    customer: {
      messages: demo.customerLog, canPay: target?.mode === "first", canPayTwice: target !== undefined, canCancel: demo.canCancel(),
      payLabel: ui.payButton(formatInr(settings.deposit.amountInr)), chips: demo.chips().map((c) => c.text),
    },
    owner: { messages: demo.ownerLog, waiting: waitingCards(demo), summary: summaryLines(demo) },
    record: { workDone: workDone(demo), rows: recordRows(demo), fakes: fakesView(demo) },
    form: formFromSettings(settings),
    languages: languageOptions(),
  };
  if (notice) state.notice = notice;
  return state;
}
