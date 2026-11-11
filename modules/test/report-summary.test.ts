// The signed summary a paper carries in its link (item 17b; modules/report/summary.ts and summary-sign.ts): one spelling only, a signature over exactly the
// bytes in the link, a changed byte anywhere refused, the size a phone can scan from paper, the committed vectors still checking, the claim fleet needs to
// list a key, and the page block that prints it. Written 11 Nov 2026; not yet run (the owner's instruction: all suites run together later).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { sealBlock } from "../report/page.ts";
import type { SealWords } from "../report/page.ts";
import { keyIdOf, publicKeyHex, seal } from "../report/sign.ts";
import { verifyCodeLink, verifyLink } from "../report/verify-link.ts";
import {
  LAYOUTS, MAX_BY_BYTES, MAX_SHOP_BYTES, SAMPLE_SUMMARY_LINK, SUMMARY_DOMAIN, SummaryError, carriedLength, decodeSummary, encodeSummary, fitText, fromBase64url,
  isPeriod, isSummaryLink, labelledFigures, readSummaryLink, signedBytes, summaryLinkOf, textBytes, toBase64url,
} from "../report/summary.ts";
import type { PaperSummary } from "../report/summary.ts";
import {
  SIGNER_CLAIM_DOMAIN, WHATSAPP_BODY_LIMIT, checkSummaryLink, goLiveSummaryFields, keyHintOf, messageCheckLink, signSummary, signerClaim, signerClaimBytes,
  summaryFor, summaryOf,
} from "../report/summary-sign.ts";
import type { ListedSigner, SummaryFields } from "../report/summary-sign.ts";
import { byteCapacity, encodeQr } from "../qr/qr.ts";
import { darkFromSvg } from "../qr/test/read.ts";

const { privateKey } = generateKeyPairSync("ed25519");
const publicKey = publicKeyHex(privateKey);
const keyId = keyIdOf(publicKey);
const listed = (pub: string, o: Partial<ListedSigner> = {}): ListedSigner => ({ key_id: keyIdOf(pub), public_key: pub, kind: "builder", name: "Kiran, Kiran Tech", since: "2026-11-11", ...o });
const LIST = [listed(publicKey)];
const DIGEST = `sha256:${"ab".repeat(32)}`;

const bookings: SummaryFields = { layout: 1, source: "live", ownerMarked: false, period: "2026-11", pathway: "bookings", shop: "Glow Salon", by: "Divya, Sri Sai Digital", figures: [38, 1_760_000, 40_000, 5, 3, 2, 1, 1] };
const malayalam: SummaryFields = { layout: 2, source: "live", ownerMarked: true, period: "2026-11", pathway: "bookings", shop: "ശ്രീ ദുർഗ്ഗ ബ്യൂട്ടി പാർലർ", by: "ദിവ്യ, ശ്രീ സായി ഡിജിറ്റൽ", figures: [138, 12, 9_760_000, 140_000, 13, 12, 1, 25, 3] };
const kannada: SummaryFields = { layout: 4, source: "test-mode", ownerMarked: true, period: "2026-11-01..2026-11-15", pathway: "fees", shop: "ಬ್ರೈಟ್ ಟ್ಯೂಷನ್ ಸೆಂಟರ್", by: "ದಿವ್ಯಾ, ಶ್ರೀ ಸಾಯಿ ಡಿಜಿಟಲ್", figures: [24_500_000, 120_000, 3_500_000, 140, 50_000, 4, 3, 1, 2] };
const make = (fields: SummaryFields) => signSummary(summaryOf(fields, DIGEST, keyId), privateKey);
const parts = (link: string) => link.slice(link.indexOf("#") + 1).split(".");
const withParts = (link: string, p: string[]) => `${link.slice(0, link.indexOf("#") + 1)}${p.join(".")}`;

// ---- one spelling only ---------------------------------------------------------------------------------------------------------------------------------

