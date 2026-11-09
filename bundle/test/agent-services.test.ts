// The after-care services for an agent someone else wrote, each on its own: the heartbeat (counts only, from the Guards), the stop switch, the shared services' config files,
// the relay's look at the payment, and the inbox that keeps the owner's replies and passes the rest on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { agentInboxHandler } from "../agent/inbox.ts";
import { ownAgentRuntime } from "../agent/relay-context.ts";
import { addressing, composeServer } from "../generate/compose.ts";
import type { AgentDeploy } from "../generate/compose.ts";
import { inboxConfig, opsConfig, relayConfig, refresherConfig } from "../generate/configs.ts";
import type { AgentFacts } from "../generate/configs.ts";
import { names } from "../generate/shop.ts";
import { observeAgent, stopShop } from "../services/ops.ts";
import type { OpsConfig, OpsOwnAgent } from "../services/ops.ts";
import { buildHeartbeat } from "../services/heartbeat.ts";
import { serverConfig } from "./helpers.ts";

const server = serverConfig();
const deploy: AgentDeploy = { name: "my-agent", index: 3, guards: (["razorpay", "whatsapp", "calendar"] as const).map((kind) => ({ kind, service: names.guard("my-agent", kind), tenant: "my-agent" })) };
const facts: AgentFacts = { ...deploy, createdAt: "2026-11-05T09:00:00Z", ownerWhatsapp: "+919800000001", phoneNumberId: "123456789012345", calendarId: "c@group.calendar.google.com", verification: "meta-signature", hasGoogle: true, ownGoogleKey: true, business: { name: "Glow Salon", timeZone: "Asia/Kolkata", ownerLanguage: "en" } };

// ---- configs -----------------------------------------------------------------------------------------------------------------------------------

test("the shared services' config files are as they were without agents, and name each agent's Guards, relay and inbox with it", () => {
  assert.deepEqual(JSON.parse(inboxConfig(server, [])), { shops: {} });
  assert.deepEqual(JSON.parse(opsConfig(server, [])).ownAgents, undefined);
  const inbox = JSON.parse(inboxConfig(server, [], [facts])).shops["my-agent"];
  assert.deepEqual([inbox.kind, inbox.relayUrl, inbox.secretsDir, inbox.forwardTo], ["own-agent", "http://relay:8795/c/my-agent", "/run/secrets/my-agent", undefined]);
  assert.equal(JSON.parse(inboxConfig(server, [], [{ ...facts, forwardTo: "https://agent.example.com/whatsapp" }])).shops["my-agent"].forwardTo, "https://agent.example.com/whatsapp");
  const relay = JSON.parse(relayConfig(server, [], [facts])).shops["my-agent"];
  const net = addressing(server);
  assert.deepEqual([relay.kind, relay.agentId, relay.approverId], ["own-agent", "agent-my-agent", "owner-my-agent"]);
  assert.equal(relay.razorpayGuardUrl, `http://${net.adminIp("my-agent", "razorpay", 3)}:8080`);
  assert.equal(relay.runtimeUrl, undefined, "there is no runtime to ask");
  assert.equal(relay.guardAdminUrl, `http://${net.adminIp("my-agent", "razorpay", 3)}:8190`);
  assert.deepEqual(JSON.parse(refresherConfig(server, [], {}, [facts])).shops["my-agent"].adminTokenFile, "/run/secrets/my-agent/admin_token");
  const ops = JSON.parse(opsConfig(server, [], [facts])).ownAgents["my-agent"] as OpsOwnAgent;
  assert.deepEqual(ops.guards.map((g) => g.id), ["guard-razorpay", "guard-whatsapp", "guard-calendar"]);
  assert.equal(ops.recordTokenFile, "/run/secrets/my-agent/record_token");
  // an agent without Razorpay has no relay (nothing is ever held); without WhatsApp it has no inbox
  const calendarOnly: AgentFacts = { ...facts, guards: facts.guards.filter((g) => g.kind === "calendar") };
  assert.deepEqual(Object.keys(JSON.parse(relayConfig(server, [], [calendarOnly])).shops), []);
  assert.deepEqual(Object.keys(JSON.parse(inboxConfig(server, [], [calendarOnly])).shops), []);
});

