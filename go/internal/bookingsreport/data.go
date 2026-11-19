// The Bookings monthly report as plain data, counted from the action record: templates/commerce/bookings/report/data.ts (`buildMonthlyReport`, `workOf`, `entryDigest`, the types).
// Nothing here is estimated: every number is a count of record entries (or a sum of amounts the record itself kept); what the record cannot tell is listed as "not counted".
//
// The report is a TREE that is sealed (report.Seal digests and signs its canonical JSON), so the Go value `MonthlyReport` has one `Tree()` that builds the same key set as the
// TypeScript object, leaving a key out exactly where the TypeScript leaves it out with a spread (`innovator`, `paidBy`, `accounting`, `money.settledByWord`, `money.booksOnly`, a
// refund row's `settledByWord`) and writing an explicit null where the TypeScript has null (`preparedBy`, `period.month`, `anchor`, a job's `why`, the work's cost fields). Go has no
// `undefined`; report.CanonicalJSON would write one as "null", and no field of this tree is ever undefined in the TypeScript (each was checked: the optional ones are spreads).
//
// Where Go and JavaScript differ, and what this file copies:
//   - JavaScript Maps and Sets keep insertion order; Go maps do not, so first-seen order is kept in slices where the TypeScript iterates a Map or Set and the order shows (the jobs
//     list is then SORTED, with a stable sort, by a number read from the booking's id: Number(text) || 0, accounting.JSNumber);
//   - `x ?? y` and `=== undefined` are presence, `if (x)` is truthiness (an empty text is false): both are kept where the TypeScript uses each (refs are looked up with the two-value form);
//   - `Array.prototype.sort()` with no comparator (the page's actions and outcomes) is UTF-16 order: report.LessUTF16;
//   - Math.ceil of the cost per completed job is math.Ceil of a float division, as in the TypeScript;
//   - the message counts by language use the four languages; a record entry whose language is none of them would be a NaN key in the TypeScript (Deferred.md).
package bookingsreport

import (
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/GeometerLabs/agents/go/internal/accounting"
	"github.com/GeometerLabs/agents/go/internal/report"
	"github.com/GeometerLabs/agents/go/internal/zone"
)

const formatMonthly = "geometer-monthly-report/1"

// Pathway is `pathway`: the agent's name and version (the template's package.json version by default).
type Pathway struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

// DefaultPathway is PATHWAY: "bookings" and the version in templates/commerce/bookings/package.json at the time the words were generated.
func DefaultPathway() Pathway { return loadWords().Facts.Pathway }

// Booking is what data.ts reads of the conversation store's bookings (src/booking.ts Booking): its id, its state and how many steps wait for the owner. The Bookings runtime converts.
type Booking struct {
	ID      string
	State   string // "needs_owner" is a booking paid for but not on the calendar
	Pending int    // len(booking.pending)
}

// Cost is MonthCost: what the month cost in micro-rupees (1,000,000 = one rupee) and a short sentence of what that counts.
type Cost struct {
	MicroInr int64
	Basis    string
}

// Input is ReportInput. From and To are epoch milliseconds, the month being [From, To). Entries is the whole record, oldest first.
type Input struct {
	Settings Settings
	Entries  []accounting.Entry
	Bookings []Booking
	From, To int64
	Source   string
	MadeAt   int64
	// PreparedBy is who set the agent up as the caller wrote it; nil is the TypeScript's undefined, written as null.
	PreparedBy *string
	Innovator  bool
	// GoLive is what the report was told about the go-live checks; nil: none was given.
	GoLive *report.GoLiveFinding
	// Pathway is which agent the record is of; nil: the bookings pathway.
	Pathway *Pathway
	// LedgerTenant is the shop's id on the server: the report is anchored to the head of the record. nil: the anchor is null. (An empty text is a tenant: it is the caller's to avoid, as
	// run.ts does: `run.tenant ?` leaves it out.)
	LedgerTenant *string
	Cost         *Cost
}

// RecordRow is one entry of the month with its fingerprint (never the customer's number).
type RecordRow struct {
	Seq          int
	Time         string
	Action       string
	Outcome      string
	Booking      *string
	InputsDigest string
	Digest       string
}

// UnconfirmedRow is one entry left unconfirmed or failed, and whether a later confirmed entry settled it (and a person's word, if it was that).
type UnconfirmedRow struct {
	Seq           int
	Action        string
	Outcome       string
	Booking       *string
	SettledLater  bool
	SettledByWord *string
}

