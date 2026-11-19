// The directory's index (modules/discovery/index.ts): SQLite with FTS5, in the directory's own file, THE SAME FILE the TypeScript service writes (schema version 1, the same tables and
// columns, so the service can move between the two runtimes on one folder and lose nothing).
//
// The index is a CACHE. Everything in `shops`, `items` and the full-text table is copied from shop feeds, and a rebuild throws it away and makes it again from the feeds the directory last
// accepted (kept whole in `feeds.body`). Three things are not derived and are kept across a rebuild: the list of feeds, the pinned key of each shop page ("the first key it saw"), and
// the list of key changes a person has not looked at yet.
//
// Words: every item is indexed with its titles and texts in every language it has, its place (town and pincode) and a rough Latin spelling of all of them (romanise.go), so "billi",
// "poocha" and "bekku" find the same kitten as the native words do. The tokenizer keeps the vowel signs of Hindi, Malayalam and Kannada inside their words. Matching is by word start.
// What is NOT here: any ranking. FTS5's relevance score is never read; the order of results is order.go alone.
//
// One connection: the TypeScript index is one synchronous connection, and a single one here keeps a feed going in whole (its transaction) while a search reads: the two never see half a feed.
package directory

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"sync"

	_ "modernc.org/sqlite"
)

// SchemaVersion is the version of the tables. A file with another version is emptied and made again: it is only a cache.
const SchemaVersion = 1

// MaxCandidates is the most items one search looks at (the order is made over these).
const MaxCandidates = 2000

// FeedRow is one feed the directory reads.
type FeedRow struct {
	URL, Source                               string
	Etag, Error                               *string
	FetchedAt, CheckedAt, WantedAt, GoneSince *int64
	AddedAt                                   int64
	HasBody                                   bool
}

// ShopRow is a shop as the index holds it.
type ShopRow struct {
	Page, FeedURL, Name string
	Trade, PincodeP     *string
	Town                string
	Lat, Lon            *float64
	Chat, Check         string
	AgentCard           *string
	Registration        *Registration
	Languages           []string
	KeyID, Key, Updated string
	Status              string // ok or held
}

// ItemRow is an item as the index holds it.
type ItemRow struct {
	Shop, ID, Category string
	Title, Text        LangWords
	OwnerLanguage      string
	MachineWritten     []string
	Price              *Price
	Quantity           *int64
	Photos             []Photo
	Availability       string
	Confirmed, Page    string
}

// KeyChange is a feed signed by another key than the pinned one, waiting for a person.
type KeyChange struct {
	Page, PinnedKeyID, OfferedKeyID, OfferedKey string
	SeenAt                                      int64
}

// IndexQuery is what a search asks the index for: words already cleaned, a category and the buyer's place.
type IndexQuery struct {
	Words    []string
	Category string
	Point    *[2]float64 // lat, lon
	Town     string
	RadiusKm *float64
}

// Hit is a candidate with how well it fits, the distance and whether the shop is in the buyer's town.
type Hit struct {
	Shop       *ShopRow
	Item       ItemRow
	Fit        int
	DistanceKm *float64
	SameTown   bool
}

// Index is the directory's database.
type Index struct {
	db *sql.DB
	mu sync.Mutex
}

// OpenIndex opens (and if need be makes) the index file; ":memory:" for a test.
func OpenIndex(path string) (*Index, error) {
	dsn := "file:" + path
	if path == ":memory:" {
		dsn = "file::memory:"
	}
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	x := &Index{db: db}
	if _, err := db.Exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;"); err != nil {
		return nil, err
	}
	var version int
	if err := db.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		return nil, err
	}
	if version != 0 && version != SchemaVersion {
		for _, t := range []string{"items_fts", "items", "shops", "feeds", "pins", "key_changes", "counts"} {
			if _, err := db.Exec("DROP TABLE IF EXISTS " + t); err != nil {
				return nil, err
			}
		}
	}
	if _, err := db.Exec(schema); err != nil {
		return nil, err
	}
	if _, err := db.Exec(fmt.Sprintf("PRAGMA user_version = %d", SchemaVersion)); err != nil {
		return nil, err
	}
	return x, nil
}

