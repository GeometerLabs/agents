// W1, the chat on the shop's page (17 Nov 2026), without a runtime: the guest's handle and cookie, a send run as a step (made once, a tap checked against what was offered,
// the day's model turns), the thread after a reload and its retention, the events' shape, the page's rules (one script by a nonce, no 'self', the Streetlist mark only on the
// pages domain, the words), and the public front over HTTP with a stand-in backend that keeps the thread in a ChannelState exactly as a runtime does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fakeClock } from "../../core/clock.ts";
import { HOUR, DAY } from "../../core/time.ts";
import { GUEST_HANDLE, guestHash, newGuestHandle } from "../handle.ts";
import { chatConversationOf, isChannelConversation, isChatConversation } from "../conversation.ts";
import { CHAT_LIMITS, GUEST_TURNS_BEFORE_62, chatAnswered, guestTurnsPerDay, chatDay, chatKnown, chatThread, chatTurn, createRate } from "../chat.ts";
import { checkChannelEvent, chatTaskKey, channelEventKey } from "../events.ts";
import { compactChannel, emptyChannelState, CHAT_THREAD_MAX } from "../state.ts";
import type { ChannelState } from "../state.ts";
import { channelMessaging } from "../outbox.ts";
import { createFakeMessaging } from "../../messaging/messaging.ts";
import { stateFor } from "../../understanding/ai-state.ts";
import type { AiStore } from "../../understanding/ai-state.ts";
import { chatPage } from "../chat-page.ts";
import { CHAT_COOKIE, chatPolicy, guestFromCookie } from "../chat-front.ts";
import { frontHandler } from "../front.ts";
import type { FrontShop } from "../front.ts";
import type { ChannelBackend } from "../backend.ts";
import { CHAT, QUICK, forKind } from "../words-chat.ts";
import { identityBlock } from "../chat-identity-page.ts";
import { CHAT_LINK_TEMPLATES, IDENTITY } from "../words-chat-identity.ts";
import { CHAT_MORE } from "../words-chat-more.ts";
import { FIRST_WORDS } from "../words-owner-first.ts";
import { LANGUAGES } from "../../language/languages.ts";
import { screen } from "../chat-screens.ts";
import { esc } from "../../core/html.ts";

const TZ = "Asia/Kolkata";
const NOW = Date.UTC(2026, 10, 17, 6, 0);

// ---- the guest ------------------------------------------------------------------------------------------------------------------------------

test("a guest handle is 32 random bytes, and its hash names the guest at ONE shop only", () => {
  const h = newGuestHandle();
  assert.match(h, GUEST_HANDLE);
  assert.equal(h.length, 43);
  assert.notEqual(newGuestHandle(), h);
  assert.match(guestHash("glow", h), /^[0-9a-f]{64}$/u);
  assert.notEqual(guestHash("glow", h), guestHash("other-shop", h), "the same handle at another shop is another (empty) conversation: one shop's guest is never found at another's");
  assert.equal(guestHash("glow", h), guestHash("glow", h));
});

test("a chat conversation is a channel conversation (so it never goes to WhatsApp), and no other channel name is widened", () => {
  const c = chatConversationOf(guestHash("glow", newGuestHandle()));
  assert.match(c, /^chat:[0-9a-f]{16}$/u);
  assert.ok(isChatConversation(c) && isChannelConversation(c));
  assert.ok(!isChatConversation("web:0123456789abcdef") && isChannelConversation("web:0123456789abcdef"));
  assert.ok(!isChannelConversation("+919811111111"));
});

test("the cookie is read only in its own shape", () => {
  const h = newGuestHandle();
  assert.equal(guestFromCookie(`a=b; ${CHAT_COOKIE}=${h}`), h);
  assert.equal(guestFromCookie(`${CHAT_COOKIE}=short`), undefined);
  assert.equal(guestFromCookie(undefined), undefined);
  assert.equal(guestFromCookie(`other=${h}`), undefined);
});

// ---- the events -------------------------------------------------------------------------------------------------------------------------------

test("a chat_message is exactly one of text, a tap or a quick tap, and its key is per send", () => {
  const handle = "a".repeat(64);
  const ok = (extra: Record<string, unknown>) => checkChannelEvent({ kind: "chat_message", id: "s-1", handle, language: "en", ...extra });
  assert.ok(ok({ text: "hello" }).ok);
  assert.ok(ok({ tap: "svc:haircut" }).ok);
  assert.ok(ok({ quick: 2 }).ok);
  assert.ok(!ok({}).ok, "nothing said");
  assert.ok(!ok({ text: "hi", quick: 1 }).ok, "two ways at once");
  assert.ok(!ok({ quick: 4 }).ok);
  assert.ok(!ok({ text: "x".repeat(501) }).ok, "past the longest send");
  assert.ok(!checkChannelEvent({ kind: "chat_message", id: "s-1", handle: "short", language: "en", text: "hi" }).ok, "the hash, never the handle");
  assert.ok(!checkChannelEvent({ kind: "chat_message", id: "s-1", handle, language: "xx", text: "hi" }).ok);
  const a = ok({ text: "hi" }); const b = checkChannelEvent({ kind: "chat_message", id: "s-2", handle, language: "en", text: "hi" });
  assert.ok(a.ok && b.ok);
  if (a.ok && b.ok) {
    assert.notEqual(channelEventKey(a.event), channelEventKey(b.event), "each send is its own task");
    assert.equal(channelEventKey(a.event), chatTaskKey(handle, "s-1"));
  }
});

