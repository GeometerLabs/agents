// The refunds example, end to end, through the REAL geo-guard: the example's compiled spec, the guard.toml companies/guard-config.ts writes, a Guard process
// on this computer, and the made-up API behind it (examples/refunds-api/fake-api.ts), which does not honour Idempotency-Key. So when it shows one refund, Guard
// stopped the repeat. Skipped, saying why, when geo-guard is not on this computer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { draftFromText, specFromAccept } from "../openapi-to-spec.ts";
import type { Draft } from "../openapi-to-spec.ts";
import { sha256 } from "../openapi-read.ts";
import { customerApi, exampleJson, exampleText, skipWithoutGuard, specWith, stringBodyApi, tempDir, textMoneySpec } from "./helpers.ts";
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
  // the identical call again is done, by that person's word: a 409 that says so (reason_code already_done), not a replay and not a send
  const afterwards = await s.call("POST", "/v1/refunds", refund);
  assert.equal(afterwards.status, 409);
  assert.equal(afterwards.json.guard.code, "conflict");
  assert.equal(afterwards.json.guard.reason_code, "already_done");
  assert.equal(afterwards.json.guard.sent, "no");
  assert.equal(afterwards.headers.get("guard-replayed"), null, "there is no reply of the API's to replay");
  assert.match(String(afterwards.json.guard.detail?.confirmed_by), /^operator:/u, "who settled it is named");
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
    ["one above the bound, as a JSON number", { charge_id: "ch_C", amount: 50001 }, /create_refund-amount-bound: amount 50001 is above the highest allowed value, 50000/u],
    // the bound reads a JSON number only (ADR-0060): text is refused for being text, whatever number it spells, and even inside the range,
    // because how the API would read "60000" is the API's business
    ["above the bound, written as text", { charge_id: "ch_C", amount: "60000" }, /create_refund-amount-bound: amount is text \("60000"\), not a JSON number/u],
    ["inside the bound, written as text", { charge_id: "ch_C", amount: "5000" }, /create_refund-amount-bound: amount is text \("5000"\), not a JSON number/u],
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

test("an amount in the query is text: the draft's \"encoding\": \"string\" bounds it exactly, and the same bound without it would refuse every call", opts, async () => {
  const dir = tempDir();
  const spec = textMoneySpec();
  writeFileSync(join(dir, "spec.json"), JSON.stringify(spec));
  const s = await startStack({ spec: join(dir, "spec.json") });
  try {
    const q = (amount: string) => `/v1/refunds?amount=${encodeURIComponent(amount)}&charge_id=ch_Q`;
    const inRange = await s.call("POST", q("500"));
    assert.equal(inRange.json?.guard, undefined, `"500" in the query passed the bound and reached the API: ${JSON.stringify(inRange.json)}`);
    assert.equal(inRange.status, 422, "the made-up API wants a JSON body, and says so itself");
    const over = await s.call("POST", q("60000"));
    assert.equal(over.status, 403);
    assert.match(over.json.guard.reason, /create_refund-amount-bound: amount 60000 is above the highest allowed value, 50000/u);
    for (const odd of ["+500", "0500", "500.0", "5e2", " 500"]) {
      const r = await s.call("POST", q(odd));
      assert.equal(r.status, 403, `${JSON.stringify(odd)} is not the number written exactly`);
      assert.match(r.json.guard.reason, /create_refund-amount-bound/u, odd);
    }
    assert.equal(posts(s).length, 1, "only the exact, in-range amount reached the API");
  } finally { await s.stop(); }

  // the same spec with the encoding taken off the query bound: the compiler cannot tell a query field from a body field on a POST, so it builds it, and Guard
  // then refuses even "500", because a query value is never a JSON number. That is why the draft writes the encoding.
  const without = structuredClone(spec);
  delete without.rules.find((r: any) => r.id === "create_refund-amount-bound").encoding;
  writeFileSync(join(dir, "without.json"), JSON.stringify(without));
  const t = await startStack({ spec: join(dir, "without.json") });
  try {
    const r = await t.call("POST", "/v1/refunds?amount=500&charge_id=ch_Q");
    assert.equal(r.status, 403);
    assert.match(r.json.guard.reason, /create_refund-amount-bound: amount is text \("500"\), not a JSON number/u);
    assert.equal(posts(t).length, 0);
  } finally { await t.stop(); }
});

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

