// What the agent does about monthly plans (17 Nov 2026), kept out of agent.ts: the customer's words (subscribe, skip, pause, resume, cancel), the payment of each period, the
// meals going out, the renewal and the credits. The agent hands in what is its own (saying, the record, the payment link, the refund paths) as `env`, and calls the few hooks
// this returns; a shop without a `plans` block never makes one, so the agent is exactly as it was.
//
// The shape of it. A plan's period is paid like an order's advance: it is an Order record with `plan` set (no day, no items), so the payment link, the owner's UPI mark, a
// payment matched to it, a second payment refunded and a late one owed back are the agent's own paths and none is written again. The meals are not orders: each is a day in
// the period's ledger (ledger.ts, the one source), counted against the slot's capacity through `ordersInSlot`. Money moves only in the agent's own paths and only up to what a
// period was paid: a credit is settled once, as carried (taken off a later payment) or refunded, and a cancelled plan refunds what is unused. There is no automatic debit:
// a renewal is a payment link the customer pays, and one that is not paid before its first meal closes lapses without charge.
import { HOUR, addDays, localParts, parseClock, timeFromMinutes, zonedToMs } from "../../../../../modules/core/time.ts";
import type { LocalDate } from "../../../../../modules/core/time.ts";
import type { Clock } from "../../../../../modules/core/clock.ts";
import { resolveDate } from "../../../../../modules/language/dates.ts";
import type { DatePhrase } from "../../../../../modules/language/dates.ts";
import { formatInr } from "../../../../../modules/language/format.ts";
import type { Decision } from "../../../../../modules/limits/limits.ts";
import { hoursBefore, scheduleAround, takeDue } from "../../../../../modules/reminders/reminders.ts";
import { areaOf, checkDeliveryArea } from "../limits.ts";
import { moveTo, newDraft, ordersInSlot, register } from "../order.ts";
import type { Order, Store } from "../order.ts";
import { slotOf } from "../settings.ts";
import type { Settings } from "../settings.ts";
import type { MessageFacts } from "../language/templates.ts";
import { cancelPlan, checkOneRenewal, cutoffMsFor, deliverDue, newDays, pauseFrom, periodOfDay, planOfCustomer, plansOf, renewalDue, resumeFrom, returnBalance, settle, skipDay, takeBalance } from "./ledger.ts";
import type { Asked, Plan, PlanPeriod, PlanRules } from "./ledger.ts";
import { dateOfKey, firstMealOnOrAfter, keyOf } from "./periods.ts";
import { planName, planTypeOf } from "./settings.ts";
import type { PlanType } from "./settings.ts";
import { readPlanIntent, plansLine } from "./words.ts";
import type { PlanIntent } from "./words.ts";

/** What the agent hands in. Each is the agent's own function for the same thing; plans add no other way to speak, to ask for money or to move it. */
export interface PlansEnv {
  settings: Settings;
  store: Store;
  clock: Clock;
  takesNewWork(): boolean;
  /** A UPI shop: the customer pays the shop's own UPI ID and the owner marks it, so "I have paid" is offered as a button. */
  ownerConfirms: boolean;
  /** The record, as the agent writes it (`log`). */
  log(o: Order | null, phone: string, action: string, outcome: string, inputs: unknown, more?: { decisions?: Decision[]; notes?: string; refs?: Record<string, string> }): unknown;
  /** One message to the customer or the owner, from a template, with facts laid over the order's (`facts`) and the offers and pictures the agent's `say` takes. True when it went out. */
  tell(o: Order | null, phone: string, template: string, more?: Record<string, unknown>): Promise<boolean>;
  tellOwner(o: Order | null, phone: string, template: string, more?: Record<string, unknown>): Promise<boolean>;
  /** Make the period's payment link (and, on a UPI shop, its request and the owner's note). */
  askPayment(o: Order): Promise<"ok" | "failed" | "paused">;
  /** A UPI shop's QR picture for the period's request, if there is one. */
  qr(o: Order): Promise<unknown>;
  /** Look at the payment record again for the period's order (the agent's own `reconcilePayments`). */
  reconcile(o: Order): Promise<unknown>;
  /** Give up an order waiting for its payment, closing its link; a payment that landed just before is refunded or owed back. */
  cancelWaiting(o: Order, why: string): Promise<void>;
  /** Refund `amountInr` of the period's payment: the agent's own refund path (Guard holds it above the owner's limit; a UPI shop's owner owes it). */
  refund(o: Order, amountInr: number, why: string): Promise<unknown>;
  /** The money of a period that was earned, moved from "advance held" to the shop's, in the books. */
  applied(o: Order, amountInr: number): void;
}

