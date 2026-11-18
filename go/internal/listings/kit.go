package listings

// What the shop does with the owner's listing steps (modules/listings/kit.ts): the body of the owner's listings page checked for shape, the one rule-checked effect of each op on
// the state, and the reads the owner's page and the public page need. Pure: no disk, no network, no clock (the caller says what time it is).

import (
	"math"
	"regexp"
)

// Opt is a member of an op that may be absent, null (clear it) or have a value.
type Opt[T any] struct {
	Set  bool
	Null bool
	V    T
}

// Op is one step on the owner's listings page, after its shape was checked.
type Op struct {
	Op           string // publish_form, edit, confirm, sold, remove, shop
	ID           string
	Category     Opt[string]
	Title        Opt[string]
	PriceInr     Opt[float64]
	PriceNote    Opt[string]
	Qty          Opt[float64]
	Photos       []string
	ConfirmedMs  int64
	Visible      Opt[bool]
	Town         Opt[string]
	Pincode      Opt[string]
	Registration Opt[string]
	Point        Opt[Point]
}

var (
	requestID = regexp.MustCompile(`^[A-Za-z0-9-]{1,64}$`)
	listingID = regexp.MustCompile(`^l-\d{1,9}$`)
	// PhotoID is a photo's name: "ph-" and 12 hex digits.
	PhotoID = regexp.MustCompile(`^ph-[0-9a-f]{12}$`)
)

func isObj(v any) (map[string]any, bool) { m, ok := v.(map[string]any); return m, ok }

// text is `typeof v === "string" && v.trim().length > 0 && v.length <= max`.
func text(v any, max int) (string, bool) {
	s, ok := v.(string)
	if !ok || !hasNonSpace(s) || utf16Len(s) > max {
		return "", false
	}
	return s, true
}

func hasNonSpace(s string) bool {
	for _, r := range s {
		if !isJSSpace(r) {
			return true
		}
	}
	return false
}

// num is the page's number: a finite number, null (clear it) or absent.
func num(v any) (f float64, isNum bool) {
	n, ok := v.(float64)
	return n, ok && !math.IsInf(n, 0) && !math.IsNaN(n)
}