test("a call marked off with `forbid` is refused by the rule that names it, while the reads next to it still work", opts, async () => {
  const dir = tempDir();
  const draft = JSON.parse(exampleText("draft.json")) as Draft;
  const a = exampleJson("accept.json");
  a.forbid = ["cancel_refund"];
  const spec = join(dir, "spec.json");
  writeFileSync(spec, JSON.stringify(specFromAccept(draft, a, sha256(exampleText("draft.json"))).spec));
  const s = await startStack({ spec });
  try {
    const cancel = await s.call("POST", "/v1/refunds/re_1/cancel");
    assert.equal(cancel.status, 403);
    assert.match(cancel.json.guard.reason, /cancel_refund-forbidden/u);
    assert.equal((await s.call("GET", "/v1/refunds/re_1")).status, 404, "a read of a refund goes through to the API (which has none)");
    assert.equal(s.api.seen.filter((x) => x.path.endsWith("/cancel")).length, 0);
  } finally { await s.stop(); }
});

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

// ---------------------------------------------------------------------------------------------------------------------------------------------
// A string-typed amount in a JSON body (Guard's ADR-0060: a bound reads text only with "encoding": "string")
// ---------------------------------------------------------------------------------------------------------------------------------------------

test("the draft suggests the text bound for an amount the API types as a string in the body, with a note; it offers no hold or spend on it", () => {
  const d = draftFromText(stringBodyApi(), { tool: "refunds" });
  const bound = d.suggestions.find((s) => s.id === "create_refund-amount-bound")!;
  assert.equal(bound.kind, "argument_bound");
  assert.equal(bound.encoding, "string");
  assert.match(bound.review, /typed as a string.*travels as text inside the JSON body \("500", not 500\).*"encoding": "string".*REFUSES a JSON number/u);
  assert.match(bound.review, /does not hold or count a call on a text amount/u);
  assert.equal(d.suggestions.some((s) => s.id === "create_refund-needs-approval" || s.id === "create_refund-spend-per-day"), false, "a hold or a spend limit cannot read a text amount");
  assert.equal(d.routes.find((r) => r.operation === "create_refund")!.consequential, true, "the string amount counts as money, so the route looks consequential");
  assert.deepEqual(specWith(stringBodyApi()).rules.find((r: any) => r.kind === "argument_bound"), { id: "create_refund-amount-bound", kind: "argument_bound", operation: "create_refund", field: "amount", min: "1", max: "50000", encoding: "string" });
  // a number-typed amount in the body gets no encoding
  assert.equal(draftFromText(customerApi(), { tool: "refunds" }).suggestions.find((s) => s.id === "create_refund-amount-bound")!.encoding, undefined);
});

test("through the real Guard: text that spells the number within bounds passes, outside is refused, and a JSON number is refused", opts, async () => {
  const dir = tempDir();
  writeFileSync(join(dir, "spec.json"), JSON.stringify(specWith(stringBodyApi())));
  const s = await startStack({ spec: join(dir, "spec.json") });
  try {
    const body = (amount: unknown) => ({ charge_id: "ch_S", customer_id: "cu_1", amount });
    // the made-up API wants a whole-number amount and says 422 itself: that answer, with no "guard" part, is how a call that passed the bound looks here
    for (const ok of ["500", "1", "50000"]) {
      const r = await s.call("POST", "/v1/refunds", body(ok));
      assert.equal(r.json?.guard, undefined, `${JSON.stringify(ok)} passed the bound and reached the API: ${JSON.stringify(r.json)}`);
      assert.equal(r.status, 422);
    }
    assert.equal(posts(s).length, 3);
    const over = await s.call("POST", "/v1/refunds", body("60000"));
    assert.equal(over.status, 403);
    assert.match(over.json.guard.reason, /create_refund-amount-bound: amount 60000 is above the highest allowed value, 50000/u);
    const under = await s.call("POST", "/v1/refunds", body("0"));
    assert.equal(under.status, 403);
    assert.match(under.json.guard.reason, /create_refund-amount-bound/u);
    // a JSON number is refused even when it is in range: under this encoding Guard reads text only
    const number = await s.call("POST", "/v1/refunds", body(500));
    assert.equal(number.status, 403);
    assert.match(number.json.guard.reason, /create_refund-amount-bound/u);
    for (const odd of ["+500", "0500", "500.0", "5e2", " 500"]) {
      const r = await s.call("POST", "/v1/refunds", body(odd));
      assert.equal(r.status, 403, `${JSON.stringify(odd)} is not the number written exactly`);
    }
    assert.equal(posts(s).length, 3, "nothing else reached the API");
  } finally { await s.stop(); }
});

