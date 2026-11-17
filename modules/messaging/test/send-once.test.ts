// Send once (modules/messaging/send-once.ts), tried on its own with a stand-in sender, before any template uses it: the claim is saved before the send and the ending after; a claim
// with no ending is never sent again; only a refusal that says nothing went out is tried again, an hour later, three tries at most; a person's word settles an unconfirmed
// message once, and "send it again" is a new intent. Written 17 Nov 2026 (not yet run: the one test pass is at the end).
import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, NotSentError, TimeoutError } from "../../core/faults.ts";
import { HOUR } from "../../core/time.ts";
import { MAX_TRIES, RETRY_AFTER_MS, nextIntentId, nothingWasSent, openUnknowns, queueSend, resolveUnknown, runSendOnce } from "../send-once.ts";
import type { SendEnding, SendIntent, SendOnceState } from "../send-once.ts";
import type { SaidOutcome } from "../say.ts";

/** A sender over a state, with the order of what happened written down: "claim:x", "save:claimed", "send:x", "save:confirmed", ... */
function harness(outcomes: (SaidOutcome | Error)[] = ["accepted"]) {
  const state: SendOnceState = { intents: [] };
  const events: string[] = [];
  const settled: [string, SendEnding][] = [];
  const notified: [string, SendEnding][] = [];
  let now = 1_000_000;
  let sends = 0;
  const run = () => runSendOnce({
    state, now: () => now,
    recordClaim: (i) => { events.push(`claim:${i.id}`); },
    recordEnding: (i, ending) => { events.push(`ending:${i.id}:${ending}`); },
    deliver: async (i) => { events.push(`send:${i.id}`); sends += 1; const next = outcomes[Math.min(sends - 1, outcomes.length - 1)]; if (next instanceof Error) throw next; return next; },
    settle: (i, ending) => { settled.push([i.id, ending]); },
    notify: async (i, ending) => { notified.push([i.id, ending]); },
    save: () => { events.push(`save:${state.intents.map((i) => i.status).join(",")}`); },
  });
  const ask = (id = "po-1:order:1"): SendIntent => queueSend(state, { id, kind: "purchase_order", caseId: "po-1", to: "+919876500001", toName: "Ravi Traders", templates: ["supplier_order"], values: { orderRef: "po-1" }, createdMs: now })!;
  return { state, events, settled, notified, run, ask, sends: () => sends, advance: (ms: number) => { now += ms; } };
}

test("the happy path: the claim is saved before the send, the ending after, and it is sent once however often the job runs", async () => {
  const h = harness();
  h.ask();
  await h.run();
  assert.deepEqual(h.events, ["claim:po-1:order:1", "save:claimed", "send:po-1:order:1", "save:confirmed", "save:confirmed"]); // the last save keeps the owner's words with the rest
  assert.equal(h.state.intents[0].status, "confirmed");
  assert.equal(h.state.intents[0].tries, 1);
  assert.deepEqual(h.settled, [["po-1:order:1", "confirmed"]]);
  assert.deepEqual(h.notified, [["po-1:order:1", "confirmed"]]);
  await h.run();
  await h.run();
  assert.equal(h.sends(), 1);
});

test("a claim with no ending (the process died after the claim, or after the send) is never sent: it ends unconfirmed, and the case hears it", async () => {
  const h = harness();
  const i = h.ask();
  i.status = "claimed"; // what a dead process left in the saved state
  i.tries = 1;
  await h.run();
  assert.equal(h.sends(), 0);
  assert.equal(i.status, "unconfirmed");
  assert.match(i.note ?? "", /may or may not/u);
  assert.deepEqual(h.events.filter((e) => e.startsWith("ending:")), ["ending:po-1:order:1:unconfirmed"]);
  assert.deepEqual(h.settled, [["po-1:order:1", "unconfirmed"]]);
  await h.run();
  assert.equal(h.sends(), 0, "still not sent on the next run");
  assert.deepEqual(openUnknowns(h.state).map((x) => x.id), ["po-1:order:1"]);
});

test("a send whose reply was lost ends unconfirmed and is not sent again", async () => {
  const h = harness(["maybe"]);
  h.ask();
  await h.run();
  await h.run();
  assert.equal(h.sends(), 1);
  assert.equal(h.state.intents[0].status, "unconfirmed");
});

