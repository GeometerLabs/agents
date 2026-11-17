// The shop's assistant on a Bookings shop (item 11e): the owner's fixed phrases still work, the owner's own words are read, money comes back as a card that only a tap
// does (with the shown amount being the amount sent), a changed amount voids the card, a no is final, free text never executes, closing a day asks the customers and is
// undone, limits are not changed from the chat, and the morning line reads the same store. Uses the dev harness (src/harness.ts) with the in-memory fakes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CUSTOMER, OTHER_CUSTOMER, createWorld } from "../src/harness.ts";
import type { World } from "../src/harness.ts";
import { parseSettings, validateSettings } from "../src/settings.ts";
import { bookingsSkill } from "../src/assistant.ts";
import { ownerItems } from "../src/channel.ts";
import { parseStore, serializeStore } from "../server/snapshot.ts";
import { approvalButtonId } from "../../../../modules/approvals/buttons.ts";
import { createMorningJob } from "../../../../modules/assistant/morning.ts";
import { HOUR, zonedToMs } from "../../../../modules/core/time.ts";
import { LANGUAGES } from "../../../../modules/language/languages.ts";
import type { Store } from "../src/booking.ts";

const glow = () => JSON.parse(readFileSync(new URL("../settings/glow-salon.example.json", import.meta.url), "utf8")) as Record<string, unknown>;
const withAssistant = () => createWorld({ settings: parseSettings({ ...glow(), assistant: {} }) });

const BOOK = "haircut tomorrow at 6pm"; // Wed 4 Nov, 6:00 pm (the world starts Tue 3 Nov, 10:00 in India)
async function bookAndPay(w: World, from = CUSTOMER, ref = "b-1"): Promise<void> {
  await w.say(BOOK, { from });
  w.payments.customerPays(w.linkFor(ref)!.id);
  await w.deliverPaymentEvents();
  assert.equal(w.store.bookings.get(ref)?.state, "confirmed");
}
const owner = (w: World, text: string) => w.say(text, { from: w.owner });
/** The card buttons of the newest card the owner was sent: the yes and the no ids. */
function lastCard(w: World): { yes: string; no?: string; text: string } {
  const card = w.messaging.sentTo(w.owner).filter((m) => m.interactive?.buttons?.some((b) => b.id.startsWith("card-"))).at(-1);
  assert.ok(card, "a card was sent to the owner");
  const buttons = card.interactive!.buttons!;
  return { yes: buttons[0].id, no: buttons[1]?.id, text: card.text };
}
const tapOwner = (w: World, id: string) => w.tap(id, { from: w.owner });
const recordOf = (w: World, action: string) => w.record.entries().filter((e) => e.action === action);

