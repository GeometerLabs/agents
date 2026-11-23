// The Fees monthly report as plain data, counted from the action record: templates/education/fees/report/data.ts (`buildFeesReport`, `entryDigest`, the types). Nothing here is
// estimated: every number is a count of record entries (or a sum of amounts the record itself kept); what the record cannot tell is listed as "not counted".
//
// The report is a TREE that is sealed (report.Seal digests and signs its canonical JSON), so the Go value `Report` has one `Tree()` (tree.go) that builds the same key set as the
// TypeScript object, leaving a key out exactly where the TypeScript leaves it out with a spread (`innovator`, `paidBy`, `accounting`, `classes`, `money.oldDues`, `money.settledByWord`,
// `money.booksOnly`) and writing an explicit null where the TypeScript has null (`preparedBy`, `period.month`, `anchor`).
//
// STUDENTS' NAMES NEVER APPEAR HERE. The report is given the fees only as `Due` (the month, the state, how many payments and what is left, in paise): no name, no parent's number. The
// record's entries are digested without their `conversation` (the parent's number) and without their `notes` (a note can name a child, and a digest of it could be tested by guessing the
// name), exactly as the TypeScript's entryDigest does.
//
// Where Go and JavaScript differ, and what this file copies:
//   - JavaScript Sets keep insertion order; Go maps do not. The sets used only for their size are Go maps;
//   - `x ?? y` and `=== undefined` are presence, `if (x)` is truthiness (an empty text is false): refs are looked up with the two-value form;
//   - `Number(text)` is accounting.JSNumber; a money sum is whole paise (int64): a ref that is not a whole number (the runtime writes none) is cut to one, see Deferred.md;
//   - `byLanguage[e.language]++` for a language the report does not list is not counted here (the TypeScript would add a NaN member): the record writes the centre's languages only.
package feesreport

import (
	"fmt"
	"math"
	"strings"

	"github.com/GeometerLabs/agents/go/internal/accounting"
	"github.com/GeometerLabs/agents/go/internal/bookingsreport"
	"github.com/GeometerLabs/agents/go/internal/report"
	"github.com/GeometerLabs/agents/go/internal/zone"
)

const formatReport = "geometer-fees-report/1"

// Due is what the report reads of one fee: the month it is for, its state, how many payments the agent counted on it and what is still to pay (negative: more was paid than is owed). It
// carries no student's name and no parent's number: the report cannot print what it is not given.
type Due struct {
	Month        string
	State        string // "open", "paid", ...
	Payments     int
	BalancePaise int64
}

// Input is ReportInput. From and To are epoch milliseconds, the month being [From, To). Entries is the whole record, oldest first; Dues are the fees as they are when the report is made.
type Input struct {
	Settings Settings
	Entries  []accounting.Entry
	Dues     []Due
	From, To int64
	Source   string
	MadeAt   int64
	// PreparedBy is who set the agent up as the caller wrote it; nil is the TypeScript's undefined, written as null.
	PreparedBy *string
	Innovator  bool
	// GoLive is what the report was told about the go-live checks; nil: none was given.
	GoLive *report.GoLiveFinding
	// LedgerTenant is the centre's id on the server: the report is anchored to the head of the record. nil: the anchor is null.
	LedgerTenant *string
}

// Report is data.ts FeesReport.
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
		OldDues              *accounting.Amount // nil: no old due was paid in the period (left out of the tree)
		SettledByWord        []report.SettledRow
		BooksOnly            *accounting.BooksOnly
	}
	// PaidBy is "owner-marked" for a UPI centre (B33) and "" otherwise (left out of the tree).
	PaidBy string
	Fees   struct {
		Opened, PaidInFull, PartlyPaid, StillOpen int
		StillToCollect                            accounting.Amount
	}
	Waivers struct{ Total, ByOwner, WithinLimit, LateFeesAdded accounting.Amount }
	Owner   struct{ Asked, Approved, Denied int }
	// Reminders.ByLanguage has a key for every language.
	Reminders struct {
		Sent       int
		ByLanguage map[string]int
		Receipts   int
	}
	Parents struct{ Stopped int }
	Stopped struct {
		Total  int
		ByRule map[string]int
	}
	Messages    struct{ ToOwner, HeldBack int }
	Unconfirmed struct{ Open int }
	NotCounted  []string
	NotTested   []string
	GoLive      report.GoLiveFinding
	Accounting  *accounting.ReportAccountingData
	// Classes is nil for a centre without the add-on (the block is then left out of the tree and the page).
	Classes *ClassesCounts
	// Credit is the credit book's counts (data.ts creditCounts), nil for a shop without the `creditBook` block (left out of the tree, the page and the owner's text).
	Credit *CreditCounts
	Anchor *bookingsreport.LedgerHead
}