test("a send that throws is unconfirmed unless the error says nothing went out", async () => {
  const lost = harness([new TimeoutError("send message")]);
  lost.ask();
  await lost.run();
  assert.equal(lost.state.intents[0].status, "unconfirmed");
  const refused = harness([new NotSentError("connection refused"), "accepted"]);
  refused.ask();
  await refused.run();
  assert.equal(refused.state.intents[0].status, "failed");
  assert.deepEqual([new ApiError(400, "x"), new NotSentError("x")].map(nothingWasSent), [true, true]);
  assert.deepEqual([new ApiError(500, "x"), new TimeoutError("x")].map(nothingWasSent), [false, false]);
});

test("a refusal is tried again once, an hour later and not before, then it is sent once", async () => {
  const h = harness(["not_sent", "accepted"]);
  const i = h.ask();
  await h.run();
  assert.equal(i.status, "failed");
  assert.equal(h.sends(), 1);
  assert.deepEqual(h.settled.at(-1), ["po-1:order:1", "failed"]);
  h.advance(RETRY_AFTER_MS - 60_000);
  await h.run();
  assert.equal(h.sends(), 1, "not before the hour");
  h.advance(2 * 60_000);
  await h.run();
  assert.equal(h.sends(), 2);
  assert.equal(i.status, "confirmed");
  assert.equal(i.tries, 2);
  h.advance(10 * HOUR);
  await h.run();
  assert.equal(h.sends(), 2, "a confirmed message is never tried again");
});

test("a refusal that goes on is given up after the third try, and the case hears gave_up, once", async () => {
  const h = harness(["not_sent"]);
  const i = h.ask();
  for (let n = 0; n < MAX_TRIES + 2; n++) { await h.run(); h.advance(RETRY_AFTER_MS + 1); }
  assert.equal(h.sends(), MAX_TRIES);
  assert.equal(i.status, "gave_up");
  assert.deepEqual(h.settled.filter(([, e]) => e === "gave_up"), [["po-1:order:1", "gave_up"]]);
});

test("a message a gate held back is final: not tried again", async () => {
  const h = harness(["held_back"]);
  const i = h.ask();
  await h.run();
  h.advance(5 * HOUR);
  await h.run();
  assert.equal(h.sends(), 1);
  assert.equal(i.status, "blocked");
});

test("an intent id is queued once, and the next ask for the same case and kind gets the next number", () => {
  const h = harness();
  assert.ok(h.ask());
  assert.equal(h.ask(), undefined);
  assert.equal(nextIntentId(h.state, "po-1", "purchase_order"), "po-1:purchase_order:2");
});

test("a person settles an unconfirmed message once; \"send it again\" is a new intent and a new claim, never made by the job", async () => {
  const h = harness(["maybe", "accepted"]);
  h.ask();
  await h.run();
  assert.equal(openUnknowns(h.state).length, 1);
  assert.equal(resolveUnknown(h.state, "po-1:order:1", "owner_send_again")?.resolved, "owner_send_again");
  assert.equal(resolveUnknown(h.state, "po-1:order:1", "owner_got_it"), undefined, "only once");
  assert.equal(openUnknowns(h.state).length, 0);
  await h.run();
  assert.equal(h.sends(), 1, "settling sends nothing by itself");
  queueSend(h.state, { id: nextIntentId(h.state, "po-1", "purchase_order"), kind: "purchase_order", caseId: "po-1", to: "+919876500001", toName: "Ravi Traders", templates: ["supplier_order"], values: {}, createdMs: 0 });
  await h.run();
  assert.equal(h.sends(), 2);
  assert.deepEqual(h.state.intents.map((i) => i.status), ["unconfirmed", "confirmed"]);
  assert.equal(h.events.filter((e) => e.startsWith("claim:")).length, 2, "the second send had its own claim");
});

test("resolveUnknown refuses a message that is not unconfirmed", async () => {
  const h = harness();
  h.ask();
  await h.run();
  assert.equal(resolveUnknown(h.state, "po-1:order:1", "owner_got_it"), undefined);
  assert.equal(resolveUnknown(h.state, "nope", "owner_got_it"), undefined);
});