test("without an \"assistant\" block nothing changes: the owner's free words get the usual answer", async () => {
  const w = createWorld();
  await owner(w, "close tomorrow");
  assert.match(w.lastTextTo(w.owner), /^Sorry, I didn't get that\./u);
  assert.equal(w.store.assistant, undefined);
  assert.equal(recordOf(w, "owner_assistant").length, 0);
});

test("the fixed phrases keep working with the assistant on, and the relay's replies (typed or tapped) get no word", async () => {
  const w = withAssistant();
  await bookAndPay(w);
  await owner(w, "tomorrow");
  assert.match(w.lastTextTo(w.owner), /^Tomorrow's bookings:/u);
  const before = w.messaging.sentTo(w.owner).length;
  const lines = w.record.entries().length;
  await owner(w, "approve K7M2QX");
  const tapped = w.messaging.receive(w.owner, "Approve", { reply: { id: approvalButtonId("approve", "K7M2QX"), kind: "button" } });
  await w.agent.handle({ kind: "message", message: tapped });
  assert.equal(w.messaging.sentTo(w.owner).length, before, "nothing is said to the relay's replies");
  assert.equal(w.record.entries().length, lines, "and nothing is recorded");
  // a late cancellation, answered with the owner's fixed command
  await w.advance(10 * 60);
  await w.say("cancel my booking");
  await owner(w, "approve b-1");
  assert.ok(w.record.entries().some((e) => e.action === "owner_decision" && e.outcome === "confirmed" && e.refs.command === "approve"));
  assert.equal(w.payments.refunds().length, 1);
});

test("on a UPI shop the owner's marks still work, typed or tapped, and \"move <code>\" is still the handover, with no word from the assistant", async () => {
  const upi = JSON.parse(readFileSync(new URL("../settings/glow-salon-upi.example.json", import.meta.url), "utf8")) as Record<string, unknown>;
  const w = createWorld({ settings: parseSettings({ ...upi, assistant: {} }) });
  await w.say(BOOK);
  await w.ownerMarksReceived("b-1");
  assert.equal(w.store.bookings.get("b-1")!.state, "confirmed", "\"received <code>\" typed");
  await w.say("haircut tomorrow at 4pm", { from: OTHER_CUSTOMER });
  await w.ownerMarksReceived("b-2", { tap: true });
  assert.equal(w.store.bookings.get("b-2")!.state, "confirmed", "the Received button");
  const sent = w.messaging.sentTo(w.owner).length;
  await owner(w, "move K7M2QX");
  assert.equal(recordOf(w, "handover_agreed").length, 1);
  assert.equal(w.messaging.sentTo(w.owner).length, sent);
  assert.equal(recordOf(w, "owner_assistant").length, 0, "none of these reached the assistant");
  await owner(w, "today");
  assert.match(w.lastTextTo(w.owner), /^(Today's bookings:|No bookings today\.)/u);
});

test("asks: a day's list, money in, what needs me", async () => {
  const w = withAssistant();
  await bookAndPay(w);
  await owner(w, "bookings tomorrow");
  assert.match(w.lastTextTo(w.owner), /^Wed 4 Nov, bookings: 1\n6:00 pm haircut, \+919811111111 \(b-1\)$/u);
  await owner(w, "how much money today");
  assert.equal(w.lastTextTo(w.owner), "Recorded on Tue 3 Nov: ₹200 from payments: 1.");
  await owner(w, "what needs me");
  assert.equal(w.lastTextTo(w.owner), "Nothing needs you right now.");
  assert.ok(recordOf(w, "owner_assistant").every((e) => e.refs.step === "rules" && e.refs.costMicroInr === "0"), "the rules read them, for nothing");
});

test("cancel: a card with the exact change; nothing happens before the tap; the tap refunds exactly the amount shown, once", async () => {
  const w = withAssistant();
  await bookAndPay(w);
  await owner(w, "cancel b-1");
  const card = lastCard(w);
  assert.match(card.text, /^Cancel b-1 \(\+919811111111, haircut, Wed 4 Nov, 6:00 pm\) and refund the ₹200 deposit\?\nTap a button, or reply yes [A-Z2-9]{6} or no [A-Z2-9]{6}\.$/u);
  assert.equal(w.store.bookings.get("b-1")!.state, "confirmed", "nothing changes before the tap");
  assert.equal(w.payments.refunds().length, 0);
  await tapOwner(w, card.yes);
  assert.equal(w.store.bookings.get("b-1")!.state, "cancelled");
  assert.deepEqual(w.payments.refunds().map((r) => r.amount), [20_000], "the amount sent is the amount shown");
  assert.equal(w.lastTextTo(w.owner), "Done: ₹200 is on its way back to +919811111111 (b-1).");
  assert.match(w.lastTextTo(CUSTOMER), /is cancelled\. We're refunding your ₹200 deposit\./u);
  const done = recordOf(w, "owner_card").filter((e) => e.outcome === "confirmed");
  assert.equal(done.length, 1);
  assert.equal(done[0].refs.skill, "bookings", "the record says which skill acted");
  await tapOwner(w, card.yes);
  assert.equal(w.lastTextTo(w.owner), "That card was already answered.");
  assert.equal(w.payments.refunds().length, 1, "a second tap does nothing");
});

/** A paid booking cancelled late, whose refund the owner declined: its deposit is still the shop's, so a refund can be asked for. */
async function cancelledLateAndKept(w: World): Promise<string> {
  await bookAndPay(w);
  await w.advance(10 * 60);
  await w.say("cancel my booking");
  await owner(w, "deny b-1");
  assert.equal(w.payments.refunds().length, 0);
  return w.store.bookings.get("b-1")!.depositPaymentId!;
}

test("a changed amount voids the card: nothing is done, and a new card shows the amount as it is now", async () => {
  const w = withAssistant();
  const paymentId = await cancelledLateAndKept(w);
  await owner(w, "refund b-1");
  const first = lastCard(w);
  assert.match(first.text, /^Refund ₹200 to \+919811111111 for b-1\?/u);
  // meanwhile ₹100 of it went back another way
  w.record.append({ conversation: CUSTOMER, booking: "b-1", action: "refund", outcome: "confirmed", inputs: {}, language: "en", refs: { paymentId, amountPaise: "10000" } });
  await tapOwner(w, first.yes);
  assert.equal(w.payments.refunds().length, 0, "the old card did nothing");
  const texts = w.textsTo(w.owner);
  assert.ok(texts.includes("This changed since that card, so nothing was done. Here is the card as it is now:"));
  const second = lastCard(w);
  assert.match(second.text, /^Refund ₹100 to \+919811111111 for b-1\?/u);
  await tapOwner(w, first.yes);
  assert.equal(w.payments.refunds().length, 0, "the void card stays void");
  await tapOwner(w, second.yes);
  assert.deepEqual(w.payments.refunds().map((r) => r.amount), [10_000]);
});

test("a no is final: nothing is done, and the same refund is not offered again that day; a different amount is a new question", async () => {
  const w = withAssistant();
  await cancelledLateAndKept(w);
  await owner(w, "refund b-1");
  const card = lastCard(w);
  await tapOwner(w, card.no!);
  assert.equal(w.lastTextTo(w.owner), "OK. Nothing was changed.");
  await tapOwner(w, card.yes);
  assert.equal(w.payments.refunds().length, 0, "a yes after the no does nothing");
  const cards = () => w.messaging.sentTo(w.owner).filter((m) => m.interactive?.buttons?.some((b) => b.id.startsWith("card-"))).length;
  const shown = cards();
  await owner(w, "refund b-1");
  assert.match(w.lastTextTo(w.owner), /^You said no to this at \d{1,2}:\d{2} [ap]m\. I won't ask again until tomorrow\.$/u);
  assert.equal(cards(), shown);
  await owner(w, "refund ₹100 b-1");
  assert.equal(cards(), shown + 1);
});

test("free text never executes a card: a bare yes, haan or ok is read as words", async () => {
  const w = withAssistant();
  await cancelledLateAndKept(w);
  await owner(w, "refund b-1");
  for (const text of ["yes", "haan", "ok", "yes please do it"]) await owner(w, text);
  assert.equal(w.payments.refunds().length, 0);
  assert.equal(recordOf(w, "owner_card").filter((e) => e.outcome === "confirmed").length, 0);
});

test("a refund of a booking that still stands asks to cancel it instead", async () => {
  const w = withAssistant();
  await bookAndPay(w);
  await owner(w, "refund b-1");
  assert.equal(w.lastTextTo(w.owner), "b-1 is still booked. To give the deposit back, cancel it: cancel b-1.");
});

test("what needs me: a late refund waiting comes as a card, and its tap is the owner's own 'approve b-1'", async () => {
  const w = withAssistant();
  await bookAndPay(w);
  await w.advance(10 * 60);
  await w.say("cancel my booking");
  await owner(w, "what needs me");
  assert.ok(w.textsTo(w.owner).includes("Things that need you: 1. Each one is below."));
  const card = lastCard(w);
  assert.match(card.text, /^\+919811111111 cancelled b-1 late\. Refund the ₹200 deposit\?/u);
  await tapOwner(w, card.yes);
  assert.deepEqual(w.payments.refunds().map((r) => r.amount), [20_000]);
  assert.ok(w.record.entries().some((e) => e.action === "owner_decision" && e.outcome === "confirmed" && e.refs.command === "approve"));
  // the typed command afterwards finds nothing waiting, as it always did
  await owner(w, "approve b-1");
  assert.equal(w.payments.refunds().length, 1);
});

test("Refuse on something waiting is the owner's own deny: it stops waiting and the customer hears the answer", async () => {
  const w = withAssistant();
  await bookAndPay(w);
  await w.advance(10 * 60);
  await w.say("cancel my booking");
  await owner(w, "what needs me");
  await tapOwner(w, lastCard(w).no!);
  assert.ok(w.record.entries().some((e) => e.action === "owner_decision" && e.outcome === "confirmed" && e.refs.command === "deny"), "the deny was sent");
  assert.equal(w.store.bookings.get("b-1")!.pending.length, 0, "nothing waits any more");
  assert.equal(w.payments.refunds().length, 0);
  await owner(w, "what needs me");
  assert.equal(w.lastTextTo(w.owner), "Nothing needs you right now.");
});

test("a cancel refunds exactly what its card showed, after part of the deposit already went back", async () => {
  const w = withAssistant();
  await bookAndPay(w);
  w.record.append({ conversation: CUSTOMER, booking: "b-1", action: "refund", outcome: "confirmed", inputs: {}, language: "en", refs: { paymentId: w.store.bookings.get("b-1")!.depositPaymentId!, amountPaise: "10000" } });
  await owner(w, "cancel b-1");
  const card = lastCard(w);
  assert.match(card.text, /and refund the ₹100 deposit\?/u);
  await tapOwner(w, card.yes);
  assert.deepEqual(w.payments.refunds().map((r) => r.amount), [10_000], "not the whole ₹200");
});

test("closing a day names the customers the message could not reach, so the owner can call them", async () => {
  const w = withAssistant();
  await bookAndPay(w);
  await w.say("haircut tomorrow at 4pm", { from: OTHER_CUSTOMER });
  w.payments.customerPays(w.linkFor("b-2")!.id);
  await w.deliverPaymentEvents();
  await w.say("STOP", { from: OTHER_CUSTOMER });
  await owner(w, "close tomorrow");
  assert.equal(w.lastTextTo(w.owner), "Closed Wed 4 Nov. Bookings that day: 2. I've asked them to pick another day. I could not reach these, please call them: b-2 (+919822222222). Reply undo to open it again.");
});

test("message a customer: a preview card, the owner's words as typed, and never an amount that is not on the booking", async () => {
  const w = withAssistant();
  await bookAndPay(w);
  await owner(w, "message b-1 Running 15 minutes late, sorry!");
  const card = lastCard(w);
  assert.match(card.text, /^Send this to \+919811111111 \(b-1\)\?\n“Running 15 minutes late, sorry!”/u);
  assert.equal(w.lastTextTo(CUSTOMER).startsWith("Message from"), false, "nothing goes before the tap");
  await tapOwner(w, card.yes);
  assert.equal(w.lastTextTo(CUSTOMER), "Message from Glow Salon: Running 15 minutes late, sorry!");
  await owner(w, "message b-1 we will give you ₹500 back");
  assert.equal(w.lastTextTo(w.owner), "I can only send amounts that are on b-1. To give money back, say: refund b-1.");
});

test("close a day: said in passing, the customers that day are asked to move and stay booked, nobody else can book it, and undo opens it again", async () => {
  const w = withAssistant();
  await bookAndPay(w);
  await owner(w, "close tomorrow");
  assert.equal(w.lastTextTo(w.owner), "Closed Wed 4 Nov. Bookings that day: 1. I've asked them to pick another day. Reply undo to open it again.");
  assert.equal(w.lastTextTo(CUSTOMER), "Sorry: Glow Salon is closed on Wed 4 Nov, so your booking at 6:00 pm cannot go ahead that day. Reply with another day and time to move it, or CANCEL to cancel it.");
  assert.equal(w.store.bookings.get("b-1")!.state, "confirmed", "nothing is cancelled by closing a day");
  assert.equal(w.payments.refunds().length, 0);
  assert.deepEqual(w.store.assistant?.closedDays, ["2026-11-04"]);
  await w.say("haircut tomorrow at 11am", { from: OTHER_CUSTOMER });
  assert.ok(w.record.entries().some((e) => e.action === "hold_slot" && e.outcome === "blocked" && e.conversation === OTHER_CUSTOMER), "a closed day is outside the hours");
  await owner(w, "undo");
  assert.equal(w.lastTextTo(w.owner), "Open again on Wed 4 Nov. I've told customers their booking stands: 1.");
  assert.equal(w.lastTextTo(CUSTOMER), "Good news: Glow Salon is open on Wed 4 Nov after all. Your booking at 6:00 pm stands. Reply here if you have already made other plans.");
  assert.deepEqual(w.store.assistant?.closedDays, []);
  await owner(w, "undo");
  assert.equal(w.lastTextTo(w.owner), "There is nothing to undo.");
});

test("move a booking: done at once through the agent's own reschedule, the customer told, and undo moves it back", async () => {
  const w = withAssistant();
  await bookAndPay(w);
  await owner(w, "move b-1 to 7pm");
  assert.equal(w.lastTextTo(w.owner), "Moved b-1 to Wed 4 Nov, 7:00 pm. I've told the customer. Reply undo to move it back.");
  assert.equal(w.store.bookings.get("b-1")!.startMs, zonedToMs({ year: 2026, month: 11, day: 4 }, { hour: 19, minute: 0 }, w.settings.timezone));
  assert.match(w.lastTextTo(CUSTOMER), /7:00 pm/u);
  await owner(w, "undo");
  assert.equal(w.lastTextTo(w.owner), "b-1 is back at Wed 4 Nov, 6:00 pm. I've told the customer.");
  assert.equal(w.store.bookings.get("b-1")!.startMs, zonedToMs({ year: 2026, month: 11, day: 4 }, { hour: 18, minute: 0 }, w.settings.timezone));
  // a time that cannot be had is said to the owner only: the customer hears nothing of it
  const told = w.textsTo(CUSTOMER).length;
  await owner(w, "move b-1 to 9pm");
  assert.equal(w.lastTextTo(w.owner), "I couldn't move b-1 to Wed 4 Nov, 9:00 pm: the shop is closed then.");
  assert.equal(w.textsTo(CUSTOMER).length, told);
  await owner(w, "move b-1");
  assert.equal(w.lastTextTo(w.owner), "To when? For example: move b-1 to 5pm, or move b-1 to Friday.");
});

test("closing a weekday that is always closed, or a day gone, is said plainly", async () => {
  const w = withAssistant();
  await owner(w, "close sunday");
  assert.equal(w.lastTextTo(w.owner), "The shop is always closed on that weekday (Sun 8 Nov). Your opening hours are set by your Operator.");
  await owner(w, "close");
  assert.equal(w.lastTextTo(w.owner), "Which day? For example: close Sunday.");
});

test("a limit is tightened by a card and the owner's tap; the chat never loosens one (₹500 loosens ₹200)", async () => {
  const w = withAssistant(); // the refund limit is ₹200
  await owner(w, "refunds above ₹500 need my OK");
  assert.match(w.lastTextTo(w.owner), /would loosen it/u, "a rule that is looser than the limit in force gets no card");
  assert.equal(w.store.assistant?.limitChanges?.length ?? 0, 0);
  await owner(w, "refunds above ₹100 need my OK");
  const card = lastCard(w);
  assert.match(card.text, /Refunds above ₹100 need your approval\. Now: ₹200\./u);
  assert.equal(w.store.assistant!.limitChanges.length, 0, "nothing is changed before the tap");
  assert.equal(w.settings.cancellation.refundLimitInr, 200);
  await tapOwner(w, card.yes);
  const [change] = w.store.assistant!.limitChanges;
  assert.deepEqual([change.state, change.from, change.to, change.by], ["pending", 200, 100, "owner_chat"]);
  assert.match(w.lastTextTo(w.owner), /^Pending: Refunds above ₹100 need your approval/u);
  assert.equal(w.settings.cancellation.refundLimitInr, 100, "the runtime's own checks use the tighter value at once");
  assert.deepEqual(recordOf(w, "limit_change").map((e) => [e.outcome, e.refs.state, e.refs.to]), [["unconfirmed", "pending", "100"]]);
  // the deployer's word (the runtime's core settles it in a step): the owner hears Active on the next beat, once
  change.state = "active";
  await w.tick();
  assert.match(w.lastTextTo(w.owner), /^Active: Refunds above ₹100 need your approval/u);
  const told = w.messaging.sentTo(w.owner).length;
  await w.tick();
  assert.equal(w.messaging.sentTo(w.owner).length, told, "said once");
});

test("a failed change is told with the previous limit still in force; a rule that names no limit gets the list of limits", async () => {
  const w = withAssistant();
  await owner(w, "refunds above ₹100 need my OK");
  await tapOwner(w, lastCard(w).yes);
  const change = w.store.assistant!.limitChanges[0];
  change.state = "failed"; change.why = "the deploy did not go through";
  await w.tick();
  assert.match(w.lastTextTo(w.owner), /previous limit is still in force: Refunds above ₹200 need your approval/u);
  await owner(w, "limit the dress colours to 3");
  assert.match(w.lastTextTo(w.owner), /Which limit do you mean\?/u);
});

test("the card is void when the limit changed between the card and the tap", async () => {
  const w = withAssistant();
  await owner(w, "refunds above ₹100 need my OK");
  const card = lastCard(w);
  w.store.assistant!.limitChanges.push({ id: "l-90", limit: "refund_limit", path: "cancellation.refundLimitInr", from: 200, to: 50, direction: "tighten", by: "owner_app", state: "pending", atMs: 1 });
  await tapOwner(w, card.yes);
  assert.equal(w.store.assistant!.limitChanges.length, 1, "100 no longer tightens 50: nothing was done");
  assert.match(w.lastTextTo(w.owner), /no longer tightens/u);
});

test("the owner's language: the assistant answers in it", async () => {
  const settings = parseSettings({ ...glow(), owner: { whatsapp: "+919000000000", language: "hi" }, assistant: {} });
  const w = createWorld({ settings });
  await owner(w, "ravivar band karo");
  assert.match(w.lastTextTo(w.owner), /हमेशा बंद रहती है/u);
});

test("what needs me is the owner page's list (one list): a deposit waiting on a UPI shop is on both, and its card's tap marks it as the page's press would", async () => {
  const upi = JSON.parse(readFileSync(new URL("../settings/glow-salon-upi.example.json", import.meta.url), "utf8")) as Record<string, unknown>;
  const w = createWorld({ settings: parseSettings({ ...upi, assistant: {} }) });
  await w.say(BOOK);
  const skill = bookingsSkill({ settings: w.settings, store: w.store, nowMs: () => w.clock.now(), entries: () => w.record.entries(), optedOut: () => false });
  const page = ownerItems(w.settings, w.store, w.clock.now()).items;
  assert.deepEqual(skill.waiting().map((i) => [i.case, i.kind, i.amountPaise]), page.map((i) => [i.case, i.kind, i.amountPaise]), "the assistant and the owner's page list the same things");
  assert.deepEqual(page.map((i) => [i.case, i.kind]), [["b-1", "deposit"]], "a deposit to mark waits on the page from the start, so it is on the assistant's list too");
  await owner(w, "what needs me");
  const card = lastCard(w);
  assert.equal(card.no, undefined, "a deposit to mark has only the one answer");
  await tapOwner(w, card.yes);
  assert.equal(w.store.bookings.get("b-1")!.state, "confirmed", "the tap is the owner's own Received button, with its code");
  assert.deepEqual(ownerItems(w.settings, w.store, w.clock.now()).items, [], "and nothing waits on the page any more");
});

test("what needs me lists a late deposit (a UPI hold that ended where money may have come): it is a deposit card, and its yes is the late \"received\" mark with its one-use code", async () => {
  // Found 17 Nov 2026: the assistant had no answer for the page's `late_deposit` item, so "what needs me" threw as soon as one was listed. (No customer's "I have paid" is said
  // here: that late claim comes only from the booking's own web page, so this is the 48-hour listing of an ended hold, which is the same item.)
  const upi = JSON.parse(readFileSync(new URL("../settings/glow-salon-upi.example.json", import.meta.url), "utf8")) as Record<string, unknown>;
  const w = createWorld({ settings: parseSettings({ ...upi, assistant: {} }) });
  await w.say(BOOK);
  await w.advance(61 + 60); // the hold (60 minutes) runs out and the agent expires it
  assert.equal(w.store.bookings.get("b-1")!.state, "expired");
  const page = ownerItems(w.settings, w.store, w.clock.now()).items;
  assert.deepEqual(page.map((i) => [i.case, i.kind]), [["b-1", "late_deposit"]], "the owner's page lists the ended hold");
  const skill = bookingsSkill({ settings: w.settings, store: w.store, nowMs: () => w.clock.now(), entries: () => w.record.entries(), optedOut: () => false });
  assert.deepEqual(skill.waiting().map((i) => [i.case, i.amountPaise]), page.map((i) => [i.case, i.amountPaise]), "and so does the assistant, without throwing");
  await owner(w, "what needs me");
  assert.ok(w.textsTo(w.owner).includes("Things that need you: 1. Each one is below."));
  const card = lastCard(w);
  assert.match(card.text, /reach your UPI\?/u, "shown as a deposit card");
  assert.equal(card.no, undefined, "with only the one answer");
  await tapOwner(w, card.yes);
  assert.equal(w.store.bookings.get("b-1")!.state, "expired", "never booked again by itself");
  assert.ok(recordOf(w, "owner_marked_paid").some((e) => e.refs.markedBy === "owner"), "the tap is the owner's own received mark, with its code");
  assert.equal(w.upiRefunds("b-1").length, 1, "the late mark owes the money back (or keep, for a booking made by hand)");
  assert.deepEqual(ownerItems(w.settings, w.store, w.clock.now()).items.filter((i) => i.kind === "late_deposit"), [], "and the ended hold no longer waits");
});

/** The owner answers a card on their page: the front posts the card's id and the digest the page showed (item 11d's owner_action, card_yes / card_no). */
const pagePress = (w: World, card: { id: string; digest: string }, answer: "yes" | "no", id = `page-${card.id}-${answer}-${w.clock.now()}`) =>
  w.agent.handle({ kind: "owner_action", id, action: answer === "yes" ? "card_yes" : "card_no", case: card.id, digest: card.digest });
const openCard = (w: World) => { const c = w.store.assistant!.cards.filter((x) => x.state === "open").at(-1); assert.ok(c, "an open card"); return c; };

test("a card answered on the owner's page is the same binding as a WhatsApp tap: done once, its question without a code, the answer in the page's talk", async () => {
  const w = withAssistant();
  await bookAndPay(w);
  await owner(w, "cancel b-1");
  const card = openCard(w);
  const tap = lastCard(w);
  assert.equal(card.question, "Cancel b-1 (+919811111111, haircut, Wed 4 Nov, 6:00 pm) and refund the ₹200 deposit?", "the page's question is the WhatsApp card's, without the line with the code");
  const toOwner = w.messaging.sentTo(w.owner).length;
  await pagePress(w, card, "yes");
  assert.equal(w.store.bookings.get("b-1")!.state, "cancelled");
  assert.deepEqual(w.payments.refunds().map((r) => r.amount), [20_000], "the amount sent is the amount shown");
  assert.equal(w.messaging.sentTo(w.owner).length, toOwner, "the answer is shown on the page, not sent to WhatsApp as well");
  assert.equal(w.store.assistant!.talk.at(-1)?.text, "Done: ₹200 is on its way back to +919811111111 (b-1).");
  assert.ok(recordOf(w, "owner_card").some((e) => e.outcome === "confirmed" && e.refs.via === "page"), "the record says the page answered it");
  // the same card on WhatsApp afterwards: already answered, nothing more is sent back
  await tapOwner(w, tap.yes);
  assert.equal(w.lastTextTo(w.owner), "That card was already answered.");
  assert.equal(w.payments.refunds().length, 1);
  // and a second press on the page does nothing either
  await pagePress(w, card, "yes", "page-again");
  assert.equal(w.payments.refunds().length, 1);
});

test("a card tapped on WhatsApp is closed on the page; a press with another digest, or a no where the card has none, does nothing", async () => {
  const w = withAssistant();
  await bookAndPay(w);
  await owner(w, "cancel b-1");
  const card = openCard(w);
  await pagePress(w, { id: card.id, digest: "0".repeat(32) }, "yes");
  assert.equal(w.store.bookings.get("b-1")!.state, "confirmed", "a digest the card does not have is not the card the page showed");
  assert.ok(recordOf(w, "owner_card").some((e) => e.outcome === "blocked" && e.refs.via === "page"));
  await tapOwner(w, lastCard(w).yes);
  assert.equal(w.payments.refunds().length, 1);
  await pagePress(w, card, "yes");
  assert.equal(w.payments.refunds().length, 1, "already answered on WhatsApp: the page's press does nothing");
  assert.equal(w.store.assistant!.talk.at(-1)?.text, "That card was already answered.");
});

test("on the page too a changed amount voids the card and a new one shows the amount as it is now; a no there is final", async () => {
  const w = withAssistant();
  const paymentId = await cancelledLateAndKept(w);
  await owner(w, "refund b-1");
  const first = openCard(w);
  w.record.append({ conversation: CUSTOMER, booking: "b-1", action: "refund", outcome: "confirmed", inputs: {}, language: "en", refs: { paymentId, amountPaise: "10000" } });
  await pagePress(w, first, "yes");
  assert.equal(w.payments.refunds().length, 0, "the old card did nothing");
  assert.equal(w.store.assistant!.cards.find((c) => c.id === first.id)!.state, "void");
  const second = openCard(w);
  assert.notEqual(second.id, first.id);
  assert.match(second.question ?? "", /^Refund ₹100 to \+919811111111 for b-1\?/u);
  await pagePress(w, second, "no");
  assert.equal(w.store.assistant!.cards.find((c) => c.id === second.id)!.state, "refused");
  assert.equal(w.store.assistant!.talk.at(-1)?.text, "OK. Nothing was changed.");
  // the new card was made on the page, so WhatsApp only ever had the first one, which stays void
  await tapOwner(w, lastCard(w).yes);
  assert.equal(w.payments.refunds().length, 0, "the old WhatsApp card does nothing after the page's no");
  await pagePress(w, second, "yes", "page-yes-after-no");
  assert.equal(w.payments.refunds().length, 0, "nor does a yes on the page after its no");
});

test("the morning line reads the same store: tomorrow's booking and the deposit recorded the day before", async () => {
  const w = withAssistant();
  await bookAndPay(w);
  for (const language of LANGUAGES) w.messaging.approve("owner_morning", language);
  const settings = w.settings;
  const job = createMorningJob<Store>({ shop: { name: settings.name, timezone: settings.timezone, owner: settings.owner, settings: settings.assistant! }, skills: (store) => [bookingsSkill({ settings, store, nowMs: () => w.clock.now(), entries: () => [], optedOut: () => false })] });
  w.clock.set(zonedToMs({ year: 2026, month: 11, day: 4 }, { hour: 8, minute: 5 }, settings.timezone));
  const r = await job.run({ clock: w.clock, messaging: w.messaging, record: w.record, store: w.store, log: () => undefined, save: () => undefined });
  assert.equal(r.done, true);
  assert.equal(w.lastTextTo(w.owner), "Good morning from the assistant of Glow Salon. Today, Wed 4 Nov: bookings: 1, the first at 6:00 pm. Recorded yesterday: ₹200. Waiting for you: nothing. Reply here to see more.");
  w.clock.advance(HOUR);
  assert.equal((await job.run({ clock: w.clock, messaging: w.messaging, record: w.record, store: w.store, log: () => undefined, save: () => undefined })).done, false);
});

test("the assistant's part of the store survives a restart, and a shop without one saves as before", async () => {
  const w = withAssistant();
  await bookAndPay(w);
  await owner(w, "close tomorrow");
  await owner(w, "cancel b-1");
  const back = parseStore(serializeStore(w.store));
  assert.deepEqual(back.assistant, w.store.assistant);
  assert.equal(back.assistant!.cards.length, 1);
  const plain = createWorld();
  assert.ok(!serializeStore(plain.store).includes("assistant"));
});

test("the settings: an \"assistant\" block is read; a voice for the character is refused (it answers in text)", () => {
  assert.ok(validateSettings({ ...glow(), assistant: { morning: { at: "07:30" }, character: { name: "Mithra", style: "critters", seed: "glow-salon-3f2a1c-4", colour: "fda4af", personality: "cheerful" } } }).ok);
  const r = validateSettings({ ...glow(), assistant: { character: { name: "Mithra", voice: "warm" } } });
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.errors.some((e) => /answers in text/u.test(e)));
});