// ---- a send run as a step ----------------------------------------------------------------------------------------------------------------------

function stepWorld() {
  const clock = fakeClock(NOW);
  const state = emptyChannelState();
  const ai: AiStore = {};
  const seen: { text: string; from: string; reply?: unknown; noModel?: true }[] = [];
  const langs: string[] = [];
  let modelAsked = false;
  const hash = guestHash("glow", newGuestHandle());
  const turn = (e: Record<string, unknown>) => chatTurn({
    state, ai, now: clock.now(), timeZone: TZ, kind: "bookings",
    run: async (m) => { seen.push({ text: m.text, from: m.from, ...(m.reply ? { reply: m.reply } : {}), ...(m.noModel ? { noModel: true as const } : {}) }); if (modelAsked) stateFor(ai, clock.now(), TZ).model += 1; },
    setLanguage: (_c, l) => langs.push(l),
  }, { kind: "chat_message", id: "s-1", handle: hash, language: "en", ...e } as never);
  return { clock, state, ai, seen, langs, hash, turn, ask: (v: boolean) => { modelAsked = v; } };
}

test("a send reaches the template's own step as the message a WhatsApp customer would have sent, from the guest's conversation, and its line is in the thread", async () => {
  const w = stepWorld();
  assert.equal(await w.turn({ text: "book a haircut" }), "done");
  assert.deepEqual(w.seen.map((m) => [m.from, m.text]), [[chatConversationOf(w.hash), "book a haircut"]]);
  assert.ok(chatKnown(w.state, w.hash));
  const t = chatThread(w.state, w.hash, { retentionDays: 30, now: w.clock.now(), dayKey: chatDay(w.clock.now(), TZ) });
  assert.deepEqual(t.lines.map((l) => [l.who, l.text]), [["you", "book a haircut"]]);
  assert.equal(t.answered, false, "nobody has answered yet: alerts are not offered");
  assert.deepEqual(w.langs, ["en"]);
});

test("the same send made again (a retry with the same id) is answered once", async () => {
  const w = stepWorld();
  assert.equal(await w.turn({ id: "s-9", text: "hello" }), "done");
  assert.equal(await w.turn({ id: "s-9", text: "hello" }), "repeat");
  assert.equal(w.seen.length, 1);
  assert.equal(chatThread(w.state, w.hash, { retentionDays: 30, now: NOW, dayKey: "x" }).lines.length, 1);
});

test("a quick tap is the template's command to the agent and the guest's own words in the thread", async () => {
  const w = stepWorld();
  await w.turn({ quick: 2, language: "ml" });
  assert.equal(w.seen[0].text, QUICK.bookings.command[1]);
  const t = chatThread(w.state, w.hash, { retentionDays: 30, now: NOW, dayKey: "x" });
  assert.equal(t.lines[0].text, QUICK.bookings.label.ml[1]);
});

test("a tap is read only if the shop's latest lines offered it, and is shown with the words of the button", async () => {
  const w = stepWorld();
  const conversation = chatConversationOf(w.hash);
  w.state.outbox.push({ id: `ch-${++w.state.seq}`, to: conversation, text: "Which service?", atMs: NOW, choices: [{ id: "svc:haircut", title: "Haircut", hint: "₹450" }, { id: "slot:1", title: "5 pm", list: true }] });
  assert.equal(await w.turn({ id: "s-a", tap: "svc:nothing" }), "refused", "an id nothing offered does nothing");
  assert.equal(w.seen.length, 0);
  assert.equal(await w.turn({ id: "s-b", tap: "svc:haircut" }), "done");
  assert.deepEqual(w.seen[0].reply, { id: "svc:haircut", kind: "button" });
  assert.equal(w.seen[0].text, "");
  await w.turn({ id: "s-c", tap: "slot:1" });
  assert.deepEqual(w.seen[1].reply, { id: "slot:1", kind: "list" });
  const t = chatThread(w.state, w.hash, { retentionDays: 30, now: NOW, dayKey: "x" });
  assert.deepEqual(t.lines.filter((l) => l.who === "you").map((l) => l.text), ["Haircut", "5 pm"]);
});

