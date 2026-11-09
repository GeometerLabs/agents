// Fingerprints of a person's value that nobody outside the shop can work back (B69).
//
// A customer's number, or a Fees student's name, must not leave the shop as itself. A plain sha256 of it does not hide it: India has about 4 billion mobile numbers, so anyone holding the
// hash can try them all in minutes, and a class's names can be guessed. A fingerprint here is an HMAC-SHA256 of the value with a key only the shop holds (and its backups): whoever lacks the
// key cannot test a guess, and the shop's own tools, which have it, can still find a person's entries. The key is never in an export, a paper, a report or a log.
//
// The key itself: 32 random bytes as 64 hex digits, made once per shop by the deploy bundle (bundle/lib/secrets.ts); what each container gets is in bundle/Explanation.md.
// A person is fingerprinted as the first 12 hex digits (48 bits) of the HMAC, under a prefix that says what kind of field it fills: "c-" a record entry's conversation, "p-" a case's person,
// "s-" a Fees student's name, "b-" a reference an own agent chose that looks like a number. Twelve digits is enough with the key in place: without the key nothing can be tried, so the length
// only has to keep two people of one shop apart, and the export job refuses a shop where two different people ever land on the same fingerprint (bundle/backup/export.ts).
import { createHmac } from "node:crypto";

/** What an export says about its fingerprints. An export that does not say this was made before the keyed form (B69), and its fingerprints can be worked back. */
export const PERSON_FORM = "hmac-sha256/shop-key/12-hex";
export const OLD_PERSON_FORM = "sha256/unkeyed/12-hex";

const hmac = (key: Buffer, domain: string, text: string): string => createHmac("sha256", key).update(`${domain}\n${text}`).digest("hex");

/** A person's value as 12 hex digits. The same value always gives the same digits under the same key, so the shop's tools can match it; a different key gives different digits. */
export const personFingerprint = (key: Buffer, value: string): string => hmac(key, "geometer/person/1", value).slice(0, 12);

/** The form a record or a case field carries: "<prefix>-<12 hex>". */
export const personLabel = (key: Buffer, prefix: "c" | "p" | "s" | "b", value: unknown): string => `${prefix}-${personFingerprint(key, String(value))}`;

/** Which key an export was made with, in a form that shows nothing about the key: the panel will not search an export made under another key (after a restore). */
export const keyIdOf = (key: Buffer): string => hmac(key, "geometer/key-id/1", "").slice(0, 12);

/** The inputs' digest under a key: same content, same digest; without the key, a guess cannot be tested against it. Sixteen hex digits, as the unkeyed digest has, with "k-" in front so a reader can tell the two apart. */
export const keyedDigest = (key: Buffer, canonicalText: string): string => `k-${hmac(key, "geometer/inputs/1", canonicalText).slice(0, 16)}`;

/** WhatsApp's own message id can carry the sender's number, so it is kept as a fingerprint of itself: "m-<12 hex>". */
export const messageFingerprint = (key: Buffer, id: string): string => `m-${hmac(key, "geometer/message/1", id).slice(0, 12)}`;
