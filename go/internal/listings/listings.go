// Package listings is a shop's listings: what the owner may show, the rules that keep it honest, and what the public, the feed and the owner's page read of it. It is the Go twin
// of modules/listings (listings.ts, kit.ts, feed.ts, protocol.ts, photo.ts) and of the assistant's draft (modules/assistant/listing-draft.ts): the same state in the same JSON (it
// lives in the shop's snapshot as `assistant.listings`, which the TypeScript runtime reads and writes too), the same rules, the same limits. Only the owner writes; the owner's
// authority is "app" here, as in the TypeScript runtime's step.
package listings

import (
	"regexp"
	"sort"
	"strings"
)

// Languages a listing's words are kept in.
var Langs = []string{"en", "hi", "ml", "kn"}

// Categories are the fixed ones, shown in four languages by the owner's app.
var Categories = []string{"pets", "food", "clothes", "home", "electronics", "vehicles", "services", "other"}

const (
	Day         = 24 * 3_600_000
	MaxLive     = 50
	MaxTitle    = 80
	MaxText     = 400
	MaxNote     = 30
	MaxQty      = 9999
	MaxPhotos   = 3
	MaxDrafts   = 5
	DraftMs     = Day
	FreshMs     = 3 * Day
	HideAfterMs = 30 * Day
	UploadsDay  = 30
	PendingMs   = 6 * 3_600_000
	GoneKeptMs  = 30 * Day
	// PhotoGraceMs is how long a photo no listing holds is kept before the daily clean-up may delete it.
	PhotoGraceMs = Day
)

