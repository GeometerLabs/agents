// The CONTRACT of the owner's Stock page (block S, phase A3) on a listings-only shop: GET/POST /internal/channel/owner-stock, what each op does to the one stock count, what the
// public read and the owner's listings show of it, the record's `stock` lines, the Confirm button's restore of a listing that sold itself at 0, and the count surviving restarts on
// one folder (until 19 Nov 2026 the TypeScript and Go runtimes took turns on it; since the TypeScript runtime was deleted, decision 61 wave 1b, it is the Go shop stopped and started
// again). Like listings.contract.test.ts it starts the shop as a separate process and talks to it only over HTTP; the one place it looks inside is the shop's own file (agent.db, read
// with node:sqlite after the shop is stopped), for what no route shows: the record's lines, the low-mark alerts and the keys that stop a double count. Assertions are on status codes
// and machine fields (`why`, ids, counts), never on English sentences.
//
// Two things in the TypeScript behaviour that the cases pin down because they are easy to get wrong in another language: lengths are UTF-16 units (31 emoji are 62), and a counted listing
// takes its name from the listing in the OWNER's language when the page sends none (so a long listing title is refused in the step, after the page's pre-check passed).
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { canonicalJson } from "../../../../modules/record/record.ts";
import { keyedDigest } from "../../../../modules/record/fingerprint.ts";
import { draftAnswer, makeShop, PAGE, SKIP, startFakeModel } from "./harness.ts";
import type { FakeModel, Shop } from "./harness.ts";
import { goldenFor } from "./golden.ts";

const shops: Shop[] = [];
const fakes: FakeModel[] = [];
after(async () => { for (const s of shops) { await s.stop(); s.cleanup(); } for (const f of fakes) await f.close(); });

const golden = goldenFor(import.meta.url);
const PATH = "/internal/channel/owner-stock";
const L1 = "listing:l-1";
const L2 = "listing:l-2";

