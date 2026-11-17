// W2, who a chat guest is (17 Nov 2026), without a browser or a runtime: the customer's key pair (a passkey) bound to a thread and used to open it on another phone, the same checks
// as the owner's (webauthn.ts) driven by the software authenticator, another shop's key refused, the user verified, the options that let the old phone sign the new one in, the one-use
// link to the number a customer gave, its limits, "delete my chat", the runtime's translations at the door, and the link step. Written 17 Nov, not run when written (the owner asked for
// one test pass at the end).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeClock } from "../../core/clock.ts";
import { createFakeMessaging } from "../../messaging/messaging.ts";
import { CHAT_CHALLENGE_MS, LINKS_PER_DAY, RECOVERY_LINK_MS, WRONG_LINK_LIMIT, openChatIdentity } from "../chat-identity.ts";
import { createChatIdentity } from "../chat-identity-http.ts";
import { createChatLinks } from "../chat-link-send.ts";
import { chatConversationOf } from "../conversation.ts";
import { checkChannelEvent } from "../events.ts";
import { chatTurn, forgetChat } from "../chat.ts";
import { emptyChannelState } from "../state.ts";
import type { ChannelState } from "../state.ts";
import { parentChatHash } from "../handle.ts";
import { CHAT_LINK_TEMPLATES, IDENTITY, chatLinkSubmissions } from "../words-chat-identity.ts";
import { LANGUAGES } from "../../language/languages.ts";
import { newSoftPasskey, softRegister, softSignin } from "./soft-authenticator.ts";

const T0 = Date.parse("2026-11-17T10:00:00Z");
const RP = { rpId: "pages.example", origin: "https://pages.example" };
const OTHER = "https://pages.example/other-shop";
const H1 = "1".repeat(64); const H2 = "2".repeat(64); const H3 = "3".repeat(64);
const NUMBER = "919811111111";

function store() {
  const dir = mkdtempSync(join(tmpdir(), "chat-identity-"));
  const file = join(dir, "chat-identity.sqlite");
  const identity = openChatIdentity(file);
  return { identity, file, done: () => { identity.close(); rmSync(dir, { recursive: true, force: true }); } };
}
/** Keep the chat of `hash` with a software passkey; returns the passkey and the result. */
function keep(identity: ReturnType<typeof openChatIdentity>, hash: string, o: { flags?: number; alg?: -7 | -8; count?: number } = {}) {
  const p = newSoftPasskey(RP.rpId, { ...(o.alg ? { alg: o.alg } : {}), ...(o.count !== undefined ? { count: o.count } : {}) });
  const options = identity.keepOptions(hash, RP, "Glow Salon", T0) as { challenge: string; user: { id: string } };
  const result = identity.keep(hash, RP, softRegister(p, options, RP.origin, o.flags !== undefined ? { flags: o.flags } : {}), T0);
  return { p, result, options };
}
const signinOptions = (identity: ReturnType<typeof openChatIdentity>, now = T0 + 1) => identity.signinOptions(RP, now) as { challenge: string };

// ---- the key, bound to the thread ------------------------------------------------------------------------------------------------------------------

test("keeping a chat binds the key to the thread; the new phone's own hash is then tied to it, and only that", () => {
  const s = store();
  try {
    const { p, result } = keep(s.identity, H1);
    assert.deepEqual(result, { ok: true });
    assert.deepEqual(s.identity.state(H1), { keys: 1, here: true, number: false });
    const o = signinOptions(s.identity);
    const r = s.identity.signin(H2, RP, softSignin(p, o, RP.origin), T0 + 2);
    assert.deepEqual(r, { ok: true, thread: H1 });
    assert.equal(s.identity.resolve(H2), H1, "the new phone reads the old thread: its lines, its caps, its bookings");
    assert.equal(s.identity.resolve(H1), H1);
    assert.equal(s.identity.resolve(H3), H3, "another guest is nobody's");
    assert.deepEqual(s.identity.state(H2), { keys: 1, here: true, number: false }, "a phone that opened the chat with the key has one of its own");
    assert.deepEqual(s.identity.signin(H3, RP, softSignin(p, o, RP.origin), T0 + 3).ok, false, "the challenge is used up: the same answer does nothing again");
  } finally { s.done(); }
});

test("the options: a key the phone finds again by itself, the user verified, no list of keys, and nothing that keeps the key to this phone (the old phone can sign the new one in)", () => {
  const s = store();
  try {
    const keepOptions = s.identity.keepOptions(H1, RP, "Glow Salon", T0) as { authenticatorSelection: Record<string, unknown>; rp: { id: string }; user: { id: string; name: string }; attestation: string };
    assert.equal(keepOptions.authenticatorSelection.residentKey, "required");
    assert.equal(keepOptions.authenticatorSelection.userVerification, "required");
    assert.ok(!("authenticatorAttachment" in keepOptions.authenticatorSelection), "no platform-only restriction");
    assert.equal(keepOptions.attestation, "none");
    assert.equal(keepOptions.rp.id, RP.rpId);
    const signin = s.identity.signinOptions(RP, T0) as Record<string, unknown>;
    assert.deepEqual(signin.allowCredentials, [], "a new phone cannot name its key");
    assert.equal(signin.userVerification, "required");
    assert.ok(!("authenticatorAttachment" in signin) && !("hints" in signin), "nothing restricts where the key lives: the browser offers its own 'use another phone' with the QR");
    assert.equal(signin.rpId, RP.rpId);
  } finally { s.done(); }
});