test("nothing of the agent's can reach a shop's runtime, and its Guards' admin ports are not on the gate", () => {
  const c = composeServer(server, { app: "/repo", generated: "/g", secrets: "/s", status: "/st", shops: "/sh", secretsInbox: "/i", requests: "/r", exports: "/e", panelData: "/p", config: "/c.json", licence: "/l" }, [], { agents: [deploy] });
  const nets = (svc: string) => Object.keys((c.services[svc].block.networks ?? {}) as Record<string, unknown>);
  for (const k of ["razorpay", "whatsapp", "calendar"]) {
    const fwd = c.services[`fwd-my-agent-${k}`].block.command as string[];
    assert.equal(fwd[3], addressing(server).adminIp("my-agent", k as "razorpay", 3), "the admin port listens on the admin network only");
    assert.ok(!nets(`fwd-my-agent-${k}`).includes("front"));
  }
  assert.ok(nets("relay").includes("admin") && !nets("relay").includes("gate") && !nets("ops").includes("gate"));
});

// ---- the heartbeat -------------------------------------------------------------------------------------------------------------------------------

const ROOT = new URL("../../", import.meta.url).pathname;
const FLEET = [process.env.GEOMETER_MONOREPO, join(ROOT, "..", "monorepo"), join(ROOT, "..", "..", "monorepo"), join(ROOT, "..", "..", "geometer", "monorepo"), join(ROOT, "..", "geometer", "monorepo")].filter((x): x is string => !!x).map((c) => join(c, "apps", "fleet", "src", "schema.ts")).find((p) => existsSync(p));
const fleet = FLEET ? await import(FLEET) as { checkHeartbeat(input: unknown): { ok: boolean } } : undefined;

const ownAgent: OpsOwnAgent = {
  createdAt: "2026-11-05T09:00:00Z", recordTokenFile: "/nope", labelKeyFile: "/nope", ownerWhatsapp: "+919800000001",
  guards: ["razorpay", "whatsapp", "calendar"].map((k) => ({ id: `guard-${k}`, service: `g-my-agent-${k}`, adminUrl: `http://admin/${k}`, healthUrl: `http://health/${k}`, adminTokenFile: "/nope", agentUrl: `http://agent/${k}` })),
};
/** The Guards as they answer: ready, tripwires fine, `decisions` calls decided on, and a refund waiting at the Razorpay Guard. */
const guardsAnswer = (decisions: number, down: string[] = []): typeof fetch => (async (url: string | URL | Request) => {
  const u = String(url);
  const kind = /\/(razorpay|whatsapp|calendar)/u.exec(u)?.[1] ?? "";
  if (down.includes(kind)) throw Object.assign(new Error("x"), { cause: { code: "ECONNREFUSED" } });
  if (u.endsWith("/readyz")) return new Response("ok");
  if (u.includes("/admin/approvals")) return Response.json({ approvals: [{ id: "ap-1" }] });
  return Response.json({ runtime: { mode: "enforce" }, kill_switch: { on: false }, tripwires: { ran: true, ok: true, passed: 4, of: 4 }, counts: { decisions } });
}) as typeof fetch;

