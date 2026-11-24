// Package words is the Go twin of the Orders agent's customer-facing words: templates/commerce/orders/src/language/templates.ts (every message, in English, Hindi, Malayalam and
// Kannada, with the plan messages of src/plans/templates.ts), meta-templates.ts (the WhatsApp templates), interactive.ts (the labels, buttons and lists), check.ts (the outgoing
// check's facts) and limits.ts checkMessageMatchesRecord. The words are GENERATED, never retyped: <lang>.json.gz is written by go/scripts/gen_orders_words.ts, which renders each
// TypeScript template with probe facts and turns each probe back into a `{slot}` named after the fact it reads; this package only fills the slots. Dates, times, rupees are written
// by internal/language (format.go, FormatInr), shared with Bookings and Fees. See Explanation.md for how the TypeScript maps to the files here.
//
// The package imports nothing of Orders (the Orders runtime imports it) and nothing of Bookings.
package words

import (
	"compress/gzip"
	"embed"
	"encoding/json"
	"io"
	"regexp"
	"strings"
	"sync"
)

//go:embed en.json.gz hi.json.gz ml.json.gz kn.json.gz
var wordsFS embed.FS

// part is a stretch of a message: fixed words (slot == "") or the value of a slot.
type part struct{ lit, slot string }

// MetaWord is one WhatsApp template in one language (meta-templates.ts MetaTemplate): the name registered with Meta, the message whose wording it carries, who it is for, and the
// body with `{slot}`s (the slot names are the TypeScript's own: {items}, {when}, {how} ...).
type MetaWord struct {
	Name     string `json:"name"`
	UsedFor  string `json:"usedFor"`
	Audience string `json:"audience"`
	Body     string `json:"body"`
}

// Composites are the wording of the values that are a small rule over several facts rather than one fact: the order's window, the cut-off, how it is collected, what is left to pay,
// where to pay and the UPI shop's closing sentence. Each is found by asking the TypeScript helper itself (the generator), so the Go side only fills the named holes.
type Composites struct {
	When         string `json:"when"`         // "{fromDate}, {fromTime} to {toTime}" (the window's wording is the language's)
	CutAt        string `json:"cutAt"`        // "{cutDate}, {cutTime}"
	HowPickup    string `json:"howPickup"`    // "pickup"
	HowDelivery  string `json:"howDelivery"`  // "delivery to {area}"
	RestPaid     string `json:"restPaid"`     // "Paid in full."
	RestPickup   string `json:"restPickup"`   // "{balanceInr} is to pay on pickup."
	RestDelivery string `json:"restDelivery"` // "{balanceInr} is to pay on delivery."
	PayToUpi     string `json:"payToUpi"`     // "{link} (UPI ID {upiId}, {payee})"
	UpiNote      string `json:"upiNote"`      // the sentence a UPI shop's message ends with
}

// Example holds the constants of meta-templates.ts exampleFacts (what is written in the function, not what is read from the shop's settings).
type Example struct {
	Address       string `json:"address"`
	Link          string `json:"link"`
	OrderRef      string `json:"orderRef"`
	CustomerPhone string `json:"customerPhone"`
	ApprovalCode  string `json:"approvalCode"`
	ApprovalHours int64  `json:"approvalHours"`
	ApprovalsLeft int64  `json:"approvalsLeft"`
	UpiCode       string `json:"upiCode"`
	Partner       string `json:"partner"`
	UpcomingCount int64  `json:"upcomingCount"`
	LeftInr       int64  `json:"leftInr"`
	Mode          string `json:"mode"`
	DefaultArea   string `json:"defaultArea"`
	ItemsText     string `json:"itemsText"` // "2 × {item}"
	Qty           int64  `json:"qty"`
	Meals         int64  `json:"meals"`
	Date          [3]int `json:"date"`       // the order's day: year, month, day
	CutoffDate    [3]int `json:"cutoffDate"` // the day before it, at the shop's cut-off time
	PlanToDate    [3]int `json:"planToDate"` // the plan's last day
	// E1: the owner's card's code, and how much below the item's price the example's price asked is
	DiscountCode string `json:"discountCode"`
	OfferedLess  int64  `json:"offeredLess"`
	// 25 Nov 2026: the number that asked about an order, and a UPI refund's payment: its note, its day and the time of day it was marked
	AskerPhone string `json:"askerPhone"`
	UpiNote    string `json:"upiNote"`
	PaidDate   [3]int `json:"paidDate"`
	PaidClock  string `json:"paidClock"`
}

