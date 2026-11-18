// The directory's index: SQLite with FTS5 (node:sqlite, nothing else), kept in the directory's own file. SERVER SIDE: this is the one file of the module that opens a
// database (the pure files, feed.ts, order.ts, romanise.ts, words.ts and page.ts, never do), so an agent's import graph can use the pure ones.
//
// The index is a CACHE. Everything in `shops`, `items` and the full-text table is copied from shop feeds, and `rebuild` throws it away and makes it again from the
// feeds the directory last accepted (kept whole in `feeds.body`). Three things are not derived and are kept across a rebuild: the list of feeds, the pinned key of
// each shop page (`pins`, "the first key it saw"), and the list of key changes a person has not looked at yet. Losing the file loses nothing the shops do not hold: the
// feeds are read again.
//
// Words. Every item is indexed with its titles and texts in every language it has, its place (town and pincode), and a rough Latin spelling of all of them
// (romanise.ts), so "billi", "poocha" and "bekku" find the same kitten as the native words do. The tokenizer keeps the vowel signs of Hindi, Malayalam and Kannada
// inside their words (the default tokenizer would cut a word at every sign: checked 18 Nov 2026). Matching is by word start, so a Malayalam word with an ending
// ("പൂച്ചക്കുട്ടി" for a search of "പൂച്ച") still matches.
//
// What is NOT here: any ranking. FTS5's relevance score is never read; the order of results is order.ts alone.
import { DatabaseSync } from "node:sqlite";
import { skeleton } from "./romanise.ts";
import { normal, haversineKm } from "./text.ts";
export { normal, haversineKm, searchWords, wordsOf } from "./text.ts";
import type { Category, Feed, FeedItem, Photo, Price } from "./types.ts";

/** The version of the tables. A file with another version is emptied and made again: it is only a cache. */
export const SCHEMA_VERSION = 1;
/** The most items one search looks at (the order is made over these, so it is large; a search that matches more is narrowed by its category and place). */
export const MAX_CANDIDATES = 2000;

export type FeedSource = "config" | "notice";
export interface FeedRow { url: string; source: FeedSource; etag: string | null; fetchedAt: number | null; checkedAt: number | null; wantedAt: number | null; goneSince: number | null; addedAt: number; error: string | null; hasBody: boolean }
export interface ShopRow { page: string; feedUrl: string; name: string; trade: string | null; town: string; pincode: string | null; lat: number | null; lon: number | null; chat: string; check: string; agentCard: string | null; registration: { kind: string; number: string; source: "owner" } | null; languages: string[]; keyId: string; key: string; updated: string; status: "ok" | "held" }
export interface ItemRow { shop: string; id: string; category: Category; title: FeedItem["title"]; text: FeedItem["text"]; ownerLanguage: FeedItem["ownerLanguage"]; machineWritten: FeedItem["machineWritten"]; price: Price | null; quantity: number | null; photos: Photo[]; availability: FeedItem["availability"]; confirmed: string; page: string }
export interface KeyChange { page: string; pinnedKeyId: string; offeredKeyId: string; offeredKey: string; seenAt: number }

/** What a search asks the index for: words already cleaned, a category, and the buyer's place. */
export interface IndexQuery { words: string[]; category?: Category; point?: { lat: number; lon: number }; town?: string; radiusKm?: number }
export interface Hit { shop: ShopRow; item: ItemRow; fit: 0 | 1; distanceKm: number | null; sameTown: boolean }

