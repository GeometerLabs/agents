// The CONTRACT of four routes a listings-only shop answers besides the ones in listings.contract.test.ts: the owner's limits page and the deployer's limit-changes, "Get my shop's
// file" (leave with your shop), and web push. Same rules as that file: the shop is a separate process (harness.ts), the only way in is HTTP, LISTINGS_IMPL=ts|go picks the runtime,
// it must pass on TypeScript first, and assertions are on statuses and machine fields, not on English sentences. The push tests turn push on through push-harness.ts (a fake push
// Guard and a browser that opens what it is sent).
//
// Where TypeScript and Go are asked to differ from each other: nowhere in this file. (The one difference it once marked `todo`, TypeScript writing the session's token into the
// owner's file-taken record line, was fixed in http.ts: both name the session by its short id.)
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { DatabaseSync } from "node:sqlite";
import { newSoftPasskey, softRegister } from "../../../../modules/channels/test/soft-authenticator.ts";
import { newOwnerFileId } from "../../../../modules/channels/owner-file.ts";
import { IMPL, OWNER_BASE, REPO, makeShop } from "./harness.ts";
import type { Shop } from "./harness.ts";
import { GUARD_TOKEN, enablePush, softBrowser, startFakeGuard, vapidChecks } from "./push-harness.ts";
import type { FakeGuard } from "./push-harness.ts";

const shops: Shop[] = [];
const guards: FakeGuard[] = [];
after(async () => { for (const s of shops) { await s.stop(); s.cleanup(); } for (const g of guards) await g.close(); });

const bin = process.env.LISTINGS_GO_BIN ?? join(REPO, "go", "bin", "listings");
const rp = { rpId: new URL(OWNER_BASE).hostname, origin: new URL(OWNER_BASE).origin };
const OTHER = IMPL === "ts" ? "go" : "ts";

async function boot(o: Parameters<typeof makeShop>[0] = {}): Promise<Shop> { const s = await makeShop(o); shops.push(s); await s.start(); return s; }
/** A shop with push on (a fake Guard named in runtime.json), started as `impl`. */
async function bootPush(impl: "ts" | "go" = IMPL): Promise<{ shop: Shop; guard: FakeGuard }> {
  const shop = await makeShop(); shops.push(shop);
  const guard = await startFakeGuard(); guards.push(guard);
  enablePush(shop, guard);
  await shop.start(impl);
  return { shop, guard };
}

/** The owner signs in with a passkey made from the Operator's setup QR: the only kind of session a listings shop (no WhatsApp, so no sign-in link) has. */
async function passkeySession(s: Shop): Promise<{ session: string; phone: ReturnType<typeof newSoftPasskey> }> {
  const phone = newSoftPasskey(rp.rpId);
  const ro = await s.call("/internal/channel/owner-passkey", { body: { op: "register_options", grant: { kind: "setup", token: s.setup } } });
  const reg = await s.call("/internal/channel/owner-passkey", { body: { op: "register", grant: { kind: "setup", token: s.setup }, response: softRegister(phone, ro.body.options, rp.origin) } });
  assert.equal(reg.status, 200, JSON.stringify(reg.body));
  await s.settle();
  return { session: reg.body.session, phone };
}

/** The record's lines, read from the shop's own database (read only; the shop may be running). */
function record(s: Shop): { action: string; outcome: string; refs: Record<string, string>; inputsDigest: string; notes: string }[] {
  const db = new DatabaseSync(join(s.dataDir, "agent.db"), { readOnly: true });
  try { return (db.prepare("SELECT entry FROM record ORDER BY seq").all() as { entry: string }[]).map((r) => JSON.parse(r.entry)); } finally { db.close(); }
}
const statusOf = async (s: Shop) => (await s.call("/status")).body;

// ---- the owner's limits page and the deployer's limit-changes ---------------------------------------------------------------------------------------------------------------

/** What a shop with no assistant yet holds for limit changes; a limit event makes the assistant (as TypeScript's `assistantOf` does), then rows are written straight into the state. */
const CHANGE = { id: "l-1", limit: "daily_cap", path: "limits.dailyCap", from: 100, to: 50, direction: "tighten", by: "owner_app", state: "pending", atMs: 1_700_000_000_000 };
async function seedChanges(s: Shop, changes: Record<string, unknown>[]): Promise<void> {
  assert.equal((await s.call("/internal/limit-changes", { body: { id: "seed-0", change: "l-99", result: "active" } })).status, 200);
  await s.settle();
  await s.stop();
  const db = new DatabaseSync(join(s.dataDir, "agent.db"));
  const list = JSON.stringify(["assistant", "limitChanges"]);
  assert.ok((JSON.parse((db.prepare("SELECT lists FROM state_shape WHERE id = 1").get() as { lists: string }).lists) as string[]).includes(list), "the assistant's list of limit changes is a row list");
  changes.forEach((c, i) => db.prepare("INSERT INTO state_rows (list, pos, value) VALUES (?, ?, ?)").run(list, i, JSON.stringify(c)));
  db.close();
  await s.start();
}