test("the day's model turns: after the cap the words are read by the rules alone (noModel), the buttons still work, and a new day starts again", async () => {
  const w = stepWorld();
  w.ask(true);
  for (let i = 0; i < GUEST_TURNS_BEFORE_62; i++) await w.turn({ id: `s-${i}`, text: `question ${i}` });
  assert.ok(w.seen.every((m) => m.noModel === undefined), "up to the cap the model may be asked");
  assert.equal(chatThread(w.state, w.hash, { retentionDays: 30, now: NOW, dayKey: chatDay(NOW, TZ) }).capped, true);
  await w.turn({ id: "s-over", text: "one more question" });
  assert.equal(w.seen.at(-1)!.noModel, true);
  w.state.outbox.push({ id: `ch-${++w.state.seq}`, to: chatConversationOf(w.hash), text: "Pick", atMs: NOW, choices: [{ id: "owner", title: "Talk to the owner" }] });
  await w.turn({ id: "s-tap", tap: "owner" });
  assert.equal(w.seen.at(-1)!.noModel, undefined, "a tap is never held back");
  w.clock.advance(DAY);
  await w.turn({ id: "s-next", text: "good morning" });
  assert.equal(w.seen.at(-1)!.noModel, undefined, "tomorrow the model may be asked again");
});

test("one guest's daily model turns are the shop's budget number (price list ai.daily.customer-talk.per-guest), and the old 20 only when the budget has none", async () => {
  assert.equal(guestTurnsPerDay(undefined), GUEST_TURNS_BEFORE_62);
  assert.equal(guestTurnsPerDay({}), GUEST_TURNS_BEFORE_62);
  assert.equal(guestTurnsPerDay({ guestTurnsPerDay: 40 }), 40);
  const w = stepWorld();
  w.ask(true);
  const budget = { monthlyMicroInr: 30_000_000, daily: {}, guestTurnsPerDay: 40 };
  const turn = (i: number) => chatTurn({ state: w.state, ai: w.ai, now: w.clock.now(), timeZone: TZ, kind: "bookings", budget, run: async (m) => { w.seen.push({ text: m.text, from: m.from, ...(m.noModel ? { noModel: true as const } : {}) }); stateFor(w.ai, w.clock.now(), TZ).model += 1; }, setLanguage: () => undefined }, { kind: "chat_message", id: `b-${i}`, handle: w.hash, language: "en", text: `q ${i}` } as never);
  for (let i = 0; i < 40; i++) await turn(i);
  assert.ok(w.seen.every((m) => m.noModel === undefined), "the 21st to the 40th may still ask the model");
  assert.equal(chatThread(w.state, w.hash, { retentionDays: 30, now: NOW, dayKey: chatDay(NOW, TZ), budget }).capped, true);
  assert.equal(chatThread(w.state, w.hash, { retentionDays: 30, now: NOW, dayKey: chatDay(NOW, TZ) }).capped, true, "without the budget the fallback of 20 is passed too");
  await turn(40);
  assert.equal(w.seen.at(-1)!.noModel, true);
});

test("a turn in which no model was asked does not use up the day's model turns", async () => {
  const w = stepWorld();
  w.ask(false);
  for (let i = 0; i < GUEST_TURNS_BEFORE_62 + 5; i++) await w.turn({ id: `s-${i}`, text: "menu" });
  assert.ok(w.seen.every((m) => m.noModel === undefined));
});

test("the day's sends in all are capped in the saved state", async () => {
  const w = stepWorld();
  for (let i = 0; i < CHAT_LIMITS.messagesPerDay; i++) await w.turn({ id: `s-${i}`, text: "hi" });
  assert.equal(await w.turn({ id: "s-last", text: "hi" }), "refused");
});

test("the per-guest and per-shop rates count in memory and forget with the window", () => {
  let t = 0;
  const rate = createRate(() => t);
  for (let i = 0; i < CHAT_LIMITS.perMinute; i++) assert.ok(rate.take("g", CHAT_LIMITS.perMinute, 60_000));
  assert.ok(!rate.take("g", CHAT_LIMITS.perMinute, 60_000));
  assert.ok(rate.take("other", CHAT_LIMITS.perMinute, 60_000), "another guest is counted apart");
  t += 61_000;
  assert.ok(rate.take("g", CHAT_LIMITS.perMinute, 60_000));
});

// ---- the thread: what the shop said, history, retention -------------------------------------------------------------------------------------

