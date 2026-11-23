package fees

// A Fees centre's settings.json, checked: the Go twin of templates/education/fees/src/settings.ts `validateSettings` (with src/classes/settings.ts readClasses and
// src/joining.ts parseJoined). Every problem is said in plain words, all at once, in the TypeScript's sentences and order, so a builder reads the same refusal from either
// runtime. The blocks every template shares (payment, approvers, assistant) are read by the shared readers (bookings.SettingsReader), with their sentences.
//
// Where Go and JavaScript differ: `.trim()` is language.TrimJS (JavaScript's white space); `toLowerCase()` is language.LowerJS; an object's keys are read in the order the file
// names them (Object.keys keeps insertion order, a Go map does not), from the file's bytes.

import (
	"fmt"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/GeometerLabs/agents/go/internal/bookings"
	"github.com/GeometerLabs/agents/go/internal/language"
	"github.com/GeometerLabs/agents/go/internal/runtime"
)

// Batch is one class or batch: what parents call it per language (the first name is the one the agent says) and the monthly fee in whole rupees.
type Batch struct {
	ID            string
	Names         map[string][]string
	MonthlyFeeInr int64
}

// BackDue is joining.ts BackDue: an earlier month still unpaid when the agent started.
type BackDue struct {
	Month     string
	AmountInr int64
}

// Student is settings.ts Student.
type Student struct {
	Name     string
	Parent   string
	BatchID  string
	Language string // "" when left out: the centre's first language
	Joined   string
	BackDues []BackDue
	Adult    bool
}

// ClassSlot is classes/settings.ts ClassSlot: Day 0 = Sunday.
type ClassSlot struct{ Day, Hour, Minute, Minutes int }

// Classes is classes/settings.ts ClassesSettings. Batches is the timetable's batch ids in the file's order (Object.entries).
type Classes struct {
	Timetable       map[string][]ClassSlot
	Batches         []string
	LinkLeadMinutes int64
	MaterialMaxMb   int64
	OldDuesStopLink bool
}

// Settings is a Fees centre's settings.json, checked.
type Settings struct {
	Name            string
	Address         string
	HasAddress      bool
	Timezone        string
	Loc             *time.Location
	Languages       []string
	Batches         []Batch
	Students        []Student
	Due             struct{ Day, GraceDays int64 }
	JoiningMidMonth string // "usual" when left out
	LateFeeInr      int64
	Reminders       struct {
		DaysFromDue       []int64 // sorted
		Hour, MaxPerMonth int64
	}
	PartPayments struct {
		Allowed bool
		MinInr  int64
	}
	WaiverLimitInr int64
	RefundLimitInr int64
	Payment        bookings.Payment
	Owner          struct{ Whatsapp, Language string }
	// Approvers and Assistant are the blocks as the shared readers hand them back, checked; nil when left out.
	Approvers map[string]any
	Assistant map[string]any
	Classes   *Classes
}

// OwnerMarked: a UPI centre, whose owner marks payments received (B33).
func (s *Settings) OwnerMarked() bool { return s.Payment.Module == "upi" }

// BatchByID is the batch with this id, or nil.
func (s *Settings) BatchByID(id string) *Batch {
	for i := range s.Batches {
		if s.Batches[i].ID == id {
			return &s.Batches[i]
		}
	}
	return nil
}

// BatchName is settings.ts batchName: the name the agent says in a language, falling back to the first language that has one.
func BatchName(b *Batch, lang string) string {
	for _, l := range []string{lang, "en", "hi", "ml", "kn"} {
		if n := b.Names[l]; len(n) > 0 {
			return n[0]
		}
	}
	return b.ID
}

// HighestDueInr is settings.ts highestDueInr: the dearest batch's fee with the late fee on top.
func (s *Settings) HighestDueInr() int64 {
	var most int64
	for _, b := range s.Batches {
		most = max(most, b.MonthlyFeeInr)
	}
	return most + s.LateFeeInr
}

