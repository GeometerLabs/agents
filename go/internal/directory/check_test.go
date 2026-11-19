// Asking a shop to confirm, carried over from modules/discovery/test/search.test.ts (the checks half): a good signed shop-check/1 answer is believed and kept 60 seconds; an answer
// that is old, from the future, changed after signing, signed by another key, naming another page or about an item not asked about is ignored (the checker is "silent", the search
// shows the index's copy); and the shop is sent the format name and the item ids only, never the search words. The shop is a fake Fetcher; the clock is set by the test.
package directory

import (
	"encoding/json"
	"testing"
)

// ttCheckWorld is a shop whose check address answers from a function, and a clock the test sets.
type ttCheckWorld struct {
	shop  ttShop
	now   int64
	calls []FetchRequest
	reply func(w *ttCheckWorld) string
	chk   *Checker
}

func ttNewCheckWorld(t *testing.T, reply func(w *ttCheckWorld) string) *ttCheckWorld {
	w := &ttCheckWorld{shop: ttNewShop(t, "pages.example", "rani-pets", nil), now: ttNow, reply: reply}
	w.chk = NewChecker(func(url string, in FetchRequest) (FetchResponse, error) {
		if url != w.shop.page+"api/v1/check" {
			t.Errorf("asked the wrong address: %s", url)
		}
		w.calls = append(w.calls, in)
		return FetchResponse{Status: 200, Body: w.reply(w)}, nil
	}, func() int64 { return w.now })
	return w
}

func (w *ttCheckWorld) target() CheckTarget {
	return CheckTarget{Page: w.shop.page, Check: w.shop.page + "api/v1/check", Key: w.shop.key.PublicKey}
}

func ttInStock(id, price string) map[string]any {
	return map[string]any{"id": id, "availability": "in_stock", "price": map[string]any{"value": price, "currency": "INR"}}
}

func TestCheckGoodAnswerIsBelievedAndKeptSixtySeconds(t *testing.T) {
	w := ttNewCheckWorld(t, func(w *ttCheckWorld) string {
		return w.shop.answer(t, w.shop.page, ttISO(w.now), ttInStock("l-3", "7500.00"))
	})
	out := w.chk.Check(w.target(), []string{"l-3"})
	if !out.Answered || out.Items["l-3"].Price == nil || out.Items["l-3"].Price.Value != "7500.00" || out.Items["l-3"].Availability != "in_stock" {
		t.Fatalf("a good answer is answered: %+v", out)
	}
	w.now += 59_000
	if o := w.chk.Check(w.target(), []string{"l-3"}); !o.Answered || len(w.calls) != 1 {
		t.Fatalf("at +59 s the kept answer is used, no new fetch: calls=%d %+v", len(w.calls), o)
	}
	w.now += 2_000 // +61 s
	if o := w.chk.Check(w.target(), []string{"l-3"}); !o.Answered || len(w.calls) != 2 {
		t.Fatalf("at +61 s the shop is asked again: calls=%d %+v", len(w.calls), o)
	}
}

func TestCheckIgnoresWhatItShouldNotBelieve(t *testing.T) {
	stranger := ttNewKey(t)
	cases := map[string]func(w *ttCheckWorld) string{
		"three minutes old": func(w *ttCheckWorld) string {
			return w.shop.answer(t, w.shop.page, ttISO(w.now-3*60_000), ttInStock("l-3", "1.00"))
		},
		"three minutes in the future": func(w *ttCheckWorld) string {
			return w.shop.answer(t, w.shop.page, ttISO(w.now+3*60_000), ttInStock("l-3", "1.00"))
		},
		"changed after signing": func(w *ttCheckWorld) string {
			m := ttReparse(t, w.shop.answer(t, w.shop.page, ttISO(w.now), ttInStock("l-3", "8000.00")))
			m["items"].([]any)[0].(map[string]any)["price"].(map[string]any)["value"] = "1.00"
			return ttJSON(t, m)
		},
		"signed by another key": func(w *ttCheckWorld) string {
			s := w.shop
			s.key = stranger
			return s.answer(t, w.shop.page, ttISO(w.now), ttInStock("l-3", "1.00"))
		},
		"naming another page": func(w *ttCheckWorld) string {
			return w.shop.answer(t, "https://pages.example/other-shop/", ttISO(w.now), ttInStock("l-3", "1.00"))
		},
		"not JSON": func(w *ttCheckWorld) string { return "<html>" },
	}
	for name, reply := range cases {
		w := ttNewCheckWorld(t, reply)
		if out := w.chk.Check(w.target(), []string{"l-3"}); out.Answered || len(out.Items) != 0 || out.Why == "" {
			t.Errorf("%s: must be silent with a reason, got %+v", name, out)
		}
	}
}

func TestCheckBelievesAnAnswerOneMinuteOff(t *testing.T) {
	for _, off := range []int64{-60_000, 60_000} {
		w := ttNewCheckWorld(t, func(w *ttCheckWorld) string {
			return w.shop.answer(t, w.shop.page, ttISO(w.now+off), ttInStock("l-3", "7500.00"))
		})
		if out := w.chk.Check(w.target(), []string{"l-3"}); !out.Answered || out.Items["l-3"].Price == nil {
			t.Errorf("%d ms off must be believed: %+v", off, out)
		}
	}
}

func TestCheckAddsNoItemThatWasNotAskedAbout(t *testing.T) {
	w := ttNewCheckWorld(t, func(w *ttCheckWorld) string {
		return w.shop.answer(t, w.shop.page, ttISO(w.now), ttInStock("l-3", "7500.00"), ttInStock("l-9", "1.00"))
	})
	out := w.chk.Check(w.target(), []string{"l-3"})
	if _, extra := out.Items["l-9"]; extra || len(out.Items) != 1 || !out.Answered {
		t.Fatalf("l-9 was not asked about: %+v", out)
	}
}

// What the shop learns: the format name and the ids, in a POST, and nothing else (no search words, no place).
func TestCheckSendsOnlyTheFormatAndTheIds(t *testing.T) {
	w := ttNewCheckWorld(t, func(w *ttCheckWorld) string {
		return w.shop.answer(t, w.shop.page, ttISO(w.now), ttInStock("l-3", "1.00"), ttInStock("l-4", "1.00"))
	})
	w.chk.Check(w.target(), []string{"l-3", "l-4", "l-3"})
	if len(w.calls) != 1 {
		t.Fatalf("calls: %d", len(w.calls))
	}
	c := w.calls[0]
	if c.Method != "POST" {
		t.Fatalf("a check is a POST, got %s", c.Method)
	}
	if want := `{"format":"shop-check/1","ids":["l-3","l-4"]}`; c.Body != want {
		t.Fatalf("body = %s, want %s", c.Body, want)
	}
	var m map[string]any
	_ = json.Unmarshal([]byte(c.Body), &m)
	if len(m) != 2 {
		t.Fatalf("only format and ids: %v", m)
	}
}
