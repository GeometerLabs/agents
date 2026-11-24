// A parts shop's runtime.json (decision 65), checked for the deployer and the panel (the shop's program is Go: go/cmd/parts). One runtime.json serves every part: the shop's one
// WhatsApp, its push, its report block, its models. It is read with the services Fees and Orders read (FEES_SERVICES: a payments service and WhatsApp, each optional for a
// UPI shop and a shop with no WhatsApp); a Stock orders part's need of WhatsApp in a live shop is checked by the program itself when it starts (its PreCheck), as Stock orders'
// own program does. `validateRuntimeConfig` accepts the same other keys as every template (`ai`, `report`, `allowance`, ...), because the deploy bundle writes them.
import { validateSettings } from "../src/settings.ts";
import type { Settings } from "../src/settings.ts";
import { FEES_SERVICES, loadClientFolder, pathwayVersion as versionOf, readRuntimeConfig } from "../../../../modules/runtime/config.ts";
import type { ClientFolder as SharedClientFolder, RuntimeConfig as SharedRuntimeConfig } from "../../../../modules/runtime/config.ts";

/** The template's name, as a shop's pathway.lock names it (`parts@<version>`). */
export const PATHWAY = "parts";

export type RuntimeConfig = SharedRuntimeConfig;
export type ClientFolder = SharedClientFolder<Settings>;

export function pathwayVersion(): string {
  return versionOf(new URL("../package.json", import.meta.url));
}

/** Check runtime.json's contents. `folder` is what a relative dataDir is measured from. */
export function validateRuntimeConfig(input: unknown, folder: string): { ok: true; config: RuntimeConfig } | { ok: false; errors: string[] } {
  return readRuntimeConfig(input, folder, FEES_SERVICES) as { ok: true; config: RuntimeConfig } | { ok: false; errors: string[] };
}

/** Read and check a whole client folder, and refuse if it is pinned to another version than this one. */
export function loadClient(folder: string, running: { pathway: string; version: string } = { pathway: PATHWAY, version: pathwayVersion() }): ClientFolder {
  return loadClientFolder(folder, running, { validateSettings, services: FEES_SERVICES }) as ClientFolder;
}
