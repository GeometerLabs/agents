package stockorders

// A Stock orders shop's settings.json, read and checked: the Go twin of templates/commerce/stock-orders/src/settings.ts (validateSettings and the catalogue's reads). Every problem
// is said in plain words, all at once and in the TypeScript's order, so a builder can fix the folder without a manual. The sentences are the TypeScript's, copied from
// src/settings.ts (vectors generated from validateSettings are not made yet: Deferred.md).
//
// Where Go and JavaScript differ: an object's keys are walked in the file's own order (JSON.parse keeps it; a Go map does not), so `keysIn` reads the order from the raw bytes;
// `JSON.stringify` of a value in a sentence is jsQuote; a number is written as JavaScript writes it (jsNum).
//
// The `assistant` block is read by the shared runtime (Settings.ReadAssistant). Its own sentences (modules/assistant/settings.ts readAssistantSettings) are NOT checked here:
// they live in internal/bookings unexported; Deferred.md says so.

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/zone"
)

// Names is an item's or a unit's names per language; "en" is always there.
type Names map[string][]string

// Item and Unit are what may be ordered and the packs.
type Item struct {
	ID    string
	Names Names
}
type Unit = Item

// Supplier is one supplier on the owner's list.
type Supplier struct {
	ID       string
	Name     string
	Aliases  []string
	WhatsApp string
	Language string
	Approved bool
}

// Line is one catalogue line: an item from a supplier in a unit at the last price. ReorderQty 0 is "not given" (the agent asks).
type Line struct {
	Item, Supplier, Unit string
	PriceInr             float64
	ReorderQty           int64
}

// Limits are the cap, the month's budget and the most units in one order.
type Limits struct {
	MaxPerOrderInr   float64
	MonthlyBudgetInr float64
	MaxQuantity      int64
}

// Settings is settings.ts Settings.
type Settings struct {
	Name, Address, Timezone string
	Languages               []string
	Owner                   struct{ WhatsApp, Language string }
	Items                   []Item
	Units                   []Unit
	Suppliers               []Supplier
	Catalogue               []Line
	Limits                  Limits
	FollowUpHours           []int64
	// Assistant: the settings have an `assistant` block (the shop's assistant is on).
	Assistant bool
}

