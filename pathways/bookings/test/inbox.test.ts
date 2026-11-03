// The inbox on an ephemeral port with a fake runtime: signatures are checked on the raw bytes before anything is parsed,
// the runtime is told only about good webhooks, and the provider is answered 200 only if the runtime took the events.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startInbox } from "../inbox/server.ts";
import type { InboxConfig, RunningInbox } from "../inbox/server.ts";
import { signMeta, signRazorpay } from "../src/adapters/live/webhooks.ts";
import { fixtureText, scripted } from "./helpers/scripted-server.ts";
import type { Answer, Recorded, Scripted } from "./helpers/scripted-server.ts";

const SECRETS = { internalToken: "tok-internal-123", razorpayWebhookSecret: "rzp-whsec-456", whatsappAppSecret: "wa-app-secret-789", whatsappVerifyToken: "verify-me-000" };

async function withInbox(run: (t: { inbox: RunningInbox; runtime: Scripted; logs: string[]; post(path: string, body: string | Buffer, headers?: Record<string, string>): Promise<{ status: number; text: string }> }) => Promise<void>, options: { runtime?: (r: Recorded) => Answer; config?: Partial<InboxConfig> } = {}) {
  const runtime = await scripted(options.runtime ?? (() => ({ status: 200, json: { ok: true } })));
  const logs: string[] = [];
  const inbox = await startInbox({ runtimeUrl: runtime.url, ...SECRETS, log: (l) => logs.push(l), ...options.config }, { port: 0 });
  const post = async (path: string, body: string | Buffer, headers: Record<string, string> = {}) => {
    const r = await fetch(inbox.url + path, { method: "POST", body, headers });
    return { status: r.status, text: await r.text() };
  };
  try { await run({ inbox, runtime, logs, post }); } finally { await inbox.close(); await runtime.close(); }
}

const razorpayBody = fixtureText("razorpay-webhook-payment_link.paid.json");
const razorpayHeaders = (body: string, extra: Record<string, string> = {}) => ({ "content-type": "application/json", "x-razorpay-signature": signRazorpay(Buffer.from(body), SECRETS.razorpayWebhookSecret), "x-razorpay-event-id": "evt_abc", ...extra });
const whatsappBody = fixtureText("whatsapp-webhook-text.json");
const whatsappHeaders = (body: string) => ({ "content-type": "application/json", "x-hub-signature-256": signMeta(Buffer.from(body), SECRETS.whatsappAppSecret) });

test("razorpay: a good signature is parsed, handed to the runtime with the internal token, and answered 200", async () => {
  await withInbox(async ({ runtime, post }) => {
    const r = await post("/webhooks/razorpay", razorpayBody, razorpayHeaders(razorpayBody));
    assert.equal(r.status, 200);
    assert.equal(runtime.requests.length, 1);
    assert.equal(runtime.requests[0].method, "POST");
    assert.equal(runtime.requests[0].url, "/internal/events");
    assert.equal(runtime.requests[0].headers.authorization, `Bearer ${SECRETS.internalToken}`);
    const sent = JSON.parse(runtime.requests[0].body);
    assert.deepEqual(Object.keys(sent), ["events"]);
    assert.equal(sent.events[0].kind, "payment_event");
    assert.equal(sent.events[0].event.id, "evt_abc"); // the id is the header's
    assert.equal(sent.events[0].event.event, "payment_link.paid");
    assert.equal(sent.events[0].event.payload.payment_link.id, "plink_QflcnnZqCekuvL");
  });
});

