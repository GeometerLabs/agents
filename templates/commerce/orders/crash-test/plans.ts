// The crash-test situations of monthly plans (17 Nov 2026). Like every Orders situation they start a fresh world, make something go wrong on purpose and judge from the stand-ins'
// own records (the plan's ledger, the payments service, the owner's UPI ledger, the messaging outbox), never from what the agent said. They run only on a shop whose settings
// have a `plans` block, so every other shop's hand check is exactly as it was. Five: a skip just after the cut-off; a pause that spans a renewal date; a renewal paid twice; a
// cancel while a reminder is queued; a credit and a refund for the same day attempted.
import { addDays, localParts, zonedToMs } from "../../../../modules/core/time.ts";
import { checker } from "../../../../modules/crash-test/situations.ts";
import type { Situation } from "../../../../modules/crash-test/situations.ts";
import { capabilitiesOf } from "../../../../modules/payments/providers/index.ts";
import { createWorld } from "../src/harness.ts";
import type { World } from "../src/harness.ts";
import { cutoffMsFor } from "../src/plans/ledger.ts";
import type { Plan } from "../src/plans/ledger.ts";
import { creditInr, dateOfKey, keyOf } from "../src/plans/periods.ts";
import { planName } from "../src/plans/settings.ts";
import type { Settings } from "../src/settings.ts";

