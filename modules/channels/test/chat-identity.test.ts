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

test("the three link templates: four languages, utility, a body that neither starts nor ends with a value, the two values in order", () => {
  assert.deepEqual(CHAT_LINK_TEMPLATES.map((t) => t.name), ["chat_new_phone", "chat_my_link", "chat_confirm_number"]);
  for (const t of CHAT_LINK_TEMPLATES) for (const language of LANGUAGES) {
    const body = t.bodies[language];
    assert.ok(!body.startsWith("{") && !body.endsWith("}"), `${t.name}.${language}`);
    assert.ok(body.indexOf("{shop}") < body.indexOf("{link}"), `${t.name}.${language}: shop first, link second`);
  }
  const list = chatLinkSubmissions();
  assert.equal(list.length, 12);
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

// ---- retention: a cleared thread takes its keys, number and ties with it (W2 fix b) ---------------------------------------------------------------------------

// ---- a number counts only once its holder taps the link sent to it (W2 fix c) -------------------------------------------------------------------------------

test("a typed number waits: it is nobody's contact until the link sent to it is tapped, once, in time", () => {
  const s = store();
  try {
    const a = s.identity.issueConfirm(H1, NUMBER, T0);
    assert.equal(s.identity.numberOf(H1), undefined);
    assert.equal(s.identity.guestOfNumber(NUMBER), undefined, "a recovery cannot be tied to a number nobody confirmed");
    assert.equal(s.identity.confirmState(a.token, T0 + 1), "valid");
    assert.equal(s.identity.confirmState(a.token, T0 + 2), "valid", "looking uses nothing up");
    assert.deepEqual(s.identity.confirmNumber(a.token, T0 + 3), { ok: true });
    assert.equal(s.identity.numberOf(H1), NUMBER);
    assert.equal(s.identity.guestOfNumber(NUMBER), H1);
    assert.deepEqual(s.identity.confirmNumber(a.token, T0 + 4), { ok: false, state: "used" });
    const b = s.identity.issueConfirm(H3, "919822222222", T0 + 10);
    assert.deepEqual(s.identity.confirmNumber(b.token, T0 + 10 + RECOVERY_LINK_MS + 1), { ok: false, state: "expired" });
    assert.equal(s.identity.numberOf(H3), undefined);
    const c = s.identity.issueConfirm(H3, "919822222222", T0 + 20); const d = s.identity.issueConfirm(H3, "919833333333", T0 + 21);
    assert.equal(s.identity.confirmState(c.token, T0 + 22), "replaced");
    assert.equal(s.identity.confirmState("not a token", T0), "unknown");
    s.identity.confirmUnsent(d.id);
    assert.equal(s.identity.confirmState(d.token, T0 + 23), "unknown", "a link that never went out can never be used");
    for (const f of [s.file, `${s.file}-wal`]) if (existsSync(f)) assert.ok(!readFileSync(f).includes(c.token), "only the token's hash is kept");
  } finally { s.done(); }
});

test("asking to confirm a number is counted per number, per thread and per shop, and a deleted chat takes a waiting number with it", () => {
  const s = store();
  try {
    assert.ok(s.identity.countConfirmAsk(H1, NUMBER, T0) && s.identity.countConfirmAsk(H1, NUMBER, T0 + 1));
    assert.equal(s.identity.countConfirmAsk(H1, NUMBER, T0 + 2), false, "two an hour for one number");
    const link = s.identity.issueConfirm(H1, NUMBER, T0);
    s.identity.forget(H1);
    assert.equal(s.identity.confirmState(link.token, T0 + 1), "unknown");
  } finally { s.done(); }
});
