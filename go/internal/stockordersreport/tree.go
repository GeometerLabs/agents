// The Stock orders monthly report as the JSON tree that is sealed (data.ts's object, key for key): the one place that decides which keys are written and which are left out, so the signed
// bytes are the TypeScript's. See the header of data.go for the rule (the optional `innovator` is a spread in the TypeScript; explicit nulls are nulls). A tree is map[string]any with ints,
// strings, bools, nil and []any: exactly what report.CanonicalJSON writes. The go-live finding's tree and the anchor's are Bookings' (the same shared types).
package stockordersreport

import (
	"github.com/GeometerLabs/agents/go/internal/bookingsreport"
	"github.com/GeometerLabs/agents/go/internal/report"
)

// Tree is the report as the tree that is sealed.
func (r *Report) Tree() map[string]any {
	byAction := report.ByActionTree(r.Record.ByAction)
	var preparedBy any
	if r.PreparedBy != nil {
		preparedBy = *r.PreparedBy
	}
	period := report.PeriodTree(r.Period, r.From, r.To)
	suppliers := make([]any, len(r.Suppliers))
	for i, s := range r.Suppliers {
		suppliers[i] = map[string]any{"id": s.ID, "name": s.Name, "placed": s.Placed, "acknowledged": s.Acknowledged, "receivedFull": s.ReceivedFull, "partReceived": s.PartReceived,
			"wrongItem": s.WrongItem, "declined": s.Declined, "silent": s.Silent}
	}
	byRule := map[string]any{}
	for k, v := range r.Stopped.ByRule {
		byRule[k] = v
	}
	o := &r.Orders
	out := map[string]any{
		"format":       formatReport,
		"pathway":      map[string]any{"name": r.Pathway.Name, "version": r.Pathway.Version},
		"source":       r.Source,
		"shop":         map[string]any{"name": r.ShopName, "timeZone": r.TimeZone, "languages": report.StringsTree(r.Languages), "ownerLanguage": r.OwnerLang},
		"preparedBy":   preparedBy,
		"period":       period,
		"madeAt":       r.MadeAt,
		"policyDigest": r.PolicyDig,
		"record":       map[string]any{"entries": r.Record.Entries, "digest": r.Record.Digest, "byAction": byAction},
		"orders": map[string]any{"placed": o.Placed, "sentOut": o.SentOut, "acknowledged": o.Acknowledged, "declinedBySupplier": o.DeclinedBySupplier, "silent": o.Silent,
			"receivedFull": o.ReceivedFull, "partReceived": o.PartReceived, "wrongItem": o.WrongItem, "neverSent": o.NeverSent, "sendUnknown": o.SendUnknown},
		"owner":             map[string]any{"asked": r.Owner.Asked, "approved": r.Owner.Approved, "saidNo": r.Owner.SaidNo, "voided": r.Owner.Voided},
		"markedPaidByOwner": map[string]any{"orders": r.MarkedPaidByOwner},
		"budget":            map[string]any{"monthlyPaise": r.Budget.MonthlyPaise, "usedPaise": r.Budget.UsedPaise, "leftPaise": r.Budget.LeftPaise},
		"suppliers":         suppliers,
		"stopped":           map[string]any{"total": r.Stopped.Total, "byRule": byRule},
		"unconfirmed":       map[string]any{"open": r.UnconfirmedOpen},
		"notCounted":        report.StringsTree(r.NotCounted),
		"notTested":         report.StringsTree(r.NotTested),
		"goLive":            bookingsreport.GoLiveTree(r.GoLive),
		"anchor":            r.Anchor.Tree(),
	}
	if r.Innovator {
		out["innovator"] = true
	}
	return out
}