test("each thread has its own user id, stable for the thread; a second customer on one phone does not replace the first one's key", () => {
  const s = store();
  try {
    const a = s.identity.keepOptions(H1, RP, "Glow", T0) as { user: { id: string } };
    const b = s.identity.keepOptions(H3, RP, "Glow", T0) as { user: { id: string } };
    assert.notEqual(a.user.id, b.user.id);
    assert.equal((s.identity.keepOptions(H1, RP, "Glow", T0 + 1) as { user: { id: string } }).user.id, a.user.id);
    assert.equal((s.identity.keepOptions(H1, RP, "Glow", T0) as { user: { id: string } }).user.id.length, 22, "16 random bytes");
  } finally { s.done(); }
});

test("another shop's key is refused: a passkey made for another shop on the same pages domain is not known here", () => {
  const here = store(); const there = store();
  try {
    const { p } = keep(there.identity, H1);
    const o = signinOptions(here.identity);
    const r = here.identity.signin(H2, RP, softSignin(p, o, RP.origin), T0 + 2);
    assert.equal(r.ok, false);
    assert.match((r as { why: string }).why, /not one of this shop/u);
    assert.equal(here.identity.resolve(H2), H2, "nothing was tied");
    // and a key of this shop that names another shop's user id is refused too
    const mine = keep(here.identity, H1);
    const r2 = here.identity.signin(H2, RP, softSignin(mine.p, signinOptions(here.identity, T0 + 3), RP.origin, { userHandle: "x".repeat(22) }), T0 + 4);
    assert.match((r2 as { why: string }).why, /another shop/u);
  } finally { here.done(); there.done(); }
});

test("the registration is bound to the thread that asked: another guest cannot use its challenge", () => {
  const s = store();
  try {
    const p = newSoftPasskey(RP.rpId);
    const options = s.identity.keepOptions(H1, RP, "Glow", T0) as { challenge: string; user: { id: string } };
    const r = s.identity.keep(H3, RP, softRegister(p, options, RP.origin), T0);
    assert.equal(r.ok, false);
    assert.match((r as { why: string }).why, /no challenge of this chat/u);
  } finally { s.done(); }
});

test("the user must be verified: a phone that did not check a fingerprint or screen lock is refused, at keeping and at opening", () => {
  const s = store();
  try {
    const bad = keep(s.identity, H1, { flags: 0x01 });
    assert.equal(bad.result.ok, false);
    assert.match((bad.result as { why: string }).why, /fingerprint or screen lock/u);
    const good = keep(s.identity, H1);
    assert.equal(good.result.ok, true);
    const r = s.identity.signin(H2, RP, softSignin(good.p, signinOptions(s.identity), RP.origin, { flags: 0x01 }), T0 + 2);
    assert.equal(r.ok, false);
    assert.match((r as { why: string }).why, /fingerprint or screen lock/u);
  } finally { s.done(); }
});

test("a challenge works once, in time; an answer for another site's origin or RP ID is refused", () => {
  const s = store();
  try {
    const { p } = keep(s.identity, H1);
    const o = signinOptions(s.identity, T0);
    assert.equal(s.identity.signin(H2, RP, softSignin(p, o, RP.origin), T0 + CHAT_CHALLENGE_MS + 1).ok, false, "the challenge has run out");
    const o2 = signinOptions(s.identity, T0 + 10);
    assert.equal(s.identity.signin(H2, RP, softSignin(p, o2, "https://evil.example"), T0 + 11).ok, false, "another origin");
    const o3 = signinOptions(s.identity, T0 + 20);
    assert.equal(s.identity.signin(H2, RP, softSignin(p, o3, RP.origin, { rpId: "evil.example" }), T0 + 21).ok, false, "another RP ID");
  } finally { s.done(); }
});

test("the counter rule: a counter that goes back shows a copied key; a synced key that always says 0 is accepted", () => {
  const s = store();
  try {
    const { p } = keep(s.identity, H1);
    assert.equal(s.identity.signin(H2, RP, softSignin(p, signinOptions(s.identity, T0 + 1), RP.origin), T0 + 2).ok, true);
    assert.equal(s.identity.signin(H2, RP, softSignin(p, signinOptions(s.identity, T0 + 3), RP.origin), T0 + 4).ok, true);
    p.count = 0;
    const back = s.identity.signin(H2, RP, softSignin(p, signinOptions(s.identity, T0 + 5), RP.origin), T0 + 6);
    assert.equal(back.ok, false);
    assert.match((back as { why: string }).why, /counter/u);
    const synced = keep(s.identity, H3, { alg: -8 });
    for (let i = 0; i < 2; i++) assert.equal(s.identity.signin(H2, RP, softSignin(synced.p, signinOptions(s.identity, T0 + 10 + i * 2), RP.origin, { still: true }), T0 + 11 + i * 2).ok, true);
  } finally { s.done(); }
});

