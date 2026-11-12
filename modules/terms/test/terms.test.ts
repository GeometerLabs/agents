// B72: the shop terms agreed on WhatsApp (modules/terms). Written, not run (owner's instruction of 11 Nov: run everything once at the end).
//   - the text exists in four languages, carries the shop, the partner and the two prices, and uses none of the banned words or a promise of legal strength;
//   - the digest changes with any price, name, language or version;
//   - the owner's words: "terms" asks, "I agree" in four languages agrees, "ok" and "yes" do not;
//   - a terms file is read field by field, and the runtime's reader follows the file: no file, or one that does not check, is the feature off.
// The agent's side (OFF by default, "terms" and "I agree" through a Bookings shop) is templates/commerce/bookings/test/terms.test.ts, and the deployer's hand-over is
// bundle/test/terms.test.ts: a shared module's tests import no template and no bundle code (modules/test/boundary.test.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LANGUAGES } from "../../language/languages.ts";
import { bannedIn } from "../../report/claims.ts";
import { TERMS_VERSION, isAgreeWords, isTermsRequest, readTermsFile, termsDigest, termsText } from "../terms.ts";
import type { TermsFile } from "../terms.ts";
import { termsReader } from "../reader.ts";

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

test("the runtime's reader follows the file: no file is off, a good one is read, a bad one or a removed one is off again", () => {
  const dir = mkdtempSync(join(tmpdir(), "terms-reader-"));
  try {
    const read = termsReader(dir);
    assert.equal(read(), undefined, "no file: the feature is off");
    writeFileSync(join(dir, "terms.json"), JSON.stringify(FILE));
    assert.deepEqual(read(), FILE);
    writeFileSync(join(dir, "terms.json"), JSON.stringify({ ...FILE, schema: 2 }));
    assert.equal(termsReader(dir)(), undefined, "a file that does not check is off");
    rmSync(join(dir, "terms.json"));
    assert.equal(read(), undefined, "the file is gone: off again");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