test("a bad, missing or wrong-body signature is 401 and nothing reaches the runtime; the signature is checked before the body is read as JSON", async () => {
  await withInbox(async ({ runtime, post }) => {
    assert.equal((await post("/webhooks/razorpay", razorpayBody, { ...razorpayHeaders(razorpayBody), "x-razorpay-signature": "0".repeat(64) })).status, 401);
    assert.equal((await post("/webhooks/razorpay", razorpayBody, { "content-type": "application/json" })).status, 401);
    assert.equal((await post("/webhooks/razorpay", razorpayBody + " ", razorpayHeaders(razorpayBody))).status, 401); // signed for other bytes
    assert.equal((await post("/webhooks/razorpay", "{not json", { "x-razorpay-signature": "0".repeat(64) })).status, 401); // unsigned junk is 401, not 400
    assert.equal((await post("/webhooks/razorpay", "{not json", razorpayHeaders("{not json"))).status, 400); // signed junk is the provider's bug
    assert.equal((await post("/webhooks/whatsapp", whatsappBody, { "x-hub-signature-256": signMeta(Buffer.from(whatsappBody), "the wrong app secret") })).status, 401);
    assert.equal((await post("/webhooks/whatsapp", whatsappBody, { "x-hub-signature-256": signMeta(Buffer.from(whatsappBody), SECRETS.whatsappAppSecret).replace("sha256=", "") })).status, 401);
    assert.equal((await post("/webhooks/whatsapp", whatsappBody, { "x-hub-signature-256": signRazorpay(Buffer.from(whatsappBody), SECRETS.razorpayWebhookSecret) })).status, 401); // the other provider's secret and format
    assert.equal(runtime.requests.length, 0);
  });
});

test("whatsapp: a signed message is forwarded as a message event; a status-only webhook and an event the agent does not use are answered 200 and not forwarded", async () => {
  await withInbox(async ({ runtime, post }) => {
    assert.equal((await post("/webhooks/whatsapp", whatsappBody, whatsappHeaders(whatsappBody))).status, 200);
    const sent = JSON.parse(runtime.requests[0].body);
    assert.deepEqual(sent.events, [{ kind: "message", message: { id: "wamid.HBgLMTY1MDM4Nzk0MzkVAgASGBQzQTRBNjU5OUFFRTAzODEwMTQ0RgA=", from: "+16505551234", text: "Does it come in another color?", timestamp: 1749416383000 } }]);
    const status = fixtureText("whatsapp-webhook-status-delivered.json");
    assert.equal((await post("/webhooks/whatsapp", status, whatsappHeaders(status))).status, 200);
    const expired = fixtureText("razorpay-webhook-payment_link.expired.json");
    assert.equal((await post("/webhooks/razorpay", expired, razorpayHeaders(expired))).status, 200);
    assert.equal(runtime.requests.length, 1);
  });
});

test("if the runtime does not take the events (an error, down, or too slow) the provider is told 503 so it sends them again", async () => {
  await withInbox(async ({ post }) => {
    assert.equal((await post("/webhooks/razorpay", razorpayBody, razorpayHeaders(razorpayBody))).status, 503);
    assert.equal((await post("/webhooks/whatsapp", whatsappBody, whatsappHeaders(whatsappBody))).status, 503);
  }, { runtime: () => ({ status: 500, json: { error: "disk full" } }) });
  await withInbox(async ({ runtime, post }) => {
    await runtime.close();
    assert.equal((await post("/webhooks/razorpay", razorpayBody, razorpayHeaders(razorpayBody))).status, 503);
  });
  await withInbox(async ({ post }) => {
    assert.equal((await post("/webhooks/razorpay", razorpayBody, razorpayHeaders(razorpayBody))).status, 503);
  }, { runtime: () => ({ status: 200, json: {}, delayMs: 400 }), config: { forwardTimeoutMs: 100 } });
  await withInbox(async ({ post }) => {
    assert.equal((await post("/webhooks/razorpay", razorpayBody, razorpayHeaders(razorpayBody))).status, 503); // 3xx and 4xx from the runtime are not "saved" either
  }, { runtime: () => ({ status: 401, json: {} }) });
});