const q = (w: string): string => `"${w.replaceAll('"', "")}"`;
/** A word's Latin skeleton as the index compares it: the last vowel is not asked for (a word may take an ending: "bekku", "bekkina"), as the match is by word start. */
function skeletonOf(word: string): string {
  let sk = skeleton(word).replace(/[^a-z0-9]/gu, "");
  if (sk.length >= 4) sk = sk.replace(/[aeiou]$/u, "");
  return sk;
}
/** FTS5 text for a word in what an item SAYS: it starts a word in the titles or the texts, or its Latin skeleton starts a word in the spelling column (which holds the category's word too). */
function contentTerm(word: string): string {
  const sk = skeletonOf(word);
  return `({title body} : ${q(word)}*${sk.length >= 2 ? ` OR rom : ${q(sk)}*` : ""})`;
}
/** The same, or the word names the shop's town or pincode (the `place` column, which also holds the town's skeleton). A place word counts toward "every word" and never makes an item a match by itself. */
function anyTerm(word: string): string {
  const sk = skeletonOf(word);
  return `({title body place} : ${q(word)}*${sk.length >= 2 ? ` OR rom : ${q(sk)}* OR place : ${q(sk)}*` : ""})`;
}

const json = (v: unknown): string => JSON.stringify(v);
const parse = <T>(text: string | null, fallback: T): T => { try { return text === null ? fallback : JSON.parse(text) as T; } catch { return fallback; } };

type Row = Record<string, unknown>;

export class DirectoryIndex {
  readonly db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL;");
    const version = (this.db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
    if (version !== 0 && version !== SCHEMA_VERSION) this.dropAll();
    this.create();
    this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  }
  close(): void { this.db.close(); }

