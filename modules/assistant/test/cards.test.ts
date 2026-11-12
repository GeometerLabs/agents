// The runtime's cards (item 11e, modules/assistant/cards.ts): the binding between what the owner is shown and what is done. A tap does the saved action only when the
// store still gives the same digest; a changed amount voids the card; a no is final for 24 hours; a closed card does nothing; free text never executes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CARD_FOR_MS, actionDigest, cardButtonId, closeCard, codeHash, expireCards, judgeReply, makeCard, openCards, parseCardReply, refusedBefore } from "../cards.ts";
import { emptyAssistantState } from "../state.ts";
import type { CardAction } from "../state.ts";
import { HOUR } from "../../core/time.ts";
import { RELAY_CODE_REPLY } from "../../approvals/code.ts";

const refund = (amountPaise: number, paymentId = "pay_1"): CardAction => ({ kind: "refund", skill: "bookings", case: "b-14", fields: { who: "Priya", paymentId, amountPaise } });
const NOW = 1_800_000_000_000;

test("the digest is over the exact fields, whatever their order, and changes with any of them", () => {
  const a = refund(120_000);
  assert.equal(actionDigest(a), actionDigest({ ...a, fields: { amountPaise: 120_000, paymentId: "pay_1", who: "Priya" } }));
  assert.notEqual(actionDigest(a), actionDigest(refund(100_000)));
  assert.notEqual(actionDigest(a), actionDigest(refund(120_000, "pay_2")));
  assert.notEqual(actionDigest(a), actionDigest({ ...a, case: "b-15" }));
  assert.notEqual(actionDigest(a), actionDigest({ ...a, skill: "fees" }));
});

test("a tap or the card's exact code is a reply; a bare yes, haan or ok never is, and the relay's verb is never a card's", () => {
  assert.deepEqual(parseCardReply({ text: "Approve", reply: { id: cardButtonId("yes", "K7M2QX") } }), { answer: "yes", code: "K7M2QX", via: "button" });
  assert.deepEqual(parseCardReply({ text: "no k7m2qx" }), { answer: "no", code: "K7M2QX", via: "typed" });
  for (const text of ["yes", "Yes!", "haan", "ok", "हाँ", "ശരി", "ಹೌದು", "approve K7M2QX", "yes b-14"]) assert.equal(parseCardReply({ text }), undefined, text);
  // the relay counts codes it never issued: a card's reply must never look like the relay's
  assert.equal(RELAY_CODE_REPLY.test("yes K7M2QX"), false);
  assert.notEqual(codeHash("K7M2QX"), codeHash("K7M2QY"));
});

test("a tap does the saved action only while the store gives the same digest", () => {
  const s = emptyAssistantState();
  const { card, code } = makeCard(s, refund(120_000), { kind: "refund", case: "b-14" }, NOW);
  assert.equal(card.state, "open");
  assert.equal(openCards(s, NOW).length, 1);
  const same = judgeReply(s, { answer: "yes", code, via: "button" }, NOW + 1000, () => ({ ok: true, action: refund(120_000) }));
  assert.equal(same.verdict, "do");
  const changed = judgeReply(s, { answer: "yes", code, via: "button" }, NOW + 1000, () => ({ ok: true, action: refund(100_000) }));
  assert.equal(changed.verdict, "changed");
  assert.equal(changed.verdict === "changed" && changed.now.fields.amountPaise, 100_000);
  const gone = judgeReply(s, { answer: "yes", code, via: "button" }, NOW + 1000, () => ({ ok: false, why: "not_live" }));
  assert.equal(gone.verdict, "gone");
});

test("a closed card does nothing, a second tap included; an unknown code is unknown", () => {
  const s = emptyAssistantState();
  const { card, code } = makeCard(s, refund(120_000), {}, NOW);
  closeCard(s, card, "done", NOW + 10);
  assert.equal(judgeReply(s, { answer: "yes", code, via: "button" }, NOW + 20, () => ({ ok: true, action: refund(120_000) })).verdict, "closed");
  assert.equal(judgeReply(s, { answer: "yes", code: "ZZZZZZ", via: "typed" }, NOW + 20, () => ({ ok: true, action: refund(120_000) })).verdict, "unknown");
});

test("a no is final: the card is closed as refused, a later yes does nothing, and the same action is not offered again for 24 hours", () => {
  const s = emptyAssistantState();
  const { card, code } = makeCard(s, refund(120_000), {}, NOW);
  const v = judgeReply(s, { answer: "no", code, via: "button" }, NOW + 5, () => { throw new Error("a no reads nothing"); });
  assert.equal(v.verdict, "refuse");
  closeCard(s, card, "refused", NOW + 5);
  assert.equal(judgeReply(s, { answer: "yes", code, via: "button" }, NOW + 6, () => ({ ok: true, action: refund(120_000) })).verdict, "closed");
  assert.deepEqual(refusedBefore(s, card.digest, NOW + 23 * HOUR), { digest: card.digest, atMs: NOW + 5, card: card.id });
  assert.equal(refusedBefore(s, card.digest, NOW + 25 * HOUR), undefined);
  assert.equal(refusedBefore(s, actionDigest(refund(100_000)), NOW + HOUR), undefined); // another amount is another action
});

test("a new card for the same thing voids the old one, so an old amount can never be tapped after a new one was shown", () => {
  const s = emptyAssistantState();
  const first = makeCard(s, refund(120_000), {}, NOW);
  const second = makeCard(s, refund(100_000), {}, NOW + 60_000);
  assert.deepEqual(second.voided.map((c) => c.id), [first.card.id]);
  assert.equal(first.card.state, "void");
  assert.equal(first.card.replacedBy, second.card.id);
  assert.equal(judgeReply(s, { answer: "yes", code: first.code, via: "button" }, NOW + 70_000, () => ({ ok: true, action: refund(120_000) })).verdict, "closed");
  assert.notEqual(first.code, second.code);
  // the code is never saved, only its hash
  assert.ok(!JSON.stringify(s).includes(second.code));
});

test("a card runs out after a day", () => {
  const s = emptyAssistantState();
  const { code } = makeCard(s, refund(120_000), {}, NOW);
  assert.equal(judgeReply(s, { answer: "yes", code, via: "button" }, NOW + CARD_FOR_MS, () => ({ ok: true, action: refund(120_000) })).verdict, "expired");
  assert.equal(expireCards(s, NOW + CARD_FOR_MS).length, 1);
  assert.equal(openCards(s, NOW + CARD_FOR_MS).length, 0);
});
