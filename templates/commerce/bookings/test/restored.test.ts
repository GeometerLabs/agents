// A shop put back from last night's snapshot (the deploy bundle's `restore`), while the world went on: the stand-ins (Razorpay through a Guard model, the calendar,
// WhatsApp) keep what happened after the snapshot, and the runtime's own database goes back a day. Nothing that already happened may happen again: a refund sent today
// is not sent twice, a hold that the owner approved today is not called "nothing was refunded", and a new booking never takes an id that was used after the snapshot,
// so it can never be handed another customer's payment link or move another customer's calendar event.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createGuardModel } from "../../../../modules/payments/guard-model.ts";
import { createFakePayments } from "../../../../modules/payments/payments.ts";
import type { FakePayments } from "../../../../modules/payments/payments.ts";
import { MINUTE } from "../../../../modules/core/time.ts";
import { CUSTOMER, HARNESS_GUARD, OTHER_CUSTOMER, glowSalon } from "../src/harness.ts";
import { razorpayLimitsSpec } from "../src/guard-limits.ts";
import { parseSettings } from "../src/settings.ts";
import { createKit } from "./runtime-kit.ts";
import type { Kit } from "./runtime-kit.ts";
import type { Runtime } from "../server/runtime.ts";

const THIRD_CUSTOMER = "+919833333333";

/** Last night's snapshot: a consistent copy of the runtime's database, taken while it runs (VACUUM INTO, as the nightly job does). */
function snapshot(kit: Kit): string {
  const copy = join(kit.dir, `snapshot-${kit.clock.now()}.db`);
  const live = new DatabaseSync(join(kit.dir, "data", "agent.db"), { readOnly: true });
  try { live.exec(`VACUUM INTO '${copy}'`); } finally { live.close(); }
  return copy;
}

/** What `geometer restore` does to the shop's volume: the runtime stopped, the database replaced by the snapshot's, and the note beside it. */
async function putBack(kit: Kit, runtime: Runtime, copy: string): Promise<void> {
  await runtime.close();
  for (const f of ["agent.db", "agent.db-wal", "agent.db-shm"]) rmSync(join(kit.dir, "data", f), { force: true });
  writeFileSync(join(kit.dir, "data", "agent.db"), readFileSync(copy));
  writeFileSync(join(kit.dir, "data", "restored.json"), JSON.stringify({ snapshot: "20261103T013000Z", restoredAt: new Date(kit.clock.now()).toISOString(), lastSeq: null }));
}

async function paid(kit: Kit, runtime: Runtime, payments: FakePayments, text: string, from = CUSTOMER): Promise<void> {
  await kit.say(runtime, text, { from });
  const link = payments.links().at(-1)!;
  payments.customerPays(link.id);
  runtime.submit(payments.events.filter((e) => e.event === "payment_link.paid" && e.payload.payment_link?.id === link.id).map((event) => ({ kind: "payment_event" as const, event })));
  runtime.kick(); await runtime.idle();
}

test("a refund that was waiting to be sent again in last night's snapshot, and went out today, is not sent twice after the restore", async () => {
  const kit = createKit();
  try {
    let { runtime, db } = kit.open();
    await paid(kit, runtime, kit.payments, "haircut day after tomorrow at 6pm");
    kit.payments.inject("refund", "error", { times: 2 }); // nothing goes out: the refund waits to be tried again (refund_retry)
    await kit.say(runtime, "cancel my booking");
    assert.equal(kit.payments.refunds().length, 0);
    assert.equal(runtime.status().refunds.beingSentAgain, 1);
    const night = snapshot(kit);
    kit.clock.advance(2 * MINUTE);
    await runtime.tick();
    assert.equal(kit.payments.refunds().length, 1, "today: the refund went out");
    // the restore: yesterday's database, with the refund still waiting to be sent again
    await putBack(kit, runtime, night);
    ({ runtime, db } = kit.open());
    assert.equal(runtime.status().refunds.beingSentAgain, 1, "the restored shop still believes the refund is to be sent");
    kit.clock.advance(5 * MINUTE);
    await runtime.tick();
    assert.equal(kit.payments.refunds().length, 1, "Razorpay's own list showed it: not sent again");
    assert.equal(runtime.status().refunds.beingSentAgain, 0);
    const record = db.loadState().record;
    const restoredAt = record.findIndex((e) => e.action === "restored");
    assert.ok(restoredAt >= 0, "the record says the shop was restored");
    const after = record.slice(restoredAt);
    assert.ok(after.some((e) => e.action === "refund" && e.outcome === "confirmed" && e.refs.refundId === kit.payments.refunds()[0].id), "the refund is recorded as made, from Razorpay's list");
    assert.ok(!after.some((e) => e.action === "refund" && e.outcome === "failed"));
    assert.ok(!existsSync(join(kit.dir, "data", "restored.json")));
    await runtime.close();
  } finally { kit.cleanup(); }
});

