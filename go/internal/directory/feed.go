// Reading a shop feed (modules/discovery/feed.ts; specs/shop-feed.md "The document"): the limits, the fields, the money strings and the categories, checked one by one. It takes the
// text a shop's address answered and says what is in it, or why it is refused. It does NOT check the signature (trust.go does, with the key the directory pinned).
//
// Refused as a whole: more than 1 MB, not JSON, not "shop-feed/1", more than 200 items, a shop block that is not as the spec says, or an address in the feed that does not sit under the
// shop's own page (a security rule: a feed may only speak for its own page, so one shop's feed cannot claim another shop's page and with it the other shop's pinned key). Dropped with a
// note: one malformed item (one bad listing must not hide the shop's others). The reasons are the TypeScript's words, kept, because the index stores them and a person reads them.
package directory

import (
	"encoding/json"
	"github.com/GeometerLabs/agents/go/internal/language"
	"math"
	"regexp"
	"strconv"
	"strings"
)

// FeedRead is a feed read, or why not.
type FeedRead struct {
	OK      bool
	Feed    Feed
	Dropped []string
	Reason  string
}

var (
	isoShape  = regexp.MustCompile(`^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$`)
	idShape   = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$`)
	moneyRE   = regexp.MustCompile(`^\d{1,9}\.\d{2}$`)
	degreesRE = regexp.MustCompile(`^-?\d{1,3}(?:\.\d{1,6})?$`)
	pincodeRE = regexp.MustCompile(`^\d{6}$`)
)

type obj = map[string]any

func isObj(v any) (obj, bool) { m, ok := v.(map[string]any); return m, ok }

// str is feed.ts str: a well-formed string of 1 to max UTF-16 units.
func str(v any, max int) (string, bool) {
	s, ok := v.(string)
	if !ok || s == "" || language.UTF16Len(s) > max || !isWellFormed(s) {
		return "", false
	}
	return s, true
}

// iso is feed.ts iso: the ISO shape with a "Z" that JavaScript's Date.parse accepts. V8 reads a day up to 31 in any month (February 30 is March 2), an hour of 24 only as exactly midnight.
func iso(v any) (string, bool) {
	s, ok := v.(string)
	if !ok {
		return "", false
	}
	m := isoShape.FindStringSubmatch(s)
	if m == nil {
		return "", false
	}
	n := func(i int) int { x, _ := strconv.Atoi(m[i]); return x }
	mo, d, h, mi, se := n(2), n(3), n(4), n(5), n(6)
	if mo < 1 || mo > 12 || d < 1 || d > 31 || mi > 59 || se > 59 || h > 24 || (h == 24 && (mi != 0 || se != 0 || (m[7] != "" && strings.Trim(m[7], "0") != ""))) {
		return "", false
	}
	return s, true
}

// safeInt is Number.isSafeInteger for a decoded JSON number.
func safeInt(v any) (int64, bool) {
	f, ok := v.(float64)
	if !ok || f != math.Trunc(f) || math.Abs(f) > 9007199254740991 {
		return 0, false
	}
	return int64(f), true
}

// httpsURL is feed.ts httpsUrl: an https address of at most 500 UTF-16 units with no user or password.
func httpsURL(v any) (webURL, bool) {
	s, ok := v.(string)
	if !ok || language.UTF16Len(s) > 500 {
		return webURL{}, false
	}
	return parseHTTPS(s)
}

// under: is the address inside the shop's page (same origin, path at or under it)?
func under(page webURL, v any) (webURL, bool) {
	u, ok := httpsURL(v)
	if ok && u.Origin == page.Origin && strings.HasPrefix(u.Pathname, page.Pathname) {
		return u, true
	}
	return webURL{}, false
}

// FeedURLOf is the feed's address for a shop page: `<page>listings.json`.
func FeedURLOf(page string) string { return page + "listings.json" }

func readShop(raw any) (FeedShop, webURL, string) {
	r, ok := isObj(raw)
	if !ok {
		return FeedShop{}, webURL{}, "the shop is missing"
	}
	page, ok := httpsURL(r["page"])
	if !ok || page.Search != "" || page.Hash != "" || strings.Contains(page.Href, "?") || strings.Contains(page.Href, "#") || !strings.HasSuffix(page.Pathname, "/") {
		return FeedShop{}, webURL{}, "the shop's page must be an https address ending in /"
	}
	name, ok := str(r["name"], 120)
	if !ok {
		return FeedShop{}, webURL{}, "the shop has no name"
	}
	place, ok := isObj(r["place"])
	if !ok {
		return FeedShop{}, webURL{}, "the shop has no place"
	}
	town, ok := str(place["town"], 80)
	if !ok {
		return FeedShop{}, webURL{}, "the shop's place has no town"
	}
	out := Place{Town: town}
	if p, has := place["pincode"]; has {
		s, ok := p.(string)
		if !ok || !pincodeRE.MatchString(s) {
			return FeedShop{}, webURL{}, "the pincode is not six digits"
		}
		out.Pincode = s
	}
	_, hasLat := place["lat"]
	_, hasLon := place["lon"]
	if hasLat || hasLon {
		lat, ok1 := place["lat"].(string)
		lon, ok2 := place["lon"].(string)
		la, _ := strconv.ParseFloat(lat, 64)
		lo, _ := strconv.ParseFloat(lon, 64)
		if !ok1 || !ok2 || !degreesRE.MatchString(lat) || !degreesRE.MatchString(lon) || math.Abs(la) > 90 || math.Abs(lo) > 180 {
			return FeedShop{}, webURL{}, "lat and lon must both be decimal degrees as strings with at most 6 places"
		}
		out.Lat, out.Lon = lat, lon
	}
	chat, okChat := under(page, r["chat"])
	check, okCheck := under(page, r["check"])
	if !okChat {
		return FeedShop{}, webURL{}, "the shop's chat address is not under its page"
	}
	if !okCheck {
		return FeedShop{}, webURL{}, "the shop's check address is not under its page"
	}
	shop := FeedShop{Name: name, Page: page.Href, Place: out, Chat: chat.Href, Check: check.Href, Languages: []string{}}
	if a, has := r["agentCard"]; has {
		u, ok := under(page, a)
		if !ok {
			return FeedShop{}, webURL{}, "the shop's agent card address is not under its page"
		}
		shop.AgentCard = u.Href
	}
	if ls, ok := r["languages"].([]any); ok {
		for _, l := range ls {
			if s, ok := l.(string); ok && isLang(s) {
				shop.Languages = append(shop.Languages, s)
			}
		}
	}
	if t, has := r["trade"]; has {
		if s, ok := str(t, 80); ok {
			shop.Trade = s
		}
	}
	if reg, ok := isObj(r["registration"]); ok {
		kind, ok1 := str(reg["kind"], 40)
		number, ok2 := str(reg["number"], 60)
		// the registration is the owner's word and always says so; a feed that claims another source is not trusted to say "checked"
		if ok1 && ok2 {
			shop.Registration = &Registration{Kind: kind, Number: number, Source: "owner"}
		}
	}
	return shop, page, ""
}

func readWords(v any, max int) (LangWords, bool) {
	m, ok := isObj(v)
	if !ok {
		return nil, false
	}
	out := LangWords{}
	for _, l := range Langs {
		w, has := m[l]
		if !has {
			continue
		}
		s, ok := str(w, max)
		if !ok {
			return nil, false
		}
		out[l] = s
	}
	return out, true
}

// readItem is feed.ts readItem: an item, or why it is dropped.
func readItem(raw any, page webURL) (FeedItem, string) {
	r, ok := isObj(raw)
	if !ok {
		return FeedItem{}, "not an object"
	}
	id, ok := r["id"].(string)
	if !ok || !idShape.MatchString(id) {
		return FeedItem{}, "bad id"
	}
	itemPage, ok := under(page, r["page"])
	if !ok {
		return FeedItem{}, id + ": its page is not under the shop's page"
	}
	cat, _ := r["category"].(string)
	if !isCategory(cat) {
		return FeedItem{}, id + ": unknown category"
	}
	title, ok := readWords(r["title"], 200)
	if !ok || len(title) == 0 {
		return FeedItem{}, id + ": no title"
	}
	var textRaw any = obj{}
	if t, has := r["text"]; has && t != nil {
		textRaw = t
	}
	text, ok := readWords(textRaw, 2000)
	if !ok {
		return FeedItem{}, id + ": bad text"
	}
	ol, _ := r["ownerLanguage"].(string)
	if !isLang(ol) {
		return FeedItem{}, id + ": no owner language"
	}
	machine := []string{}
	if mw, ok := r["machineWritten"].([]any); ok {
		for _, l := range mw {
			s, ok := l.(string)
			if !ok || !isLang(s) {
				return FeedItem{}, id + ": bad machineWritten"
			}
			machine = append(machine, s)
		}
	}
	var price *Price
	if p, has := r["price"]; has && p != nil {
		pm, ok := isObj(p)
		val, vok := pm["value"].(string)
		if !ok || !vok || !moneyRE.MatchString(val) || pm["currency"] != "INR" {
			return FeedItem{}, id + ": bad price"
		}
		price = &Price{Value: val, Currency: "INR"}
		if n, has := pm["note"]; has {
			note, ok := str(n, 40)
			if !ok {
				return FeedItem{}, id + ": bad price note"
			}
			price.Note = note
		}
	}
	photos := []Photo{}
	if ph, has := r["photos"]; has {
		arr, ok := ph.([]any)
		if !ok || len(arr) > 3 {
			return FeedItem{}, id + ": at most 3 photos"
		}
		for _, p := range arr {
			pm, ok := isObj(p)
			if !ok {
				return FeedItem{}, id + ": bad photo"
			}
			u, uok := under(page, pm["url"])
			typ, _ := pm["type"].(string)
			if !uok || (typ != "image/jpeg" && typ != "image/webp") {
				return FeedItem{}, id + ": a photo must be a JPEG or WebP under the shop's page"
			}
			photo := Photo{URL: u.Href, Type: typ}
			if w, ok := safeInt(pm["width"]); ok && w > 0 {
				photo.Width = &w
			}
			if h, ok := safeInt(pm["height"]); ok && h > 0 {
				photo.Height = &h
			}
			photos = append(photos, photo)
		}
	}
	av, _ := r["availability"].(string)
	if av != "in_stock" && av != "call_to_check" {
		return FeedItem{}, id + ": availability must be in_stock or call_to_check"
	}
	confirmed, ok := iso(r["confirmed"])
	if !ok {
		return FeedItem{}, id + ": no confirmed date"
	}
	item := FeedItem{ID: id, Page: itemPage.Href, Category: cat, Title: title, Text: text, OwnerLanguage: ol, MachineWritten: machine, Price: price, Photos: photos, Availability: av, Confirmed: confirmed}
	if q, has := r["quantity"]; has {
		n, ok := safeInt(q)
		if !ok || n < 0 || n > 1_000_000 {
			return FeedItem{}, id + ": bad quantity"
		}
		item.Quantity = &n
	}
	return item, ""
}

// ParseFeed reads a feed from the text the shop's address answered. feedURL is the address it was read from: it must be `<shop page>listings.json`.
func ParseFeed(text, feedURL string) FeedRead {
	if len(text) > MaxFeedBytes {
		return FeedRead{Reason: "the feed is over 1 MB"}
	}
	var doc any
	if json.Unmarshal([]byte(text), &doc) != nil {
		return FeedRead{Reason: "the feed is not JSON"}
	}
	return ReadFeed(doc, feedURL)
}

// ReadFeed is the same for a document already parsed (the signature member is ignored here).
func ReadFeed(doc any, feedURL string) FeedRead {
	d, ok := isObj(doc)
	if !ok || d["format"] != "shop-feed/1" {
		return FeedRead{Reason: "the feed is not shop-feed/1"}
	}
	updated, ok := iso(d["updated"])
	if !ok {
		return FeedRead{Reason: "the feed has no valid `updated`"}
	}
	shop, page, why := readShop(d["shop"])
	if why != "" {
		return FeedRead{Reason: why}
	}
	if FeedURLOf(shop.Page) != feedURL {
		return FeedRead{Reason: "the feed is not at the address its shop's page names (<page>listings.json)"}
	}
	items, ok := d["items"].([]any)
	if !ok {
		return FeedRead{Reason: "the feed has no items list"}
	}
	if len(items) > MaxFeedItems {
		return FeedRead{Reason: "the feed has more than " + strconv.Itoa(MaxFeedItems) + " items"}
	}
	out := FeedRead{OK: true, Feed: Feed{Updated: updated, Shop: shop}, Dropped: []string{}}
	seen := map[string]bool{}
	for _, raw := range items {
		it, why := readItem(raw, page)
		if why != "" {
			out.Dropped = append(out.Dropped, why)
			continue
		}
		if seen[it.ID] {
			out.Dropped = append(out.Dropped, it.ID+": listed twice")
			continue
		}
		seen[it.ID] = true
		out.Feed.Items = append(out.Feed.Items, it)
	}
	return out
}