test("the heartbeat carries an agent's Guards: counts only, up when every Guard answers, a waiting refund as a held call, and nothing it did", async () => {
  const obs = await observeAgent(ownAgent, "0.1.0", "my-agent", guardsAnswer(7));
  const now = new Date("2026-11-05T10:00:00Z");
  const { body, next } = buildHeartbeat({ deploymentId: "acme-vps-1", bundleVersion: "0.1.0", now, shops: [obs], baseline: {} });
  const a = (body.agents as Record<string, unknown>[])[0];
  assert.deepEqual(a, {
    id: "my-agent", pathway: "own-agent", pathway_version: "0.1.0",
    runtime: { up: true, ready: true, tasks: { pending: 0, failed: 0 }, last_step_age_s: null, bookings: {} },
    guards: [{ id: "guard-razorpay", ready: true, mode: "enforce", killed: false, held_calls: 1 }, { id: "guard-whatsapp", ready: true, mode: "enforce", killed: false, held_calls: 0 }, { id: "guard-calendar", ready: true, mode: "enforce", killed: false, held_calls: 0 }],
    since_last: { steps: 21, errors: 0 }, // 7 calls decided at each of three Guards
  });
  if (fleet) assert.equal(fleet.checkHeartbeat(body).ok, true, "fleet's own validator accepts it");
  // the next minute: only what is new
  const again = buildHeartbeat({ deploymentId: "acme-vps-1", bundleVersion: "0.1.0", now: new Date(now.getTime() + 60_000), shops: [await observeAgent(ownAgent, "0.1.0", "my-agent", guardsAnswer(9))], baseline: next });
  assert.deepEqual((again.body.agents as { since_last: unknown }[])[0].since_last, { steps: 6, errors: 0 });
  // a Guard that does not answer: the agent is not up, so fleet alerts, and says which Guard
  const down = await observeAgent(ownAgent, "0.1.0", "my-agent", guardsAnswer(9, ["whatsapp"]));
  assert.deepEqual([down.up, down.ready], [false, false]);
  const sent = buildHeartbeat({ deploymentId: "acme-vps-1", bundleVersion: "0.1.0", now, shops: [down], baseline: {} }).body.agents as { guards: { id: string; ready: boolean }[] }[];
  assert.deepEqual(sent[0].guards.map((g) => [g.id, g.ready]), [["guard-razorpay", true], ["guard-whatsapp", false], ["guard-calendar", true]]);
  if (fleet) assert.equal(fleet.checkHeartbeat(buildHeartbeat({ deploymentId: "acme-vps-1", bundleVersion: "0.1.0", now, shops: [down], baseline: {} }).body).ok, true);
});

test("stop switches an agent's own Guards and nothing shared: there is no model Guard to stop for it", async () => {
  const calls: string[] = [];
  const config = { deploymentId: "x", bundleVersion: "0.1.0", shops: {}, model: { id: "guard-model", service: "g-model", adminUrl: "http://admin/model", healthUrl: "", adminTokenFile: "/nope" }, ownAgents: { "my-agent": ownAgent } } as OpsConfig;
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => { calls.push(`${init?.method} ${String(url)}`); return Response.json({}); }) as typeof fetch;
  const r = await stopShop(config, "my-agent", true, "arjun@laptop", "owner asked", fetchFn);
  assert.deepEqual(calls.sort(), ["POST http://admin/calendar/admin/kill", "POST http://admin/razorpay/admin/kill", "POST http://admin/whatsapp/admin/kill"]);
  assert.equal(r.results.length, 3);
  await assert.rejects(() => stopShop(config, "nobody", true, "x", "y", fetchFn), /no shop nobody on this server/);
});

// ---- the relay's look at the payment -----------------------------------------------------------------------------------------------------------------

const heldItem = (receipt: string | null, payment = "pay_7", amount = "20000") => ({
  id: "ap-1", agent: "agent-my-agent", tool: "razorpay", operation: "refund", requested_at_ms: "1793826609791", expires_at_ms: "1793913009791", you_may_decide: true,
  arguments: ["map", { amount: ["int", amount], payment_id: ["str", payment], ...(receipt ? { receipt: ["str", receipt] } : {}) }],
});
const guardWith = (items: unknown[]) => ({ reviews: async () => ({ ok: true as const, items }), notify: async () => ({ kind: "recorded" as const }) });
const runtimeWith = (items: unknown[], answer: (url: string) => Response | Promise<Response>) => ownAgentRuntime({ guard: guardWith(items), razorpay: { baseUrl: "http://rzp", token: () => "gg_reader" }, business: { name: "Glow Salon", timeZone: "Asia/Kolkata", ownerLanguage: "en" }, fetchFn: (async (url: string | URL | Request, init?: RequestInit) => { assert.equal((init?.headers as Record<string, string>).authorization, "Bearer gg_reader"); return answer(String(url)); }) as typeof fetch });

