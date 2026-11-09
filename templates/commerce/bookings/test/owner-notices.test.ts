// Owner notices outside the owner's 24-hour window. WhatsApp carries only an approved template to someone who has not written to the number
// in the last day, and the owner usually has not. Every notice the agent sends the owner on its own now has a template with fixed wording
// (src/language/meta-templates.ts), so none of them is refused any more. In these tests the owner never writes, so their window is closed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CUSTOMER, OTHER_CUSTOMER, createWorld, glowSalon } from "../src/harness.ts";
import type { World } from "../src/harness.ts";
import type { TemplateMessage } from "../../../../modules/messaging/messaging.ts";
import { checkMessage } from "../src/language/check.ts";
import { fillBody, metaBody } from "../../../../modules/language/meta-templates.ts";
import { META_TEMPLATES, exampleFacts, templateMessage } from "../src/language/meta-templates.ts";
import { TEMPLATES, TEMPLATE_NAMES, render } from "../src/language/templates.ts";
import type { TemplateId } from "../src/language/templates.ts";
import { parseSettings } from "../src/settings.ts";
import { LANGUAGES } from "../../../../modules/language/languages.ts";

const BOOK = "haircut tomorrow at 6pm"; // Wed 4 Nov, 6:00 pm, as the world's clock starts on Tue 3 Nov
const WHEN = "Wed 4 Nov, 6:00 pm";

async function bookAndPay(w: World): Promise<void> {
  await w.say(BOOK);
  w.payments.customerPays(w.linkFor("b-1")!.id);
  await w.deliverPaymentEvents();
}

interface Scenario { name: string; template: string; world?: () => World; run(w: World): Promise<void>; says: string }
const customer = `\\${CUSTOMER}`; // +91... in a regular expression

const SCENARIOS: Scenario[] = [
  { name: "the slot could not be held", template: "owner_not_booked", says: `^Could not set up ${customer}'s haircut on ${WHEN}: the calendar or the payment link did not work\\. Nothing is booked\\.$`,
    run: async (w) => { w.calendar.inject("insert", "silentFailure", { times: 2 }); await w.say(BOOK); } },
  { name: "the payment link could not be made", template: "owner_not_booked", says: `^Could not set up ${customer}'s haircut on ${WHEN}: `,
    run: async (w) => { w.payments.inject("createRequest", "error", { times: 10 }); await w.say(BOOK); } },
  { name: "the calendar will not confirm a paid booking", template: "owner_cant_confirm", says: `NOT booked\\..*Reply "retry b-1" .* "approve b-1" `,
    run: async (w) => { await w.say(BOOK); w.calendar.inject("update", "silentFailure", { times: 2 }); w.payments.customerPays(w.linkFor("b-1")!.id); await w.deliverPaymentEvents(); } },
  { name: "a late cancellation, which is the owner's call", template: "owner_late_cancellation", says: `^Customer ${customer} cancelled haircut on ${WHEN} less than 24 hours before the start\\. Deposit ₹200\\. Reply "approve b-1" to refund it or "deny b-1" to keep it\\.$`,
    run: async (w) => { await bookAndPay(w); await w.advance(10 * 60); await w.say("cancel my booking"); } },
  { name: "the deposit was paid twice", template: "owner_paid_twice", says: `^Customer ${customer} paid the deposit twice for haircut on ${WHEN}\\. The extra ₹200 was refunded\\.$`,
    run: async (w) => { await w.say(BOOK); const id = w.linkFor("b-1")!.id; w.payments.customerPays(id); w.payments.customerPays(id); await w.deliverPaymentEvents(); } },
  { name: "a payment arrived after the hold ended and the time was taken", template: "owner_payment_unused", says: `^A ₹200 payment from ${customer} arrived for ${WHEN}, but that booking was no longer active .* ₹200 was refunded\\.$`,
    run: async (w) => {
      w.payments.inject("cancelRequest", "error"); // the link stays open, so the customer can still pay it
      await w.say(BOOK);
      await w.advance(16);
      await w.say(BOOK, { from: OTHER_CUSTOMER });
      w.payments.customerPays(w.linkFor("b-1")!.id);
      await w.deliverPaymentEvents();
    } },
  { name: "moving a booking could not be confirmed", template: "owner_move_failed", says: `^Could not confirm moving ${customer}'s haircut to .* in the calendar\\. Please check their booking\\.$`,
    run: async (w) => { await bookAndPay(w); w.calendar.inject("update", "silentFailure", { times: 3 }); await w.say("reschedule to 7pm"); } },
  { name: "a customer sends STOP", template: "owner_customer_stopped", says: `^Customer ${customer} sent STOP\\. No more messages will go to them\\.$`,
    run: async (w) => { await w.say("STOP"); } },
];