test("encoding is canonical: decode(encode(s)) is s, encode(decode(b)) is b, for every layout and both text encodings", () => {
  for (const fields of [bookings, malayalam, kannada, goLiveSummaryFields({ pathway: { name: "orders" }, shop: { name: "Annapurna Tiffins" }, preparedBy: null, issuedOn: { year: 2026, month: 11, day: 3 }, checks: { held: 31, total: 31, failed: 0 }, notTested: new Array(14) })]) {
    const s = summaryOf(fields, DIGEST, keyId);
    const bytes = encodeSummary(s);
    assert.deepEqual(decodeSummary(bytes), s);
    assert.deepEqual(encodeSummary(decodeSummary(bytes)), bytes);
    assert.deepEqual(encodeSummary(s), bytes, "the same summary is always the same bytes");
  }
});

test("a text in an Indian script travels as UTF-16 only when that is shorter, and a text written the other way is refused", () => {
  assert.equal(textBytes("Glow Salon").wide, false);
  assert.equal(textBytes("ശ്രീ ദുർഗ്ഗ").wide, true);
  assert.ok(carriedLength("ശ്രീ ദുർഗ്ഗ") < new TextEncoder().encode("ശ്രീ ദുർഗ്ഗ").length);
  // a name short enough that its UTF-8 spelling (30 bytes) is also within the cap, so only the one-spelling rule can refuse it
  const s = summaryOf({ ...malayalam, shop: "ശ്രീ ദുർഗ്ഗ" }, DIGEST, keyId);
  const bytes = encodeSummary(s);
  assert.ok(new TextEncoder().encode(s.shop).length <= MAX_SHOP_BYTES);
  // find the shop's length byte (layout, source, flags, then period and pathway as length + bytes) and rewrite the shop as UTF-8 with the narrow flag
  let at = 3;
  at += 1 + bytes[at]; // period
  at += 1 + (bytes[at] & 0x7f); // pathway
  assert.ok((bytes[at] & 0x80) !== 0, "the Malayalam shop name is wide");
  const narrow = new TextEncoder().encode(s.shop);
  const respelt = Uint8Array.from([...bytes.slice(0, at), narrow.length, ...narrow, ...bytes.slice(at + 1 + (bytes[at] & 0x7f))]);
  assert.throws(() => decodeSummary(respelt), /longer of its two encodings/u, "the same name in the longer encoding is not the one spelling");
});

test("the parser refuses every other spelling: stray base64 bits, padding, a long-form number, an unknown flag, a wrong figure count, trailing bytes, a cut summary", () => {
  const signed = make(bookings);
  const [v, p, sig] = parts(signed.link);
  // base64url: the last character of the 64-byte signature carries 2 spare bits; setting one gives the same bytes from a different text
  const last = sig.at(-1)!;
  const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const sibling = B64[B64.indexOf(last) ^ 1];
  assert.throws(() => fromBase64url(sig.slice(0, -1) + sibling), SummaryError);
  assert.equal(readSummaryLink(withParts(signed.link, [v, p, sig])).summary.shop, "Glow Salon");
  assert.throws(() => readSummaryLink(withParts(signed.link, [v, `${p}=`, sig])), SummaryError, "padding");
  assert.throws(() => readSummaryLink(withParts(signed.link, [v, p.replace(/[A-Za-z]/u, "+"), sig])), SummaryError, "plain base64's + is not base64url");
  assert.throws(() => readSummaryLink(withParts(signed.link, ["s2", p, sig])), SummaryError, "another version");
  assert.throws(() => readSummaryLink(withParts(signed.link, [v, p])), SummaryError, "no signature");
  assert.throws(() => readSummaryLink(withParts(signed.link, [v, p, sig, "x"])), SummaryError, "an extra part");

  const bytes = encodeSummary(signed.summary);
  const flags = Uint8Array.from(bytes); flags[2] = 0b10;
  assert.throws(() => decodeSummary(flags), /flag/u);
  const source = Uint8Array.from(bytes); source[1] = 3;
  assert.throws(() => decodeSummary(source), /source/u);
  assert.throws(() => decodeSummary(Uint8Array.from([...bytes, 0])), /after its end/u);
  assert.throws(() => decodeSummary(bytes.slice(0, -1)), /cut short/u);
  // a figure of 5 written as 0x85 0x00 (two bytes) instead of 0x05: same number, longer spelling
  const s = summaryOf({ ...bookings, figures: [5, 0, 0, 0, 0, 0, 0, 0] }, DIGEST, keyId);
  const plain = encodeSummary(s);
  const i = plain.length - 32 - 8 - 8; // the first figure: before the other seven one-byte figures, the key hint and the digest
  assert.equal(plain[i], 5);
  const long = Uint8Array.from([...plain.slice(0, i), 0x85, 0x00, ...plain.slice(i + 1)]);
  assert.throws(() => decodeSummary(long), /more bytes than it needs/u);
  assert.throws(() => encodeSummary({ ...s, figures: [1, 2, 3] }), /carries 8 figures/u, "a known layout's count is fixed");
  const unknownLayout = encodeSummary({ ...s, layout: 200, figures: [1, 2, 3] });
  assert.equal(decodeSummary(unknownLayout).layout, 200, "a newer layout still reads");
  assert.equal(labelledFigures(decodeSummary(unknownLayout)), null, "and shows no figures, never a guess");
});

