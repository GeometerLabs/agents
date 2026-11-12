// An order as an explicit state machine, the stock and the day's count worked out from the orders themselves, and the conversation state the agent keeps (the store).
//
//   enquiry ─► awaiting_owner ─► awaiting_advance ─► confirmed ─► completed
//      │            │              │   │                │
//      ▼            ▼              │   ▼                ▼
//   cancelled    cancelled         │ expired ─► awaiting_advance (a late payment, stock and cut-off still allow it)
//                                  │     └────► cancelled
//                                  └────► cancelled
//
// "confirmed" is only ever reached through the payment record: the agent moves an order there after the payments service's own list (or, for UPI, the owner's mark) shows the
// whole advance. It is never reached from what a customer says.
//
// Stock and the day's order count are NOT counters. They are worked out each time from the orders that hold them (confirmed ones, and ones waiting for their advance whose
// hold has not run out). So an expired hold, a cancellation, or a restart from the saved store can never leave a number that disagrees with the orders.
import { formatDate, formatTime } from "../../../../modules/language/format.ts";
import type { Language } from "../../../../modules/language/languages.ts";
import { addDays, localParts, sameDate, zonedToMs, parseClock, timeFromMinutes } from "../../../../modules/core/time.ts";
import type { LocalDate } from "../../../../modules/core/time.ts";
import type { GuardHold, RefundIssue, RefundRetry, UntoldRefund } from "../../../../modules/payments/refunds.ts";
import type { AssistantState } from "../../../../modules/assistant/state.ts";
import type { MarkState } from "../../../../modules/payments/owner-marked/ledger.ts";
import { ownerMarkedOf } from "../../../../modules/payments/providers/index.ts";
import type { AiState } from "../../../../modules/understanding/ai-state.ts";
import type { ChannelState } from "../../../../modules/channels/state.ts";
import { advanceFor, cutoffOf, itemName, itemOf, slotOf } from "./settings.ts";
import type { Settings } from "./settings.ts";
import type { MessageFacts } from "./language/templates.ts";

export type OrderState = "enquiry" | "awaiting_owner" | "awaiting_advance" | "confirmed" | "expired" | "cancelled" | "completed";

const TRANSITIONS: Record<OrderState, OrderState[]> = {
  enquiry: ["awaiting_owner", "awaiting_advance", "cancelled"],
  awaiting_owner: ["awaiting_advance", "enquiry", "cancelled"],
  awaiting_advance: ["confirmed", "expired", "cancelled", "enquiry"], // enquiry: the link failed, start again
  confirmed: ["cancelled", "completed"],
  expired: ["awaiting_advance", "cancelled"], // a payment that arrives late
  cancelled: [],
  completed: [],
};

/** The states in which an order is still the customer's current business. */
export const LIVE_STATES: OrderState[] = ["enquiry", "awaiting_owner", "awaiting_advance", "confirmed"];

export const canMove = (from: OrderState, to: OrderState): boolean => from === to || TRANSITIONS[from].includes(to);

/** Move an order to a new state, refusing any move the flow does not allow. */
export function moveTo(order: Order, to: OrderState): void {
  if (!canMove(order.state, to)) throw new Error(`An order cannot go from ${order.state} to ${to}.`);
  order.state = to;
}

/**
 * Something waiting for an answer, or for another try.
 *  - refund: the owner's own call about a refund WITHIN the limit (a late cancellation), asked by the agent as "approve o-3".
 *  - big_order: an order above the owner's approval line: "approve o-3" lets the customer pay for it, "deny o-3" refuses it. Nothing is held and no link is made until then.
 *  - guard_hold, refund_retry: a refund Guard is holding for the owner, and a refund that could not be sent at all (modules/payments/refunds.ts).
 */
export type Pending =
  | { kind: "refund"; amountInr: number; paymentId: string; reason: "late_cancellation"; askedAtMs?: number }
  | { kind: "big_order"; totalInr: number; askedAtMs: number }
  | GuardHold
  | RefundRetry;

export interface OrderLine { itemId: string; qty: number }

