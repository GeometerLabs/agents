// What Orders hands the accounting core (modules/accounting): its own action names, frozen, so the core can read a record written before the core existed.
//
// Why here and not in the module: a module imports nothing from a template (modules/test/boundary.test.ts), and only the template knows which of its persisted
// action names were money. The map is frozen: new lines carry `refs.money` (modules/accounting/post.ts) and never need it. `record_payment` confirmed is the
// advance, `record_payment` blocked is a second payment (given back, never revenue), `owner_marked_paid` is a UPI advance the owner marked, and `complete_order`
// applies the advance the order then holds.
import type { Clock } from "../../../../modules/core/clock.ts";
import { createAccounting } from "../../../../modules/accounting/post.ts";
import type { Accounting } from "../../../../modules/accounting/post.ts";
import type { LegacyMap } from "../../../../modules/accounting/journal.ts";
import type { RecordEntry } from "../../../../modules/record/record.ts";

export const ORDERS_LEGACY: LegacyMap = Object.freeze({
  received: Object.freeze([
    Object.freeze({ action: "record_payment", outcome: "confirmed", for: "advance" }),
    Object.freeze({ action: "record_payment", outcome: "blocked", for: "extra" }),
    Object.freeze({ action: "owner_marked_paid", outcome: "confirmed", for: "advance" }),
  ]),
  applied: Object.freeze([Object.freeze({ action: "complete_order", account: "revenue:orders" })]),
}) as LegacyMap;

/** The shop's accounting over the same record the agent's `log` appends to. */
export const ordersAccounting = (o: { record: { entries(): readonly RecordEntry[] }; timezone: string; clock: Clock }): Accounting =>
  createAccounting({ record: o.record, shop: { timezone: o.timezone }, legacy: ORDERS_LEGACY, clock: o.clock });