test("texts are one line, without control or direction-changing characters, and cut at a whole character with an ellipsis", () => {
  assert.equal(fitText("Glow\n  Salon\t", 64), "Glow Salon");
  assert.equal(fitText("A\u202eB", 64), "AB", "a right-to-left override is taken out");
  const long = "ശ്രീ മഞ്ജുനാഥ ബ്രൈറ്റ് ട്യൂഷൻ സെന്റർ ആൻഡ് കമ്പ്യൂട്ടർ പരിശീലന കേന്ദ്രം";
  const cut = fitText(long, MAX_SHOP_BYTES);
  assert.ok(cut.endsWith("\u2026") && carriedLength(cut) <= MAX_SHOP_BYTES, cut);
  // the cut ends between whole characters: what is kept is the name's first N graphemes (a letter with its vowel signs and virama), never half of one
  const graphemes = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(long)].map((g) => g.segment);
  const kept = cut.slice(0, -1);
  assert.ok(graphemes.some((_, n) => graphemes.slice(0, n + 1).join("").trimEnd() === kept), kept);
  assert.throws(() => encodeSummary({ ...summaryOf(bookings, DIGEST, keyId), shop: "Glow\nSalon" }), SummaryError);
  assert.throws(() => encodeSummary({ ...summaryOf(bookings, DIGEST, keyId), by: "x".repeat(MAX_BY_BYTES + 1) }), SummaryError);
  assert.ok(isPeriod("2026-11") && isPeriod("2026-11-03") && isPeriod("2026-11-01..2026-11-15"));
  assert.ok(!isPeriod("2026-11..2026-12-01") && !isPeriod("2026-11-15..2026-11-01") && !isPeriod("2026-13") && !isPeriod("26-11"));
});

// ---- the signature ---------------------------------------------------------------------------------------------------------------------------------------

test("the signature covers the domain and exactly the payload bytes in the link, and checks against the listed key", () => {
  const signed = make(bookings);
  const read = readSummaryLink(signed.link);
  assert.deepEqual(read.signed, signedBytes(read.payload));
  assert.equal(new TextDecoder().decode(read.signed.slice(0, SUMMARY_DOMAIN.length)), "geo-summary/1\n");
  assert.ok(verify(null, read.signed, createPublicKey(privateKey), read.signature));
  const check = checkSummaryLink(signed.link, LIST);
  assert.equal(check.status, "genuine");
  assert.ok(check.status === "genuine" && check.signer.name === "Kiran, Kiran Tech" && check.summary.shop === "Glow Salon" && check.summary.keyHint === keyHintOf(keyId));
  // a document signature over the same payload (another domain) is not a summary's signature
  const asDocument = sign(null, Buffer.concat([Buffer.from("geo-document/1\n"), Buffer.from(read.payload)]), privateKey);
  assert.equal(checkSummaryLink(summaryLinkOf(read.payload, new Uint8Array(asDocument)), LIST).status, "not-genuine");
});

