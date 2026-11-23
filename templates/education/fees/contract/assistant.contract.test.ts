// The shop's assistant on a Fees centre, its money paths on the wire (23 Nov 2026): what test/assistant.test.ts and test/assistant-money.test.ts prove on the dev harness, held
// here as contract cases so they run on both runtimes and survive the deletion of the TypeScript runtime (the owner's rule: never prune the only check on money, limits or
// approvals). owner.contract.test.ts keeps the first two ("who owes fees" with a waiver card's Approve, and "cancel f-2"); these are the rest:
//   - a waiting waiver's Refuse is the owner's own "deny q-1" (nothing waived, the parent told), and the owner's page lists it as the Fees skill's;
//   - a cancel card made before a payment is void on its tap (nothing waived; a new card for the new balance), and a refund of an open fee asks for the cancel first;
//   - a refund card on a Razorpay centre: nothing before the tap; above the limit Guard HOLDS exactly the card's amount; Guard's approval releases it once; the payment is then
//     already going back, so no second card;
//   - a refund card on a UPI centre: the owner owes it (the agent never sends money), marked as owed with a code;
//   - a message card to a parent sends the owner's words as typed, after the centre's name;
//   - the morning line counts the fees not paid and what they owe.
// Expected words are words.ts's (SKILL_ASK.fees, SKILL_REFUSAL.fees, BASE_ASK, done) and templates.ts MORNING_PARTS.owes.
import { after, describe } from "node:test";
import assert from "node:assert/strict";
import { MIN, OWNER_NUMBER, ROHAN, contract, lines, makeCentre, sleep } from "./harness.ts";
import type { Centre, CentreOptions } from "./harness.ts";
import { MORNING_TEMPLATE_OF, templateNameOf } from "../../../../modules/assistant/templates.ts";

const centres: Centre[] = [];
after(async () => { for (const c of centres) await c.cleanup(); });

/** A centre on the wire (guards mode) with the shop's assistant, its two earlier months open (f-1 Meera's September, ₹1,500; f-2 Rohan's, ₹1,800). */
async function centre(o: CentreOptions = {}): Promise<Centre> {
  const c = await makeCentre({ mode: "guards", ...o, settings: { assistant: {}, ...(o.settings ?? {}) } }); centres.push(c);
  await c.start();
  await c.waitFor(() => lines(c, "open_fee", "confirmed").length === 2, "the two earlier months opened");
  return c;
}
const texts = (c: Centre, to: string): string[] => c.sent(to).map((m) => m.text);
const last = (c: Centre, to: string): string => texts(c, to).at(-1) ?? "";
const cards = (c: Centre) => c.sent(OWNER_NUMBER).filter((m) => m.interactive?.buttons?.some((b: { id: string }) => b.id.startsWith("card-")));
const lastCard = (c: Centre) => cards(c).at(-1)!;
const links = (c: Centre) => c.guards!.standins.fakes.payments.links();
const linkOf = (c: Centre, ref: string) => links(c).find((l) => l.reference_id === ref);
async function pays(c: Centre, ref: string, amountPaise?: number): Promise<void> {
  const events = c.guards!.pay(linkOf(c, ref)!.id, amountPaise !== undefined ? { amountPaise } : {});
  assert.equal((await c.events(events.map((event) => ({ kind: "payment_event", event })))).status, 200);
  await c.settle();
}
/** The newest one-use code the owner was given for `fee` ("received K7M2QX" in the owner's message). */
function codeFor(c: Centre, fee: string): string {
  for (const t of texts(c, OWNER_NUMBER).reverse()) { if (!t.includes(fee)) continue; const m = /received ([A-Z0-9]{4,})/u.exec(t); if (m) return m[1]; }
  throw new Error(`the owner was given no code for ${fee}`);
}

