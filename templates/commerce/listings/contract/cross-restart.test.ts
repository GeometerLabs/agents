// The two runtimes on ONE folder, in turn: what one wrote the other reads, both ways (TypeScript then Go, Go then TypeScript). This is what keeps the deployer's backup, snapshot,
// export and "leave with your shop" working whichever runtime a shop runs: the store file, the shop's key, the owner's passkeys and sessions are the same files. Skipped when no Go
// binary is named (LISTINGS_GO_BIN, default <repo>/go/bin/listings) or it is not built.
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { newSoftPasskey, softRegister, softSignin } from "../../../../modules/channels/test/soft-authenticator.ts";
import { OWNER_BASE, PAGE, REPO, makeShop, tinyJpeg } from "./harness.ts";
import type { Shop } from "./harness.ts";

const bin = process.env.LISTINGS_GO_BIN ?? join(REPO, "go", "bin", "listings");
const rp = { rpId: new URL(OWNER_BASE).hostname, origin: new URL(OWNER_BASE).origin };
const shops: Shop[] = [];
after(async () => { for (const s of shops) { await s.stop(); s.cleanup(); } });

const op = async (s: Shop, id: string, body: Record<string, unknown>): Promise<void> => {
  const r = await s.call("/internal/channel/owner-listing", { owner: s.owner, body: { id, op: body } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  await s.settle();
};
const feed = async (s: Shop) => (await s.call("/internal/channel/shop-feed", { body: { page: PAGE, name: "Glow Pets", languages: ["en"] } })).body;

describe("TypeScript and Go take turns on one shop folder", { skip: !existsSync(bin) && `no Go binary at ${bin}` }, () => {
  for (const [first, second] of [["ts", "go"], ["go", "ts"]] as const) {
    test(`${first} writes, ${second} reads and writes, ${first} reads again`, async () => {
      const s = await makeShop(); shops.push(s);
      await s.start(first);
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

      await s.start(second);
      const v = (await s.call("/internal/channel/owner-listing", { owner: s.owner })).body;
      assert.equal(v.listings[0].id, "l-1"); assert.equal(v.shop.town, "Kochi"); assert.equal(v.pending[0].id, up.body.photo.id);
      const f2 = await feed(s);
      assert.equal(f2.signature.keyId, f1.signature.keyId, "the shop's own key is the one in the store file");
      assert.deepEqual(f2.items, f1.items);
      assert.equal((await s.call("/internal/channel/owner-listing", { session: reg.body.session })).status, 200, "the session made by the first runtime is good for the second");
      const so = await s.call("/internal/channel/owner-passkey", { body: { op: "signin_options" } });
      const sign = await s.call("/internal/channel/owner-passkey", { body: { op: "signin", response: softSignin(phone, so.body.options, rp.origin) } });
      assert.equal(sign.status, 200, "the passkey the first runtime kept signs in at the second");
      await op(s, "r-3", { op: "publish_form", category: "home", title: "Brass lamp", photos: [] });
      const rec2 = (await s.call("/status")).body.recordLength;
      await s.stop();

      await s.start(first);
      const v2 = (await s.call("/internal/channel/owner-listing", { owner: s.owner })).body;
      assert.deepEqual(v2.listings.map((l: { id: string }) => l.id), ["l-2", "l-1"], "what the second runtime wrote is read back, ids carried on");
      assert.equal((await s.call("/status")).body.recordLength, rec2);
      assert.equal((await feed(s)).signature.keyId, f1.signature.keyId);
      assert.equal((await s.call("/internal/channel/owner-listing", { session: sign.body.session })).status, 200);
      await op(s, "r-4", { op: "sold", id: "l-1" });
      assert.deepEqual((await s.call("/internal/channel/owner-listing", { owner: s.owner })).body.listings.map((l: { id: string }) => l.id), ["l-2"]);
    });
  }
});
