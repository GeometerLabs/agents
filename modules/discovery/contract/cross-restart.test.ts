// The TypeScript service and the Go service in turn on ONE data folder, so the files are proved interchangeable: the index (directory.sqlite: feeds, pinned keys, key changes, the shops
// and items) and the signing key (directory.key, so the Agent Card keeps its key id). Needs the Go binary (skipped, with the reason, when there is none): it is the one test that is about
// the two together.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { GO_BIN, directoryWith, fakeShop, until } from "./harness.ts";
import type { FakeDoor } from "./harness.ts";

const SKIP_BOTH = existsSync(GO_BIN) ? false : `there is no Go binary at ${GO_BIN} (build it: cd go && go build -o bin/directory ./cmd/directory)`;
const doors: FakeDoor[] = [];
after(async () => { for (const d of doors) await d.close(); });

test("the index, the pinned keys, a held key change and the signing key move between the two services both ways", { skip: SKIP_BOTH }, async () => {
  const a = fakeShop("alpha-pets", { name: "Alpha Pets" }), b = fakeShop("beta-pets", { name: "Beta Pets", town: "Kochi" });
  const { d, door } = await directoryWith([a, b]);
  doors.push(door);
  const found = async () => ((await d.searchJson({ q: "kitten" })).body.results as any[]).map((r) => r.shop.name).sort();
  const kid = async () => JSON.parse(Buffer.from((await d.call("/.well-known/agent-card.json")).body.signatures[0].protected, "base64url").toString("utf8")).kid;
  assert.deepEqual(await found(), ["Alpha Pets", "Beta Pets"]);
  const key = await kid();
  // Go on the TypeScript service's folder: the same shops at once (no feed is due), the same key, the same pins
  await d.stop();
  await d.start("go");
  assert.deepEqual(await found(), ["Alpha Pets", "Beta Pets"]);
  assert.equal(await kid(), key);
  assert.equal(d.db().prepare("SELECT COUNT(*) AS n FROM pins").get()?.n, 2);
  // a feed signed by another key is held by Go (the pin the TypeScript service wrote is believed), listed, and accepted
  await d.stop();
  a.rekey();
  d.makeDue(a.feedUrl);
  await d.start("go");
  await until("the change to be held", () => d.db().prepare("SELECT COUNT(*) AS n FROM key_changes").get()?.n === 1);
  assert.deepEqual(await found(), ["Beta Pets"]);
  assert.ok((await d.cli("changes")).out.includes(a.page));
  await d.stop();
  assert.equal((await d.cli("accept", a.page)).code, 0);
  // back to TypeScript: it reads Go's accepted pin and the shop is listed again; the key is still the same
  d.makeDue(a.feedUrl);
  await d.start("ts");
  await until("the shop to be listed again", async () => (await found()).length === 2);
  assert.equal(await kid(), key);
  assert.equal((d.db().prepare("SELECT key_id FROM pins WHERE page = ?").get(a.page) as any).key_id, a.key.keyId);
  assert.equal(d.db().prepare("SELECT COUNT(*) AS n FROM key_changes").get()?.n, 0);
});