test("the shop's replies and its buttons are kept for the conversation and read back in order; only the latest line carries its choices", async () => {
  const clock = fakeClock(NOW);
  const state = emptyChannelState();
  const base = createFakeMessaging(clock);
  const messaging = channelMessaging(base, () => state, clock);
  const hash = guestHash("glow", newGuestHandle());
  const to = chatConversationOf(hash);
  await messaging.sendText(to, "Hello");
  await messaging.sendInteractive!(to, { body: "Pick one", buttons: [{ id: "a", title: "A" }, { id: "b", title: "B" }] });
  await messaging.sendInteractive!(to, { body: "Which time?", list: { button: "Times", rows: [{ id: "t1", title: "5 pm", description: "free" }] } });
  assert.equal(base.sentTo(to).length, 0, "nothing goes to WhatsApp");
  const t = chatThread(state, hash, { retentionDays: 30, now: NOW, dayKey: "x" });
  assert.deepEqual(t.lines.map((l) => l.text), ["Hello", "Pick one", "Which time?"]);
  assert.equal(t.lines[0].choices, undefined);
  assert.equal(t.lines[1].choices, undefined, "an older line's buttons are no longer on offer");
  assert.deepEqual(t.lines[2].choices, [{ id: "t1", title: "5 pm", hint: "free", list: true }]);
  assert.ok(t.answered && chatAnswered(state, hash));
  // a picture is answered as done and keeps nothing: a chat draws no QR code
  const sent = await messaging.sendImage!(to, { link: "https://x.example/qr.png", caption: "Scan" });
  assert.equal((await messaging.getMessage(sent.id))?.id, sent.id);
  assert.equal(state.outbox.filter((m) => m.to === to).length, 3);
});

test("the thread after a reload is the same, and a reader who has the last line number gets only what is newer", async () => {
  const w = stepWorld();
  const to = chatConversationOf(w.hash);
  await w.turn({ id: "s-1", text: "hi" });
  w.state.outbox.push({ id: `ch-${++w.state.seq}`, to, text: "Hello!", atMs: NOW + 1 });
  await w.turn({ id: "s-2", text: "price?" });
  const all = chatThread(w.state, w.hash, { retentionDays: 30, now: NOW, dayKey: "x" });
  assert.deepEqual(all.lines.map((l) => l.text), ["hi", "Hello!", "price?"]);
  const after = chatThread(w.state, w.hash, { after: all.lines[1].n, retentionDays: 30, now: NOW, dayKey: "x" });
  assert.deepEqual(after.lines.map((l) => l.text), ["price?"]);
});

test("an unknown guest, and a guest at another shop, have an empty thread: nothing is learnt from a made-up handle", () => {
  const w = stepWorld();
  assert.equal(chatThread(w.state, guestHash("another", "x".repeat(43)), { retentionDays: 30, now: NOW, dayKey: "x" }).lines.length, 0);
  assert.equal(chatKnown(w.state, guestHash("another", "x".repeat(43))), false);
});

test("the thread is capped, and goes with the retention: a guest with no line left is forgotten whole", async () => {
  const w = stepWorld();
  for (let i = 0; i < CHAT_THREAD_MAX + 10; i++) await w.turn({ id: `s-${i}`, text: `m${i}` });
  assert.equal(w.state.chat![chatConversationOf(w.hash)].said.length, CHAT_THREAD_MAX);
  const changed = compactChannel(w.state, NOW + 1, () => true);
  assert.ok(changed > 0);
  assert.equal(w.state.chat, undefined, "the guest, its day and its counts are gone");
  assert.equal(chatKnown(w.state, w.hash), false);
});

// ---- the page ----------------------------------------------------------------------------------------------------------------------------------

const shop = { name: "Glow Salon", languages: [...LANGUAGES], paused: false, character: { face: "well" as const, picture: "data:image/svg+xml;base64,AAAA" }, contact: { phone: "+919811111111" } };
const page = (o: Record<string, unknown> = {}) => chatPage({ shop, kind: "bookings", language: "en", base: "https://p.example/glow/chat", home: "https://p.example/glow", nonce: "N0NCE", thread: { lines: [], answered: false, capped: false, retentionDays: 30 }, onStreetlist: false, fontUrl: "https://p.example/glow/chat/font.woff2", ...o });

test("the page has one script, by the nonce, and names every address its policy allows (never 'self')", () => {
  const html = page();
  assert.equal((html.match(/<script/gu) ?? []).length, 1);
  assert.match(html, /<script nonce="N0NCE">/u);
  const policy = chatPolicy("https://p.example/glow/chat", "N0NCE");
  assert.match(policy, /script-src 'nonce-N0NCE'/u);
  assert.match(policy, /connect-src https:\/\/p\.example\/glow\/chat\/send https:\/\/p\.example\/glow\/chat\/thread https:\/\/p\.example\/glow\/chat\/push/u);
  assert.match(policy, /font-src https:\/\/p\.example\/glow\/chat\/font\.woff2/u);
  assert.ok(!/'self'.*script-src|script-src[^;]*'self'|connect-src[^;]*'self'/u.test(policy));
  assert.ok(!/https?:\/\/(?!p\.example)/u.test(html.replace(/https:\/\/streetlist\.in/gu, "").replace(/http:\/\/www\.w3\.org\/2000\/svg/gu, "")), "no external request");
});