// JobLine is one job of the month: its state, why it is unresolved (nil otherwise) and the record entries behind it.
type JobLine struct {
	Booking string
	State   string // "completed", "abandoned" or "unresolved"
	Why     *string
	Seqs    []int
}

// Work is the month's work in three parts that add up, with what it cost. The cost fields are nil when the caller gave none: unknown, never 0.
type Work struct {
	List                     []JobLine
	Jobs, Completed          int
	Abandoned, Unresolved    int
	SettledByPerson          int
	CostMicroInr             *int64
	CostBasis                *string
	CostPerCompletedMicroInr *int64
	NoUnitCost               *string // "no-completed-jobs", "cost-unknown" or nil
}

// ByLanguage is the count of messages by the language they were written in.
type ByLanguage map[string]int

// Side is messages to customers or to the owner.
type Side struct {
	Total      int
	ByLanguage ByLanguage
}

// MonthlyReport is data.ts MonthlyReport.
type MonthlyReport struct {
	Pathway    Pathway
	Source     string
	ShopName   string
	TimeZone   string
	Languages  []string
	OwnerLang  string
	PreparedBy *string
	Period     report.ReportPeriod
	From, To   string // period.from, period.to (ISO)
	MadeAt     string
	PolicyDig  string
	Record     struct {
		Entries  int
		Digest   string
		ByAction map[string]map[string]int
		Rows     []RecordRow
	}
	Bookings struct{ Made, Cancelled, Moved, DroppedBeforeBooked int }
	Money    struct {
		Deposits      accounting.Amount
		Refunds       accounting.RefundAmount
		SettledByWord []report.SettledRow
		BooksOnly     *accounting.BooksOnly
	}
	Owner   struct{ Asked, Approved, Denied, Retried int }
	Stopped struct {
		Total  int
		ByRule map[string]int
	}
	Messages struct {
		ToCustomers, ToOwner Side
		HeldBack             int
	}
	Unconfirmed struct {
		Open, OpenOnBookings, SettledLater int
		Rows                               []UnconfirmedRow
	}
	AtReportTime struct{ WaitingForOwner, PaidNotBooked int }
	Work         Work
	Missing      struct{ DepositAmounts, RefundAmounts, OwnerCommands, MessageTargets int }
	NotCounted   []string
	NotTested    []string
	GoLive       report.GoLiveFinding
	Innovator    bool
	// PaidBy is "owner-marked" for a UPI shop (B33) and "" otherwise (left out of the tree).
	PaidBy     string
	Accounting *accounting.ReportAccountingData
	Anchor     *LedgerHead
}

// UPI says whether the money is the owner's marks (paidBy).
func (r *MonthlyReport) UPI() bool { return r.PaidBy == "owner-marked" }

// messageActions are the actions that are a message going out (data.ts MESSAGE_ACTIONS): a reply to a voice note is one too.
var messageActions = []string{"send_message", "voice_note_reply"}

// stopSites is STOP_SITES: the entry where a rule's "no" is counted (a block is written twice, so each rule is counted at its own entry only).
var stopSites = map[string][]string{
	"price-at-or-above-list":     messageActions,
	"within-hours":               {"hold_slot", "reschedule_booking"},
	"no-double-booking":          {"hold_slot", "reschedule_booking"},
	"confirm-only-when-recorded": messageActions,
	"one-deposit-per-booking":    {"record_deposit"},
	"refund-limit":               {"refund"},
	"no-message-after-stop":      messageActions,
	"message-matches-record":     messageActions,
	"opt-out":                    messageActions,
}

// settleable is SETTLEABLE: actions whose unconfirmed or failed entry can be settled by a later confirmed entry for the same booking.
var settleable = []string{"hold_slot", "create_deposit_link", "record_deposit", "confirm_booking", "reschedule_booking", "refund", "release_slot", "cancel_deposit_link"}

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

// isoOf is new Date(ms).toISOString() for a year from 1000 to 9999.
func isoOf(ms int64) string { return time.UnixMilli(ms).UTC().Format("2006-01-02T15:04:05.000Z") }

// jsonTree turns a value with JSON tags into the tree report.CanonicalJSON writes (numbers as json.Number, read as the double JSON.parse would make).
func jsonTree(v any) any {
	raw, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	dec.UseNumber()
	var out any
	if err := dec.Decode(&out); err != nil {
		panic(err)
	}
	return out
}

func strTree(s *string) any {
	if s == nil {
		return nil
	}
	return *s
}

