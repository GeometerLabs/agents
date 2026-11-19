// Reading feeds from the network, carried over from modules/discovery/test/notices.test.ts (the refresh half) and index.test.ts: a first good feed is accepted and its items are
// searchable; a later read sends If-None-Match and a 304 is "unchanged"; a shop that was accepted and then serves a tampered feed, junk, HTTP 500 or nothing keeps its old items and old
// price and the feed row says why; a re-read with fewer items replaces the old list; a 404 or 410 keeps the items until a whole day has passed, then drops the feed (the pin stays);
// a feed is due again after 6 hours, a hinted one at most once a minute; a feed signed by another key is held. The network is a fake Fetcher; the index is a real file in a temp folder.
package directory

import (
	"errors"
	"sort"
	"testing"
)

// ttNet answers each read from a function and logs the requests.
type ttNet struct {
	answer func(url string, h map[string]string) (FetchResponse, error)
	log    []FetchRequest
}

func (n *ttNet) fetch(url string, in FetchRequest) (FetchResponse, error) {
	n.log = append(n.log, in)
	return n.answer(url, in.Headers)
}

func ttIDs(ix *Index, q string) []string {
	ids := []string{}
	for _, h := range ix.Candidates(IndexQuery{Words: searchWords(q)}) {
		ids = append(ids, h.Item.ID)
	}
	sort.Strings(ids)
	return ids
}

