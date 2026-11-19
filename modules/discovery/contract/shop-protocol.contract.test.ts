// The two halves of the open protocol meet: the feed, the check answer and the notice made by THE SHOPS' OWN CODE (modules/runtime/shop-protocol.ts over the listings kit, what every
// TypeScript runtime serves) are served by the fake door, and the directory (a separate process) must accept them. The other contract files sign their fake shops with
// modules/signing directly; this one uses the shop side as it is. It holds the checks modules/listings/test/protocol.test.ts made with the TypeScript directory's own reader
// (readFeed, trustFeed, createChecker, handleNotice) before that reader was deleted (decision 61, wave 1c).
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { fakeClock } from "../../core/clock.ts";
import { createRecord } from "../../record/record.ts";
import { generateSigningKey } from "../../signing/index.ts";
import { createShopProtocol } from "../../runtime/shop-protocol.ts";
import { createListingsKit } from "../../listings/kit.ts";
import type { ListingOp } from "../../listings/kit.ts";
import type { AssistantState } from "../../assistant/state.ts";
import { ORIGIN, SKIP, directoryWith, fakeShop, startFakeDoor, until } from "./harness.ts";
import type { Directory, FakeDoor, FakeShop } from "./harness.ts";

const closers: (() => Promise<void>)[] = [];
after(async () => { for (const c of closers) await c(); });

const kit = createListingsKit<{ assistant?: AssistantState }>({ owner: { whatsapp: "+919000000000", language: "en" }, timezone: "Asia/Kolkata" });
const op = (o: ListingOp, id: string) => ({ kind: "owner_listing" as const, id, op: o });
const form = (title: string, extra: Partial<Extract<ListingOp, { op: "publish_form" }>> = {}): ListingOp => ({ op: "publish_form", category: "pets", title, priceInr: 8000, priceNote: "each", qty: 2, photos: [], ...extra });

/** A shop as its runtime holds it: two live listings (l-1 counted by the owner, l-2 not), its town, the switch on; the protocol over its public read, on the machine's clock. */
function shopWorld(slug: string) {
  const page = `${ORIGIN}/${slug}`;
  const clock = fakeClock(Date.now());
  const store: { assistant?: AssistantState } = {};
  const record = createRecord(clock);
  const run = (e: ReturnType<typeof op>) => kit.run(e, { store, record, nowMs: clock.now() });
  run(op({ op: "shop", visible: true, town: "Thrissur" }, "r-0"));
  run(op(form("Persian kitten"), "r-1"));
  run(op(form("Siamese cat", { priceInr: 5000, qty: undefined }), "r-2"));
  const key = generateSigningKey();
  const protocol = createShopProtocol({ read: () => kit.publicRead(store, Date.now()), key: () => key, now: () => Date.now(), name: () => "Rani Pets" });
  const feed = () => protocol.feed({ page, name: "Rani Pets", languages: ["en", "ml"], chat: `${page}/chat` })!;
  // the fake door serves this shop's own documents: its feed, and its answer to a check
  const served: FakeShop = Object.assign(fakeShop(slug), {
    key,
    feedAnswer: () => JSON.stringify(feed()),
    checkAnswer: (ids: string[]) => protocol.check({ page, ids }),
  });
  return { page, store, run, key, protocol, feed, served };
}

async function up(shops: FakeShop[]): Promise<{ d: Directory; door: FakeDoor }> {
  const r = await directoryWith(shops);
  closers.push(() => r.door.close());
  return r;
}
const results = async (d: Directory, q = "persian siamese kitten cat") => (await d.searchJson({ q })).body.results as any[];

test("the feed a shop's runtime signs is read and its key pinned; its check answer is believed; a listing it says is gone is dropped", { skip: SKIP }, async () => {
  const w = shopWorld("rani-pets");
  const sells = shopWorld("sells-one");
  const { d } = await up([w.served, sells.served]);
  const feed = w.feed() as any;
  // the directory pinned the key the shop signs with
  assert.equal((d.db().prepare("SELECT key_id FROM pins WHERE page = ?").get(`${w.page}/`) as any)?.key_id, w.key.keyId);
  // after its feed was read, the second shop's owner sells a listing: the index still has it, the shop's own answer says it is gone
  const [kept, sold] = ((sells.feed() as any).items as { id: string }[]).map((i) => i.id);
  sells.run(op({ op: "sold", id: sold }, "r-9"));
  const all = await results(d);
  const mine = all.filter((r) => r.shop.page === `${w.page}/`);
  assert.deepEqual(mine.map((r) => r.item.id).sort(), feed.items.map((i: any) => i.id).sort(), "both listings, at the storefront's tiles");
  for (const r of mine) {
    assert.equal(r.shop.name, "Rani Pets");
    assert.ok(r.checked, "the shop's own signed answer, from just now, was believed");
    assert.equal(r.item.availability, "in_stock");
    assert.ok(r.chat.startsWith(`${w.page}/chat?about=`));
  }
  assert.equal(mine.find((r) => r.item.id === feed.items[0].id)?.item.price?.value, feed.items[0].price.value);
  assert.deepEqual(all.filter((r) => r.shop.page === `${sells.page}/`).map((r) => r.item.id), [kept], "the sold listing is not shown: the shop said it is gone");
});

test("a feed changed after the shop signed it is refused, and the reason kept", { skip: SKIP }, async () => {
  const w = shopWorld("tampered-pets");
  const cheaper = JSON.parse(JSON.stringify(w.feed()));
  cheaper.items[0].price.value = "1.00";
  const door = await startFakeDoor(Object.assign(w.served, { feedAnswer: () => JSON.stringify(cheaper) }));
  closers.push(() => door.close());
  const { d } = await directoryWith([], { door, feeds: [w.served.feedUrl] });
  await until("the feed to be read", () => (d.db().prepare("SELECT checked_at FROM feeds WHERE url = ?").get(w.served.feedUrl) as any)?.checked_at);
  assert.deepEqual(await results(d), []);
  assert.match(String((d.db().prepare("SELECT error FROM feeds WHERE url = ?").get(w.served.feedUrl) as any)?.error), /signature/u);
});

test("the notice a shop's runtime signs is taken: for a shop not met yet it makes the directory read the feed, and for a known shop it must be signed by the pinned key", { skip: SKIP }, async () => {
  const known = shopWorld("known-pets");
  const { d, door } = await up([known.served]);
  const post = (body: unknown) => d.call("/feed-changed", { body });
  // a known shop's own notice
  const n = known.protocol.notice({ page: known.page })!;
  assert.equal(n.notice && (n.notice as any).feed, `${known.page}/listings.json`);
  assert.equal((await post(n.notice)).status, 202);
  // the same notice changed after signing (another feed of the same shop) is refused for a known shop
  assert.equal((await post({ ...(n.notice as object), updated: "2020-01-01T00:00:00.000Z" })).status, 403);
  // a shop not met yet: its runtime's notice makes the directory read its feed
  const fresh = shopWorld("new-pets");
  door.add(fresh.served);
  assert.equal((await post(fresh.protocol.notice({ page: fresh.page })!.notice)).status, 202);
  await until("the new shop to be listed", async () => (await results(d)).some((r) => r.shop.page === `${fresh.page}/`));
  // a shop not met yet with a signature that is junk: its hint is still taken (it only gets the feed read, which must then verify)
  const stranger = shopWorld("hint-pets");
  door.add(stranger.served);
  assert.equal((await post({ ...(stranger.protocol.notice({ page: stranger.page })!.notice as object), sig: "x".repeat(86) })).status, 202);
});
