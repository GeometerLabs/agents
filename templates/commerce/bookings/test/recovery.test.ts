// The to-do list's recovery steps (plan B31) and the owner's agreement to a handover (B38), as the Bookings agent does them. A recovery step is an event the agent handles like any other:
// it looks again or asks again through the same code and the same Guard as every day, and it can never do more than that.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorld } from "../src/harness.ts";
import type { World } from "../src/harness.ts";
import { handoverHash } from "../../../../modules/approvals/handover.ts";
import { startServer } from "../server/server.ts";
import { createKit } from "./runtime-kit.ts";

const BOOK = "haircut tomorrow at 6pm";
const recover = (w: World, action: string, id = "r-1", c = "b-1") => w.agent.handle({ kind: "recovery", id, case: c, action });
const entries = (w: World, action: string) => w.record.entries().filter((e) => e.action === action);

async function stuckBooking(): Promise<World> {
  const w = createWorld();
  await w.say(BOOK);
  w.calendar.inject("update", "silentFailure", { times: 2 }); // the calendar will not confirm the paid booking
  w.payments.customerPays(w.linkFor("b-1")!.id);
  await w.deliverPaymentEvents();
  assert.equal(w.store.bookings.get("b-1")!.state, "needs_owner");
  return w;
}

test("retry_booking: a deposit is in and the calendar would not confirm; asked again, the calendar confirms it and only then is the customer told", async () => {
  const w = await stuckBooking();
  const told = w.textsTo("+919811111111").length;
  await recover(w, "retry_booking");
  assert.equal(w.store.bookings.get("b-1")!.state, "confirmed");
  assert.equal(w.textsTo("+919811111111").length, told + 1, "the customer hears 'booked' once, now");
  const mine = entries(w, "recovery");
  assert.deepEqual(mine.map((e) => e.outcome), ["attempted"]);
  assert.deepEqual(mine[0].refs, { action: "retry_booking", recovery: "r-1" });
  assert.ok(w.record.isConfirmed("b-1", "confirm_booking"), "the booking is confirmed by the calendar's own list, the way it always is");
});

test("retry_booking while the calendar still will not confirm: nothing is told the customer, and the booking stays on the owner", async () => {
  const w = await stuckBooking();
  w.calendar.inject("update", "silentFailure", { times: 5 });
  w.calendar.inject("insert", "silentFailure", { times: 5 });
  await recover(w, "retry_booking");
  assert.equal(w.store.bookings.get("b-1")!.state, "needs_owner", "never 'booked' on the strength of a button: only the calendar's own list can say so");
  assert.equal(w.record.isConfirmed("b-1", "confirm_booking"), false);
});

test("ask_owner_again sends the owner the same notice once more, and says nothing to the customer", async () => {
  const w = await stuckBooking();
  const owner = w.textsTo(w.owner).length;
  const customer = w.textsTo("+919811111111").length;
  await recover(w, "ask_owner_again");
  assert.equal(w.textsTo(w.owner).length, owner + 1);
  assert.match(w.lastTextTo(w.owner), /NOT booked/u);
  assert.equal(w.textsTo("+919811111111").length, customer);
  assert.deepEqual(entries(w, "recovery").map((e) => e.outcome), ["attempted", "confirmed"]);
});

test("recheck_payment reads the payments service's list for the booking's link and records a payment the webhook never brought", async () => {
  const w = createWorld();
  await w.say(BOOK);
  w.payments.customerPays(w.linkFor("b-1")!.id); // the webhook is never delivered
  assert.equal(w.store.bookings.get("b-1")!.state, "awaiting_deposit");
  await recover(w, "recheck_payment");
  assert.equal(w.store.bookings.get("b-1")!.state, "confirmed");
  assert.ok(w.record.isConfirmed("b-1", "record_deposit"));
  assert.deepEqual(entries(w, "recovery").map((e) => e.outcome), ["attempted", "confirmed"]);
});

test("an action that does not fit, an unknown action, and a booking that is not there are refused in the record and change nothing", async () => {
  const w = createWorld();
  await w.say(BOOK);
  const before = JSON.stringify([...w.store.bookings.values()]);
  const texts = w.textsTo(w.owner).length + w.textsTo("+919811111111").length;
  await recover(w, "retry_booking", "r-1"); // no deposit yet
  await recover(w, "ask_owner_again", "r-2"); // nothing is waiting on the owner
  await recover(w, "recheck_refund", "r-3"); // no refund problem
  await recover(w, "refund_everything", "r-4"); // not an action
  await recover(w, "recheck_payment", "r-5", "b-99"); // not a booking
  assert.deepEqual(entries(w, "recovery").map((e) => e.outcome), ["blocked", "blocked", "blocked", "blocked", "blocked"]);
  assert.equal(JSON.stringify([...w.store.bookings.values()]), before);
  assert.equal(w.textsTo(w.owner).length + w.textsTo("+919811111111").length, texts, "nothing was sent");
  assert.equal(entries(w, "refund").length, 0, "and no refund was asked for");
});

