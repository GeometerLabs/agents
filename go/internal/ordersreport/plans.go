// What the monthly report says about plans (17 Nov 2026): templates/commerce/orders/src/plans/report.ts `plansReportOf`. Plans active at the month's end, plans started, renewals, meals
// delivered, days credited and what the credits came to (carried to a later payment, or refunded), counted from the action record only. Made only for a shop with plans. Its words are
// PlanWords (words.go, generated from PLAN_REPORT_WORDS).
//
// Where Go differs from JavaScript: `Number(e.refs.days ?? 0)` is accounting.JSNumber of the ref (0 when there is none); the runtime writes whole numbers, and a ref that is not a number
// (JavaScript would make the sum NaN, written as null) is counted as 0 here (Deferred.md). `e.refs.period !== "0"` is true for a missing ref, as in JavaScript.
package ordersreport

import (
	"math"

	"github.com/GeometerLabs/agents/go/internal/accounting"
)

// PlansReport is PlansReport.
type PlansReport struct {
	// Active is the plans paid at least once that were not cancelled or lapsed by the month's end.
	Active, Started, Renewals, MealsDelivered int
	// Credits are the meal days not taken, in the periods settled this month, and what they came to in paise.
	Credits           struct{ Days, CarriedPaise, RefundedPaise int64 }
	Cancelled, Lapsed int
}

// number is `Number(e.refs.k ?? 0)` for whole numbers: a ref that is not a number counts as 0 (see the file's comment).
func number(e accounting.Entry, key string) int64 {
	ref, ok := e.Refs[key]
	if !ok {
		return 0
	}
	if n := accounting.JSNumber(ref); !math.IsNaN(n) && !math.IsInf(n, 0) {
		return int64(n)
	}
	return 0
}

// plansReportOf is plansReportOf(all, month): all is the whole record up to the month's end, month the month's own entries.
func plansReportOf(all, month []accounting.Entry) PlansReport {
	live := map[string]bool{}
	for _, e := range all {
		plan := e.Refs["plan"]
		if e.Action == "plan_paid" && e.Outcome == "confirmed" && plan != "" {
			live[plan] = true
		}
		if (e.Action == "plan_cancel" || (e.Action == "plan_lapse" && e.Refs["period"] != "0")) && e.Outcome == "confirmed" {
			delete(live, plan)
		}
	}
	var p PlansReport
	p.Active = len(live)
	for _, e := range month {
		if e.Outcome != "confirmed" {
			continue
		}
		switch e.Action {
		case "plan_paid":
			if e.Refs["period"] == "0" {
				p.Started++
			} else {
				p.Renewals++
			}
		case "deliver_meal":
			p.MealsDelivered++
		case "plan_credit":
			p.Credits.Days += number(e, "days")
			switch e.Refs["kind"] {
			case "carried":
				p.Credits.CarriedPaise += number(e, "amountPaise")
			case "refunded":
				p.Credits.RefundedPaise += number(e, "amountPaise")
			}
		case "plan_cancel":
			p.Cancelled++
		case "plan_lapse":
			if e.Refs["period"] != "0" {
				p.Lapsed++
			}
		}
	}
	return p
}
