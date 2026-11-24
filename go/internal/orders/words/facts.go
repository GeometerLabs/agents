package words

// Every message the Orders agent sends: the Go twin of templates.ts `render` and MessageFacts. A message is its text with `{slot}`s (generated, words.go) and this file fills them from
// the order's facts. A message whose record lacks a fact it needs is refused with the TypeScript's own sentence (`need`), naming the FIRST fact missing in the order the message reads
// (slots are filled left to right, as the TypeScript's template literal is evaluated; inside a composite value the order is the helper's: {when} asks for the window's start and
// then its end, {how} for the mode and then the area, {rest} for the balance and then the mode, {payTo} for the link and then, on a UPI shop, the payee).
//
// Where Go and JavaScript differ: a count is written with strconv (String(n) of a whole number); a rupee amount with language.FormatInr (toLocaleString "en-IN"); a UPI ID that is the
// empty string is "no UPI shop" (JavaScript's `f.upiId ?` is false for ""), and `dateMs ?? slotFromMs` falls back only when dateMs is absent (nil), as `??` does.

import (
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/GeometerLabs/agents/go/internal/language"
)

// MenuPrice is one item of the menu with its price, named in the conversation's language (MessageFacts.menu).
type MenuPrice struct {
	Name     string `json:"name"`
	PriceInr int64  `json:"priceInr"`
}

// Window is a time window, as instants (slotChoices; the same shape the lists take).
type Window struct {
	FromMs int64 `json:"fromMs"`
	ToMs   int64 `json:"toMs"`
}

// PlanFacts is plans/templates.ts PlanFacts: how many meals, and the period's first and last day (as instants). A member that is nil is a fact the record does not have.
type PlanFacts struct {
	Meals  *int64 `json:"meals,omitempty"`
	FromMs *int64 `json:"fromMs,omitempty"`
	ToMs   *int64 `json:"toMs,omitempty"`
}

