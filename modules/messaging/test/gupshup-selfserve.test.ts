// Gupshup's self-serve API as the WhatsApp provider (item 11c): the form each message type becomes, Gupshup's template ids found from the app's list (cached, refreshed,
// refused when not approved), how its replies and callbacks are read (messages, tapped replies, delivered/read/failed kept apart from "accepted"), which provider a
// runtime.json picks, and that no request ever carries a Gupshup key (the shop's Guard adds `apikey`). A local server stands in for that Guard with Gupshup's documented
// replies (fixtures/README.md). Nothing here touches the real service.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { IncomingHttpHeaders, Server } from "node:http";
import { fakeClock } from "../../core/clock.ts";
import { ApiError, WindowClosedError } from "../../core/faults.ts";
import { GUPSHUP_SELFSERVE_ROUTES, createGupshupSelfServeMessaging, readTemplateList, templateListPath } from "../gupshup-selfserve.ts";
import { createLiveMessaging, messagingConfigProblem } from "../providers.ts";
import { parseWhatsAppStatuses, parseWhatsAppWebhook } from "../webhooks.ts";
import { findSentEntry } from "../statuses.ts";

const fixture = (name: string): any => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const CUSTOMER = "+919800000001";
const AGENT_TOKEN = "gg_" + "a".repeat(32); // Guard's credential for this agent: the only Authorization an adapter may send
const APP = { appName: "Glow_Salon", sourceNumber: "919876543210" };

interface Seen { method: string; path: string; headers: IncomingHttpHeaders; raw: string; form: Record<string, string> }

