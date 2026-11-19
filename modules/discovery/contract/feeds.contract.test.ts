// Feeds, checks and notices as the directory's outside sees them: what a good feed does, every way a feed is refused, what a shop's answer to "do you still have these?" must be to
// be believed, the "my feed changed" notice, a feed that disappears, and a key that changes. Fake shops serve signed documents (signed with the TypeScript signing module) through a
// fake door; the directory is a separate process (the Go directory, go/cmd/directory) reached over HTTP, plus its index file read only (what a person could not see over HTTP).
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { sign as edSign } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { SKIP, answerFor, directoryWith, fakeShop, item, makeDirectory, startFakeDoor, until } from "./harness.ts";
import type { Directory, FakeDoor, FakeShop } from "./harness.ts";

const cleanups: (() => Promise<void>)[] = [];
after(async () => { for (const c of cleanups) await c(); });
async function up(shops: FakeShop[], o: Parameters<typeof directoryWith>[1] = {}): Promise<{ d: Directory; door: FakeDoor }> {
  const r = await directoryWith(shops, o);
  cleanups.push(() => r.door.close());
  return r;
}
const feedRow = (d: Directory, url: string) => d.db().prepare("SELECT error, gone_since, etag FROM feeds WHERE url = ?").get(url) as { error: string | null; gone_since: number | null; etag: string | null };
const found = async (d: Directory, q = "kitten", who?: string) => (await d.searchJson({ q }, who)).body.results as any[];

test("a good feed is listed, in the buyer's language, confirmed by the shop and with the shop's own chat address", { skip: SKIP }, async () => {
  const rani = fakeShop("rani-pets", { name: "Rani Pets" });
  const { d } = await up([rani]);
  const r = await d.searchJson({ q: "kitten", lang: "hi" });
  assert.equal(r.status, 200);
  assert.equal(r.body.format, "directory-search/1");
  assert.equal(r.body.results.length, 1);
  const x = r.body.results[0];
  assert.equal(x.shop.name, "Rani Pets");
  assert.equal(x.shop.page, rani.page);
  assert.equal(x.item.title, "फ़ारसी बिल्ली का बच्चा");
  assert.equal(x.item.lang, "hi");
  assert.equal(x.item.machineWritten, true);
  assert.deepEqual(x.item.price, { value: "8000.00", currency: "INR", note: "each" });
  assert.equal(x.item.availability, "in_stock");
  assert.equal(x.checked, true);
  assert.equal(x.chat, `${rani.page}chat?about=l-3`);
  assert.equal(r.body.order, "https://pages.example/order");
  assert.equal(r.body.next, null);
  // the shop was reached through the door's own port with the pages domain as the Host, and learned only the item ids
  assert.ok(rani.hits.hosts.every((h) => h === "pages.example"));
  assert.deepEqual(JSON.parse(rani.hits.checkBodies[0]), { format: "shop-check/1", ids: ["l-3"] });
  assert.match(d.log(), /The directory listens for https:\/\/pages\.example/u);
  // the pin: the first key seen for the shop page is kept
  const pin = d.db().prepare("SELECT key_id, key FROM pins WHERE page = ?").get(rani.page) as { key_id: string; key: string };
  assert.equal(pin.key_id, rani.key.keyId);
  assert.equal(pin.key, rani.key.publicKey);
});

