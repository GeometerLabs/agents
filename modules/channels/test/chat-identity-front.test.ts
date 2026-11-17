// W2, a guest's identity in the chat and a parent's chat, over HTTP (17 Nov 2026): the public front with a stand-in runtime that keeps a ChannelState, runs each send through chatTurn
// and answers the identity route with the REAL identity store and door (chat-identity.ts, chat-identity-http.ts), driven by the software authenticator (no browser). It shows: a thread
// kept on one phone and opened on another by a key; another shop's key refused; the link's page that uses nothing up until its button; delete my chat clearing the cookie and the
// words; a parent's chat on their private link (no cookie, no keys, only their own thread, the same thread after a new link, another parent's empty). Written 17 Nov, not run when
// written (the owner asked for one test pass at the end).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeClock } from "../../core/clock.ts";
import { chatDay, chatThread, chatTurn } from "../chat.ts";
import { openChatIdentity } from "../chat-identity.ts";
import { createChatIdentity } from "../chat-identity-http.ts";
import { chatConversationOf } from "../conversation.ts";
import { frontHandler } from "../front.ts";
import type { FrontShop } from "../front.ts";
import { guestHash, parentChatHash, parentLinkHash } from "../handle.ts";
import { emptyChannelState } from "../state.ts";
import type { ChannelState } from "../state.ts";
import { channelMessaging } from "../outbox.ts";
import { createFakeMessaging } from "../../messaging/messaging.ts";
import type { ChannelBackend } from "../backend.ts";
import { IDENTITY } from "../words-chat-identity.ts";
import { LANGUAGES } from "../../language/languages.ts";
import { parentPage } from "../fee-page.ts";
import { newSoftPasskey, softRegister, softSignin } from "./soft-authenticator.ts";
import type { SoftPasskey } from "./soft-authenticator.ts";

const TZ = "Asia/Kolkata";
const NOW = Date.UTC(2026, 10, 17, 6, 0);
const LINK_A = "A".repeat(32); const LINK_A2 = "B".repeat(32); const LINK_C = "C".repeat(32);
const REF_A = "p-0123456789ab"; const REF_C = "p-ba9876543210";
const PARENT_OF: Record<string, string> = { [parentLinkHash(LINK_A)]: REF_A, [parentLinkHash(LINK_A2)]: REF_A, [parentLinkHash(LINK_C)]: REF_C };

