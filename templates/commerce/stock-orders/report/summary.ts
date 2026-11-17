// What the Stock orders monthly report says in its signed summary link (the format is modules/report/summary.ts): layout 6, the report's counts and the owner's text lines,
// read from the report itself so the summary always says what the signed page says. The go-live certificate's summary is the same for every template (goLiveSummaryFields in
// modules/report/summary-sign.ts). The only money figure is the budget the approved orders hold; it is not money the owner marked, so the summary is not "owner marked".
// Used by report/run.ts.
import { periodOf } from "../../../../modules/report/summary-sign.ts";
import type { SummaryFields } from "../../../../modules/report/summary-sign.ts";
import type { StockReport } from "./data.ts";

/** Placed, supplier said OK, received in full, part received, wrong item, supplier said no, no answer, cancelled or never sent, budget used (paise), marked paid by the owner, stopped by limits. */
export function reportSummaryFields(r: StockReport): SummaryFields {
  const o = r.orders;
  return {
    layout: 6, source: r.source, ownerMarked: false, period: periodOf(r.period), pathway: r.pathway.name, shop: r.shop.name, by: r.preparedBy,
    figures: [o.placed, o.acknowledged, o.receivedFull, o.partReceived, o.wrongItem, o.declinedBySupplier, o.silent, o.neverSent, r.budget.usedPaise, r.markedPaidByOwner.orders, r.stopped.total],
  };
}