func samePtr(a, b *string) bool { return (a == nil && b == nil) || (a != nil && b != nil && *a == *b) }

// refEq is `a.refs.k === b.refs.k`: both missing is equal (undefined === undefined).
func refEq(a, b map[string]string, k string) bool {
	va, oka := a[k]
	vb, okb := b[k]
	return oka == okb && va == vb
}

func truthyRef(e accounting.Entry, k string) bool { return e.Refs[k] != "" }

// entryTree is the record entry without the customer's number: what entryDigest digests.
func entryTree(e accounting.Entry) map[string]any {
	refs := make(map[string]any, len(e.Refs))
	for k, v := range e.Refs {
		refs[k] = v
	}
	return map[string]any{"seq": e.Seq, "time": e.Time, "booking": strTree(e.Booking), "action": e.Action, "inputsDigest": e.InputsDigest, "outcome": e.Outcome,
		"decisions": decisionsTree(e), "language": e.Language, "notes": e.Notes, "refs": refs}
}

// EntryDigest is entryDigest: the fingerprint of one record entry. The customer's number (`conversation`) is left out: the digest must not carry it.
func EntryDigest(e accounting.Entry) string { return report.DigestOf(entryTree(e)) }

type decision struct {
	RuleID  string `json:"ruleId"`
	Verdict string `json:"verdict"`
}

