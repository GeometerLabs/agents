// The owner's sign-in on the shop's page, the runtime's side (plan item 11f): the access store (a link works once, for 10 minutes, a newer one replaces it, the
// shop's limits, at most five sessions, a new owner number or address or the panel's "sign out every device" ends a session), the core's runner (the link goes
// only to the owner's number in the settings, only inside the owner's WhatsApp window, never into the record; "open my app" only from the owner), and the
// runtime's HTTP routes (a link used up once, a session accepted where the panel's link was, the relay's question). Written 12 Nov 2026.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeClock } from "../../core/clock.ts";
import { createFakeMessaging } from "../../messaging/messaging.ts";
import { createRecord } from "../../record/record.ts";
import { checkChannelEvent } from "../events.ts";
import { ACCESS_TOKEN, LINK_LIMITS, MAX_SESSIONS, OWNER_SESSION_HEADER, OWNER_SIGNIN_HEADER, SESSION_MS, SIGNIN_LINK_MS, openOwnerAccess, ownerSessionChecker, readEndBefore } from "../owner-access.ts";
import { OPEN_MY_APP, createOwnerSignin, phraseOf } from "../owner-signin.ts";
import type { PagesFile } from "../pages-file.ts";
import { startServer } from "../../runtime/http.ts";
import type { IncomingEvent } from "../../runtime/events.ts";

