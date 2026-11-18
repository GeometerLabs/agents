// Two listings-only shops on ONE shared process, for real (the template's own runtime, a store file and tokens for each): they never see each other's data. Every credential of
// one is presented to the other and refused; each shop's listings, store file, owner sign-in file and photos are its own; a new shop needs no new process and no restart; a shop
// let go closes its store and leaves its file where it was.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OWNER_LINK_FILE, newOwnerToken, ownerLinkFile } from "../../../../modules/channels/owner-link.ts";
import { OWNER_ACCESS_FILE } from "../../../../modules/channels/owner-access.ts";
import { folderSource, startShared } from "../../../../modules/runtime/shared.ts";
import type { SharedProcess } from "../../../../modules/runtime/shared.ts";
import { pathwayVersion } from "../server/config.ts";
import { startClient } from "../server/start.ts";
import type { RunningClient } from "../server/start.ts";

const roots: string[] = [];
const procs: SharedProcess[] = [];
after(async () => { for (const p of procs) await p.stop(); for (const r of roots) rmSync(r, { recursive: true, force: true }); });

const hex = (n: number) => randomUUID().replace(/-/gu, "").repeat(4).slice(0, n);
interface Shop { name: string; owner: string; channel: string; internal: string }

/** A shop's folder as the deployer writes it: client files (lock last), secrets, and the owner's link (a hash file in the client folder). */
function folder(root: string, name: string): Shop {
  const client = join(root, "clients", name, "client");
  mkdirSync(client, { recursive: true });
  mkdirSync(join(root, "secrets", name), { recursive: true });
  const s: Shop = { name, owner: newOwnerToken(), channel: hex(40), internal: hex(40) };
  writeFileSync(join(root, "secrets", name, "internal_token"), s.internal);
  writeFileSync(join(root, "secrets", name, "channel_token"), s.channel);
  writeFileSync(join(root, "secrets", name, "record_key"), hex(64));
  writeFileSync(join(client, "settings.json"), JSON.stringify({ name: name.toUpperCase(), place: { town: "Thrissur" }, languages: ["en"], owner: { language: "en" } }));
  writeFileSync(join(client, "runtime.json"), JSON.stringify({ mode: "fakes", tickSeconds: 3600, dataDir: join(root, "data", name, "data"), services: {} }));
  writeFileSync(join(client, OWNER_LINK_FILE), JSON.stringify(ownerLinkFile(s.owner, new Date())));
  writeFileSync(join(client, "pathway.lock"), `listings@${pathwayVersion()}\n`);
  return s;
}

async function boot(names: string[]) {
  const root = mkdtempSync(join(tmpdir(), "listings-shared-"));
  roots.push(root);
  const shops = Object.fromEntries(names.map((n) => [n, folder(root, n)]));
  const running = new Map<string, RunningClient>();
  const starts: string[] = [];
  const shared = await startShared({
    source: folderSource({ clientsDir: join(root, "clients"), secretsDir: join(root, "secrets") }), port: 0, scanSeconds: 3600,
    start: async (p, listen) => { starts.push(p.name); const r = await startClient({ clientFolder: p.clientFolder, tokenFile: p.tokenFile, channelTokenFile: p.channelTokenFile, recordKeyFile: p.recordKeyFile, listen, log: () => undefined }); running.set(p.name, r); return r; },
  });
  procs.push(shared);
  const call = async (shop: string, path: string, o: { token?: string; owner?: string; method?: string; body?: unknown } = {}) => {
    const r = await fetch(`${shared.url}/shop/${shop}${path}`, {
      method: o.method ?? "GET",
      headers: { ...(o.token ? { authorization: `Bearer ${o.token}` } : {}), ...(o.owner ? { "x-owner-link": o.owner } : {}), ...(o.body ? { "content-type": "application/json" } : {}) },
      ...(o.body ? { body: JSON.stringify(o.body) } : {}),
    });
    return { status: r.status, body: await r.json().catch(() => null) as any };
  };
  const settle = async (shop: string) => { await running.get(shop)!.runtime.idle(); };
  return { root, shops, shared, running, starts, call, settle };
}

const kittens = { op: { op: "publish_form", category: "pets", title: "Two Persian kittens", priceInr: 8000, photos: [] } };

test("two shops, one process: each is served at its own path, each with its own store file, and a new shop needs no new process", async () => {
  const t = await boot(["glow-pets", "sree-cycles"]);
  assert.deepEqual(t.shared.held(), ["glow-pets", "sree-cycles"]);
  for (const n of ["glow-pets", "sree-cycles"]) assert.ok(existsSync(join(t.root, "data", n, "data", "agent.db")), `${n} has its own agent.db`);
  assert.notEqual(join(t.root, "data", "glow-pets", "data", "agent.db"), join(t.root, "data", "sree-cycles", "data", "agent.db"));
  assert.equal((await t.call("glow-pets", "/readyz")).status, 200);
  const portsBefore = [...t.running.values()].map((r) => r.server.port);
  const added = folder(t.root, "new-shop");
  const r = await t.shared.scan();
  assert.deepEqual(r.started, ["new-shop"], "found by looking at the folder: no new container, no restart");
  assert.deepEqual(t.starts, ["glow-pets", "sree-cycles", "new-shop"]);
  assert.deepEqual([...t.running.values()].slice(0, 2).map((x) => x.server.port), portsBefore, "the others kept their ports");
  assert.equal((await t.call("new-shop", "/internal/channel/listings", { token: added.channel })).status, 200);
});