// BuildMonthlyReport is buildMonthlyReport(input). The errors are the TypeScript's sentences (a period that ends before it starts, a source it does not know) and the ledger's.
func BuildMonthlyReport(in Input) (*MonthlyReport, error) {
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
	// nothing after the period can matter; a time that does not parse is NaN, and NaN < to is false
	var all []accounting.Entry
	for _, e := range in.Entries {
		if t, ok := accounting.ParseISO(e.Time); ok && t < to {
			all = append(all, e)
		}
	}
	sort.SliceStable(all, func(i, j int) bool { return all[i].Seq < all[j].Seq })
	timeOf := map[int]int64{} // a Map built from the entries: a repeated seq keeps the last one's time
	for _, e := range all {
		t, _ := accounting.ParseISO(e.Time)
		timeOf[e.Seq] = t
	}
	inPeriod := func(e accounting.Entry) bool { return timeOf[e.Seq] >= from }
	var month []accounting.Entry
	for _, e := range all {
		if inPeriod(e) {
			month = append(month, e)
		}
	}

	// ---- bookings: each counted once, at the first confirmed entry ----
	firstConfirmed, confirmedOrder := firstBy(all, func(e accounting.Entry) bool {
		return e.Action == "confirm_booking" && e.Outcome == "confirmed" && e.Booking != nil
	})
	firstCancel, cancelOrder := firstBy(all, func(e accounting.Entry) bool {
		return e.Action == "cancel_booking" && e.Outcome == "confirmed" && e.Booking != nil
	})
	r := &MonthlyReport{}
	for _, id := range confirmedOrder {
		if inPeriod(firstConfirmed[id]) {
			r.Bookings.Made++
		}
	}
	for _, id := range cancelOrder {
		e := firstCancel[id]
		if !inPeriod(e) {
			continue
		}
		if was, ok := firstConfirmed[id]; ok && was.Seq < e.Seq {
			r.Bookings.Cancelled++
		} else {
			r.Bookings.DroppedBeforeBooked++ // a draft, or a hold nobody paid for: never a booking the shop had
		}
	}
	moved := map[string]bool{}
	for _, e := range month {
		if e.Action == "reschedule_booking" && e.Outcome == "confirmed" && e.Booking != nil {
			moved[*e.Booking] = true
		}
	}
	r.Bookings.Moved = len(moved)

	// ---- money: a gateway's from entries the payments service's own record confirmed; UPI's from the owner's marks, labelled as the owner's (paidBy) ----
	upi := !ConfirmsAutomatically(shop)
	fromIso, toIso := isoOf(from), isoOf(to)
	figures := accounting.FiguresOf(accounting.BuildJournal(all, accounting.BookingsLegacy), all, accounting.BookingsLegacy, fromIso, toIso, accounting.FigureOptions{OwnerMarks: &upi})
	booksOnly := accounting.BooksOnlyOf(figures)
	acct := accounting.ReportAccounting(all, accounting.BookingsLegacy, fromIso, toIso)
	r.Money.Deposits = figures.Received
	r.Money.Refunds = figures.Refunds
	// a refund a person settled by their word is not a refund made: it is counted on its own (settledByWord), never in `refunds`
	byWordRows, byWordMissing := report.SettledByWordOf(month)
	r.Missing.DepositAmounts = figures.Missing.DepositAmounts
	r.Missing.RefundAmounts = figures.Missing.RefundAmounts + byWordMissing

	// ---- the owner's part ----
	asked := map[string]bool{}
	for _, e := range month {
		if e.Action == "refund" && e.Outcome == "held_for_owner" {
			key := "null"
			if e.Booking != nil {
				key = *e.Booking
			}
			if pid, ok := e.Refs["paymentId"]; ok {
				key += "|" + pid
			} else {
				key += "|" + strconv.Itoa(e.Seq)
			}
			asked[key] = true
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
			case "retry":
				r.Owner.Retried++
			default:
				r.Missing.OwnerCommands++
			}
		}
	}

	// ---- what the limits stopped: each rule at its own entry; the total counts entries, not rules ----
	r.Stopped.ByRule = map[string]int{}
	for _, id := range RuleIDs() {
		r.Stopped.ByRule[id] = 0
	}
	for _, e := range month {
		var blockedRules []string
		for _, raw := range e.Decisions {
			var d decision
			if json.Unmarshal(raw, &d) != nil {
				continue
			}
			// a rule the report does not list is not one of the shop's limits (the licence's `subscription_suspended`, B13): it is never counted as a limit that held
			if sites, ok := stopSites[d.RuleID]; d.Verdict == "block" && ok && has(sites, e.Action) {
				blockedRules = append(blockedRules, d.RuleID)
			}
		}
		if len(blockedRules) == 0 {
			continue
		}
		r.Stopped.Total++
		done := map[string]bool{}
		for _, id := range blockedRules {
			if !done[id] {
				done[id] = true
				r.Stopped.ByRule[id]++
			}
		}
	}

	// ---- messages that were sent, by the language they were written in ----
	newSide := func() Side {
		s := Side{ByLanguage: ByLanguage{}}
		for _, l := range loadWords().Facts.Languages {
			s.ByLanguage[l] = 0
		}
		return s
	}
	r.Messages.ToCustomers, r.Messages.ToOwner = newSide(), newSide()
	for _, e := range month {
		if !has(messageActions, e.Action) {
			continue
		}
		if e.Outcome == "blocked" {
			r.Messages.HeldBack++
		}
		if e.Outcome != "confirmed" {
			continue
		}
		var side *Side
		switch e.Refs["to"] {
		case "customer":
			side = &r.Messages.ToCustomers
		case "owner":
			side = &r.Messages.ToOwner
		}
		if side == nil {
			r.Missing.MessageTargets++
			continue
		}
		side.Total++
		if _, known := side.ByLanguage[e.Language]; known {
			side.ByLanguage[e.Language]++
		}
	}

	// ---- left unconfirmed or failed (an entry that a later confirmed entry settled is marked, not hidden) ----
	// A refund row a person later settled by their word is settled (nothing is open), and says whose word it was: it is not the payments service's confirmation.
	rows := []UnconfirmedRow{}
	for _, e := range month {
		if e.Outcome != "unconfirmed" && e.Outcome != "failed" {
			continue
		}
		row := UnconfirmedRow{Seq: e.Seq, Action: e.Action, Outcome: e.Outcome, Booking: e.Booking}
		if has(settleable, e.Action) {
			for _, later := range all {
				if later.Seq > e.Seq && later.Outcome == "confirmed" && later.Action == e.Action && samePtr(later.Booking, e.Booking) && (e.Action != "refund" || refEq(later.Refs, e.Refs, "paymentId")) {
					row.SettledLater = true
					if report.IsSettledByWord(later) {
						by := later.Refs["confirmedBy"]
						row.SettledByWord = &by
					}
					break
				}
			}
		}
		rows = append(rows, row)
	}
	settledLater, openOnBookings := 0, 0
	for _, x := range rows {
		if x.SettledLater {
			settledLater++
		} else if !has(messageActions, x.Action) && x.Action != loadWords().Facts.MessageStatusEntry { // a failed delivery report is about a message too
			openOnBookings++
		}
	}
	r.Unconfirmed.Open, r.Unconfirmed.OpenOnBookings, r.Unconfirmed.SettledLater, r.Unconfirmed.Rows = len(rows)-settledLater, openOnBookings, settledLater, rows

	// ---- the record itself ----
	digests := make([]any, 0, len(month))
	r.Record.Rows = make([]RecordRow, 0, len(month))
	r.Record.ByAction = map[string]map[string]int{}
	for _, e := range month {
		d := EntryDigest(e)
		r.Record.Rows = append(r.Record.Rows, RecordRow{e.Seq, e.Time, e.Action, e.Outcome, e.Booking, e.InputsDigest, d})
		digests = append(digests, d)
		if r.Record.ByAction[e.Action] == nil {
			r.Record.ByAction[e.Action] = map[string]int{}
		}
		r.Record.ByAction[e.Action][e.Outcome]++
	}
	r.Record.Entries, r.Record.Digest = len(month), report.DigestOf(digests)

	first := zone.LocalParts(from, shop.Timezone)
	last := zone.LocalParts(to-1, shop.Timezone)
	firstDay, lastDay := first.Date, last.Date
	next := zone.Date{Year: firstDay.Year, Month: firstDay.Month + 1, Day: 1}
	if firstDay.Month == 12 {
		next = zone.Date{Year: firstDay.Year + 1, Month: 1, Day: 1}
	}
	wholeMonth := zone.ZonedToMs(zone.Date{Year: firstDay.Year, Month: firstDay.Month, Day: 1}, 0, 0, shop.Timezone) == from && zone.ZonedToMs(next, 0, 0, shop.Timezone) == to
	r.Period = report.ReportPeriod{FirstDay: firstDay, LastDay: lastDay}
	if wholeMonth {
		r.Period.Month = &report.YearMonth{Year: firstDay.Year, Month: firstDay.Month}
	}
	r.From, r.To = fromIso, toIso

	r.Pathway = DefaultPathway()
	if in.Pathway != nil {
		r.Pathway = *in.Pathway
	}
	r.Source = in.Source
	r.ShopName, r.TimeZone, r.Languages, r.OwnerLang = shop.Name, shop.Timezone, append([]string{}, shop.Languages...), shop.OwnerLanguage
	r.PreparedBy = in.PreparedBy
	r.MadeAt = isoOf(in.MadeAt)
	r.PolicyDig = PolicyDigest(in.Settings)
	r.Money.SettledByWord = byWordRows
	r.Money.BooksOnly = booksOnly
	for _, b := range in.Bookings {
		if b.Pending > 0 {
			r.AtReportTime.WaitingForOwner++
		}
		if b.State == "needs_owner" {
			r.AtReportTime.PaidNotBooked++
		}
	}
	r.Work = workOf(all, month, rows, in.Bookings, firstConfirmed, in.Cost)
	r.NotCounted = append([]string{}, NotCounted()...)
	r.NotTested = NotTestedForReport(goLive, shop)
	r.GoLive = goLive
	r.Innovator = in.Innovator
	if upi {
		r.PaidBy = "owner-marked"
	}
	r.Accounting = acct
	if in.LedgerTenant != nil {
		if r.Anchor, err = HeadOf(in.Entries, *in.LedgerTenant); err != nil {
			return nil, err
		}
	}
	return r, nil
}

