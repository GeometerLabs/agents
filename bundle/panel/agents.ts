// Own agents in the panel (B51's rest, 12 Nov 2026): what a builder sees of each agent they wrote, beside the shops, and the three things they may ask for from here (stop,
// a new crash test, new credentials). The panel has no agents/ folder and no state file: everything comes from files the deployer writes for it (status/<agent>.json with its
// `own` block, exports/<agent>/: the record, the last crash test, the version in service, the last rotation), and every action is a request file with a name and an id that
// the deployer carries out (bundle/agent/requests.ts, apply.ts processStopRequests). Nothing the panel writes reaches a command line. Builders only: a partner never sees an
// own agent, and to them the address is a 404 like any shop that is not theirs.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { obligations, DEFAULT_OPTIONS } from "../../modules/unfinished/index.ts";
import type { CaseLike, Obligation, UnfinishedOptions } from "../../modules/unfinished/index.ts";
import type { Account } from "./accounts.ts";
import { casesOf, readExport } from "./activity.ts";
import type { PanelConfig } from "./config.ts";
import { SHOP_ID, liveView, parseStatus, parseStopRequest, serverPaths } from "./contract.ts";
import type { LiveView, ShopStatus, StopRequest } from "./contract.ts";

/** One Guard of an own agent, as the panel shows it: its kind, its address, and its credential's dates (never the credential). */
export interface AgentGuard { kind: string; url: string; since?: string; oldUntil?: string }

/** The last crash test, as exports/<agent>/crash-test.json holds it (bundle/agent/requests.ts CrashSummary): counts and titles only. */
export interface AgentCrash { at: string; version: string | null; held: number; of: number; failed: string[]; notRun: string[]; goLive: boolean; running?: boolean; error?: string; by?: string }

export interface AgentView {
  id: string;
  live: LiveView;
  status?: ShopStatus;
  guards: AgentGuard[];
  /** Every Guard still takes the one credential made before 12 Nov 2026. */
  sharedCredential: boolean;
  held?: { calls: number; at: string };
  unfinished: { asOf?: string; items: Obligation[]; failed: string[] };
  crash?: AgentCrash;
  inService?: { version: string | null; at: string; held: number; of: number; code: string };
  rotation?: { at: string; ok: boolean; oldUntil?: string | null };
  asked: { stop?: StopRequest; crashTest: boolean; rotate: boolean };
}

const isObj = (v: unknown): v is Record<string, any> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number): string | undefined => (typeof v === "string" && v.length > 0 && v.length <= max ? v : undefined);
const whole = (v: unknown): number | undefined => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : undefined);
const iso = (v: unknown): string | undefined => (typeof v === "string" && Number.isFinite(Date.parse(v)) ? v : undefined);
const titles = (v: unknown): string[] => (Array.isArray(v) ? v.filter((t): t is string => typeof t === "string" && t.length <= 200).slice(0, 30) : []);