async function boot(o: Parameters<typeof makeShop>[0] = {}): Promise<Shop> { const s = await makeShop(o); shops.push(s); await s.start(); return s; }
const KITTENS = { op: "publish_form", category: "pets", title: "Two Persian kittens", priceInr: 8000, qty: 2, photos: [] };
async function listingOp(s: Shop, id: string, op: Record<string, unknown>): Promise<void> {
  const r = await s.call("/internal/channel/owner-listing", { owner: s.owner, body: { id, op } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  await s.settle();
}
const ownerList = async (s: Shop): Promise<any> => (await s.call("/internal/channel/owner-listing", { owner: s.owner })).body;
const publicRead = async (s: Shop): Promise<any> => (await s.call("/internal/channel/listings")).body;
const withSwitch = async (s: Shop): Promise<void> => listingOp(s, "sw-1", { op: "shop", visible: true });

/** One op through the page, accepted (200) and run. */
async function stock(s: Shop, id: string, op: Record<string, unknown>): Promise<any> {
  const r = await s.call(PATH, { owner: s.owner, body: { id, op } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  await s.settle();
  return r.body;
}
/** One op the shop's rules refuse at the page's pre-check: 422 with the machine word in `why`, and nothing saved. */
async function refused(s: Shop, id: string, op: Record<string, unknown>, why: string): Promise<void> {
  const r = await s.call(PATH, { owner: s.owner, body: { id, op } });
  assert.equal(r.status, 422, JSON.stringify(r.body)); assert.equal(r.body.why, why); assert.equal(typeof r.body.error, "string");
}
const page = async (s: Shop, lang?: string): Promise<any> => (await s.call(`${PATH}${lang ? `?lang=${lang}` : ""}`, { owner: s.owner })).body;
/** The rows with their clocks left out (a move's `atMs` is the shop's time). */
const rowsOf = (v: any): any[] => v.rows.map((r: any) => ({ ...r, moves: r.moves.map(({ atMs, ...m }: any) => { assert.equal(typeof atMs, "number"); return m; }) }));
const noClocks = (x: unknown): any => JSON.parse(JSON.stringify(x), (k, v) => (k === "atMs" || k === "startedMs" ? 0 : v));

/** The shop's stock state as saved in its file (the shop must be stopped): the shape with its lists put back from `state_rows`, as modules/runtime/store.ts keeps them. */
function savedStock(s: Shop): any {
  const db = new DatabaseSync(join(s.dataDir, "agent.db"), { readOnly: true });
  try {
    const shape = db.prepare("SELECT shape, lists FROM state_shape WHERE id = 1").get() as { shape: string; lists: string };
    const doc = JSON.parse(shape.shape);
    for (const name of JSON.parse(shape.lists) as string[]) {
      const path = JSON.parse(name) as string[];
      const rows = (db.prepare("SELECT value FROM state_rows WHERE list = ? ORDER BY pos").all(name) as { value: string }[]).map((r) => JSON.parse(r.value));
      let at = doc;
      for (const p of path.slice(0, -1)) at = at[p];
      at[path[path.length - 1]] = rows;
    }
    return doc.assistant?.stock;
  } finally { db.close(); }
}
function savedRecord(s: Shop): { action: string; outcome: string; entry: any }[] {
  const db = new DatabaseSync(join(s.dataDir, "agent.db"), { readOnly: true });
  try { return (db.prepare("SELECT action, outcome, entry FROM record ORDER BY seq").all() as { action: string; outcome: string; entry: string }[]).map((r) => ({ ...r, entry: JSON.parse(r.entry) })); } finally { db.close(); }
}
const recordKey = (s: Shop): Buffer => Buffer.from(readFileSync(join(s.root, "secrets", "record_key"), "utf8").trim(), "hex");

describe("the Stock page needs the owner", { skip: SKIP }, () => {
  test("no link, a wrong link or no channel token is refused; an empty shop has nothing to count", async () => {
    const s = await boot();
    assert.equal((await s.call(PATH)).status, 403);
    assert.equal((await s.call(PATH, { owner: "A".repeat(43) })).status, 403);
    assert.equal((await s.call(PATH, { token: null, owner: s.owner })).status, 401);
    const post = await s.call(PATH, { body: { id: "s-1", op: { op: "start", id: L1, count: 3 } } });
    assert.equal(post.status, 403, "a customer-side caller (the channel token alone) cannot write the count");
    await s.settle();
    assert.deepEqual(await page(s), { rows: [], candidates: [], attention: 0 });
    assert.equal((await s.call(PATH, { owner: s.owner, method: "PUT", body: {} })).status, 405);
    assert.equal((await s.call("/status")).body.recordLength, 0, "the refused write left no line in the record");
  });
});

describe("what the owner may count", { skip: SKIP }, () => {
  test("live listings are candidates, in creation order; counting one takes it off the list; a sold or removed one is not offered", async () => {
    const s = await boot();
    await listingOp(s, "r-1", KITTENS);
    await listingOp(s, "r-2", { op: "publish_form", category: "home", title: "Brass lamp", photos: [] });
    await listingOp(s, "r-3", { op: "publish_form", category: "home", title: "Clay pot", photos: [] });
    const names = (v: any) => v.candidates.map((c: any) => [c.id, c.name]);
    assert.deepEqual(names(await page(s)), [[L1, "Two Persian kittens"], [L2, "Brass lamp"], ["listing:l-3", "Clay pot"]]);
    assert.deepEqual(names(await page(s, "ml")), names(await page(s)), "a listing with no Malayalam words is named in the owner's own words");
    assert.deepEqual(names(await page(s, "xx")), names(await page(s)), "a language the shop does not have is the owner's own");
    await stock(s, "s-1", { op: "start", id: L1, count: 4 });
    await listingOp(s, "r-4", { op: "sold", id: "l-2" });
    await listingOp(s, "r-5", { op: "remove", id: "l-3" });
    const v = await page(s);
    assert.deepEqual(v.candidates, [], "counted, sold and removed listings are not offered");
    assert.equal(v.rows.length, 1); assert.equal(v.attention, 0);
  });

  test("a listing the model wrote in four languages is offered in the language asked (drafted and shown through the card, then read after a restart)", async () => {
    const fake = await startFakeModel(() => ({ ...draftAnswer() as object, titles: { en: "Kittens", hi: "बिल्ली", ml: "പൂച്ച", kn: "ಬೆಕ್ಕು" } })); fakes.push(fake);
    const s = await makeShop({ modelPort: fake.port, budget: { monthlyMicroInr: 50_000_000, daily: { listing_draft: 10 } } }); shops.push(s);
    await s.start();
    await s.call("/internal/channel/events", { owner: s.owner, body: { events: [{ kind: "owner_message", id: "u-1", text: "Kittens for sale on my page, 500 rupees" }] } });
    await s.settle();
    const card = (await s.call("/internal/channel/owner", { owner: s.owner })).body.app.cards[0];
    assert.equal((await s.call("/internal/channel/events", { owner: s.owner, body: { events: [{ kind: "owner_action", id: "a-1", action: "card_yes", case: card.id, digest: card.digest }] } })).status, 200);
    await s.settle();
    await s.stop(); await s.start();
    const name = async (lang?: string) => (await page(s, lang)).candidates[0].name;
    assert.equal(await name(), "Kittens"); assert.equal(await name("en"), "Kittens");
    assert.equal(await name("hi"), "बिल्ली"); assert.equal(await name("ml"), "പൂച്ച"); assert.equal(await name("kn"), "ಬೆಕ್ಕು");
    await stock(s, "s-1", { op: "start", id: L1, count: 2 });
    // the line took the name in the owner's language when the page sent none, and keeps it whatever language the page is read in
    for (const lang of [undefined, "ml", "kn"]) assert.equal((await page(s, lang)).rows[0].name, "Kittens");
    assert.deepEqual((await page(s, "ml")).candidates, []);
  });
});

describe("the five ops, and what the public sees of the count", { skip: SKIP }, () => {
  test("start, sold, correct, low, stop: each shows in the next read, and a counted listing shows its count on the public page", async () => {
    const s = await boot();
    await listingOp(s, "r-1", KITTENS); await withSwitch(s);
    const qty = async () => (await publicRead(s)).listings.map((l: any) => [l.id, l.qty]);
    assert.deepEqual(await qty(), [["l-1", 2]], "uncounted: the owner's own number");

    await stock(s, "s-1", { op: "start", id: L1, count: 5, low: 2, unit: "pc" });
    assert.deepEqual(rowsOf(await page(s)), [{ id: L1, name: "Two Persian kittens", unit: "pc", count: 5, low: 2, isLow: false, soldOut: false, kind: "listing", moves: [{ kind: "started", delta: 5, after: 5, by: "owner" }] }]);
    assert.deepEqual(await qty(), [["l-1", 5]], "a counted listing shows its count as its quantity");
    assert.equal((await s.call("/internal/channel/shop-check", { body: { page: PAGE, ids: ["l-1"] } })).body.items[0].quantity, 5, "and so does the signed check answer");
    const mine = (await ownerList(s)).listings[0];
    assert.equal(mine.counted, true); assert.equal(mine.qty, 5); assert.ok(!mine.soldOut);

    await stock(s, "s-2", { op: "sold", id: L1, qty: 2 });
    assert.deepEqual(rowsOf(await page(s))[0].moves[0], { kind: "sold", delta: -2, after: 3, by: "owner" }, "the newest move is first");
    assert.deepEqual(await qty(), [["l-1", 3]]);

    await stock(s, "s-3", { op: "correct", id: L1, to: 4, shown: 3 });
    let row = rowsOf(await page(s))[0];
    assert.equal(row.count, 4); assert.deepEqual(row.moves.map((m: any) => m.kind), ["corrected", "sold", "started"]);
    assert.deepEqual(row.moves[0], { kind: "corrected", delta: 1, after: 4, by: "owner" });

    await stock(s, "s-4", { op: "low", id: L1, low: 4 });
    row = rowsOf(await page(s))[0];
    assert.equal(row.low, 4); assert.equal(row.isLow, true, "the count is at the new low mark"); assert.equal((await page(s)).attention, 1);
    await stock(s, "s-5", { op: "low", id: L1, low: null });
    row = rowsOf(await page(s))[0];
    assert.equal("low" in row, false, "the mark is cleared"); assert.equal(row.isLow, false);

    await stock(s, "s-6", { op: "correct", id: L1, to: 0 });
    assert.deepEqual((await publicRead(s)).listings, [], "a counted listing at 0 sells itself: it leaves the public page");
    const sold = (await ownerList(s)).listings[0];
    assert.equal(sold.counted, true); assert.equal(sold.soldOut, true); assert.equal(sold.qty, 0, "the owner still sees it, at 0");
    assert.equal((await page(s)).attention, 1); assert.equal(rowsOf(await page(s))[0].soldOut, true);
    const check = await s.call("/internal/channel/shop-check", { body: { page: PAGE, ids: ["l-1"] } });
    assert.deepEqual(check.body.items, [{ id: "l-1", availability: "gone" }], "the signed check answer says gone too");

    await stock(s, "s-7", { op: "stop", id: L1 });
    assert.deepEqual((await page(s)).rows, []);
    assert.deepEqual((await page(s)).candidates.map((c: any) => c.id), [L1], "an item that is no longer counted is offered again");
    assert.deepEqual(await qty(), [["l-1", 2]], "stopped: the listing is as it was, with the owner's own number, and shows again");
    assert.equal(!("counted" in (await ownerList(s)).listings[0]), true);
  });

  test("a sale bigger than the count takes what is there and notes the shortfall; rows list sold out first, then low, then by name", async () => {
    const s = await boot();
    await stock(s, "s-1", { op: "start", id: "menu:thali", count: 1, name: "Thali" });
    await stock(s, "s-2", { op: "sold", id: "menu:thali", qty: 3 });
    assert.deepEqual(rowsOf(await page(s))[0], { id: "menu:thali", name: "Thali", count: 0, isLow: false, soldOut: true, kind: "menu", moves: [{ kind: "sold", delta: -1, after: 0, by: "owner", short: 2 }, { kind: "started", delta: 1, after: 1, by: "owner" }] });
    // other kinds of item and ids the shop has no listing for are counted as asked; their name is the one the page sent, else the id
    await stock(s, "s-3", { op: "start", id: "supply:rice", count: 10, low: 10 });
    await stock(s, "s-4", { op: "start", id: "supply:atta", count: 9, name: "atta", unit: "kg" });
    await stock(s, "s-5", { op: "start", id: "supply:Dal", count: 9, name: "Dal" });
    await stock(s, "s-6", { op: "start", id: "supply:bean", count: 9, name: "bean" });
    const v = await page(s);
    assert.deepEqual(v.rows.map((r: any) => r.id), ["menu:thali", "supply:rice", "supply:atta", "supply:bean", "supply:Dal"], "sold out, then low, then by name (atta < bean < Dal, as localeCompare)");
    assert.equal(v.rows[1].name, "supply:rice", "no name sent and no listing: the id"); assert.equal(v.rows[1].isLow, true);
    assert.equal(v.attention, 2);
    assert.deepEqual(v.rows.map((r: any) => r.kind), ["menu", "supply", "supply", "supply", "supply"]);
  });

  test("the last five moves show, newest first, while 30 are kept", async () => {
    const s = await boot();
    await stock(s, "s-0", { op: "start", id: L1, count: 100 });
    for (let i = 1; i <= 34; i++) await stock(s, `s-${i}`, { op: "sold", id: L1, qty: 1 });
    const row = (await page(s)).rows[0];
    assert.deepEqual(row.moves.map((m: any) => m.after), [66, 67, 68, 69, 70]);
    await s.stop();
    const line = savedStock(s).lines[0];
    assert.equal(line.moves.length, 30, "35 moves were made and the newest 30 are kept");
    assert.equal(line.moves[0].after, 95); assert.equal(Object.keys(line.applied).length, 34, "the keys that stop a double count are kept longer than the moves");
  });
});

// `bad_id` cannot be reached through the page: the shape check answers 400 for an item id that does not look like one, and the page never sends the `aliases` that are its other cause.
describe("the rules refuse at the page (422 with a why) and the shape is checked first (400)", { skip: SKIP }, () => {
  test("bad_count, bad_low and bad_text (a count, a low mark, a name or unit too long in UTF-16 units)", async () => {
    const s = await boot();
    for (const count of [-1, 1.5, 1_000_001]) await refused(s, "x-1", { op: "start", id: L1, count }, "bad_count");
    assert.equal((await s.call(PATH, { owner: s.owner, body: { id: "x-1", op: { op: "start", id: L1, count: 1_000_000 } } })).status, 200, "a million is the most");
    await s.settle();
    await stock(s, "s-0", { op: "stop", id: L1 });
    for (const low of [-1, 2.5, 1_000_001]) await refused(s, "x-2", { op: "start", id: L1, count: 3, low }, "bad_low");
    await refused(s, "x-3", { op: "start", id: L1, count: 3, name: "n".repeat(61) }, "bad_text");
    await refused(s, "x-4", { op: "start", id: L1, count: 3, unit: "u".repeat(21) }, "bad_text");
    await refused(s, "x-5", { op: "start", id: L1, count: 3, name: "😀".repeat(31) }, "bad_text"); // 31 emoji are 62 UTF-16 units: JavaScript's length, not 31 characters
  });

  test("the name and unit are cleaned before they are measured and kept", async () => {
    const s = await boot();
    await stock(s, "s-1", { op: "start", id: L1, count: 3, name: `  ${"😀".repeat(30)}  `, unit: "  big \t box " });
    const row = (await page(s)).rows[0];
    assert.equal(row.name, "😀".repeat(30), "60 UTF-16 units is allowed"); assert.equal(row.unit, "big box");
    await stock(s, "s-2", { op: "start", id: L2, count: 3, name: `a${" ".repeat(79)}`, unit: "x" });
    assert.equal((await page(s)).rows.find((r: any) => r.id === L2).name, "a", "80 units are taken from the page, then white space is cleaned away");
  });

  test("exists, no_such_line, stale and the quantity of a sale", async () => {
    const s = await boot();
    await stock(s, "s-1", { op: "start", id: L1, count: 3 });
    await refused(s, "x-1", { op: "start", id: L1, count: 9 }, "exists");
    for (const op of [{ op: "correct", id: L2, to: 1 }, { op: "sold", id: L2, qty: 1 }, { op: "low", id: L2, low: 1 }, { op: "stop", id: L2 }]) await refused(s, "x-2", op, "no_such_line");
    await refused(s, "x-3", { op: "correct", id: L1, to: 9, shown: 2 }, "stale");
    await refused(s, "x-4", { op: "correct", id: L1, to: -1 }, "bad_count");
    await refused(s, "x-5", { op: "correct", id: L1, to: 2.5 }, "bad_count");
    for (const qty of [0, -1, 1.5, 1_000_001]) await refused(s, "x-6", { op: "sold", id: L1, qty }, "bad_count");
    await refused(s, "x-7", { op: "low", id: L1, low: 2.5 }, "bad_low");
    await refused(s, "x-8", { op: "low", id: L1, low: -1 }, "bad_low");
    assert.equal((await page(s)).rows[0].count, 3, "nothing a refused op asked for happened");
    await s.stop();
    assert.equal(savedStock(s).lines[0].moves.length, 1);
  });

  test("a page's body of the wrong shape is a 400, and the item id must look like one", async () => {
    const s = await boot();
    const bad = async (body: unknown) => { const r = await s.call(PATH, { owner: s.owner, body }); assert.equal(r.status, 400, JSON.stringify(body)); assert.equal(typeof r.body.error, "string"); };
    const op = (o: Record<string, unknown>) => ({ id: "b-1", op: { id: L1, ...o } });
    await bad([]); await bad("x"); await bad({}); await bad({ id: "b-1" }); await bad({ id: "bad id!", op: { op: "stop", id: L1 } }); await bad({ id: "x".repeat(65), op: { op: "stop", id: L1 } });
    await bad({ id: 7, op: { op: "stop", id: L1 } }); await bad({ id: "b-1", op: [] }); await bad({ id: "b-1", op: "stop" });
    for (const id of [undefined, 3, "l-3", "listing:", "listing:l 3", "shop:l-3", "listing:" + "x".repeat(65), "Listing:l-3"]) await bad({ id: "b-1", op: { op: "stop", id } });
    await bad(op({ op: "dance" })); await bad(op({})); await bad(op({ op: 4 }));
    await bad(op({ op: "start" })); await bad(op({ op: "start", count: "3" })); await bad(op({ op: "start", count: null })); await bad(op({ op: "start", count: 3, low: "1" })); await bad(op({ op: "start", count: 3, low: null }));
    await bad(op({ op: "correct" })); await bad(op({ op: "correct", to: "3" })); await bad(op({ op: "correct", to: 3, shown: "2" })); await bad(op({ op: "correct", to: 3, shown: null }));
    await bad(op({ op: "sold" })); await bad(op({ op: "sold", qty: "1" }));
    await bad(op({ op: "low" })); await bad(op({ op: "low", low: "1" }));
    assert.equal((await s.call(PATH, { owner: s.owner, raw: new TextEncoder().encode("{not json"), type: "application/json" })).status, 400);
    // a name that is only white space is not a name; an ordinary start with extra members is taken as sent
    await stock(s, "ok-1", { op: "start", id: L1, count: 1, name: "   ", unit: " \t", extra: true });
    assert.equal("unit" in (await page(s)).rows[0], false);
    assert.equal((await page(s)).rows[0].name, L1, "no name sent and no live listing named it: the id");
    // an item the shop has no listing for is counted all the same (the shape is all the page's check asks)
    assert.equal((await s.call("/status")).body.recordLength, 1, "only the one accepted op reached the record");
  });

  test("the most lines a shop may count is 300", async () => {
    const s = await boot();
    for (let i = 0; i < 300; i++) {
      const r = await s.call(PATH, { owner: s.owner, body: { id: `f-${i}`, op: { op: "start", id: `supply:i${i}`, count: 1 } } });
      assert.equal(r.status, 200, JSON.stringify(r.body));
    }
    await s.settle();
    assert.equal((await page(s)).rows.length, 300);
    await refused(s, "f-x", { op: "start", id: "supply:one-too-many", count: 1 }, "full");
    await stock(s, "f-y", { op: "stop", id: "supply:i7" });
    await stock(s, "f-z", { op: "start", id: "supply:one-too-many", count: 1 });
  });
});

describe("a request id counts once, and a low mark speaks once per crossing", { skip: SKIP }, () => {
  test("the same request id again changes nothing (it is a retry); a new id is a new act", async () => {
    const s = await boot();
    await stock(s, "s-1", { op: "start", id: L1, count: 10 });
    assert.deepEqual(await stock(s, "s-2", { op: "sold", id: L1, qty: 3 }), { saved: 1, duplicates: 0 });
    assert.deepEqual(await stock(s, "s-2", { op: "sold", id: L1, qty: 3 }), { saved: 0, duplicates: 1 }, "the retry is told it was a duplicate");
    assert.equal((await page(s)).rows[0].count, 7, "taken once");
    // the retry of a `correct` that worked: its `shown` is now stale, but the request id was served, so the answer is the duplicate, not a 422 (the key is checked before staleness)
    await stock(s, "s-c", { op: "correct", id: L1, to: 5, shown: 7 });
    assert.deepEqual(await stock(s, "s-c", { op: "correct", id: L1, to: 5, shown: 7 }), { saved: 0, duplicates: 1 });
    await stock(s, "s-d", { op: "correct", id: L1, to: 7 });
    assert.deepEqual(await stock(s, "s-2", { op: "correct", id: L1, to: 50 }), { saved: 0, duplicates: 1 }, "the id names the act, whatever the retry says");
    assert.equal((await page(s)).rows[0].count, 7);
    await stock(s, "s-3", { op: "sold", id: L1, qty: 3 });
    assert.equal((await page(s)).rows[0].count, 4, "a new id takes again");
    await s.stop(); await s.start();
    assert.equal((await page(s)).rows[0].count, 4, "and a restart does not take it a third time");
  });

  test("a low mark is told once when the count falls to it, again only after it has risen above and fallen back", async () => {
    const s = await boot();
    await stock(s, "b-a", { op: "start", id: L1, count: 5, low: 2, name: "Kittens", unit: "pc" });
    await stock(s, "b-b", { op: "sold", id: L1, qty: 3 });
    assert.equal((await page(s)).rows[0].isLow, true);
    await stock(s, "b-c", { op: "sold", id: L1, qty: 1 });
    await stock(s, "b-d", { op: "correct", id: L1, to: 10 });
    assert.equal((await page(s)).rows[0].isLow, false, "above the mark again");
    await stock(s, "b-e", { op: "sold", id: L1, qty: 9 });
    assert.equal((await page(s)).rows[0].isLow, true);
    await s.stop();
    // the shape of the saved line is what the TypeScript runtime also reads: the same members, in the same order for `applied`
    assert.deepEqual(noClocks(savedStock(s)), {
      lines: [{
        id: L1, name: "Kittens", unit: "pc", count: 1, low: 2, lowFlag: true, crossings: 2,
        applied: { "req:b-b": { qty: 3, took: 3, atMs: 0 }, "req:b-c": { qty: 1, took: 1, atMs: 0 }, "req:b-d": { qty: 10, took: 0, atMs: 0 }, "req:b-e": { qty: 9, took: 9, atMs: 0 } },
        moves: [
          { kind: "started", delta: 5, after: 5, atMs: 0, by: "owner" }, { kind: "sold", delta: -3, after: 2, atMs: 0, by: "owner" }, { kind: "sold", delta: -1, after: 1, atMs: 0, by: "owner" },
          { kind: "corrected", delta: 9, after: 10, atMs: 0, by: "owner" }, { kind: "sold", delta: -9, after: 1, atMs: 0, by: "owner" },
        ],
        startedMs: 0,
      }],
      alerts: [{ line: L1, crossing: 1, count: 2, atMs: 0 }, { line: L1, crossing: 2, count: 1, atMs: 0 }],
    });
    assert.deepEqual(Object.keys(savedStock(s).lines[0].applied), ["req:b-b", "req:b-c", "req:b-d", "req:b-e"], "keys stay in the order they were made");
    assert.deepEqual(Object.keys(savedStock(s).lines[0]), ["id", "name", "unit", "count", "low", "lowFlag", "crossings", "applied", "moves", "startedMs"], "members as the TypeScript state writes them");
  });

  test("a count that starts at or under its mark is told at once; clearing the mark takes the pending alert away; stopping takes the line's alerts", async () => {
    const s = await boot();
    await stock(s, "a-1", { op: "start", id: L1, count: 1, low: 1 });
    await stock(s, "a-2", { op: "start", id: L2, count: 5 });
    await stock(s, "a-3", { op: "low", id: L2, low: 9 });
    await stock(s, "a-4", { op: "low", id: L2, low: null });
    await stock(s, "a-5", { op: "start", id: "supply:x", count: 0, low: 3 });
    await stock(s, "a-6", { op: "stop", id: "supply:x" });
    await s.stop();
    const st = noClocks(savedStock(s));
    assert.deepEqual(st.alerts, [{ line: L1, crossing: 1, count: 1, atMs: 0 }]);
    assert.deepEqual(st.lines.map((l: any) => [l.id, l.lowFlag, l.crossings]), [[L1, true, 1], [L2, false, 1]]);
    assert.equal("low" in st.lines[1], false);
  });
});

describe("the record keeps a line for every op", { skip: SKIP }, () => {
  test("a `stock` line per op with the item, kind, change and who; a refused step is a blocked line", async () => {
    const s = await boot();
    await listingOp(s, "r-1", KITTENS);
    await listingOp(s, "r-2", { op: "publish_form", category: "home", title: "A long and winding name for a brass lamp that sits on the shelf by the door", photos: [] });
    await stock(s, "k-1", { op: "start", id: L1, count: 5, low: 2 });
    await stock(s, "k-2", { op: "sold", id: L1, qty: 2 });
    await stock(s, "k-3", { op: "correct", id: L1, to: 7, shown: 3 });
    await stock(s, "k-4", { op: "low", id: L1, low: null });
    await stock(s, "k-5", { op: "low", id: L1, low: 4 });
    await stock(s, "k-6", { op: "stop", id: L1 });
    // no name sent, so the step names the line by the listing's title in the owner's language, and that is 74 units: over the 60 a name may have. The page's check cannot know, so it says yes.
    await stock(s, "k-7", { op: "start", id: L2, count: 1 });
    await s.stop();
    const rec = savedRecord(s).filter((r) => r.action === "stock");
    const key = recordKey(s);
    const refs = (item: string, change: string) => ({ item, kind: "listing", change, by: "owner" });
    const want: [string, string, unknown, Record<string, string>][] = [
      ["confirmed", "the owner changed their stock count in their app", { op: "start", item: L1, count: 5, low: 2 }, refs(L1, "started")],
      ["confirmed", "the owner changed their stock count in their app", { op: "sold", item: L1, qty: 2 }, refs(L1, "sold")],
      ["confirmed", "the owner changed their stock count in their app", { op: "correct", item: L1, to: 7 }, refs(L1, "corrected")],
      ["confirmed", "the owner changed their stock count in their app", { op: "low", item: L1, low: null }, refs(L1, "low_mark")],
      ["confirmed", "the owner changed their stock count in their app", { op: "low", item: L1, low: 4 }, refs(L1, "low_mark")],
      ["confirmed", "the owner changed their stock count in their app", { op: "stop", item: L1 }, refs(L1, "stopped")],
      ["blocked", "the owner's Stock page asked for something the rules refuse (bad_text); nothing changed", { op: "start", item: L2, why: "bad_text" }, refs(L2, "corrected")],
    ];
    assert.equal(rec.length, want.length);
    const listingLine = savedRecord(s).find((r) => r.action === "listing")!.entry;
    want.forEach(([outcome, notes, inputs, r], i) => {
      const e = rec[i].entry;
      assert.equal(rec[i].outcome, outcome, `line ${i}`); assert.equal(e.notes, notes, `line ${i}`); assert.deepEqual(e.refs, r, `line ${i}`);
      assert.equal(e.inputsDigest, keyedDigest(key, canonicalJson(inputs)), `line ${i}: the inputs are the ones the TypeScript line carries`);
      assert.equal(e.conversation, listingLine.conversation); assert.equal(e.language, "en");
    });
    assert.equal(savedStock(s).lines.length, 0, "the refused start made no line");
  });
});

describe("Confirm on a listing that sold itself at 0", { skip: SKIP }, () => {
  test("it sets the count to the quantity the owner first said, or 1, and says so in the record before the listing's own line", async () => {
    const s = await boot();
    await listingOp(s, "r-1", { ...KITTENS, qty: 3 });
    await listingOp(s, "r-2", { op: "publish_form", category: "home", title: "Brass lamp", photos: [] });
    await listingOp(s, "r-3", { op: "publish_form", category: "home", title: "Clay pot", photos: [] });
    await withSwitch(s);
    await stock(s, "s-1", { op: "start", id: L1, count: 1 });
    await stock(s, "s-2", { op: "sold", id: L1, qty: 1 });
    await stock(s, "s-3", { op: "start", id: L2, count: 1 });
    await stock(s, "s-4", { op: "sold", id: L2, qty: 1 });
    assert.deepEqual((await publicRead(s)).listings.map((l: any) => l.id), ["l-3"], "the two counted ones sold themselves");
    const confirmMs = async (id: string) => (await ownerList(s)).listings.find((l: any) => l.id === id).confirmedMs;
    const before = (await s.call("/status")).body.recordLength;

    await listingOp(s, "c-1", { op: "confirm", id: "l-1", confirmedMs: await confirmMs("l-1") });
    assert.equal((await page(s)).rows.find((r: any) => r.id === L1).count, 3, "the quantity the owner first said");
    assert.deepEqual((await publicRead(s)).listings.map((l: any) => [l.id, l.qty]).sort(), [["l-1", 3], ["l-3", undefined]], "it is back on the page, showing 3");
    await listingOp(s, "c-2", { op: "confirm", id: "l-2", confirmedMs: await confirmMs("l-2") });
    assert.equal((await page(s)).rows.find((r: any) => r.id === L2).count, 1, "no quantity was said: one");
    assert.equal((await page(s)).rows.find((r: any) => r.id === L2).moves[0].kind, "corrected");
    // a confirm of a counted listing with stock, and of one nobody counts, leaves the counts alone
    await listingOp(s, "c-3", { op: "confirm", id: "l-1", confirmedMs: await confirmMs("l-1") });
    await listingOp(s, "c-4", { op: "confirm", id: "l-3", confirmedMs: await confirmMs("l-3") });
    assert.equal((await page(s)).rows.find((r: any) => r.id === L1).count, 3);
    assert.equal((await page(s)).rows.length, 2);
    await s.stop();
    const rec = savedRecord(s).slice(before);
    assert.deepEqual(rec.map((r) => r.action), ["stock", "listing", "stock", "listing", "listing", "listing"], "the stock line comes first, then the listing's, and only a restore makes one");
    assert.equal(rec[0].outcome, "confirmed"); assert.deepEqual(rec[0].entry.refs, { item: L1, kind: "listing", change: "corrected", by: "owner" });
    assert.equal(rec[0].entry.notes, "the owner confirmed a listing that had sold itself at 0, so its count was set to the number they first said");
    assert.equal(rec[0].entry.inputsDigest, keyedDigest(recordKey(s), canonicalJson({ op: "correct", item: L1 })));
    assert.equal(savedStock(s).lines.find((l: any) => l.id === L1).applied["req:confirm-c-1"].qty, 3, "keyed by the confirm's own request id");
  });
});

describe("the count survives", { skip: SKIP }, () => {
  test("a restart of the same runtime", async () => {
    const s = await boot();
    await listingOp(s, "r-1", KITTENS); await withSwitch(s);
    await stock(s, "s-1", { op: "start", id: L1, count: 6, low: 3 });
    await stock(s, "s-2", { op: "sold", id: L1, qty: 3 });
    const was = await page(s); const pub = await publicRead(s);
    await s.stop(); await s.start();
    assert.deepEqual(await page(s), was);
    assert.deepEqual(await publicRead(s), pub);
    await stock(s, "s-3", { op: "sold", id: L1, qty: 1 });
    assert.equal((await page(s)).rows[0].count, 2);
    assert.equal((await page(s)).rows[0].isLow, true, "still the one crossing");
  });

  describe("and restarted twice on one folder", () => {
    test("it counts, is restarted, reads and counts, is restarted, reads and counts again", async () => {
      const s = await makeShop(); shops.push(s);
      await s.start();
      await listingOp(s, "r-1", KITTENS); await withSwitch(s);
      await stock(s, "t-1", { op: "start", id: L1, count: 6, low: 3, unit: "pc" });
      await stock(s, "t-2", { op: "sold", id: L1, qty: 2 });
      await s.stop();

      await s.start();
      let v = await page(s);
      assert.deepEqual(rowsOf(v)[0], { id: L1, name: "Two Persian kittens", unit: "pc", count: 4, low: 3, isLow: false, soldOut: false, kind: "listing", moves: [{ kind: "sold", delta: -2, after: 4, by: "owner" }, { kind: "started", delta: 6, after: 6, by: "owner" }] });
      assert.equal((await publicRead(s)).listings[0].qty, 4);
      await stock(s, "t-3", { op: "sold", id: L1, qty: 1 });           // 3: the mark is reached
      await stock(s, "t-4", { op: "start", id: L2, count: 2, name: "Lamp" });
      await s.stop();

      await s.start();
      v = await page(s);
      assert.deepEqual(v.rows.map((r: any) => [r.id, r.count, r.isLow]), [[L1, 3, true], [L2, 2, false]], "what the last start wrote is read back, low first");
      await stock(s, "t-5", { op: "correct", id: L1, to: 9, shown: 3 });
      await stock(s, "t-6", { op: "sold", id: L1, qty: 7 });             // 2: a second crossing
      assert.equal((await page(s)).rows.find((r: any) => r.id === L1).count, 2);
      await s.stop();

      const st = noClocks(savedStock(s));
      assert.deepEqual(Object.keys(st.lines[0].applied), ["req:t-2", "req:t-3", "req:t-5", "req:t-6"], "the keys of every start, in the order they were made");
      assert.deepEqual(st.alerts, [{ line: L1, crossing: 1, count: 3, atMs: 0 }, { line: L1, crossing: 2, count: 2, atMs: 0 }]);
      assert.equal(st.lines[0].crossings, 2);
      assert.deepEqual(st.lines[0].moves.map((m: any) => m.kind), ["started", "sold", "sold", "corrected", "sold"]);
      // the saved state, field for field, is the one the TypeScript runtime saved for the same ops (the golden answer: the file a shop moved between runtimes keeps)
      await golden("the saved stock after three starts", async () => st);
    });
  });
});