// CheckOwnerListing checks the body of POST /internal/channel/owner-listing for shape. The rules themselves (limits, the pets rules) are applied again in the step.
func CheckOwnerListing(body any) (id string, op Op, errText string) {
	b, ok := isObj(body)
	if !ok {
		return "", Op{}, `Send {"id": a request id, "op": {...}}.`
	}
	rid, _ := b["id"].(string)
	o, isO := isObj(b["op"])
	if !requestID.MatchString(rid) || !isO {
		return "", Op{}, `Send {"id": a request id, "op": {...}}.`
	}
	oid, _ := o["id"].(string)
	if !listingID.MatchString(oid) {
		oid = ""
	}
	which, _ := o["op"].(string)
	switch which {
	case "publish_form":
		title, okT := text(o["title"], 200)
		cat, okC := o["category"].(string)
		photos, okP := o["photos"].([]any)
		if !okT || !okC || !okP || len(photos) > MaxPhotos {
			return "", Op{}, "A listing needs a title, a category and up to 3 photo ids."
		}
		var ids []string
		for _, p := range photos {
			s, ok := p.(string)
			if !ok || !PhotoID.MatchString(s) {
				return "", Op{}, "A listing needs a title, a category and up to 3 photo ids."
			}
			ids = append(ids, s)
		}
		x := Op{Op: which, Category: Opt[string]{Set: true, V: cat}, Title: Opt[string]{Set: true, V: title}, Photos: ids}
		if v, present := o["priceInr"]; present {
			if f, ok := num(v); ok {
				x.PriceInr = Opt[float64]{Set: true, V: f}
			} else if v == nil {
				return "", Op{}, "price and quantity are numbers, or left out."
			}
		}
		if v, present := o["qty"]; present {
			if f, ok := num(v); ok {
				x.Qty = Opt[float64]{Set: true, V: f}
			} else if v == nil {
				return "", Op{}, "price and quantity are numbers, or left out."
			}
		}
		if s, ok := o["priceNote"].(string); ok && hasNonSpace(s) {
			x.PriceNote = Opt[string]{Set: true, V: utf16Slice(s, 60)}
		}
		return rid, x, ""
	case "edit":
		if oid == "" {
			return "", Op{}, "edit needs a listing id (l-3)."
		}
		x := Op{Op: which, ID: oid}
		if v, present := o["title"]; present {
			t, ok := text(v, 200)
			if !ok {
				return "", Op{}, "title is words."
			}
			x.Title = Opt[string]{Set: true, V: t}
		}
		if c, ok := o["category"].(string); ok {
			x.Category = Opt[string]{Set: true, V: c}
		}
		if v, present := o["priceInr"]; present {
			f, ok := num(v)
			x.PriceInr = Opt[float64]{Set: true, Null: !ok, V: f}
		}
		if v, present := o["priceNote"]; present {
			s, ok := v.(string)
			if ok && hasNonSpace(s) {
				x.PriceNote = Opt[string]{Set: true, V: utf16Slice(s, 60)}
			} else {
				x.PriceNote = Opt[string]{Set: true, Null: true}
			}
		}
		if v, present := o["qty"]; present {
			f, ok := num(v)
			x.Qty = Opt[float64]{Set: true, Null: !ok, V: f}
		}
		return rid, x, ""
	case "confirm":
		ms, ok := num(o["confirmedMs"])
		if oid == "" || !ok || ms != math.Trunc(ms) || math.Abs(ms) > 9007199254740991 {
			return "", Op{}, "confirm needs a listing id and the confirmedMs the owner was shown."
		}
		return rid, Op{Op: which, ID: oid, ConfirmedMs: int64(ms)}, ""
	case "sold", "remove":
		if oid == "" {
			return "", Op{}, which + " needs a listing id (l-3)."
		}
		return rid, Op{Op: which, ID: oid}, ""
	case "shop":
		x := Op{Op: which}
		if v, present := o["visible"]; present {
			b, ok := v.(bool)
			if !ok {
				return "", Op{}, "visible is true or false."
			}
			x.Visible = Opt[bool]{Set: true, V: b}
		}
		for _, k := range []struct {
			key string
			dst *Opt[string]
		}{{"town", &x.Town}, {"pincode", &x.Pincode}, {"registration", &x.Registration}} {
			v, present := o[k.key]
			if !present {
				continue
			}
			if v == nil {
				*k.dst = Opt[string]{Set: true, Null: true}
				continue
			}
			s, ok := v.(string)
			if !ok {
				return "", Op{}, k.key + " is words, or null to clear it."
			}
			*k.dst = Opt[string]{Set: true, V: utf16Slice(s, 200)}
		}
		if v, present := o["point"]; present {
			if v == nil {
				x.Point = Opt[Point]{Set: true, Null: true}
			} else if p, ok := isObj(v); ok {
				lat, ok1 := num(p["lat"])
				lon, ok2 := num(p["lon"])
				if !ok1 || !ok2 {
					return "", Op{}, "point is {lat, lon}, or null to clear it."
				}
				x.Point = Opt[Point]{Set: true, V: Point{lat, lon}}
			} else {
				return "", Op{}, "point is {lat, lon}, or null to clear it."
			}
		}
		return rid, x, ""
	}
	return "", Op{}, "op is one of publish_form, edit, confirm, sold, remove, shop."
}