// CreditCounts is `credit`: what the accounts showed at the month's start, what was paid after a reminder, the credit reminders sent, and those sent when the record already showed
// the account paid (which must be 0).
type CreditCounts struct {
	OwedAtStart, CollectedAfterReminder accounting.Amount
	RemindersSent, RemindersAfterPaid   int
}

// creditCounts is data.ts creditCounts over the whole record in its order (seq), by the fee each line is on.
func creditCounts(all []accounting.Entry, from int64) *CreditCounts {
	owed := map[string]int64{}
	reminded := map[string]bool{}
	out := &CreditCounts{}
	started := false
	takeStart := func() {
		for _, v := range owed {
			if v > 0 {
				out.OwedAtStart.Count++
				out.OwedAtStart.Paise += v
			}
		}
		started = true
	}
	for _, e := range all {
		t, _ := accounting.ParseISO(e.Time)
		inMonth := t >= from
		if inMonth && !started {
			takeStart()
		}
		if e.Booking == nil || *e.Booking == "" || e.Outcome != "confirmed" {
			continue
		}
		fee := *e.Booking
		ref, present := e.Refs["amountPaise"]
		n := math.NaN()
		if present {
			n = accounting.JSNumber(ref)
		}
		finite := !math.IsNaN(n) && !math.IsInf(n, 0)
		_, known := owed[fee]
		switch {
		case e.Action == "credit_add" && finite:
			owed[fee] += int64(n)
		case !known:
		case (e.Action == "record_payment" || e.Action == "owner_marked_paid") && finite:
			owed[fee] -= int64(n)
			if inMonth && reminded[fee] {
				addTo(&out.CollectedAfterReminder, ref, present)
			}
		case e.Action == "send_message" && e.Refs["to"] == "customer" && has(strings.Split(e.Refs["templates"], "+"), "credit_reminder"):
			reminded[fee] = true
			if inMonth {
				out.RemindersSent++
				if owed[fee] <= 0 {
					out.RemindersAfterPaid++
				}
			}
		}
	}
	if !started {
		takeStart()
	}
	return out
}

// ClassesCounts is `classes`: counted from the record. `Held` is classes whose attendance the teacher confirmed; `AttendanceMarked` the students marked in them.
type ClassesCounts struct{ Held, LinksSent, AttendanceMarked, MissedNotes, Doubts int }

// UPI says whether the money is the owner's marks (paidBy).
func (r *Report) UPI() bool { return r.PaidBy == "owner-marked" }

