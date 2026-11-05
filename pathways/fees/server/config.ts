// A centre's folder, read and checked: clients/<name>/settings.json (the centre), runtime.json (how this agent runs) and pathway.lock (which pathway version it is pinned
// to). Every problem is said in plain words, all at once, so a builder can fix the folder without a manual. Nothing secret lives here: the internal token is a file named
// in the environment, and the service keys are never in the runtime at all (Guard holds them).
//
// Reading runtime.json is the same for every template except which services it calls (modules/runtime/config.ts documents every setting). Fees calls two: payments and
// messaging. It has no calendar. `validateRuntimeConfig` accepts everything Bookings' does (`parser`, `decision`, `ai`, `allowance`, `pauseMinutes` and `report`), because
// the deploy bundle writes `ai` and `report` into the config it generates and a runtime that refused them would not start (bundle/generate/shop.ts checks this).
import { validateSettings } from "../src/settings.ts";
import type { Settings } from "../src/settings.ts";
import { FEES_SERVICES, loadClientFolder, pathwayVersion as versionOf, readRuntimeConfig } from "../../../modules/runtime/config.ts";
import type { ClientFolder as SharedClientFolder, RuntimeConfig as SharedRuntimeConfig } from "../../../modules/runtime/config.ts";
import { PATHWAY } from "./runtime.ts";

export { ClientError, aiOverrideReader, parseLock, reportOptionsReader, validName } from "../../../modules/runtime/config.ts";
export type { AllowanceConfig, DecisionConfig, ParserConfig, ReportConfig } from "../../../modules/runtime/config.ts";

/** Where the live adapters should call. Each base URL is a Guard instance in front of that service. `agentTokenFile` is the credential THIS agent presents to that Guard. */
export interface LiveServicesConfig {
  payments: { baseUrl: string; agentTokenFile?: string };
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
  return readRuntimeConfig(input, folder, FEES_SERVICES) as { ok: true; config: RuntimeConfig } | { ok: false; errors: string[] };
}

/** Read and check a whole client folder, and refuse if it is pinned to another version of the pathway than this one. */
export function loadClient(folder: string, running: { pathway: string; version: string } = { pathway: PATHWAY, version: pathwayVersion() }): ClientFolder {
  return loadClientFolder(folder, running, { validateSettings, services: FEES_SERVICES }) as ClientFolder;
}