export interface Order {
  id: string; // "o-1": also the payment link's reference_id
  customer: string;
  language: Language;
  state: OrderState;
  lines: OrderLine[];
  // what the customer asked for, as the agent understood it
  date?: LocalDate;
  dateNeedsConfirmation: boolean; // a weekday phrase: read it back and wait for a yes
  mode?: "pickup" | "delivery";
  slotId?: string;
  /** The slots a name the customer wrote ("lunch") stands for, kept until the way (pickup or delivery) says which. */
  slotCandidates?: string[];
  /** A delivery whose address has not been given yet: the next plain message is the address. */
  awaitingAddress: boolean;
  /** The place in the shop's delivery list the address named; the address as the customer wrote it (cut short), for the owner only. */
  area?: string;
  address?: string;
  slotStartMs?: number;
  slotEndMs?: number;
  /** When orders for this day and slot close, worked out when the slot was fixed. */
  cutoffMs?: number;
  // what the services' records say
  totalInr?: number;
  advanceInr?: number;
  holdExpiresAt?: number;
  linkId?: string;
  linkUrl?: string;
  advancePaymentId?: string;
  handledPayments: string[]; // payments already dealt with (the advance, or an extra one that was refunded or sent to the owner)
  pending: Pending[];
  refundIssues?: RefundIssue[];
  /** Payments the agent must not ask Guard to refund again: the owner said no, the outcome is unclear, it failed for good, or the approval ran out. */
  stoppedRefunds?: string[];
  /** Refunds the payments service's list settled whose customer has not been told yet (modules/payments/refunds.ts): listed on the to-do list until a message is accepted. */
  refundsUntold?: UntoldRefund[];
  /** UPI: when the owner was last told that this customer says they paid (at most once an hour). */
  claimTellAtMs?: number;
  /**
   * Item 11h: an order made on the shop's page or its API ("web") or through the MCP endpoint ("mcp"). Its `customer` is then the channel's conversation ("web:<16
   * hex>", modules/channels/conversation.ts), never the typed number, so nothing finds it by number and nothing is sent to that number on WhatsApp.
   */
  channel?: "web" | "mcp";
  /** Item 11h: the hash of the order's handle (modules/channels/handle.ts): the only thing that reaches it from the page, the API or MCP. */
  handle?: string;
  /** Item 11h: the name and number the customer typed (not verified): what the owner sees, and what the per-number limits count. */
  contact?: { name?: string; phone: string };
}

export interface Customer {
  phone: string;
  language?: Language;
  optedOut: boolean;
  /** When this customer last asked to talk to the owner (the owner is told at most once an hour about the same person). */
  ownerAskedAtMs?: number;
}

/** All the conversation state. It is passed in, never global, so every scenario starts clean. */
export interface Store {
  orders: Map<string, Order>;
  customers: Map<string, Customer>;
  seenMessages: Set<string>; // WhatsApp message ids already handled
  seenEvents: Set<string>; // payment event ids already handled
  nextOrder: number;
  /** The month's AI spend and button-mode notices. Left out until the first message. */
  ai?: AiState;
  /** An owner-marked shop's requests, the owner's marks and the refunds the owner owes (modules/payments/owner-marked/ledger.ts). Kept under `upi`, as it always was. Left out until the first request. */
  upi?: MarkState;
  /** Item 11e: the shop's assistant's own part (its cards and undo; modules/assistant/state.ts). Left out until the owner first talks to it. */
  assistant?: AssistantState;
  /** Item 11h: the shop page's, the API's and the MCP endpoint's messages and requests (modules/channels/state.ts). Left out until the first one. */
  channel?: ChannelState;
}

export function createStore(): Store {
  return { orders: new Map(), customers: new Map(), seenMessages: new Set(), seenEvents: new Set(), nextOrder: 1 };
}

export function newDraft(customer: string, language: Language): Order {
  return { id: "", customer, language, state: "enquiry", lines: [], dateNeedsConfirmation: false, awaitingAddress: false, handledPayments: [], pending: [] };
}