var (
	phoneRe = regexp.MustCompile(`^\+\d{10,15}$`)
	idRe    = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,39}$`)
)

var allLanguages = []string{"hi", "en", "ml", "kn"} // languages.ts LANGUAGES, in its order

func knownLanguage(l string) bool {
	for _, x := range allLanguages {
		if x == l {
			return true
		}
	}
	return false
}

// languageList is settings.ts languageList: the codes with their names.
func languageList() string {
	return `"hi" (Hindi), "en" (English), "ml" (Malayalam), "kn" (Kannada)`
}

type reader struct {
	errs []string
	raw  []byte
}

func (r *reader) add(s string) { r.errs = append(r.errs, s) }

// keysIn is Object.keys in the file's order: the keys of the object at path (a list of member names from the top) as the raw file has them.
func keysIn(raw json.RawMessage) []string {
	dec := json.NewDecoder(bytes.NewReader(raw))
	if t, err := dec.Token(); err != nil || t != json.Delim('{') {
		return nil
	}
	var out []string
	for dec.More() {
		k, err := dec.Token()
		if err != nil {
			return out
		}
		out = append(out, k.(string))
		var skip json.RawMessage
		if dec.Decode(&skip) != nil {
			return out
		}
	}
	return out
}

func (r *reader) unknownKeys(raw json.RawMessage, known []string, where string) {
	quoted := make([]string, len(known))
	for i, k := range known {
		quoted[i] = `"` + k + `"`
	}
	for _, k := range keysIn(raw) {
		ok := false
		for _, n := range known {
			ok = ok || n == k
		}
		if !ok {
			r.add(fmt.Sprintf(`%s has "%s", which I do not know. Known: %s.`, where, k, strings.Join(quoted, ", ")))
		}
	}
}

// jsQuote is JSON.stringify of a value as a sentence quotes it.
func jsQuote(v json.RawMessage) string {
	if len(v) == 0 {
		return "undefined"
	}
	var x any
	if json.Unmarshal(v, &x) != nil {
		return string(v)
	}
	if f, ok := x.(float64); ok {
		return jsNum(f)
	}
	b, _ := json.Marshal(x)
	return string(b)
}

// jsNum is String(n) of a number as JavaScript writes it (a whole number with no ".0").
func jsNum(f float64) string {
	if f == math.Trunc(f) && math.Abs(f) < 1e21 {
		return strconv.FormatFloat(f, 'f', -1, 64)
	}
	return strconv.FormatFloat(f, 'g', -1, 64)
}

func obj(v json.RawMessage) (map[string]json.RawMessage, bool) {
	if len(v) == 0 || v[0] != '{' {
		return nil, false
	}
	var m map[string]json.RawMessage
	return m, json.Unmarshal(v, &m) == nil
}
func arr(v json.RawMessage) ([]json.RawMessage, bool) {
	if len(v) == 0 || v[0] != '[' {
		return nil, false
	}
	var a []json.RawMessage
	return a, json.Unmarshal(v, &a) == nil
}
func str(v json.RawMessage) (string, bool) {
	if len(v) == 0 || v[0] != '"' {
		return "", false
	}
	var s string
	return s, json.Unmarshal(v, &s) == nil
}
func num(v json.RawMessage) (float64, bool) {
	if len(v) == 0 {
		return 0, false
	}
	var f float64
	if json.Unmarshal(v, &f) != nil {
		return 0, false
	}
	return f, true
}
func isWhole(v json.RawMessage) (int64, bool) {
	f, ok := num(v)
	if !ok || f != math.Trunc(f) || math.Abs(f) > 1<<53 {
		return 0, false
	}
	return int64(f), true
}

// isMoney is settings.ts isMoney: rupees above 0 with at most two decimals.
func isMoney(v json.RawMessage) (float64, bool) {
	f, ok := num(v)
	if !ok || math.IsInf(f, 0) || f <= 0 || math.Abs(f*100-math.Round(f*100)) >= 1e-6 {
		return 0, false
	}
	return f, true
}
func trimJS(s string) string { return strings.TrimFunc(s, isJSSpace) }

// ReadSettings is validateSettings over the raw file: the settings, or every problem.
func ReadSettings(raw []byte) (*Settings, []string) {
	r := &reader{raw: raw}
	in, ok := obj(raw)
	if !ok {
		return nil, []string{"The settings must be an object with the shop's name, suppliers, catalogue and limits."}
	}
	r.unknownKeys(raw, []string{"name", "address", "timezone", "languages", "owner", "items", "units", "suppliers", "catalogue", "limits", "followUpHours", "assistant"}, "the settings")
	s := &Settings{}
	name, isStr := str(in["name"])
	if !isStr || trimJS(name) == "" {
		r.add(`Add the shop's name ("name").`)
	}
	if v, there := in["address"]; there {
		if a, ok := str(v); ok {
			s.Address = a
		} else {
			r.add(`The address ("address") must be text.`)
		}
	}
	tz := "Asia/Kolkata"
	if v, there := in["timezone"]; there && string(v) != "null" {
		t, ok := str(v)
		if !ok || !zone.Valid(t) {
			r.add(fmt.Sprintf(`The time zone %s is not one I know. Use a name like "Asia/Kolkata".`, jsQuote(v)))
		}
		tz = t
	}
	s.Languages = r.languages(in["languages"])
	ownerOK := r.owner(in["owner"], s)
	s.Items = r.named(in["items"], "item", "items")
	s.Units = r.named(in["units"], "unit", "units")
	s.Suppliers = r.suppliers(in["suppliers"], s.Languages)
	s.Catalogue = r.catalogue(in["catalogue"], s)
	limitsOK := r.limits(in["limits"], s)
	s.FollowUpHours = r.followUp(in["followUpHours"])
	if v, there := in["assistant"]; there && string(v) != "null" {
		s.Assistant = true
	}
	if len(r.errs) == 0 && limitsOK {
		for _, l := range s.Catalogue {
			if l.PriceInr > s.Limits.MaxPerOrderInr {
				r.add(fmt.Sprintf(`One unit of %s from %s costs ₹%s, more than the most one order may be worth (₹%s): it could never be ordered. Raise "limits.maxPerOrderInr" or fix the price.`, l.Item, l.Supplier, jsNum(l.PriceInr), jsNum(s.Limits.MaxPerOrderInr)))
			}
		}
		if s.Limits.MaxPerOrderInr > s.Limits.MonthlyBudgetInr {
			r.add(fmt.Sprintf(`The most for one order (₹%s) is above the month's budget (₹%s). Make the order limit the smaller number.`, jsNum(s.Limits.MaxPerOrderInr), jsNum(s.Limits.MonthlyBudgetInr)))
		}
	}
	if len(r.errs) > 0 || !ownerOK || !limitsOK {
		return nil, r.errs
	}
	s.Name, s.Timezone = trimJS(name), tz
	return s, nil
}