func has(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
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

// refOr is `e.refs.k ?? fallback`: present (even empty) wins.
func refOr(e accounting.Entry, k, fallback string) string {
	if v, ok := e.Refs[k]; ok {
		return v
	}
	return fallback
}

// BuildFeesReport is buildFeesReport(input). The errors are the TypeScript's sentences (a period that ends before it starts, a source it does not know) and the ledger's.
func BuildFeesReport(in Input) (*Report, error) {
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
	all, month := report.SplitMonth(in.Entries, from, to)
	r := &Report{}

	// ---- money: read from the books (internal/accounting): the journal is the record read as double-entry lines, and the month's figures are sums over it ----
	// For a UPI centre the owner's marks are the payment record (cash and bank marks too), and a refund counts once the owner marks it sent; the journal reads them all. A payment is
	// counted once, a refund once per refund id, and a refund a person settled by their word is not money given back (it is counted on its own below).
	upi := !ConfirmsAutomatically(shop)
	fromIso, toIso := report.ISOOf(from), report.ISOOf(to)
	legacy := accounting.FeesLegacy
	journal := accounting.BuildJournal(all, legacy)
	opt := accounting.FigureOptions{OwnerMarks: &upi}
	figures := accounting.FiguresOf(journal, all, legacy, fromIso, toIso, opt)
	r.Money.BooksOnly = accounting.BooksOnlyOf(figures)
	r.Accounting = accounting.ReportAccounting(all, legacy, fromIso, toIso)
	// Old dues collected: the same books figure over only the entries on a fee that was opened as a back due (accounting.OldDueMonths), so every rule of `received` (once per payment, a
	// second payment on a link left out, a UPI centre's marks) applies unchanged and the two parts add up to `figures.Received` exactly.
	oldMonths := accounting.OldDueMonths(all)
	var onOld []accounting.Entry
	for _, e := range all {
		if e.Booking != nil && *e.Booking != "" {
			if _, isOld := oldMonths[*e.Booking]; isOld {
				onOld = append(onOld, e)
			}
		}
	}
	old := accounting.FiguresOf(journal, onOld, legacy, fromIso, toIso, opt).Received
	r.Money.Collected = figures.Received
	if old.Count > 0 {
		r.Money.OldDues = &accounting.Amount{Count: old.Count, Paise: old.Paise}
		r.Money.Collected = accounting.Amount{Count: figures.Received.Count - old.Count, Paise: figures.Received.Paise - old.Paise}
	}
	r.Money.GivenBack = accounting.Amount{Count: figures.Refunds.Count, Paise: figures.Refunds.Paise}
	r.Money.SettledByWord, _ = report.SettledByWordOf(month) // a person's word, by who said it

	// ---- waivers and late fees, each at its own confirmed entry ----
	// the totals come from the books; who approved each waiver (the owner, or within the limit) is the entry's own `by`, which the books do not carry, so that split is counted here
	r.Waivers.Total, r.Waivers.LateFeesAdded = figures.Discounts, figures.LateFees
	for _, e := range month {
		if e.Action == "waive_fee" && e.Outcome == "confirmed" {
			amount, ok := e.Refs["amountPaise"]
			if e.Refs["by"] == "owner" {
				addTo(&r.Waivers.ByOwner, amount, ok)
			} else {
				addTo(&r.Waivers.WithinLimit, amount, ok)
			}
		}
	}

	// ---- the owner's part: a request is counted once, whether it was a waiver or a refund, and however many entries it left ----
	asked := map[string]bool{}
	for _, e := range month {
		if e.Outcome == "held_for_owner" && (e.Action == "waiver_request" || e.Action == "refund") {
			booking := "null"
			if e.Booking != nil {
				booking = *e.Booking
			}
			asked[e.Action+"|"+booking+"|"+refOr(e, "paymentId", refOr(e, "request", fmt.Sprint(e.Seq)))] = true
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

	// ---- the fees as they stand: the month's own fees, read when the report is made ----
	start := zone.LocalParts(from, shop.Timezone)
	key := fmt.Sprintf("%d-%02d", start.Year, start.Month)
	for _, d := range in.Dues {
		if d.Month != key {
			continue
		}
		r.Fees.Opened++
		switch d.State {
		case "paid":
			r.Fees.PaidInFull++
		case "open":
			r.Fees.StillOpen++
			r.Fees.StillToCollect.Count++
			r.Fees.StillToCollect.Paise += max(0, d.BalancePaise)
			if d.Payments > 0 {
				r.Fees.PartlyPaid++
			}
		}
	}

	// ---- reminders and receipts sent: a message counted by the template the record names ----
	templatesOf := func(e accounting.Entry) []string { return strings.Split(e.Refs["templates"], "+") } // `(refs.templates ?? "").split("+")`
	anyIn := func(e accounting.Entry, names []string) bool {
		for _, t := range templatesOf(e) {
			if has(names, t) {
				return true
			}
		}
		return false
	}
	var toParents []accounting.Entry
	for _, e := range month {
		if e.Action == "send_message" && e.Outcome == "confirmed" && e.Refs["to"] == "customer" {
			toParents = append(toParents, e)
		}
	}
	r.Reminders.ByLanguage = map[string]int{}
	for _, l := range loadWords().Facts.Languages {
		r.Reminders.ByLanguage[l] = 0
	}
	f := &loadWords().Facts
	for _, e := range toParents {
		if anyIn(e, f.ReminderTemplates) {
			r.Reminders.Sent++
			if _, known := r.Reminders.ByLanguage[e.Language]; known {
				r.Reminders.ByLanguage[e.Language]++
			}
		}
		if anyIn(e, f.ReceiptTemplates) {
			r.Reminders.Receipts++
		}
	}

	// ---- what the limits stopped: each rule at its own entry; the total counts entries, not rules. A waiver or refund held for the owner is not "stopped": it is under "asked". ----
	r.Stopped.ByRule = map[string]int{}
	for _, id := range RuleIDs() {
		r.Stopped.ByRule[id] = 0
	}
	for _, e := range month {
		blocked := map[string]bool{}
		for _, d := range report.DecisionsOf(e) {
			if sites, ok := f.StopSites[d.RuleID]; d.Verdict == "block" && ok && has(sites, e.Action) {
				blocked[d.RuleID] = true
			}
		}
		if len(blocked) == 0 {
			continue
		}
		r.Stopped.Total++
		for id := range blocked {
			r.Stopped.ByRule[id]++
		}
	}

	// ---- the record itself: the counts by action and outcome, and a digest of the WHOLE record (not the month's), never carrying a parent's number or a note ----
	r.Record.ByAction = report.CountByAction(month)
	digests := make([]any, 0, len(all))
	for _, e := range all {
		digests = append(digests, report.EntryDigest(e))
	}
	r.Record.Entries, r.Record.Digest = len(month), report.DigestOf(digests)

	// ---- Classes: counted at the entries Classes writes (src/classes/run.ts CLASS_ACTIONS), only for a centre that has it ----
	if hasClasses(in.Settings) {
		c := &ClassesCounts{}
		for _, e := range month {
			if e.Action == "class_attendance" && e.Outcome == "confirmed" {
				c.Held++
				c.AttendanceMarked += refCount(e, "present") + refCount(e, "absent") // `Number(refs.present ?? 0) + Number(refs.absent ?? 0)`
			}
			if e.Action == "class_doubt" && e.Outcome == "confirmed" {
				if _, answered := e.Refs["answered"]; !answered {
					c.Doubts++
				}
			}
		}
		for _, e := range toParents {
			if has(templatesOf(e), "class_link") {
				c.LinksSent++
			}
			if has(templatesOf(e), "class_missed_note") {
				c.MissedNotes++
			}
		}
		r.Classes = c
	}
	// ---- the credit book: its counts, only for a shop that has it ----
	if hasCredit(in.Settings) {
		r.Credit = creditCounts(all, from)
	}

	stoppedParents := map[string]bool{}
	for _, e := range month {
		if e.Action == "opt_out" && e.Outcome == "confirmed" {
			stoppedParents[e.Conversation] = true
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
		if (e.Outcome == "unconfirmed" || e.Outcome == "failed") && e.Action != "send_message" && e.Action != f.MessageStatusEntry {
			r.Unconfirmed.Open++ // a message, or WhatsApp's report on one, is not an open payment
		}
	}
	r.Parents.Stopped = len(stoppedParents)

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
		if swap, ok := f.UpiNotCounted[id]; upi && ok {
			id = swap
		}
		r.NotCounted = append(r.NotCounted, id)
	}
	r.NotTested = NotTestedForReport(goLive, shop)
	r.GoLive = goLive
	if in.LedgerTenant != nil {
		if r.Anchor, err = bookingsreport.HeadOf(in.Entries, *in.LedgerTenant); err != nil {
			return nil, err
		}
	}
	return r, nil
}

// refCount is `Number(e.refs[k] ?? 0)` as a whole number: a missing or non-numeric ref counts 0 here (the TypeScript's sum would be NaN, written as null; the runtime writes numbers).
func refCount(e accounting.Entry, k string) int {
	v, ok := e.Refs[k]
	if !ok {
		return 0
	}
	if n := accounting.JSNumber(v); !math.IsNaN(n) && !math.IsInf(n, 0) {
		return int(n)
	}
	return 0
}
