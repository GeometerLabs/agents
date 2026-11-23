// The Stock orders monthly report as plain data, counted from the action record and the purchase orders: templates/commerce/stock-orders/report/data.ts (`buildStockReport`, `stopsIn`, the
// types). Nothing here is estimated: every number is a count of orders or of record entries, and what the record cannot tell is listed as "not counted".
//
// The report is a TREE that is sealed (report.Seal digests and signs its canonical JSON), so the Go value `Report` has one `Tree()` (tree.go) that builds the same key set as the TypeScript
// object, leaving a key out exactly where the TypeScript leaves it out with a spread (`innovator`) and writing an explicit null where the TypeScript has null (`preparedBy`, `period.month`,
// `anchor`).
//
// Three different things stay three counts: the supplier said yes (ack), the goods came (receipt) and "marked paid by the owner" (the owner's own note, from the record, never checked).
// No phone number is in the report: the owner's and the suppliers' numbers are only ever in the record's `conversation` field, which the digest leaves out and the report never copies.
//
// Where Go and JavaScript differ, and what this file copies:
//   - `x ?? y` and `=== undefined` are presence (a pointer here), `if (x)` is truthiness (an empty text is false): `e.booking &&` is "not nil and not empty";
//   - a JavaScript Set kept only for its size is a Go map; the suppliers follow the SHOP'S list (a slice), as the TypeScript's `.map` does;
//   - `new Date(ms).toISOString()` is report.ISOOf (years 1000 to 9999).
package stockordersreport

import (
	"fmt"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/accounting"
	"github.com/GeometerLabs/agents/go/internal/bookingsreport"
	"github.com/GeometerLabs/agents/go/internal/report"
)

const formatReport = "geometer-stock-orders-report/1"

// Pathway is `pathway`: the agent's name and version (the template's package.json version).
type Pathway = bookingsreport.Pathway

// DefaultPathway is PATHWAY: "stock-orders" and the version in templates/commerce/stock-orders/package.json at the time the words were generated.
func DefaultPathway() Pathway { return loadWords().Facts.Pathway }

// Order is what data.ts reads of a purchase order (src/order.ts PurchaseOrder): its state, the supplier, what it came to, and the times the owner asked for it, approved it and it went out
// (nil is the TypeScript's undefined), and what the supplier answered and what arrived. The Stock orders runtime converts its own orders into this.
type Order struct {
	State      string
	Supplier   string
	TotalPaise int64
	CreatedMs  *int64
	ApprovedMs *int64
	SentMs     *int64
	Ack        string // "none", "accepted" or "declined"
	Receipt    string // "none", "full", "part" or "wrong_item"
}

// holdsBudget is order.ts holdsBudget: approved, and not cancelled or declined by the supplier. (An order that never went out and was cancelled gives its budget back.)
func holdsBudget(o Order) bool {
	if o.ApprovedMs == nil {
		return false
	}
	switch o.State {
	case "approved", "sent", "send_unknown", "send_failed", "send_blocked":
		return true
	}
	return false
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

// OrderCounts is the part of the TypeScript's `orders` that a supplier row repeats.
type OrderCounts struct {
	SentOut, Acknowledged, DeclinedBySupplier, Silent, ReceivedFull, PartReceived, WrongItem int
}

// SupplierCounts is data.ts SupplierCounts.
type SupplierCounts struct {
	ID, Name                                                                      string
	Placed, Acknowledged, ReceivedFull, PartReceived, WrongItem, Declined, Silent int
}

// Report is data.ts StockReport.
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
	Orders struct {
		Placed int
		OrderCounts
		NeverSent, SendUnknown int
	}
	Owner             struct{ Asked, Approved, SaidNo, Voided int }
	MarkedPaidByOwner int
	Budget            struct{ MonthlyPaise, UsedPaise, LeftPaise int64 }
	Suppliers         []SupplierCounts
	Stopped           struct {
		Total  int
		ByRule map[string]int
	}
	UnconfirmedOpen int
	NotCounted      []string
	NotTested       []string
	GoLive          report.GoLiveFinding
	Anchor          *bookingsreport.LedgerHead
}