// Event is the saved form of an op: exactly the members the TypeScript runtime saves, so a task left in the queue by one runtime is run by the other.
func (o Op) Event(id string) map[string]any {
	op := map[string]any{"op": o.Op}
	put := func(k string, v any) { op[k] = v }
	if o.ID != "" {
		put("id", o.ID)
	}
	opt := func(k string, set bool, null bool, v any) {
		if !set {
			return
		}
		if null {
			put(k, nil)
		} else {
			put(k, v)
		}
	}
	opt("category", o.Category.Set, false, o.Category.V)
	opt("title", o.Title.Set, false, o.Title.V)
	opt("priceInr", o.PriceInr.Set, o.PriceInr.Null, o.PriceInr.V)
	opt("priceNote", o.PriceNote.Set, o.PriceNote.Null, o.PriceNote.V)
	opt("qty", o.Qty.Set, o.Qty.Null, o.Qty.V)
	if o.Op == "publish_form" {
		photos := o.Photos
		if photos == nil {
			photos = []string{}
		}
		put("photos", photos)
	}
	if o.Op == "confirm" {
		put("confirmedMs", o.ConfirmedMs)
	}
	opt("visible", o.Visible.Set, false, o.Visible.V)
	opt("town", o.Town.Set, o.Town.Null, o.Town.V)
	opt("pincode", o.Pincode.Set, o.Pincode.Null, o.Pincode.V)
	opt("registration", o.Registration.Set, o.Registration.Null, o.Registration.V)
	if o.Point.Set {
		if o.Point.Null {
			put("point", nil)
		} else {
			put("point", map[string]any{"lat": o.Point.V.Lat, "lon": o.Point.V.Lon})
		}
	}
	return map[string]any{"kind": "owner_listing", "id": id, "op": op}
}

// Change is what a successful op did, for the record's line.
type Change string

// Result of one op.
type Result struct {
	Listing *Listing
	Change  Change
	Why     Failure
}

func wholeInt(f float64) (int64, bool) {
	if f != math.Trunc(f) || math.Abs(f) > 9007199254740991 {
		return 0, false
	}
	return int64(f), true
}

// round is Math.round: halves go up.
func round(f float64) float64 { return math.Floor(f + 0.5) }

// Apply is the effect of one op on a state. Shared by the step (the real state) and the page's pre-check (a copy), so what the page says is what the step does.
func Apply(s *State, op Op, ownerLang string, nowMs int64) Result {
	switch op.Op {
	case "publish_form":
		if !IsCategory(op.Category.V, &s.Shop) {
			return Result{Why: BadCategory}
		}
		in := DraftInput{Category: op.Category.V, OwnerLang: ownerLang, Words: map[string]LangText{ownerLang: {Title: op.Title.V}}, OwnerWords: &op.Title.V, PriceNote: op.PriceNote.V, Photos: s.TakePhotos(op.Photos, nowMs)}
		if op.PriceInr.Set {
			p, ok := wholeInt(round(op.PriceInr.V * 100))
			if !ok {
				return Result{Why: BadPrice}
			}
			in.PricePaise = &p
		}
		if op.Qty.Set {
			q, ok := wholeInt(op.Qty.V)
			if !ok {
				return Result{Why: BadQty}
			}
			in.Qty = &q
		}
		made, why := s.Draft(in, nowMs)
		if why != "" {
			return Result{Why: why}
		}
		id := made.ID
		l, why := s.Publish(id, nowMs)
		if why != "" {
			// a refused publish (50 already live) leaves no draft behind: the form is all-or-nothing
			s.Remove(id, nowMs)
			return Result{Why: why}
		}
		return Result{Listing: l, Change: "published"}
	case "edit":
		l := s.find(op.ID)
		if l == nil {
			return Result{Why: NoSuchListing}
		}
		e := Edit{}
		if op.Category.Set {
			e.Category = &op.Category.V
		}
		if op.Title.Set {
			e.Words = map[string]LangText{l.OwnerLang: {Title: op.Title.V, Text: l.Words[l.OwnerLang].Text}}
			e.ReplaceWords = true
		}
		if op.PriceInr.Set {
			if op.PriceInr.Null {
				e.ClearPrice = true
			} else {
				p, ok := wholeInt(round(op.PriceInr.V * 100))
				if !ok {
					return Result{Why: BadPrice}
				}
				e.Price = &p
			}
		}
		if op.PriceNote.Set {
			if op.PriceNote.Null {
				e.ClearNote = true
			} else {
				e.Note = &op.PriceNote.V
			}
		}
		if op.Qty.Set {
			if op.Qty.Null {
				e.ClearQty = true
			} else {
				q, ok := wholeInt(op.Qty.V)
				if !ok {
					return Result{Why: BadQty}
				}
				e.Qty = &q
			}
		}
		l, why := s.ApplyEdit(op.ID, e)
		return Result{Listing: l, Change: "edited", Why: why}
	case "confirm":
		l, why := s.Confirm(op.ID, nowMs, op.ConfirmedMs)
		return Result{Listing: l, Change: "confirmed", Why: why}
	case "sold":
		l, why := s.MarkSold(op.ID, nowMs)
		return Result{Listing: l, Change: "sold", Why: why}
	case "remove":
		l, why := s.Remove(op.ID, nowMs)
		return Result{Listing: l, Change: "removed", Why: why}
	case "shop":
		p := ShopPatch{}
		if op.Visible.Set {
			p.Visible = &op.Visible.V
		}
		clear := func(o Opt[string]) *string {
			if !o.Set {
				return nil
			}
			if o.Null {
				e := ""
				return &e
			}
			return &o.V
		}
		p.Town, p.Pincode, p.Registration = clear(op.Town), clear(op.Pincode), clear(op.Registration)
		if op.Point.Set {
			if op.Point.Null {
				p.ClearPoint = true
			} else {
				p.Point = &op.Point.V
			}
		}
		if why := s.SetShop(p); why != "" {
			return Result{Why: why}
		}
		change := Change("place")
		if op.Visible.Set {
			change = "switch"
		}
		return Result{Change: change}
	}
	return Result{Why: BadText}
}