test("a feed is refused, and the reason is kept, when it is badly signed, unsigned, signed over another canonical form, or too big", { skip: SKIP }, async () => {
  const mk = (slug: string) => fakeShop(slug);
  const tampered = mk("tampered"), unsigned = mk("unsigned"), noncanon = mk("noncanon"), big = mk("big-feed"), swapped = mk("swapped-key"), wrongcard = mk("wrong-alg");
  tampered.feedAnswer = () => JSON.stringify({ ...tampered.feed(), items: [item(tampered.page, "l-3", { price: { value: "1.00", currency: "INR" } })] }); // signed for other items
  unsigned.feedAnswer = () => { const { signature: _s, ...body } = unsigned.feed(); return JSON.stringify(body); };
  // signed with the right key, over the document as JSON.stringify writes it (members in the order written, not RFC 8785's sorted form)
  noncanon.feedAnswer = () => {
    const { signature: _s, ...body } = noncanon.feed();
    const sig = edSign(null, Buffer.from(JSON.stringify(body)), noncanon.key.privateKey).toString("base64url");
    return JSON.stringify({ ...body, signature: { alg: "Ed25519", keyId: noncanon.key.keyId, key: noncanon.key.publicKey, sig } });
  };
  big.feedAnswer = () => JSON.stringify(big.feed({ items: [item(big.page, "l-3", { text: { en: "x".repeat(1_100_000) } })] }));
  swapped.feedAnswer = () => { const f = swapped.feed() as any; f.signature.key = tampered.key.publicKey; return JSON.stringify(f); }; // its own id, another key
  wrongcard.feedAnswer = () => { const f = wrongcard.feed() as any; f.signature.alg = "RS256"; return JSON.stringify(f); };
  const good = mk("good-one");
  const { d } = await up([tampered, unsigned, noncanon, big, swapped, wrongcard, good]);
  assert.equal((await found(d)).length, 1, "only the good shop is listed");
  assert.equal((await found(d))[0].shop.page, good.page);
  assert.match(feedRow(d, tampered.feedUrl).error ?? "", /signature/u);
  assert.match(feedRow(d, unsigned.feedUrl).error ?? "", /not signed/u);
  assert.match(feedRow(d, noncanon.feedUrl).error ?? "", /signature/u);
  assert.match(feedRow(d, big.feedUrl).error ?? "", /too big|1 MB/u);
  assert.match(feedRow(d, swapped.feedUrl).error ?? "", /signature/u);
  assert.match(feedRow(d, wrongcard.feedUrl).error ?? "", /signature/u);
  assert.equal(d.db().prepare("SELECT COUNT(*) AS n FROM pins").get()?.n, 1, "a refused feed pins no key");
  assert.match(d.log(), /was refused/u);
});

