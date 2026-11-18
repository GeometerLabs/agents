// The shop's side of the open protocol (modules/listings/protocol.ts, runtime/shop-protocol.ts): the feed is signed with the shop's key and a directory's own reader accepts it (and refuses it
// when a price is changed); a check answers from the record only (gone for anything not public, a counted listing at 0 is gone, at most ten ids, nothing about a buyer, read only), is signed and
// stamped, and the directory's own check reader accepts it; the card is signed and refused unless it is a card for this shop; the notice is signed, comes only for a real change and at most
// once a minute. Written, not run, in the 18 Nov build stream.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DAY } from "../../core/time.ts";
import { fakeClock } from "../../core/clock.ts";
import { createRecord } from "../../record/record.ts";
import { generateSigningKey, verifyCard, verifyDocument, verifyNotice } from "../../signing/index.ts";
import { createChecker } from "../../discovery/check.ts";
import { readFeed } from "../../discovery/feed.ts";
import { trustFeed } from "../../discovery/trust.ts";
import { createShopProtocol, NOTICE_EVERY_MS, underPage } from "../../runtime/shop-protocol.ts";
import { DirectoryIndex } from "../../discovery/index.ts";
import { handleNotice } from "../../discovery/notices.ts";
import { createListingsKit } from "../kit.ts";
import type { ListingOp } from "../kit.ts";
import { listingsOf } from "../listings.ts";
import { MAX_CHECK_IDS, checkIds } from "../protocol.ts";
import type { AssistantState } from "../../assistant/state.ts";

const NOW = 1_800_000_000_000;
const PAGE = "https://pages.example/rani-pets";
const PH = { id: "ph-0123456789ab", type: "image/jpeg" as const, width: 800, height: 600, bytes: 1000 };
const kit = createListingsKit<{ assistant?: AssistantState }>({ owner: { whatsapp: "+919000000000", language: "en" }, timezone: "Asia/Kolkata" });
const op = (o: ListingOp, id: string) => ({ kind: "owner_listing" as const, id, op: o });
const form = (title: string, extra: Partial<Extract<ListingOp, { op: "publish_form" }>> = {}): ListingOp => ({ op: "publish_form", category: "pets", title, priceInr: 8000, priceNote: "each", qty: 2, photos: [], ...extra });

/** A shop with two live listings (l-1 counted by the owner, l-2 not), its place and the switch on; `now` moves with the test. */
function shopWorld(visible = true) {
  const clock = fakeClock(NOW);
  const store: { assistant?: AssistantState } = {};
  const record = createRecord(clock);
  const run = (e: ReturnType<typeof op>) => kit.run(e, { store, record, nowMs: clock.now() });
  run(op({ op: "shop", visible, town: "Thrissur" }, "r-0"));
  run({ kind: "owner_photo", id: PH.id, photo: PH } as never);
  run(op(form("Persian kitten", { photos: [PH.id] }), "r-1"));
  run(op(form("Siamese cat", { priceInr: 5000, qty: undefined }), "r-2"));
  const key = generateSigningKey();
  const protocol = createShopProtocol({ read: () => kit.publicRead(store, clock.now()), key: () => key, now: () => clock.now(), name: () => "Rani Pets" });
  return { clock, store, record, run, key, protocol, state: () => listingsOf(store.assistant!) };
}
const feedOf = (w: ReturnType<typeof shopWorld>) => w.protocol.feed({ page: PAGE, name: "Rani Pets", languages: ["en", "ml"], chat: `${PAGE}/chat` })!;