test("a listing of one shop is in that shop's feed and nobody else's", async () => {
  const t = await boot(["glow-pets", "sree-cycles"]);
  const a = t.shops["glow-pets"]; const b = t.shops["sree-cycles"];
  const posted = await t.call("glow-pets", "/internal/channel/owner-listing", { token: a.channel, owner: a.owner, method: "POST", body: { id: randomUUID(), ...kittens } });
  assert.equal(posted.status, 200, JSON.stringify(posted.body));
  await t.settle("glow-pets");
  const own = await t.call("glow-pets", "/internal/channel/listings", { token: a.channel });
  assert.equal(own.body.listings.length, 1);
  assert.equal(own.body.listings[0].words.en.title, "Two Persian kittens");
  const other = await t.call("sree-cycles", "/internal/channel/listings", { token: b.channel });
  assert.deepEqual(other.body.listings, [], "the cycle shop has nothing of the pet shop's");
  assert.ok(!JSON.stringify(await t.call("sree-cycles", "/internal/channel/owner-listing", { token: b.channel, owner: b.owner })).includes("kittens"));
});

test("every credential of one shop, presented to the other, opens nothing", async () => {
  const t = await boot(["glow-pets", "sree-cycles"]);
  const a = t.shops["glow-pets"]; const b = t.shops["sree-cycles"];
  // B's channel token on A: not a token A knows
  assert.equal((await t.call("glow-pets", "/internal/channel/listings", { token: b.channel })).status, 401);
  // B's internal token on A's status, and A's on B's
  assert.equal((await t.call("glow-pets", "/status", { token: b.internal })).status, 401);
  assert.equal((await t.call("sree-cycles", "/status", { token: a.internal })).status, 401);
  // the channel token is not the internal token, whichever shop
  assert.equal((await t.call("glow-pets", "/status", { token: a.channel })).status, 401);
  // B's owner link on A's owner page: A holds the hash of its own link only
  assert.equal((await t.call("glow-pets", "/internal/channel/owner-listing", { token: a.channel, owner: b.owner })).status, 403);
  assert.equal((await t.call("glow-pets", "/internal/channel/owner-listing", { token: a.channel, owner: a.owner })).status, 200);
  // and a write made with B's link on A changes nothing in A
  const before = await t.call("glow-pets", "/internal/channel/listings", { token: a.channel });
  const refused = await t.call("glow-pets", "/internal/channel/owner-listing", { token: a.channel, owner: b.owner, method: "POST", body: { id: randomUUID(), ...kittens } });
  assert.equal(refused.status, 403);
  await t.settle("glow-pets");
  assert.deepEqual((await t.call("glow-pets", "/internal/channel/listings", { token: a.channel })).body, before.body);
});

test("a photo of one shop is in that shop's file only; each shop has its own owner sign-in file", async () => {
  const t = await boot(["glow-pets", "sree-cycles"]);
  const a = t.running.get("glow-pets")!; const b = t.running.get("sree-cycles")!;
  const photo = { id: "ph-0123456789ab", type: "image/jpeg" as const, width: 10, height: 10, bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]) };
  a.runtime.channel!.listings!.putPhoto(photo);
  const count = (shop: string) => { const db = new DatabaseSync(join(t.root, "data", shop, "data", "agent.db"), { readOnly: true }); try { return Number((db.prepare("SELECT count(*) AS n FROM listing_photos").get() as { n: number }).n); } finally { db.close(); } };
  assert.equal(count("glow-pets"), 1);
  assert.equal(count("sree-cycles"), 0, "the other shop's photo table has none of it");
  assert.equal(b.runtime.channel!.listings!.ownerPhoto(photo.id), undefined);
  const photoOnB = await t.call("sree-cycles", `/internal/channel/listing-photo?id=${photo.id}`, { token: t.shops["sree-cycles"].channel, owner: t.shops["sree-cycles"].owner });
  assert.equal(photoOnB.status, 404);
  for (const n of ["glow-pets", "sree-cycles"]) assert.ok(existsSync(join(t.root, "data", n, "data", OWNER_ACCESS_FILE)), `${n}: its own passkeys and sessions file`);
});

test("a shop let go closes its store, answers nothing, and keeps its file; the other shop is not disturbed", async () => {
  const t = await boot(["glow-pets", "sree-cycles"]);
  const a = t.shops["glow-pets"]; const b = t.shops["sree-cycles"];
  await t.call("sree-cycles", "/internal/channel/owner-listing", { token: b.channel, owner: b.owner, method: "POST", body: { id: randomUUID(), ...kittens } });
  await t.settle("sree-cycles");
  rmSync(join(t.root, "clients", "sree-cycles", "client", "pathway.lock"));
  assert.deepEqual((await t.shared.scan()).letGo, ["sree-cycles"]);
  assert.equal((await t.call("sree-cycles", "/readyz")).status, 404);
  assert.equal((await t.call("glow-pets", "/readyz")).status, 200);
  assert.equal((await t.call("glow-pets", "/internal/channel/listings", { token: a.channel })).status, 200);
  const file = join(t.root, "data", "sree-cycles", "data", "agent.db");
  assert.ok(existsSync(file), "the shop's file is where it was: moving or removing it is the deployer's, after this answer");
  const db = new DatabaseSync(file, { readOnly: true });
  assert.ok(readFileSync(file).length > 0);
  db.close();
});
