// What Bookings' papers say in their signed summary link (item 17b; the format is modules/report/summary.ts): the monthly report's figures (layout 1) and the
// monthly record certificate's (layout 2), read from the paper itself, so the summary always says what the signed page says. The go-live certificate's summary
// is the same for every template (goLiveSummaryFields in modules/report/summary-sign.ts). Used by report/run.ts when it writes a signed paper.
import { periodOf } from "../../../../modules/report/summary-sign.ts";
import type { SummaryFields } from "../../../../modules/report/summary-sign.ts";
import type { MonthlyCertificate } from "./certificate.ts";
import type { MonthlyReport } from "./data.ts";

/** The monthly report: bookings made, deposits, given back, stopped by limits, asked, approved, said no, not confirmed (the owner's WhatsApp lines). */
export function reportSummaryFields(r: MonthlyReport): SummaryFields {
  return {
    layout: 1, source: r.source, ownerMarked: r.paidBy === "owner-marked", period: periodOf(r.period), pathway: r.pathway.name, shop: r.shop.name, by: r.preparedBy,
    figures: [r.bookings.made, r.money.deposits.paise, r.money.refunds.paise, r.stopped.total, r.owner.asked, r.owner.approved, r.owner.denied, r.unconfirmed.openOnBookings],
  };
}

/** The monthly record certificate: what it says was counted, in the order its page lists it. */
export function certificateSummaryFields(c: MonthlyCertificate): SummaryFields {
  const n = c.counted;
  return {
    layout: 2, source: c.source, ownerMarked: c.paidBy === "owner-marked", period: periodOf(c.period), pathway: c.pathway.name, shop: c.shop.name, by: c.preparedBy,
    figures: [n.bookingsMade, n.cancelled, n.depositsPaise, n.refundsPaise, n.asked, n.approved, n.denied, n.stopped, n.unconfirmedOpen],
  };
}
