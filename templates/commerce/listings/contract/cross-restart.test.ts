// The shop stopped and started again on ONE folder: what one start wrote the next reads and writes on (the store file, the shop's key, the owner's passkeys and sessions, the owner
// control state). This is what keeps the deployer's backup, snapshot, export and "leave with your shop" working across restarts and updates.
//
// Until 19 Nov 2026 this file ran the TypeScript runtime and the Go runtime in turn on the folder, both ways, which proved the files interchangeable (a server moving from TypeScript
// to Go kept its volume; the last such run passed before the TypeScript runtime was deleted, decision 61 wave 1b). No TypeScript-written folder is kept as a fixture: the store holds
// the shop's signing key. What is kept is the files' SHAPE as the TypeScript made it: the tables, indexes, triggers, SQL text and schema version of agent.db, owner-access.sqlite and
// push.sqlite, in the golden answers (golden.ts, golden/cross-restart.json), so a Go shop still writes the files a TypeScript shop wrote.
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { newSoftPasskey, softRegister, softSignin } from "../../../../modules/channels/test/soft-authenticator.ts";
import type { SoftPasskey } from "../../../../modules/channels/test/soft-authenticator.ts";
import { REMOVAL_WAIT_MS, SETUP_MS, newRecoveryCode, recoveryHash, setupHash } from "../../../../modules/channels/owner-grants.ts";
import { OWNER_BASE, PAGE, makeShop, tinyJpeg } from "./harness.ts";
import type { Shop } from "./harness.ts";
import { goldenFor } from "./golden.ts";
import { enablePush, startFakeGuard } from "../../../../modules/test/contract/push-harness.ts";

const golden = goldenFor(import.meta.url);
const rp = { rpId: new URL(OWNER_BASE).hostname, origin: new URL(OWNER_BASE).origin };
const shops: Shop[] = [];
after(async () => { for (const s of shops) { await s.stop(); s.cleanup(); } });

