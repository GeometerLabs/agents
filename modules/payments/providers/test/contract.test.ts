// The one contract every payment provider must pass (B71): what makes a contributed module acceptable. Each provider in the registry (providers/index.ts) runs the
// same situations through the same neutral flow the templates use (links.ts ensureLink, refunds.ts, the owner-marked ledger), behind the same Guard model where it
// has a gateway, and over its own wire format: its adapter speaks HTTP to a stub Guard, which speaks to its own stand-in, which keeps the in-memory fake.
//
// A situation that cannot apply to a provider (UPI sends no refund, so a refund reply cannot be lost) is NOT skipped: it is its own test, named "does not apply",
// which asserts the capability that makes it so and that the call is refused in plain words. A new provider gets every row of this table, and a row that is
// neither passed nor shown not to apply is a failing test.
//
//   situation                         gateway (confirms and refunds by itself)                      owner-marked (UPI)
//   lost reply                         a lost create and a lost refund are looked for, never made twice  does not apply: the request is the agent's own store; no refund is sent
//   duplicate and late events          the same body twice is one event; a late one is judged by read-back  the same mark twice counts once; a mark after the close is kept apart
//   never refunding more than paid     above the payment is refused; a second refund of a payment is not sent  what is owed is counted against the payment, so nothing is left to owe twice
//   a held refund                      held for the owner, sent once after the approval, never again      does not apply: no refund is sent; the owed one waits for the owner's mark
//   a refund that fails                a 5xx is looked for once, never repeated; a refusal stops it        does not apply: the owner pays; an unmarked one is reminded three times, then listed
//   B33: screenshot, other amount, never, twice, after the release     does not apply: the provider's own record confirms         each as B33 says
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeClock } from "../../../core/clock.ts";
import type { FakeClock } from "../../../core/clock.ts";
import { createRecord } from "../../../record/record.ts";
import { createGuardClient } from "../../../approvals/clients.ts";
import { startStubGuard } from "../../../standins/guard.ts";
import { serveHandlers } from "../../../standins/http.ts";
import { DEFAULT_CAPS, paymentLimitsSpecFrom } from "../../guard-limits.ts";
import { ensureLink } from "../../links.ts";
import { createFakePayments } from "../../payments.ts";
import type { FakePayments, Payments } from "../../payments.ts";
import { createRefunds } from "../../refunds.ts";
import type { RefundCase } from "../../refunds.ts";
import { closeRequest, emptyMarkState, markReceived, markRefund, markedPayments, oweRefund, owedOn, reminded, remindersDue, OwnerPaysError, REFUND_REMINDERS_MAX, REFUND_REMINDER_EVERY_MS } from "../../owner-marked/ledger.ts";
import type { MarkState } from "../../owner-marked/ledger.ts";
import { MARK_ACTIONS, markObligations } from "../../owner-marked/obligations.ts";
import { PROVIDERS, ownerMarkedOf } from "../index.ts";
import { gatewayRuntime } from "../runtime.ts";
import type { PaymentProvider } from "../types.ts";

const T0 = Date.UTC(2026, 10, 10, 4, 30);
const OWNER = "+919800000000";
const CUSTOMER = "+919811111111";
const DEPOSIT = 20_000; // paise
const LIMIT_INR = 150; // the owner's refund limit: above it Guard holds the refund
const SECRET = "contract-owner-secret-0123456789";

/** The settings block of a provider's own example: what a shop that chose it writes. */
function blockOf(p: PaymentProvider) {
  const errors: string[] = [];
  const block = p.readSettings(JSON.parse(p.example) as Record<string, unknown>, errors);
  assert.deepEqual(errors, [], `${p.id}: its own example settings read without a problem`);
  return block!;
}

// ---- a gateway, over its own wire format, behind the stub Guard ------------------------------------------------------------------------

/** `payments` goes through the stub Guard, as an agent's does; `direct` speaks to the stand-in with no Guard, for what Guard does not stand in front of here (a create). */
interface GatewayKit { clock: FakeClock; fake: FakePayments; payments: Payments; direct: Payments; guard: Awaited<ReturnType<typeof startStubGuard>>; close(): Promise<void> }

