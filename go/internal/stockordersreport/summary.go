// What the Stock orders monthly report says in its signed summary link: templates/commerce/stock-orders/report/summary.ts. Layout 6 (internal/report LAYOUTS): the report's counts and the
// owner's text lines, read from the report itself so the summary always says what the signed page says. The only money figure is the budget the approved orders hold; it is not money the
// owner marked, so the summary is not "owner marked". The format and the signing are internal/report.
package stockordersreport

import "github.com/GeometerLabs/agents/go/internal/report"

// ReportSummaryFields is reportSummaryFields: placed, supplier said OK, received in full, part received, wrong item, supplier said no, no answer, cancelled or never sent, budget used
// (paise), marked paid by the owner, stopped by limits. A report that names no one who set the agent up carries an empty `by` (the TypeScript's null).
func ReportSummaryFields(r *Report) report.SummaryFields {
	by := ""
	if r.PreparedBy != nil {
		by = *r.PreparedBy
	}
	o := &r.Orders
	return report.SummaryFields{Layout: 6, Source: r.Source, OwnerMarked: false, Period: report.PeriodOf(r.Period), Pathway: r.Pathway.Name, Shop: r.ShopName, By: by,
		Figures: []int64{int64(o.Placed), int64(o.Acknowledged), int64(o.ReceivedFull), int64(o.PartReceived), int64(o.WrongItem), int64(o.DeclinedBySupplier), int64(o.Silent),
			int64(o.NeverSent), r.Budget.UsedPaise, int64(r.MarkedPaidByOwner), int64(r.Stopped.Total)}}
}