// ---- the one-use link to the number the customer gave ----------------------------------------------------------------------------------------------

test("the link: one use, short, replaced by a newer one, never used up by looking, and only its hash is kept", () => {
  const s = store();
  try {
    s.identity.setNumber(H1, NUMBER, T0);
    assert.equal(s.identity.guestOfNumber(NUMBER), H1);
    assert.equal(s.identity.guestOfNumber("919800000000"), undefined);
    const a = s.identity.issueLink(H1, T0);
    assert.equal(s.identity.linkState(a.token, T0 + 1), "valid");
    assert.equal(s.identity.linkState(a.token, T0 + 2), "valid", "looking at it (a scanner, a preview) uses nothing up");
    const used = s.identity.useLink(a.token, H2, T0 + 3);
    assert.deepEqual(used, { ok: true, thread: H1 });
    assert.equal(s.identity.resolve(H2), H1, "the new phone is tied to the thread");
    assert.deepEqual(s.identity.useLink(a.token, H3, T0 + 4), { ok: false, state: "used" });
    assert.equal(s.identity.resolve(H3), H3, "a second press ties nothing");
    // it runs out
    const b = s.identity.issueLink(H1, T0 + 10);
    assert.equal(s.identity.linkState(b.token, T0 + 10 + RECOVERY_LINK_MS - 1), "valid");
    assert.equal(s.identity.linkState(b.token, T0 + 10 + RECOVERY_LINK_MS + 1), "expired");
    assert.deepEqual(s.identity.useLink(b.token, H3, T0 + 10 + RECOVERY_LINK_MS + 1), { ok: false, state: "expired" });
    // a newer link replaces an older one
    const c = s.identity.issueLink(H1, T0 + 20); const d = s.identity.issueLink(H1, T0 + 21);
    assert.equal(s.identity.linkState(c.token, T0 + 22), "replaced");
    assert.equal(s.identity.linkState(d.token, T0 + 22), "valid");
    assert.equal(s.identity.linkState("not a token", T0), "unknown");
    // the token is never kept: its hash is
    const rows = new DatabaseSync(s.file, { readOnly: true }).prepare("SELECT hash FROM links").all() as { hash: string }[];
    assert.ok(rows.length >= 4 && rows.every((r) => r.hash !== d.token && /^[0-9a-f]{64}$/u.test(r.hash)));
    for (const f of [s.file, `${s.file}-wal`]) if (existsSync(f)) assert.ok(!readFileSync(f).includes(d.token), `${f} holds no token`);
  } finally { s.done(); }
});

test("two presses at once: only one wins; and a link that was never sent can never be used", () => {
  const s = store();
  try {
    const a = s.identity.issueLink(H1, T0);
    const first = s.identity.useLink(a.token, H2, T0 + 1); const second = s.identity.useLink(a.token, H3, T0 + 1);
    assert.equal([first.ok, second.ok].filter(Boolean).length, 1);
    const b = s.identity.issueLink(H1, T0 + 5);
    s.identity.linkUnsent(b.id);
    assert.equal(s.identity.linkState(b.token, T0 + 6), "unknown");
  } finally { s.done(); }
});