var (
	phoneRe   = regexp.MustCompile(`^\+\d{10,15}$`)
	batchIDRe = regexp.MustCompile(`^[a-z0-9-]+$`)
	monthRe   = regexp.MustCompile(`^\d{4}-(0[1-9]|1[0-2])$`)
	joinedRe  = regexp.MustCompile(`^(\d{4})-(\d{2})-(\d{2})$`)
	clockRe   = regexp.MustCompile(`^(\d{1,2}):(\d{2})$`)
)

var languageNames = map[string]string{"en": "English", "hi": "Hindi", "ml": "Malayalam", "kn": "Kannada"}

// JoiningRules is joining.ts JOINING_RULES.
var JoiningRules = []string{"usual", "full", "prorata", "nextMonth"}

// BackDuesMax is joining.ts BACK_DUES_MAX.
const BackDuesMax = 12

func isObj(v any) (map[string]any, bool) { m, ok := v.(map[string]any); return m, ok }

func contains[T comparable](l []T, x T) bool {
	for _, y := range l {
		if y == x {
			return true
		}
	}
	return false
}

// DaysInMonth is joining.ts daysInMonth.
func DaysInMonth(year, month int) int {
	return time.Date(year, time.Month(month)+1, 0, 0, 0, 0, 0, time.UTC).Day()
}

// ParseJoined is joining.ts parseJoined: "2026-11-18" as a date, or ok=false when it is not a real date.
func ParseJoined(text string) (y, m, d int, ok bool) {
	g := joinedRe.FindStringSubmatch(text)
	if g == nil {
		return 0, 0, 0, false
	}
	y, _ = strconv.Atoi(g[1])
	m, _ = strconv.Atoi(g[2])
	d, _ = strconv.Atoi(g[3])
	return y, m, d, m >= 1 && m <= 12 && d >= 1 && d <= DaysInMonth(y, m)
}

// whole is settings.ts readWhole, with its optional reason.
func whole(r *bookings.SettingsReader, v any, label string, minV, maxV int64, why string) (int64, bool) {
	n, ok := bookings.IsWhole(v)
	if !ok {
		r.Add("Set %s as a whole number, for example %d.", label, max(minV, 1))
		return 0, false
	}
	if n < minV || n > maxV {
		tail := ""
		if why != "" {
			tail = " (" + why + ")"
		}
		r.Add("%s must be between %d and %d, not %d%s.", bookings.Capitalise(label), minV, maxV, n, tail)
		return 0, false
	}
	return n, true
}