test("recheck_refund looks for a refund whose outcome was unclear, read-only: a refund on the list settles it, none is ever sent again", async () => {
  const w = createWorld();
  await w.say(BOOK);
  w.payments.customerPays(w.linkFor("b-1")!.id);
  await w.deliverPaymentEvents();
  const b = w.store.bookings.get("b-1")!;
  const paymentId = b.depositPaymentId!;
  b.refundIssues = [{ paymentId, kind: "unknown", note: "the outcome was not clear", atMs: w.clock.now() }];
  await recover(w, "recheck_refund");
  assert.equal(b.refundIssues.length, 1, "no refund on the list yet: the problem stays");
  assert.equal(w.payments.refunds().length, 0, "and nothing was sent");
  const refund = await w.payments.refund(paymentId, { amount: 20000, receipt: `b-1:${paymentId}` }); // the refund had gone after all
  await recover(w, "recheck_refund", "r-2");
  assert.equal(b.refundIssues.length, 0);
  assert.equal(w.payments.refunds().length, 1, "still the one refund");
  assert.ok(entries(w, "refund").some((e) => e.outcome === "confirmed" && e.refs.refundId === refund.id));
});

test("'move CODE' from the owner's number is the owner agreeing to a handover: one line in the record with the code's hash, no reply, and nothing else changes", async () => {
  const w = createWorld();
  const outbox = w.textsTo(w.owner).length;
  await w.say("move k7m2qx", { from: w.owner });
  const [e] = entries(w, "handover_agreed");
  assert.equal(e.outcome, "confirmed");
  assert.equal(e.conversation, w.owner);
  assert.deepEqual(e.refs, { command: "handover", handover: handoverHash("K7M2QX") });
  assert.ok(!JSON.stringify(e).includes("K7M2QX"), "the code itself is never in the record");
  assert.equal(w.textsTo(w.owner).length, outbox, "no reply");
  assert.equal(entries(w, "owner_decision").length, 0, "it is not counted as an approval or a refusal");
  // the same words from a customer are just a customer's message
  await w.say("move k7m2qx", { from: "+919811111111" });
  assert.equal(entries(w, "handover_agreed").length, 1);
});

test("the runtime's recovery endpoint: only with the token, only a well-formed request, saved once, and /internal/events refuses a recovery", async () => {
  const kit = createKit();
  const { runtime, db } = kit.open();
  const server = await startServer(runtime, { token: "test-token-0123456789abcdef", port: 0 });
  const post = (path: string, body: unknown, token = "test-token-0123456789abcdef") =>
    fetch(`${server.url}${path}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  try {
    assert.equal((await post("/internal/recover", { id: "r-1", case: "b-1", action: "recheck_payment" }, "")).status, 401);
    assert.equal((await post("/internal/recover", { id: "r-1", case: "b-1", action: "recheck_payment" }, "wrong")).status, 401);
    assert.equal((await post("/internal/recover", { id: "r 1", case: "b-1", action: "recheck_payment" })).status, 400);
    assert.equal((await post("/internal/recover", { id: "r-1", case: "../etc", action: "recheck_payment" })).status, 400);
    assert.equal((await post("/internal/recover", { id: "r-1", case: "b-1", action: "Recheck Payment" })).status, 400);
    assert.equal((await fetch(`${server.url}/internal/recover`, { headers: { authorization: "Bearer test-token-0123456789abcdef" } })).status, 405);
    const ok = await post("/internal/recover", { id: "r-1", case: "b-1", action: "recheck_payment" });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { saved: 1, duplicates: 0 });
    const again = await post("/internal/recover", { id: "r-1", case: "b-1", action: "recheck_payment" });
    assert.deepEqual(await again.json(), { saved: 0, duplicates: 1 }, "pressing the button twice is one request");
    await runtime.idle();
    const [recovery] = db.loadState().record.filter((e) => e.action === "recovery");
    assert.equal(recovery.outcome, "blocked", "there is no booking b-1 in an empty shop");
    // the inbox's endpoint does not take one
    const viaInbox = await post("/internal/events", { events: [{ kind: "recovery", id: "r-2", case: "b-1", action: "recheck_payment" }] });
    assert.equal(viaInbox.status, 400);
  } finally { await server.close(); await runtime.close(); kit.cleanup(); }
});