/** A stand-in for the Guard in front of api.gupshup.io: it keeps every request and answers sends with Gupshup's reply and the list with `templates`. */
async function guard(o: { templates?: () => unknown; send?: (s: Seen) => { status: number; body: unknown } } = {}): Promise<{ url: string; seen: Seen[]; close(): Promise<void> }> {
  const seen: Seen[] = [];
  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      const s: Seen = { method: req.method ?? "", path: req.url ?? "", headers: req.headers, raw, form: Object.fromEntries(new URLSearchParams(raw)) };
      seen.push(s);
      const r = s.method === "GET" ? { status: 200, body: o.templates ? o.templates() : fixture("gupshup-selfserve-templates.json") } : o.send ? o.send(s) : { status: 200, body: fixture("gupshup-selfserve-send-reply.json") };
      res.writeHead(r.status, { "content-type": "text/html" }); // Gupshup's page lists the reply as text/html with a JSON body
      res.end(JSON.stringify(r.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}`, seen, close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }) };
}

const openWindow = { lastInboundAt: () => 0 };
const make = (url: string, extra: Record<string, unknown> = {}, clock = fakeClock(0)) => createGupshupSelfServeMessaging({ baseUrl: url, ...APP, agentToken: AGENT_TOKEN, ...extra }, { clock, window: openWindow });

test("every session message type is one form post to /wa/api/v1/msg: the app's number and name, the digits of the customer, and the type's own JSON; the reply is 'accepted', not delivered", async () => {
  // Gupshup's documented reply for the first message, then an id of its own for each later one
  let n = 0;
  const g = await guard({ send: () => ({ status: 200, body: n++ === 0 ? fixture("gupshup-selfserve-send-reply.json") : { status: "submitted", messageId: `gs-${n}` } }) });
  try {
    const m = make(g.url);
    const buttons = { body: "Which day?", buttons: [{ id: "d:1", title: "Monday" }, { id: "d:2", title: "Tuesday" }] };
    const list = { body: "Pick a time", list: { button: "Times", rows: [{ id: "t:1", title: "10:00", description: "morning" }, { id: "t:2", title: "11:00" }] } };
    const sent = [
      await m.sendText(CUSTOMER, "Your booking is confirmed."),
      await m.sendInteractive!(CUSTOMER, buttons),
      await m.sendInteractive!(CUSTOMER, list),
      await m.sendDocument!(CUSTOMER, { link: "https://shop.example/r.pdf", filename: "receipt.pdf", caption: "Your receipt" }),
      await m.sendImage!(CUSTOMER, { link: "https://shop.example/q.png", caption: "Scan to pay" }),
    ];
    assert.deepEqual(g.seen.map((s) => [s.method, s.path]), Array(5).fill(["POST", GUPSHUP_SELFSERVE_ROUTES.send]));
    for (const s of g.seen) {
      assert.equal(s.headers["content-type"], "application/x-www-form-urlencoded");
      assert.deepEqual([s.form.channel, s.form.source, s.form.destination, s.form["src.name"]], ["whatsapp", "919876543210", "919800000001", "Glow_Salon"]);
    }
    const message = g.seen.map((s) => JSON.parse(s.form.message));
    assert.deepEqual(message[0], { type: "text", text: "Your booking is confirmed." });
    // our ids travel as postbackText, which Gupshup hands back on a tap
    assert.deepEqual(message[1], { type: "quick_reply", msgid: message[1].msgid, content: { type: "text", text: "Which day?" }, options: [{ title: "Monday", postbackText: "d:1" }, { title: "Tuesday", postbackText: "d:2" }] });
    assert.match(message[1].msgid, /^geo-[a-z0-9-]+$/u);
    assert.deepEqual(message[2], {
      type: "list", title: "Times", body: "Pick a time", msgid: message[2].msgid, globalButtons: [{ type: "text", title: "Times" }],
      items: [{ options: [{ type: "text", title: "10:00", description: "morning", postbackText: "t:1" }, { type: "text", title: "11:00", description: "11:00", postbackText: "t:2" }] }],
    });
    assert.notEqual(message[1].msgid, message[2].msgid, "each interactive message has its own id");
    assert.deepEqual(message[3], { type: "file", url: "https://shop.example/r.pdf", filename: "receipt.pdf", caption: "Your receipt" });
    assert.deepEqual(message[4], { type: "image", originalUrl: "https://shop.example/q.png", previewUrl: "https://shop.example/q.png", caption: "Scan to pay" });
    assert.deepEqual(sent.map((s) => [s.id, s.acceptedAs]), [["ee4a68a0-1203-4c85-8dc3-49d0b3226a35", "accepted"], ...[2, 3, 4, 5].map((i) => [`gs-${i}`, "accepted"])]);
    assert.deepEqual(await Promise.all(sent.map(async (s) => (await m.getMessage(s.id))?.kind)), ["text", "interactive", "interactive", "document", "image"], "the read-back is the local copy of what Gupshup took");
  } finally { await g.close(); }
});

test("no request carries a Gupshup key: only Guard's credential for this agent as a Bearer, and no apikey header, whatever is sent", async () => {
  const g = await guard();
  try {
    const m = make(g.url);
    await m.sendText(CUSTOMER, "hi");
    await m.sendTemplate(CUSTOMER, { name: "booking_confirmed", language: "en", text: "…", parameters: ["a", "b"] });
    await m.ping!();
    for (const s of g.seen) {
      assert.equal(s.headers.authorization, `Bearer ${AGENT_TOKEN}`);
      assert.equal(s.headers.apikey, undefined);
      assert.equal(s.headers.api_key, undefined);
      assert.ok(!s.raw.includes("apikey"));
    }
    const bare = createGupshupSelfServeMessaging({ baseUrl: g.url, ...APP }, { clock: fakeClock(0), window: openWindow });
    await bare.sendText(CUSTOMER, "hi");
    assert.equal(g.seen.at(-1)!.headers.authorization, undefined);
  } finally { await g.close(); }
});

test("a template names Gupshup's own id: found from the app's list by name and language, fetched once and kept, and an en_US listing matches 'en'", async () => {
  const g = await guard();
  try {
    const m = make(g.url);
    await m.sendTemplate(CUSTOMER, { name: "booking_confirmed", language: "en", text: "…", parameters: ["Glow  Salon", "10:00"] });
    await m.sendTemplate(CUSTOMER, { name: "booking_confirmed", language: "hi", text: "…", parameters: ["x", "y"] });
    await m.sendTemplate(CUSTOMER, { name: "booking_reminder", language: "en", text: "…", parameters: ["10:00"] });
    assert.deepEqual(g.seen.map((s) => [s.method, s.path]), [
      ["GET", "/sm/api/v1/template/list/Glow_Salon"], ["POST", GUPSHUP_SELFSERVE_ROUTES.template], ["POST", GUPSHUP_SELFSERVE_ROUTES.template], ["POST", GUPSHUP_SELFSERVE_ROUTES.template],
    ]);
    const posts = g.seen.filter((s) => s.method === "POST");
    assert.deepEqual(JSON.parse(posts[0].form.template), { id: "312371e9-2771-463b-8cfd-cd8994b810cc", params: ["Glow Salon", "10:00"] }, "parameters in order, white space cleaned");
    assert.equal(JSON.parse(posts[1].form.template).id, "5a1b2c3d-0000-4000-8000-000000000002");
    assert.equal(JSON.parse(posts[2].form.template).id, "5a1b2c3d-0000-4000-8000-000000000003");
    assert.deepEqual([posts[0].form.source, posts[0].form["src.name"], posts[0].form.destination, posts[0].form.message], ["919876543210", "Glow_Salon", "919800000001", undefined]);
    const sent = await m.getMessage((await m.sendTemplate(CUSTOMER, { name: "booking_confirmed", language: "en", text: "x", parameters: [] })).id);
    assert.deepEqual([sent?.kind, sent?.templateName, sent?.language], ["template", "booking_confirmed", "en"]);
  } finally { await g.close(); }
});

test("a template the app has not approved, or does not have, is refused in plain words before anything is sent; a new approval is found by refreshing the list (not more than every 30 seconds)", async () => {
  const clock = fakeClock(0);
  let approved = false;
  const g = await guard({ templates: () => { const l = fixture("gupshup-selfserve-templates.json"); if (approved) l.templates[3].status = "APPROVED"; return l; } });
  try {
    const m = make(g.url, {}, clock);
    const pending = { name: "booking_reminder", language: "ml" as const, text: "…", parameters: ["10:00"] };
    await assert.rejects(m.sendTemplate(CUSTOMER, pending), (e: unknown) => e instanceof ApiError && e.status === 400 && /not approved yet in the Gupshup app Glow_Salon \(its status there is pending\)/u.test(e.message));
    await assert.rejects(m.sendTemplate(CUSTOMER, { name: "owner_report", language: "en", text: "…" }), (e: unknown) => e instanceof ApiError && /not in the Gupshup app Glow_Salon.*added to the app and approved there/u.test(e.message));
    assert.equal(g.seen.filter((s) => s.method === "POST").length, 0, "nothing was sent");
    assert.equal(g.seen.filter((s) => s.method === "GET").length, 1, "the second refusal came from the kept list: asked again only after 30 seconds");
    approved = true;
    clock.advance(31_000);
    await m.sendTemplate(CUSTOMER, pending);
    assert.equal(g.seen.filter((s) => s.method === "GET").length, 2);
    assert.equal(JSON.parse(g.seen.at(-1)!.form.template).id, "5a1b2c3d-0000-4000-8000-000000000004");
  } finally { await g.close(); }
});

test("the template list is read by the app's id when runtime.json gives one, and a refusal of the list is said in plain words", async () => {
  const id = "07c7c72d-20e3-4ff9-a5a1-14d1186eeec8";
  assert.equal(templateListPath("Glow_Salon", id), `/wa/app/${id}/template`);
  assert.equal(templateListPath("Glow_Salon"), "/sm/api/v1/template/list/Glow_Salon");
  const g = await guard();
  try {
    await make(g.url, { appId: id }).ping!();
    assert.deepEqual([g.seen[0].method, g.seen[0].path], ["GET", `/wa/app/${id}/template?pageSize=1`]);
  } finally { await g.close(); }
  const denied = await guard({ templates: () => ({ status: "error", message: "Authentication Failed" }) });
  try {
    // a 200 that is not a list reads as no templates: the send is then refused as not in the app, never sent
    await assert.rejects(make(denied.url).sendTemplate(CUSTOMER, { name: "booking_confirmed", language: "en", text: "…" }), /not in the Gupshup app/u);
  } finally { await denied.close(); }
  assert.equal(readTemplateList({ templates: [{ id: "a", elementName: "n", languageCode: "en", status: "approved" }] }).get("n:en")?.status, "APPROVED");
  assert.equal(readTemplateList("nonsense").size, 0);
});

test("free text, buttons, files and pictures after the window closed are refused here (Gupshup would take them and fail them later); a bad message never goes out", async () => {
  const g = await guard();
  try {
    const closed = createGupshupSelfServeMessaging({ baseUrl: g.url, ...APP }, { clock: fakeClock(48 * 3_600_000), window: { lastInboundAt: () => 0 } });
    await assert.rejects(closed.sendText(CUSTOMER, "hi"), WindowClosedError);
    await assert.rejects(closed.sendInteractive!(CUSTOMER, { body: "x", buttons: [{ id: "a", title: "A" }] }), WindowClosedError);
    await assert.rejects(closed.sendDocument!(CUSTOMER, { link: "https://a.example/x.pdf", filename: "x.pdf" }), WindowClosedError);
    await assert.rejects(closed.sendImage!(CUSTOMER, { link: "https://a.example/x.png" }), WindowClosedError);
    assert.equal(await closed.isWindowOpen(CUSTOMER), false);
    const m = make(g.url);
    await assert.rejects(m.sendDocument!(CUSTOMER, { link: "http://a.example/x.pdf", filename: "x.pdf" }), /https/u);
    await assert.rejects(m.sendInteractive!(CUSTOMER, { body: "x", buttons: [] }), ApiError);
    assert.equal(g.seen.length, 0);
  } finally { await g.close(); }
});

test("Gupshup's refusals are read in its words: 400 Invalid Destination, 401 authentication failed", async () => {
  for (const [status, body, words] of [[400, fixture("gupshup-selfserve-error-invalid-destination.json"), "Gupshup: Invalid Destination"], [401, { status: "error", message: "Authentication Failed" }, "Gupshup: Authentication Failed"]] as const) {
    const g = await guard({ send: () => ({ status, body }) });
    try {
      await assert.rejects(make(g.url).sendText(CUSTOMER, "hi"), (e: unknown) => e instanceof ApiError && e.status === status && e.message === words);
    } finally { await g.close(); }
  }
  // a 200 whose body says error, or has no message id, is not a taken message
  for (const body of [{ status: "error", message: "Invalid App Details" }, { status: "submitted" }]) {
    const g = await guard({ send: () => ({ status: 200, body }) });
    try { await assert.rejects(make(g.url).sendText(CUSTOMER, "hi"), ApiError); } finally { await g.close(); }
  }
});

test("runtime.json picks the provider: gupshup-selfserve needs the app name and number, takes an optional app id, and the other providers refuse those fields", () => {
  assert.equal(messagingConfigProblem({ provider: "gupshup-selfserve", appName: "Glow_Salon", sourceNumber: "919876543210" }), null);
  assert.equal(messagingConfigProblem({ provider: "gupshup-selfserve", appName: "Glow_Salon", sourceNumber: "+919876543210", appId: "07c7c72d-20e3-4ff9-a5a1-14d1186eeec8" }), null);
  assert.match(messagingConfigProblem({ provider: "gupshup-selfserve", sourceNumber: "919876543210" }) ?? "", /appName is needed/u);
  assert.match(messagingConfigProblem({ provider: "gupshup-selfserve", appName: "Glow Salon!", sourceNumber: "919876543210" }) ?? "", /appName is needed/u);
  assert.match(messagingConfigProblem({ provider: "gupshup-selfserve", appName: "Glow_Salon" }) ?? "", /sourceNumber is needed/u);
  assert.match(messagingConfigProblem({ provider: "gupshup-selfserve", appName: "Glow_Salon", sourceNumber: "919876543210", appId: "../x" }) ?? "", /appId/u);
  assert.match(messagingConfigProblem({ provider: "meta", appName: "Glow_Salon" }) ?? "", /only for "provider": "gupshup-selfserve"/u);
  assert.match(messagingConfigProblem({ provider: "gupshup", appId: "07c7c72d-20e3-4ff9-a5a1-14d1186eeec8", sourceNumber: "1" }) ?? "", /only for/u);
  assert.equal(messagingConfigProblem({}), null);
  assert.throws(() => createLiveMessaging({ baseUrl: "http://g", phoneNumberId: "1", provider: "gupshup-selfserve" }, { clock: fakeClock(0), window: openWindow }), /appName is needed/u);
  assert.ok(createLiveMessaging({ baseUrl: "http://g", phoneNumberId: "1", provider: "gupshup-selfserve", ...APP }, { clock: fakeClock(0), window: openWindow }));
});

test("callbacks: text, a tapped template button, a tapped list row (the id we gave it) and a tapped reply button; pictures and voice notes are the fact only", () => {
  const one = (name: string) => parseWhatsAppWebhook(fixture(name));
  assert.deepEqual(one("gupshup-selfserve-message-text.json"), [{ id: "ABEGkZUTIXZ0Ago6jWqOZm-Sz0WD", from: "+919800000001", text: "Hi", timestamp: 1718007189549 }]);
  assert.deepEqual(one("gupshup-selfserve-message-template-button.json").map((m) => [m.text, m.reply]), [["View Account Balance", undefined]], "a template's button arrives as a text message: read as words");
  assert.deepEqual(one("gupshup-selfserve-message-list-reply-our-id.json"), [{ id: "ABEGkYaYVSEEAhCzqobr15BdMPcRup1fIXAJ", from: "+919800000001", text: "10:00", timestamp: 1580228523976, reply: { id: "slot:2026-11-14T10:00", kind: "list" } }]);
  // the page's own list example has a postbackText that is no plain id, and its quick reply has none: the title is read as words, and Gupshup's own ids ('list1', 'qr1') are not ours
  assert.deepEqual(one("gupshup-selfserve-message-list-reply.json").map((m) => [m.text, m.reply]), [["section 1 row 1", undefined]]);
  assert.deepEqual(one("gupshup-selfserve-message-quick-reply.json").map((m) => [m.text, m.reply]), [["First", undefined]]);
  assert.deepEqual(one("gupshup-selfserve-message-quick-reply-postback.json").map((m) => [m.text, m.reply]), [["Yes", { id: "confirm:yes", kind: "button" }]]);
  assert.deepEqual(one("gupshup-selfserve-message-image.json").map((m) => [m.text, m.image]), [["", true]]);
  assert.deepEqual(one("gupshup-selfserve-message-audio.json").map((m) => [m.text, m.voiceNote, m.media]), [["", true, undefined]], "voice off: nothing of the audio is read");
  // B29 with item 11c: a shop with voice on gets where the audio is (the callback's url and contentType), as for Meta and Gupshup's partner API
  assert.deepEqual(parseWhatsAppWebhook(fixture("gupshup-selfserve-message-audio.json"), { voiceMedia: true }).map((m) => m.media), [{ url: "https://example.invalid/media/audio.ogg", mime: "audio/ogg; codecs=opus" }]);
  assert.ok(!JSON.stringify(one("gupshup-selfserve-message-image.json")).includes("example.invalid"), "no media link is kept");
  // not ours to read: a message with no id or number, a wrong type, an event, a Meta body
  const text = fixture("gupshup-selfserve-message-text.json");
  assert.deepEqual(parseWhatsAppWebhook({ ...text, payload: { ...text.payload, id: undefined } }), []);
  assert.deepEqual(parseWhatsAppWebhook({ ...text, payload: { ...text.payload, source: "not a number" } }), []);
  assert.deepEqual(parseWhatsAppWebhook({ ...text, payload: { ...text.payload, type: "location", payload: {} } }), []);
  assert.deepEqual(parseWhatsAppWebhook(fixture("gupshup-selfserve-event-delivered.json")), []);
  assert.deepEqual(parseWhatsAppStatuses(text), []);
});

test("statuses: delivered, read and failed are kept (with both ids), enqueued and sent are not; 'accepted' and 'delivered' stay two things; Gupshup's 470 is the closed 24-hour window", () => {
  const status = (name: string) => parseWhatsAppStatuses(fixture(name));
  assert.deepEqual(status("gupshup-selfserve-event-enqueued.json"), []);
  assert.deepEqual(status("gupshup-selfserve-event-sent.json"), []);
  assert.deepEqual(status("gupshup-selfserve-event-delivered.json"), [{ ids: ["ee4a68a0-1203-4c85-8dc3-49d0b3226a35", "gBEGkYaYVSEEAgnZxQ3JmKK6Wvg"], status: "delivered", to: "+919800000001", timestamp: 1585344476000 }]);
  assert.equal(status("gupshup-selfserve-event-read.json")[0].status, "read");
  assert.deepEqual(status("gupshup-selfserve-event-failed.json"), [{ ids: ["ee4a68a0-1203-4c85-8dc3-49d0b3226a35"], status: "failed", to: "+919800000001", timestamp: 1580311136040, error: { code: 1008, title: "User is not Opted in and Inactive" } }]);
  const closed = status("gupshup-selfserve-event-failed-window.json")[0];
  assert.deepEqual([closed.ids, closed.error?.code, closed.error?.title?.startsWith("Message failed to send because more than 24 hours")], [["72f61f22-5aa4-4615-a970-943edf6da01c", "9163a016-710e-41ee-978b-79a1adbd734e"], 470, true]);
  // the id the send call answered with (the Gupshup id) finds the line that sent it, in either of the report's two ids
  const sendLine = { seq: 7, action: "send_message", refs: { messageId: "ee4a68a0-1203-4c85-8dc3-49d0b3226a35" } } as any;
  for (const name of ["gupshup-selfserve-event-delivered.json", "gupshup-selfserve-event-failed.json"]) assert.equal(findSentEntry([sendLine], status(name)[0].ids)?.entry.seq, 7);
  const asyncLine = { seq: 9, action: "send_message", refs: { messageId: "72f61f22-5aa4-4615-a970-943edf6da01c" } } as any;
  assert.equal(findSentEntry([asyncLine], closed.ids)?.entry.seq, 9);
});
