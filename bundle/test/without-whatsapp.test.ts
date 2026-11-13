// Item 11h's bundle half (decision 45): a shop with no WhatsApp number is planned and deployed with its page alone, and every shop's pushes go through a push Guard
// of its own to the server's one push sender. Pure checks (no Docker): the plan, the push Guard's spec and guard.toml, the compose layout, the push sender's
// address rule, and the panel's go-live conditions. The real Guard image compiles and verifies the push spec in the Docker proof (test/proof/run.ts, "nowhatsapp").
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { PUSH_HOSTS, PUSH_LICENCE, PUSH_LIMITS, guardToml, pushGuardDef, pushSpec } from "../generate/guards.ts";
import { PUSH_ADMIN_BASE, addressing } from "../generate/compose.ts";
import { planShop } from "../generate/shop.ts";
import { pushHandler, pushRequest } from "../services/push.ts";
import type { PushCall } from "../../modules/push/hosts.ts";
import { runtimeHasWhatsApp } from "../lib/kinds.ts";
import { panelRuntime, serverConfig, tempServer } from "./helpers.ts";

const plan = (runtime: Record<string, unknown>) => {
  const t = tempServer({ "glow-salon": runtime });
  try { return planShop(serverConfig(), t.shop("glow-salon")); } finally { t.done(); }
};
const noWhatsApp = () => { const r = panelRuntime() as { services: Record<string, unknown> }; const { messaging: _m, ...services } = r.services; return { ...r, services }; };

test("a shop whose runtime.json names no messaging has no WhatsApp: no number is asked, no WhatsApp Guard, no messaging in its runtime; its push Guard is there", () => {
  const p = plan(noWhatsApp());
  assert.deepEqual(p.problems, []);
  assert.equal(runtimeHasWhatsApp(noWhatsApp()), false);
  assert.equal(runtimeHasWhatsApp(panelRuntime()), true);
  assert.ok(!p.guards.some((g) => g.kind === "whatsapp"));
  assert.ok(p.guards.some((g) => g.kind === "push"));
  const services = (p.runtime.services ?? {}) as Record<string, unknown>;
  assert.equal(services.messaging, undefined);
  assert.deepEqual(services.push, { baseUrl: "http://g-glow-salon-push:8080", agentTokenFile: "/run/secrets/agent_push" });
  const withIt = plan(panelRuntime());
  assert.ok(withIt.guards.some((g) => g.kind === "whatsapp") && withIt.guards.some((g) => g.kind === "push"), "a shop with WhatsApp keeps it, and gets push too");
});

test("the push Guard: the push services' hosts exactly, a daily count per kind and per phone, its own licence lists (a customer's push held back in the final stop, never the owner's)", () => {
  const spec = pushSpec({ tenant: "glow-salon", name: "glow-salon-push", version: 1, reviewedBy: "t" }, PUSH_LIMITS);
  assert.equal(spec.tool, "web-push");
  assert.deepEqual(spec.rules.map((r: { operation: string; field: string; match: string; allowed_values: string[] }) => [r.operation, r.field, r.match, r.allowed_values]), [
    ["push_owner", "host", "exact", [...PUSH_HOSTS]], ["push_customer", "host", "exact", [...PUSH_HOSTS]],
  ]);
  assert.deepEqual(spec.limits.map((l: { id: string; scope: string[]; cap: string; window_seconds: number }) => [l.id, l.scope, l.cap, l.window_seconds]), [
    ["owner-pushes-per-day", [], "200", 86_400], ["customer-pushes-per-day", [], "500", 86_400],
    ["pushes-per-phone-per-day-owner", ["sub"], "50", 86_400], ["pushes-per-phone-per-day-customer", ["sub"], "50", 86_400],
  ]);
  const toml = guardToml({ def: pushGuardDef(), tenant: "glow-salon", deployment: "glow-salon-push", bundleDigest: "sha256:" + "0".repeat(64), upstream: { host: "push:8798", tls: false }, adminSha: "0".repeat(64), agents: [{ id: "runtime-glow-salon", sha: "1".repeat(64) }], licence: { deployment: "srv", shop: "glow-salon", ownerNumbers: ["+919000000000"] } });
  assert.match(toml, /^upstream = "push:8798"$/mu, "in front of the server's push sender, in plain HTTP on its private network");
  assert.doesNotMatch(toml, /\[upstream_tls\]/u);
  assert.match(toml, /^wind_down_refuses = \[\]$/mu);
  assert.match(toml, new RegExp(`^stopped_refuses = \\["${PUSH_LICENCE.stopped[0]}"\\]$`, "mu"));
});

test("compose: the push Guards' admin addresses are a range of their own, clear of every shop's four and of each other", () => {
  const net = addressing(serverConfig());
  const four = new Set<string>();
  for (let i = 0; i < 224; i++) for (const slot of ["razorpay", "whatsapp", "calendar", "door"] as const) four.add(net.adminIp(`s${i}`, slot, i));
  const push = new Set(Array.from({ length: 224 }, (_, i) => net.adminIp(`s${i}`, "push", i)));
  assert.equal(push.size, 224);
  assert.ok([...push].every((ip) => !four.has(ip)), "no push Guard takes a shop's address");
  assert.ok(PUSH_ADMIN_BASE + 223 < 4094, "inside the admin /20");
});

test("the push sender: the address is built from the host Guard checked and nothing else; a test server only through the override; anything else is refused before it goes", async () => {
  const call: PushCall = { host: "fcm.googleapis.com", path: "/fcm/send/abc:1", sub: "0123456789ab", ttl: 60, urgency: "high", topic: "owner-0123456789ab", vapid: "vapid t=a.b.c, k=AAAA", body: Buffer.from("ciphertext").toString("base64url") };
  const r = pushRequest(call);
  assert.equal(r.url, "https://fcm.googleapis.com/fcm/send/abc:1");
  assert.deepEqual(r.headers, { ttl: "60", urgency: "high", topic: "owner-0123456789ab", "content-encoding": "aes128gcm", "content-type": "application/octet-stream", authorization: "vapid t=a.b.c, k=AAAA" });
  assert.equal(r.body.toString(), "ciphertext");
  assert.equal(pushRequest(call, "http://standins:8792").url, "http://standins:8792/fcm/send/abc:1");
  assert.equal(pushRequest(call, "http://standins:8792").headers["x-push-host"], "fcm.googleapis.com");

  const sent: string[] = [];
  const handler = pushHandler({ fetchImpl: (async (url: string) => { sent.push(url); return new Response(null, { status: 201 }); }) as unknown as typeof fetch });
  const server = createServer((req, res) => { void handler(req, res); });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const at = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const post = (path: string, body: unknown) => fetch(`${at}${path}`, { method: "POST", body: JSON.stringify(body) });
    assert.equal((await post("/v1/push/owner", call)).status, 201, "the push service's own status comes back");
    assert.equal((await post("/v1/push/owner", { ...call, host: "evil.example" })).status, 400);
    assert.equal((await post("/v1/push/owner", { ...call, path: "//evil.example/x" })).status, 400);
    assert.equal((await post("/v1/anything", call)).status, 404);
    assert.deepEqual(sent, ["https://fcm.googleapis.com/fcm/send/abc:1"], "only the checked push went out");
  } finally { server.close(); }
});
