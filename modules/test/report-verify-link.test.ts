// The link a signed paper carries (the website's contract, public-web docs/Deferred.md P22): https://geometer.dev/verify/#<digest or code>[&key=...], and the QR of it.
// Changing the page must not change the signed file: the page is made from the envelope, never the other way round.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { sealBlock } from "../report/page.ts";
import type { SealWords } from "../report/page.ts";
import { envelopeFile, seal, verifyEnvelopeText } from "../report/sign.ts";
import { verifyCodePath, verifyLink, VERIFY_URL } from "../report/verify-link.ts";
import { digestOf, verificationCode } from "../report/digest.ts";
import { encodeQr } from "../qr/qr.ts";
import { darkFromSvg, readQr } from "../qr/test/read.ts";

const words: SealWords = { checkHeading: "Check", code: "Code", digest: "Digest", signedBy: "Signed", notSigned: "Not signed", signatureNote: "Note.", scanToCheck: "Scan to check." };
const { privateKey } = generateKeyPairSync("ed25519");
const document = { kind: "test-paper", n: 3, items: ["a", "b"] };

/** The link a page prints, and what a camera reads from its SVG: the SVG's modules must be the encoder's code for the printed link, and must read back as it. */
function fromPage(html: string): { text: string; scanned: string } {
  const svg = html.match(/<svg[\s\S]*?<\/svg>/)![0];
  const text = html.match(/<div class="mono">(https:[^<]*)<\/div>/)![1];
  const expected = encodeQr(text);
  assert.deepEqual(darkFromSvg(svg, expected.size), expected.dark, "the SVG draws the code of the printed link");
  return { text, scanned: readQr({ ...expected, dark: darkFromSvg(svg, expected.size) }) };
}

test("the link is the website's: the full digest after a # on /verify/, no key, nothing else", () => {
  const env = seal(document, privateKey);
  assert.equal(verifyLink(env), `https://geometer.dev/verify/#${digestOf(document)}`);
  assert.match(verifyLink(env), /^https:\/\/geometer\.dev\/verify\/#sha256:[0-9a-f]{64}$/);
  assert.equal(verifyCodePath(env), `/verify/#${verificationCode(digestOf(document))}`);
  assert.equal(verifyLink(env, `key:${"1".repeat(64)}`), `${verifyLink(env)}&key=key:${"1".repeat(64)}`);
  assert.throws(() => verifyLink({ digest: "sha256:abc" }), /full digest/);
  assert.throws(() => verifyLink(env, "not a key"), /key:/);
});

test("the printed link and the link the QR carries are the digest the verifier computes", () => {
  for (const key of [privateKey, undefined]) {
    const env = seal(document, key);
    const html = sealBlock(words, env);
    const verified = verifyEnvelopeText(envelopeFile(env));
    assert.ok(verified.unchanged);
    const { text, scanned } = fromPage(html);
    assert.equal(text, `${VERIFY_URL}#${verified.envelope!.digest}`);
    assert.equal(text, `${VERIFY_URL}#${digestOf(verified.envelope!.document)}`);
    assert.equal(scanned.length, text.length);
    assert.equal(scanned, text, "the QR modules, read back through the encoder's own layout, give exactly the printed link");
    assert.ok(html.includes(env.code) && html.includes("Scan to check.") && html.includes("<svg"));
    assert.ok(!html.includes("&amp;key=") && !text.includes("key="), "no key in the link");
  }
});

test("the page changes nothing in the signed file: it is made from the envelope, and the file checks byte for byte before and after", () => {
  const env = seal(document, privateKey);
  const before = envelopeFile(env);
  const frozen = JSON.stringify(env);
  sealBlock(words, env);
  sealBlock({ ...words, scanToCheck: "<b>other</b> words" }, env);
  assert.equal(envelopeFile(env), before);
  assert.equal(JSON.stringify(env), frozen);
  assert.ok(!before.includes("<svg") && !before.includes("verify/"), "neither the QR nor the link is part of the signed document");
  assert.ok(verifyEnvelopeText(before).unchanged);
  // And a one-byte change is still refused: nothing about the page loosens the file's checks.
  assert.equal(verifyEnvelopeText(before.replace('"n":3', '"n":4')).unchanged, false);
});
