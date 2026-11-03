// The Google token refresher, the ops container's stop, and the relay host's credential handling: token discipline (never logged, never retried in a tight
// loop, the key file never rewritten), and a stopped shop that says who stopped it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createVerify } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRefresher, exchange, signAssertion } from "../services/refresher.ts";
import { adminCall, observeGuard, stopShop } from "../services/ops.ts";
import type { OpsConfig } from "../services/ops.ts";
import { rereadingGuardClient } from "../services/relay.ts";

function folder() {
  const dir = mkdtempSync(join(tmpdir(), "geo-svc-"));
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const account = { client_email: "sa@project.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) as string, token_uri: "https://oauth2.example/token" };
  writeFileSync(join(dir, "sa.json"), JSON.stringify(account));
  writeFileSync(join(dir, "admin_token"), "gg_0123456789abcdef0123456789abcdef");
  return { dir, account, publicKey, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test("the assertion is a signed JWT Google can check: the service account, the scope, the audience and an hour", () => {
  const f = folder(); try {
    const jwt = signAssertion(f.account, "https://www.googleapis.com/auth/calendar", 1_793_700_000);
    const [h, c, s] = jwt.split(".");
    assert.deepEqual(JSON.parse(Buffer.from(h, "base64url").toString()), { alg: "RS256", typ: "JWT" });
    assert.deepEqual(JSON.parse(Buffer.from(c, "base64url").toString()), { iss: f.account.client_email, scope: "https://www.googleapis.com/auth/calendar", aud: f.account.token_uri, iat: 1_793_700_000, exp: 1_793_703_600 });
    assert.ok(createVerify("RSA-SHA256").update(`${h}.${c}`).verify(f.publicKey, Buffer.from(s, "base64url")));
  } finally { f.done(); }
});

test("a refresh writes 'Bearer <token>' for that shop only, asks that shop's Calendar Guard to reload, and logs no token", async () => {
  const f = folder(); try {
    const log: string[] = []; const calls: { url: string; auth?: string; body?: string }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, auth: (init.headers as Record<string, string>)?.authorization, body: String(init.body ?? "") });
      return url.includes("oauth2") ? new Response(JSON.stringify({ access_token: "ya29.TOKEN-VALUE-0123456789", expires_in: 3599, token_type: "Bearer" })) : new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const out = join(f.dir, "out");
    const r = createRefresher({ outDir: out, refreshMinutes: 45, scope: "s", shops: { "glow-salon": { serviceAccountFile: join(f.dir, "sa.json"), guardAdminUrl: "http://10.231.240.22:8190", adminTokenFile: join(f.dir, "admin_token") } } }, { fetch: fake, now: () => 1_793_700_000_000, log: (l) => log.push(l) });
    assert.equal(r.healthy(), false, "no token yet: the Calendar Guards wait");
    await r.refreshAll();
    assert.equal(readFileSync(join(out, "glow-salon", "authorization"), "utf8"), "Bearer ya29.TOKEN-VALUE-0123456789");
    assert.equal(statSync(join(out, "glow-salon", "authorization")).mode & 0o777, 0o644);
    assert.equal(r.healthy(), true);
    assert.match(calls[0].body!, /grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=/);
    assert.deepEqual([calls[1].url, calls[1].auth], ["http://10.231.240.22:8190/admin/reload", "Bearer gg_0123456789abcdef0123456789abcdef"]);
    assert.ok(!log.join("\n").includes("TOKEN-VALUE") && !log.join("\n").includes("gg_0123"), log.join("\n"));
    assert.match(log[0], /glow-salon: new Google token written \(valid 60 min\)/);
  } finally { f.done(); }
});

test("a failed exchange is tried once, then waits 1 minute, then 2, and the old file is left alone; the key file is never rewritten", async () => {
  const f = folder(); try {
    let t = 1_793_700_000_000; const log: string[] = []; let n = 0;
    const fake = (async () => { n++; return new Response("denied: invalid_grant for ya29.SECRET-ECHO", { status: 400 }); }) as unknown as typeof fetch;
    const before = readFileSync(join(f.dir, "sa.json"), "utf8");
    const r = createRefresher({ outDir: join(f.dir, "out"), refreshMinutes: 45, scope: "s", shops: { s: { serviceAccountFile: join(f.dir, "sa.json"), guardAdminUrl: "http://x", adminTokenFile: join(f.dir, "admin_token") } } }, { fetch: fake, now: () => t, log: (l) => log.push(l) });
    await r.refreshAll(); assert.equal(n, 1);
    assert.match(log[0], /\(the token endpoint answered 400\); trying again in 1 min/);
    assert.ok(!log[0].includes("SECRET-ECHO"), "the body of a failed answer (which could echo a credential) is never logged");
    assert.equal(r.healthy(), false);
    assert.equal(readFileSync(join(f.dir, "sa.json"), "utf8"), before);
    assert.match((await exchange(join(f.dir, "missing.json"), "s") as { why: string }).why, /could not be read/);
    t += 61_000; await r.refreshAll(); assert.match(log[1], /in 2 min/);
  } finally { f.done(); }
});

test("stop engages the kill switch on all three of the shop's Guards, stops the shop's agent on the model Guard only, and the reason says who", async () => {
  const calls: { url: string; body: unknown }[] = [];
  const fake = (async (url: string, init: RequestInit) => { calls.push({ url, body: JSON.parse(String(init.body)) }); return new Response('{"ok":true}', { status: 200 }); }) as unknown as typeof fetch;
  const g = (id: string, ip: number) => ({ id: `guard-${id}`, service: `g-glow-salon-${id}`, adminUrl: `http://10.231.240.${ip}:8190`, healthUrl: `http://10.231.240.${ip}:8081`, adminTokenFile: "/nonexistent" });
  const config: OpsConfig = { deploymentId: "x", bundleVersion: "0.1.0", shops: { "glow-salon": { pathway: "bookings", pathwayVersion: "0.1.0", runtimeUrl: "http://rt", internalTokenFile: "/n", guards: [g("razorpay", 20), g("whatsapp", 21), g("calendar", 22)] } }, model: { id: "guard-model", service: "g-model", adminUrl: "http://10.231.240.8:8190", healthUrl: "http://10.231.240.8:8081", adminTokenFile: "/n" } };
  const r = await stopShop(config, "glow-salon", true, "arjun@laptop", "customer complaint", fake);
  assert.deepEqual(calls.map((c) => c.url).sort(), ["http://10.231.240.20:8190/admin/kill", "http://10.231.240.21:8190/admin/kill", "http://10.231.240.22:8190/admin/kill", "http://10.231.240.8:8190/admin/agents/runtime-glow-salon/stop"]);
  for (const c of calls) { assert.equal((c.body as { on: boolean }).on, true); assert.match((c.body as { reason: string }).reason, /^stopped by arjun@laptop at 20\d\d-.*: customer complaint$/); }
  assert.match(r.reason, /stopped by arjun@laptop/);
  await assert.rejects(stopShop(config, "nobody", true, "x", "", fake), /no shop nobody/);
  assert.equal((await adminCall({ adminUrl: "http://127.0.0.1:1", adminTokenFile: "/n" }, "GET", "/admin/status")).status, 0, "a Guard that cannot be reached is status 0, not a crash");
  assert.equal((await observeGuard(config.model, false, (async () => { throw new Error("no"); }) as unknown as typeof fetch)).healthReady, false);
});

test("the relay re-reads its reading credential from its file on every call, so a renewed one is used without a restart", async () => {
  const f = folder(); try {
    mkdirSync(join(f.dir, "s"), { recursive: true });
    writeFileSync(join(f.dir, "s", "owner_notify_secret"), "notify-secret"); writeFileSync(join(f.dir, "s", "read_token"), "gg_old");
    const seen: string[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init: RequestInit) => { seen.push(String((init.headers as Record<string, string>).authorization)); return new Response('{"reviews":[]}'); }) as unknown as typeof fetch;
    try {
      const read = (p: string) => { try { return readFileSync(p, "utf8").trim(); } catch { return undefined; } };
      const client = rereadingGuardClient({ guardAdminUrl: "http://g", approverId: "owner-x", agentId: "a", runtimeUrl: "r", whatsappGuardUrl: "w", ownerWhatsapp: "+919800000001", phoneNumberId: "1", secretsDir: join(f.dir, "s"), stateDir: "s" }, read);
      await client.reviews();
      writeFileSync(join(f.dir, "s", "read_token"), "gg_new");
      await client.reviews();
    } finally { globalThis.fetch = real; }
    assert.deepEqual(seen, ["Bearer gg_old", "Bearer gg_new"]);
  } finally { f.done(); }
});
