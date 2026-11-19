// LIMITS AND APPROVALS, as the outside sees them (group ii of the contract, README.md). The refund limit in the settings is the threshold of the payments Guard (the stub Guard
// is built from the limits spec the deployer generates from the same settings): a refund AT the limit goes straight through, one rupee ABOVE is HELD by the Guard, the customer is
// told the owner will confirm, the approvals relay (here: the test) carries the owner's decision to the shop as an `approval_decision` event, and the shop sends the SAME BYTES again,
// once. Every way it can go wrong ends without a second refund: a forged answer, a repeat, a no, an approval that ran out, a Guard refusal by a limit, "already done" and "outcome
// unknown". Also what needs the OWNER (a late cancellation's refund, asked of the owner, who answers from their page by the digest of what was shown). Expected values come from
// test/refund-held, approvals-runtime, guard-limits, limits-runtime and guard-responses; the Guard's answers are the captured ones in test/fixtures/guard-responses.json.
import { after, describe } from "node:test";
import assert from "node:assert/strict";
import { ALWAYS_OPEN, MIN, OWNER_BASE, contract, makeShop, soonStart, sleep } from "./harness.ts";
import type { Shop } from "./harness.ts";
import { fixture } from "./guards.ts";
import { ownerKit, qr } from "../../../../modules/test/contract/owner-kit.ts";

const { register } = ownerKit(OWNER_BASE);
const shops: Shop[] = [];
after(async () => { for (const s of shops) { await s.stop(); await s.cleanup(); } });
async function boot(o: Parameters<typeof makeShop>[0] = {}): Promise<Shop> { const s = await makeShop({ mode: "guards", ...o }); shops.push(s); await s.start(); return s; }
const limited = (refundLimitInr: number) => ({ cancellation: { windowHours: 24, refundLimitInr } });
const link = (s: Shop) => s.guards!.standins.fakes.payments.links()[0];
const refundCalls = (s: Shop) => s.guards!.of("payments", "POST", /\/refund$/u);

/** A paid web booking, then the customer cancels it in good time: with a ₹100 limit the ₹200 refund is held by the Guard. */
async function heldRefund(o: Parameters<typeof makeShop>[0] = {}): Promise<{ s: Shop; hash: string; approval: string; paymentId: string }> {
  const s = await boot({ settings: limited(100), ...o });
  const { hash } = await s.book();
  const events = s.guards!.pay(link(s).id);
  await s.events(events.map((event) => ({ kind: "payment_event", event }))); await s.settle();
  await s.channelEvents([{ kind: "channel_request", id: "cancel-1", channel: "web", op: "cancel", handle: hash }]); await s.settle();
  const [review] = s.guards!.stub.model.reviews("x", true);
  return { s, hash, approval: review.id, paymentId: link(s).payments[0].id };
}
const decideAtGuard = (s: Shop, approval: string, yes: boolean) => assert.equal(s.guards!.stub.model.decide(approval, yes, "owner-contract").status, 200);
const relay = async (s: Shop, approval: string, decision: "approve" | "deny", id: string) => { const a = await s.events([{ kind: "approval_decision", approval, decision, id }]); assert.equal(a.status, 200, JSON.stringify(a.body)); await s.settle(); };