test("the feed is signed with the shop's key, names its check and card, and the directory's own reader and key check accept it", () => {
  const w = shopWorld();
  const feed = feedOf(w) as any;
  assert.deepEqual(feed.shop.check, `${PAGE}/api/v1/check`);
  assert.deepEqual(feed.shop.agentCard, `${PAGE}/agent-card.json`);
  assert.equal(feed.shop.page, `${PAGE}/`);
  assert.ok(!("trade" in feed.shop), "the runtime cannot see the shop's trade, so the feed leaves it out");
  assert.ok(feed.items.every((i: any) => !Object.values(i.text).includes("")), "a listing with no text writes none, so the directory's reader keeps the item");
  assert.equal(feed.items[0].page.startsWith(`${PAGE}/shop#l-`), true, "an item's page is the storefront's tile");
  assert.deepEqual(feed.signature.keyId, w.key.keyId);
  assert.deepEqual(verifyDocument(feed), { ok: true, keyId: w.key.keyId });
  // the directory's own reader (the other half of the contract) takes it, and its trust rule pins the first key then recognises it
  const read = readFeed(JSON.parse(JSON.stringify(feed)), `${PAGE}/listings.json`);
  assert.ok(read.ok, JSON.stringify(read));
  assert.equal(read.feed.items.length, 2);
  const first = trustFeed(feed, undefined);
  assert.equal(first.state, "first");
  assert.equal(trustFeed(feed, (first as { pin: { keyId: string; key: string } }).pin).state, "same");
});

test("a changed price, a changed item or a stripped signature is refused", () => {
  const w = shopWorld();
  const feed = JSON.parse(JSON.stringify(feedOf(w)));
  assert.ok(verifyDocument(feed).ok);
  const cheaper = structuredClone(feed); cheaper.items[0].price.value = "1.00";
  assert.equal(verifyDocument(cheaper).ok, false);
  assert.equal(trustFeed(cheaper, undefined).state, "refused");
  const more = structuredClone(feed); more.items.push({ ...more.items[0], id: "l-99" });
  assert.equal(verifyDocument(more).ok, false);
  const other = structuredClone(feed); other.shop.name = "Not Rani Pets";
  assert.equal(verifyDocument(other).ok, false);
  const { signature: _s, ...bare } = feed;
  assert.equal(trustFeed(bare, undefined).state, "refused");
});

test("no feed and no card while the owner's switch is off, and a check then answers every id gone", () => {
  const w = shopWorld(false);
  assert.equal(w.protocol.feed({ page: PAGE, name: "Rani Pets", languages: ["en"] }), null);
  assert.equal(w.protocol.card({ page: PAGE, card: { supportedInterfaces: [{ url: `${PAGE}/api/v1` }], provider: { url: `${PAGE}/` } } }), null);
  const a = w.protocol.check({ page: PAGE, ids: ["l-1", "l-2"] }) as any;
  assert.deepEqual(a.items, [{ id: "l-1", availability: "gone" }, { id: "l-2", availability: "gone" }]);
  assert.ok(verifyDocument(a, w.key.publicKey).ok, "the all-gone answer is signed all the same");
  assert.equal(w.protocol.notice({ page: PAGE }), undefined, "no notice while it shows nothing");
});

test("a check answers from the record: price, quantity and freshness as the feed says them; anything else is gone; the answer is signed and stamped", () => {
  const w = shopWorld();
  const a = w.protocol.check({ page: PAGE, ids: ["l-1", "l-2", "l-77"] }) as any;
  assert.equal(a.format, "shop-check/1");
  assert.equal(a.page, `${PAGE}/`, "the page is exactly the feed's shop.page, so the directory accepts it");
  assert.equal(a.at, new Date(NOW).toISOString());
  const feed = feedOf(w) as any;
  for (const id of ["l-1", "l-2"]) {
    const inFeed = feed.items.find((i: any) => i.id === id);
    const got = a.items.find((i: any) => i.id === id);
    assert.deepEqual([got.availability, got.price, got.quantity, got.confirmed], [inFeed.availability, inFeed.price, inFeed.quantity, inFeed.confirmed], "the same as the feed says");
  }
  assert.deepEqual(a.items.find((i: any) => i.id === "l-77"), { id: "l-77", availability: "gone" }, "an id never seen is gone, and nothing says it never existed");
  assert.ok(verifyDocument(a, w.key.publicKey).ok);
  assert.equal(verifyDocument({ ...a, items: [{ id: "l-1", availability: "in_stock" }] }, w.key.publicKey).ok, false, "a changed answer fails");
  // the whole answer says no more than the feed would: no words, no photos, no category
  assert.ok(!/title|text|photos|category/u.test(JSON.stringify(a)));
});

