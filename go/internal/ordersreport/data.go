// The Orders monthly report as plain data, counted from the action record: templates/commerce/orders/report/data.ts (`buildOrdersReport`, `stopsIn`, the types) and, for a shop with plans,
// templates/commerce/orders/src/plans/report.ts (plans.go). Nothing here is estimated: every number is a count of record entries (or a sum of amounts the record itself kept); what the
// record cannot tell is listed as "not counted".
//
// The report is a TREE that is sealed (report.Seal digests and signs its canonical JSON), so the Go value `Report` has one `Tree()` (tree.go) that builds the same key set as the TypeScript
// object, leaving a key out exactly where the TypeScript leaves it out with a spread (`innovator`, `paidBy`, `accounting`, `plans`, `money.balanceCollected`, `money.settledByWord`,
// `money.booksOnly`) and writing an explicit null where the TypeScript has null (`preparedBy`, `period.month`, `anchor`).
//
// Where Go and JavaScript differ, and what this file copies:
//   - JavaScript Sets and Maps keep insertion order; Go maps do not. Where the order shows (the sold items follow the MENU's order, the record's by-action counts are sorted by the page) it
//     is rebuilt from a list; the sets used only for their size are Go maps;
//   - `x ?? y` and `=== undefined` are presence, `if (x)` is truthiness (an empty text is false): `e.booking &&` is "not nil and not empty", refs are looked up with the two-value form;
//   - `Number(text)` is accounting.JSNumber, and `Number(undefined)` is NaN (a missing balance amount still counts the line, adds nothing);
//   - a money sum is whole paise (int64): a ref that is not a whole number (the runtime writes none) is cut to one, see Deferred.md.
package ordersreport

import (
	"fmt"
	"math"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/accounting"
	"github.com/GeometerLabs/agents/go/internal/bookingsreport"
	"github.com/GeometerLabs/agents/go/internal/report"
	"github.com/GeometerLabs/agents/go/internal/zone"
)

const formatReport = "geometer-orders-report/1"

// Pathway is `pathway`: the agent's name and version (the template's package.json version).
type Pathway = bookingsreport.Pathway

// DefaultPathway is PATHWAY: "orders" and the version in templates/commerce/orders/package.json at the time the words were generated.
func DefaultPathway() Pathway { return loadWords().Facts.Pathway }

// OrderLine is one line of an order: the menu item and how many.
type OrderLine struct {
	ItemID string
	Qty    int
}

// Order is what data.ts reads of the conversation store's orders (src/order.ts Order): its id, its state, the day it is for, pickup or delivery, its lines, what it came to and what the
// advance was (whole rupees, 0 when not set: the TypeScript reads `?? 0`), whether the balance was already marked received (`balance.paid` set), and how many steps wait for the owner. The
// Orders runtime converts its own orders into this.
type Order struct {
	ID      string
	State   string // "confirmed" and "completed" are the ones the report counts as sold
	Pending int    // len(order.pending): kept for the lead's use; the report does not read it
	// Date is the day the order is for; nil when none was fixed.
	Date        *zone.Date
	Mode        string // "pickup", "delivery" or ""
	Lines       []OrderLine
	TotalInr    int64
	AdvanceInr  int64
	BalancePaid bool
}

// Input is ReportInput. From and To are epoch milliseconds, the month being [From, To). Entries is the whole record, oldest first.
type Input struct {
	Settings Settings
	Entries  []accounting.Entry
	Orders   []Order
	From, To int64
	Source   string
	MadeAt   int64
	// PreparedBy is who set the agent up as the caller wrote it; nil is the TypeScript's undefined, written as null.
	PreparedBy *string
	Innovator  bool
	// GoLive is what the report was told about the go-live checks; nil: none was given.
	GoLive *report.GoLiveFinding
	// LedgerTenant is the shop's id on the server: the report is anchored to the head of the record. nil: the anchor is null.
	LedgerTenant *string
}

// SoldItem is one menu item sold in the month, with its name in each of the four languages.
type SoldItem struct {
	ID    string
	Names map[string]string
	Qty   int
}

