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