test("sends are limited per number and per shop, counted whether or not a link then goes; wrong links are counted per shop; a thread's booking links a few a day", () => {
  const s = store();
  try {
    assert.ok(s.identity.countRecoveryAsk(NUMBER, T0) && s.identity.countRecoveryAsk(NUMBER, T0 + 1));
    assert.equal(s.identity.countRecoveryAsk(NUMBER, T0 + 2), false, "two an hour for one number");
    assert.ok(s.identity.countRecoveryAsk(NUMBER, T0 + 61 * 60_000), "an hour later it is served again");
    assert.equal(s.identity.countRecoveryAsk(NUMBER, T0 + 62 * 60_000), false, "three a day for one number");
    const t = store();
    try {
      let served = 0;
      for (let i = 0; i < 8; i++) if (t.identity.countRecoveryAsk(`9198000000${String(i).padStart(2, "0")}`, T0 + i)) served++;
      assert.equal(served, 5, "five a quarter of an hour for the whole shop, whoever asks");
    } finally { t.done(); }
    assert.equal(s.identity.wrongLinks.locked(T0), false);
    for (let i = 0; i < WRONG_LINK_LIMIT; i++) s.identity.wrongLinks.note(T0 + i);
    assert.equal(s.identity.wrongLinks.locked(T0 + 100), true);
    assert.equal(s.identity.countLinksAsk(H1, T0), false, "no number given, nothing to send to");
    s.identity.setNumber(H1, NUMBER, T0);
    for (let i = 0; i < LINKS_PER_DAY; i++) assert.ok(s.identity.countLinksAsk(H1, T0 + i));
    assert.equal(s.identity.countLinksAsk(H1, T0 + 10), false, "three a day for a thread");
    // several threads naming ONE number: three a day for the number, whoever asks
    const same = store();
    try {
      for (const h of [H1, H2, H3]) same.identity.setNumber(h, NUMBER, T0);
      assert.ok(same.identity.countLinksAsk(H1, T0) && same.identity.countLinksAsk(H1, T0 + 1) && same.identity.countLinksAsk(H2, T0 + 2));
      assert.equal(same.identity.countLinksAsk(H3, T0 + 3), false, "the number's three a day are used");
    } finally { same.done(); }
    // many threads, each its own number: twenty a day for the shop
    const u = store();
    try {
      let served = 0;
      for (let i = 0; i < 25; i++) { const h = String(i).padStart(2, "0").repeat(32); u.identity.setNumber(h, `91980000${String(i).padStart(4, "0")}`, T0); if (u.identity.countLinksAsk(h, T0 + i)) served++; }
      assert.equal(served, 20);
    } finally { u.done(); }
  } finally { s.done(); }
});

test("delete my chat, this side: keys, number, links and every tied phone go, and this phone's own tie", () => {
  const s = store();
  try {
    const { p } = keep(s.identity, H1);
    s.identity.setNumber(H1, NUMBER, T0);
    const link = s.identity.issueLink(H1, T0);
    s.identity.signin(H2, RP, softSignin(p, signinOptions(s.identity), RP.origin), T0 + 2);
    assert.equal(s.identity.resolve(H2), H1);
    assert.equal(s.identity.forget(H2), H1, "asked from the tied phone, it is the thread that is forgotten");
    assert.deepEqual(s.identity.state(H1), { keys: 0, here: false, number: false });
    assert.equal(s.identity.resolve(H2), H2);
    assert.equal(s.identity.guestOfNumber(NUMBER), undefined);
    assert.equal(s.identity.linkState(link.token, T0 + 3), "unknown");
    assert.equal(s.identity.signin(H3, RP, softSignin(p, signinOptions(s.identity, T0 + 4), RP.origin), T0 + 5).ok, false, "the old key opens nothing now");
  } finally { s.done(); }
});

test("what is kept past its use goes: a number after the thread's retention, a link after a day; a key stays until the chat is deleted", () => {
  const s = store();
  try {
    const { p } = keep(s.identity, H1);
    s.identity.setNumber(H1, NUMBER, T0);
    const link = s.identity.issueLink(H1, T0);
    s.identity.purge(T0 + 29 * 24 * 3_600_000);
    assert.equal(s.identity.guestOfNumber(NUMBER), H1, "kept for the thread's retention");
    s.identity.purge(T0 + 31 * 24 * 3_600_000);
    assert.equal(s.identity.guestOfNumber(NUMBER), undefined);
    assert.equal(s.identity.linkState(link.token, T0 + 31 * 24 * 3_600_000), "unknown");
    assert.equal(s.identity.state(H1).keys, 1);
    assert.equal(s.identity.signin(H2, RP, softSignin(p, signinOptions(s.identity, T0 + 32 * 24 * 3_600_000), RP.origin), T0 + 32 * 24 * 3_600_000 + 1).ok, true, "the key still opens the chat");
  } finally { s.done(); }
});

// ---- the words and the templates --------------------------------------------------------------------------------------------------------------------

test("the words are in four languages, never say passkey, sign in, login or error, and never promise what they cannot", () => {
  const banned = /passkey|sign in|login|log in|session|error|retry|\bbot\b|safe|guarantee|certified|100%|\bearn|income|founder/iu;
  for (const language of LANGUAGES) {
    const w = IDENTITY[language];
    for (const [key, text] of Object.entries(w)) { assert.ok(text.length > 0, `${language}.${key} is empty`); assert.ok(!banned.test(text), `${language}.${key}: ${text}`); }
  }
  assert.match(IDENTITY.en.keepBody, /fingerprint or screen lock/u);
  assert.match(IDENTITY.en.keepBody, /No password/u);
  assert.match(IDENTITY.en.otherPhoneLine, /another phone/u, "the old phone's help, in one line");
  assert.match(IDENTITY.en.keepNoLock, /no screen lock/u);
  assert.match(IDENTITY.en.deleteAsk, /law/u, "what stays is said in one line");
});

