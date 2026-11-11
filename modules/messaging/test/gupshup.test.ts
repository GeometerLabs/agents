// Gupshup as the WhatsApp provider (item 11b): the requests the adapter builds for every message type, how it reads Gupshup's replies and refusals, which
// provider a runtime.json picks, and that no request ever carries a provider key (Guard adds it). A local server stands in for the Guard in front of Gupshup;
// its replies are Gupshup's documented ones (fixtures/README.md). Nothing here touches the real service.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { IncomingHttpHeaders, Server } from "node:http";
import { fakeClock } from "../../core/clock.ts";
import { ApiError, WindowClosedError } from "../../core/faults.ts";
import { GUPSHUP_ROUTES, GUPSHUP_UPSTREAM, createGupshupMessaging, gupshupPath } from "../gupshup.ts";
import { createLiveMessaging, messagingConfigProblem } from "../providers.ts";
import { documentBody, imageBody, interactiveBody, templateBody } from "../whatsapp.ts";
import { BOOKINGS_SERVICES, FEES_SERVICES, readRuntimeConfig } from "../../runtime/config.ts";

const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const APP = "07c7c72d-20e3-4ff9-a5a1-14d1186eeec8";
const CUSTOMER = "+919800000001";
const AGENT_TOKEN = "gg_" + "a".repeat(32); // Guard's credential for this agent: the only Authorization an adapter may send

interface Seen { method: string; path: string; headers: IncomingHttpHeaders; body: unknown }

