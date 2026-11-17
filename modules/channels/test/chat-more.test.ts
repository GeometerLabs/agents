// W1b, finishing the chat on the shop's page (17 Nov 2026), without a runtime or a browser: the three animations and their rules (small, short, brand colours only, no
// expressions, a still for each, no eval in the vendored player), the page's policy (one img-src, the player at its own address, no unsafe-eval), reduced motion (the animated
// source only where motion is welcome, the still always there), the moments a record marks, the signboard paints at AA, hold to talk through a step (listened to once, counted in
// the guest's turns, never past the cap, a reference sent from outside dropped), the number the owner sees for a guest, the bound on a guest's pings to the owner, and the front's
// own routes (the player and the files with a year's cache, a recording passed on). The animations themselves were looked at in a real browser by the review (chat-screens.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fakeClock } from "../../core/clock.ts";
import { guestHash, newGuestHandle } from "../handle.ts";
import { chatConversationOf } from "../conversation.ts";
import { CHAT_LIMITS, chatMayPing, chatPingGate, chatThread, chatTurn } from "../chat.ts";
import { checkChannelEvent } from "../events.ts";
import { compactChannel, emptyChannelState } from "../state.ts";
import { channelMessaging, markMoment } from "../outbox.ts";
import { createFakeMessaging } from "../../messaging/messaging.ts";
import type { AiStore } from "../../understanding/ai-state.ts";
import { chatPage } from "../chat-page.ts";
import { chatPolicy } from "../chat-front.ts";
import { frontHandler } from "../front.ts";
import type { FrontShop } from "../front.ts";
import type { ChannelBackend } from "../backend.ts";
import { PAINTS, PAINT_IDS, contrastRatio, isPaint } from "../chat-paint.ts";
import { MOMENTS, STILLS } from "../chat-motion.ts";
import { CHAT_GUEST, conversationOfNumber, guestLabel, guestNumber } from "../chat-guest.ts";
import { CHAT_MORE } from "../words-chat-more.ts";
import { readPagesFile } from "../pages-file.ts";
import { screen } from "../chat-screens.ts";
import { LANGUAGES } from "../../language/languages.ts";
import { prepareGuestMessage } from "../../assistant/wire.ts";
import { readOwnerRules } from "../../assistant/intents.ts";

const TZ = "Asia/Kolkata";
const NOW = Date.UTC(2026, 10, 17, 6, 0);
const motionJson = (name: string) => JSON.parse(readFileSync(new URL(`../motion/${name}.json`, import.meta.url), "utf8")) as { fr: number; ip: number; op: number; w: number; h: number; assets: unknown[]; layers: unknown[] };

// ---- the animations ----------------------------------------------------------------------------------------------------------------------------

