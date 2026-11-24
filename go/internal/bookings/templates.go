package bookings

// Every message the Bookings agent sends, per language: the Go twin of templates/commerce/bookings/src/language/templates.ts (`render`, MessageFacts), check.ts (`checkMessage`)
// and the owner's day list. The words are GENERATED, never retyped: words/<lang>.json.gz is written by go/scripts/gen_bookings_words.ts, which renders each TypeScript template with
// probe facts and turns each probe back into a `{slot}` named after the fact it reads; this file only fills the slots. Dates, times, rupees and phone numbers are written by
// internal/language (format.go, FormatInr), shared with Orders and Fees.
//
// A message whose record lacks a fact it needs is refused with the TypeScript's own sentence (`need`), naming the first fact missing in the order the message reads. The generator
// finds which facts a message needs by taking each away from the real function, and checks that the slots it wrote name exactly those.
//
// Where Go and JavaScript differ: a count is written with strconv (String(n) of a whole number), a rupee amount with language.FormatInr; the English capital of a name opening a
// sentence is language.SentenceStart (JavaScript's toUpperCase of the first unit).

import (
	"compress/gzip"
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/GeometerLabs/agents/go/internal/language"
)

//go:embed words/en.json.gz words/hi.json.gz words/ml.json.gz words/kn.json.gz
var wordsFS embed.FS

// part is a stretch of a message: fixed words (slot == "") or the value of a slot.
type part struct{ lit, slot string }

// MetaWord is one WhatsApp template in one language (meta-templates.ts MetaTemplate): the name registered with Meta, the message whose wording it carries and the body with `{slot}`s.
type MetaWord struct {
	Name     string `json:"name"`
	UsedFor  string `json:"usedFor"`
	Audience string `json:"audience"`
	Body     string `json:"body"`
}