/**
 * The delivery address, as the customer wrote it, is kept on the order for the owner while the order is being done. Once the order is over and its slot ended before
 * `beforeMs`, only its place on the delivery list (`area`) stays: the words are deleted (the runtime's daily compaction, modules/runtime/core.ts). Returns how many.
 */
export function compactFinishedOrders(store: Store, beforeMs: number): number {
  let n = 0;
  for (const o of store.orders.values()) {
    if (o.address === undefined || o.slotEndMs === undefined || o.slotEndMs >= beforeMs) continue;
    if (o.state !== "completed" && o.state !== "cancelled" && o.state !== "expired") continue;
    delete o.address;
    n++;
  }
  return n;
}

/** Give a draft its id and keep it. */
export function register(store: Store, order: Order): Order {
  order.id = `o-${store.nextOrder++}`;
  store.orders.set(order.id, order);
  return order;
}

/** The customer's most recent order in one of these states. */
export function latestOrder(store: Store, customer: string, states: OrderState[]): Order | undefined {
  return [...store.orders.values()].reverse().find((o) => o.customer === customer && states.includes(o.state));
}

// ---- the money, whole rupees ------------------------------------------------------------------------------------------

export const totalOf = (settings: Settings, lines: readonly OrderLine[]): number => lines.reduce((n, l) => n + (itemOf(settings, l.itemId)?.priceInr ?? 0) * l.qty, 0);
export const countOf = (lines: readonly OrderLine[]): number => lines.reduce((n, l) => n + l.qty, 0);

/** Add a line, or more of the same item. */
export function addLine(lines: OrderLine[], itemId: string, qty: number): void {
  const found = lines.find((l) => l.itemId === itemId);
  if (found) found.qty += qty;
  else lines.push({ itemId, qty });
}

// ---- stock and the day's count, derived ------------------------------------------------------------------------------

/** Does this order hold stock and a place in the day's count right now? Confirmed ones always; one waiting for its advance until its hold runs out. */
export function holdsStock(o: Order, nowMs: number): boolean {
  return o.state === "confirmed" || (o.state === "awaiting_advance" && o.holdExpiresAt !== undefined && o.holdExpiresAt > nowMs);
}

const sameDay = (a: LocalDate | undefined, b: LocalDate): boolean => a !== undefined && sameDate(a, b);

/** How many of an item are taken for a day, by the other orders that hold stock. */
export function takenOf(store: Store, date: LocalDate, itemId: string, nowMs: number, exceptId = ""): number {
  let n = 0;
  for (const o of store.orders.values()) if (o.id !== exceptId && sameDay(o.date, date) && holdsStock(o, nowMs)) n += o.lines.filter((l) => l.itemId === itemId).reduce((s, l) => s + l.qty, 0);
  return n;
}

/** How many orders hold a place in the day's count. */
export function ordersOn(store: Store, date: LocalDate, nowMs: number, exceptId = ""): number {
  let n = 0;
  for (const o of store.orders.values()) if (o.id !== exceptId && sameDay(o.date, date) && holdsStock(o, nowMs)) n++;
  return n;
}

// ---- the slot, the cut-off and what a message may say ----------------------------------------------------------------

/** Fix the slot's moments for the order: the date's start and end of the window, and the cut-off. Needs a date and a slot. */
export function fixSlot(settings: Settings, o: Order): boolean {
  const found = slotOf(settings, o.slotId);
  if (!found || !o.date) return false;
  const at = (clock: string, date: LocalDate) => zonedToMs(date, timeFromMinutes(parseClock(clock)!), settings.timezone);
  const cut = cutoffOf(settings, found.slot);
  o.mode = found.mode;
  o.slotStartMs = at(found.slot.from, o.date);
  o.slotEndMs = at(found.slot.to, o.date);
  o.cutoffMs = at(cut.time, addDays(o.date, -cut.daysBefore));
  return true;
}

/** The moments of every slot of a mode on a date, for a message that offers slots. */
export function slotMoments(settings: Settings, mode: "pickup" | "delivery", date: LocalDate): { id: string; fromMs: number; toMs: number }[] {
  const slots = mode === "pickup" ? settings.pickup.slots : settings.delivery?.slots ?? [];
  return slots.map((s) => ({ id: s.id, fromMs: zonedToMs(date, timeFromMinutes(parseClock(s.from)!), settings.timezone), toMs: zonedToMs(date, timeFromMinutes(parseClock(s.to)!), settings.timezone) }));
}

