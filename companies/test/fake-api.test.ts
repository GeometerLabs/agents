// The made-up API is the control for the end-to-end tests: it needs its own key, and it does NOT forgive a repeat, so any "one refund" in those tests is Guard's
// doing. These tests need no Guard.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startFakeApi } from "../examples/refunds-api/fake-api.ts";

const KEY = "sk_test_control";
const post = (url: string, body: unknown, headers: Record<string, string> = {}) => fetch(url, { method: "POST", headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

test("asked twice with the same Idempotency-Key, the made-up API makes two refunds (so Guard is what makes it one)", async () => {
  const api = await startFakeApi({ apiKey: KEY });
  try {
    const refund = { charge_id: "ch_1", amount: 5000 };
    assert.equal((await post(`${api.url}/v1/refunds`, refund, { "Idempotency-Key": "same" })).status, 201);
    assert.equal((await post(`${api.url}/v1/refunds`, refund, { "Idempotency-Key": "same" })).status, 201);
    assert.equal(api.refunds.length, 2);
  } finally { await api.close(); }
});

test("it needs its own key, checks the shape of a refund, and can make a refund and drop the reply", async () => {
  const api = await startFakeApi({ apiKey: KEY });
  try {
    assert.equal((await fetch(`${api.url}/v1/charges/ch_1`)).status, 401);
    assert.equal((await post(`${api.url}/v1/refunds`, { charge_id: "ch_1", amount: "5000" })).status, 422);
    assert.equal(api.refunds.length, 0);
    api.loseReplyFor.add("ch_9");
    await assert.rejects(post(`${api.url}/v1/refunds`, { charge_id: "ch_9", amount: 100 }));
    assert.equal(api.refunds.length, 1, "made, never answered");
    assert.equal(api.seen.at(-1)!.answered, false);
  } finally { await api.close(); }
});
