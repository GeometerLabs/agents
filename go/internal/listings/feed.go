package listings

// The shop's side of the open protocol (specs/shop-feed.md, specs/shop-check.md): the feed, the answer to "do you still have these?", the "my feed changed" notice and the Agent
// Card's address check. Go twin of modules/listings/feed.ts, protocol.ts and modules/runtime/shop-protocol.ts. Everything is made from what the PUBLIC may already see, through
// the one item builder, so a check answer can never say more than the feed. Signing is in package signing; this package only builds the documents.

import (
	"crypto/sha256"
	"encoding/base64"
	"net/url"
	"path"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/GeometerLabs/agents/go/internal/signing"
)

const (
	FeedFormat   = "shop-feed/1"
	CheckFormat  = "shop-check/1"
	NoticeFormat = "shop-feed-changed/1"
	FeedMaxItems = 200
	MaxCheckIDs  = 10
	noticeEvery  = 60_000
)

// iso is `new Date(ms).toISOString()`: always three digits of milliseconds and a Z.
func iso(ms int64) string { return time.UnixMilli(ms).UTC().Format("2006-01-02T15:04:05.000Z") }

// FeedShop is the shop's addresses the signed documents carry. Page has no trailing slash.
type FeedShop struct {
	Name      string
	Page      string
	Languages []string
	Check     string
	AgentCard string
}

// ShopFacts is the shop's name and addresses, with the check and the Agent Card at their fixed places under the page.
func ShopFacts(name, page string, languages []string) FeedShop {
	return FeedShop{Name: name, Page: page, Languages: languages, Check: page + "/api/v1/check", AgentCard: page + "/agent-card.json"}
}

var specCategory = map[string]string{"vehicles": "vehicles_and_cycles"}

func decimal(paise int64) string {
	return strconv.FormatInt(paise/100, 10) + "." + string([]byte{byte('0' + paise%100/10), byte('0' + paise%10)})
}

func degrees(n float64) string {
	rounded, _ := strconv.ParseFloat(strconv.FormatFloat(n, 'f', 6, 64), 64)
	return strconv.FormatFloat(rounded, 'f', -1, 64)
}

// FeedItem is one item as the feed and the check both say it.
func FeedItem(shop FeedShop, l *Listing, nowMs int64) map[string]any {
	title, text := map[string]string{}, map[string]string{}
	machine := []string{}
	for _, k := range Langs {
		w, ok := l.Words[k]
		if !ok {
			continue
		}
		title[k] = w.Title
		// a language with no text (the owner's plain form writes the title only) is left out, not written as "": a reader refuses an empty string
		if w.Text != "" {
			text[k] = w.Text
		}
		if k != l.OwnerLang {
			machine = append(machine, k)
		}
	}
	category := l.Category
	if c, ok := specCategory[category]; ok {
		category = c
	}
	var price any
	if l.PricePaise != 0 {
		p := map[string]any{"value": decimal(l.PricePaise), "currency": "INR"}
		if l.PriceNote != "" {
			p["note"] = l.PriceNote
		}
		price = p
	}
	photos := []map[string]any{}
	for i, p := range l.Photos {
		if i == 3 {
			break
		}
		photos = append(photos, map[string]any{"url": shop.Page + "/listings/photo/" + p.ID + "." + Extension[p.Type], "type": p.Type, "width": p.Width, "height": p.Height})
	}
	availability := "call_to_check"
	if Freshness(l, nowMs) == "fresh" {
		availability = "in_stock"
	}
	at := l.ConfirmedMs
	if at == 0 {
		at = l.PublishedMs
	}
	if at == 0 {
		at = l.CreatedMs
	}
	item := map[string]any{
		"id": l.ID, "page": shop.Page + "/shop#" + l.ID, "category": category, "title": title, "text": text, "ownerLanguage": l.OwnerLang, "machineWritten": machine,
		"price": price, "photos": photos, "availability": availability, "confirmed": iso(at),
	}
	// a whole number only: a signature is made over canonical JSON, which has no floats
	if l.Qty > 0 {
		item["quantity"] = l.Qty
	}
	return item
}

