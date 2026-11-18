// Listings and their photos in what a shop takes with it (block S, phase A): the deployer's export writes listings.json and the photos from the shop's own database, and the package
// carries them under listings/ with their hashes. A removed listing's words and photos are not exported; a shop with no listings exports as it did. Written, not run, in the 18 Nov build stream.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildExport } from "../export/build.ts";
import type { ExportSources } from "../export/build.ts";

test("a package carries listings/listings.json and listings/photos/ when the shop has listings, and nothing about them when it has none", () => {
  const photo = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const base: ExportSources = {
    shopFile: (n) => (n === "settings.json" ? JSON.stringify({ name: "Paws" }) : undefined), exportFile: () => undefined, exportedAt: () => undefined, statusText: () => undefined,
    papers: () => [], pins: () => undefined, meta: () => undefined,
  };
  const none = buildExport(base, { shop: "paws", now: Date.UTC(2026, 10, 18), exportedBy: { name: "test", role: "server" } });
  assert.ok(![...none.files.keys()].some((k) => k.startsWith("listings/")));
  const withListings = buildExport({ ...base, exportFile: (n) => (n === "listings.json" ? JSON.stringify({ seq: 1, items: [{ id: "l-1", state: "live", photos: [{ id: "ph-0123456789ab" }] }], shop: { visible: true } }) : undefined), listingPhotos: () => [{ name: "ph-0123456789ab.jpg", bytes: photo }] }, { shop: "paws", now: Date.UTC(2026, 10, 18), exportedBy: { name: "test", role: "server" } });
  assert.ok(withListings.files.has("listings/listings.json"));
  assert.deepEqual(withListings.files.get("listings/photos/ph-0123456789ab.jpg"), photo);
  assert.ok(withListings.manifest.files.some((f) => f.path === "listings/photos/ph-0123456789ab.jpg" && f.bytes === 4), "the manifest lists the photo with its hash");
});
