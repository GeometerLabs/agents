// The approvals relay for Bookings: the shared relay (modules/approvals/relay.ts) with Bookings' words and facts given to it.
import * as shared from "../../../../modules/approvals/relay.ts";
import type { Ask } from "../../../../modules/approvals/store.ts";
import type { RefundContext } from "../../../../modules/approvals/clients.ts";
import { checkMessage } from "../src/language/check.ts";
import { templateMessage } from "../src/language/meta-templates.ts";
import { TEMPLATE_NAMES, render } from "../src/language/templates.ts";
import type { MessageFacts, TemplateId } from "../src/language/templates.ts";

export type { Relay, RelayStatus } from "../../../../modules/approvals/relay.ts";
export type RelayOptions = Omit<shared.RelayOptions, "voice">;

/** What Bookings' relay says to the owner: the templates in src/language/templates.ts, checked against the booking's facts like every other message. */
export const bookingsVoice: shared.RelayVoice<MessageFacts> = {
  render: (ids, facts) => ids.map((id) => render(id as TemplateId, facts)).join(" "),
  check: (text, facts) => checkMessage(text, facts),
  templateMessage: (a) => templateMessage({ ...a, ids: a.ids as TemplateId[] }),
  ownerTemplate: TEMPLATE_NAMES.owner,
  factsFor: (ask: Ask, c: RefundContext): MessageFacts => ({
    language: c.ownerLanguage, timeZone: c.timeZone, businessName: c.businessName, services: [], serviceName: c.serviceName, slotMs: c.slotMs,
    customerPhone: c.customerPhone, refundInr: ask.amountPaise / 100, bookingRef: c.booking, approvalHours: ask.approvalHours, ...(ask.code ? { approvalCode: ask.code } : {}),
  }),
  ids: { ask: "owner_refund_needs_approval", expired: "owner_approval_expired", failed: "owner_approval_failed", done: "owner_approval_done", denied: "owner_approval_denied", waiting: "owner_approval_waiting", closed: "owner_approval_closed", refused: "owner_approval_refused" },
};

export function createRelay(options: RelayOptions): shared.Relay {
  return shared.createRelay({ ...options, voice: bookingsVoice });
}
