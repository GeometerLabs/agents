// What the owner's private page shows for a Stock orders shop (modules/channels/owner-page.ts), read from the saved store and nothing else: the orders that wait for the
// owner's yes, the orders no supplier has answered, and the deliveries to mark. Pure, with no disk and no server import (src/ is also the browser demo's agent).
//
// Each item carries `case` and `digest`: a button posts both, and the agent (agent.ts onOwnerAction) does the thing only while the item it finds now has that digest, so a
// press for something that has changed since (a new quantity, an answer already given on WhatsApp) does nothing, and the same press twice is done once.
// An approval is the agent's own approval card: its case is the card's id and its digest the card's own, so the page answers it through the same judge as a tap
// (cards.ts judgeCard). The assistant's app would list that card too; the runtime takes it out of the app's list (server/runtime.ts) so one order is never shown twice.
import { createHash } from "node:crypto";
import type { OwnerItemView, OwnerView } from "../../../../modules/channels/backend.ts";
import { openCards } from "../../../../modules/assistant/cards.ts";
import type { AssistantState } from "../../../../modules/assistant/state.ts";
import { SKILL, isOpen } from "./order.ts";
import type { PurchaseOrder, Store } from "./order.ts";
import { itemOf, nameIn, supplierOf, unitOf } from "./settings.ts";
import type { Settings } from "./settings.ts";

export type OwnerItem = OwnerItemView & { kind: "po_approval" | "po_silent" | "po_receive" };

const digestOf = (...parts: (string | number | undefined)[]): string => createHash("sha256").update(parts.map((p) => String(p ?? "")).join("|")).digest("hex").slice(0, 32);

/** What an order is, in the owner's language and nobody else's: "10 box hair colour". The names are the shop's own. */
export const whatOf = (settings: Settings, o: PurchaseOrder): string => {
  const l = settings.owner.language;
  return `${o.qty} ${nameIn(unitOf(settings, o.unit).names, l)} ${nameIn(itemOf(settings, o.item).names, l)}`;
};

/** The three lists, oldest first. `state` is the assistant's state (for the approval cards); left out, there are no approvals to list. */
export function ownerItems(settings: Settings, store: Store, nowMs: number, state?: AssistantState): OwnerItem[] {
  const out: OwnerItem[] = [];
  const open = state ? openCards(state, nowMs).filter((c) => c.action.skill === SKILL && c.action.kind === "order") : [];
  for (const card of open) {
    const o = store.orders.get(card.action.case);
    if (!o || o.state !== "awaiting_approval") continue;
    const supplier = supplierOf(settings, o.supplier);
    out.push({ kind: "po_approval", case: card.id, digest: card.digest, actions: ["card_yes", "card_no"], amountPaise: o.totalPaise, customer: { phone: supplier.whatsapp, name: supplier.name }, channel: "whatsapp", what: `${o.id}: ${whatOf(settings, o)}` });
  }
  for (const o of store.orders.values()) {
    const supplier = supplierOf(settings, o.supplier);
    const customer = { phone: supplier.whatsapp, name: supplier.name };
    if (o.ack === "none" && (o.state === "sent" || o.state === "send_unknown") && o.silentToldMs !== undefined) {
      out.push({ kind: "po_silent", case: o.id, digest: digestOf(o.id, o.state, o.ack, o.askedMs, o.asks.filter((a) => a.sent).length), actions: ["retry"], amountPaise: o.totalPaise, customer, channel: "whatsapp", what: `${o.id}: ${whatOf(settings, o)}` });
    } else if (o.ack === "accepted" && isOpen(o)) {
      out.push({ kind: "po_receive", case: o.id, digest: digestOf(o.id, o.state, o.receipt, o.receivedQty, o.qty), actions: ["received"], amountPaise: o.totalPaise, customer, channel: "whatsapp", what: `${o.id}: ${whatOf(settings, o)}${o.receivedQty > 0 ? ` (${o.receivedQty}/${o.qty})` : ""}` });
    }
  }
  return out;
}

/** The owner read the runtime serves (ChannelKit.owner): the items, and the orders now with suppliers as the page's "coming" list. */
export function ownerView(settings: Settings, store: Store, nowMs: number): OwnerView {
  const upcoming = [...store.orders.values()].filter((o) => (o.state === "sent" || o.state === "send_unknown") && isOpen(o)).map((o) => ({
    case: o.id, startMs: o.sentMs ?? o.createdMs, what: `${o.id}: ${whatOf(settings, o)} · ${supplierOf(settings, o.supplier).name}`,
    customer: { phone: supplierOf(settings, o.supplier).whatsapp, name: supplierOf(settings, o.supplier).name }, channel: "whatsapp" as const, state: o.state,
  }));
  return { shop: { name: settings.name, timezone: settings.timezone, ownerLanguage: settings.owner.language }, kind: "stock", services: [], items: ownerItems(settings, store, nowMs, store.assistant), upcoming };
}