// Close closes the file.
func (x *Index) Close() error { return x.db.Close() }

const schema = `
      CREATE TABLE IF NOT EXISTS feeds (url TEXT PRIMARY KEY, source TEXT NOT NULL, etag TEXT, fetched_at INTEGER, checked_at INTEGER, wanted_at INTEGER, gone_since INTEGER, added_at INTEGER NOT NULL, error TEXT, body TEXT);
      CREATE TABLE IF NOT EXISTS pins (page TEXT PRIMARY KEY, key_id TEXT NOT NULL, key TEXT NOT NULL, since INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS key_changes (page TEXT PRIMARY KEY, pinned_key_id TEXT NOT NULL, offered_key_id TEXT NOT NULL, offered_key TEXT NOT NULL, seen_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS shops (page TEXT PRIMARY KEY, feed_url TEXT NOT NULL, name TEXT NOT NULL, trade TEXT, town TEXT NOT NULL, pincode TEXT, lat REAL, lon REAL, chat TEXT NOT NULL, check_url TEXT NOT NULL, agent_card TEXT, registration TEXT, languages TEXT NOT NULL, key_id TEXT NOT NULL, key TEXT NOT NULL, updated TEXT NOT NULL, status TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS items (shop_page TEXT NOT NULL, id TEXT NOT NULL, category TEXT NOT NULL, title TEXT NOT NULL, text TEXT NOT NULL, owner_language TEXT NOT NULL, machine TEXT NOT NULL, price_value TEXT, price_note TEXT, quantity INTEGER, photos TEXT NOT NULL, availability TEXT NOT NULL, confirmed TEXT NOT NULL, item_page TEXT NOT NULL, PRIMARY KEY (shop_page, id));
      CREATE INDEX IF NOT EXISTS items_category ON items (category);
      CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(title, body, rom, place, tokenize = "unicode61 remove_diacritics 0 categories 'L* N* Co Mn Mc'");
      CREATE TABLE IF NOT EXISTS counts (day TEXT NOT NULL, kind TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, kind));
`

const feedColumns = "url, source, etag, fetched_at, checked_at, wanted_at, gone_since, added_at, error, body IS NOT NULL"

func scanFeed(r interface{ Scan(...any) error }) (FeedRow, error) {
	var f FeedRow
	var etag, errText sql.NullString
	var fetched, checked, wanted, gone sql.NullInt64
	var has int
	if err := r.Scan(&f.URL, &f.Source, &etag, &fetched, &checked, &wanted, &gone, &f.AddedAt, &errText, &has); err != nil {
		return f, err
	}
	f.Etag, f.Error = nullStr(etag), nullStr(errText)
	f.FetchedAt, f.CheckedAt, f.WantedAt, f.GoneSince = nullInt(fetched), nullInt(checked), nullInt(wanted), nullInt(gone)
	f.HasBody = has == 1
	return f, nil
}

func nullStr(n sql.NullString) *string {
	if !n.Valid {
		return nil
	}
	return &n.String
}
func nullInt(n sql.NullInt64) *int64 {
	if !n.Valid {
		return nil
	}
	return &n.Int64
}

// ---- the list of feeds ----

// AddFeed adds a feed address if the directory does not know it yet; true when it was added.
func (x *Index) AddFeed(url, source string, now int64) bool {
	r, err := x.db.Exec("INSERT OR IGNORE INTO feeds (url, source, added_at) VALUES (?, ?, ?)", url, source, now)
	if err != nil {
		return false
	}
	n, _ := r.RowsAffected()
	return n > 0
}

// Feeds lists every feed, by address.
func (x *Index) Feeds() []FeedRow {
	rows, err := x.db.Query("SELECT " + feedColumns + " FROM feeds ORDER BY url")
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []FeedRow
	for rows.Next() {
		if f, err := scanFeed(rows); err == nil {
			out = append(out, f)
		}
	}
	return out
}

// Feed is one feed, or nil.
func (x *Index) Feed(url string) *FeedRow {
	f, err := scanFeed(x.db.QueryRow("SELECT "+feedColumns+" FROM feeds WHERE url = ?", url))
	if err != nil {
		return nil
	}
	return &f
}

