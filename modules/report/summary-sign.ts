// Signing a paper's summary (summary.ts says what the summary is), checking one the way the website will, and the claim a server sends Geometer's fleet so its
// signing key goes on the public list of signers. Who uses it: the templates' report and certificate code (report/run.ts in each template) to put the summary
// link on the printed page and in the owner's WhatsApp message; the tests; and the bundle, which sends the claim (see "The claim" below).
//
// THE SAME KEY, OR NONE. A summary is made only for a paper that is signed, and only with the key that signed the paper: summaryLinkFor checks that the key it is
// handed is the one in the paper's own signature. A paper that is not signed keeps the older link (#sha256:<digest>), never an unsigned summary.
//
// THE CLAIM (decision 40, item 17b). Fleet lists a key only when the server shows it holds the private half: it signs the statement
//   "geo-paper-signer/1\n" + <the deployment id fleet knows it by> + "\n" + <the raw public key, 64 hex digits>
// with the key itself, and sends { public_key, proof } to fleet's POST /v1/paper-signers with its deployment key. So nobody can put someone else's key (Geometer's
// partner server's, another builder's) on the list under their own name, and a statement made for one deployment cannot be replayed for another. The monorepo's
// apps/fleet/src/paper-signers.ts checks the same bytes; the two must change together.
import { createPublicKey, sign, verify } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { keyIdOf, publicKeyHex } from "./sign.ts";
import { verifyLink } from "./verify-link.ts";
import type { Envelope } from "./sign.ts";
import {
  KEY_HINT_BYTES, MAX_BY_BYTES, MAX_PATHWAY_BYTES, MAX_SHOP_BYTES, SummaryError, encodeSummary, fitText, readSummaryLink, signedBytes, summaryLinkOf,
} from "./summary.ts";
import type { PaperSummary, SummarySource } from "./summary.ts";

/** What a template says about its paper; the digest and the key hint come from the signed paper and the key, never from the caller. */
export interface SummaryFields {
  layout: number;
  source: SummarySource;
  ownerMarked: boolean;
  period: string;
  pathway: string;
  shop: string;
  /** Who set the shop up, as the paper says it; null or "" when it names no one. */
  by: string | null;
  figures: number[];
}

export interface SignedSummary { summary: PaperSummary; payload: Uint8Array; signature: Uint8Array; link: string }

/** The key hint: the first 8 bytes of the key id ("key:" and the sha256 of the raw public key), as 16 hex digits. */
export const keyHintOf = (keyId: string): string => {
  if (!/^key:[0-9a-f]{64}$/u.test(keyId)) throw new SummaryError("A key id is key: and 64 hex digits.");
  return keyId.slice(4, 4 + KEY_HINT_BYTES * 2);
};

/** The summary as it will be carried: texts on one line and cut to what the format holds (a cut text ends with "…"). */
export function summaryOf(fields: SummaryFields, digest: string, keyId: string): PaperSummary {
  return {
    layout: fields.layout, source: fields.source, ownerMarked: fields.ownerMarked, period: fields.period, figures: [...fields.figures],
    pathway: fitText(fields.pathway, MAX_PATHWAY_BYTES), shop: fitText(fields.shop, MAX_SHOP_BYTES), by: fitText(fields.by ?? "", MAX_BY_BYTES),
    keyHint: keyHintOf(keyId), digest,
  };
}

/** Sign a summary with a private key: Ed25519 over "geo-summary/1\n" and the payload. */
export function signSummary(summary: PaperSummary, key: KeyObject): SignedSummary {
  const payload = encodeSummary(summary);
  const signature = new Uint8Array(sign(null, signedBytes(payload), key));
  return { summary, payload, signature, link: summaryLinkOf(payload, signature) };
}

/**
 * The summary link for a sealed paper, or undefined when there is no key or the paper is not signed (the page then prints the older #digest link). Throws when the
 * key is not the one that signed the paper: a summary must never name a signer other than the paper's own.
 */
export function summaryFor<T>(envelope: Envelope<T>, fields: SummaryFields, key?: KeyObject): SignedSummary | undefined {
  if (!key || !envelope.signature) return undefined;
  if (publicKeyHex(key) !== envelope.signature.publicKey) throw new Error("The summary would be signed with a different key from the paper's own signature.");
  return signSummary(summaryOf(fields, envelope.digest, envelope.signature.keyId), key);
}

/** The same, as just the link. */
export const summaryLinkFor = <T>(envelope: Envelope<T>, fields: SummaryFields, key?: KeyObject): string | undefined => summaryFor(envelope, fields, key)?.link;

/** "2026-11" for a whole month, "2026-11-01..2026-11-15" for any other range, from a report's period. */
export function periodOf(period: { month: { year: number; month: number } | null; firstDay: { year: number; month: number; day: number }; lastDay: { year: number; month: number; day: number } }): string {
  const two = (n: number) => String(n).padStart(2, "0");
  const day = (d: { year: number; month: number; day: number }) => `${d.year}-${two(d.month)}-${two(d.day)}`;
  if (period.month) return `${period.month.year}-${two(period.month.month)}`;
  return `${day(period.firstDay)}..${day(period.lastDay)}`;
}