test("a changed payload, a changed figure re-encoded under the old signature, or a changed signature is never genuine", () => {
  const signed = make(bookings);
  const [v, p, sig] = parts(signed.link);
  // every single-character change to the payload or the signature
  const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  for (const [which, text] of [[1, p], [2, sig]] as const) {
    for (let i = 0; i < text.length; i += 7) {
      const swapped = text.slice(0, i) + B64[(B64.indexOf(text[i]) + 1) % 64] + text.slice(i + 1);
      const changed = [v, p, sig];
      changed[which] = swapped;
      assert.notEqual(checkSummaryLink(withParts(signed.link, changed), LIST).status, "genuine", `character ${i} of part ${which}`);
    }
  }
  // a cleanly re-encoded summary with one more booking, carrying the old signature
  const forged = encodeSummary({ ...signed.summary, figures: [39, ...signed.summary.figures.slice(1)] });
  assert.equal(checkSummaryLink(summaryLinkOf(forged, signed.signature), LIST).status, "not-genuine");
  // the same, re-signed by someone else: their key is not on the list, so it is not genuine either
  const other = generateKeyPairSync("ed25519").privateKey;
  const theirs = signSummary({ ...signed.summary, keyHint: keyHintOf(keyIdOf(publicKeyHex(other))) }, other);
  assert.equal(checkSummaryLink(theirs.link, LIST).status, "unknown-signer");
  // and keeping our key hint while signing with theirs: the hint finds our key, the signature does not fit it
  const disguised = signSummary(signed.summary, other);
  assert.equal(checkSummaryLink(disguised.link, LIST).status, "not-genuine");
});

test("the list is the trust: an unlisted key is not genuine, and a list entry whose id is not its key's is ignored", () => {
  const signed = make(bookings);
  assert.equal(checkSummaryLink(signed.link, []).status, "unknown-signer");
  const other = publicKeyHex(generateKeyPairSync("ed25519").privateKey);
  // an entry that claims our key id but gives another public key cannot make our summary genuine, nor theirs
  assert.equal(checkSummaryLink(signed.link, [{ ...listed(other), key_id: keyId }]).status, "unknown-signer");
  assert.equal(checkSummaryLink("https://geometer.dev/verify/#sha256:" + "a".repeat(64), LIST).status, "unreadable");
  assert.ok(isSummaryLink(signed.link) && isSummaryLink(`#${parts(signed.link).join(".")}`) && !isSummaryLink(verifyLink({ digest: DIGEST })));
  assert.equal(checkSummaryLink(`${signed.link}&key=key:${"1".repeat(64)}`, LIST).status, "genuine", "a part after & is ignored, as the /verify contract says");
});

test("a summary is made only for a signed paper and only with the paper's own key", () => {
  const document = { format: "test-paper/1", n: 1 };
  assert.equal(summaryFor(seal(document), bookings, privateKey), undefined, "an unsigned paper gets no summary");
  assert.equal(summaryFor(seal(document, privateKey), bookings), undefined, "no key, no summary");
  const env = seal(document, privateKey);
  const made = summaryFor(env, bookings, privateKey)!;
  assert.equal(made.summary.digest, env.digest, "the digest is the paper's, never the caller's");
  assert.equal(made.summary.keyHint, keyHintOf(env.signature!.keyId));
  assert.throws(() => summaryFor(env, bookings, generateKeyPairSync("ed25519").privateKey), /different key/u);
  // a figure the format cannot carry (half a paisa, a negative amount) never holds the paper back: it goes out with the #digest link
  assert.equal(summaryFor(env, { ...bookings, figures: [38, 1_760_000.5, 40_000, 5, 3, 2, 1, 1] }, privateKey), undefined);
  assert.equal(summaryFor(env, { ...bookings, figures: [38, -1, 40_000, 5, 3, 2, 1, 1] }, privateKey), undefined);
});