  private dropAll(): void {
    for (const t of ["items_fts", "items", "shops", "feeds", "pins", "key_changes", "counts"]) this.db.exec(`DROP TABLE IF EXISTS ${t}`);
  }
  private create(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS feeds (url TEXT PRIMARY KEY, source TEXT NOT NULL, etag TEXT, fetched_at INTEGER, checked_at INTEGER, wanted_at INTEGER, gone_since INTEGER, added_at INTEGER NOT NULL, error TEXT, body TEXT);
      CREATE TABLE IF NOT EXISTS pins (page TEXT PRIMARY KEY, key_id TEXT NOT NULL, key TEXT NOT NULL, since INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS key_changes (page TEXT PRIMARY KEY, pinned_key_id TEXT NOT NULL, offered_key_id TEXT NOT NULL, offered_key TEXT NOT NULL, seen_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS shops (page TEXT PRIMARY KEY, feed_url TEXT NOT NULL, name TEXT NOT NULL, trade TEXT, town TEXT NOT NULL, pincode TEXT, lat REAL, lon REAL, chat TEXT NOT NULL, check_url TEXT NOT NULL, agent_card TEXT, registration TEXT, languages TEXT NOT NULL, key_id TEXT NOT NULL, key TEXT NOT NULL, updated TEXT NOT NULL, status TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS items (shop_page TEXT NOT NULL, id TEXT NOT NULL, category TEXT NOT NULL, title TEXT NOT NULL, text TEXT NOT NULL, owner_language TEXT NOT NULL, machine TEXT NOT NULL, price_value TEXT, price_note TEXT, quantity INTEGER, photos TEXT NOT NULL, availability TEXT NOT NULL, confirmed TEXT NOT NULL, item_page TEXT NOT NULL, PRIMARY KEY (shop_page, id));
      CREATE INDEX IF NOT EXISTS items_category ON items (category);
      CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(title, body, rom, place, tokenize = "unicode61 remove_diacritics 0 categories 'L* N* Co Mn Mc'");
      CREATE TABLE IF NOT EXISTS counts (day TEXT NOT NULL, kind TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, kind));
    `);
  }

  // ---- the list of feeds ----

  /** Add a feed address if the directory does not know it yet; true when it was added. */
  addFeed(url: string, source: FeedSource, now: number): boolean {
    return Number(this.db.prepare("INSERT OR IGNORE INTO feeds (url, source, added_at) VALUES (?, ?, ?)").run(url, source, now).changes) > 0;
  }
  private feedOf(r: Row): FeedRow {
    return { url: r.url as string, source: r.source as FeedSource, etag: (r.etag as string) ?? null, fetchedAt: (r.fetched_at as number) ?? null, checkedAt: (r.checked_at as number) ?? null, wantedAt: (r.wanted_at as number) ?? null, goneSince: (r.gone_since as number) ?? null, addedAt: r.added_at as number, error: (r.error as string) ?? null, hasBody: r.has_body === 1 };
  }
  private static readonly FEED_COLUMNS = "url, source, etag, fetched_at, checked_at, wanted_at, gone_since, added_at, error, body IS NOT NULL AS has_body";
  feeds(): FeedRow[] { return (this.db.prepare(`SELECT ${DirectoryIndex.FEED_COLUMNS} FROM feeds ORDER BY url`).all() as Row[]).map((r) => this.feedOf(r)); }
  feed(url: string): FeedRow | undefined { const r = this.db.prepare(`SELECT ${DirectoryIndex.FEED_COLUMNS} FROM feeds WHERE url = ?`).get(url) as Row | undefined; return r && this.feedOf(r); }
  feedCount(): number { return (this.db.prepare("SELECT COUNT(*) AS n FROM feeds").get() as { n: number }).n; }
  /** A hint (a notice) that the feed changed: the feed wants reading at the next chance. */
  want(url: string, now: number): void { this.db.prepare("UPDATE feeds SET wanted_at = ? WHERE url = ?").run(now, url); }
  /** An attempt at reading, whatever its outcome (so the once-a-minute rule counts attempts). */
  touch(url: string, now: number, error: string | null): void { this.db.prepare("UPDATE feeds SET checked_at = ?, wanted_at = NULL, error = ? WHERE url = ?").run(now, error, url); }
  /** The feed answered 404 or 410: remember since when. Returns that moment. */
  markGone(url: string, now: number): number {
    this.db.prepare("UPDATE feeds SET gone_since = COALESCE(gone_since, ?) WHERE url = ?").run(now, url);
    return (this.db.prepare("SELECT gone_since FROM feeds WHERE url = ?").get(url) as { gone_since: number }).gone_since;
  }
  /** A feed and every shop and item it gave, removed. Its pinned key is kept (the shop may come back). */
  dropFeed(url: string): void {
    for (const s of this.db.prepare("SELECT page FROM shops WHERE feed_url = ?").all(url) as { page: string }[]) this.removeShop(s.page);
    this.db.prepare("DELETE FROM feeds WHERE url = ?").run(url);
  }

  // ---- keys ----

  pinOf(page: string): { keyId: string; key: string } | undefined {
    const r = this.db.prepare("SELECT key_id, key FROM pins WHERE page = ?").get(page) as { key_id: string; key: string } | undefined;
    return r && { keyId: r.key_id, key: r.key };
  }
  pin(page: string, pin: { keyId: string; key: string }, now: number): void {
    this.db.prepare("INSERT INTO pins (page, key_id, key, since) VALUES (?, ?, ?, ?) ON CONFLICT(page) DO UPDATE SET key_id = excluded.key_id, key = excluded.key, since = excluded.since").run(page, pin.keyId, pin.key, now);
  }
  /** A feed signed by another key than the pinned one: its items are held (the shop is hidden from search) and the change is listed. */
  hold(page: string, pinned: string, offered: { keyId: string; key: string }, now: number): void {
    this.db.prepare("INSERT INTO key_changes (page, pinned_key_id, offered_key_id, offered_key, seen_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(page) DO UPDATE SET offered_key_id = excluded.offered_key_id, offered_key = excluded.offered_key, seen_at = excluded.seen_at").run(page, pinned, offered.keyId, offered.key, now);
    this.db.prepare("UPDATE shops SET status = 'held' WHERE page = ?").run(page);
  }
  keyChanges(): KeyChange[] {
    return (this.db.prepare("SELECT page, pinned_key_id, offered_key_id, offered_key, seen_at FROM key_changes ORDER BY seen_at").all() as Row[]).map((r) => ({ page: r.page as string, pinnedKeyId: r.pinned_key_id as string, offeredKeyId: r.offered_key_id as string, offeredKey: r.offered_key as string, seenAt: r.seen_at as number }));
  }
  /** A person looked at the change and accepts the new key: it becomes the pinned one and the shop is read again at the next refresh. */
  acceptKeyChange(page: string, now: number): boolean {
    const c = this.keyChanges().find((k) => k.page === page);
    if (!c) return false;
    this.pin(page, { keyId: c.offeredKeyId, key: c.offeredKey }, now);
    this.db.prepare("DELETE FROM key_changes WHERE page = ?").run(page);
    this.db.prepare("UPDATE feeds SET etag = NULL, wanted_at = ? WHERE url = (SELECT feed_url FROM shops WHERE page = ?)").run(now, page);
    return true;
  }
  /** A person looked at the change and says no: the shop stays held until its feed is signed with the pinned key again. */
  clearKeyChange(page: string): void { this.db.prepare("DELETE FROM key_changes WHERE page = ?").run(page); }

  // ---- putting a feed in ----

  /** A feed accepted: the shop and its items replace what was there. `body` is the exact text, kept so the index can be made again without the network. */
  ingest(feedUrl: string, feed: Feed, pin: { keyId: string; key: string }, body: string, etag: string | null, now: number): void {
    this.db.exec("BEGIN");
    try {
      this.removeShop(feed.shop.page);
      const s = feed.shop;
      this.db.prepare("INSERT INTO shops (page, feed_url, name, trade, town, pincode, lat, lon, chat, check_url, agent_card, registration, languages, key_id, key, updated, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ok')")
        .run(s.page, feedUrl, s.name, s.trade ?? null, s.place.town, s.place.pincode ?? null, s.place.lat ? Number(s.place.lat) : null, s.place.lon ? Number(s.place.lon) : null, s.chat, s.check, s.agentCard ?? null, s.registration ? json(s.registration) : null, json(s.languages), pin.keyId, pin.key, feed.updated);
      const add = this.db.prepare("INSERT INTO items (shop_page, id, category, title, text, owner_language, machine, price_value, price_note, quantity, photos, availability, confirmed, item_page) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      const addWords = this.db.prepare("INSERT INTO items_fts (rowid, title, body, rom, place) VALUES (?, ?, ?, ?, ?)");
      // the place is the town and pincode as written, and the town's Latin skeleton (so "thrissur" finds a shop whose town is written in Malayalam)
      const place = `${normal(`${s.place.town} ${s.place.pincode ?? ""}`)} ${skeleton(s.place.town)}`;
      for (const it of feed.items) {
        const r = add.run(s.page, it.id, it.category, json(it.title), json(it.text), it.ownerLanguage, json(it.machineWritten), it.price?.value ?? null, it.price?.note ?? null, it.quantity ?? null, json(it.photos), it.availability, it.confirmed, it.page);
        const title = normal(Object.values(it.title).join(" ")), body = normal(Object.values(it.text).join(" "));
        // the category's own word is searchable ("pets" is a thing people type); the town is in `place`, not here, so a town word never makes an unrelated item a match
        const rom = `${skeleton(`${title} ${body}`)} ${it.category.replaceAll("_", " ")}`;
        addWords.run(r.lastInsertRowid, title, body, rom, place);
      }
      this.db.prepare("INSERT INTO feeds (url, source, added_at) VALUES (?, 'notice', ?) ON CONFLICT(url) DO NOTHING").run(feedUrl, now);
      this.db.prepare("UPDATE feeds SET body = ?, etag = ?, fetched_at = ?, checked_at = ?, wanted_at = NULL, gone_since = NULL, error = NULL WHERE url = ?").run(body, etag, now, now, feedUrl);
      this.db.prepare("DELETE FROM key_changes WHERE page = ?").run(s.page);
      this.pin(s.page, pin, now);
      this.db.exec("COMMIT");
    } catch (e) { this.db.exec("ROLLBACK"); throw e; }
  }
  private removeShop(page: string): void {
    this.db.prepare("DELETE FROM items_fts WHERE rowid IN (SELECT rowid FROM items WHERE shop_page = ?)").run(page);
    this.db.prepare("DELETE FROM items WHERE shop_page = ?").run(page);
    this.db.prepare("DELETE FROM shops WHERE page = ?").run(page);
  }
  /** Throw the derived tables away (shops, items, words); the feeds with their stored bodies, the pins and the key changes stay. Make it again with `storedFeeds` and `ingest`. */
  wipeDerived(): void {
    this.db.exec("DELETE FROM items_fts; DELETE FROM items; DELETE FROM shops;");
  }
  /** Every feed with the text last accepted for it. */
  storedFeeds(): { url: string; body: string; etag: string | null; fetchedAt: number | null }[] {
    return (this.db.prepare("SELECT url, body, etag, fetched_at FROM feeds WHERE body IS NOT NULL ORDER BY url").all() as Row[]).map((r) => ({ url: r.url as string, body: r.body as string, etag: (r.etag as string) ?? null, fetchedAt: (r.fetched_at as number) ?? null }));
  }

  // ---- reading ----

  private shopOf(r: Row): ShopRow {
    return { page: r.page as string, feedUrl: r.feed_url as string, name: r.name as string, trade: (r.trade as string) ?? null, town: r.town as string, pincode: (r.pincode as string) ?? null, lat: (r.lat as number) ?? null, lon: (r.lon as number) ?? null, chat: r.chat as string, check: r.check_url as string, agentCard: (r.agent_card as string) ?? null, registration: parse(r.registration as string | null, null), languages: parse(r.languages as string, []), keyId: r.key_id as string, key: r.key as string, updated: r.updated as string, status: r.status as "ok" | "held" };
  }
  private itemOf(r: Row): ItemRow {
    return { shop: r.shop_page as string, id: r.id as string, category: r.category as Category, title: parse(r.title as string, {}), text: parse(r.text as string, {}), ownerLanguage: r.owner_language as ItemRow["ownerLanguage"], machineWritten: parse(r.machine as string, []), price: r.price_value === null ? null : { value: r.price_value as string, currency: "INR", ...(r.price_note ? { note: r.price_note as string } : {}) }, quantity: (r.quantity as number) ?? null, photos: parse(r.photos as string, []), availability: r.availability as ItemRow["availability"], confirmed: r.confirmed as string, page: r.item_page as string };
  }
  shop(page: string): ShopRow | undefined { const r = this.db.prepare("SELECT * FROM shops WHERE page = ?").get(page) as Row | undefined; return r && this.shopOf(r); }
  shops(): ShopRow[] { return (this.db.prepare("SELECT * FROM shops ORDER BY page").all() as Row[]).map((r) => this.shopOf(r)); }
  item(page: string, id: string): { shop: ShopRow; item: ItemRow } | undefined {
    const s = this.shop(page);
    const r = s && s.status === "ok" ? this.db.prepare("SELECT * FROM items WHERE shop_page = ? AND id = ?").get(page, id) as Row | undefined : undefined;
    return s && r ? { shop: s, item: this.itemOf(r) } : undefined;
  }
  itemsOf(page: string): ItemRow[] { return (this.db.prepare("SELECT * FROM items WHERE shop_page = ? ORDER BY id").all(page) as Row[]).map((r) => this.itemOf(r)); }
  /** The towns of the shops that are in, the most common first: the choices the buyer's assistant may name (assistant.ts). Public facts from open feeds; at most `limit`. */
  towns(limit = 30): string[] {
    return (this.db.prepare("SELECT town FROM shops WHERE status = 'ok' GROUP BY town ORDER BY COUNT(*) DESC, town LIMIT ?").all(limit) as { town: string }[]).map((r) => r.town);
  }
  counts(): { shops: number; items: number } {
    return { shops: (this.db.prepare("SELECT COUNT(*) AS n FROM shops WHERE status = 'ok'").get() as { n: number }).n, items: (this.db.prepare("SELECT COUNT(*) AS n FROM items JOIN shops ON shops.page = items.shop_page WHERE shops.status = 'ok'").get() as { n: number }).n };
  }

  /**
   * The items that could answer a search, each with how well it fits (every word, or some), the distance and whether the shop is in the buyer's town. NO order is
   * made here and no relevance score is read: order.ts puts them in order. Shops whose key changed (held) are not here.
   */
  candidates(query: IndexQuery): Hit[] {
    const words = query.words.map(normal).filter(Boolean);
    const filter = query.category ? " AND items.category = ?" : "";
    const extra: string[] = query.category ? [query.category] : [];
    let rowids: { all: Set<number>; any: number[] };
    if (words.length === 0) {
      const rows = this.db.prepare(`SELECT items.rowid AS rid FROM items JOIN shops ON shops.page = items.shop_page WHERE shops.status = 'ok'${filter} LIMIT ${MAX_CANDIDATES}`).all(...extra) as { rid: number }[];
      rowids = { all: new Set(rows.map((r) => r.rid)), any: rows.map((r) => r.rid) };
    } else {
      const run = (match: string): number[] => (this.db.prepare(`SELECT items.rowid AS rid FROM items_fts JOIN items ON items.rowid = items_fts.rowid JOIN shops ON shops.page = items.shop_page WHERE items_fts MATCH ? AND shops.status = 'ok'${filter} LIMIT ${MAX_CANDIDATES}`).all(match, ...extra) as { rid: number }[]).map((r) => r.rid);
      // every word, each found in the item's words OR in its shop's place; then the items that have at least one word in what they SAY (so "persian kitten Thrissur" never lists every item of a Thrissur shop)
      const every = run(words.map(anyTerm).join(" AND "));
      const some = run(words.map(contentTerm).join(" OR "));
      rowids = { all: new Set(every), any: [...new Set([...every, ...some])] };
    }
    const hits: Hit[] = [];
    const get = this.db.prepare("SELECT * FROM items WHERE rowid = ?");
    const shops = new Map<string, ShopRow>();
    const buyerTown = query.town ? normal(query.town).trim() : "";
    const buyerSkeleton = buyerTown ? skeleton(buyerTown) : "";
    for (const rid of rowids.any) {
      const row = get.get(rid) as Row | undefined;
      if (!row) continue;
      const item = this.itemOf(row);
      const shop = shops.get(item.shop) ?? shops.set(item.shop, this.shop(item.shop)!).get(item.shop)!;
      const sameTown = buyerTown !== "" && (normal(shop.town) === buyerTown || skeleton(shop.town) === buyerSkeleton || shop.pincode === buyerTown);
      const distanceKm = query.point && shop.lat !== null && shop.lon !== null ? haversineKm(query.point, { lat: shop.lat, lon: shop.lon }) : null;
      if (query.radiusKm !== undefined && query.point) {
        // a radius keeps shops inside it; a shop with no map point stays only when it is in the buyer's own town
        if (distanceKm === null ? !sameTown : distanceKm > query.radiusKm) continue;
      }
      hits.push({ shop, item, fit: rowids.all.has(rid) ? 0 : 1, distanceKm, sameTown });
    }
    return hits;
  }

  // ---- counts (the only record of a search: how many, never whose or what) ----

  count(day: string, kind: "searches" | "results", n = 1): void {
    this.db.prepare("INSERT INTO counts (day, kind, n) VALUES (?, ?, ?) ON CONFLICT(day, kind) DO UPDATE SET n = n + excluded.n").run(day, kind, n);
  }
  countsOf(day: string): { searches: number; results: number } {
    const rows = this.db.prepare("SELECT kind, n FROM counts WHERE day = ?").all(day) as { kind: string; n: number }[];
    return { searches: rows.find((r) => r.kind === "searches")?.n ?? 0, results: rows.find((r) => r.kind === "results")?.n ?? 0 };
  }
}
