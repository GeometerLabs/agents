// Shared helpers for the directory's unit tests (check_test.go, refresh_test.go, notices_test.go): a hand-made shop with its own signing key, and the signed feed, the signed
// check answer and the signed notice it would send. They follow specs/shop-feed.md and specs/shop-check.md field for field (the way modules/discovery/test/fixtures.ts did for the
// TypeScript tests this carries over), so the directory is tested against the specs and not against another program's code. No test here opens a socket.
package directory

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/GeometerLabs/agents/go/internal/signing"
)

// ttNow is 2026-11-18T09:00:00.000Z in milliseconds (fixtures.ts NOW).
var ttNow = time.Date(2026, 11, 18, 9, 0, 0, 0, time.UTC).UnixMilli()

func ttISO(ms int64) string { return time.UnixMilli(ms).UTC().Format("2006-01-02T15:04:05.000Z") }

// ttShop is one shop: its page, its feed address, its key.
type ttShop struct {
	page, feedURL string
	key           *signing.Key
}

func ttNewKey(t *testing.T) *signing.Key {
	t.Helper()
	k, _, err := signing.Generate()
	if err != nil {
		t.Fatal(err)
	}
	return k
}

// ttNewShop makes a shop at https://<host>/<slug>/ with a new key (key may be given to share one).
func ttNewShop(t *testing.T, host, slug string, key *signing.Key) ttShop {
	t.Helper()
	if key == nil {
		key = ttNewKey(t)
	}
	page := "https://" + host + "/" + slug + "/"
	return ttShop{page: page, feedURL: page + "listings.json", key: key}
}

// ttItem is a feed item; over replaces members.
func ttItem(s ttShop, id string, over map[string]any) map[string]any {
	it := map[string]any{
		"id": id, "page": s.page + "#" + id, "category": "pets",
		"title":         map[string]any{"en": "Persian kitten"},
		"text":          map[string]any{"en": "Two kittens, vaccinated by the vet."},
		"ownerLanguage": "en", "machineWritten": []any{},
		"price": map[string]any{"value": "8000.00", "currency": "INR", "note": "each"}, "quantity": 2,
		"photos": []any{}, "availability": "in_stock", "confirmed": "2026-11-17T04:10:00.000Z",
	}
	for k, v := range over {
		it[k] = v
	}
	return it
}

// feed is the signed feed document (shop-feed/1) as text.
func (s ttShop) feed(t *testing.T, updated string, items ...map[string]any) string {
	t.Helper()
	list := make([]any, len(items))
	for i, it := range items {
		list[i] = it
	}
	sealed, err := s.key.SealFeed(map[string]any{
		"format": "shop-feed/1", "updated": updated,
		"shop": map[string]any{"name": "Rani Pets", "page": s.page, "trade": "pet shop", "languages": []any{"en"}, "place": map[string]any{"town": "Thrissur"},
			"chat": s.page + "chat", "check": s.page + "api/v1/check", "agentCard": s.page + "agent-card.json"},
		"items": list,
	})
	if err != nil {
		t.Fatal(err)
	}
	return ttJSON(t, sealed)
}

// answer is the signed check answer (shop-check/1) as text (harness answerFor).
func (s ttShop) answer(t *testing.T, page string, at string, items ...map[string]any) string {
	t.Helper()
	list := make([]any, len(items))
	for i, it := range items {
		list[i] = it
	}
	sealed, err := s.key.SealAnswer(map[string]any{"format": "shop-check/1", "page": page, "at": at, "items": list})
	if err != nil {
		t.Fatal(err)
	}
	return ttJSON(t, sealed)
}

// notice is the signed "my feed changed" notice, as a map so a test can change a member after signing.
func (s ttShop) notice(t *testing.T, key *signing.Key) map[string]any {
	t.Helper()
	if key == nil {
		key = s.key
	}
	sealed, err := key.SealNotice(map[string]any{"format": "shop-feed-changed/1", "feed": s.feedURL, "updated": "2026-11-18T03:30:00.000Z"})
	if err != nil {
		t.Fatal(err)
	}
	return sealed
}

func ttJSON(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

// ttReparse reads a signed document's text into a map so a test can change it after signing.
func ttReparse(t *testing.T, text string) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal([]byte(text), &m); err != nil {
		t.Fatal(err)
	}
	return m
}
