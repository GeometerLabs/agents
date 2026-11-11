// What Fees' monthly report says in its signed summary link (item 17b; the format is modules/report/summary.ts): layout 4, the report's cards and the owner's
// WhatsApp lines, read from the report itself so the summary always says what the signed page says. The go-live certificate's summary is the same for every
// template (goLiveSummaryFields in modules/report/summary-sign.ts). Fees has no monthly record certificate yet (report/certificate.ts). Used by report/run.ts.
import { periodOf } from "../../../../modules/report/summary-sign.ts";
import type { SummaryFields } from "../../../../modules/report/summary-sign.ts";
import type { FeesReport } from "./data.ts";

/** Collected, given back, still to collect, reminders sent, taken off fees, asked, approved, said no, stopped by limits. Money is what the owner marked for a UPI centre. */
export function reportSummaryFields(r: FeesReport): SummaryFields {
  return {
    layout: 4, source: r.source, ownerMarked: r.paidBy === "owner-marked", period: periodOf(r.period), pathway: r.pathway.name, shop: r.shop.name, by: r.preparedBy,
    figures: [r.money.collected.paise, r.money.givenBack.paise, r.fees.stillToCollect.paise, r.reminders.sent, r.waivers.total.paise, r.owner.asked, r.owner.approved, r.owner.denied, r.stopped.total],
  };
}