describe("the clock's beat keeps the newest 30 settled limit changes (chat-limits.ts compactChanges)", () => {
  test("35 settled and 2 pending: the 5 oldest settled go on the beat, the pending ones and every member of the rest stay", async () => {
    const s = await makeShop({ tickSeconds: 1 }); shops.push(s); await s.start();
    const changes = Array.from({ length: 37 }, (_, i) => ({ ...CHANGE, id: `l-${i + 1}`, state: i === 3 || i === 20 ? "pending" : i % 2 ? "active" : "failed", settledAtMs: 1_700_000_000_000 + i, extra: { kept: i } }));
    await seedChanges(s, changes);
    let left: { id: string }[] = [];
    for (let i = 0; i < 80; i++) { left = (await s.call("/internal/limit-changes")).body.changes; if (left.length < 37) break; await new Promise((r) => setTimeout(r, 100)); }
    assert.deepEqual(left.map((c) => c.id), changes.filter((c, i) => c.state === "pending" || i > 5).map((c) => c.id));
    // every kept change is as it was, a settled one marked told on the beat (limits-card.ts unannounced: the shop declares no limit, so nothing is said)
    assert.deepEqual(left, changes.filter((c, i) => c.state === "pending" || i > 5).map((c) => (c.state === "pending" ? c : { ...c, told: true })));
  });
});

describe("the owner's limits page: GET/POST /internal/channel/owner-limits", () => {
  test("reading needs the owner's credential; a listings shop declares no limits; a link is no passkey session", async () => {
    const s = await boot();
    assert.equal((await s.call("/internal/channel/owner-limits")).status, 403);
    assert.equal((await s.call("/internal/channel/owner-limits", { owner: "not-the-link" })).status, 403);
    assert.equal((await s.call("/internal/channel/owner-limits", { token: null })).status, 401, "the channel token comes first");
    const r = await s.call("/internal/channel/owner-limits", { owner: s.owner });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { limits: [], changes: [], passkey: false });
    assert.equal(r.headers.get("cache-control"), "no-store");
    assert.equal((await s.call("/internal/channel/owner-limits", { owner: s.owner, method: "PUT" })).status, 405);
    assert.equal((await s.call("/internal/channel/owner-limits", { owner: s.owner, method: "PUT" })).headers.get("allow"), "POST");
  });

  test("a change is refused without a session made by a passkey (the panel's link cannot loosen or tighten)", async () => {
    const s = await boot();
    const before = await statusOf(s);
    const body = { id: "ol-1", limit: "daily_cap", to: 50 };
    const r = await s.call("/internal/channel/owner-limits", { owner: s.owner, body });
    assert.equal(r.status, 403); assert.equal(r.body.state, "passkey_needed");
    assert.equal((await s.call("/internal/channel/owner-limits", { body })).status, 403, "no credential at all");
    assert.equal((await s.call("/internal/channel/owner-limits", { session: "x".repeat(40), body })).status, 403, "a session nobody made");
    await s.settle();
    assert.equal((await statusOf(s)).recordLength, before.recordLength);
    assert.equal((await statusOf(s)).tasks.done, before.tasks.done, "nothing was saved");
  });

  test("with a passkey session: passkey is true; bodies are checked for shape; a request for a limit the shop does not declare is saved and changes nothing", async () => {
    const s = await boot();
    const { session } = await passkeySession(s);
    const view = await s.call("/internal/channel/owner-limits", { session });
    assert.deepEqual(view.body, { limits: [], changes: [], passkey: true });
    const bad: unknown[] = [{}, null, [], { id: "a b", limit: "x", to: 1 }, { id: "ok", limit: "Bad Limit", to: 1 }, { id: "ok", limit: "daily_cap", to: 1.5 }, { id: "ok", limit: "daily_cap", to: "5" }, { id: "ok", limit: "daily_cap", to: 2 ** 53 }, { id: "x".repeat(65), limit: "daily_cap", to: 1 }];
    for (const body of bad) {
      const r = await s.call("/internal/channel/owner-limits", { session, raw: new TextEncoder().encode(JSON.stringify(body)), type: "application/json" });
      assert.equal(r.status, 400, JSON.stringify(body));
    }
    assert.equal((await s.call("/internal/channel/owner-limits", { session, raw: new TextEncoder().encode("{not json"), type: "application/json" })).status, 400);
    assert.equal((await s.call("/internal/channel/owner-limits", { session, raw: new Uint8Array(3000).fill(32), type: "application/json" })).status, 413);
    const before = await statusOf(s);
    const ok = await s.call("/internal/channel/owner-limits", { session, body: { id: "ol-1", limit: "daily_cap", to: 50 } });
    assert.equal(ok.status, 200); assert.deepEqual(ok.body, { saved: 1, duplicates: 0 });
    assert.deepEqual((await s.call("/internal/channel/owner-limits", { session, body: { id: "ol-1", limit: "daily_cap", to: 50 } })).body, { saved: 0, duplicates: 1 }, "one task per request id");
    const after = await s.settle();
    assert.equal(after.tasks.done, before.tasks.done + 1);
    assert.equal(after.recordLength, before.recordLength, "a limit the shop does not declare changes nothing, and says nothing");
    assert.deepEqual((await s.call("/internal/channel/owner-limits", { session })).body.changes, []);
  });
});

