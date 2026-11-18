// The shop's own signing key (block S, specs/shop-feed.md "The signature": "The key belongs to the shop"). One Ed25519 key per shop, made by the shop's own runtime the first time it
// needs one and kept in the shop's own database (store.ts, table `shop_key`), so:
//   - it is in the shop's nightly snapshot and replication copy, and a restore brings it back with the shop;
//   - a shop that changes its Operator takes its database along and keeps its key, so every directory that pinned it still knows the shop;
//   - the owner's file ("Get my shop's file") can carry it (bundle/backup/export.ts reads the same table).
// It is never written to the record, the state snapshot, a log or a response. Only the PUBLIC key and its id leave the shop (in the feed's signature and the card).
//
// A second way in, for a shop restored from the owner's file onto a new server: if the data folder holds `shop-key.json` (the file the owner's package carries, put there by whoever
// restores the shop) and the database has no key yet, that key is adopted, and the file is deleted so the key is not left beside the database as a second plaintext copy (the database, the
// backup and the owner's file hold it, and the owner still has the file they brought).
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { generateSigningKey, privateText, signingKeyFromText } from "../signing/index.ts";
import type { SigningKey } from "../signing/index.ts";
import type { DurableStore } from "./store.ts";

/** The file name the owner's package uses for the key, and the one the runtime looks for in its data folder when adopting it. */
export const SHOP_KEY_FILE = "shop-key.json";
/** What the file holds: the format name and the key as text. Nothing else, so nothing in it can be mistaken for something to run. */
export interface ShopKeyFile { format: "shop-key/1"; privateKey: string; keyId: string }

/** The key file's text for a stored key (used by the owner's package). */
export const shopKeyFileText = (privateKey: string): string => {
  const key = signingKeyFromText(privateKey);
  return `${JSON.stringify({ format: "shop-key/1", privateKey, keyId: key.keyId } satisfies ShopKeyFile)}\n`;
};

/** The key in a `shop-key.json` text, or undefined when it is not a good one (wrong format, not a key, or a key id that does not match). */
export function readShopKeyFile(text: string): { privateKey: string; key: SigningKey } | undefined {
  try {
    const f = JSON.parse(text) as Partial<ShopKeyFile>;
    if (f.format !== "shop-key/1" || typeof f.privateKey !== "string" || typeof f.keyId !== "string") return undefined;
    const key = signingKeyFromText(f.privateKey);
    return key.keyId === f.keyId ? { privateKey: f.privateKey, key } : undefined;
  } catch { return undefined; }
}

/**
 * The shop's key: the one in the database; else the one in `<dataDir>/shop-key.json` (adopted once); else a new one. Made inside one transaction, so two callers never make two keys.
 * Returns undefined for a store that has no key table (a test double). `log` hears only the key's public id.
 */
export function loadShopKey(store: DurableStore, o: { dataDir?: string; nowMs: number; log?: (line: string) => void }): SigningKey | undefined {
  const keys = store.shopKey;
  if (!keys) return undefined;
  const have = keys.get();
  if (have) return signingKeyFromText(have);
  const file = o.dataDir ? join(o.dataDir, SHOP_KEY_FILE) : undefined;
  if (file && existsSync(file)) {
    const adopted = readShopKeyFile(readFileSync(file, "utf8"));
    if (adopted) {
      const text = keys.ensure(() => adopted.privateKey, o.nowMs);
      try { rmSync(file, { force: true }); } catch { /* the key is kept either way; a file left behind is only untidy */ }
      o.log?.(`The shop's signing key (id ${adopted.key.keyId}) was taken from ${SHOP_KEY_FILE}.`);
      return signingKeyFromText(text);
    }
    o.log?.(`${SHOP_KEY_FILE} is not a good key file, so it was ignored.`);
  }
  const made = signingKeyFromText(keys.ensure(() => privateText(generateSigningKey()), o.nowMs));
  o.log?.(`The shop made its signing key (id ${made.keyId}).`);
  return made;
}
