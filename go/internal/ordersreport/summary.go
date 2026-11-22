// What Orders' monthly report says in its signed summary link (item 17b): templates/commerce/orders/report/summary.ts. Layout 5 (internal/report LAYOUTS): the report's cards and the owner's
// WhatsApp lines, read from the report itself so the summary always says what the signed page says. Orders has no monthly record certificate (report/certificate.ts is the go-live
// certificate), so there is one summary only; the go-live certificate's is the same for every template (report.GoLiveSummaryFields). The format and the signing are internal/report.
package ordersreport

import "github.com/GeometerLabs/agents/go/internal/report"

// ReportSummaryFields is reportSummaryFields: collected, given back, still to collect, orders taken, cancelled, asked, approved, said no, stopped by limits. Money is what the owner marked for
// a UPI shop. A report that names no one who set the agent up carries an empty `by` (the TypeScript's null).
func ReportSummaryFields(r *Report) report.SummaryFields {
	by := ""
	if r.PreparedBy != nil {
		by = *r.PreparedBy
	}
	return report.SummaryFields{Layout: 5, Source: r.Source, OwnerMarked: r.UPI(), Period: report.PeriodOf(r.Period), Pathway: r.Pathway.Name, Shop: r.ShopName, By: by,
		Figures: []int64{r.Money.Collected.Paise, r.Money.GivenBack.Paise, r.Sold.ToCollect.Paise, int64(r.Orders.Taken), int64(r.Orders.Cancelled), int64(r.Owner.Asked), int64(r.Owner.Approved),
			int64(r.Owner.Denied), int64(r.Stopped.Total)}}
}
