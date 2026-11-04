// The dev forwarder (Phase 0 only): it adds the credential, passes the call on, refuses live Razorpay keys, and never shows a key.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BANNER, configFromEnv, parseEnv, startDevForwarder } from "../standins/dev-forwarder.ts";
import { createLiveAdapters } from "../src/adapters/live/index.ts";
import { fakeClock } from "../../../modules/core/clock.ts";
import { fixture, scripted } from "./helpers/scripted-server.ts";

const KEYS = { RAZORPAY_KEY_ID: "rzp_test_abc123", RAZORPAY_KEY_SECRET: "rzp-secret-xyz", GOOGLE_ACCESS_TOKEN: "ya29.google-token", WHATSAPP_ACCESS_TOKEN: "wa-token-777" };

test(".env text: comments, quotes, export and blank lines", () => {
  assert.deepEqual(parseEnv('# a comment\n\nRAZORPAY_KEY_ID=rzp_test_1\nexport A="quoted value"\nB=\'single\'\nC = spaced \r\nnot a pair\n'), { RAZORPAY_KEY_ID: "rzp_test_1", A: "quoted value", B: "single", C: "spaced" });
});

test("it refuses a live Razorpay key (in either place), a key that is not a test key, a missing secret, and an empty setup, without repeating the key", () => {
  const mustNotMention = "rzp_live_SECRETSECRET";
  for (const env of [
    { ...KEYS, RAZORPAY_KEY_ID: mustNotMention },
    { ...KEYS, SOMETHING_ELSE: `prefix ${mustNotMention}` },
    { RAZORPAY_KEY_ID: "key_without_prefix", RAZORPAY_KEY_SECRET: "s" },
    { RAZORPAY_KEY_ID: "rzp_test_abc" },
    {},
  ] as Record<string, string>[]) {
    assert.throws(() => configFromEnv(env), (e: Error) => !e.message.includes(mustNotMention) && !e.message.includes("rzp-secret-xyz"));
  }
  assert.throws(() => configFromEnv({ ...KEYS, RAZORPAY_KEY_ID: mustNotMention }), /LIVE Razorpay key/);
  assert.throws(() => configFromEnv({ RAZORPAY_KEY_ID: "rzp_prod_x", RAZORPAY_KEY_SECRET: "s" }), /rzp_test_/);
  assert.deepEqual(Object.keys(configFromEnv({ GOOGLE_ACCESS_TOKEN: "t" })), ["google"]); // one service is enough
  assert.deepEqual(Object.keys(configFromEnv(KEYS)).sort(), ["google", "razorpay", "whatsapp"]);
  assert.throws(() => configFromEnv({ ...KEYS, WHATSAPP_BASE_URL: "https://user:pass@host.example" }), /plain web address/);
});