func ttEqual(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestRefreshFirstReadSecondReadAndTheClock(t *testing.T) {
	s := ttNewShop(t, "pages.example", "rani-pets", nil)
	ix := ttOpen(t)
	ix.AddFeed(s.feedURL, "config", ttNow)
	body := s.feed(t, "2026-11-18T03:30:00.000Z", ttItem(s, "l-3", nil))
	n := &ttNet{answer: func(_ string, h map[string]string) (FetchResponse, error) {
		if h["if-none-match"] == `"v1"` {
			return FetchResponse{Status: 304}, nil
		}
		return FetchResponse{Status: 200, Headers: map[string]string{"etag": `"v1"`}, Body: body}, nil
	}}
	now := ttNow
	deps := ReadDeps{Index: ix, Fetch: n.fetch, Now: func() int64 { return now }}

	if r := RefreshDue(deps, 2); len(r) != 1 || r[s.feedURL] != "accepted" {
		t.Fatalf("a feed never read is read and accepted: %v", r)
	}
	if !ttEqual(ttIDs(ix, "kitten"), []string{"l-3"}) {
		t.Fatalf("the accepted items are searchable: %v", ttIDs(ix, "kitten"))
	}
	if f := ix.Feed(s.feedURL); f.Etag == nil || *f.Etag != `"v1"` || !f.HasBody {
		t.Fatalf("the etag and the kept copy are recorded: %+v", f)
	}
	if len(n.log[0].Headers) != 1 {
		t.Fatalf("the first read has no If-None-Match: %v", n.log[0].Headers)
	}
	if r := RefreshDue(deps, 2); len(r) != 0 {
		t.Fatalf("nothing is due straight after: %v", r)
	}
	now += RefreshMs - 1000
	if r := RefreshDue(deps, 2); len(r) != 0 {
		t.Fatalf("not yet 6 hours: %v", r)
	}
	now += 1000
	if r := RefreshDue(deps, 2); r[s.feedURL] != "unchanged" {
		t.Fatalf("after 6 hours the feed is asked again and a 304 is unchanged: %v", r)
	}
	if got := n.log[len(n.log)-1].Headers["if-none-match"]; got != `"v1"` {
		t.Fatalf("If-None-Match = %q", got)
	}

	// a hint: read only if the last read was over a minute ago
	now += 10_000
	ix.Want(s.feedURL, now)
	if r := RefreshDue(deps, 2); len(r) != 0 {
		t.Fatalf("10 seconds after the last read: not yet, %v", r)
	}
	now += MinRereadMs
	if r := RefreshDue(deps, 2); r[s.feedURL] != "unchanged" {
		t.Fatalf("a hinted feed is read once a minute has passed: %v", r)
	}
	if ix.Feed(s.feedURL).WantedAt != nil {
		t.Fatal("the hint is used up")
	}
	row := *ix.Feed(s.feedURL)
	row.CheckedAt = nil
	if !IsDue(row, now) {
		t.Fatal("a feed never read is due")
	}
}

func TestRefreshKeepsWhatItHasWhenTheShopMisbehaves(t *testing.T) {
	s := ttNewShop(t, "pages.example", "rani-pets", nil)
	ix := ttOpen(t)
	ix.AddFeed(s.feedURL, "config", ttNow)
	good := s.feed(t, "2026-11-18T03:30:00.000Z", ttItem(s, "l-3", nil))
	tampered := ttReparse(t, good)
	tampered["items"].([]any)[0].(map[string]any)["price"].(map[string]any)["value"] = "1.00"
	mode := "good"
	n := &ttNet{answer: func(string, map[string]string) (FetchResponse, error) {
		switch mode {
		case "down":
			return FetchResponse{}, errors.New("connection refused")
		case "500":
			return FetchResponse{Status: 500}, nil
		case "junk":
			return FetchResponse{Status: 200, Body: "<html>"}, nil
		case "tampered":
			return FetchResponse{Status: 200, Body: ttJSON(t, tampered)}, nil
		}
		return FetchResponse{Status: 200, Body: good}, nil
	}}
	now := ttNow
	deps := ReadDeps{Index: ix, Fetch: n.fetch, Now: func() int64 { return now }}
	if r, _ := ReadFeedNow(deps, s.feedURL); r != "accepted" {
		t.Fatalf("setup: %s", r)
	}
	for _, m := range []string{"down", "500", "junk", "tampered"} {
		mode = m
		now += 5 * RefreshMs // far more than a day
		r, _ := ReadFeedNow(deps, s.feedURL)
		if r != "error" && r != "refused" {
			t.Errorf("%s: result %s", m, r)
		}
		if c, _ := ix.Counts(); c != 1 {
			t.Errorf("%s: the shop's items stay (shops=%d)", m, c)
		}
		if _, it := ix.Item(s.page, "l-3"); it == nil || it.Price == nil || it.Price.Value != "8000.00" {
			t.Errorf("%s: the old price stays: %+v", m, it)
		}
		if f := ix.Feed(s.feedURL); f.Error == nil || *f.Error == "" {
			t.Errorf("%s: the reason is recorded", m)
		}
		if ix.Feed(s.feedURL).GoneSince != nil {
			t.Errorf("%s: not marked gone", m)
		}
	}
}

func TestRefreshFewerItemsReplaceTheOldList(t *testing.T) {
	s := ttNewShop(t, "pages.example", "rani-pets", nil)
	ix := ttOpen(t)
	ix.AddFeed(s.feedURL, "config", ttNow)
	body := s.feed(t, "2026-11-18T03:30:00.000Z", ttItem(s, "l-3", nil), ttItem(s, "l-4", map[string]any{"category": "food", "title": map[string]any{"en": "Cat food, 1 kg"}, "text": map[string]any{}}))
	n := &ttNet{answer: func(string, map[string]string) (FetchResponse, error) { return FetchResponse{Status: 200, Body: body}, nil }}
	now := ttNow
	deps := ReadDeps{Index: ix, Fetch: n.fetch, Now: func() int64 { return now }}
	ReadFeedNow(deps, s.feedURL)
	if !ttEqual(ttIDs(ix, "kitten"), []string{"l-3"}) {
		t.Fatalf("setup: %v", ttIDs(ix, "kitten"))
	}
	body = s.feed(t, "2026-11-18T05:00:00.000Z", ttItem(s, "l-9", map[string]any{"title": map[string]any{"en": "Parrot"}, "text": map[string]any{}}))
	now += RefreshMs
	if r, _ := ReadFeedNow(deps, s.feedURL); r != "accepted" {
		t.Fatalf("the shorter feed: %s", r)
	}
	if got := ttIDs(ix, "kitten"); len(got) != 0 {
		t.Fatalf("the dropped item's words no longer find it: %v", got)
	}
	if !ttEqual(ttIDs(ix, "parrot"), []string{"l-9"}) || len(ix.ItemsOf(s.page)) != 1 {
		t.Fatalf("only the new item is held: %v", ix.ItemsOf(s.page))
	}
}

func TestRefreshGoneIsDroppedAfterADayAndTheKeyStays(t *testing.T) {
	s := ttNewShop(t, "pages.example", "rani-pets", nil)
	ix := ttOpen(t)
	ix.AddFeed(s.feedURL, "config", ttNow)
	status := 200
	good := s.feed(t, "2026-11-18T03:30:00.000Z", ttItem(s, "l-3", nil))
	n := &ttNet{answer: func(string, map[string]string) (FetchResponse, error) {
		if status == 200 {
			return FetchResponse{Status: 200, Body: good}, nil
		}
		return FetchResponse{Status: status}, nil
	}}
	now := ttNow
	deps := ReadDeps{Index: ix, Fetch: n.fetch, Now: func() int64 { return now }}
	ReadFeedNow(deps, s.feedURL)
	after := func(ms int64) string { now += ms; r, _ := ReadFeedNow(deps, s.feedURL); return r }
	items := func() int { _, i := ix.Counts(); return i }
	status = 404
	if r := after(RefreshMs); r != "gone" {
		t.Fatalf("first 404: %s", r)
	}
	if r := after(RefreshMs); r != "gone" {
		t.Fatalf("second 404: %s", r)
	}
	if items() != 1 {
		t.Fatal("the items stay while the feed is only recently gone")
	}
	status = 200
	if r := after(RefreshMs); r != "accepted" {
		t.Fatalf("a good answer in between: %s", r)
	}
	if ix.Feed(s.feedURL).GoneSince != nil {
		t.Fatal("a good answer clears the gone clock")
	}
	status = 410
	if r := after(RefreshMs); r != "gone" {
		t.Fatalf("410: %s", r)
	}
	if r := after(DropAfterMs - 1000); r != "gone" {
		t.Fatalf("a second before a day: %s", r)
	}
	if r := after(1000); r != "dropped" {
		t.Fatalf("a whole day: %s", r)
	}
	if items() != 0 || ix.Feed(s.feedURL) != nil {
		t.Fatal("the feed and its items are gone")
	}
	if p := ix.PinOf(s.page); p == nil || p.KeyID != s.key.KeyID {
		t.Fatal("the key stays pinned in case the shop comes back")
	}
}

func TestRefreshFeedSignedByAnotherKeyIsHeld(t *testing.T) {
	s := ttNewShop(t, "pages.example", "rani-pets", nil)
	impostor := ttNewShop(t, "pages.example", "rani-pets", nil)
	ix := ttOpen(t)
	ix.AddFeed(s.feedURL, "config", ttNow)
	doc := s.feed(t, "2026-11-18T03:30:00.000Z", ttItem(s, "l-3", nil))
	n := &ttNet{answer: func(string, map[string]string) (FetchResponse, error) { return FetchResponse{Status: 200, Body: doc}, nil }}
	deps := ReadDeps{Index: ix, Fetch: n.fetch, Now: func() int64 { return ttNow }}
	if r, _ := ReadFeedNow(deps, s.feedURL); r != "accepted" {
		t.Fatal(r)
	}
	doc = impostor.feed(t, "2026-11-18T04:00:00.000Z", ttItem(s, "l-3", nil))
	if r, _ := ReadFeedNow(deps, s.feedURL); r != "held" {
		t.Fatalf("held: %s", r)
	}
	if _, items := ix.Counts(); items != 0 || len(ix.KeyChanges()) != 1 {
		t.Fatalf("the shop leaves the search and the change is listed: items=%d", items)
	}
}