export function planSituations(settings: Settings, customer: string): Situation[] {
  const cfg = settings.plans;
  if (!cfg) return [];
  const type = cfg.types[0];
  const isUpi = !capabilitiesOf(settings.payment).confirmsAutomatically;
  const tz = settings.timezone;
  const rules = { timeZone: tz, cutoff: cfg.cutoff, weekdays: type.weekdays, credits: cfg.credits };
  const lang0 = settings.languages[0];
  const world = (): World => createWorld({ settings });
  const planOf = (w: World): Plan => Object.values(w.store.plans?.plans ?? {}).find((p) => p.customer === customer && !p.id.startsWith("pending"))!;
  const pay = async (w: World): Promise<void> => { if (isUpi) await w.ownerMarksReceived(customer); else { w.pays(customer); await w.deliverPaymentEvents(); } };
  const subscribe = async (w: World): Promise<Plan> => { await w.say(`I want the monthly plan ${planName(type, lang0)}`, { from: customer }); await pay(w); return planOf(w); };
  const goto = (w: World, ms: number) => { const p = localParts(ms, tz); return w.goto({ year: p.year, month: p.month, day: p.day }, { hour: p.hour, minute: p.minute }); };
  const lastDay = (plan: Plan, index = 0) => Object.keys(plan.periods[index].days).sort().at(-1)!;
  const refundedPaise = (w: World): number => (isUpi ? (w.store.upi?.refunds ?? []).reduce((n, r) => n + r.amountPaise, 0) : w.payments.refunds().reduce((n, r) => n + r.amount, 0) + w.heldForOwner().reduce((n, r) => n + r.amountPaise, 0));
  const credited = (plan: Plan, index = 0) => Object.values(plan.periods[index].days).filter((s) => s === "skipped" || s === "paused" || s === "cancelled").length;
  const worth = (plan: Plan, index = 0) => creditInr(plan.periods[index].priceInr, Object.keys(plan.periods[index].days).length, credited(plan, index), plan.periods[index].dueInr);
  void addDays; void zonedToMs;

  return [
    {
      id: "plan-skip-after-cutoff", planNumber: 20, title: "A skip just after the cut-off is refused, with the cut-off time",
      how: "the plan is paid; one minute before a meal day's cut-off a skip is taken, at the cut-off itself another day's skip is refused and the customer is told when it closed",
      async run() {
        const { results, expect } = checker();
        const w = world();
        const plan = await subscribe(w);
        expect("The plan is paid and its meals are owed", plan?.periods[0].state === "paid");
        const days = Object.keys(plan.periods[0].days).sort();
        const [a, b] = [days[2], days[3]];
        await goto(w, cutoffMsFor(rules, a) - 60_000);
        await w.say(`skip ${dateOfKey(a).day} ${["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"][dateOfKey(a).month - 1]}`, { from: customer });
        expect("One minute before the cut-off the skip is recorded", plan.periods[0].days[a] === "skipped", plan.periods[0].days[a]);
        await goto(w, cutoffMsFor(rules, b));
        await w.say(`skip ${dateOfKey(b).day} ${["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"][dateOfKey(b).month - 1]}`, { from: customer });
        expect("At the cut-off the skip is refused and the day is still owed", plan.periods[0].days[b] === "due", plan.periods[0].days[b]);
        expect("The record shows the refusal under the cut-off rule", w.record.entries().some((e) => e.action === "plan_skip" && e.outcome === "blocked" && e.decisions.some((d) => d.ruleId === "plan-cutoff" && d.verdict === "block")));
        expect("The customer was told the cut-off, not left guessing", /closed at|बंद हो गया|അടച്ചു|ಮುಚ್ಚಿದೆ/u.test(w.lastTextTo(customer)), w.lastTextTo(customer));
        return results;
      },
    },
    {
      id: "plan-pause-across-renewal", planNumber: 21, title: "A pause that spans a renewal date credits each day once, in its own month",
      how: "the plan is paid, paused from the last week of its month, and the clock moves past the renewal and the new month's first meal",
      async run() {
        const { results, expect } = checker();
        const w = world();
        const plan = await subscribe(w);
        const days = Object.keys(plan.periods[0].days).sort();
        const from = days[days.length - 3];
        await goto(w, cutoffMsFor(rules, from) - 3_600_000);
        await w.say(`pause from ${dateOfKey(from).day} ${["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"][dateOfKey(from).month - 1]}`, { from: customer });
        expect("The last three meal days are paused", days.slice(-3).every((d) => plan.periods[0].days[d] === "paused"));
        await goto(w, cutoffMsFor(rules, lastDay(plan)) + 3_600_000);
        const next = plan.periods[1];
        expect("The next month was asked for once", plan.periods.length === 2 && next?.state === "awaiting_payment");
        expect("Every meal day of the new month starts paused: the pause belongs to the plan", !!next && Object.values(next.days).every((s) => s === "paused"));
        expect("The first month's credit is settled once, for exactly its own three days", plan.periods[0].settlement?.days === 3 && plan.periods[0].settlement.amountInr === creditInr(plan.periods[0].priceInr, days.length, 3));
        expect("Nothing is credited for the new month yet, and nothing is delivered in it", next.settlement === undefined && Object.values(next.days).every((s) => s !== "delivered"));
        return results;
      },
    },
    {
      id: "plan-renewal-paid-twice", planNumber: 22, title: "A renewal paid twice is counted once and the extra goes back",
      how: isUpi ? "the renewal is asked for; the owner marks it received, then replays the same code" : "the renewal link is paid twice and the event arrives",
      async run() {
        const { results, expect } = checker();
        const w = world();
        const plan = await subscribe(w);
        await goto(w, cutoffMsFor(rules, lastDay(plan)) + 3_600_000);
        const next = plan.periods[1];
        expect("The renewal is one request for one period", plan.periods.length === 2 && !!next);
        await pay(w);
        const once = refundedPaise(w);
        if (isUpi) await w.ownerMarksReceived(customer, { code: w.upiRequest(customer)?.usedCodes.at(-1) });
        else { w.pays(customer); await w.deliverPaymentEvents(); }
        expect("The period is paid once", plan.periods.filter((p) => p.state === "paid").length === 2 && plan.periods.length === 2);
        expect(isUpi ? "The replayed code counted nothing" : "The second payment is refunded or held for the owner, never kept as a second month", isUpi ? (w.store.upi?.requests.find((r) => r.reference === next.orderId)?.marks.length ?? 0) === 1 : refundedPaise(w) > once, `${once} -> ${refundedPaise(w)}`);
        expect("No second renewal was asked for", w.store.orders.size === 2);
        return results;
      },
    },
    {
      id: "plan-cancel-during-reminder", planNumber: 23, title: "A cancel while a renewal reminder is queued stops the reminder, the delivery and the charge",
      how: "the renewal is asked for with a reminder queued for the day before its pay-by time; the customer cancels; the clock runs past the reminder and the pay-by time",
      async run() {
        const { results, expect } = checker();
        const w = world();
        const plan = await subscribe(w);
        await goto(w, cutoffMsFor(rules, lastDay(plan)) + 3_600_000);
        const next = plan.periods[1];
        expect("A reminder is queued for the renewal", (next?.reminders?.length ?? 0) === 1);
        await w.say("cancel my plan", { from: customer });
        const sent = w.textsTo(customer).length;
        await goto(w, (next.payByMs ?? 0) + 3_600_000);
        expect("The plan is cancelled and the renewal is given up, not charged", plan.state === "cancelled" && next.state === "lapsed" && w.store.orders.get(next.orderId)?.state === "cancelled");
        expect("The reminder never went out", w.textsTo(customer).length === sent && next.reminders === undefined);
        expect("No meal of the renewal is delivered", Object.values(next.days).every((s) => s !== "delivered"));
        expect("The renewal's request or link is closed or unpaid", isUpi ? !(w.store.upi?.requests.find((r) => r.reference === next.orderId)?.marks.length) : !w.payments.links().find((l) => l.reference_id === next.orderId)?.payments.length);
        return results;
      },
    },
    {
      id: "plan-credit-and-refund-same-day", planNumber: 24, title: "A day that is credited is never also refunded",
      how: "one day is skipped (a credit), then the plan is cancelled the same day, which refunds what is unused; each day must be worth money once",
      async run() {
        const { results, expect } = checker();
        const w = world();
        const plan = await subscribe(w);
        const days = Object.keys(plan.periods[0].days).sort();
        await w.say(`skip ${dateOfKey(days[1]).day} ${["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"][dateOfKey(days[1]).month - 1]}`, { from: customer });
        expect("The day is skipped", plan.periods[0].days[days[1]] === "skipped");
        await w.say("cancel my plan", { from: customer });
        expect("The plan is cancelled and the skipped day stays skipped, not cancelled as well", plan.state === "cancelled" && plan.periods[0].days[days[1]] === "skipped");
        expect("The period is settled once, as a refund, and nothing is carried", plan.periods[0].settlement?.kind === "refunded" && plan.balance.length === 0);
        expect("The refund is exactly what the unused days are worth, each counted once", refundedPaise(w) === worth(plan) * 100, `${refundedPaise(w)} vs ${worth(plan) * 100}`);
        expect("A refund is never more than was paid", refundedPaise(w) <= plan.periods[0].dueInr * 100);
        await w.say(`skip ${dateOfKey(days[2]).day} ${["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"][dateOfKey(days[2]).month - 1]}`, { from: customer });
        expect("After the cancel a skip changes nothing and credits nothing more", refundedPaise(w) === worth(plan) * 100);
        return results;
      },
    },
  ];
}