// FeedCount is how many feeds there are.
func (x *Index) FeedCount() int {
	var n int
	_ = x.db.QueryRow("SELECT COUNT(*) FROM feeds").Scan(&n)
	return n
}

// Want records a hint (a notice) that the feed changed: it wants reading at the next chance.
func (x *Index) Want(url string, now int64) {
	_, _ = x.db.Exec("UPDATE feeds SET wanted_at = ? WHERE url = ?", now, url)
}

// Touch records an attempt at reading, whatever its outcome (so the once-a-minute rule counts attempts).
func (x *Index) Touch(url string, now int64, errText *string) {
	_, _ = x.db.Exec("UPDATE feeds SET checked_at = ?, wanted_at = NULL, error = ? WHERE url = ?", now, errText, url)
}

// ClearGone notes that the feed answered again (a 304).
func (x *Index) ClearGone(url string) {
	_, _ = x.db.Exec("UPDATE feeds SET gone_since = NULL WHERE url = ?", url)
}

// MarkGone: the feed answered 404 or 410: remember since when, and return that moment.
func (x *Index) MarkGone(url string, now int64) int64 {
	_, _ = x.db.Exec("UPDATE feeds SET gone_since = COALESCE(gone_since, ?) WHERE url = ?", now, url)
	var since int64
	_ = x.db.QueryRow("SELECT gone_since FROM feeds WHERE url = ?", url).Scan(&since)
	return since
}

// DropFeed removes a feed and every shop and item it gave. Its pinned key is kept (the shop may come back).
func (x *Index) DropFeed(url string) {
	rows, err := x.db.Query("SELECT page FROM shops WHERE feed_url = ?", url)
	var pages []string
	if err == nil {
		for rows.Next() {
			var p string
			_ = rows.Scan(&p)
			pages = append(pages, p)
		}
		rows.Close()
	}
	for _, p := range pages {
		x.removeShop(x.db, p)
	}
	_, _ = x.db.Exec("DELETE FROM feeds WHERE url = ?", url)
}

// ---- keys ----

// PinOf is the key pinned for a shop page, or nil.
func (x *Index) PinOf(page string) *Pin {
	var p Pin
	if x.db.QueryRow("SELECT key_id, key FROM pins WHERE page = ?", page).Scan(&p.KeyID, &p.Key) != nil {
		return nil
	}
	return &p
}

func (x *Index) pin(e execer, page string, p Pin, now int64) {
	_, _ = e.Exec("INSERT INTO pins (page, key_id, key, since) VALUES (?, ?, ?, ?) ON CONFLICT(page) DO UPDATE SET key_id = excluded.key_id, key = excluded.key, since = excluded.since", page, p.KeyID, p.Key, now)
}

// Hold records a feed signed by another key than the pinned one: its items are held (the shop is hidden from search) and the change is listed.
func (x *Index) Hold(page, pinnedKeyID string, offered Pin, now int64) {
	_, _ = x.db.Exec("INSERT INTO key_changes (page, pinned_key_id, offered_key_id, offered_key, seen_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(page) DO UPDATE SET offered_key_id = excluded.offered_key_id, offered_key = excluded.offered_key, seen_at = excluded.seen_at", page, pinnedKeyID, offered.KeyID, offered.Key, now)
	_, _ = x.db.Exec("UPDATE shops SET status = 'held' WHERE page = ?", page)
}

// KeyChanges lists what waits for a person, oldest first.
func (x *Index) KeyChanges() []KeyChange {
	rows, err := x.db.Query("SELECT page, pinned_key_id, offered_key_id, offered_key, seen_at FROM key_changes ORDER BY seen_at")
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []KeyChange
	for rows.Next() {
		var c KeyChange
		if rows.Scan(&c.Page, &c.PinnedKeyID, &c.OfferedKeyID, &c.OfferedKey, &c.SeenAt) == nil {
			out = append(out, c)
		}
	}
	return out
}