// ---- the committed vectors --------------------------------------------------------------------------------------------------------------------------------

test("every committed vector is genuine under its public key and reads back as written (the website's tests use the same file)", () => {
  const file = JSON.parse(readFileSync(new URL("./summary-vectors.json", import.meta.url), "utf8")) as { public_key: string; key_id: string; vectors: { name: string; link: string; summary: PaperSummary }[] };
  assert.equal(keyIdOf(file.public_key), file.key_id);
  assert.ok(!JSON.stringify(file).includes("PRIVATE"), "no private key in the file");
  const list = [listed(file.public_key)];
  assert.ok(file.vectors.length >= 5);
  for (const v of file.vectors) {
    const check = checkSummaryLink(v.link, list);
    assert.equal(check.status, "genuine", v.name);
    assert.deepEqual(check.status === "genuine" && check.summary, v.summary, v.name);
    assert.ok(labelledFigures(v.summary), `${v.name}: a known layout`);
  }
  assert.equal(SAMPLE_SUMMARY_LINK, file.vectors[0].link, "the sample in Meta's examples is the first vector");
});

// ---- size: a QR a phone reads from A4 ------------------------------------------------------------------------------------------------------------------

test("a realistic summary is a version 12 QR with Latin names and at most version 15 with names in Hindi, Malayalam or Kannada", () => {
  assert.ok(encodeQr(make(bookings).link).version <= 12, "Latin names");
  for (const fields of [malayalam, kannada, { ...bookings, shop: "ग्लो ब्यूटी सैलून", by: "दिव्या, श्री साई डिजिटल" }]) {
    const link = make(fields).link;
    const qr = encodeQr(link);
    assert.ok(qr.version <= 15, `${fields.shop}: version ${qr.version}, ${link.length} characters`);
    assert.ok(link.length <= byteCapacity(15));
  }
  // the most any summary can be: both names at their caps, a range, nine figures near ₹1 crore
  const worst = make({ ...kannada, shop: "ಶ".repeat(200), by: "ದ".repeat(200), figures: new Array(9).fill(999_999_999) });
  assert.ok(encodeQr(worst.link).version <= 16, `worst case: version ${encodeQr(worst.link).version}`); // measured 11 Nov: 449 characters, version 16
});

test("every layout has a unique number, a known paper kind and named figures; a summary carries at most 16", () => {
  const ids = LAYOUTS.map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const l of LAYOUTS) {
    assert.ok(l.id >= 1 && l.id <= 255 && l.figures.length <= 16 && l.figures.every((f) => /^[a-z][A-Za-z]+$/u.test(f.id)));
    assert.ok(["monthly-report", "monthly-certificate", "go-live-certificate"].includes(l.paper));
  }
});

// ---- on the page ---------------------------------------------------------------------------------------------------------------------------------------

const words: SealWords = { checkHeading: "Check", code: "Code", digest: "Digest", signedBy: "Signed", notSigned: "Not signed", signatureNote: "Note.", scanToCheck: "Scan to check.", scanSummary: "Scan, no file needed." };