describe("the deployer's word about a limit change: GET/POST /internal/limit-changes", () => {
  test("the internal token (not the channel's); GET is the view; the other methods are 405", async () => {
    const s = await boot();
    assert.equal((await s.call("/internal/limit-changes", { token: null })).status, 401);
    assert.equal((await s.call("/internal/limit-changes", { token: s.channel })).status, 401);
    const r = await s.call("/internal/limit-changes");
    assert.equal(r.status, 200); assert.deepEqual(r.body, { limits: [], changes: [] });
    const put = await s.call("/internal/limit-changes", { method: "PUT" });
    assert.equal(put.status, 405); assert.equal(put.headers.get("allow"), "POST");
    assert.equal((await s.call("/internal/limit-changes", { token: null, method: "PUT" })).status, 401, "the credential is checked before the method");
  });

  test("bad bodies are 400 and nothing is saved; a body past 4 KB is 413", async () => {
    const s = await boot();
    const send = (raw: string | Uint8Array) => s.call("/internal/limit-changes", { raw: typeof raw === "string" ? new TextEncoder().encode(raw) : raw, type: "application/json" });
    for (const body of [{}, null, [], { id: "a", change: "l-3" }, { id: "a", change: "l-3", result: "maybe" }, { id: "a", change: "x-3", result: "active" }, { id: "a", change: "l-1234567890", result: "active" }, { id: "a b", change: "l-3", result: "failed" }, { id: "", change: "l-3", result: "failed" }]) {
      assert.equal((await send(JSON.stringify(body))).status, 400, JSON.stringify(body));
    }
    assert.equal((await send("{nope")).status, 400);
    assert.equal((await send(new Uint8Array(5000).fill(32))).status, 413);
    assert.equal((await statusOf(s)).tasks.done, 0);
  });

  test("a word about a change the shop does not have is saved and written in the record as blocked; the same request id twice is one", async () => {
    const s = await boot();
    const r = await s.call("/internal/limit-changes", { body: { id: "dep-1", change: "l-3", result: "active", why: "x" } });
    assert.equal(r.status, 200); assert.deepEqual(r.body, { saved: 1, duplicates: 0 });
    assert.deepEqual((await s.call("/internal/limit-changes", { body: { id: "dep-1", change: "l-3", result: "active" } })).body, { saved: 0, duplicates: 1 });
    const st = await s.settle();
    assert.equal(st.recordLength, 1);
    const [line] = record(s);
    assert.equal(line.action, "limit_change"); assert.equal(line.outcome, "blocked");
    assert.deepEqual(line.refs, { change: "l-3", result: "active" });
    assert.match(line.inputsDigest, /^k-[0-9a-f]{16}$/u);
    assert.deepEqual((await s.call("/internal/limit-changes")).body, { limits: [], changes: [] });
  });

  test("changes in the saved state are carried through raw on both views; a settled pending change is written, a second word about it is blocked", async () => {
    const s = await boot();
    await seedChanges(s, [CHANGE, { ...CHANGE, id: "l-2", to: 25 }, { ...CHANGE, id: "l-3", state: "active", settledAtMs: 1_700_000_100_000 }]);
    assert.deepEqual((await s.call("/internal/limit-changes")).body, { limits: [], changes: [CHANGE, { ...CHANGE, id: "l-2", to: 25 }, { ...CHANGE, id: "l-3", state: "active", settledAtMs: 1_700_000_100_000 }] });
    assert.deepEqual((await s.call("/internal/channel/owner-limits", { owner: s.owner })).body.changes.map((c: { id: string }) => c.id), ["l-1", "l-2", "l-3"]);
    const lines = record(s).length;
    assert.equal((await s.call("/internal/limit-changes", { body: { id: "dep-2", change: "l-1", result: "active", why: "  Guard said \n  ok  " } })).status, 200);
    assert.equal((await s.call("/internal/limit-changes", { body: { id: "dep-3", change: "l-2", result: "failed" } })).status, 200);
    assert.equal((await s.call("/internal/limit-changes", { body: { id: "dep-4", change: "l-1", result: "failed" } })).status, 200);
    await s.settle();
    const [settled, failed, again] = record(s).slice(lines);
    assert.equal(settled.action, "limit_change"); assert.equal(settled.outcome, "confirmed");
    assert.deepEqual(settled.refs, { limit: "daily_cap", path: "limits.dailyCap", change: "l-1", from: "100", to: "50", direction: "tighten", by: "owner_app", state: "active", why: "Guard said ok" });
    assert.equal(failed.outcome, "failed"); assert.equal(failed.refs.state, "failed"); assert.equal(failed.refs.change, "l-2");
    assert.equal(again.outcome, "blocked", "a change already settled is not settled again");
    assert.deepEqual(again.refs, { change: "l-1", result: "failed" });
    const view = (await s.call("/internal/limit-changes")).body.changes as Record<string, unknown>[];
    assert.equal(view[0].state, "active"); assert.equal(view[0].why, "Guard said ok"); assert.equal(typeof view[0].settledAtMs, "number");
    assert.equal(view[1].state, "failed"); assert.equal(view[2].state, "active");
    assert.equal(view[0].from, 100, "numbers stay numbers");
  });
});

// ---- "Get my shop's file" ----------------------------------------------------------------------------------------------------------------------------------------------

