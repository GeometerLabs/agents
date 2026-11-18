// The CONTRACT of "who controls the owner's sign-in" (owner control, 19 Nov 2026; bundle/Explanation.md "Who controls the owner's sign-in" and its review rounds), as the
// outside sees it. Like the rest of this folder it starts the shop as a separate process (harness.ts) and drives it ONLY over HTTP and through the files the deployer
// writes: owner-grants.json (the Operator's QR, card, "remove the owner's passkeys" request), owner-reset.json (Geometer's reset, copied from admin/owner-reset/<shop>.json),
// owner-sessions.json (the panel's "sign out every device"), settings.json (the owner's number, read at start) and runtime.json (the tick). It reads back only what the shop
// answers, the record lines in agent.db and, for the restore, the deployer's own backup code (bundle/backup/owner-keep.ts). The 48-hour, one-day and 15-minute rules run on
// the TEST clock (modules/runtime/test-clock.ts, go/internal/testclock): the machine's clock plus an offset the test moves.
//
// Rule by rule (each test names its rule; the reviewer's proved attacks are marked ATTACK):
//   the lock and the phones list; the Operator's QR and card after the lock (ATTACK); forged future times clamped (ATTACK: a 2099 QR, sign-out, reset, passkeysBefore);
//   a passkeysBefore written into the file after the lock; the owner's own codes void the card; a new phone, codes and a removal are announced; removing a phone takes back
//   its codes and links (ATTACK) and the last one needs the second confirm; the Operator's request is timed from first sight, back-dating buys nothing, the owner cancels,
//   a day's quiet, then it applies after 48 hours and only a QR seen after that works; an owner-number change is a request (ATTACK), a cancel sticks for a day, it applies
//   after 48 hours with no restart and the sale binds the NEW owner; Geometer's reset and its window, in which only the reset's own QR works (ATTACK); a restart does not lose
//   a request's notice and extends a request once only (ATTACK); a restore keeps the lock; and (TypeScript only: the Go runtime serves no push) the alerts follow the phone.
//
// Not reachable here: a session made by a WhatsApp LINK (a listings-only shop has no WhatsApp, so no link is ever sent), so "a link session may not remove a phone or make
// codes" and "sign out every device ends link sessions" are left to modules/channels/test/owner-control*.test.ts.
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { rmSync } from "node:fs";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { join } from "node:path";
import { REMOVAL_WAIT_MS, SETUP_MS, newRecoveryCode, newSetupToken, recoveryHash, setupHash } from "../../../../modules/channels/owner-grants.ts";
import { newSoftPasskey, softRegister, softSignin } from "../../../../modules/channels/test/soft-authenticator.ts";
import type { SoftPasskey } from "../../../../modules/channels/test/soft-authenticator.ts";
import { putOwnerKeep, readOwnerKeep } from "../../../../bundle/backup/owner-keep.ts";
import { IMPL, OWNER_BASE, makeShop } from "./harness.ts";
import type { Shop, ShopOptions } from "./harness.ts";

const shops: Shop[] = [];
const servers: Server[] = [];
after(async () => {
  for (const s of shops) { await s.stop(); s.cleanup(); }
  for (const v of servers) await new Promise<void>((r) => { v.closeAllConnections(); v.close(() => r()); });
});

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
/** The owner's number when the shop was set up, and the number the Operator's settings form later names (a sale, or an Operator taking the shop). */
const A = "+919800000001";
const B = "+919822222222";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const rp = { rpId: new URL(OWNER_BASE).hostname, origin: new URL(OWNER_BASE).origin };
const iso = (t: number): string => new Date(t).toISOString();

/** A started shop on the test clock, owned by `owner` (A unless said otherwise). */
async function boot(o: ShopOptions = {}): Promise<Shop> {
  const s = await makeShop({ clock: true, owner: A, ...o }); shops.push(s); await s.start(); return s;
}

type Grant = { kind: "setup"; token: string } | { kind: "recovery"; code: string };
const qr = (token: string): Grant => ({ kind: "setup", token });
const code = (c: string): Grant => ({ kind: "recovery", code: c });
/** The Operator's file as the panel writes it, every time taken from the shop's clock: a QR (15 minutes), a card, a request. */
function grants(s: Shop, o: { token?: string; expiresAt?: string; codes?: string[]; pending?: { askedAt: number; by?: string }; passkeysBefore?: string } = {}): Record<string, unknown> {
  const now = s.now();
  return {
    schema: 1,
    ...(o.token ? { setup: { sha256: setupHash(o.token), createdAt: iso(now), expiresAt: o.expiresAt ?? iso(now + SETUP_MS) } } : {}),
    ...(o.codes ? { recovery: { codes: o.codes.map(recoveryHash), createdAt: iso(now) } } : {}),
    ...(o.passkeysBefore ? { passkeysBefore: o.passkeysBefore } : {}),
    ...(o.pending ? { pendingRemoval: { askedBy: o.pending.by ?? "Divya", askedAt: iso(o.pending.askedAt), effectiveAt: iso(o.pending.askedAt + REMOVAL_WAIT_MS) } } : {}),
  };
}

