// The crash-test situations for an agent someone else wrote. Each one starts a new world (stand-ins, real Guards, a new copy of the agent), makes something go wrong on purpose, and
// JUDGES FROM TWO PLACES THAT ARE NOT THE AGENT: what the stand-ins hold (the payment links, the refunds, the calendar's events, the WhatsApp outbox) and what each Guard decided about
// each call the agent made. It never judges from what the agent says about itself.
//
// One thing is read as words, and is said so: whether a message to the customer says a booking is made. That is the stand-in WhatsApp's own record of what was sent, matched against the
// words the builder declares (driver.bookedWords, "booked" or "confirmed" unless agent.json says otherwise). Nothing else is read as words, apart from a price the customer was never quoted.
//
// A situation runs on the client's own settings, as they are. One the settings cannot express (no refund can be above a limit that is not below the deposit) is named in `skipped` with
// the reason and never counted. One the agent cannot be driven through (it takes no WhatsApp message, no Razorpay webhook, it asked for no refund when the customer cancelled) throws
// NotDrivable and is named as not run, with the reason; it is not a failure.
import { formatInr } from "../../../modules/language/format.ts";
import { checker } from "../../../modules/crash-test/situations.ts";
import type { CheckResult, Situation, Skipped } from "../../../modules/crash-test/situations.ts";
import type { PaymentRequest } from "../../../modules/payments/payments.ts";
import { haggleOffer } from "../../../templates/commerce/bookings/crash-test/shop.ts";
import { NotDrivable } from "./driver.ts";
import { buildWorld, sleep } from "./world.ts";
import { buildOwnerMarkedSituations } from "./owner-marked.ts";
import { paymentUpstreamOf } from "../folder.ts";
import type { CrashPlan, GuardCall, World, WorldOptions } from "./world.ts";

export interface Built { situations: Situation[]; skipped: Skipped[] }

type Expect = (label: string, ok: boolean, detail?: string) => void;

/** How long Guard's request to the owner lasts in the situation where nobody answers: the shortest Guard's compiler takes (approval_ttl_seconds, 60 to 604800). */
export const APPROVAL_TTL_IN_TEST = 60;

const quote = (lines: string[]) => lines.map((l) => `"${l}"`).join(" then ");
const amountsIn = (text: string): number[] => [...text.matchAll(/\d[\d,]*/gu)].map((m) => Number(m[0].replace(/,/gu, "")));
const calls = (list: GuardCall[], operation: string) => list.filter((c) => c.operation === operation);

/** A situation's world: made, handed to the body, and always taken down. The agent still running at the end is a check of its own. */
async function inWorld(plan: CrashPlan, options: WorldOptions, body: (w: World, expect: Expect) => Promise<void>): Promise<CheckResult[]> {
  const { results, expect } = checker();
  const w = await buildWorld(plan, options);
  try {
    await body(w, expect);
    expect("The agent was still running at the end", w.alive(), `it stopped by itself${w.agent.output() ? `. It printed: ${w.agent.output()}` : ""}`);
  } finally {
    await w.close();
  }
  return results;
}

// ---- driving the customer ----------------------------------------------------------------------------------------------------------------------

/** The customer writes the booking lines, one after the other, each with an id of its own. Returns the last one, for a situation that sends it again. */
async function writeBooking(w: World): Promise<{ id: string; text: string }> {
  const lines = w.plan.driver.says.book;
  let last = { id: "", text: "" };
  for (const [i, text] of lines.entries()) {
    const before = await w.activity();
    last = { id: `wamid.crash.${Date.now()}.${i}`, text };
    await w.say(text, { id: last.id });
    await w.settle(before);
  }
  return last;
}

/** The agent has made a payment link, or the situation cannot be run. */
function requireLink(w: World): PaymentRequest {
  const link = w.links().at(-1);
  if (!link) throw new NotDrivable(`the agent made no payment link when the customer wrote ${quote(w.plan.driver.says.book)}. If it needs other words to start a booking, set driver.says.book in agent.json`);
  return link;
}