// MessageFacts is templates.ts MessageFacts: the values of this order's record that a message may use. The member names are the TypeScript's, capitalised, and the JSON tags are
// the TypeScript's own member names, so a JSON object of facts decodes straight into it.
//
// HOW THE LEAD FILLS IT: Language, TimeZone, BusinessName and Menu are always set (Menu may be empty: the menu list is then ""). Every other member is OPTIONAL and means "the record
// has this fact" only when it is non-nil: set a pointer with S (text) or N (whole number) for a fact the order has, leave it nil for one it does not (a message that needs it is then
// refused). Whole rupees, instants (epoch milliseconds) and counts are *int64. Areas and Quantities are "absent" when nil (an empty non-nil Areas is a shop with no places: the
// message is written with an empty list). Mode is "pickup" or "delivery". UpiID set (and not "") makes the message a UPI shop's: the link is followed by the UPI ID and the payee
// and the message ends with the UPI sentence; leave it nil for a gateway shop. DateMs is the order's day at midnight; when it is nil the day is read from SlotFromMs.
type MessageFacts struct {
	Language     string      `json:"language"`
	TimeZone     string      `json:"timeZone"`
	BusinessName string      `json:"businessName"`
	Menu         []MenuPrice `json:"menu"`

	ItemsText  *string `json:"itemsText,omitempty"`  // the order's lines as words, "2 × Veg thali, 1 × Curd"
	Quantities []int64 `json:"quantities,omitempty"` // the quantities they hold (the outgoing check does not read them)
	ItemName   *string `json:"itemName,omitempty"`   // one item, for a message about it
	PriceInr   *int64  `json:"priceInr,omitempty"`
	LeftCount  *int64  `json:"leftCount,omitempty"` // how many of that item are left for the day

	TotalInr   *int64 `json:"totalInr,omitempty"`
	AdvanceInr *int64 `json:"advanceInr,omitempty"`
	BalanceInr *int64 `json:"balanceInr,omitempty"` // the total less the advance
	RefundInr  *int64 `json:"refundInr,omitempty"`

	DateMs      *int64   `json:"dateMs,omitempty"`      // the order's day at midnight
	SlotFromMs  *int64   `json:"slotFromMs,omitempty"`  // its window
	SlotToMs    *int64   `json:"slotToMs,omitempty"`    //
	CutoffMs    *int64   `json:"cutoffMs,omitempty"`    // the moment orders for it close
	SlotChoices []Window `json:"slotChoices,omitempty"` // the windows a list message offers

	Mode    *string  `json:"mode,omitempty"`    // "pickup" or "delivery"
	Area    *string  `json:"area,omitempty"`    // the place in the delivery list the address named
	Address *string  `json:"address,omitempty"` // the customer's address, only ever in a message to the owner
	Areas   []string `json:"areas,omitempty"`   // the places the shop delivers to

	Link          *string `json:"link,omitempty"` // the payment link
	HoldMinutes   *int64  `json:"holdMinutes,omitempty"`
	WindowHours   *int64  `json:"windowHours,omitempty"`
	MaxItems      *int64  `json:"maxItems,omitempty"`
	OrderRef      *string `json:"orderRef,omitempty"`
	CustomerPhone *string `json:"customerPhone,omitempty"` // written as it is in the record (Orders does not group it)
	ApprovalCode  *string `json:"approvalCode,omitempty"`
	ApprovalHours *int64  `json:"approvalHours,omitempty"`
	ApprovalsLeft *int64  `json:"approvalsLeft,omitempty"`

	UpiID         *string `json:"upiId,omitempty"` // a UPI shop's UPI ID
	Payee         *string `json:"payee,omitempty"`
	UpiCode       *string `json:"upiCode,omitempty"`
	MarkedInr     *int64  `json:"markedInr,omitempty"`
	LeftInr       *int64  `json:"leftInr,omitempty"`
	Partner       *string `json:"partner,omitempty"`
	UpcomingCount *int64  `json:"upcomingCount,omitempty"`

	Plan *PlanFacts `json:"plan,omitempty"` // monthly plans: only plan messages carry it

	// E1, the discount authority (24 Nov 2026): the price of one the customer asked for (PriceInr stays the menu price) and the owner's card's code
	OfferedInr   *int64  `json:"offeredInr,omitempty"`
	DiscountCode *string `json:"discountCode,omitempty"`

	// 25 Nov 2026: the number (or chat guest) that asked about an order from another conversation (runtime/caseasked.go), only in a message to the owner; and a UPI refund's
	// payment (ownermarked.RefundSource): the day the owner marked it and the note it carried
	AskerPhone *string `json:"askerPhone,omitempty"`
	PaidAtMs   *int64  `json:"paidAtMs,omitempty"`
	UpiNote    *string `json:"upiNote,omitempty"`
}

// S makes a pointer to a text: a fact the record has.
func S(v string) *string { return &v }

// N makes a pointer to a whole number: a fact the record has.
func N(v int64) *int64 { return &v }

// MissingFact is templates.ts `need`'s error: the record lacks a fact the message needs (Key is the member's name, "plan.meals" for a plan's).
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

var zones sync.Map // name -> *time.Location

// loc is the shop's time zone (localParts' zone). An unknown name is an error: the TypeScript's Intl throws a RangeError, and a shop's settings are checked at setup.
func (f *MessageFacts) loc() (*time.Location, error) {
	if l, ok := zones.Load(f.TimeZone); ok {
		return l.(*time.Location), nil
	}
	l, err := time.LoadLocation(f.TimeZone)
	if err != nil {
		return nil, fmt.Errorf("invalid time zone: %q", f.TimeZone)
	}
	zones.Store(f.TimeZone, l)
	return l, nil
}

// zone is the time zone for the outgoing check: UTC when the name is unknown (the message was refused at Render already).
func (f *MessageFacts) zone() *time.Location {
	if l, err := f.loc(); err == nil {
		return l
	}
	return time.UTC
}

