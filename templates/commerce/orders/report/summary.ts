// What Orders' monthly report says in its signed summary link (item 17b; the format is modules/report/summary.ts): layout 5, the report's cards and the owner's
// WhatsApp lines, read from the report itself so the summary always says what the signed page says. The go-live certificate's summary is the same for every
// template (goLiveSummaryFields in modules/report/summary-sign.ts). Orders has no monthly record certificate yet (report/certificate.ts). Used by report/run.ts.
import { periodOf } from "../../../../modules/report/summary-sign.ts";
import type { SummaryFields } from "../../../../modules/report/summary-sign.ts";
import type { OrdersReport } from "./data.ts";

/** Collected, given back, still to collect, orders taken, cancelled, asked, approved, said no, stopped by limits. Money is what the owner marked for a UPI shop. */
export function reportSummaryFields(r: OrdersReport): SummaryFields {
  return {
    layout: 5, source: r.source, ownerMarked: r.paidBy === "owner-marked", period: periodOf(r.period), pathway: r.pathway.name, shop: r.shop.name, by: r.preparedBy,
    figures: [r.money.collected.paise, r.money.givenBack.paise, r.sold.toCollect.paise, r.orders.taken, r.orders.cancelled, r.owner.asked, r.owner.approved, r.owner.denied, r.stopped.total],
  };
}
