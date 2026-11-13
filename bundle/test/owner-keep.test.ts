// The owner's passkeys and alert subscriptions through a backup and a restore (pre-release batch 7, item 2; bundle/backup/owner-keep.ts). They live in two small SQLite
// files beside agent.db, which the snapshot did not carry, so a restore used to sign the owner out and turn their alerts off. All stand-ins: a software passkey for the
// phone, a fake push service behind the push Guard, a folder for the bucket. What is proved: back up, restore onto a NEW machine, the owner signs in with the same
// passkey (no link, no new registration) and an alert reaches the same subscription (the phone opens it); the snapshot holds them only encrypted; a shop that has neither
// makes no extra object; a restore into a live shop leaves what is there (a removed passkey stays removed, a newer counter stays); a damaged file stops a restore early.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createECDH, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { generateIdentity } from "../backup/age.ts";
import { fetchSnapshot, runRestoreJob } from "../backup/restore-snapshot.ts";
import { snapshotShop } from "../backup/snapshot.ts";
import { OWNER_KEEP_OBJECT, putOwnerKeep, readOwnerKeep } from "../backup/owner-keep.ts";
import type { OwnerKeep } from "../backup/owner-keep.ts";
import { folderStore } from "../backup/store.ts";
import type { SnapshotJob } from "../backup/snapshot.ts";
import { openStore } from "../../templates/commerce/bookings/server/store.ts";
import { fakeClock } from "../../modules/core/clock.ts";
import { OWNER_ACCESS_FILE, openOwnerAccess } from "../../modules/channels/owner-access.ts";
import type { RelyingParty } from "../../modules/channels/owner-access.ts";
import { newSetupToken, setupHash, SETUP_MS } from "../../modules/channels/owner-grants.ts";
import type { OwnerGrants } from "../../modules/channels/owner-grants.ts";
import { relyingParty } from "../../modules/channels/webauthn.ts";
import { newSoftPasskey, softRegister, softSignin } from "../../modules/channels/test/soft-authenticator.ts";
import { decryptPush } from "../../modules/push/crypto.ts";
import { createPushSender } from "../../modules/push/sender.ts";
import { PUSH_FILE, openPushStore } from "../../modules/push/store.ts";

const T0 = Date.parse("2026-11-14T10:00:00Z");
const BASE = "https://pages.example/glow/owner";
const RP: RelyingParty = relyingParty(BASE);
const OWNER = { owner: "+919800000001", base: BASE };
const STAMP = "20261114T013000Z";

const scratch = () => { const dir = mkdtempSync(join(tmpdir(), "geo-ownerkeep-")); return { dir, done: () => rmSync(dir, { recursive: true, force: true }) }; };
const job = (recipient: string): SnapshotJob => ({ stamp: STAMP, keepDays: 30, recipient, target: { url: "x" }, shops: [] });

/** A phone that allows alerts: its subscription as the browser hands it, and a way to open what was pushed to it. */
function phone() {
  const endpoint = `https://fcm.googleapis.com/fcm/send/${randomBytes(8).toString("hex")}`;
  const ecdh = createECDH("prime256v1"); ecdh.generateKeys();
  const auth = randomBytes(16);
  return {
    sub: { endpoint, keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: auth.toString("base64url") } },
    open: (body: string) => JSON.parse(decryptPush(Buffer.from(body, "base64url"), { privateKey: ecdh.getPrivateKey(), publicKey: ecdh.getPublicKey(), auth }).toString("utf8")) as { title: string; body: string },
  };
}

