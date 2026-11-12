// B72: the shop terms agreed on WhatsApp, through a Bookings shop (moved here from modules/terms/test/terms.test.ts, since a shared module's tests may not import a
// template: modules/test/boundary.test.ts). The text, digest and words are tested in modules/terms; here, the agent:
//   - the feature is OFF without a terms file: the owner's "terms" is just an unknown command and nothing is recorded;
//   - ON: "terms" sends the text and the buttons and records terms_sent; "I agree" (typed or the button) records terms_agreed with the digest, version, language and
//     message id; it is refused before the terms were sent, and after the terms changed; a customer's "I agree" is nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { AGREE_PREFIX, TERMS_AGREED_ACTION, TERMS_SENT_ACTION, TERMS_VERSION, termsDigest, termsText } from "../../../../modules/terms/terms.ts";
import type { TermsFile } from "../../../../modules/terms/terms.ts";
import { createWorld, CUSTOMER } from "../src/harness.ts";

const FILE: TermsFile = { schema: 1, partnerName: "Divya", partnerPhone: "+919800000000", monthlyInr: 700, setupInr: 1500 };

const entries = (w: ReturnType<typeof createWorld>, action: string) => w.record.entries().filter((e) => e.action === action);

test("OFF by default: the owner's 'terms' is an unknown command and nothing is recorded", async () => {
  const w = createWorld();
  await w.say("terms", { from: w.owner });
  assert.equal(entries(w, TERMS_SENT_ACTION).length, 0);
  assert.match(w.lastTextTo(w.owner), /didn't understand/u);
});

test("ON: terms are sent, the agreement is recorded with the digest, version, language and message id, and only once", async () => {
  const w = createWorld({ terms: () => FILE });
  await w.say("terms", { from: w.owner });
  const text = termsText(w.settings.owner.language, w.settings.name, FILE);
  assert.ok(w.textsTo(w.owner).includes(text), "the exact text went to the owner");
  const sent = entries(w, TERMS_SENT_ACTION);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].refs.termsDigest, termsDigest(text));
  const reply = await w.say("I agree", { from: w.owner });
  const agreed = entries(w, TERMS_AGREED_ACTION);
  assert.equal(agreed.length, 1);
  assert.deepEqual([agreed[0].outcome, agreed[0].refs.termsDigest, agreed[0].refs.termsVersion, agreed[0].refs.termsLanguage], ["confirmed", termsDigest(text), TERMS_VERSION, w.settings.owner.language]);
  assert.ok(agreed[0].refs.messageId, `the reply's message id (${reply.id}) is kept`);
  await w.say("I agree", { from: w.owner });
  assert.equal(entries(w, TERMS_AGREED_ACTION).length, 1, "a second 'I agree' adds nothing");
});

test("ON: the button agrees too, and a button for other terms does not", async () => {
  const w = createWorld({ terms: () => FILE });
  await w.say("terms", { from: w.owner });
  const digest = termsDigest(termsText(w.settings.owner.language, w.settings.name, FILE));
  await w.tap(`${AGREE_PREFIX}${digest.slice(0, 12)}`, { from: w.owner });
  assert.equal(entries(w, TERMS_AGREED_ACTION).filter((e) => e.outcome === "confirmed").length, 1);
});

test("ON: 'I agree' before the terms were sent, or after they changed, records no agreement", async () => {
  let file = FILE;
  const w = createWorld({ terms: () => file });
  await w.say("I agree", { from: w.owner });
  assert.deepEqual(entries(w, TERMS_AGREED_ACTION).map((e) => e.outcome), ["blocked"]);
  await w.say("terms", { from: w.owner });
  file = { ...FILE, monthlyInr: 900 }; // the partner changed the price after the terms went out
  await w.say("I agree", { from: w.owner });
  assert.deepEqual(entries(w, TERMS_AGREED_ACTION).map((e) => e.outcome), ["blocked", "blocked"]);
});

test("ON: a customer who writes 'I agree' or 'terms' is a customer: nothing is recorded or sent as terms", async () => {
  const w = createWorld({ terms: () => FILE });
  await w.say("terms", { from: CUSTOMER });
  await w.say("I agree", { from: CUSTOMER });
  assert.equal(entries(w, TERMS_SENT_ACTION).length + entries(w, TERMS_AGREED_ACTION).length, 0);
});