test("a refund Guard held in last night's snapshot, which the owner approved and Guard sent today, is not called 'nothing was refunded' when its time runs out after the restore", async () => {
  const kit = createKit();
  const settings = parseSettings({ ...JSON.parse(JSON.stringify(glowSalon())), cancellation: { windowHours: 24, refundLimitInr: 100 } });
  const guard = createGuardModel(razorpayLimitsSpec(settings, HARNESS_GUARD), kit.clock);
  const payments = createFakePayments(kit.clock, { guard }); // Guard's own store is not part of the shop's database: a restore does not touch it
  const open = () => kit.open({ settings, services: { calendar: kit.calendar, payments, messaging: kit.messaging } });
  try {
    let { runtime, db } = open();
    await paid(kit, runtime, payments, "haircut day after tomorrow at 6pm");
    await kit.say(runtime, "cancel my booking");
    assert.equal(runtime.status().refunds.waitingForOwner, 1);
    const night = snapshot(kit);
    // today: the owner approves on WhatsApp, the relay tells the runtime, and it sends the held call; Guard lets it through once
    const held = guard.reviews("runtime-glow-salon", true)[0];
    guard.decide(held.id, true, "owner");
    runtime.submit([{ kind: "approval_decision", approval: held.id, decision: "approve" }]);
    runtime.kick(); await runtime.idle();
    assert.equal(payments.refunds().length, 1);
    // the restore: the hold is back, still waiting for the owner, and the relay will not say again what it already said
    await putBack(kit, runtime, night);
    ({ runtime, db } = open());
    assert.equal(runtime.status().refunds.waitingForOwner, 1);
    kit.clock.advance(guard.ttlMs + MINUTE);
    await runtime.tick();
    assert.equal(payments.refunds().length, 1, "nothing was sent again");
    const status = runtime.status();
    assert.deepEqual([status.refunds.waitingForOwner, status.refunds.needBuilder.total], [0, 0], "nothing is left for the builder: the refund was found");
    const record = db.loadState().record;
    const after = record.slice(record.findIndex((e) => e.action === "restored"));
    assert.ok(after.some((e) => e.action === "refund" && e.outcome === "confirmed" && /time ran out here, but the payments service's own list shows the refund/u.test(e.notes)));
    assert.ok(!after.some((e) => e.action === "refund" && e.outcome === "failed"), "never 'nothing was refunded'");
    await runtime.close();
  } finally { kit.cleanup(); }
});

test("after the restore a new booking takes an id no booking used after the snapshot, so it is never given another customer's paid link or calendar event", async () => {
  const kit = createKit();
  try {
    let { runtime, db } = kit.open();
    await kit.say(runtime, "haircut day after tomorrow at 6pm"); // b-1, waiting for its deposit
    const night = snapshot(kit);
    // today, after the snapshot: the first customer pays, and a second one books b-2 and pays too
    const first = kit.linkFor("b-1")!;
    kit.payments.customerPays(first.id);
    await kit.deliverPaymentEvents(runtime);
    await paid(kit, runtime, kit.payments, "haircut tomorrow at 6pm", OTHER_CUSTOMER);
    const secondsLink = kit.linkFor("b-2")!;
    assert.equal(secondsLink.status, "paid");
    const secondsEvent = (await kit.calendar.list({ bookingRef: "b-2" }))[0];
    // the restore: the shop's next id is 2 again
    await putBack(kit, runtime, night);
    ({ runtime, db } = kit.open());
    // a third customer books: without the move this would be b-2, and "look first" would find the second customer's paid link and take it as this booking's deposit
    await kit.say(runtime, "haircut day after tomorrow at 11am", { from: THIRD_CUSTOMER });
    const third = [...(JSON.parse(db.loadState().snapshot!).bookings as [string, { id: string; customer: string; state: string; linkId?: string }][])].map(([, b]) => b).find((b) => b.customer === THIRD_CUSTOMER)!;
    assert.equal(third.id, "b-100002");
    assert.equal(third.state, "awaiting_deposit", "not confirmed: nobody paid for it");
    assert.notEqual(third.linkId, secondsLink.id);
    assert.equal(kit.linkFor("b-100002")!.status, "created");
    const still = (await kit.calendar.list({ bookingRef: "b-2" }))[0];
    assert.deepEqual([still.id, still.start, still.status], [secondsEvent.id, secondsEvent.start, secondsEvent.status], "the second customer's event was not moved");
    // the first customer's payment, made after the snapshot, is found on Razorpay's list when the hold's time comes: booked, not refunded
    kit.clock.advance(30 * MINUTE);
    await runtime.tick();
    const firstBooking = (JSON.parse(db.loadState().snapshot!).bookings as [string, { id: string; state: string }][]).find(([id]) => id === "b-1")![1];
    assert.equal(firstBooking.state, "confirmed");
    assert.equal(kit.payments.refunds().length, 0);
    await runtime.close();
  } finally { kit.cleanup(); }
});