export function createPlans(env: PlansEnv) {
  const { settings, store, clock } = env;
  const cfg = settings.plans!;
  const tz = settings.timezone;
  const state = () => (store.plans ??= { plans: {} });
  const typeOf = (plan: Plan): PlanType => planTypeOf(cfg, plan.typeId)!;
  const rulesOf = (plan: Plan): PlanRules => ({ timeZone: tz, cutoff: cfg.cutoff, weekdays: typeOf(plan).weekdays, credits: cfg.credits });
  const orderOf = (period: PlanPeriod): Order => store.orders.get(period.orderId)!;
  const at = (clockText: string, key: string): number => zonedToMs(dateOfKey(key), timeFromMinutes(parseClock(clockText)!), tz);
  const slotWindow = (plan: Plan, key: string) => { const s = slotOf(settings, plan.slotId)!.slot; return { fromMs: at(s.from, key), toMs: at(s.to, key) }; };
  const momentOf = (key: string): number => zonedToMs(dateOfKey(key), { hour: 0, minute: 0 }, tz);
  const nameOf = (plan: Plan): string => planName(typeOf(plan), plan.language);
  const mealsIn = (p: PlanPeriod): number => Object.keys(p.days).length;

  /** The facts a plan message lays over the order's own: the plan's name as "the items", the period's meals and ends, the amounts and who it is for. */
  function facts(plan: Plan, period?: PlanPeriod, extra: Partial<MessageFacts> = {}): Partial<MessageFacts> {
    return {
      itemsText: nameOf(plan), orderRef: plan.id, mode: plan.mode, ...(plan.area ? { area: plan.area } : {}), ...(plan.address ? { address: plan.address } : {}),
      ...(period ? { plan: { meals: mealsIn(period), fromMs: momentOf(period.from), toMs: momentOf(period.to) }, totalInr: period.priceInr, advanceInr: period.dueInr, ...(period.orderId ? { link: orderOf(period)?.linkUrl } : {}) } : {}),
      ...extra,
    };
  }
  /** Before the plan has a period (a quick refusal): the plan's name only, and the day if there is one. */
  const dayFacts = (plan: Plan, key: string, extra: Partial<MessageFacts> = {}) => facts(plan, undefined, { dateMs: momentOf(key), ...extra });
  const say = (plan: Plan, template: string, f: Partial<MessageFacts>, more: Record<string, unknown> = {}, o: Order | null = null) => env.tell(o, plan.customer, template, { facts: f, ...more });
  const logPlan = (plan: Plan, action: string, outcome: string, inputs: unknown, more: { decisions?: Decision[]; notes?: string; refs?: Record<string, string> } = {}) =>
    env.log(null, plan.customer, action, outcome, inputs, { ...more, refs: { plan: plan.id, ...(more.refs ?? {}) } });

  /** The order waiting for a plan period's payment, for a customer who says they paid (the agent's `latestOrder` leaves plan orders out). */
  function awaitingOrderOf(phone: string): Order | undefined {
    for (const plan of plansOf(store.plans).reverse()) if (plan.customer === phone) for (const p of [...plan.periods].reverse()) if (p.state === "awaiting_payment") { const o = orderOf(p); if (o?.state === "awaiting_advance") return o; }
    return undefined;
  }

  // ---- a new plan ------------------------------------------------------------------------------------------------------------

  async function subscribe(phone: string, language: Order["language"], typeId: string | undefined): Promise<void> {
    if (!env.takesNewWork()) { env.log(null, phone, "new_work", "blocked", { asked: "plan" }, { notes: "online ordering is paused, so no plan is started" }); await env.tell(null, phone, "orders_paused"); return; }
    const existing = planOfCustomer(state(), phone);
    if (existing) { await myPlan(existing); return; }
    const type = typeId ? planTypeOf(cfg, typeId) : cfg.types.length === 1 ? cfg.types[0] : undefined;
    if (!type) { await env.tell(null, phone, "plan_choose", { facts: { itemsText: plansLine(cfg.types, language, formatInr) } }); return; }
    const slot = slotOf(settings, type.slotId)!;
    const plan: Plan = { id: "", customer: phone, language, typeId: type.id, slotId: type.slotId, mode: slot.mode, state: "awaiting_address", startKey: "", periods: [], pauses: [], balance: [], askedAtMs: clock.now() };
    if (slot.mode === "delivery") { state().plans[`pending:${phone}`] = plan; await env.tell(null, phone, "ask_address", { areas: true, facts: { itemsText: planName(type, language) } }); return; }
    await begin(plan);
  }

  /** The customer's next plain message to a delivery plan is its address, checked against the delivery list like an order's. */
  async function onAddress(plan: Plan, text: string): Promise<void> {
    const address = text.replace(/[\u0000-\u001f\u007f]+/gu, " ").replace(/\s+/gu, " ").trim().slice(0, 120);
    const decision = checkDeliveryArea({ address, area: settings.delivery?.area ?? [] });
    if (decision.verdict === "block") { env.log(null, plan.customer, "check_address", "blocked", { area: null }, { decisions: [decision], notes: "the address names no place on the delivery list; it is not kept" }); await env.tell(null, plan.customer, "outside_area", { areas: true }); return; }
    plan.area = areaOf(address, settings.delivery!.area)!;
    plan.address = address;
    env.log(null, plan.customer, "check_address", "confirmed", { area: plan.area }, { decisions: [decision], notes: "the address names a place on the delivery list" });
    delete state().plans[`pending:${plan.customer}`];
    await begin(plan);
  }

  /** The first period: the first meal day whose cut-off is still ahead, every meal day of the month fits the slot, then the payment link. Nothing is made if the slot is full. */
  async function begin(plan: Plan): Promise<void> {
    const now = clock.now();
    const rules = rulesOf(plan);
    let start: LocalDate = firstMealOnOrAfter(localParts(now, tz), rules.weekdays);
    for (let i = 0; i < 14 && now >= cutoffMsFor(rules, keyOf(start)); i++) start = firstMealOnOrAfter(addDays(start, 1), rules.weekdays);
    plan.startKey = keyOf(start);
    const made = newDays(plan, rules.weekdays, start, 0);
    const max = slotOf(settings, plan.slotId)!.slot.maxOrders;
    const full = max !== undefined && Object.keys(made.days).some((key) => ordersInSlot(store, dateOfKey(key), plan.slotId, now) >= max);
    if (full) {
      env.log(null, plan.customer, "plan_start", "blocked", { type: plan.typeId }, { decisions: [{ ruleId: "within-day-cap", verdict: "block", reason: "a day of the plan's first month has no place left in the slot (the slot's own most orders, plan meals counted)" }] });
      await env.tell(null, plan.customer, "plan_full", { facts: { itemsText: nameOf(plan) } });
      return;
    }
    const type = typeOf(plan);
    const o = register(store, newDraft(plan.customer, plan.language));
    plan.id = `p-${o.id.slice(2)}`;
    const period: PlanPeriod = { index: 0, from: made.from, to: made.to, priceInr: type.priceInr, dueInr: type.priceInr, taken: [], orderId: o.id, days: made.days, state: "awaiting_payment", holdUntilMs: now + settings.advance.holdMinutes * 60_000 };
    plan.periods.push(period);
    state().plans[plan.id] = plan;
    attach(o, plan, period);
    plan.state = "active"; // nothing is owed or delivered until the first payment is recorded: the period is "awaiting_payment" and holds its places only while its hold runs
    env.log(o, plan.customer, "plan_start", "confirmed", { type: plan.typeId, from: period.from, to: period.to, meals: mealsIn(period) }, { refs: { plan: plan.id, period: "0" }, notes: "the plan's first month is held; it starts when the payment record shows the payment" });
    const asked = await env.askPayment(o);
    if (asked !== "ok") { plan.state = "cancelled"; period.state = "lapsed"; moveTo(o, "cancelled"); if (asked === "failed") await env.tell(o, plan.customer, "link_failed"); return; }
    await env.tell(o, plan.customer, "plan_quote", { facts: facts(plan, period), offer: { kind: "buttons", buttons: env.ownerConfirms ? ["paid", "owner"] : ["owner"], body: ["plan_quote"] }, image: await env.qr(o) });
  }

  /** Make the period's order: the record its payment is matched to. No day, no items, so it is never one of the shop's orders in a slot. */
  function attach(o: Order, plan: Plan, period: PlanPeriod): void {
    o.plan = { id: plan.id, period: period.index, typeId: plan.typeId };
    o.state = "awaiting_advance";
    o.totalInr = period.dueInr;
    o.advanceInr = period.dueInr;
    o.mode = plan.mode;
    if (plan.area) o.area = plan.area;
    const first = Object.keys(period.days).sort()[0];
    if (first) { const w = slotWindow(plan, first); o.slotStartMs = w.fromMs; o.slotEndMs = w.toMs; }
  }

  // ---- a period's payment is recorded ------------------------------------------------------------------------------------------

  /** The agent's `afterAdvance` for a period's order that was waiting for its payment: the period is paid, the plan stands, the customer (and for a first period, the owner) is told. */
  async function onPaid(o: Order): Promise<void> {
    const plan = state().plans[o.plan!.id];
    const period = plan?.periods[o.plan!.period];
    if (!plan || !period || period.state !== "awaiting_payment" || plan.state !== "active") { env.log(o, o.customer, "plan_paid", "blocked", { plan: o.plan }, { notes: "the plan or the period does not stand any more, so the payment is not counted as meals" }); return; }
    period.state = "paid";
    period.paidAtMs = clock.now();
    period.holdUntilMs = undefined;
    period.reminders = undefined;
    o.holdExpiresAt = undefined;
    moveTo(o, "confirmed");
    moveTo(o, "completed"); // meals are not this record's business: the ledger carries them, and the record must never read as an order still to come
    for (const piece of period.taken) { const origin = store.orders.get(piece.orderId); if (origin) env.applied(origin, piece.amountInr); } // credit used: the earlier payment it came from is earned now
    env.log(o, o.customer, "plan_paid", "confirmed", { period: period.index, amountInr: period.dueInr, creditTakenInr: period.taken.reduce((n, t) => n + t.amountInr, 0) }, { refs: { plan: plan.id, period: String(period.index), amountPaise: String(period.dueInr * 100) }, notes: "the payment record shows this period's payment: its meals are owed" });
    await env.tell(o, o.customer, "plan_active", { facts: facts(plan, period, { cutoffMs: cutoffMsFor(rulesOf(plan), Object.keys(period.days).sort()[0] ?? period.from) }), offer: undefined });
    if (period.index === 0) await env.tellOwner(o, o.customer, "owner_plan_started", { facts: facts(plan, period) });
  }

  // ---- what the customer writes -----------------------------------------------------------------------------------------------

  /** True when the message was about a plan and has been answered. Anything else (and a customer's STOP) goes the way it always did. */
  async function onMessage(phone: string, text: string, language: Order["language"]): Promise<boolean> {
    const pending = state().plans[`pending:${phone}`];
    const plan = planOfCustomer(store.plans, phone);
    const intent = readPlanIntent(text, plan !== undefined, cfg.types, settings.languages);
    if (pending && !intent) { if (/^\s*(stop|cancel|no)\s*$/iu.test(text)) { delete state().plans[`pending:${phone}`]; return false; } await onAddress(pending, text); return true; }
    if (!intent) return false;
    env.log(null, phone, "receive_message", "confirmed", { plan: intent.kind }, { notes: "a message about the customer's monthly plan, read from plain words (no model)" });
    switch (intent.kind) {
      case "subscribe": await subscribe(phone, language, intent.typeId); return true;
      case "my_plan": if (plan) await myPlan(plan); else await env.tell(null, phone, "plan_none"); return true;
      case "cancel_plan": if (plan) await cancel(plan); else { delete state().plans[`pending:${phone}`]; await env.tell(null, phone, "plan_none"); } return true;
      default: if (!plan) { await env.tell(null, phone, "plan_none"); return true; } await change(plan, intent); return true;
    }
  }

  /** The day a customer means, or the earliest day that can still be changed when they name none. */
  function dayOf(plan: Plan, phrase: DatePhrase | undefined): string | undefined {
    const now = clock.now();
    if (phrase) { const r = resolveDate(phrase, now, tz); return r ? keyOf(r.date) : undefined; }
    const rules = rulesOf(plan);
    let d = firstMealOnOrAfter(localParts(now, tz), rules.weekdays);
    for (let i = 0; i < 14 && now >= cutoffMsFor(rules, keyOf(d)); i++) d = firstMealOnOrAfter(addDays(d, 1), rules.weekdays);
    return keyOf(d);
  }

  async function change(plan: Plan, intent: Extract<PlanIntent, { kind: "skip" | "pause" | "resume" }>): Promise<void> {
    const key = dayOf(plan, intent.date);
    if (!key) { await say(plan, "plan_no_meal", facts(plan)); return; }
    const rules = rulesOf(plan);
    const now = clock.now();
    const asked: Asked = intent.kind === "skip" ? skipDay(plan, key, rules, now) : intent.kind === "pause" ? pauseFrom(plan, key, rules, now) : resumeFrom(plan, key, rules, now);
    const action = `plan_${intent.kind}`;
    if (!asked.ok) {
      logPlan(plan, action, "blocked", { day: key }, { decisions: [asked.decision], refs: { day: key } });
      if (asked.why === "after_cutoff") await say(plan, "plan_cutoff_refused", dayFacts(plan, key, { cutoffMs: asked.cutoffMs }));
      else await say(plan, "plan_no_meal", dayFacts(plan, key));
      return;
    }
    logPlan(plan, action, "confirmed", { day: key, days: asked.days }, { decisions: [asked.decision], refs: { day: key, days: String(asked.days) }, notes: "the days are recorded in the entitlement ledger; they become credit when the period is settled, once" });
    await say(plan, intent.kind === "skip" ? "plan_skip_done" : intent.kind === "pause" ? "plan_pause_done" : "plan_resume_done", dayFacts(plan, key));
  }

  /** "My plan": a period still waiting for payment gets its link again; otherwise the current period. */
  async function myPlan(plan: Plan): Promise<void> {
    const last = plan.periods[plan.periods.length - 1];
    if (!last) { await env.tell(null, plan.customer, "plan_choose", { facts: { itemsText: nameOf(plan) } }); return; }
    const o = orderOf(last);
    if (last.state === "awaiting_payment" && o?.state === "awaiting_advance") { await env.tell(o, plan.customer, last.index === 0 ? "plan_quote" : "plan_renewal", { facts: facts(plan, last, { dateMs: momentOf(last.from), cutoffMs: last.payByMs }) }); return; }
    const now = clock.now();
    const current = plan.periods.find((p) => p.state === "paid" && now < momentOf(p.to) + 24 * HOUR) ?? plan.periods.filter((p) => p.state === "paid").at(-1) ?? last;
    await env.tell(null, plan.customer, "plan_active", { facts: facts(plan, current, { cutoffMs: cutoffMsFor(rulesOf(plan), Object.keys(current.days).sort()[0] ?? current.from) }) });
  }

  // ---- cancelling ----------------------------------------------------------------------------------------------------------------

  /**
   * Cancel: nothing is sent or charged for a day whose cut-off is still ahead, a renewal waiting for its payment is given up (and the credit it was to take comes back), and
   * what is unused is refunded through the agent's refund path: the days not taken of the last period, and any credit carried and not yet used. Never both for one day.
   */
  async function cancel(plan: Plan): Promise<void> {
    const now = clock.now();
    for (const period of plan.periods) {
      if (period.state !== "awaiting_payment") continue;
      const o = orderOf(period);
      await env.reconcile(o); // a payment that landed just before the cancel is counted, then refunded below
      if (period.state !== "awaiting_payment" as PlanPeriod["state"]) continue;
      period.state = "lapsed";
      period.reminders = undefined; // a reminder still queued for it never goes out
      returnBalance(plan, period.taken);
      if (o?.state === "awaiting_advance") await env.cancelWaiting(o, "the customer cancelled the plan before paying this period");
    }
    const { days, decision } = cancelPlan(plan, rulesOf(plan), now);
    logPlan(plan, "plan_cancel", "confirmed", { days }, { decisions: [decision], refs: { days: String(days) }, notes: "no meal is sent or charged for the days after the cancellation; what is unused is refunded below" });
    const paid = plan.periods.filter((p) => p.state === "paid");
    const last = paid.at(-1);
    if (last && !last.settlement) await closeAndRefund(plan, last);
    for (const piece of plan.balance.splice(0)) { const origin = store.orders.get(piece.orderId); if (origin) await env.refund(origin, piece.amountInr, "credit carried from an earlier month, unused because the plan was cancelled"); }
    delete state().plans[`pending:${plan.customer}`];
    await say(plan, "plan_cancelled", facts(plan));
    await env.tellOwner(null, plan.customer, "owner_plan_cancelled", { facts: facts(plan) });
  }

  /** Count a paid period's days not taken, once, and act on it: refunded now (the shop's rule is refund, or the plan is over), or carried (already on the balance). Then the period's earned money is applied. */
  async function closeAndRefund(plan: Plan, period: PlanPeriod): Promise<void> {
    const s = settle(plan, period, rulesOf(plan), clock.now());
    logPlan(plan, "plan_credit", "confirmed", { period: period.index, days: period.settlement?.days, amountInr: s.amountInr, kind: s.kind }, { decisions: [s.decision], refs: { period: String(period.index), kind: s.kind, amountPaise: String(s.amountInr * 100) }, notes: s.kind === "carried" ? "the days not taken are carried: they come off a later payment" : s.kind === "refunded" ? "the days not taken are refunded" : "no day was left untaken" });
    const o = orderOf(period);
    if (o) env.applied(o, period.dueInr - (s.kind === "none" ? 0 : s.amountInr));
    if (s.kind === "refunded" && o) await env.refund(o, s.amountInr, "days of a plan not taken, refunded by the shop's rule or because the plan ended");
  }

  // ---- time passing ---------------------------------------------------------------------------------------------------------------

  /** The agent's tick: meals whose slot ended are delivered, a period whose credit is final is settled and the next is asked for, an unpaid renewal is reminded and lapses, a hold ends. */
  async function onTick(): Promise<void> {
    const now = clock.now();
    for (const [id, plan] of Object.entries(state().plans)) if (id.startsWith("pending:") && plan.askedAtMs !== undefined && now - plan.askedAtMs > settings.advance.holdMinutes * 60_000) delete state().plans[id];
    for (const plan of plansOf(store.plans)) {
      if (plan.state === "awaiting_address") continue;
      for (const key of deliverDue(plan, (k) => slotWindow(plan, k).toMs, now)) logPlan(plan, "deliver_meal", "confirmed", { day: key }, { refs: { day: key }, notes: "the meal day's slot ended and the plan stood, so the meal is counted as delivered once (what was handed over is the shop's to say)" });
      for (const period of plan.periods) if (period.state === "awaiting_payment") await watch(plan, period, now);
      if (plan.state === "active" && renewalDue(plan, rulesOf(plan), now) && env.takesNewWork()) await renew(plan);
    }
  }

  /** A period waiting for its payment: look at the record, send the one reminder when it is due, and give it up when its time is out. */
  async function watch(plan: Plan, period: PlanPeriod, now: number): Promise<void> {
    const o = orderOf(period);
    if (!o || o.state !== "awaiting_advance") return;
    const out = period.index === 0 ? (period.holdUntilMs ?? 0) <= now : (period.payByMs ?? Infinity) <= now;
    if (period.reminders && !out && plan.state === "active" && takeDue(period.reminders, now).due) await env.tell(o, plan.customer, "plan_renewal", { facts: facts(plan, period, { dateMs: momentOf(period.from), cutoffMs: period.payByMs }) });
    if (!out) return;
    await env.reconcile(o);
    if (period.state !== "awaiting_payment" as PlanPeriod["state"] || o.state !== "awaiting_advance") return;
    period.state = "lapsed";
    period.reminders = undefined;
    returnBalance(plan, period.taken);
    await env.cancelWaiting(o, period.index === 0 ? "the hold on the plan's first payment ran out" : "the renewal was not paid before its first meal closed");
    if (period.index === 0) { plan.state = "cancelled"; await env.tell(o, plan.customer, "plan_hold_expired", { facts: facts(plan) }); }
    else { plan.state = "lapsed"; await env.tell(o, plan.customer, "plan_lapsed", { facts: facts(plan) }); }
    logPlan(plan, "plan_lapse", "confirmed", { period: period.index }, { refs: { period: String(period.index) }, notes: "the payment did not come in time: no meal is owed and nothing is charged for this period" });
  }

  /** The last period's credit is final (its last cut-off passed): settle it once, take what is carried off the next payment, and ask for that payment: a link, never a debit. */
  async function renew(plan: Plan): Promise<void> {
    const last = plan.periods[plan.periods.length - 1];
    const next = last.index + 1;
    const once = checkOneRenewal(plan, next);
    if (once.verdict === "block") { logPlan(plan, "plan_renew", "blocked", { period: next }, { decisions: [once] }); return; }
    if (!last.settlement) await closeAndRefund(plan, last);
    const type = typeOf(plan);
    const rules = rulesOf(plan);
    const range = newDays(plan, rules.weekdays, dateOfKey(plan.startKey), next);
    const taken = cfg.credits === "carry" ? takeBalance(plan, type.priceInr) : [];
    const takenInr = taken.reduce((n, t) => n + t.amountInr, 0);
    const firstDay = Object.keys(range.days).sort()[0];
    const payBy = cutoffMsFor(rules, firstDay);
    const o = register(store, newDraft(plan.customer, plan.language));
    const period: PlanPeriod = { index: next, from: range.from, to: range.to, priceInr: type.priceInr, dueInr: type.priceInr - takenInr, taken, orderId: o.id, days: range.days, state: "awaiting_payment", payByMs: payBy, reminders: scheduleAround(payBy, hoursBefore([24]), clock.now()) };
    plan.periods.push(period);
    attach(o, plan, period);
    logPlan(plan, "plan_renew", "confirmed", { period: next, dueInr: period.dueInr, creditTakenInr: takenInr }, { decisions: [once], refs: { period: String(next) }, notes: "the next period is asked for with a payment link; nothing is charged by itself" });
    if (period.dueInr === 0) { await onPaid(o); return; }
    const asked = await env.askPayment(o);
    if (asked !== "ok") { period.state = "lapsed"; returnBalance(plan, taken); moveTo(o, "cancelled"); return; }
    await env.tell(o, plan.customer, "plan_renewal", { facts: facts(plan, period, { dateMs: momentOf(period.from), cutoffMs: payBy }), image: await env.qr(o) });
  }

  return { onMessage, onPaid, onTick, awaitingOrderOf };
}