// AcceptKeyChange: a person looked at the change and accepts the new key: it becomes the pinned one and the shop is read again at the next refresh.
func (x *Index) AcceptKeyChange(page string, now int64) bool {
	var c *KeyChange
	for _, k := range x.KeyChanges() {
		if k.Page == page {
			k := k
			c = &k
		}
	}
	if c == nil {
		return false
	}
	x.pin(x.db, page, Pin{c.OfferedKeyID, c.OfferedKey}, now)
	_, _ = x.db.Exec("DELETE FROM key_changes WHERE page = ?", page)
	_, _ = x.db.Exec("UPDATE feeds SET etag = NULL, wanted_at = ? WHERE url = (SELECT feed_url FROM shops WHERE page = ?)", now, page)
	return true
}

// ---- putting a feed in ----

type execer interface {
	Exec(query string, args ...any) (sql.Result, error)
}

func jsonText(v any) string { b, _ := marshalNoEscape(v); return string(b) }

func nilIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// Ingest: a feed accepted: the shop and its items replace what was there. body is the exact text, kept so the index can be made again without the network.
func (x *Index) Ingest(feedURL string, feed Feed, pin Pin, body string, etag *string, now int64) error {
	tx, err := x.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	s := feed.Shop
	x.removeShop(tx, s.Page)
	var lat, lon any
	if s.Place.Lat != "" {
		f, _ := strconv.ParseFloat(s.Place.Lat, 64)
		lat = f
	}
	if s.Place.Lon != "" {
		f, _ := strconv.ParseFloat(s.Place.Lon, 64)
		lon = f
	}
	var reg any
	if s.Registration != nil {
		reg = jsonText(s.Registration)
	}
	if _, err := tx.Exec("INSERT INTO shops (page, feed_url, name, trade, town, pincode, lat, lon, chat, check_url, agent_card, registration, languages, key_id, key, updated, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ok')",
		s.Page, feedURL, s.Name, nilIfEmpty(s.Trade), s.Place.Town, nilIfEmpty(s.Place.Pincode), lat, lon, s.Chat, s.Check, nilIfEmpty(s.AgentCard), reg, jsonText(s.Languages), pin.KeyID, pin.Key, feed.Updated); err != nil {
		return err
	}
	// the place is the town and pincode as written, and the town's Latin skeleton (so "thrissur" finds a shop whose town is written in Malayalam)
	place := normal(s.Place.Town+" "+s.Place.Pincode) + " " + skeleton(s.Place.Town)
	for _, it := range feed.Items {
		var note, qty any
		var price any
		if it.Price != nil {
			price = it.Price.Value
			note = nilIfEmpty(it.Price.Note)
		}
		if it.Quantity != nil {
			qty = *it.Quantity
		}
		r, err := tx.Exec("INSERT INTO items (shop_page, id, category, title, text, owner_language, machine, price_value, price_note, quantity, photos, availability, confirmed, item_page) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
			s.Page, it.ID, it.Category, jsonText(it.Title), jsonText(it.Text), it.OwnerLanguage, jsonText(it.MachineWritten), price, note, qty, jsonText(it.Photos), it.Availability, it.Confirmed, it.Page)
		if err != nil {
			return err
		}
		rowid, _ := r.LastInsertId()
		title, text := normal(values(it.Title)), normal(values(it.Text))
		// the category's own word is searchable ("pets" is a thing people type); the town is in `place`, not here, so a town word never makes an unrelated item a match
		rom := skeleton(title+" "+text) + " " + strings.ReplaceAll(it.Category, "_", " ")
		if _, err := tx.Exec("INSERT INTO items_fts (rowid, title, body, rom, place) VALUES (?, ?, ?, ?, ?)", rowid, title, text, rom, place); err != nil {
			return err
		}
	}
	if _, err := tx.Exec("INSERT INTO feeds (url, source, added_at) VALUES (?, 'notice', ?) ON CONFLICT(url) DO NOTHING", feedURL, now); err != nil {
		return err
	}
	if _, err := tx.Exec("UPDATE feeds SET body = ?, etag = ?, fetched_at = ?, checked_at = ?, wanted_at = NULL, gone_since = NULL, error = NULL WHERE url = ?", body, etag, now, now, feedURL); err != nil {
		return err
	}
	if _, err := tx.Exec("DELETE FROM key_changes WHERE page = ?", s.Page); err != nil {
		return err
	}
	x.pin(tx, s.Page, pin, now)
	return tx.Commit()
}

