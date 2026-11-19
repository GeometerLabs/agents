// Asking a shop to confirm (modules/discovery/check.ts; specs/shop-check.md), from the directory's side: "do you still have l-3 and l-7?", the shop answers from its own record and
// signs the answer. This file sends the question, checks the answer and keeps what it learned for 60 seconds.
//
// What the question carries: the format name and the item ids. Never the search words, the place or anything about the buyer (a shop must not learn who searched or for what), and
// the function that sends it takes no such thing. What the answer must be, or it is ignored (the item is then shown from the index with "Call to check"): HTTP 200, JSON, under 64 KB,
// in time (about 1.5 seconds: the buyer is waiting); shop-check/1 naming this shop's page; signed by the key the directory pinned for this shop page; made just now (`at` within two
// minutes of the directory's clock, so a recorded "in stock" cannot be played back tomorrow); only items that were asked about, each with an availability the spec knows.
package directory

import (
	"encoding/json"
	"github.com/GeometerLabs/agents/go/internal/language"
	"strconv"
	"sync"
	"time"

	"github.com/GeometerLabs/agents/go/internal/signing"
)

const (
	CheckTimeout    = 1500 * time.Millisecond
	CheckCacheMs    = 60_000
	MaxAnswerBytes  = 64 * 1024
	MaxAnswerSkewMs = 2 * 60_000
	maxKeptAnswers  = 5000
)

// CheckTarget is what the checker needs of a shop: its page, its check address and its pinned public key.
type CheckTarget struct{ Page, Check, Key string }

// CheckOutcome is "answered" with the items the shop spoke of (and those kept from a minute ago), or "silent" with why.
type CheckOutcome struct {
	Answered bool
	Items    map[string]CheckedItem
	Why      string
}

// Checker asks shops; its memory is the last 60 seconds of what each shop said about each item.
type Checker struct {
	fetch   Fetcher
	now     func() int64
	timeout time.Duration
	cacheMs int64
	mu      sync.Mutex
	kept    map[string]keptItem
	order   []string // insertion order, to drop the oldest as a JavaScript Map does
}

type keptItem struct {
	item CheckedItem
	at   int64
}

// NewChecker makes the checker over a Fetcher. now is in milliseconds.
func NewChecker(fetch Fetcher, now func() int64) *Checker {
	if now == nil {
		now = func() int64 { return time.Now().UnixMilli() }
	}
	return &Checker{fetch: fetch, now: now, timeout: CheckTimeout, cacheMs: CheckCacheMs, kept: map[string]keptItem{}}
}

func readCheckedItem(raw any, asked map[string]bool) (CheckedItem, bool) {
	r, ok := isObj(raw)
	if !ok {
		return CheckedItem{}, false
	}
	id, ok := r["id"].(string)
	if !ok || !asked[id] {
		return CheckedItem{}, false
	}
	av, _ := r["availability"].(string)
	if av == "gone" {
		return CheckedItem{ID: id, Availability: "gone"}, true
	}
	if av != "in_stock" && av != "call_to_check" {
		return CheckedItem{}, false
	}
	out := CheckedItem{ID: id, Availability: av}
	switch p := r["price"].(type) {
	case nil:
		if _, has := r["price"]; has {
			out.HasPrice = true // price: null is "ask the shop"
		}
	case map[string]any:
		val, vok := p["value"].(string)
		if !vok || !moneyRE.MatchString(val) || p["currency"] != "INR" {
			return CheckedItem{}, false
		}
		price := &Price{Value: val, Currency: "INR"}
		if note, ok := p["note"].(string); ok && language.UTF16Len(note) <= 40 {
			price.Note = note
		}
		out.HasPrice, out.Price = true, price
	default:
		return CheckedItem{}, false
	}
	if q, ok := safeInt(r["quantity"]); ok && q >= 0 {
		out.Quantity = &q
	}
	if c, ok := r["confirmed"].(string); ok {
		if _, ok := language.ParseJSDate(c); ok {
			out.Confirmed = c
		}
	}
	return out, true
}

// Check asks one shop about at most 10 of its items. Items it did not answer for are absent from the map.
func (c *Checker) Check(shop CheckTarget, ids []string) CheckOutcome {
	var wanted []string
	seen := map[string]bool{}
	for _, id := range ids {
		if !seen[id] {
			seen[id] = true
			wanted = append(wanted, id)
		}
	}
	if len(wanted) > MaxCheckIDs {
		wanted = wanted[:MaxCheckIDs]
	}
	t := c.now()
	items := map[string]CheckedItem{}
	var toAsk []string
	c.mu.Lock()
	for _, id := range wanted {
		if hit, ok := c.kept[shop.Page+"|"+id]; ok && t-hit.at < c.cacheMs {
			items[id] = hit.item
		} else {
			toAsk = append(toAsk, id)
		}
	}
	c.mu.Unlock()
	if len(toAsk) == 0 {
		return CheckOutcome{Answered: true, Items: items}
	}
	bad := func(why string) CheckOutcome {
		if len(items) > 0 {
			return CheckOutcome{Answered: true, Items: items}
		}
		return CheckOutcome{Why: why}
	}
	// the question is the format name and the ids, and nothing else: that is the whole of what a shop learns
	body, _ := marshalNoEscape(map[string]any{"format": "shop-check/1", "ids": toAsk})
	res, err := c.fetch(shop.Check, FetchRequest{Method: "POST", Headers: map[string]string{"content-type": "application/json", "accept": "application/json"}, Body: string(body), Timeout: c.timeout, MaxBytes: MaxAnswerBytes})
	if err != nil {
		return bad(err.Error())
	}
	if res.Status != 200 || language.UTF16Len(res.Body) > MaxAnswerBytes {
		return bad("the shop answered " + strconv.Itoa(res.Status))
	}
	var doc any
	if json.Unmarshal([]byte(res.Body), &doc) != nil {
		return bad("not JSON")
	}
	d, isO := isObj(doc)
	items0, hasItems := d["items"].([]any)
	if !isO || d["format"] != "shop-check/1" || d["page"] != shop.Page || !hasItems {
		return bad("not an answer for this shop")
	}
	var members map[string]json.RawMessage
	_ = json.Unmarshal([]byte(res.Body), &members)
	if _, err := signing.VerifyDocument(members, shop.Key); err != nil {
		return bad("the answer is not signed by the shop's key (" + err.Error() + ")")
	}
	at := int64(-1 << 62)
	if s, ok := d["at"].(string); ok {
		if v, ok := language.ParseJSDate(s); ok {
			at = v
		}
	}
	if at == int64(-1<<62) || abs64(at-t) > MaxAnswerSkewMs {
		return bad("the answer is not from just now")
	}
	asked := map[string]bool{}
	for _, id := range toAsk {
		asked[id] = true
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, raw := range items0 {
		it, ok := readCheckedItem(raw, asked)
		if !ok {
			continue
		}
		items[it.ID] = it
		key := shop.Page + "|" + it.ID
		if _, has := c.kept[key]; !has {
			if len(c.kept) >= maxKeptAnswers && len(c.order) > 0 {
				delete(c.kept, c.order[0])
				c.order = c.order[1:]
			}
			c.order = append(c.order, key)
		}
		c.kept[key] = keptItem{it, t}
	}
	return CheckOutcome{Answered: true, Items: items}
}

func abs64(n int64) int64 {
	if n < 0 {
		return -n
	}
	return n
}