test("the empty chat greets in the shop's personality with three taps in the guest's language; no model is asked", () => {
  for (const language of LANGUAGES) {
    const html = page({ language, personality: "cheerful" });
    for (const label of QUICK.bookings.label[language]) assert.ok(html.includes(label), `${language}: ${label}`);
    assert.match(html, /data-quick="1"/u);
    assert.ok(html.includes(esc(CHAT[language].note)), "the quiet note (as the page escapes it)");
    assert.match(html, new RegExp(`<html lang="${language}">`, "u"));
  }
  assert.ok(page({ personality: "brief" }).includes("This is Glow Salon&#39;s assistant.") || page({ personality: "brief" }).includes("Glow Salon"));
});

test("the Streetlist mark shows only on the Streetlist pages domain", () => {
  assert.ok(!page({ onStreetlist: false }).includes("streetlist.in"));
  const on = page({ onStreetlist: true });
  assert.match(on, /href="https:\/\/streetlist\.in"/u);
  assert.match(on, new RegExp(CHAT.en.onStreetlist, "u"));
});

test("Call the shop is in the head, alerts are offered only after an answer, and no forbidden word is on the page", () => {
  assert.match(page(), /href="tel:\+919811111111"/u);
  const unanswered = page({ pushKey: "KEY" });
  assert.match(unanswered, /id="alerts-slot" class="alerts-slot" hidden/u);
  const answered = page({ pushKey: "KEY", thread: { lines: [{ n: 1, who: "shop", text: "Hello", atMs: NOW }], answered: true, capped: false, retentionDays: 30 } });
  assert.doesNotMatch(answered, /id="alerts-slot" class="alerts-slot" hidden/u);
  assert.doesNotMatch(page({ pushKey: undefined }), /id="alerts-on"/u);
  for (const language of LANGUAGES) for (const bad of [/\bbot\b/iu, /\bsafe\b/iu, /guarantee/iu, /passkey/iu, /\bcookie\b/iu]) assert.doesNotMatch(page({ language }).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gu, ""), bad);
});

test("a Fees chat never says shop: head, call button, strip, note, retention line, footer and moments say centre, in four languages; the other kinds keep shop", () => {
  // the words a shop is called in each language (the Malayalam one only as a whole word, so "ഹെയർകട്ട്" is not caught)
  const SHOP_WORD: Record<string, RegExp> = { en: /\bshops?\b/iu, hi: /दुकान/u, ml: /(?<![\p{L}\p{M}])കട(?![\p{L}\p{M}])|കടയ/u, kn: /ಅಂಗಡಿ/u };
  const CENTRE: Record<string, string> = { en: "centre", hi: "केंद्र", ml: "കേന്ദ്ര", kn: "ಕೇಂದ್ರ" };
  const thread = { lines: [{ n: 1, who: "shop" as const, text: "Hello", atMs: NOW, moment: "confirmed" as const }], answered: true, capped: false, retentionDays: 30 };
  for (const language of LANGUAGES) {
    for (const o of [{}, { thread }]) {
      const html = page({ kind: "fees", language, pushKey: "KEY", identity: identityBlock({ kind: "fees", language, base: "https://p.example/glow/chat" }), ...o });
      // the page's own words: no style, and no script (its code and class names call the sender "shop"; its words are checked through the tables below)
      const visible = html.replace(/<style[\s\S]*?<\/style>/gu, "").replace(/<script[\s\S]*?<\/script>/gu, "").replace(/\s(?:class|id|data-[a-z-]+)="[^"]*"/gu, "");
      assert.doesNotMatch(visible.replace(/Glow Salon/gu, ""), SHOP_WORD[language], `${language}: no shop word on a Fees chat`);
      assert.ok(visible.includes(CENTRE[language]), `${language}: says centre`);
    }
    // the call words, the strip's accessible name and the note, exactly
    const fees = page({ kind: "fees", language });
    assert.ok(fees.includes(esc(forKind("fees", language, FIRST_WORDS[language]).shopCall)));
    assert.ok(fees.includes(esc(forKind("fees", language, CHAT[language]).note)));
    assert.ok(fees.includes(esc(forKind("fees", language, CHAT[language]).kept(30))));
    assert.ok(page({ kind: "bookings", language }).includes(esc(CHAT[language].note)), `${language}: Bookings keeps shop`);
    assert.ok(page({ kind: "orders", language }).includes(esc(FIRST_WORDS[language].shopCall)), `${language}: Orders keeps shop`);
  }
  // every line of every table the page reads, as text, in four languages (the script's words are among them)
  for (const language of LANGUAGES) {
    const all = JSON.stringify([forKind("fees", language, CHAT[language]), forKind("fees", language, CHAT_MORE[language]), forKind("fees", language, FIRST_WORDS[language]), forKind("fees", language, IDENTITY[language])]
      .map((t) => Object.values(t).map((v) => (typeof v === "function" ? (v as (n: number) => string)(30) : v))));
    assert.doesNotMatch(all.replace(/\{shop\}/gu, ""), SHOP_WORD[language], `${language}: no table line says shop`);
  }
  assert.equal(forKind("fees", "en", FIRST_WORDS.en).shopCall, "Call the centre");
  assert.equal(forKind("fees", "en", CHAT.en).note, "The centre's assistant replies here. A payment counts once the centre's record shows it.");
  assert.equal(forKind("fees", "en", CHAT.en).kept(30), "The centre keeps this chat for 30 days.");
  assert.equal(forKind("fees", "en", IDENTITY.en).deleteDone, "Deleted. This chat is gone from this centre.");
  // a name placeholder is a shop's name, not the word shop
  assert.match(forKind("fees", "en", { a: "Your link from {shop}: x" }).a, /\{shop\}/u);
  assert.equal(forKind("bookings", "en", CHAT.en), CHAT.en);
});