// Check is what an op would do now, without doing it: "" when it would work, else why not. For the page's own notice.
func Check(s State, op Op, ownerLang string, nowMs int64) Failure {
	copy := s.Clone()
	return Apply(&copy, op, ownerLang, nowMs).Why
}

// Clone is a copy that shares nothing with the original.
func (s State) Clone() State {
	c := s
	c.Items = make([]Listing, len(s.Items))
	for i, l := range s.Items {
		l.Words = copyWords(l.Words)
		l.Photos = append([]Photo{}, l.Photos...)
		l.Claims = append([]string(nil), l.Claims...)
		c.Items[i] = l
	}
	c.Pending = append([]PendingPhoto{}, s.Pending...)
	return c
}

func copyWords(w map[string]LangText) map[string]LangText {
	out := make(map[string]LangText, len(w))
	for k, v := range w {
		out[k] = v
	}
	return out
}

// ---- the reads -------------------------------------------------------------------------------------------------------------------------------------------

// Stock (the one stock count, assistant.stock) is in stock.go.

// PublicRead is what the public page, the feed and the open data read: only what a visitor may see.
type PublicRead struct {
	Shop     Shop      `json:"shop"`
	Listings []Listing `json:"listings"`
}

// PublicOf is the public read of a state.
func PublicOf(s *State, stock *Stock, nowMs int64) PublicRead {
	if s == nil {
		return PublicRead{Shop: Shop{}, Listings: []Listing{}}
	}
	out := []Listing{}
	for _, l := range s.Public(nowMs, stock.SoldOut()) {
		l.AskedMs = 0
		if q, ok := stock.Count(l.ID); ok {
			l.Qty = q
		}
		l.By, l.From = "owner", "app"
		out = append(out, l)
	}
	return PublicRead{Shop: s.Shop, Listings: out}
}

// OwnerPhoto is a photo as the owner's page lists it.
type OwnerPhoto = Photo

