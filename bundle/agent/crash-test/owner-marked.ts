// The crash-test situations for an agent someone else wrote that takes UPI through the owner-marked desk (B71). The world gives the agent the desk's address
// (GEOMETER_UPI_URL) and its one credential; the owner's "Received" is played here, from the owner's own number, the only way anything is ever marked paid.
//
// Judged from two places that are not the agent: the desk's own state (requests, the owner's marks, refunds owed) and the stand-in WhatsApp's record of what the
// customer was sent. One thing is read as words, and said so: whether a message to the customer says it is booked (driver.bookedWords) or refunded. That is all the
// crash test can check of an agent we did not write; nothing at run time reads its messages (see desk.ts for what the desk cannot check).
import { checker } from "../../../modules/crash-test/situations.ts";
import type { CheckResult, Situation, Skipped } from "../../../modules/crash-test/situations.ts";
import { formatInr } from "../../../modules/language/format.ts";
import { NotDrivable } from "./driver.ts";
import { buildWorld } from "./world.ts";
import type { CrashPlan, World } from "./world.ts";

/** The gateway situations, named here so a run on a UPI agent says why they did not run. */
export const GATEWAY_SITUATIONS: { id: string; title: string }[] = [
  { id: "booking-works", title: "A normal booking" }, { id: "payment-link-lost-reply", title: "The gateway created the link but the reply was lost" },
  { id: "refund-lost-reply", title: "The refund reply was lost" }, { id: "duplicate-payment-event", title: "The same payment event twice" },
  { id: "razorpay-key-expired", title: "The gateway key expired" }, { id: "refund-above-limit", title: "A refund above the owner's limit" },
  { id: "refund-more-than-paid", title: "A refund of more than was paid" },
];

const REFUNDED = /\brefund(ed)?\b.*\b(sent|done|back|processed)\b|\bmoney is back\b/iu;

async function inWorld(plan: CrashPlan, body: (w: World, expect: (label: string, ok: boolean, detail?: string) => void) => Promise<void>): Promise<CheckResult[]> {
  const { results, expect } = checker();
  const w = await buildWorld(plan);
  try {
    await body(w, expect);
    expect("The agent was still running at the end", w.alive(), `it stopped by itself${w.agent.output() ? `. It printed: ${w.agent.output()}` : ""}`);
  } finally {
    await w.close();
  }
  return results;
}

/** The customer books; the agent asks the desk for a request, or the situation cannot be run. */
async function bookAndRequest(w: World): Promise<{ id: string; at: number }> {
  for (const text of w.plan.driver.says.book) { const before = await w.activity(); await w.say(text); await w.settle(before); }
  const r = w.desk!.state.requests.at(-1);
  if (!r) throw new NotDrivable(`the agent asked the UPI desk for no request when the customer wrote ${w.plan.driver.says.book.map((t) => `"${t}"`).join(" then ")}. It must call GEOMETER_UPI_URL (POST /requests); see bundle/README.md`);
  return { id: r.id, at: w.toCustomer().length };
}

const booked = (w: World, from = 0) => w.toCustomer().slice(from).filter((t) => w.plan.driver.bookedWords.test(t));

// The situations for an agent taking UPI through the desk. The gateway ones are returned as skipped with a reason, so the certificate shows they were left out and why.
export function buildOwnerMarkedSituations(plan: CrashPlan): { situations: Situation[]; skipped: Skipped[] } {
  const D = plan.settings.deposit.amountInr;
  const out: Situation[] = [];
  const skipped: Skipped[] = GATEWAY_SITUATIONS.map((s) => ({ ...s, reason: "this agent takes UPI through the desk: there is no gateway, no payment link and no refund it can send, so these do not apply" }));

  out.push({
    id: "upi-paid-only-after-owner",
    title: "UPI: not booked on the customer's word, only after the owner marks the money received",
    how: "The customer books, then says they paid. Nobody marks anything; then the owner taps Received",
    async run() {
      return inWorld(plan, async (w, expect) => {
        const { id, at } = await bookAndRequest(w);
        const request = w.desk!.state.requests.find((r) => r.id === id)!;
        expect(`The request asks for the deposit, ${formatInr(D)}, and the customer was sent its link`, request.amountPaise === D * 100 && w.toCustomer().some((t) => t.includes(request.link)), w.toCustomer().join(" | "));
        const before = await w.activity();
        await w.say("I have paid");
        await w.settle(before);
        expect("The customer's word marked nothing paid", request.marks.length === 0);
        expect("No message to the customer says it is booked before the owner marked the money", booked(w, at).length === 0, w.toCustomer().slice(at).join(" | "));
        const beforeMark = w.toCustomer().length;
        expect("The owner's mark is accepted", (await w.ownerMarks(id)) === "marked");
        await w.until(() => booked(w, beforeMark).length > 0, 8_000);
        expect("After the owner's mark the customer was told it is booked, once", booked(w, beforeMark).length === 1, w.toCustomer().slice(beforeMark).join(" | ") || "nothing after the mark");
      });
    },
  });

  out.push({
    id: "upi-marked-twice",
    title: "UPI: the owner confirms twice, and it counts once",
    how: "The owner taps Received, then sends the same code again",
    async run() {
      return inWorld(plan, async (w, expect) => {
        const { id, at } = await bookAndRequest(w);
        const code = w.desk!.state.requests.find((r) => r.id === id)!.code!;
        expect("The first mark is accepted", (await w.ownerMarks(id, code)) === "marked");
        await w.until(() => booked(w, at).length > 0, 8_000);
        expect("The same code again counts nothing", (await w.ownerMarks(id, code)) === "already");
        await w.settle();
        const r = w.desk!.state.requests.find((x) => x.id === id)!;
        expect(`The desk counts ${formatInr(D)} once`, r.marks.reduce((n, m) => n + m.amountPaise, 0) === D * 100, JSON.stringify(r.marks));
        expect("The customer was told it is booked once", booked(w, at).length === 1, w.toCustomer().slice(at).join(" | "));
      });
    },
  });

  out.push({
    id: "upi-refund-owed",
    title: "UPI: a refund is owed by the owner, never sent by the agent, and never more than was marked",
    how: "A booking the owner marked paid is cancelled",
    async run() {
      return inWorld(plan, async (w, expect) => {
        const { id, at } = await bookAndRequest(w);
        await w.ownerMarks(id);
        await w.until(() => booked(w, at).length > 0, 8_000);
        const beforeCancel = w.toCustomer().length;
        const before = await w.activity();
        await w.say(w.plan.driver.says.cancel);
        await w.settle(before);
        const owed = w.desk!.state.refunds;
        if (owed.length === 0) throw new NotDrivable(`the agent owed no refund at the desk when the customer wrote "${w.plan.driver.says.cancel}". It must call GEOMETER_UPI_URL (POST /refunds); see bundle/README.md`);
        expect(`What is owed is at most the ${formatInr(D)} the owner marked`, owed.reduce((n, r) => n + r.amountPaise, 0) <= D * 100, JSON.stringify(owed.map((r) => r.amountPaise)));
        expect("The owner was told what to send back", w.desk!.notices.some((n) => n.template === "owner_upi_refund_owed"));
        expect("No message to the customer says the money was sent back before the owner marked it", !w.toCustomer().slice(beforeCancel).some((t) => REFUNDED.test(t)), w.toCustomer().slice(beforeCancel).join(" | "));
      });
    },
  });

  return { situations: out, skipped };
}