/** What the deployer writes into the shop's client folder (bundle/lib/owner-file.ts): the package first, the meta last. */
function leaveWithFile(s: Shop, o: { ask?: string; expiresInMs?: number; tamper?: boolean; noBody?: boolean } = {}) {
  const body = gzipSync(randomBytes(3000));
  const id = newOwnerFileId();
  const meta = {
    schema: 1, ask: o.ask ?? `ask_${randomBytes(6).toString("hex")}`, id, name: "glow-pets-shop-file-20261118.tar.gz", bytes: body.length,
    sha256: createHash("sha256").update(body).digest("hex"), madeAt: new Date().toISOString(), expiresAt: new Date(Date.now() + (o.expiresInMs ?? 72 * 3_600_000)).toISOString(),
  };
  if (!o.noBody) writeFileSync(join(s.client, "owner-file.tar.gz"), o.tamper ? Buffer.concat([body.subarray(0, body.length - 1), Buffer.from([body[body.length - 1] ^ 1])]) : body);
  writeFileSync(join(s.client, "owner-file.json"), `${JSON.stringify(meta)}\n`);
  return { body, meta };
}
const take = (s: Shop, id: string, who: { session?: string; owner?: string }) => s.call(`/internal/channel/owner-file?take=${id}`, who);

describe("\"Get my shop's file\": GET /internal/channel/owner-file", () => {
  test("only the owner's SESSION: a panel link, no credential and a wrong method are refused", async () => {
    const s = await boot();
    const { session } = await passkeySession(s);
    assert.equal((await s.call("/internal/channel/owner-file")).status, 403);
    assert.equal((await s.call("/internal/channel/owner-file", { owner: s.owner })).status, 403, "the Operator's link opens nothing here");
    assert.equal((await s.call("/internal/channel/owner-file", { session: "y".repeat(40) })).status, 403);
    assert.equal((await s.call("/internal/channel/owner-file", { token: null, session })).status, 401);
    const post = await s.call("/internal/channel/owner-file", { method: "POST", session });
    assert.equal(post.status, 405); assert.equal(post.headers.get("allow"), "GET");
    const none = await s.call("/internal/channel/owner-file", { session });
    assert.equal(none.status, 200); assert.deepEqual(none.body, { state: "none" });
    leaveWithFile(s);
    assert.equal((await take(s, "A".repeat(40), { owner: s.owner })).status, 403, "a link may not take it either");
  });

  test("none, ready, taken: the bytes come once, with TypeScript's headers; the use is written before they leave; the record says the ask", async () => {
    const s = await boot();
    const { session } = await passkeySession(s);
    const { body, meta } = leaveWithFile(s);
    const ready = await s.call("/internal/channel/owner-file", { session });
    assert.deepEqual(ready.body, { state: "ready", id: meta.id, name: meta.name, bytes: meta.bytes, expiresAt: meta.expiresAt });
    assert.equal((await take(s, "short", { session })).status, 404, "an id of the wrong shape");
    assert.equal((await take(s, "B".repeat(43), { session })).status, 404, "an id that is not this file's");
    assert.deepEqual((await s.call("/internal/channel/owner-file", { session })).body.state, "ready", "a wrong id uses nothing");
    const got = await take(s, meta.id, { session });
    assert.equal(got.status, 200);
    assert.deepEqual(Buffer.from(got.bytes), body, "byte for byte what the deployer copied");
    assert.equal(got.headers.get("content-type"), "application/gzip");
    assert.equal(got.headers.get("content-disposition"), `attachment; filename="${meta.name}"`);
    assert.equal(got.headers.get("content-length"), String(body.length));
    assert.equal(got.headers.get("cache-control"), "no-store");
    assert.equal(got.headers.get("x-content-type-options"), "nosniff");
    const used = join(s.dataDir, "owner-file-used.json");
    assert.deepEqual(JSON.parse(readFileSync(used, "utf8")), [meta.id]);
    assert.equal(statSync(used).mode & 0o777, 0o600, "private to the shop's process");
    assert.deepEqual((await s.call("/internal/channel/owner-file", { session })).body, { state: "taken" });
    assert.equal((await take(s, meta.id, { session })).status, 404, "once");
    await s.settle();
    const lines = record(s).filter((l) => l.action === "owner_file_taken");
    assert.equal(lines.length, 1, "one line, however often it is asked");
    assert.equal(lines[0].outcome, "confirmed"); assert.equal(lines[0].refs.ask, meta.ask);
    assert.equal(typeof lines[0].refs.session, "string");
  });

  test("a new file after one was taken is offered again, and the used list keeps the last 50", async () => {
    const s = await boot();
    const { session } = await passkeySession(s);
    const ids: string[] = [];
    for (let i = 0; i < 52; i++) {
      const { meta } = leaveWithFile(s);
      assert.equal((await take(s, meta.id, { session })).status, 200, `file ${i}`);
      ids.push(meta.id);
    }
    assert.deepEqual(JSON.parse(readFileSync(join(s.dataDir, "owner-file-used.json"), "utf8")), ids.slice(-50));
  });

  test("a file that ran out, a body that does not match its meta, and a meta with no body are never given, and a refusal uses nothing up", async () => {
    const s = await boot();
    const { session } = await passkeySession(s);
    const old = leaveWithFile(s, { expiresInMs: -1000 });
    assert.deepEqual((await s.call("/internal/channel/owner-file", { session })).body, { state: "expired" });
    assert.equal((await take(s, old.meta.id, { session })).status, 404);
    const bent = leaveWithFile(s, { tamper: true });
    assert.equal((await s.call("/internal/channel/owner-file", { session })).body.state, "ready");
    assert.equal((await take(s, bent.meta.id, { session })).status, 404, "the hash is checked against the meta");
    assert.equal((await s.call("/internal/channel/owner-file", { session })).body.state, "ready", "and nothing is marked used");
    assert.equal(existsSync(join(s.dataDir, "owner-file-used.json")), false);
    unlinkSync(join(s.client, "owner-file.tar.gz"));
    assert.equal((await take(s, bent.meta.id, { session })).status, 404);
    writeFileSync(join(s.client, "owner-file.json"), "{not json");
    assert.deepEqual((await s.call("/internal/channel/owner-file", { session })).body, { state: "none" }, "a broken meta offers nothing");
    writeFileSync(join(s.client, "owner-file.json"), JSON.stringify({ schema: 1, ask: "ask_1", id: "short", name: "a.tar.gz", bytes: 5, sha256: "0".repeat(64), madeAt: new Date().toISOString(), expiresAt: new Date().toISOString() }));
    assert.deepEqual((await s.call("/internal/channel/owner-file", { session })).body, { state: "none" }, "a meta with a bad id offers nothing");
  });

  test("the record never holds the session's secret: the file-taken line names the session by the short id its sign-in line gave", async () => {
    const s = await boot();
    const { session } = await passkeySession(s);
    const { meta } = leaveWithFile(s);
    assert.equal((await take(s, meta.id, { session })).status, 200);
    await s.settle();
    const lines = record(s);
    for (const l of lines) assert.ok(!JSON.stringify(l).includes(session), `${l.action} holds the session's token`);
    const signedIn = lines.filter((l) => l.action === "owner_session" && l.refs.what === "signed_in").map((l) => l.refs.session);
    const taken = lines.filter((l) => l.action === "owner_file_taken");
    assert.equal(taken.length, 1);
    assert.ok(signedIn.includes(taken[0].refs.session), `the file-taken line names ${taken[0].refs.session}, the sign-in lines ${signedIn.join(", ")}`);
  });
});


