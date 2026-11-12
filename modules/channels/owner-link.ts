// The owner's private approvals link: a long random token the partner gives the owner once (the panel makes it, shows it once, and keeps only its hash). Used by the panel
// (which makes and revokes it), by the deployer (which hands the hash to the shop's runtime and relay), and by those two, which check the link on every request.
//
// The link is checked at the authority, not only at the public front: the runtime (for what the agent asks the owner) and the approvals relay (for a refund Guard
// holds) each read the hash from their own file on every request, so a front that was taken over still cannot act for the owner without the link, and a revoked link
// stops working as soon as the deployer has removed the file (its next pass), without a restart.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";

/** The file's name, in the runtime's client folder and in the relay's secret folder for the shop. */
export const OWNER_LINK_FILE = "owner-link.json";

/** What the file holds: the hash and when the link was made. Never the token. */
export interface OwnerLinkFile { schema: 1; sha256: string; createdAt: string }

/** 32 random bytes in base64url (43 characters): the part of the link after /o/. */
export const newOwnerToken = (): string => randomBytes(32).toString("base64url");
export const OWNER_TOKEN = /^[A-Za-z0-9_-]{43}$/u;

export const ownerTokenHash = (token: string): string => createHash("sha256").update(`owner-link:${token}`).digest("hex");

/** The file's content for a new token. */
export const ownerLinkFile = (token: string, now: Date): OwnerLinkFile => ({ schema: 1, sha256: ownerTokenHash(token), createdAt: now.toISOString() });

/** The hash in a file's text, or undefined for no file, a revoked link or anything unreadable (no link means no owner page: it fails closed). */
export function readOwnerLink(text: string | undefined): OwnerLinkFile | undefined {
  if (text === undefined) return undefined;
  try {
    const f = JSON.parse(text) as Partial<OwnerLinkFile>;
    return f.schema === 1 && typeof f.sha256 === "string" && /^[0-9a-f]{64}$/u.test(f.sha256) && typeof f.createdAt === "string" ? (f as OwnerLinkFile) : undefined;
  } catch { return undefined; }
}

/** A reader that looks at the file on every call, so a revoked link stops at once. */
export const ownerLinkReader = (file: string): (() => OwnerLinkFile | undefined) => () => {
  let text: string | undefined;
  try { text = readFileSync(file, "utf8"); } catch { text = undefined; }
  return readOwnerLink(text);
};

/** Does this token open the owner's page? Compared in constant time. False when there is no link. */
export function ownerTokenMatches(token: string | undefined, link: OwnerLinkFile | undefined): boolean {
  if (!token || !link || !OWNER_TOKEN.test(token)) return false;
  return timingSafeEqual(Buffer.from(ownerTokenHash(token), "hex"), Buffer.from(link.sha256, "hex"));
}

/** The header the front passes the owner's token in, to the runtime and the relay. */
export const OWNER_LINK_HEADER = "x-owner-link";
