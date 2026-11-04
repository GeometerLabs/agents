// What the deployer remembers between runs, in one file (state/state.json): which network index each shop has, the Guard bundle version each Guard
// was last given, who stopped a shop, the lock history for rollback, the last backup and drill. Written atomically; read fresh on every command.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { serverPaths } from "./server.ts";
import { stableJson, writeAtomic } from "./util.ts";

export interface GuardApplied {
  version: number;
  /** sha256 of the spec with its version zeroed: the same content is never given a new version. */
  contentHash: string;
  digest: string;
  tripwires: { passed: number; of: number; notSelfTestable: string[] };
}

/** Everything a shop needs to be put back in the compose file without reading its desired state again. */
export interface Snapshot {
  appliedAt: string;
  pathway: string;
  lockText: string;
  settingsText: string;
  runtime: Record<string, unknown>;
  guards: Record<string, GuardFiles>;
  pathwayDir: string;
  /** Hash of the files the shop was applied from. A shop is "up to date" when its desired state hashes to this. */
  desiredHash: string;
}

export interface ShopState {
  index: number;
  guards: Record<string, GuardApplied>;
  lockHistory: string[];
  stopped?: { by: string; at: string; reason: string; requestId?: string };
  applied?: Snapshot;
  lastDeployAt?: string;
  lastBackupAt?: string;
  lastDrill?: { at: string; ok: boolean; detail: string };
}

/** An agent we did not write: Guards only (no runtime). What it needs to be put back in the compose file without reading its folder again. */
export interface AgentSnapshot {
  appliedAt: string;
  settingsText: string;
  agentText: string;
  guards: Record<string, GuardFiles>;
  desiredHash: string;
}

export interface AgentState {
  /** From the same pool as the shops' (1 to 199): it fixes the agent's addresses on the admin network. */
  index: number;
  guards: Record<string, GuardApplied>;
  stopped?: { by: string; at: string; reason: string };
  applied?: AgentSnapshot;
  lastDeployAt?: string;
}

export interface GuardFiles { kind: string; service: string; specText: string; bundleText: string; tomlText: string }

export interface State {
  schema: 1;
  shops: Record<string, ShopState>;
  /** Agents someone else wrote ("bring your own agent"). Absent on a server that has none, so a shop-only state file is unchanged. */
  agents?: Record<string, AgentState>;
  /** The record job's memory for each such agent is in state/records/<agent>.json (agent/record.ts), not here. */
  model?: GuardApplied;
  modelApplied?: GuardFiles;
  /** Each compose service as last applied: its entry, and the files it mounts. A changed entry is recreated by compose; changed files need a restart. */
  serviceHashes?: Record<string, { block: string; files: string }>;
  /** When the deployer's scheduled jobs last ran (ISO times), so each runs once when it is due and not again after a restart. */
  jobs?: { snapshotAt?: string; drillAt?: string; relayCredentialsAt?: string; exportsAt?: string; agentRecordsAt?: string };
}

const file = (dir: string) => join(serverPaths(dir).state, "state.json");

export function loadState(dir: string): State {
  if (!existsSync(file(dir))) return { schema: 1, shops: {} };
  return JSON.parse(readFileSync(file(dir), "utf8")) as State;
}

export function saveState(dir: string, state: State): void {
  writeAtomic(file(dir), stableJson(state), 0o600);
}

/** A shop's or an agent's network index: the lowest free number from 1 to 199, kept for its life (never reused, so an address never moves). Shops and agents draw from one pool. */
export function shopIndex(state: State, shop: string): number {
  const have = state.shops[shop]?.index ?? state.agents?.[shop]?.index;
  if (have !== undefined) return have;
  const used = new Set([...Object.values(state.shops), ...Object.values(state.agents ?? {})].map((s) => s.index));
  for (let i = 1; i < 200; i++) if (!used.has(i)) return i;
  throw new Error("This server has 199 shops and agents, the most the network plan has addresses for.");
}