// TypeScript and Go take turns on one folder (as cross-restart.test.ts does): the used list one wrote is the other's, and a session one made is good for the other.
describe("the owner's file across a change of runtime", { skip: !existsSync(bin) && `no Go binary at ${bin}` }, () => {
  for (const [first, second] of [["ts", "go"], ["go", "ts"]] as const) {
    test(`taken at ${first}, still taken at ${second}; a file left untaken at ${first} is taken at ${second} once`, async () => {
      const s = await makeShop(); shops.push(s);
      await s.start(first);
      const { session } = await passkeySession(s);
      const one = leaveWithFile(s);
      assert.equal((await take(s, one.meta.id, { session })).status, 200);
      await s.settle();
      await s.stop();
      await s.start(second);
      assert.deepEqual((await s.call("/internal/channel/owner-file", { session })).body, { state: "taken" }, "the used list is one file");
      assert.equal((await take(s, one.meta.id, { session })).status, 404);
      const two = leaveWithFile(s);
      await s.stop();
      await s.start(first);
      assert.equal((await s.call("/internal/channel/owner-file", { session })).body.state, "ready");
      await s.stop();
      await s.start(second);
      const got = await take(s, two.meta.id, { session });
      assert.equal(got.status, 200); assert.deepEqual(Buffer.from(got.bytes), two.body);
      assert.deepEqual(JSON.parse(readFileSync(join(s.dataDir, "owner-file-used.json"), "utf8")), [one.meta.id, two.meta.id]);
      await s.settle();
      assert.deepEqual(record(s).filter((l) => l.action === "owner_file_taken").map((l) => l.refs.ask), [one.meta.ask, two.meta.ask]);
    });
  }
});

// ---- web push ------------------------------------------------------------------------------------------------------------------------------------------------------------

const push = (s: Shop, body: Record<string, unknown>, who: { owner?: string; session?: string } = { owner: s.owner }) => s.call("/internal/channel/push", { ...who, body });
/** The live subscriptions' `ref` (the passkey each was made from), as plain objects. */
const refs = (db: DatabaseSync) => (db.prepare("SELECT ref FROM subs WHERE dead_at IS NULL ORDER BY made_at").all() as { ref: string | null }[]).map((r) => ({ ref: r.ref }));
const pushDb = (s: Shop) => new DatabaseSync(join(s.dataDir, "push.sqlite"), { readOnly: true });

describe("web push is off while runtime.json names no push Guard", () => {
  test("the key says off, every other op is 404, a bad body is 400, a wrong method 405", async () => {
    const s = await boot();
    for (const who of [{ owner: s.owner }, {}]) {
      const k = await push(s, { op: "key" }, who);
      assert.equal(k.status, 200); assert.deepEqual(k.body, { on: false });
    }
    for (const op of ["owner_state", "owner_subscribe", "owner_choice", "customer_state", "nonsense", ""]) {
      const r = await push(s, { op });
      assert.equal(r.status, 404, op); assert.deepEqual(r.body, { on: false });
    }
    assert.equal((await s.call("/internal/channel/push", { body: { op: "key" }, token: null })).status, 401);
    assert.equal((await s.call("/internal/channel/push", { owner: s.owner, raw: new TextEncoder().encode("{x"), type: "application/json" })).status, 400);
    assert.equal((await s.call("/internal/channel/push", { owner: s.owner, raw: new Uint8Array(9000).fill(32), type: "application/json" })).status, 413);
    assert.equal((await s.call("/internal/channel/push", { method: "GET" })).status, 405);
    assert.equal((await statusOf(s)).ownerAccess.alertPhones, 0);
  });
});