const T0 = Date.parse("2026-11-12T05:00:00Z");
const OWNER = "+919800000001";
const BASE = "https://pages.example/veena-salon";
const who = { owner: OWNER, base: `${BASE}/owner` };

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "owner-access-"));
  const access = openOwnerAccess(join(dir, "owner-access.sqlite"));
  return { dir, access, done: () => { access.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test("a link works once, for 10 minutes; a newer link replaces it; another owner or address cannot use it", () => {
  const { access, done } = setup();
  try {
    const first = access.issue({ ...who, via: "page", now: T0 });
    assert.match(first.token, ACCESS_TOKEN);
    assert.equal(access.linkState(first.token, who, T0), "valid");
    assert.equal(access.linkState(first.token, { ...who, owner: "+919800000002" }, T0), "unknown", "made for another owner number");
    assert.equal(access.linkState(first.token, { ...who, base: "https://pages.example/other/owner" }, T0), "unknown", "made for another address");
    const second = access.issue({ ...who, via: "whatsapp", now: T0 + 1000 });
    assert.equal(access.linkState(first.token, who, T0 + 2000), "replaced");
    assert.deepEqual(access.consume(first.token, who, T0 + 2000), { ok: false, state: "replaced" });
    assert.equal(access.linkState(second.token, who, T0 + 1000 + SIGNIN_LINK_MS), "expired", "10 minutes and not a moment more");
    const third = access.issue({ ...who, via: "page", now: T0 + 3000 });
    const s = access.consume(third.token, who, T0 + 4000);
    assert.ok(s.ok);
    assert.match(s.session, ACCESS_TOKEN);
    assert.deepEqual(access.consume(third.token, who, T0 + 5000), { ok: false, state: "used" }, "single use");
    assert.equal(access.linkState("not-a-token", who, T0), "unknown");
  } finally { done(); }
});

test("a session is good for its owner and address, ends with sign-out, the panel's sign-out of every device, a new owner number, a new slug, or 30 days", () => {
  const { access, done } = setup();
  try {
    const open = (at: number) => { const l = access.issue({ ...who, via: "page", now: at }); const s = access.consume(l.token, who, at); assert.ok(s.ok); return s.session; };
    const a = open(T0);
    assert.ok(access.check(a, who, T0));
    assert.equal(access.check(a, { ...who, owner: "+919800000009" }, T0), undefined, "the settings name another owner now");
    assert.equal(access.check(a, { ...who, base: "https://pages.example/new-name/owner" }, T0), undefined, "the shop's page moved to another slug");
    assert.equal(access.check(a, who, T0 + SESSION_MS), undefined, "30 days");
    assert.equal(access.check(a, who, T0 + 1, T0 + 1), undefined, "made before the panel's sign-out of every device");
    const b = open(T0 + 10);
    assert.ok(access.end(b, T0 + 11));
    assert.equal(access.check(b, who, T0 + 12), undefined, "signed out");
    assert.equal(access.end(b, T0 + 13), undefined, "ending twice does nothing");
    // at most five at once: the oldest ends
    const many = Array.from({ length: MAX_SESSIONS + 1 }, (_, i) => open(T0 + 100 + i));
    assert.equal(access.check(many[0], who, T0 + 200), undefined);
    assert.ok(access.check(many[MAX_SESSIONS], who, T0 + 200));
    assert.equal(access.endAllBefore(T0 + 150, T0 + 200), MAX_SESSIONS, "the panel's moment, seen once");
    assert.equal(access.endAllBefore(T0 + 150, T0 + 300), undefined, "and not said again");
  } finally { done(); }
});

test("the shop's limits count every request: three a quarter of an hour, ten a day", () => {
  const { access, done } = setup();
  try {
    let t = T0;
    for (let i = 0; i < LINK_LIMITS[0].max; i++) assert.ok(access.tryAttempt(t++));
    assert.equal(access.tryAttempt(t), false);
    t = T0 + LINK_LIMITS[0].perMs;
    let allowed = 0;
    for (let i = 0; i < 30; i++, t += LINK_LIMITS[0].perMs / 3) if (access.tryAttempt(t)) allowed++;
    assert.equal(allowed + LINK_LIMITS[0].max, LINK_LIMITS[1].max, "ten in a day, however they are spread");
  } finally { done(); }
});

test("the page's request carries no number: the event keeps only its kind and id, whatever was posted", () => {
  const checked = checkChannelEvent({ kind: "owner_signin", id: "s-1", phone: "+919811111111", to: "+919811111111", base: "https://evil.example" });
  assert.ok(checked.ok);
  assert.deepEqual(checked.event, { kind: "owner_signin", id: "s-1" });
});

function runner(o: { pages?: PagesFile | undefined } = {}) {
  const { access, dir, done } = setup();
  const clock = fakeClock(T0);
  const messaging = createFakeMessaging(clock);
  const pages: PagesFile | undefined = "pages" in o ? o.pages : { schema: 1, base: "https://partners.example/s/veena", ownerBase: `${BASE}/owner`, slug: "veena-salon", url: BASE };
  let endBefore: number | undefined;
  const signin = createOwnerSignin({ access, pages: () => pages, endBefore: () => endBefore, owner: { whatsapp: OWNER, language: "en" }, shopName: "Veena Salon", clock });
  const record = createRecord(clock);
  return { access, dir, done, clock, messaging, signin, record, setEndBefore: (v: number) => { endBefore = v; } };
}

test("a link goes to the owner's number in the settings, inside the owner's window, and never into the record", async () => {
  const r = runner();
  try {
    // the window is closed: nothing can go as free text, and the record says so without a link
    await r.signin.run({ kind: "owner_signin", id: "p-1" }, r);
    assert.equal(r.messaging.outbox().length, 0);
    assert.equal(r.record.entries().at(-1)?.outcome, "blocked");
    // the owner writes to the shop (the window opens), then taps "send me a link" on the page
    r.messaging.receive(OWNER, "hi");
    await r.signin.run({ kind: "owner_signin", id: "p-2" }, r);
    const sent = r.messaging.outbox();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, OWNER, "only to the owner's number on file");
    const link = /https:\/\/\S+\/owner\/in\/([A-Za-z0-9_-]{43})/u.exec(sent[0].text);
    assert.ok(link, sent[0].text);
    assert.ok(sent[0].text.startsWith("Your sign-in link for Veena Salon"));
    assert.equal(r.access.linkState(link[1], who, T0), "valid");
    const line = r.record.entries().at(-1)!;
    assert.equal(line.action, "owner_signin");
    assert.equal(line.outcome, "confirmed");
    assert.ok(!JSON.stringify(r.record.entries()).includes(link[1]), "the token is never in the record");
  } finally { r.done(); }
});

test("\"open my app\" is the owner's fixed phrase in four languages, read before the agent; from anyone else it is an ordinary message", async () => {
  const r = runner();
  try {
    assert.equal(phraseOf("  Open   my App!  "), "open my app");
    const m = r.messaging.receive(OWNER, "Open my app.");
    assert.ok(r.signin.takes({ kind: "message", message: m }));
    for (const words of ["मेरा ऐप खोलो", "എന്റെ ആപ്പ് തുറക്കൂ", "ನನ್ನ ಆಪ್ ತೆರೆಯಿರಿ"]) assert.ok(OPEN_MY_APP.includes(phraseOf(words)), words);
    assert.equal(r.signin.takes({ kind: "message", message: r.messaging.receive("+919811111111", "open my app") }), false, "a customer's words go to the agent");
    assert.equal(r.signin.takes({ kind: "message", message: r.messaging.receive(OWNER, "open my app please") }), false, "only the phrase itself");
    await r.signin.run({ kind: "message", message: m }, r);
    assert.equal(r.messaging.outbox().length, 1, "the owner's own message opened the window: the link goes back as a reply");
    assert.equal(r.record.entries().at(-1)?.refs.via, "whatsapp");
  } finally { r.done(); }
  const none = runner({ pages: undefined });
  try { assert.equal(none.signin.takes({ kind: "message", message: none.messaging.receive(OWNER, "open my app") }), false, "no pages file yet: the agent answers as before"); } finally { none.done(); }
});

test("sign-ins are in the record; the panel's sign-out of every device is said once", async () => {
  const r = runner();
  try {
    await r.signin.run({ kind: "owner_access", id: "a-1", what: "signed_in", session: "abc123" }, r);
    assert.deepEqual([r.record.entries().at(-1)?.action, r.record.entries().at(-1)?.refs.what], ["owner_session", "signed_in"]);
    r.setEndBefore(T0);
    r.signin.tick(r);
    r.signin.tick(r);
    assert.equal(r.record.entries().filter((e) => e.refs.what === "all_ended").length, 1);
  } finally { r.done(); }
});

test("the runtime's routes: a link is used up once over HTTP, the session then opens the owner's reads, and the relay's question needs the internal token", async () => {
  const r = runner();
  const submitted: IncomingEvent[] = [];
  const runtime = {
    submit: (events: IncomingEvent[]) => { submitted.push(...events); return { saved: events.length, duplicates: 0 }; }, kick: () => undefined,
    status: () => ({}), refundContext: () => null, ready: () => ({ ok: true as const }),
    channel: { offer: async () => ({}), view: () => null, owner: () => ({ shop: { name: "Veena Salon" }, items: [] }) },
  };
  const server = await startServer(runtime as never, { token: "i".repeat(40), channelToken: "c".repeat(40), port: 0, ownerSignin: r.signin.http });
  const call = (path: string, init: { method?: string; headers?: Record<string, string> } = {}, token = "c".repeat(40)) => fetch(`${server.url}${path}`, { method: init.method ?? "GET", headers: { authorization: `Bearer ${token}`, ...init.headers } });
  try {
    r.messaging.receive(OWNER, "open my app");
    await r.signin.run({ kind: "owner_signin", id: "p-1" }, r);
    const token = /\/owner\/in\/([A-Za-z0-9_-]{43})/u.exec(r.messaging.outbox()[0].text)![1];
    assert.deepEqual(await (await call("/internal/channel/owner-signin", { headers: { [OWNER_SIGNIN_HEADER]: token } })).json(), { state: "valid" }, "looking does not use it up");
    const got = await call("/internal/channel/owner-signin", { method: "POST", headers: { [OWNER_SIGNIN_HEADER]: token } });
    assert.equal(got.status, 200);
    const { session } = await got.json() as { session: string };
    assert.equal((await call("/internal/channel/owner-signin", { method: "POST", headers: { [OWNER_SIGNIN_HEADER]: token } })).status, 403, "the second press gets nothing");
    assert.deepEqual(submitted.map((e) => [e.kind, (e as { what?: string }).what]), [["owner_access", "signed_in"]], "the sign-in goes to the record");
    assert.equal((await call("/internal/channel/owner", { headers: { [OWNER_SESSION_HEADER]: session } })).status, 200, "the session opens what the panel's link opens");
    assert.equal((await call("/internal/channel/owner", { headers: { [OWNER_SESSION_HEADER]: "x".repeat(43) } })).status, 403);
    // the relay asks with the INBOX's internal token, never the channel token
    const checker = ownerSessionChecker({ url: server.url, token: "i".repeat(40) });
    assert.equal(await checker(session), true);
    assert.equal(await ownerSessionChecker({ url: server.url, token: "c".repeat(40) })(session), false);
    assert.equal((await call("/internal/channel/owner-signout", { method: "POST", headers: { [OWNER_SESSION_HEADER]: session } })).status, 200);
    assert.equal(await checker(session), false, "signed out everywhere at once");
  } finally { await server.close(); r.done(); }
});

test("the panel's file is read as a moment, and anything unreadable never widens access", () => {
  const { dir, done } = setup();
  try {
    const f = join(dir, "owner-sessions.json");
    assert.equal(readEndBefore(f), undefined);
    writeFileSync(f, JSON.stringify({ schema: 1, endBefore: "2026-11-12T05:00:00.000Z" }));
    assert.equal(readEndBefore(f), T0);
    writeFileSync(f, "{not json");
    assert.equal(readEndBefore(f), undefined);
  } finally { done(); }
});
