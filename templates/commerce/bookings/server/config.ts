// A client's folder, read and checked: clients/<name>/settings.json (the business), runtime.json (how this agent runs) and pathway.lock (which pathway version it is pinned
// to). Every problem is said in plain words, all at once, so a builder can fix the folder without a manual. Nothing secret lives here: the internal token is a file named
// in the environment, and the service keys are never in the runtime at all (Guard holds them).
//
// Reading runtime.json is the same for every template except which services it calls, so the code is shared (modules/runtime/config.ts, which documents every setting).
// This file says what Bookings calls (payments, the calendar and messaging), and keeps the names Bookings' tests and the bundle have always imported.
import { validateSettings } from "../src/settings.ts";
import type { Settings } from "../src/settings.ts";
import { BOOKINGS_SERVICES, loadClientFolder, pathwayVersion as versionOf, readRuntimeConfig } from "../../../../modules/runtime/config.ts";
import type { ClientFolder as SharedClientFolder, RuntimeConfig as SharedRuntimeConfig, ServiceConfig } from "../../../../modules/runtime/config.ts";
import { PATHWAY } from "./runtime.ts";

export { ClientError, aiOverrideReader, parseLock, reportOptionsReader, validName } from "../../../../modules/runtime/config.ts";
export type { AllowanceConfig, DecisionConfig, ParserConfig, ReportConfig } from "../../../../modules/runtime/config.ts";

/** Where the live adapters should call. Each base URL is a Guard instance in front of that service. */
export interface LiveServicesConfig {
  // `agentTokenFile`: a file holding the credential THIS agent presents to that Guard (what Guard calls the agent's token; Guard removes it before it
  // forwards). It is not a key to the service. Left out, no Authorization header is sent. A relative path is measured from the client folder.
  payments: { baseUrl: string; agentTokenFile?: string };
  calendar: { baseUrl: string; calendarId: string; agentTokenFile?: string };
  messaging: { baseUrl: string; phoneNumberId: string; agentTokenFile?: string };
  timeoutMs?: number;
}

export type RuntimeConfig = Omit<SharedRuntimeConfig, "services"> & { services?: LiveServicesConfig };
export type ClientFolder = Omit<SharedClientFolder<Settings>, "runtime"> & { runtime: RuntimeConfig };
export type { ServiceConfig };

export function pathwayVersion(): string {
  return versionOf(new URL("../package.json", import.meta.url));
}

/** Check runtime.json's contents. `folder` is what a relative dataDir is measured from. */
export function validateRuntimeConfig(input: unknown, folder: string): { ok: true; config: RuntimeConfig } | { ok: false; errors: string[] } {
  return readRuntimeConfig(input, folder, BOOKINGS_SERVICES) as { ok: true; config: RuntimeConfig } | { ok: false; errors: string[] };
}

/** Read and check a whole client folder, and refuse if it is pinned to another version of the pathway than this one. */
export function loadClient(folder: string, running: { pathway: string; version: string } = { pathway: PATHWAY, version: pathwayVersion() }): ClientFolder {
  return loadClientFolder(folder, running, { validateSettings, services: BOOKINGS_SERVICES }) as ClientFolder;
}
