// Writes the test vectors of the Go report package (go/internal/report/testdata/): what modules/report/*.ts gives on a set of cases, made by RUNNING the TypeScript on Node. The
// Go tests compare byte for byte. The signing key is a TEST VALUE made from a fixed 32-byte seed (so Ed25519's deterministic signatures can be compared); it signs nothing real.
//   testdata/vectors.json     canonical JSON, digests, seals and their files, the verdicts of verifyEnvelopeText, signed summaries and what reading them back and checking them gives,
//                             fitText, messageCheckLink at the limit, page(), table(), list(), sealBlock(), months, the text helpers in four languages, settledByWordOf and
//                             settledByWordWords, the claim rules, the go-live reading, the verify links
//   testdata/graphemes.json   what Intl.Segmenter cuts: every code point after and before "a", all pairs of a few hundred edge code points, and hand-made strings (Hindi, Malayalam,
//                             Kannada, Latin with combining marks, emoji with ZWJ, flags, Hangul)
// Run from the repository root:  node go/scripts/gen_report_vectors.ts   (--check only compares)
import { createPrivateKey } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson } from "../../modules/record/record.ts";
import type { RecordEntry } from "../../modules/record/record.ts";
import { digestOf, sha256, verificationCode } from "../../modules/report/digest.ts";
import { envelopeFile, keyIdOf, publicKeyHex, seal, verifyEnvelopeText } from "../../modules/report/sign.ts";
import { LAYOUTS, SAMPLE_SUMMARY_LINK, carriedLength, fitText, isPeriod, isSummaryLink, labelledFigures, readSummaryLink, textBytes } from "../../modules/report/summary.ts";
import { checkSummaryLink, dayOf, goLiveSummaryFields, keyHintOf, messageCheckLink, periodOf, signSummary, signerClaim, summaryFor, summaryOf } from "../../modules/report/summary-sign.ts";
import type { ListedSigner, SummaryFields } from "../../modules/report/summary-sign.ts";
import { esc, fig, list, page, sealBlock, table } from "../../modules/report/page.ts";
import type { SealWords } from "../../modules/report/page.ts";
import { INNOVATOR, SETTLED_BY_WORD, badgeText, languagesOf, oneLine, periodLabel, rupees, settledByWordWords, settledWho } from "../../modules/report/text.ts";
import { settledByWordOf } from "../../modules/report/settled-by-word.ts";
import { monthRange } from "../../modules/report/months.ts";
import { BANNED, bannedIn } from "../../modules/report/claims.ts";
import { GO_LIVE_FORMAT, readGoLiveText } from "../../modules/report/go-live.ts";
import { verifyCodeLink, verifyCodePath, verifyLink, verifyQrSvg } from "../../modules/report/verify-link.ts";
import { whatThisChecksBlock } from "../../modules/report/what-this-checks.ts";
import { lastMonth, sendFrom } from "../../modules/report/monthly-job.ts";
import { LANGUAGES } from "../../modules/language/languages.ts";
import type { Language } from "../../modules/language/languages.ts";
import { nothingWasSent } from "../../modules/messaging/send-once.ts";
import { ApiError, GuardUnavailableError, NotSentError, WindowClosedError } from "../../modules/core/faults.ts";

const here = dirname(fileURLToPath(import.meta.url));
const INTERNAL = join(here, "..", "internal");
export const OUT = INTERNAL;

// ---- the test keys: fixed seeds, never real keys ----
const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const keyFromSeed = (seed: Buffer): KeyObject => createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, seed]), format: "der", type: "pkcs8" });
const SEED = Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 7 + 3) & 255));
const SEED2 = Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 11 + 5) & 255));
const KEY = keyFromSeed(SEED);
const KEY2 = keyFromSeed(SEED2);
const PUB = publicKeyHex(KEY);
const KEY_ID = keyIdOf(PUB);
const PUB2 = publicKeyHex(KEY2);

/** What a call gives, or the message it threw: the Go test compares both. */
const trial = <T>(fn: () => T): { ok: T } | { error: string } => { try { return { ok: fn() }; } catch (e) { return { error: (e as Error).message }; } };
const hex = (u: Uint8Array): string => Buffer.from(u).toString("hex");

// ---- canonical JSON ----
const TREES: unknown[] = [
  null, true, false, 0, 1, -1, 1.5, -0.25, 0.1 + 0.2, 100, 1e21, 1e20, 123456789012345680000, 1e-7, 0.000001, 5e-324, 1.7976931348623157e308, 9007199254740991, 4.35, 2 ** 53, 1.0000000000000002,
  "", "plain", 'quote " and back \\ slash', "tab\tnl\ncr\rbs\bff\f", "\u0001\u001f\u007f", "line para sep", "<script>alert(1)&</script>", "emoji 😀 and é and ക്ഷ", "é́",
  [], {}, [1, [2, [3, []]]], { b: 1, a: 2, "": 3, B: 4, "é": 5, "\u{10000}": 6, "～": 7, "": 8, "ab": 9, "a": 10 },
  { document: { items: [{ n: 1, paise: 1760000 }, { n: 2, paise: 40000 }], note: "नमस्ते", flag: true, none: null }, format: "x" },
  { "key with \"quotes\"": "v", "ключ": "значение", "日本": [1, 2, 3] },
];

// ---- documents to seal (any JSON) ----
const DOCUMENTS: unknown[] = [
  { kind: "report", month: "2026-11", paise: 1760000, count: 38, shop: "Glow Salon", anchor: null },
  { kind: "report", shop: "ग्लो सैलून", by: "ദിവ്യ, ശ്രീ സായി", figures: [1, 2, 3], ratio: 0.1 + 0.2, big: 1e21 },
  { a: 1 },
  [1, "two", { three: 3 }],
  "just text",
  { format: "geometer-go-live-certificate/1", anchor: null, note: "ಕನ್ನಡ" },
];

const flip = (text: string, from: string, to: string): string => text.replace(from, to);
const sealedCases = DOCUMENTS.flatMap((document) => [
  { document: JSON.stringify(document), key: "main", ...(() => { const e = seal(document, KEY); return { digest: e.digest, code: e.code, file: envelopeFile(e), signature: e.signature }; })() },
  { document: JSON.stringify(document), key: "none", ...(() => { const e = seal(document); return { digest: e.digest, code: e.code, file: envelopeFile(e), signature: e.signature }; })() },
]);

