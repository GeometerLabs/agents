// The Orders monthly report as the JSON tree that is sealed (data.ts's object, key for key): the one place that decides which keys are written and which are left out, so the signed bytes are
// the TypeScript's. See the header of data.go for the rule (absent optional keys are spreads in the TypeScript; explicit nulls are nulls). A tree is map[string]any with ints, strings,
// bools, nil, []any and json.Number (from jsonTree): exactly what report.CanonicalJSON writes. The go-live finding's tree and the anchor's are Bookings' (the same shared types).
package ordersreport

import (
	"github.com/GeometerLabs/agents/go/internal/bookingsreport"
	"github.com/GeometerLabs/agents/go/internal/report"
)

// Tree is the report as the tree that is sealed.
func (r *Report) Tree() map[string]any {
	byAction := report.ByActionTree(r.Record.ByAction)
	period := report.PeriodTree(r.Period, r.From, r.To)
	money := map[string]any{"collected": report.AmountTree(r.Money.Collected), "givenBack": report.AmountTree(r.Money.GivenBack)}
	if r.Money.BalanceCollected != nil {
		money["balanceCollected"] = report.AmountTree(*r.Money.BalanceCollected)
	}
	if len(r.Money.SettledByWord) > 0 {
		rows := make([]any, len(r.Money.SettledByWord))
		for i, w := range r.Money.SettledByWord {
			rows[i] = map[string]any{"by": w.By, "count": w.Count, "paise": w.Paise}
		}
		money["settledByWord"] = rows
	}
	if r.Money.BooksOnly != nil {
		money["booksOnly"] = report.JSONTree(r.Money.BooksOnly)
	}
	items := make([]any, len(r.Sold.Items))
	for i, it := range r.Sold.Items {
		names := map[string]any{}
		for l, n := range it.Names {
			names[l] = n
		}
		items[i] = map[string]any{"id": it.ID, "names": names, "qty": it.Qty}
	}
	byRule := map[string]any{}
	for k, v := range r.Stopped.ByRule {
		byRule[k] = v
	}
	out := map[string]any{
		"format":       formatReport,
		"pathway":      map[string]any{"name": r.Pathway.Name, "version": r.Pathway.Version},
		"source":       r.Source,
		"shop":         map[string]any{"name": r.ShopName, "timeZone": r.TimeZone, "languages": report.StringsTree(r.Languages), "ownerLanguage": r.OwnerLang},
		"preparedBy":   report.StrTree(r.PreparedBy),
		"period":       period,
		"madeAt":       r.MadeAt,
		"policyDigest": r.PolicyDig,
		"record":       map[string]any{"entries": r.Record.Entries, "digest": r.Record.Digest, "byAction": byAction},
		"money":        money,
		"orders":       map[string]any{"taken": r.Orders.Taken, "completed": r.Orders.Completed, "cancelled": r.Orders.Cancelled, "holdsRanOut": r.Orders.HoldsRanOut},
		"sold":         map[string]any{"orders": r.Sold.Orders, "pickup": r.Sold.Pickup, "delivery": r.Sold.Delivery, "items": items, "toCollect": report.AmountTree(r.Sold.ToCollect)},
		"owner":        map[string]any{"asked": r.Owner.Asked, "approved": r.Owner.Approved, "denied": r.Owner.Denied},
		"customers":    map[string]any{"stopped": r.Customers.Stopped},
		"stopped":      map[string]any{"total": r.Stopped.Total, "byRule": byRule},
		"messages":     map[string]any{"toOwner": r.Messages.ToOwner, "heldBack": r.Messages.HeldBack},
		"unconfirmed":  map[string]any{"open": r.Unconfirmed.Open},
		"notCounted":   report.StringsTree(r.NotCounted),
		"notTested":    report.StringsTree(r.NotTested),
		"goLive":       bookingsreport.GoLiveTree(r.GoLive),
		"anchor":       r.Anchor.Tree(),
	}
	if r.Innovator {
		out["innovator"] = true
	}
	if r.PaidBy != "" {
		out["paidBy"] = r.PaidBy
	}
	if r.Accounting != nil {
		out["accounting"] = report.JSONTree(r.Accounting)
	}
	if r.Plans != nil {
		p := r.Plans
		out["plans"] = map[string]any{"active": p.Active, "started": p.Started, "renewals": p.Renewals, "mealsDelivered": p.MealsDelivered,
			"credits": map[string]any{"days": p.Credits.Days, "carriedPaise": p.Credits.CarriedPaise, "refundedPaise": p.Credits.RefundedPaise}, "cancelled": p.Cancelled, "lapsed": p.Lapsed}
	}
	return out
}