test("each kind has its own words for the link a guest holds: a booking link, an order link, a fee page link; an unknown kind keeps the booking words and the word shop", () => {
  // what each kind's guest is told they hold, in each language (the Bookings words are the lines as written)
  const LINK: Record<string, Record<string, string>> = {
    bookings: { en: "booking link", hi: "बुकिंग का लिंक", ml: "ബുക്കിംഗ് ലിങ്ക്", kn: "ಬುಕಿಂಗ್ ಲಿಂಕ್" },
    orders: { en: "order link", hi: "ऑर्डर का लिंक", ml: "ഓർഡർ ലിങ്ക്", kn: "ಆರ್ಡರ್ ಲಿಂಕ್" },
    fees: { en: "fee page link", hi: "फ़ीस पेज का लिंक", ml: "ഫീസ് പേജ് ലിങ്ക്", kn: "ಶುಲ್ಕ ಪುಟದ ಲಿಂಕ್" },
  };
  const BOOKING_WORD: Record<string, RegExp> = { en: /booking/iu, hi: /बुकिंग/u, ml: /ബുക്കിംഗ്|ബുക്കിങ്/u, kn: /ಬುಕಿಂಗ್/u };
  for (const language of LANGUAGES) {
    for (const kind of ["bookings", "orders", "fees"] as const) {
      const w = forKind(kind, language, IDENTITY[language]);
      assert.ok(w.sendMyLinks.includes(LINK[kind][language]), `${language}/${kind}: the send button names its link`);
      // the button, the no-lock line and the delete line, as the page draws them
      const block = identityBlock({ kind, language, base: "https://p.example/glow/chat" }).html;
      assert.ok(block.includes(esc(w.sendMyLinks)) && block.includes(esc(w.keepNoLock)) && block.includes(esc(w.deleteAsk)), `${language}/${kind}: the identity box carries the kind's words`);
      // only a Bookings guest is told about a booking: an Orders or Fees guest never reads the word
      const all = JSON.stringify([w, forKind(kind, language, CHAT[language]), forKind(kind, language, CHAT_MORE[language])].map((t) => Object.values(t).map((v) => (typeof v === "function" ? (v as (n: number) => string)(30) : v))));
      if (kind === "bookings") assert.match(all, BOOKING_WORD[language], `${language}: Bookings keeps its booking words`);
      else assert.doesNotMatch(all, BOOKING_WORD[language], `${language}/${kind}: no booking word reaches this guest`);
    }
    // an unknown kind (a caller that does not know, a kind with no words of its own) is the lines as written
    assert.equal(forKind("stock" as never, language, IDENTITY[language]), IDENTITY[language]);
  }
  assert.equal(forKind("orders", "en", IDENTITY.en).sendMyLinks, "Send me my order link");
  assert.equal(forKind("orders", "en", IDENTITY.en).keepNoLock, "This phone has no screen lock, so it cannot keep the chat. You can still chat as a guest, and your order link keeps working.");
  assert.equal(forKind("orders", "en", CHAT.en).note, "The shop's assistant replies here. An order or a payment counts once the shop's record shows it.");
  assert.equal(forKind("fees", "en", IDENTITY.en).sendMyLinks, "Send me my fee page link");
  assert.equal(forKind("fees", "en", IDENTITY.en).deleteAsk.includes("for a payment."), true);
  assert.equal(IDENTITY.en.sendMyLinks, "Send me my booking link");
  // the one template for a link sent again says "link" for every kind, so one approved template serves them all
  assert.doesNotMatch(JSON.stringify(CHAT_LINK_TEMPLATES.find((t) => t.name === "chat_my_link")?.bodies), /booking|order/iu);
});

