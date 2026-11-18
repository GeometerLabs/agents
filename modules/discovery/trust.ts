// Whose key signed a feed, and may it speak for this shop page? (specs/directory.md, "Keys"). The directory PINS the first key it saw for a shop page. A feed
// signed with the pinned key is believed. A feed signed with another key is not shown: its items are held and the change is listed for a person to look at.
// A key changes only when a shop loses its folder (its key moves with it when the shop changes Operator), so this is rare, and a person decides.
//
// Checking the signature here uses the key the FEED carries only the first time (no key pinned yet), because the feed's own key proves nothing about whose it
// is; from then on the pinned key is the one the signature is checked against. Server side (node:crypto, through modules/signing), no disk.
import { verifyDocument } from "../signing/sign.ts";

export interface Pin { keyId: string; key: string }

export type FeedTrust =
  | { state: "first"; pin: Pin }                    // no key was pinned: this one is kept now
  | { state: "same"; pin: Pin }                     // signed with the pinned key
  | { state: "changed"; pinned: Pin; offered: Pin } // signed (validly) by another key than the pinned one: hold and list
  | { state: "refused"; reason: string };           // not signed, or not validly

/** Check a feed document's signature and compare its key with the pinned one (if any). */
export function trustFeed(doc: unknown, pinned: Pin | undefined): FeedTrust {
  const sig = (doc as { signature?: { key?: unknown; keyId?: unknown } } | null)?.signature;
  if (typeof sig?.key !== "string" || typeof sig?.keyId !== "string") return { state: "refused", reason: "the feed is not signed with a key it carries" };
  const offered: Pin = { keyId: sig.keyId, key: sig.key };
  // the feed's own signature must be valid under the key it carries, always
  const own = verifyDocument(doc);
  if (!own.ok) return { state: "refused", reason: `the feed's signature is not valid (${own.reason})` };
  if (!pinned) return { state: "first", pin: offered };
  return pinned.keyId === offered.keyId && pinned.key === offered.key ? { state: "same", pin: pinned } : { state: "changed", pinned, offered };
}