/** The order as a line of words, from the record: "2 × Veg thali, 1 × Curd". */
export const itemsText = (settings: Settings, lines: readonly OrderLine[], language: Language): string =>
  lines.map((l) => `${l.qty} × ${itemName(itemOf(settings, l.itemId)!, language)}`).join(", ");

/** The values of this order's record that a message may use. Everything comes from the order and the settings, never from message text. */
export function factsFor(settings: Settings, order: Order | null, language: Language, extra: { customerPhone?: string; refundInr?: number; menu?: boolean; areas?: boolean; slotChoices?: { fromMs: number; toMs: number }[]; upiCode?: string; markedInr?: number; leftInr?: number; itemId?: string; leftCount?: number; nowMs?: number } = {}): MessageFacts {
  const payTo = ownerMarkedOf(settings.payment)?.payTo; // who the customer pays, when the owner marks payments (B71)
  const item = extra.itemId ? itemOf(settings, extra.itemId) : undefined;
  const dateMs = order?.date ? zonedToMs(order.date, { hour: 0, minute: 0 }, settings.timezone) : undefined;
  const total = order?.totalInr ?? (order && order.lines.length > 0 ? totalOf(settings, order.lines) : undefined);
  const advance = order?.advanceInr ?? (total !== undefined ? advanceFor(settings, total) : undefined);
  return {
    language,
    timeZone: settings.timezone,
    businessName: settings.name,
    // Only the menu may state every item's price; any other message may state this order's own items and nothing else.
    menu: (extra.menu ? settings.menu : []).map((i) => ({ name: itemName(i, language), priceInr: i.priceInr })),
    ...(extra.areas && settings.delivery ? { areas: settings.delivery.area } : {}),
    ...(order && order.lines.length > 0 ? { itemsText: itemsText(settings, order.lines, language), quantities: order.lines.map((l) => l.qty) } : {}),
    ...(item ? { itemName: itemName(item, language), priceInr: item.priceInr } : {}),
    ...(extra.leftCount !== undefined ? { leftCount: extra.leftCount } : {}),
    totalInr: total,
    advanceInr: advance,
    balanceInr: total !== undefined && advance !== undefined ? total - advance : undefined,
    refundInr: extra.refundInr,
    dateMs,
    slotFromMs: order?.slotStartMs,
    slotToMs: order?.slotEndMs,
    cutoffMs: order?.cutoffMs,
    ...(extra.slotChoices ? { slotChoices: extra.slotChoices } : {}),
    mode: order?.mode,
    area: order?.area,
    address: order?.address,
    link: order?.linkUrl,
    holdMinutes: order?.holdExpiresAt !== undefined && order.state === "awaiting_advance" && extra.nowMs !== undefined ? Math.max(1, Math.round((order.holdExpiresAt - extra.nowMs!) / 60_000)) : settings.advance.holdMinutes,
    windowHours: settings.cancellation.windowHours,
    maxItems: settings.orders.maxItemsPerOrder,
    orderRef: order?.id || undefined,
    customerPhone: extra.customerPhone ?? order?.customer,
    ...(payTo ? { upiId: payTo.id, payee: payTo.name } : {}),
    ...(extra.upiCode ? { upiCode: extra.upiCode } : {}),
    ...(extra.markedInr !== undefined ? { markedInr: extra.markedInr } : {}),
    ...(extra.leftInr !== undefined ? { leftInr: extra.leftInr } : {}),
  };
}

/** The date and window as a customer reads them, for the report and the tests. */
export const slotText = (settings: Settings, o: Order, language: Language): string =>
  o.slotStartMs === undefined || o.slotEndMs === undefined ? "" : `${formatDate(localParts(o.slotStartMs, settings.timezone), language)} ${formatTime(localParts(o.slotStartMs, settings.timezone), language)}–${formatTime(localParts(o.slotEndMs, settings.timezone), language)}`;