// Photo is what the state keeps of a photo (its bytes are in the store, by id).
type Photo struct {
	ID     string `json:"id"`
	Type   string `json:"type"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
	Bytes  int    `json:"bytes"`
}

// PendingPhoto is an uploaded photo no listing has taken yet.
type PendingPhoto struct {
	Photo
	AtMs int64 `json:"atMs"`
}

// LangText is a title and a short text in one language.
type LangText struct {
	Title string `json:"title"`
	Text  string `json:"text"`
}

// Listing is one thing the shop has. The member order is the TypeScript runtime's, so a snapshot written by either reads the same.
type Listing struct {
	ID          string              `json:"id"`
	State       string              `json:"state"` // draft, live, sold, removed
	Category    string              `json:"category"`
	OwnerLang   string              `json:"ownerLang"`
	Words       map[string]LangText `json:"words"`
	PricePaise  int64               `json:"pricePaise,omitempty"`
	PriceNote   string              `json:"priceNote,omitempty"`
	Qty         int64               `json:"qty,omitempty"`
	Photos      []Photo             `json:"photos"`
	CreatedMs   int64               `json:"createdMs"`
	PublishedMs int64               `json:"publishedMs,omitempty"`
	ConfirmedMs int64               `json:"confirmedMs,omitempty"`
	SoldMs      int64               `json:"soldMs,omitempty"`
	RemovedMs   int64               `json:"removedMs,omitempty"`
	AskedMs     int64               `json:"askedMs,omitempty"`
	By          string              `json:"by"`
	From        string              `json:"from"`
	Claims      []string            `json:"claims,omitempty"`
}

// Shop is what the owner sets for the whole shop's showing: the switch, the place, the registration.
type Shop struct {
	Visible         bool     `json:"visible"`
	Town            string   `json:"town,omitempty"`
	Pincode         string   `json:"pincode,omitempty"`
	Lat             *float64 `json:"lat,omitempty"`
	Lon             *float64 `json:"lon,omitempty"`
	Registration    string   `json:"registration,omitempty"`
	Directories     []string `json:"directories,omitempty"`
	ExtraCategories []Extra  `json:"extraCategories,omitempty"`
}

// Extra is a builder's extra category.
type Extra struct {
	ID    string            `json:"id"`
	Names map[string]string `json:"names"`
}

// State is the shop's listings as the snapshot holds them (`assistant.listings`).
type State struct {
	Seq     int            `json:"seq"`
	Items   []Listing      `json:"items"`
	Shop    Shop           `json:"shop"`
	Pending []PendingPhoto `json:"pending"`
	Uploads struct {
		Day string `json:"day"`
		N   int    `json:"n"`
	} `json:"uploads"`
}

// Empty is a shop with no listings and the switch off.
func Empty() State { return State{Items: []Listing{}, Pending: []PendingPhoto{}} }

// Failure is why a rule refused, as a plain machine word.
type Failure string

const (
	BadCategory     Failure = "bad_category"
	Empty_          Failure = "empty"
	TooLong         Failure = "too_long"
	BadPrice        Failure = "bad_price"
	BadQty          Failure = "bad_qty"
	TooManyPhotos   Failure = "too_many_photos"
	NoSuchListing   Failure = "no_such_listing"
	NotADraft       Failure = "not_a_draft"
	NotLive         Failure = "not_live"
	Full            Failure = "full"
	TooManyDrafts   Failure = "too_many_drafts"
	ProtectedAnimal Failure = "protected_animal"
	HealthClaim     Failure = "health_claim"
	BadPlace        Failure = "bad_place"
	BadText         Failure = "bad_text"
)

// IsCategory is true for a fixed category or one the shop's state adds.
func IsCategory(c string, s *Shop) bool {
	for _, k := range Categories {
		if k == c {
			return true
		}
	}
	if s != nil {
		for _, x := range s.ExtraCategories {
			if x.ID == c {
				return true
			}
		}
	}
	return false
}

// ---- the words rules -------------------------------------------------------------------------------------------------------------------------------------

// protectedAnimals are the animals a pets listing may not name (the TypeScript list, with the same words in four languages).
var protectedAnimals = []struct {
	Name  string
	Words *regexp.Regexp
}{
	{"native parrots and parakeets", compileWords(`parrots?|parakeets?|parakeet|popat|tota|tote|तोता|तोते|तोती|തത്ത|ಗಿಳಿ`)},
	{"munias", compileWords(`munias?|muniya|मुनिया|മുനിയ|ಮುನಿಯಾ`)},
	{"mynas", compileWords(`mynas?|mynahs?|maina|मैना|മൈന|ಮೈನಾ`)},
	{"native owls", compileWords(`owls?|ullu|उल्लू|മൂങ്ങ|ಗೂಬೆ`)},
	{"Indian star tortoise and native turtles", compileWords(`tortoises?|turtles?|kachua|कछुआ|कछुए|ആമ|ಆಮೆ`)},
	{"monkeys", compileWords(`monkeys?|bandar|बंदर|കുരങ്ങ്|കുരങ്ങൻ|ಕೋತಿ`)},
}

// ProtectedAnimalIn is the protected animal a pets listing's words name, or "". Looked for in every language's title and text.
func ProtectedAnimalIn(words map[string]LangText) string {
	var parts []string
	for _, l := range Langs {
		if w, ok := words[l]; ok {
			parts = append(parts, w.Title+" "+w.Text)
		}
	}
	// JavaScript's Object.values order is insertion order; the words are the same set whichever way they are joined
	all := strings.Join(parts, " \n ")
	for _, a := range protectedAnimals {
		if findWord(a.Words, all) {
			return a.Name
		}
	}
	return ""
}

var (
	healthBounded  = compileWords(`healthy|health|vaccinat\w*|dewormed|pure-?bred|pure breed|pedigree\w*|kc registered|certified|disease[- ]free|vet[- ]checked|checked by (?:a )?vet`)
	healthAnywhere = regexp.MustCompile(`(?i)स्वस्थ|तंदुरुस्त|टीका|टीके|वैक्सीन|टीकाकरण|शुद्ध नस्ल|नस्ल|പ്രതിരോധ കുത്തിവയ്പ്|വാക്സിൻ|ആരോഗ്യ|ശുദ്ധ ജാതി|ശുദ്ധമായ ജാതി|ಆರೋಗ್ಯ|ಲಸಿಕೆ|ಶುದ್ಧ ತಳಿ|ತಳಿ`)
)

// HasHealthClaim: words that say an animal is healthy, vaccinated, certified or of a pure breed.
func HasHealthClaim(text string) bool {
	return findWord(healthBounded, text) || healthAnywhere.MatchString(text)
}

func checkWords(category string, words map[string]LangText, ownerWords *string) (map[string]LangText, Failure) {
	out := map[string]LangText{}
	for _, l := range Langs {
		w, ok := words[l]
		if !ok {
			continue
		}
		title, text := clean(w.Title), clean(w.Text)
		if title == "" {
			return nil, Empty_
		}
		if utf16Len(title) > MaxTitle || utf16Len(text) > MaxText {
			return nil, TooLong
		}
		out[l] = LangText{title, text}
	}
	if len(out) == 0 {
		return nil, Empty_
	}
	if category == "pets" {
		if ProtectedAnimalIn(out) != "" {
			return nil, ProtectedAnimal
		}
		// a health claim in a pets listing must be in the owner's own words (the words they said), or the listing is not made
		for _, l := range Langs {
			if w, ok := out[l]; ok && HasHealthClaim(w.Title+" "+w.Text) && !(ownerWords != nil && HasHealthClaim(*ownerWords)) {
				return nil, HealthClaim
			}
		}
	}
	return out, ""
}

// ---- reading and writing the state ------------------------------------------------------------------------------------------------------------------------

func (s *State) find(id string) *Listing {
	for i := range s.Items {
		if s.Items[i].ID == id {
			return &s.Items[i]
		}
	}
	return nil
}

// LiveCount is how many listings are live.
func (s *State) LiveCount() int {
	n := 0
	for _, l := range s.Items {
		if l.State == "live" {
			n++
		}
	}
	return n
}

// DraftInput is what the assistant's draft (or the owner's form) gives.
type DraftInput struct {
	Category   string
	OwnerLang  string
	Words      map[string]LangText
	PricePaise *int64
	PriceNote  string
	Qty        *int64
	Photos     []Photo
	OwnerWords *string
	Claims     []string
}

func checkFields(s *State, category string, price *int64, note string, qty *int64, photos []Photo) Failure {
	if !IsCategory(category, &s.Shop) {
		return BadCategory
	}
	if price != nil && (*price <= 0 || *price > 100_000_000_00) {
		return BadPrice
	}
	if note != "" && utf16Len(clean(note)) > MaxNote {
		return TooLong
	}
	if qty != nil && (*qty < 1 || *qty > MaxQty) {
		return BadQty
	}
	if len(photos) > MaxPhotos {
		return TooManyPhotos
	}
	return ""
}

// Draft makes a listing that is NOT public (state "draft"), waiting for the owner's tap. Its id is taken now and never given again.
func (s *State) Draft(in DraftInput, nowMs int64) (*Listing, Failure) {
	if bad := checkFields(s, in.Category, in.PricePaise, in.PriceNote, in.Qty, in.Photos); bad != "" {
		return nil, bad
	}
	words, bad := checkWords(in.Category, in.Words, in.OwnerWords)
	if bad != "" {
		return nil, bad
	}
	kept := s.Items[:0]
	for _, l := range s.Items {
		if !(l.State == "draft" && l.CreatedMs+DraftMs <= nowMs) {
			kept = append(kept, l)
		}
	}
	s.Items = kept
	drafts := 0
	for _, l := range s.Items {
		if l.State == "draft" {
			drafts++
		}
	}
	if drafts >= MaxDrafts {
		return nil, TooManyDrafts
	}
	s.Seq++
	l := Listing{ID: "l-" + itoa(s.Seq), State: "draft", Category: in.Category, OwnerLang: in.OwnerLang, Words: words, Photos: append([]Photo{}, in.Photos...), CreatedMs: nowMs, By: "owner", From: "app"}
	if in.PricePaise != nil {
		l.PricePaise = *in.PricePaise
	}
	if in.PriceNote != "" {
		l.PriceNote = clean(in.PriceNote)
	}
	if in.Qty != nil {
		l.Qty = *in.Qty
	}
	if len(in.Claims) > 0 {
		for _, c := range in.Claims {
			if c = clean(c); c != "" && len(l.Claims) < 3 {
				l.Claims = append(l.Claims, c)
			}
		}
	}
	s.Items = append(s.Items, l)
	return &s.Items[len(s.Items)-1], ""
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		b[i] = '-'
	}
	return string(b[i:])
}

// Publish is the owner's tap on "Show it": the draft goes live now, confirmed today. At most 50 live.
func (s *State) Publish(id string, nowMs int64) (*Listing, Failure) {
	l := s.find(id)
	if l == nil {
		return nil, NoSuchListing
	}
	if l.State != "draft" {
		return nil, NotADraft
	}
	if s.LiveCount() >= MaxLive {
		return nil, Full
	}
	// checked again at the tap: the protected-animal rule holds whatever was drafted
	if l.Category == "pets" && ProtectedAnimalIn(l.Words) != "" {
		return nil, ProtectedAnimal
	}
	l.State, l.PublishedMs, l.ConfirmedMs, l.By, l.From = "live", nowMs, nowMs, "owner", "app"
	taken := map[string]bool{}
	for _, p := range l.Photos {
		taken[p.ID] = true
	}
	kept := s.Pending[:0]
	for _, p := range s.Pending {
		if !taken[p.ID] {
			kept = append(kept, p)
		}
	}
	s.Pending = kept
	return l, ""
}

// Edit is what the owner may change on a draft or a live listing; only the fields given, each checked as at the draft. A nil pointer is "not given"; Clear* turns a field off.
type Edit struct {
	Category     *string
	Words        map[string]LangText
	ReplaceWords bool
	Price        *int64
	ClearPrice   bool
	Note         *string
	ClearNote    bool
	Qty          *int64
	ClearQty     bool
}

// ApplyEdit changes the listing.
func (s *State) ApplyEdit(id string, e Edit) (*Listing, Failure) {
	l := s.find(id)
	if l == nil {
		return nil, NoSuchListing
	}
	if l.State != "draft" && l.State != "live" {
		return nil, NotLive
	}
	category := l.Category
	if e.Category != nil {
		category = *e.Category
	}
	var price *int64
	if l.PricePaise != 0 {
		v := l.PricePaise
		price = &v
	}
	if e.Price != nil {
		price = e.Price
	}
	if e.ClearPrice {
		price = nil
	}
	note := l.PriceNote
	if e.Note != nil {
		note = *e.Note
	}
	if e.ClearNote {
		note = ""
	}
	var qty *int64
	if l.Qty != 0 {
		v := l.Qty
		qty = &v
	}
	if e.Qty != nil {
		qty = e.Qty
	}
	if e.ClearQty {
		qty = nil
	}
	if bad := checkFields(s, category, price, note, qty, l.Photos); bad != "" {
		return nil, bad
	}
	merged := map[string]LangText{}
	if !e.ReplaceWords {
		for k, v := range l.Words {
			merged[k] = v
		}
	}
	for k, v := range e.Words {
		merged[k] = v
	}
	// the owner is the one editing: their own words are what a health claim may come from
	var owner []string
	for _, l := range Langs {
		if w, ok := e.Words[l]; ok {
			owner = append(owner, w.Title+" "+w.Text)
		}
	}
	ownerText := strings.Join(owner, " ") + " " + strings.Join(l.Claims, " ")
	words, bad := checkWords(category, merged, &ownerText)
	if bad != "" {
		return nil, bad
	}
	l.Category, l.Words = category, words
	l.PricePaise, l.Qty, l.PriceNote = 0, 0, ""
	if price != nil {
		l.PricePaise = *price
	}
	if note != "" {
		l.PriceNote = clean(note)
	}
	if qty != nil {
		l.Qty = *qty
	}
	l.By, l.From = "owner", "app"
	return l, ""
}

// Confirm is "Yes, still have it": confirmed now. The tap names the confirmedMs the owner was shown, so an old tap does nothing.
func (s *State) Confirm(id string, nowMs, shown int64) (*Listing, Failure) {
	l := s.find(id)
	if l == nil {
		return nil, NoSuchListing
	}
	if l.State != "live" || l.ConfirmedMs != shown {
		return nil, NotLive
	}
	l.ConfirmedMs = nowMs
	return l, ""
}

// MarkSold hides the listing at once.
func (s *State) MarkSold(id string, nowMs int64) (*Listing, Failure) {
	l := s.find(id)
	if l == nil {
		return nil, NoSuchListing
	}
	if l.State != "live" {
		return nil, NotLive
	}
	l.State, l.SoldMs = "sold", nowMs
	return l, ""
}

// Remove takes a listing (or a draft) off.
func (s *State) Remove(id string, nowMs int64) (*Listing, Failure) {
	l := s.find(id)
	if l == nil {
		return nil, NoSuchListing
	}
	if l.State == "removed" {
		return nil, NotLive
	}
	l.State, l.RemovedMs = "removed", nowMs
	return l, ""
}

// ShopPatch is what the owner sets for the shop. Each *Set says the field was given; a given empty string (or Clear) clears it.
type ShopPatch struct {
	Visible      *bool
	Town         *string
	Pincode      *string
	Point        *Point
	ClearPoint   bool
	Registration *string
}

// Point is a map point.
type Point struct{ Lat, Lon float64 }

var pincode = regexp.MustCompile(`^[1-9]\d{5}$`)

// SetShop is the shop-wide settings the owner sets: the switch, the place, the registration.
func (s *State) SetShop(p ShopPatch) Failure {
	shop := s.Shop
	if p.Town != nil {
		t := clean(*p.Town)
		if utf16Len(t) > 60 {
			return BadPlace
		}
		shop.Town = t
	}
	if p.Pincode != nil {
		t := strings.TrimFunc(*p.Pincode, isJSSpace)
		if t != "" && !pincode.MatchString(t) {
			return BadPlace
		}
		shop.Pincode = t
	}
	if p.ClearPoint {
		shop.Lat, shop.Lon = nil, nil
	} else if p.Point != nil {
		lat, lon := p.Point.Lat, p.Point.Lon
		// India's own box, so a typo in a map point is refused rather than shown
		if lat < 6 || lat > 37.5 || lon < 68 || lon > 98 {
			return BadPlace
		}
		la, lo := round5(lat), round5(lon)
		shop.Lat, shop.Lon = &la, &lo
	}
	if p.Registration != nil {
		t := clean(*p.Registration)
		if utf16Len(t) > 120 {
			return BadText
		}
		shop.Registration = t
	}
	if p.Visible != nil {
		shop.Visible = *p.Visible
	}
	s.Shop = shop
	return ""
}

func round5(f float64) float64 {
	// Math.round(f * 1e5) / 1e5: round half up
	x := f * 1e5
	r := float64(int64(x + 0.5))
	if x < 0 {
		r = -float64(int64(-x + 0.5))
	}
	return r / 1e5
}

// NoteUpload counts a photo the owner took in against the day's bound and keeps it as waiting.
func (s *State) NoteUpload(p Photo, day string, nowMs int64) Failure {
	if s.Uploads.Day != day {
		s.Uploads.Day, s.Uploads.N = day, 0
	}
	if s.Uploads.N >= UploadsDay {
		return TooManyPhotos
	}
	s.Uploads.N++
	s.Pending = append(s.Pending, PendingPhoto{Photo: p, AtMs: nowMs})
	return ""
}

// PendingPhotos are the photos uploaded lately and not used: what the next listing takes (at most 3, oldest first).
func (s *State) PendingPhotos(nowMs int64) []PendingPhoto {
	var out []PendingPhoto
	for _, p := range s.Pending {
		if nowMs-p.AtMs < PendingMs {
			out = append(out, p)
		}
	}
	if len(out) > MaxPhotos {
		out = out[:MaxPhotos]
	}
	return out
}

// TakePhotos are the pending photos a form names (by id); they are taken off the waiting list when the listing is published.
func (s *State) TakePhotos(ids []string, nowMs int64) []Photo {
	want := map[string]bool{}
	for _, id := range ids {
		want[id] = true
	}
	out := []Photo{}
	for _, p := range s.PendingPhotos(nowMs) {
		if want[p.ID] {
			out = append(out, p.Photo)
		}
	}
	return out
}

// Freshness of a live listing, by the owner's last confirm.
func Freshness(l *Listing, nowMs int64) string {
	at := l.ConfirmedMs
	if at == 0 {
		at = l.PublishedMs
	}
	age := nowMs - at
	switch {
	case age <= FreshMs:
		return "fresh"
	case age <= HideAfterMs:
		return "check"
	}
	return "hidden"
}

// IsPublic: live, and not hidden for want of a confirm.
func IsPublic(l *Listing, nowMs int64) bool {
	return l.State == "live" && Freshness(l, nowMs) != "hidden"
}

// Public is the listings the public sees, newest confirmed first. soldOut holds the counted listings at 0 (stock): they sell themselves and are left out without writing to them.
func (s *State) Public(nowMs int64, soldOut map[string]bool) []Listing {
	out := []Listing{}
	for _, l := range s.Items {
		if IsPublic(&l, nowMs) && !soldOut[l.ID] {
			out = append(out, l)
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].ConfirmedMs != out[j].ConfirmedMs {
			return out[i].ConfirmedMs > out[j].ConfirmedMs
		}
		return out[i].CreatedMs > out[j].CreatedMs
	})
	return out
}

// Owners is the owner's own list: drafts and live (hidden ones too), newest first.
func (s *State) Owners() []Listing {
	out := []Listing{}
	for _, l := range s.Items {
		if l.State == "draft" || l.State == "live" {
			out = append(out, l)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].CreatedMs > out[j].CreatedMs })
	return out
}

// PhotoIDs is every photo id the state holds: the listings' (draft, live, sold) and the pending ones. The daily clean-up keeps these.
func (s *State) PhotoIDs() map[string]bool {
	ids := map[string]bool{}
	for _, l := range s.Items {
		if l.State != "removed" {
			for _, p := range l.Photos {
				ids[p.ID] = true
			}
		}
	}
	for _, p := range s.Pending {
		ids[p.ID] = true
	}
	return ids
}

// Tidy runs on the daily beat: a draft past its day goes, sold or removed listings lose their words after 30 days, stale pending photos go.
func (s *State) Tidy(nowMs int64) {
	kept := s.Items[:0]
	for _, l := range s.Items {
		if !(l.State == "draft" && l.CreatedMs+DraftMs <= nowMs) {
			kept = append(kept, l)
		}
	}
	s.Items = kept
	for i := range s.Items {
		l := &s.Items[i]
		if (l.State == "sold" && l.SoldMs+GoneKeptMs <= nowMs) || (l.State == "removed" && l.RemovedMs+GoneKeptMs <= nowMs) {
			l.Words, l.Photos, l.Claims = map[string]LangText{}, []Photo{}, nil
		}
		if l.State == "removed" && len(l.Photos) > 0 {
			l.Photos = []Photo{}
		}
	}
	pending := s.Pending[:0]
	for _, p := range s.Pending {
		if nowMs-p.AtMs < PendingMs {
			pending = append(pending, p)
		}
	}
	s.Pending = pending
}

// TextIn is the text of a listing in a language: that language's, else the owner's own, else English, else whatever there is.
func TextIn(l *Listing, lang string) LangText {
	for _, k := range append([]string{lang, l.OwnerLang, "en"}, Langs...) {
		if w, ok := l.Words[k]; ok {
			return w
		}
	}
	return LangText{Title: l.ID}
}