test("meta's verification handshake echoes the challenge only for the right token and mode", async () => {
  await withInbox(async ({ inbox }) => {
    const get = async (query: string) => { const r = await fetch(`${inbox.url}/webhooks/whatsapp?${query}`); return { status: r.status, text: await r.text() }; };
    assert.deepEqual(await get(`hub.mode=subscribe&hub.verify_token=${SECRETS.whatsappVerifyToken}&hub.challenge=1158201444`), { status: 200, text: "1158201444" });
    assert.equal((await get("hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1")).status, 403);
    assert.equal((await get(`hub.mode=unsubscribe&hub.verify_token=${SECRETS.whatsappVerifyToken}&hub.challenge=1`)).status, 403);
    assert.equal((await get("hub.mode=subscribe&hub.challenge=1")).status, 403);
    assert.equal((await get(`hub.mode=subscribe&hub.verify_token=${SECRETS.whatsappVerifyToken.slice(1)}&hub.challenge=1`)).status, 403);
  });
});

test("wrong methods are 405, unknown paths 404, and a body over the limit is 413 and goes nowhere", async () => {
  await withInbox(async ({ inbox, runtime, post }) => {
    assert.equal((await fetch(`${inbox.url}/webhooks/razorpay`)).status, 405);
    assert.equal((await fetch(`${inbox.url}/webhooks/whatsapp`, { method: "PUT", body: "x" })).status, 405);
    assert.equal((await fetch(`${inbox.url}/webhooks/razorpay`, { method: "DELETE" })).status, 405);
    assert.equal((await fetch(`${inbox.url}/nope`)).status, 404);
    assert.equal((await fetch(`${inbox.url}/healthz`)).status, 200);
    const big = "x".repeat(2000);
    const rejected = await post("/webhooks/razorpay", big, razorpayHeaders(big)).catch(() => ({ status: 413 })); // the server may close the connection while we are still sending
    assert.equal(rejected.status, 413);
    assert.equal(runtime.requests.length, 0);
  }, { config: { maxBodyBytes: { razorpay: 1000, whatsapp: 1000 } } });
});

test("the log has no secret, no body, no phone number and no message text", async () => {
  await withInbox(async ({ post, logs }) => {
    await post("/webhooks/razorpay", razorpayBody, razorpayHeaders(razorpayBody));
    await post("/webhooks/whatsapp", whatsappBody, whatsappHeaders(whatsappBody));
    await post("/webhooks/whatsapp", whatsappBody, { "x-hub-signature-256": "sha256=bad" });
    assert.ok(logs.length >= 3);
    const all = logs.join("\n");
    for (const forbidden of [...Object.values(SECRETS), "16505551234", "another color", "plink_", "bad", "pay_"]) assert.ok(!all.includes(forbidden), `the log mentions ${forbidden}: ${all}`);
  });
});

test("as its own process: it refuses to start without its settings, reads secrets from files (newline dropped), and never prints them", async () => {
  const dir = mkdtempSync(join(tmpdir(), "inbox-"));
  const file = (name: string, content: string) => { const p = join(dir, name); writeFileSync(p, content); return p; };
  const env = {
    RUNTIME_URL: "http://127.0.0.1:1", PORT: "0", HOST: "127.0.0.1",
    INTERNAL_TOKEN_FILE: file("token", `${SECRETS.internalToken}\n`), RAZORPAY_WEBHOOK_SECRET_FILE: file("rzp", `${SECRETS.razorpayWebhookSecret}\n`),
    WHATSAPP_APP_SECRET_FILE: file("app", `${SECRETS.whatsappAppSecret}\n`), WHATSAPP_VERIFY_TOKEN_FILE: file("verify", `${SECRETS.whatsappVerifyToken}\n`),
  };
  const main = new URL("../inbox/main.ts", import.meta.url).pathname;
  const run = (e: Record<string, string>) => spawn(process.execPath, [main], { env: { PATH: process.env.PATH ?? "", ...e } });

  const missing = run({ ...env, RAZORPAY_WEBHOOK_SECRET_FILE: join(dir, "does-not-exist") });
  let err = "";
  missing.stderr.on("data", (d) => { err += d; });
  const code = await new Promise((resolve) => missing.on("close", resolve));
  assert.equal(code, 2);
  assert.match(err, /RAZORPAY_WEBHOOK_SECRET_FILE/);

  const child = run(env);
  const out = await new Promise<string>((resolve, reject) => {
    let seen = "";
    const timer = setTimeout(() => reject(new Error(`the inbox did not start: ${seen}`)), 8000);
    child.stderr.on("data", (d) => { seen += d; if (/listening on/.test(seen)) { clearTimeout(timer); resolve(seen); } });
  });
  try {
    const port = /127\.0\.0\.1:(\d+)/.exec(out)![1];
    const body = razorpayBody;
    const bad = await fetch(`http://127.0.0.1:${port}/webhooks/razorpay`, { method: "POST", body, headers: { "x-razorpay-signature": "0".repeat(64) } });
    assert.equal(bad.status, 401);
    // the file's secret (without its newline) is the key: a body signed with it is accepted by the inbox (the runtime at :1 is down, so 503, not 401)
    const good = await fetch(`http://127.0.0.1:${port}/webhooks/razorpay`, { method: "POST", body, headers: razorpayHeaders(body) });
    assert.equal(good.status, 503);
    for (const secret of Object.values(SECRETS)) assert.ok(!out.includes(secret));
  } finally { child.kill("SIGTERM"); }
});