// moment is a date or a clock time of an instant in the shop's zone: kind "date" is format.ts formatDate over localParts, "time" is formatTime.
func (f *MessageFacts) moment(kind string, ms int64) (string, error) {
	l, err := f.loc()
	if err != nil {
		return "", err
	}
	fm := language.Formats(f.Language)
	if kind == "date" {
		return fm.SlotDate(ms, l), nil
	}
	return fm.SlotTime(ms, l), nil
}

func (f *MessageFacts) rupees(v *int64, key string) (string, error) {
	n, err := needN(v, key)
	if err != nil {
		return "", err
	}
	return language.FormatInr(float64(n)), nil
}

func count(v *int64, key string) (string, error) {
	n, err := needN(v, key)
	return strconv.FormatInt(n, 10), err
}

// plan is plans/templates.ts `plan`: the plan's facts, or a refusal naming "plan" or "plan.<member>".
func (f *MessageFacts) plan(key string) (int64, error) {
	if f.Plan == nil {
		return 0, &MissingFact{"plan"}
	}
	var v *int64
	switch key {
	case "meals":
		v = f.Plan.Meals
	case "fromMs":
		v = f.Plan.FromMs
	case "toMs":
		v = f.Plan.ToMs
	}
	if v == nil {
		return 0, &MissingFact{"plan." + key}
	}
	return *v, nil
}