// ReadSettings is validateSettings over settings.json as decoded; `raw` is the file's bytes (for the keys' order).
func ReadSettings(in map[string]any, raw []byte) (*Settings, []string) {
	r := bookings.NewSettingsReader(raw)
	s := &Settings{JoiningMidMonth: "usual"}
	r.UnknownKeys(in, "", []string{"name", "address", "timezone", "languages", "batches", "students", "due", "joiningMidMonth", "lateFeeInr", "reminders", "partPayments", "waiver", "refund", "payment", "owner", "approvers", "assistant", "classes"}, "the settings")
	name, ok := in["name"].(string)
	if !ok || language.TrimJS(name) == "" {
		r.Add(`Add the centre's name ("name").`)
	}
	s.Name = language.TrimJS(name)
	if a, given := in["address"]; given {
		if as, ok := a.(string); ok {
			s.Address, s.HasAddress = as, true
		} else {
			r.Add(`The address ("address") must be text.`)
		}
	}
	tzv, given := in["timezone"]
	if !given || tzv == nil {
		tzv = "Asia/Kolkata"
	}
	tz, _ := tzv.(string)
	if loc, err := time.LoadLocation(tz); err != nil || tz == "" || tz == "Local" {
		r.Add("The time zone %s is not one I know. Use a name like \"Asia/Kolkata\".", bookings.JSJSON(tzv))
	} else {
		s.Timezone, s.Loc = tz, loc
	}
	s.Languages = readLanguages(r, in["languages"])
	s.Batches = readBatches(r, in["batches"], s.Languages)
	ownerOK := readOwner(r, in["owner"], s)
	_ = ownerOK
	s.Students = readStudents(r, in["students"], s.Batches, s.Languages, s.Owner.Whatsapp)
	if j, given := in["joiningMidMonth"]; given && j != nil {
		js, _ := j.(string)
		if !contains(JoiningRules, js) {
			quoted := make([]string, len(JoiningRules))
			for i, x := range JoiningRules {
				quoted[i] = `"` + x + `"`
			}
			r.Add(`The rule for a student who joins mid-month ("joiningMidMonth") must be one of %s.`, strings.Join(quoted, ", "))
		} else {
			s.JoiningMidMonth = js
		}
	}
	var cheapest int64 = -1
	for _, b := range s.Batches {
		if cheapest < 0 || b.MonthlyFeeInr < cheapest {
			cheapest = b.MonthlyFeeInr
		}
	}
	readDue(r, in["due"], s)
	if lf, given := in["lateFeeInr"]; given {
		maxLate, why := int64(1_000_000), ""
		if cheapest >= 0 {
			maxLate, why = cheapest, fmt.Sprintf("a late fee is never more than the cheapest monthly fee (₹%d)", cheapest)
		}
		s.LateFeeInr, _ = whole(r, lf, `the late fee ("lateFeeInr")`, 0, maxLate, why)
	}
	readReminders(r, in["reminders"], s)
	readPartPayments(r, in["partPayments"], cheapest, s)
	waiverMax, waiverWhy := int64(1_000_000), ""
	if cheapest >= 0 {
		waiverMax, waiverWhy = cheapest, fmt.Sprintf("it is never more than the cheapest monthly fee (₹%d)", cheapest)
	}
	s.WaiverLimitInr, _ = readLimit(r, in["waiver"], hasKey(in, "waiver"), "waiver", `the waiver limit ("waiver.limitInr")`, waiverMax, waiverWhy, false)
	refund, refundOK := readLimit(r, in["refund"], hasKey(in, "refund"), "refund", `the refund limit ("refund.limitInr")`, 1_000_000, "", true)
	s.RefundLimitInr = refund
	// settings.ts readPayment: an empty block is read as no block (refused and asked for the UPI ID), never as the gateway (B71)
	pv, given := in["payment"], hasKey(in, "payment")
	if m, ok := isObj(pv); ok && len(m) == 0 {
		pv, given = nil, false
	}
	s.Payment = r.Payment(pv, given, "/payment")
	s.Approvers = r.Approvers(in["approvers"], hasKey(in, "approvers"), "/approvers", s.Owner.Whatsapp, refund, refundOK)
	if s.Approvers != nil {
		people, _ := s.Approvers["people"].([]any)
		for _, p := range people {
			pm, _ := p.(map[string]any)
			for _, st := range s.Students {
				if st.Parent == pm["whatsapp"] {
					r.Add(`approvers: %s's number is a parent's. A person who approves refunds answers from their own number, not a parent's.`, pm["id"])
					break
				}
			}
		}
	}
	s.Assistant = r.Assistant(in["assistant"], hasKey(in, "assistant"), "/assistant")
	s.Classes = readClasses(r, in["classes"], hasKey(in, "classes"), s.Batches)
	return s, r.Errors()
}

func hasKey(m map[string]any, k string) bool { _, ok := m[k]; return ok }

func languageList() string { return bookings.LanguageList() }

func readLanguages(r *bookings.SettingsReader, v any) []string {
	if v == nil {
		return []string{"hi", "en"}
	}
	list, ok := v.([]any)
	if !ok || len(list) == 0 {
		r.Add(`List at least one parent language ("languages"), for example ["hi", "en"].`)
		return []string{"hi", "en"}
	}
	var out []string
	for _, l := range list {
		ls, _ := l.(string)
		switch {
		case !contains(runtime.LANGUAGES, ls):
			r.Add("The language %s is not supported yet. Use one of %s.", bookings.JSJSON(l), languageList())
		case contains(out, ls):
			r.Add("The language %q is listed twice.", ls)
		default:
			out = append(out, ls)
		}
	}
	if len(out) == 0 {
		return []string{"hi", "en"}
	}
	return out
}