/** A stand-in for the Guard in front of Gupshup: it keeps every request and answers with `reply`. */
async function guard(reply: (seen: Seen) => { status: number; body: unknown } = () => ({ status: 200, body: fixture("gupshup-v3-send-reply.json") })): Promise<{ url: string; seen: Seen[]; close(): Promise<void> }> {
  const seen: Seen[] = [];
  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      const s: Seen = { method: req.method ?? "", path: req.url ?? "", headers: req.headers, body: raw ? JSON.parse(raw) : undefined };
      seen.push(s);
      const r = reply(s);
      res.writeHead(r.status, { "content-type": "application/json" });
      res.end(JSON.stringify(r.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}`, seen, close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }) };
}

const openWindow = { lastInboundAt: () => 0 };

test("every message type goes to Gupshup's v3 path as Meta's own body, and the reply's id is Gupshup's message id, kept as 'accepted' (not delivered)", async () => {
  // Gupshup's documented reply first, then the same reply with an id of its own for each later message
  const documented = fixture("gupshup-v3-send-reply.json") as { messages: { id: string }[] };
  let n = 0;
  const g = await guard(() => ({ status: 200, body: { ...documented, messages: [{ id: n++ === 0 ? documented.messages[0].id : `gs-${n}` }] } }));
  try {
    const m = createGupshupMessaging({ baseUrl: g.url, appId: APP, agentToken: AGENT_TOKEN }, { clock: fakeClock(0), window: openWindow });
    const buttons = { body: "Which day?", buttons: [{ id: "d:1", title: "Monday" }, { id: "d:2", title: "Tuesday" }] };
    const list = { body: "Pick a time", list: { button: "Times", rows: [{ id: "t:1", title: "10:00", description: "morning" }] } };
    const sent = [
      await m.sendText(CUSTOMER, "Your booking is confirmed."),
      await m.sendTemplate(CUSTOMER, { name: "booking_confirmed", language: "hi", text: "…", parameters: ["Glow  Salon", "10:00"] }),
      await m.sendInteractive!(CUSTOMER, buttons),
      await m.sendInteractive!(CUSTOMER, list),
      await m.sendDocument!(CUSTOMER, { link: "https://shop.example/r.pdf", filename: "receipt.pdf", caption: "Your receipt" }),
      await m.sendImage!(CUSTOMER, { link: "https://shop.example/q.png", caption: "Scan to pay" }),
    ];
    const path = `/partner/app/${APP}/v3/message`;
    assert.deepEqual(g.seen.map((s) => [s.method, s.path]), Array(6).fill(["POST", path]));
    assert.deepEqual(g.seen.map((s) => s.body), [
      { messaging_product: "whatsapp", recipient_type: "individual", to: CUSTOMER, type: "text", text: { body: "Your booking is confirmed.", preview_url: false } },
      templateBody(CUSTOMER, { name: "booking_confirmed", language: "hi", text: "…", parameters: ["Glow  Salon", "10:00"] }),
      interactiveBody(CUSTOMER, buttons),
      interactiveBody(CUSTOMER, list),
      documentBody(CUSTOMER, { link: "https://shop.example/r.pdf", filename: "receipt.pdf", caption: "Your receipt" }),
      imageBody(CUSTOMER, { link: "https://shop.example/q.png", caption: "Scan to pay" }),
    ]);
    // Gupshup's template page (14 Oct 2026) takes { name, language: { code }, components }: what templateBody writes, with no namespace
    assert.deepEqual((g.seen[1].body as any).template, { name: "booking_confirmed", language: { code: "hi" }, components: [{ type: "body", parameters: [{ type: "text", text: "Glow Salon" }, { type: "text", text: "10:00" }] }] });
    assert.deepEqual(sent.map((s) => [s.id, s.acceptedAs]), [["8b149927-8f3c-40da-b62c-58eeff60903e", "accepted"], ...[2, 3, 4, 5, 6].map((i) => [`gs-${i}`, "accepted"])]);
    assert.deepEqual(await m.getMessage(sent[0].id).then((x) => x?.text), "Your booking is confirmed.", "the read-back is the local copy of what Gupshup took");
  } finally { await g.close(); }
});

test("no request carries a provider key: only Guard's credential for this agent, as a Bearer token, and none at all when there is none", async () => {
  const g = await guard((s) => (s.method === "GET" ? { status: 200, body: { status: "success", healthy: "true" } } : { status: 200, body: fixture("gupshup-v3-send-reply.json") }));
  try {
    const withToken = createGupshupMessaging({ baseUrl: g.url, appId: APP, agentToken: AGENT_TOKEN }, { clock: fakeClock(0), window: openWindow });
    await withToken.sendText(CUSTOMER, "hello");
    await withToken.ping!();
    const bare = createLiveMessaging({ baseUrl: g.url, phoneNumberId: "105523045970845", provider: "gupshup", appId: APP }, { clock: fakeClock(0), window: openWindow });
    await bare.sendText(CUSTOMER, "hello");
    assert.deepEqual(g.seen.map((s) => s.headers.authorization), [`Bearer ${AGENT_TOKEN}`, `Bearer ${AGENT_TOKEN}`, undefined]);
    for (const s of g.seen) {
      assert.equal(s.headers.apikey, undefined, "no Gupshup apikey header");
      assert.equal(s.headers.token, undefined, "no Gupshup token header");
    }
    assert.deepEqual([g.seen[1].method, g.seen[1].path], ["GET", `/partner/app/${APP}/health`], "the cheap read for guard-wait.ts is the app's health");
    // the config has nowhere to put a key: runtime.json refuses one by name, as for any other service
    const refused = readRuntimeConfig({ mode: "live", services: { payments: { baseUrl: "http://g:8080" }, messaging: { baseUrl: "http://g:8080", phoneNumberId: "1", provider: "gupshup", appId: APP, apiKey: "secret-value" } } }, "/c", FEES_SERVICES);
    assert.equal(refused.ok, false);
    if (!refused.ok) { assert.ok(refused.errors.some((e) => /"apiKey"/.test(e))); assert.ok(!refused.errors.join(" ").includes("secret-value"), "the value is never repeated"); }
  } finally { await g.close(); }
});

test("Gupshup's refusals are read in plain words; a closed window is a WindowClosedError whether found here or passed on from Meta; a reply with no id is not taken as sent", async () => {
  const replies: { status: number; body: unknown }[] = [
    { status: 401, body: fixture("gupshup-error-authentication.json") },
    { status: 400, body: fixture("gupshup-error-callback-billing.json") },
    { status: 400, body: { error: { message: "(#131047) Re-engagement message", code: 131047, error_data: { details: "More than 24 hours have passed." } } } },
    { status: 200, body: { messaging_product: "whatsapp", messages: [] } },
  ];
  const g = await guard(() => replies.shift()!);
  try {
    const m = createGupshupMessaging({ baseUrl: g.url, appId: APP }, { clock: fakeClock(0), window: openWindow });
    await assert.rejects(m.sendText(CUSTOMER, "a"), (e: unknown) => e instanceof ApiError && e.status === 401 && /Gupshup: Authentication Failed/.test(e.message));
    await assert.rejects(m.sendText(CUSTOMER, "b"), (e: unknown) => e instanceof ApiError && /Callback Billing must be enabled/.test(e.message));
    await assert.rejects(m.sendText(CUSTOMER, "c"), WindowClosedError);
    await assert.rejects(m.sendText(CUSTOMER, "d"), (e: unknown) => e instanceof ApiError && e.status === 502 && /Gupshup accepted the call but gave no message id/.test(e.message));
    // the window is the runtime's own knowledge: a closed one is refused before anything is sent, as with Meta
    const closed = createGupshupMessaging({ baseUrl: g.url, appId: APP }, { clock: fakeClock(0), window: { lastInboundAt: () => undefined } });
    const before = g.seen.length;
    await assert.rejects(closed.sendText(CUSTOMER, "e"), WindowClosedError);
    assert.equal(g.seen.length, before);
  } finally { await g.close(); }
});

test("provider selection: Meta direct when runtime.json names none (the path is Graph's, unchanged), Gupshup when it says so; a bad provider or app id is refused in plain words", async () => {
  const g = await guard();
  try {
    const deps = { clock: fakeClock(0), window: openWindow };
    await createLiveMessaging({ baseUrl: g.url, phoneNumberId: "106540352242922" }, deps).sendText(CUSTOMER, "meta");
    await createLiveMessaging({ baseUrl: g.url, phoneNumberId: "106540352242922", provider: "meta" }, deps).sendText(CUSTOMER, "meta again");
    await createLiveMessaging({ baseUrl: g.url, phoneNumberId: "106540352242922", provider: "gupshup", appId: APP }, deps).sendText(CUSTOMER, "gupshup");
    assert.deepEqual(g.seen.map((s) => s.path), ["/v26.0/106540352242922/messages", "/v26.0/106540352242922/messages", `/partner/app/${APP}/v3/message`]);
  } finally { await g.close(); }
  assert.match(messagingConfigProblem({ provider: "aisensy" }) ?? "", /must be one of "meta", "gupshup"/);
  assert.match(messagingConfigProblem({ provider: "gupshup" }) ?? "", /appId is needed/);
  assert.match(messagingConfigProblem({ provider: "gupshup", appId: "../../v26.0/1" }) ?? "", /appId is needed/, "an app id that could change the path is refused");
  assert.match(messagingConfigProblem({ appId: APP }) ?? "", /only for "provider": "gupshup"/);
  assert.equal(messagingConfigProblem({}), null);
  assert.throws(() => createLiveMessaging({ baseUrl: "http://g:8080", phoneNumberId: "1", provider: "gupshup" }, { clock: fakeClock(0), window: openWindow }), /appId is needed/);
  // runtime.json: the two fields are accepted for messaging, checked, and refused anywhere else
  const live = (messaging: Record<string, unknown>) => readRuntimeConfig({ mode: "live", services: { payments: { baseUrl: "http://g:8080" }, calendar: { baseUrl: "http://g:8080", calendarId: "c" }, messaging: { baseUrl: "http://g:8080", phoneNumberId: "1", ...messaging } } }, "/c", BOOKINGS_SERVICES);
  const ok = live({ provider: "gupshup", appId: APP });
  assert.ok(ok.ok);
  if (ok.ok) assert.deepEqual((ok.config.services as any).messaging, { baseUrl: "http://g:8080", phoneNumberId: "1", provider: "gupshup", appId: APP });
  assert.ok(live({}).ok, "no provider: Meta, as before");
  const bad = live({ provider: "gupshup" });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.ok(bad.errors.some((e) => /appId is needed/.test(e)));
  const elsewhere = readRuntimeConfig({ mode: "live", services: { payments: { baseUrl: "http://g:8080", provider: "gupshup" }, messaging: { baseUrl: "http://g:8080", phoneNumberId: "1" } } }, "/c", FEES_SERVICES);
  assert.equal(elsewhere.ok, false, "provider means nothing on the payments service");
});

test("Guard's routes and the adapter's paths are one source: the generator reads GUPSHUP_ROUTES and the host from gupshup.ts", () => {
  assert.equal(GUPSHUP_UPSTREAM, "partner.gupshup.io:443");
  assert.equal(gupshupPath("send", APP), GUPSHUP_ROUTES.send.replace("{app_id}", APP));
  assert.equal(gupshupPath("read", APP), `/partner/app/${APP}/health`);
});