describe("the refund limit and the hold", () => {
  contract("at the limit a refund goes straight through; one rupee above it is held by the Guard and nobody is refunded", async () => {
    const at = await boot({ settings: limited(200) });
    const a = await at.book();
    await at.events(at.guards!.pay(link(at).id).map((event) => ({ kind: "payment_event", event }))); await at.settle();
    await at.channelEvents([{ kind: "channel_request", id: "c-1", channel: "web", op: "cancel", handle: a.hash }]); await at.settle();
    assert.equal(at.guards!.standins.fakes.payments.refunds().length, 1, "₹200 with a ₹200 limit: through");
    assert.equal(refundCalls(at)[0].status, 200);
    assert.deepEqual(at.guards!.stub.model.reviews("x", true), [], "nobody was asked");

    const over = await boot({ settings: limited(199) });
    const b = await over.book();
    await over.events(over.guards!.pay(link(over).id).map((event) => ({ kind: "payment_event", event }))); await over.settle();
    await over.channelEvents([{ kind: "channel_request", id: "c-1", channel: "web", op: "cancel", handle: b.hash }]); await over.settle();
    assert.equal(over.guards!.standins.fakes.payments.refunds().length, 0, "₹200 with a ₹199 limit: held");
    assert.equal(refundCalls(over)[0].status, 202);
    assert.equal(over.guards!.stub.model.reviews("x", true).length, 1);
  });

  contract("held: the customer is told the owner will confirm, the owner is not asked by the shop, and the relay can read what it may know about the refund", async () => {
    const { s, hash, approval, paymentId } = await heldRefund();
    assert.equal(refundCalls(s).length, 1);
    assert.deepEqual(refundCalls(s)[0].body, { amount: 20000, receipt: `b-1:${paymentId}` });
    assert.equal(s.guards!.standins.fakes.payments.refunds().length, 0, "nothing was refunded");
    assert.match((await s.request(hash)).body.messages.at(-1).text, /owner will confirm your ₹200 refund/u);
    assert.deepEqual(s.guards!.of("messaging"), []);
    assert.deepEqual((await s.status()).refunds, { waitingForOwner: 1, beingSentAgain: 0, needBuilder: { total: 0 } });
    const asked = s.record().filter((r) => r.action === "refund" && r.outcome === "held_for_owner");
    assert.equal(asked.length, 1);
    assert.equal(asked[0].refs.approval, approval, "the record names the Guard's approval");
    // the refund-context endpoint: the inbox's token only, only for a refund that is held, nothing the relay should not know
    const receipt = encodeURIComponent(`b-1:${paymentId}`);
    assert.equal((await s.call(`/internal/refund-context?receipt=${receipt}`, { token: null })).status, 401);
    assert.equal((await s.call(`/internal/refund-context?receipt=${receipt}`, { token: s.channel })).status, 401);
    assert.equal((await s.call("/internal/refund-context")).status, 400);
    assert.equal((await s.call("/internal/refund-context?receipt=b-9:pay_nope")).status, 404);
    const ctx = (await s.call(`/internal/refund-context?receipt=${receipt}`)).body;
    assert.deepEqual(ctx, { booking: "b-1", customerPhone: "+919811111111", businessName: "Glow Salon", timeZone: "Asia/Kolkata", ownerLanguage: "en", serviceName: "haircut", slotMs: ctx.slotMs, paymentId, amountPaise: 20000, approval, expiresAtMs: ctx.expiresAtMs });
    assert.ok(ctx.expiresAtMs > s.now() + 23 * 60 * MIN, "the approval lasts 24 hours");
  });

  contract("approved: the SAME bytes are sent again, once; the same answer again, an approval for something else, and time send nothing more", async () => {
    const { s, approval, paymentId } = await heldRefund({ tickSeconds: 1 });
    decideAtGuard(s, approval, true);
    await relay(s, approval, "approve", "d-1");
    const calls = refundCalls(s);
    assert.equal(calls.length, 2, "the held call and its resend");
    assert.equal(JSON.stringify(calls[1].body), JSON.stringify(calls[0].body), "byte for byte the same body");
    assert.equal(calls[1].status, 200);
    assert.deepEqual(s.guards!.standins.fakes.payments.refunds().map((r) => [r.payment_id, r.amount, r.receipt]), [[paymentId, 20000, `b-1:${paymentId}`]]);
    assert.deepEqual((await s.status()).refunds, { waitingForOwner: 0, beingSentAgain: 0, needBuilder: { total: 0 } });
    for (const [i, a] of [[2, approval], [3, approval], [4, "ap-not-ours-9"]] as const) await relay(s, a, "approve", `d-${i}`);
    await sleep(2500); await s.settle(); // two beats of the clock
    assert.equal(refundCalls(s).length, 2, "no third call");
    assert.equal(s.guards!.standins.fakes.payments.refunds().length, 1);
    assert.ok(s.record().filter((r) => r.action === "owner_decision" && r.outcome === "blocked").length >= 2, "answers nobody was waiting for are in the record and do nothing");
    assert.deepEqual(s.record().filter((r) => r.action === "owner_decision" && r.outcome === "confirmed").map((r) => r.refs.command), ["approve"], "the owner's approval is counted once, after the Guard released the call");
  });

  contract("a forged approval, one the Guard has no approval behind, makes the shop ask the Guard once, and the Guard holds it as before", async () => {
    const { s, approval } = await heldRefund();
    await relay(s, approval, "approve", "forged-1"); // nobody approved at the Guard
    assert.equal(refundCalls(s).length, 2, "one more look at the Guard");
    assert.equal(refundCalls(s)[1].status, 202, "and it said it is still held");
    assert.equal(s.guards!.standins.fakes.payments.refunds().length, 0);
    assert.deepEqual((await s.status()).refunds.waitingForOwner, 1);
    assert.deepEqual(s.record().filter((r) => r.action === "owner_decision" && r.outcome === "confirmed"), [], "an approval counts only when the Guard released the call");
    assert.equal(s.record().filter((r) => r.action === "owner_decision" && r.outcome === "attempted").length, 1);
  });

  contract("a no is final: the customer is told, nothing is sent, and the Guard is not asked about this payment again", async () => {
    const { s, hash, approval } = await heldRefund({ tickSeconds: 1 });
    decideAtGuard(s, approval, false);
    await relay(s, approval, "deny", "d-1");
    assert.equal(s.guards!.standins.fakes.payments.refunds().length, 0);
    assert.match((await s.request(hash)).body.messages.at(-1).text, /decided not to refund the ₹200/u);
    const calls = s.guards!.calls.length;
    await sleep(2200); await s.settle();
    assert.equal(refundCalls(s).length, 1, "the Guard is not asked about this payment again");
    assert.deepEqual(s.guards!.calls.slice(calls).filter((c) => c.method !== "GET").map((c) => `${c.method} ${c.path}`), [], "nothing is written anywhere");
    assert.deepEqual((await s.status()).refunds, { waitingForOwner: 0, beingSentAgain: 0, needBuilder: { total: 0 } });
  });

  contract("no blind retries: a held refund is never sent again on a timer", async () => {
    const { s } = await heldRefund({ tickSeconds: 1 });
    const before = refundCalls(s).length;
    await sleep(3200); await s.settle();
    assert.equal(refundCalls(s).length, before);
    assert.equal(s.guards!.stub.model.reviews("x", true).length, 1, "still one ask, still the same one");
  });

  contract("an approval event that is not well formed is refused whole, and one for another case is saved and does nothing", async () => {
    const s = await boot();
    for (const bad of [{ kind: "approval_decision", approval: "ap-1" }, { kind: "approval_decision", decision: "approve" }, { kind: "approval_decision", approval: "ap 1", decision: "approve" }, { kind: "approval_decision", approval: "ap-1", decision: "maybe" }, { kind: "approval_decision", approval: "ap-1", decision: "approve", id: "x y" }]) {
      assert.equal((await s.events([bad])).status, 400, JSON.stringify(bad));
    }
    const ok = await s.events([{ kind: "approval_decision", approval: "ap-none-1", decision: "approve", id: "r-1" }]);
    assert.deepEqual([ok.body.saved, ok.body.duplicates], [1, 0]);
    assert.deepEqual((await s.events([{ kind: "approval_decision", approval: "ap-none-1", decision: "approve", id: "r-1" }])).body.duplicates, 1, "a repeat of the same answer is one");
    await s.settle();
    assert.deepEqual(s.guards!.calls, [], "nobody was waiting for it: no call");
  });
});