test("each Lottie file is our own, small and short: at most 20 KB and 1.5 s, no images, no expressions, no text, brand colours only", () => {
  const brand = new Set(["#f6a609", "#136650", "#f7f8f4"]);
  for (const name of MOMENTS) {
    const raw = readFileSync(new URL(`../motion/${name}.json`, import.meta.url), "utf8");
    assert.ok(raw.length <= 20 * 1024, `${name}: ${raw.length} bytes`);
    const m = motionJson(name);
    assert.ok((m.op - m.ip) / m.fr <= 1.5, `${name}: ${(m.op - m.ip) / m.fr} s`);
    assert.deepEqual(m.assets, [], `${name}: no images`);
    assert.ok(!/"x":"|"ef":|"ty":5|"ty":2|"d":\{/u.test(raw.replace(/"x":\[/gu, "")), `${name}: no expressions, effects, text or image layers`);
    // every colour in a fill or stroke is one of the three brand colours
    for (const c of raw.matchAll(/"c":\{"a":0,"k":\[([0-9.]+),([0-9.]+),([0-9.]+),1\]/gu)) {
      const hex = `#${[c[1], c[2], c[3]].map((v) => Math.round(Number(v) * 255).toString(16).padStart(2, "0")).join("")}`;
      assert.ok(brand.has(hex), `${name}: ${hex} is not a brand colour`);
    }
  }
});

test("a moment that is a record's has a still: the animation's last frame, with the same meaning in words in four languages", () => {
  for (const kind of ["confirmed", "paid"] as const) {
    assert.match(STILLS[kind], /^<svg viewBox="0 0 120 120" aria-hidden="true"/u);
    assert.ok(!/<script|on\w+=|href=/u.test(STILLS[kind]), "a still is shapes only");
    for (const l of LANGUAGES) assert.ok(CHAT_MORE[l][kind].length > 10, `${kind} ${l}`);
  }
  assert.ok(!/safe|guarantee|proves|certified|100%|earn|income|bot\b|founder/iu.test(Object.values(CHAT_MORE.en).join(" ")), "the words that are never used");
});

test("the vendored player is the light SVG build 5.12.2, with its licence, and has no eval", () => {
  const js = readFileSync(new URL("../vendor/lottie/lottie_light.min.js", import.meta.url), "utf8");
  assert.ok(!/\beval\s*\(/u.test(js) && !/new Function\s*\(/u.test(js), "no eval and no new Function: the page's policy needs no unsafe-eval");
  assert.match(readFileSync(new URL("../vendor/lottie/README.md", import.meta.url), "utf8"), /5\.12\.2/u);
  assert.match(readFileSync(new URL("../vendor/lottie/LICENSE", import.meta.url), "utf8"), /MIT License/u);
});

test("the policy is one img-src (never two), names the player and the files at their own addresses, and never allows eval", () => {
  const base = "https://p.example/glow/chat";
  const policy = chatPolicy(base, "N0NCE", "https://p.example/glow");
  assert.equal((policy.match(/img-src/gu) ?? []).length, 1);
  assert.match(policy, /img-src data: https:\/\/p\.example\/glow\/character\/;/u);
  assert.match(policy, /script-src 'nonce-N0NCE' https:\/\/p\.example\/glow\/chat\/m\/lottie\.js;/u);
  assert.match(policy, /connect-src [^;]*\/chat\/voice [^;]*\/chat\/m\//u);
  assert.ok(!/unsafe-eval|'self'/u.test(policy));
  assert.equal((chatPolicy(base, "N0NCE").match(/img-src data:;/gu) ?? []).length, 1, "with no pictures drawn, images stay data only");
});

test("the head: DiceBear's animation is a source only a phone that welcomes motion uses, and the still is the picture itself", () => {
  const html = screen("busy", new URLSearchParams("")).html;
  assert.match(html, /<picture class="face-p" id="face-pic"><source srcset="[^"]*\/character\/busy-anim\.svg\?v=screens" type="image\/svg\+xml" media="\(prefers-reduced-motion: no-preference\)"><img class="face-c" id="face-src" src="data:image\/svg\+xml/u);
  // the hop is inside the no-preference block, so reduced motion has none
  // (the block holds several rules, so cut it at its own closing brace instead of matching across rule braces)
  const start = html.indexOf("@media (prefers-reduced-motion: no-preference) {\n.arrive");
  const block = html.slice(start, html.indexOf("\n}", start));
  assert.ok(start >= 0 && /\.hop \{ animation: hop \.35s/u.test(block), "the hop is inside the no-preference block");
  assert.equal(html.split(".hop {").length - 1, 1, "and only there");
});

test("a record-marked line is drawn with its still and sentence after a reload (no motion), and the player is not named until a moment arrives", () => {
  for (const state of ["confirmed", "paid"]) {
    const html = screen(state, new URLSearchParams("lang=ml")).html;
    assert.match(html, new RegExp(`class="moment m-${state}"><span class="art" aria-hidden="true"><svg`, "u"));
    assert.ok(html.includes(CHAT_MORE.ml[state as "confirmed"]));
  }
  assert.ok(!/<script[^>]*src=/u.test(screen("confirmed", new URLSearchParams("")).html), "no player in the page's own markup: it is added by the script, lazily");
  // the script plays a moment only for a phone that welcomes motion, loads the player on demand, and ends on the still
  const script = /<script nonce="[^"]*">([\s\S]*)<\/script>/u.exec(screen("confirmed-live", new URLSearchParams("")).html)![1];
  assert.match(script, /prefers-reduced-motion: no-preference/u);
  assert.match(script, /if \(!calm\.matches \|\| !box\) return/u);
  assert.match(script, /loop: false, autoplay: true/u);
  assert.match(script, /if \(l\.moment === "confirmed" \|\| l\.moment === "paid"\) reaction\(run, l\.moment\)/u);
});

test("the thread carries the moment a send marked, and a reload keeps it; only the say that passed the record's gate marks it", async () => {
  const clock = fakeClock(NOW);
  const state = emptyChannelState();
  const hash = guestHash("glow", newGuestHandle());
  const to = chatConversationOf(hash);
  state.chat = { [to]: { startedMs: NOW, lastMs: NOW, said: [], day: "x", turns: 0, messages: 0 } };
  const messaging = channelMessaging(createFakeMessaging(clock), () => state, clock);
  const plain = await messaging.sendText(to, "Held until 10:30.");
  const booked = await messaging.sendText(to, "Booked: haircut tomorrow at 5:00 pm.");
  markMoment(state, booked.id, "confirmed");
  const t = chatThread(state, hash, { retentionDays: 30, now: NOW, dayKey: "x" });
  assert.deepEqual(t.lines.map((l) => [l.text, l.moment]), [["Held until 10:30.", undefined], ["Booked: haircut tomorrow at 5:00 pm.", "confirmed"]]);
  assert.ok(plain.id !== booked.id);
  const after = chatThread(state, hash, { after: 0, retentionDays: 30, now: NOW, dayKey: "x" });
  assert.equal(after.lines[0].moment, undefined, "an unmarked line stays unmarked");
});

// ---- the signboard paints ------------------------------------------------------------------------------------------------------------------------

test("each signboard paint is Streetlist's own and its text colour passes AA (4.5 to 1)", () => {
  assert.deepEqual(PAINT_IDS, ["pink", "blue", "green", "marigold", "brick"]);
  // Streetlist's stylesheet is another repository: compared when this checkout sits beside it (the lead's machine), skipped otherwise
  let site = "";
  try { site = readFileSync(process.env.STREETLIST_CSS ?? "/Users/navaltharun/Work/geometer/streetlist/src/styles/site.css", "utf8"); } catch { /* not beside this checkout */ }
  for (const id of PAINT_IDS) {
    const { hex, ink } = PAINTS[id];
    assert.ok(contrastRatio(hex, ink) >= 4.5, `${id}: ${contrastRatio(hex, ink).toFixed(2)}`);
    if (site) assert.ok(site.includes(hex), `${id} ${hex} is a paint on Streetlist's site`);
  }
  assert.ok(isPaint("pink") && !isPaint("#ff0000") && !isPaint("toString") && !isPaint(undefined));
});

test("the page paints the head with the paint's table colours, and keeps the green tint when none is chosen", () => {
  for (const id of PAINT_IDS) assert.match(screen("answered", new URLSearchParams(`paint=${id}`)).html, new RegExp(`--paint:${PAINTS[id].hex};--paint-ink:${PAINTS[id].ink}`, "u"));
  assert.ok(!/--paint:/u.test(screen("answered", new URLSearchParams("")).html));
  assert.ok(!/--paint:/u.test(screen("answered", new URLSearchParams("paint=ff7a59")).html), "a made-up colour is not a paint");
});

test("the pages file carries the paint by id, and reads back only a real one", () => {
  const base = { schema: 1, base: "https://s.example/s/glow", ownerBase: "https://s.example/s/glow/owner" };
  assert.equal(readPagesFile(JSON.stringify({ ...base, paint: "brick" }))?.paint, "brick");
  assert.equal(readPagesFile(JSON.stringify({ ...base, paint: "#b4401f" }))?.paint, undefined);
  assert.equal(readPagesFile(JSON.stringify(base))?.paint, undefined);
});

// ---- hold to talk ---------------------------------------------------------------------------------------------------------------------------------

function voiceWorld(o: { capped?: boolean; audio?: boolean } = {}) {
  const clock = fakeClock(NOW);
  const state = emptyChannelState();
  const hash = guestHash("glow", newGuestHandle());
  const seen: { voiceNote?: true; hasAudio: boolean; text: string }[] = [];
  let listened = 0;
  const turn = (e: Record<string, unknown>) => chatTurn({
    state, ai: {} as AiStore, now: clock.now(), timeZone: TZ, kind: "bookings", setLanguage: () => undefined,
    ...(o.audio === false ? {} : { audio: (ref: string) => (ref === "gone" ? undefined : { ref, bytes: new Uint8Array([1, 2, 3]), mime: "audio/webm; codecs=opus" }) }),
    run: async (m) => { seen.push({ ...(m.voiceNote ? { voiceNote: true as const } : {}), hasAudio: m.audio !== undefined, text: m.text }); if (m.audio) { listened++; m.onHeard?.("is five pm free tomorrow"); } },
  }, { kind: "chat_message", id: "v-1", handle: hash, language: "en", voice: "ref-1", ...e } as never);
  if (o.capped) { state.chat = { [chatConversationOf(hash)]: { startedMs: NOW, lastMs: NOW, said: [], day: "2026-11-17", turns: CHAT_LIMITS.modelTurnsPerDay, messages: 0 } }; }
  return { state, hash, seen, turn, listened: () => listened };
}

test("a recording is handed to the step once, the heard words become the guest's bubble, and it counts as a model turn", async () => {
  const w = voiceWorld();
  assert.equal(await w.turn({}), "done");
  assert.deepEqual(w.seen, [{ voiceNote: true, hasAudio: true, text: "" }]);
  const t = chatThread(w.state, w.hash, { retentionDays: 30, now: NOW, dayKey: "2026-11-17" });
  assert.deepEqual(t.lines.map((l) => [l.who, l.text]), [["you", "is five pm free tomorrow"]], "the words heard, not 'Voice message'");
  assert.equal(w.state.chat![chatConversationOf(w.hash)].turns, 1, "listening is one of the guest's day's model turns");
  assert.equal(await w.turn({}), "repeat", "the same send again is not listened to twice");
  assert.equal(w.listened(), 1);
});

test("a recording is not listened to once the day's model turns are used, or after a restart forgot it; the guest sees 'Voice message' and the agent asks them to type", async () => {
  const capped = voiceWorld({ capped: true });
  await capped.turn({});
  assert.equal(capped.seen[0].hasAudio, false);
  assert.equal(chatThread(capped.state, capped.hash, { retentionDays: 30, now: NOW, dayKey: "x" }).lines[0].text, CHAT_MORE.en.voiceNote);
  const gone = voiceWorld();
  await gone.turn({ voice: "gone" });
  assert.deepEqual(gone.seen, [{ voiceNote: true, hasAudio: false, text: "" }]);
  const none = voiceWorld({ audio: false });
  await none.turn({});
  assert.equal(none.seen[0].hasAudio, false, "a shop with no voice service never holds audio");
});

test("a voice reference from outside is dropped: the event check never reads one", () => {
  const e = checkChannelEvent({ kind: "chat_message", id: "s-1", handle: "a".repeat(64), language: "en", text: "hi", voice: "someone-elses-recording" });
  assert.ok(e.ok && !("voice" in e.event));
  assert.ok(!checkChannelEvent({ kind: "chat_message", id: "s-1", handle: "a".repeat(64), language: "en", voice: "x" }).ok, "a voice send is made by the runtime's own route only");
});

test("hold to talk is drawn only when the shop has a voice service: no button and no gap otherwise; the recorder is the owner app's", () => {
  const without = screen("answered", new URLSearchParams("")).html;
  assert.ok(!/id="rec"|rec-hint|holdToRecord/u.test(without), "no voice service: nothing of it in the page");
  const withVoice = screen("voice", new URLSearchParams("lang=hi")).html;
  assert.match(withVoice, /<button type="button" id="rec" class="rec" hidden aria-label="[^"]*"/u, "hidden until the phone proves it can record");
  assert.ok(withVoice.includes(CHAT_MORE.hi.hold));
  assert.match(withVoice, /audioBitsPerSecond: 24000/u);
  assert.match(withVoice, /audio\/ogg;codecs=opus", "audio\/webm;codecs=opus"/u);
  assert.match(screen("recording", new URLSearchParams("lang=ml")).html, /class="rec-note"/u);
});

// ---- the owner's view of a guest -------------------------------------------------------------------------------------------------------------------

test("a guest gets a short number at the first send, the owner sees 'Chat guest 3', never the conversation's name, and the number outlives a quiet thread while a booking lives", async () => {
  const clock = fakeClock(NOW);
  const state = emptyChannelState();
  const hashes = [1, 2, 3].map(() => guestHash("glow", newGuestHandle()));
  for (const [i, hash] of hashes.entries()) await chatTurn({ state, ai: {} as AiStore, now: clock.now(), timeZone: TZ, kind: "bookings", setLanguage: () => undefined, run: async () => undefined }, { kind: "chat_message", id: `s-${i}`, handle: hash, language: "en", text: "hello" });
  const third = chatConversationOf(hashes[2]);
  assert.equal(guestNumber(state, third), 3);
  assert.equal(guestLabel(state, third, "en"), "Chat guest 3");
  assert.equal(guestLabel(state, third, "ml"), `${CHAT_GUEST.ml} 3`);
  assert.ok(!guestLabel(state, third, "en").includes("chat:"));
  assert.equal(conversationOfNumber(state, 3), third);
  assert.equal(guestLabel(undefined, third, "en"), "Chat guest", "a guest nobody remembers is still never shown as chat:...");
  assert.equal(guestLabel(state, "+919811111111", "en"), "+919811111111", "a WhatsApp number is shown as it always was");
  // retention: the quiet guests go, the one with a live booking stays, and the next number is never a used one
  compactChannel(state, NOW + 40 * 24 * 3_600_000, () => true, (c) => c === third);
  assert.deepEqual(Object.keys(state.chat ?? {}), [third]);
  await chatTurn({ state, ai: {} as AiStore, now: clock.now(), timeZone: TZ, kind: "bookings", setLanguage: () => undefined, run: async () => undefined }, { kind: "chat_message", id: "s-9", handle: guestHash("glow", newGuestHandle()), language: "en", text: "hi" });
  assert.equal(state.guests, 4);
});

test("the owner answers a guest by number through the message card: 'tell chat guest 3 ...' is the proposal message g-3, and the words go to that guest's thread", async () => {
  assert.deepEqual([readOwnerRules("tell chat guest 3 we open at ten", { kinds: ["message", "waiting"] as never }).kind, readOwnerRules("tell chat guest 3 we open at ten", { kinds: ["message", "waiting"] as never }).ref], ["message", "g-3"]);
  assert.equal(readOwnerRules("message g-3 we open at ten", { kinds: ["message", "waiting"] as never }).words, "we open at ten");
  const clock = fakeClock(NOW);
  const state = emptyChannelState();
  const hash = guestHash("glow", newGuestHandle());
  await chatTurn({ state, ai: {} as AiStore, now: clock.now(), timeZone: TZ, kind: "bookings", setLanguage: () => undefined, run: async () => undefined }, { kind: "chat_message", id: "s-1", handle: hash, language: "en", text: "can I talk to someone" });
  const a = { skill: "bookings", channel: state, language: "en" as const, optedOut: () => false };
  const ok = prepareGuestMessage({ kind: "message", case: "g-1", words: "We open at ten." }, a);
  assert.ok(ok && ok.ok && ok.action.fields.phone === chatConversationOf(hash) && ok.shown.who === "Chat guest 1");
  assert.deepEqual(prepareGuestMessage({ kind: "message", case: "g-7", words: "x" }, a), { ok: false, why: "no_case" });
  assert.deepEqual(prepareGuestMessage({ kind: "refund", case: "g-1" }, a), { ok: false, why: "not_here" }, "money is never a guest's");
  assert.deepEqual(prepareGuestMessage({ kind: "message", case: "g-1", words: "Sure, ₹500 back" }, a), { ok: false, why: "amount_not_on_record" });
  assert.deepEqual(prepareGuestMessage({ kind: "message", case: "g-1", words: "hi" }, { ...a, optedOut: () => true }), { ok: false, why: "opted_out" });
  assert.equal(prepareGuestMessage({ kind: "message", case: "b-1", words: "x" }, a), undefined, "another case is the template's own");
  // the words reach the thread as a shop line (and are pushed by the outbox's onKeep when the guest allowed it)
  const pushed: string[] = [];
  const messaging = channelMessaging(createFakeMessaging(clock), () => state, clock, (to, text) => pushed.push(`${to}|${text}`));
  await messaging.sendText(chatConversationOf(hash), "We open at ten.");
  assert.deepEqual(chatThread(state, hash, { retentionDays: 30, now: NOW, dayKey: "x" }).lines.map((l) => [l.who, l.text]), [["you", "can I talk to someone"], ["shop", "We open at ten."]]);
  assert.equal(pushed.length, 1);
});

// ---- the bound on pings --------------------------------------------------------------------------------------------------------------------------

test("a guest can make the shop tell the owner only a few times a day; other conversations and other kinds of message are not limited", async () => {
  const clock = fakeClock(NOW);
  const state = emptyChannelState();
  const hash = guestHash("glow", newGuestHandle());
  await chatTurn({ state, ai: {} as AiStore, now: clock.now(), timeZone: TZ, kind: "bookings", setLanguage: () => undefined, run: async () => undefined }, { kind: "chat_message", id: "s-1", handle: hash, language: "en", text: "hi" });
  const c = chatConversationOf(hash);
  const ask = () => chatPingGate(state, { to: "owner", phone: c, templates: ["owner_wants_to_talk"] }, NOW, TZ);
  for (let i = 0; i < CHAT_LIMITS.pingsPerDay; i++) assert.deepEqual(ask(), [], `ping ${i + 1} is let through`);
  const blocked = ask();
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].verdict, "block");
  assert.deepEqual(chatPingGate(state, { to: "owner", phone: c, templates: ["owner_refund_needs_approval"] }, NOW, TZ), [], "work the owner must see is never held here");
  assert.deepEqual(chatPingGate(state, { to: "customer", phone: c, templates: ["owner_wants_to_talk"] }, NOW, TZ), []);
  assert.deepEqual(chatPingGate(state, { to: "owner", phone: "+919811111111", templates: ["owner_wants_to_talk"] }, NOW, TZ), [], "a WhatsApp customer is not a guest");
  assert.equal(chatMayPing(state, c, NOW + 24 * 3_600_000, TZ), true, "the next day it starts again");
});

// ---- the front's own routes -------------------------------------------------------------------------------------------------------------------------

async function front(withVoice: boolean) {
  const calls: { guest: string; id: string; language: string; bytes: number; mime: string }[] = [];
  const backend = {
    async offer() { return { shop: { name: "Glow Salon", timezone: TZ, languages: [...LANGUAGES], deposit: { amountInr: 200, holdMinutes: 30 }, cancellation: { windowHours: 24 }, payment: { kind: "link" }, paused: false }, services: [] }; },
    async submit() { return "saved" as const; }, async view() { return null; }, async owner() { return null; },
    async chat() { return { lines: [], answered: false, capped: false, retentionDays: 30, ...(withVoice ? { listen: true as const } : {}) }; },
    ...(withVoice ? { async chatVoice(guest: string, send: { id: string; language: string }, audio: { bytes: Buffer; mime: string }) { calls.push({ guest, id: send.id, language: send.language, bytes: audio.bytes.length, mime: audio.mime }); return "saved" as const; } } : {}),
  } as unknown as ChannelBackend;
  const shops: Record<string, FrontShop> = {};
  const server = createServer(frontHandler({ shops }));
  const port = await new Promise<number>((r) => server.listen(0, "127.0.0.1", () => r((server.address() as { port: number }).port)));
  const origin = `http://127.0.0.1:${port}`;
  shops.glow = { publicUrl: `${origin}/s/glow`, backend, pages: () => ({ schema: 1, base: `${origin}/s/glow`, ownerBase: `${origin}/s/glow/owner`, paint: "marigold" }) as never };
  return { origin, calls, done: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }) };
}
const cookieOf = (res: Response) => /(__Secure-geo-chat=[A-Za-z0-9_-]{43})/u.exec(res.headers.get("set-cookie") ?? "")?.[1];

test("the front serves the player and the three files with a year's cache, only for the known names; the page takes its paint from the pages file", async () => {
  const f = await front(true);
  try {
    const js = await fetch(`${f.origin}/s/glow/chat/m/lottie.js`);
    assert.equal(js.status, 200);
    assert.match(js.headers.get("content-type") ?? "", /javascript/u);
    assert.match(js.headers.get("cache-control") ?? "", /max-age=31536000, immutable/u);
    for (const name of MOMENTS) assert.equal((await fetch(`${f.origin}/s/glow/chat/m/${name}.json`)).status, 200, name);
    assert.equal((await fetch(`${f.origin}/s/glow/chat/m/other.json`)).status, 404);
    const page = await fetch(`${f.origin}/s/glow/chat`);
    const html = await page.text();
    assert.match(html, /--paint:#f2a516;--paint-ink:#3d1708/u);
    assert.match(html, /id="rec"/u, "the runtime said it listens: the button is there");
  } finally { await f.done(); }
});

test("a recording is passed to the runtime for the guest only: Opus in Ogg or WebM, from the page's own origin, with the cookie", async () => {
  const f = await front(true);
  try {
    const cookie = cookieOf(await fetch(`${f.origin}/s/glow/chat`))!;
    const post = (headers: Record<string, string>, body: Uint8Array = new Uint8Array(500)) => fetch(`${f.origin}/s/glow/chat/voice?id=v-1&lang=ml`, { method: "POST", headers: { origin: f.origin, ...headers }, body });
    assert.equal((await post({ cookie, "content-type": "audio/webm;codecs=opus" })).status, 200);
    assert.deepEqual(f.calls.map((c) => [c.id, c.language, c.bytes, c.mime]), [["v-1", "ml", 500, "audio/webm;codecs=opus"]]);
    assert.equal((await post({ cookie, "content-type": "audio/mpeg" })).status, 415);
    assert.equal((await post({ "content-type": "audio/ogg" })).status, 400, "no guest cookie");
    assert.equal((await post({ cookie, "content-type": "audio/ogg", origin: "https://evil.example" })).status, 403);
    assert.equal((await post({ cookie, "content-type": "audio/ogg" }, new Uint8Array(0))).status, 413);
    assert.equal(f.calls.length, 1);
  } finally { await f.done(); }
});

test("a shop with no voice service has no voice route and no button", async () => {
  const f = await front(false);
  try {
    const cookie = cookieOf(await fetch(`${f.origin}/s/glow/chat`))!;
    assert.equal((await fetch(`${f.origin}/s/glow/chat/voice`, { method: "POST", headers: { cookie, origin: f.origin, "content-type": "audio/ogg" }, body: new Uint8Array(10) })).status, 404);
    assert.ok(!(await (await fetch(`${f.origin}/s/glow/chat`, { headers: { cookie } })).text()).includes('id="rec"'));
  } finally { await f.done(); }
});
