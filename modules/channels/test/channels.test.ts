// The pieces of a shop's channels (item 11d) that need no runtime: the contact and handle rules, the event check, the messaging that keeps a web customer's words off
// WhatsApp, the per-address limits, the owner's link, the one list of operations behind the API and the MCP tools, the MCP protocol answers, and the page's escaping.
// The whole path through a real Bookings runtime is in templates/commerce/bookings/test/channels.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { normaliseName, normalisePhone } from "../contact.ts";
import { checkChannelEvent, channelEventKey } from "../events.ts";
import { conversationOf, handleHash, isChannelConversation, newHandle, HANDLE } from "../handle.ts";
import { createLimiter } from "../limits.ts";
import { channelMessaging } from "../outbox.ts";
import { emptyChannelState, compactChannel } from "../state.ts";
import { newOwnerToken, ownerLinkFile, ownerTokenMatches, readOwnerLink } from "../owner-link.ts";
import { OPERATIONS, createOps, isoInZone, parseStart } from "../ops.ts";
import { API_ROUTES, apiOperation } from "../api.ts";
import { MCP_VERSIONS, TOOLS, mcpPost } from "../mcp.ts";
import { bookingPage, statusPage } from "../page.ts";
import type { ChannelBackend, Offer } from "../backend.ts";
import { createFakeMessaging } from "../../messaging/messaging.ts";
import { fakeClock } from "../../core/clock.ts";

test("a typed number is read the usual Indian ways and nothing else; a name is letters only", () => {
  for (const raw of ["9811111111", "98111 11111", "+91 98111-11111", "09811111111", "919811111111", "+919811111111"]) assert.equal(normalisePhone(raw), "+919811111111", raw);
  for (const raw of ["12345", "+91 5811111111", "98111111111111", "call me", "", "+44"]) assert.equal(normalisePhone(raw), undefined, raw);
  assert.equal(normalisePhone("+44 20 7946 0958"), "+442079460958");
  assert.equal(normaliseName("  Asha   K "), "Asha K");
  assert.equal(normaliseName("आशा"), "आशा");
  for (const raw of ["", "<script>", "Asha1", "x".repeat(61)]) assert.equal(normaliseName(raw), undefined, raw);
});

test("a handle is long and random; the runtime keeps only its hash, and a channel's conversation is never a phone number", () => {
  const h = newHandle();
  assert.match(h, HANDLE);
  assert.notEqual(newHandle(), h);
  const hash = handleHash(h);
  assert.match(hash, /^[0-9a-f]{64}$/u);
  assert.equal(conversationOf("web", hash), `web:${hash.slice(0, 16)}`);
  assert.ok(isChannelConversation(conversationOf("mcp", hash)));
  assert.ok(!isChannelConversation("+919811111111"));
});

test("a channel event is checked whole: a booking needs the hash (never the handle), a full number and a known language", () => {
  const hash = handleHash(newHandle());
  const book = { kind: "channel_request", id: "r-1", channel: "web", op: "book", handle: hash, serviceId: "haircut", startMs: 1_800_000_000_000, name: "Asha", phone: "+919811111111", language: "hi" };
  const ok = checkChannelEvent(book);
  assert.ok(ok.ok);
  assert.equal(channelEventKey(ok.event), `channel_book:${hash}`, "one booking per handle, however often it is sent");
  assert.equal(checkChannelEvent({ ...book, handle: newHandle() }).ok, false, "the handle itself is refused: only its hash travels");
  assert.equal(checkChannelEvent({ ...book, phone: "98111 11111" }).ok, false, "the front sends the number in full");
  assert.equal(checkChannelEvent({ ...book, language: "fr" }).ok, false);
  assert.equal(checkChannelEvent({ ...book, kind: "message" }).ok, false, "nothing but the two channel kinds");
  const act = checkChannelEvent({ kind: "owner_action", id: "o-1", action: "received", case: "b-3", digest: "0".repeat(32) });
  assert.ok(act.ok);
  assert.equal(checkChannelEvent({ kind: "owner_action", id: "o-1", action: "refund_everything", case: "b-3", digest: "0".repeat(32) }).ok, false);
  // items 11d and 11e: a card's answer names the card, and the talk box's words are only words (a recording's reference is the runtime's own to set)
  assert.ok(checkChannelEvent({ kind: "owner_action", id: "o-2", action: "card_yes", case: "c-4", digest: "a".repeat(32) }).ok);
  assert.equal(checkChannelEvent({ kind: "owner_action", id: "o-2", action: "card_yes", case: "b-3", digest: "a".repeat(32) }).ok, false, "a card's answer names a card, not a booking");
  const said = checkChannelEvent({ kind: "owner_message", id: "t-1", text: "  close Sunday  ", voice: "a-reference-the-front-made-up" });
  assert.ok(said.ok);
  assert.deepEqual(said.event, { kind: "owner_message", id: "t-1", text: "close Sunday" }, "a voice reference from the front is never taken");
  assert.equal(channelEventKey(said.event), "owner_message:t-1");
  assert.equal(checkChannelEvent({ kind: "owner_message", id: "t-2", text: "   " }).ok, false);
  assert.equal(checkChannelEvent({ kind: "owner_message", id: "t-3", text: "x".repeat(901) }).ok, false);
});