/** One shop: a runtime stand-in (state, a script of replies, the real identity store and door) behind the public front. */
async function world(o: { kind?: "bookings" | "fees"; work?: () => number } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "chat-identity-front-"));
  const clock = fakeClock(NOW);
  const state: ChannelState = emptyChannelState();
  const identity = openChatIdentity(join(dir, "chat-identity.sqlite"));
  const submitted: { kind: string; [k: string]: unknown }[] = [];
  const fake = createFakeMessaging(clock);
  const messaging = channelMessaging(fake, () => state, clock);
  const kind = o.kind ?? "bookings";
  let origin = "";
  /** The step a saved chat event runs in the real runtime (a forget needs no step of the template, so it is safe to run it here and now). */
  const step = (e: unknown) => chatTurn({ state, ai: {}, now: clock.now(), timeZone: TZ, kind, setLanguage: () => undefined, run: async (m) => { await messaging.sendText(m.from, `You said: ${m.text}`); } }, e as never);
  const routes = createChatIdentity({
    identity, shopName: "Glow Salon", clock, pages: () => ({ schema: 1, base: `${origin}/s/glow`, ownerBase: `${origin}/s/glow/owner` }) as never,
    runtime: {
      channel: { chatState: (h: string) => ({ known: Object.hasOwn(state.chat ?? {}, chatConversationOf(h)), answered: state.outbox.some((m) => m.to === chatConversationOf(h)) }), chatWork: () => o.work?.() ?? 0, parent: (link: string) => (PARENT_OF[link] ? { ref: PARENT_OF[link] } : null) } as never,
      submit: (events) => { for (const e of events as { kind: string }[]) { submitted.push(e as never); if (e.kind === "chat_message") void step(e); } return { saved: events.length, duplicates: 0 }; }, kick: () => undefined,
    },
  });
  const shopInfo = { name: "Glow Salon", timezone: TZ, languages: [...LANGUAGES], payment: { kind: "link" }, paused: false };
  const backend = {
    async offer() { return { shop: { ...shopInfo, deposit: { amountInr: 200, holdMinutes: 30 }, cancellation: { windowHours: 24 } }, services: [] }; },
    async feesOffer() { return { kind: "fees", shop: shopInfo }; },
    async feeConfirmView() { return null; },
    async parentView(linkHash: string) { return PARENT_OF[linkHash] ? { ref: PARENT_OF[linkHash], students: [], dues: [] } : null; },
    async submit(events: { kind: string; handle?: string; parent?: string; text?: string; id: string; language: string; forget?: true }[]) {
      for (const e of events) {
        if (e.kind !== "chat_message") continue;
        if (!routes.openEvent(e as never)) return "refused" as never;
        submitted.push(e);
        await step(e);
      }
      return "saved" as const;
    },
    async view() { return null; }, async owner() { return null; },
    async chat(hash: string, q: { after?: number; parent?: string } = {}) {
      const thread = routes.openRead(hash, q.parent);
      if (!thread) throw new Error("That link opens nothing now.");
      return { ...chatThread(state, thread, { ...(q.after ? { after: q.after } : {}), retentionDays: 30, now: clock.now(), dayKey: chatDay(clock.now(), TZ) }), personality: "warm" };
    },
    async chatId(body: Record<string, unknown>) { return routes.call(body); },
    async push(body: Record<string, unknown>) { return body.op === "key" ? { status: 200, body: { on: false } } : { status: 404, body: {} }; },
  } as unknown as ChannelBackend;
  const shops: Record<string, FrontShop> = {};
  const server = createServer(frontHandler({ shops }));
  const port = await new Promise<number>((r) => server.listen(0, "127.0.0.1", () => r((server.address() as { port: number }).port)));
  origin = `http://127.0.0.1:${port}`;
  shops.glow = { publicUrl: `${origin}/s/glow`, backend, kind };
  const get = (path: string, headers: Record<string, string> = {}) => fetch(`${origin}/s/glow${path}`, { redirect: "manual", headers });
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) => fetch(`${origin}/s/glow${path}`, { method: "POST", redirect: "manual", headers: { "content-type": "application/json", origin, ...headers }, body: JSON.stringify(body) });
  const form = (path: string, fields: Record<string, string>, headers: Record<string, string> = {}) => fetch(`${origin}/s/glow${path}`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", origin, ...headers }, body: new URLSearchParams(fields).toString() });
  return { origin, state, identity, submitted, clock, get, post, form, done: async () => { await new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }); identity.close(); rmSync(dir, { recursive: true, force: true }); } };
}

const cookieOf = (res: Response) => /(__Secure-geo-chat=[A-Za-z0-9_-]{43})/u.exec(res.headers.get("set-cookie") ?? "")?.[1];
const handleOf = (cookie: string) => cookie.split("=")[1]!;
type Lines = { lines: { who: string; text: string }[] };

/** A guest opens the chat and says something: returns their cookie. */
async function guestWho(w: Awaited<ReturnType<typeof world>>, text = "hello") {
  const cookie = cookieOf(await w.get("/chat?lang=en"))!;
  assert.equal((await w.post("/chat/send", { id: `s-${Math.random().toString(16).slice(2)}`, text, lang: "en" }, { cookie })).status, 200);
  return cookie;
}
async function keepWith(w: Awaited<ReturnType<typeof world>>, cookie: string, p: SoftPasskey) {
  const opts = await (await w.post("/chat/id/keep-options", {}, { cookie })).json() as { options: { challenge: string; user: { id: string } } };
  return w.post("/chat/id/keep", { response: softRegister(p, opts.options, w.origin) }, { cookie });
}
async function openWith(w: Awaited<ReturnType<typeof world>>, cookie: string, p: SoftPasskey) {
  const opts = await (await w.post("/chat/id/signin-options", {}, { cookie })).json() as { options: { challenge: string } };
  return w.post("/chat/id/signin", { response: softSignin(p, opts.options, w.origin) }, { cookie });
}