for (const scenario of SCENARIOS) {
  test(`the owner has not written today, and is told by template when ${scenario.name}`, async () => {
    const w = (scenario.world ?? createWorld)();
    const sent: TemplateMessage[] = [];
    const sendTemplate = w.messaging.sendTemplate;
    w.messaging.sendTemplate = (to, t) => { sent.push(t); return sendTemplate(to, t); };
    await scenario.run(w);

    const toOwner = w.messaging.sentTo(w.owner);
    assert.ok(toOwner.length > 0, "the owner heard nothing");
    const notice = toOwner.find((m) => m.templateName === scenario.template);
    assert.ok(notice, `expected the template ${scenario.template}, the owner got: ${toOwner.map((m) => `${m.kind}:${m.templateName}`).join(", ")}`);
    assert.equal(notice.kind, "template");
    assert.match(notice.text, new RegExp(scenario.says, "u"));
    assert.ok(toOwner.every((m) => m.templateName !== TEMPLATE_NAMES.owner), "nothing went out under the generic name, which a real provider refuses");

    // What a real provider receives is the approved wording with the record's values, and it comes out as the text the check read.
    const message = sent.find((t) => t.name === scenario.template)!;
    assert.ok(message.parameters && message.parameters.length > 0);
    const approved = META_TEMPLATES.find((t) => t.name === scenario.template)!;
    assert.equal(fillBody(metaBody(approved.bodies.en), message.parameters), notice.text);
    // and the record shows no send that failed (the owner's used to be recorded as failed: the provider did not know the generic template)
    const ownerIds = toOwner.map((m) => m.id);
    assert.ok(w.record.entries().some((e) => e.action === "send_message" && e.outcome === "confirmed" && ownerIds.includes(e.refs.messageId)), "the owner's notice was read back from the provider's outbox");
    assert.deepEqual(w.record.entries().filter((e) => e.action === "send_message" && e.outcome !== "confirmed").map((e) => [e.outcome, e.notes]), []);
  });
}

test("every notice the agent sends the owner on its own has a template in all four languages, and a template fills to exactly the line the check reads", () => {
  const ownerIds = (Object.keys(TEMPLATES.en) as TemplateId[]).filter((id) => id.startsWith("owner_"));
  // The reply to the owner's own message needs none: they have just written, so their window is open. The approvals relay's answers to
  // "approve <code>" / "deny <code>" are such replies; its first ask (owner_refund_needs_approval) is not, and has its template.
  // UPI (B33): the answers to the owner's own "received <code>" / "refunded <code>" are replies too; the notices the agent sends on its own (what to look for,
  // the customer says they paid, a refund to send and its reminder, the rest of a part) have their templates.
  // B37 (8 Nov): "your approval is in, N more are needed" answers that person's own "approve <code>" too.
  const repliesToTheOwner = ["owner_unknown_command", "owner_approval_done", "owner_approval_denied", "owner_approval_expired", "owner_approval_failed", "owner_approval_waiting",
    "owner_upi_marked", "owner_upi_already", "owner_upi_unknown", "owner_upi_late", "owner_upi_refund_marked", "owner_upi_refund_kept"];
  const needTemplate = ownerIds.filter((id) => !repliesToTheOwner.includes(id));
  assert.deepEqual(needTemplate.filter((id) => !META_TEMPLATES.some((t) => t.usedFor === id)), [], "an owner notice has no template, so it would be refused outside the window");
  for (const id of needTemplate) {
    for (const language of LANGUAGES) {
      const facts = exampleFacts(glowSalon(), language);
      const text = render(id, facts);
      assert.deepEqual(checkMessage(text, facts), { ok: true, problems: [] }, `${id} (${language})`);
      const message = templateMessage({ ids: [id], language, facts, text, generic: TEMPLATE_NAMES.owner });
      assert.notEqual(message.name, TEMPLATE_NAMES.owner, `${id} (${language}) would go out under the generic name`);
      assert.equal(fillBody(metaBody(META_TEMPLATES.find((t) => t.usedFor === id)!.bodies[language]), message.parameters!), text);
    }
  }
  // one template per notice: where one sentence is true of two situations they share one notice (Explanation.md, "Owner notices outside the window")
  assert.equal(META_TEMPLATES.filter((t) => t.audience === "owner").length, needTemplate.length);
});
