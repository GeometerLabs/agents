// A purchase order and the store the agent keeps it in. The order is one exact thing: a supplier, one catalogue line (item, unit), a whole quantity, the unit price and the
// total in paise, worked out here in code. Everything the owner approves is these fields, and the approval card is bound to them (agent.ts).
//
// Three questions that are different things and are kept as different fields, never folded into one "status":
//   - did the supplier accept it?   `ack`      (the supplier's own reply, from the supplier's own number)
//   - did the goods come?           `receipt`  (the owner marks it: full, part, wrong item)
//   - was it paid?                  `paidOutsideMs` (the owner says they paid; this agent never pays anyone)
// "Supplier accepted" is not "received", and "received" is not "paid".
//
// The month's budget is NOT a counter. It is worked out from the orders every time (reservedPaise): an order holds budget from the moment the owner approves it until it is
// cancelled, declined by the supplier or never sent, so a crash, a restart or a race cannot leave a number that disagrees with the orders.
import { localParts } from "../../../../modules/core/time.ts";
import type { AiState } from "../../../../modules/understanding/ai-state.ts";
import type { AssistantState } from "../../../../modules/assistant/state.ts";
import type { Reminder } from "../../../../modules/reminders/reminders.ts";
import type { CardAction } from "../../../../modules/assistant/state.ts";
import { lineKey, paise, supplierOf } from "./settings.ts";
import type { Line, Settings } from "./settings.ts";

export type OrderState =
  | "awaiting_approval" // a card is open; nothing is reserved, nothing is sent
  | "declined" // the owner said no
  | "void" // the card ran out, or the order changed and its card was replaced by a new order card
  | "approved" // approved and budget reserved; the order message is being sent
  | "sent" // the provider took the order message
  | "send_unknown" // the provider's reply was lost: it may have gone out. Never sent again as an order; the supplier is asked about it
  | "send_failed" // the provider refused it: nothing went out; the owner may send it again
  | "send_blocked" // a check held it back (the supplier opted out, the text did not match the record)
  | "supplier_declined" // the supplier said they cannot supply it: the budget is released
  | "cancelled"; // the owner cancelled it before it went out: the budget is released

export type Ack = "none" | "accepted" | "declined";
export type Receipt = "none" | "part" | "full" | "wrong_item";

export interface PurchaseOrder {
  /** "po-3". Named in the supplier's message and the owner's card, so the reply can be tied to the order. */
  id: string;
  /** The owner's inbound WhatsApp message that asked for it: one request makes at most one order. */
  requestId: string;
  lowStock: boolean;
  supplier: string;
  /** lineKey(): item, supplier and unit of the catalogue line at the time of the request. */
  line: string;
  item: string;
  unit: string;
  qty: number;
  unitPaise: number;
  totalPaise: number;
  state: OrderState;
  createdMs: number;
  /** When the owner approved it and the budget was reserved, and the month it counts against ("2026-11"). */
  approvedMs?: number;
  budgetMonth?: string;
  sentMs?: number;
  ack: Ack;
  ackMs?: number;
  receipt: Receipt;
  receivedQty: number;
  receiptMs?: number;
  paidOutsideMs?: number;
  /** When the supplier is asked again (reminders/reminders.ts); the last one also tells the owner. */
  asks: Reminder[];
  silentToldMs?: number;
  /** When the owner asked the supplier again from their page (about this same order). */
  askedMs?: number;
}

/** What the agent is waiting for the owner to answer, when it had to ask: never guessed. */
export interface Asking {
  kind: "line" | "qty";
  /** The request it is for. */
  requestId: string;
  lowStock: boolean;
  item: string;
  qty?: number;
  /** The catalogue lines the owner may pick from (lineKeys). */
  options: string[];
  askedMs: number;
}