test("a sold, removed, hidden or draft listing is gone; a counted listing at 0 is gone and comes back with a count; call_to_check after three days", () => {
  const w = shopWorld();
  const ids = ["l-1", "l-2"];
  const states = () => Object.fromEntries((w.protocol.check({ page: PAGE, ids }) as any).items.map((i: any) => [i.id, i.availability]));
  assert.deepEqual(states(), { "l-1": "in_stock", "l-2": "in_stock" });
  // l-1 is counted by the owner and runs out: it sells itself, nothing is written to the listing
  w.store.assistant!.stock = { lines: [{ id: "listing:l-1", count: 0, moves: [], lowFlag: false }], alerts: [] } as never;
  assert.equal(states()["l-1"], "gone", "stock 0 is gone");
  (w.store.assistant!.stock as any).lines[0].count = 3;
  assert.equal(states()["l-1"], "in_stock");
  assert.equal((w.protocol.check({ page: PAGE, ids: ["l-1"] }) as any).items[0].quantity, 3, "the count is the quantity");
  w.clock.advance(4 * DAY);
  assert.deepEqual(states(), { "l-1": "call_to_check", "l-2": "call_to_check" });
  w.run(op({ op: "sold", id: "l-2" }, "r-9"));
  assert.equal(states()["l-2"], "gone");
  w.run(op({ op: "remove", id: "l-1" }, "r-10"));
  assert.equal(states()["l-1"], "gone");
  w.clock.advance(40 * DAY);
  assert.deepEqual(states(), { "l-1": "gone", "l-2": "gone" }, "not confirmed for 30 days is gone");
});

test("a check changes nothing and is not written anywhere: the saved state and the record are the same after a hundred checks", () => {
  const w = shopWorld();
  const before = JSON.stringify(w.store);
  const length = w.record.entries().length;
  for (let i = 0; i < 100; i++) w.protocol.check({ page: PAGE, ids: ["l-1", "l-2", `l-${i}`] });
  assert.equal(JSON.stringify(w.store), before);
  assert.equal(w.record.entries().length, length);
});

test("the question: one to ten ids of the right shape and nothing about a buyer", () => {
  assert.deepEqual(checkIds({ ids: ["l-1", "l-1", "l-2"] }), { ok: true, ids: ["l-1", "l-2"] });
  assert.deepEqual(checkIds({ format: "shop-check/1", ids: ["l-1"] }), { ok: true, ids: ["l-1"] });
  assert.equal(checkIds({ ids: Array.from({ length: MAX_CHECK_IDS }, (_, i) => `l-${i}`) }).ok, true);
  assert.equal(checkIds({ ids: Array.from({ length: MAX_CHECK_IDS + 1 }, (_, i) => `l-${i}`) }).ok, false, "eleven is too many");
  for (const bad of [{}, { ids: [] }, { ids: "l-1" }, { ids: [1] }, { ids: ["../x"] }, { ids: ["l-1"], format: "shop-check/2" }, null, [], "l-1"]) assert.equal(checkIds(bad).ok, false, JSON.stringify(bad));
  // anything else in the question (a search, a place, who is asking) is simply not read: only ids reach the runtime
  assert.deepEqual(checkIds({ ids: ["l-1"], q: "kitten", lat: 10.5, buyer: "Asha" }), { ok: true, ids: ["l-1"] });
});