func (r *reader) languages(v json.RawMessage) []string {
	list, ok := arr(v)
	if !ok || len(list) == 0 {
		r.add(fmt.Sprintf(`List the languages ("languages"), for example ["en", "hi"]. Known: %s.`, languageList()))
		return []string{"en"}
	}
	var out []string
	for _, x := range list {
		l, _ := str(x)
		if !knownLanguage(l) || x[0] != '"' {
			r.add(fmt.Sprintf(`The language %s is not one I know. Known: %s.`, jsQuote(x), languageList()))
			continue
		}
		dup := false
		for _, o := range out {
			dup = dup || o == l
		}
		if !dup {
			out = append(out, l)
		}
	}
	return out
}

func (r *reader) owner(v json.RawMessage, s *Settings) bool {
	o, ok := obj(v)
	if !ok {
		r.add(`Add the owner ("owner": the WhatsApp number and language).`)
		return false
	}
	r.unknownKeys(v, []string{"whatsapp", "language"}, `"owner"`)
	wa, isStr := str(o["whatsapp"])
	if !isStr || !phoneRe.MatchString(wa) {
		r.add(`The owner's WhatsApp number ("owner.whatsapp") must look like +919812345678.`)
	}
	lang := ""
	if len(s.Languages) > 0 {
		lang = s.Languages[0]
	}
	if lv, there := o["language"]; there && string(lv) != "null" {
		l, _ := str(lv)
		lang = l
		if lv[0] != '"' {
			lang = "\x00"
		}
	}
	if !knownLanguage(lang) {
		r.add(fmt.Sprintf(`The owner's language ("owner.language") must be one of %s.`, languageList()))
	}
	s.Owner.WhatsApp, s.Owner.Language = wa, lang
	return isStr
}

func (r *reader) names(v json.RawMessage, where string) Names {
	o, ok := obj(v)
	if !ok {
		r.add(fmt.Sprintf(`%s needs names, for example {"en": ["hair colour"], "hi": ["हेयर कलर"]}.`, where))
		return nil
	}
	out := Names{}
	for _, lang := range keysIn(v) {
		if !knownLanguage(lang) {
			r.add(fmt.Sprintf(`%s has a name in "%s", which is not a language I know.`, where, lang))
			continue
		}
		list, isArr := arr(o[lang])
		bad := !isArr || len(list) == 0
		var names []string
		for _, n := range list {
			t, isStr := str(n)
			if !isStr || trimJS(t) == "" {
				bad = true
			}
			names = append(names, trimJS(t))
		}
		if bad {
			r.add(fmt.Sprintf(`%s: the names in "%s" must be a list of words.`, where, lang))
			continue
		}
		out[lang] = names
	}
	if _, has := out["en"]; !has {
		r.add(fmt.Sprintf(`%s needs an English name ("en"): it is the fallback every language uses.`, where))
		return nil
	}
	return out
}

func (r *reader) named(v json.RawMessage, singular, plural string) []Item {
	list, ok := arr(v)
	if !ok || len(list) == 0 {
		r.add(fmt.Sprintf(`List the %s ("%s"), each with an id and names.`, plural, plural))
		return nil
	}
	var out []Item
	for i, e := range list {
		where := fmt.Sprintf("%s number %d", singular, i+1)
		o, ok := obj(e)
		if !ok {
			r.add(where + " must be an object with an id and names.")
			continue
		}
		r.unknownKeys(e, []string{"id", "names"}, where)
		id, isStr := str(o["id"])
		if !isStr || !idRe.MatchString(id) {
			r.add(where + " needs an id of lowercase letters, digits and dashes.")
			continue
		}
		for _, x := range out {
			if x.ID == id {
				r.add(fmt.Sprintf(`The %s id "%s" is used twice.`, singular, id))
				break
			}
		}
		if n := r.names(o["names"], fmt.Sprintf(`%s "%s"`, singular, id)); n != nil {
			out = append(out, Item{ID: id, Names: n})
		}
	}
	return out
}