test("it adds each service's credential, drops the caller's own, passes the path, query, body and status through, and logs no key", async () => {
  const upstream = await scripted((r) => (r.url.startsWith("/v1/payment_links") ? { status: 400, json: fixture("razorpay-error-not-exist.json") } : { json: { ok: true } }));
  const logs: string[] = [];
  const fwd = await startDevForwarder({
    razorpay: { keyId: KEYS.RAZORPAY_KEY_ID, keySecret: KEYS.RAZORPAY_KEY_SECRET, baseUrl: upstream.url },
    google: { accessToken: KEYS.GOOGLE_ACCESS_TOKEN, baseUrl: upstream.url },
    whatsapp: { accessToken: KEYS.WHATSAPP_ACCESS_TOKEN, baseUrl: upstream.url, headerName: "D360-API-KEY" },
    log: (l) => logs.push(l),
  }, { port: 0 });
  try {
    const r = await fetch(`${fwd.url}/razorpay/v1/payment_links/plink_x?reference_id=b-1`, { headers: { authorization: "Bearer caller-tried-this" } });
    assert.equal(r.status, 400); // the real service's status, passed on
    assert.equal(r.headers.get("x-geometer-dev-forwarder"), "not-guard");
    assert.equal((await r.json()).error.description, "The id provided does not exist");
    assert.equal(upstream.requests[0].url, "/v1/payment_links/plink_x?reference_id=b-1");
    assert.equal(upstream.requests[0].headers.authorization, `Basic ${Buffer.from("rzp_test_abc123:rzp-secret-xyz").toString("base64")}`);

    await fetch(`${fwd.url}/google/calendar/v3/calendars/c/events`, { method: "POST", body: JSON.stringify({ summary: "x" }), headers: { "content-type": "application/json" } });
    assert.equal(upstream.requests[1].headers.authorization, "Bearer ya29.google-token");
    assert.equal(upstream.requests[1].url, "/calendar/v3/calendars/c/events");
    assert.deepEqual(JSON.parse(upstream.requests[1].body), { summary: "x" });

    await fetch(`${fwd.url}/whatsapp/v26.0/1/messages`, { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
    assert.equal(upstream.requests[2].headers["d360-api-key"], "wa-token-777");
    assert.equal(upstream.requests[2].headers.authorization, undefined);

    assert.equal((await fetch(`${fwd.url}/nothing`)).status, 404);
    for (const l of logs) for (const secret of Object.values(KEYS)) assert.ok(!l.includes(secret));
    assert.equal(logs.length, 3);
  } finally { await fwd.close(); await upstream.close(); }
});

test("a service with no credentials answers 503, a dead upstream 502, and the adapters work through the forwarder with a path prefix", async () => {
  const upstream = await scripted(() => ({ json: { payment_links: [fixture("razorpay-payment-links-list.json").payment_links[0]] } }));
  const fwd = await startDevForwarder({ razorpay: { keyId: KEYS.RAZORPAY_KEY_ID, keySecret: KEYS.RAZORPAY_KEY_SECRET, baseUrl: upstream.url }, log: () => undefined }, { port: 0 });
  try {
    assert.equal((await fetch(`${fwd.url}/google/calendar/v3/freeBusy`, { method: "POST", body: "{}" })).status, 503);
    const { payments } = createLiveAdapters({ payments: { baseUrl: `${fwd.url}/razorpay` }, calendar: { baseUrl: `${fwd.url}/google`, calendarId: "c" }, messaging: { baseUrl: `${fwd.url}/whatsapp`, phoneNumberId: "1" } }, { clock: fakeClock(0), window: { lastInboundAt: () => undefined } });
    const links = await payments.listPaymentLinks({ reference_id: "111" });
    assert.equal(links[0].id, "plink_KBnb7I424Rc1R9");
    assert.match(upstream.requests[0].headers.authorization ?? "", /^Basic /); // the adapter sent none; the forwarder added it
    await upstream.close();
    assert.equal((await fetch(`${fwd.url}/razorpay/v1/payment_links`)).status, 502);
  } finally { await fwd.close(); }
});

test("as a program it prints the banner, listens on this computer only, and refuses to start with a live key (printing no key)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "devfwd-"));
  const write = (name: string, text: string) => { const p = join(dir, name); writeFileSync(p, text); return p; };
  const program = new URL("../standins/dev-forwarder.ts", import.meta.url).pathname;
  const run = (args: string[]) => spawn(process.execPath, [program, ...args], { env: { PATH: process.env.PATH ?? "" } });

  const live = run(["--env", write("live.env", "RAZORPAY_KEY_ID=rzp_live_TOPSECRET\nRAZORPAY_KEY_SECRET=shh\n"), "--port", "0"]);
  let err = "";
  live.stderr.on("data", (d) => { err += d; });
  assert.equal(await new Promise((r) => live.on("close", r)), 2);
  assert.match(err, /LIVE Razorpay key/);
  assert.ok(!err.includes("TOPSECRET") && !err.includes("shh"));

  const good = run(["--env", write("good.env", "RAZORPAY_KEY_ID=rzp_test_ok1\nRAZORPAY_KEY_SECRET=secretvalue\n"), "--port", "0"]);
  const out = await new Promise<string>((resolve, reject) => {
    let seen = "";
    const timer = setTimeout(() => reject(new Error(`did not start: ${seen}`)), 8000);
    good.stderr.on("data", (d) => { seen += d; if (/Press Ctrl\+C/.test(seen)) { clearTimeout(timer); resolve(seen); } });
  });
  try {
    assert.ok(out.includes(BANNER));
    assert.match(out, /Listening on http:\/\/127\.0\.0\.1:\d+/);
    assert.ok(!out.includes("secretvalue"));
  } finally { good.kill("SIGTERM"); }

  const nothing = run(["--env", join(dir, "missing.env")]);
  assert.equal(await new Promise((r) => nothing.on("close", r)), 2);
});