const passkey = (s: Shop, op: string, extra: Record<string, unknown> = {}) => s.call("/internal/channel/owner-passkey", { body: { op, ...extra } });
const grantState = async (s: Shop, g: Grant): Promise<string> => (await passkey(s, "grant_state", { grant: g })).body.state;
/** A phone registers with a grant (the setup QR's token, a recovery code, an "add a phone" link or Geometer's reset QR). */
async function register(s: Shop, g: Grant, ua = ANDROID): Promise<{ phone: SoftPasskey; session: string }> {
  const ro = await passkey(s, "register_options", { grant: g });
  assert.equal(ro.status, 200, `register_options: ${JSON.stringify(ro.body)}`);
  const phone = newSoftPasskey(rp.rpId);
  const r = await passkey(s, "register", { grant: g, response: softRegister(phone, ro.body.options, rp.origin), ua });
  assert.equal(r.status, 200, `register: ${JSON.stringify(r.body)}`);
  return { phone, session: r.body.session as string };
}
/** How many passkeys the shop offers at sign-in now (0: the passkey button is not shown). */
const offered = async (s: Shop): Promise<number> => (await passkey(s, "signin_options")).body.count;
/** A phone signs in with its passkey: the status, and the new session on 200. */
async function signin(s: Shop, phone: SoftPasskey): Promise<{ status: number; session?: string }> {
  const so = await passkey(s, "signin_options");
  if (!so.body.options) return { status: 0 };
  const r = await passkey(s, "signin", { response: softSignin(phone, so.body.options, rp.origin) });
  return { status: r.status, ...(r.status === 200 ? { session: r.body.session as string } : {}) };
}
/** Is this session good now? (The inbox's question, with the internal token.) */
const good = async (s: Shop, session: string): Promise<boolean> => (await s.call("/internal/owner-session", { session })).status === 204;
const phones = (s: Shop, session: string | undefined, body: Record<string, unknown>, owner?: string) => s.call("/internal/channel/owner-phones", { ...(session ? { session } : {}), ...(owner ? { owner } : {}), body });
/** The owner's phones page data, for the phone that holds `session`. */
async function list(s: Shop, session: string): Promise<any> {
  const r = await phones(s, session, { op: "list" });
  assert.equal(r.status, 200, `list: ${JSON.stringify(r.body)}`);
  return r.body;
}
/** What the panel's probe sees (/status, the internal token): the passkeys, whether the shop is locked, and the Operator's pending request. */
const panel = async (s: Shop): Promise<{ passkeys: number; alertPhones: number; locked?: boolean; removal?: { askedBy: string; effectiveAt: string } }> => (await s.call("/status")).body.ownerAccess;
/** "Add a phone" from the owner's own phone: the token at the end of the link's address. */
async function addPhoneLink(s: Shop, session: string): Promise<string> {
  const r = await phones(s, session, { op: "add_phone" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(String(r.body.url).startsWith(`${OWNER_BASE}/setup/`), r.body.url);
  return String(r.body.url).slice(`${OWNER_BASE}/setup/`.length);
}
/** A shop locked by its first phone (the Operator's QR the harness wrote). */
async function lockedShop(o: ShopOptions = {}): Promise<{ s: Shop; p1: { phone: SoftPasskey; session: string }; p1id: string }> {
  const s = await boot(o);
  const p1 = await register(s, qr(s.setup));
  const p1id = (await list(s, p1.session)).phones[0].id as string;
  return { s, p1, p1id };
}
/** The record's owner_session lines with this `what` (the tick writes the request notices). */
const lines = (s: Shop, what: string) => s.record().filter((r) => r.action === "owner_session" && r.refs.what === what);
/** Wait until the tick has written `n` lines with this `what` (a 1-second tick), then a little more, to see that no second one comes. */
async function told(s: Shop, what: string, n = 1): Promise<void> {
  for (let i = 0; i < 100 && lines(s, what).length < n; i++) await new Promise((r) => setTimeout(r, 100));
  await new Promise((r) => setTimeout(r, 2500)); // two more ticks
  assert.equal(lines(s, what).length, n, `${what} lines in the record:\n${s.log()}`);
}
/** Within a minute of the expected moment (the panel shows effectiveAt as an ISO time). */
const near = (actual: string | number | undefined, expected: number, what: string): void => {
  const t = typeof actual === "string" ? Date.parse(actual) : actual;
  assert.ok(t !== undefined && Math.abs(t - expected) < MIN, `${what}: ${actual === undefined ? "none" : iso(t!)}, expected about ${iso(expected)}`);
};

describe("the test clock", () => {
  test("a shop in live mode (what the panel writes for every real shop) refuses to start on a test clock", async () => {
    const s = await makeShop({ clock: true, owner: A }); shops.push(s);
    s.setMode("live");
    await assert.rejects(s.start(), /test clock/u);
  });
});

describe("the lock and the owner's phones", () => {
  test("the first passkey locks the shop; the phones list shows each phone with its label, how it came and 'this phone'; only a session made here opens it", async () => {
    const s = await boot();
    assert.deepEqual(await panel(s), { passkeys: 0, alertPhones: 0, locked: false });
    const p1 = await register(s, qr(s.setup), ANDROID);
    const p = await panel(s);
    assert.equal(p.passkeys, 1); assert.equal(p.locked, true); assert.equal(p.removal, undefined);
    const v = await list(s, p1.session);
    assert.equal(v.phones.length, 1);
    assert.deepEqual([v.phones[0].label, v.phones[0].via, v.phones[0].mine], ["Android, Chrome", "setup", true]);
    assert.equal(v.passkeySession, true);
    assert.equal(v.removal, undefined); assert.equal(v.ownCodesAt, undefined);
    assert.equal(v.lockedLast4, "0001", "the number the shop is locked with, last 4 digits only");
    assert.deepEqual(v.announce, []); assert.deepEqual(v.news, []);
    assert.deepEqual(v.alerts, []);
    // the panel's owner link is the OPERATOR's: it opens none of the phones page; no session, or a made-up one, neither
    assert.deepEqual([(await phones(s, undefined, { op: "list" }, s.owner)).status, (await phones(s, undefined, { op: "list" }, s.owner)).body.state], [403, "signed_out"]);
    assert.equal((await phones(s, "B".repeat(43), { op: "list" })).status, 403);
    assert.equal((await phones(s, p1.session, { op: "nonsense" })).status, 400);
  });
});

describe("the Operator's files cannot reopen a locked shop", () => {
  test("ATTACK: a QR or a card the Operator makes after the first passkey is refused, whatever the file says, even back-dated; one seen before it still works", async () => {
    const s = await boot();
    const before = newRecoveryCode();
    s.writeGrants(grants(s, { token: s.setup, codes: [before] }));
    assert.equal(await grantState(s, code(before)), "valid", "a card seen before the lock");
    await register(s, qr(s.setup));
    // a new QR and a new card, written as the panel would (or by hand, back-dated to an hour ago)
    const late = newSetupToken(); const card = newRecoveryCode();
    const file = grants(s, { token: late, codes: [card] }) as { setup: { createdAt: string } ; recovery: { createdAt: string } };
    file.setup.createdAt = iso(s.now() - HOUR); file.recovery.createdAt = iso(s.now() - HOUR);
    s.writeGrants(file);
    assert.equal(await grantState(s, qr(late)), "unknown");
    assert.equal(await grantState(s, code(card)), "unknown");
    const ro = await passkey(s, "register_options", { grant: qr(late) });
    assert.deepEqual([ro.status, ro.body.state], [403, "unknown"]);
    // the card seen before the lock still works (the Operator's honest card for a lost phone), until the owner makes their own codes
    s.writeGrants(grants(s, { codes: [before, card] }));
    assert.equal(await grantState(s, code(before)), "valid");
    assert.equal(await grantState(s, code(card)), "unknown");
  });

  test("ATTACK: a QR dated 2099 works for 15 minutes from the runtime's first sight, and no longer", async () => {
    const s = await boot();
    const far = newSetupToken();
    s.writeGrants(grants(s, { token: far, expiresAt: "2099-01-01T00:00:00.000Z" }));
    assert.equal(await grantState(s, qr(far)), "valid");
    s.advance(14 * MIN);
    assert.equal(await grantState(s, qr(far)), "valid");
    s.advance(2 * MIN);
    assert.equal(await grantState(s, qr(far)), "expired");
  });

  test("ATTACK: a 'sign out every device' dated 2099 never refuses a session made after the runtime saw it; once locked, pressing it keeps the owner's passkey session", async () => {
    const s = await boot();
    s.writeSessionsEnd("2099-01-01T00:00:00.000Z");
    assert.equal(await good(s, "C".repeat(43)), false); // any session check reads the file: the runtime sees 2099 now, and clamps it to now
    s.advance(MIN);
    const p1 = await register(s, qr(s.setup));
    assert.equal(await good(s, p1.session), true, "a session made after the runtime saw the far date is good");
    s.advance(HOUR);
    assert.equal(await good(s, p1.session), true);
    // the Operator presses it again and again: after the lock it ends link sessions only, so the owner's passkey session stays
    for (let i = 0; i < 3; i++) { s.writeSessionsEnd(iso(s.now())); s.advance(MIN); assert.equal(await good(s, p1.session), true); }
    assert.equal((await s.call("/internal/channel/owner-listing", { session: p1.session })).status, 200);
  });

  test("ATTACK: a passkeysBefore dated 2099 in the file the runtime first reads is clamped (the owner's first phone works); one written after the lock is ignored", async () => {
    const s = await makeShop({ clock: true, owner: A }); shops.push(s);
    s.writeGrants(grants(s, { token: s.setup, passkeysBefore: "2099-01-01T00:00:00.000Z" }));
    await s.start();
    s.advance(MIN);
    const p1 = await register(s, qr(s.setup));
    assert.equal(await offered(s), 1);
    assert.equal((await signin(s, p1.phone)).status, 200);
    s.advance(MIN);
    s.writeGrants(grants(s, { passkeysBefore: iso(s.now()) }));
    assert.equal(await offered(s), 1, "the Operator cannot cut the owner's phones off by writing the file");
    assert.equal((await signin(s, p1.phone)).status, 200);
    assert.equal(await good(s, p1.session), true);
  });

  test("ATTACK: a reset dated 2099 does not block Geometer's real reset later: its QR works", async () => {
    const { s, p1 } = await lockedShop();
    s.writeReset({ schema: 1, at: "2099-01-01T00:00:00.000Z", reason: "forged", by: "someone" });
    assert.equal((await panel(s)).locked, true, "a reset with no QR of its own: the window is open, and nothing but a reset QR works");
    assert.equal(await good(s, p1.session), false, "the reset (clamped to now) ended the session");
    s.advance(HOUR);
    const rq = newSetupToken();
    s.writeReset({ schema: 1, at: iso(s.now()), reason: "the owner lost every phone", by: "Geometer", setup: { sha256: setupHash(rq), expiresAt: iso(s.now() + HOUR) } });
    assert.equal(await grantState(s, qr(rq)), "valid");
    const p2 = await register(s, qr(rq));
    assert.equal((await list(s, p2.session)).phones[0].via, "reset");
  });
});

describe("the owner's own codes and phones", () => {
  test("the owner's own codes: shown once, void the Operator's card, and register a new phone (via own_code); a phone that makes codes cannot void another phone's set", async () => {
    const s = await boot();
    const card = newRecoveryCode();
    s.writeGrants(grants(s, { token: s.setup, codes: [card] }));
    const p1 = await register(s, qr(s.setup));
    assert.equal(await grantState(s, code(card)), "valid");
    const made = await phones(s, p1.session, { op: "codes" });
    assert.equal(made.status, 200);
    const own = made.body.codes as string[];
    assert.equal(own.length, 5); assert.ok(own.every((c) => /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}$/u.test(c)));
    assert.equal(await grantState(s, code(card)), "unknown", "the Operator's printed card stops working");
    assert.ok((await list(s, p1.session)).ownCodesAt !== undefined);
    // a code reads however it is typed (lower case, dashes, spaces)
    const typed = `${own[0].slice(0, 5).toLowerCase()} - ${own[0].slice(5)}`;
    assert.equal(await grantState(s, code(typed)), "valid");
    const p2 = await register(s, code(own[0]), IPHONE);
    assert.equal(await grantState(s, code(own[0])), "used");
    const v2 = await list(s, p2.session);
    assert.equal(v2.phones.find((p: any) => p.mine).via, "own_code");
    // the second phone makes its own set: the first phone's set (the owner's) is untouched
    assert.equal((await phones(s, p2.session, { op: "codes" })).status, 200);
    assert.equal(await grantState(s, code(own[1])), "valid");
  });

  test("a new phone is announced to every OTHER phone until it dismisses it; codes made and a phone removed are news for the others; a phone from the card hears of every earlier one", async () => {
    const s = await boot();
    const card = newRecoveryCode();
    s.writeGrants(grants(s, { token: s.setup, codes: [card] }));
    const p1 = await register(s, qr(s.setup), ANDROID);
    s.advance(MIN);
    const p2 = await register(s, qr(await addPhoneLink(s, p1.session)), IPHONE);
    const v1 = await list(s, p1.session);
    assert.deepEqual(v1.announce.map((a: any) => [a.label, a.via]), [["iPhone, Safari", "own_phone"]]);
    const v2 = await list(s, p2.session);
    assert.deepEqual(v2.announce, [], "a phone the owner added themselves does not hear of older ones, nor of itself");
    // a phone from the Operator's card (seen before the lock) hears of every phone made before it, once
    s.advance(MIN);
    const p3 = await register(s, code(card), ANDROID);
    const v3 = await list(s, p3.session);
    assert.equal(v3.phones.length, 3);
    assert.equal(v3.announce.length, 2, "both earlier phones are announced to a phone made by the card");
    assert.equal(v3.phones.find((p: any) => p.mine).via, "recovery");
    // "It was me": dismisses up to what the banner showed, and the new phone p3 is still news for p1
    const v1b = await list(s, p1.session);
    assert.deepEqual(v1b.announce.map((a: any) => a.via), ["own_phone", "recovery"]);
    assert.equal((await phones(s, p1.session, { op: "dismiss", through: v1.seenThrough })).status, 200);
    assert.deepEqual((await list(s, p1.session)).announce.map((a: any) => a.via), ["recovery"], "only what the banner showed was dismissed");
    assert.equal((await phones(s, p1.session, { op: "dismiss", through: v1b.seenThrough })).status, 200);
    assert.deepEqual((await list(s, p1.session)).announce, []);
    // p2 makes codes: news for p1, not for p2
    s.advance(MIN);
    assert.equal((await phones(s, p2.session, { op: "codes" })).status, 200);
    assert.deepEqual((await list(s, p1.session)).news.map((n: any) => n.kind), ["codes"]);
    assert.deepEqual((await list(s, p2.session)).news, []);
    // p1 removes p3: news of a removal for p2
    s.advance(MIN);
    const p3id = v3.phones.find((p: any) => p.mine).id;
    assert.equal((await phones(s, p1.session, { op: "remove", id: p3id })).status, 200);
    assert.ok((await list(s, p2.session)).news.some((n: any) => n.kind === "removed"));
    assert.ok(!(await list(s, p1.session)).news.some((n: any) => n.kind === "removed"), "not for the phone that did it");
  });

  test("ATTACK: removing a phone takes back the codes and 'add a phone' links it made and ends its session; the last phone goes only with the second confirm", async () => {
    const { s, p1, p1id } = await lockedShop();
    const ownerCodes = (await phones(s, p1.session, { op: "codes" })).body.codes as string[];
    s.advance(MIN);
    const p2 = await register(s, qr(await addPhoneLink(s, p1.session)), IPHONE);
    const p2id = (await list(s, p2.session)).phones.find((p: any) => p.mine).id as string;
    // the second phone (an intruder, say) makes codes and an "add a phone" link of its own
    const intruderCodes = (await phones(s, p2.session, { op: "codes" })).body.codes as string[];
    const intruderLink = await addPhoneLink(s, p2.session);
    assert.equal(await grantState(s, code(intruderCodes[0])), "valid");
    assert.equal(await grantState(s, qr(intruderLink)), "valid");
    assert.equal(await grantState(s, code(ownerCodes[0])), "valid", "its codes did not void the owner's");
    // the owner removes it
    const r = await phones(s, p1.session, { op: "remove", id: p2id });
    assert.deepEqual([r.status, r.body.ok, r.body.wasLast], [200, true, false]);
    assert.equal(await good(s, p2.session), false, "the removed phone's session ended");
    assert.equal((await signin(s, p2.phone)).status !== 200, true, "the removed phone does not sign in");
    assert.equal(await grantState(s, code(intruderCodes[1])), "unknown", "its codes went with it");
    assert.equal(await grantState(s, qr(intruderLink)), "unknown", "and its link");
    assert.equal(await grantState(s, code(ownerCodes[0])), "valid", "the owner's own set stays");
    assert.equal((await phones(s, p1.session, { op: "remove", id: p2id })).status, 404, "already gone");
    // the last phone: refused until the owner confirms twice
    const last = await phones(s, p1.session, { op: "remove", id: p1id });
    assert.deepEqual([last.status, last.body.state], [409, "last"]);
    assert.equal(await good(s, p1.session), true, "refused: nothing changed");
    const gone = await phones(s, p1.session, { op: "remove", id: p1id, confirm_last: true });
    assert.deepEqual([gone.status, gone.body.wasLast], [200, true]);
    assert.equal(await good(s, p1.session), false);
    assert.equal(await offered(s), 0, "no phone opens the shop now");
    // FINDING (reported, not changed): the codes the removed phone made go with it, so after removing the LAST phone even the owner's own codes are void,
    // although the confirm page says the owner "can only get back in with your own recovery codes" (owner-phones-page.ts lastAsk)
    assert.equal(await grantState(s, code(ownerCodes[1])), "unknown");
  });
});

describe("the Operator's request to remove every phone", () => {
  test("ATTACK: a back-dated request starts its 48 hours at first sight; the owner sees it and cancels; the same request is never heard again, a new one waits a day", async () => {
    const { s, p1 } = await lockedShop();
    s.advance(HOUR);
    s.writeGrants(grants(s, { pending: { askedAt: s.now() - 3 * DAY } }));
    const seen = s.now();
    const p = await panel(s);
    assert.equal(p.removal?.askedBy, "Divya");
    near(p.removal?.effectiveAt, seen + REMOVAL_WAIT_MS, "a back-dated request waits 48 hours from first sight");
    assert.equal((await signin(s, p1.phone)).status, 200, "it has not applied");
    const v = await list(s, p1.session);
    assert.deepEqual([v.removal?.kind, v.removal?.askedBy], ["removal", "Divya"]);
    near(v.removal?.effectiveAt, seen + REMOVAL_WAIT_MS, "the phones page");
    assert.deepEqual((await phones(s, p1.session, { op: "cancel_removal" })).body, { cancelled: true });
    assert.equal((await panel(s)).removal, undefined);
    assert.deepEqual((await phones(s, p1.session, { op: "cancel_removal" })).body, { cancelled: false }, "nothing is waiting");
    s.advance(3 * DAY);
    assert.equal((await panel(s)).removal, undefined, "the same request (the same askedAt) is not heard again, however long the file keeps it");
    // a new request (a new askedAt) is heard: three days after the cancel, at once
    s.writeGrants(grants(s, { pending: { askedAt: s.now() } }));
    near((await panel(s)).removal?.effectiveAt, s.now() + REMOVAL_WAIT_MS, "a new request");
    // the owner cancels it too; a third one right away waits a day's quiet before it is heard (the Operator cannot ask again and again until the owner is not looking)
    assert.deepEqual((await phones(s, p1.session, { op: "cancel_removal" })).body, { cancelled: true });
    s.advance(MIN);
    s.writeGrants(grants(s, { pending: { askedAt: s.now() } }));
    assert.equal((await panel(s)).removal, undefined, "within a day of the cancel: not heard");
    s.advance(23 * HOUR);
    assert.equal((await panel(s)).removal, undefined);
    s.advance(2 * HOUR);
    near((await panel(s)).removal?.effectiveAt, s.now() + REMOVAL_WAIT_MS, "after the day's quiet it is heard, with its own 48 hours");
    assert.equal((await signin(s, p1.phone)).status, 200);
  });

  test("a request nobody cancels applies after 48 hours: every phone and session ends, and only a QR the runtime sees after that works", async () => {
    const { s, p1 } = await lockedShop();
    const seen = s.now();
    s.writeGrants(grants(s, { pending: { askedAt: seen } }));
    near((await panel(s)).removal?.effectiveAt, seen + REMOVAL_WAIT_MS, "the request");
    // a QR the Operator makes while the request waits (the same request, the same askedAt, stays in the file) is first seen before the gate opens: it never works
    s.advance(HOUR);
    const early = newSetupToken();
    s.writeGrants(grants(s, { token: early, pending: { askedAt: seen } }));
    assert.equal(await grantState(s, qr(early)), "unknown");
    s.advance(47 * HOUR + MIN);
    const after48 = await panel(s);
    assert.deepEqual([after48.locked, after48.removal], [false, undefined], "applied: the shop is open for a new first phone");
    assert.equal(await offered(s), 0);
    assert.equal(await good(s, p1.session), false);
    assert.equal(await grantState(s, qr(early)), "unknown", "the QR made while it waited stays void");
    const fresh = newSetupToken();
    s.writeGrants(grants(s, { token: fresh }));
    assert.equal(await grantState(s, qr(fresh)), "valid");
    await register(s, qr(fresh));
    assert.equal((await panel(s)).locked, true);
  });

  test("a request before the owner holds any passkey is not a request (nothing to wait for); still in the file after the lock, it is timed from then", async () => {
    const s = await boot();
    s.writeGrants(grants(s, { token: s.setup, pending: { askedAt: s.now() - 10 * DAY } }));
    assert.equal((await panel(s)).removal, undefined);
    s.advance(MIN);
    const p1 = await register(s, qr(s.setup));
    near((await panel(s)).removal?.effectiveAt, s.now() + REMOVAL_WAIT_MS, "48 hours from the first sight after the lock, not from the file's date");
    assert.equal((await signin(s, p1.phone)).status, 200);
  });
});

describe("the owner's number is locked with the first phone", () => {
  test("ATTACK: a changed number after the lock keeps the owner's phones and is a 48-hour request; a cancel sticks for a day, then the same change may be asked again", async () => {
    const { s, p1 } = await lockedShop();
    await s.stop();
    s.setOwnerNumber(B); // the Operator's settings form; the deployer restarts the runtime with it
    await s.start();
    const seen = s.now();
    const p = await panel(s);
    assert.equal(p.locked, true);
    assert.equal(p.removal?.askedBy, "the owner number");
    near(p.removal?.effectiveAt, seen + REMOVAL_WAIT_MS, "the number change waits 48 hours");
    assert.equal(await offered(s), 1, "the owner's phone still opens the shop");
    assert.equal((await signin(s, p1.phone)).status, 200);
    assert.equal(await good(s, p1.session), true);
    const v = await list(s, p1.session);
    assert.equal(v.removal?.kind, "owner_change");
    assert.equal(v.numberDiffers, true, "the phones page says the settings name another number");
    assert.equal(v.lockedLast4, "0001", "messages still go to the number it was locked with");
    assert.deepEqual((await phones(s, p1.session, { op: "cancel_removal" })).body, { cancelled: true });
    assert.equal((await panel(s)).removal, undefined);
    s.advance(23 * HOUR);
    assert.equal((await panel(s)).removal, undefined, "the cancel sticks for a day");
    assert.equal(await offered(s), 1);
    s.advance(2 * HOUR);
    const again = await panel(s);
    near(again.removal?.effectiveAt, s.now() + REMOVAL_WAIT_MS, "after a day's quiet the same change is asked again, with a new 48 hours");
    assert.equal(await offered(s), 1);
  });

  test("ATTACK: a sale: the change applies after 48 hours with no restart, the new owner's phone binds the shop to the NEW number, and a restart keeps it so", async () => {
    const { s, p1 } = await lockedShop({ tickSeconds: 1 });
    await s.stop();
    s.setOwnerNumber(B);
    await s.start();
    assert.equal((await panel(s)).removal?.askedBy, "the owner number");
    await told(s, "owner_change_asked");
    s.advance(REMOVAL_WAIT_MS + MIN);
    const open = await panel(s);
    assert.deepEqual([open.locked, open.removal], [false, undefined], "applied, with no restart");
    assert.equal(await good(s, p1.session), false); assert.equal(await offered(s), 0);
    await told(s, "removal_applied");
    // the new owner registers with the Operator's new QR: the shop binds to B
    const q = newSetupToken();
    s.writeGrants(grants(s, { token: q }));
    const pB = await register(s, qr(q));
    assert.equal((await list(s, pB.session)).lockedLast4, "2222", "locked with the new owner's number");
    await s.stop();
    await s.start();
    assert.equal((await panel(s)).removal, undefined, "the settings and the lock agree: no request");
    assert.equal((await signin(s, pB.phone)).status, 200);
    // and the binding is to B: the old number in the settings now is the request
    await s.stop();
    s.setOwnerNumber(A);
    await s.start();
    assert.equal((await panel(s)).removal?.askedBy, "the owner number");
  });
});

describe("Geometer's reset", () => {
  test("ATTACK: a reset voids every phone, session, QR, card and code and cancels the request; in its window only the reset's own QR works, and what the panel shows then is void for good", async () => {
    const s = await boot();
    const card = newRecoveryCode();
    s.writeGrants(grants(s, { token: s.setup, codes: [card] }));
    const p1 = await register(s, qr(s.setup));
    const own = (await phones(s, p1.session, { op: "codes" })).body.codes as string[];
    s.writeGrants(grants(s, { pending: { askedAt: s.now() } }));
    assert.ok((await panel(s)).removal);
    s.advance(HOUR);
    const rq = newSetupToken();
    s.writeReset({ schema: 1, at: iso(s.now()), reason: "dispute", by: "Geometer", setup: { sha256: setupHash(rq), expiresAt: iso(s.now() + HOUR) } });
    const p = await panel(s);
    assert.deepEqual([p.locked, p.removal], [true, undefined], "locked for the Operator in the window; the request is cancelled");
    assert.equal(await good(s, p1.session), false); assert.equal(await offered(s), 0);
    assert.equal(await grantState(s, code(own[0])), "unknown", "the owner's own codes are void");
    // the Operator's buttons in the window: a new QR, a new card, a request
    const opQr = newSetupToken(); const opCard = newRecoveryCode();
    s.writeGrants(grants(s, { token: opQr, codes: [opCard, card], pending: { askedAt: s.now() } }));
    assert.equal(await grantState(s, qr(opQr)), "unknown");
    assert.equal(await grantState(s, code(opCard)), "unknown");
    assert.equal(await grantState(s, code(card)), "unknown");
    assert.equal((await panel(s)).removal, undefined, "a request posted in the window is void");
    // the reset's own QR
    assert.equal(await grantState(s, qr(rq)), "valid");
    s.advance(MIN);
    const p2 = await register(s, qr(rq));
    assert.equal((await list(s, p2.session)).phones[0].via, "reset");
    assert.equal(await grantState(s, qr(rq)), "used");
    // the window has closed: what the panel showed in it stays void, and the request never wakes
    assert.equal(await grantState(s, code(opCard)), "unknown");
    assert.equal(await grantState(s, qr(opQr)), "unknown");
    s.advance(3 * DAY);
    assert.equal((await panel(s)).removal, undefined);
    assert.equal((await signin(s, p2.phone)).status, 200);
  });

  test("the reset's QR works for an hour from the runtime's first sight, whatever expiry the file says", async () => {
    const { s } = await lockedShop();
    const rq = newSetupToken();
    s.writeReset({ schema: 1, at: iso(s.now()), reason: "dispute", by: "Geometer", setup: { sha256: setupHash(rq), expiresAt: "2099-01-01T00:00:00.000Z" } });
    assert.equal(await grantState(s, qr(rq)), "valid");
    s.advance(61 * MIN);
    assert.equal(await grantState(s, qr(rq)), "expired");
  });
});

describe("restarts and restores", () => {
  test("ATTACK: a request seen by the panel's probe and then a restart before any tick is still told, once; a restart never tells it again", async () => {
    const { s } = await lockedShop();
    s.writeGrants(grants(s, { pending: { askedAt: s.now() } }));
    assert.ok((await panel(s)).removal, "the panel's probe read the request (a reconcile outside the tick)");
    await s.stop(); // before any tick (the tick is an hour here)
    s.setTickSeconds(1);
    await s.start();
    await told(s, "removal_asked");
    await s.stop();
    await s.start();
    await told(s, "removal_asked"); // still exactly one
  });

  test("ATTACK: a restart gives a request about to fall due one more day, and says so once; a second restart does not extend it again", async () => {
    const { s, p1 } = await lockedShop({ tickSeconds: 1 });
    s.writeGrants(grants(s, { pending: { askedAt: s.now() } }));
    const seen = s.now();
    near((await panel(s)).removal?.effectiveAt, seen + REMOVAL_WAIT_MS, "the request");
    await told(s, "removal_asked");
    s.advance(47 * HOUR); // due in an hour
    await s.stop();
    await s.start();
    const started = s.now();
    near((await panel(s)).removal?.effectiveAt, started + DAY, "moved to a day after the start");
    await told(s, "removal_extended");
    s.advance(HOUR);
    await s.stop();
    await s.start();
    near((await panel(s)).removal?.effectiveAt, started + DAY, "a second restart does not move it again");
    await told(s, "removal_extended"); // still one
    assert.equal((await signin(s, p1.phone)).status, 200);
    s.advance(DAY);
    assert.deepEqual([(await panel(s)).locked, (await panel(s)).removal], [false, undefined], "then it applies");
    assert.equal(await offered(s), 0);
  });

  test("a restore (the deployer's owner-keep) keeps the lock: the owner's phone still opens the shop, and the Operator's changed number is a request", async () => {
    const { s, p1 } = await lockedShop();
    await s.stop();
    const keep = readOwnerKeep(s.dataDir);
    assert.ok(keep && keep.ownerAccess.meta.some((m) => m.name === "bound_owner"), "the binding is in the snapshot");
    for (const f of ["owner-access.sqlite", "owner-access.sqlite-wal", "owner-access.sqlite-shm"]) rmSync(join(s.dataDir, f), { force: true });
    putOwnerKeep(s.dataDir, keep!);
    s.setOwnerNumber(B);
    await s.start();
    assert.equal(await offered(s), 1);
    assert.equal((await signin(s, p1.phone)).status, 200);
    const p = await panel(s);
    assert.equal(p.locked, true);
    assert.equal(p.removal?.askedBy, "the owner number");
    assert.equal(await grantState(s, qr(s.setup)), "used", "the used QR stays used");
  });
});

// ---- web push (TypeScript only: the Go runtime serves no push yet, go/TRIAL.md "Left out" 2) -------------------------------------------------------------------------

/** A browser subscription at a push service the shop allows: a P-256 public key and a 16-byte secret, made up. */
function subscription(): Record<string, unknown> {
  const { publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
  const raw = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]);
  return { endpoint: `https://fcm.googleapis.com/fcm/send/${randomBytes(12).toString("hex")}`, keys: { p256dh: raw.toString("base64url"), auth: randomBytes(16).toString("base64url") } };
}
/** A push Guard that takes every push and says nothing back. */
async function fakePushGuard(): Promise<number> {
  const server = createServer((req, res) => { req.resume(); req.on("end", () => { res.writeHead(201); res.end(); }); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  return (server.address() as { port: number }).port;
}

describe("the owner's alerts follow the phone", { skip: IMPL !== "ts" && "the Go runtime serves no web push (go/TRIAL.md, Left out 2); its hooks (dropUnbound, dropRef) wait for the push port" }, () => {
  test("the first passkey ends the alerts no phone holds; afterwards only a phone subscribes, the phones page lists its alert, and removing the phone ends it", async () => {
    const guard = await fakePushGuard();
    const s = await boot({ services: { push: { baseUrl: `http://127.0.0.1:${guard}` } } });
    const push = (body: Record<string, unknown>, o: { session?: string; owner?: string } = {}) => s.call("/internal/channel/push", { ...o, body });
    // the Operator, at the setup visit, turns alerts on with the panel's link: no phone holds that subscription
    const before = await push({ op: "owner_subscribe", subscription: subscription() }, { owner: s.owner });
    assert.equal(before.status, 200, JSON.stringify(before.body));
    assert.equal((await panel(s)).alertPhones, 1);
    const p1 = await register(s, qr(s.setup));
    assert.equal((await panel(s)).alertPhones, 0, "the lock ended the alert no phone holds");
    assert.equal((await push({ op: "owner_subscribe", subscription: subscription() }, { owner: s.owner })).status, 403, "the panel's link may not subscribe once locked");
    assert.equal((await push({ op: "owner_subscribe", subscription: subscription() }, { session: p1.session })).status, 200);
    const p2 = await register(s, qr(await addPhoneLink(s, p1.session)), IPHONE);
    assert.equal((await push({ op: "owner_subscribe", subscription: subscription() }, { session: p2.session })).status, 200);
    assert.equal((await panel(s)).alertPhones, 2);
    const v = await list(s, p1.session);
    assert.deepEqual(v.alerts.map((a: any) => a.label).sort(), ["Android, Chrome", "iPhone, Safari"]);
    const p2id = v.phones.find((p: any) => !p.mine).id;
    assert.equal((await phones(s, p1.session, { op: "remove", id: p2id })).status, 200);
    assert.equal((await panel(s)).alertPhones, 1, "the removed phone's alert ended with it");
    const mine = (await list(s, p1.session)).alerts[0].id;
    assert.deepEqual((await phones(s, p1.session, { op: "stop_alert", id: mine })).body, { stopped: true });
    assert.equal((await panel(s)).alertPhones, 0);
  });
});
