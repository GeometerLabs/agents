// Fixtures shared by the bundle's tests: a server config, a shop folder on disk made from the pathway's example client, and a panel-style runtime.json.
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseServer, readShop, serverPaths } from "../lib/server.ts";
import type { PanelRuntime, ServerConfig } from "../lib/server.ts";
import { TEST_PUBLIC_HEX } from "./licence-helpers.ts";

export const EXAMPLE_CLIENT = new URL("../../templates/commerce/bookings/clients/glow-salon.example", import.meta.url).pathname;
export const CALENDAR_ID = "glowsalon@group.calendar.google.com";
export const PHONE_NUMBER_ID = "123456789012345";

export function serverConfig(change: Record<string, unknown> = {}): ServerConfig {
  const parsed = parseServer({ schema: 1, id: "acme-vps-1", domain: "shops.example.com", reviewedBy: "builder-arjun", model: { wire: "openai", model: "gpt-4o-mini" }, ...change });
  if (parsed.errors.length > 0) throw new Error(parsed.errors.join("; "));
  return parsed.config;
}

/** B69: a shop's fingerprint key for an export test: 64 hex digits in a file, as the deployer's job mounts it. */
export const PERSON_KEY_HEX = "0f".repeat(32);
export function writePersonKey(dir: string): string { const file = join(dir, "person-key"); writeFileSync(file, PERSON_KEY_HEX, { mode: 0o600 }); return file; }

export const panelRuntime = (change: PanelRuntime = {}): PanelRuntime => ({
  mode: "live", tickSeconds: 30,
  services: { payments: {}, calendar: { calendarId: CALENDAR_ID }, messaging: { phoneNumberId: PHONE_NUMBER_ID }, timeoutMs: 20_000 },
  ...change,
});

/**
 * A server folder in a temp directory with one shop in it, written the way the panel writes it. Its geometer.json pins RFC 8032's published test key, as `init` now
 * requires a licence key (decision 39) and the fake Guard image (test/world.ts) has that key built in, as the test image does. A test that wants another key or none
 * says so in `config`.
 */
export function tempServer(shops: Record<string, PanelRuntime | null> = { "glow-salon": panelRuntime() }, config: Record<string, unknown> = {}) {
  const root = mkdtempSync(join(tmpdir(), "geo-bundle-"));
  const paths = serverPaths(root);
  writeFileSync(paths.config, JSON.stringify({ schema: 1, id: "acme-vps-1", domain: "shops.example.com", reviewedBy: "builder-arjun", model: { wire: "openai", model: "gpt-4o-mini" }, licence: { keys: [TEST_PUBLIC_HEX] }, ...config }));
  for (const [name, runtime] of Object.entries(shops)) {
    mkdirSync(paths.shop(name), { recursive: true });
    cpSync(join(EXAMPLE_CLIENT, "settings.json"), join(paths.shop(name), "settings.json"));
    cpSync(join(EXAMPLE_CLIENT, "pathway.lock"), join(paths.shop(name), "pathway.lock"));
    if (runtime) writeFileSync(join(paths.shop(name), "runtime.json"), JSON.stringify(runtime));
    // the panel writes owner.json when it makes a shop: the owner's monthly report names this person (a shop made by `shop add` has none, and says so)
    writeFileSync(join(paths.shop(name), "owner.json"), JSON.stringify({ schema: 1, accountId: "acc_test", accountName: "Divya", role: "partner", createdAt: "2026-11-01T10:00:00Z", template: "bookings" }));
  }
  return { root, paths, shop: (name: string) => readShop(root, name), done: () => rmSync(root, { recursive: true, force: true }) };
}