func readBatches(r *bookings.SettingsReader, v any, langs []string) []Batch {
	list, ok := v.([]any)
	if !ok || len(list) == 0 {
		r.Add(`Add at least one batch or class ("batches") with a name and a monthly fee in rupees.`)
		return nil
	}
	var out []Batch
	seenIDs := map[string]bool{}
	seenNames := map[string]string{}
	for i, raw := range list {
		obj, isO := isObj(raw)
		label := fmt.Sprintf("Batch number %d", i+1)
		if id, ok := obj["id"].(string); isO && ok {
			label = fmt.Sprintf("Batch %q", id)
		}
		if !isO {
			r.Add("%s must be an object with id, names and monthlyFeeInr.", label)
			continue
		}
		path := fmt.Sprintf("/batches/%d", i)
		r.UnknownKeys(obj, path, []string{"id", "names", "monthlyFeeInr"}, label)
		id, idOK := obj["id"].(string)
		switch {
		case !idOK || !batchIDRe.MatchString(id):
			r.Add(`%s needs an id made of lowercase letters, digits and dashes, for example "class-10".`, label)
		case seenIDs[id]:
			r.Add(`Two batches share the id %q. Each id must be different.`, id)
		default:
			seenIDs[id] = true
		}
		idText := jsString(obj["id"])
		names := map[string][]string{}
		if nm, ok := isObj(obj["names"]); !ok {
			r.Add(`%s needs "names": what parents call it, per language, for example {"en": ["Class 10"], "hi": ["कक्षा 10"]}.`, label)
		} else {
			r.UnknownKeys(nm, path+"/names", runtime.LANGUAGES, label+"'s names")
			for _, lang := range langs {
				l, isL := nm[lang].([]any)
				good := isL && len(l) > 0
				for _, n := range l {
					ns, isS := n.(string)
					good = good && isS && language.TrimJS(ns) != ""
				}
				if !good {
					r.Add(`%s needs at least one name in %s (%q), because parents can write in it.`, label, languageNames[lang], lang)
					continue
				}
				for _, n := range l {
					t := language.TrimJS(n.(string))
					names[lang] = append(names[lang], t)
					key := language.LowerJS(t)
					if other, seen := seenNames[key]; seen && other != idText {
						r.Add(`The name %q is used by both %q and %q, so the agent could not tell which one a parent means.`, t, other, idText)
					} else {
						seenNames[key] = idText
					}
				}
			}
		}
		fee, feeOK := bookings.IsWhole(obj["monthlyFeeInr"])
		if !feeOK || fee < 1 || fee > 1_000_000 {
			r.Add(`%s needs a monthly fee in whole rupees ("monthlyFeeInr"), for example 1500.`, label)
		}
		if idOK && feeOK && fee >= 1 && fee <= 1_000_000 {
			out = append(out, Batch{ID: id, Names: names, MonthlyFeeInr: fee})
		}
	}
	return out
}

// jsString is String(v) of a JSON value (a number as JavaScript writes it).
func jsString(v any) string {
	switch x := v.(type) {
	case string:
		return x
	case float64:
		return strconv.FormatFloat(x, 'f', -1, 64)
	case nil:
		return "undefined"
	case bool:
		return strconv.FormatBool(x)
	}
	return "[object Object]"
}