// Report is data.ts OrdersReport.
type Report struct {
	Pathway    Pathway
	Source     string
	ShopName   string
	TimeZone   string
	Languages  []string
	OwnerLang  string
	PreparedBy *string
	Innovator  bool
	Period     report.ReportPeriod
	From, To   string // period.from, period.to (ISO)
	MadeAt     string
	PolicyDig  string
	Record     struct {
		Entries  int
		Digest   string
		ByAction map[string]map[string]int
	}
	Money struct {
		Collected, GivenBack accounting.Amount
		BalanceCollected     *accounting.Amount // nil: none (left out of the tree)
		SettledByWord        []report.SettledRow
		BooksOnly            *accounting.BooksOnly
	}
	// PaidBy is "owner-marked" for a UPI shop (B33) and "" otherwise (left out of the tree).
	PaidBy string
	Orders struct{ Taken, Completed, Cancelled, HoldsRanOut int }
	Sold   struct {
		Orders, Pickup, Delivery int
		Items                    []SoldItem
		ToCollect                accounting.Amount
	}
	Owner     struct{ Asked, Approved, Denied int }
	Customers struct{ Stopped int }
	Stopped   struct {
		Total  int
		ByRule map[string]int
	}
	Messages    struct{ ToOwner, HeldBack int }
	Unconfirmed struct{ Open int }
	NotCounted  []string
	NotTested   []string
	GoLive      report.GoLiveFinding
	Accounting  *accounting.ReportAccountingData
	// Plans is nil for a shop without plans (the block is then left out of the tree and the page).
	Plans  *PlansReport
	Anchor *bookingsreport.LedgerHead
}

// UPI says whether the money is the owner's marks (paidBy).
func (r *Report) UPI() bool { return r.PaidBy == "owner-marked" }

// messageActions is MESSAGES: the actions that are a message going out (a reply to a voice note is one too).
var messageActions = []string{"send_message", "voice_note_reply"}

// checkSites is CHECK_SITES: the recorded steps that check an order or an address.
var checkSites = []string{"check_order", "check_address"}

// stopSites is STOP_SITES: the entries a rule's "block" is counted at (a rule is checked at more than one place, and an entry that merely carries its decision is not a stop).
var stopSites = map[string][]string{
	"price-at-or-above-menu":     messageActions,
	"order-size":                 messageActions,
	"within-stock":               {"check_order", "send_message", "voice_note_reply"},
	"within-day-cap":             {"check_order", "send_message", "voice_note_reply"},
	"before-cutoff":              {"check_order", "send_message", "voice_note_reply"},
	"within-delivery-area":       {"check_address", "send_message", "voice_note_reply"},
	"confirm-only-when-recorded": messageActions,
	"one-advance-per-order":      {"record_payment"},
	"refund-limit":               {"refund", "owner_decision"},
	"message-matches-record":     messageActions,
	"opt-out":                    messageActions,
}