// Words is one language's pack. Unpacked once per process per language, the first time a shop needs it.
type Words struct {
	Lang string            `json:"lang"`
	T    map[string]string `json:"t"`
	Day  struct {
		Heading map[string]string `json:"heading"`
		None    map[string]string `json:"none"`
		Row     string            `json:"row"`
	} `json:"day"`
	Meta      []MetaWord        `json:"meta"`
	MetaSlots map[string]string `json:"metaSlots"` // a WhatsApp slot's name to the message slot that fills it
	Labels    map[string]string `json:"labels"`
	Limits    struct {
		Buttons, ButtonTitle, Rows, RowTitle, RowDescription, ListButton, Body, ID int
	} `json:"limits"`
	// Generic are templates.ts TEMPLATE_NAMES: the names a message that is none of the approved templates goes out under (the same in every language).
	Generic struct {
		Customer string `json:"customer"`
		Reminder string `json:"reminder"`
		Owner    string `json:"owner"`
	} `json:"generic"`
	parts map[string][]part
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
	f, err := wordsFS.Open("words/" + lang + ".json.gz")
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

// ServicePrice is a service with its list price, named in the conversation's language (MessageFacts.services).
type ServicePrice struct {
	Name     string
	PriceInr int64
}

// DayBooking is one booking on the owner's day list (MessageFacts.dayBookings).
type DayBooking struct {
	SlotMs                     int64
	ServiceName, CustomerPhone string
	Ref                        string
}

// MessageFacts is templates.ts MessageFacts: the values of this conversation's record a message may use. A fact the record does not have is nil, and a message that needs it is not
// written. The outgoing check reads the same object.
type MessageFacts struct {
	Language     string
	Loc          *time.Location
	BusinessName string
	Services     []ServicePrice

	ServiceName, Link, PageLink, BookingRef, CustomerPhone, ApprovalCode, UpiID, Payee, UpiCode, Partner *string
	PriceInr, DepositInr, RefundInr, MarkedInr, LeftInr                                                  *int64
	SlotMs                                                                                               *int64
	HoldMinutes, WindowHours, ApprovalHours, ApprovalsLeft, UpcomingCount                                *int64
	// OfferedInr and DiscountCode are E1's (the discount authority, 24 Nov 2026): the price of one the customer asked for (PriceInr stays the list price) and the owner's card's code.
	OfferedInr   *int64
	DiscountCode *string
	// AskerPhone is the number (or chat guest) that asked about a booking from another conversation (25 Nov 2026, runtime/caseasked.go); only in a message to the owner.
	AskerPhone *string
	// PaidAtMs and UpiNote are a UPI refund's payment (25 Nov 2026, ownermarked.RefundSource): the day the owner marked it and the note it carried.
	PaidAtMs *int64
	UpiNote  *string
	// SlotChoices are the free times a list message offers (each date and time in the message must be one of these, or the booking's own).
	SlotChoices []int64
	// Day is "today" or "tomorrow" ("" is today), with DayBookings the owner's day list.
	Day         string
	DayBookings []DayBooking
}

// S and N make a pointer to a text or a whole number: a fact the record has.
func S(v string) *string { return &v }

// N: see S.
func N(v int64) *int64 { return &v }

// MissingFact is templates.ts `need`'s error: the record lacks a fact the message needs.
type MissingFact struct{ Key string }

func (e *MissingFact) Error() string {
	return fmt.Sprintf(`The message needs "%s" from the record, and the record does not have it.`, e.Key)
}

func needS(v *string, key string) (string, error) {
	if v == nil {
		return "", &MissingFact{key}
	}
	return *v, nil
}

func needN(v *int64, key string) (int64, error) {
	if v == nil {
		return 0, &MissingFact{key}
	}
	return *v, nil
}

// value is the text of a slot, or the refusal when its fact is missing.
func (f *MessageFacts) value(name string) (string, error) {
	fm := language.Formats(f.Language)
	rupees := func(v *int64, key string) (string, error) {
		n, err := needN(v, key)
		if err != nil {
			return "", err
		}
		return language.FormatInr(float64(n)), nil
	}
	count := func(v *int64, key string) (string, error) {
		n, err := needN(v, key)
		return strconv.FormatInt(n, 10), err
	}
	switch name {
	case "businessName":
		return f.BusinessName, nil
	case "serviceName":
		return needS(f.ServiceName, "serviceName")
	case "Service":
		v, err := needS(f.ServiceName, "serviceName")
		return language.SentenceStart(v, f.Language), err
	case "slot":
		ms, err := needN(f.SlotMs, "slotMs")
		if err != nil {
			return "", err
		}
		return fm.Slot(ms, f.zone()), nil
	case "priceInr":
		return rupees(f.PriceInr, name)
	case "depositInr":
		return rupees(f.DepositInr, name)
	case "refundInr":
		return rupees(f.RefundInr, name)
	case "markedInr":
		return rupees(f.MarkedInr, name)
	case "leftInr":
		return rupees(f.LeftInr, name)
	case "holdMinutes":
		return count(f.HoldMinutes, name)
	case "windowHours":
		return count(f.WindowHours, name)
	case "approvalHours":
		return count(f.ApprovalHours, name)
	case "approvalsLeft":
		return count(f.ApprovalsLeft, name)
	case "upcomingCount":
		return count(f.UpcomingCount, name)
	case "customerPhone":
		v, err := needS(f.CustomerPhone, name)
		return language.GroupPhone(v), err
	case "customerPhoneRaw":
		return needS(f.CustomerPhone, "customerPhone")
	case "link":
		return needS(f.Link, name)
	case "pageLink":
		return needS(f.PageLink, name)
	case "bookingRef":
		return needS(f.BookingRef, name)
	case "approvalCode":
		return needS(f.ApprovalCode, name)
	case "upiId":
		return needS(f.UpiID, name)
	case "payee":
		return needS(f.Payee, name)
	case "upiCode":
		return needS(f.UpiCode, name)
	case "partner":
		return needS(f.Partner, name)
	case "offeredInr":
		return rupees(f.OfferedInr, name)
	case "discountCode":
		return needS(f.DiscountCode, name)
	case "askerPhone":
		v, err := needS(f.AskerPhone, name)
		return language.GroupPhone(v), err
	case "paidDate":
		ms, err := needN(f.PaidAtMs, "paidAtMs")
		if err != nil {
			return "", err
		}
		return fm.SlotDate(ms, f.zone()), nil
	case "upiNote":
		return needS(f.UpiNote, name)
	case "menuList":
		// templates.ts menuList: each service and its price, joined with ", "
		names := make([]string, len(f.Services))
		for i, s := range f.Services {
			names[i] = s.Name + " " + language.FormatInr(float64(s.PriceInr))
		}
		return strings.Join(names, ", "), nil
	}
	panic("the packed words name a slot this code does not know: " + name) // the generator and this file are one change
}

func (f *MessageFacts) zone() *time.Location {
	if f.Loc == nil {
		return time.UTC
	}
	return f.Loc
}

// Render is templates.ts render: one message from the record. It returns a *MissingFact when the record lacks something the message needs, and an error for an id that is no template.
func Render(id string, f *MessageFacts) (string, error) {
	w := WordsFor(f.Language)
	if id == "owner_day_bookings" {
		return w.dayList(f), nil
	}
	ps, ok := w.parts[id]
	if !ok {
		return "", fmt.Errorf("there is no message %q", id)
	}
	var b strings.Builder
	for _, p := range ps {
		if p.slot == "" {
			b.WriteString(p.lit)
			continue
		}
		v, err := f.value(p.slot)
		if err != nil {
			return "", err
		}
		b.WriteString(v)
	}
	return b.String(), nil
}

// dayList is templates.ts dayList: a heading that names the day, then one short line per booking (the time, the service and the customer's number); no bookings is one line.
func (w *Words) dayList(f *MessageFacts) string {
	day := f.Day
	if day != "tomorrow" {
		day = "today"
	}
	if len(f.DayBookings) == 0 {
		return w.Day.None[day]
	}
	fm := language.Formats(f.Language)
	lines := []string{w.Day.Heading[day]}
	for _, r := range f.DayBookings {
		lines = append(lines, strings.NewReplacer("{time}", fm.SlotTime(r.SlotMs, f.zone()), "{service}", r.ServiceName, "{phone}", language.GroupPhone(r.CustomerPhone)).Replace(w.Day.Row))
	}
	return strings.Join(lines, "\n")
}

// CheckMessage is check.ts checkMessage: a final message against the facts of its conversation. The problems are in plain words and none means the message may go.
func CheckMessage(text string, f *MessageFacts) []string {
	return language.CheckText(text, checkFactsOf(f))
}

// checkFactsOf is check.ts checkFactsOf: the lists the check reads, made from a booking conversation's facts. The customer's number may be written grouped, so both forms of every
// number are literals.
func checkFactsOf(f *MessageFacts) language.Facts {
	var out language.Facts
	for _, v := range []*int64{f.PriceInr, f.DepositInr, f.RefundInr, f.MarkedInr, f.LeftInr, f.OfferedInr} {
		if v != nil {
			out.AmountsInr = append(out.AmountsInr, float64(*v))
		}
	}
	for _, s := range f.Services {
		out.AmountsInr = append(out.AmountsInr, float64(s.PriceInr))
	}
	for _, v := range []*int64{f.HoldMinutes, f.WindowHours, f.ApprovalHours, f.UpcomingCount, f.ApprovalsLeft} {
		if v != nil {
			out.Counts = append(out.Counts, float64(*v))
		}
	}
	out.ShownMs = f.SlotMs
	out.MomentsMs = append(out.MomentsMs, f.SlotChoices...)
	for _, d := range f.DayBookings {
		out.MomentsMs = append(out.MomentsMs, d.SlotMs)
	}
	if f.PaidAtMs != nil {
		out.MomentsMs = append(out.MomentsMs, *f.PaidAtMs) // 25 Nov 2026: the day a UPI refund's payment was marked
	}
	out.Loc = f.zone()
	for _, l := range []*string{f.Link, f.PageLink} {
		if l != nil && *l != "" {
			out.Links = append(out.Links, *l)
		}
	}
	lits := []*string{&f.BusinessName, f.ServiceName, f.BookingRef, f.CustomerPhone, f.AskerPhone, f.UpiNote, f.ApprovalCode, f.UpiID, f.Payee, f.UpiCode, f.Partner, f.DiscountCode}
	for _, l := range lits {
		if l != nil {
			out.Literals = append(out.Literals, *l)
		}
	}
	if f.CustomerPhone != nil {
		out.Literals = append(out.Literals, language.GroupPhone(*f.CustomerPhone))
	}
	if f.AskerPhone != nil {
		out.Literals = append(out.Literals, language.GroupPhone(*f.AskerPhone))
	}
	for _, s := range f.Services {
		out.Literals = append(out.Literals, s.Name)
	}
	for _, d := range f.DayBookings {
		out.Literals = append(out.Literals, d.ServiceName, d.CustomerPhone, language.GroupPhone(d.CustomerPhone), d.Ref)
	}
	return out
}

// ExampleFacts is meta-templates.ts exampleFacts: example values for Meta's review, a believable booking in the template's own language.
func ExampleFacts(s *Settings, lang string) *MessageFacts {
	f := &MessageFacts{Language: lang, Loc: s.Loc, BusinessName: s.Name}
	for i := range s.Services {
		f.Services = append(f.Services, ServicePrice{ServiceName(&s.Services[i], lang), s.Services[i].PriceInr})
	}
	f.ServiceName, f.PriceInr = S(ServiceName(&s.Services[0], lang)), N(s.Services[0].PriceInr)
	f.DepositInr, f.RefundInr = N(s.Deposit.AmountInr), N(s.Deposit.AmountInr)
	f.SlotMs = N(time.Date(2026, 11, 10, 12, 30, 0, 0, time.UTC).UnixMilli()) // Tue 10 Nov 2026, 6:00 pm in India
	f.Link, f.HoldMinutes, f.WindowHours = S("https://rzp.io/i/example"), N(s.Deposit.HoldMinutes), N(s.Cancellation.WindowHours)
	f.BookingRef, f.CustomerPhone, f.ApprovalCode, f.ApprovalHours, f.ApprovalsLeft = S("b-3"), S("+919811111111"), S("K7M2QX"), N(24), N(1)
	f.UpiID, f.Payee, f.UpiCode, f.MarkedInr, f.LeftInr = S("glowsalon@okicici"), S(s.Name), S("P4XR9T"), N(s.Deposit.AmountInr), N(s.Deposit.AmountInr)
	f.Partner, f.UpcomingCount = S("Divya, Sri Sai Digital"), N(3)
	f.OfferedInr, f.DiscountCode = N(s.Services[0].PriceInr-50), S("Q7RM2X") // E1: meta-templates.ts exampleFacts' price asked and card code
	// 25 Nov 2026: exampleFacts' asker and refund payment
	f.AskerPhone, f.PaidAtMs, f.UpiNote = S("+919822222222"), N(time.Date(2026, 11, 3, 6, 0, 0, 0, time.UTC).UnixMilli()), S("b-3")
	return f
}