// ---- keeping the chat and opening it on another phone ------------------------------------------------------------------------------------------------

test("a guest keeps their chat with a key; a second phone opens it with the key and reads the same thread, its bookings' lines and all", async () => {
  let work = 0;
  const w = await world({ work: () => work });
  try {
    const phoneA = await guestWho(w, "book a haircut");
    assert.equal(((await (await w.get("/chat/id/state", { cookie: phoneA })).json()) as { offer: boolean }).offer, false, "nothing is offered until a booking or an order is made");
    work = 1;
    const state = await (await w.get("/chat/id/state", { cookie: phoneA })).json() as { offer: boolean; keys: number; known: boolean };
    assert.deepEqual([state.offer, state.keys, state.known], [true, 0, true]);
    const p = newSoftPasskey("127.0.0.1");
    const kept = await keepWith(w, phoneA, p);
    assert.equal(kept.status, 200);
    assert.equal(((await (await w.get("/chat/id/state", { cookie: phoneA })).json()) as { keys: number }).keys, 1);
    // phone B: a fresh cookie, an empty thread, then the key
    const phoneB = cookieOf(await w.get("/chat?lang=en"))!;
    assert.notEqual(phoneB, phoneA);
    assert.deepEqual(((await (await w.get("/chat/thread", { cookie: phoneB })).json()) as Lines).lines, []);
    const opened = await openWith(w, phoneB, p);
    assert.equal(opened.status, 200);
    const restored = await (await w.get("/chat/thread", { cookie: phoneB })).json() as Lines;
    assert.ok(restored.lines.some((l) => l.who === "you" && l.text === "book a haircut"), "the old thread, on the new phone");
    assert.ok(restored.lines.some((l) => l.who === "shop"));
    // a send from the new phone is the old thread's send: one conversation in the shop's state
    await w.post("/chat/send", { id: "s-b", text: "and a shave", lang: "en" }, { cookie: phoneB });
    assert.deepEqual(Object.keys(w.state.chat!), [chatConversationOf(guestHash("glow", handleOf(phoneA)))]);
    const same = await (await w.get("/chat/thread", { cookie: phoneA })).json() as Lines;
    assert.ok(same.lines.some((l) => l.text === "and a shave"));
  } finally { await w.done(); }
});

test("a key of another shop opens nothing here, and says so in the page's own words; a wrong answer counts against the address", async () => {
  const here = await world(); const there = await world();
  try {
    const owner = await guestWho(there);
    const p = newSoftPasskey("127.0.0.1");
    assert.equal((await keepWith(there, owner, p)).status, 200);
    const phone = cookieOf(await here.get("/chat?lang=en"))!;
    const r = await openWith(here, phone, p);
    assert.equal(r.status, 403);
    assert.deepEqual(await r.json(), { ok: false, reason: "other_shop" });
    assert.deepEqual(((await (await here.get("/chat/thread", { cookie: phone })).json()) as Lines).lines, []);
    assert.ok(IDENTITY.en.otherShop.length > 0);
  } finally { await here.done(); await there.done(); }
});

test("the calls are the page's own: another site's form is refused, no cookie is refused, an op nobody knows is nothing", async () => {
  const w = await world();
  try {
    const cookie = await guestWho(w);
    assert.equal((await w.post("/chat/id/keep-options", {}, { cookie, origin: "https://evil.example" })).status, 403);
    assert.equal((await w.post("/chat/id/keep-options", {})).status, 400, "no guest yet");
    assert.equal((await w.post("/chat/id/anything", {}, { cookie })).status, 404);
    assert.equal((await w.get("/chat/id/keep", { cookie })).status, 404);
    // a typed number is checked before anything is sent: "abc" is no number
    assert.equal((await w.post("/chat/id/recover", { number: "abc" }, { cookie })).status, 400);
    assert.equal((await w.post("/chat/id/number", { number: "98111 11111" }, { cookie })).status, 200);
    assert.equal(w.identity.numberOf(guestHash("glow", handleOf(cookie))), "919811111111", "kept as digits with the country code");
  } finally { await w.done(); }
});