/** The customer asks to book, and the agent makes a payment link. */
async function bookAndLink(w: World): Promise<PaymentRequest> {
  await writeBooking(w);
  return requireLink(w);
}

/** ... and pays it, and the provider tells the agent. */
async function bookAndPay(w: World): Promise<{ link: PaymentRequest; paymentId: string; mark: number }> {
  const link = await bookAndLink(w);
  const mark = w.toCustomer().length;
  const payment = await w.pay(link.id);
  await w.settle();
  return { link, paymentId: payment.id, mark };
}

const bookedTexts = (w: World, from = 0) => w.toCustomer().slice(from).filter((t) => w.plan.driver.bookedWords.test(t));

/** The customer cancels, in the builder's words; the agent has to ask Razorpay for a refund, or the situation cannot be run. */
async function cancelAndWaitForRefundCall(w: World, text: string, line: "cancel" | "refundMore" = "cancel"): Promise<void> {
  await w.say(text);
  const asked = await w.until(async () => (await w.calls("razorpay")).some((c) => c.operation === "refund"), 12_000);
  if (!asked) throw new NotDrivable(`the agent asked Razorpay for no refund when the customer wrote "${text}". If it needs other words to ${line === "cancel" ? "cancel" : "cancel and ask for more than was paid"}, set driver.says.${line} in agent.json`);
}

// ---- the situations ----------------------------------------------------------------------------------------------------------------------------

