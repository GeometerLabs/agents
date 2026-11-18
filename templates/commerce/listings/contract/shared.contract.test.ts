// The CONTRACT of the SHARED process for listings-only shops, as the deployer and the front see it: one port, `/shop/<name>/...` routed to that shop, `/healthz`, `/readyz` and
// `/shared/shops` (the deployer reads `shops`, `paused` and `pausedDetail` from it), shops found and let go by looking at the folders. Every scenario starts the process as a
// SEPARATE process on a folder layout the deployer writes (shared-harness.ts) and talks to it ONLY over HTTP.
//
// Both implementations run the SAME scenarios in one run: the TypeScript shared process (modules/runtime/shared.ts through templates/commerce/listings/server/shared-main.ts, with a
// pool of worker threads) and the Go one (go/cmd/listings-shared, the binary named by LISTINGS_SHARED_GO_BIN, default go/bin/listings-shared). SHARED_IMPL=ts or go runs one only.
// Assertions are on status codes and machine fields, never on English sentences.
//
// NOT here (no black-box way to make a shop misbehave in the shipped binary, which has no fault hooks): the strikes, quarantine, pause and the spinning shop. Those are tested with
// fake shops in go/internal/shared/host_test.go and, for TypeScript, modules/runtime/test/shared-pool.test.ts.
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { verifyDocument } from "../../../../modules/signing/index.ts";
import { PAGE } from "./harness.ts";
import { dataFile, haveGo, makeRoot, startHost, writeShop } from "./shared-harness.ts";
import type { Host, Impl, Root, ShopFolder } from "./shared-harness.ts";

const impls = (process.env.SHARED_IMPL ? [process.env.SHARED_IMPL] : ["ts", "go"]) as Impl[];
const roots: Root[] = [];
const hosts: Host[] = [];
after(async () => { for (const h of hosts) await h.stop(); for (const r of roots) rmSync(r.dir, { recursive: true, force: true }); });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(what: string, f: () => Promise<boolean> | boolean, ms = 15_000): Promise<void> {
  const t = Date.now();
  while (Date.now() - t < ms) { if (await f()) return; await sleep(50); }
  throw new Error(`timed out waiting until ${what}`);
}

async function boot(impl: Impl, names: string[], prepare?: (root: Root, shops: Record<string, ShopFolder>) => void, expect = names.length) {
  const root = makeRoot();
  roots.push(root);
  const shops: Record<string, ShopFolder> = {};
  for (const n of names) shops[n] = writeShop(root, n);
  prepare?.(root, shops);
  const host = await startHost(impl, root, { shops, expect });
  hosts.push(host);
  const settle = async (shop: string) => { await until(`${shop}'s queue is empty`, async () => { const s = await host.call(shop, "/status"); return s.status === 200 && s.body.tasks.pending === 0; }); };
  return { root, shops, host, settle };
}

