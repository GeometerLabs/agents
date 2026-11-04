// The host side of the record of an agent someone else wrote: ask `ops` (the one container that can reach the Guards) what the Guards and the services say, add it to the record
// (agent/record.ts), keep the record where only the deployer reads it (state/records/<agent>.json), and export it for the report the way a shop's record is exported
// (exports/<agent>/record.json and bookings.json, which carry no customer's number).
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ops } from "../deploy.ts";
import type { Context } from "../deploy.ts";
import { serverPaths } from "../lib/server.ts";
import { loadState } from "../lib/state.ts";
import { writeAtomic } from "../lib/util.ts";
import type { Facts } from "./facts.ts";
import { readAgent } from "./folder.ts";
import { emptyRecord, foldFacts, waitingForOwner } from "./record.ts";
import type { RecordState } from "./record.ts";

export const recordFile = (dir: string, agent: string): string => join(serverPaths(dir).state, "records", `${agent}.json`);

export function loadRecord(dir: string, agent: string): RecordState {
  const path = recordFile(dir, agent);
  if (!existsSync(path)) return emptyRecord();
  const state = JSON.parse(readFileSync(path, "utf8")) as RecordState;
  if (state.schema !== 1) throw new Error(`${path} is not a record this bundle can read.`);
  return state;
}

/** Fold what the Guards and services say into the record and export it. `facts` is for a test; left out, `ops` is asked. */
export async function recordAgent(ctx: Context, agent: string, facts?: Facts): Promise<{ added: number; total: number; problems: string[] }> {
  const folder = readAgent(ctx.dir, agent);
  if (!folder.settings) return { added: 0, total: 0, problems: folder.problems };
  let seen = facts;
  if (!seen) {
    const r = await ops(ctx, ["agent-facts", agent]);
    try { seen = JSON.parse(r.stdout.trim().split("\n").at(-1) ?? "") as Facts; } catch { /* handled below */ }
    if (!seen || typeof seen.guards !== "object" || typeof seen.service !== "object") return { added: 0, total: loadRecord(ctx.dir, agent).entries.length, problems: [`The Guards could not be asked (${(r.stderr.trim() || r.stdout.trim() || `exit ${r.code}`).slice(0, 200)}). Is the server up?`] };
  }
  const { state, added } = foldFacts(loadRecord(ctx.dir, agent), seen, { settings: folder.settings, agentId: `agent-${agent}`, relayId: `relay-${agent}`, now: ctx.now().getTime() });
  const out = serverPaths(ctx.dir).exportsOf(agent);
  mkdirSync(out, { recursive: true });
  writeAtomic(recordFile(ctx.dir, agent), `${JSON.stringify(state)}\n`, 0o600);
  writeAtomic(join(out, "record.json"), JSON.stringify(state.entries));
  writeAtomic(join(out, "bookings.json"), JSON.stringify(waitingForOwner(seen, ctx.now().getTime())));
  return { added: added.length, total: state.entries.length, problems: seen.problems };
}

/** Every deployed agent's record, one after the other. */
export async function recordAgents(ctx: Context): Promise<string[]> {
  const lines: string[] = [];
  for (const [name, a] of Object.entries(loadState(ctx.dir).agents ?? {})) {
    if (!a.applied) continue;
    const r = await recordAgent(ctx, name);
    lines.push(`${name}: ${r.added} added to the record (${r.total} in all)${r.problems.length > 0 ? `; ${r.problems.join(" ")}` : ""}`);
  }
  return lines;
}
