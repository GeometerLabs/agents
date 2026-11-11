// A refund a PERSON settled as made, told apart from a refund the payments service confirmed (B75; follow-up 5, 12 Nov 2026). Used by the three templates' monthly
// report data (report/data.ts): what they count as "given back" is only what the payments service's own record confirmed; what a person at the server settled by their
// word (Guard's `already_done`, modules/payments/refunds.ts settledByPerson) is counted on its own, with who said so, and never as a refund made.
//
// How the record tells them apart: a person's settlement is a `refund` / `confirmed` line with `refs.confirmedBy` (who, as Guard names them: `operator:<admin id>`)
// and no `refs.refundId`, because the payments service's list never showed it. A line the provider's list or its refund.done event confirmed carries the provider's
// refund id and never `confirmedBy`. This file only reads lines; how a document shows them ("settled by <who>, by their word") is the presentation's.
import type { RecordEntry } from "../record/record.ts";

/** One person's settlements in the period: who (as the record names them), how many payments, and the amount the record kept for them, in paise. */
export interface SettledByWord { by: string; count: number; paise: number }

/** Is this line a refund a person settled as made, by their word (no provider refund id)? Such a line is never a refund made. */
export function isSettledByWord(e: Pick<RecordEntry, "action" | "outcome" | "refs">): boolean {
  const by = e.refs.confirmedBy;
  return e.action === "refund" && e.outcome === "confirmed" && typeof by === "string" && by !== "" && e.refs.refundId === undefined;
}

/**
 * The settlements by a person's word among `entries` (the report passes the month's), grouped by who, each payment once (a payment is settled once: it is then never
 * asked about again), sorted by who so the signed bytes do not depend on the record's order. A line with no amount still counts, with nothing added, and is reported
 * in `missingAmounts` so the report can say its total is short, as it does for refunds.
 */
export function settledByWordOf(entries: readonly RecordEntry[]): { rows: SettledByWord[]; missingAmounts: number } {
  const byWho = new Map<string, SettledByWord>();
  const seen = new Set<string>();
  let missingAmounts = 0;
  for (const e of entries) {
    if (!isSettledByWord(e)) continue;
    const key = e.refs.paymentId ?? `seq-${e.seq}`; // by payment, not by line: two lines about one payment are one settlement
    if (seen.has(key)) continue;
    seen.add(key);
    const by = e.refs.confirmedBy as string;
    const row = byWho.get(by) ?? { by, count: 0, paise: 0 };
    row.count++;
    const paise = e.refs.amountPaise === undefined ? NaN : Number(e.refs.amountPaise);
    if (Number.isInteger(paise) && paise >= 0) row.paise += paise; else missingAmounts++;
    byWho.set(by, row);
  }
  return { rows: [...byWho.values()].sort((a, b) => (a.by < b.by ? -1 : a.by > b.by ? 1 : 0)), missingAmounts };
}