async function gatewayKit(p: PaymentProvider): Promise<GatewayKit> {
  const g = p.gateway!;
  const wire = gatewayRuntime(p.id);
  const clock = fakeClock(T0);
  const fake = createFakePayments(clock);
  const served = await serveHandlers([wire.standin.handler(fake)]);
  const spec = paymentLimitsSpecFrom({
    identity: { tenant: "contract", version: 1, reviewedBy: "contract-test" }, approvalTtlSeconds: 86_400, caps: DEFAULT_CAPS,
    link: { ruleId: "deposit-amount", minPaise: DEPOSIT, maxPaise: DEPOSIT }, refundBound: { ruleId: "refund-at-most-deposit", maxPaise: DEPOSIT }, refundThresholdPaise: LIMIT_INR * 100,
  }, g.guard);
  const guard = await startStubGuard({ clock, upstreamUrl: served.url, spec, approver: { id: "owner", secret: SECRET }, readToken: "contract-read" });
  const payments = wire.adapter({ baseUrl: guard.agentUrl, timeoutMs: 3_000 });
  return { clock, fake, payments, direct: wire.adapter({ baseUrl: served.url, timeoutMs: 3_000 }), guard, close: async () => { await guard.close(); await served.close(); } };
}

interface Booking extends RefundCase { linkId?: string }
/** The refund flow every template uses (refunds.ts), on one booking, with the record kept as a plain list. */
function refundFlow(payments: Payments, clock: FakeClock) {
  const b: Booking = { id: "b-1", customer: CUSTOMER, pending: [] };
  const log: { action: string; outcome: string; notes?: string }[] = [];
  const told: string[] = [];
  const flow = createRefunds<Booking>({
    payments, clock, owner: OWNER, limitInr: () => LIMIT_INR,
    log: (_c, _phone, action, outcome, _inputs, more) => { log.push({ action, outcome, ...(more?.notes ? { notes: more.notes } : {}) }); },
    tellCustomer: async (_c, _p, templates) => { told.push(...templates); return true; },
    tellCustomerOutcome: async (_c, _p, id) => { told.push(id); return "accepted"; },
    tellOwner: async (_c, _p, template) => { told.push(template); return true; },
    cases: () => [b],
    ids: { checking: "refund_checking", denied: "refund_denied", approved: "refund_approved", expired: "refund_expired", settled: "refund_settled", confirmed: "refund_confirmed" },
  });
  return { b, log, told, flow };
}

/** The customer pays a deposit request made the careful way (look first, write, read back). */
async function paidDeposit(kit: GatewayKit): Promise<{ requestId: string; paymentId: string }> {
  const made = await ensureLink(kit.payments, { reference: "b-1", amountPaise: DEPOSIT, description: "Deposit b-1" });
  assert.ok(made.link, made.error);
  const paid = kit.fake.customerPays(made.link!.id);
  return { requestId: made.link!.id, paymentId: paid.id };
}

// ---- an owner-marked provider: the agent's own ledger ------------------------------------------------------------------------------

interface MarkedKit { clock: FakeClock; state: MarkState; payments: Payments }
function markedKit(p: PaymentProvider): MarkedKit {
  const clock = fakeClock(T0);
  const state = emptyMarkState();
  return { clock, state, payments: markedPayments(state, ownerMarkedOf(blockOf(p))!.payLink, clock) };
}

// ---- the table -------------------------------------------------------------------------------------------------------------------------