/** The texts verifyEnvelopeText is asked about: good files and files changed in each way it checks. */
function verifyTexts(): { name: string; text: string }[] {
  const signed = envelopeFile(seal({ kind: "report", paise: 100, anchor: null, shop: "Glow" }, KEY));
  const signedOther = envelopeFile(seal({ kind: "report", paise: 100, anchor: null, shop: "Glow" }, KEY2));
  const unsigned = envelopeFile(seal({ kind: "report", paise: 100, shop: "Glow" }));
  const env = JSON.parse(signed);
  const reissue = (mutate: (e: any) => void): string => { const e = JSON.parse(signed); mutate(e); return `${canonicalJson(e)}\n`; };
  const sig = env.signature;
  return [
    { name: "signed", text: signed }, { name: "signed by another key", text: signedOther }, { name: "unsigned", text: unsigned },
    { name: "a digit changed", text: flip(signed, "100", "900") }, { name: "re-spaced", text: signed.replace(/,"/, ', "') }, { name: "no newline", text: signed.trimEnd() },
    { name: "two newlines", text: `${signed}\n` }, { name: "not json", text: "this is not json" }, { name: "empty", text: "" }, { name: "array", text: "[1,2]\n" }, { name: "a number", text: "5\n" },
    { name: "trailing text", text: `${signed}x` },
    { name: "other format", text: reissue((e) => { e.format = "geometer-document/2"; }) },
    { name: "extra key", text: reissue((e) => { e.extra = 1; }) },
    { name: "missing key", text: reissue((e) => { delete e.code; }) },
    { name: "wrong digest", text: reissue((e) => { e.digest = `sha256:${"0".repeat(64)}`; }) },
    { name: "digest not a string", text: reissue((e) => { e.digest = 5; }) },
    { name: "wrong code", text: reissue((e) => { e.code = "AAAA-AAAA"; }) },
    { name: "wrong key id", text: reissue((e) => { e.signature.keyId = `key:${"1".repeat(64)}`; }) },
    { name: "wrong signature", text: reissue((e) => { e.signature.value = "0".repeat(128); }) },
    { name: "short signature", text: reissue((e) => { e.signature.value = "0".repeat(10); }) },
    { name: "signature extra field", text: reissue((e) => { e.signature.more = 1; }) },
    { name: "signature a string", text: reissue((e) => { e.signature = "signed"; }) },
    { name: "signature wrong algorithm", text: reissue((e) => { e.signature.algorithm = "rsa"; }) },
    { name: "document changed but digest kept", text: reissue((e) => { e.document.paise = 101; }) },
    { name: "document changed, digest and code redone, signature kept", text: reissue((e) => { e.document.paise = 101; e.digest = digestOf(e.document); e.code = verificationCode(e.digest); }) },
    { name: "signed again with another key", text: reissue((e) => { const s = seal(e.document, KEY2); e.digest = s.digest; e.code = s.code; e.signature = s.signature; }) },
    { name: "a big number", text: `${canonicalJson({ code: "x", digest: "y", document: 1e21, format: "geometer-document/1", signature: null })}\n` },
    { name: "public key of the signature changed", text: reissue((e) => { e.signature.publicKey = sig.publicKey.replace(/^./, sig.publicKey[0] === "a" ? "b" : "a"); }) },
  ];
}

// ---- signed summaries ----
const DIGEST = `sha256:${"ab".repeat(32)}`;
const figuresFor = (layoutId: number, base: number): number[] => LAYOUTS.find((l) => l.id === layoutId)!.figures.map((_, i) => base * (i + 1) + i);
const NAMES = {
  latin: "Glow Salon", hindi: "ग्लो सैलून दिल्ली", malayalam: "ശ്രീ ദുർഗ്ഗ ബ്യൂട്ടി പാർലർ", kannada: "ಬ್ರೈಟ್ ಟ್ಯೂಷನ್ ಸೆಂಟರ್",
  longLatin: "The Very Long Named Neighbourhood Hair and Beauty Salon and Spa of Greater Kochi", longMalayalam: "ശ്രീ ദുർഗ്ഗാ ഭഗവതി ബ്യൂട്ടി പാർലർ ആൻഡ് ഹെയർ സ്റ്റുഡിയോ എറണാകുളം കൊച്ചി",
  longHindi: "श्री लक्ष्मी नारायण स्त्री सौंदर्य एवं केश सज्जा केंद्र, कनॉट प्लेस, नई दिल्ली", longKannada: "ಶ್ರೀ ಲಕ್ಷ್ಮೀ ನಾರಾಯಣ ಸ್ತ್ರೀ ಸೌಂದರ್ಯ ಮತ್ತು ಕೇಶ ವಿನ್ಯಾಸ ಕೇಂದ್ರ ಬೆಂಗಳೂರು",
  messy: "  Glow \n\t Salon ​‮  ", emojiLong: "👨‍👩‍👧‍👦".repeat(12), mixed: "Café Déjà Vu ക്ഷേമം", bidi: "A‮B⁦C⁩D", zwj: "ക്ക‍കോ",
} as const;
const SUMMARY_CASES: { name: string; fields: SummaryFields; signer: "main" | "other" }[] = [];
const sources = ["live", "test-mode", "stand-in"] as const;
for (const layout of LAYOUTS) {
  SUMMARY_CASES.push({ name: `layout ${layout.id} latin`, signer: "main", fields: { layout: layout.id, source: sources[layout.id % 3], ownerMarked: layout.id % 2 === 0, period: layout.paper === "go-live-certificate" ? "2026-11-03" : "2026-11", pathway: layout.template === "any" ? "orders" : layout.template, shop: NAMES.latin, by: "Divya, Sri Sai Digital", figures: figuresFor(layout.id, 37) } });
}
for (const [k, shop] of Object.entries(NAMES)) {
  SUMMARY_CASES.push({ name: `shop ${k}`, signer: "main", fields: { layout: 1, source: "live", ownerMarked: false, period: "2026-11-01..2026-11-15", pathway: "bookings", shop, by: k.endsWith("indi") ? "दिव्या, श्री साईं डिजिटल" : null as unknown as string, figures: figuresFor(1, 1_000_003) } });
  SUMMARY_CASES.push({ name: `by ${k}`, signer: "other", fields: { layout: 4, source: "test-mode", ownerMarked: true, period: "2026-11", pathway: "fees", shop: NAMES.latin, by: shop, figures: figuresFor(4, 1) } });
}
SUMMARY_CASES.push(
  { name: "figures at the edges", signer: "main", fields: { layout: 3, source: "stand-in", ownerMarked: false, period: "2026-11-03", pathway: "bookings", shop: "Edge", by: "", figures: [0, 127, 128, 2 ** 53 - 1] } },
  { name: "big figures", signer: "main", fields: { layout: 3, source: "stand-in", ownerMarked: false, period: "2026-11-03", pathway: "bookings", shop: "Edge", by: "", figures: [16383, 16384, 2 ** 31, 2 ** 40] } },
  { name: "a negative figure", signer: "main", fields: { layout: 3, source: "live", ownerMarked: false, period: "2026-11-03", pathway: "bookings", shop: "Edge", by: "", figures: [1, 2, -3, 4] } },
  { name: "a fraction", signer: "main", fields: { layout: 3, source: "live", ownerMarked: false, period: "2026-11-03", pathway: "bookings", shop: "Edge", by: "", figures: [1, 2, 3.5, 4] } },
  { name: "too many figures for the layout", signer: "main", fields: { layout: 3, source: "live", ownerMarked: false, period: "2026-11-03", pathway: "bookings", shop: "Edge", by: "", figures: [1, 2, 3, 4, 5] } },
  { name: "unknown layout", signer: "main", fields: { layout: 99, source: "live", ownerMarked: false, period: "2026-11", pathway: "bookings", shop: "Edge", by: "", figures: [1, 2, 3] } },
  { name: "bad period", signer: "main", fields: { layout: 3, source: "live", ownerMarked: false, period: "2026-13", pathway: "bookings", shop: "Edge", by: "", figures: [1, 2, 3, 4] } },
  { name: "a range from a month", signer: "main", fields: { layout: 3, source: "live", ownerMarked: false, period: "2026-11..2026-11-15", pathway: "bookings", shop: "Edge", by: "", figures: [1, 2, 3, 4] } },
  { name: "a backwards range", signer: "main", fields: { layout: 3, source: "live", ownerMarked: false, period: "2026-11-15..2026-11-01", pathway: "bookings", shop: "Edge", by: "", figures: [1, 2, 3, 4] } },
  { name: "empty shop", signer: "main", fields: { layout: 3, source: "live", ownerMarked: false, period: "2026-11", pathway: "bookings", shop: "  ", by: "", figures: [1, 2, 3, 4] } },
  { name: "wrong key for the paper", signer: "other", fields: { layout: 3, source: "live", ownerMarked: false, period: "2026-11", pathway: "bookings", shop: "Edge", by: "", figures: [1, 2, 3, 4] } },
);

function summaryRecord(c: (typeof SUMMARY_CASES)[number]) {
  const paperKey = c.name === "wrong key for the paper" ? KEY : c.signer === "main" ? KEY : KEY2;
  const useKey = c.name === "wrong key for the paper" ? KEY2 : paperKey;
  const doc = { kind: "paper", shop: c.fields.shop, case: c.name };
  const envelope = seal(doc, paperKey);
  const result = trial(() => summaryFor(envelope, c.fields, useKey));
  const out: Record<string, unknown> = { name: c.name, fields: c.fields, document: JSON.stringify(doc), signer: paperKey === KEY ? "main" : "other", signWith: useKey === KEY ? "main" : "other", digest: envelope.digest, keyId: envelope.signature!.keyId };
  if ("error" in result) out.error = result.error;
  else if (result.ok === undefined) out.none = true;
  else out.summary = { summary: result.ok.summary, payload: hex(result.ok.payload), signature: hex(result.ok.signature), link: result.ok.link };
  return out;
}

// What a summary link gives when read, over good links and links changed in each way.
function linkCases(): { name: string; link: string }[] {
  const good = summaryFor(seal({ k: 1 }, KEY), SUMMARY_CASES[0].fields, KEY)!;
  const mal = summaryFor(seal({ k: 2 }, KEY), SUMMARY_CASES.find((c) => c.name === "shop malayalam")!.fields, KEY)!;
  const link = good.link;
  const frag = link.slice(link.indexOf("#") + 1).split(".");
  const swap = (s: string, i: number) => s.slice(0, i) + (s[i] === "A" ? "B" : "A") + s.slice(i + 1);
  const L = (p: string[]) => `${link.slice(0, link.indexOf("#") + 1)}${p.join(".")}`;
  const payload = Buffer.from(frag[1], "base64url");
  const withPayload = (b: Buffer) => L([frag[0], b.toString("base64url"), frag[2]]);
  return [
    { name: "good", link }, { name: "good, malayalam", link: mal.link }, { name: "fragment only", link: frag.join(".") }, { name: "with #", link: `#${frag.join(".")}` }, { name: "with &key", link: `${link}&key=key:${"0".repeat(64)}` },
    { name: "the sample link", link: SAMPLE_SUMMARY_LINK }, { name: "a payload char changed", link: L([frag[0], swap(frag[1], 10), frag[2]]) }, { name: "a payload char changed late", link: L([frag[0], swap(frag[1], frag[1].length - 5), frag[2]]) },
    { name: "a signature char changed", link: L([frag[0], frag[1], swap(frag[2], 3)]) }, { name: "padding", link: `${link}==` }, { name: "extra char", link: L([frag[0], `${frag[1]}A`, frag[2]]) },
    { name: "wrong version", link: L(["s2", frag[1], frag[2]]) }, { name: "two parts", link: L([frag[0], frag[1]]) }, { name: "four parts", link: L([...frag, "x"]) }, { name: "standard base64 chars", link: L([frag[0], frag[1].replace(/[-_]/g, "+"), frag[2]]) },
    { name: "old digest link", link: `https://geometer.dev/verify/#sha256:${"a".repeat(64)}` }, { name: "empty", link: "" }, { name: "short signature", link: L([frag[0], frag[1], frag[2].slice(0, 40)]) },
    { name: "payload cut", link: withPayload(payload.subarray(0, payload.length - 3)) }, { name: "payload with a trailing byte", link: withPayload(Buffer.concat([payload, Buffer.from([0])])) },
    { name: "layout 0", link: withPayload(Buffer.concat([Buffer.from([0]), payload.subarray(1)])) }, { name: "source 9", link: withPayload(Buffer.concat([payload.subarray(0, 1), Buffer.from([9]), payload.subarray(2)])) },
    { name: "unknown flag", link: withPayload(Buffer.concat([payload.subarray(0, 2), Buffer.from([2]), payload.subarray(3)])) }, { name: "unknown layout", link: withPayload(Buffer.concat([Buffer.from([200]), payload.subarray(1)])) },
    { name: "non-ASCII char", link: L([frag[0], "é" + frag[1], frag[2]]) },
  ];
}

const SIGNERS: ListedSigner[] = [
  { key_id: KEY_ID, public_key: PUB, kind: "builder", name: "Kiran, Kiran Tech", since: "2026-11-11" },
  { key_id: keyIdOf(PUB2), public_key: PUB2, kind: "partner", name: null, since: "2026-11-12" },
  { key_id: `key:${"f".repeat(64)}`, public_key: PUB, kind: "geometer", name: "liar", since: "2026-11-13" },
  { key_id: KEY_ID, public_key: "zz", kind: "builder", name: "bad key", since: "2026-11-13" },
];

// ---- text helpers ----
const PERIODS = [
  { month: { year: 2026, month: 11 }, firstDay: { year: 2026, month: 11, day: 1 }, lastDay: { year: 2026, month: 11, day: 30 } },
  { month: null, firstDay: { year: 2026, month: 11, day: 3 }, lastDay: { year: 2026, month: 11, day: 9 } },
  { month: { year: 2027, month: 1 }, firstDay: { year: 2027, month: 1, day: 1 }, lastDay: { year: 2027, month: 1, day: 31 } },
  { month: null, firstDay: { year: 2026, month: 12, day: 28 }, lastDay: { year: 2027, month: 1, day: 3 } },
];
const SETTLED_ROWS = [[], [{ by: "operator:asha", count: 1, paise: 20000 }], [{ by: "operator:asha", count: 2, paise: 45050 }, { by: "operator:bhaskar", count: 1, paise: 9900 }],
  [{ by: "operator:asha", count: 2, paise: 45050 }, { by: "meera", count: 1, paise: 9900 }, { by: "  ravi \n kumar  ", count: 4, paise: 100 }, { by: "operator:zed", count: 1, paise: 1 }],
  [{ by: "operator:ഹരിത", count: 3, paise: 123456 }, { by: "operator:" + "x".repeat(60), count: 1, paise: 5 }], [{ by: "operator:", count: 1, paise: 0 }], [{ by: "ഹ".repeat(45), count: 1, paise: 5 }]];

function entry(seq: number, refs: Record<string, string>, over: Partial<RecordEntry> = {}): RecordEntry {
  return { seq, time: "2026-11-05T10:00:00.000Z", conversation: "owner", booking: null, action: "refund", inputsDigest: "x", outcome: "confirmed", decisions: [], language: "en", notes: "", refs, ...over } as RecordEntry;
}
const SETTLED_ENTRY_SETS: RecordEntry[][] = [
  [entry(1, { confirmedBy: "operator:asha", paymentId: "p1", amountPaise: "20000" }), entry(2, { confirmedBy: "operator:asha", paymentId: "p1", amountPaise: "20000" }), entry(3, { confirmedBy: "operator:bhaskar", paymentId: "p2", amountPaise: "9900" })],
  [entry(1, { confirmedBy: "operator:b", paymentId: "p1", amountPaise: "" }), entry(2, { confirmedBy: "operator:b", paymentId: "p2", amountPaise: " 12 " }), entry(3, { confirmedBy: "operator:b", paymentId: "p3", amountPaise: "0x10" }),
    entry(4, { confirmedBy: "operator:b", paymentId: "p4", amountPaise: "1e2" }), entry(5, { confirmedBy: "operator:b", paymentId: "p5", amountPaise: "abc" }), entry(6, { confirmedBy: "operator:b", paymentId: "p6" }),
    entry(7, { confirmedBy: "operator:b", paymentId: "p7", amountPaise: "-5" }), entry(8, { confirmedBy: "operator:b", paymentId: "p8", amountPaise: "12.5" }), entry(9, { confirmedBy: "operator:b", amountPaise: "7" }),
    entry(10, { confirmedBy: "operator:b", amountPaise: "8" }), entry(11, { confirmedBy: "operator:b", paymentId: "p9", amountPaise: "1,000" }), entry(12, { confirmedBy: "operator:b", paymentId: "p10", amountPaise: "5." }),
    entry(13, { confirmedBy: "operator:b", paymentId: "p11", amountPaise: ".5e1" }), entry(14, { confirmedBy: "operator:b", paymentId: "p12", amountPaise: "0b11" }), entry(15, { confirmedBy: "operator:b", paymentId: "p13", amountPaise: "Infinity" })],
  [entry(1, { confirmedBy: "z", refundId: "r1", paymentId: "p1", amountPaise: "5" }), entry(2, { confirmedBy: "", paymentId: "p2", amountPaise: "5" }), entry(3, { paymentId: "p3", amountPaise: "5" }), entry(4, { confirmedBy: "z", paymentId: "p4", amountPaise: "5" }, { outcome: "failed" }),
    entry(5, { confirmedBy: "z", paymentId: "p5", amountPaise: "5" }, { action: "send_message" }), entry(6, { confirmedBy: "\u{10000}", paymentId: "p6", amountPaise: "1" }), entry(7, { confirmedBy: "～", paymentId: "p7", amountPaise: "2" }), entry(8, { confirmedBy: "b", paymentId: "p8", amountPaise: "3" })],
  [],
];

const CLAIM_TEXTS = ["Your booking is safe with us", "Guaranteed refund", "Certified by Geometer", "A certificate is attached", "100% sure", "100 % sure", "You will earn more", "Total income", "Profit and revenue", "risk-free", "fool proof", "secured payment", "proven", "unsafe",
  "सुरक्षित भुगतान", "गारंटी", "कमाई", "आमदनी", "मुनाफ़ा", "प्रमाणित", "സുരക്ഷിതം", "ഗ്യാരണ്ടി", "ലാഭം", "ഉറപ്പ് നൽകുന്നു", "ഉറപ്പുനൽകുന്നു", "ಸುರಕ್ಷಿತ", "ಖಾತರಿ", "ಲಾಭ", "ಆದಾಯ", "ಪ್ರಮಾಣೀಕರಿಸ", "Nothing to flag here", "", "Salary", "Earnest", "Learn", "Safeguard"];

const WORDS: SealWords = { checkHeading: "Check this paper", code: "Code", digest: "Digest", signedBy: "Signed by", notSigned: "Not signed", signatureNote: "A signature shows it has not changed.", scanToCheck: "Scan to check <this> & that.", scanSummary: "Scan: it runs on your phone." };
const WORDS_NO_SUMMARY: SealWords = { ...WORDS }; delete WORDS_NO_SUMMARY.scanSummary;

function goLiveCases() {
  const ownDigest = sha256("own settings");
  const exampleDigest = sha256("example settings");
  const otherDigest = sha256("other settings");
  const doc = (over: Record<string, unknown> = {}) => ({ format: GO_LIVE_FORMAT, checkedPolicyDigest: ownDigest, issuedOn: { year: 2026, month: 11, day: 3 }, checks: { held: 29, total: 31, failed: 2 }, notTested: ["a", "b", "c"], pathway: { name: "bookings" }, ...over });
  const subject = { pathway: ["bookings", "bring-your-own"], ownDigest, exampleDigest, noun: "shop", exampleName: "Glow Salon" };
  const signedText = (d: unknown, key?: KeyObject) => envelopeFile(seal(d, key));
  const cases: { name: string; text: string }[] = [
    { name: "own", text: signedText(doc(), KEY) }, { name: "own, notRun", text: signedText(doc({ checks: { held: 1, total: 3, failed: 0, notRun: ["x", "y"] } }), KEY) }, { name: "example", text: signedText(doc({ checkedPolicyDigest: exampleDigest }), KEY) },
    { name: "different", text: signedText(doc({ checkedPolicyDigest: otherDigest }), KEY) }, { name: "other template", text: signedText(doc({ pathway: { name: "fees" } }), KEY) }, { name: "second accepted name", text: signedText(doc({ pathway: { name: "bring-your-own" } }), KEY) },
    { name: "no pathway", text: signedText(doc({ pathway: undefined }), KEY) }, { name: "unsigned", text: signedText(doc()) }, { name: "tampered", text: signedText(doc(), KEY).replace("29", "30") }, { name: "not json", text: "nope" },
    { name: "not a go-live certificate", text: signedText({ format: "other/1" }, KEY) }, { name: "a string document", text: signedText("hello", KEY) }, { name: "missing notTested", text: signedText(doc({ notTested: undefined }), KEY) },
    { name: "bad date", text: signedText(doc({ issuedOn: { year: 2026, month: 13, day: 3 } }), KEY) }, { name: "bad count", text: signedText(doc({ checks: { held: -1, total: 3, failed: 0 } }), KEY) }, { name: "fractional count", text: signedText(doc({ checks: { held: 1.5, total: 3, failed: 0 } }), KEY) },
    { name: "bad notRun", text: signedText(doc({ checks: { held: 1, total: 3, failed: 0, notRun: 4 } }), KEY) }, { name: "bad digest", text: signedText(doc({ checkedPolicyDigest: "sha256:zz" }), KEY) },
  ];
  return { subject, cases: cases.map((c) => ({ ...c, reading: readGoLiveText(c.text, { ...subject }) })) };
}

function pageCases() {
  const sections = [`<section lang="hi"><h1>शीर्षक</h1></section>`, `<section class="doc"><h1>Title</h1></section>`, `<section data-x="1" lang="ml"><p>x</p></section>`, `<section lang="kn"></section>`, `<div>no section</div>`, `<section lang="xx">z</section>`];
  const envelopeSigned = seal({ kind: "report", shop: "Glow" }, KEY);
  const envelopeUnsigned = seal({ kind: "report", shop: "Glow" });
  const summary = summaryFor(envelopeSigned, SUMMARY_CASES[0].fields, KEY)!;
  return {
    pages: LANGUAGES.flatMap((l) => [{ title: `Report <"${l}"> & 'x'`, lang: l, sections: [sections[0], sections[1]] }, { title: "one", lang: l, sections: sections.slice(2) }, { title: "none", lang: l, sections: [] }]).map((p) => ({ ...p, html: page(p.title, p.lang as Language, p.sections) })),
    esc: ["", "plain", `<a href="x">'&'</a>`, "a&amp;b", "नमस्ते <b>"].map((v) => ({ value: v, out: esc(v) })),
    fig: ["", "0", "₹1,200", "<5>", "a&b"].map((v) => ({ value: v, out: fig(v) })),
    figNumber: [0, 5, 1760000].map((v) => ({ value: v, out: fig(v) })),
    table: [{ head: [{ text: "Item" }, { text: "Amount <₹>", n: true }, { text: "Note" }], rows: [["a", "<strong>1</strong>", "x<br>y"], ["b", "2"], ["c", "3", "n", "extra"]] }, { head: [], rows: [] }, { head: [{ text: "H", n: true }], rows: [] }].map((t) => ({ ...t, html: table(t.head, t.rows) })),
    list: [[], ["a"], ["<b>", "a & b", "नमस्ते"]].map((items) => ({ items, html: list(items) })),
    sealBlocks: [
      { words: WORDS, envelope: envelopeSigned, extra: [["Month", "2026-11"], ["Shop <x>", "Glow & Co"]], summaryLink: summary.link },
      { words: WORDS, envelope: envelopeSigned, extra: [], summaryLink: null },
      { words: WORDS, envelope: envelopeUnsigned, extra: [], summaryLink: null },
      { words: WORDS_NO_SUMMARY, envelope: envelopeSigned, extra: [], summaryLink: summary.link },
    ].map((c) => ({ words: c.words, envelope: c.envelope, extra: c.extra, summaryLink: c.summaryLink, html: sealBlock(c.words, c.envelope, c.extra as [string, string][], c.summaryLink ?? undefined) })),
    whatThisChecks: LANGUAGES.map((l) => ({ lang: l, html: whatThisChecksBlock(l) })),
  };
}

export function generateVectors(): unknown {
  const MAIN = KEY;
  const envMain = seal({ shop: "x" }, MAIN);
  const checkLinks = linkCases();
  const messageLimit = (() => {
    // the longest message the summary link still fits, then one unit more; Hindi padding counts UTF-16 units, an emoji pad counts two
    const summary = summaryFor(envMain, SUMMARY_CASES[0].fields, MAIN)!;
    const out: unknown[] = [];
    for (const pad of ["x", "नमस्ते", "😀"]) {
      for (const link of ["summary", "digest"] as const) {
        const target = link === "summary" ? summary.link : verifyLink(envMain);
        const unit = pad.length; // UTF-16 units per pad char
        const count = Math.floor((1024 - target.length) / unit);
        for (const n of [count - 1, count, count + 1, count + 2]) {
          const fill = (c: string) => pad.repeat(n) + c;
          out.push({ pad, n, summaryLink: summary.link, digest: envMain.digest, code: envMain.code, expected: messageCheckLink(fill, envMain, summary.link), noSummary: messageCheckLink(fill, envMain) });
        }
      }
    }
    return out;
  })();
  return {
    keys: { seed: hex(SEED), publicKey: PUB, keyId: KEY_ID, seed2: hex(SEED2), publicKey2: PUB2},
    canonical: TREES.map((t) => ({ json: JSON.stringify(t), out: canonicalJson(t), digest: digestOf(t) })),
    numbers: [0, 1, -1, 1.5, 1e21, 1e-7, 123456789012345680000, 5e-324, 1e300, 0.000001, 1e-6 / 3, 2 ** 53, 255, 1 / 3, 100, 12345.678].map((n) => ({ number: n, text: JSON.stringify(n) })),
    codes: [sha256("a"), sha256("b"), sha256(""), `sha256:${"0".repeat(64)}`, `sha256:${"f".repeat(64)}`, "sha256:abc", "md5:xx", `sha256:${"A".repeat(64)}`, `sha256:${"0".repeat(64)}\n`].map((d) => ({ digest: d, ...trial(() => verificationCode(d)) })),
    sealed: sealedCases,
    verify: verifyTexts().flatMap(({ name, text }) => [[], [KEY_ID], [keyIdOf(PUB2)]].map((trust) => ({ name, text, trust, verdict: (() => { const v = verifyEnvelopeText(text, trust); return { unchanged: v.unchanged, signed: v.signed, trusted: v.trusted, keyId: v.keyId, checks: v.checks, notChecked: v.notChecked, summary: v.summary, envelope: v.envelope ?? null }; })() }))),
    summaries: SUMMARY_CASES.map(summaryRecord),
    fitText: [["Glow Salon", 64], ["Glow Salon", 5], ["  a \n b ", 64], [NAMES.longLatin, 64], [NAMES.longLatin, 32], [NAMES.longMalayalam, 64], [NAMES.longHindi, 64], [NAMES.longKannada, 64], [NAMES.emojiLong, 64], ["é".repeat(30), 20], ["क्षत्रिय ज्ञान", 14], ["ക്ഷേത്രം ക്ഷീരം", 14], ["ಕ್ಷೇತ್ರ ಕ್ಷಮೆ", 12],
      ["🇮🇳🇺🇸🇬🇧🇫🇷🇩🇪", 20], ["abc​def‮ghi", 64], ["a\u0085b", 64], ["a﻿b", 64], ["a ​ b", 64], ["", 10], ["x", 0], ["xyz", 1], [" nbsp ", 64], ["ab cd", 64], ["🏳️‍🌈 pride flag", 10], ["한국어 가게 이름이 아주 긴 경우", 20], ["a".repeat(70), 64], ["é".repeat(40), 64]]
      .map(([text, max]) => ({ text, max, out: fitText(text as string, max as number), carried: carriedLength(text as string), wide: textBytes(text as string).wide })),
    texts: Object.values(NAMES).map((t) => ({ text: t, wide: textBytes(t).wide, length: carriedLength(t) })),
    links: checkLinks.map((c) => ({ ...c, read: trial(() => { const r = readSummaryLink(c.link); return { summary: r.summary, payload: hex(r.payload), signature: hex(r.signature), signed: hex(r.signed) }; }), isSummary: isSummaryLink(c.link), figures: trial(() => labelledFigures(readSummaryLink(c.link).summary)), check: checkSummaryLink(c.link, SIGNERS), checkNoSigners: checkSummaryLink(c.link, []) })),
    signers: SIGNERS,
    periods: ["2026-11", "2026-11-03", "2026-11-01..2026-11-15", "2026-11..2026-11-15", "2026-13", "2026-11-15..2026-11-01", "2026-11-01..2026-11-01", "٢٠٢٦-١١", "2026-11\n", "2026-00", "2026-11-32", "2026-11-31"].map((p) => ({ period: p, ok: isPeriod(p) })),
    periodOf: PERIODS.map((p) => ({ period: p, out: periodOf(p), label: LANGUAGES.map((l) => periodLabel(p, l)) })),
    dayOf: [{ year: 2026, month: 1, day: 5 }, { year: 2026, month: 11, day: 30 }].map((d) => ({ date: d, out: dayOf(d) })),
    goLiveFields: [{ pathway: { name: "bookings" }, shop: { name: "Annapurna" }, preparedBy: null, issuedOn: { year: 2026, month: 11, day: 3 }, checks: { held: 31, total: 31, failed: 0 }, notTested: new Array(14) }, { pathway: { name: "fees" }, shop: { name: "ಬ್ರೈಟ್" }, preparedBy: "ದಿವ್ಯ", issuedOn: { year: 2026, month: 1, day: 30 }, checks: { held: 1, total: 31, failed: 4 }, notTested: [] }].map((c) => ({ cert: c, fields: goLiveSummaryFields(c) })),
    keyHints: [KEY_ID, "key:abc", `key:${"A".repeat(64)}`, ""].map((k) => ({ keyId: k, ...trial(() => keyHintOf(k)) })),
    messageLimit,
    claim: [["fees-1", PUB], ["a", PUB], ["ABC", PUB], ["a".repeat(64), PUB], ["a".repeat(65), PUB], ["-a", PUB], ["a_b-c", PUB]].map(([id]) => ({ id, ...trial(() => signerClaim(KEY, id)) })),
    page: pageCases(),
    months: ["Asia/Kolkata", "America/New_York", "Australia/Sydney", "UTC"].flatMap((tz) => ["2026-01", "2026-03", "2026-11", "2026-12", "2027-02", "2028-02", "2026-13", "2026-1", "2026-00", "26-11", "2026-11 "].map((m) => ({ month: m, tz, ...trial(() => monthRange(m, tz)) }))),
    lastMonth: ["Asia/Kolkata", "America/New_York", "Australia/Sydney", "Asia/Kathmandu"].flatMap((tz) => [1_735_669_800_000 - 1, 1_735_669_800_000, 1_762_000_000_000, 1_772_303_399_999, 1_772_303_400_000, 1_784_000_000_000, Date.UTC(2026, 10, 1, 3, 29), Date.UTC(2026, 10, 1, 3, 30), Date.UTC(2026, 0, 1, 12), Date.UTC(2026, 11, 31, 20)].map((ms) => ({ tz, ms, last: lastMonth(ms, tz), from: sendFrom(ms, tz) }))),
    text: {
      languagesOf: ["en", "hi", "ml", "kn", "both"].map((l) => ({ lang: l, out: languagesOf(l as Language | "both") })),
      rupees: [0, 1, 5, 50, 99, 100, 101, 12345, 99999, 100000, 12345678, 1234567890, 5555555555555, -250, -1, 1099].map((p) => ({ paise: p, out: rupees(p) })),
      oneLine: ["", "a", "  a  b  ", "line\nbreak\r\n\ttab", " nbsp x", " a b", "\u0085keep", "﻿bom ", "ഗ്ലോ   സലൂൺ"].map((t) => ({ text: t, out: oneLine(t) })),
      innovator: LANGUAGES.map((l) => ({ lang: l, word: INNOVATOR[l], badge: badgeText(l) })),
      settledBy: LANGUAGES.flatMap((l) => ["asha", "ഹരിത", "a & b"].map((w) => ({ lang: l, who: w, out: SETTLED_BY_WORD[l](w) }))),
      settledWho: SETTLED_ROWS.flat().map((r) => r.by).concat(["", "operator:operator:x", "  ", "operator:   ", "x".repeat(40), "x".repeat(41), "x".repeat(38) + "😀", "x".repeat(39) + "😀"]).map((b) => ({ by: b, out: settledWho(b) })),
      words: LANGUAGES.flatMap((l) => SETTLED_ROWS.flatMap((rows) => [10000, 400, 200, 120, 90, 60, 40, 30, 20, 10, 0].map((max) => ({ lang: l, rows, max, out: settledByWordWords(rows, l, (n) => `+${n} more`, (w) => w.length <= max) ?? null })))),
    },
    settledEntries: SETTLED_ENTRY_SETS.map((entries) => ({ entries, out: settledByWordOf(entries) })),
    claims: CLAIM_TEXTS.flatMap((t) => LANGUAGES.map((l) => ({ text: t, lang: l, out: bannedIn(t, l) }))),
    bannedLanguages: Object.keys(BANNED),
    goLive: goLiveCases(),
    verifyLinks: [{ d: sha256("x"), k: undefined }, { d: sha256("x"), k: KEY_ID }, { d: "sha256:abc", k: undefined }, { d: sha256("x"), k: "key:xyz" }].map((c) => ({ digest: c.d, key: c.k ?? null, ...trial(() => verifyLink({ digest: c.d }, c.k)), qr: trial(() => verifyQrSvg({ digest: c.d }, "Scan <me>", c.k)) })),
    codeLinks: ["7K2M-9QXD", "ABCD-EFGH"].map((code) => ({ code, link: verifyCodeLink({ code }), path: verifyCodePath({ code }) })),
    faults: [
      ["notSent", nothingWasSent(new NotSentError("refused"))], ["guard", nothingWasSent(new GuardUnavailableError(503, "busy", {} as never, {} as never))], ["api400", nothingWasSent(new ApiError(400, "bad"))],
      ["api499", nothingWasSent(new ApiError(499, "bad"))], ["api500", nothingWasSent(new ApiError(500, "bad"))], ["api399", nothingWasSent(new ApiError(399, "x"))], ["window", nothingWasSent(new WindowClosedError())], ["plain", nothingWasSent(new Error("x"))], ["string", nothingWasSent("x")],
    ].map(([name, out]) => ({ name, out })),
  };
}

// ---- grapheme clusters, from Node's segmenter ----
const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const cut = (s: string): string[] => [...seg.segment(s)].map((g) => g.segment);
const countOf = (s: string): number => { let n = 0; for (const _ of seg.segment(s)) n++; return n; };
const rangesOf = (cps: number[]): [number, number][] => { const out: [number, number][] = []; for (const cp of cps) { const l = out[out.length - 1]; if (l && l[1] === cp - 1) l[1] = cp; else out.push([cp, cp]); } return out; };

const EDGE: number[] = [
  0x0d, 0x0a, 0x00, 0x01, 0x1f, 0x7f, 0x85, 0xad, 0x200b, 0x200c, 0x200d, 0x200e, 0x2028, 0x2029, 0x2060, 0xfeff, 0xfff9, 0xe0001, 0xe0020, 0xe007f, 0xe0100,
  0x61, 0x62, 0x30, 0x20, 0xa0, 0x300, 0x301, 0x36f, 0x483, 0x5bf, 0x64b, 0x93c, 0x93e, 0x93f, 0x941, 0x94d, 0x903, 0x900, 0x981, 0x9be, 0x9cd, 0xacd, 0xb4d, 0xbcd, 0xbbe, 0xc4d, 0xcbc, 0xccd, 0xcc1, 0xcc2, 0xd3e, 0xd4d, 0xd4e,
  0xe33, 0xeb3, 0xe01, 0xe40, 0xe31, 0x1f3fb, 0x1f3ff, 0x1f3fc, 0xfe0f, 0xfe0e, 0x20e3, 0x600, 0x605, 0x6dd, 0x70f, 0x890, 0x110bd, 0x111c2, 0x11f02,
  0x1f1e6, 0x1f1e7, 0x1f1ee, 0x1f1f3, 0x1f1ff, 0x1100, 0x1112, 0x115f, 0x1160, 0x1175, 0x11a7, 0x11a8, 0x11c2, 0x11ff, 0xac00, 0xac01, 0xac1b, 0xac1c, 0xd7a3, 0xa960, 0xa97c, 0xd7b0, 0xd7c6, 0xd7cb, 0xd7fb,
  0xa9, 0xae, 0x203c, 0x2764, 0x2640, 0x2642, 0x2695, 0x1f600, 0x1f468, 0x1f469, 0x1f466, 0x1f9d1, 0x1f3f4, 0x1f3f3, 0x1f308, 0x1f441, 0x1f5e8,
  0x915, 0x916, 0x939, 0x95f, 0x978, 0x995, 0x9b9, 0xa95, 0xab9, 0xb15, 0xb39, 0xc15, 0xc39, 0xd15, 0xd3a, 0xc95, 0xcb9, 0xb95, 0xbb9, 0x9f1, 0xaf9, 0xb71, 0xc5a,
  0x3042, 0x4e00, 0x1f600, 0x10000, 0xe000, 0xffff,
];
const HANDMADE = [
  "", "a", "ab", "é", "ẹ́", "äb", "\r\n", "a\r\nb", "\n\r", "\r\r\n", "क्ष", "क्षत्रिय", "ज्ञान", "स्त्री", "हिंदी दुकान", "ग्लो सैलून दिल्ली", "कि", "की", "क्‍ष", "क्‍ष", "र्‍", "ക്ഷേമം", "ക്ക", "ക്‍ക", "ന്മ", "ഗ്ലോ സലൂൺ", "ശ്രീ ദുർഗ്ഗ ബ്യൂട്ടി പാർലർ", "ക്ക്ക",
  "ಕ್ಷೇತ್ರ", "ಕ್ಕ", "ಬ್ರೈಟ್ ಟ್ಯೂಷನ್ ಸೆಂಟರ್", "ಕನ್ನಡ", "క్ష", "ক্ষ", "ક્ષ", "କ୍ଷ", "க்ஷ", "தமிழ்", "👨‍👩‍👧‍👦", "👨‍👩‍👧‍👦👨‍👩‍👧‍👦", "👍🏽", "👍🏽👍🏿", "🏳️‍🌈", "🏴󠁧󠁢󠁥󠁮󠁧󠁿", "1️⃣", "©️", "❤️‍🔥", "🧑‍🤝‍🧑", "a‍😀", "😀‍a", "🇮🇳", "🇮🇳🇺", "🇮🇳🇺🇸", "🇮🇳🇺🇸🇬", "🇮🇳🇺🇸🇬🇧", "a🇮🇳b", "🇮🇳‍🇺🇸",
  "한국어", "각", "각", "ᄀ각ᆨ", "각", "각ᆨ", "ᅡᅡ", "Prepend: ؀a", "؀؀a", "؀\r", "ไทยำ", "เ", "ก็", "ำ", "aำ", "ຄຳ",
  "a​b", "a­b", "a b", "a﻿b", "😀́", "́", "́́a", "a्", "्क", "क्", "क््ष", "क्॑ष", "क्॑ष", "क्‍ष", "क्‌ष", "क्😀", "कx्ष", "का्ष",
  "Glow Salon", "Café Déjà Vu", "é".repeat(5), "a‍‍😀",
];

export function generateGraphemes(): unknown {
  const joinsAfter: number[] = [], joinsBefore: number[] = [], controls: number[] = [];
  for (let cp = 0; cp <= 0x10ffff; cp++) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue;
    const ch = String.fromCodePoint(cp);
    if (countOf("a" + ch) === 1) joinsAfter.push(cp);
    if (countOf(ch + "a") === 1) joinsBefore.push(cp);
    if (countOf("a" + ch + "a") === 3) controls.push(cp);
  }
  const edge = [...new Set(EDGE)];
  const pairs = edge.map((x) => edge.map((y) => countOf(String.fromCodePoint(x) + String.fromCodePoint(y))).join(""));
  const triples: { s: string; cuts: string[] }[] = [];
  const small = [0x61, 0x1f1e6, 0x1f1e7, 0x200d, 0x1f600, 0x301, 0x94d, 0x915, 0x916, 0xd15, 0xd4d, 0x903, 0x600, 0x1100, 0x1161, 0x11a8, 0xac00, 0x0d, 0x0a, 0x1f3fb];
  for (const a of small) for (const b of small) for (const c of small) { const s = String.fromCodePoint(a, b, c); triples.push({ s, cuts: cut(s) }); }
  return { joinsAfter: rangesOf(joinsAfter), joinsBefore: rangesOf(joinsBefore), controls: rangesOf(controls), edge, pairs, triples, strings: HANDMADE.map((s) => ({ s, cuts: cut(s) })) };
}

export function generate(): Map<string, string> {
  const out = new Map<string, string>();
  out.set("report/testdata/vectors.json", JSON.stringify(generateVectors()) + "\n");
  out.set("report/testdata/graphemes.json", JSON.stringify(generateGraphemes()) + "\n");
  return out;
}

export function staleFiles(root = INTERNAL): string[] {
  return [...generate()].filter(([name, text]) => !existsSync(join(root, name)) || readFileSync(join(root, name), "utf8") !== text).map(([name]) => name);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--check")) {
    const stale = staleFiles();
    if (stale.length) { console.error(`out of date: ${stale.join(", ")}  (run node go/scripts/gen_report_vectors.ts)`); process.exit(1); }
  } else {
    for (const [name, text] of generate()) { mkdirSync(dirname(join(INTERNAL, name)), { recursive: true }); writeFileSync(join(INTERNAL, name), text); }
  }
}
