// The refunds example, end to end, through the REAL geo-guard: the example's compiled spec, the guard.toml companies/guard-config.ts writes, a Guard process
// on this computer, and the made-up API behind it (examples/refunds-api/fake-api.ts), which does not honour Idempotency-Key. So when it shows one refund, Guard
// stopped the repeat. Skipped, saying why, when geo-guard is not on this computer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { skipWithoutGuard } from "./helpers.ts";
import { API_KEY, startStack } from "./real-guard.ts";
import type { Stack } from "./real-guard.ts";

async function withStack(run: (s: Stack) => Promise<void>) {
  const s = await startStack();
  try { await run(s); } finally { await s.stop(); }
}
const refundsReaching = (s: Stack, charge: string) => s.api.refunds.filter((r) => r.charge_id === charge).length;
const posts = (s: Stack) => s.api.seen.filter((x) => x.method === "POST" && x.path === "/v1/refunds");
const opts = { skip: skipWithoutGuard };

test("a refund above the threshold is held, not sent; a person approves that exact call; then it is made once", opts, () => withStack(async (s) => {
  const refund = { charge_id: "ch_A", amount: 20000, reason: "late" };
  const held = await s.call("POST", "/v1/refunds", refund, { "Idempotency-Key": "agent-chose-this" });
  assert.equal(held.status, 202);
  assert.equal(held.json.guard.decision, "hold");
  assert.equal(held.json.guard.code, "held_for_approval");
  assert.equal(held.json.guard.sent, "no");
  assert.match(held.json.guard.reason, /create_refund-needs-approval/u);
  const approval = held.json.guard.detail.approval as string;
  assert.equal(held.headers.get("guard-held"), approval);
  assert.equal(posts(s).length, 0, "nothing reached the API while it was held");

  // asking again does not make a second approval; a changed call is a different call and needs its own
  assert.equal((await s.call("POST", "/v1/refunds", refund)).json.guard.detail.approval, approval);
  const changed = await s.call("POST", "/v1/refunds", { ...refund, amount: 20001 });
  assert.equal(changed.status, 202);
  assert.notEqual(changed.json.guard.detail.approval, approval);

  // Guard's admin credential alone never approves: a named approver with a role does
  const adminOnly = await s.admin("POST", `/admin/approvals/${approval}/approve`, {});
  assert.equal(adminOnly.status, 403);
  assert.match(adminOnly.json.error, /admin credential alone never approves/u);
  const issued = await s.admin("POST", "/admin/approvers", { id: "alex.reviewer", roles: ["approver"], ttl_seconds: 600 });
  assert.equal(issued.status, 200);
  const approved = await s.admin("POST", `/admin/approvals/${approval}/approve`, {}, issued.json.token);
  assert.equal(approved.status, 200);
  assert.equal(approved.json.state, "approved");
  assert.equal(approved.json.approver, "alex.reviewer");
  assert.equal(posts(s).length, 0, "approving does not send anything");

  // the agent sends the identical call again, and it goes
  const done = await s.call("POST", "/v1/refunds", refund, { "Idempotency-Key": "agent-chose-this" });
  assert.equal(done.status, 201);
  assert.equal(refundsReaching(s, "ch_A"), 1);
  assert.match(s.api.refunds[0]!.idempotency_key!, /^geo-[0-9a-f]{32}-0$/u, "Guard sent its own key, not the one the agent chose");

  // the approval worked once: the same call again is held again, and no second refund is made
  const again = await s.call("POST", "/v1/refunds", refund);
  assert.equal(again.status, 202);
  assert.notEqual(again.json.guard.detail.approval, approval);
  // the other amount was never approved
  assert.equal((await s.call("POST", "/v1/refunds", { ...refund, amount: 20001 })).status, 202);
  assert.equal(refundsReaching(s, "ch_A"), 1);
}));

test("the same refund twice after a lost reply is made once", opts, () => withStack(async (s) => {
  s.api.loseReplyFor.add("ch_B"); // the API makes the refund and then never answers
  const refund = { charge_id: "ch_B", amount: 5000 };
  const first = await s.call("POST", "/v1/refunds", refund);
  assert.equal(first.status, 504);
  assert.equal(first.json.guard.code, "outcome_unknown");
  assert.equal(first.json.guard.retry, "do_not_repeat");
  assert.equal(first.headers.get("guard-outcome"), "unknown");
  assert.equal(refundsReaching(s, "ch_B"), 1, "the API did make it; only the reply was lost");

  // the agent, seeing no answer, sends the identical call again. Guard does not send it.
  const repeat = await s.call("POST", "/v1/refunds", refund);
  assert.equal(repeat.status, 202);
  assert.equal(repeat.json.guard.decision, "hold");
  assert.equal(repeat.json.guard.sent, "no");
  assert.equal(repeat.json.guard.detail.approval, null, "nothing for a reviewer to approve: a person at the server settles it");
  assert.match(repeat.json.guard.reason, /unknown outcome/u);
  assert.equal(refundsReaching(s, "ch_B"), 1);

  // the same action with other numbers is refused too
  const other = await s.call("POST", "/v1/refunds", { ...refund, amount: 6000 });
  assert.equal(other.status, 409);
  assert.equal(other.json.guard.code, "conflict");
  assert.equal(refundsReaching(s, "ch_B"), 1);

  // the uncertain call is listed for the person who settles it; once they say it happened, nothing is sent
  const open = await s.admin("GET", "/admin/intents");
  const intent = open.json.intents.find((i: any) => i.state === "outcome_unknown");
  assert.ok(intent, "the uncertain refund is listed");
  assert.equal(intent.operation, "create_refund");
  const settled = await s.admin("POST", "/admin/intents/resolve", { intent: intent.intent, resolution: "happened" });
  assert.equal(settled.status, 200);
  const afterwards = await s.call("POST", "/v1/refunds", refund);
  assert.notEqual(afterwards.status, 201);
  assert.equal(refundsReaching(s, "ch_B"), 1);
  assert.equal(posts(s).length, 1, "the API was asked exactly once in the whole story");
}));

