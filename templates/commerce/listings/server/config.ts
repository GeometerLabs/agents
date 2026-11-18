// A shop's folder, read and checked: settings.json (the shop), runtime.json (how this runtime runs it) and pathway.lock (the version it is pinned to). The same reading as
// every template (modules/runtime/config.ts). A listings-only shop calls NO service: no payments, no calendar, no WhatsApp. runtime.json may name `push` (not used yet) and
// the model for the assistant's drafts, which is reached through the server's model Guard like any shop's.
import { validateSettings } from "../src/settings.ts";
import type { Settings } from "../src/settings.ts";
import { LISTINGS_SERVICES, loadClientFolder, pathwayVersion as versionOf, readRuntimeConfig } from "../../../../modules/runtime/config.ts";
import type { ClientFolder as SharedClientFolder, RuntimeConfig } from "../../../../modules/runtime/config.ts";

export { ClientError, aiOverrideReader, parseLock, validName } from "../../../../modules/runtime/config.ts";
export type { AllowanceConfig, ParserConfig, RuntimeConfig } from "../../../../modules/runtime/config.ts";
export const PATHWAY = "listings";
export type ClientFolder = SharedClientFolder<Settings>;

export const pathwayVersion = (): string => versionOf(new URL("../package.json", import.meta.url));

/** Check runtime.json's contents. `folder` is what a relative dataDir is measured from. */
export function validateRuntimeConfig(input: unknown, folder: string): { ok: true; config: RuntimeConfig } | { ok: false; errors: string[] } {
  return readRuntimeConfig(input, folder, LISTINGS_SERVICES);
}

/** Read and check a whole client folder, and refuse if it is pinned to another version of the pathway than this one. */
export function loadClient(folder: string, running: { pathway: string; version: string } = { pathway: PATHWAY, version: pathwayVersion() }): ClientFolder {
  return loadClientFolder(folder, running, { validateSettings, services: LISTINGS_SERVICES });
}