func readStudents(r *bookings.SettingsReader, v any, batches []Batch, langs []string, ownerNumber string) []Student {
	list, ok := v.([]any)
	if !ok || len(list) == 0 {
		r.Add(`Add the students ("students"), each with a name, the parent's WhatsApp number and the batch.`)
		return nil
	}
	var out []Student
	seen := map[string]bool{}
	batchOf := func(id any) *Batch {
		s, _ := id.(string)
		for i := range batches {
			if batches[i].ID == s {
				return &batches[i]
			}
		}
		return nil
	}
	for i, raw := range list {
		obj, isO := isObj(raw)
		label := fmt.Sprintf("Student number %d", i+1)
		if n, ok := obj["name"].(string); isO && ok {
			label = fmt.Sprintf("Student %q", n)
		}
		if !isO {
			r.Add("%s must be an object with name, parent and batch.", label)
			continue
		}
		r.UnknownKeys(obj, fmt.Sprintf("/students/%d", i), []string{"name", "parent", "batch", "language", "joined", "backDues", "adult"}, label)
		name := ""
		if n, ok := obj["name"].(string); ok {
			name = language.TrimJS(n)
		}
		if name == "" {
			r.Add(`%s needs a name ("name").`, label)
		}
		parent, parentIsS := obj["parent"].(string)
		switch {
		case !parentIsS || !phoneRe.MatchString(parent):
			r.Add(`%s needs the parent's WhatsApp number ("parent"), starting with + and the country code, then digits only, for example +919800000000.`, label)
		case parent == ownerNumber:
			r.Add(`%s: the parent's number is the owner's. The owner's number is for the owner's replies, not for a parent.`, label)
		}
		b := batchOf(obj["batch"])
		if b == nil {
			r.Add(`%s needs a batch ("batch") that is one of the ids in "batches".`, label)
		}
		lang := ""
		if lv, given := obj["language"]; given && lv != nil {
			ls, _ := lv.(string)
			if !contains(runtime.LANGUAGES, ls) || !contains(langs, ls) {
				quoted := make([]string, len(langs))
				for i, l := range langs {
					quoted[i] = `"` + l + `"`
				}
				r.Add(`%s's language ("language") must be one of the centre's languages: %s.`, label, strings.Join(quoted, ", "))
			} else {
				lang = ls
			}
		}
		joined := ""
		if jv, given := obj["joined"]; given && jv != nil {
			js, isS := jv.(string)
			if _, _, _, ok := ParseJoined(js); !isS || !ok {
				r.Add(`%s's joining day ("joined") must be a real date written like 2026-11-18.`, label)
			}
			if isS {
				joined = js
			}
		}
		backs := readBackDues(r, obj["backDues"], hasKey(obj, "backDues"), label, b)
		adult := false
		if av, given := obj["adult"]; given && av != nil {
			ab, isB := av.(bool)
			if !isB {
				r.Add(`%s's "adult" must be true or false.`, label)
			}
			adult = isB && ab
		}
		if name != "" && parentIsS {
			key := parent + "|" + language.LowerJS(name)
			if seen[key] {
				r.Add("%s is listed twice for the same parent number.", label)
			}
			seen[key] = true
		}
		if name != "" && parentIsS && phoneRe.MatchString(parent) && b != nil {
			out = append(out, Student{Name: name, Parent: parent, BatchID: b.ID, Language: lang, Joined: joined, BackDues: backs, Adult: adult})
		}
	}
	return out
}

func readBackDues(r *bookings.SettingsReader, v any, given bool, label string, b *Batch) []BackDue {
	if !given || v == nil {
		return nil
	}
	list, ok := v.([]any)
	if !ok || len(list) > BackDuesMax {
		r.Add(`%s's earlier unpaid months ("backDues") must be a list of at most %d, each like {"month": "2026-09", "amountInr": 1500}.`, label, BackDuesMax)
		return nil
	}
	var top int64 = 1_000_000
	if b != nil {
		top = b.MonthlyFeeInr
	}
	var out []BackDue
	for _, item := range list {
		m, isO := isObj(item)
		month, monthOK := m["month"].(string)
		amount, amountOK := bookings.IsWhole(m["amountInr"])
		if !isO || !monthOK || !monthRe.MatchString(month) || !amountOK || amount < 1 || amount > top {
			r.Add(`%s has an earlier unpaid month ("backDues") that is not like {"month": "2026-09", "amountInr": 1500} (the amount is whole rupees, at most the batch's monthly fee).`, label)
			continue
		}
		dup := false
		for _, x := range out {
			dup = dup || x.Month == month
		}
		if dup {
			r.Add(`%s lists the earlier month %s twice in "backDues".`, label, month)
		} else {
			out = append(out, BackDue{Month: month, AmountInr: amount})
		}
	}
	return out
}