// BuildFeed is the open feed, exactly shop-feed/1: public listings only, unsigned.
func BuildFeed(s *State, shop FeedShop, nowMs int64) map[string]any {
	languages := shop.Languages
	if len(languages) == 0 {
		owner := ""
		for _, l := range s.Items {
			if l.State != "draft" {
				owner = l.OwnerLang
				break
			}
		}
		if owner != "" {
			languages = []string{owner}
			for _, k := range Langs {
				if k != owner {
					languages = append(languages, k)
				}
			}
		} else {
			languages = append([]string{}, Langs...)
		}
	}
	items := []map[string]any{}
	for i, l := range s.Public(nowMs, nil) {
		if i == FeedMaxItems {
			break
		}
		l := l
		items = append(items, FeedItem(shop, &l, nowMs))
	}
	var latest int64
	for _, l := range s.Items {
		for _, t := range []int64{l.CreatedMs, l.PublishedMs, l.ConfirmedMs, l.SoldMs, l.RemovedMs} {
			if t > latest {
				latest = t
			}
		}
	}
	updated := nowMs
	if latest > 0 {
		updated = latest
	}
	sh := s.Shop
	feedShop := map[string]any{"name": shop.Name, "page": shop.Page + "/", "languages": languages}
	if sh.Town != "" {
		place := map[string]any{"town": sh.Town}
		if sh.Pincode != "" {
			place["pincode"] = sh.Pincode
		}
		if sh.Lat != nil && sh.Lon != nil {
			place["lat"], place["lon"] = degrees(*sh.Lat), degrees(*sh.Lon)
		}
		feedShop["place"] = place
	}
	if shop.Check != "" {
		feedShop["check"] = shop.Check
	}
	if shop.AgentCard != "" {
		feedShop["agentCard"] = shop.AgentCard
	}
	if sh.Registration != "" {
		feedShop["registration"] = map[string]any{"kind": "pet-shop", "number": sh.Registration, "source": "owner"}
	}
	return map[string]any{"format": FeedFormat, "updated": iso(updated), "shop": feedShop, "items": items}
}

// public is the state of a public read as the pure builders take it.
func publicState(r PublicRead) *State {
	s := Empty()
	s.Items, s.Shop = r.Listings, r.Shop
	return &s
}