test("the owner is asked about the payment and the amount Guard holds, with who paid and when from Razorpay's own record; never from the agent", async () => {
  const urls: string[] = [];
  const rt = runtimeWith([heldItem("b-1"), heldItem("b-2", "pay_8")], (url) => { urls.push(url); return Response.json({ id: "pay_7", contact: "+919876543210", created_at: 1793826600 }); });
  const found = await rt.context("b-1");
  assert.deepEqual(urls, ["http://rzp/v1/payments/pay_7"]);
  assert.equal(found.kind, "found");
  if (found.kind === "found") assert.deepEqual(found.context, { booking: "b-1", customerPhone: "+919876543210", businessName: "Glow Salon", timeZone: "Asia/Kolkata", ownerLanguage: "en", serviceName: "payment pay_7", slotMs: 1793826600000, paymentId: "pay_7", amountPaise: 20000, approval: "ap-1", expiresAtMs: 1793913009791 });
  assert.deepEqual(await rt.context("b-9"), { kind: "missing" }, "no held refund has that receipt");
  assert.equal(await rt.decided(), true);
  // Razorpay shows no contact: the payment stands in. Razorpay has no such payment: nobody is asked. Razorpay is down: it is the builder's to look at.
  const none = await runtimeWith([heldItem("b-1")], () => Response.json({ id: "pay_7", created_at: 1793826600 })).context("b-1");
  assert.equal(none.kind === "found" && none.context.customerPhone, "the customer of pay_7");
  assert.deepEqual(await runtimeWith([heldItem("b-1")], () => Response.json({ error: {} }, { status: 400 })).context("b-1"), { kind: "missing" });
  assert.equal((await runtimeWith([heldItem("b-1")], () => new Response("", { status: 502 })).context("b-1")).kind, "error");
  const twice = await runtimeWith([heldItem("b-1"), heldItem("b-1", "pay_8")], () => Response.json({})).context("b-1");
  assert.equal(twice.kind === "error" && /more than one held refund/.test(twice.error), true, "two holds with one receipt are not guessed between");
});

// ---- the inbox ---------------------------------------------------------------------------------------------------------------------------------------

