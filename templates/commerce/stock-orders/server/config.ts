// A shop's folder, read and checked: clients/<name>/settings.json (the shop), runtime.json (how this agent runs) and pathway.lock (which pathway version it is pinned to).
// Every problem is said in plain words, all at once, so a builder can fix the folder without a manual. Nothing secret lives here: the internal token is a file named in the
// environment, and the service keys are never in the runtime at all (Guard holds them).
//
// Stock orders calls one service, WhatsApp (messaging), and it is required: the order goes to a supplier on it (modules/runtime/config.ts STOCK_SERVICES). There is no
// payment service and no calendar. `validateRuntimeConfig` accepts the same other keys as every template (`ai`, `report`, `allowance`, ...), because the deploy bundle writes
// them into the config it generates and a runtime that refused them would not start (bundle/generate/shop.ts checks this).
import { validateSettings } from "../src/settings.ts";
import type { Settings } from "../src/settings.ts";
import { STOCK_SERVICES, loadClientFolder, pathwayVersion as versionOf, readRuntimeConfig } from "../../../../modules/runtime/config.ts";
import type { ClientFolder as SharedClientFolder, RuntimeConfig as SharedRuntimeConfig } from "../../../../modules/runtime/config.ts";
import { PATHWAY } from "./runtime.ts";

export { ClientError, aiOverrideReader, parseLock, reportOptionsReader, validName } from "../../../../modules/runtime/config.ts";
export type { AllowanceConfig, DecisionConfig, ParserConfig, ReportConfig } from "../../../../modules/runtime/config.ts";

/** Where the live adapter should call: a Guard instance in front of WhatsApp. `agentTokenFile` is the credential THIS agent presents to that Guard. */
export interface LiveServicesConfig {
  messaging: { baseUrl: string; phoneNumberId: string; agentTokenFile?: string };
  timeoutMs?: number;
}

export type RuntimeConfig = Omit<SharedRuntimeConfig, "services"> & { services?: LiveServicesConfig };
export type ClientFolder = Omit<SharedClientFolder<Settings>, "runtime"> & { runtime: RuntimeConfig };

export function pathwayVersion(): string {
  return versionOf(new URL("../package.json", import.meta.url));
}

/** Check runtime.json's contents. `folder` is what a relative dataDir is measured from. */
export function validateRuntimeConfig(input: unknown, folder: string): { ok: true; config: RuntimeConfig } | { ok: false; errors: string[] } {
  return readRuntimeConfig(input, folder, STOCK_SERVICES) as { ok: true; config: RuntimeConfig } | { ok: false; errors: string[] };
}

/** Read and check a whole client folder, and refuse if it is pinned to another version of the pathway than this one. */
export function loadClient(folder: string, running: { pathway: string; version: string } = { pathway: PATHWAY, version: pathwayVersion() }): ClientFolder {
  return loadClientFolder(folder, running, { validateSettings, services: STOCK_SERVICES }) as ClientFolder;
}