test("the two link templates: four languages, utility, a body that neither starts nor ends with a value, the two values in order", () => {
  assert.deepEqual(CHAT_LINK_TEMPLATES.map((t) => t.name), ["chat_new_phone", "chat_my_link"]);
  for (const t of CHAT_LINK_TEMPLATES) for (const language of LANGUAGES) {
    const body = t.bodies[language];
    assert.ok(!body.startsWith("{") && !body.endsWith("}"), `${t.name}.${language}`);
    assert.ok(body.indexOf("{shop}") < body.indexOf("{link}"), `${t.name}.${language}: shop first, link second`);
  }
  const list = chatLinkSubmissions();
  assert.equal(list.length, 8);
  assert.ok(list.every((x) => x.category === "UTILITY" && /^[a-z_]+$/u.test(x.name) && x.components[0]!.type === "BODY" && /\{\{1\}\}.*\{\{2\}\}/u.test((x.components[0] as { text: string }).text)));
  assert.deepEqual(JSON.parse(readFileSync(new URL("../chat-link-templates.json", import.meta.url), "utf8")), JSON.parse(JSON.stringify(list)), "run: node modules/channels/scripts/chat-link-templates.ts");
});

// ---- the events and "delete my chat", the step's side -----------------------------------------------------------------------------------------------

test("a forget is its own way of saying, a parent's link is named by its hash, and neither can be mixed with words", () => {
  const handle = "a".repeat(64); const parent = "b".repeat(64);
  const ok = (extra: Record<string, unknown>) => checkChannelEvent({ kind: "chat_message", id: "s-1", handle, language: "en", ...extra });
  assert.ok(ok({ forget: true }).ok);
  assert.ok(!ok({ forget: true, text: "hi" }).ok);
  assert.ok(!ok({ forget: false }).ok);
  assert.ok(ok({ text: "hi", parent }).ok);
  assert.ok(!ok({ text: "hi", parent: "short" }).ok);
});

test("delete my chat: the guest's lines, the shop's lines to them and the day's counts go; another guest's thread is untouched; the record and the bookings are not the chat's", async () => {
  const state: ChannelState = emptyChannelState();
  const mine = chatConversationOf(H1); const theirs = chatConversationOf(H3);
  const say = async (conversation: string, id: string, text: string) => {
    await chatTurn({ state, ai: {}, now: T0, timeZone: "Asia/Kolkata", kind: "bookings", setLanguage: () => undefined, run: async (m) => { state.outbox.push({ id: `ch-${++state.seq}`, to: m.from, text: `You said: ${m.text}`, atMs: T0 }); } },
      { kind: "chat_message", id, handle: conversation === mine ? H1 : H3, language: "en", text });
  };
  await say(mine, "a", "my words"); await say(theirs, "b", "their words");
  assert.ok(state.chat![mine] && state.outbox.some((m) => m.to === mine));
  const result = await chatTurn({ state, ai: {}, now: T0 + 1, timeZone: "Asia/Kolkata", kind: "bookings", setLanguage: () => undefined, run: async () => { throw new Error("a forget runs no step of the template"); } }, { kind: "chat_message", id: "f", handle: H1, language: "en", forget: true });
  assert.equal(result, "done");
  assert.equal(state.chat![mine], undefined);
  assert.ok(!state.outbox.some((m) => m.to === mine));
  assert.ok(state.chat![theirs] && state.outbox.some((m) => m.to === theirs), "another guest's thread is untouched");
  forgetChat(state, theirs);
  assert.equal(state.chat, undefined, "the last guest gone: the whole part is left out again");
});

// ---- the runtime's door: the identity route and the translations -------------------------------------------------------------------------------------

function door(o: { work?: number } = {}) {
  const s = store();
  const submitted: { kind: string; [k: string]: unknown }[] = [];
  const forgotten: string[] = [];
  const known = new Set([H1, H2, H3]);
  const PARENT_LINK = "c".repeat(64);
  const routes = createChatIdentity({
    identity: s.identity, shopName: "Glow Salon", clock: fakeClock(T0),
    pages: () => ({ schema: 1, base: "https://glow.example/s/glow", ownerBase: "https://glow.example/s/glow/owner", slug: "glow", url: "https://pages.example/glow" }) as never,
    runtime: {
      channel: { chatState: (h: string) => ({ known: known.has(h), answered: true }), chatWork: () => o.work ?? 0, parent: (link: string) => (link === PARENT_LINK ? { ref: "p-0123456789ab" } : null) } as never,
      submit: (events) => { submitted.push(...(events as never[])); return { saved: events.length, duplicates: 0 }; }, kick: () => undefined,
    },
    push: { forget: (who: string) => { forgotten.push(who); return 1; } } as never,
  });
  return { s, routes, submitted, forgotten, PARENT_LINK };
}

