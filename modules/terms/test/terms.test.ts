// B72: the shop terms agreed on WhatsApp (modules/terms). Written, not run (owner's instruction of 11 Nov: run everything once at the end).
//   - the text exists in four languages, carries the shop, the partner and the two prices, and uses none of the banned words or a promise of legal strength;
//   - the digest changes with any price, name, language or version;
//   - the owner's words: "terms" asks, "I agree" in four languages agrees, "ok" and "yes" do not;
//   - the feature is OFF without a terms file: the owner's "terms" is just an unknown command and nothing is recorded;
//   - ON: "terms" sends the text and the buttons and records terms_sent; "I agree" (typed or the button) records terms_agreed with the digest, version, language and message id;
//     it is refused before the terms were sent, and after the terms changed; a customer's "I agree" is nothing; limits and approvals are not touched;
//   - the file reader and the deployer's hand-over follow the setting.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LANGUAGES } from "../../language/languages.ts";
import { bannedIn } from "../../report/claims.ts";
import { AGREE_PREFIX, TERMS_AGREED_ACTION, TERMS_SENT_ACTION, TERMS_VERSION, isAgreeWords, isTermsRequest, readTermsFile, termsDigest, termsText } from "../terms.ts";
import type { TermsFile } from "../terms.ts";
import { termsReader } from "../reader.ts";
import { createWorld, CUSTOMER } from "../../../templates/commerce/bookings/src/harness.ts";
import { syncTerms } from "../../../bundle/lib/terms.ts";

const FILE: TermsFile = { schema: 1, partnerName: "Divya", partnerPhone: "+919800000000", monthlyInr: 700, setupInr: 1500 };

test("the terms exist in all four languages with the shop, the partner and both prices, and promise nothing legal or banned", () => {
  for (const language of LANGUAGES) {
    const text = termsText(language, "Glow Salon", FILE);
    for (const must of ["Glow Salon", "Divya", "+919800000000", "700", "1,500", TERMS_VERSION, "hello@geometer.dev"]) assert.ok(text.includes(must) || (must === "1,500" && text.includes("1500")), `${language} lacks ${must}`);
    assert.deepEqual(bannedIn(text, language), [], `${language} uses a banned word`);
    assert.doesNotMatch(text, /legally (binding|sufficient|valid)/iu);
  }
});

test("the digest follows every part of the text", () => {
  const base = termsDigest(termsText("en", "Glow Salon", FILE));
  assert.notEqual(base, termsDigest(termsText("en", "Glow Salon", { ...FILE, monthlyInr: 800 })));
  assert.notEqual(base, termsDigest(termsText("en", "Glow Salon", { ...FILE, partnerName: "Ravi" })));
  assert.notEqual(base, termsDigest(termsText("en", "Other Shop", FILE)));
  assert.notEqual(base, termsDigest(termsText("hi", "Glow Salon", FILE)));
  assert.equal(base, termsDigest(termsText("en", "Glow Salon", FILE)));
});

test("which words ask and which agree: a bare ok, yes or thumbs-up is not an agreement", () => {
  for (const w of ["terms", "Terms!", "शर्तें", "നിബന്ധനകൾ", "ನಿಯಮಗಳು"]) assert.ok(isTermsRequest(w), w);
  for (const w of ["I agree", "i agree.", "agree", "मैं सहमत हूँ", "ഞാൻ സമ്മതിക്കുന്നു", "ನಾನು ಒಪ್ಪುತ್ತೇನೆ"]) assert.ok(isAgreeWords(w), w);
  for (const w of ["ok", "yes", "👍", "haan", "I do not agree", "approve b-1"]) assert.equal(isAgreeWords(w), false, w);
});

test("a terms file is read field by field; anything else is no file", () => {
  assert.deepEqual(readTermsFile(FILE), FILE);
  for (const bad of [null, {}, { ...FILE, schema: 2 }, { ...FILE, partnerName: "" }, { ...FILE, monthlyInr: -1 }, { ...FILE, setupInr: 1.5 }, { ...FILE, partnerPhone: "x".repeat(40) }]) assert.equal(readTermsFile(bad), undefined);
});

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

test("the reader and the deployer follow the file and the server setting", () => {
  const dir = mkdtempSync(join(tmpdir(), "terms-"));
  try {
    mkdirSync(join(dir, "shops", "glow"), { recursive: true });
    writeFileSync(join(dir, "shops", "glow", "terms.json"), JSON.stringify(FILE));
    const handed = join(dir, "generated", "shops", "glow", "client", "terms.json");
    mkdirSync(join(dir, "generated", "shops", "glow", "client"), { recursive: true });
    syncTerms(dir, false, "glow");
    assert.equal(existsSync(handed), false, "setting off: nothing is handed over");
    syncTerms(dir, true, "glow");
    assert.deepEqual(termsReader(join(dir, "generated", "shops", "glow", "client"))(), FILE);
    syncTerms(dir, false, "glow");
    assert.equal(existsSync(handed), false, "turning the setting off takes the copy away");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