describe("the shop's assistant on a Fees centre: what waits", () => {
  contract("a waiting waiver is on the owner's page as the Fees skill's; the card's Refuse is the owner's own 'deny q-1': nothing is waived and the parent is told", async () => {
    const c = await centre();
    await c.inbound(ROHAN, "please waive ₹500");
    const app = (await c.ownerView()).body.app;
    assert.deepEqual(app.waiting.map((w: { case: string; kind: string; amountPaise: number; skill: string; yes: string; no: string }) => [w.case, w.kind, w.amountPaise, w.skill, w.yes, w.no]), [["f-2", "waiver", 50000, "fees", "approve", "deny"]]);
    await c.inbound(OWNER_NUMBER, "what needs me");
    const card = lastCard(c);
    assert.match(card.text, /^Waive ₹500 of Rohan Mehta's fee \(Sep 2026, f-2\)\?\n/u);
    assert.equal(card.interactive.buttons.length, 2);
    await c.tap(card.interactive.buttons[1].id, { from: OWNER_NUMBER });
    assert.equal(lines(c, "owner_decision", "confirmed").filter((l) => l.refs.command === "deny").length, 1);
    assert.equal(lines(c, "waive_fee").length, 0, "nothing waived");
    assert.ok(lines(c, "owner_card", "confirmed").some((l) => l.refs.decision === "no" && l.refs.sent === "deny"));
    assert.deepEqual((await c.ownerView()).body.app.waiting, [], "nothing waits any more");
  });
});

describe("the shop's assistant on a Fees centre: cancel and refund", () => {
  contract("a cancel card made before a payment is void on its tap (nothing waived, a new card for the new balance); a refund of a fee still open asks for the cancel first", async () => {
    const c = await centre({ example: "razorpay" });
    await c.inbound(ROHAN, "pay");
    await c.inbound(OWNER_NUMBER, "cancel f-2");
    const old = lastCard(c);
    assert.match(old.text, /^Cancel fee f-2 \(Rohan Mehta, Sep 2026\)/u);
    await pays(c, "f-2.1", 90000);
    await c.tap(old.interactive.buttons[0].id, { from: OWNER_NUMBER });
    assert.equal(lines(c, "waive_fee").length, 0, "the balance changed, so the old card did nothing");
    assert.deepEqual((await c.status()).fees, { open: 2 });
    assert.ok(lines(c, "owner_card", "blocked").some((l) => l.refs.decision === "yes"), "the old card's yes is refused in the record");
    assert.notEqual(lastCard(c).interactive.buttons[0].id, old.interactive.buttons[0].id, "a new card for the fee as it is now");
    await c.inbound(OWNER_NUMBER, "refund f-2");
    assert.equal(last(c, OWNER_NUMBER), "Fee f-2 is still open. To give the payment back, cancel it first: cancel f-2.");
    assert.equal(c.guards!.of("payments", "POST", /\/refund$/u).length, 0);
  });

  contract("a refund card on a Razorpay centre: nothing before the tap; above the limit Guard holds exactly the card's amount; Guard's approval releases it once; no second card", async () => {
    const c = await centre({ example: "razorpay" });
    await c.inbound(ROHAN, "pay");
    await pays(c, "f-2.1");
    assert.deepEqual((await c.status()).fees, { open: 1, paid: 1 });
    await c.inbound(OWNER_NUMBER, "refund f-2");
    const card = lastCard(c);
    assert.match(card.text, /^Refund ₹1,800 of the fee to Rohan Mehta \(f-2\)\?\nIt is above your limit/u);
    assert.equal(c.guards!.of("payments", "POST", /\/refund$/u).length, 0, "nothing before the tap");
    await c.tap(card.interactive.buttons[0].id, { from: OWNER_NUMBER });
    const calls = c.guards!.of("payments", "POST", /\/refund$/u);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].status, 202, "held by the Guard");
    const paymentId = linkOf(c, "f-2.1")!.payments[0].id;
    assert.deepEqual(calls[0].body, { amount: 180000, receipt: `f-2:${paymentId}` });
    assert.ok(texts(c, OWNER_NUMBER).some((t) => /^The refund of ₹1,800 for f-2 is above your limit/u.test(t)), "the owner is told Guard asks them once more");
    assert.ok(lines(c, "owner_card", "confirmed").some((l) => l.refs.result === "held_by_guard"));
    const [review] = c.guards!.stub.model.reviews("x", true);
    assert.equal(c.guards!.stub.model.decide(review.id, true, "owner-contract").status, 200);
    await c.events([{ kind: "approval_decision", approval: review.id, decision: "approve", id: "d-1" }]); await c.settle();
    assert.deepEqual(c.guards!.standins.fakes.payments.refunds().map((r: { amount: number }) => r.amount), [180000], "released once, for the card's amount");
    const before = cards(c).length;
    await c.inbound(OWNER_NUMBER, "refund f-2");
    assert.equal(cards(c).length, before, "the payment is already going back: no second card");
    assert.equal(last(c, OWNER_NUMBER), "The payment on fee f-2 is already going back, so I can't refund it again from here. Please tell the parent yourself.");
    assert.equal(c.guards!.standins.fakes.payments.refunds().length, 1);
  });

  contract("a refund card on a UPI centre: the owner owes it (the agent sends no money), recorded as owed with a code; whole rupees only, never above the payment", async () => {
    const c = await centre();
    await c.inbound(ROHAN, "please send the payment link");
    await c.inbound(OWNER_NUMBER, `received ${codeFor(c, "f-2")}`);
    assert.deepEqual((await c.status()).fees, { open: 1, paid: 1 });
    await c.inbound(OWNER_NUMBER, "refund f-2 ₹2,000");
    assert.equal(last(c, OWNER_NUMBER), "That is more than was paid on f-2 (₹0).");
    await c.inbound(OWNER_NUMBER, "refund f-2 ₹500");
    const card = lastCard(c);
    assert.match(card.text, /^Refund ₹500 of the fee to Rohan Mehta \(f-2\)\?\nTap a button/u, "a UPI owner's own refund is never above their limit");
    assert.equal(lines(c, "upi_refund_owed").length, 0, "nothing before the tap");
    await c.tap(card.interactive.buttons[0].id, { from: OWNER_NUMBER });
    const owed = lines(c, "upi_refund_owed", "held_for_owner");
    assert.equal(owed.length, 1);
    assert.deepEqual([owed[0].booking, owed[0].refs.amountPaise], ["f-2", "50000"]);
    assert.ok(texts(c, OWNER_NUMBER).some((t) => /^Please send ₹500 back to Rohan Mehta \(f-2\) from your UPI app/u.test(t)), texts(c, OWNER_NUMBER).join("\n---\n"));
    assert.ok(lines(c, "owner_card", "confirmed").some((l) => l.refs.result === "owed_by_owner"));
  });
});

