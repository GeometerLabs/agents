// A local partner opens the panel on Geometer's partner server with their geometer.dev account (plan decision 53; fleet-signin.ts), and a forgotten passphrase
// gets a one-time reset link (both modes). Checked here: the ticket check against fleet's fixed vector (the monorepo's apps/fleet/test/fixtures/panel-ticket-
// vector.json, copied below: the same bytes, the same public key) and against every way a ticket can be wrong; the sign-in over HTTP (opening the link spends
// nothing, the button does, a ticket works once, one account per partner id, a partner sees only their own shops, the account has no passphrase); hosted mode
// only; an invited partner moved to geometer.dev keeps their shops; the reset link (once, runs out, signs every session out, refused for a geometer.dev account);
// sign-out everywhere; the login page's two lines; and that no ticket or reset token reaches the log. Written 14 Nov 2026.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createPrivateKey, randomBytes, sign } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { WORDS } from "../languages.ts";
import { ConfigError } from "../config.ts";
import { checkTicket, MAX_LIFE_S, readFleetIdentity } from "../fleet-signin.ts";
import { linkFleetPartner, listAccounts, makeResetLink, signOutAccount } from "../server.ts";
import { NOW, PASS, boot, tokenOf } from "./helpers.ts";
import type { Boot } from "./helpers.ts";

/** Fleet's fixed vector (apps/fleet/test/fixtures/panel-ticket-vector.json in the monorepo): RFC 8032's published TEST 1 key, for tests only. */
const VECTOR = {
  public_key_hex: "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
  payload: { v: 1, kind: "panel", aud: "partner-1", sub: "p-abcdefghjk", jti: "AAAAAAAAAAAAAAAAAAAAAA", iat: 1_793_700_000, exp: 1_793_700_300 },
  ticket: "gp1.21fe31dfa154a261.eyJhdWQiOiJwYXJ0bmVyLTEiLCJleHAiOjE3OTM3MDAzMDAsImlhdCI6MTc5MzcwMDAwMCwianRpIjoiQUFBQUFBQUFBQUFBQUFBQUFBQUFBQSIsImtpbmQiOiJwYW5lbCIsInN1YiI6InAtYWJjZGVmZ2hqayIsInYiOjF9.xujzqCBtvPxy4PdouMggfeHpN1yhgbBH9hwhB4SCISvFLQ5mApeO_3d8s_itqT40Qqt4V5Yv2pV57_FipxagAg",
};
const KEYS = [Buffer.from(VECTOR.public_key_hex, "hex")];
const KID = VECTOR.ticket.split(".")[1];
const SEED = Buffer.from("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60", "hex");
const PRIVATE = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), SEED]), format: "der", type: "pkcs8" });
const NOW_S = Math.floor(NOW / 1000);