func readDue(r *bookings.SettingsReader, v any, s *Settings) {
	m, ok := isObj(v)
	if !ok {
		r.Add(`Add when the fee is due ("due"): {"day": 5, "graceDays": 5}.`)
		return
	}
	r.UnknownKeys(m, "/due", []string{"day", "graceDays"}, "the due rule")
	day, dayOK := whole(r, m["day"], `the due day ("due.day")`, 1, 28, "days after the 28th are not in every month")
	var grace int64
	graceOK := true
	if g, given := m["graceDays"]; given {
		grace, graceOK = whole(r, g, `the grace days ("due.graceDays")`, 0, 30, "")
	}
	if dayOK && graceOK {
		s.Due.Day, s.Due.GraceDays = day, grace
	}
}

func readReminders(r *bookings.SettingsReader, v any, s *Settings) {
	if v == nil {
		s.Reminders.DaysFromDue, s.Reminders.Hour, s.Reminders.MaxPerMonth = []int64{-3, 0, 5}, 10, 3
		return
	}
	m, ok := isObj(v)
	if !ok {
		r.Add(`The reminders ("reminders") must look like {"daysFromDue": [-3, 0, 5], "hour": 10, "maxPerMonth": 3}.`)
		return
	}
	r.UnknownKeys(m, "/reminders", []string{"daysFromDue", "hour", "maxPerMonth"}, "the reminders")
	var list any = []any{-3.0, 0.0, 5.0}
	if l, given := m["daysFromDue"]; given && l != nil {
		list = l
	}
	var days []int64
	l, isL := list.([]any)
	good := isL && len(l) > 0
	for _, d := range l {
		n, w := bookings.IsWhole(d)
		good = good && w && n >= -14 && n <= 60
	}
	daysOK := false
	if !good {
		r.Add(`Reminder days ("reminders.daysFromDue") must be a list of whole days from the due day, between -14 and 60, for example [-3, 0, 5]: three days before, on the day and five days after.`)
	} else {
		seen := map[int64]bool{}
		dup := false
		for _, d := range l {
			n, _ := bookings.IsWhole(d)
			dup = dup || seen[n]
			seen[n] = true
			days = append(days, n)
		}
		if dup {
			r.Add(`A reminder day is listed twice in "reminders.daysFromDue".`)
		} else {
			sort.Slice(days, func(i, j int) bool { return days[i] < days[j] })
			daysOK = true
		}
	}
	hour, hourOK := int64(10), true
	if h, given := m["hour"]; given && h != nil {
		hour, hourOK = whole(r, h, `the reminder hour ("reminders.hour")`, 6, 21, "")
	}
	var most int64 = 3
	if daysOK {
		most = int64(len(days))
	}
	mostOK := true
	if mp, given := m["maxPerMonth"]; given && mp != nil {
		most, mostOK = whole(r, mp, `the most reminders a month ("reminders.maxPerMonth")`, 1, 12, "")
	}
	if daysOK && hourOK && mostOK {
		s.Reminders.DaysFromDue, s.Reminders.Hour, s.Reminders.MaxPerMonth = days, hour, most
	}
}

func readPartPayments(r *bookings.SettingsReader, v any, cheapest int64, s *Settings) {
	minFallback := int64(100)
	if cheapest >= 0 {
		minFallback = min(100, cheapest)
	}
	if v == nil {
		s.PartPayments.Allowed, s.PartPayments.MinInr = true, minFallback
		return
	}
	m, ok := isObj(v)
	if !ok {
		r.Add(`The part payments ("partPayments") must look like {"allowed": true, "minInr": 100}.`)
		return
	}
	r.UnknownKeys(m, "/partPayments", []string{"allowed", "minInr"}, "the part payments")
	if a, given := m["allowed"]; given && a != nil {
		if _, isB := a.(bool); !isB {
			r.Add(`"partPayments.allowed" must be true or false.`)
		}
	}
	minInr, minOK := minFallback, true
	if mv, given := m["minInr"]; given && mv != nil {
		top, why := int64(1_000_000), ""
		if cheapest >= 0 {
			top, why = cheapest, fmt.Sprintf("it is never more than the cheapest monthly fee (₹%d)", cheapest)
		}
		minInr, minOK = whole(r, mv, `the least a part payment may be ("partPayments.minInr")`, 1, top, why)
	}
	if minOK {
		s.PartPayments.Allowed, s.PartPayments.MinInr = m["allowed"] != false, minInr
	}
}