test("a feed that is not the spec's shape is refused whole; one bad listing is dropped and the shop's others stay", { skip: SKIP }, async () => {
  const mk = (slug: string, over: Parameters<FakeShop["feed"]>[0]) => { const s = fakeShop(slug); s.feedAnswer = () => JSON.stringify(s.feed(over)); return s; };
  const elsewhere = mk("chat-elsewhere", { shop: { chat: "https://evil.example/chat" } });
  const otherPage = fakeShop("other-page"); otherPage.feedAnswer = () => JSON.stringify(otherPage.feed({ shop: { page: "https://pages.example/someone-else/", chat: "https://pages.example/someone-else/chat", check: "https://pages.example/someone-else/api/v1/check", agentCard: "https://pages.example/someone-else/c.json" } }));
  const http = mk("plain-http", { shop: { page: "http://pages.example/plain-http/" } });
  const badPin = mk("bad-pincode", { place: { pincode: "68000" } });
  const many = mk("too-many", { items: Array.from({ length: 201 }, (_, i) => item("https://pages.example/too-many/", `i-${i}`)) });
  const base = fakeShop("mixed-items");
  const p = base.page;
  base.items = [
    item(p, "ok-1"), item(p, "bad-page", { page: "https://evil.example/x" }), item(p, "bad-price", { price: { value: "8000", currency: "INR" } }), item(p, "bad-cat", { category: "weapons" }),
    item(p, "bad-photo", { photos: [{ url: "https://evil.example/p.jpg", type: "image/jpeg" }] }), item(p, "ok-1", { title: { en: "Duplicate" } }), item(p, "bad id!", {}), item(p, "ok-2", { price: null }),
  ];
  const { d } = await up([elsewhere, otherPage, http, badPin, many, base]);
  const all = (await d.searchJson({})).body.results as any[];
  assert.deepEqual(all.map((r) => r.shop.page), [base.page, base.page]);
  assert.deepEqual(all.map((r) => r.item.id).sort(), ["ok-1", "ok-2"]);
  assert.equal(all.find((r) => r.item.id === "ok-2").item.price, null);
  assert.equal(all.find((r) => r.item.id === "ok-1").item.title, "Persian kitten", "the second item with the same id is dropped");
  assert.match(feedRow(d, elsewhere.feedUrl).error ?? "", /chat address is not under its page/u);
  assert.match(feedRow(d, otherPage.feedUrl).error ?? "", /not at the address its shop's page names/u);
  assert.match(feedRow(d, http.feedUrl).error ?? "", /https address ending in \//u);
  assert.match(feedRow(d, badPin.feedUrl).error ?? "", /pincode/u);
  assert.match(feedRow(d, many.feedUrl).error ?? "", /more than 200 items/u);
});

test("a feed address that is not on a served pages domain is read directly and refused when it is not a public name", { skip: SKIP }, async () => {
  const door = await startFakeDoor();
  cleanups.push(() => door.close());
  const d = await makeDirectory({ door, feeds: ["https://127.0.0.1/x/listings.json", "https://localhost/y/listings.json", "https://intranet.internal/z/listings.json"] });
  cleanups.push(() => d.stop());
  await d.start();
  for (const u of ["https://127.0.0.1/x/listings.json", "https://localhost/y/listings.json", "https://intranet.internal/z/listings.json"]) {
    const e = (await until(`${u} to be tried`, () => (d.db().prepare("SELECT error FROM feeds WHERE url = ?").get(u) as { error: string } | undefined)?.error)) as string;
    assert.match(e, /not an address the directory reads/u);
  }
});

test("a shop's answer is believed only when it is signed by the pinned key, names the shop's page, is made just now and is about an item that was asked", { skip: SKIP }, async () => {
  const bad = (name: string, answer: (s: FakeShop, ids: string[]) => unknown) => { const s = fakeShop(name); s.checkAnswer = (ids) => answer(s, ids); return s; };
  const stranger = fakeShop("someone-else");
  const wrongKey = bad("wrong-key", (s, ids) => answerFor(s, ids.map((id) => ({ id, availability: "gone" as const })), undefined, stranger.key));
  const otherPage = bad("other-page-answer", (s, ids) => ({ ...answerFor(fakeShop("elsewhere"), ids.map((id) => ({ id, availability: "gone" as const }))) }));
  const old = bad("old-answer", (s, ids) => answerFor(s, ids.map((id) => ({ id, availability: "gone" as const })), new Date(Date.now() - 600_000).toISOString()));
  const future = bad("future-answer", (s, ids) => answerFor(s, ids.map((id) => ({ id, availability: "gone" as const })), new Date(Date.now() + 600_000).toISOString()));
  const unsigned = bad("unsigned-answer", (s, ids) => ({ format: "shop-check/1", page: s.page, at: new Date().toISOString(), items: ids.map((id) => ({ id, availability: "gone" })) }));
  const html = bad("html-answer", () => ({ status: 200, body: "<html>nope</html>" }));
  const err = bad("error-answer", () => ({ status: 500, body: "{}" }));
  const slow = bad("slow-answer", () => null);
  const { d } = await up([wrongKey, otherPage, old, future, unsigned, html, err, slow]);
  const t0 = Date.now();
  const r = (await d.searchJson({ q: "kitten" })).body.results as any[];
  const took = Date.now() - t0;
  assert.equal(r.length, 8, "an answer that is no good never removes a listing");
  assert.ok(r.every((x) => x.checked === false && x.item.availability === "call_to_check"), "every one is shown as 'call to check'");
  assert.ok(took < 5000, `the buyer is not kept waiting (${took} ms)`);
});

test("what the shop says replaces the index: gone is dropped, a new price and quantity are shown, an item that was not asked about cannot be added, and answers are kept 60 seconds", { skip: SKIP }, async () => {
  const shop = fakeShop("says-things", { items: [item("https://pages.example/says-things/", "a-1"), item("https://pages.example/says-things/", "a-2"), item("https://pages.example/says-things/", "a-3")] });
  shop.checkAnswer = (ids) => answerFor(shop, [
    { id: "a-1", availability: "gone" }, { id: "a-2", availability: "call_to_check", price: { value: "7500.00", currency: "INR" }, confirmed: "2026-11-18T01:00:00.000Z" },
    { id: "a-3", availability: "in_stock", price: null }, { id: "not-asked", availability: "in_stock" },
  ].filter((x) => x.id === "not-asked" || ids.includes(x.id)) as any);
  const { d } = await up([shop]);
  const r = await found(d);
  assert.deepEqual(r.map((x) => x.item.id).sort(), ["a-2", "a-3"]);
  const a2 = r.find((x) => x.item.id === "a-2"), a3 = r.find((x) => x.item.id === "a-3");
  assert.deepEqual(a2.item.price, { value: "7500.00", currency: "INR" });
  assert.equal(a2.item.confirmed, "2026-11-18T01:00:00.000Z");
  assert.equal(a2.item.availability, "call_to_check");
  assert.equal(a3.item.price, null, "the shop says 'ask me': the price goes");
  assert.equal(shop.hits.check, 1);
  await found(d); await found(d);
  assert.equal(shop.hits.check, 1, "the shop is not asked again within 60 seconds");
});

test("a notice for a shop the directory has not met makes it read the feed; refused notices change nothing", { skip: SKIP }, async () => {
  const known = fakeShop("known-shop");
  const { d, door } = await up([known]);
  const newShop = fakeShop("new-shop"); door.add(newShop);
  const post = (body: unknown, who?: string) => d.call("/feed-changed", { body, who });
  const unmet = await post(newShop.notice());
  assert.equal(unmet.status, 202);
  assert.deepEqual(unmet.body, { ok: true, message: "Thank you: the feed will be read again soon." });
  await until("the new shop to be listed", async () => (await d.searchJson({ q: "kitten" })).body.results.some((x: any) => x.shop.page === newShop.page));
  // for a known shop the notice must be its own: another key's is refused
  const stranger = fakeShop("stranger");
  assert.equal((await post(known.notice({}, stranger.key))).status, 403);
  assert.equal((await post(known.notice())).status, 202);
  // an address the directory does not serve, a plain-http one, a feed with a query, another file name
  for (const feed of ["https://other.example/x/listings.json", "http://pages.example/x/listings.json", "https://pages.example/x/listings.json?a=1", "https://pages.example/x/other.json", "https://pages.example:8443/x/listings.json", "https://pages.example/X/listings.json", "https://pages.example/a/b/listings.json"]) {
    assert.equal((await post(newShop.notice({ feed }))).status, 403, feed);
  }
  assert.equal((await post({ format: "shop-feed-changed/2", feed: newShop.feedUrl, updated: "x", keyId: "k", sig: "s" })).status, 400);
  assert.equal((await post([1])).status, 400);
  assert.equal((await post({})).status, 400);
  const huge = await d.call("/feed-changed", { raw: JSON.stringify({ pad: "x".repeat(3000) }), headers: { "content-type": "application/json" } });
  assert.equal(huge.status, 400);
  assert.equal((await d.call("/feed-changed", { raw: "not json{" })).status, 400);
  assert.equal((await d.call("/feed-changed", { method: "GET" })).status, 405);
  // at most 20 notices a minute from one address
  const who = d.visitor();
  const codes: number[] = [];
  for (let i = 0; i < 22; i++) codes.push((await post(known.notice(), who)).status);
  assert.deepEqual(codes.slice(0, 20), Array(20).fill(202));
  assert.deepEqual(codes.slice(20), [429, 429]);
  assert.equal(d.db().prepare("SELECT COUNT(*) AS n FROM feeds").get()?.n, 2, "refused notices added no feed");
});

test("a feed read again at most once a minute: a notice for a shop read just now does not read it again", { skip: SKIP }, async () => {
  const shop = fakeShop("once-a-minute");
  const { d } = await up([shop]);
  assert.equal(shop.hits.feed, 1);
  assert.equal((await d.call("/feed-changed", { body: shop.notice() })).status, 202);
  await new Promise((r) => setTimeout(r, 1200));
  assert.equal(shop.hits.feed, 1, "inside the minute");
});

test("a feed that answers 404 keeps its items for a day and is then dropped; its pinned key stays", { skip: SKIP }, async () => {
  const shop = fakeShop("going-away");
  const { d, door } = await up([shop]);
  assert.equal((await found(d)).length, 1);
  await d.stop();
  shop.feedAnswer = () => ({ status: 404, body: "{}" });
  d.makeDue(shop.feedUrl);
  await d.start();
  await until("the 404 to be noted", () => feedRow(d, shop.feedUrl).gone_since);
  assert.match(feedRow(d, shop.feedUrl).error ?? "", /404/u);
  assert.equal((await found(d)).length, 1, "a shop that is down for a moment is not removed");
  // a day later (the note moved back a day and a second): dropped
  await d.stop();
  const w = new DatabaseSync(join(d.dataDir, "directory.sqlite"));
  w.prepare("UPDATE feeds SET gone_since = gone_since - 86401000, checked_at = NULL WHERE url = ?").run(shop.feedUrl);
  w.close();
  await d.start();
  await until("the feed to be dropped", () => d.db().prepare("SELECT COUNT(*) AS n FROM feeds WHERE url = ?").get(shop.feedUrl)?.n === 0);
  assert.equal((await found(d)).length, 0);
  assert.equal(d.db().prepare("SELECT COUNT(*) AS n FROM pins").get()?.n, 1);
  assert.match(d.log(), /was dropped/u);
  void door;
});

test("a feed signed by another key than the pinned one is held for a person: hidden from search, listed by `changes`, taken back by `accept`", { skip: SKIP }, async () => {
  const shop = fakeShop("lost-its-folder");
  const { d } = await up([shop]);
  assert.equal((await found(d)).length, 1);
  const first = shop.key.keyId;
  await d.stop();
  shop.rekey();
  d.makeDue(shop.feedUrl);
  await d.start();
  await until("the change to be held", () => d.db().prepare("SELECT COUNT(*) AS n FROM key_changes").get()?.n === 1);
  assert.equal((await found(d)).length, 0, "its items leave every search");
  const viaMcp = await d.call("/mcp", { body: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "shop_page", arguments: { shop: shop.page } } } });
  assert.equal(viaMcp.body.result?.isError, true, "and an assistant asking for the held shop's page is told it is not found (mcp.test.ts carried over)");
  assert.match(d.log(), /a key change waits for a person/u);
  assert.equal((d.db().prepare("SELECT pinned_key_id, offered_key_id FROM key_changes").get() as any).pinned_key_id, first);
  const listed = await d.cli("changes");
  assert.equal(listed.code, 0);
  assert.ok(listed.out.includes(shop.page) && listed.out.includes(first) && listed.out.includes(shop.key.keyId), listed.out);
  const refused = await d.cli("accept", "https://pages.example/nobody/");
  assert.equal(refused.code, 1);
  assert.match(refused.out, /No key change waits for that shop page/u);
  await d.stop();
  const ok = await d.cli("accept", shop.page);
  assert.equal(ok.code, 0);
  assert.match(ok.out, /Accepted/u);
  d.makeDue(shop.feedUrl);
  await d.start();
  await until("the shop to be listed again", async () => (await found(d)).length === 1);
  assert.equal((d.db().prepare("SELECT key_id FROM pins WHERE page = ?").get(shop.page) as any).key_id, shop.key.keyId);
  assert.equal(d.db().prepare("SELECT COUNT(*) AS n FROM key_changes").get()?.n, 0);
  const none = await d.cli("changes");
  assert.match(none.out, /No key change waits/u);
});