// Sources is SOURCES; has is `list.includes(s)`.
func has(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

// stopsIn is stopsIn: what the limits stopped, one entry at a time. A blocked entry (one with a block decision) is one stop, counted under each rule that blocked it once. A rule this
// package does not list is counted under "other", so the total is always every blocked entry that carries a block.
func stopsIn(month []accounting.Entry) (int, map[string]int) {
	byRule := map[string]int{}
	for _, id := range RuleIDs() {
		byRule[id] = 0
	}
	total := 0
	for _, e := range month {
		if e.Outcome != "blocked" {
			continue
		}
		rules := map[string]bool{}
		for _, d := range report.DecisionsOf(e) {
			if d.Verdict == "block" {
				id := d.RuleID
				if !has(RuleIDs(), id) {
					id = "other"
				}
				rules[id] = true
			}
		}
		if len(rules) == 0 {
			continue
		}
		total++
		for r := range rules {
			byRule[r]++
		}
	}
	return total, byRule
}

func countsOf(list []Order) OrderCounts {
	var c OrderCounts
	for _, o := range list {
		if o.SentMs != nil {
			c.SentOut++
			if o.Ack == "none" {
				c.Silent++
			}
		}
		switch o.Ack {
		case "accepted":
			c.Acknowledged++
		case "declined":
			c.DeclinedBySupplier++
		}
		switch o.Receipt {
		case "full":
			c.ReceivedFull++
		case "part":
			c.PartReceived++
		case "wrong_item":
			c.WrongItem++
		}
	}
	return c
}

// BuildStockReport is buildStockReport(input). The errors are the TypeScript's sentences (a period that ends before it starts, a source it does not know) and the ledger's.
func BuildStockReport(in Input) (*Report, error) {
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
	inMonth := func(ms *int64) bool { return ms != nil && *ms >= from && *ms < to }

	r := &Report{}

	// ---- orders: the ones the owner approved in the month, read as they are now ----
	var placed, asked []Order
	for _, o := range in.Orders {
		if inMonth(o.ApprovedMs) {
			placed = append(placed, o)
		}
		if inMonth(o.CreatedMs) {
			asked = append(asked, o)
		}
	}
	r.Orders.Placed = len(placed)
	r.Orders.OrderCounts = countsOf(placed)
	for _, o := range placed {
		if o.SentMs == nil && (o.State == "cancelled" || o.State == "send_failed" || o.State == "send_blocked") {
			r.Orders.NeverSent++
		}
		if o.State == "send_unknown" {
			r.Orders.SendUnknown++
		}
	}

	// ---- the owner's part ----
	r.Owner.Asked, r.Owner.Approved = len(asked), len(placed)
	for _, o := range asked {
		switch o.State {
		case "declined":
			r.Owner.SaidNo++
		case "void":
			r.Owner.Voided++
		}
	}
	// the owner's own "paid" note: each order once, at the first mark in the month (`e.booking &&`: a booking that is there and not empty)
	marked := map[string]bool{}
	for _, e := range month {
		if e.Action == "mark_paid_outside" && e.Outcome == "confirmed" && e.Booking != nil && *e.Booking != "" {
			marked[*e.Booking] = true
		}
	}
	r.MarkedPaidByOwner = len(marked)

	// ---- the budget: what the placed orders that still hold it add up to ----
	for _, o := range placed {
		if holdsBudget(o) {
			r.Budget.UsedPaise += o.TotalPaise
		}
	}
	r.Budget.MonthlyPaise = monthlyPaise(in.Settings)
	r.Budget.LeftPaise = max(0, r.Budget.MonthlyPaise-r.Budget.UsedPaise)

	// ---- each supplier that was ordered from, by the shop's own name, in the order of the shop's list ----
	r.Suppliers = []SupplierCounts{}
	for _, s := range suppliersOf(in.Settings) {
		var mine []Order
		for _, o := range placed {
			if o.Supplier == s.id {
				mine = append(mine, o)
			}
		}
		if len(mine) == 0 {
			continue
		}
		c := countsOf(mine)
		r.Suppliers = append(r.Suppliers, SupplierCounts{ID: s.id, Name: s.name, Placed: len(mine), Acknowledged: c.Acknowledged, ReceivedFull: c.ReceivedFull, PartReceived: c.PartReceived,
			WrongItem: c.WrongItem, Declined: c.DeclinedBySupplier, Silent: c.Silent})
	}

	// ---- the record itself: the counts by action and outcome, and a digest of the WHOLE record (not the month's), never carrying a conversation's number ----
	r.Record.ByAction = report.CountByAction(month)
	digests := make([]any, 0, len(all))
	for _, e := range all {
		digests = append(digests, report.EntryDigest(e))
	}
	r.Record.Entries, r.Record.Digest = len(month), report.DigestOf(digests)
	r.Stopped.Total, r.Stopped.ByRule = stopsIn(month)
	for _, e := range month {
		if e.Action == "send_order" && (e.Outcome == "unconfirmed" || e.Outcome == "failed") {
			r.UnconfirmedOpen++
		}
	}

	r.Period = report.PeriodOfRange(from, to, shop.Timezone)
	r.From, r.To = report.ISOOf(from), report.ISOOf(to)

	r.Pathway = DefaultPathway()
	r.Source = in.Source
	r.ShopName, r.TimeZone, r.Languages, r.OwnerLang = shop.Name, shop.Timezone, append([]string{}, shop.Languages...), shop.OwnerLanguage
	r.PreparedBy = in.PreparedBy
	r.Innovator = in.Innovator
	r.MadeAt = report.ISOOf(in.MadeAt)
	r.PolicyDig = PolicyDigest(in.Settings)
	r.NotCounted = append([]string{}, NotCounted()...)
	r.NotTested = NotTestedForReport(goLive)
	r.GoLive = goLive
	if in.LedgerTenant != nil {
		if r.Anchor, err = bookingsreport.HeadOf(in.Entries, *in.LedgerTenant); err != nil {
			return nil, err
		}
	}
	return r, nil
}
