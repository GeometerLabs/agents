// B37 (Guard's ADR-0061; the relay's contract is the monorepo's Deferred D82): a shop where the owner and two other people approve, and refunds above
// ₹150 need two of them. The relay asks exactly the people Guard says may still decide, each with their own one-use code, accepted only from that person's
// number and signed with that person's secret; a vote is not a decision; one no refuses; the person who asked never approves. Against the stand-in Guard
// (modules/standins/guard.ts, the model built from Guard's own words); approvals-guard-binary.test.ts runs the same story against the real geo-guard.
// A shop of the owner alone is approvals-relay.test.ts, unchanged.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { readAlready, readHeld } from "../../../../modules/approvals/clients.ts";
import { hashCode, openRelayStore } from "../../../../modules/approvals/store.ts";
import { readApprovers } from "../../../../modules/approvals/people.ts";
import { CUSTOMER } from "../src/harness.ts";
import { MEENA, RAVI, READER_ID, startApprovalsWorld } from "./helpers/approvals-world.ts";
import type { ApprovalsWorld } from "./helpers/approvals-world.ts";

const codeIn = (text: string) => /"approve ([A-Z0-9]+)"/u.exec(text)?.[1] ?? "";
const refunded = (w: ApprovalsWorld) => w.payments.refunds().length;
const run = (name: string, body: (w: ApprovalsWorld) => Promise<void>, options: Parameters<typeof startApprovalsWorld>[0] = {}) =>
  test(name, async () => { const w = await startApprovalsWorld(options); try { await body(w); } finally { await w.close(); } });
const TWO = { group: { twoAboveInr: 150 } }; // the ₹200 refund needs two of the owner, Ravi and Meena
const ONE = { group: { twoAboveInr: 500 } }; // the ₹200 refund needs one

run("two of three: each person is asked once with their own code, in their own language; one approval waits, the second sends the refund once", async (w) => {
  const approval = await w.heldRefund();
  const item = w.model.reviews("runtime-glow-salon", true)[0]!;
  assert.deepEqual([item.approvals_needed, item.may_still_decide], [2, ["meena", "owner", "ravi"]], "Guard's own list of whom to ask");
  await w.relay.poll();
  const [o, r, m] = [w.toOwner(), w.toPerson("ravi"), w.toPerson("meena")];
  assert.deepEqual([o.length, r.length, m.length], [1, 1, 1], "each person once");
  const codes = [codeIn(o[0]!.text), codeIn(r[0]!.text), codeIn(m[0]!.text)];
  assert.equal(new Set(codes).size, 3, "a fresh code each");
  assert.match(o[0]!.text, /^Approval needed: refund ₹200/u, "the owner in English");
  assert.match(r[0]!.text, /^मंज़ूरी चाहिए: /u, "Ravi in Hindi");
  assert.match(m[0]!.text, /^Approval needed: refund ₹200/u);
  assert.equal(r[0]!.templateName, "owner_approval_request", "nobody has written today, so the ask is the approved template");

  // the owner approves: a vote, not a decision. The runtime is not told; nothing is refunded.
  await w.ownerWrites(`approve ${codes[0]}`);
  assert.deepEqual(w.guard.accepted.map((a) => [a.approver, a.decision]), [["owner", "approve"]], "signed as the owner");
  assert.equal(w.model.approvals()[0]!.state, "pending");
  assert.equal(refunded(w), 0);
  assert.equal(w.toOwner().at(-1)!.text, `Thank you. Your approval of the ₹200 refund for ${CUSTOMER} is recorded. Approvals still needed from the others: 1. It is sent only once they are given.`);
  assert.equal(w.toOwner().length, 2);
  for (let i = 0; i < 3; i++) { w.clock.advance(5_000); await w.relay.poll(); }
  assert.deepEqual([w.toPerson("ravi").length, w.toPerson("meena").length], [1, 1], "nobody is asked again");

  // Ravi approves with his own code, from his own phone: approved, the runtime is told, the refund goes once
  await w.personWrites("ravi", `approve ${codes[1]}`);
  assert.deepEqual(w.guard.accepted.map((a) => a.approver), ["owner", "ravi"], "Ravi's answer is signed with Ravi's own secret");
  assert.equal(refunded(w), 1);
  assert.equal(w.payments.refunds()[0]!.amount, 20000);
  assert.match(w.kit.messaging.sentTo(CUSTOMER).at(-1)!.text, /owner approved your refund/);
  assert.match(w.toPerson("ravi").at(-1)!.text, /^धन्यवाद। /u, "Ravi is told it is being sent, in Hindi");
  assert.equal(w.toPerson("meena").at(-1)!.text, `The ₹200 refund for ${CUSTOMER} has been approved by the others, so your answer is no longer needed. Thank you.`);
  assert.equal(w.toPerson("meena").at(-1)!.templateName, "owner_approval_closed", "Meena has not written today: the approved template");
  assert.equal(w.toOwner().at(-1)!.text, `Thank you. The ₹200 refund for ${CUSTOMER} is being sent, and they will be told.`, "the owner, who approved first, hears it is being sent");
  // Meena's code is gone
  await w.personWrites("meena", `approve ${codes[2]}`);
  assert.equal(w.guard.accepted.length, 2);
  for (let i = 0; i < 3; i++) await w.relay.poll();
  assert.equal(refunded(w), 1, "once");
  assert.deepEqual(w.relay.status().asks, { decided: 1, closed: 2 });
  assert.equal(w.model.approvals().find((a) => a.id === approval)!.state, "consumed");
}, TWO);