describe("the Guard says no", () => {
  const refund = { match: (c: { method: string; path: string }) => c.method === "POST" && /\/refund$/u.test(c.path) };
  async function paid(o: Parameters<typeof makeShop>[0] = {}): Promise<{ s: Shop; hash: string }> {
    const s = await boot(o);
    const { hash } = await s.book();
    await s.events(s.guards!.pay(link(s).id).map((event) => ({ kind: "payment_event", event }))); await s.settle();
    return { s, hash };
  }
  const cancel = async (s: Shop, hash: string): Promise<void> => { await s.channelEvents([{ kind: "channel_request", id: "cancel-1", channel: "web", op: "cancel", handle: hash }]); await s.settle(); };

  contract("a refund the Guard refuses by a limit (the day's cap): nothing is refunded, it is not tried again, and the builder is told, not the owner", async () => {
    const { s, hash } = await paid({ tickSeconds: 1 });
    s.guards!.payments.answer(fixture("guard-responses.json").refused_limit, { times: 5, match: refund.match });
    await cancel(s, hash);
    assert.equal(s.guards!.standins.fakes.payments.refunds().length, 0);
    await sleep(2500); await s.settle();
    assert.equal(refundCalls(s).length, 1, "tried once, not again");
    const st = await s.status();
    assert.equal(st.refunds.needBuilder.total, 1, "it is on the builder's list");
    assert.equal(st.refunds.waitingForOwner, 0, "the owner is not asked");
    const outcomes = s.record().filter((r) => r.action === "refund").map((r) => r.outcome);
    assert.ok(outcomes.length >= 1 && !outcomes.includes("confirmed"), `the refund line says it did not happen: ${JSON.stringify(outcomes)}`);
  });

  contract("409 already_done: a refund a person at the server settled as made is done by their word and never sent again", async () => {
    const { s, hash } = await paid({ tickSeconds: 1 });
    s.guards!.payments.answer(fixture("guard-responses.json").already_done, { times: 1, match: refund.match });
    await cancel(s, hash);
    await sleep(2200); await s.settle();
    assert.equal(refundCalls(s).length, 1);
    assert.equal(s.guards!.standins.fakes.payments.refunds().length, 0, "the shop made no refund of its own");
    assert.deepEqual((await s.status()).refunds, { waitingForOwner: 0, beingSentAgain: 0, needBuilder: { total: 0 } }, "settled: nothing is waiting");
    assert.ok(s.record().some((r) => r.action === "refund" && r.outcome === "confirmed"), JSON.stringify(s.record().filter((r) => r.action === "refund")));
  });

  contract("any other 409, and a 5xx from the provider, mean the refund may or may not have happened: not sent again, and the builder is told", async () => {
    for (const answer of [fixture("guard-responses.json").conflict, fixture("guard-responses.json").outcome_unknown]) {
      const { s, hash } = await paid({ tickSeconds: 1 });
      s.guards!.payments.answer(answer, { times: 1, match: refund.match });
      await cancel(s, hash);
      await sleep(2200); await s.settle();
      assert.equal(refundCalls(s).length, 1, `${answer.status}: tried once`);
      assert.equal(s.guards!.standins.fakes.payments.refunds().length, 0);
      assert.equal((await s.status()).refunds.needBuilder.total, 1, `${answer.status}: the builder is told`);
    }
  });

  contract("the Guard stopped (a kill switch): nothing was sent, so the shop tries again by itself, and the customer's booking is cancelled either way", async () => {
    const { s, hash } = await paid();
    s.guards!.stub.killSwitch(true);
    await cancel(s, hash);
    assert.equal((await s.request(hash)).body.status, "cancelled");
    assert.equal(s.guards!.standins.fakes.payments.refunds().length, 0);
    const st = await s.status();
    assert.deepEqual(st.refunds, { waitingForOwner: 0, beingSentAgain: 1, needBuilder: { total: 0 } }, "it waits to be sent again, by itself, a little later: it is not lost and nobody is asked");
    s.guards!.stub.killSwitch(false);
  });
});