// values is `Object.values(words).join(" ")`: the words in Langs order.
func values(w LangWords) string {
	var parts []string
	for _, l := range Langs {
		if v, ok := w[l]; ok {
			parts = append(parts, v)
		}
	}
	return strings.Join(parts, " ")
}

func (x *Index) removeShop(e execer, page string) {
	_, _ = e.Exec("DELETE FROM items_fts WHERE rowid IN (SELECT rowid FROM items WHERE shop_page = ?)", page)
	_, _ = e.Exec("DELETE FROM items WHERE shop_page = ?", page)
	_, _ = e.Exec("DELETE FROM shops WHERE page = ?", page)
}

// WipeDerived throws the derived tables away (shops, items, words); the feeds with their stored bodies, the pins and the key changes stay.
func (x *Index) WipeDerived() {
	_, _ = x.db.Exec("DELETE FROM items_fts; DELETE FROM items; DELETE FROM shops;")
}

// StoredFeed is a feed with the text last accepted for it.
type StoredFeed struct {
	URL, Body string
	Etag      *string
	FetchedAt *int64
}

// StoredFeeds lists every feed that has a stored text.
func (x *Index) StoredFeeds() []StoredFeed {
	rows, err := x.db.Query("SELECT url, body, etag, fetched_at FROM feeds WHERE body IS NOT NULL ORDER BY url")
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []StoredFeed
	for rows.Next() {
		var f StoredFeed
		var etag sql.NullString
		var at sql.NullInt64
		if rows.Scan(&f.URL, &f.Body, &etag, &at) == nil {
			f.Etag, f.FetchedAt = nullStr(etag), nullInt(at)
			out = append(out, f)
		}
	}
	return out
}

// ---- reading ----

const shopColumns = "page, feed_url, name, trade, town, pincode, lat, lon, chat, check_url, agent_card, registration, languages, key_id, key, updated, status"

func scanShop(r interface{ Scan(...any) error }) (*ShopRow, error) {
	var s ShopRow
	var trade, pin, card, reg, langs sql.NullString
	var lat, lon sql.NullFloat64
	if err := r.Scan(&s.Page, &s.FeedURL, &s.Name, &trade, &s.Town, &pin, &lat, &lon, &s.Chat, &s.Check, &card, &reg, &langs, &s.KeyID, &s.Key, &s.Updated, &s.Status); err != nil {
		return nil, err
	}
	s.Trade, s.PincodeP, s.AgentCard = nullStr(trade), nullStr(pin), nullStr(card)
	if lat.Valid {
		s.Lat = &lat.Float64
	}
	if lon.Valid {
		s.Lon = &lon.Float64
	}
	if reg.Valid {
		var r Registration
		if json.Unmarshal([]byte(reg.String), &r) == nil {
			s.Registration = &r
		}
	}
	s.Languages = []string{}
	if langs.Valid {
		_ = json.Unmarshal([]byte(langs.String), &s.Languages)
	}
	return &s, nil
}

const itemColumns = "shop_page, id, category, title, text, owner_language, machine, price_value, price_note, quantity, photos, availability, confirmed, item_page"

func scanItem(r interface{ Scan(...any) error }) (ItemRow, error) {
	var i ItemRow
	var title, text, machine, photos string
	var pv, pn sql.NullString
	var qty sql.NullInt64
	if err := r.Scan(&i.Shop, &i.ID, &i.Category, &title, &text, &i.OwnerLanguage, &machine, &pv, &pn, &qty, &photos, &i.Availability, &i.Confirmed, &i.Page); err != nil {
		return i, err
	}
	i.Title, i.Text, i.MachineWritten, i.Photos = LangWords{}, LangWords{}, []string{}, []Photo{}
	_ = json.Unmarshal([]byte(title), &i.Title)
	_ = json.Unmarshal([]byte(text), &i.Text)
	_ = json.Unmarshal([]byte(machine), &i.MachineWritten)
	_ = json.Unmarshal([]byte(photos), &i.Photos)
	if pv.Valid {
		i.Price = &Price{Value: pv.String, Currency: "INR"}
		if pn.Valid && pn.String != "" {
			i.Price.Note = pn.String
		}
	}
	i.Quantity = nullInt(qty)
	return i, nil
}

