// What the partner hands the owner at the setup visit, so the owner can register a passkey without WhatsApp (plan item 11h, decisions 45 and 46): a setup QR code
// (one use, that shop only, short-lived) and a printed recovery card (a few one-use codes). Used by the panel, which makes them and keeps only their hashes, by the
// deployer, which copies the file to the shop's runtime on every pass of its loop (bundle/lib/pages.ts), and by the runtime (owner-access.ts), which checks a
// token or a code against the copy it reads on every request and remembers, in its own store, which ones were used.
//
//   shops/<shop>/owner-grants.json   {"schema": 1, "setup"?: {sha256, createdAt, expiresAt}, "recovery"?: {codes: [sha256...], createdAt}, "passkeysBefore"?: ISO}
//
// Why a file and not a call: the panel holds no secret and cannot reach a runtime (bundle/Explanation.md); the owner's link (item 11d) and "sign out every device"
// already travel this way. Why hashes: the panel shows the QR and the card once; nobody who reads the server's files afterwards can use them. A new QR replaces
// the old one, a new card replaces every code of the old one, and `passkeysBefore` (the panel's "remove the owner's passkeys", for a lost phone) makes every
// passkey registered before it stop working. Nothing here passes through Geometer or Firebase: the shop's own server checks everything.
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";

export const OWNER_GRANTS_FILE = "owner-grants.json";
/** How long a setup QR works: enough for the owner to scan it and touch the fingerprint reader during the visit or a video call. */
export const SETUP_MS = 15 * 60_000;
/** How many codes a recovery card has. Each works once. */
export const RECOVERY_CODES = 5;

export interface OwnerGrants {
  schema: 1;
  setup?: { sha256: string; createdAt: string; expiresAt: string };
  recovery?: { codes: string[]; createdAt: string };
  passkeysBefore?: string;
}

/** The setup QR's token: 32 random bytes in base64url, the same shape as a sign-in link's. */
export const newSetupToken = (): string => randomBytes(32).toString("base64url");
export const SETUP_TOKEN = /^[A-Za-z0-9_-]{43}$/u;
export const setupHash = (token: string): string => createHash("sha256").update(`owner-setup:${token}`).digest("hex");

/** A recovery code's letters: no look-alikes (no 0/O, 1/I/L), upper case, so it reads aloud and types easily. 10 of them is about 48 bits. */
const CODE_LETTERS = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const newRecoveryCode = (): string => Array.from({ length: 10 }, () => CODE_LETTERS[randomInt(CODE_LETTERS.length)]).join("");
/** A code as typed: spaces and dashes dropped, upper case. */
export const normalCode = (typed: string): string => typed.normalize("NFKC").toUpperCase().replace(/[\s-]+/gu, "");
export const RECOVERY_CODE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}$/u;
export const recoveryHash = (code: string): string => createHash("sha256").update(`owner-recovery:${normalCode(code)}`).digest("hex");
/** A code as printed: two groups of five. */
export const printedCode = (code: string): string => `${code.slice(0, 5)}-${code.slice(5)}`;

const HEX64 = /^[0-9a-f]{64}$/u;
const isTime = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));

/** The file's content, field by field. A field that does not read is left out, never widened: a broken file grants nothing. */
export function readOwnerGrants(text: string | undefined): OwnerGrants | undefined {
  if (text === undefined) return undefined;
  let f: Record<string, unknown>;
  try { f = JSON.parse(text) as Record<string, unknown>; } catch { return undefined; }
  if (typeof f !== "object" || f === null || f.schema !== 1) return undefined;
  const out: OwnerGrants = { schema: 1 };
  const s = f.setup as Record<string, unknown> | undefined;
  if (s && typeof s.sha256 === "string" && HEX64.test(s.sha256) && isTime(s.createdAt) && isTime(s.expiresAt)) out.setup = { sha256: s.sha256, createdAt: s.createdAt, expiresAt: s.expiresAt };
  const r = f.recovery as Record<string, unknown> | undefined;
  if (r && Array.isArray(r.codes) && r.codes.length <= 20 && r.codes.every((c) => typeof c === "string" && HEX64.test(c)) && isTime(r.createdAt)) out.recovery = { codes: r.codes as string[], createdAt: r.createdAt };
  if (isTime(f.passkeysBefore)) out.passkeysBefore = f.passkeysBefore;
  return out;
}

/** A reader that looks at the file on every call, so a new QR, a new card or a removal is seen at once. */
export const ownerGrantsReader = (file: string): (() => OwnerGrants | undefined) => () => {
  let text: string | undefined;
  try { text = readFileSync(file, "utf8"); } catch { text = undefined; }
  return readOwnerGrants(text);
};

/** A grant the owner presents: the setup QR's token, or a code from the card. Its hash names it in the runtime's store (which remembers it was used). */
export type Grant = { kind: "setup"; token: string } | { kind: "recovery"; code: string };
export const grantHash = (g: Grant): string => (g.kind === "setup" ? setupHash(g.token) : recoveryHash(g.code));

const sameHex = (a: string, b: string): boolean => a.length === b.length && timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));

/**
 * What the file says about a grant now: "valid", "expired" (a setup QR past its time), or "unknown" (not this shop's, replaced by a newer QR or card, or no file).
 * Whether it was USED is the runtime's store's to say, not the file's.
 */
export function grantInFile(g: Grant, file: OwnerGrants | undefined, now: number): "valid" | "expired" | "unknown" {
  if (!file) return "unknown";
  if (g.kind === "setup") {
    if (!SETUP_TOKEN.test(g.token) || !file.setup || !sameHex(setupHash(g.token), file.setup.sha256)) return "unknown";
    return Date.parse(file.setup.expiresAt) > now ? "valid" : "expired";
  }
  if (!RECOVERY_CODE.test(normalCode(g.code)) || !file.recovery) return "unknown";
  const h = recoveryHash(g.code);
  return file.recovery.codes.some((c) => sameHex(c, h)) ? "valid" : "unknown";
}