test("the page is offered 'keep this chat' only after a booking or an order, and not once a key keeps it", async () => {
  const d = door({ work: 0 });
  try {
    assert.equal((await d.routes.call({ op: "state", handle: H1 })).body.offer, false, "a chat with no booking or order has nothing to keep");
    const d2 = door({ work: 1 });
    try {
      assert.equal((await d2.routes.call({ op: "state", handle: H1 })).body.offer, true);
      const opts = await d2.routes.call({ op: "keep_options", handle: H1, via: "direct" });
      const { options } = opts.body as { options: { challenge: string; user: { id: string } } };
      const p = newSoftPasskey("glow.example");
      assert.equal((await d2.routes.call({ op: "keep", handle: H1, via: "direct", response: softRegister(p, options, "https://glow.example") })).body.ok, true);
      assert.equal((await d2.routes.call({ op: "state", handle: H1 })).body.offer, false);
    } finally { d2.s.done(); }
    assert.equal((await d.routes.call({ op: "state", handle: "bad" })).status, 400);
  } finally { d.s.done(); }
});

test("a phone brought back by the link has no key of its own: it is offered one, and keeping it works", async () => {
  const d = door({ work: 1 });
  try {
    const first = (await d.routes.call({ op: "keep_options", handle: H1, via: "direct" })).body.options as { challenge: string; user: { id: string } };
    assert.equal((await d.routes.call({ op: "keep", handle: H1, via: "direct", response: softRegister(newSoftPasskey("glow.example"), first, "https://glow.example") })).body.ok, true);
    assert.equal((await d.routes.call({ op: "state", handle: H1 })).body.offer, false, "the phone that kept it is not offered again");
    const link = d.s.identity.issueLink(H1, T0);
    assert.equal((await d.routes.call({ op: "use_link", handle: H2, token: link.token })).body.ok, true);
    const state = (await d.routes.call({ op: "state", handle: H2 })).body;
    assert.deepEqual([state.keys, state.here, state.offer, state.restored], [1, false, true, true], "the thread has a key (the lost phone's), this phone has none of its own");
    const second = (await d.routes.call({ op: "keep_options", handle: H2, via: "direct" })).body.options as { challenge: string; user: { id: string } };
    assert.equal(second.user.id, first.user.id, "the same thread, the same user id");
    assert.equal((await d.routes.call({ op: "keep", handle: H2, via: "direct", response: softRegister(newSoftPasskey("glow.example"), second, "https://glow.example") })).body.ok, true);
    const after = (await d.routes.call({ op: "state", handle: H2 })).body;
    assert.deepEqual([after.keys, after.here, after.offer], [2, true, false]);
  } finally { d.s.done(); }
});

test("the RP ID and origin come from the shop's own pages file (the door's address or the server's), never from what the front sends", async () => {
  const d = door({ work: 1 });
  try {
    const viaDoor = (await d.routes.call({ op: "keep_options", handle: H1, via: "door", rpId: "evil.example", origin: "https://evil.example" })).body.options as { rp: { id: string } };
    assert.equal(viaDoor.rp.id, "pages.example");
    const direct = (await d.routes.call({ op: "keep_options", handle: H1, via: "direct" })).body.options as { rp: { id: string } };
    assert.equal(direct.rp.id, "glow.example");
    assert.equal((await d.routes.call({ op: "keep_options", handle: "9".repeat(64), via: "direct" })).status, 404, "a guest the runtime has never seen has no chat to keep");
  } finally { d.s.done(); }
});

test("'I have a new phone' answers the same for a number the shop knows and one it does not, counts every ask, and sends the step only the digits", async () => {
  const d = door();
  try {
    d.s.identity.setNumber(H1, NUMBER, T0);
    const known = await d.routes.call({ op: "recover", handle: H2, language: "ml", digits: NUMBER });
    const unknown = await d.routes.call({ op: "recover", handle: H2, language: "ml", digits: "919800000001" });
    assert.deepEqual([known.status, known.body], [unknown.status, unknown.body]);
    assert.equal(d.submitted.length, 2);
    assert.deepEqual(d.submitted[0], { kind: "chat_link", id: d.submitted[0]!.id, what: "recover", language: "ml", phone: NUMBER });
    assert.equal((await d.routes.call({ op: "recover", handle: H2, digits: NUMBER })).status, 200);
    assert.equal((await d.routes.call({ op: "recover", handle: H2, digits: NUMBER })).status, 429, "a number is asked for twice an hour");
    assert.equal((await d.routes.call({ op: "recover", handle: H2, digits: "12" })).status, 400);
  } finally { d.s.done(); }
});

test("'send me my booking link' needs a number this thread gave, and is asked of the thread", async () => {
  const d = door();
  try {
    assert.deepEqual((await d.routes.call({ op: "links", handle: H1 })).body, { ok: false, reason: "no_number" });
    assert.equal((await d.routes.call({ op: "number", handle: H1, digits: NUMBER })).body.ok, true);
    assert.equal((await d.routes.call({ op: "links", handle: H1, language: "hi" })).body.ok, true);
    assert.deepEqual(d.submitted.at(-1), { kind: "chat_link", id: d.submitted.at(-1)!.id, what: "links", language: "hi", handle: H1 });
  } finally { d.s.done(); }
});

