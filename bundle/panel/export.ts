// The panel's side of the shop export (B38): the papers it made, read through its own store (they are sealed there when the panel has a data key), handed to the
// one builder in bundle/export/. The download and `geometer export` (which asks the panel, because only the panel can open its store) make the same package.
import { buildExport, packageTarGz } from "../export/build.ts";
import type { BuiltExport } from "../export/build.ts";
import { sourcesFor } from "../export/sources.ts";
import { loadPrivateKey } from "../../modules/report/sign.ts";
import type { PanelConfig } from "./config.ts";
import type { Documents } from "./documents.ts";
import type { Shops } from "./shops.ts";

// Builds the shop export package from the panel's sealed papers; it lives in the panel because only the panel can open its store, which is why `geometer export` asks the panel instead of reading files itself.
export function exportShop(config: PanelConfig, shops: Shops, docs: Documents, shop: string, now: number, by?: { name: string; role: string }): { built: BuiltExport; tgz: Buffer } {
  const papers = (id: string) => [
    ...docs.list(id, "go-live").map((f) => ({ path: `go-live/${f}`, text: docs.get(id, `go-live/${f}`) })),
    ...docs.list(id, "monthly").map((rel) => ({ path: `monthly/${rel}`, text: docs.get(id, `monthly/${rel}`) })),
  ].filter((p): p is { path: string; text: string } => typeof p.text === "string");
  const signingKey = () => (config.signingKeyFile ? loadPrivateKey(config.signingKeyFile) : undefined); // signs the record's evidence pack and its anchor (B28)
  const built = buildExport(sourcesFor(config.serverDir, shop, { papers, meta: (id) => shops.meta(id), signingKey }), { shop, now, ...(by ? { exportedBy: by } : {}) });
  return { built, tgz: packageTarGz(built, now) };
}
