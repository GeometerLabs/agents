// The to-do list's recovery steps (plan B31) and the owner's agreement to a handover (B38), as the Fees agent does them: look again, ask again, never more.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ROHAN_PARENT, createWorld } from "../src/harness.ts";
import type { World } from "../src/harness.ts";
import { handoverHash } from "../../../../modules/approvals/handover.ts";

const recover = (w: World, action: string, id: string, c: string) => w.agent.handle({ kind: "recovery", id, case: c, action });
const entries = (w: World, action: string) => w.record.entries().filter((e) => e.action === action);

async function opened(): Promise<World> {
  const w = createWorld();
  await w.advance(61); // the month's fees are opened and reminded
  return w;
}

test("recheck_payment counts a payment the webhook never brought, by reading the payments service's own list", async () => {
  const w = await opened();
  const due = w.dueOf("Rohan Mehta")!;
  w.pays("Rohan Mehta"); // the webhook is never delivered
  assert.equal(due.state, "open");
  await recover(w, "recheck_payment", "r-1", due.id);
  assert.equal(w.dueOf("Rohan Mehta")!.state, "paid");
  assert.ok(w.record.isConfirmed(due.id, "record_payment"));
  assert.deepEqual(entries(w, "recovery").map((e) => e.outcome), ["attempted", "confirmed"]);
  assert.deepEqual(entries(w, "recovery")[0].refs, { action: "recheck_payment", recovery: "r-1" });
});

test("ask_owner_again sends the owner a waiver request again, with the same reference, and tells the parent nothing", async () => {
  const w = await opened();
  const due = w.dueOf("Rohan Mehta")!;
  due.pending.push({ kind: "waiver", id: "q-1", amountInr: 900, balanceAtAskInr: 1800, askedAtMs: w.clock.now() });
  const owner = w.textsTo(w.owner).length;
  const parent = w.textsTo(ROHAN_PARENT).length;
  await recover(w, "ask_owner_again", "r-1", due.id);
  assert.equal(w.textsTo(w.owner).length, owner + 1);
  assert.match(w.lastTextTo(w.owner), /approve q-1/u);
  assert.equal(w.textsTo(ROHAN_PARENT).length, parent);
  assert.equal(due.pending.length, 1, "the request is still the one request");
  assert.deepEqual(entries(w, "recovery").map((e) => e.outcome), ["attempted", "confirmed"]);
});

test("an action that does not fit, retry_booking (a Bookings action), and a fee that is not there are refused in the record and change nothing", async () => {
  const w = await opened();
  const due = w.dueOf("Rohan Mehta")!;
  const before = JSON.stringify([...w.store.dues.values()]);
  const texts = w.textsTo(w.owner).length + w.textsTo(ROHAN_PARENT).length;
  await recover(w, "ask_owner_again", "r-1", due.id); // nothing waits on the owner
  await recover(w, "recheck_refund", "r-2", due.id); // no refund problem
  await recover(w, "retry_booking", "r-3", due.id); // not a fees action
  await recover(w, "recheck_payment", "r-4", "f-99"); // not a fee
  assert.deepEqual(entries(w, "recovery").map((e) => e.outcome), ["blocked", "blocked", "blocked", "blocked"]);
  assert.equal(JSON.stringify([...w.store.dues.values()]), before);
  assert.equal(w.textsTo(w.owner).length + w.textsTo(ROHAN_PARENT).length, texts);
  assert.equal(entries(w, "refund").length, 0);
});

test("'move CODE' from the owner's number is the owner agreeing to a handover: one line in the record with the code's hash, no reply", async () => {
  const w = createWorld();
  const outbox = w.textsTo(w.owner).length;
  await w.ownerSays("MOVE K7M2QX");
  const [e] = entries(w, "handover_agreed");
  assert.equal(e.outcome, "confirmed");
  assert.equal(e.conversation, w.owner);
  assert.deepEqual(e.refs, { command: "handover", handover: handoverHash("K7M2QX") });
  assert.equal(w.textsTo(w.owner).length, outbox, "no reply");
  assert.equal(entries(w, "owner_decision").length, 0);
  await w.say("move K7M2QX", { from: ROHAN_PARENT });
  assert.equal(entries(w, "handover_agreed").length, 1, "a parent's message with the same words is only a parent's message");
});