// readLimit is settings.ts readLimit: a waiver limit left out is 0; a refund limit is required.
func readLimit(r *bookings.SettingsReader, v any, given bool, key, label string, top int64, why string, required bool) (int64, bool) {
	if (!given || v == nil) && !required {
		return 0, true
	}
	m, ok := isObj(v)
	if !ok {
		example := 500
		if key == "waiver" {
			example = 0
		}
		r.Add(`Add the %s limit (%q): {"limitInr": %d}.`, key, key, example)
		return 0, false
	}
	r.UnknownKeys(m, "/"+key, []string{"limitInr"}, "the "+key+" limit")
	return whole(r, m["limitInr"], label, 0, top, why)
}

func readOwner(r *bookings.SettingsReader, v any, s *Settings) bool {
	m, ok := isObj(v)
	if !ok {
		r.Add(`Add the owner ("owner") with their WhatsApp number, for example {"whatsapp": "+919800000000"}.`)
		return false
	}
	r.UnknownKeys(m, "/owner", []string{"whatsapp", "language"}, "the owner")
	w, wOK := m["whatsapp"].(string)
	if !wOK || !phoneRe.MatchString(w) {
		r.Add(`The owner's WhatsApp number ("owner.whatsapp") must start with + and the country code, then digits only, for example +919800000000.`)
	}
	lv, given := m["language"]
	if !given || lv == nil {
		lv = "en"
	}
	lang, _ := lv.(string)
	if !contains(runtime.LANGUAGES, lang) {
		r.Add(`The owner's language ("owner.language") must be one of %s.`, languageList())
		return false
	}
	if wOK && phoneRe.MatchString(w) {
		s.Owner.Whatsapp, s.Owner.Language = w, lang
		return true
	}
	return false
}

var dayNames = []string{"sun", "mon", "tue", "wed", "thu", "fri", "sat"}
var longDays = map[string]int{"sunday": 0, "monday": 1, "tuesday": 2, "wednesday": 3, "thursday": 4, "friday": 5, "saturday": 6, "tues": 2, "thur": 4, "thurs": 4}

// dayNumber is classes/settings.ts dayNumber: "mon", "Monday" or 1, or -1.
func dayNumber(v any) int {
	if n, ok := bookings.IsWhole(v); ok && n >= 0 && n <= 6 {
		return int(n)
	}
	s, ok := v.(string)
	if !ok {
		return -1
	}
	t := language.LowerJS(language.TrimJS(s))
	for i, d := range dayNames {
		if d == t {
			return i
		}
	}
	if d, ok := longDays[t]; ok {
		return d
	}
	return -1
}