// value is the text of a slot, or the refusal when a fact it reads is missing.
func (f *MessageFacts) value(w *Words, name string) (string, error) {
	switch name {
	case "businessName":
		return f.BusinessName, nil
	case "menuList": // templates.ts menuList: each item and its price, joined with ", "
		items := make([]string, len(f.Menu))
		for i, m := range f.Menu {
			items[i] = m.Name + " " + language.FormatInr(float64(m.PriceInr))
		}
		return strings.Join(items, ", "), nil
	case "itemsText":
		return needS(f.ItemsText, name)
	case "itemName":
		return needS(f.ItemName, name)
	case "address":
		return needS(f.Address, name)
	case "orderRef":
		return needS(f.OrderRef, name)
	case "customerPhone":
		return needS(f.CustomerPhone, name)
	case "askerPhone":
		return needS(f.AskerPhone, name)
	case "paidNote": // the fact upiNote ("upiNote" is the words' UPI sentence)
		return needS(f.UpiNote, "upiNote")
	case "paidDate": // templates.ts paidDate: the day a UPI refund's payment was marked, "Tue 3 Nov"
		if f.PaidAtMs == nil {
			return "", &MissingFact{"paidAtMs"}
		}
		return f.moment("date", *f.PaidAtMs)
	case "approvalCode":
		return needS(f.ApprovalCode, name)
	case "upiCode":
		return needS(f.UpiCode, name)
	case "payee":
		return needS(f.Payee, name)
	case "partner":
		return needS(f.Partner, name)
	case "link":
		return needS(f.Link, name)
	case "areas": // places: need(f, "areas").join(", ")
		if f.Areas == nil {
			return "", &MissingFact{"areas"}
		}
		return strings.Join(f.Areas, ", "), nil
	case "priceInr":
		return f.rupees(f.PriceInr, name)
	case "totalInr":
		return f.rupees(f.TotalInr, name)
	case "advanceInr":
		return f.rupees(f.AdvanceInr, name)
	case "balanceInr":
		return f.rupees(f.BalanceInr, name)
	case "refundInr":
		return f.rupees(f.RefundInr, name)
	case "markedInr":
		return f.rupees(f.MarkedInr, name)
	case "leftInr":
		return f.rupees(f.LeftInr, name)
	case "offeredInr":
		return f.rupees(f.OfferedInr, name)
	case "discountCode":
		return needS(f.DiscountCode, name)
	case "leftCount":
		return count(f.LeftCount, name)
	case "holdMinutes":
		return count(f.HoldMinutes, name)
	case "windowHours":
		return count(f.WindowHours, name)
	case "maxItems":
		return count(f.MaxItems, name)
	case "approvalHours":
		return count(f.ApprovalHours, name)
	case "approvalsLeft":
		return count(f.ApprovalsLeft, name)
	case "upcomingCount":
		return count(f.UpcomingCount, name)
	case "meals":
		n, err := f.plan("meals")
		return strconv.FormatInt(n, 10), err
	case "planFrom", "planTo": // dayAt over the plan's first or last day: "Mon 16 Nov"
		key := "fromMs"
		if name == "planTo" {
			key = "toMs"
		}
		ms, err := f.plan(key)
		if err != nil {
			return "", err
		}
		return f.moment("date", ms)
	case "day": // templates.ts day: the day of the order, dateMs ?? the window's start
		var ms int64
		if f.DateMs != nil {
			ms = *f.DateMs
		} else {
			var err error
			if ms, err = needN(f.SlotFromMs, "slotFromMs"); err != nil {
				return "", err
			}
		}
		return f.moment("date", ms)
	case "when": // templates.ts when: "Thu 12 Nov, 12:00 pm to 1:00 pm"
		from, err := needN(f.SlotFromMs, "slotFromMs")
		if err != nil {
			return "", err
		}
		to, err := needN(f.SlotToMs, "slotToMs")
		if err != nil {
			return "", err
		}
		d, err := f.moment("date", from)
		if err != nil {
			return "", err
		}
		a, _ := f.moment("time", from)
		b, _ := f.moment("time", to)
		return fill(w.C.When, "{fromDate}", d, "{fromTime}", a, "{toTime}", b), nil
	case "cutAt": // templates.ts cutAt: "Wed 11 Nov, 8:00 pm"
		ms, err := needN(f.CutoffMs, "cutoffMs")
		if err != nil {
			return "", err
		}
		d, err := f.moment("date", ms)
		if err != nil {
			return "", err
		}
		t, _ := f.moment("time", ms)
		return fill(w.C.CutAt, "{cutDate}", d, "{cutTime}", t), nil
	case "how": // templates.ts how: "pickup" or "delivery to Kakkanad"
		mode, err := needS(f.Mode, "mode")
		if err != nil {
			return "", err
		}
		if mode == "pickup" {
			return w.C.HowPickup, nil
		}
		area, err := needS(f.Area, "area")
		if err != nil {
			return "", err
		}
		return fill(w.C.HowDelivery, "{area}", area), nil
	case "rest": // templates.ts rest: nothing left to pay, or what is paid on collection or delivery
		left, err := needN(f.BalanceInr, "balanceInr")
		if err != nil {
			return "", err
		}
		mode, err := needS(f.Mode, "mode")
		if err != nil {
			return "", err
		}
		if left == 0 {
			return w.C.RestPaid, nil
		}
		pattern := w.C.RestDelivery
		if mode == "pickup" {
			pattern = w.C.RestPickup
		}
		return fill(pattern, "{balanceInr}", language.FormatInr(float64(left))), nil
	case "payTo": // templates.ts payTo: the link, and on a UPI shop the UPI ID and the payee after it
		link, err := needS(f.Link, "link")
		if err != nil {
			return "", err
		}
		if !f.isUpi() {
			return link, nil
		}
		payee, err := needS(f.Payee, "payee")
		if err != nil {
			return "", err
		}
		return fill(w.C.PayToUpi, "{link}", link, "{upiId}", *f.UpiID, "{payee}", payee), nil
	case "upiNote":
		if f.isUpi() {
			return w.C.UpiNote, nil
		}
		return "", nil
	}
	panic("the packed words name a slot this code does not know: " + name) // the generator and this file are one change
}

// isUpi is JavaScript's truthiness of f.upiId: set and not the empty string.
func (f *MessageFacts) isUpi() bool { return f.UpiID != nil && *f.UpiID != "" }

// Render is templates.ts render: one message from the record. It returns a *MissingFact when the record lacks something the message needs, and an error for an id that is no
// message. The facts are not changed.
func Render(id string, f *MessageFacts) (string, error) {
	w := WordsFor(f.Language)
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
		v, err := f.value(w, p.slot)
		if err != nil {
			return "", err
		}
		b.WriteString(v)
	}
	return b.String(), nil
}