func (r *reader) suppliers(v json.RawMessage, languages []string) []Supplier {
	list, ok := arr(v)
	if !ok || len(list) == 0 {
		r.add(`List the approved suppliers ("suppliers"): an id, a name and a WhatsApp number each.`)
		return nil
	}
	var out []Supplier
	for i, e := range list {
		where := fmt.Sprintf("supplier number %d", i+1)
		o, ok := obj(e)
		if !ok {
			r.add(where + " must be an object.")
			continue
		}
		r.unknownKeys(e, []string{"id", "name", "aliases", "whatsapp", "language", "approved"}, where)
		id, isStr := str(o["id"])
		if !isStr || !idRe.MatchString(id) {
			r.add(where + " needs an id of lowercase letters, digits and dashes.")
			continue
		}
		for _, x := range out {
			if x.ID == id {
				r.add(fmt.Sprintf(`The supplier id "%s" is used twice.`, id))
				break
			}
		}
		name, nameOK := str(o["name"])
		if !nameOK || trimJS(name) == "" {
			r.add(fmt.Sprintf(`Supplier "%s" needs a name.`, id))
		}
		wa, waOK := str(o["whatsapp"])
		if !waOK || !phoneRe.MatchString(wa) {
			r.add(fmt.Sprintf(`Supplier "%s" needs a WhatsApp number like +919812345678.`, id))
		}
		var aliases []string
		if av, there := o["aliases"]; there {
			al, isArr := arr(av)
			bad := !isArr
			for _, a := range al {
				t, isStr := str(a)
				if !isStr || trimJS(t) == "" {
					bad = true
				}
				aliases = append(aliases, trimJS(t))
			}
			if bad {
				r.add(fmt.Sprintf(`Supplier "%s": "aliases" must be a list of names.`, id))
			}
			if !isArr {
				aliases = nil
			}
		}
		lang := ""
		if len(languages) > 0 {
			lang = languages[0]
		}
		if lv, there := o["language"]; there && string(lv) != "null" {
			l, _ := str(lv)
			lang = l
			if lv[0] != '"' {
				lang = "\x00"
			}
		}
		if !knownLanguage(lang) {
			r.add(fmt.Sprintf(`Supplier "%s": the language must be one of %s.`, id, languageList()))
		}
		approved := true
		if av, there := o["approved"]; there {
			switch string(av) {
			case "true":
			case "false":
				approved = false
			default:
				r.add(fmt.Sprintf(`Supplier "%s": "approved" must be true or false.`, id))
			}
		}
		if !waOK {
			wa = ""
		}
		out = append(out, Supplier{ID: id, Name: trimJS(name), Aliases: aliases, WhatsApp: wa, Language: lang, Approved: approved})
	}
	seen := map[string]int{}
	var dups []string
	for _, s := range out {
		seen[s.WhatsApp]++
		if seen[s.WhatsApp] == 2 {
			dups = append(dups, s.WhatsApp)
		}
	}
	for _, n := range dups {
		r.add(fmt.Sprintf(`Two suppliers have the number %s: a reply could not be told apart.`, n))
	}
	return out
}

func (r *reader) catalogue(v json.RawMessage, s *Settings) []Line {
	list, ok := arr(v)
	if !ok || len(list) == 0 {
		r.add(`List the catalogue ("catalogue"): each line is an item, a supplier, a unit and the last price.`)
		return nil
	}
	has := func(xs []Item, id string, isStr bool) bool {
		for _, x := range xs {
			if isStr && x.ID == id {
				return true
			}
		}
		return false
	}
	var out []Line
	for i, e := range list {
		where := fmt.Sprintf("catalogue line %d", i+1)
		o, ok := obj(e)
		if !ok {
			r.add(where + " must be an object.")
			continue
		}
		r.unknownKeys(e, []string{"item", "supplier", "unit", "priceInr", "reorderQty"}, where)
		item, iOK := str(o["item"])
		sup, sOK := str(o["supplier"])
		unit, uOK := str(o["unit"])
		if !has(s.Items, item, iOK) {
			r.add(fmt.Sprintf(`%s: the item %s is not in "items".`, where, jsQuote(o["item"])))
		}
		supOK := false
		for _, x := range s.Suppliers {
			supOK = supOK || (sOK && x.ID == sup)
		}
		if !supOK {
			r.add(fmt.Sprintf(`%s: the supplier %s is not in "suppliers".`, where, jsQuote(o["supplier"])))
		}
		if !has(s.Units, unit, uOK) {
			r.add(fmt.Sprintf(`%s: the unit %s is not in "units".`, where, jsQuote(o["unit"])))
		}
		price, pOK := isMoney(o["priceInr"])
		if !pOK {
			r.add(where + `: the price ("priceInr") must be a number of rupees above 0 with at most two decimals.`)
		}
		var reorder int64
		if rv, there := o["reorderQty"]; there {
			q, whole := isWhole(rv)
			if !whole || q < 1 {
				r.add(where + `: "reorderQty" must be a whole number of at least 1, or left out.`)
			} else {
				reorder = q
			}
		}
		for _, x := range out {
			if x.Item == item && x.Supplier == sup && x.Unit == unit {
				r.add(where + ": the same item, supplier and unit is listed twice.")
				break
			}
		}
		if !pOK {
			price, _ = num(o["priceInr"])
		}
		out = append(out, Line{Item: item, Supplier: sup, Unit: unit, PriceInr: price, ReorderQty: reorder})
	}
	return out
}

