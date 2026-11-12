// The owner's private approvals link on the server side (item 11d). The panel makes a link for a shop and keeps only its hash, in shops/<shop>/owner-link.json; the
// deployer hands that hash, on every pass of its loop, to the two places that check the link: the shop's runtime (generated/shops/<shop>/client/owner-link.json) and
// the approvals relay (secrets/relay/<shop>/owner-link.json, for a shop whose Guard holds refunds). Revoking is the panel removing the file: at the deployer's next pass
// (every 10 s) both copies are removed, and the runtime and the relay, which read their copy on every request, refuse the link from then on. No restart.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { OWNER_LINK_FILE, readOwnerLink } from "../../modules/channels/owner-link.ts";
import { secretFile, writeSecretFile } from "./secrets.ts";
import { serverPaths } from "./server.ts";
import { stableJson } from "./util.ts";

/** Where the panel writes a shop's link (its hash only). */
export const ownerLinkSource = (dir: string, shop: string): string => join(serverPaths(dir).shop(shop), OWNER_LINK_FILE);
/** The two copies the deployer keeps in step with it. */
export const ownerLinkCopies = (dir: string, shop: string): string[] => [join(serverPaths(dir).generated, "shops", shop, "client", OWNER_LINK_FILE), secretFile(dir, "relay", shop, OWNER_LINK_FILE)];

const read = (path: string): string | undefined => { try { return readFileSync(path, "utf8"); } catch { return undefined; } };

/**
 * Hand each shop's link to its runtime and relay, or take it away. Only a copy whose folder exists is written (a shop not deployed yet, or one with no relay, has none
 * to write); a link the panel removed, or a file that does not read as one, removes both copies. Returns a line for each change, for the deployer's log.
 */
export function syncOwnerLinks(dir: string, shops: readonly string[]): string[] {
  const lines: string[] = [];
  for (const shop of shops) {
    const link = readOwnerLink(read(ownerLinkSource(dir, shop)));
    const text = link ? stableJson(link) : undefined;
    for (const copy of ownerLinkCopies(dir, shop)) {
      const have = read(copy);
      if (text === undefined) {
        if (have !== undefined) { rmSync(copy, { force: true }); lines.push(`${shop}: the owner's approvals link is switched off.`); }
        continue;
      }
      if (!existsSync(dirname(copy)) || have?.trim() === text.trim()) continue;
      writeSecretFile(copy, text); // only a hash and a date: the folder's usual mode
      lines.push(`${shop}: the owner's approvals link (made ${link!.createdAt}) is handed to ${copy.includes(`${join("secrets", "relay")}`) ? "the approvals relay" : "the runtime"}.`);
    }
  }
  return lines;
}