run("one no refuses: the runtime is told deny, the customer is told, and the others hear it was refused", async (w) => {
  await w.heldRefund();
  await w.relay.poll();
  const ravi = codeIn(w.toPerson("ravi")[0]!.text);
  const meena = codeIn(w.toPerson("meena")[0]!.text);
  await w.personWrites("ravi", `approve ${ravi}`);
  await w.personWrites("meena", `deny ${meena}`);
  assert.equal(w.model.approvals()[0]!.state, "denied");
  assert.equal(refunded(w), 0);
  assert.match(w.kit.messaging.sentTo(CUSTOMER).at(-1)!.text, /decided not to refund/);
  assert.equal(w.toPerson("meena").at(-1)!.text, `Understood. The ₹200 refund for ${CUSTOMER} will not be sent, and they will be told.`);
  assert.match(w.toPerson("ravi").at(-1)!.text, /^सूचना: .*मना कर दिया है/u, "Ravi, who had approved, hears it was refused");
  assert.equal(w.toOwner().at(-1)!.text, `The ₹200 refund for ${CUSTOMER} was refused by one of the people who approve refunds, so it will not be sent, and they will be told.`);
  for (let i = 0; i < 3; i++) { w.clock.advance(60_000); await w.relay.poll(); await w.runtime.tick(); }
  assert.equal(w.model.reviews("x", true).length, 0, "Guard holds nothing new: the agent does not ask again");
}, TWO);

run("a code works only from the number it was sent to: another approver's phone, the owner's, or a stranger's get nothing", async (w) => {
  await w.heldRefund();
  await w.relay.poll();
  const ravi = codeIn(w.toPerson("ravi")[0]!.text);
  await w.personWrites("meena", `approve ${ravi}`); // Meena types Ravi's code
  await w.ownerWrites(`approve ${ravi}`);
  await w.ownerWrites(`approve ${ravi}`, { from: "+919899999999" });
  assert.equal(w.guard.accepted.length, 0, "Guard heard nothing");
  assert.equal(w.relay.status().ignored.notFromOwner, 3);
  await w.personWrites("ravi", `approve ${ravi}`);
  assert.deepEqual(w.guard.accepted.map((a) => a.approver), ["ravi"], "from Ravi's own number it counts");
}, TWO);