// Shop is one shop by page, or nil.
func (x *Index) Shop(page string) *ShopRow {
	s, err := scanShop(x.db.QueryRow("SELECT "+shopColumns+" FROM shops WHERE page = ?", page))
	if err != nil {
		return nil
	}
	return s
}

// Item is one item of a shop that is not held, with its shop.
func (x *Index) Item(page, id string) (*ShopRow, *ItemRow) {
	s := x.Shop(page)
	if s == nil || s.Status != "ok" {
		return nil, nil
	}
	i, err := scanItem(x.db.QueryRow("SELECT "+itemColumns+" FROM items WHERE shop_page = ? AND id = ?", page, id))
	if err != nil {
		return nil, nil
	}
	return s, &i
}

// ItemsOf is a shop's items by id.
func (x *Index) ItemsOf(page string) []ItemRow {
	rows, err := x.db.Query("SELECT "+itemColumns+" FROM items WHERE shop_page = ? ORDER BY id", page)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []ItemRow
	for rows.Next() {
		if i, err := scanItem(rows); err == nil {
			out = append(out, i)
		}
	}
	return out
}

// Towns are the towns of the shops that are in, the most common first: the choices the buyer's assistant may name. Public facts from open feeds.
func (x *Index) Towns(limit int) []string {
	rows, err := x.db.Query("SELECT town FROM shops WHERE status = 'ok' GROUP BY town ORDER BY COUNT(*) DESC, town LIMIT ?", limit)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var t string
		if rows.Scan(&t) == nil {
			out = append(out, t)
		}
	}
	return out
}

// Counts is how many shops and items are in (not held).
func (x *Index) Counts() (shops, items int) {
	_ = x.db.QueryRow("SELECT COUNT(*) FROM shops WHERE status = 'ok'").Scan(&shops)
	_ = x.db.QueryRow("SELECT COUNT(*) FROM items JOIN shops ON shops.page = items.shop_page WHERE shops.status = 'ok'").Scan(&items)
	return
}

var notAlnum = regexp.MustCompile(`[^a-z0-9]`)
var endsVowel = regexp.MustCompile(`[aeiou]$`)

func ftsQuote(w string) string { return `"` + strings.ReplaceAll(w, `"`, "") + `"` }

// skeletonOf is a word's Latin skeleton as the index compares it: the last vowel is not asked for (a word may take an ending: "bekku", "bekkina"), as the match is by word start.
func skeletonOf(word string) string {
	sk := notAlnum.ReplaceAllString(skeleton(word), "")
	if len(sk) >= 4 {
		sk = endsVowel.ReplaceAllString(sk, "")
	}
	return sk
}

// contentTerm is the FTS5 text for a word in what an item SAYS: it starts a word in the titles or the texts, or its Latin skeleton starts a word in the spelling column.
func contentTerm(word string) string {
	sk := skeletonOf(word)
	extra := ""
	if len(sk) >= 2 {
		extra = " OR rom : " + ftsQuote(sk) + "*"
	}
	return "({title body} : " + ftsQuote(word) + "*" + extra + ")"
}

// anyTerm is the same, or the word names the shop's town or pincode (the `place` column). A place word counts toward "every word" and never makes an item a match by itself.
func anyTerm(word string) string {
	sk := skeletonOf(word)
	extra := ""
	if len(sk) >= 2 {
		extra = " OR rom : " + ftsQuote(sk) + "* OR place : " + ftsQuote(sk) + "*"
	}
	return "({title body place} : " + ftsQuote(word) + "*" + extra + ")"
}

var errNoMatch = errors.New("no match")

func (x *Index) rowids(match, filter string, extra []any) []int64 {
	args := append([]any{match}, extra...)
	rows, err := x.db.Query("SELECT items.rowid FROM items_fts JOIN items ON items.rowid = items_fts.rowid JOIN shops ON shops.page = items.shop_page WHERE items_fts MATCH ? AND shops.status = 'ok'"+filter+" LIMIT "+strconv.Itoa(MaxCandidates), args...)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []int64
	for rows.Next() {
		var r int64
		if rows.Scan(&r) == nil {
			out = append(out, r)
		}
	}
	return out
}