test("the link's page and button: looking uses nothing up, pressing does, a wrong one is counted for the shop", async () => {
  const d = door();
  try {
    const link = d.s.identity.issueLink(H1, T0);
    assert.equal((await d.routes.call({ op: "link_state", handle: H2, token: link.token })).body.state, "valid");
    assert.equal((await d.routes.call({ op: "link_state", handle: H2, token: link.token })).body.state, "valid");
    assert.equal((await d.routes.call({ op: "use_link", handle: H2, token: link.token })).body.ok, true);
    assert.equal(d.routes.openRead(H2), H1, "the new phone reads the old thread");
    assert.deepEqual((await d.routes.call({ op: "use_link", handle: H3, token: link.token })).body, { ok: false, state: "used" });
    for (let i = 0; i < WRONG_LINK_LIMIT; i++) await d.routes.call({ op: "link_state", handle: H3, token: "z".repeat(43) });
    assert.equal((await d.routes.call({ op: "link_state", handle: H3, token: "z".repeat(43) })).status, 429, "the shop stops looking after its day's wrong guesses");
  } finally { d.s.done(); }
});

test("delete my chat from a tied phone: the thread's keys go, its alerts end, and a forget event for the THREAD is saved for the step", async () => {
  const d = door();
  try {
    d.s.identity.tie(H2, H1, T0);
    const r = await d.routes.call({ op: "forget", handle: H2, language: "en" });
    assert.equal(r.body.ok, true);
    assert.deepEqual(d.forgotten, [chatConversationOf(H1)]);
    assert.deepEqual(d.submitted.at(-1), { kind: "chat_message", id: d.submitted.at(-1)!.id, handle: H1, language: "en", forget: true });
    assert.equal(d.routes.openRead(H2), H2);
  } finally { d.s.done(); }
});

test("a parent's chat: the link opens the parent's own thread (made from the parent, not the link), and a link that opens nothing now is refused", () => {
  const d = door();
  try {
    const e = { handle: d.PARENT_LINK, parent: d.PARENT_LINK } as { handle: string; parent?: string };
    assert.equal(d.routes.openEvent(e), true);
    assert.equal(e.handle, parentChatHash("p-0123456789ab"));
    assert.equal(e.parent, undefined, "the link's hash is not kept");
    assert.notEqual(e.handle, d.PARENT_LINK);
    assert.equal(d.routes.openEvent({ handle: H1, parent: "d".repeat(64) }), false);
    assert.equal(d.routes.openRead(d.PARENT_LINK, d.PARENT_LINK), parentChatHash("p-0123456789ab"));
    assert.equal(d.routes.openRead(H1, "d".repeat(64)), undefined);
    assert.notEqual(parentChatHash("p-0123456789ab"), parentChatHash("p-ba9876543210"), "two parents, two threads");
    // an ordinary guest hash is resolved to its tie
    d.s.identity.tie(H2, H1, T0);
    const g = { handle: H2 }; assert.equal(d.routes.openEvent(g), true); assert.equal(g.handle, H1);
  } finally { d.s.done(); }
});

// ---- the link step: through the shop's WhatsApp, as a template --------------------------------------------------------------------------------------

function linkWorld(o: { stop?: boolean } = {}) {
  const s = store();
  const clock = fakeClock(T0);
  const fake = createFakeMessaging(clock);
  for (const t of CHAT_LINK_TEMPLATES) for (const l of LANGUAGES) fake.approve(t.name, l);
  const lines: Record<string, unknown>[] = [];
  const record = { append: (e: Record<string, unknown>) => { lines.push(e); return e as never; } } as never;
  const links = createChatLinks({ identity: s.identity, pages: () => ({ schema: 1, base: "https://glow.example/s/glow", ownerBase: "https://glow.example/s/glow/owner", url: "https://pages.example/glow" }) as never, shopName: "Glow Salon", clock });
  const channel: ChannelState = emptyChannelState();
  const store0 = { customers: new Map(o.stop ? [[NUMBER, { optedOut: true }]] : []), channel };
  return { s, fake, lines, record, links, channel, store0 };
}

test("'I have a new phone': the number's thread gets a one-use link by the template, the record names the link's short id and holds no token and no number", async () => {
  const w = linkWorld();
  try {
    w.s.identity.setNumber(H1, NUMBER, T0);
    await w.links.run({ kind: "chat_link", id: "e1", what: "recover", language: "en", phone: NUMBER }, { messaging: w.fake, record: w.record, store: w.store0 });
    const sent = w.fake.outbox();
    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.to, `+${NUMBER}`);
    assert.equal(sent[0]!.templateName, "chat_new_phone");
    const token = /\/chat\/id\/back\/([A-Za-z0-9_-]{43})/u.exec(sent[0]!.text)?.[1];
    assert.ok(token, "the text carries the link");
    assert.ok(sent[0]!.text.startsWith("Your link to open your chat with Glow Salon on a new phone: https://pages.example/glow/chat/id/back/"));
    assert.equal(w.s.identity.linkState(token!, T0 + 1), "valid");
    assert.equal(w.lines.length, 1);
    assert.equal(w.lines[0]!.conversation, chatConversationOf(H1));
    assert.equal(w.lines[0]!.action, "chat_link");
    const written = JSON.stringify(w.lines);
    assert.ok(!written.includes(token!) && !written.includes(NUMBER), "no token and no number in the record");
  } finally { w.s.done(); }
});

