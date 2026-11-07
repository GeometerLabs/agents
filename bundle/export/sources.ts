// Where the export reads from on a server: the shop's folder, the deployer's export of its record, its status, and (when the panel is there to give them) the papers
// the panel made and its memory of the shop's accounts. Plain files only; nothing here starts a process or calls a service.
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { SHOP_ID, serverPaths } from "../panel/contract.ts";
import type { ExportSources } from "./build.ts";

/** What the panel can add: the papers it keeps in its own (possibly sealed) store, and what it remembers about the shop's accounts. */
export interface PanelParts {
  papers(shop: string): { path: string; text: string }[];
  meta(shop: string): ReturnType<ExportSources["meta"]>;
}

const readText = (file: string): string | undefined => { try { return readFileSync(file, "utf8"); } catch { return undefined; } };

export function sourcesFor(serverDir: string, shop: string, panel?: PanelParts): ExportSources {
  if (!SHOP_ID.test(shop)) throw new Error(`"${shop}" is not a shop name.`);
  const p = serverPaths(serverDir);
  const exports = p.exports(shop);
  return {
    shopFile: (name) => readText(join(p.shop(shop), name)),
    exportFile: (name) => readText(join(exports, name)),
    exportedAt: () => { const f = join(exports, "record.json"); return existsSync(f) ? new Date(statSync(f).mtimeMs).toISOString() : undefined; },
    statusText: () => readText(p.statusFile(shop)),
    papers: () => panel?.papers(shop) ?? [],
    pins: () => { try { return JSON.parse(readText(join(p.shop(shop), "pins.json")) ?? "null") ?? undefined; } catch { return undefined; } },
    meta: () => panel?.meta(shop),
  };
}