test("a web customer's messages are kept for their page and read back from there; a WhatsApp number still goes to WhatsApp; with no WhatsApp, nothing goes", async () => {
  const clock = fakeClock(1_800_000_000_000);
  const whatsapp = createFakeMessaging(clock);
  const state = emptyChannelState();
  const m = channelMessaging(whatsapp, () => state, clock);
  const web = conversationOf("web", handleHash(newHandle()));
  assert.equal(await m.isWindowOpen(web), true, "a page has no 24-hour window");
  const sent = await m.sendText(web, "Your time is held.");
  assert.deepEqual(state.outbox.map((x) => [x.to, x.text]), [[web, "Your time is held."]]);
  assert.equal((await m.getMessage(sent.id))?.text, "Your time is held.", "the read-back comes from the kept message");
  await m.sendInteractive!(web, { body: "Pay now.", buttons: [{ id: "x", title: "Cancel" }] });
  assert.equal(state.outbox.at(-1)?.text, "Pay now.", "only the words: the page has its own buttons");
  assert.equal(whatsapp.outbox().length, 0, "nothing reached WhatsApp");
  whatsapp.receive("+919811111111", "hi");
  await m.sendText("+919811111111", "Hello.");
  assert.equal(whatsapp.sentTo("+919811111111").length, 1, "a WhatsApp customer is unchanged");
  const none = channelMessaging(undefined, () => state, clock);
  await assert.rejects(none.sendText("+919000000000", "For the owner."), /no WhatsApp/u, "no WhatsApp yet: refused as not sent");
  for (let i = 0; i < 30; i++) await m.sendText(web, `line ${i}`);
  assert.equal(state.outbox.filter((x) => x.to === web).length, 20, "a conversation keeps its latest 20");
});

test("old words, refused requests and finished ones go with the retention; a booking still going keeps its request and number", () => {
  const state = emptyChannelState();
  state.outbox.push({ id: "ch-1", to: "web:aaaaaaaaaaaaaaaa", text: "old", atMs: 1 }, { id: "ch-2", to: "web:aaaaaaaaaaaaaaaa", text: "new", atMs: 100 });
  state.requests.a = { atMs: 1, channel: "web", booking: "b-1", phone: "919811111111" };
  state.requests.b = { atMs: 1, channel: "web", booking: "b-2", phone: "919822222222" };
  state.requests.c = { atMs: 1, channel: "web", refused: "phone_busy", phone: "919833333333" };
  const changed = compactChannel(state, 50, (id) => id === "b-1");
  assert.equal(changed, 3);
  assert.deepEqual(state.outbox.map((x) => x.text), ["new"]);
  assert.equal(state.requests.a, undefined, "its booking is over");
  assert.equal(state.requests.b.phone, "919822222222", "its booking is still going");
  assert.equal(state.requests.c, undefined, "a refusal does not stay for ever");
});