// Row is one listing as the owner's page shows it.
type Row struct {
	Counted     bool                `json:"counted,omitempty"`
	SoldOut     bool                `json:"soldOut,omitempty"`
	ID          string              `json:"id"`
	State       string              `json:"state"`
	Category    string              `json:"category"`
	OwnerLang   string              `json:"ownerLang"`
	Words       map[string]LangText `json:"words"`
	PricePaise  int64               `json:"pricePaise,omitempty"`
	PriceNote   string              `json:"priceNote,omitempty"`
	Qty         *int64              `json:"qty,omitempty"`
	Photos      []Photo             `json:"photos"`
	Freshness   string              `json:"freshness"`
	ConfirmedMs int64               `json:"confirmedMs,omitempty"`
	Claims      []string            `json:"claims,omitempty"`
}

// Category as the owner's page lists it.
type CategoryRow struct {
	ID    string            `json:"id"`
	Names map[string]string `json:"names"`
}

// OwnerView is the owner's listings page's data.
type OwnerView struct {
	Shop        Shop          `json:"shop"`
	Listings    []Row         `json:"listings"`
	Pending     []Photo       `json:"pending"`
	UploadsLeft int           `json:"uploadsLeft"`
	MaxLive     int           `json:"maxLive"`
	LiveCount   int           `json:"liveCount"`
	Categories  []CategoryRow `json:"categories"`
}

// OwnerOf is the owner's view of a state. `today` is the shop's local day ("2026-11-18"), for the upload bound.
func OwnerOf(s *State, stock *Stock, nowMs int64, today string) OwnerView {
	rows := []Row{}
	for _, l := range s.Owners() {
		r := Row{ID: l.ID, State: l.State, Category: l.Category, OwnerLang: l.OwnerLang, Words: l.Words, PricePaise: l.PricePaise, PriceNote: l.PriceNote, Photos: l.Photos, Freshness: "fresh", ConfirmedMs: l.ConfirmedMs, Claims: l.Claims}
		if l.State == "live" {
			r.Freshness = Freshness(&l, nowMs)
		}
		if q, ok := stock.Count(l.ID); ok {
			r.Counted, r.SoldOut, r.Qty = true, q <= 0, &q
		} else if l.Qty != 0 {
			q := l.Qty
			r.Qty = &q
		}
		if r.Photos == nil {
			r.Photos = []Photo{}
		}
		rows = append(rows, r)
	}
	pending := []Photo{}
	for _, p := range s.PendingPhotos(nowMs) {
		pending = append(pending, p.Photo)
	}
	cats := []CategoryRow{}
	for _, c := range Categories {
		cats = append(cats, CategoryRow{ID: c, Names: map[string]string{}})
	}
	for _, x := range s.Shop.ExtraCategories {
		cats = append(cats, CategoryRow{ID: x.ID, Names: x.Names})
	}
	return OwnerView{Shop: s.Shop, Listings: rows, Pending: pending, UploadsLeft: UploadsLeft(s, today), MaxLive: MaxLive, LiveCount: s.LiveCount(), Categories: cats}
}

// UploadsLeft is how many photos the owner may still upload today.
func UploadsLeft(s *State, today string) int {
	if s.Uploads.Day != today {
		return UploadsDay
	}
	if left := UploadsDay - s.Uploads.N; left > 0 {
		return left
	}
	return 0
}

// PublicPhoto: the photo belongs to a public listing now.
func PublicPhoto(s *State, stock *Stock, id string, nowMs int64) bool {
	if s == nil {
		return false
	}
	for _, l := range s.Public(nowMs, stock.SoldOut()) {
		for _, p := range l.Photos {
			if p.ID == id {
				return true
			}
		}
	}
	return false
}

// OwnerHoldsPhoto: any photo the state holds (a draft's, a waiting one, a hidden listing's).
func OwnerHoldsPhoto(s *State, id string) bool {
	if s == nil {
		return false
	}
	for _, l := range s.Items {
		for _, p := range l.Photos {
			if p.ID == id {
				return true
			}
		}
	}
	for _, p := range s.Pending {
		if p.ID == id {
			return true
		}
	}
	return false
}