// Candidates are the items that could answer a search, each with how well it fits (every word, or some), the distance and whether the shop is in the buyer's town. NO order is made
// here and no relevance score is read: order.go puts them in order. Shops whose key changed (held) are not here.
func (x *Index) Candidates(q IndexQuery) []Hit {
	var words []string
	for _, w := range q.Words {
		if n := normal(w); n != "" {
			words = append(words, n)
		}
	}
	filter, extra := "", []any{}
	if q.Category != "" {
		filter, extra = " AND items.category = ?", []any{q.Category}
	}
	all := map[int64]bool{}
	var anyIDs []int64
	if len(words) == 0 {
		rows, err := x.db.Query("SELECT items.rowid FROM items JOIN shops ON shops.page = items.shop_page WHERE shops.status = 'ok'"+filter+" LIMIT "+strconv.Itoa(MaxCandidates), extra...)
		if err == nil {
			for rows.Next() {
				var r int64
				if rows.Scan(&r) == nil {
					all[r] = true
					anyIDs = append(anyIDs, r)
				}
			}
			rows.Close()
		}
	} else {
		// every word, each found in the item's words OR in its shop's place; then the items that have at least one word in what they SAY (so "persian kitten Thrissur" never lists every item of a Thrissur shop)
		var every, some []string
		for _, w := range words {
			every = append(every, anyTerm(w))
			some = append(some, contentTerm(w))
		}
		ev := x.rowids(strings.Join(every, " AND "), filter, extra)
		so := x.rowids(strings.Join(some, " OR "), filter, extra)
		seen := map[int64]bool{}
		for _, r := range ev {
			all[r] = true
		}
		for _, r := range append(append([]int64{}, ev...), so...) {
			if !seen[r] {
				seen[r] = true
				anyIDs = append(anyIDs, r)
			}
		}
	}
	buyerTown := ""
	if q.Town != "" {
		buyerTown = jsTrim(normal(q.Town))
	}
	buyerSkeleton := ""
	if buyerTown != "" {
		buyerSkeleton = skeleton(buyerTown)
	}
	shops := map[string]*ShopRow{}
	var hits []Hit
	for _, rid := range anyIDs {
		item, err := scanItem(x.db.QueryRow("SELECT "+itemColumns+" FROM items WHERE rowid = ?", rid))
		if err != nil {
			continue
		}
		shop := shops[item.Shop]
		if shop == nil {
			if shop = x.Shop(item.Shop); shop == nil {
				continue
			}
			shops[item.Shop] = shop
		}
		pincode := ""
		if shop.PincodeP != nil {
			pincode = *shop.PincodeP
		}
		sameTown := buyerTown != "" && (normal(shop.Town) == buyerTown || skeleton(shop.Town) == buyerSkeleton || (shop.PincodeP != nil && pincode == buyerTown))
		var dist *float64
		if q.Point != nil && shop.Lat != nil && shop.Lon != nil {
			d := haversineKm(q.Point[0], q.Point[1], *shop.Lat, *shop.Lon)
			dist = &d
		}
		if q.RadiusKm != nil && q.Point != nil {
			// a radius keeps shops inside it; a shop with no map point stays only when it is in the buyer's own town
			if dist == nil && !sameTown || dist != nil && *dist > *q.RadiusKm {
				continue
			}
		}
		fit := 1
		if all[rid] {
			fit = 0
		}
		hits = append(hits, Hit{Shop: shop, Item: item, Fit: fit, DistanceKm: dist, SameTown: sameTown})
	}
	return hits
}

// Count adds to a day's count of searches or results: the only record of a search (how many, never whose or what).
func (x *Index) Count(day, kind string, n int) {
	_, _ = x.db.Exec("INSERT INTO counts (day, kind, n) VALUES (?, ?, ?) ON CONFLICT(day, kind) DO UPDATE SET n = n + excluded.n", day, kind, n)
}