test("the chat page: the identity part is there in the guest's words, the policy names its addresses, and no jargon", async () => {
  const w = await world();
  try {
    for (const language of ["en", "hi", "ml", "kn"] as const) {
      const res = await w.get(`/chat?lang=${language}`);
      const html = await res.text();
      assert.match(res.headers.get("content-security-policy") ?? "", /connect-src [^;]*\/s\/glow\/chat\/id\//u);
      for (const key of ["keepHead", "keepBody", "openMine", "newPhone", "deleteButton"] as const) assert.ok(html.includes(IDENTITY[language][key].replace(/&/gu, "&amp;").replace(/"/gu, "&quot;")) || html.includes(IDENTITY[language][key]), `${language}.${key} is on the page`);
      assert.ok(!/passkey/iu.test(html), `${language}: no jargon`);
      assert.equal((html.match(/<script nonce=/gu) ?? []).length, 2, "the chat's script and the identity part's, both by the one nonce");
    }
  } finally { await w.done(); }
});

// ---- a new phone, by the link ---------------------------------------------------------------------------------------------------------------------------

test("the link's page shows one button and uses nothing up; the button's post uses it once and ties the phone; a second press does nothing", async () => {
  const w = await world();
  try {
    const old = await guestWho(w, "my first words");
    const thread = guestHash("glow", handleOf(old));
    const link = w.identity.issueLink(thread, w.clock.now());
    const url = `/chat/id/back/${link.token}?lang=en`;
    const fresh = await w.get(url);
    assert.equal(fresh.status, 200);
    const html = await fresh.text();
    assert.ok(html.includes(IDENTITY.en.backBody));
    assert.match(html, /<form method="post" action="[^"]*\/chat\/id\/back">/u);
    const phone = cookieOf(fresh)!;
    assert.ok(phone, "a phone with no cookie is given one by the link's page");
    assert.equal(w.identity.linkState(link.token, w.clock.now()), "valid", "looking used nothing up");
    assert.equal((await w.get(url, { cookie: phone })).status, 200);
    const pressed = await w.form("/chat/id/back", { token: link.token }, { cookie: phone });
    assert.equal(pressed.status, 303, "to the chat page");
    assert.match(pressed.headers.get("location") ?? "", /\/s\/glow\/chat\?lang=/u);
    const lines = await (await w.get("/chat/thread", { cookie: phone })).json() as Lines;
    assert.ok(lines.lines.some((l) => l.text === "my first words"));
    const again = await w.form("/chat/id/back", { token: link.token }, { cookie: cookieOf(await w.get("/chat?lang=en"))! });
    assert.match(again.headers.get("location") ?? "", /\/chat\/id\/back\//u, "a used link goes back to its page, which says so");
    const used = await (await w.get(url, { cookie: phone })).text();
    assert.ok(used.includes(IDENTITY.en.backUsed));
    assert.equal((await w.get(`/chat/id/back/${"z".repeat(43)}`, { cookie: phone })).status, 200, "a made-up link is the same page as a used one");
  } finally { await w.done(); }
});

// ---- delete my chat -------------------------------------------------------------------------------------------------------------------------------------

test("delete my chat: the words and the guest are gone, the keys too, the cookie is cleared, and the same cookie then finds an empty chat", async () => {
  const w = await world({ work: () => 1 });
  try {
    const cookie = await guestWho(w, "private words");
    const p = newSoftPasskey("127.0.0.1");
    await keepWith(w, cookie, p);
    assert.ok(w.state.chat && w.state.outbox.length > 0);
    const gone = await w.post("/chat/id/forget", {}, { cookie });
    assert.equal(gone.status, 200);
    assert.match(gone.headers.get("set-cookie") ?? "", /^__Secure-geo-chat=; Path=\/s\/glow\/chat; Max-Age=0; HttpOnly; Secure; SameSite=Lax$/u);
    assert.equal(w.state.chat, undefined, "the guest and their counts are gone");
    assert.equal(w.state.outbox.length, 0, "the shop's lines to them are gone");
    assert.deepEqual(w.identity.state(guestHash("glow", handleOf(cookie))), { keys: 0, number: false });
    assert.deepEqual(((await (await w.get("/chat/thread", { cookie })).json()) as Lines).lines, []);
    // the key opens nothing now
    const phone = cookieOf(await w.get("/chat?lang=en"))!;
    assert.equal((await openWith(w, phone, p)).status, 403);
    assert.ok(w.submitted.some((e) => e.kind === "chat_message" && e.forget === true));
  } finally { await w.done(); }
});

// ---- a parent's chat on their private fee page ---------------------------------------------------------------------------------------------------------

test("a parent's chat: the private link is the identity (no cookie, no keys), the thread is theirs, and it is the same after a new link", async () => {
  const w = await world({ kind: "fees" });
  try {
    const open = await w.get(`/f/${LINK_A}/chat?lang=en`);
    assert.equal(open.status, 200);
    assert.equal(open.headers.get("set-cookie"), null, "no guest is made: the link is who they are");
    const html = await open.text();
    assert.ok(html.includes(IDENTITY.en.parentNote));
    assert.ok(html.includes(IDENTITY.en.parentBack));
    assert.ok(!html.includes(IDENTITY.en.keepHead), "no keys on a parent's page");
    assert.equal((html.match(/<script nonce=/gu) ?? []).length, 1);
    assert.equal((await w.post(`/f/${LINK_A}/chat/send`, { id: "p-1", text: "what do I owe", lang: "en" })).status, 200);
    const mine = await (await w.get(`/f/${LINK_A}/chat/thread`)).json() as Lines;
    assert.ok(mine.lines.some((l) => l.who === "you" && l.text === "what do I owe"));
    assert.deepEqual(Object.keys(w.state.chat!), [chatConversationOf(parentChatHash(REF_A))], "the conversation is made from the parent, not the link");
    // a new link for the same parent: the same thread
    const later = await (await w.get(`/f/${LINK_A2}/chat/thread`)).json() as Lines;
    assert.deepEqual(later.lines.map((l) => l.text), mine.lines.map((l) => l.text));
    // another parent's link: an empty thread, and nothing of the first
    const other = await (await w.get(`/f/${LINK_C}/chat/thread`)).json() as Lines;
    assert.deepEqual(other.lines, []);
    // the identity routes, the alerts and the cookie do not exist there
    assert.equal((await w.post(`/f/${LINK_A}/chat/id/keep-options`, {})).status, 404);
    assert.equal((await w.post(`/f/${LINK_A}/chat/push`, {})).status, 404);
  } finally { await w.done(); }
});

test("a link that opens nothing opens no chat: a wrong link is a plain not-found, counted as a guess, and nothing is sent", async () => {
  const w = await world({ kind: "fees" });
  try {
    const bad = "Z".repeat(32);
    assert.equal((await w.get(`/f/${bad}/chat`)).status, 404);
    assert.equal((await w.post(`/f/${bad}/chat/send`, { id: "p-1", text: "hi", lang: "en" })).status, 404);
    assert.equal((await w.get(`/f/${bad}/chat/thread`)).status, 404);
    assert.equal(w.submitted.length, 0);
    assert.equal(w.state.chat, undefined);
  } finally { await w.done(); }
});

test("the parent page offers 'Ask about this fee' only when the centre has a chat, and it opens the parent's own chat", () => {
  const view = { ref: REF_A, students: [], dues: [] } as never;
  const offer = { kind: "fees", shop: { name: "Bright Tuition", timezone: TZ, languages: [...LANGUAGES], payment: { kind: "link" }, paused: false } } as never;
  const base = "https://pages.example/bright/f/" + LINK_A;
  for (const language of LANGUAGES) {
    const withChat = parentPage({ shop: { name: "bright", publicUrl: "https://pages.example/bright" }, offer, language, base, view, nonce: "n", chat: true });
    assert.ok(withChat.includes(`href="${base}/chat?lang=${language}"`) && withChat.includes(IDENTITY[language].parentAsk), language);
    assert.ok(!parentPage({ shop: { name: "bright", publicUrl: "https://pages.example/bright" }, offer, language, base, view, nonce: "n" }).includes("/chat?lang="), "no chat, no link");
  }
});