// Words is one language's pack. Unpacked once per process per language, the first time a shop needs it.
type Words struct {
	Lang      string            `json:"lang"`
	T         map[string]string `json:"t"`
	C         Composites        `json:"c"`
	Meta      []MetaWord        `json:"meta"`
	MetaSlots map[string]string `json:"metaSlots"` // a WhatsApp slot's name to the message slot that fills it
	Labels    map[string]string `json:"labels"`
	Limits    struct {
		Buttons, ButtonTitle, Rows, RowTitle, RowDescription, ListButton, Body, ID int
	} `json:"limits"`
	IDs     map[string]string `json:"ids"`     // interactive.ts ID: the id each button carries
	MarkIDs map[string]string `json:"markIds"` // owner-marked MARK_BUTTON: the prefix of the owner's mark buttons' ids
	RowIDs  struct {
		Item string `json:"item"`
		Slot string `json:"slot"`
	} `json:"rowIds"`
	SlotTitle string `json:"slotTitle"` // "{from} – {to}"
	// Generic are templates.ts TEMPLATE_NAMES: the names a message that is none of the approved templates goes out under (the same in every language).
	Generic struct {
		Customer string `json:"customer"`
		Owner    string `json:"owner"`
	} `json:"generic"`
	Example Example `json:"example"`
	parts   map[string][]part
}

var (
	wordsMu    sync.Mutex
	wordsCache = map[string]*Words{}
	slotRe     = regexp.MustCompile(`\{([A-Za-z]+)\}`)
)

// WordsFor is the pack of a language ("en", "hi", "ml", "kn"); an unknown language is English (a shop's settings never name another).
func WordsFor(lang string) *Words {
	if lang != "hi" && lang != "ml" && lang != "kn" {
		lang = "en"
	}
	wordsMu.Lock()
	defer wordsMu.Unlock()
	if w, ok := wordsCache[lang]; ok {
		return w
	}
	f, err := wordsFS.Open(lang + ".json.gz")
	if err != nil {
		panic("the packed words are missing: " + lang) // embedded at build time, so this is a build fault
	}
	defer f.Close()
	z, err := gzip.NewReader(f)
	if err != nil {
		panic(err)
	}
	raw, err := io.ReadAll(z)
	if err != nil {
		panic(err)
	}
	w := &Words{parts: map[string][]part{}}
	if err := json.Unmarshal(raw, w); err != nil {
		panic("the packed words are not readable: " + err.Error())
	}
	for id, text := range w.T {
		w.parts[id] = splitSlots(text)
	}
	wordsCache[lang] = w
	return w
}

// TemplateIDs are the ids of every message (templates.ts TemplateId), for a test or a caller that walks them (the order is not the TypeScript's: a map has none).
func TemplateIDs() []string {
	w := WordsFor("en")
	out := make([]string, 0, len(w.T))
	for id := range w.T {
		out = append(out, id)
	}
	return out
}

// HasTemplate reports whether id is a message.
func HasTemplate(id string) bool { _, ok := WordsFor("en").T[id]; return ok }

// splitSlots cuts a message into its fixed words and its slots.
func splitSlots(text string) []part {
	var out []part
	at := 0
	for _, m := range slotRe.FindAllStringSubmatchIndex(text, -1) {
		if m[0] > at {
			out = append(out, part{lit: text[at:m[0]]})
		}
		out = append(out, part{slot: text[m[2]:m[3]]})
		at = m[1]
	}
	if at < len(text) {
		out = append(out, part{lit: text[at:]})
	}
	return out
}

// fill writes a pattern ("{fromDate}, {fromTime} to {toTime}") with the values of its named holes, in one pass (a value that looks like a hole is left as it is).
func fill(pattern string, kv ...string) string {
	return strings.NewReplacer(kv...).Replace(pattern)
}
