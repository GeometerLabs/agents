// What Fees' monthly report says in its signed summary link (item 17b): templates/education/fees/report/summary.ts. Layout 4 (internal/report LAYOUTS): the report's cards and the owner's
// WhatsApp lines, read from the report itself so the summary always says what the signed page says; a month in which old dues were paid uses layout 7 (layout 4 plus "oldDues" last; the
// owner's decision, 17 Nov 2026). Fees has no monthly record certificate yet, so there is one summary only. The format and the signing are internal/report.
package feesreport

import "github.com/GeometerLabs/agents/go/internal/report"

// ReportSummaryFields is reportSummaryFields: collected, given back, still to collect, reminders sent, taken off fees, asked, approved, said no, stopped by limits (and old dues collected).
// Money is what the owner marked for a UPI centre. A report that names no one who set the agent up carries an empty `by` (the TypeScript's null).
func ReportSummaryFields(r *Report) report.SummaryFields {
	by := ""
	if r.PreparedBy != nil {
		by = *r.PreparedBy
	}
	layout := 4
	figures := []int64{r.Money.Collected.Paise, r.Money.GivenBack.Paise, r.Fees.StillToCollect.Paise, int64(r.Reminders.Sent), r.Waivers.Total.Paise, int64(r.Owner.Asked),
		int64(r.Owner.Approved), int64(r.Owner.Denied), int64(r.Stopped.Total)}
	if r.Money.OldDues != nil {
		layout = 7
		figures = append(figures, r.Money.OldDues.Paise)
	}
	return report.SummaryFields{Layout: layout, Source: r.Source, OwnerMarked: r.UPI(), Period: report.PeriodOf(r.Period), Pathway: r.Pathway.Name, Shop: r.ShopName, By: by, Figures: figures}
}