for (const p of PROVIDERS) {
  const can = p.capabilities;
  const gateway = can.confirmsAutomatically;

  test(`${p.id}: declares a consistent module (a gateway has an API and a Guard; a module that cannot confirm says how the owner is paid)`, () => {
    assert.equal(gateway, p.gateway !== undefined, "confirms by itself exactly when it has a gateway API behind Guard");
    assert.equal(!gateway, p.ownerMarked !== undefined, "cannot confirm by itself exactly when a person marks payments");
    if (can.refundsAutomatically) assert.ok(p.gateway, "a module that refunds by itself does it through its gateway, behind Guard");
    if (p.gateway) {
      const g = p.gateway.guard;
      const ops = new Set(g.routes.map((r) => r.operation));
      for (const op of Object.values(g.ops)) assert.ok(ops.has(op), `${op} has a route`);
      for (const f of g.forbidden) assert.ok(ops.has(f.operation), `the forbidden ${f.operation} is routed, so Guard can refuse it by name`);
      assert.ok(g.reads.record.every((op) => ops.has(op)) && g.reads.panel.every((op) => ops.has(op)), "the reading credentials only read routed operations");
      assert.equal(p.id, g.tool, "the module's id is its Guard's tool name");
      assert.doesNotThrow(() => gatewayRuntime(p.id), "a gateway has its wire code in providers/runtime.ts");
    }
    assert.match(p.signup, /SIGNUP\.md$/u);
  });

  // ---- lost reply ----
  if (gateway) {
    test(`${p.id}: lost reply: a request whose reply was lost is looked for and found, never made twice; a refund whose reply was lost is looked for once and never sent again`, async () => {
      const kit = await gatewayKit(p);
      try {
        kit.fake.inject("createRequest", "lostReply");
        const made = await ensureLink(kit.direct, { reference: "b-1", amountPaise: DEPOSIT, description: "Deposit b-1" });
        assert.ok(made.link, "the request is found by its reference after the lost reply");
        assert.equal(kit.fake.links().length, 1, "one request at the provider");
        kit.fake.customerPays(made.link!.id);
        const paymentId = kit.fake.links()[0].payments[0].id;
        const { b, flow } = refundFlow(kit.payments, kit.clock);
        kit.fake.inject("refund", "lostReply");
        assert.equal(await flow.requestRefund(b, paymentId, 100, [], false), "done", "the provider's own list shows the refund");
        assert.equal(kit.fake.refunds().length, 1, "one refund, not two");
        assert.equal(await flow.requestRefund(b, paymentId, 100, [], false), "done", "asked again, it is found, not sent");
        assert.equal(kit.fake.refunds().length, 1);
      } finally { await kit.close(); }
    });
  } else {
    test(`${p.id}: lost reply: does not apply: a request is written in the agent's own store in the same step (no reply to lose), and no refund is ever sent`, async () => {
      const kit = markedKit(p);
      assert.equal(can.readsBack, false);
      const first = await ensureLink(kit.payments, { reference: "b-1", amountPaise: DEPOSIT, description: "Deposit b-1" });
      const again = await ensureLink(kit.payments, { reference: "b-1", amountPaise: DEPOSIT, description: "Deposit b-1" });
      assert.equal(first.link?.id, again.link?.id, "looking first still finds the one request");
      assert.equal(kit.state.requests.length, 1);
      await assert.rejects(kit.payments.refund("x", { amount: 100 }), (e: unknown) => e instanceof OwnerPaysError && /never sends a refund/u.test((e as Error).message));
    });
  }

  // ---- duplicate and late events ----
  if (gateway) {
    test(`${p.id}: duplicate and late events: the same signed body twice is one event with one id; a tampered one fails; a late one is judged by reading the provider back`, async () => {
      const kit = await gatewayKit(p);
      try {
        const w = gatewayRuntime(p.id).webhook;
        const { requestId, paymentId } = await paidDeposit(kit);
        const bodies = kit.fake.events.map((e) => gatewayRuntime(p.id).standin.webhookBody(e, kit.fake));
        assert.ok(bodies.length >= 2, "a payment and a paid request were announced");
        const raw = Buffer.from(bodies[0]);
        const sig = w.sign(raw, "webhook-secret-123");
        assert.ok(w.verify(raw, sig, "webhook-secret-123"));
        assert.ok(!w.verify(Buffer.from(bodies[0].replace("20000", "20001")), sig, "webhook-secret-123"), "a changed body is not the provider's");
        assert.ok(!w.verify(raw, sig, ""), "an empty secret verifies nothing");
        const once = w.read(JSON.parse(bodies[0]));
        const twice = w.read(JSON.parse(bodies[0]));
        assert.ok(once && twice && once.id === twice.id, "a repeat carries the same id, so a template's seen-events list drops it");
        assert.deepEqual(new Set(bodies.map((b) => w.read(JSON.parse(b))?.event)), new Set(["payment.received", "request.paid"]), "read into the neutral events");
        // late: the payment is refunded, then the old event arrives. The event only says "look"; the read-back says what is true now.
        const { b, flow } = refundFlow(kit.payments, kit.clock);
        assert.equal(await flow.requestRefund(b, paymentId, 100, [], false), "done", "a refund within the owner's limit");
        const late = w.read(JSON.parse(bodies[0]));
        assert.equal(late?.event, "payment.received");
        const now = await kit.payments.fetchPayment(paymentId);
        assert.equal(now?.amount_refunded, 10_000, "the read-back shows the refund the late event does not");
        assert.equal((await kit.payments.fetchRequest(requestId))?.payments.length, 1, "one payment on the request, however many times it was announced");
      } finally { await kit.close(); }
    });
  } else {
    test(`${p.id}: duplicate and late events: the owner's same mark twice counts once; a mark after the agent closed the request is kept apart and pays nothing open`, async () => {
      const kit = markedKit(p);
      const made = await ensureLink(kit.payments, { reference: "b-1", amountPaise: DEPOSIT, description: "Deposit b-1" });
      const code = kit.state.requests[0].code!;
      assert.equal(markReceived(kit.state, code, undefined, kit.clock.now()).kind, "marked");
      assert.equal(markReceived(kit.state, code, undefined, kit.clock.now()).kind, "already", "the same code again counts nothing");
      assert.equal((await kit.payments.fetchRequest(made.link!.id))?.payments.length, 1);
      const late = await ensureLink(kit.payments, { reference: "b-2", amountPaise: DEPOSIT, description: "Deposit b-2" });
      const lateCode = kit.state.requests[1].code!;
      closeRequest(kit.state.requests[1], kit.clock.now());
      const after = markReceived(kit.state, lateCode, undefined, kit.clock.now());
      assert.ok(after.kind === "marked" && after.afterClose, "recorded as received after the close");
      assert.equal((await kit.payments.fetchRequest(late.link!.id))?.status, "cancelled", "the closed request stays closed: a template does not book on it by itself");
    });
  }

  // ---- never refunding more than was paid ----
  if (can.refundsAutomatically) {
    test(`${p.id}: never refunds more than was paid: above the payment is refused before anything is sent, and a second refund of the same payment is not sent`, async () => {
      const kit = await gatewayKit(p);
      try {
        const { paymentId } = await paidDeposit(kit);
        const { b, log, flow } = refundFlow(kit.payments, kit.clock);
        assert.equal(await flow.requestRefund(b, paymentId, DEPOSIT / 100 + 1, [], true), "stopped", "more than the deposit is refused by Guard's bound");
        assert.equal(kit.fake.refunds().length, 0, "nothing was refunded");
        assert.ok(log.some((e) => e.outcome === "blocked" && /refund-at-most-deposit/u.test(e.notes ?? "")), "the record names the rule");
        const other = refundFlow(kit.payments, kit.clock);
        assert.equal(await other.flow.requestRefund(other.b, paymentId, 100, [], false), "done");
        const third = refundFlow(kit.payments, kit.clock);
        third.b.id = "b-9"; // a different receipt: a different refund of the same payment
        assert.equal(await third.flow.requestRefund(third.b, paymentId, 50, [], false), "stopped", "one refund per payment: Guard does not send a second");
        const refunded = kit.fake.refunds().reduce((n, r) => n + r.amount, 0);
        assert.ok(refunded <= DEPOSIT && kit.fake.refunds().length === 1, `refunded ${refunded} of ${DEPOSIT}`);
      } finally { await kit.close(); }
    });
  } else {
    test(`${p.id}: never refunds more than was paid: what the owner owes is counted against the payment, so the agent never owes the same money twice`, async () => {
      const kit = markedKit(p);
      await ensureLink(kit.payments, { reference: "b-1", amountPaise: DEPOSIT, description: "Deposit b-1" });
      const marked = markReceived(kit.state, kit.state.requests[0].code!, undefined, kit.clock.now());
      assert.equal(marked.kind, "marked");
      const paymentId = marked.kind === "marked" ? marked.mark.id : "";
      oweRefund(kit.state, { caseId: "b-1", customer: CUSTOMER, paymentId, amountPaise: DEPOSIT, why: "cancelled" }, kit.clock.now());
      const payment = await kit.payments.fetchPayment(paymentId);
      assert.equal(owedOn(kit.state, paymentId), DEPOSIT);
      assert.equal(payment!.amount - payment!.amount_refunded, 0, "nothing is left on the payment to owe again");
    });
  }

  // ---- a held refund ----
  if (can.refundsAutomatically) {
    test(`${p.id}: a held refund: above the owner's limit it is held, sent once with the same bytes after the owner's approval, and never again`, async () => {
      const kit = await gatewayKit(p);
      try {
        const { paymentId } = await paidDeposit(kit);
        const { b, flow } = refundFlow(kit.payments, kit.clock);
        assert.equal(await flow.requestRefund(b, paymentId, DEPOSIT / 100, [], true), "held");
        assert.equal(kit.fake.refunds().length, 0, "nothing sent while it waits");
        const hold = b.pending.find((x) => x.kind === "guard_hold") as { approval: string } | undefined;
        assert.ok(hold);
        const client = createGuardClient({ adminUrl: kit.guard.adminUrl, readToken: "contract-read", approverId: "owner", approverSecret: SECRET, now: () => kit.clock.now() });
        assert.equal((await client.notify(hold!.approval, "approve")).kind, "recorded");
        await flow.onApprovalDecision({ approval: hold!.approval, decision: "approve" });
        assert.equal(kit.fake.refunds().length, 1, "sent once");
        await flow.onApprovalDecision({ approval: hold!.approval, decision: "approve" });
        assert.equal(kit.fake.refunds().length, 1, "the same approval again sends nothing");
        assert.equal(b.pending.length, 0);
      } finally { await kit.close(); }
    });
  } else {
    test(`${p.id}: a held refund: does not apply: no refund is ever sent; an owed refund waits for the owner's own mark, and only then reads as paid out`, async () => {
      const kit = markedKit(p);
      assert.equal(can.refundsAutomatically, false);
      await assert.rejects(kit.payments.resendRefund("x", "{}"), (e: unknown) => e instanceof OwnerPaysError);
      const r = oweRefund(kit.state, { caseId: "b-1", customer: CUSTOMER, paymentId: "upi-pay-1", amountPaise: 5_000, why: "cancelled" }, kit.clock.now());
      assert.equal((await kit.payments.listRefunds("upi-pay-1"))[0].status, "pending", "owed, not paid out");
      assert.equal(markRefund(kit.state, r.code!, "done", kit.clock.now()).kind, "done");
      assert.equal((await kit.payments.listRefunds("upi-pay-1"))[0].status, "processed");
    });
  }

  // ---- a refund that fails ----
  if (can.refundsAutomatically) {
    test(`${p.id}: a refund that fails: a provider 5xx is looked for once and never repeated; a declined refund moves nothing and is not sent again; Guard down sends nothing`, async () => {
      // the provider stored the refund and answered 500: it may have happened, so the agent looks once, finds it, and sends nothing more
      const kit = await gatewayKit(p);
      try {
        const { paymentId } = await paidDeposit(kit);
        const { b, flow } = refundFlow(kit.payments, kit.clock);
        kit.fake.inject("refund", "serverError");
        assert.equal(await flow.requestRefund(b, paymentId, 100, [], false), "done", "looked for once, and found on the provider's own list");
        assert.equal(kit.fake.refunds().length, 1);
        assert.equal(await flow.requestRefund(b, paymentId, 100, [], false), "done", "asked again, found, never sent");
        assert.equal(kit.fake.refunds().length, 1);
      } finally { await kit.close(); }
      // the provider declines the refund: no money moves, the customer is not told it was sent, and it is not tried again by itself
      const declined = await gatewayKit(p);
      try {
        const { paymentId } = await paidDeposit(declined);
        const { b, log, told, flow } = refundFlow(declined.payments, declined.clock);
        declined.fake.inject("refund", "declined");
        const result = await flow.requestRefund(b, paymentId, 100, [], false);
        assert.equal(result, "stopped", "a declined refund is for the builder to look at, not something to send again");
        await flow.afterRefund(b, result, { paymentId, amountInr: 100, done: { customer: "refund_done" }, held: "refund_held" });
        assert.equal(declined.fake.refunds().length, 0, "nothing was refunded");
        assert.equal((await declined.payments.fetchPayment(paymentId))?.amount_refunded, 0);
        assert.ok(!told.includes("refund_done"), "the customer was never told it was sent");
        assert.ok(log.some((e) => e.outcome === "unconfirmed" && /NOT sent again/u.test(e.notes ?? "")), "the record says it was not sent again");
        assert.equal(await flow.requestRefund(b, paymentId, 100, [], false), "stopped", "a second ask is blocked, not sent");
        assert.equal(declined.fake.calls.filter((c) => c.op === "refund").length, 1, "the provider was asked once");
      } finally { await declined.close(); }
      // Guard cannot decide: nothing went out, and it is tried again later by the clock, never at once in a loop
      const down = await gatewayKit(p);
      try {
        const paid = await paidDeposit(down);
        const again = refundFlow(down.payments, down.clock);
        down.guard.killSwitch(true);
        assert.equal(await again.flow.requestRefund(again.b, paid.paymentId, 100, [], false), "retry");
        assert.equal(down.fake.refunds().length, 0);
      } finally { await down.close(); }
    });
  } else {
    test(`${p.id}: a refund that fails: does not apply: the owner pays every refund; one never marked is reminded at most ${REFUND_REMINDERS_MAX} times and stays on the owner's list`, () => {
      const kit = markedKit(p);
      const r = oweRefund(kit.state, { caseId: "b-1", customer: CUSTOMER, paymentId: "upi-pay-1", amountPaise: 5_000, why: "cancelled" }, kit.clock.now());
      let sent = 0;
      for (let day = 1; day <= 10; day++) {
        kit.clock.advance(REFUND_REMINDER_EVERY_MS);
        for (const due of remindersDue(kit.state, kit.clock.now())) { reminded(due, kit.clock.now()); sent++; }
      }
      assert.equal(sent, REFUND_REMINDERS_MAX);
      assert.equal(r.state, "owed", "still owed: the record lists it until the owner marks it");
    });
  }

  // ---- B33's situations ----
  if (gateway) {
    test(`${p.id}: B33 (a screenshot as proof, another amount, never, twice, after the release): does not apply: the provider's own record confirms a payment, never a person`, () => {
      assert.equal(can.confirmsAutomatically, true);
      assert.equal(p.ownerMarked, undefined);
    });
  } else {
    test(`${p.id}: B33: a screenshot marks nothing; another amount leaves the rest with a new code; never confirmed stays listed; twice counts once; after the release is kept apart`, async () => {
      const kit = markedKit(p);
      const record = createRecord(kit.clock);
      const add = (action: string, refs: Record<string, string>) => record.append({ conversation: CUSTOMER, booking: "b-1", action, inputs: {}, outcome: "confirmed", language: "en", refs } as never);
      await ensureLink(kit.payments, { reference: "b-1", amountPaise: DEPOSIT, description: "Deposit b-1" });
      const request = kit.state.requests[0];
      add(MARK_ACTIONS.request, { requestId: request.id, reference: "b-1", amountPaise: String(DEPOSIT) });
      // a screenshot: a claim, not a payment
      add(MARK_ACTIONS.claim, { requestId: request.id, via: "screenshot" });
      assert.equal(request.marks.length, 0, "the screenshot marked nothing");
      assert.deepEqual(markObligations(record.entries()).map((o) => [o.kind, o.amountPaise]), [["upi_payment_unconfirmed", DEPOSIT]], "the owner is asked to look");
      // another amount: part of it, the rest with a new code
      const first = request.code!;
      const part = markReceived(kit.state, first, 5_000, kit.clock.now());
      assert.ok(part.kind === "marked" && !part.full && request.code && request.code !== first, "a part, and a new code for the rest");
      // twice: the used code counts nothing more
      assert.equal(markReceived(kit.state, first, 5_000, kit.clock.now()).kind, "already");
      // never: no mark for the rest, so it stays the owner's to look at
      add(MARK_ACTIONS.marked, { requestId: request.id, paymentId: part.kind === "marked" ? part.mark.id : "", amountPaise: "5000" });
      assert.deepEqual(markObligations(record.entries()).map((o) => o.amountPaise), [DEPOSIT - 5_000]);
      // after the release: the agent closes the request when the hold runs out; a later mark is recorded apart and books nothing
      closeRequest(request, kit.clock.now());
      const late = markReceived(kit.state, request.code!, undefined, kit.clock.now());
      assert.ok(late.kind === "marked" && late.afterClose && request.status === "cancelled");
    });
  }
}