func has(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

// RuleIDs is RULE_IDS and NotCounted is NOT_COUNTED, as the TypeScript lists them.
func RuleIDs() []string    { return loadWords().Facts.RuleIDs }
func NotCounted() []string { return loadWords().Facts.NotCounted }

// Sources is SOURCES (what the numbers were counted from).
func Sources() []string { return loadWords().Facts.Sources }

// truthy is the TypeScript's `e.booking &&`: a booking id that is there and not empty.
func bookingOf(e accounting.Entry) (string, bool) {
	if e.Booking != nil && *e.Booking != "" {
		return *e.Booking, true
	}
	return "", false
}

// addTo is `add(a, paise)`: the line is counted, and its amount is added when it is a finite number (`Number(undefined)` is NaN: not added). The amount is whole paise.
func addTo(a *accounting.Amount, ref string, present bool) {
	a.Count++
	if !present {
		return
	}
	if n := accounting.JSNumber(ref); !math.IsNaN(n) && !math.IsInf(n, 0) {
		a.Paise += int64(n)
	}
}

// stopsIn is stopsIn: what the limits stopped, one entry at a time. A rule is counted at the entries stopSites names for it, and when a message repeats a decision that the step before it
// (a check_order or check_address of the same conversation) already stopped, that is the same stop and it is not counted again.
func stopsIn(month []accounting.Entry) (int, map[string]int) {
	byRule := map[string]int{}
	for _, id := range RuleIDs() {
		byRule[id] = 0
	}
	total := 0
	justChecked := map[string]map[string]bool{} // conversation -> the rules the previous entry's check stopped
	for _, e := range month {
		blocked := map[string]bool{}
		for _, d := range report.DecisionsOf(e) {
			// a rule the report does not list is not one of the shop's limits (the licence's `subscription_suspended`): it is never counted as a limit that held
			if sites, ok := stopSites[d.RuleID]; d.Verdict == "block" && ok && has(sites, e.Action) {
				blocked[d.RuleID] = true
			}
		}
		before := justChecked[e.Conversation]
		delete(justChecked, e.Conversation)
		if has(checkSites, e.Action) {
			justChecked[e.Conversation] = blocked
		} else if has(messageActions, e.Action) && before != nil {
			for r := range before {
				delete(blocked, r)
			}
		}
		if len(blocked) == 0 {
			continue
		}
		total++
		for r := range blocked {
			byRule[r]++
		}
	}
	return total, byRule
}

// BuildOrdersReport is buildOrdersReport(input). The errors are the TypeScript's sentences (a period that ends before it starts, a source it does not know) and the ledger's.
func BuildOrdersReport(in Input) (*Report, error) {
	shop, err := ShopOf(in.Settings)
	if err != nil {
		return nil, err
	}
	from, to := in.From, in.To
	goLive := report.GoLiveFinding{Status: "none"}
	if in.GoLive != nil {
		goLive = *in.GoLive
	}
	if !(from < to) {
		return nil, fmt.Errorf("The report period must end after it starts.")
	}
	if !has(Sources(), in.Source) {
		return nil, fmt.Errorf("Say what the numbers were counted from: %s.", strings.Join(Sources(), ", "))
	}
	// nothing after the period can matter; a time that does not parse is NaN, and NaN < to is false (report.SplitMonth)
	all, month := report.SplitMonth(in.Entries, from, to)

	r := &Report{}

	// ---- money: read from the books (internal/accounting): the journal is the record read as double-entry lines, and the month's figures are sums over it ----
	// For a UPI shop the owner's marks are the payment record, and a refund counts once the owner marks it sent; the journal reads both. The advance a payment brought is counted once per
	// payment, a refund once per refund id, and a refund a person settled by their word is not money given back (it is counted on its own below).
	upi := !ConfirmsAutomatically(shop)
	fromIso, toIso := report.ISOOf(from), report.ISOOf(to)
	legacy := Legacy()
	figures := accounting.FiguresOf(accounting.BuildJournal(all, legacy), all, legacy, fromIso, toIso, accounting.FigureOptions{RefundAmountFromPayment: true, OwnerMarks: &upi})
	r.Money.BooksOnly = accounting.BooksOnlyOf(figures)
	r.Accounting = accounting.ReportAccounting(all, legacy, fromIso, toIso)
	r.Money.Collected = figures.Received
	r.Money.GivenBack = accounting.Amount{Count: figures.Refunds.Count, Paise: figures.Refunds.Paise}
	balance := accounting.Amount{}
	for _, e := range month {
		if e.Action == "record_balance" && e.Outcome == "confirmed" {
			ref, ok := e.Refs["balancePaise"]
			addTo(&balance, ref, ok)
		}
	}
	if balance.Count > 0 {
		r.Money.BalanceCollected = &balance
	}
	r.Money.SettledByWord, _ = report.SettledByWordOf(month) // a person's word, by who said it

	// ---- orders: each at its own confirmed entry, once per order ----
	bookingsOf := func(action string, entries []accounting.Entry) map[string]bool {
		out := map[string]bool{}
		for _, e := range entries {
			if b, ok := bookingOf(e); ok && e.Action == action && e.Outcome == "confirmed" {
				out[b] = true
			}
		}
		return out
	}
	everConfirmed := bookingsOf("confirm_order", all)
	r.Orders.Taken = len(bookingsOf("confirm_order", month))
	r.Orders.Completed = len(bookingsOf("complete_order", month))
	for b := range bookingsOf("cancel_order", month) {
		if everConfirmed[b] { // an enquiry or a hold given up before the advance was never an order taken
			r.Orders.Cancelled++
		}
	}
	r.Orders.HoldsRanOut = len(bookingsOf("release_stock", month))

	// ---- the owner's part: a request is counted once, whether it was a big order or a late cancellation, and however many entries it left ----
	asked := map[string]bool{}
	for _, e := range month {
		if e.Outcome == "held_for_owner" && (e.Action == "ask_owner" || e.Action == "refund") {
			booking := "null"
			if e.Booking != nil {
				booking = *e.Booking
			}
			pid, ok := e.Refs["paymentId"]
			if !ok {
				pid = fmt.Sprint(e.Seq)
			}
			asked[e.Action+"|"+booking+"|"+pid] = true
		}
	}
	r.Owner.Asked = len(asked)
	for _, e := range month {
		if e.Action == "owner_decision" && e.Outcome == "confirmed" {
			switch e.Refs["command"] {
			case "approve":
				r.Owner.Approved++
			case "deny":
				r.Owner.Denied++
			}
		}
	}

	// ---- what was sold and what is left to pay at pickup: the month's own orders, read when the report is made ----
	var ofMonth []Order
	for _, o := range in.Orders {
		if o.Date == nil || (o.State != "confirmed" && o.State != "completed") {
			continue
		}
		if day := zone.ZonedToMs(*o.Date, 0, 0, shop.Timezone); day >= from && day < to {
			ofMonth = append(ofMonth, o)
		}
	}
	qty := map[string]int{}
	for _, o := range ofMonth {
		for _, l := range o.Lines {
			qty[l.ItemID] += l.Qty
		}
	}
	r.Sold.Items = []SoldItem{}
	for _, it := range menuOf(in.Settings) {
		n, ok := qty[it.id]
		if !ok {
			continue
		}
		names := map[string]string{}
		for _, l := range loadWords().Facts.Languages {
			names[l] = itemName(it, l)
		}
		r.Sold.Items = append(r.Sold.Items, SoldItem{ID: it.id, Names: names, Qty: n})
	}
	for _, o := range ofMonth {
		if o.State == "confirmed" && !o.BalancePaid { // a balance already marked received is no longer to collect
			if left := max(0, o.TotalInr-o.AdvanceInr); left > 0 {
				r.Sold.ToCollect.Count++
				r.Sold.ToCollect.Paise += left * 100
			}
		}
		switch o.Mode {
		case "pickup":
			r.Sold.Pickup++
		case "delivery":
			r.Sold.Delivery++
		}
	}
	r.Sold.Orders = len(ofMonth)

	r.Stopped.Total, r.Stopped.ByRule = stopsIn(month)

	// ---- the record itself: the counts by action and outcome, and a digest of the WHOLE record (not the month's), never carrying a customer's number ----
	r.Record.ByAction = report.CountByAction(month)
	digests := make([]any, 0, len(all))
	for _, e := range all {
		digests = append(digests, report.EntryDigest(e))
	}
	r.Record.Entries, r.Record.Digest = len(month), report.DigestOf(digests)

	stoppedCustomers := map[string]bool{}
	for _, e := range month {
		if e.Action == "opt_out" && e.Outcome == "confirmed" {
			stoppedCustomers[e.Conversation] = true
		}
		if e.Action == "send_message" && e.Outcome != "blocked" && e.Refs["to"] == "owner" {
			r.Messages.ToOwner++
		}
		if e.Action == "send_message" && e.Outcome == "blocked" {
			for _, d := range report.DecisionsOf(e) {
				if d.RuleID == "message-matches-record" { // whatever the verdict
					r.Messages.HeldBack++
					break
				}
			}
		}
		if (e.Outcome == "unconfirmed" || e.Outcome == "failed") && e.Action != "send_message" && e.Action != loadWords().Facts.MessageStatusEntry {
			r.Unconfirmed.Open++ // a message, or WhatsApp's report on one, is not an open payment (a reply to a voice note is counted)
		}
	}
	r.Customers.Stopped = len(stoppedCustomers)

	r.Period = report.PeriodOfRange(from, to, shop.Timezone)
	r.From, r.To = fromIso, toIso

	r.Pathway = DefaultPathway()
	r.Source = in.Source
	r.ShopName, r.TimeZone, r.Languages, r.OwnerLang = shop.Name, shop.Timezone, append([]string{}, shop.Languages...), shop.OwnerLanguage
	r.PreparedBy = in.PreparedBy
	r.Innovator = in.Innovator
	r.MadeAt = report.ISOOf(in.MadeAt)
	r.PolicyDig = PolicyDigest(in.Settings)
	if upi {
		r.PaidBy = "owner-marked"
	}
	for _, id := range NotCounted() {
		if swap, ok := loadWords().Facts.UpiNotCounted[id]; upi && ok {
			id = swap
		}
		r.NotCounted = append(r.NotCounted, id)
	}
	r.NotTested = NotTestedForReport(goLive, shop)
	r.GoLive = goLive
	if hasPlans(in.Settings) {
		p := plansReportOf(all, month)
		r.Plans = &p
	}
	if in.LedgerTenant != nil {
		if r.Anchor, err = bookingsreport.HeadOf(in.Entries, *in.LedgerTenant); err != nil {
			return nil, err
		}
	}
	return r, nil
}