/** A ticket as fleet signs one (apps/fleet/src/panel-ticket.ts), with any payload a test needs. */
function ticket(over: Record<string, unknown> = {}, key = PRIVATE, kid = KID): string {
  const payload = { v: 1, kind: "panel", aud: "partner-1", sub: "p-divyaaaaaa", jti: randomBytes(16).toString("base64url"), iat: NOW_S, exp: NOW_S + 300, ...over };
  const head = `gp1.${kid}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
  return `${head}.${sign(null, Buffer.from(head, "ascii"), key).toString("base64url")}`;
}

/** Geometer's partner server: hosted mode, with the licence key and the fleet id geometer.json pins. */
async function hosted(): Promise<Boot> {
  const b = await boot({}, { mode: "hosted" });
  writeFileSync(join(b.dir, "geometer.json"), JSON.stringify({ id: "partners-local", fleet: { url: "https://fleet.example", keyFile: "fleet_key", deploymentId: "partner-1" }, licence: { keys: [VECTOR.public_key_hex] } }));
  return b;
}

/** Open a ticket's link and press the button: the reply of the POST, and the browser (signed in on a 303). */
async function signIn(b: Boot, t: string, form: Record<string, string> = { name: "Divya", company: "", language: "en" }) {
  const browser = b.browser();
  const page = await browser.get(`/signin/${t}`);
  if (page.status !== 200) return { browser, page, done: page };
  const done = await browser.req("POST", "/signin", { _csrf: tokenOf(page.text), ticket: t, ...form });
  return { browser, page, done };
}

// ---- the ticket ---------------------------------------------------------------------------------------------------------------------------------------

test("fleet's fixed ticket is good here, and each way of getting it wrong is refused with its reason", () => {
  const at = (nowS: number, o: { audience?: string; keys?: Buffer[] } = {}) => checkTicket(VECTOR.ticket, { keys: o.keys ?? KEYS, audience: o.audience ?? "partner-1", nowS });
  assert.deepEqual(at(VECTOR.payload.iat + 10), { ok: true, ticket: { partner: "p-abcdefghjk", jti: VECTOR.payload.jti, exp: VECTOR.payload.exp } });
  assert.deepEqual(at(VECTOR.payload.iat + 10, { audience: "partner-2" }), { ok: false, problem: "audience" }, "a ticket for another server");
  assert.deepEqual(at(VECTOR.payload.exp + 61), { ok: false, problem: "expired" });
  assert.deepEqual(at(VECTOR.payload.exp + 59).ok, true, "a minute's leeway for the two clocks");
  assert.deepEqual(at(VECTOR.payload.iat - 61), { ok: false, problem: "early" });
  assert.deepEqual(at(VECTOR.payload.iat + 10, { keys: [Buffer.alloc(32, 7)] }), { ok: false, problem: "unknown-key" });
  const [p, kid, body, sig] = VECTOR.ticket.split(".");
  const flip = (s: string) => `${s.slice(0, 10)}${s[10] === "A" ? "B" : "A"}${s.slice(11)}`;
  const check = (t: string) => checkTicket(t, { keys: KEYS, audience: "partner-1", nowS: VECTOR.payload.iat + 10 });
  assert.equal((check([p, kid, flip(body), sig].join(".")) as { problem: string }).problem, "signature", "a changed payload");
  assert.equal((check([p, kid, body, flip(sig)].join(".")) as { problem: string }).problem, "signature");
  assert.equal((check(["gl1", kid, body, sig].join(".")) as { problem: string }).problem, "shape", "a lease's prefix: the signature covers the prefix, and the shape refuses it first");
  assert.equal((check(VECTOR.ticket.replace("gp1.", "gp1..")) as { problem: string }).problem, "shape");
  assert.equal((check("") as { problem: string }).problem, "shape");
  // a good signature over a payload that is wrong in itself
  const now = (over: Record<string, unknown>) => checkTicket(ticket(over), { keys: KEYS, audience: "partner-1", nowS: NOW_S });
  assert.equal((now({ exp: NOW_S + MAX_LIFE_S + 1 }) as { problem: string }).problem, "too-long", "no ticket fleet makes lives that long");
  assert.equal((now({ kind: "lease" }) as { problem: string }).problem, "payload");
  assert.equal((now({ sub: "Not An Id" }) as { problem: string }).problem, "payload");
  assert.equal((now({ jti: "short" }) as { problem: string }).problem, "payload");
  assert.equal((now({ v: 2 }) as { problem: string }).problem, "payload");
});

test("the server's identity comes from geometer.json: fleet's id for it, else its own; no pinned key means no geometer.dev sign-in", async () => {
  const b = await hosted();
  try {
    assert.deepEqual(readFleetIdentity(b.dir), { keys: KEYS, audience: "partner-1" });
    writeFileSync(join(b.dir, "geometer.json"), JSON.stringify({ id: "partner-1", licence: { keys: [VECTOR.public_key_hex] } }));
    assert.equal(readFleetIdentity(b.dir)?.audience, "partner-1");
    writeFileSync(join(b.dir, "geometer.json"), JSON.stringify({ id: "partner-1" }));
    assert.equal(readFleetIdentity(b.dir), undefined);
    const { done } = await signIn(b, ticket());
    assert.deepEqual([done.status, done.plain.includes(WORDS.en.signin.problems.bad)], [400, true]);
  } finally { await b.close(); }
});

// ---- signing in -------------------------------------------------------------------------------------------------------------------------------------

test("a partner's ticket: opening it spends nothing, the button signs them in to the account kept for their partner id, and a ticket works once", async () => {
  const b = await hosted();
  try {
    const t = ticket();
    const anon = b.browser();
    const first = await anon.get(`/signin/${t}`);
    assert.equal(first.status, 200);
    assert.ok(first.plain.includes(WORDS.en.signin.intro) && first.text.includes('name="name"'), "the first visit asks the name");
    assert.equal((await anon.get(`/signin/${t}`)).status, 200, "a link preview opening it twice spends nothing");
    const { browser, done } = await signIn(b, t, { name: "Divya", company: "Sri Sai Digital", language: "hi" });
    assert.deepEqual([done.status, done.location], [303, "/shops"]);
    const accounts = listAccounts(b.config);
    assert.deepEqual(accounts.map((a) => [a.handle, a.name, a.role, a.signsIn, a.fleetPartner]), [["p-divyaaaaaa", "Divya", "partner", "geometer.dev", "p-divyaaaaaa"]]);
    assert.equal((await browser.get("/shops")).status, 200, "signed in");
    // the same ticket again: refused, whether by opening it or by posting it
    assert.equal((await b.browser().get(`/signin/${t}`)).status, 410);
    const again = await anon.req("POST", "/signin", { _csrf: tokenOf(first.text), ticket: t, name: "Divya", company: "", language: "en" });
    assert.deepEqual([again.status, again.plain.includes(WORDS.en.signin.problems.gone)], [410, true]);
    // a new ticket for the same partner: no form, the same account
    const back = await signIn(b, ticket());
    assert.ok(back.page.plain.includes(WORDS.en.signin.welcomeBack("Divya")) && !back.page.text.includes('name="name"'));
    assert.equal(back.done.status, 303);
    assert.equal(listAccounts(b.config).length, 1, "one account per partner id");
    // an expired ticket, and one for another server
    assert.equal((await b.browser().get(`/signin/${ticket({ iat: NOW_S - 400, exp: NOW_S - 100 })}`)).status, 410);
    assert.equal((await b.browser().get(`/signin/${ticket({ aud: "partner-2" })}`)).status, 400);
    // the log has the path with the ticket blanked out, and never the ticket
    assert.ok(b.logs.some((l) => l.includes("/signin/[ticket]")));
    assert.ok(!b.logs.some((l) => l.includes(t.split(".")[3])), "no ticket in the log");
  } finally { await b.close(); }
});

test("a partner who signed in with geometer.dev sees only the shops they set up; another partner's ticket is another account; neither has a passphrase", async () => {
  const b = await hosted();
  try {
    const divya = (await signIn(b, ticket({ sub: "p-divyaaaaaa" }), { name: "Divya", company: "", language: "en" })).browser;
    const meena = (await signIn(b, ticket({ sub: "p-meenaaaaaa" }), { name: "Meena", company: "", language: "en" })).browser;
    const ids = Object.fromEntries(listAccounts(b.config).map((a) => [a.fleetPartner, a.handle]));
    const { createAccounts } = await import("../accounts.ts");
    const { openStores } = await import("../server.ts");
    const acc = createAccounts(openStores(b.config).store);
    b.addShop("divya-shop", { ownerId: acc.byHandle(ids["p-divyaaaaaa"])!.id, ownerName: "Divya", name: "Divya Salon" });
    b.addShop("meena-shop", { ownerId: acc.byHandle(ids["p-meenaaaaaa"])!.id, ownerName: "Meena", name: "Meena Salon" });
    const mine = (await divya.get("/shops")).text;
    assert.ok(mine.includes("Divya Salon") && !mine.includes("Meena Salon"));
    assert.equal((await divya.get("/shops/meena-shop")).status, 404, "another partner's shop is like one that does not exist");
    assert.ok((await meena.get("/shops")).text.includes("Meena Salon"));
    // the sign-in form never opens a geometer.dev account, whatever is typed
    const login = b.browser();
    const form = await login.get("/login");
    for (const guess of ["geometer-signin", PASS, ""]) {
      const r = await login.req("POST", "/login", { _csrf: tokenOf(form.text), handle: ids["p-divyaaaaaa"], passphrase: guess });
      assert.equal(r.status, 401, guess);
    }
    // nor does a reset link: there is no passphrase to reset
    assert.throws(() => makeResetLink(b.config, ids["p-divyaaaaaa"]), (e: Error) => e instanceof ConfigError && /geometer\.dev/.test(e.message));
  } finally { await b.close(); }
});

test("a builder's own server takes no geometer.dev ticket at all: its invitations and passphrases are unchanged", async () => {
  const b = await boot();
  try {
    writeFileSync(join(b.dir, "geometer.json"), JSON.stringify({ id: "partner-1", licence: { keys: [VECTOR.public_key_hex] } }));
    assert.equal((await b.browser().get(`/signin/${ticket()}`)).status, 404);
    const login = (await b.browser().get("/login")).plain;
    assert.ok(!login.includes(WORDS.en.login.partners), "no geometer.dev line on a builder's server");
    assert.ok(login.includes(WORDS.en.login.forgot), "the ask-for-a-new-link line");
    assert.throws(() => linkFleetPartner(b.config, "anyone", "p-x"), /Geometer's partner server/);
  } finally { await b.close(); }
});

test("on Geometer's partner server the sign-in page sends partners to geometer.dev and says how to get a new passphrase link", async () => {
  const b = await hosted();
  try {
    const page = (await b.browser().get("/login")).plain;
    assert.ok(page.includes(WORDS.en.login.partners) && page.includes('href="https://geometer.dev/account/"'));
    assert.ok(page.includes(WORDS.en.login.forgotHosted) && page.includes("hello@geometer.dev"));
    const hindi = (await b.browser().get("/login", { "accept-language": "hi" })).plain;
    assert.ok(hindi.includes(WORDS.hi.login.partners) && hindi.includes(WORDS.hi.login.forgotHosted));
  } finally { await b.close(); }
});

test("an invited partner moved to geometer.dev keeps their shops; their passphrase and their open sessions end", async () => {
  const b = await hosted();
  try {
    const asha = await b.account("asha", "partner");
    const { createAccounts } = await import("../accounts.ts");
    const { openStores } = await import("../server.ts");
    const id = createAccounts(openStores(b.config).store).byHandle("asha")!.id;
    b.addShop("asha-shop", { ownerId: id, ownerName: "Asha", name: "Asha Tailoring" });
    assert.ok((await asha.get("/shops")).text.includes("Asha Tailoring"));
    const linked = linkFleetPartner(b.config, "asha", "p-ashaaaaaaa");
    assert.equal(linked.id, id, "the same account");
    assert.deepEqual([(await asha.get("/shops")).status, (await asha.get("/shops")).location], [303, "/login"], "the old session ended");
    const fresh = b.browser();
    const f2 = await fresh.get("/login");
    assert.equal((await fresh.req("POST", "/login", { _csrf: tokenOf(f2.text), handle: "asha", passphrase: PASS })).status, 401, "the passphrase no longer works");
    const back = await signIn(b, ticket({ sub: "p-ashaaaaaaa" }));
    assert.ok(back.page.plain.includes(WORDS.en.signin.welcomeBack("ASHA")), "greeted by the account's own name");
    assert.equal(back.done.status, 303);
    assert.ok((await back.browser.get("/shops")).text.includes("Asha Tailoring"), "their shop is still theirs");
    assert.throws(() => linkFleetPartner(b.config, "nobody", "p-x"), /no account/);
    await b.account("meena", "partner");
    assert.throws(() => linkFleetPartner(b.config, "meena", "p-ashaaaaaaa"), /already has the account/);
  } finally { await b.close(); }
});

// ---- the reset link, and signing out everywhere ------------------------------------------------------------------------------------------------------

test("a reset link chooses a new passphrase once, signs every session out, and runs out; an unknown name is said plainly", async () => {
  const b = await boot();
  try {
    const divya = await b.account("divya", "partner");
    assert.throws(() => makeResetLink(b.config, "nobody"), (e: Error) => e instanceof ConfigError && /no account "nobody"/.test(e.message));
    const { link, name } = makeResetLink({ ...b.config, port: b.panel.port }, "divya");
    assert.equal(name, "DIVYA");
    const path = new URL(link).pathname;
    const other = b.browser();
    const page = await other.get(path);
    assert.equal(page.status, 200);
    assert.ok(page.plain.includes(WORDS.en.reset.intro("DIVYA")));
    const token = path.slice("/reset/".length);
    const short = await other.req("POST", "/reset", { _csrf: tokenOf(page.text), token, passphrase: "short" });
    assert.deepEqual([short.status, short.plain.includes(WORDS.en.join.problems.short)], [400, true]);
    assert.equal((await other.get(path)).status, 200, "a refused passphrase does not spend the link");
    const NEW = "a brand new long passphrase";
    const done = await other.req("POST", "/reset", { _csrf: tokenOf(page.text), token, passphrase: NEW });
    assert.deepEqual([done.status, done.location], [303, "/shops"]);
    assert.equal((await other.get("/shops")).status, 200, "signed in with the new passphrase");
    assert.equal((await divya.get("/shops")).status, 303, "every older session is signed out");
    assert.equal((await b.browser().get(path)).status, 410, "the link works once");
    const login = b.browser();
    const f = await login.get("/login");
    assert.equal((await login.req("POST", "/login", { _csrf: tokenOf(f.text), handle: "divya", passphrase: PASS })).status, 401, "the old passphrase is gone");
    assert.equal((await login.req("POST", "/login", { _csrf: tokenOf(f.text), handle: "divya", passphrase: NEW })).status, 303);
    assert.ok(!b.logs.some((l) => l.includes(token)), "no reset token in the log");
    assert.equal((await b.browser().get("/reset/not-a-link-we-made-at-all")).status, 404);
    // a link runs out
    const late = new URL(makeResetLink(b.config, "divya", 1).link).pathname.slice("/reset/".length);
    const { createAccounts } = await import("../accounts.ts");
    const { openStores } = await import("../server.ts");
    assert.equal(createAccounts(openStores(b.config).store, () => NOW + 30 * 60_000).resetStatus(late), "ok");
    assert.equal(createAccounts(openStores(b.config).store, () => NOW + 2 * 3_600_000).resetStatus(late), "expired");
  } finally { await b.close(); }
});

test("signing an account out everywhere ends its sessions at once", async () => {
  const b = await boot();
  try {
    const divya = await b.account("divya", "partner");
    assert.equal((await divya.get("/shops")).status, 200);
    signOutAccount(b.config, "divya");
    assert.equal((await divya.get("/shops")).status, 303);
    assert.throws(() => signOutAccount(b.config, "nobody"), /no account/);
  } finally { await b.close(); }
});