const op = async (s: Shop, id: string, body: Record<string, unknown>): Promise<void> => {
  const r = await s.call("/internal/channel/owner-listing", { owner: s.owner, body: { id, op: body } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  await s.settle();
};
const feed = async (s: Shop) => (await s.call("/internal/channel/shop-feed", { body: { page: PAGE, name: "Glow Pets", languages: ["en"] } })).body;

describe("restarts on one shop folder", () => {
  test("it writes; restarted, reads and writes; restarted again, reads", async () => {
    const s = await makeShop(); shops.push(s);
    await s.start();
    await op(s, "r-1", { op: "publish_form", category: "pets", title: "Two Persian kittens", priceInr: 8000, qty: 2, photos: [] });
    await op(s, "r-2", { op: "shop", visible: true, town: "Kochi" });
    const up = await s.call("/internal/channel/owner-photo", { owner: s.owner, raw: tinyJpeg(), type: "image/jpeg" });
    const phone = newSoftPasskey(rp.rpId);
    const ro = await s.call("/internal/channel/owner-passkey", { body: { op: "register_options", grant: { kind: "setup", token: s.setup } } });
    const reg = await s.call("/internal/channel/owner-passkey", { body: { op: "register", grant: { kind: "setup", token: s.setup }, response: softRegister(phone, ro.body.options, rp.origin) } });
    assert.equal(reg.status, 200, JSON.stringify(reg.body));
    await s.settle();
    const f1 = await feed(s);
    await s.stop();

    await s.start();
    const v = (await s.call("/internal/channel/owner-listing", { owner: s.owner })).body;
    assert.equal(v.listings[0].id, "l-1"); assert.equal(v.shop.town, "Kochi"); assert.equal(v.pending[0].id, up.body.photo.id);
    const f2 = await feed(s);
    assert.equal(f2.signature.keyId, f1.signature.keyId, "the shop's own key is the one in the store file");
    assert.deepEqual(f2.items, f1.items);
    assert.equal((await s.call("/internal/channel/owner-listing", { session: reg.body.session })).status, 200, "the session made before the restart is good after it");
    const so = await s.call("/internal/channel/owner-passkey", { body: { op: "signin_options" } });
    const sign = await s.call("/internal/channel/owner-passkey", { body: { op: "signin", response: softSignin(phone, so.body.options, rp.origin) } });
    assert.equal(sign.status, 200, "the passkey kept before the restart signs in after it");
    await op(s, "r-3", { op: "publish_form", category: "home", title: "Brass lamp", photos: [] });
    const rec2 = (await s.call("/status")).body.recordLength;
    await s.stop();

    await s.start();
    const v2 = (await s.call("/internal/channel/owner-listing", { owner: s.owner })).body;
    assert.deepEqual(v2.listings.map((l: { id: string }) => l.id), ["l-2", "l-1"], "what the second start wrote is read back, ids carried on");
    assert.equal((await s.call("/status")).body.recordLength, rec2);
    assert.equal((await feed(s)).signature.keyId, f1.signature.keyId);
    assert.equal((await s.call("/internal/channel/owner-listing", { session: sign.body.session })).status, 200);
    await op(s, "r-4", { op: "sold", id: "l-1" });
    assert.deepEqual((await s.call("/internal/channel/owner-listing", { owner: s.owner })).body.listings.map((l: { id: string }) => l.id), ["l-2"]);
  });
});

describe("the shop makes the files the TypeScript runtime made", () => {
  test("agent.db, owner-access.sqlite and push.sqlite have the TypeScript's tables, indexes, triggers, SQL text and schema version (the golden answers)", async () => {
    const dump = (dir: string, file: string): string => {
      const db = new DatabaseSync(join(dir, file), { readOnly: true });
      const version = db.prepare("PRAGMA user_version").get();
      const rows = db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all();
      db.close();
      return JSON.stringify({ version, rows });
    };
    await golden("the files' schema", async () => {
      const s = await makeShop(); shops.push(s);
      const guard = await startFakeGuard();
      enablePush(s, guard);
      await s.start();
      // the owner's access file is made when the shop starts with a channel token; the passkey tables are used by the first ceremony; push.sqlite by the first use of push
      await s.call("/internal/channel/owner-passkey", { body: { op: "register_options", grant: { kind: "setup", token: s.setup } } });
      await s.call("/internal/channel/push", { owner: s.owner, body: { op: "key" } });
      await s.stop(); await guard.close();
      return { store: dump(s.dataDir, "agent.db"), access: dump(s.dataDir, "owner-access.sqlite"), push: existsSync(join(s.dataDir, "push.sqlite")) ? dump(s.dataDir, "push.sqlite") : null };
    });
  });
});

// ---- owner control (19 Nov 2026) on one folder: the gate's memory is the same rows, so a shop moved between the runtimes keeps its lock, its requests and its phones ----------

const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const HOUR = 3_600_000;
const iso = (t: number): string => new Date(t).toISOString();
const passkey = (s: Shop, op: string, extra: Record<string, unknown> = {}) => s.call("/internal/channel/owner-passkey", { body: { op, ...extra } });
const grantState = async (s: Shop, grant: Record<string, unknown>): Promise<string> => (await passkey(s, "grant_state", { grant })).body.state;
async function registerPhone(s: Shop, grant: Record<string, unknown>, ua: string): Promise<{ phone: SoftPasskey; session: string }> {
  const ro = await passkey(s, "register_options", { grant });
  assert.equal(ro.status, 200, JSON.stringify(ro.body));
  const phone = newSoftPasskey(rp.rpId);
  const r = await passkey(s, "register", { grant, response: softRegister(phone, ro.body.options, rp.origin), ua });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { phone, session: r.body.session };
}
async function signsIn(s: Shop, phone: SoftPasskey): Promise<boolean> {
  const so = await passkey(s, "signin_options");
  if (!so.body.options) return false;
  return (await passkey(s, "signin", { response: softSignin(phone, so.body.options, rp.origin) })).status === 200;
}
const phones = (s: Shop, session: string, body: Record<string, unknown>) => s.call("/internal/channel/owner-phones", { session, body });
const ownerAccess = async (s: Shop) => (await s.call("/status")).body.ownerAccess;
/** The owner-access file's schema as SQLite keeps it (the text of every CREATE, after every ALTER). */
const accessSchema = (s: Shop): string => {
  const db = new DatabaseSync(join(s.dataDir, "owner-access.sqlite"), { readOnly: true });
  try { return JSON.stringify(db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all()); } finally { db.close(); }
};

describe("owner control on one folder, across restarts", () => {
  test("locked, asked and codes made; restarted, it reads it all, cancels and removes a phone; restarted again, it reads that back", async () => {
    const s = await makeShop({ clock: true, owner: "+919800000001" }); shops.push(s);
    const card = newRecoveryCode();
    s.writeGrants({ schema: 1, setup: { sha256: setupHash(s.setup), createdAt: iso(s.now()), expiresAt: iso(s.now() + SETUP_MS) }, recovery: { codes: [recoveryHash(card)], createdAt: iso(s.now()) } });
    await s.start();
    const p1 = await registerPhone(s, { kind: "setup", token: s.setup }, ANDROID);
    const own = (await phones(s, p1.session, { op: "codes" })).body.codes as string[];
    assert.equal(own.length, 5);
    const link = String((await phones(s, p1.session, { op: "add_phone" })).body.url).split("/setup/")[1];
    s.advance(60_000);
    const p2 = await registerPhone(s, { kind: "setup", token: link }, IPHONE);
    const p2codes = (await phones(s, p2.session, { op: "codes" })).body.codes as string[];
    const askedAt = s.now();
    s.writeGrants({ schema: 1, pendingRemoval: { askedBy: "Divya", askedAt: iso(askedAt), effectiveAt: iso(askedAt + REMOVAL_WAIT_MS) } });
    const before = await ownerAccess(s);
    assert.equal(before.locked, true); assert.equal(before.removal.askedBy, "Divya");
    const view1 = (await phones(s, p1.session, { op: "list" })).body;
    const schema1 = accessSchema(s);
    await s.stop();

    await s.start();
    assert.equal(accessSchema(s), schema1, "a restart leaves the schema as it is");
    const after = await ownerAccess(s);
    assert.deepEqual([after.locked, after.removal, after.passkeys], [true, before.removal, 2], "the same lock, the same request timed the same, the same phones");
    const view2 = (await phones(s, p1.session, { op: "list" })).body;
    assert.deepEqual(view2.phones, view1.phones, "the phones list (ids, labels, how each came, this phone)");
    assert.deepEqual([view2.announce, view2.news, view2.ownCodesAt, view2.lockedLast4, view2.removal], [view1.announce, view1.news, view1.ownCodesAt, view1.lockedLast4, view1.removal]);
    assert.equal(await signsIn(s, p1.phone), true); assert.equal(await signsIn(s, p2.phone), true);
    assert.equal(await grantState(s, { kind: "recovery", code: own[0] }), "valid", "the owner's own codes");
    assert.equal(await grantState(s, { kind: "recovery", code: card }), "unknown", "the card the own codes voided");
    assert.deepEqual((await phones(s, p1.session, { op: "cancel_removal" })).body, { cancelled: true });
    const p2id = view2.phones.find((p: { mine: boolean }) => !p.mine).id;
    assert.equal((await phones(s, p1.session, { op: "remove", id: p2id })).status, 200);
    assert.equal(await grantState(s, { kind: "recovery", code: p2codes[0] }), "unknown");
    await s.stop();

    await s.start();
    assert.equal(accessSchema(s), schema1);
    const back = await ownerAccess(s);
    assert.deepEqual([back.locked, back.removal, back.passkeys], [true, undefined, 1], "the cancel and the removal made before the restart");
    assert.equal(await signsIn(s, p2.phone), false, "the removed phone stays removed");
    assert.equal(await signsIn(s, p1.phone), true);
    assert.equal(await grantState(s, { kind: "recovery", code: p2codes[1] }), "unknown");
    assert.equal(await grantState(s, { kind: "recovery", code: own[1] }), "valid");
    // the day's quiet after the cancel holds across the restart: a new request now is not heard
    s.advance(HOUR);
    s.writeGrants({ schema: 1, pendingRemoval: { askedBy: "Divya", askedAt: iso(s.now()), effectiveAt: iso(s.now() + REMOVAL_WAIT_MS) } });
    assert.equal((await ownerAccess(s)).removal, undefined);
  });
});