test("every state of the review's screens draws, in four languages, with the shop's own paint", () => {
  for (const state of ["empty", "answered", "long", "sending", "failed", "slow", "offline", "capped", "closed", "paused", "alerts", "confirmed", "paid", "confirmed-live", "paid-live", "voice", "recording", "busy"]) {
    for (const language of LANGUAGES) {
      const { html } = screen(state, new URLSearchParams(`lang=${language}&paint=pink`));
      assert.match(html, /--paint:#c4386f;--paint-ink:#ffffff/u);
      assert.ok(html.length < 60_000, `${state} ${language} stays light`);
    }
  }
  assert.match(screen("capped", new URLSearchParams("lang=en")).html, new RegExp(CHAT.en.capped.slice(0, 20), "u"));
  assert.match(screen("closed", new URLSearchParams("lang=en")).html, /Closed/u);
});

// ---- the public front over HTTP ----------------------------------------------------------------------------------------------------------------

/** A stand-in runtime: it keeps a ChannelState and runs each chat_message through chatTurn with a script of replies, as the real runtime does with the template's agent. */
function standIn(name: string) {
  const clock = fakeClock(NOW);
  const state: ChannelState = emptyChannelState();
  const ai: AiStore = {};
  const submitted: unknown[] = [];
  const base = createFakeMessaging(clock);
  const messaging = channelMessaging(base, () => state, clock);
  const backend = {
    async offer() { return { shop: { name: "Glow Salon", timezone: TZ, languages: [...LANGUAGES], deposit: { amountInr: 200, holdMinutes: 30 }, cancellation: { windowHours: 24 }, payment: { kind: "link" }, paused: false, contact: undefined }, services: [] }; },
    async submit(events: { kind: string; handle?: string; text?: string; tap?: string; quick?: number; id: string; language: string }[]) {
      for (const e of events) {
        submitted.push(e);
        if (e.kind !== "chat_message") continue;
        await chatTurn({ state, ai, now: clock.now(), timeZone: TZ, kind: "bookings", setLanguage: () => undefined, run: async (m) => {
          const to = m.from;
          if (m.text === "book") await messaging.sendInteractive!(to, { body: "Which service?", buttons: [{ id: "svc:haircut", title: "Haircut" }] });
          else await messaging.sendText(to, `You said: ${m.text || m.reply?.id}`);
        } }, e as never);
      }
      return "saved" as const;
    },
    async view() { return null; },
    async owner() { return null; },
    async chat(hash: string, q: { after?: number } = {}) { return { ...chatThread(state, hash, { ...(q.after ? { after: q.after } : {}), retentionDays: 30, now: clock.now(), dayKey: chatDay(clock.now(), TZ) }), personality: "warm" }; },
    async push(body: Record<string, unknown>) { return body.op === "key" ? { status: 200, body: { on: true, publicKey: "PUBKEY" } } : { status: 200, body: {} }; },
  } as unknown as ChannelBackend;
  return { backend, state, submitted, name };
}

async function front(o: { door?: boolean } = {}) {
  const sa = standIn("glow");
  const shops: Record<string, FrontShop> = {};
  const server = createServer(frontHandler({ shops }));
  const port = await new Promise<number>((r) => server.listen(0, "127.0.0.1", () => r((server.address() as { port: number }).port)));
  const origin = `http://127.0.0.1:${port}`;
  shops.glow = { publicUrl: `${origin}/s/glow`, backend: sa.backend, ...(o.door ? { pages: () => ({ schema: 1, base: `${origin}/s/glow`, ownerBase: `${origin}/s/glow/owner`, slug: "glow-salon", url: "https://pages.example/glow-salon" }) as never } : {}) };
  const get = (path: string, headers: Record<string, string> = {}) => fetch(`${origin}/s/glow${path}`, { redirect: "manual", headers });
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) => fetch(`${origin}/s/glow${path}`, { method: "POST", redirect: "manual", headers: { "content-type": "application/json", origin, ...headers }, body: JSON.stringify(body) });
  return { sa, origin, get, post, done: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }) };
}

const cookieOf = (res: Response) => /(__Secure-geo-chat=[A-Za-z0-9_-]{43})/u.exec(res.headers.get("set-cookie") ?? "")?.[1];