test("the directory's own check reader accepts the answer: signed by the pinned key, from just now, only the ids it asked about", async () => {
  const w = shopWorld();
  const answered: string[] = [];
  const fetch = async (_url: string, init: { body?: string }) => {
    answered.push(init.body ?? "");
    const ids = (JSON.parse(init.body ?? "{}") as { ids: string[] }).ids;
    return { status: 200, headers: {}, body: JSON.stringify(w.protocol.check({ page: PAGE, ids })) };
  };
  const checker = createChecker({ fetch: fetch as never, now: () => NOW });
  const out = await checker.check({ page: `${PAGE}/`, check: `${PAGE}/api/v1/check`, key: w.key.publicKey }, ["l-1", "l-2", "l-9"]);
  assert.equal(out.state, "answered");
  if (out.state === "answered") assert.deepEqual([...out.items.values()].map((i) => [i.id, i.availability]), [["l-1", "in_stock"], ["l-2", "in_stock"], ["l-9", "gone"]]);
  assert.deepEqual(JSON.parse(answered[0]), { format: "shop-check/1", ids: ["l-1", "l-2", "l-9"] }, "the question carries ids and nothing about the buyer");
  // an answer older than two minutes is ignored
  const late = createChecker({ fetch: fetch as never, now: () => NOW + 3 * 60_000 });
  assert.equal((await late.check({ page: `${PAGE}/`, check: `${PAGE}/api/v1/check`, key: w.key.publicKey }, ["l-1"])).state, "silent");
  // another key's answer is ignored
  const stranger = createChecker({ fetch: fetch as never, now: () => NOW });
  assert.equal((await stranger.check({ page: `${PAGE}/`, check: `${PAGE}/api/v1/check`, key: generateSigningKey().publicKey }, ["l-1"])).state, "silent");
});

test("the card is signed with the shop's key, and only a card for this shop is signed", () => {
  const w = shopWorld();
  const card = { name: "Rani Pets", supportedInterfaces: [{ url: `${PAGE}/mcp`, protocolBinding: "MCP", protocolVersion: "2025-11-25" }, { url: `${PAGE}/api/v1`, protocolBinding: "HTTPS-JSON", protocolVersion: "1" }], provider: { organization: "Rani Pets", url: `${PAGE}/` }, skills: [] };
  const signed = w.protocol.card({ page: PAGE, card }) as any;
  assert.ok(verifyCard(signed, w.key.publicKey));
  assert.equal(JSON.parse(Buffer.from(signed.signatures[0].protected, "base64url").toString()).kid, w.key.keyId, "the same key id as the feed");
  assert.equal(verifyCard({ ...signed, name: "Other" }, w.key.publicKey), false);
  for (const bad of [
    { ...card, supportedInterfaces: [{ url: "https://evil.example/mcp" }] },
    { ...card, supportedInterfaces: [] },
    { ...card, provider: { url: "https://evil.example/" } },
    { ...card, supportedInterfaces: [{ url: `${PAGE}.evil.example/mcp` }] },
    { ...card, supportedInterfaces: [{ url: `${PAGE}/../other-shop/mcp` }] },
    { ...card, supportedInterfaces: [{ url: `http://pages.example/rani-pets/mcp` }] },
    { ...card, supportedInterfaces: [{ url: `https://user:pw@pages.example/rani-pets/mcp` }] },
    { ...card, price: 1.5 },
    [], "x", null,
  ]) assert.equal(w.protocol.card({ page: PAGE, card: bad }), "bad", JSON.stringify(bad).slice(0, 60));
});

test("the notice: signed, only for a real change, never more than one a minute, and a restart sends one (a hint)", () => {
  const w = shopWorld();
  const first = w.protocol.notice({ page: PAGE })!;
  assert.ok(first, "a first notice is due");
  const n = first.notice as any;
  assert.equal(n.format, "shop-feed-changed/1");
  assert.equal(n.feed, `${PAGE}/listings.json`);
  assert.ok(verifyNotice(n, w.key.publicKey).ok);
  assert.equal(verifyNotice({ ...n, feed: "https://elsewhere.example/listings.json" }, w.key.publicKey).ok, false);
  assert.equal(w.protocol.notice({ page: PAGE })?.fingerprint, first.fingerprint, "until it is delivered, the same notice stays due");
  w.protocol.delivered(first.fingerprint);
  w.clock.advance(NOTICE_EVERY_MS + 1);
  assert.equal(w.protocol.notice({ page: PAGE }), undefined, "nothing changed, so nothing is sent");
  w.run(op({ op: "edit", id: "l-1", priceInr: 7000 }, "r-5"));
  const changed = w.protocol.notice({ page: PAGE })!;
  assert.ok(changed && changed.fingerprint !== first.fingerprint, "a changed price is a real change");
  w.protocol.delivered(changed.fingerprint);
  w.run(op({ op: "edit", id: "l-1", priceInr: 6500 }, "r-6"));
  assert.equal(w.protocol.notice({ page: PAGE }), undefined, "a second change inside a minute waits");
  w.clock.advance(NOTICE_EVERY_MS + 1);
  assert.ok(w.protocol.notice({ page: PAGE }), "and goes a minute later");
});