// ---- the runtime refuses more than 100 events or 256 KiB in one request ----

function manyMessages(count: number, textLength = 20) {
  const hook = JSON.parse(fixtureText("whatsapp-webhook-text.json"));
  const base = hook.entry[0].changes[0].value.messages[0];
  hook.entry[0].changes[0].value.messages = Array.from({ length: count }, (_v, i) => ({ ...base, id: `wamid.m${i}`, timestamp: String(1749416383 + i), text: { body: String(i).padStart(4, "0") + "x".repeat(textLength) } }));
  return JSON.stringify(hook);
}

test("a webhook with many messages is forwarded in order, in requests of at most 100 events and 200 KiB, and every timestamp is milliseconds", async () => {
  await withInbox(async ({ runtime, post }) => {
    const body = manyMessages(250);
    assert.equal((await post("/webhooks/whatsapp", body, whatsappHeaders(body))).status, 200);
    const sent = runtime.requests.map((r) => JSON.parse(r.body).events);
    assert.deepEqual(sent.map((e) => e.length), [100, 100, 50]);
    const all = sent.flat();
    assert.deepEqual(all.map((e: any) => e.message.id), Array.from({ length: 250 }, (_v, i) => `wamid.m${i}`));
    assert.equal(all[0].message.timestamp, 1749416383 * 1000); // WhatsApp sends epoch seconds; the runtime wants milliseconds
    assert.equal(all[249].message.timestamp, (1749416383 + 249) * 1000);
    for (const r of runtime.requests) assert.ok(Buffer.byteLength(r.body) <= 200 * 1024);
  });
  await withInbox(async ({ runtime, post }) => {
    const body = manyMessages(90, 4000); // 90 messages of about 4 KB: under 100 events, but more than 200 KiB
    assert.equal((await post("/webhooks/whatsapp", body, whatsappHeaders(body))).status, 200);
    assert.ok(runtime.requests.length >= 2);
    for (const r of runtime.requests) { assert.ok(Buffer.byteLength(r.body) <= 200 * 1024); assert.ok(JSON.parse(r.body).events.length <= 100); }
    assert.equal(runtime.requests.reduce((n, r) => n + JSON.parse(r.body).events.length, 0), 90);
  });
});

test("if a later batch is not taken, the provider is told 503 (it sends the webhook again, and the runtime skips the message ids it already saved)", async () => {
  let calls = 0;
  await withInbox(async ({ runtime, post }) => {
    const body = manyMessages(150);
    assert.equal((await post("/webhooks/whatsapp", body, whatsappHeaders(body))).status, 503);
    assert.equal(runtime.requests.length, 2);
  }, { runtime: () => (++calls === 2 ? { status: 503, json: {} } : { status: 200, json: {} }) });
});