/** A go-live certificate's date, "2026-11-03". */
export const dayOf = (d: { year: number; month: number; day: number }): string => `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;

/**
 * The summary of any template's go-live certificate (layout 3): held N of M situations, K failed, J things not tested, on the day it was issued. The hand check runs
 * on stand-in services only, so its source is always "stand-in"; it counts no money, so nothing is marked by the owner.
 */
export function goLiveSummaryFields(cert: { pathway: { name: string }; shop: { name: string }; preparedBy: string | null; issuedOn: { year: number; month: number; day: number }; checks: { held: number; total: number; failed: number }; notTested: readonly unknown[] }): SummaryFields {
  return {
    layout: 3, source: "stand-in", ownerMarked: false, period: dayOf(cert.issuedOn), pathway: cert.pathway.name, shop: cert.shop.name, by: cert.preparedBy,
    figures: [cert.checks.held, cert.checks.total, cert.checks.failed, cert.notTested.length],
  };
}

/**
 * The most characters WhatsApp takes in a template's body once its values are filled in. Meta documents 1024 for a template's body; that the same bound holds for
 * the filled text is our reading of its "hydrated text too long" refusal, not a documented number (Deferred.md), so the message keeps under it either way.
 */
export const WHATSAPP_BODY_LIMIT = 1024;

/**
 * The check link a monthly report's WhatsApp message carries, chosen once per message so the plain text and the template say the same: the signed summary link when
 * the whole message, filled with it, stays within WHATSAPP_BODY_LIMIT; otherwise (an unsigned report, or a long message in Malayalam or Kannada) the older
 * #digest link, which still finds the paper and checks its file. `fill` gives the whole message for a check link.
 */
export function messageCheckLink(fill: (check: string) => string, envelope: Pick<Envelope, "digest">, summaryLink?: string): string {
  if (summaryLink && fill(summaryLink).length <= WHATSAPP_BODY_LIMIT) return summaryLink; // UTF-16 units: never fewer than the characters Meta counts
  return verifyLink(envelope);
}

// ---- checking, as the page will -------------------------------------------------------------------------------------------------------------------------

/** One entry of fleet's public list of signers (apps/fleet/src/paper-signers.ts), as far as checking needs it. */
export interface ListedSigner { key_id: string; public_key: string; kind: "builder" | "partner" | "geometer"; name: string | null; since: string }

export type SummaryCheck =
  /** The signature verifies under the public key of this listed signer. Says nothing about whether the figures are true. */
  | { status: "genuine"; summary: PaperSummary; signer: ListedSigner }
  /** Readable, but no key on the list could have signed it: signed by a key Geometer does not list, or changed so its key hint no longer points at one. */
  | { status: "unknown-signer"; summary: PaperSummary }
  /** A listed key matches the hint, but the signature does not verify under it: the summary was changed after it was signed, or signed by someone else. */
  | { status: "not-genuine"; summary: PaperSummary }
  /** Not an s1 summary, or not written the one way the format allows. */
  | { status: "unreadable"; reason: string };

const rawPublicKey = (hex: string): KeyObject => createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(hex, "hex").toString("base64url") }, format: "jwk" });

/**
 * Check a summary link against the whole list of signers, the way the website's /verify page will: read it, take the listed keys whose id starts with the hint
 * (an entry whose id is not the sha256 of its own public key is ignored), and verify the signature over exactly the bytes in the link under each.
 */
export function checkSummaryLink(link: string, signers: readonly ListedSigner[]): SummaryCheck {
  let read;
  try { read = readSummaryLink(link); } catch (e) {
    if (e instanceof SummaryError) return { status: "unreadable", reason: e.message };
    throw e;
  }
  const candidates = signers.filter((s) => /^[0-9a-f]{64}$/u.test(s.public_key) && keyIdOf(s.public_key) === s.key_id && s.key_id.startsWith(`key:${read.summary.keyHint}`));
  if (candidates.length === 0) return { status: "unknown-signer", summary: read.summary };
  for (const signer of candidates) {
    let ok = false;
    try { ok = verify(null, read.signed, rawPublicKey(signer.public_key), read.signature); } catch { ok = false; }
    if (ok) return { status: "genuine", summary: read.summary, signer };
  }
  return { status: "not-genuine", summary: read.summary };
}

// ---- the claim a server sends fleet ---------------------------------------------------------------------------------------------------------------------

export const SIGNER_CLAIM_DOMAIN = "geo-paper-signer/1\n";

/** The bytes a claim's proof signs: the domain, the deployment id, a line break, and the raw public key in hex. */
export const signerClaimBytes = (deploymentId: string, publicKey: string): Buffer => Buffer.from(`${SIGNER_CLAIM_DOMAIN}${deploymentId}\n${publicKey}`, "utf8");

/**
 * What a server sends fleet's POST /v1/paper-signers (with its deployment key as the bearer) to put its signing key on the public list: the raw public key and a
 * proof that it holds the private half, made for this deployment only. Not a secret: it is a public key and a signature over a public statement.
 */
export function signerClaim(key: KeyObject, deploymentId: string): { public_key: string; proof: string } {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(deploymentId)) throw new Error(`"${deploymentId}" is not a deployment id.`);
  const publicKey = publicKeyHex(key);
  return { public_key: publicKey, proof: sign(null, signerClaimBytes(deploymentId, publicKey), key).toString("hex") };
}
