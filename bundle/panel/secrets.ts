// The secrets intake. A provider key or a webhook secret goes from the form to a file in the server's secrets inbox, and nowhere else:
//  - it is written, never read back (this file has no way to read a file or list a folder, and a test checks that);
//  - it is never logged, never put in a page or a redirect, never put in the panel's own data (only the fact that it arrived, and when);
//  - a problem with it is described by the field's name, never by the value, so no error message can repeat it.
// The deployer moves each file into the one container that needs it and deletes it from the inbox.
import { chmodSync, existsSync, linkSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { SECRET_NAMES, SHOP_ID, isObj } from "./contract.ts";
import type { SecretName } from "./contract.ts";
import type { Shops } from "./shops.ts";

export const KEY_ID = /^rzp_(live|test)_[A-Za-z0-9]{6,40}$/u;
const NO_SPACE = (min: number, max: number) => new RegExp(`^[^\\s]{${min},${max}}$`, "u");

export type SecretCheck = { ok: true; text: string; clientEmail?: string } | { ok: false };

/** Shape only: it cannot tell a right key from a wrong one, only one that was clearly copied badly (spaces, line breaks, a half). */
export function checkSecret(name: SecretName, value: string): SecretCheck {
  const v = value.trim();
  switch (name) {
    case "whatsapp_token": return NO_SPACE(20, 2000).test(v) ? { ok: true, text: v } : { ok: false };
    case "whatsapp_app_secret": return NO_SPACE(16, 200).test(v) ? { ok: true, text: v } : { ok: false };
    case "razorpay_webhook_secret": return NO_SPACE(8, 200).test(v) ? { ok: true, text: v } : { ok: false };
    case "razorpay_key": {
      // "<key id>:<key secret>" on one line, which is what the deployer turns into the Basic credential Guard holds.
      const i = v.indexOf(":");
      return i > 0 && KEY_ID.test(v.slice(0, i)) && NO_SPACE(10, 100).test(v.slice(i + 1)) && !v.slice(i + 1).includes(":") ? { ok: true, text: v } : { ok: false };
    }
    case "google_service_account.json": {
      if (v.length === 0 || v.length > 8000) return { ok: false };
      let parsed: unknown;
      try { parsed = JSON.parse(v); } catch { return { ok: false }; } // the parser's own message repeats part of the text: it is not passed on
      if (!isObj(parsed) || parsed.type !== "service_account" || typeof parsed.client_email !== "string" || !/^[^\s@]+@[^\s@]+$/u.test(parsed.client_email) || typeof parsed.private_key !== "string" || !parsed.private_key.includes("PRIVATE KEY")) return { ok: false };
      return { ok: true, text: v, clientEmail: parsed.client_email };
    }
  }
}

/** A file with this name is already waiting in the shop's inbox and the panel did not put it there. Nothing was overwritten. */
export class InboxTaken extends Error { override name = "InboxTaken"; }

export function createInbox(shops: Shops, now: () => number = Date.now) {
  return {
    /** Would a first write of any of these names land on a file that is already there? (Existence only; nothing is opened.) */
    taken(shop: string, names: SecretName[]): boolean {
      if (!SHOP_ID.test(shop)) return true;
      const meta = shops.meta(shop);
      return names.some((n) => meta.receipts[n] === undefined && existsSync(join(shops.paths.inbox(shop), n)));
    },
    /** Write one secret for one shop and note that it arrived. Returns nothing: there is nothing to show. */
    put(shop: string, name: SecretName, text: string): void {
      if (!SHOP_ID.test(shop) || !(SECRET_NAMES as readonly string[]).includes(name)) throw new Error("not a place the secrets inbox takes");
      const dir = shops.paths.inbox(shop);
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const file = join(dir, name);
      const tmp = join(dir, `.${randomBytes(6).toString("hex")}.tmp`);
      writeFileSync(tmp, text.endsWith("\n") ? text : `${text}\n`, { mode: 0o600 });
      chmodSync(tmp, 0o600);
      const meta = shops.meta(shop);
      if (meta.receipts[name] === undefined) {
        // The first time this panel writes this name for this shop: create it only if nothing is there (a hard link fails when the name exists).
        try { linkSync(tmp, file); } catch (e) { unlinkSync(tmp); if ((e as NodeJS.ErrnoException).code === "EEXIST") throw new InboxTaken("a file by that name is already waiting in the inbox"); throw e; }
        unlinkSync(tmp);
      } else renameSync(tmp, file); // a new key for a name this panel wrote before replaces it, if the deployer has not collected it yet
      shops.saveMeta(shop, { ...meta, receipts: { ...meta.receipts, [name]: new Date(now()).toISOString() } });
    },
  };
}

export type Inbox = ReturnType<typeof createInbox>;
