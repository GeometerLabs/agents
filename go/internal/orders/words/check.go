package words

// The outgoing check for Orders: the Go twin of templates/commerce/orders/src/language/check.ts (checkFactsOf, checkMessage) over the shared check in internal/language/check.go, and
// of limits.ts checkMessageMatchesRecord (the shared checkRecordMatch over those facts). A message that fails is not sent.

import (
	"strings"

	"github.com/GeometerLabs/agents/go/internal/language"
	"github.com/GeometerLabs/agents/go/internal/messaging"
)

// CheckFactsOf is check.ts checkFactsOf: the lists the check reads, made from an order conversation's facts. The order's lines are one literal ("2 × Veg thali, 1 × Curd") read whole
// from the record. Unlike Bookings, the customer's number is NOT also grouped.
func CheckFactsOf(f *MessageFacts) language.Facts {
	var out language.Facts
	for _, v := range []*int64{f.PriceInr, f.TotalInr, f.AdvanceInr, f.BalanceInr, f.RefundInr, f.MarkedInr, f.LeftInr} {
		if v != nil {
			out.AmountsInr = append(out.AmountsInr, float64(*v))
		}
	}
	for _, m := range f.Menu {
		out.AmountsInr = append(out.AmountsInr, float64(m.PriceInr))
	}
	counts := []*int64{f.LeftCount, f.HoldMinutes, f.WindowHours, f.MaxItems, f.ApprovalHours, f.ApprovalsLeft, f.UpcomingCount}
	if f.Plan != nil {
		counts = append(counts, f.Plan.Meals)
	}
	for _, v := range counts {
		if v != nil {
			out.Counts = append(out.Counts, float64(*v))
		}
	}
	// shownMs is the window's start, or the day; momentsMs the rest (the window's end, the cut-off, the day, the list's windows, the plan's first and last day)
	out.ShownMs = f.SlotFromMs
	if out.ShownMs == nil {
		out.ShownMs = f.DateMs
	}
	moments := []*int64{f.SlotToMs, f.CutoffMs, f.DateMs}
	for _, s := range f.SlotChoices {
		moments = append(moments, N(s.FromMs), N(s.ToMs))
	}
	if f.Plan != nil {
		moments = append(moments, f.Plan.FromMs, f.Plan.ToMs)
	}
	for _, v := range moments {
		if v != nil {
			out.MomentsMs = append(out.MomentsMs, *v)
		}
	}
	out.Loc = f.zone()
	if f.Link != nil && *f.Link != "" {
		out.Links = append(out.Links, *f.Link)
	}
	lits := []*string{&f.BusinessName, f.ItemsText, f.ItemName}
	for _, m := range f.Menu {
		lits = append(lits, S(m.Name))
	}
	lits = append(lits, f.Area, f.Address)
	for _, a := range f.Areas {
		lits = append(lits, S(a))
	}
	lits = append(lits, f.OrderRef, f.CustomerPhone, f.ApprovalCode, f.UpiID, f.Payee, f.UpiCode, f.Partner)
	for _, l := range lits {
		if l != nil {
			out.Literals = append(out.Literals, *l)
		}
	}
	return out
}

// CheckMessage is check.ts checkMessage: a final message against the facts of its order. The problems are in plain words and none means the message may go.
func CheckMessage(text string, f *MessageFacts) []string {
	return language.CheckText(text, CheckFactsOf(f))
}

// MatchesRecord is limits.ts checkMessageMatchesRecord: the check's problems as the rule's decision (message-matches-record), word for word.
func MatchesRecord(text string, f *MessageFacts) messaging.Decision {
	problems := CheckMessage(text, f)
	if len(problems) == 0 {
		return messaging.Decision{RuleID: "message-matches-record", Verdict: "allow", Reason: "Every amount, date, time and link in the message is in the record."}
	}
	return messaging.Decision{RuleID: "message-matches-record", Verdict: "block", Reason: "The message does not match the record. " + strings.Join(problems, " ")}
}