test("a repeat of a refund that went through is answered from Guard's record; the same action with another amount is refused", opts, () => withStack(async (s) => {
  const refund = { charge_id: "ch_D", amount: 5000 };
  const first = await s.call("POST", "/v1/refunds", refund);
  assert.equal(first.status, 201);
  const second = await s.call("POST", "/v1/refunds", refund);
  assert.equal(second.status, 201);
  assert.equal(second.headers.get("guard-replayed"), "true");
  assert.deepEqual(second.json, first.json, "the first answer comes back");
  const other = await s.call("POST", "/v1/refunds", { ...refund, amount: 4000 });
  assert.equal(other.status, 409);
  assert.equal(refundsReaching(s, "ch_D"), 1);
  assert.equal(posts(s).length, 1);
}));

test("an amount above the bound is refused before it is sent, and so are the amounts and shapes that cannot be right", opts, () => withStack(async (s) => {
  const over = await s.call("POST", "/v1/refunds", { charge_id: "ch_C", amount: 60000 });
  assert.equal(over.status, 403);
  assert.equal(over.json.guard.code, "refused_by_policy");
  assert.equal(over.json.guard.sent, "no");
  assert.match(over.json.guard.reason, /create_refund-amount-bound: amount 60000 is above the highest allowed value, 50000/u);
  for (const [label, body, why] of [
    ["zero", { charge_id: "ch_C", amount: 0 }, /below the lowest allowed value, 1/u],
    ["negative", { charge_id: "ch_C", amount: -5 }, /below the lowest allowed value/u],
    ["written as a string", { charge_id: "ch_C", amount: "60000" }, /above the highest allowed value/u],
    ["written as 1e5", { charge_id: "ch_C", amount: 1e5 }, /above the highest allowed value/u],
    ["no amount", { charge_id: "ch_C" }, /no amount in the call/u],
  ] as const) {
    const r = await s.call("POST", "/v1/refunds", body);
    assert.equal(r.status, 403, label);
    assert.match(r.json.guard.reason, why, label);
  }
  // no id to tell which action it is: Guard cannot tell whether it is a repeat, so it does not send
  const noKey = await s.call("POST", "/v1/refunds", { amount: 100 });
  assert.equal(noKey.status, 409);
  assert.match(noKey.json.guard.reason, /intent key field charge_id is missing/u);
  assert.equal(posts(s).length, 0, "the API never saw any of them");
}));

test("a call the reviewer forbade, and calls nobody listed, are refused by name; reads that were listed go through", opts, () => withStack(async (s) => {
  const transfer = await s.call("POST", "/v1/transfers", { from_account_id: "acc_1", to_account_id: "acc_2", amount: 1 });
  assert.equal(transfer.status, 403);
  assert.match(transfer.json.guard.reason, /create_transfer-forbidden/u);
  const del = await s.call("DELETE", "/v1/customers/cu_1");
  assert.equal(del.status, 403);
  assert.match(del.json.guard.reason, /is not a route this policy covers/u);
  assert.equal((await s.call("GET", "/v1/customers/cu_1")).status, 403, "left out of the accept file, so unlisted even though it only reads");
  assert.equal((await s.call("GET", "/v1/charges/ch_1")).status, 200);
  assert.deepEqual([s.api.transfers.length, s.api.deletedCustomers.length], [0, 0]);
  assert.deepEqual(s.api.seen.map((x) => `${x.method} ${x.path}`), ["GET /v1/charges/ch_1"], "only the listed read reached the API");
}));

test("a daily spend cap refuses the call that would go over it, and says when the counter starts again", opts, () => withStack(async (s) => {
  // 9000 is under the threshold, so no approval is needed; each refund is for another charge, so each is a different action
  let refused: any;
  let made = 0;
  for (let i = 0; i < 40 && !refused; i++) {
    const r = await s.call("POST", "/v1/refunds", { charge_id: `ch_spend_${i}`, amount: 9000 });
    if (r.status === 201) made++; else refused = r;
  }
  assert.ok(refused, "the cap was reached");
  assert.equal(made, 22, "22 x 9000 = 198000 fits under 200000; the 23rd would make 207000");
  assert.equal(refused.status, 403);
  assert.equal(refused.json.guard.reason_code, "limit_exceeded");
  assert.equal(refused.json.guard.detail.limit, "create_refund-spend-per-day");
  assert.equal(refused.json.guard.detail.window_seconds, 86400);
  assert.ok(Number(refused.json.guard.detail.resets_at_ms) > Date.now());
  assert.equal(s.api.refunds.length, 22);
}));

test("the API's key lives only in Guard: the agent's token is no good at the API, and the API sees only its own key through Guard", opts, () => withStack(async (s) => {
  const direct = await fetch(`${s.api.url}/v1/charges/ch_1`, { headers: { authorization: `Bearer ${s.agentToken}` } });
  assert.equal(direct.status, 401);
  assert.equal((await fetch(`${s.agentUrl}/v1/charges/ch_1`)).status, 401, "and Guard wants the agent's token");
  assert.equal((await fetch(`${s.agentUrl}/v1/charges/ch_1`, { headers: { authorization: `Bearer ${API_KEY}` } })).status, 401, "the API's own key does not open Guard");
  s.api.seen.length = 0;
  assert.equal((await s.call("GET", "/v1/charges/ch_1")).status, 200);
  assert.deepEqual(s.api.seen.map((x) => x.authorization), [`Bearer ${API_KEY}`]);
}));
