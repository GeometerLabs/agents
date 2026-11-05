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
  /**
   * The version of the agent that Geometer last crash-tested and wrote a go-live certificate for (`geometer agent go-live`, or an `update` that moved it): the version "in service" as far as
   * Geometer knows. It does not run the agent, so this is the builder's word for what runs, backed by the test. The next `update` compares the version in agent.json with this one.
   */
  service?: { version: string | null; at: string; held: number; of: number; code: string };
}

/**
 * One client's part in an update or a rollback: what was decided, what was moved, and what a restart needs to finish a move that stopped half-way.
 * "moving" is written BEFORE the pin is touched and replaced by "moved" (or "held-back") once the deploy has gone through, so a run that was stopped
 * in the middle can tell the clients it finished from the one it did not.
 */
export interface Step {
  status: "moving" | "moved" | "held-back" | "unchanged" | "skipped";
  at: string;
  /** The pins, as `bookings@0.1.0`. */
  from?: string;
  to?: string;
  /** Plain words: why it was held back or skipped, or something to know about the move. */
  reason?: string;
  /** "Held N of M" from the hand check on this client's own settings: on the version it ran (before) and on the new one (after). */
  before?: { held: number; of: number };
  after?: { held: number; of: number };
  /** Situations that held before and fail now, each with the first check that failed. */
  failing?: { title: string; why: string }[];
  /** Situations that held before and are not run at the new version. */
  notChecked?: string[];
  /** What the running Guards proved after the move ("12 of 12 limits proven to bite"). */
  proven?: string;
  /** How the runtime lays out its saved data in the two versions, when both could be asked. The older version cannot read what a higher number wrote. */
  layout?: { from: number; to: number };
  /** The pin file as it was and as it will be, and the lock history as it was, so a move that stopped half-way can be finished or put back. */
  fromLock?: string;
  toLock?: string;
  historyBefore?: string[];
}

/** An update or a rollback over several clients, step by step. The last of each kind is kept in `State.update` and `State.rollback`. */
export interface Run {
  kind: "update" | "rollback";
  startedAt: string;
  finishedAt?: string;
  /** What was asked, so the same command again after a stop carries on with this run and does not start another. */
  request: { to: string | null; shops: string[] | null };
  /** The clients, in the order they are taken. */
  shops: string[];
  steps: Record<string, Step>;
  /** Set when the run stopped on purpose before the end (a deploy was refused), and why. */
  stoppedBecause?: string;
  /** A dry run, for the summary only: it is never written to the state file. */
  dryRun?: boolean;
}

export interface GuardFiles { kind: string; service: string; specText: string; bundleText: string; tomlText: string }

export interface State {
  schema: 1;
  shops: Record<string, ShopState>;
  /** The last `geometer update` and the last `geometer rollback`, client by client (update.ts). The pins are shops/<shop>/pathway.lock; the ones before are each shop's `lockHistory`. */
  update?: Run;
  rollback?: Run;
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
