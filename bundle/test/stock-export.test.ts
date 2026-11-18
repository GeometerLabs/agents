// The shop's own stock count in what a shop takes with it (block S phase A3): the deployer's export writes stock.json from the shop's own database and the package carries it as
// stock/stock.json with its hash; a shop that counts nothing exports exactly as it did. Written, not run, in the 18 Nov build stream: the lead's test pass runs it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildExport } from "../export/build.ts";
import type { ExportSources } from "../export/build.ts";

test("a package carries stock/stock.json when the shop counts something, and nothing about stock when it counts nothing", () => {
  const base: ExportSources = {
    shopFile: (n) => (n === "settings.json" ? JSON.stringify({ name: "Paws" }) : undefined), exportFile: () => undefined, exportedAt: () => undefined, statusText: () => undefined,
    papers: () => [], pins: () => undefined, meta: () => undefined,
  };
  const req = { shop: "paws", now: Date.UTC(2026, 10, 18), exportedBy: { name: "test", role: "server" } };
  const none = buildExport(base, req);
  assert.ok(![...none.files.keys()].some((k) => k.startsWith("stock/")));
  const text = JSON.stringify({ lines: [{ id: "listing:l-1", count: 2, lowFlag: false, crossings: 0, applied: {}, moves: [], startedMs: 1 }], alerts: [] });
  const withStock = buildExport({ ...base, exportFile: (n) => (n === "stock.json" ? text : undefined) }, req);
  assert.equal(Buffer.from(withStock.files.get("stock/stock.json")!).toString("utf8"), text);
  assert.ok(withStock.manifest.files.some((f) => f.path === "stock/stock.json"), "the manifest lists it with its hash");
});