func (r *reader) limits(v json.RawMessage, s *Settings) bool {
	o, ok := obj(v)
	if !ok {
		r.add(`Add the limits ("limits": maxPerOrderInr, monthlyBudgetInr).`)
		return false
	}
	r.unknownKeys(v, []string{"maxPerOrderInr", "monthlyBudgetInr", "maxQuantity"}, `"limits"`)
	capInr, capOK := isMoney(o["maxPerOrderInr"])
	if !capOK || capInr != math.Trunc(capInr) {
		r.add(`"limits.maxPerOrderInr" must be a whole number of rupees above 0: the most one order may be worth.`)
	}
	budget, budOK := isMoney(o["monthlyBudgetInr"])
	if !budOK || budget != math.Trunc(budget) {
		r.add(`"limits.monthlyBudgetInr" must be a whole number of rupees above 0: the most a month's orders may add up to.`)
	}
	maxQ := int64(500)
	if mv, there := o["maxQuantity"]; there && string(mv) != "null" {
		q, whole := isWhole(mv)
		if !whole || q < 1 {
			r.add(`"limits.maxQuantity" must be a whole number of at least 1.`)
		}
		maxQ = q
	}
	if !(len(r.errs) == 0 || (capOK && budOK)) {
		return false
	}
	s.Limits = Limits{MaxPerOrderInr: capInr, MonthlyBudgetInr: budget, MaxQuantity: maxQ}
	return true
}

func (r *reader) followUp(v json.RawMessage) []int64 {
	if len(v) == 0 {
		return []int64{4, 24}
	}
	list, ok := arr(v)
	bad := !ok || len(list) == 0
	var out []int64
	for i, h := range list {
		n, whole := isWhole(h)
		if !whole || n < 1 || (i > 0 && n <= out[i-1]) {
			bad = true
		}
		out = append(out, n)
	}
	if bad {
		r.add(`"followUpHours" must be a list of whole hours, each later than the one before, for example [4, 24].`)
		return []int64{4, 24}
	}
	return out
}

// ---- reading the catalogue ----------------------------------------------------------------------------------------------------------------------------

func (s *Settings) itemOf(id string) *Item {
	for i := range s.Items {
		if s.Items[i].ID == id {
			return &s.Items[i]
		}
	}
	return &Item{ID: id, Names: Names{"en": {id}}}
}
func (s *Settings) unitOf(id string) *Unit {
	for i := range s.Units {
		if s.Units[i].ID == id {
			return &s.Units[i]
		}
	}
	return &Unit{ID: id, Names: Names{"en": {id}}}
}
func (s *Settings) supplierOf(id string) *Supplier {
	for i := range s.Suppliers {
		if s.Suppliers[i].ID == id {
			return &s.Suppliers[i]
		}
	}
	return &Supplier{ID: id}
}

// nameIn is settings.ts nameIn: an item's or unit's first name in a language, or its English one.
func nameIn(n Names, lang string) string {
	if l, ok := n[lang]; ok && len(l) > 0 {
		return l[0]
	}
	if l := n["en"]; len(l) > 0 {
		return l[0]
	}
	return ""
}

// lineKey is settings.ts lineKey: "item~supplier~unit".
func lineKey(l Line) string { return l.Item + "~" + l.Supplier + "~" + l.Unit }

func (s *Settings) lineByKey(key string) *Line {
	for i := range s.Catalogue {
		if lineKey(s.Catalogue[i]) == key {
			return &s.Catalogue[i]
		}
	}
	return nil
}

// paise is settings.ts paise: Math.round(rupees * 100) (prices are positive, so JavaScript's round-half-up and Go's round-half-away agree).
func paise(rupees float64) int64 { return int64(math.Round(rupees * 100)) }