describe("web push on, through a fake push Guard", () => {
  test("the key: made once, the same after a restart; any caller with the channel token may ask for it", async () => {
    const { shop: s } = await bootPush();
    const k = await push(s, { op: "key" }, {});
    assert.equal(k.status, 200); assert.equal(k.body.on, true);
    assert.match(k.body.publicKey, /^B[A-Za-z0-9_-]{86}$/u, "65 bytes, 0x04 first, base64url");
    assert.equal(k.body.relayKey, undefined);
    assert.equal(statSync(join(s.dataDir, "push.sqlite")).isFile(), true);
    await s.stop(); await s.start();
    assert.equal((await push(s, { op: "key" }, {})).body.publicKey, k.body.publicKey);
  });

  test("the owner's state and choice: no WhatsApp, so alerts come by push and no other choice is taken", async () => {
    const { shop: s } = await bootPush();
    assert.equal((await push(s, { op: "owner_state" }, {})).status, 403);
    assert.equal((await push(s, { op: "owner_state" }, { owner: "no-such-link" })).status, 403);
    const st = await push(s, { op: "owner_state" });
    assert.equal(st.status, 200); assert.deepEqual(st.body, { on: true, whatsapp: false, choice: "push", phones: 0 });
    for (const choice of ["both", "whatsapp", "nonsense", 5, undefined]) assert.equal((await push(s, { op: "owner_choice", choice })).status, 400, String(choice));
    assert.equal((await push(s, { op: "owner_choice", choice: "push" })).status, 200);
    assert.equal((await push(s, { op: "owner_nonsense" })).status, 400);
    assert.equal((await push(s, { op: "nonsense" })).status, 400);
    assert.equal((await push(s, {})).status, 400);
    assert.equal((await s.call("/internal/channel/push", { owner: s.owner, raw: new TextEncoder().encode("[]"), type: "application/json" })).status, 400);
  });

  test("a subscription is checked (the https address at a push service, a P-256 key, a 16-byte secret); the same address is one phone; the owner keeps five", async () => {
    const { shop: s } = await bootPush();
    const b = softBrowser();
    const sub = (v: unknown) => push(s, { op: "owner_subscribe", subscription: v });
    const sp = b.subscription;
    for (const [name, bad] of Object.entries({
      none: undefined, empty: {}, noKeys: { endpoint: sp.endpoint }, http: { ...sp, endpoint: sp.endpoint.replace("https", "http") }, host: { ...sp, endpoint: "https://evil.example/x" },
      port: { ...sp, endpoint: "https://fcm.googleapis.com:8443/x" }, userinfo: { ...sp, endpoint: "https://u:p@fcm.googleapis.com/x" }, fragment: { ...sp, endpoint: `${sp.endpoint}#x` },
      point: { ...sp, keys: { ...sp.keys, p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64)]).toString("base64url") } }, short: { ...sp, keys: { ...sp.keys, auth: "AAAA" } }, long: { ...sp, endpoint: `${sp.endpoint}/${"a".repeat(1000)}` },
    })) assert.equal((await sub(bad)).status, 400, name);
    assert.deepEqual((await push(s, { op: "owner_state" })).body.phones, 0);
    const first = await sub(sp);
    assert.equal(first.status, 200); assert.deepEqual(first.body, { on: true, whatsapp: false, choice: "push", phones: 1 });
    assert.equal((await sub(sp)).body.phones, 1, "the same address again is the same phone");
    assert.equal((await sub({ ...sp, endpoint: sp.endpoint.replace("https://fcm.googleapis.com", "https://fcm.googleapis.com:443") })).body.phones, 1, "the default port is no port");
    for (let i = 0; i < 6; i++) await sub(softBrowser(["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"][i % 3]).subscription);
    assert.equal((await push(s, { op: "owner_state" })).body.phones, 5, "the oldest goes");
    assert.equal((await push(s, { op: "owner_unsubscribe" })).status, 400);
    assert.equal((await push(s, { op: "owner_unsubscribe", endpoint: "https://fcm.googleapis.com/fcm/send/never-subscribed" })).body.phones, 5);
    assert.equal((await statusOf(s)).ownerAccess.alertPhones, 5, "/status counts the owner's phones while push is on");
    const publicKey = (await push(s, { op: "key" })).body.publicKey; // the shop's VAPID key is made on first use
    const db = pushDb(s);
    try {
      const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
      assert.deepEqual(tables, ["meta", "queue", "subs"]);
      assert.deepEqual((db.prepare("SELECT value FROM meta WHERE name = 'owner_choice'").get() as { value: string }).value, "push", "the first phone with alerts sets the choice");
      const vapid = JSON.parse((db.prepare("SELECT value FROM meta WHERE name = 'vapid'").get() as { value: string }).value) as { privateJwk: { kty: string; crv: string; x: string; y: string; d: string }; publicKey: string };
      assert.equal(vapid.privateJwk.kty, "EC"); assert.equal(vapid.privateJwk.crv, "P-256"); assert.equal(vapid.publicKey, publicKey);
      const cols = (db.prepare("PRAGMA table_info(subs)").all() as { name: string }[]).map((c) => c.name);
      assert.ok(cols.includes("signer") && cols.includes("ref"));
    } finally { db.close(); }
  });

  test("a phone that is unsubscribed stops getting alerts; customer ops have no page to act on in a listings shop", async () => {
    const { shop: s } = await bootPush();
    const b = softBrowser();
    assert.equal((await push(s, { op: "owner_subscribe", subscription: b.subscription })).body.phones, 1);
    const un = await push(s, { op: "owner_unsubscribe", endpoint: b.subscription.endpoint });
    assert.equal(un.status, 200); assert.equal(un.body.phones, 0);
    assert.equal((await statusOf(s)).ownerAccess.alertPhones, 0);
    assert.equal((await push(s, { op: "customer_state" }, {})).status, 400, "no handle");
    assert.equal((await push(s, { op: "customer_state", handle: "AB".repeat(32) }, {})).status, 400, "not a handle's hash");
    for (const op of ["customer_state", "customer_subscribe", "customer_unsubscribe", "customer_nonsense"]) {
      const r = await push(s, { op, handle: "a".repeat(64), subscription: b.subscription, endpoint: b.subscription.endpoint }, {});
      assert.equal(r.status, 404, op);
    }
  });

  test("the lock: once the owner holds a passkey, the panel's link may read the state but not subscribe, unsubscribe or choose; a subscription is tied to the phone it came from", async () => {
    const { shop: s } = await bootPush();
    const { session, phone } = await passkeySession(s);
    const b = softBrowser();
    assert.equal((await push(s, { op: "owner_state" })).status, 200, "reading is still the link's");
    for (const body of [{ op: "owner_subscribe", subscription: b.subscription }, { op: "owner_unsubscribe", endpoint: b.subscription.endpoint }, { op: "owner_choice", choice: "push" }]) {
      assert.equal((await push(s, body)).status, 403, body.op);
    }
    assert.equal((await push(s, { op: "owner_state" })).body.phones, 0);
    const done = await push(s, { op: "owner_subscribe", subscription: b.subscription }, { session });
    assert.equal(done.status, 200); assert.equal(done.body.phones, 1);
    assert.equal((await push(s, { op: "owner_choice", choice: "push" }, { session })).status, 200);
    assert.equal((await push(s, { op: "owner_state" }, { session })).body.phones, 1);
    // the phone's id, from the sign-in store the two runtimes share, is the subscription's `ref`
    const access = new DatabaseSync(join(s.dataDir, "owner-access.sqlite"), { readOnly: true });
    const pk = (access.prepare("SELECT id FROM passkeys").all() as { id: string }[]);
    access.close();
    assert.equal(pk.length, 1); void phone;
    const db = pushDb(s);
    try { assert.deepEqual(refs(db), [{ ref: pk[0].id }], "tied to the passkey the session was made from"); } finally { db.close(); }
    assert.equal((await push(s, { op: "owner_unsubscribe", endpoint: b.subscription.endpoint }, { session })).body.phones, 0);
  });

  test("a subscription before any passkey is the link's own and has no phone behind it", async () => {
    const { shop: s } = await bootPush();
    const b = softBrowser();
    assert.equal((await push(s, { op: "owner_subscribe", subscription: b.subscription })).status, 200);
    const db = pushDb(s);
    try { assert.deepEqual(refs(db), [{ ref: null }]); } finally { db.close(); }
  });

  test("a push alert reaches the Guard, encrypted for the phone, signed with the shop's key (the owner makes recovery codes: the other phones are told)", async () => {
    const { shop: s, guard } = await bootPush();
    const { session } = await passkeySession(s);
    const b = softBrowser();
    assert.equal((await push(s, { op: "owner_subscribe", subscription: b.subscription }, { session })).status, 200);
    const codes = await s.call("/internal/channel/owner-phones", { session, body: { op: "codes" } });
    assert.equal(codes.status, 200);
    for (let i = 0; i < 100 && guard.calls.length === 0; i++) await new Promise((r) => setTimeout(r, 50));
    assert.equal(guard.calls.length, 1);
    const { path, authorization, call } = guard.calls[0];
    assert.equal(path, "/v1/push/owner"); assert.equal(authorization, `Bearer ${GUARD_TOKEN}`);
    assert.equal(call.host, "fcm.googleapis.com"); assert.equal(call.urgency, "high"); assert.equal(call.ttl, 86400);
    assert.match(call.sub, /^[0-9a-f]{12}$/u); assert.equal(call.topic, `owner-${call.sub}`); assert.equal(call.relay, undefined);
    assert.equal(call.path, new URL(b.subscription.endpoint).pathname);
    const key = (await push(s, { op: "key" }, {})).body.publicKey;
    assert.equal(vapidChecks(call, key), true, "ES256 for the push service's origin, the shop's page as the contact");
    const said = b.open(call);
    assert.equal(said.title, "Glow Pets"); assert.equal(said.tag, "phones"); assert.match(said.body, /^New recovery codes were made on /u);
    assert.throws(() => softBrowser().open(call), "another browser opens nothing");
  });
});