// firstBy is firstBy: the first entry for each key, and the keys in the order they were first seen (a JavaScript Map's).
func firstBy(entries []accounting.Entry, keep func(accounting.Entry) bool) (map[string]accounting.Entry, []string) {
	out := map[string]accounting.Entry{}
	var order []string
	for _, e := range entries {
		if !keep(e) {
			continue
		}
		if _, seen := out[*e.Booking]; !seen {
			out[*e.Booking] = e
			order = append(order, *e.Booking)
		}
	}
	return out, order
}

// bookingNo is `Number(id.replace(/^\D+/u, "")) || 0`: the digits at the end of "b-12" (everything before the first ASCII digit is cut), 0 when that is not a number.
func bookingNo(id string) float64 {
	i := 0
	for i < len(id) && !(id[i] >= '0' && id[i] <= '9') {
		i++
	}
	n := accounting.JSNumber(id[i:])
	if math.IsNaN(n) {
		return 0
	}
	return n
}

// workOf is workOf: completed, abandoned and unresolved jobs, counted from the record and the store, so the three always add up to the jobs. A job is unresolved if ANY of: a step the
// service did not confirm and nothing later did; a booking waiting for the owner or paid but not on the calendar; a refund held for the owner with no answer since; a refund the owner
// owes and has not marked; a UPI payment the customer says they made that the owner has not marked.
func workOf(all, month []accounting.Entry, rows []UnconfirmedRow, bookings []Booking, firstConfirmed map[string]accounting.Entry, cost *Cost) Work {
	status := loadWords().Facts.MessageStatusEntry
	var jobs []string
	seenJob := map[string]bool{}
	for _, e := range month {
		if e.Booking != nil && e.Action != status && !seenJob[*e.Booking] {
			seenJob[*e.Booking] = true
			jobs = append(jobs, *e.Booking)
		}
	}
	open := map[string]string{}
	flag := func(booking, why string) { // the first thing found, in the order below
		if _, ok := open[booking]; !ok {
			open[booking] = why
		}
	}
	for _, r := range rows {
		if r.Booking != nil && *r.Booking != "" && !r.SettledLater && !has(messageActions, r.Action) && r.Action != status {
			flag(*r.Booking, "step-not-confirmed")
		}
	}
	lastSeq := func(booking string, keep func(accounting.Entry) bool) int {
		n := 0
		for _, e := range all {
			if e.Booking != nil && *e.Booking == booking && keep(e) && e.Seq > n {
				n = e.Seq
			}
		}
		return n
	}
	cancelled := func(booking string) bool {
		return lastSeq(booking, func(e accounting.Entry) bool { return e.Action == "cancel_booking" && e.Outcome == "confirmed" }) > 0
	}
	// a refund held for the owner is open until the owner has answered after it
	for _, e := range all {
		if e.Action == "refund" && e.Outcome == "held_for_owner" && e.Booking != nil && *e.Booking != "" &&
			e.Seq > lastSeq(*e.Booking, func(x accounting.Entry) bool { return x.Action == "owner_decision" && x.Outcome == "confirmed" }) {
			flag(*e.Booking, "refund-waiting-for-owner")
		}
	}
	// UPI: the customer says they paid and the owner has not marked it; a refund owed and not yet marked sent or kept
	for _, e := range all {
		if e.Booking == nil || *e.Booking == "" {
			continue
		}
		b := *e.Booking
		if e.Action == "upi_paid_claim" && e.Seq > lastSeq(b, func(x accounting.Entry) bool {
			return (x.Action == "owner_marked_paid" && x.Outcome == "confirmed") || x.Action == "upi_request_closed"
		}) && !cancelled(b) {
			flag(b, "payment-not-marked")
		}
		if e.Action == "upi_refund_owed" && e.Outcome == "held_for_owner" {
			settled := false
			for _, x := range all {
				if (x.Action == "upi_refund_marked_done" || x.Action == "upi_refund_kept") && x.Outcome == "confirmed" && refEq(x.Refs, e.Refs, "refundId") {
					settled = true
					break
				}
			}
			if !settled {
				flag(b, "refund-owed-by-owner")
			}
		}
	}
	// the store's own view comes last: a more specific reason from the record wins
	for _, b := range bookings {
		if b.State == "needs_owner" {
			flag(b.ID, "paid-not-booked")
		} else if b.Pending > 0 {
			flag(b.ID, "waiting-for-owner")
		}
	}
	w := Work{List: []JobLine{}}
	sorted := append([]string(nil), jobs...)
	sort.SliceStable(sorted, func(i, j int) bool { return bookingNo(sorted[i])-bookingNo(sorted[j]) < 0 })
	for _, id := range sorted {
		seqs := []int{}
		for _, e := range month {
			if e.Booking != nil && *e.Booking == id && e.Action != status {
				seqs = append(seqs, e.Seq)
			}
		}
		if why, ok := open[id]; ok {
			w.Unresolved++
			w.List = append(w.List, JobLine{id, "unresolved", &why, seqs})
		} else if _, ok := firstConfirmed[id]; ok {
			w.Completed++
			w.List = append(w.List, JobLine{id, "completed", nil, seqs})
		} else {
			w.Abandoned++
			w.List = append(w.List, JobLine{id, "abandoned", nil, seqs})
		}
	}
	w.Jobs = len(jobs)
	for _, e := range month {
		if e.Outcome == "confirmed" && truthyRef(e, "confirmedBy") {
			w.SettledByPerson++
		}
	}
	var unit *int64
	if cost != nil && w.Completed > 0 {
		u := int64(math.Ceil(float64(cost.MicroInr) / float64(w.Completed)))
		unit = &u
	}
	if cost != nil {
		m, b := cost.MicroInr, cost.Basis
		w.CostMicroInr, w.CostBasis = &m, &b
	}
	w.CostPerCompletedMicroInr = unit
	if unit == nil {
		why := "cost-unknown"
		if w.Completed == 0 {
			why = "no-completed-jobs"
		}
		w.NoUnitCost = &why
	}
	return w
}