for (const impl of impls) {
  const skip = impl === "go" && !haveGo() ? "go/bin/listings-shared is not built (cd go && go build -o bin/listings-shared ./cmd/listings-shared)" : false;
  describe(`shared process: ${impl}`, { skip }, () => {
    test("two shops in one folder layout: routing by name, and the shapes of /healthz, /readyz and /shared/shops", async () => {
      const t = await boot(impl, ["glow-pets", "sree-cycles"]);
      for (const p of ["/healthz", "/readyz"]) {
        const r = await t.host.get(p);
        assert.equal(r.status, 200);
        assert.deepEqual(Object.keys(r.body).sort(), ["ok", "paused", "quarantined", "shops"]);
        assert.deepEqual([r.body.ok, r.body.shops, r.body.paused, r.body.quarantined], [true, 2, [], []]);
      }
      const list = await t.host.get("/shared/shops");
      assert.equal(list.status, 200);
      assert.deepEqual(Object.keys(list.body).sort(), ["paused", "pausedDetail", "shops"], "the deployer reads these three");
      assert.deepEqual(list.body, { shops: ["glow-pets", "sree-cycles"], paused: [], pausedDetail: [] });
      assert.equal((await t.host.call("glow-pets", "/readyz")).status, 200);
      assert.equal((await t.host.call("glow-pets", "/readyz")).body.ok, true);
      const st = await t.host.call("sree-cycles", "/status");
      assert.equal(st.status, 200);
      assert.equal(st.body.pathway, "listings");
      assert.equal((await t.host.call("nobody", "/readyz")).status, 404, "a name no shop has: nothing here");
      assert.equal((await t.host.get("/nothing")).status, 404);
      assert.equal((await t.host.get("/shop")).status, 404);
      assert.ok(existsSync(dataFile(t.root, "glow-pets")) && existsSync(dataFile(t.root, "sree-cycles")), "each shop has a store file of its own");
    });

    test("each shop has its own tokens: another shop's token is refused by the shop itself", async () => {
      const t = await boot(impl, ["glow-pets", "sree-cycles"]);
      const a = t.shops["glow-pets"]; const b = t.shops["sree-cycles"];
      assert.equal((await t.host.call("glow-pets", "/internal/channel/listings", { token: b.channel })).status, 401);
      assert.equal((await t.host.call("glow-pets", "/internal/channel/listings", { token: a.channel })).status, 200);
      assert.equal((await t.host.call("glow-pets", "/status", { token: b.internal })).status, 401);
      assert.equal((await t.host.call("sree-cycles", "/status", { token: a.internal })).status, 401);
      assert.equal((await t.host.call("glow-pets", "/status", { token: a.channel })).status, 401, "the channel token is not the internal token");
      assert.equal((await t.host.call("glow-pets", "/status", { token: null })).status, 401);
      assert.equal((await t.host.call("glow-pets", "/internal/channel/owner-listing", { token: a.channel, owner: b.owner })).status, 403, "another shop's owner link opens nothing");
    });

    test("a shop with a missing token file is skipped, the others run on, and it starts when the file appears", async () => {
      const t = await boot(impl, ["glow-pets", "no-token", "sree-cycles"], (root) => unlinkSync(join(root.secrets, "no-token", "internal_token")), 2);
      assert.deepEqual((await t.host.get("/shared/shops")).body.shops, ["glow-pets", "sree-cycles"]);
      assert.equal((await t.host.call("no-token", "/readyz")).status, 404);
      assert.equal((await t.host.call("glow-pets", "/readyz")).status, 200);
      assert.equal((await t.host.get("/readyz")).status, 200, "the process is healthy whatever a shop is");
      const token = "f".repeat(48);
      writeFileSync(join(t.root.secrets, "no-token", "internal_token"), token);
      await until("the shop is picked up", async () => (await t.host.get("/shared/shops")).body.shops.includes("no-token"));
      assert.equal((await t.host.call("no-token", "/status", { token })).status, 200, "it runs on ITS token file");
    });

    test("a shop added after the start is picked up by the scan, and the others are not disturbed", async () => {
      const t = await boot(impl, ["glow-pets"]);
      const added = writeShop(t.root, "new-shop");
      t.shops["new-shop"] = added;
      await until("new-shop is held", async () => (await t.host.get("/shared/shops")).body.shops.includes("new-shop"));
      assert.deepEqual((await t.host.get("/shared/shops")).body.shops, ["glow-pets", "new-shop"]);
      assert.equal((await t.host.call("new-shop", "/internal/channel/listings", { token: added.channel })).status, 200);
      assert.equal((await t.host.get("/healthz")).body.shops, 2);
      assert.equal((await t.host.call("glow-pets", "/readyz")).status, 200, "and glow-pets still answers");
    });

    test("the owner's link and the shop's feed are read through /shop/<name>/internal/channel/...", async () => {
      const t = await boot(impl, ["glow-pets", "sree-cycles"]);
      const a = t.shops["glow-pets"];
      const publish = async (id: string, op: Record<string, unknown>) => {
        const r = await t.host.call("glow-pets", "/internal/channel/owner-listing", { owner: a.owner, body: { id, op } });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        await t.settle("glow-pets");
      };
      await publish("sw-1", { op: "shop", visible: true });
      await publish("r-1", { op: "publish_form", category: "pets", title: "Two Persian kittens", priceInr: 8000, photos: [] });
      const own = await t.host.call("glow-pets", "/internal/channel/owner-listing", { owner: a.owner });
      assert.equal(own.status, 200);
      assert.equal(own.body.liveCount, 1);
      const q = { page: PAGE, name: "Glow Pets", languages: ["en"] };
      const f = await t.host.call("glow-pets", "/internal/channel/shop-feed", { body: q });
      assert.equal(f.status, 200, JSON.stringify(f.body));
      assert.equal(f.body.format, "shop-feed/1");
      assert.equal(f.body.items.length, 1);
      assert.deepEqual(verifyDocument(f.body), { ok: true, keyId: f.body.signature.keyId }, "the signature holds, through the router");
      assert.deepEqual((await t.host.call("glow-pets", "/internal/channel/listings")).body.listings.map((l: any) => l.id), ["l-1"]);
      assert.deepEqual((await t.host.call("sree-cycles", "/internal/channel/listings")).body.listings, [], "the other shop has none of it");
      assert.equal((await t.host.call("sree-cycles", "/internal/channel/shop-feed", { body: q })).status, 404, "the other shop's switch is off");
    });

    test("a shop let go closes its store BEFORE /shared/shops stops naming it, and keeps its file", async () => {
      const t = await boot(impl, ["glow-pets", "sree-cycles"]);
      const b = t.shops["sree-cycles"];
      const r = await t.host.call("sree-cycles", "/internal/channel/owner-listing", { owner: b.owner, body: { id: "r-1", op: { op: "publish_form", category: "pets", title: "Two kittens", priceInr: 8000, photos: [] } } });
      assert.equal(r.status, 200);
      await t.settle("sree-cycles");
      const wal = `${dataFile(t.root, "sree-cycles")}-wal`;
      assert.ok(existsSync(wal), "while the store is open its write-ahead log is there");
      unlinkSync(join(t.root.clients, "sree-cycles", "client", "pathway.lock"));
      // look at the list as fast as the process answers: the moment the name is gone, the store must already be closed (a closed WAL store removes its -wal file)
      let walAtUnlisting: boolean | undefined;
      await until("the name leaves the list", async () => {
        const shops = (await t.host.get("/shared/shops")).body.shops as string[];
        if (shops.includes("sree-cycles")) return false;
        walAtUnlisting = existsSync(wal);
        return true;
      });
      assert.equal(walAtUnlisting, false, "the store was closed before the name left the list");
      assert.equal((await t.host.call("sree-cycles", "/readyz")).status, 404);
      assert.equal((await t.host.call("glow-pets", "/readyz")).status, 200, "the other shop is not disturbed");
      assert.ok(existsSync(dataFile(t.root, "sree-cycles")) && readFileSync(dataFile(t.root, "sree-cycles")).length > 0, "its file is where it was");
    });
  });
}

