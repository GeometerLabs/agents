// The approvals relay for Orders: the shared relay (modules/approvals/relay.ts) with Orders' words and facts given to it.
//
// A refund above the shop's refund limit is held by Guard, not by the agent. The relay is what asks the owner, once, in the owner's language: the exact amount, the customer's
// number and the order, all read from the payment record Guard holds and the runtime's order (never from anything a customer typed), with a fresh one-use code. The owner's
// reply ("approve K7M2QX" or "deny K7M2QX") reaches the relay straight from the inbox; the relay gives Guard the owner's signed answer, tells the runtime, and tells the owner
// what happens next. Guard releases the refund only when the runtime sends the identical call again.
//
// What this does NOT cover: an order above the owner's approval line, and a refund after a late cancellation. Neither is held by Guard (no money has moved, or the refund is
// within the limit), so they are the agent's own question to the owner ("approve o-2"), answered in the ordinary conversation.
import * as shared from "../../../../modules/approvals/relay.ts";
import type { Ask } from "../../../../modules/approvals/store.ts";
import type { RefundContext } from "../../../../modules/approvals/clients.ts";
import { checkMessage } from "../src/language/check.ts";
import { templateMessage } from "../src/language/meta-templates.ts";
import { TEMPLATE_NAMES, render } from "../src/language/templates.ts";
import type { MessageFacts, TemplateId } from "../src/language/templates.ts";

export type { Relay, RelayStatus } from "../../../../modules/approvals/relay.ts";
export type RelayOptions = Omit<shared.RelayOptions, "voice">;

/** What Orders' relay says to the owner: the templates in src/language/templates.ts, checked against the order's facts like every other message. */
export const ordersVoice: shared.RelayVoice<MessageFacts> = {
  render: (ids, facts) => ids.map((id) => render(id as TemplateId, facts)).join(" "),
  check: (text, facts) => checkMessage(text, facts),
  templateMessage: (a) => templateMessage({ ...a, ids: a.ids as TemplateId[] }),
  ownerTemplate: TEMPLATE_NAMES.owner,
  factsFor(ask: Ask, c: RefundContext): MessageFacts {
    // The runtime must say which day the order is for: a context without it is not one the relay can word, and the owner is not asked (the builder is told).
    if (c.slotMs === undefined || c.slotMs === 0) throw new Error("the runtime's order does not name its slot, so the request cannot be worded");
    return {
      language: c.ownerLanguage, timeZone: c.timeZone, businessName: c.businessName, menu: [], dateMs: c.slotMs, slotFromMs: c.slotMs, customerPhone: c.customerPhone,
      refundInr: ask.amountPaise / 100, orderRef: c.booking, approvalHours: ask.approvalHours, ...(ask.code ? { approvalCode: ask.code } : {}),
    };
  },
  ids: { ask: "owner_refund_needs_approval", expired: "owner_approval_expired", failed: "owner_approval_failed", done: "owner_approval_done", denied: "owner_approval_denied", waiting: "owner_approval_waiting", closed: "owner_approval_closed", refused: "owner_approval_refused" },
};

export function createRelay(options: RelayOptions): shared.Relay {
  return shared.createRelay({ ...options, voice: ordersVoice });
}
