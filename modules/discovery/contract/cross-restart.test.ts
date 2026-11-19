// The directory stopped and started again on ONE data folder keeps what it had: the index (directory.sqlite: the feeds, the pinned keys, a held key change, the shops and their items, so
// the same shops are found at once, with no feed read), the key change a person accepted while it was stopped, and its signing key (directory.key, so the Agent Card keeps its key id).
// Until 19 Nov 2026 this test ran the TypeScript service and the Go one in turn on the folder (so a server moving to Go kept its volume: proved then, both ways); since the TypeScript
// directory was deleted (decision 61, wave 1c) it is the directory against itself across restarts.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { SKIP, directoryWith, fakeShop, until } from "./harness.ts";
import type { FakeDoor } from "./harness.ts";

const doors: FakeDoor[] = [];
after(async () => { for (const d of doors) await d.close(); });

test("the index, the pinned keys, a held key change, an accepted change and the signing key are kept across restarts on one folder", { skip: SKIP }, async () => {
  const a = fakeShop("alpha-pets", { name: "Alpha Pets" }), b = fakeShop("beta-pets", { name: "Beta Pets", town: "Kochi" });
  const { d, door } = await directoryWith([a, b]);
  doors.push(door);
  const found = async () => ((await d.searchJson({ q: "kitten" })).body.results as any[]).map((r) => r.shop.name).sort();
  const kid = async () => JSON.parse(Buffer.from((await d.call("/.well-known/agent-card.json")).body.signatures[0].protected, "base64url").toString("utf8")).kid;
  assert.deepEqual(await found(), ["Alpha Pets", "Beta Pets"]);
  const key = await kid();
  const reads = a.hits.feed + b.hits.feed;
  // started again: the same shops at once (no feed is due, so none is read), the same key, the same pins
  await d.stop();
  await d.start();
  assert.deepEqual(await found(), ["Alpha Pets", "Beta Pets"]);
  assert.equal(a.hits.feed + b.hits.feed, reads, "nothing was read again: the index was kept");
  assert.equal(await kid(), key);
  assert.equal(d.db().prepare("SELECT COUNT(*) AS n FROM pins").get()?.n, 2);
  // a feed signed by another key is held (the pin written before the restart is believed), listed, and accepted while the service is stopped
  await d.stop();
  a.rekey();
  d.makeDue(a.feedUrl);
  await d.start();
  await until("the change to be held", () => d.db().prepare("SELECT COUNT(*) AS n FROM key_changes").get()?.n === 1);
  assert.deepEqual(await found(), ["Beta Pets"]);
  await d.stop();
  await d.start();
  assert.deepEqual(await found(), ["Beta Pets"], "a held change is still held after a restart");
  assert.ok((await d.cli("changes")).out.includes(a.page));
  await d.stop();
  assert.equal((await d.cli("accept", a.page)).code, 0);
  // started again: the accepted pin is read and the shop is listed again; the key is still the same
  d.makeDue(a.feedUrl);
  await d.start();
  await until("the shop to be listed again", async () => (await found()).length === 2);
  assert.equal(await kid(), key);
  assert.equal((d.db().prepare("SELECT key_id FROM pins WHERE page = ?").get(a.page) as any).key_id, a.key.keyId);
  assert.equal(d.db().prepare("SELECT COUNT(*) AS n FROM key_changes").get()?.n, 0);
  await d.stop();
});