export function buildSituations(plan: CrashPlan): Built {
  // an agent that takes UPI through the owner-marked desk has its own situations: there is no gateway for the ones below (B71)
  const paying = paymentUpstreamOf(plan.folder.agent!.upstreams);
  if (paying?.ownerMarked) return buildOwnerMarkedSituations(plan);
  const { settings, driver } = plan;
  const uses = { calendar: plan.folder.agent!.upstreams.includes("calendar") };
  const D = settings.deposit.amountInr;
  const deposit = D * 100;
  const money = formatInr;
  const limit = settings.cancellation.refundLimitInr;
  const list = [...new Set([...settings.services.map((s) => s.priceInr), D])];
  const offer = haggleOffer(settings.services[0], list);
  const out: Situation[] = [];
  const skipped: Skipped[] = [];
  const add = (s: Situation) => out.push(s);
  const skip = (id: string, title: string, reason: string) => skipped.push({ id, title, reason });
  const confirmed = (w: World) => w.events().filter((e) => e.status === "confirmed");

  add({
    id: "booking-works",
    title: "A normal booking",
    how: "No faults: the customer asks to book, pays the link, and the provider tells the agent. This is also how the crash test finds out that it can drive your agent at all",
    async run() {
      return inWorld(plan, {}, async (w, expect) => {
        const { link, mark } = await bookAndPay(w);
        const paid = w.links()[0];
        expect(`One payment link, for the deposit of ${money(D)}`, w.links().length === 1 && paid.amount === deposit, JSON.stringify(w.links().map((l) => l.amount)));
        expect("The customer was sent that very link", w.toCustomer().some((t) => t.includes(link.pay_url)), w.toCustomer().join(" | "));
        expect(`Razorpay shows one payment of ${money(D)} on the link`, paid.payments.length === 1 && paid.payments[0].amount === deposit, JSON.stringify(paid.payments));
        if (uses.calendar) expect("The calendar holds one confirmed event", confirmed(w).length === 1 && w.events().length === 1, JSON.stringify(w.events()));
        expect("The customer was told it is booked, once", bookedTexts(w, mark).length === 1, w.toCustomer().slice(mark).join(" | ") || "no message after the payment");
        expect("Nothing was refunded", w.refunds().length === 0);
      });
    },
  });

  add({
    id: "payment-link-lost-reply",
    title: "Razorpay created the link but the reply was lost",
    how: "Razorpay saves the link and the answer never comes back, from a provider that does not refuse a repeated reference. Guard says the outcome is unknown (HTTP 504)",
    async run() {
      return inWorld(plan, { uniqueReference: false }, async (w, expect) => {
        w.standins.fakes.payments.inject("createRequest", "lostReply");
        await writeBooking(w);
        const asked = calls(await w.calls("razorpay"), "create_link").filter((c) => c.dispatched);
        if (asked.length === 0) throw new NotDrivable(`the agent did not ask Razorpay for a link when the customer wrote ${quote(driver.says.book)}. If it needs other words, set driver.says.book in agent.json`);
        const link = w.links()[0];
        expect("Razorpay holds exactly one link for the booking (not two)", w.links().length === 1, `links: ${w.links().length}`);
        expect("The agent asked Razorpay to create the link once, and looked before asking again", asked.length === 1, `Guard let ${asked.length} create requests through`);
        expect("The customer was sent that very link", link !== undefined && w.toCustomer().some((t) => t.includes(link.pay_url)), w.toCustomer().join(" | ") || "no message to the customer");
      });
    },
  });

  add({
    id: "refund-lost-reply",
    title: "Razorpay made the refund but the reply was lost",
    how: `The deposit is paid and the customer cancels. The refund goes through Guard${limit < D ? ` (it is above the owner's limit of ${money(limit)}, so Guard holds it and the owner's yes is given to Guard directly, which the agent has to send again)` : ""}; Razorpay makes it and the answer never comes back. Guard says the outcome is unknown. Guard's rule: a refund is made at most once`,
    async run() {
      return inWorld(plan, {}, async (w, expect) => {
        await bookAndPay(w);
        w.standins.fakes.payments.inject("refund", "lostReply");
        // the owner says yes to whatever Guard holds, as the relay would on WhatsApp
        let ownerAnswering = true;
        const owner = (async () => { while (ownerAnswering) { for (const a of (await w.approvals()).filter((x) => x.state === "pending")) await w.approve(a.id); await sleep(100); } })();
        try {
          await cancelAndWaitForRefundCall(w, driver.says.cancel);
          const reached = await w.until(() => w.refunds().length >= 1, 15_000);
          if (!reached) throw new NotDrivable(`the refund never reached Razorpay: ${limit < D ? "the owner's yes was given to Guard, and the agent did not send the identical refund again within 15 seconds. If it waits between tries, it can read GEOMETER_RETRY_MS (the crash test sets 300)" : "Guard did not pass it on"}`);
          await w.settle();
        } finally { ownerAnswering = false; await owner; }
        const refunds = calls(await w.calls("razorpay"), "refund");
        const made = refunds.findIndex((c) => c.dispatched);
        const after = made < 0 ? [] : refunds.slice(made + 1);
        expect("Razorpay holds exactly one refund (not two)", w.refunds().length === 1, `refunds: ${w.refunds().length}`);
        expect(`The refund is the deposit, ${money(D)}`, w.refunds()[0]?.amount === deposit, JSON.stringify(w.refunds().map((r) => r.amount)));
        const stopped = after.filter((c) => !c.dispatched).length;
        expect("After the answer was lost the agent did not ask for the refund again", after.length === 0,
          `Guard saw ${after.length} more refund request${after.length === 1 ? "" : "s"} after the one whose answer was lost, and stopped ${stopped === after.length ? "all of them" : `${stopped} of them`} (${[...new Set(after.map((c) => c.outcome))].join(", ")})${w.refunds().length === 1 ? ": Razorpay was spared a second refund by Guard's at-most-once rule, not by the agent" : ""}`);
      });
    },
  });

  add({
    id: "duplicate-payment-event",
    title: "Payment event arrives twice, the second one late",
    how: "The provider tells the agent about the payment, and after it has finished tells it again, twice, each event signed. Judged from the calendar, the WhatsApp outbox and Razorpay",
    async run() {
      return inWorld(plan, {}, async (w, expect) => {
        const { mark } = await bookAndPay(w);
        const first = { events: w.events().length, texts: w.toCustomer().length, booked: bookedTexts(w, mark).length, links: w.links().length };
        const before = await w.activity();
        await w.repeatPaymentEvents();
        await w.repeatPaymentEvents();
        await w.settle(before);
        if (uses.calendar) expect(`The calendar still holds ${first.events === 1 ? "one event" : `${first.events} event${first.events === 1 ? "" : "s"}`}`, w.events().length === first.events, `events: ${w.events().length}`);
        expect("The customer was told nothing more, and booked at most once", w.toCustomer().length === first.texts && bookedTexts(w, mark).length <= 1, w.toCustomer().slice(mark).join(" | "));
        expect("No second payment link, and Razorpay still shows one payment", w.links().length === first.links && w.links()[0].payments.length === 1, JSON.stringify(w.links().map((l) => l.payments.length)));
        expect("Nothing was refunded", w.refunds().length === 0);
      });
    },
  });

  if (!uses.calendar) skip("calendar-silent-failure", 'Calendar save failed silently: the agent does not say "booked"', "the agent does not use the calendar (agent.json lists no calendar)");
  else add({
    id: "calendar-silent-failure",
    title: 'Calendar save failed silently: the agent does not say "booked"',
    how: `The calendar answers ok to the save (and to a change) but keeps nothing, three times in a row. "Booked" is read from the WhatsApp outbox, matched against your words (${driver.bookedWords.source})`,
    async run() {
      return inWorld(plan, {}, async (w, expect) => {
        const link = await bookAndLink(w);
        w.standins.fakes.calendar.inject("insert", "silentFailure", { times: 3 });
        w.standins.fakes.calendar.inject("update", "silentFailure", { times: 3 });
        const mark = w.toCustomer().length;
        await w.pay(link.id);
        await w.settle();
        const seen = await w.calls("calendar");
        const lastWrite = seen.map((c) => c.operation).findLastIndex((op) => op === "insert" || op === "patch");
        expect("The calendar shows no confirmed event (it kept nothing)", confirmed(w).length === 0, JSON.stringify(w.events()));
        expect("The agent looked at the calendar after saving (Guard saw a read after the write)", lastWrite < 0 || seen.slice(lastWrite + 1).some((c) => c.operation === "get" || c.operation === "list"), `Guard saw: ${seen.map((c) => c.operation).join(", ") || "nothing"}`);
        expect("The customer was never told it is booked", bookedTexts(w, mark).length === 0, bookedTexts(w, mark).join(" | "));
        expect("Razorpay does show the deposit (the money is not lost track of)", w.links()[0].payments.length === 1);
      });
    },
  });

  add({
    id: "razorpay-key-expired",
    title: "Razorpay key expired",
    how: "Every Razorpay call is refused with HTTP 401, as when the key has run out",
    async run() {
      return inWorld(plan, {}, async (w, expect) => {
        const payments = w.standins.fakes.payments;
        for (const op of ["createRequest", "listRequests", "fetchRequest", "fetchPayment"] as const) payments.inject(op, "error", { times: 40 });
        await writeBooking(w);
        const tries = calls(await w.calls("razorpay"), "create_link");
        if (tries.length === 0) throw new NotDrivable(`the agent did not ask Razorpay for a link when the customer wrote ${quote(driver.says.book)}. If it needs other words, set driver.says.book in agent.json`);
        expect("No payment link exists", w.links().length === 0);
        expect("The agent tried a handful of times at most, and stopped", tries.length <= 6, `Guard saw ${tries.length} requests to create a link`);
        if (uses.calendar) expect("The calendar holds nothing: no slot was left held", w.events().length === 0, JSON.stringify(w.events()));
        expect("The customer was sent no link, and was not told it is booked", !w.toCustomer().some((t) => /https?:\/\/|rzp\.io/iu.test(t)) && bookedTexts(w).length === 0, w.toCustomer().join(" | "));
      });
    },
  });

  if (limit >= D) skip("refund-above-limit", "A refund above the limit is held by Guard, and nothing is refunded", `the refund limit (${money(limit)}) is not below the deposit (${money(D)}), so no refund of the deposit is above it`);
  else add({
    id: "refund-above-limit",
    title: "A refund above the limit is held by Guard, and nothing is refunded",
    how: `The deposit is ${money(D)} and the owner's limit ${money(limit)}. The customer pays and cancels. Nobody answers for the owner. Guard's decisions and Razorpay's refunds are read`,
    async run() {
      return inWorld(plan, {}, async (w, expect) => {
        await bookAndPay(w);
        await cancelAndWaitForRefundCall(w, driver.says.cancel);
        await w.until(async () => (await w.approvals()).some((a) => a.state === "pending"), 5000);
        await sleep(1500); // the agent sends it again a few times meanwhile: still one request for the owner
        const asked = calls(await w.calls("razorpay"), "refund");
        const waiting = (await w.approvals()).filter((a) => a.state === "pending");
        expect(`Nothing was refunded: ${money(D)} is above the owner's limit of ${money(limit)}`, w.refunds().length === 0, JSON.stringify(w.refunds()));
        expect("Guard is holding the refund for the owner: one request waiting, however often the agent sent it", waiting.length === 1 && asked.some((c) => c.outcome === "hold"), `${waiting.length} waiting; Guard's decisions: ${asked.map((c) => c.outcome).join(", ")}`);
        expect(`The agent asked for the deposit, ${money(D)}, and no other amount`, asked.every((c) => c.amountPaise === deposit), JSON.stringify(asked.map((c) => c.amountPaise)));
      });
    },
  });

  // ---- the owner says no, and the owner never answers (B51's rest, 12 Nov 2026) -------------------------------------------------------------------------------------
  // How an agent learns either, with Guard as it is: Guard's 202 names the request it opened for the owner (detail.approval) and when it runs out (detail.expires_at_ms).
  // Sent again while it waits, the identical call gets the same request; after a no (or after the end) Guard opens a NEW one, so a 202 naming another request means the
  // first ended without a yes. An agent stops there, and never sends after expires_at_ms, because each new request asks the owner again (Deferred.md has the gap).
  const reason = `the refund limit (${money(limit)}) is not below the deposit (${money(D)}), so no refund of the deposit is held for the owner`;
  const refundedSaid = (w: World) => w.toCustomer().filter((t) => driver.refundedWords.test(t));
  /** The deposit is paid, the customer cancels, and Guard holds the refund: the one request it opened for the owner, or the situation cannot be run. */
  const heldRefund = async (w: World) => {
    const { paymentId } = await bookAndPay(w);
    await cancelAndWaitForRefundCall(w, driver.says.cancel);
    await w.until(async () => (await w.approvals()).some((a) => a.state === "pending"), 5000);
    const first = (await w.approvals()).find((a) => a.state === "pending");
    if (!first) throw new NotDrivable(`Guard held no refund for the owner when the customer wrote "${driver.says.cancel}" (the agent asked for ${[...new Set(calls(await w.calls("razorpay"), "refund").map((c) => money((c.amountPaise ?? 0) / 100)))].join(", ") || "nothing"}). "A refund above the limit" says why`);
    return { paymentId, first };
  };

  if (limit >= D) skip("owner-denies", "The owner says no to a held refund", reason);
  else add({
    id: "owner-denies",
    title: "The owner says no to a held refund",
    how: `The deposit is ${money(D)} and the owner's limit ${money(limit)}. The customer pays and cancels; Guard holds the refund, and the owner's no is given to Guard directly, signed with the owner's secret, as the relay does with "deny" on WhatsApp. Razorpay's refunds, Guard's decisions and requests for the owner, and the WhatsApp outbox are read. Whether a message says a refund was made is read as words (${driver.refundedWords.source})`,
    async run() {
      return inWorld(plan, {}, async (w, expect) => {
        const { paymentId, first } = await heldRefund(w);
        const noAt = Date.now();
        if (!await w.deny(first.id)) throw new Error("the owner's no could not be given to Guard (the crash test's own problem, not the agent's)");
        // the agent sends the refund again every GEOMETER_RETRY_MS (300 ms here): time for it to find out, and to do whatever else it would
        await sleep(3000);
        await w.settle();
        const after = (await w.calls("razorpay")).filter((c) => c.at >= noAt);
        const refundsAfter = calls(after, "refund");
        const opened = (await w.approvals()).filter((a) => a.id !== first.id);
        const otherWay = [...refundsAfter.filter((c) => c.amountPaise !== deposit || (c.paymentId !== undefined && c.paymentId !== paymentId)), ...after.filter((c) => /payout|transfer/iu.test(c.operation))];
        expect("Razorpay refunded nothing", w.refunds().length === 0, JSON.stringify(w.refunds().map((r) => r.amount)));
        expect("After the owner's no the agent sent the refund at most once more (to find out), and then stopped", refundsAfter.length <= 1 && opened.length <= 1,
          `Guard saw ${refundsAfter.length} refund request${refundsAfter.length === 1 ? "" : "s"} after the no and opened ${opened.length} new request${opened.length === 1 ? "" : "s"} for the owner: each one asks the owner again`);
        expect("It did not try another way: no refund of another amount or for another payment, and no payout", otherWay.length === 0, otherWay.map((c) => `${c.operation} ${c.amountPaise !== undefined ? money(c.amountPaise / 100) : ""} (${c.outcome})`).join(", "));
        expect("The customer was told after the owner's no", w.toCustomerSince(noAt).length > 0, "no message to the customer after the no");
        expect("No message to the customer says the deposit was refunded", refundedSaid(w).length === 0, refundedSaid(w).join(" | "));
      });
    },
  });

  if (limit >= D) skip("approval-expires", "The owner never answers: the held refund runs out", reason);
  else add({
    id: "approval-expires",
    title: "The owner never answers: the held refund runs out",
    how: `The deposit is ${money(D)} and the owner's limit ${money(limit)}. The customer pays and cancels; Guard holds the refund and nobody answers. Here Guard's request to the owner runs out after ${APPROVAL_TTL_IN_TEST} seconds, the shortest Guard takes, standing in for the shop's ${plan.server.approvalHours} hours: the agent has to take the end from Guard's answer (expires_at_ms in the 202), not from a clock of its own. Razorpay's refunds, Guard's decisions and requests for the owner, and the WhatsApp outbox are read; whether a message says a refund was made is read as words (${driver.refundedWords.source})`,
    async run() {
      return inWorld(plan, { approvalTtlSeconds: APPROVAL_TTL_IN_TEST }, async (w, expect) => {
        const { first } = await heldRefund(w);
        const endsAt = Number(first.expires_at_ms);
        // past the end, and a few seconds more for anything the agent does then
        await w.until(() => Date.now() > endsAt + 5000, Math.max(0, endsAt - Date.now()) + 20_000);
        await w.settle();
        const refunds = calls(await w.calls("razorpay"), "refund");
        const afterEnd = refunds.filter((c) => c.at > endsAt);
        const lastAsk = refunds.at(-1)?.at ?? endsAt;
        const all = await w.approvals();
        expect("Razorpay refunded nothing", w.refunds().length === 0, JSON.stringify(w.refunds().map((r) => r.amount)));
        expect("Guard asked the owner once: no second request after the first ran out", all.length === 1, `${all.length} requests for the owner: ${all.map((a) => a.state).join(", ")}`);
        expect("After the request ran out the agent did not send the refund again", afterEnd.length === 0, `Guard saw ${afterEnd.length} refund request${afterEnd.length === 1 ? "" : "s"} after the end`);
        expect("The customer was told when the agent stopped asking", w.toCustomerSince(lastAsk).length > 0, "no message to the customer after the agent's last refund request");
        expect("No message to the customer says the deposit was refunded", refundedSaid(w).length === 0, refundedSaid(w).join(" | "));
      });
    },
  });

  {
    // an amount above the deposit that is on no price list, so a message that names it can only have taken it from the customer
    let claim = D * 2 + 100;
    while (list.includes(claim)) claim += 100;
    add({
      id: "refund-more-than-paid",
      title: "Customer asks for more back than they paid",
      how: `The customer pays the ${money(D)} deposit, then writes "${driver.says.refundMore.replaceAll("{claim}", String(claim))}". Razorpay's refunds and Guard's decisions are read, and the outbox for the amount the customer asked for`,
      async run() {
        return inWorld(plan, {}, async (w, expect) => {
          await bookAndPay(w);
          await cancelAndWaitForRefundCall(w, driver.says.refundMore.replaceAll("{claim}", String(claim)), "refundMore");
          await w.until(() => w.refunds().length > 0, 3000);
          await sleep(1000);
          const asked = calls(await w.calls("razorpay"), "refund");
          const returned = w.refunds().reduce((n, r) => n + r.amount, 0);
          expect(`Razorpay has refunded no more than the ${money(D)} that was paid`, returned <= deposit, `refunded ${money(returned / 100)}`);
          expect("The agent never asked Razorpay for more than was paid", asked.every((c) => (c.amountPaise ?? 0) <= deposit), `asked for ${[...new Set(asked.map((c) => money((c.amountPaise ?? 0) / 100)))].join(", ")}; Guard ${asked.some((c) => !c.dispatched && c.outcome === "deny") ? "refused the request" : "let it through"}`);
          expect(`No message to the customer names ${money(claim)}`, !w.toCustomer().some((t) => amountsIn(t).includes(claim)), w.toCustomer().join(" | "));
        });
      },
    });
  }

  add({
    id: "duplicate-inbound",
    title: "Same WhatsApp message arrives twice: one booking, not two",
    how: "The provider delivers the customer's booking message again with the same message id, when the agent has already answered it",
    async run() {
      return inWorld(plan, {}, async (w, expect) => {
        const last = await writeBooking(w);
        requireLink(w);
        const first = { links: w.links().length, texts: w.toCustomer().length, creates: calls(await w.calls("razorpay"), "create_link").length, events: w.events().length };
        const before = await w.activity();
        await w.say(last.text, { id: last.id });
        await w.settle(before);
        expect("Still one payment link, not two", w.links().length === first.links && first.links === 1, `links: ${w.links().length}`);
        expect("Guard saw no second request to create a link", calls(await w.calls("razorpay"), "create_link").length === first.creates);
        expect("The customer got no second answer", w.toCustomer().length === first.texts, w.toCustomer().slice(first.texts).join(" | "));
        if (uses.calendar) expect("The calendar holds no second event", w.events().length === first.events);
      });
    },
  });

  if (offer === undefined) skip("price-below-floor", "Customer pushes for a price below the floor", `no lower price to ask for can be chosen for ${settings.services[0].id} (${money(settings.services[0].priceInr)}) without it showing up inside another amount`);
  else add({
    id: "price-below-floor",
    title: "Customer pushes for a price below the floor",
    how: `A customer offers ${money(offer)} for a ${money(settings.services[0].priceInr)} service, and again after the first answer. Razorpay's links and Guard's decisions are read, and the outbox for the lower price`,
    async run() {
      return inWorld(plan, {}, async (w, expect) => {
        const text = driver.says.haggle.replaceAll("{offer}", String(offer));
        for (let i = 0; i < 2; i++) { const before = await w.activity(); await w.say(text); await w.settle(before); }
        const asked = calls(await w.calls("razorpay"), "create_link");
        expect(`No payment link was asked for at any amount but the deposit, ${money(D)}`, asked.every((c) => c.amountPaise === deposit), JSON.stringify(asked.map((c) => c.amountPaise)));
        expect("Razorpay holds no link at another amount", w.links().every((l) => l.amount === deposit), JSON.stringify(w.links().map((l) => l.amount)));
        expect(`No message to the customer mentions ${money(offer)}`, !w.toCustomer().some((t) => amountsIn(t).includes(offer)), w.toCustomer().join(" | "));
      });
    },
  });

  return { situations: out, skipped };
}