test("the per-address limits count by kind and forget after their window", () => {
  let t = 0;
  const limiter = createLimiter(() => t);
  for (let i = 0; i < 6; i++) assert.ok(limiter.take("book", "1.2.3.4"));
  assert.equal(limiter.take("book", "1.2.3.4"), false, "the seventh booking in ten minutes from one address waits");
  assert.ok(limiter.take("book", "5.6.7.8"), "another address is not held up");
  t += 10 * 60_000 + 1;
  assert.ok(limiter.take("book", "1.2.3.4"));
});

test("the owner's link matches only its own token, compared by hash; no file means no page", () => {
  const token = newOwnerToken();
  const file = ownerLinkFile(token, new Date(0));
  assert.ok(!JSON.stringify(file).includes(token), "only the hash is kept");
  const read = readOwnerLink(JSON.stringify(file));
  assert.ok(ownerTokenMatches(token, read));
  assert.equal(ownerTokenMatches(newOwnerToken(), read), false);
  assert.equal(ownerTokenMatches(token, undefined), false, "a revoked link (no file) opens nothing");
  assert.equal(readOwnerLink("{not json"), undefined);
});

test("one list of operations: the API's routes and the MCP tools are exactly the operations, in the same order", () => {
  assert.deepEqual(Object.keys(API_ROUTES), [...OPERATIONS]);
  assert.deepEqual(TOOLS.map((t) => t.name), [...OPERATIONS]);
  for (const [name, r] of Object.entries(API_ROUTES)) assert.equal(apiOperation(r.method, r.path.replace("{handle}", "h".repeat(32))), name);
  for (const t of TOOLS) assert.equal(t.annotations.readOnlyHint, ["list_services", "free_slots", "payment_instructions", "booking_status"].includes(t.name), t.name);
});

test("times go out in the shop's own zone and a start must be a whole minute with a zone", () => {
  assert.equal(isoInZone(Date.UTC(2026, 10, 14, 10, 30), "Asia/Kolkata"), "2026-11-14T16:00:00+05:30");
  assert.equal(parseStart("2026-11-14T16:00:00+05:30"), Date.UTC(2026, 10, 14, 10, 30));
  assert.equal(parseStart("2026-11-14T16:00:00"), undefined, "a time with no zone is not guessed");
  assert.equal(parseStart(Date.UTC(2026, 10, 14, 10, 30) + 1), undefined);
});

const OFFER: Offer = {
  shop: { name: "Glow <b>Salon</b>", timezone: "Asia/Kolkata", languages: ["en", "hi"], deposit: { amountInr: 200, holdMinutes: 60 }, cancellation: { windowHours: 24 }, payment: { kind: "upi", payee: "Glow Salon" }, paused: false },
  services: [{ id: "haircut", names: { en: "Haircut", hi: "हेयरकट", ml: "ഹെയർകട്ട്", kn: "ಹೇರ್ ಕಟ್" }, priceInr: 450, durationMinutes: 45 }],
};
function backend(over: Partial<ChannelBackend> = {}): ChannelBackend & { submitted: unknown[] } {
  const submitted: unknown[] = [];
  return { submitted, offer: async () => OFFER, submit: async (e) => { submitted.push(...e); return "saved"; }, view: async () => ({ status: "pending" }), owner: async () => null, ...over };
}

