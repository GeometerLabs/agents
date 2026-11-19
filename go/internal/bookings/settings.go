package bookings

// A Bookings shop's settings.json, checked: the Go twin of templates/commerce/bookings/src/settings.ts `validateSettings`. Every problem is said in plain words, all at once, with
// the TypeScript's sentences, so a builder reads the same refusal from either runtime. The blocks other modules own are read for what the runtime uses and checked for their
// shape (`payment`: the module and a UPI shop's ID and payee; `approvers` and `assistant`: kept raw for the parts not ported yet); go/internal/bookings/Deferred.md lists what of
// their own checks is not repeated here (the deployer checks the folder with the TypeScript readers before it writes it).
//
// Where Go and JavaScript differ: `name.trim()` is language.TrimJS (JavaScript's white space), a key's order in an error is the order the file names them (JavaScript's
// Object.keys keeps insertion order; Go's map does not, so the unknown keys are read in the file's order by readOrdered).

import (
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/GeometerLabs/agents/go/internal/language"
	"github.com/GeometerLabs/agents/go/internal/runtime"
)

// WeekdayKeys is settings.ts WEEKDAY_KEYS: Date#getDay() order.
var WeekdayKeys = []string{"sun", "mon", "tue", "wed", "thu", "fri", "sat"}

// SharedResource is settings.ts SHARED_RESOURCE.
const SharedResource = "shop"

// MaxDurationMinutes is settings.ts MAX_DURATION_MINUTES.
const MaxDurationMinutes = 1440

var languageNames = map[string]string{"en": "English", "hi": "Hindi", "ml": "Malayalam", "kn": "Kannada"}

// Service is one of the shop's services.
type Service struct {
	ID              string
	Names           map[string][]string // per language; the first name is the one the agent says
	PriceInr        int64
	DurationMinutes int64
	Resource        string // "" is the shared pool
}

// Hours is one day's opening hours as minutes since midnight (Open < Close), with the text as written.
type Hours struct {
	Open, Close         int
	OpenText, CloseText string
}

// Payment is the shop's payment block: "upi" (the owner marks money) or a gateway ("razorpay").
type Payment struct {
	Module string
	UpiID  string
	Payee  string
}

// Settings is a Bookings shop's settings.json, checked.
type Settings struct {
	Name          string
	Address       string
	HasAddress    bool
	Timezone      string
	Loc           *time.Location
	Services      []Service
	OpeningHours  [7]*Hours // by weekday, 0 = Sunday; nil = closed
	SlotMinutes   int64
	BufferMinutes int64
	Resources     map[string]int64
	Deposit       struct{ AmountInr, HoldMinutes int64 }
	Cancellation  struct{ WindowHours, RefundLimitInr int64 }
	Languages     []string
	Owner         struct{ Whatsapp, Language string }
	Reminders     []int64 // hours before, largest first
	Payment       Payment
	Calendar      string // "own" or "google" (calendarModule: left out is "google")
	// Approvers and Assistant are the raw blocks (modules/approvals/people.ts, modules/assistant/settings.ts), nil when left out.
	Approvers map[string]any
	Assistant map[string]any
	// HoursJSON is `openingHours` as the page shows it (shopInfo `hours`): every weekday key, null for a closed day, in WEEKDAY_KEYS order.
	HoursJSON json.RawMessage
}

// ServiceByID is the service with this id, or nil.
func (s *Settings) ServiceByID(id string) *Service {
	for i := range s.Services {
		if s.Services[i].ID == id {
			return &s.Services[i]
		}
	}
	return nil
}

// ServiceName is settings.ts serviceName: the first name in the language, falling back through en, hi, ml, kn, then the id.
func ServiceName(sv *Service, lang string) string {
	for _, l := range []string{lang, "en", "hi", "ml", "kn"} {
		if n := sv.Names[l]; len(n) > 0 {
			return n[0]
		}
	}
	return sv.ID
}