test("opening the chat sets a guest cookie: HttpOnly, Secure, SameSite=Lax, scoped to the shop's chat path; the page has the policy and no sign-in", async () => {
  const f = await front();
  try {
    const res = await f.get("/chat?lang=en");
    assert.equal(res.status, 200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /^__Secure-geo-chat=[A-Za-z0-9_-]{43}; Path=\/s\/glow\/chat; Max-Age=\d+; HttpOnly; Secure; SameSite=Lax$/u);
    const csp = res.headers.get("content-security-policy") ?? "";
    assert.match(csp, /script-src 'nonce-/u);
    assert.match(csp, /font-src .*\/s\/glow\/chat\/font\.woff2/u);
    const html = await res.text();
    assert.match(html, /Glow Salon/u);
    assert.ok(!/Streetlist/u.test(html), "a shop served on its own address shows no Streetlist mark");
    const again = await f.get("/chat", { cookie: cookieOf(res)! });
    assert.equal(again.headers.get("set-cookie"), null, "a guest who has a cookie is not given another");
  } finally { await f.done(); }
});

test("through the pages domain's door the Streetlist mark shows, and the cookie path is the door's", async () => {
  const f = await front({ door: true });
  try {
    const res = await fetch(`${f.origin}/s/glow/chat`, { headers: { "x-geometer-door": "glow-salon" } });
    assert.match(res.headers.get("set-cookie") ?? "", /Path=\/glow-salon\/chat;/u);
    assert.match(await res.text(), /streetlist\.in/u);
  } finally { await f.done(); }
});

test("a send reaches the step, its reply is in the thread, and the same send again is answered once", async () => {
  const f = await front();
  try {
    const open = await f.get("/chat");
    const cookie = cookieOf(open)!;
    const one = await f.post("/chat/send", { id: "s-1", text: "hello", lang: "en" }, { cookie });
    assert.equal(one.status, 200);
    const again = await f.post("/chat/send", { id: "s-1", text: "hello", lang: "en" }, { cookie });
    assert.equal(again.status, 200);
    const thread = await (await f.get("/chat/thread", { cookie })).json() as { lines: { who: string; text: string }[]; answered: boolean };
    assert.deepEqual(thread.lines.map((l) => [l.who, l.text]), [["you", "hello"], ["shop", "You said: hello"]]);
    assert.equal(thread.answered, true);
    // the page after a reload draws the same thread
    const reload = await (await f.get("/chat", { cookie })).text();
    assert.match(reload, /You said: hello/u);
  } finally { await f.done(); }
});

test("a booking started in the chat: the shop's card comes back as buttons in the thread, and a tap on one is read as that button", async () => {
  const f = await front();
  try {
    const cookie = cookieOf(await f.get("/chat"))!;
    await f.post("/chat/send", { id: "s-1", quick: 2, lang: "en" }, { cookie });
    const t1 = await (await f.get("/chat/thread", { cookie })).json() as { lines: { who: string; text: string; choices?: { id: string; title: string }[] }[] };
    assert.deepEqual(t1.lines.at(-1)!.choices, [{ id: "svc:haircut", title: "Haircut" }]);
    const page = await (await f.get("/chat", { cookie })).text();
    assert.match(page, /data-tap="svc:haircut"/u, "drawn as a tap");
    await f.post("/chat/send", { id: "s-2", tap: "svc:haircut", lang: "en" }, { cookie });
    const t2 = await (await f.get("/chat/thread", { cookie })).json() as { lines: { who: string; text: string }[] };
    assert.ok(t2.lines.some((l) => l.who === "you" && l.text === "Haircut"));
    await f.post("/chat/send", { id: "s-3", tap: "svc:made-up", lang: "en" }, { cookie });
    const t3 = await (await f.get("/chat/thread", { cookie })).json() as { lines: unknown[] };
    assert.equal(t3.lines.length, t2.lines.length, "a tap nothing offered adds nothing");
  } finally { await f.done(); }
});

test("one shop's cookie opens nothing at another shop: the same handle names another, empty conversation there", async () => {
  const f = await front();
  try {
    const cookie = cookieOf(await f.get("/chat"))!;
    await f.post("/chat/send", { id: "s-1", text: "hello", lang: "en" }, { cookie });
    const handle = /=(.+)$/u.exec(cookie)![1];
    assert.notEqual(guestHash("glow", handle), guestHash("elsewhere", handle));
    assert.equal(chatKnown(f.sa.state, guestHash("elsewhere", handle)), false);
    assert.equal(chatKnown(f.sa.state, guestHash("glow", handle)), true);
  } finally { await f.done(); }
});

test("a send with no cookie, from another site, or past the door's per-address limit is refused", async () => {
  const f = await front();
  try {
    assert.equal((await f.post("/chat/send", { id: "s-1", text: "hi" })).status, 400, "no guest yet");
    const cookie = cookieOf(await f.get("/chat"))!;
    const other = await fetch(`${f.origin}/s/glow/chat/send`, { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example", cookie }, body: JSON.stringify({ id: "s-2", text: "hi" }) });
    assert.equal(other.status, 403);
    let last = 200;
    for (let i = 0; i < 60; i++) last = (await f.post("/chat/send", { id: `s-${i + 10}`, text: "hi", lang: "en" }, { cookie })).status;
    assert.equal(last, 429);
  } finally { await f.done(); }
});

test("alerts are offered with the shop's key, and the worker is served only for the chat's own scope", async () => {
  const f = await front();
  try {
    const cookie = cookieOf(await f.get("/chat"))!;
    await f.post("/chat/send", { id: "s-1", text: "hello", lang: "en" }, { cookie });
    const html = await (await f.get("/chat", { cookie })).text();
    assert.match(html, /data-key="PUBKEY"/u);
    assert.match(html, /data-scope="[^"]*\/s\/glow\/chat\/"/u);
    const sw = await f.get("/chat/sw.js");
    assert.equal(sw.status, 200);
    assert.match(await sw.text(), /showNotification/u);
    const font = await f.get("/chat/font.woff2");
    assert.equal(font.headers.get("content-type"), "font/woff2");
    assert.match(font.headers.get("cache-control") ?? "", /max-age=31536000/u);
  } finally { await f.done(); }
});
