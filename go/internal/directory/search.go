// A search, start to finish (modules/discovery/search.ts; specs/directory.md "Search: asking the index, then the shops"): candidates from the index, put in THE order (order.go), the
// first ten confirmed by their shops (check.go) in parallel, what a shop says is gone dropped, and the answer written as `directory-search/1`. The people's page, the JSON API and the
// MCP tools all call SearchListings, so they cannot disagree.
//
// No model runs here and no word of the search leaves the directory: a shop is asked about item ids only. A shop that does not answer (or answers wrongly signed, or late) keeps what the
// index knew and is shown as "Call to check". Not a ranking: the confirmed answers only change an item's FRESHNESS and the order is made again by order.go.
package directory

import (
	"github.com/GeometerLabs/agents/go/internal/language"
	"math"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// SearchRequest is a buyer's request as the callers give it: a form's strings, or an MCP tool's JSON values (a number where a string is expected is NOT a string: the TypeScript reader
// takes only strings for q, category, lat, lon and town).
type SearchRequest map[string]any

// SearchResultItem is one result as the API and the page show it (specs/directory.md "The search API"). The member order is the TypeScript object's.
type SearchResultItem struct {
	Shop    ResultShop `json:"shop"`
	Item    ResultItem `json:"item"`
	Chat    string     `json:"chat"`
	Checked bool       `json:"checked"`
}

// ResultShop is the shop of a result.
type ResultShop struct {
	Name       string   `json:"name"`
	Page       string   `json:"page"`
	Town       string   `json:"town"`
	DistanceKm *float64 `json:"distanceKm"`
}

// ResultItem is the item of a result.
type ResultItem struct {
	ID             string  `json:"id"`
	Title          string  `json:"title"`
	Lang           string  `json:"lang"`
	MachineWritten bool    `json:"machineWritten"`
	Price          *Price  `json:"price"`
	Photo          *string `json:"photo"`
	Availability   string  `json:"availability"`
	Confirmed      string  `json:"confirmed"`
	Category       string  `json:"category"`
}

// SearchAnswer is `directory-search/1`.
type SearchAnswer struct {
	Format  string             `json:"format"`
	Results []SearchResultItem `json:"results"`
	Order   string             `json:"order"`
	Next    *string            `json:"next"`
}

// Cleaned is the request as it was understood.
type Cleaned struct {
	Words    []string
	Category string
	Place    string
	Town     string
	Lang     string
}

// Searched is an answer or what is wrong with the request.
type Searched struct {
	OK      bool
	Error   string
	Answer  SearchAnswer
	Cleaned Cleaned
}

var degrees = regexp.MustCompile(`^-?\d{1,3}(?:\.\d{1,6})?$`)
var decimalLiteral = regexp.MustCompile(`^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$`)

// jsNumber is JavaScript's Number(value) for a string, a number, a boolean or null; NaN for anything it cannot read. (The 0x, 0o and 0b integer forms are read too.)
func jsNumber(v any) float64 {
	switch x := v.(type) {
	case nil:
		return 0
	case bool:
		if x {
			return 1
		}
		return 0
	case float64:
		return x
	case string:
		s := language.TrimJS(x)
		if s == "" {
			return 0
		}
		switch {
		case s == "Infinity" || s == "+Infinity":
			return math.Inf(1)
		case s == "-Infinity":
			return math.Inf(-1)
		case len(s) > 2 && s[0] == '0' && (s[1] == 'x' || s[1] == 'X' || s[1] == 'o' || s[1] == 'O' || s[1] == 'b' || s[1] == 'B'):
			base := map[byte]int{'x': 16, 'o': 8, 'b': 2}[s[1]|0x20]
			n, err := strconv.ParseUint(s[2:], base, 64)
			if err != nil {
				return math.NaN()
			}
			return float64(n)
		case decimalLiteral.MatchString(s):
			f, err := strconv.ParseFloat(s, 64)
			if err != nil && !math.IsInf(f, 0) {
				return math.NaN()
			}
			return f
		}
	}
	return math.NaN()
}

func isSafeInt(f float64) bool { return f == math.Trunc(f) && math.Abs(f) <= 9007199254740991 }

// textOf is search.ts `text`: a string that is not blank, trimmed and cut to max UTF-16 units.
func textOf(v any, max int) (string, bool) {
	s, ok := v.(string)
	if !ok || language.TrimJS(s) == "" {
		return "", false
	}
	return language.UTF16SliceFFFD(language.TrimJS(s), max), true
}

// ReadRequest is the buyer's request, cleaned: the words, category, point, town, radius and language, or what is wrong with it.
func ReadRequest(r SearchRequest) (q IndexQuery, place, lang string, offset int, errText string) {
	q = IndexQuery{}
	qt, _ := textOf(r["q"], 200)
	q.Words = searchWords(qt)
	if c, ok := textOf(r["category"], 40); ok {
		if !isCategory(c) {
			return q, "", "", 0, "category must be one of " + strings.Join(Categories, ", ")
		}
		q.Category = c
	}
	lat, latOK := textOf(r["lat"], 12)
	lon, lonOK := textOf(r["lon"], 12)
	if latOK || lonOK {
		la, lo := jsNumber(lat), jsNumber(lon)
		if !latOK || !lonOK || !degrees.MatchString(lat) || !degrees.MatchString(lon) || math.Abs(la) > 90 || math.Abs(lo) > 180 {
			return q, "", "", 0, "lat and lon must both be decimal degrees"
		}
		q.Point = &[2]float64{la, lo}
	}
	if t, ok := textOf(r["town"], 80); ok {
		q.Town = t
	}
	if rk, has := r["radius_km"]; has {
		if s, isStr := rk.(string); !(isStr && s == "") {
			km := jsNumber(rk)
			if math.IsNaN(km) || math.IsInf(km, 0) || km < 1 || km > 500 {
				return q, "", "", 0, "radius_km must be between 1 and 500"
			}
			q.RadiusKm = &km
		}
	}
	lang = "en"
	if l, has := r["lang"]; has {
		if s, isStr := l.(string); !(isStr && s == "") {
			if !isStr || !isLang(s) {
				return q, "", "", 0, "lang must be en, hi, ml or kn"
			}
			lang = s
		}
	}
	off := 0.0
	if o, has := r["offset"]; has {
		if s, isStr := o.(string); !(isStr && s == "") {
			off = jsNumber(o)
		}
	}
	if !isSafeInt(off) || off < 0 || off > 190 || int(off)%firstPage != 0 {
		return q, "", "", 0, "offset must be 0, 10, 20 ... up to 190"
	}
	place = "none"
	if q.Point != nil {
		place = "point"
	} else if q.Town != "" {
		place = "town"
	}
	return q, place, lang, int(off), ""
}

// WordsFor is the words of an item in the buyer's language, else the owner's, else English, else any; and whether an assistant wrote them.
func WordsFor(title LangWords, ownerLanguage string, machine []string, lang string) (text, got string, machineWritten bool) {
	for _, l := range append([]string{lang, ownerLanguage, "en"}, Langs...) {
		if t, ok := title[l]; ok {
			for _, m := range machine {
				if m == l {
					machineWritten = true
				}
			}
			return t, l, machineWritten
		}
	}
	return "", "", false
}

// SearchDeps is what a search needs.
type SearchDeps struct {
	Index   *Index
	Checker *Checker
	Origin  string // the directory's own address, for the link to the page that states the order
	Now     func() int64
}

func (d SearchDeps) now() int64 {
	if d.Now != nil {
		return d.Now()
	}
	return time.Now().UnixMilli()
}

// DayOf is a day as YYYY-MM-DD in India's time (the day the rotation changes on).
func DayOf(ms int64) string { return time.UnixMilli(ms + 19_800_000).UTC().Format("2006-01-02") }

func keyOf(h Hit) string { return h.Shop.Page + "|" + h.Item.ID }

func candidateOf(h Hit, inStock bool) Candidate {
	return Candidate{Key: keyOf(h), Shop: h.Shop.Page, Fit: h.Fit, DistanceKm: h.DistanceKm, SameTown: h.SameTown, InStock: inStock}
}

// roundHalfUp is Math.round: halves go up.
func roundHalfUp(f float64) float64 { return math.Floor(f + 0.5) }

// SearchListings is a search from request to answer.
func SearchListings(deps SearchDeps, request SearchRequest) Searched {
	query, place, lang, offset, bad := ReadRequest(request)
	if bad != "" {
		return Searched{Error: bad}
	}
	now := deps.now()
	hits := deps.Index.Candidates(query)
	byKey := map[string]Hit{}
	cands := make([]Candidate, len(hits))
	for i, h := range hits {
		byKey[keyOf(h)] = h
		cands[i] = candidateOf(h, h.Item.Availability == "in_stock")
	}
	seed := DayOf(now) + "|" + strings.Join(query.Words, " ") + "|" + query.Category
	ordered := orderResults(cands, OrderQuery{Place: place, Seed: seed})
	var page []Hit
	for i := offset; i < offset+firstPage && i < len(ordered); i++ {
		page = append(page, byKey[ordered[i]])
	}
	// ask each shop about its items on this page, all shops at once
	perShop := map[string][]Hit{}
	var shopOrder []string
	for _, h := range page {
		if _, ok := perShop[h.Shop.Page]; !ok {
			shopOrder = append(shopOrder, h.Shop.Page)
		}
		perShop[h.Shop.Page] = append(perShop[h.Shop.Page], h)
	}
	outcomes := map[string]CheckOutcome{}
	var mu sync.Mutex
	var wg sync.WaitGroup
	for _, sp := range shopOrder {
		items := perShop[sp]
		wg.Add(1)
		go func() {
			defer wg.Done()
			shop := items[0].Shop
			ids := make([]string, len(items))
			for i, h := range items {
				ids[i] = h.Item.ID
			}
			o := deps.Checker.Check(CheckTarget{Page: shop.Page, Check: shop.Check, Key: shop.Key}, ids)
			mu.Lock()
			outcomes[sp] = o
			mu.Unlock()
		}()
	}
	wg.Wait()
	// what the shops said: gone is dropped; an answer replaces the index's price and freshness; no answer means "call to check"
	type shown struct {
		hit          Hit
		availability string
		price        *Price
		confirmed    string
		checked      bool
	}
	var list []shown
	for _, h := range page {
		out := outcomes[h.Shop.Page]
		var said *CheckedItem
		if out.Answered {
			if it, ok := out.Items[h.Item.ID]; ok {
				said = &it
			}
		}
		switch {
		case said != nil && said.Availability == "gone":
			continue
		case said != nil:
			price := h.Item.Price
			if said.HasPrice {
				price = said.Price
			}
			confirmed := h.Item.Confirmed
			if said.Confirmed != "" {
				confirmed = said.Confirmed
			}
			list = append(list, shown{h, said.Availability, price, confirmed, true})
		default:
			list = append(list, shown{h, "call_to_check", h.Item.Price, h.Item.Confirmed, false})
		}
	}
	// freshness may have changed, so the order is made again by the one order function (never by hand)
	rc := make([]Candidate, len(list))
	byShown := map[string]shown{}
	for i, s := range list {
		rc[i] = candidateOf(s.hit, s.availability == "in_stock")
		byShown[keyOf(s.hit)] = s
	}
	reorder := orderResults(rc, OrderQuery{Place: place, Seed: seed})
	results := make([]SearchResultItem, 0, len(reorder))
	for _, k := range reorder {
		s := byShown[k]
		shop, item := s.hit.Shop, s.hit.Item
		text, got, machine := WordsFor(item.Title, item.OwnerLanguage, item.MachineWritten, lang)
		var dist *float64
		if s.hit.DistanceKm != nil {
			d := roundHalfUp(*s.hit.DistanceKm*10) / 10
			dist = &d
		}
		var photo *string
		if len(item.Photos) > 0 {
			photo = &item.Photos[0].URL
		}
		results = append(results, SearchResultItem{
			Shop: ResultShop{Name: shop.Name, Page: shop.Page, Town: shop.Town, DistanceKm: dist},
			Item: ResultItem{ID: item.ID, Title: text, Lang: got, MachineWritten: machine, Price: s.price, Photo: photo, Availability: s.availability, Confirmed: s.confirmed, Category: item.Category},
			Chat: shop.Chat + "?about=" + encodeURIComponent(item.ID), Checked: s.checked,
		})
	}
	deps.Index.Count(DayOf(now), "searches", 1)
	deps.Index.Count(DayOf(now), "results", len(results))
	var next *string
	if len(ordered) > offset+firstPage {
		n := strconv.Itoa(offset + firstPage)
		next = &n
	}
	return Searched{OK: true, Answer: SearchAnswer{Format: "directory-search/1", Results: results, Order: deps.Origin + "/order", Next: next}, Cleaned: Cleaned{Words: query.Words, Category: query.Category, Place: place, Town: query.Town, Lang: lang}}
}
