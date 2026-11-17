// What Fees hands the accounting core (modules/accounting): its own action names, frozen, so the core can read a record written before the core existed.
//
// Why here and not in the module: a module imports nothing from a template (modules/test/boundary.test.ts), and only the template knows which of its persisted
// action names were money. The map is frozen: new lines carry `refs.money` (modules/accounting/post.ts) and never need it. A payment is for a fee
// (`record_payment` confirmed; `owner_marked_paid` is the owner's UPI mark, or their cash or bank mark with refs.via "cash" or "bank"), `open_fee` charges the month's
// fee, `add_late_fee` a late fee, and `waive_fee` is a discount on what the parent owes.
import type { Clock } from "../../../../modules/core/clock.ts";
import { createAccounting } from "../../../../modules/accounting/post.ts";
import type { Accounting } from "../../../../modules/accounting/post.ts";
import { journal } from "../../../../modules/accounting/journal.ts";
import type { Journal, LegacyMap } from "../../../../modules/accounting/journal.ts";
import type { RecordEntry } from "../../../../modules/record/record.ts";

export const FEES_LEGACY: LegacyMap = Object.freeze({
  received: Object.freeze([
    Object.freeze({ action: "record_payment", outcome: "confirmed", for: "fee" }),
    Object.freeze({ action: "owner_marked_paid", outcome: "confirmed", for: "fee" }),
  ]),
  feeCharged: "open_fee",
  lateFee: "add_late_fee",
  discount: "waive_fee",
}) as LegacyMap;

/** The journal of a record's entries, read with Fees' own action names: what the page's receipts, the owner's Money section and the accountant's files are built from. */
export const feesJournal = (entries: readonly RecordEntry[]): Journal => journal(entries, FEES_LEGACY);

/** The centre's accounting over the same record the agent's `log` appends to. */
export const feesAccounting = (o: { record: { entries(): readonly RecordEntry[] }; timezone: string; clock: Clock }): Accounting =>
  createAccounting({ record: o.record, shop: { timezone: o.timezone }, legacy: FEES_LEGACY, clock: o.clock });

/**
 * The fees that are old dues, read from the record: each back due was opened once by an `open_fee` line that says `backDue: "true"` and the month it is for (agent.ts
 * openMonthlyFees). Fee id -> month ("2026-09"). The owner decided (17 Nov 2026) that old dues are told apart in the report and marked in the accountant's files, never
 * posted differently, so this is the one place that says which lines belong to one.
 */
export function oldDueMonths(entries: readonly RecordEntry[]): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  for (const e of entries) if (e.action === "open_fee" && e.outcome === "confirmed" && e.refs.backDue === "true" && e.booking && e.refs.month) out.set(e.booking, e.refs.month);
  return out;
}

/** The month an entry's old due is for, or undefined when the entry is not on an old due (what modules/accounting/export.ts `oldDueOf` wants). */
export function oldDueOf(entries: readonly RecordEntry[]): (e: RecordEntry) => string | undefined {
  const months = oldDueMonths(entries);
  return (e) => (e.booking ? months.get(e.booking) : undefined);
}