export function createAgents(config: PanelConfig) {
  const paths = serverPaths(config.serverDir);
  const now = () => (config.now ?? Date.now)();
  const requests = join(paths.root, "requests");
  const read = (file: string): string | undefined => { try { return readFileSync(file, "utf8"); } catch { return undefined; } };
  const json = (file: string): unknown => { const t = read(file); if (t === undefined) return undefined; try { return JSON.parse(t); } catch { return undefined; } };
  const safe = (id: string): string => { if (!SHOP_ID.test(id)) throw new Error("not an agent id"); return id; };
  const crashFile = (id: string) => join(requests, `${safe(id)}.crash-test.json`);
  const rotateFile = (id: string) => join(requests, `${safe(id)}.rotate.json`);

  /** The status file's `own` block, checked: an agent someone else wrote is a status file that has one (shops never do). */
  const ownOf = (id: string): Record<string, any> | undefined => { const raw = json(paths.statusFile(id)); return isObj(raw) && isObj(raw.own) && isObj(raw.own.baseUrls) ? raw.own : undefined; };

  const write = (file: string, body: unknown) => {
    mkdirSync(requests, { recursive: true });
    const tmp = join(requests, `.${randomBytes(6).toString("hex")}.tmp`);
    writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o644 });
    renameSync(tmp, file);
  };
  const request = (id: string, account: Account, extra: Record<string, string> = {}) => ({ schema: 1, requestId: randomBytes(8).toString("hex"), agent: id, requestedAt: new Date(now()).toISOString(), requestedBy: { id: account.id, name: account.name, role: account.role }, ...extra });

  const api = {
    /** Every own agent on this server, by id (a status file with an `own` block and no shop folder of the same name). Builders only. */
    ids(account: Account): string[] {
      if (account.role !== "builder") return [];
      const dir = join(paths.root, "status");
      if (!existsSync(dir)) return [];
      return readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).filter((id) => SHOP_ID.test(id) && !existsSync(paths.shop(id)) && ownOf(id) !== undefined).sort();
    },
    /** The one rule, as shops.find: an agent the account may not see is undefined, and the caller answers 404. */
    find(account: Account, id: string): string | undefined { return account.role === "builder" && SHOP_ID.test(id) && !existsSync(paths.shop(id)) && ownOf(id) ? id : undefined; },

    view(id: string, staleMs: number, options: UnfinishedOptions = DEFAULT_OPTIONS): AgentView {
      const read0 = parseStatus(read(paths.statusFile(safe(id))));
      const own = ownOf(id) ?? {};
      const stop = parseStopRequest(read(paths.stopFile(id)));
      const credentials = isObj(own.credentials) && isObj(own.credentials.guards) ? own.credentials.guards as Record<string, unknown> : {};
      const guards: AgentGuard[] = Object.entries(own.baseUrls as Record<string, unknown>).flatMap(([kind, url]) => {
        if (!/^[a-z][a-z0-9-]{0,30}$/u.test(kind) || !str(url, 300)) return [];
        const c = isObj(credentials[kind]) ? credentials[kind] as Record<string, unknown> : {};
        return [{ kind, url: url as string, ...(iso(c.since) ? { since: iso(c.since) } : {}), ...(iso(c.oldUntil) ? { oldUntil: iso(c.oldUntil) } : {}) }];
      });
      const heldCalls = isObj(own.held) && whole(own.held.calls) !== undefined && iso(own.held.at) ? { calls: own.held.calls as number, at: own.held.at as string } : undefined;
      // the unfinished-work list, the panel's own (modules/unfinished), from the record the deployer exports for the agent in Bookings' shape (agent/record.ts)
      const dir = paths.exports(id);
      const data = readExport(dir);
      const found = data ? obligations.detect({ template: "bookings", entries: data.entries, cases: casesOf(data, "bookings") as unknown as CaseLike[], nowMs: now(), options }) : { found: [], failed: [] };
      const recordFile = join(dir, "record.json");
      const c = json(join(dir, "crash-test.json"));
      const crash: AgentCrash | undefined = isObj(c) && iso(c.at) ? {
        at: c.at, version: typeof c.version === "string" ? c.version.slice(0, 64) : null, held: whole(c.held) ?? 0, of: whole(c.of) ?? 0, failed: titles(c.failed), notRun: titles(c.notRun), goLive: c.goLive === true,
        ...(c.running === true ? { running: true } : {}), ...(str(c.error, 400) ? { error: c.error } : {}), ...(str(c.by, 200) ? { by: c.by } : {}),
      } : undefined;
      const s = json(join(dir, "in-service.json"));
      const inService = isObj(s) && iso(s.at) && str(s.code, 80) ? { version: typeof s.version === "string" ? s.version.slice(0, 64) : null, at: s.at, held: whole(s.held) ?? 0, of: whole(s.of) ?? 0, code: s.code } : undefined;
      const r = json(join(dir, "rotation.json"));
      const rotation = isObj(r) && iso(r.at) ? { at: r.at, ok: r.ok === true, ...(iso(r.oldUntil) ? { oldUntil: r.oldUntil } : {}) } : undefined;
      return {
        id, live: liveView(read0, stop, undefined, now(), staleMs), ...(read0.ok ? { status: read0.status } : {}), guards,
        sharedCredential: isObj(own.credentials) && own.credentials.shared === true, ...(heldCalls ? { held: heldCalls } : {}),
        unfinished: { ...(data && existsSync(recordFile) ? { asOf: new Date(statSync(recordFile).mtimeMs).toISOString() } : {}), items: found.found, failed: found.failed },
        ...(crash ? { crash } : {}), ...(inService ? { inService } : {}), ...(rotation ? { rotation } : {}),
        asked: { ...(stop ? { stop } : {}), crashTest: existsSync(crashFile(id)), rotate: existsSync(rotateFile(id)) },
      };
    },

    /** Ask for a new crash test. One request at a time: asking again while one waits changes nothing. */
    requestCrashTest(id: string, account: Account): void { if (!existsSync(crashFile(id))) write(crashFile(id), request(id, account)); },
    /** Ask for new credentials at every Guard, or at one (its kind, which must be one of the agent's). */
    requestRotate(id: string, account: Account, guard?: string): boolean {
      if (guard !== undefined && !(isObj(ownOf(id)?.baseUrls) && Object.hasOwn(ownOf(id)!.baseUrls, guard))) return false;
      if (!existsSync(rotateFile(id))) write(rotateFile(id), request(id, account, guard ? { guard } : {}));
      return true;
    },
  };
  return api;
}

export type Agents = ReturnType<typeof createAgents>;
