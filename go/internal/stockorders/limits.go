package stockorders

// The limits of Stock orders, as pure functions: the Go twin of src/limits.ts. Each takes the facts it needs and returns a decision { verdict, ruleId, reason } with the
// TypeScript's own reason. They read nothing but their arguments, so the agent calls them in-process and Guard could run the very same checks.
//
//   approved-supplier-only, order-quantity, per-order-cap, monthly-budget, one-order-per-request, approval-matches-order, send-only-when-approved (reply-from-supplier is the
//   agent's number comparison, supplierByNumber).

import (
	"fmt"
	"math"
	"time"

	"github.com/GeometerLabs/agents/go/internal/messaging"
	"github.com/GeometerLabs/agents/go/internal/zone"
)

type decision = messaging.Decision

func allow(rule, reason string) decision { return decision{RuleID: rule, Verdict: "allow", Reason: reason} }
func block(rule, reason string) decision { return decision{RuleID: rule, Verdict: "block", Reason: reason} }

func checkApprovedSupplier(sp *Supplier, named string) decision {
	if sp == nil {
		who := "That supplier"
		if named != "" {
			who = `"` + named + `"`
		}
		return block("approved-supplier-only", who+" is not on the owner's supplier list, so nothing is ordered from them.")
	}
	if !sp.Approved {
		return block("approved-supplier-only", sp.Name+" is on the list but not approved at the moment, so nothing is ordered from them.")
	}
	return allow("approved-supplier-only", sp.Name+" is an approved supplier.")
}

func checkQuantity(qty, maxQ int64) decision {
	if qty < 1 {
		return block("order-quantity", "An order needs a whole quantity of at least 1.")
	}
	if qty > maxQ {
		return block("order-quantity", fmt.Sprintf("%d is more than one order may have (%d). It may be a typing slip.", qty, maxQ))
	}
	return allow("order-quantity", fmt.Sprintf("%d is within the %d one order may have.", qty, maxQ))
}

func checkPerOrderCap(totalPaise int64, capInr float64) decision {
	total := float64(totalPaise) / 100
	if total > capInr {
		return block("per-order-cap", fmt.Sprintf("%s is more than the %s one order may be worth.", money(total), money(capInr)))
	}
	return allow("per-order-cap", fmt.Sprintf("%s is within the %s one order may be worth.", money(total), money(capInr)))
}

func checkMonthlyBudget(totalPaise, reservedPaise int64, budgetInr float64) decision {
	left := math.Max(0, budgetInr*100-float64(reservedPaise))
	if float64(totalPaise) > left {
		return block("monthly-budget", fmt.Sprintf("%s is more than the %s left of this month's %s budget.", money(float64(totalPaise)/100), money(left/100), money(budgetInr)))
	}
	return allow("monthly-budget", fmt.Sprintf("%s is within the %s left of this month's %s budget.", money(float64(totalPaise)/100), money(left/100), money(budgetInr)))
}

func checkOneOrderPerRequest(requestID string, st *Store) decision {
	if made, ok := st.request(requestID); ok && made != "" {
		return block("one-order-per-request", "This request already made order "+made+", so it makes no second one.")
	}
	return allow("one-order-per-request", "This request has made no order yet.")
}

func checkApprovalMatches(same bool, what string) decision {
	if same {
		return allow("approval-matches-order", "The order is exactly what the owner approved.")
	}
	w := ""
	if what != "" {
		w = " (" + what + ")"
	}
	return block("approval-matches-order", "The order changed since the owner saw it"+w+", so that approval does not count and a new one is asked.")
}

func checkSendOnlyWhenApproved(approved bool, sp *Supplier) decision {
	if !approved {
		return block("send-only-when-approved", "The owner has not approved this order, so it is not sent to the supplier.")
	}
	if sp == nil || !sp.Approved {
		return block("send-only-when-approved", "The supplier is not approved at the moment, so the order is not sent.")
	}
	return allow("send-only-when-approved", "The owner approved this order and the supplier is approved.")
}

// proposalChecks is limits.ts proposalChecks: every check an order must pass before its card is shown, in the order they are recorded.
func proposalChecks(s *Settings, sp *Supplier, qty, totalPaise, reservedPaise int64) []decision {
	var named *Supplier
	if sp != nil && sp.ID != "" {
		named = sp
	}
	return []decision{
		checkApprovedSupplier(named, ""),
		checkQuantity(qty, s.Limits.MaxQuantity),
		checkPerOrderCap(totalPaise, s.Limits.MaxPerOrderInr),
		checkMonthlyBudget(totalPaise, reservedPaise, s.Limits.MonthlyBudgetInr),
	}
}

// jsRound is Math.round: half up (towards +infinity), unlike Go's math.Round (half away from zero).
func jsRound(f float64) float64 { return math.Floor(f + 0.5) }

func zoneParts(ms int64, tz string) zone.Parts { return zone.LocalParts(ms, tz) }

func zoneLoc(tz string) *time.Location {
	if l, err := time.LoadLocation(tz); err == nil {
		return l
	}
	return time.UTC
}
