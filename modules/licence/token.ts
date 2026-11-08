// Checking a lease or an emergency extension (plan B13): the same checks, in the same order, as fleet's reference `checkToken` (monorepo apps/fleet/src/lease.ts),
// with node:crypto's Ed25519 and no dependency. The test vectors (bundle/test/fixtures/licence-vectors.json, a copy of fleet's) pin every answer.
//
//   gl1.<kid>.<payload>.<sig>   a lease          gx1.<kid>.<payload>.<sig>   an emergency extension
//
// The signature covers the exact bytes received ("<prefix>.<kid>.<payload>"), so nothing is ever re-encoded; only then is the payload parsed. The keys are the
// public halves pinned in the server's own config (geometer.json `licence.keys`, from what fleet's `licence key show` prints): a key that comes inside a token
// is never trusted, because the kid only picks among the pinned keys.
import { createHash, createPublicKey, verify } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { wellFormed } from "./rules.ts";
import type { Payload } from "./rules.ts";

export const LEASE_PREFIX = "gl1";
export const EXTENSION_PREFIX = "gx1";
export const LEASE_VERSION = 1;
/** A token longer than this is refused before anything else is looked at. */
export const MAX_TOKEN_BYTES = 64 * 1024;

const B64URL = /^[A-Za-z0-9_-]*$/u;
/** Base64url with no padding, in its one exact form: a character more, or a non-zero trailing bit, is not the same token. */
function unb64url(text: string): Buffer | undefined {
  if (!B64URL.test(text) || text.length % 4 === 1) return undefined;
  const bytes = Buffer.from(text, "base64url");
  return bytes.toString("base64url") === text ? bytes : undefined;
}

/** The key id: the first 8 bytes of SHA-256 over the 32-byte raw public key, as 16 lowercase hex characters. */
export const kidOf = (publicRaw: Buffer): string => createHash("sha256").update(publicRaw).digest().subarray(0, 8).toString("hex");

/** A public key from its raw 32 bytes. */
export function publicKeyFromRaw(raw: Buffer): KeyObject {
  if (raw.length !== 32) throw new Error("An Ed25519 public key is 32 bytes.");
  return createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), raw]), format: "der", type: "spki" });
}

/** A pinned key as geometer.json holds it: 64 hex characters (fleet's `licence key show` prints it so). */
export const PUBLIC_KEY_HEX = /^[0-9a-f]{64}$/u;
export const keysFromHex = (hex: readonly string[]): Buffer[] => hex.filter((h) => PUBLIC_KEY_HEX.test(h)).map((h) => Buffer.from(h, "hex"));

export type CheckCode = "too_long" | "not_four_parts" | "wrong_kind" | "unknown_key" | "not_base64url" | "bad_signature" | "not_json" | "wrong_version" | "wrong_shape";
export type Checked<T> = { ok: true; payload: T; kid: string } | { ok: false; code: CheckCode };

/** Refuse what is not exactly a token of the expected kind, signed by one of the given public keys (raw 32 bytes each), and only then read the payload. Replay is `newerThan`. */
export function checkToken<T extends Payload>(token: string, kind: T["kind"], keys: readonly Buffer[]): Checked<T> {
  if (Buffer.byteLength(token, "utf8") > MAX_TOKEN_BYTES) return { ok: false, code: "too_long" };
  const parts = token.split(".");
  if (parts.length !== 4) return { ok: false, code: "not_four_parts" };
  const [prefix, kid, body, sig] = parts;
  if (prefix !== (kind === "lease" ? LEASE_PREFIX : EXTENSION_PREFIX)) return { ok: false, code: "wrong_kind" };
  const key = /^[0-9a-f]{16}$/u.test(kid) ? keys.find((k) => k.length === 32 && kidOf(k) === kid) : undefined;
  if (!key) return { ok: false, code: "unknown_key" };
  const payloadBytes = unb64url(body);
  const sigBytes = unb64url(sig);
  if (!payloadBytes || !sigBytes || sigBytes.length !== 64) return { ok: false, code: "not_base64url" };
  if (!verify(null, Buffer.from(`${prefix}.${kid}.${body}`, "ascii"), publicKeyFromRaw(key), sigBytes)) return { ok: false, code: "bad_signature" };
  let payload: unknown;
  try { payload = JSON.parse(payloadBytes.toString("utf8")); } catch { return { ok: false, code: "not_json" }; }
  if (typeof payload !== "object" || payload === null || (payload as { v?: unknown }).v !== LEASE_VERSION) return { ok: false, code: "wrong_version" };
  if ((payload as { kind?: unknown }).kind !== kind) return { ok: false, code: "wrong_kind" };
  return wellFormed(payload as Payload) ? { ok: true, payload: payload as T, kid } : { ok: false, code: "wrong_shape" };
}

/** Each refusal in plain words, for the deployer's log and `geometer licence extension`. Never the token itself. */
export const CHECK_WORDS: Record<CheckCode, string> = {
  too_long: "it is longer than any lease could be",
  not_four_parts: "it is not four parts joined by dots",
  wrong_kind: "it is not the kind of token expected here (a lease starts gl1., an extension gx1.)",
  unknown_key: "it is not signed by a key this server has pinned (geometer.json, licence.keys)",
  not_base64url: "a part of it is not in the exact base64url form",
  bad_signature: "its signature does not match: it was changed, or not signed by fleet",
  not_json: "what it carries is not JSON",
  wrong_version: "it is not a version-1 token",
  wrong_shape: "what it carries does not have the version-1 fields",
};
