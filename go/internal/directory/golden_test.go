// The feed reader and the pages against what the TypeScript directory gave on the same inputs, recorded on 19 Nov 2026 by go/scripts/gen_directory_vectors.ts before the TypeScript was
// deleted (decision 61, wave 1c): testdata/feeds.json.gz (a good feed and one change at a time: what is refused whole and why, what is dropped, what is kept and how it reads; the cases
// of modules/discovery/test/feed.test.ts and the edges it did not try) and testdata/pages.json.gz (the search page in every state, in four languages, with and without the assistant,
// and the order page: the cases of page.test.ts, whole). Since the deletion these files are the source: change them only with a change of behaviour that is meant.
package directory

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"os"
	"reflect"
	"regexp"
	"strings"
	"testing"
)

func gunzipJSON(t *testing.T, file string, into any) {
	t.Helper()
	raw, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	zr, err := gzip.NewReader(bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	text, err := io.ReadAll(zr)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(text, into); err != nil {
		t.Fatal(err)
	}
}

// asTS is a read feed in the TypeScript reader's shape (feed.ts FeedRead's `feed`), decoded back to plain values so the two compare member for member.
func asTS(f Feed) any {
	shop := map[string]any{"name": f.Shop.Name, "page": f.Shop.Page, "languages": f.Shop.Languages, "place": f.Shop.Place, "chat": f.Shop.Chat, "check": f.Shop.Check}
	if f.Shop.AgentCard != "" {
		shop["agentCard"] = f.Shop.AgentCard
	}
	if f.Shop.Trade != "" {
		shop["trade"] = f.Shop.Trade
	}
	if f.Shop.Registration != nil {
		shop["registration"] = f.Shop.Registration
	}
	items := []any{}
	for _, it := range f.Items {
		m := map[string]any{"id": it.ID, "page": it.Page, "category": it.Category, "title": it.Title, "text": it.Text, "ownerLanguage": it.OwnerLanguage, "machineWritten": it.MachineWritten,
			"price": it.Price, "photos": it.Photos, "availability": it.Availability, "confirmed": it.Confirmed}
		if it.Quantity != nil {
			m["quantity"] = *it.Quantity
		}
		items = append(items, m)
	}
	b, _ := json.Marshal(map[string]any{"format": "shop-feed/1", "updated": f.Updated, "shop": shop, "items": items})
	var out any
	_ = json.Unmarshal(b, &out)
	return out
}

func TestFeedsReadAsTheTypeScriptReadThem(t *testing.T) {
	var all struct {
		URL   string
		Feeds []struct {
			Name    string
			Doc     any
			OK      bool
			Reason  string
			Feed    any
			Dropped []string
		}
	}
	gunzipJSON(t, "testdata/feeds.json.gz", &all)
	if len(all.Feeds) < 40 {
		t.Fatalf("only %d feeds", len(all.Feeds))
	}
	for _, v := range all.Feeds {
		// a lone surrogate written as \ud800 in JSON is read by Go's decoder as U+FFFD, so the reader cannot see it (the TypeScript refuses the name): Deferred.md
		if v.Name == "lone surrogate name" {
			continue
		}
		got := ReadFeed(v.Doc, all.URL)
		switch {
		case got.OK != v.OK:
			t.Errorf("%s: Go ok=%v (%s), TypeScript ok=%v (%s)", v.Name, got.OK, got.Reason, v.OK, v.Reason)
		case !v.OK && got.Reason != v.Reason:
			t.Errorf("%s: Go refuses with %q, TypeScript with %q", v.Name, got.Reason, v.Reason)
		case v.OK:
			dropped := got.Dropped
			if dropped == nil {
				dropped = []string{}
			}
			if v.Dropped == nil {
				v.Dropped = []string{}
			}
			if !reflect.DeepEqual(dropped, v.Dropped) {
				t.Errorf("%s: dropped\n Go %q\n TS %q", v.Name, dropped, v.Dropped)
			}
			if g := asTS(got.Feed); !reflect.DeepEqual(g, v.Feed) {
				gb, _ := json.Marshal(g)
				wb, _ := json.Marshal(v.Feed)
				t.Errorf("%s: the feed read\n Go %s\n TS %s", v.Name, gb, wb)
			}
		}
	}
}

var styleBlock = regexp.MustCompile(`(?s)<style>(.*?)</style>`)

func styleHashed(html string) string {
	return styleBlock.ReplaceAllStringFunc(html, func(m string) string {
		sum := sha256.Sum256([]byte(styleBlock.FindStringSubmatch(m)[1]))
		return "<style>sha256:" + hex.EncodeToString(sum[:]) + "</style>"
	})
}

func TestPagesAreTheTypeScriptPages(t *testing.T) {
	var all struct {
		Now   int64
		Pages []struct {
			Name, Lang string
			Assistant  bool
			Form       map[string]string
			View       *struct {
				State   string
				Answer  *SearchAnswer
				Message string
			}
			Assist *struct{ Line, Notice *string }
			HTML   string
		}
	}
	gunzipJSON(t, "testdata/pages.json.gz", &all)
	if len(all.Pages) != 44 {
		t.Fatalf("%d pages", len(all.Pages))
	}
	for _, p := range all.Pages {
		ctx := PageContext{Origin: "https://pages.example", Lang: p.Lang, Now: all.Now, Nonce: "NONCE", FontURL: "/search/font.woff2", Assistant: p.Assistant}
		var html string
		if p.Name == "order" {
			html = OrderPage(ctx)
		} else {
			f := FormValues{Q: p.Form["q"], Category: p.Form["category"], Town: p.Form["town"], Lat: p.Form["lat"], Lon: p.Form["lon"], RadiusKm: p.Form["radius_km"], Ask: p.Form["ask"]}
			var assist *AssistBits
			if p.Assist != nil {
				assist = &AssistBits{}
				if p.Assist.Line != nil {
					assist.Line = *p.Assist.Line
				}
				if p.Assist.Notice != nil {
					assist.Notice = *p.Assist.Notice
				}
			}
			html = SearchPage(ctx, f, SearchView{State: p.View.State, Answer: p.View.Answer, Message: p.View.Message}, assist)
		}
		if got := styleHashed(html); got != p.HTML {
			i := 0
			for i < len(got) && i < len(p.HTML) && got[i] == p.HTML[i] {
				i++
			}
			from := max(0, i-120)
			t.Errorf("%s (%s, assistant %v) differs at byte %d:\n Go %q\n TS %q", p.Name, p.Lang, p.Assistant, i, got[from:min(len(got), i+160)], p.HTML[from:min(len(p.HTML), i+160)])
		}
	}
	if !strings.Contains(all.Pages[0].HTML, "<style>sha256:") {
		t.Fatal("the pages were recorded without their style sheet")
	}
}
