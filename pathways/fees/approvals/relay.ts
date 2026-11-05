// The approvals relay for Fees: the shared relay (modules/approvals/relay.ts) with Fees' words and facts given to it.
//
// A refund above the centre's refund limit is held by Guard, not by the agent. The relay is what asks the owner, once, in the owner's language: the exact amount, the
// parent's number, the student and the month, all read from the payment record Guard holds and the runtime's fee (never from anything a parent typed), with a fresh
// one-use code. The owner's reply ("approve K7M2QX" or "deny K7M2QX") reaches the relay straight from the inbox; the relay gives Guard the owner's signed answer, tells the
// runtime, and tells the owner what happens next. Guard releases the refund only when the runtime sends the identical call again.
//
// What this does NOT cover: a waiver. Guard holds a refund, not a smaller payment link, so a waiver above the centre's waiver limit is the agent's own question to the
// owner ("approve q-2"), answered in the ordinary conversation, and applied only if the fee is still exactly as it was when the owner was asked.
import * as shared from "../../../modules/approvals/relay.ts";
import type { Ask } from "../../../modules/approvals/store.ts";
import type { RefundContext } from "../../../modules/approvals/clients.ts";
import { checkMessage } from "../src/language/check.ts";
import { templateMessage } from "../src/language/meta-templates.ts";
import { TEMPLATE_NAMES, render } from "../src/language/templates.ts";
import type { MessageFacts, TemplateId } from "../src/language/templates.ts";

export type { Relay, RelayStatus } from "../../../modules/approvals/relay.ts";
export type RelayOptions = Omit<shared.RelayOptions, "voice">;

/** What Fees' relay says to the owner: the templates in src/language/templates.ts, checked against the fee's facts like every other message. */
export const feesVoice: shared.RelayVoice<MessageFacts> = {
  render: (ids, facts) => ids.map((id) => render(id as TemplateId, facts)).join(" "),
  check: (text, facts) => checkMessage(text, facts),
  templateMessage: (a) => templateMessage({ ...a, ids: a.ids as TemplateId[] }),
  ownerTemplate: TEMPLATE_NAMES.owner,
  factsFor(ask: Ask, c: RefundContext): MessageFacts {
    // The runtime must say who and for which month: a context without them is not one the relay can word, and the owner is not asked (the builder is told).
    if (c.studentName === undefined || c.monthLabel === undefined) throw new Error("the runtime's fee does not name the student and the month, so the request cannot be worded");
    return {
      language: c.ownerLanguage, timeZone: c.timeZone, businessName: c.businessName, studentName: c.studentName, ...(c.batchName !== undefined ? { batchName: c.batchName } : {}),
      monthLabel: c.monthLabel, customerPhone: c.customerPhone, refundInr: ask.amountPaise / 100, dueRef: c.booking, approvalHours: ask.approvalHours, ...(ask.code ? { approvalCode: ask.code } : {}),
    };
  },
  ids: { ask: "owner_refund_needs_approval", expired: "owner_approval_expired", failed: "owner_approval_failed", done: "owner_approval_done", denied: "owner_approval_denied" },
};

export function createRelay(options: RelayOptions): shared.Relay {
  return shared.createRelay({ ...options, voice: feesVoice });
}