run("the person who asked never approves: the owner's own command names the owner, and only the others are asked", async (w) => {
  // the calendar will not confirm a paid booking; the owner answers "approve b-1" to cancel it and give the ₹200 back, which Guard holds
  await w.kit.say(w.runtime, "haircut day after tomorrow at 6pm");
  w.kit.calendar.inject("update", "silentFailure", { times: 2 });
  w.payments.customerPays(w.payments.links().at(-1)!.id);
  await w.deliverPayments();
  await w.ownerWrites("approve b-1");
  const held = w.model.approvals();
  assert.equal(held.length, 1);
  assert.deepEqual(held[0]!.requestedBy, ["owner"], "the runtime sent Geo-Requested-By: owner");
  const item = w.model.reviews("runtime-glow-salon", true)[0]!;
  assert.deepEqual(item.may_still_decide, ["meena", "ravi"]);
  await w.relay.poll();
  assert.equal(w.toOwner().filter((m) => /Approval needed/u.test(m.text)).length, 0, "the owner, who asked, is not asked");
  assert.deepEqual([w.toPerson("ravi").length, w.toPerson("meena").length], [1, 1]);
  await w.personWrites("ravi", `approve ${codeIn(w.toPerson("ravi")[0]!.text)}`);
  await w.personWrites("meena", `approve ${codeIn(w.toPerson("meena")[0]!.text)}`);
  assert.equal(refunded(w), 1);
}, TWO);

run("up to the two-person amount one approval is enough: nobody named, so the owner alone is asked, exactly as a shop of the owner alone", async (w) => {
  await w.heldRefund();
  const item = w.model.reviews("runtime-glow-salon", true)[0]!;
  assert.equal(item.may_still_decide, undefined, "a request that needs one and names nobody has none of the B37 keys");
  await w.relay.poll();
  assert.equal(w.toOwner().length, 1);
  assert.deepEqual([w.toPerson("ravi").length, w.toPerson("meena").length], [0, 0]);
  assert.equal(w.store.ask(w.model.approvals()[0]!.id)!.approver, "", "the owner's single ask, as before");
  await w.ownerWrites(`approve ${codeIn(w.toOwner()[0]!.text)}`);
  assert.equal(refunded(w), 1);
}, ONE);

run("up to the two-person amount, when the owner asked: the others are asked, and the first answer decides it; the relay's own reading credential is never asked", async (w) => {
  await w.kit.say(w.runtime, "haircut day after tomorrow at 6pm");
  w.kit.calendar.inject("update", "silentFailure", { times: 2 });
  w.payments.customerPays(w.payments.links().at(-1)!.id);
  await w.deliverPayments();
  await w.ownerWrites("approve b-1");
  const item = w.model.reviews("runtime-glow-salon", true)[0]!;
  assert.deepEqual([item.approvals_needed, item.may_still_decide], [1, ["meena", "ravi", READER_ID]]);
  await w.relay.poll();
  assert.equal(w.store.asksOf(item.id).length, 2, "Ravi and Meena; the reading credential has no number");
  await w.personWrites("meena", `approve ${codeIn(w.toPerson("meena")[0]!.text)}`);
  assert.equal(refunded(w), 1);
  assert.match(w.toPerson("ravi").at(-1)!.text, /^सूचना: .*दूसरों ने मंज़ूरी दे दी है/u, "Ravi's ask is closed");
}, ONE);

run("the runtime names the owner but Guard's item names nobody (a Guard from before B37, or the header lost): the owner is not asked, and the builder is told", async (w) => {
  const { refund } = w.payments;
  w.payments.refund = (id, r) => refund(id, { amount: r.amount, ...(r.receipt ? { receipt: r.receipt } : {}) }); // Geo-Requested-By never reaches Guard
  await w.kit.say(w.runtime, "haircut day after tomorrow at 6pm");
  w.kit.calendar.inject("update", "silentFailure", { times: 2 });
  w.payments.customerPays(w.payments.links().at(-1)!.id);
  await w.deliverPayments();
  await w.ownerWrites("approve b-1");
  const item = w.model.reviews("runtime-glow-salon", true)[0]!;
  assert.equal(item.may_still_decide, undefined, "Guard's item has none of the B37 keys: it looks like the owner's alone");
  await w.relay.poll();
  assert.equal(w.toOwner().length, 0, "the owner, who asked, is not asked to approve it");
  assert.deepEqual([w.toPerson("ravi").length, w.toPerson("meena").length], [0, 0]);
  assert.equal(w.relay.status().alerts.byKind.requester_not_named, 1);
  assert.match(w.store.alerts().find((a) => a.kind === "requester_not_named")!.note, /The owner asked for it, so may not approve it/u);
  assert.equal(refunded(w), 0);
}, ONE);