/** A shop's data folder as the runtime leaves it: agent.db, the owner's sign-in file with one passkey registered through the partner's QR, and the push file with one phone. */
function shop(dir: string) {
  const data = join(dir, "data"); mkdirSync(data, { recursive: true });
  const store = openStore(data);
  store.commitStep({ snapshot: "{}", entries: [{ seq: 1, time: "2026-11-04T10:00:00Z", conversation: "c", booking: "b-1", action: "a", outcome: "confirmed" } as never], nowMs: Date.now() });
  store.close();
  const access = openOwnerAccess(join(data, OWNER_ACCESS_FILE));
  const token = newSetupToken();
  const grants: OwnerGrants = { schema: 1, setup: { sha256: setupHash(token), createdAt: new Date(T0).toISOString(), expiresAt: new Date(T0 + SETUP_MS).toISOString() } };
  const g = { kind: "setup" as const, token };
  const o = access.registrationOptions(g, grants, OWNER, RP, "Glow", T0);
  assert.ok(o.ok);
  const passkey = newSoftPasskey(RP.rpId);
  const reg = access.register(g, grants, OWNER, RP, softRegister(passkey, o.options as never, RP.origin), T0 + 1000);
  assert.ok(reg.ok, JSON.stringify(reg));
  access.close();
  const push = openPushStore(join(data, PUSH_FILE));
  const alerts = phone();
  const sub = push.subscribe("owner", alerts.sub, T0);
  assert.ok(sub.ok);
  push.setChoice("both");
  const vapid = push.vapid().publicKey;
  push.close();
  return { data, passkey, alerts, subId: (sub as { id: string }).id, vapid };
}

test("back up, restore onto a new machine: the owner signs in with the same passkey and an alert reaches the same phone", async () => {
  const t = scratch(); try {
    const old = shop(join(t.dir, "old"));
    const owner = generateIdentity();
    const store = folderStore(join(t.dir, "bucket"));
    const r = await snapshotShop({ name: "glow-salon", runtimeDb: join(old.data, "agent.db"), guards: [] }, job(owner.recipient), store, join(t.dir, "scratch"));
    assert.equal(r.ok, true, r.error);
    const keys = (await store.list("glow-salon/")).map((o) => o.key);
    assert.ok(keys.includes(`glow-salon/${STAMP}/${OWNER_KEEP_OBJECT}`), "the passkeys and subscriptions are an object of the snapshot");
    // encrypted like the rest: neither the phone's push address nor its key is readable in the bucket
    for (const k of keys) {
      const raw = (await store.get(k))!.toString("latin1");
      assert.ok(!raw.includes(new URL(old.alerts.sub.endpoint).pathname) && !raw.includes(old.alerts.sub.keys.auth), `${k} holds no plain subscription`);
    }

    // the restore job, as the container runs it
    const out = join(t.dir, "restore-out");
    const done = await runRestoreJob({ target: { url: "x" }, shop: "glow-salon", identityFile: join(t.dir, "id.txt"), out, nowIso: "2026-11-14T12:00:00Z" }, store).catch(() => undefined);
    assert.equal(done, undefined, "no identity file yet: nothing is written");
    writeFileSync(join(t.dir, "id.txt"), owner.identity);
    const restored = await runRestoreJob({ target: { url: "x" }, shop: "glow-salon", identityFile: join(t.dir, "id.txt"), out, nowIso: "2026-11-14T12:00:00Z" }, store);
    assert.equal(restored.ownerKeep, true);
    assert.ok(readdirSync(out).includes("owner-keep.json"));

    // a NEW machine: empty data folder, the import step of `geometer restore`
    const fresh = join(t.dir, "new", "data"); mkdirSync(fresh, { recursive: true });
    const put = putOwnerKeep(fresh, JSON.parse(readFileSync(join(out, "owner-keep.json"), "utf8")) as OwnerKeep);
    assert.deepEqual(put, { passkeys: 1, subscriptions: 1 });

    // the owner signs in with the passkey they already have
    const access = openOwnerAccess(join(fresh, OWNER_ACCESS_FILE));
    const options = access.signinOptions(OWNER, RP, T0 + 60_000);
    assert.equal(options.count, 1, "the passkey is offered");
    const opts = options.options as { challenge: string; allowCredentials: { id: string }[] };
    assert.deepEqual(opts.allowCredentials.map((c) => c.id), [old.passkey.credId.toString("base64url")]);
    const signed = access.signin(softSignin(old.passkey, opts, RP.origin), OWNER, RP, T0 + 61_000);
    assert.ok(signed.ok, JSON.stringify(signed));
    assert.ok(access.check(signed.session, OWNER, T0 + 62_000));
    access.close();

    // an alert reaches the same subscription, signed with the same VAPID key
    const push = openPushStore(join(fresh, PUSH_FILE));
    assert.equal(push.vapid().publicKey, old.vapid, "the shop's push keys came back with the subscription");
    assert.equal(push.choice(), "both");
    assert.equal(push.phones("owner"), 1);
    const calls: { sub: string; host: string; path: string; body: string }[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => { calls.push(JSON.parse(String(init.body))); return new Response("{}", { status: 201 }); }) as unknown as typeof fetch;
    const sender = createPushSender({ store: push, guard: { baseUrl: "http://g-glow-push:8080" }, subject: () => "https://pages.example/glow", clock: fakeClock(T0 + 120_000), fetchImpl });
    assert.equal(push.enqueue("owner", "owner", { title: "Glow", body: "A booking needs you", tag: "owner" }, T0 + 120_000).length, 1);
    await sender.pass();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].sub, old.subId, "the same subscription");
    assert.equal(calls[0].path, new URL(old.alerts.sub.endpoint).pathname);
    assert.deepEqual(old.alerts.open(calls[0].body), { title: "Glow", body: "A booking needs you", tag: "owner" }, "the phone opens it");
    push.close();
  } finally { t.done(); }
});

