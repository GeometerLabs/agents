// The shop terms agreed on WhatsApp, on the server side (B72, 12 Nov 2026). Two small jobs, used by the deployer and the panel:
//   shops/<shop>/terms.json            what the partner entered (their name and number, the two prices); written by the panel's terms page
//   generated/shops/<shop>/client/terms.json   what the shop's runtime is handed; present only while the server setting `panel.termsOnWhatsapp` is on and the file checks
// The feature is OFF by default (the owner's legal check comes first, see Deferred.md). Turning the setting off removes every handed-over copy at the next deploy.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { readTermsFile } from "../../modules/terms/terms.ts";
import type { TermsFile } from "../../modules/terms/terms.ts";
import { serverPaths } from "./server.ts";
import { stableJson, writeAtomic } from "./util.ts";

export const termsSourceFile = (dir: string, shop: string): string => join(serverPaths(dir).shop(shop), "terms.json");
const handedFile = (dir: string, shop: string): string => join(serverPaths(dir).generated, "shops", shop, "client", "terms.json");

/** What the partner entered for this shop, or undefined when nothing valid is there. */
export function readShopTerms(dir: string, shop: string): TermsFile | undefined {
  try { return readTermsFile(JSON.parse(readFileSync(termsSourceFile(dir, shop), "utf8"))); } catch { return undefined; }
}

/** Hand the runtime its terms, or take them away. Called for every deployed shop at every deploy. */
export function syncTerms(dir: string, on: boolean, shop: string): void {
  const file = on ? readShopTerms(dir, shop) : undefined;
  if (file) writeAtomic(handedFile(dir, shop), stableJson(file));
  else if (existsSync(handedFile(dir, shop))) rmSync(handedFile(dir, shop), { force: true });
}