// UnitsFor is settings.ts unitsFor: how many bookings may run at once on a service's resource (one when nothing says more).
func (s *Settings) UnitsFor(sv *Service) int64 {
	res := SharedResource
	if sv != nil && sv.Resource != "" {
		res = sv.Resource
	}
	if n, ok := s.Resources[res]; ok {
		return n
	}
	return 1
}

// OwnerMarked: the owner marks the money (a UPI shop); a gateway shop's money is read from the gateway.
func (s *Settings) OwnerMarked() bool { return s.Payment.Module == "upi" }

func isObj(v any) (map[string]any, bool) {
	m, ok := v.(map[string]any)
	return m, ok
}

func isWhole(v any) (int64, bool) {
	n, ok := v.(float64)
	if !ok || n != math.Trunc(n) || math.IsInf(n, 0) || math.Abs(n) > 9007199254740991 {
		return 0, false
	}
	return int64(n), true
}

// jsJSON is JavaScript's JSON.stringify of a value read from JSON (a number is written the way JavaScript writes it).
func jsJSON(v any) string {
	if n, ok := v.(float64); ok {
		return strconv.FormatFloat(n, 'f', -1, 64)
	}
	if v == nil {
		return "undefined"
	}
	b, _ := json.Marshal(v)
	return string(b)
}

func capitalise(s string) string {
	if s == "" {
		return s
	}
	r := []rune(s)
	r[0] = unicode.ToUpper(r[0])
	return string(r)
}

// reader carries the errors and the order of each object's keys as the file wrote them.
type reader struct {
	errs  []string
	order map[*map[string]any][]string
}

func (r *reader) add(format string, a ...any) { r.errs = append(r.errs, fmt.Sprintf(format, a...)) }