// GO ONLY: a quarantined shop in a process of its own. The shipped binary has no fault hooks, so the strike memory (a small json file in STATE_DIR, which the host reads at its start) is
// SEEDED with "quarantined" and the host must start the shop straight in a child (`listings-shared --one <shop>`): the real spawn, the proxy and the shop's own token check, end to end.
describe("shared process: a quarantined shop in a process of its own (Go)", { skip: haveGo() ? false : "go/bin/listings-shared is not built" }, () => {
  /** A host with the strike memory seeded: glow-pets quarantined. */
  async function seeded() {
    const root = makeRoot();
    roots.push(root);
    const shops = { "glow-pets": writeShop(root, "glow-pets"), "sree-cycles": writeShop(root, "sree-cycles") };
    const client = join(root.clients, "glow-pets", "client");
    // the fingerprint is the TypeScript one: the three files joined by a NUL, sha-256, 16 hex digits
    const fingerprint = createHash("sha256").update(["settings.json", "runtime.json", "pathway.lock"].map((f) => readFileSync(join(client, f), "utf8")).join("\u0000")).digest("hex").slice(0, 16);
    mkdirSync(join(root.dir, "state"), { recursive: true });
    writeFileSync(join(root.dir, "state", "shared-strikes.json"), JSON.stringify({ "glow-pets": { fingerprint, quarantined: true } }));
    const host = await startHost("go", root, { shops, expect: 2 });
    hosts.push(host);
    const kids = () => { try { return execFileSync("pgrep", ["-P", String(host.pid)]).toString().trim().split("\n").filter(Boolean); } catch { return []; } };
    const gone = (pid: string) => until("the child is gone", () => { try { execFileSync("kill", ["-0", pid], { stdio: "ignore" }); return false; } catch { return true; } });
    return { host, shops, kids, gone };
  }
  test("a seeded quarantine starts the shop in a child process; the child is gone when the host stops", async () => {
    const { host, shops, kids, gone } = await seeded();
    assert.deepEqual((await host.get("/healthz")).body.quarantined, ["glow-pets"]);
    assert.equal(kids().length, 1, "one child process, for the quarantined shop only");
    const a = shops["glow-pets"]; const b = shops["sree-cycles"];
    assert.equal((await host.call("glow-pets", "/internal/channel/listings", { token: a.channel })).status, 200, "served through the proxy");
    assert.equal((await host.call("glow-pets", "/internal/channel/listings", { token: b.channel })).status, 401, "the child's own token check refuses another shop's token");
    assert.equal((await host.call("glow-pets", "/readyz")).status, 200);
    assert.equal((await host.call("sree-cycles", "/internal/channel/listings", { token: b.channel })).status, 200, "the other shop runs in the host");
    const child = kids()[0];
    await host.stop();
    await gone(child);
  });

  test("a child never outlives a host that died without cleaning up (it watches the pipe the host holds)", async () => {
    const { host, kids, gone } = await seeded();
    const child = kids()[0];
    assert.ok(child);
    process.kill(host.pid, "SIGKILL");
    await gone(child); // otherwise the restarted host would start a second owner of the same store
  });
});
