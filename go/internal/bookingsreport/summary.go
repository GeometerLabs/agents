// What Bookings' papers say in their signed summary link (item 17b): templates/commerce/bookings/report/summary.ts. The monthly report's figures (layout 1) and the monthly record
// certificate's (layout 2), read from the paper itself, so the summary always says what the signed page says. The go-live certificate's summary is the same for every template
// (report.GoLiveSummaryFields). The format and the signing are internal/report (summary.go, summarysign.go).
package bookingsreport

import "github.com/GeometerLabs/agents/go/internal/report"

// ReportSummaryFields is reportSummaryFields: bookings made, deposits, given back, stopped by limits, asked, approved, said no, not confirmed (the owner's WhatsApp lines).
func ReportSummaryFields(r *MonthlyReport) report.SummaryFields {
	by := ""
	if r.PreparedBy != nil {
		by = *r.PreparedBy
	}
	return report.SummaryFields{Layout: 1, Source: r.Source, OwnerMarked: r.UPI(), Period: report.PeriodOf(r.Period), Pathway: r.Pathway.Name, Shop: r.ShopName, By: by,
		Figures: []int64{int64(r.Bookings.Made), r.Money.Deposits.Paise, r.Money.Refunds.Paise, int64(r.Stopped.Total), int64(r.Owner.Asked), int64(r.Owner.Approved), int64(r.Owner.Denied), int64(r.Unconfirmed.OpenOnBookings)}}
}

// CertificateSummaryFields is certificateSummaryFields: the monthly record certificate, what it says was counted, in the order its page lists it.
func CertificateSummaryFields(c *MonthlyCertificate) report.SummaryFields {
	n := c.Counted
	by := ""
	if c.PreparedBy != nil {
		by = *c.PreparedBy
	}
	return report.SummaryFields{Layout: 2, Source: c.Source, OwnerMarked: c.UPI(), Period: report.PeriodOf(c.Report.Period), Pathway: c.Pathway.Name, Shop: c.ShopName, By: by,
		Figures: []int64{int64(n.BookingsMade), int64(n.Cancelled), n.DepositsPaise, n.RefundsPaise, int64(n.Asked), int64(n.Approved), int64(n.Denied), int64(n.Stopped), int64(n.UnconfirmedOpen)}}
}
