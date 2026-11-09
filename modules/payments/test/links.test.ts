import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeClock } from "../../core/clock.ts";
import { GuardRefusedError } from "../../core/faults.ts";
import { MINUTE } from "../../core/time.ts";
import { createGuardModel } from "../guard-model.ts";
import { DEFAULT_CAPS, razorpayLimitsSpecFrom } from "../guard-limits.ts";
import { ensureLink } from "../links.ts";
import { createFakePayments } from "../payments.ts";

const clock = () => fakeClock(Date.UTC(2026, 10, 3, 4, 30));

test("a payment link is made once, even when the reply to the create is lost: the next try looks first", async () => {
  const payments = createFakePayments(clock());
  payments.inject("createRequest", "lostReply");
  const made = await ensureLink(payments, { reference: "f-1.1", amountPaise: 150_000, description: "Tuition fee" });
  assert.ok(made.link, "the link is found in the payments service's own list");
  assert.equal(payments.links().length, 1);
  assert.equal(payments.links()[0].amount, 150_000);
  const again = await ensureLink(payments, { reference: "f-1.1", amountPaise: 150_000, description: "Tuition fee" });
  assert.equal(again.link?.id, made.link!.id, "asking again gives the same link");
  assert.equal(payments.links().length, 1);
});

test("a link that takes part payments is paid in pieces: partially paid until the amount is reached, and a piece below the minimum is refused", async () => {
  const payments = createFakePayments(clock());
  const { link } = await ensureLink(payments, { reference: "f-2.1", amountPaise: 150_000, description: "Tuition fee", acceptPartial: true, minPartialPaise: 10_000 });
  assert.equal(link!.part_payments, true);
  assert.throws(() => payments.customerPays(link!.id, { amount: 5_000 }), /not allowed/);
  payments.customerPays(link!.id, { amount: 50_000 });
  assert.equal((await payments.fetchRequest(link!.id))!.status, "partially_paid");
  assert.throws(() => payments.customerPays(link!.id, { amount: 150_000 }), /not allowed/, "more than is left");
  payments.customerPays(link!.id);
  const paid = (await payments.fetchRequest(link!.id))!;
  assert.equal(paid.status, "paid");
  assert.equal(paid.amount_paid, 150_000);
  assert.deepEqual(payments.events.map((e) => e.event), ["payment.received", "payment.received", "request.paid"], "the link announces being paid once, when it is");
});

test("Guard bounds the amount of a link: a link outside the range is refused before anything is sent", async () => {
  const clk = clock();
  const spec = razorpayLimitsSpecFrom({
    identity: { tenant: "t", version: 1, reviewedBy: "test" }, approvalTtlSeconds: 86_400, caps: DEFAULT_CAPS,
    link: { ruleId: "fee-amount", minPaise: 10_000, maxPaise: 200_000 }, refundBound: { ruleId: "refund-at-most-fee", maxPaise: 200_000 }, refundThresholdPaise: 50_000,
  });
  const payments = createFakePayments(clk, { guard: createGuardModel(spec, clk) });
  await payments.createRequest({ amount: 150_000, reference_id: "ok", description: "d" });
  for (const amount of [9_999, 200_001, 0]) {
    await assert.rejects(payments.createRequest({ amount, reference_id: `r-${amount}`, description: "d" }), (e: unknown) => e instanceof GuardRefusedError && e.ruleId === "fee-amount");
  }
  assert.equal(payments.links().length, 1, "only the first was created");
  void MINUTE;
});
