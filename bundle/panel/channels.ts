// Item 11d in the panel: a Bookings shop's booking page, its QR code, its MCP endpoint, and the owner's private approvals link. Used by the panel's shop page and its two
// owner-link routes (server.ts). The panel writes only the link's HASH, in shops/<shop>/owner-link.json; the deployer hands it to the shop's runtime and relay on its next
// pass (bundle/lib/owner-link.ts). The token itself is shown once, on the page that made it, and kept nowhere.
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { OWNER_LINK_FILE, newOwnerToken, ownerLinkFile, readOwnerLink } from "../../modules/channels/owner-link.ts";
import type { OwnerLinkFile } from "../../modules/channels/owner-link.ts";
import { textQrSvg } from "../../modules/qr/svg.ts";
import { serverPaths } from "../lib/server.ts";
import { stableJson, writeAtomic } from "../lib/util.ts";

/** What the shop page shows: the addresses, the QR code of the booking page, and whether an owner's link is on (and since when). */
export interface ChannelsView { bookingUrl: string; mcpUrl: string; apiUrl: string; qrSvg: string; ownerLink?: { createdAt: string } }

export function createChannels(serverDir: string, publicUrl: string | undefined) {
  const file = (id: string) => join(serverPaths(serverDir).shop(id), OWNER_LINK_FILE);
  const read = (id: string): OwnerLinkFile | undefined => { try { return readOwnerLink(readFileSync(file(id), "utf8")); } catch { return undefined; } };
  /** https://<server>/s/<shop>, or undefined when the panel does not know the server's public address (a local panel without PANEL_PUBLIC_URL). */
  const base = (id: string): string | undefined => (publicUrl ? `${publicUrl}/s/${id}` : undefined);
  return {
    view(id: string): ChannelsView | undefined {
      const b = base(id);
      if (!b) return undefined;
      const link = read(id);
      return { bookingUrl: `${b}/`, mcpUrl: `${b}/mcp`, apiUrl: `${b}/api/v1`, qrSvg: textQrSvg(`${b}/`, { label: `${b}/`, width: 200 }), ...(link ? { ownerLink: { createdAt: link.createdAt } } : {}) };
    },
    /** A new owner's link (any earlier one stops working at the deployer's next pass). Returns the whole address, to show once. */
    make(id: string, now: Date): string | undefined {
      const b = base(id);
      if (!b) return undefined;
      const token = newOwnerToken();
      writeAtomic(file(id), stableJson(ownerLinkFile(token, now)));
      return `${b}/o/${token}`;
    },
    /** Switch the owner's link off: the deployer removes the runtime's and the relay's copies at its next pass, and the link is refused from then on. */
    revoke(id: string): void { rmSync(file(id), { force: true }); },
  };
}