describe("what needs the owner", () => {
  contract("a late cancellation of a paid booking is the owner's question, asked on their page by a digest, and only an exact answer moves money", async () => {
    const s = await boot({ settings: ALWAYS_OPEN });
    const { hash } = await s.book({ startMs: soonStart(s.now()) });
    await s.events(s.guards!.pay(link(s).id).map((event) => ({ kind: "payment_event", event }))); await s.settle();
    await s.channelEvents([{ kind: "channel_request", id: "late-1", channel: "web", op: "cancel", handle: hash }]); await s.settle();
    assert.deepEqual(refundCalls(s), [], "inside the 24 hours the shop does not refund by itself");
    const [item] = (await s.ownerView()).body.items;
    assert.deepEqual([item.kind, item.case, item.amountPaise, item.actions], ["late_refund", "b-1", 20000, ["approve", "deny"]]);
    const press = (id: string, action: string, digest: string, owner = true) => s.channelEvents([{ kind: "owner_action", id, action, case: "b-1", digest }], owner ? { owner: true } : {});
    assert.equal((await press("o-0", "approve", item.digest, false)).status, 403, "no refund for someone who is not the owner");
    await press("o-1", "approve", "f".repeat(32)); await s.settle();
    assert.deepEqual(refundCalls(s), [], "a digest of something the owner was not shown does nothing");
    await press("o-2", "approve", item.digest); await s.settle();
    assert.equal(refundCalls(s).length, 1);
    assert.deepEqual(refundCalls(s)[0].body, { amount: 20000, receipt: `b-1:${link(s).payments[0].id}` });
    assert.deepEqual((await s.ownerView()).body.items, [], "answered");
    await press("o-3", "approve", item.digest); await s.settle();
    assert.equal(refundCalls(s).length, 1, "the same press again is not a second refund");
  });

  contract("the owner refusing a late refund sends nothing, and the customer is told", async () => {
    const s = await boot({ settings: ALWAYS_OPEN });
    const { hash } = await s.book({ startMs: soonStart(s.now()) });
    await s.events(s.guards!.pay(link(s).id).map((event) => ({ kind: "payment_event", event }))); await s.settle();
    await s.channelEvents([{ kind: "channel_request", id: "late-1", channel: "web", op: "cancel", handle: hash }]); await s.settle();
    const [item] = (await s.ownerView()).body.items;
    await s.channelEvents([{ kind: "owner_action", id: "o-1", action: "deny", case: "b-1", digest: item.digest }], { owner: true }); await s.settle();
    assert.deepEqual(refundCalls(s), []);
    assert.match((await s.request(hash)).body.messages.at(-1).text, /decided not to refund/u);
  });
});

