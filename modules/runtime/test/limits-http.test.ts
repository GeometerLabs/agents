// The runtime's HTTP routes for "limits, tightened by a tap": the deployer's (the internal bearer token only) and the owner's limits page (the owner's credential to read, a
// session made with a PASSKEY to change). A link or a session made by a link is never enough to change a limit: loosening is outside the chat and behind the passkey.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../http.ts";
import type { ServedRuntime } from "../http.ts";
import type { IncomingEvent } from "../events.ts";

const SESSION = "S".repeat(43);
const LINK_SESSION = "L".repeat(43);
const view = { limits: [{ id: "refund_limit", inForce: 1000 }], changes: [] };

async function run(fn: (call: (path: string, init?: RequestInit & { headers?: Record<string, string> }) => Promise<{ status: number; body: any }>, submitted: IncomingEvent[]) => Promise<void>) {
  const submitted: IncomingEvent[] = [];
  const runtime = {
    submit: (events: IncomingEvent[]) => { submitted.push(...events); return { saved: events.length, duplicates: 0 }; }, kick: () => undefined, status: () => ({}), refundContext: () => null, ready: () => ({ ok: true as const }),
    channel: { offer: async () => ({}), view: () => null, owner: () => ({}) },
    limits: { view: () => view },
  } as unknown as ServedRuntime;
  const server = await startServer(runtime, {
    token: "internal-token", port: 0, channelToken: "channel-token",
    ownerSignin: { check: (s: string) => (s === SESSION || s === LINK_SESSION ? { id: "x" } : undefined), checkPasskey: (s: string) => (s === SESSION ? { id: "x" } : undefined) } as never,
  });
  const call = async (path: string, init: RequestInit & { headers?: Record<string, string> } = {}) => {
    const r = await fetch(`${server.url}${path}`, init);
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  try { await fn(call, submitted); } finally { await server.close(); }
}
const bearer = (token: string, more: Record<string, string> = {}) => ({ authorization: `Bearer ${token}`, "content-type": "application/json", ...more });

test("the deployer reads the limits and settles a change with the internal token only; a bad word is refused", async () => {
  await run(async (call, submitted) => {
    assert.equal((await call("/internal/limit-changes")).status, 401);
    assert.equal((await call("/internal/limit-changes", { headers: bearer("channel-token") })).status, 401, "the channel token cannot reach the deployer's route");
    const read = await call("/internal/limit-changes", { headers: bearer("internal-token") });
    assert.deepEqual([read.status, read.body], [200, view]);
    const bad = await call("/internal/limit-changes", { method: "POST", headers: bearer("internal-token"), body: JSON.stringify({ id: "r-1", change: "l-1", result: "maybe" }) });
    assert.equal(bad.status, 400);
    const ok = await call("/internal/limit-changes", { method: "POST", headers: bearer("internal-token"), body: JSON.stringify({ id: "r-1", change: "l-1", result: "active" }) });
    assert.equal(ok.status, 200);
    assert.deepEqual(submitted, [{ kind: "limit_settled", id: "r-1", change: "l-1", result: "active" }]);
  });
});

test("the owner's page: any good session reads, only a passkey session changes, and the front's word alone is nothing", async () => {
  await run(async (call, submitted) => {
    const owner = (session: string) => bearer("channel-token", { "x-owner-session": session });
    assert.equal((await call("/internal/channel/owner-limits", { headers: bearer("channel-token") })).status, 403, "no owner credential");
    const byLink = await call("/internal/channel/owner-limits", { headers: owner(LINK_SESSION) });
    assert.deepEqual([byLink.status, byLink.body.passkey], [200, false]);
    const byPasskey = await call("/internal/channel/owner-limits", { headers: owner(SESSION) });
    assert.deepEqual([byPasskey.status, byPasskey.body.passkey], [200, true]);
    const body = JSON.stringify({ id: "o-1", limit: "refund_limit", to: 1500 });
    const refused = await call("/internal/channel/owner-limits", { method: "POST", headers: owner(LINK_SESSION), body });
    assert.deepEqual([refused.status, refused.body.state], [403, "passkey_needed"]);
    assert.deepEqual(submitted, [], "nothing was saved");
    const asked = await call("/internal/channel/owner-limits", { method: "POST", headers: owner(SESSION), body });
    assert.equal(asked.status, 200);
    assert.deepEqual(submitted, [{ kind: "owner_limit", id: "o-1", limit: "refund_limit", to: 1500 }]);
    assert.equal((await call("/internal/channel/owner-limits", { method: "POST", headers: owner(SESSION), body: JSON.stringify({ id: "o-2", limit: "refund_limit", to: 1.5 }) })).status, 400);
    // the inbox's own events route cannot carry a limit event
    const inbox = await call("/internal/events", { method: "POST", headers: bearer("internal-token"), body: JSON.stringify({ events: [{ kind: "owner_limit", id: "o-3", limit: "refund_limit", to: 5 }] }) });
    assert.equal(inbox.status, 400);
  });
});
