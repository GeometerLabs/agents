// THE order of search results (modules/discovery/order.ts; specs/directory.md "The order"; the owner's rule of 16 Nov 2026: "never by payment, plan or Operator"). The only place a
// result list is put in order: the page, the JSON search and the MCP tools all call orderResults, and the check step calls it again after a shop's answer changed how fresh an item is.
//
// The order, and nothing else: 1. fit (every word, then some), 2. distance in bands (0-2, 2-5, 5-10, 10-25, 25-50, over 50 km; with only a town the buyer's town first; with no place all
// alike), 3. freshness (in stock before "call to check", inside a band), 4. taking turns (shops in the same band alternate, the order of shops and of a shop's items shuffled by a hash of
// the DAY and the SEARCH, so no shop is always first and nobody can buy a spot; at most 3 items of one shop in the first 10 while other shops have items to put there).
//
// What it may not know: a price, a plan, a payment, an Operator, a shop's size, how often it is searched, its name or when it arrived. So Candidate has only the fields below, and a
// test (order_test.go) fails when one is added. Ties after the turn hash are broken by the key compared as text; the TypeScript compares with `<` on strings, which is by UTF-16 code
// unit, so compareUTF16 is used here and not Go's byte order.
package directory

import (
	"sort"
	"strconv"
	"strings"
	"unicode/utf16"
)

// Candidate is what the order may look at. Nothing else is read.
type Candidate struct {
	Key        string   // an opaque name for the item (shop page + item id)
	Shop       string   // the shop, as an opaque name (its page address)
	Fit        int      // 0: every word of the search (or no words); 1: some
	DistanceKm *float64 // from the buyer's point to the shop's map point; nil when either is not known
	SameTown   bool     // the shop's town is the buyer's town
	InStock    bool
}

// OrderQuery is the buyer's side: how they gave their place and the seed of the rotation (`YYYY-MM-DD|the search`).
type OrderQuery struct {
	Place string // "point", "town" or "none"
	Seed  string
}

var bandEdgesKm = []float64{2, 5, 10, 25, 50}

const (
	unknownBand        = 6
	perShopInFirstPage = 3
	firstPage          = 10
)

func bandOf(c Candidate, place string) int {
	switch {
	case place == "none":
		return 0
	case place == "town":
		if c.SameTown {
			return 0
		}
		return 1
	case c.DistanceKm == nil:
		if c.SameTown { // a shop with no map point counts as near only when it is in the buyer's own town
			return 0
		}
		return unknownBand
	}
	for i, edge := range bandEdgesKm {
		if *c.DistanceKm <= edge {
			return i
		}
	}
	return len(bandEdgesKm)
}

type orderRow struct {
	key, shop, turn  string
	fit, band, fresh int
}

// compareUTF16 is JavaScript's `<` on strings: by UTF-16 code unit.
func compareUTF16(a, b string) int {
	if a == b {
		return 0
	}
	ua, ub := utf16.Encode([]rune(a)), utf16.Encode([]rune(b))
	for i := 0; i < len(ua) && i < len(ub); i++ {
		if ua[i] != ub[i] {
			if ua[i] < ub[i] {
				return -1
			}
			return 1
		}
	}
	if len(ua) < len(ub) {
		return -1
	}
	return 1
}

// orderResults: the keys of the candidates in the fair order. Every candidate is returned once.
func orderResults(candidates []Candidate, q OrderQuery) []string {
	rows := make([]orderRow, len(candidates))
	for i, c := range candidates {
		fresh := 1
		if c.InStock {
			fresh = 0
		}
		rows[i] = orderRow{key: c.Key, shop: c.Shop, fit: c.Fit, band: bandOf(c, q.Place), fresh: fresh, turn: turnHash(q.Seed + "|" + c.Key)}
	}
	// group by (fit, band, fresh): the groups go in that order; inside a group the shops take turns
	groups := map[string][]orderRow{}
	var names []string
	for _, r := range rows {
		g := strconv.Itoa(r.fit) + "/" + strconv.Itoa(r.band) + "/" + strconv.Itoa(r.fresh)
		if _, ok := groups[g]; !ok {
			names = append(names, g)
		}
		groups[g] = append(groups[g], r)
	}
	sort.SliceStable(names, func(i, j int) bool { return compareGroups(names[i], names[j]) < 0 })
	var list []orderRow
	for _, g := range names {
		list = append(list, takeTurns(groups[g], q.Seed)...)
	}
	return capFirstPage(list)
}

func compareGroups(x, y string) int {
	a, b := strings.Split(x, "/"), strings.Split(y, "/")
	for i := range a {
		p, _ := strconv.Atoi(a[i])
		q, _ := strconv.Atoi(b[i])
		if p != q {
			return p - q
		}
	}
	return 0
}

// takeTurns: the shops of a group in the order of their turn hash; then one item of each shop in turn, round and round. A shop's own items are in the order of their turn hash too.
func takeTurns(members []orderRow, seed string) []orderRow {
	byShop := map[string][]orderRow{}
	var order []string
	for _, r := range members {
		if _, ok := byShop[r.shop]; !ok {
			order = append(order, r.shop)
		}
		byShop[r.shop] = append(byShop[r.shop], r)
	}
	type shopTurn struct{ shop, turn string }
	shops := make([]shopTurn, len(order))
	for i, s := range order {
		shops[i] = shopTurn{s, turnHash(seed + "|shop|" + s)}
	}
	// the turn hashes are lower-case hex, so comparing them as text is the same in both languages; a tie falls to the shop's own name by UTF-16 order
	sort.SliceStable(shops, func(i, j int) bool {
		if shops[i].turn != shops[j].turn {
			return shops[i].turn < shops[j].turn
		}
		return compareUTF16(shops[i].shop, shops[j].shop) < 0
	})
	queues := make([][]orderRow, len(shops))
	longest := 0
	for i, s := range shops {
		q := byShop[s.shop]
		sort.SliceStable(q, func(a, b int) bool {
			if q[a].turn != q[b].turn {
				return q[a].turn < q[b].turn
			}
			return compareUTF16(q[a].key, q[b].key) < 0
		})
		queues[i] = q
		if len(q) > longest {
			longest = len(q)
		}
	}
	var out []orderRow
	for round := 0; round < longest; round++ {
		for _, q := range queues {
			if len(q) > round {
				out = append(out, q[round])
			}
		}
	}
	return out
}

// capFirstPage: at most perShopInFirstPage of a shop in the first firstPage places; what was held back follows, in its own order.
func capFirstPage(list []orderRow) []string {
	var taken, held []orderRow
	count := map[string]int{}
	for _, r := range list {
		n := count[r.shop]
		if len(taken) < firstPage && n >= perShopInFirstPage {
			held = append(held, r)
			continue
		}
		taken = append(taken, r)
		count[r.shop] = n + 1
	}
	cut := firstPage
	if len(taken) < cut {
		cut = len(taken)
	}
	out := make([]string, 0, len(list))
	for _, r := range taken[:cut] {
		out = append(out, r.key)
	}
	for _, r := range held {
		out = append(out, r.key)
	}
	for _, r := range taken[cut:] {
		out = append(out, r.key)
	}
	return out
}