// ---------------------------------------------------------------------------------------------------------------------------------------------
// `scope`: a counter for each customer
// ---------------------------------------------------------------------------------------------------------------------------------------------

const refundFor = (s: Stack, customer: string, n: number, amount = 100) => s.call("POST", "/v1/refunds", { charge_id: `ch_${customer}_${n}`, customer_id: customer, amount });
const through = (r: { status: number }) => r.status === 201;

test("a count limit with scope [customer_id]: one customer reaches the limit and is refused, another customer is not affected", opts, async () => {
  const dir = tempDir();
  writeFileSync(join(dir, "spec.json"), JSON.stringify(specWith(customerApi(), { "create_refund-count-per-day": { cap: 2, scope: ["customer_id"] } })));
  const s = await startStack({ spec: join(dir, "spec.json") });
  try {
    assert.ok(through(await refundFor(s, "cu_A", 1)));
    assert.ok(through(await refundFor(s, "cu_A", 2)));
    const third = await refundFor(s, "cu_A", 3);
    assert.equal(third.json.guard.decision, "deny", JSON.stringify(third.json));
    assert.match(third.json.guard.reason, /create_refund-count-per-day/u);
    assert.ok(through(await refundFor(s, "cu_B", 1)), "cu_B has a counter of its own");
    assert.ok(through(await refundFor(s, "cu_B", 2)));
    assert.match((await refundFor(s, "cu_B", 3)).json.guard.reason, /create_refund-count-per-day/u, "and reaches the same cap on its own");
    assert.match((await refundFor(s, "cu_A", 4)).json.guard.reason, /create_refund-count-per-day/u, "cu_A stays refused");
    assert.equal(posts(s).length, 4, "two for each customer reached the API");
    // a call that does not name the customer cannot be counted for anyone, and is refused rather than passed
    const none = await s.call("POST", "/v1/refunds", { charge_id: "ch_x", amount: 100 });
    assert.equal(none.json.guard.decision, "deny", JSON.stringify(none.json));
    assert.equal(posts(s).length, 4);
  } finally { await s.stop(); }
});

test("a spend limit with scope [customer_id]: each customer's total is counted on its own", opts, async () => {
  const dir = tempDir();
  writeFileSync(join(dir, "spec.json"), JSON.stringify(specWith(customerApi(), { "create_refund-spend-per-day": { cap: "1000", scope: ["customer_id"] } })));
  const s = await startStack({ spec: join(dir, "spec.json") });
  try {
    assert.ok(through(await refundFor(s, "cu_A", 1, 600)));
    const over = await refundFor(s, "cu_A", 2, 600);
    assert.equal(over.json.guard.decision, "deny", JSON.stringify(over.json));
    assert.match(over.json.guard.reason, /create_refund-spend-per-day/u);
    assert.ok(through(await refundFor(s, "cu_B", 1, 600)), "cu_B has spent nothing yet");
    assert.ok(through(await refundFor(s, "cu_A", 3, 400)), "cu_A can still spend what is left of its own cap");
    assert.equal(posts(s).length, 3);
  } finally { await s.stop(); }
});
