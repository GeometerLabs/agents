// Item 11d: the owner answers a refund Guard holds on their private page instead of WhatsApp. The page's answer must be bound to the exact action exactly as the
// WhatsApp code is: the relay's own ask, used once, in the same one-at-a-time chain, with the same finishDecision (Guard, then the runtime, then the owner). These tests
// use the relay with a stub Guard and runtime, and asks put straight into its store as a pass would leave them ("asked"), so they read only what the page adds.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GuardClient, RuntimeClient } from "../clients.ts";
import { ownApiVoice } from "../own-api-voice.ts";
import { createRelay } from "../relay.ts";
import { relayHandler } from "../server.ts";
import { hashCode, openRelayStore } from "../store.ts";
import { fakeClock } from "../../core/clock.ts";
import { createFakeMessaging } from "../../messaging/messaging.ts";
import { OWNER_LINK_HEADER, newOwnerToken, ownerLinkFile } from "../../channels/owner-link.ts";

const OWNER = "+919800000001";
const START = Date.UTC(2026, 10, 12, 6, 0);
const HOUR = 3_600_000;

function world() {
  const dir = mkdtempSync(join(tmpdir(), "geo-owner-page-"));
  const clock = fakeClock(START);
  const store = openRelayStore(dir);
  const notified: [string, string, string | undefined][] = [];
  const decided: [string, string][] = [];
  let guardAnswer: Awaited<ReturnType<GuardClient["notify"]>> = { kind: "recorded" };
  const guard: GuardClient = { reviews: async () => ({ ok: true, items: [] }), notify: async (approval, decision, approver) => { notified.push([approval, decision, approver]); return guardAnswer; } };
  const runtime: RuntimeClient = { context: async () => ({ kind: "missing" }), decided: async (approval, decision) => { decided.push([approval, decision]); return true; } };
  const relay = createRelay({ voice: ownApiVoice, clock, guard, runtime, messaging: createFakeMessaging(clock), store, ownerWhatsapp: OWNER, approvers: [{ id: "ravi", whatsapp: "+919800000002", language: "en" }], ownerApproverId: "owner" });
  /** An ask as a pass leaves it once the owner's WhatsApp message is out: its code live (only the hash kept), until an hour less a minute. Codes from the real alphabet. */
  const CODES: Record<string, string> = { "ap-01": "KQ7M2X", "ap-02": "KQ7M2Y" };
  const asked = (approval: string, amountPaise: number, over: Record<string, unknown> = {}) => store.insertAsk({
    approval, state: "asked", receipt: `b-3:pay_1`, paymentId: "pay_1", amountPaise, firstSeenMs: START, guardExpiresAtMs: START + HOUR, approvalHours: 1,
    codeHash: hashCode(CODES[approval] ?? "KQ7M2Z"), codeExpiresAtMs: START + HOUR - 60_000, booking: "b-3", customerPhone: "+919811111111", language: "en",
    context: JSON.stringify({ booking: "b-3", customerPhone: "+919811111111", businessName: "Glow", timeZone: "Asia/Kolkata", ownerLanguage: "en", paymentId: "pay_1", amountPaise, approval, expiresAtMs: START + HOUR, serviceName: "Haircut", slotMs: START + 24 * HOUR }),
    ...over,
  });
  return { relay, store, clock, notified, decided, asked, setGuard: (a: typeof guardAnswer) => { guardAnswer = a; }, done: () => { store.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test("the page lists the owner's own live asks, with what Guard holds and a digest, and never another approver's ask", () => {
  const w = world();
  try {
    w.asked("ap-01", 30_000);
    w.asked("ap-02", 45_000, { approver: "ravi", codeHash: hashCode("RVRVRV") });
    const asks = w.relay.ownerAsks();
    assert.deepEqual(asks.map((a) => [a.approval, a.amountPaise, a.serviceName]), [["ap-01", 30_000, "Haircut"]]);
    assert.match(asks[0].digest, /^[0-9a-f]{32}$/u);
    assert.ok(!JSON.stringify(asks).includes("KQ7M2X"), "no code on the page");
  } finally { w.done(); }
});

test("a press is the ask's one use: a wrong digest does nothing; the right one goes to Guard, then the runtime; again it is gone, and a no stays a no", async () => {
  const w = world();
  try {
    w.asked("ap-01", 30_000);
    const [ask] = w.relay.ownerAsks();
    assert.equal(await w.relay.decideOnPage("ap-01", "0".repeat(32), "approve"), "changed");
    assert.deepEqual(w.notified, [], "nothing reached Guard");
    assert.equal(await w.relay.decideOnPage("ap-01", ask.digest, "deny"), "recorded");
    assert.deepEqual(w.notified, [["ap-01", "deny", undefined]], "signed as the owner, as the WhatsApp code is");
    assert.deepEqual(w.decided, [["ap-01", "deny"]]);
    assert.equal(w.store.ask("ap-01")!.state, "decided");
    assert.equal(await w.relay.decideOnPage("ap-01", ask.digest, "approve"), "gone", "a no is final for that call: the page cannot turn it into a yes");
    assert.equal(w.notified.length, 1);
    // the WhatsApp code for the same ask is used up too
    w.relay.receive([{ id: "wamid.1", from: OWNER, text: "approve KQ7M2X", timestamp: w.clock.now() }]);
    await w.relay.idle();
    assert.equal(w.notified.length, 1, "the WhatsApp reply after the page's answer counts nothing");
    assert.equal(w.relay.status().ignored.reusedOrUnknownCode, 1, "it was read, as the code of an ask already answered");
  } finally { w.done(); }
});

test("a changed amount is a new approval: the old page's answer does not reach it, and it needs its own yes", async () => {
  const w = world();
  try {
    w.asked("ap-01", 30_000);
    const [old] = w.relay.ownerAsks();
    w.store.moveAsk("ap-01", ["asked"], "expired"); // the agent's held call changed: Guard holds a new one, and the old ask ends
    w.asked("ap-02", 35_000);
    assert.equal(await w.relay.decideOnPage("ap-02", old.digest, "approve"), "changed", "the old digest does not fit the new amount");
    assert.equal(await w.relay.decideOnPage("ap-01", old.digest, "approve"), "expired");
    assert.deepEqual(w.notified, []);
    const [fresh] = w.relay.ownerAsks();
    assert.equal(fresh.amountPaise, 35_000);
    assert.equal(await w.relay.decideOnPage("ap-02", fresh.digest, "approve"), "recorded");
    assert.deepEqual(w.notified, [["ap-02", "approve", undefined]]);
  } finally { w.done(); }
});

test("a code that ran out cannot be answered on the page, and an answer Guard did not take leaves the ask open, as on WhatsApp", async () => {
  const w = world();
  try {
    w.asked("ap-01", 30_000);
    const [ask] = w.relay.ownerAsks();
    w.setGuard({ kind: "unreachable", error: "down" } as never);
    assert.equal(await w.relay.decideOnPage("ap-01", ask.digest, "approve"), "failed");
    assert.equal(w.store.ask("ap-01")!.state, "asked", "the ask is still the owner's to answer");
    w.clock.advance(HOUR);
    assert.equal(w.relay.ownerAsks().length, 0, "past its time it is not shown");
    assert.equal(await w.relay.decideOnPage("ap-01", ask.digest, "approve"), "expired");
  } finally { w.done(); }
});

test("the relay's page routes need its token AND the owner's link, checked against its own file", async () => {
  const w = world();
  const token = newOwnerToken();
  let link: ReturnType<typeof ownerLinkFile> | undefined = ownerLinkFile(token, new Date(START));
  const server = createServer(relayHandler(w.relay, "relay-token-0123456789", { ownerLink: () => link }));
  const port = await new Promise<number>((r) => server.listen(0, "127.0.0.1", () => r((server.address() as { port: number }).port)));
  const call = (path: string, headers: Record<string, string>, body?: unknown) => fetch(`http://127.0.0.1:${port}${path}`, { method: body ? "POST" : "GET", headers: { "content-type": "application/json", ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
  try {
    w.asked("ap-01", 30_000);
    assert.equal((await call("/owner/asks", { [OWNER_LINK_HEADER]: token })).status, 401, "the relay's own token first");
    const auth = { authorization: "Bearer relay-token-0123456789" };
    assert.equal((await call("/owner/asks", auth)).status, 403, "no owner's link");
    assert.equal((await call("/owner/asks", { ...auth, [OWNER_LINK_HEADER]: newOwnerToken() })).status, 403, "someone else's link");
    const asks = await (await call("/owner/asks", { ...auth, [OWNER_LINK_HEADER]: token })).json() as { asks: { approval: string; digest: string }[] };
    assert.equal(asks.asks.length, 1);
    link = undefined; // revoked: the deployer took the file away
    assert.equal((await call("/owner/decide", { ...auth, [OWNER_LINK_HEADER]: token }, { approval: "ap-01", digest: asks.asks[0].digest, decision: "approve" })).status, 403);
    assert.deepEqual(w.notified, []);
    link = ownerLinkFile(token, new Date(START));
    const r = await (await call("/owner/decide", { ...auth, [OWNER_LINK_HEADER]: token }, { approval: "ap-01", digest: asks.asks[0].digest, decision: "approve" })).json() as { result: string };
    assert.equal(r.result, "recorded");
  } finally { await new Promise<void>((r) => server.close(() => r())); w.done(); }
});