test("MCP: the four protocol versions, the newest for one it does not know, notifications get 202, and a refusal is a tool result the assistant can read", async () => {
  const ops = createOps({ backend: backend(), publicUrl: "https://x.test/s/glow", channel: "mcp", waitMs: 0, sleep: async () => undefined });
  const init = await mcpPost(ops, "Glow", { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
  assert.equal((init.body as { result: { protocolVersion: string } }).result.protocolVersion, "2025-06-18");
  const unknown = await mcpPost(ops, "Glow", { jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } });
  assert.equal((unknown.body as { result: { protocolVersion: string } }).result.protocolVersion, MCP_VERSIONS[0]);
  assert.equal((await mcpPost(ops, "Glow", { jsonrpc: "2.0", method: "notifications/initialized" })).status, 202);
  const list = await mcpPost(ops, "Glow", { jsonrpc: "2.0", id: 3, method: "tools/list" });
  assert.equal((list.body as { result: { tools: unknown[] } }).result.tools.length, OPERATIONS.length);
  const bad = await mcpPost(ops, "Glow", { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "start_booking", arguments: { service_id: "haircut", start: "tomorrow", name: "Asha", phone: "9811111111" } } });
  const r = (bad.body as { result: { isError: boolean; structuredContent: { error: { code: string } } } }).result;
  assert.equal(r.isError, true);
  assert.equal(r.structuredContent.error.code, "bad_request");
  const none = await mcpPost(ops, "Glow", { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "mark_paid", arguments: {} } });
  assert.equal((none.body as { error: { code: number } }).error.code, -32602, "there is no tool to mark a payment received");
});

test("start_booking sends only the handle's hash and the checked fields, as a web or MCP request", async () => {
  const b = backend();
  const ops = createOps({ backend: b, publicUrl: "https://x.test/s/glow", channel: "mcp", waitMs: 0, sleep: async () => undefined });
  const out = await ops.start_booking({ service_id: "haircut", start: "2026-11-14T16:00:00+05:30", name: " Asha ", phone: "98111 11111", language: "hi" }) as { handle: string; status: string; status_url: string };
  assert.match(out.handle, HANDLE);
  assert.equal(out.status_url, `https://x.test/s/glow/b/${out.handle}`);
  const sent = b.submitted[0] as Record<string, unknown>;
  assert.deepEqual({ ...sent, id: "x" }, { kind: "channel_request", id: "x", channel: "mcp", op: "book", handle: handleHash(out.handle), serviceId: "haircut", startMs: Date.UTC(2026, 10, 14, 10, 30), name: "Asha", phone: "+919811111111", language: "hi" });
  assert.ok(!JSON.stringify(b.submitted).includes(out.handle), "the handle never leaves the front");
});

test("the page escapes what it shows, offers the shop's languages, and says what an assistant can and cannot do", () => {
  const page = bookingPage({ shop: { name: "glow", publicUrl: "https://x.test/s/glow" }, offer: OFFER, language: "en", values: { name: "<script>alert(1)</script>" } });
  assert.ok(!page.includes("<b>Salon</b>") && page.includes("Glow &lt;b&gt;Salon&lt;/b&gt;"));
  assert.ok(page.includes("https://x.test/s/glow/mcp") && /cannot mark a payment received/u.test(page));
  assert.ok(!/<script/iu.test(page), "no script on the page");
  const hi = bookingPage({ shop: { name: "glow", publicUrl: "https://x.test/s/glow" }, offer: OFFER, language: "hi" });
  assert.ok(hi.includes("मशीन से लिखी"), "a machine-written language says so");
  const held = statusPage({ shop: { name: "glow", publicUrl: "https://x.test/s/glow" }, offer: OFFER, language: "en", handle: "h".repeat(32), view: {
    status: "held", ref: "b-1", depositInr: 200, holdExpiresAt: Date.UTC(2026, 10, 14, 9, 30), canCancel: true, canSayPaid: true, messages: [{ atMs: 0, text: "<i>held</i>" }],
    pay: { kind: "upi", link: "upi://pay?pa=glowsalon@okicici&pn=Glow%20Salon&am=200.00&cu=INR&tn=b-1", payTo: { id: "glowsalon@okicici", name: "Glow Salon" }, amountPaise: 20000, leftPaise: 20000, note: "b-1" },
  } });
  assert.ok(held.includes('href="upi://pay?pa=glowsalon@okicici&amp;pn=Glow%20Salon&amp;am=200.00'), "the UPI link opens the customer's UPI app");
  assert.ok(held.includes("<svg") && held.includes("₹200"), "the QR code and the amount are on the page");
  assert.ok(held.includes("&lt;i&gt;held&lt;/i&gt;"), "messages are text");
  assert.ok(held.includes('http-equiv="refresh"'), "a held booking's page looks again by itself");
});