// keysOf is Object.keys in the order the file wrote them (sorted when the order is not known: a value made in Go).
func keysOf(obj map[string]any, order []string) []string {
	if order != nil {
		return order
	}
	keys := make([]string, 0, len(obj))
	for k := range obj {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func (r *reader) unknownKeys(obj map[string]any, order []string, allowed []string, where string) {
	for _, k := range keysOf(obj, order) {
		if !contains(allowed, k) {
			r.add("I don't know what %q means in %s. Allowed: %s.", k, where, strings.Join(allowed, ", "))
		}
	}
}

func contains(l []string, s string) bool {
	for _, x := range l {
		if x == s {
			return true
		}
	}
	return false
}

func (r *reader) whole(v any, label string, minV, maxV int64) (int64, bool) {
	n, ok := isWhole(v)
	if !ok {
		r.add("Set %s as a whole number, for example %d.", label, max(minV, 1))
		return 0, false
	}
	if n < minV || n > maxV {
		r.add("%s must be between %d and %d, not %d.", capitalise(label), minV, maxV, n)
		return 0, false
	}
	return n, true
}

var (
	clockRe = regexp.MustCompile(`^(\d{1,2}):(\d{2})$`)
	idRe    = regexp.MustCompile(`^[a-z0-9-]+$`)
	ownerRe = regexp.MustCompile(`^\+\d{10,15}$`)
	vpaRe   = regexp.MustCompile(`^[a-z0-9._-]{2,256}@[a-z][a-z0-9]{1,64}$`) // upi/link.ts VPA_RE
)

// ParseClock is time.ts parseClock: "10:00" as minutes since midnight, or -1.
func ParseClock(text string) int {
	m := clockRe.FindStringSubmatch(text)
	if m == nil {
		return -1
	}
	h, _ := strconv.Atoi(m[1])
	mi, _ := strconv.Atoi(m[2])
	if h > 23 || mi > 59 {
		return -1
	}
	return h*60 + mi
}

// ordered decodes settings.json keeping each object's key order (for the unknown-key sentences, which list the keys as the file wrote them).
func ordered(raw []byte) map[string][]string {
	out := map[string][]string{}
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	var walk func(path string) error
	walk = func(path string) error {
		t, err := dec.Token()
		if err != nil {
			return err
		}
		switch t {
		case json.Delim('{'):
			keys := []string{}
			for dec.More() {
				kt, err := dec.Token()
				if err != nil {
					return err
				}
				k := kt.(string)
				keys = append(keys, k)
				if err := walk(path + "/" + k); err != nil {
					return err
				}
			}
			out[path] = keys
			_, err = dec.Token()
			return err
		case json.Delim('['):
			i := 0
			for dec.More() {
				if err := walk(path + "/" + strconv.Itoa(i)); err != nil {
					return err
				}
				i++
			}
			_, err = dec.Token()
			return err
		}
		return nil
	}
	_ = walk("")
	return out
}

// ReadSettings is validateSettings over settings.json as decoded; `raw` is the file's bytes (for the keys' order), nil when not known.
func ReadSettings(in map[string]any, raw []byte) (*Settings, []string) {
	r := &reader{}
	order := map[string][]string{}
	if raw != nil {
		order = ordered(raw)
	}
	keys := func(path string) []string { return order[path] }
	s := &Settings{}
	r.unknownKeys(in, keys(""), []string{"name", "address", "timezone", "services", "openingHours", "slotMinutes", "bufferMinutes", "resources", "deposit", "cancellation", "languages", "owner", "approvers", "reminders", "payment", "calendar", "assistant"}, "the settings")
	name, ok := in["name"].(string)
	if !ok || language.TrimJS(name) == "" {
		r.add(`Add the business's name ("name").`)
	}
	s.Name = language.TrimJS(name)
	if a, given := in["address"]; given {
		if as, ok := a.(string); ok {
			s.Address, s.HasAddress = as, true
		} else {
			r.add(`The address ("address") must be text.`)
		}
	}
	tzv, given := in["timezone"]
	if !given {
		tzv = "Asia/Kolkata"
	}
	tz, _ := tzv.(string)
	if loc, err := time.LoadLocation(tz); err != nil || tz == "" || tz == "Local" {
		r.add("The time zone %s is not one I know. Use a name like \"Asia/Kolkata\".", jsJSON(tzv))
	} else {
		s.Timezone, s.Loc = tz, loc
	}
	s.Languages = r.languages(in["languages"])
	if v, ok := r.whole(in["slotMinutes"], `the slot length ("slotMinutes")`, 5, 240); ok {
		s.SlotMinutes = v
	}
	if b, given := in["bufferMinutes"]; given {
		s.BufferMinutes, _ = r.whole(b, `the buffer time ("bufferMinutes")`, 0, 240)
	}
	s.Resources = r.resources(in["resources"], keys("/resources"))
	s.Services = r.services(in["services"], s.Languages, s.Resources, keys)
	r.hours(in["openingHours"], keys("/openingHours"), s)
	r.deposit(in["deposit"], keys("/deposit"), s)
	r.cancellation(in["cancellation"], keys("/cancellation"), s)
	r.owner(in["owner"], keys("/owner"), s)
	if ap, given := in["approvers"]; given {
		if m, ok := isObj(ap); ok {
			s.Approvers = m
		} else {
			r.add(`"approvers" must be an object: {"people": [...], "twoAboveInr": ...}.`)
		}
	}
	s.Reminders = r.reminders(in["reminders"], keys("/reminders"))
	r.payment(in["payment"], keys("/payment"), keys("/payment/upi"), s)
	s.Calendar = "google"
	if c, given := in["calendar"]; given {
		m, ok := isObj(c)
		if mod, _ := m["module"].(string); !ok || (mod != "own" && mod != "google") {
			r.add(`"calendar" must be {"module": "own"} (the shop's own booking list, no Google Calendar) or {"module": "google"}.`)
		} else {
			s.Calendar = mod
		}
	}
	if a, given := in["assistant"]; given {
		if m, ok := isObj(a); ok {
			s.Assistant = m
		} else {
			r.add(`The shop's assistant ("assistant") must be an object.`)
		}
	}
	return s, r.errs
}

func (r *reader) languages(v any) []string {
	if v == nil {
		return []string{"hi", "en"}
	}
	list, ok := v.([]any)
	if !ok || len(list) == 0 {
		r.add(`List at least one customer language ("languages"), for example ["hi", "en"].`)
		return []string{"hi", "en"}
	}
	var out []string
	for _, l := range list {
		ls, _ := l.(string)
		switch {
		case !contains(runtime.LANGUAGES, ls):
			r.add("The language %s is not supported yet. Use one of %s.", jsJSON(l), languageList())
		case contains(out, ls):
			r.add("The language %q is listed twice.", ls)
		default:
			out = append(out, ls)
		}
	}
	if len(out) == 0 {
		return []string{"hi", "en"}
	}
	return out
}

func languageList() string {
	var parts []string
	for _, l := range runtime.LANGUAGES {
		parts = append(parts, fmt.Sprintf("%q (%s)", l, languageNames[l]))
	}
	return strings.Join(parts, ", ")
}

func (r *reader) resources(v any, order []string) map[string]int64 {
	if v == nil {
		return nil
	}
	m, ok := isObj(v)
	if !ok || len(m) == 0 {
		r.add(`"resources" must say how many bookings can run at once for each thing, for example {"shop": 2} for two chairs.`)
		return nil
	}
	out := map[string]int64{}
	for _, id := range keysOf(m, order) {
		n, whole := isWhole(m[id])
		switch {
		case !idRe.MatchString(id):
			r.add("The resource %q needs a name made of lowercase letters, digits and dashes, for example \"tractor\".", id)
		case !whole || n < 1 || n > 50:
			r.add("The number for %q in \"resources\" must be a whole number from 1 to 50, not %s.", id, jsJSON(m[id]))
		default:
			out[id] = n
		}
	}
	return out
}

func (r *reader) services(v any, langs []string, resources map[string]int64, keys func(string) []string) []Service {
	list, ok := v.([]any)
	if !ok || len(list) == 0 {
		r.add(`Add at least one service ("services") with a name, a price in rupees and a duration.`)
		return nil
	}
	var out []Service
	seenIDs := map[string]bool{}
	seenNames := map[string]string{}
	for i, raw := range list {
		m, isMap := isObj(raw)
		label := fmt.Sprintf("Service number %d", i+1)
		if id, ok := m["id"].(string); isMap && ok {
			label = fmt.Sprintf("Service %q", id)
		}
		if !isMap {
			r.add("%s must be an object with id, names, priceInr and durationMinutes.", label)
			continue
		}
		path := "/services/" + strconv.Itoa(i)
		r.unknownKeys(m, keys(path), []string{"id", "names", "priceInr", "durationMinutes", "resource"}, label)
		id, idOK := m["id"].(string)
		switch {
		case !idOK || !idRe.MatchString(id):
			r.add("%s needs an id made of lowercase letters, digits and dashes, for example \"haircut\".", label)
		case seenIDs[id]:
			r.add("Two services share the id %q. Each id must be different.", id)
		default:
			seenIDs[id] = true
		}
		idText := fmt.Sprint(m["id"])
		if !idOK {
			idText = jsString(m["id"])
		}
		names := map[string][]string{}
		if nm, ok := isObj(m["names"]); !ok {
			r.add(`%s needs "names": what customers call it, per language, for example {"en": ["haircut"], "hi": ["हेयरकट"]}.`, label)
		} else {
			r.unknownKeys(nm, keys(path+"/names"), runtime.LANGUAGES, label+"'s names")
			for _, lang := range langs {
				l, ok := nm[lang].([]any)
				good := ok && len(l) > 0
				for _, n := range l {
					if ns, isS := n.(string); !isS || language.TrimJS(ns) == "" {
						good = false
					}
				}
				if !good {
					r.add("%s needs at least one name in %s (%q), because customers can write in it.", label, languageNames[lang], lang)
					continue
				}
				for _, n := range l {
					t := language.TrimJS(n.(string))
					names[lang] = append(names[lang], t)
					key := strings.ToLower(t)
					if other, seen := seenNames[key]; seen && other != idText {
						r.add("The name %q is used by both %q and %q, so the agent could not tell which one a customer means.", t, other, idText)
					} else {
						seenNames[key] = idText
					}
				}
			}
		}
		price, priceOK := isWhole(m["priceInr"])
		if !priceOK || price < 1 {
			r.add(`%s needs a price in whole rupees ("priceInr"), for example 450. This is also the lowest price the agent will ever agree to.`, label)
		}
		dur, durOK := isWhole(m["durationMinutes"])
		if !durOK || dur < 5 || dur > MaxDurationMinutes {
			r.add(`%s needs a duration in whole minutes ("durationMinutes"), between 5 and %d.`, label, MaxDurationMinutes)
		}
		res, hasRes := m["resource"]
		resS, resIsS := res.(string)
		if hasRes && (!resIsS || (resS != SharedResource && resources[resS] == 0)) {
			r.add(`%s uses the resource %s, which is not listed in "resources". Add it there with how many can run at once.`, label, jsJSON(res))
		}
		if idOK && priceOK && durOK {
			sv := Service{ID: id, Names: names, PriceInr: price, DurationMinutes: dur}
			if resIsS {
				sv.Resource = resS
			}
			out = append(out, sv)
		}
	}
	return out
}

// jsString is String(v) for a value read from JSON.
func jsString(v any) string {
	switch x := v.(type) {
	case nil:
		return "undefined"
	case string:
		return x
	case float64:
		return strconv.FormatFloat(x, 'f', -1, 64)
	case bool:
		return strconv.FormatBool(x)
	case []any:
		return "" // an array's String() is its items joined; an id is never one in a good file
	}
	return "[object Object]"
}

func (r *reader) hours(v any, order []string, s *Settings) {
	m, ok := isObj(v)
	if !ok {
		r.add(`Add the opening hours ("openingHours") for each weekday, for example "mon": {"open": "10:00", "close": "20:00"}, or null for a closed day.`)
		return
	}
	r.unknownKeys(m, order, WeekdayKeys, "the opening hours")
	before := len(r.errs)
	anyOpen := false
	shown := map[string]any{}
	for i, day := range WeekdayKeys {
		h := m[day]
		shown[day] = nil
		if h == nil {
			continue
		}
		hm, ok := isObj(h)
		open, oOK := hm["open"].(string)
		cl, cOK := hm["close"].(string)
		if !ok || !oOK || !cOK {
			r.add(`The hours for %q must be {"open": "10:00", "close": "20:00"} or null when closed.`, day)
			continue
		}
		o, c := ParseClock(open), ParseClock(cl)
		switch {
		case o < 0 || c < 0:
			r.add(`The hours for %q must be written as 24-hour times like "10:00" or "20:30".`, day)
		case o >= c:
			r.add("On %q the opening time %s must be earlier than the closing time %s.", day, open, cl)
		default:
			s.OpeningHours[i] = &Hours{Open: o, Close: c, OpenText: open, CloseText: cl}
			shown[day] = map[string]any{"open": open, "close": cl}
			anyOpen = true
		}
	}
	if !anyOpen && len(r.errs) == before {
		r.add("The business is closed every day. Open it on at least one weekday.")
	}
	// the page's `hours`: WEEKDAY_KEYS order, as the TypeScript builds the object
	var b strings.Builder
	b.WriteByte('{')
	for i, day := range WeekdayKeys {
		if i > 0 {
			b.WriteByte(',')
		}
		v, _ := json.Marshal(shown[day])
		b.WriteString(`"` + day + `":` + string(v))
	}
	b.WriteByte('}')
	s.HoursJSON = json.RawMessage(b.String())
}

func (r *reader) deposit(v any, order []string, s *Settings) {
	m, ok := isObj(v)
	if !ok {
		r.add(`Add the deposit ("deposit"): the amount in rupees, for example {"amountInr": 200}.`)
		return
	}
	r.unknownKeys(m, order, []string{"amountInr", "holdMinutes"}, "the deposit")
	amount, aOK := r.whole(m["amountInr"], `the deposit amount ("deposit.amountInr")`, 1, 1_000_000)
	hold, hOK := int64(15), true
	if h, given := m["holdMinutes"]; given {
		hold, hOK = r.whole(h, `how long a slot is held ("deposit.holdMinutes")`, 1, 240)
	}
	if aOK && len(s.Services) > 0 {
		cheapest := s.Services[0].PriceInr
		for _, sv := range s.Services {
			cheapest = min(cheapest, sv.PriceInr)
		}
		if amount > cheapest {
			r.add("The deposit (₹%d) is more than the cheapest service (₹%d). Lower the deposit so it never exceeds a price.", amount, cheapest)
		}
	}
	if aOK && hOK {
		s.Deposit.AmountInr, s.Deposit.HoldMinutes = amount, hold
	}
}

func (r *reader) cancellation(v any, order []string, s *Settings) {
	m, ok := isObj(v)
	if !ok {
		r.add(`Add the cancellation rule ("cancellation"): {"windowHours": 24, "refundLimitInr": 200}.`)
		return
	}
	r.unknownKeys(m, order, []string{"windowHours", "refundLimitInr"}, "the cancellation rule")
	w, wOK := r.whole(m["windowHours"], `the cancellation window ("cancellation.windowHours")`, 0, 720)
	l, lOK := r.whole(m["refundLimitInr"], `the refund limit ("cancellation.refundLimitInr")`, 0, 1_000_000)
	if wOK && lOK {
		s.Cancellation.WindowHours, s.Cancellation.RefundLimitInr = w, l
	}
}

func (r *reader) owner(v any, order []string, s *Settings) {
	m, ok := isObj(v)
	if !ok {
		r.add(`Add the owner ("owner") with their WhatsApp number, for example {"whatsapp": "+919800000000"}.`)
		return
	}
	r.unknownKeys(m, order, []string{"whatsapp", "language"}, "the owner")
	w, wOK := m["whatsapp"].(string)
	if !wOK || !ownerRe.MatchString(w) {
		r.add(`The owner's WhatsApp number ("owner.whatsapp") must start with + and the country code, then digits only, for example +919800000000.`)
	}
	lv, given := m["language"]
	if !given {
		lv = "en"
	}
	lang, _ := lv.(string)
	if !contains(runtime.LANGUAGES, lang) {
		r.add(`The owner's language ("owner.language") must be one of %s.`, languageList())
		return
	}
	if wOK {
		s.Owner.Whatsapp, s.Owner.Language = w, lang
	}
}

func (r *reader) reminders(v any, order []string) []int64 {
	def := []int64{24, 2}
	if v == nil {
		return def
	}
	m, ok := isObj(v)
	if !ok {
		r.add(`The reminders ("reminders") must look like {"hoursBefore": [24, 2]}.`)
		return def
	}
	r.unknownKeys(m, order, []string{"hoursBefore"}, "the reminders")
	raw, given := m["hoursBefore"]
	if !given {
		return def
	}
	list, ok := raw.([]any)
	var out []int64
	for _, h := range list {
		n, whole := isWhole(h)
		if !whole || n < 1 || n > 168 {
			ok = false
		}
		out = append(out, n)
	}
	if !ok {
		r.add(`Reminder times ("reminders.hoursBefore") must be a list of whole hours before the booking, between 1 and 168, for example [24, 2].`)
		return def
	}
	seen := map[int64]bool{}
	for _, h := range out {
		if seen[h] {
			r.add(`A reminder time is listed twice in "reminders.hoursBefore".`)
			break
		}
		seen[h] = true
	}
	sort.Slice(out, func(i, j int) bool { return out[i] > out[j] })
	return out
}

// payment is providers/index.ts readPaymentSettings for the two modules there are (upi, razorpay), with their sentences.
func (r *reader) payment(v any, order, upiOrder []string, s *Settings) {
	examples := `{"module": "upi", "upi": {"id": "glowsalon@okicici", "payee": "Glow Salon"}} or {"module": "razorpay"}`
	if v == nil {
		r.add(`Add how customers pay ("payment"). UPI is the default: {"module": "upi", "upi": {"id": "glowsalon@okicici", "payee": "Glow Salon"}}, with the shop's own UPI ID and the name its customers see. A shop with its own gateway account names it instead: {"module": "razorpay"}.`)
		return
	}
	m, ok := isObj(v)
	if !ok {
		r.add(`The payment module ("payment") must look like %s.`, examples)
		return
	}
	switch m["module"] {
	case "razorpay":
		for _, k := range keysOf(m, order) {
			if k != "module" && k != "upi" {
				r.add(`I don't know what %q means in the payment module. Allowed: module, upi.`, k)
			}
		}
		if _, has := m["upi"]; has {
			r.add(`A Razorpay shop has no UPI ID in its settings: take out "payment.upi", or set "payment.module" to "upi".`)
			return
		}
		s.Payment = Payment{Module: "razorpay"}
	case "upi":
		for _, k := range keysOf(m, order) {
			if k != "module" && k != "upi" {
				r.add(`I don't know what %q means in the payment module. Allowed: module, upi.`, k)
			}
		}
		u, ok := isObj(m["upi"])
		if !ok {
			r.add(`A UPI shop needs its UPI ID and the payee name: "payment": {"module": "upi", "upi": {"id": "glowsalon@okicici", "payee": "Glow Salon"}}.`)
			return
		}
		for _, k := range keysOf(u, upiOrder) {
			if k != "id" && k != "payee" {
				r.add(`I don't know what %q means in "payment.upi". Allowed: id, payee.`, k)
			}
		}
		idIssue, payeeIssue := vpaProblem(u["id"]), payeeProblem(u["payee"])
		if idIssue != "" {
			r.add(`"payment.upi.id": %s`, idIssue)
		}
		if payeeIssue != "" {
			r.add(`"payment.upi.payee": %s`, payeeIssue)
		}
		if idIssue == "" && payeeIssue == "" {
			s.Payment = Payment{Module: "upi", UpiID: normaliseVpa(u["id"].(string)), Payee: language.TrimJS(u["payee"].(string))}
		}
	default:
		r.add(`The payment module %s is not one I know. Use "upi" or "razorpay": %s.`, jsJSON(m["module"]), examples)
	}
}

// normaliseVpa, vpaProblem and payeeProblem are modules/payments/providers/upi/link.ts's, with its sentences.
func normaliseVpa(v string) string { return strings.ToLower(language.TrimJS(v)) }

func vpaProblem(raw any) string {
	v, ok := raw.(string)
	if !ok || language.TrimJS(v) == "" {
		return "Add the shop's UPI ID, for example glowsalon@okicici."
	}
	n := normaliseVpa(v)
	if !strings.Contains(n, "@") {
		return fmt.Sprintf("\"%s\" is not a UPI ID: it needs an @ and the app's or bank's name after it, for example glowsalon@okicici.", language.TrimJS(v))
	}
	if !vpaRe.MatchString(n) {
		return fmt.Sprintf("\"%s\" is not a UPI ID. Before the @: letters, digits, dots, dashes or underscores (at least 2). After the @: the app's or bank's name, letters and digits, starting with a letter.", language.TrimJS(v))
	}
	return ""
}

func payeeProblem(raw any) string {
	n, ok := raw.(string)
	if !ok || language.TrimJS(n) == "" {
		return "Add the name the customer should see in their UPI app (the payee name), for example Glow Salon."
	}
	for _, c := range n {
		if unicode.IsControl(c) { // /[\p{Cc}\n\r\t]/u
			return "The payee name must be on one line."
		}
	}
	if len([]rune(language.TrimJS(n))) > 50 {
		return "The payee name is longer than 50 characters. Use the short name the shop's UPI app shows."
	}
	return ""
}