test("the page block prints the summary link and draws exactly it as the QR, larger, tappable, with no referrer; without one, the old link as before", () => {
  const env = seal({ format: "test-paper/1", n: 2 }, privateKey);
  const link = summaryFor(env, bookings, privateKey)!.link;
  const html = sealBlock(words, env, [], link);
  const svg = html.match(/<svg[\s\S]*?<\/svg>/u)![0];
  const qr = encodeQr(link);
  assert.deepEqual(darkFromSvg(svg, qr.size), qr.dark, "the QR is the code of the summary link");
  assert.ok(html.includes('<div class="qr wide">') && html.includes(`<a href="${link}" rel="noreferrer">`) && html.includes("Scan, no file needed.") && !html.includes("Scan to check."));
  assert.ok(html.includes(env.code) && html.includes(env.digest));
  const old = sealBlock(words, env);
  assert.ok(old.includes(`<div class="mono">${verifyLink(env)}</div>`) && old.includes('<div class="qr">') && old.includes("Scan to check.") && !old.includes("<a "));
  const noSummaryWords = sealBlock({ ...words, scanSummary: undefined }, env, [], link);
  assert.ok(noSummaryWords.includes("Scan to check."), "words without scanSummary fall back to scanToCheck");
});

// ---- the WhatsApp message's check link ---------------------------------------------------------------------------------------------------------------------

test("the message carries the longest check link that fits WhatsApp's 1024 characters: the summary, then the #digest link, then the #code link", () => {
  const link = make(bookings).link;
  const env = { digest: DIGEST, code: "7K2M-9QXD" };
  const digest = verifyLink(env);
  const code = verifyCodeLink(env);
  assert.equal(code, "https://geometer.dev/verify/#7K2M-9QXD");
  const room = (n: number) => (c: string) => `${"x".repeat(WHATSAPP_BODY_LIMIT - n)}${c}`;
  assert.equal(messageCheckLink((c) => `short\n${c}`, env, link), link);
  assert.equal(messageCheckLink(room(link.length), env, link), link, "exactly at the limit still fits");
  assert.equal(messageCheckLink(room(link.length - 1), env, link), digest);
  assert.equal(messageCheckLink(room(digest.length), env, link), digest);
  assert.equal(messageCheckLink(room(digest.length - 1), env, link), code);
  assert.equal(messageCheckLink(room(0), env, link), code, "the code link even when nothing fits: nothing shorter is a link");
  assert.equal(messageCheckLink((c) => c, env, undefined), digest, "an unsigned report has no summary");
});

// ---- the claim a server sends fleet -------------------------------------------------------------------------------------------------------------------------

test("a signer claim shows the key is held, for one deployment only: the public key, and a signature over the domain, the deployment and the key", () => {
  const claim = signerClaim(privateKey, "acme-vps-1");
  assert.equal(claim.public_key, publicKey);
  assert.match(claim.proof, /^[0-9a-f]{128}$/u);
  assert.equal(signerClaimBytes("acme-vps-1", publicKey).toString("utf8"), `${SIGNER_CLAIM_DOMAIN}acme-vps-1\n${publicKey}`);
  const pub = createPublicKey(privateKey);
  assert.ok(verify(null, signerClaimBytes("acme-vps-1", publicKey), pub, Buffer.from(claim.proof, "hex")));
  assert.ok(!verify(null, signerClaimBytes("other-vps", publicKey), pub, Buffer.from(claim.proof, "hex")), "not for another deployment");
  assert.ok(!verify(null, signedBytes(new TextEncoder().encode(`acme-vps-1\n${publicKey}`)), pub, Buffer.from(claim.proof, "hex")), "not a summary's signature");
  assert.throws(() => signerClaim(privateKey, "Not An Id"), /deployment id/u);
});

test("toBase64url and fromBase64url round-trip every length", () => {
  for (let n = 0; n < 70; n++) {
    const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + n) & 255);
    const text = toBase64url(bytes);
    assert.ok(/^[A-Za-z0-9_-]*$/u.test(text) && !text.includes("="));
    assert.deepEqual(fromBase64url(text), bytes);
    assert.equal(text, Buffer.from(bytes).toString("base64url"), "the same as Node's");
  }
});