run("an answer whose reply was lost is not a second answer: Guard's 409 'already approved by ravi' reads as Ravi's vote, recorded", async (w) => {
  const approval = await w.heldRefund();
  await w.relay.poll();
  const ravi = codeIn(w.toPerson("ravi")[0]!.text);
  // Ravi's signed answer reached Guard, and the relay crashed before it saved that: Guard has the vote, the relay does not
  assert.equal(w.model.decide(approval, true, "ravi").status, 200);
  await w.personWrites("ravi", `approve ${ravi}`);
  assert.equal(w.toPerson("ravi").at(-1)!.text.includes("1"), true);
  assert.match(w.toPerson("ravi").at(-1)!.text, /^धन्यवाद। .*मंज़ूरी दर्ज हो गई है/u, "told it is recorded and waits for one more");
  assert.equal(w.relay.status().alerts.total, 0);
  assert.equal(refunded(w), 0);
}, TWO);

run("Guard's queue is the only list of whom to ask: someone who already answered elsewhere is not asked; the last answer still decides it", async (w) => {
  await w.heldRefund();
  const approval = w.model.approvals()[0]!.id;
  w.model.decide(approval, true, "ravi"); // Ravi answered with his own credential, not through the relay: Guard no longer lists him
  await w.relay.poll();
  assert.deepEqual(w.store.asksOf(approval).map((a) => a.approver), ["meena", "owner"]);
  assert.equal(w.toPerson("ravi").length, 0);
  await w.personWrites("meena", `approve ${codeIn(w.toPerson("meena")[0]!.text)}`);
  assert.equal(refunded(w), 1);
  assert.match(w.toOwner().at(-1)!.text, /has been approved by the others/u);
}, TWO);

// ---- pieces ------------------------------------------------------------------------------------------------------------------------------

test("Guard's words: a vote's 409 names the voter and the count; a decided request's does not", () => {
  assert.deepEqual(readAlready("approval ap-1 is already approved by asha: each approver decides once (1 of 2 approvals so far)"), { state: "approved", by: "asha", given: 1, needed: 2 });
  assert.deepEqual(readAlready("approval ap-1 is already denied by ravi.k: each approver decides once (0 of 2 approvals so far)"), { state: "denied", by: "ravi.k", given: 0, needed: 2 });
  assert.deepEqual(readAlready("approval ap-1 is already approved"), { state: "approved" });
  assert.deepEqual(readAlready("approval ap-1 is already consumed"), { state: "consumed" });
});

test("a review item with the B37 keys is read whole, and one with some of them is refused, not guessed", () => {
  const base = { id: "ap-1", agent: "a", tool: "razorpay", operation: "refund", arguments: ["map", { amount: ["int", "20000"], payment_id: ["str", "pmt_1"], receipt: ["str", "b-1:pmt_1"] }], requested_at_ms: "1", expires_at_ms: "2" };
  const whole = readHeld({ ...base, approvals_needed: 2, approvals_given: 1, votes: [{ approver: "asha", decision: "approve", role: "committee", at_ms: "5" }], requested_by: ["ravi"], may_still_decide: ["meena"] });
  assert.ok(whole.ok && whole.held.group);
  if (whole.ok) assert.deepEqual(whole.held.group, { needed: 2, given: 1, votes: [{ approver: "asha", decision: "approve" }], requestedBy: ["ravi"], mayStillDecide: ["meena"] });
  const single = readHeld(base);
  assert.ok(single.ok && single.held.group === undefined, "no keys: the owner's alone");
  const partial = readHeld({ ...base, may_still_decide: ["meena"] });
  assert.equal(partial.ok, false);
  if (!partial.ok) assert.match(partial.reason, /not in the form Guard writes/u);
});