test("with no key (a store that keeps none) nothing is signed", () => {
  const w = shopWorld();
  const none = createShopProtocol({ read: () => kit.publicRead(w.store, NOW), key: () => undefined, now: () => NOW });
  assert.equal(none.feed({ page: PAGE, name: "x", languages: [] }), null);
  assert.equal(none.check({ page: PAGE, ids: ["l-1"] }), null);
  assert.equal(none.notice({ page: PAGE }), undefined);
});

test("what is under the shop's page is decided by parsing the address: a dot-dot, another scheme, another host or a user name is not", () => {
  assert.equal(underPage(PAGE, `${PAGE}/api/v1`), true);
  assert.equal(underPage(PAGE, `${PAGE}/`), true);
  assert.equal(underPage(PAGE, PAGE), true);
  for (const bad of [`${PAGE}/../other/mcp`, `${PAGE}/%2e%2e/other`, "http://pages.example/rani-pets/x", "https://pages.example/rani-petsx", "https://pages.example:8443/rani-pets/x", "https://u:p@pages.example/rani-pets/x", "https://evil.example/rani-pets/x", "not a url", 3, undefined]) assert.equal(underPage(PAGE, bad), false, String(bad));
});

test("turning the switch off after a notice went out is a change too: one notice for it, signed, and then none", () => {
  const w = shopWorld();
  const first = w.protocol.notice({ page: PAGE })!;
  w.protocol.delivered(first.fingerprint);
  w.clock.advance(NOTICE_EVERY_MS + 1);
  w.run(op({ op: "shop", visible: false }, "r-off"));
  const off = w.protocol.notice({ page: PAGE })!;
  assert.ok(off, "the directory is told, so it drops the shop now and not at its next six-hourly read");
  assert.equal((off.notice as any).feed, `${PAGE}/listings.json`);
  assert.ok(verifyNotice(off.notice as any, w.key.publicKey).ok);
  assert.match(off.fingerprint, /^[A-Za-z0-9_-]{43}$/u, "a fingerprint the runtime's own acknowledgement route accepts");
  w.protocol.delivered(off.fingerprint);
  w.clock.advance(NOTICE_EVERY_MS + 1);
  assert.equal(w.protocol.notice({ page: PAGE }), undefined, "and nothing more while it stays off");
  w.run(op({ op: "shop", visible: true }, "r-on"));
  assert.ok(w.protocol.notice({ page: PAGE }), "turned on again, the feed is a change again");
});

test("the directory's own notice handler takes the shop's notice: the address and the shape follow its rules", () => {
  const w = shopWorld();
  const ix = new DirectoryIndex(":memory:");
  const cfg = { index: ix, served: ["pages.example"], configured: [], now: () => NOW };
  const notice = w.protocol.notice({ page: PAGE })!.notice;
  assert.equal(handleNotice(cfg, notice).status, 202);
  assert.deepEqual(ix.feeds().map((f) => f.url), [`${PAGE}/listings.json`]);
  assert.equal(handleNotice({ ...cfg, served: ["other.example"] }, notice).status, 403, "not a domain this directory serves");
  assert.equal(handleNotice(cfg, { ...(notice as object), sig: "x".repeat(86) }).status, 202, "an unknown shop's hint is taken (it only gets the feed read); a known shop's must verify (discovery/test/notices.test.ts)");
});
