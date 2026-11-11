// What the panel asks for an own agent (B51's rest, 12 Nov 2026), carried out by the deployer (apply.ts watch), and what it writes back for the panel to show. The panel never
// runs anything: it writes a request file with a name and an id, and reads the results from status/ and exports/ (bundle/panel/agents.ts).
//
//   requests/<agent>.stop.json         the kill switch: the same request a shop's stop is (apply.ts processStopRequests), carried out on the agent's Guards
//   requests/<agent>.crash-test.json   a new crash test of the agent, on its own settings, with the run command in its agent.json (never anything the panel wrote).
//                                      It runs BESIDE the deployer's loop, one at a time per server, so a stop request never waits behind it.
//   requests/<agent>.rotate.json       new credentials for every Guard, or for one (agent/rotate.ts), with the usual overlap; run in the loop, because it deploys
//
//   exports/<agent>/crash-test.json    the last crash test, as the panel shows it: when, which version, the counts, the titles of what did not hold or was not run (never a
//                                      check's detail, which can carry the agent's own output), or that one is running, or why it could not run. Written only here and by
//                                      `geometer agent crash-test|go-live`, so nothing else writes it at the same time.
//   exports/<agent>/in-service.json    the version Geometer last issued a go-live certificate for with everything holding (lib/state.ts AgentState.service), for the panel.
//   exports/<agent>/rotation.json      the last rotation the panel asked for: done (which Guards, until when the old ones work) or why not.
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Context } from "../deploy.ts";
import { serverPaths } from "../lib/server.ts";
import { loadState } from "../lib/state.ts";
import { shopNameProblem, stableJson, writeAtomic } from "../lib/util.ts";
import { planCrashTest, runCrashTest } from "./crash-test/run.ts";
import type { CrashResult } from "./crash-test/run.ts";
import { rotateAgent } from "./rotate.ts";

/** The last crash test of an own agent, as exports/<agent>/crash-test.json holds it. */
export interface CrashSummary { at: string; version: string | null; held: number; of: number; failed: string[]; notRun: string[]; goLive: boolean; running?: boolean; error?: string; by?: string }

export const CRASH_REQUEST = /^([a-z0-9][a-z0-9-]{0,39})\.crash-test\.json$/u;
export const ROTATE_REQUEST = /^([a-z0-9][a-z0-9-]{0,39})\.rotate\.json$/u;

/** A request file the panel wrote: its id, who asked and when, and (rotate only) one Guard's kind. Anything else in it is ignored; anything missing makes it no request. */
export interface AgentRequest { schema: 1; requestId: string; agent: string; requestedAt: string; requestedBy: { id: string; name: string; role: string }; guard?: string }

const text = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max;

export function parseAgentRequest(content: string | undefined, agent: string): AgentRequest | undefined {
  if (content === undefined) return undefined;
  try {
    const r = JSON.parse(content) as Record<string, any>;
    if (!(r && r.schema === 1 && text(r.requestId, 80) && r.agent === agent && text(r.requestedAt, 40) && Number.isFinite(Date.parse(r.requestedAt)) && r.requestedBy && text(r.requestedBy.id, 80))) return undefined;
    if (r.guard !== undefined && !(typeof r.guard === "string" && /^[a-z][a-z0-9-]{0,30}$/u.test(r.guard))) return undefined;
    return { schema: 1, requestId: r.requestId, agent, requestedAt: r.requestedAt, requestedBy: { id: r.requestedBy.id, name: text(r.requestedBy.name, 120) ? r.requestedBy.name : r.requestedBy.id, role: text(r.requestedBy.role, 20) ? r.requestedBy.role : "user" }, ...(r.guard ? { guard: r.guard } : {}) };
  } catch { return undefined; }
}

export const crashSummaryFile = (dir: string, agent: string): string => join(serverPaths(dir).exportsOf(agent), "crash-test.json");
export const rotationFile = (dir: string, agent: string): string => join(serverPaths(dir).exportsOf(agent), "rotation.json");
export const inServiceFile = (dir: string, agent: string): string => join(serverPaths(dir).exportsOf(agent), "in-service.json");

/** The panel's copy of a crash test's result: counts and titles only. */
export function crashSummaryOf(result: CrashResult, at: Date, goLive: boolean, by?: string): CrashSummary {
  return { at: at.toISOString(), version: result.version, held: result.held, of: result.total, failed: result.situations.filter((s) => !s.held).map((s) => s.title), notRun: result.notRun.map((s) => s.title), goLive, ...(by ? { by } : {}) };
}

export function writeCrashSummary(dir: string, agent: string, summary: CrashSummary): void {
  writeAtomic(crashSummaryFile(dir, agent), stableJson(summary));
}

