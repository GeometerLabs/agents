// Digests and the short verification code. A digest is always the full sha256 of the canonical JSON bytes, written
// "sha256:<64 hex digits>" (the same spelling geometer-verify uses). The 16-digit digest in record.ts is only the
// record's per-entry fingerprint of its inputs.
import { createHash } from "node:crypto";
import { canonicalJson } from "../record/record.ts";

// Always the full digest with an algorithm prefix, so a stored value says what it is and two digests are never compared at different lengths.
export const sha256 = (bytes: string | Uint8Array): string => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

/** The digest of any JSON value: its canonical bytes, hashed. */
export const digestOf = (value: unknown): string => sha256(canonicalJson(value));

// Crockford's base32 without I, L, O or U: nothing that is easy to misread when it is read out or typed from paper.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * A short code to read out or print ("7K2M-9QXD"): the first 40 bits of the digest. It is for finding a document, not for
 * trusting one: the full digest is what is checked, and the code is re-derived from it every time.
 */
export function verificationCode(digest: string): string {
  const hex = /^sha256:([0-9a-f]{64})$/.exec(digest)?.[1];
  if (!hex) throw new Error(`"${digest}" is not a sha256 digest.`);
  let bits = BigInt(`0x${hex.slice(0, 10)}`);
  let code = "";
  for (let i = 0; i < 8; i++) { code = ALPHABET[Number(bits & 31n)] + code; bits >>= 5n; }
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}