describe("the shop's assistant on a Fees centre: a message and the morning line", () => {
  contract("'message f-2 ...' is a card; its Send gives the parent the owner's words as typed, after the centre's name", async () => {
    const c = await centre();
    await c.inbound(ROHAN, "hello");
    await c.inbound(OWNER_NUMBER, "message f-2 Class is at 5 today");
    const card = lastCard(c);
    assert.match(card.text, /^Send this to Rohan Mehta \(f-2\)\?\n“Class is at 5 today”/u);
    await c.tap(card.interactive.buttons[0].id, { from: OWNER_NUMBER });
    assert.equal(last(c, ROHAN), "Message from Bright Tuition Centre (UPI): Class is at 5 today");
    assert.match(last(c, OWNER_NUMBER), /^Sent to Rohan Mehta \(f-2\)\./u);
  });

  // The owner has not written when the first beat makes the line, so it goes as its approved template (Fees' stand-in has not approved the assistant's templates, and Meta refuses
  // one with no picture anyway: talk.contract.test.ts in the Bookings contract says why); what is held here is what the centre asks the provider to send, on both runtimes.
  contract("the morning line counts the fees not paid and what they owe, in the template's values with the centre's name first; not again the same hour", async () => {
    const india = new Date(Date.now() + 330 * MIN);
    const at = `${String(india.getUTCHours()).padStart(2, "0")}:${String(Math.max(0, india.getUTCMinutes() - 1)).padStart(2, "0")}`;
    const c = await centre({ settings: { assistant: { morning: { at } } } });
    const morning = () => c.guards!.of("messaging", "POST").filter((x) => x.body.to === OWNER_NUMBER && x.body.template?.name === templateNameOf(MORNING_TEMPLATE_OF.warm));
    await c.waitFor(() => morning().length === 1, "the morning line");
    const values = morning()[0].body.template.components.filter((x: { type: string }) => x.type === "body").flatMap((x: { parameters: { text: string }[] }) => x.parameters.map((p) => p.text));
    assert.equal(values[0], "Bright Tuition Centre (UPI)", "the centre's name first, as the template's order has it");
    assert.ok(values.includes("fees not paid: 2 (₹3,300)"), JSON.stringify(values));
    assert.ok(lines(c, "send_message").some((l) => l.refs.morning !== undefined && l.outcome === "attempted"), "claimed in the record before it went");
    await sleep(2500);
    assert.equal(morning().length, 1, "not again the same hour");
  });
});