/** The version in service, for the panel (called where the state's `service` is written: crash-test/golive.ts recordService). */
export function writeInService(dir: string, agent: string): void {
  const s = loadState(dir).agents?.[agent]?.service;
  if (s) writeAtomic(inServiceFile(dir, agent), stableJson(s));
}

/** Crash tests started from the panel and still running in this process, by agent. One at a time per server: each starts real Guards and the agent itself. */
const running = new Map<string, Promise<void>>();
const warned = new Set<string>();

/** Run one crash test the panel asked for, beside the loop; its summary is written when it ends, whatever the end. */
function startCrashTest(ctx: Context, agent: string, request: AgentRequest): void {
  const by = `${request.requestedBy.name} (${request.requestedBy.role}, from the panel)`;
  writeCrashSummary(ctx.dir, agent, { at: ctx.now().toISOString(), version: null, held: 0, of: 0, failed: [], notRun: [], goLive: false, running: true, by });
  const work = (async () => {
    try {
      const { plan } = await planCrashTest(ctx, agent);
      const result = await runCrashTest(plan);
      writeCrashSummary(ctx.dir, agent, crashSummaryOf(result, ctx.now(), false, by));
      ctx.log(`${agent}: the crash test the panel asked for held ${result.held} of ${result.total} (request ${request.requestId}).`);
    } catch (e) {
      writeCrashSummary(ctx.dir, agent, { at: ctx.now().toISOString(), version: null, held: 0, of: 0, failed: [], notRun: [], goLive: false, error: (e as Error).message.slice(0, 400), by });
      ctx.log(`${agent}: the crash test the panel asked for could not run: ${(e as Error).message.slice(0, 200)}`);
    } finally { running.delete(agent); }
  })();
  running.set(agent, work);
}

/**
 * The panel's crash-test and rotate requests for own agents (stop requests are processStopRequests'). A request is removed once it is taken; a crash test is then running
 * beside the loop. A request for an agent that is not on this server is left alone and said once. Returns what was started or done.
 */
export async function processAgentRequests(ctx: Context): Promise<string[]> {
  const dir = serverPaths(ctx.dir).requests;
  const done: string[] = [];
  if (!existsSync(dir)) return done;
  const agents = loadState(ctx.dir).agents ?? {};
  // a crash test this process did not start cannot still be running here (the deployer was restarted in the middle of one): say so, so the panel does not wait for good
  for (const agent of Object.keys(agents)) {
    if (running.has(agent)) continue;
    let was: CrashSummary | undefined;
    try { was = JSON.parse(readFileSync(crashSummaryFile(ctx.dir, agent), "utf8")) as CrashSummary; } catch { /* none yet */ }
    if (was?.running) writeCrashSummary(ctx.dir, agent, { ...was, running: false, error: "The deployer was restarted before this crash test finished, so it has no result. Ask for a new one." });
  }
  for (const file of readdirSync(dir).sort()) {
    const crash = CRASH_REQUEST.exec(file);
    const rotate = ROTATE_REQUEST.exec(file);
    const agent = crash?.[1] ?? rotate?.[1];
    if (!agent) continue;
    const path = join(dir, file);
    const request = shopNameProblem(agent) || !agents[agent] ? undefined : parseAgentRequest(readFileSync(path, "utf8"), agent);
    if (!request) { if (!warned.has(path)) { warned.add(path); ctx.log(`requests/${file} is not a request for an own agent on this server, so it is left alone.`); } continue; }
    if (crash) {
      if (running.size > 0) continue; // one at a time: it is taken when the one running ends
      rmSync(path, { force: true });
      startCrashTest(ctx, agent, request);
      done.push(`${agent}: crash test started`);
      continue;
    }
    rmSync(path, { force: true });
    try {
      const r = await rotateAgent(ctx, agent, request.guard ? { guard: request.guard } : {});
      writeAtomic(rotationFile(ctx.dir, agent), stableJson({ at: ctx.now().toISOString(), ok: true, guards: r.guards, oldUntil: r.overlapUntil }));
      ctx.log(`${agent}: new credentials at the panel's request ${request.requestId}. ${r.lines.slice(0, 2).join(" ")}`);
      done.push(`${agent}: rotated`);
    } catch (e) {
      writeAtomic(rotationFile(ctx.dir, agent), stableJson({ at: ctx.now().toISOString(), ok: false, error: (e as Error).message.slice(0, 400) }));
      ctx.log(`${agent}: the panel's request ${request.requestId} for new credentials was not done: ${(e as Error).message.slice(0, 300)}`);
    }
  }
  return done;
}

/** For a test, and for a deployer that is stopping: wait for the crash tests the panel started. */
export const crashTestsRunning = (): Promise<void[]> => Promise.all(running.values());
