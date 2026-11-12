// Item 11d on the server: the deployer hands the owner's link (its hash) from shops/<shop>/owner-link.json to the shop's runtime and relay on every pass, and takes both
// copies away when the panel switched the link off, so a revoked link stops within one pass of the loop without a restart.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newOwnerToken, ownerLinkFile, ownerTokenMatches, readOwnerLink } from "../../modules/channels/owner-link.ts";
import { ownerLinkCopies, ownerLinkSource, syncOwnerLinks } from "../lib/owner-link.ts";
import { caddyfile } from "../generate/compose.ts";
import { serverConfig } from "./helpers.ts";

test("the link's hash reaches the runtime and the relay, a new one replaces it, and a revoked one is taken from both", () => {
  const dir = mkdtempSync(join(tmpdir(), "geo-owner-link-"));
  try {
    const [runtimeCopy, relayCopy] = ownerLinkCopies(dir, "glow");
    assert.deepEqual(syncOwnerLinks(dir, ["glow"]), [], "no link: nothing to do");
    mkdirSync(join(dir, "shops", "glow"), { recursive: true });
    const token = newOwnerToken();
    writeFileSync(ownerLinkSource(dir, "glow"), JSON.stringify(ownerLinkFile(token, new Date(0))));
    assert.deepEqual(syncOwnerLinks(dir, ["glow"]), [], "a shop not deployed yet has no folders to write into");
    mkdirSync(join(dir, "generated", "shops", "glow", "client"), { recursive: true });
    mkdirSync(join(dir, "secrets", "relay", "glow"), { recursive: true });
    assert.equal(syncOwnerLinks(dir, ["glow"]).length, 2);
    for (const copy of [runtimeCopy, relayCopy]) assert.ok(ownerTokenMatches(token, readOwnerLink(readFileSync(copy, "utf8"))), copy);
    assert.deepEqual(syncOwnerLinks(dir, ["glow"]), [], "nothing changed, nothing written");
    const next = newOwnerToken();
    writeFileSync(ownerLinkSource(dir, "glow"), JSON.stringify(ownerLinkFile(next, new Date(1))));
    syncOwnerLinks(dir, ["glow"]);
    assert.ok(!ownerTokenMatches(token, readOwnerLink(readFileSync(runtimeCopy, "utf8"))) && ownerTokenMatches(next, readOwnerLink(readFileSync(relayCopy, "utf8"))));
    rmSync(ownerLinkSource(dir, "glow"));
    assert.equal(syncOwnerLinks(dir, ["glow"]).length, 2);
    assert.ok(!existsSync(runtimeCopy) && !existsSync(relayCopy), "revoked: both copies are gone");
    writeFileSync(ownerLinkSource(dir, "glow"), "{ not a link");
    syncOwnerLinks(dir, ["glow"]);
    assert.ok(!existsSync(runtimeCopy), "a file that does not read as a link opens nothing");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("Caddy sends each shop's /s/ pages to the inbox process, and only on a server that has shops", () => {
  assert.match(caddyfile(serverConfig({}), [], ["glow"]), /handle \/s\/\* \{\n\t\treverse_proxy inbox:8788\n\t\}/u);
  assert.doesNotMatch(caddyfile(serverConfig({}), [], []), /handle \/s\//u);
});