describe("the limits the owner may tighten", () => {
  const limits = async (s: Shop): Promise<any> => (await s.call("/internal/limit-changes")).body;
  const tighten = (s: Shop, session: string, id: string, limit: string, to: number) => s.call("/internal/channel/owner-limits", { session, body: { id, limit, to } });

  contract("a change needs the owner's passkey session: the panel's link may read the page but not change it", async () => {
    const s = await boot();
    const read = await s.call("/internal/channel/owner-limits", { owner: s.owner });
    assert.equal(read.status, 200);
    assert.equal(read.body.passkey, false, "a panel-made link is not a passkey session");
    assert.deepEqual(read.body.limits.map((l: { id: string; inForce: number; file: number }) => [l.id, l.inForce, l.file]), [["refund_limit", 200, 200]]);
    const refused = await s.call("/internal/channel/owner-limits", { owner: s.owner, body: { id: "x-1", limit: "refund_limit", to: 50 } });
    assert.deepEqual([refused.status, refused.body.state], [403, "passkey_needed"]);
    assert.equal((await s.call("/internal/channel/owner-limits", { session: "made-up", body: { id: "x-1", limit: "refund_limit", to: 50 } })).status, 403);
    assert.deepEqual((await limits(s)).changes, [], "nothing was changed");
    assert.equal((await s.call("/internal/limit-changes", { token: null })).status, 401);
  });

  contract("tightened by a tap: pending at once, the deployer's word settles it (failed puts the old limit back, active keeps the new), a loosening or an undeclared limit changes nothing", async () => {
    const s = await boot({ clock: false });
    const { session } = await register(s, qr(s.setup));
    const row = async () => (await limits(s)).limits[0] as { id: string; inForce: number; file: number };
    assert.deepEqual(await row(), { ...(await row()), id: "refund_limit", inForce: 200, file: 200 });
    assert.equal((await tighten(s, session, "o-1", "refund_limit", 100)).status, 200); await s.settle();
    const v1 = await limits(s);
    assert.deepEqual(v1.changes.map((c: any) => [c.id, c.state, c.direction, c.by, c.from, c.to]), [["l-1", "pending", "tighten", "owner_app", 200, 100]]);
    assert.equal(v1.limits[0].inForce, 100, "obeyed at once");
    assert.equal(v1.limits[0].file, 200, "the file's own value is what the runtime started with");
    // the deployer could not finish it
    const failed = await s.call("/internal/limit-changes", { body: { id: "r-1", change: "l-1", result: "failed", why: "the deploy did not go through" } });
    assert.equal(failed.status, 200); await s.settle();
    assert.deepEqual([(await limits(s)).changes[0].state, (await row()).inForce], ["failed", 200]);
    // a second try, settled active; the same word twice is one
    await tighten(s, session, "o-2", "refund_limit", 150); await s.settle();
    for (let i = 0; i < 2; i++) await s.call("/internal/limit-changes", { body: { id: "r-2", change: "l-2", result: "active" } });
    await s.settle();
    assert.deepEqual((await limits(s)).changes.map((c: any) => [c.id, c.state]), [["l-1", "failed"], ["l-2", "active"]]);
    assert.equal((await row()).inForce, 150);
    // loosening past the template's bound, and a limit that is not declared
    await tighten(s, session, "o-3", "refund_limit", 900); await tighten(s, session, "o-4", "deposit", 1); await s.settle();
    assert.equal((await limits(s)).changes.length, 2, "no third change");
    assert.equal((await row()).inForce, 150);
    assert.deepEqual(s.record().filter((r) => r.action === "limit_change" && r.outcome === "blocked").length >= 1, true, "the refusal is in the record");
    for (const bad of [{ id: "x", limit: "refund_limit" }, { id: "x y", limit: "refund_limit", to: 1 }, { id: "x", limit: "Refund", to: 1 }, { id: "x", limit: "refund_limit", to: 1.5 }]) {
      assert.equal((await s.call("/internal/channel/owner-limits", { session, body: bad })).status, 400, JSON.stringify(bad));
    }
    assert.equal((await s.call("/internal/limit-changes", { body: { id: "r-9", change: "l-1", result: "maybe" } })).status, 400);
  });
});
