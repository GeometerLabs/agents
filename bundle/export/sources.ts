// Where the export reads from on a server: the shop's folder, the deployer's export of its record, its status, and (when the panel is there to give them) the papers
// the panel made and its memory of the shop's accounts. Plain files only; nothing here starts a process or calls a service.
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { gatewaySpec } from "../generate/guards.ts";
import { kindFor } from "../lib/kinds.ts";
import { loadServer } from "../lib/server.ts";
import { loadState } from "../lib/state.ts";
import { SHOP_ID, serverPaths } from "../panel/contract.ts";
import type { ExportSources } from "./build.ts";

/** What the panel can add: the papers it keeps in its own (possibly sealed) store, and what it remembers about the shop's accounts. */
export interface PanelParts {
  papers(shop: string): { path: string; text: string }[];
  meta(shop: string): ReturnType<ExportSources["meta"]>;
  /** The panel's signing key, which signs the record's evidence pack and its anchor. */
  signingKey?: () => ReturnType<NonNullable<ExportSources["signingKey"]>>;
}

const readText = (file: string): string | undefined => { try { return readFileSync(file, "utf8"); } catch { return undefined; } };

// Maps a shop name to the readers the export uses. Checks the name first so a crafted name cannot walk out of the shops folder.
export function sourcesFor(serverDir: string, shop: string, panel?: PanelParts): ExportSources {
  if (!SHOP_ID.test(shop)) throw new Error(`"${shop}" is not a shop name.`);
  const p = serverPaths(serverDir);
  const exports = p.exports(shop);
  return {
    shopFile: (name) => readText(join(p.shop(shop), name)),
    exportFile: (name) => readText(join(exports, name)),
    exportedAt: () => { const f = join(exports, "record.json"); return existsSync(f) ? new Date(statSync(f).mtimeMs).toISOString() : undefined; },
    statusText: () => readText(p.statusFile(shop)),
    limitsSpec: (settings, template) => {
      // the deployer's own generator, with this server's approval hours and link cap and the version Guard was last given: the spec Guard enforces, not a look-alike
      let server;
      try { server = loadServer(serverDir); } catch { return undefined; }
      const kind = kindFor(template);
      if (!kind) return undefined;
      let version = 1;
      try { version = loadState(serverDir).shops[shop]?.guards?.razorpay?.version ?? 1; } catch { /* no state yet: version 1, as a first deploy gives */ }
      return gatewaySpec(settings, { tenant: shop, name: `${shop}-razorpay`, version, reviewedBy: server.reviewedBy }, server.approvalHours, server.limits.razorpayLinksPerHour, undefined, kind.gatewaySpec);
    },
    papers: () => panel?.papers(shop) ?? [],
    pins: () => { try { return JSON.parse(readText(join(p.shop(shop), "pins.json")) ?? "null") ?? undefined; } catch { return undefined; } },
    meta: () => panel?.meta(shop),
    signingKey: () => panel?.signingKey?.(),
  };
}