test("approvers in the settings: ids, numbers and the two-person amount are checked in plain words", () => {
  const errors: string[] = [];
  assert.deepEqual(readApprovers({ people: [RAVI, MEENA], twoAboveInr: 150 }, { ownerWhatsapp: "+919800000001", refundLimitInr: 100 }, errors), { people: [RAVI, MEENA], twoAboveInr: 150 });
  assert.deepEqual(errors, []);
  const bad: string[] = [];
  readApprovers({ people: [{ id: "owner", whatsapp: "+919800000001" }, { id: "Ravi K", whatsapp: "98000" }], twoAboveInr: 50, extra: 1 }, { ownerWhatsapp: "+919800000001", refundLimitInr: 100 }, bad);
  assert.ok(bad.some((e) => /not "owner"/u.test(e)));
  assert.ok(bad.some((e) => /already the owner's/u.test(e)));
  assert.ok(bad.some((e) => /must start with \+/u.test(e)));
  assert.ok(bad.some((e) => /below the refund limit/u.test(e)));
  assert.ok(bad.some((e) => /"extra"/u.test(e)));
  assert.equal(readApprovers(undefined, {}, []), undefined, "left out: the owner alone");
});

test("the relay's data from before B37 opens and carries on: an ask written then is the owner's single ask, its code still works", () => {
  const dir = mkdtempSync(join(tmpdir(), "geo-relay-v1-"));
  try {
    const db = new DatabaseSync(join(dir, "relay.db"));
    db.exec(`CREATE TABLE asks (
      approval TEXT PRIMARY KEY, state TEXT NOT NULL, code_hash TEXT UNIQUE, code TEXT, receipt TEXT NOT NULL, booking TEXT, payment_id TEXT NOT NULL,
      amount_paise INTEGER NOT NULL, customer_phone TEXT, language TEXT, context TEXT, first_seen_ms INTEGER NOT NULL, asked_at_ms INTEGER, code_expires_at_ms INTEGER,
      guard_expires_at_ms INTEGER NOT NULL, approval_hours INTEGER NOT NULL, decision TEXT, guard_told INTEGER NOT NULL DEFAULT 0,
      runtime_told INTEGER NOT NULL DEFAULT 0, owner_told INTEGER NOT NULL DEFAULT 0, late_replied INTEGER NOT NULL DEFAULT 0, send_tries INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE messages (id TEXT PRIMARY KEY, sender TEXT NOT NULL, body TEXT NOT NULL, ts INTEGER NOT NULL, received_ms INTEGER NOT NULL, processed INTEGER NOT NULL DEFAULT 0, seq INTEGER NOT NULL);
      CREATE TABLE guesses (at_ms INTEGER NOT NULL);
      CREATE TABLE alerts (approval TEXT NOT NULL, kind TEXT NOT NULL, note TEXT NOT NULL, at_ms INTEGER NOT NULL, PRIMARY KEY (approval, kind));
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      PRAGMA user_version = 1;`);
    db.prepare("INSERT INTO asks (approval, state, code_hash, receipt, payment_id, amount_paise, first_seen_ms, guard_expires_at_ms, approval_hours, code_expires_at_ms) VALUES (?, 'asked', ?, 'b-1:pmt_1', 'pmt_1', 20000, 1, 999999, 24, 999000)").run("ap-old-1", hashCode("K7M2QX"));
    db.prepare("INSERT INTO meta (key, value) VALUES ('owner_last_inbound', '5')").run();
    db.close();
    const store = openRelayStore(dir);
    const ask = store.askByCode("K7M2QX")!;
    assert.deepEqual([ask.approval, ask.approver, ask.state, ask.approvalsLeft], ["ap-old-1", "", "asked", null]);
    assert.equal(store.ask("ap-old-1")!.receipt, "b-1:pmt_1");
    assert.equal(store.moveAsk("ap-old-1", ["asked"], "deciding", { decision: "approve" }), true, "it carries on where it was");
    assert.equal(store.getMeta("owner_last_inbound"), "5");
    assert.deepEqual(store.outcomes(), []);
    store.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