export interface Store {
  orders: Map<string, PurchaseOrder>;
  /** The owner's message ids already handled, in order, and the order each made: a message delivered twice makes nothing twice. */
  handled: Set<string>;
  requests: Map<string, string>;
  asking?: Asking;
  optedOut: Set<string>;
  seq: number;
  /** The approval cards (modules/assistant/cards.ts): kept in the same store, so a card and the order it is for change together. */
  assistant?: AssistantState;
  /** The month's AI counts (modules/understanding/ai-state.ts): the runtime keeps them with the store. Left out until the first message is read. */
  ai?: AiState;
}

export const createStore = (): Store => ({ orders: new Map(), handled: new Set(), requests: new Map(), optedOut: new Set(), seq: 0 });

export function nextOrderId(store: Store): string {
  store.seq += 1;
  return `po-${store.seq}`;
}

/** "2026-11": the month a moment is in, in the shop's time zone. */
export function monthOf(ms: number, timeZone: string): string {
  const p = localParts(ms, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}`;
}

/** Orders that hold budget: approved, and not cancelled or declined by the supplier. (An order that never went out and was cancelled gives its budget back.) */
const HOLDS_BUDGET: ReadonlySet<OrderState> = new Set(["approved", "sent", "send_unknown", "send_failed", "send_blocked"]);
export const holdsBudget = (o: PurchaseOrder): boolean => o.approvedMs !== undefined && HOLDS_BUDGET.has(o.state);

/** What the month's approved orders add up to, in paise, worked out from the orders. `except` leaves one order out (the one being decided). */
export function reservedPaise(store: Store, month: string, except?: string): number {
  let sum = 0;
  for (const o of store.orders.values()) if (o.id !== except && o.budgetMonth === month && holdsBudget(o)) sum += o.totalPaise;
  return sum;
}

/** The total of a line for a whole quantity, in paise: price (in paise) times quantity. The only place a total is made. */
export const totalOfPaise = (unitPaise: number, qty: number): number => unitPaise * qty;
export const unitPaiseOf = (line: Line): number => paise(line.priceInr);

/** Is this order still to arrive: approved, dispatched or being dispatched, not declined, and the goods not all in (or wrong). */
export const isOpen = (o: PurchaseOrder): boolean => HOLDS_BUDGET.has(o.state) && o.receipt !== "full" && o.receipt !== "wrong_item";

/** Orders with a supplier that has not answered yet: the ones a bare "ok" from that supplier could mean. */
export const unansweredFor = (store: Store, supplier: string): PurchaseOrder[] =>
  [...store.orders.values()].filter((o) => o.supplier === supplier && o.ack === "none" && (o.state === "sent" || o.state === "send_unknown"));

/** The same catalogue line, as the settings hold it now (its price may have changed since the order was made). */
export const currentLine = (settings: Settings, o: PurchaseOrder): Line | undefined => settings.catalogue.find((l) => lineKey(l) === o.line);

export const orderRefOf = (text: string): string | undefined => /\bpo-?\s*(\d{1,6})\b/iu.exec(text)?.[1] ? `po-${/\bpo-?\s*(\d{1,6})\b/iu.exec(text)![1]}` : undefined;

/** The assistant's and the agent's skill name: the record's `skill` ref and the card's. */
export const SKILL = "stock-orders";

/**
 * The exact action an approval card is bound to: the supplier and its number, the item, the unit, the quantity, the unit price and total in paise, the currency and the budget
 * month, read from the order and the catalogue line as they are NOW. One place: the agent's own card, the assistant's card for the same order and the owner page's item all
 * use it, so a card made by any of them has the same digest and a change under any of them voids all of them.
 */
export function approvalAction(settings: Settings, o: PurchaseOrder, line: Line, nowMs: number): CardAction {
  return {
    kind: "order", skill: SKILL, case: o.id,
    fields: { supplier: o.supplier, supplierWhatsapp: supplierOf(settings, o.supplier).whatsapp, item: o.item, unit: o.unit, qty: o.qty, unitPaise: unitPaiseOf(line), totalPaise: totalOfPaise(unitPaiseOf(line), o.qty), currency: "INR", month: monthOf(nowMs, settings.timezone) },
  };
}