test("a number nobody gave, a number that said STOP, and a shop with no WhatsApp: nothing is sent", async () => {
  const w = linkWorld({ stop: true });
  try {
    w.s.identity.setNumber(H1, NUMBER, T0);
    await w.links.run({ kind: "chat_link", id: "e1", what: "recover", language: "en", phone: "919800000001" }, { messaging: w.fake, record: w.record, store: w.store0 });
    await w.links.run({ kind: "chat_link", id: "e2", what: "recover", language: "en", phone: NUMBER }, { messaging: w.fake, record: w.record, store: w.store0 });
    assert.equal(w.fake.outbox().length, 0);
    const none = createChatLinks({ identity: w.s.identity, pages: () => undefined, shopName: "Glow", clock: fakeClock(T0) });
    await none.run({ kind: "chat_link", id: "e3", what: "recover", language: "en", phone: NUMBER }, { messaging: w.fake, record: w.record, store: { customers: new Map() } });
    assert.equal(w.fake.outbox().length, 0);
  } finally { w.s.done(); }
});

test("'send me my booking link': only the shop's own page links already in the thread go, again, to the number this thread gave", async () => {
  const w = linkWorld();
  try {
    w.s.identity.setNumber(H1, NUMBER, T0);
    const to = chatConversationOf(H1);
    w.channel.outbox.push({ id: "ch-1", to, text: "You are booked. Your booking page: https://pages.example/glow/b/abc123.", atMs: T0 });
    w.channel.outbox.push({ id: "ch-2", to, text: "Pay here: https://rzp.io/i/xyz", atMs: T0 });
    w.channel.outbox.push({ id: "ch-3", to: chatConversationOf(H3), text: "Someone else's: https://pages.example/glow/b/other", atMs: T0 });
    await w.links.run({ kind: "chat_link", id: "e1", what: "links", language: "en", handle: H1 }, { messaging: w.fake, record: w.record, store: w.store0 });
    const sent = w.fake.outbox();
    assert.equal(sent.length, 1, "the shop's own page link of THIS thread, and nothing else");
    assert.equal(sent[0]!.templateName, "chat_my_link");
    assert.match(sent[0]!.text, /https:\/\/pages\.example\/glow\/b\/abc123/u);
    assert.ok(!/rzp\.io|other/u.test(sent[0]!.text));
    // no number given: nothing goes
    await w.links.run({ kind: "chat_link", id: "e2", what: "links", language: "en", handle: H3 }, { messaging: w.fake, record: w.record, store: w.store0 });
    assert.equal(w.fake.outbox().length, 1);
  } finally { w.s.done(); }
});

// ---- retention: a cleared thread takes its keys, number and ties with it (W2 fix b) ---------------------------------------------------------------------------

test("when the shop's retention clears a thread, the beat drops its keys, number, user id and ties; a thread the shop still has is untouched", () => {
  const w = linkWorld();
  try {
    const a = keep(w.s.identity, H1); const b = keep(w.s.identity, H3);
    w.s.identity.setNumber(H1, NUMBER, T0); w.s.identity.setNumber(H3, "919822222222", T0);
    w.s.identity.tie(H2, H1, T0);
    // the shop still has H3's thread, and H1's was cleared by compactChannel (no guest, no lines)
    w.channel.chat = { [chatConversationOf(H3)]: { startedMs: T0, lastMs: T0, said: [], day: "2026-11-17", turns: 0, messages: 0 } };
    w.links.tick({ store: w.store0 });
    assert.deepEqual(w.s.identity.state(H1), { keys: 0, here: false, number: false });
    assert.equal(w.s.identity.resolve(H2), H2, "the tied phone is untied");
    assert.equal(w.s.identity.guestOfNumber(NUMBER), undefined);
    assert.equal(w.s.identity.signin(H2, RP, softSignin(a.p, signinOptions(w.s.identity, T0 + 1), RP.origin), T0 + 2).ok, false, "the old key opens nothing");
    assert.deepEqual(w.s.identity.state(H3), { keys: 1, here: true, number: true });
    assert.equal(w.s.identity.signin(H2, RP, softSignin(b.p, signinOptions(w.s.identity, T0 + 3), RP.origin), T0 + 4).ok, true);
    // a beat with no state to read (no store) drops nothing
    w.links.tick();
    assert.equal(w.s.identity.state(H3).keys, 1);
  } finally { w.s.done(); }
});