describe("web push: the sender drains what was queued to the Guard", () => {
  // No route of this shop makes an alert yet in every runtime, so the queue is filled the way a runtime would fill it (a row in push.sqlite, for a subscribed phone) while the shop is
  // stopped; the shop's sender finds it and posts it to the Guard. Go sends at start; TypeScript on its timer (15 s), so the wait is long.
  for (const [name, answer, then] of [
    ["a Guard that takes it: the phone reads the words, the Guard heard the shop's credential and a signature that verifies", { status: 201 }, "sent"],
    ["a Guard that refuses it with a reason: it is not tried again", { status: 403, reason: "daily_cap" }, "refused"],
    ["a push service that says the phone is gone: the subscription is forgotten", { status: 410 }, "gone"],
  ] as const) {
    test(name, { timeout: 60_000 }, async () => {
      const { shop: s, guard } = await bootPush();
      guard.answer = { ...answer };
      const b = softBrowser();
      assert.equal((await push(s, { op: "owner_subscribe", subscription: b.subscription })).status, 200);
      const key = (await push(s, { op: "key" })).body.publicKey;
      await s.stop();
      const db = new DatabaseSync(join(s.dataDir, "push.sqlite"));
      const sub = db.prepare("SELECT id FROM subs WHERE dead_at IS NULL").get() as { id: string };
      const now = Date.now();
      db.prepare("INSERT INTO queue (id, sub_id, kind, title, body, tag, made_at, next_at, state) VALUES ('aaaaaaaaaaaa', ?, 'owner', 'Glow Pets', ?, 'phones', ?, ?, 'waiting')").run(sub.id, "A new phone \u20b9 was added", now, now);
      db.close();
      await s.start();
      for (let i = 0; i < 480 && guard.calls.length === 0; i++) await new Promise((r) => setTimeout(r, 50));
      assert.equal(guard.calls.length, 1, "the sender posted it");
      const { path, authorization, call } = guard.calls[0];
      assert.equal(path, "/v1/push/owner"); assert.equal(authorization, `Bearer ${GUARD_TOKEN}`);
      assert.equal(call.host, "fcm.googleapis.com"); assert.equal(call.urgency, "high"); assert.equal(call.ttl, 86400);
      assert.equal(call.sub, sub.id); assert.equal(call.topic, `owner-${sub.id}`); assert.equal(call.path, new URL(b.subscription.endpoint).pathname);
      assert.equal(vapidChecks(call, key), true, "ES256 for the push service's origin, the shop's page as the contact");
      assert.deepEqual(b.open(call), { title: "Glow Pets", body: "A new phone \u20b9 was added", tag: "phones" });
      assert.throws(() => softBrowser().open(call), "another browser opens nothing");
      // what came of it is kept in the queue
      let state = "";
      for (let i = 0; i < 100 && state !== then; i++) {
        await new Promise((r) => setTimeout(r, 50));
        const ro = new DatabaseSync(join(s.dataDir, "push.sqlite"), { readOnly: true });
        try { state = (ro.prepare("SELECT state FROM queue WHERE id = 'aaaaaaaaaaaa'").get() as { state: string }).state; } finally { ro.close(); }
      }
      assert.equal(state, then);
      if (then === "gone") assert.equal((await push(s, { op: "owner_state" })).body.phones, 0);
      else assert.equal((await push(s, { op: "owner_state" })).body.phones, 1);
    });
  }
});

