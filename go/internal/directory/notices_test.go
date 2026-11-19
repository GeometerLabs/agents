// "My feed changed", carried over from modules/discovery/test/notices.test.ts: a notice is only a hint. An unknown shop's notice (even with a junk signature) is taken and makes the
// feed wanted; a known shop's notice must be signed with its own key and unchanged since; an address outside the served pages domains is refused; junk is a 400; and the number of
// feeds is capped so notices cannot fill the directory.
package directory

import (
	"fmt"
	"path/filepath"
	"testing"
)

func ttOpen(t *testing.T) *Index {
	t.Helper()
	ix, err := OpenIndex(filepath.Join(t.TempDir(), "directory.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ix.Close() })
	return ix
}

func ttNoticeCfg(ix *Index) NoticeConfig {
	return NoticeConfig{Index: ix, Served: []string{"pages.example"}, Configured: []string{"https://builder.example/s/ravi/listings.json"}, Now: func() int64 { return ttNow }}
}

func ttNoticeBody(t *testing.T, m map[string]any) []byte { return []byte(ttJSON(t, m)) }

func TestNoticeFromAnUnknownShopIsAHint(t *testing.T) {
	ix := ttOpen(t)
	cfg := ttNoticeCfg(ix)
	s := ttNewShop(t, "pages.example", "rani-pets", nil)
	if a := HandleNotice(cfg, ttNoticeBody(t, s.notice(t, nil))); a.Status != 202 || !a.OK {
		t.Fatalf("an unknown shop's notice is taken: %+v", a)
	}
	f := ix.Feed(s.feedURL)
	if f == nil || f.Source != "notice" || f.WantedAt == nil || *f.WantedAt != ttNow {
		t.Fatalf("the feed is added and wanted: %+v", f)
	}
	// no key is known, so a junk signature is no reason to refuse: all the notice does is get the feed read
	other := ttNewShop(t, "pages.example", "ravi-cuts", nil)
	junk := other.notice(t, nil)
	junk["sig"] = "junk"
	junk["keyId"] = "nobody"
	if a := HandleNotice(cfg, ttNoticeBody(t, junk)); a.Status != 202 {
		t.Fatalf("junk signature on an unknown shop: %+v", a)
	}
	if f := ix.Feed(other.feedURL); f == nil || f.WantedAt == nil {
		t.Fatal("the feed must be wanted")
	}
}

func TestNoticeForAKnownShopMustBeItsOwn(t *testing.T) {
	ix := ttOpen(t)
	cfg := ttNoticeCfg(ix)
	s := ttNewShop(t, "pages.example", "rani-pets", nil)
	ix.AddFeed(s.feedURL, "config", ttNow)
	if r := IngestFeed(ix, s.feedURL, s.feed(t, "2026-11-18T03:30:00.000Z", ttItem(s, "l-3", nil)), nil, ttNow, false); r.State != "accepted" {
		t.Fatalf("setup: %+v", r)
	}
	if a := HandleNotice(cfg, ttNoticeBody(t, s.notice(t, ttNewKey(t)))); a.Status != 403 {
		t.Fatalf("signed by a stranger: %+v", a)
	}
	changed := s.notice(t, nil)
	changed["updated"] = "2026-11-19T00:00:00.000Z"
	if a := HandleNotice(cfg, ttNoticeBody(t, changed)); a.Status != 403 {
		t.Fatalf("changed after signing: %+v", a)
	}
	if a := HandleNotice(cfg, ttNoticeBody(t, s.notice(t, nil))); a.Status != 202 {
		t.Fatalf("its own notice: %+v", a)
	}
}

func TestNoticeAddressMustBeUnderAServedDomainOrConfigured(t *testing.T) {
	ix := ttOpen(t)
	cfg := ttNoticeCfg(ix)
	s := ttNewShop(t, "pages.example", "rani-pets", nil)
	for _, feed := range []string{"https://evil.example/rani-pets/listings.json", "http://pages.example/rani-pets/listings.json", "https://pages.example/rani-pets/other.json",
		"https://pages.example:8443/rani-pets/listings.json", "https://pages.example/rani-pets/listings.json?x=1", "https://pages.example/a/b/listings.json",
		"https://user:pw@pages.example/rani-pets/listings.json", "https://builder.example/s/other/listings.json", "file:///etc/passwd", "not a url"} {
		n := s.notice(t, nil)
		n["feed"] = feed // changed after signing is fine here: the address is judged first
		if a := HandleNotice(cfg, ttNoticeBody(t, n)); a.Status != 403 {
			t.Errorf("%s: want 403, got %d", feed, a.Status)
		}
	}
	if len(ix.Feeds()) != 0 {
		t.Fatal("nothing refused was kept")
	}
	n := s.notice(t, nil)
	n["feed"] = "https://builder.example/s/ravi/listings.json"
	if a := HandleNotice(cfg, ttNoticeBody(t, n)); a.Status != 202 {
		t.Fatalf("a configured address is allowed: %+v", a)
	}
}

func TestNoticeJunkIsA400(t *testing.T) {
	cfg := ttNoticeCfg(ttOpen(t))
	for _, bad := range []string{"null", "[]", `"x"`, "not json", `{"format":"shop-feed-changed/2"}`, `{"format":"shop-feed-changed/1","feed":5}`,
		`{"format":"shop-feed-changed/1","feed":"https://pages.example/rani-pets/listings.json","updated":"x","keyId":"k"}`} {
		if a := HandleNotice(cfg, []byte(bad)); a.Status != 400 {
			t.Errorf("%s: want 400, got %d", bad, a.Status)
		}
	}
}

func TestNoticeFeedCountIsCapped(t *testing.T) {
	ix, err := OpenIndex(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer ix.Close()
	for i := 0; i < MaxFeeds; i++ {
		ix.AddFeed(fmt.Sprintf("https://pages.example/shop-%dx/listings.json", i), "notice", ttNow)
	}
	cfg := ttNoticeCfg(ix)
	s := ttNewShop(t, "pages.example", "rani-pets", nil)
	if a := HandleNotice(cfg, ttNoticeBody(t, s.notice(t, nil))); a.Status != 429 {
		t.Fatalf("a new feed at the cap: %+v", a)
	}
	known := ttNewShop(t, "pages.example", "shop-0x", nil)
	if a := HandleNotice(cfg, ttNoticeBody(t, known.notice(t, nil))); a.Status != 202 {
		t.Fatalf("a feed already held is still hinted at the cap: %+v", a)
	}
}