// parseClock is core/time.ts parseClock: "17:00" as minutes since midnight, or -1.
func parseClock(text string) int {
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

// readClasses is classes/settings.ts readClasses; nil: the centre has no Classes.
func readClasses(r *bookings.SettingsReader, v any, given bool, batches []Batch) *Classes {
	if !given || v == nil {
		return nil
	}
	m, ok := isObj(v)
	if !ok {
		r.Add(`The classes block ("classes") must look like {"timetable": {"class-10": [{"day": "mon", "time": "17:00", "minutes": 60}]}}.`)
		return nil
	}
	for _, k := range r.Keys(m, "/classes") {
		if !contains([]string{"timetable", "linkLeadMinutes", "materialMaxMb", "oldDuesStopLink"}, k) {
			r.Add(`I don't know what %q means in the classes block. Allowed: timetable, linkLeadMinutes, materialMaxMb, oldDuesStopLink.`, k)
		}
	}
	c := &Classes{Timetable: map[string][]ClassSlot{}, LinkLeadMinutes: 30, MaterialMaxMb: 10}
	tt, ttOK := isObj(m["timetable"])
	if !ttOK || len(tt) == 0 {
		r.Add(`Add the timetable ("classes.timetable"): for each batch id, a list of classes like {"day": "mon", "time": "17:00", "minutes": 60}.`)
	} else {
		for _, batchID := range r.Keys(tt, "/classes/timetable") {
			raw := tt[batchID]
			known := false
			for _, b := range batches {
				known = known || b.ID == batchID
			}
			if !known {
				r.Add(`The timetable names the batch %q, which is not one of the batches.`, batchID)
				continue
			}
			list, isL := raw.([]any)
			if !isL || len(list) == 0 || len(list) > 14 {
				r.Add(`The timetable of %q must be a list of 1 to 14 weekly classes.`, batchID)
				continue
			}
			var slots []ClassSlot
			for i, item := range list {
				where := fmt.Sprintf(`Class number %d of %q`, i+1, batchID)
				im, isO := isObj(item)
				if !isO {
					r.Add(`%s must look like {"day": "mon", "time": "17:00", "minutes": 60}.`, where)
					continue
				}
				for _, k := range r.Keys(im, fmt.Sprintf("/classes/timetable/%s/%d", batchID, i)) {
					if k != "day" && k != "time" && k != "minutes" {
						r.Add(`I don't know what %q means in %s. Allowed: day, time, minutes.`, k, where)
					}
				}
				day := dayNumber(im["day"])
				clock := -1
				if ts, isS := im["time"].(string); isS {
					clock = parseClock(ts)
				}
				var minutesV any = 60.0
				if mv, given := im["minutes"]; given {
					minutesV = mv
				}
				minutes, minOK := bookings.IsWhole(minutesV)
				minOK = minOK && minutes >= 10 && minutes <= 240
				if day < 0 {
					r.Add(`%s needs a day ("day"): mon, tue, wed, thu, fri, sat or sun.`, where)
				}
				if clock < 0 {
					r.Add(`%s needs a start time ("time") like "17:00" (24-hour clock).`, where)
				}
				if !minOK {
					r.Add(`%s: the length ("minutes") must be a whole number from 10 to 240.`, where)
				}
				if day >= 0 && clock >= 0 && minOK {
					dup := false
					for _, s := range slots {
						dup = dup || (s.Day == day && s.Hour*60+s.Minute == clock)
					}
					if dup {
						r.Add(`%s is listed twice (same day and time).`, where)
					} else {
						slots = append(slots, ClassSlot{Day: day, Hour: clock / 60, Minute: clock % 60, Minutes: int(minutes)})
					}
				}
			}
			c.Timetable[batchID] = slots
			c.Batches = append(c.Batches, batchID)
		}
	}
	var lead any = 30.0
	if l, given := m["linkLeadMinutes"]; given {
		lead = l
	}
	if n, ok := bookings.IsWhole(lead); !ok || n < 5 || n > 180 {
		r.Add(`The minutes before a class when its link is sent ("classes.linkLeadMinutes") must be a whole number from 5 to 180.`)
	} else {
		c.LinkLeadMinutes = n
	}
	if n, ok := bookings.IsWhole(lead); ok && (n < 5 || n > 180) {
		c.LinkLeadMinutes = n // TypeScript keeps a whole number even when it is refused (`isWhole(lead) ? lead : 30`); the settings are refused anyway
	}
	var mb any = 10.0
	if x, given := m["materialMaxMb"]; given {
		mb = x
	}
	if n, ok := bookings.IsWhole(mb); !ok || n < 1 || n > 100 {
		r.Add(`The largest reading-material file ("classes.materialMaxMb") must be a whole number of megabytes from 1 to 100.`)
	} else {
		c.MaterialMaxMb = n
	}
	if o, given := m["oldDuesStopLink"]; given && o != nil {
		ob, isB := o.(bool)
		if !isB {
			r.Add(`Whether an old due stops the class link ("classes.oldDuesStopLink") must be true or false.`)
		}
		c.OldDuesStopLink = isB && ob
	}
	return c
}

// isFinite guards a JSON number read as a float.
func isFinite(f float64) bool { return !math.IsInf(f, 0) && !math.IsNaN(f) }

var _ = isFinite