test("what the buyer typed never reaches a shop, and nothing about the buyer is kept but a count", { skip: SKIP }, async () => {
  const shop = fakeShop("watching");
  const { d } = await up([shop]);
  await d.searchJson({ q: "kitten", town: "Thrissur", lat: "10.52", lon: "76.21" });
  for (const b of shop.hits.checkBodies) assert.deepEqual(Object.keys(JSON.parse(b)).sort(), ["format", "ids"]);
  assert.ok(!shop.hits.checkBodies.join("").includes("Thrissur"));
  await d.searchJson({ q: "zebra" }, "198.51.100.5");
  const counts = d.db().prepare("SELECT day, kind, n FROM counts").all() as { day: string; kind: string; n: number }[];
  assert.deepEqual(counts.map((c) => c.kind).sort(), ["results", "searches"]);
  // the values, and nothing else: two searches, one result, under India's day (index.test.ts and http.test.ts carried over)
  assert.deepEqual(Object.fromEntries(counts.map((c) => [c.kind, c.n])), { searches: 2, results: 1 });
  assert.match(counts[0].day, /^\d{4}-\d{2}-\d{2}$/u);
  assert.deepEqual((d.db().prepare("PRAGMA table_info(counts)").all() as { name: string }[]).map((c) => c.name), ["day", "kind", "n"]);
  const tables = (d.db().prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name);
  for (const t of tables) assert.ok(!/search|query|visitor|address|session|cookie/iu.test(t.replace("items_fts", "")), `a table called ${t} would keep what a person searched`);
  const dump = JSON.stringify(d.db().prepare("SELECT * FROM counts").all());
  assert.ok(!dump.includes("198.51.100.5") && !dump.includes("zebra"));
  assert.ok(!d.log().includes("kitten"), "the log never holds a search");
});