var checkID = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$`)

// CheckIDs reads the ids of a check question, or says why not. Nothing else is read from the question.
func CheckIDs(body any) (ids []string, errText string) {
	o, ok := body.(map[string]any)
	if !ok {
		return nil, `Send {"ids": ["l-3", "l-7"]}: one to ten item ids.`
	}
	if f, present := o["format"]; present && f != CheckFormat {
		return nil, `format, when given, is "` + CheckFormat + `".`
	}
	list, ok := o["ids"].([]any)
	if !ok || len(list) == 0 {
		return nil, "ids is a list of one to ten item ids."
	}
	if len(list) > MaxCheckIDs {
		return nil, "Ask about at most 10 items at a time."
	}
	seen := map[string]bool{}
	for _, v := range list {
		s, ok := v.(string)
		if !ok || !checkID.MatchString(s) {
			return nil, "Each id is an item id such as l-3."
		}
		if !seen[s] {
			seen[s] = true
			ids = append(ids, s)
		}
	}
	return ids, ""
}

// SignedFeed is the feed signed with the shop's key.
func SignedFeed(r PublicRead, shop FeedShop, nowMs int64, key *signing.Key) (map[string]any, error) {
	return key.SealFeed(BuildFeed(publicState(r), shop, nowMs))
}

// CheckAnswer answers "do you still have these?", signed. An id that is not a public listing now, whatever the reason, is gone; with the switch off nothing is public.
func CheckAnswer(r PublicRead, shop FeedShop, ids []string, nowMs int64, key *signing.Key) (map[string]any, error) {
	live := map[string]*Listing{}
	if r.Shop.Visible {
		s := publicState(r)
		for _, l := range s.Public(nowMs, nil) {
			l := l
			live[l.ID] = &l
		}
	}
	items := []map[string]any{}
	for i, id := range ids {
		if i == MaxCheckIDs {
			break
		}
		l, ok := live[id]
		if !ok {
			items = append(items, map[string]any{"id": id, "availability": "gone"})
			continue
		}
		f := FeedItem(shop, l, nowMs)
		item := map[string]any{"id": f["id"], "availability": f["availability"], "price": f["price"], "confirmed": f["confirmed"]}
		if q, ok := f["quantity"]; ok {
			item["quantity"] = q
		}
		items = append(items, item)
	}
	return key.SealAnswer(map[string]any{"format": CheckFormat, "page": shop.Page + "/", "at": iso(nowMs), "items": items})
}

// feedFingerprint is what changed in a feed, for the notice: a hash of the feed without `updated`.
func feedFingerprint(feed map[string]any) (string, error) {
	content := map[string]any{}
	for k, v := range feed {
		if k != "updated" {
			content[k] = v
		}
	}
	c, err := signing.Canonical(content)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(c)
	return base64.RawURLEncoding.EncodeToString(sum[:]), nil
}

// hiddenFingerprint stands for "the switch went off after a notice went out" (a change too: the feed is now a 404).
var hiddenFingerprint = strings.Repeat("hidden", 8)[:43]

// Protocol is the shop's signed documents, with the memory of the last notice delivered. The key is read when first needed.
type Protocol struct {
	mu        sync.Mutex
	Read      func() PublicRead
	Key       func() *signing.Key
	Now       func() int64
	Name      func() string
	delivered string
	at        int64
}

// NewProtocol makes one.
func NewProtocol(read func() PublicRead, key func() *signing.Key, now func() int64, name func() string) *Protocol {
	return &Protocol{Read: read, Key: key, Now: now, Name: name}
}

// Feed is the signed feed for this page, or nil while the owner's switch is off.
func (p *Protocol) Feed(page, name string, languages []string, chat string) (map[string]any, error) {
	read := p.Read()
	if !read.Shop.Visible {
		return nil, nil
	}
	var known []string
	for _, l := range languages {
		for _, k := range Langs {
			if l == k {
				known = append(known, l)
			}
		}
	}
	return SignedFeed(read, ShopFacts(name, page, known), p.Now(), p.Key())
}

// Check is the signed answer; with the switch off, every id is gone (signed all the same).
func (p *Protocol) Check(page string, ids []string) (map[string]any, error) {
	return CheckAnswer(p.Read(), ShopFacts("", page, nil), ids, p.Now(), p.Key())
}

const maxCardBytes = 32 * 1024

// UnderPage: is value an address inside the shop's page: https, the same origin, no user or password, and a path at or under the page's own path?
func UnderPage(page string, value any) bool {
	v, ok := value.(string)
	if !ok {
		return false
	}
	pu, err1 := url.Parse(page)
	vu, err2 := url.Parse(v)
	if err1 != nil || err2 != nil || pu.Scheme != "https" || vu.Scheme != "https" || vu.User != nil {
		return false
	}
	origin := func(u *url.URL) string { return strings.TrimSuffix(strings.ToLower(u.Host), ":443") }
	if origin(pu) != origin(vu) || vu.Host == "" {
		return false
	}
	base := strings.TrimRight(pu.Path, "/")
	// a browser's URL resolves "." and ".." before anyone compares the path, so `<page>/../other` is `/other`
	p := path.Clean("/" + strings.TrimPrefix(vu.Path, "/"))
	return p == base || strings.HasPrefix(p, base+"/")
}

// Card signs the front's Agent Card: "bad" when it is not a card for this shop, nil while the switch is off.
func (p *Protocol) Card(page string, card any) (doc map[string]any, bad bool) {
	if !p.Read().Shop.Visible {
		return nil, false
	}
	c, ok := card.(map[string]any)
	if !ok {
		return nil, true
	}
	raw, err := signing.Marshal(c)
	if err != nil || len(raw) > maxCardBytes {
		return nil, true
	}
	interfaces, ok := c["supportedInterfaces"].([]any)
	if !ok || len(interfaces) == 0 {
		return nil, true
	}
	for _, i := range interfaces {
		m, ok := i.(map[string]any)
		if !ok || !UnderPage(page, m["url"]) {
			return nil, true
		}
	}
	provider, _ := c["provider"].(map[string]any)
	if provider == nil || !UnderPage(page, provider["url"]) {
		return nil, true
	}
	signed, err := p.Key().SignCard(c)
	if err != nil {
		return nil, true // a card with no canonical form (a float) is not one we sign
	}
	return signed, false
}

// Notice is the "my feed changed" notice to send now, with its fingerprint, or nil: nothing changed since the last delivered one, or one went less than a minute ago.
func (p *Protocol) Notice(page string) (map[string]any, string, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	read, now := p.Read(), p.Now()
	key := p.Key()
	if key == nil || (p.at != 0 && now-p.at < noticeEvery) { // at == 0: no notice delivered yet (the TypeScript side starts at minus infinity; int64 would overflow)
		return nil, "", nil
	}
	feedURL := page + "/listings.json"
	if !read.Shop.Visible {
		if p.delivered == "" || p.delivered == hiddenFingerprint {
			return nil, "", nil
		}
		n, err := key.SealNotice(map[string]any{"format": NoticeFormat, "feed": feedURL, "updated": iso(now)})
		return n, hiddenFingerprint, err
	}
	feed := BuildFeed(publicState(read), ShopFacts(p.Name(), page, nil), now)
	fp, err := feedFingerprint(feed)
	if err != nil || fp == p.delivered {
		return nil, "", err
	}
	n, err := key.SealNotice(map[string]any{"format": NoticeFormat, "feed": feedURL, "updated": feed["updated"]})
	return n, fp, err
}

// Delivered notes that a notice with this fingerprint reached the directory.
func (p *Protocol) Delivered(fingerprint string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.delivered, p.at = fingerprint, p.Now()
}