test("a shop whose owner has set up neither makes no extra object; reading a folder with no files is nothing", async () => {
  const t = scratch(); try {
    const data = join(t.dir, "data"); mkdirSync(data);
    const s = openStore(data); s.commitStep({ snapshot: "{}", entries: [{ seq: 1, time: "2026-11-04T10:00:00Z", conversation: "c", booking: "b-1", action: "a", outcome: "confirmed" } as never], nowMs: Date.now() }); s.close();
    assert.equal(readOwnerKeep(data), null);
    openOwnerAccess(join(data, OWNER_ACCESS_FILE)).close(); openPushStore(join(data, PUSH_FILE)).close(); // files made, nothing in them
    assert.equal(readOwnerKeep(data), null);
    const store = folderStore(join(t.dir, "bucket"));
    await snapshotShop({ name: "s", runtimeDb: join(data, "agent.db"), guards: [] }, job(generateIdentity().recipient), store, join(t.dir, "scratch"));
    assert.ok(!(await store.list("s/")).some((o) => o.key.includes("owner-keep")));
  } finally { t.done(); }
});

test("restoring into a shop that is already running leaves what it has: a passkey removed since stays removed, a newer counter stays, a phone that was dropped stays dropped", () => {
  const t = scratch(); try {
    const old = shop(join(t.dir, "a"));
    const keep = readOwnerKeep(old.data)!;
    // time passes on the live shop: the owner's passkey is used again (counter up) and then removed; the phone unsubscribes
    const db = new DatabaseSync(join(old.data, OWNER_ACCESS_FILE));
    db.prepare("UPDATE passkeys SET sign_count = 9, removed_at = ?, removed_why = 'removed'").run(T0 + 5);
    db.close();
    const push = openPushStore(join(old.data, PUSH_FILE));
    assert.equal(push.unsubscribe("owner", old.alerts.sub.endpoint, T0 + 6), true);
    push.close();
    const put = putOwnerKeep(old.data, keep);
    assert.deepEqual(put, { passkeys: 0, subscriptions: 0 }, "nothing the live files already know is put back");
    const check = new DatabaseSync(join(old.data, OWNER_ACCESS_FILE), { readOnly: true });
    assert.deepEqual({ ...check.prepare("SELECT sign_count, removed_at FROM passkeys").get() }, { sign_count: 9, removed_at: T0 + 5 });
    check.close();
    assert.equal(readOwnerKeep(old.data)!.push.subs.length, 0);
  } finally { t.done(); }
});

test("a damaged owner-keep file is refused before anything is changed, and a missing table in the snapshot's file is refused", async () => {
  const t = scratch(); try {
    const data = join(t.dir, "data"); mkdirSync(data);
    assert.throws(() => putOwnerKeep(data, { schema: 1 } as never), /cannot be put back/u);
    assert.throws(() => putOwnerKeep(data, { schema: 2 } as never), /schema 1/u);
    assert.deepEqual(readdirSync(data), [], "the refusal made no file");
  } finally { t.done(); }
});