const listen = (handler: (req: IncomingMessage, res: ServerResponse) => void) => new Promise<{ url: string; close(): Promise<void> }>((resolve) => {
  const s = createServer(handler);
  s.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${(s.address() as { port: number }).port}`, close: () => new Promise<void>((done) => { s.closeAllConnections(); s.close(() => done()); }) }));
});
const body = (from: string, text: string, phone = "123456789012345") => JSON.stringify({ entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: phone }, messages: [{ from: from.replace(/\D/gu, ""), id: `wamid.${text}`, timestamp: "1793826610", type: "text", text: { body: text } }] } }] }] });
const sign = (raw: string, secret = "app-secret-0123456789") => `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;

test("the inbox for an agent: a signature is checked before anything is read, the owner's replies reach the relay, everything accepted goes on to the agent as it came, and a failure anywhere is a 503 so the provider sends it again", async () => {
  const toRelay: unknown[] = []; const toAgent: { body: string; signature?: string }[] = [];
  let relayUp = true; let agentUp = true;
  const relay = await listen((req, res) => { const c: Buffer[] = []; req.on("data", (d: Buffer) => c.push(d)); req.on("end", () => { if (!relayUp) { res.writeHead(500); res.end(); return; } toRelay.push({ auth: req.headers.authorization, ...JSON.parse(Buffer.concat(c).toString()) }); res.writeHead(200); res.end("{}"); }); });
  const agent = await listen((req, res) => { const c: Buffer[] = []; req.on("data", (d: Buffer) => c.push(d)); req.on("end", () => { if (!agentUp) { res.writeHead(500); res.end(); return; } toAgent.push({ body: Buffer.concat(c).toString(), signature: req.headers["x-hub-signature-256"] as string }); res.writeHead(200); res.end(); }); });
  const inbox = await listen(agentInboxHandler({ ownerWhatsapp: "+919800000001", phoneNumberId: "123456789012345", verification: "meta-signature", appSecret: "app-secret-0123456789", verifyToken: "verify-token-0123456789", relayUrl: relay.url, relayToken: "relay-token-0123456789", forwardTo: agent.url, log: () => undefined }));
  const post = async (raw: string, signature: string | undefined) => (await fetch(`${inbox.url}/webhooks/whatsapp`, { method: "POST", headers: { "content-type": "application/json", ...(signature ? { "x-hub-signature-256": signature } : {}) }, body: raw })).status;
  try {
    // Meta's handshake
    assert.equal(await (await fetch(`${inbox.url}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-token-0123456789&hub.challenge=abc123`)).text(), "abc123");
    assert.equal((await fetch(`${inbox.url}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc123`)).status, 403);
    // a body nobody signed, or signed with another secret: refused before it is read, and nothing goes anywhere
    const owner = body("+919800000001", "approve ABC123");
    assert.equal(await post(owner, undefined), 401);
    assert.equal(await post(owner, sign(owner, "another-secret-0123456789")), 401);
    assert.deepEqual([toRelay.length, toAgent.length], [0, 0]);
    // the owner's reply: to the relay, with the relay's own token, and on to the agent with Meta's signature unchanged
    assert.equal(await post(owner, sign(owner)), 200);
    assert.equal(toRelay.length, 1);
    assert.equal((toRelay[0] as { auth: string }).auth, "Bearer relay-token-0123456789");
    assert.deepEqual(toAgent.map((a) => [a.body, a.signature]), [[owner, sign(owner)]]);
    // a customer's message goes only to the agent
    const customer = body("+919811111111", "hello");
    assert.equal(await post(customer, sign(customer)), 200);
    assert.deepEqual([toRelay.length, toAgent.length], [1, 2]);
    // a body for another number is not ours, even with a good signature
    const other = body("+919800000001", "approve ZZZ999", "999999999999999");
    assert.equal(await post(other, sign(other)), 200);
    assert.deepEqual([toRelay.length, toAgent.length], [1, 2]);
    // the relay cannot take it, or the agent cannot: 503, and the provider sends it again
    relayUp = false;
    assert.equal(await post(owner, sign(owner)), 503);
    relayUp = true; agentUp = false;
    assert.equal(await post(customer, sign(customer)), 503);
    // and only that one route exists
    assert.equal((await fetch(`${inbox.url}/webhooks/razorpay`, { method: "POST", body: "{}" })).status, 404);
  } finally { await inbox.close(); await relay.close(); await agent.close(); }
});

test("the inbox for a provider that does not sign its webhooks: a secret address, and a wrong one is a 404 as if nothing were there", async () => {
  const toRelay: unknown[] = [];
  const relay = await listen((req, res) => { req.on("data", () => undefined); req.on("end", () => { toRelay.push(req.url); res.writeHead(200); res.end("{}"); }); });
  const inbox = await listen(agentInboxHandler({ ownerWhatsapp: "+919800000001", phoneNumberId: "123456789012345", verification: "path-token", pathToken: "a-long-unguessable-token-0123", relayUrl: relay.url, relayToken: "relay-token-0123456789", log: () => undefined }));
  try {
    const owner = body("+919800000001", "approve ABC123");
    const post = async (path: string) => (await fetch(`${inbox.url}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: owner })).status;
    assert.equal(await post("/webhooks/whatsapp"), 404);
    assert.equal(await post("/webhooks/whatsapp/wrong-token-0123456789"), 404);
    assert.equal(toRelay.length, 0);
    assert.equal(await post("/webhooks/whatsapp/a-long-unguessable-token-0123"), 200);
    assert.equal(toRelay.length, 1);
    assert.throws(() => agentInboxHandler({ ownerWhatsapp: "+919800000001", phoneNumberId: "1", verification: "meta-signature", relayUrl: "x", relayToken: "y" }), /needs the app secret and the verify token/);
  } finally { await inbox.close(); await relay.close(); }
});