describe("web push across a change of runtime", { skip: !existsSync(bin) && `no Go binary at ${bin}` }, () => {
  for (const [first, second] of [["ts", "go"], ["go", "ts"]] as const) {
    test(`a subscription and the choice made at ${first} are the shop's at ${second}, with the same key`, async () => {
      const { shop: s } = await bootPush(first);
      const { session } = await passkeySession(s);
      const key = (await push(s, { op: "key" }, {})).body.publicKey;
      const a = softBrowser(), b = softBrowser("updates.push.services.mozilla.com");
      assert.equal((await push(s, { op: "owner_subscribe", subscription: a.subscription }, { session })).body.phones, 1);
      assert.equal((await push(s, { op: "owner_subscribe", subscription: b.subscription }, { session })).body.phones, 2);
      await s.stop(); await s.start(second);
      assert.equal((await push(s, { op: "key" }, {})).body.publicKey, key, "the VAPID key is the one in the store");
      assert.deepEqual((await push(s, { op: "owner_state" }, { session })).body, { on: true, whatsapp: false, choice: "push", phones: 2 });
      assert.equal((await statusOf(s)).ownerAccess.alertPhones, 2);
      assert.equal((await push(s, { op: "owner_unsubscribe", endpoint: a.subscription.endpoint }, { session })).body.phones, 1, "ends the other runtime's subscription");
      await s.stop(); await s.start(first);
      assert.equal((await push(s, { op: "owner_state" }, { session })).body.phones, 1);
      assert.equal((await push(s, { op: "owner_subscribe", subscription: b.subscription }, { session })).body.phones, 1, "the same address is still one phone");
    });
  }
});
