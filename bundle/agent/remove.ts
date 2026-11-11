// `geometer agent remove <agent> [--force]` (B51's rest, 12 Nov 2026): take an agent someone else wrote off this server. Used by the command line only: the panel has no
// remove button, because removing is not something to do from a phone in passing.
//
// What it does, in this order (each step is safe to find half-done: the folder is moved out of agents/ before anything else, so the deployer's loop cannot deploy it again):
//   1. asks the agent's Guards, fresh, what is still open: a call held for the owner, one the owner approved that the agent has not sent again, an effect whose outcome is
//      not known yet; and reads the unfinished-work list from its record (the same list the panel shows). Anything open, or a Guard that cannot be asked, refuses the
//      removal unless --force, which says plainly what stays open;
//   2. pulls the kill switch on its Guards, so nothing new goes out while it is taken down;
//   3. moves what it keeps into removed/<agent>-<time>/ (agents/<agent>/, its state entry, status file, record and exports) and leaves a tombstone in the state file, so
//      the name and its network index are not given to anything else while its Guards' stores are kept; drops any panel request for it that is still waiting;
//   4. revokes its credentials: every credential the bundle made for it is deleted (the agent's own, the reading agent's, the relay's, the admin ones, the desk's, the
//      owner's signing secret's copies), before anything that could fail;
//   5. writes down what it kept and where (README.txt in the kept folder);
//   6. writes the server's configuration without it and brings that up: its Guards and their forwarders are taken down, the inbox, relay, refresher and ops forget it. A
//      server that cannot bring it up is said in words (`geometer deploy` finishes it), with steps 1 to 5 already done. NOTHING ELSE IS DELETED: the shop's own keys, its fingerprint key, its Guards' stores (Docker volumes) and its nightly snapshots stay
//      until the builder deletes them, by hand, knowing what they are.
// Geometer does not run the agent itself (it runs wherever its builder runs it), so it cannot stop it: from now on its calls to the old addresses get errors.
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { Context } from "../deploy.ts";
import { Refused, adminCall, bringUp, ops, writeServer } from "../deploy.ts";
import { project } from "../backup/jobs.ts";
import { names } from "../generate/shop.ts";
import { DESK_SECRET, OWNER_MARKED_KINDS } from "../generate/guards.ts";
import { loadServer, serverPaths } from "../lib/server.ts";
import { loadState, saveState } from "../lib/state.ts";
import { secretFile } from "../lib/secrets.ts";
import { stableJson } from "../lib/util.ts";
import { OWN_API, isGatewayKind } from "../../modules/payments/providers/index.ts";
import { obligations, DEFAULT_OPTIONS } from "../../modules/unfinished/index.ts";
import type { CaseLike } from "../../modules/unfinished/index.ts";
import { readExport, casesOf } from "../panel/activity.ts";
import { HEALTH_WORDS } from "../panel/words-health.ts";
import { credentialsFolder } from "./credentials.ts";
import { recordAgent, recordFile } from "./records.ts";

/** An effect Guard sent, or was about to, whose outcome it has not recorded: the agent's refund may or may not have gone. */
const UNSETTLED = new Set(["received", "reserved", "dispatched", "outcome_unknown"]);

export interface OpenWork {
  /** Calls held for the owner, approved and not yet sent again, or with an outcome not known yet, in plain words. */
  held: string[];
  /** The unfinished-work list (modules/unfinished), from the record as last exported, in plain words. */
  unfinished: string[];
  /** Guards that could not be asked, so nothing can be said about what they hold. */
  notAsked: string[];
}

const list = (body: unknown, key: string): Record<string, unknown>[] | undefined => {
  const v = typeof body === "object" && body !== null ? (body as Record<string, unknown>)[key] : undefined;
  return Array.isArray(v) ? v as Record<string, unknown>[] : undefined;
};

/** What is still open for an agent, asked of its running Guards now and read from its record. Nothing is changed. */
export async function openWorkOf(ctx: Context, name: string): Promise<OpenWork> {
  const a = loadState(ctx.dir).agents?.[name];
  const out: OpenWork = { held: [], unfinished: [], notAsked: [] };
  const now = ctx.now().getTime();
  if (a?.applied) {
    for (const g of Object.values(a.applied.guards)) {
      // a Guard that holds calls for the owner: a gateway's (refunds), or the agent's own API's (B71 part 2)
      if (isGatewayKind(g.kind) || g.kind === OWN_API) {
        const r = await adminCall(ctx, g.service, "GET", "/admin/approvals");
        const approvals = r.status === 200 ? list(r.body, "approvals") : undefined;
        if (!approvals) { out.notAsked.push(g.service); continue; }
        for (const ap of approvals) {
          if (ap.state === "pending" && Number(ap.expires_at_ms) > now) out.held.push(`${g.kind}: a ${String(ap.operation)} is held for the owner (Guard's request ${String(ap.id)})`);
          if (ap.state === "approved" && !ap.consumed_by && Number(ap.expires_at_ms) > now) out.held.push(`${g.kind}: the owner approved a ${String(ap.operation)} that the agent has not sent again yet (Guard's request ${String(ap.id)})`);
        }
      }
      const i = await adminCall(ctx, g.service, "GET", "/admin/intents");
      const intents = i.status === 200 ? list(i.body, "intents") : undefined;
      if (!intents) { if (!out.notAsked.includes(g.service)) out.notAsked.push(g.service); continue; }
      for (const it of intents) if (UNSETTLED.has(String(it.state))) out.held.push(`${g.kind}: a ${String(it.operation)} whose outcome Guard does not know yet (${String(it.state).replace("_", " ")})`);
    }
    // the record is brought up to date first, so the list below is today's; if the Guards cannot be read, the last export is used and its age said
    await recordAgent(ctx, name).catch(() => undefined);
  }
  const dir = serverPaths(ctx.dir).exportsOf(name);
  const data = readExport(dir);
  if (data) {
    const { found } = obligations.detect({ template: "bookings", entries: data.entries, cases: casesOf(data, "bookings") as unknown as CaseLike[], nowMs: now, options: DEFAULT_OPTIONS });
    const words = HEALTH_WORDS.en.attention.kind;
    const age = existsSync(join(dir, "record.json")) ? ` (record as of ${new Date(statSync(join(dir, "record.json")).mtimeMs).toISOString()})` : "";
    out.unfinished.push(...found.map((o) => `${Object.hasOwn(words, o.kind) ? words[o.kind] : o.kind}: ${o.caseId}${age}`));
  }
  return out;
}

export interface Removed { agent: string; keptIn: string; lines: string[] }

/** Take the agent off this server. Throws, with what is open, before anything is changed, unless `force`. */
export async function removeAgent(ctx: Context, name: string, o: { force?: boolean } = {}): Promise<Removed> {
  const p = serverPaths(ctx.dir);
  const state0 = loadState(ctx.dir);
  if (!existsSync(p.agent(name)) && !state0.agents?.[name]) throw new Error(state0.removed?.[name] ? `${name} was removed already, on ${state0.removed[name].at.slice(0, 10)}: what it kept is in ${state0.removed[name].keptIn}.` : `There is no agent called ${name} on this server.`);
  const open = await openWorkOf(ctx, name);
  const openLines = [...open.held, ...open.unfinished, ...open.notAsked.map((s) => `${s} could not be asked whether it holds a call for the owner (is the server up?)`)];
  if (openLines.length > 0 && !o.force) {
    throw new Error(`${name} was not removed, and nothing was changed. This is still open:\n${openLines.map((l) => `  - ${l}`).join("\n")}\nFinish it first (the owner answers on WhatsApp; the panel's to-do list has the rest), then run this again. Or say --force to remove it anyway: what is open then stays open, and nothing on this server will finish it.`);
  }
  const lines: string[] = [];
  if (openLines.length > 0) lines.push(`WARNING: ${name} is being removed with this still open. Nothing on this server will finish it: a held call is never made, the owner's answer reaches nothing, and an unfinished item is left for you to settle with the owner by hand.\n${openLines.map((l) => `  - ${l}`).join("\n")}`);

  const server = loadServer(ctx.dir);
  const at = ctx.now();
  const stamp = at.toISOString().replace(/[-:]|\.\d{3}/gu, "");
  const kept = join(p.root, "removed", `${name}-${stamp}`);
  mkdirSync(kept, { recursive: true, mode: 0o700 });
  const a = state0.agents?.[name];

  // 2. nothing new goes out from its Guards while they are taken down (a Guard that cannot be reached is about to be removed anyway)
  if (a?.applied) await ops(ctx, ["stop", name, "on", "the deployer", "being removed from this server (geometer agent remove)"]).catch(() => undefined);

  // 3. what it keeps, out of the places the deployer and the panel look; the folder first, so the deployer's loop cannot deploy it again
  const move = (from: string, to: string): boolean => { if (!existsSync(from)) return false; renameSync(from, join(kept, to)); return true; };
  move(p.agent(name), "agent");
  writeFileSync(join(kept, "state.json"), stableJson(a ?? null), { mode: 0o600 });
  const state = loadState(ctx.dir);
  if (a?.applied || a?.lastDeployAt) (state.removed ??= {})[name] = { at: at.toISOString(), keptIn: relative(p.root, kept), index: a!.index };
  if (state.agents) { delete state.agents[name]; if (Object.keys(state.agents).length === 0) delete state.agents; }
  saveState(ctx.dir, state);
  move(p.statusFile(name), "status.json");
  move(p.exportsOf(name), "exports");
  move(recordFile(ctx.dir, name), "record.json");

  // what the panel asked for it and has not been carried out: nothing of it will run again (a stop for it would otherwise be read as a shop's)
  if (existsSync(p.requests)) for (const f of readdirSync(p.requests).filter((x) => x.startsWith(`${name}.`))) rmSync(join(p.requests, f), { force: true });

  // 4. its credentials: every one the bundle made for it. Before the configuration is brought up, so a server that cannot bring it up still leaves none of them on disk
  const guardsOf = Object.values(a?.applied?.guards ?? {});
  const revoked = [
    credentialsFolder(ctx.dir, name),
    secretFile(ctx.dir, "relay", name),
    ...["record_token", ...guardsOf.map((g) => `admin_${g.kind}`)].map((f) => secretFile(ctx.dir, "ops", name, f)),
    secretFile(ctx.dir, "inbox", name, "relay_token"),
    secretFile(ctx.dir, "refresher", name, "admin_token"),
    ...guardsOf.flatMap((g) => [secretFile(ctx.dir, g.service, "owner_notify_secret"), secretFile(ctx.dir, g.service, DESK_SECRET)]),
  ].filter((f) => existsSync(f));
  for (const f of revoked) rmSync(f, { recursive: true, force: true });

  // 5. what is kept, and where, written down before anything that could fail
  const keptSecrets = keptSecretFiles(ctx.dir, name, guardsOf.map((g) => g.service));
  const volumes = guardsOf.map((g) => `${project(server)}_${names.stateVolume(name, g.kind as "razorpay")}`);
  const snapshot = server.backup ? `${server.backup.snapshots.url.replace(/\/+$/u, "")}/${name}/${a?.lastBackupAt ? ` (the last one taken ${a.lastBackupAt})` : " (no snapshot was taken yet)"}` : undefined;
  const readme = [
    `${name}, removed from this server at ${at.toISOString()} by \`geometer agent remove\`${openLines.length > 0 ? " --force, with work still open (below)" : ""}.`,
    "",
    "Kept here:",
    "  agent/        its agent.json and settings.json (and its own gateway's reviewed rules, if it had them)",
    "  state.json    what the deployer knew of it: its Guards as applied, the version in service, its backups",
    "  status.json   what the panel showed",
    "  record.json   its record, built from its Guards' decisions and the services' own state (0600)",
    "  exports/      the record and certificates the monthly report read",
    "",
    "Kept elsewhere on this server (nothing reads them now; delete them only when you are sure you no longer need them):",
    ...keptSecrets.map((f) => `  ${f}`),
    ...volumes.map((v) => `  Docker volume ${v}  (a Guard's store: its decisions, held calls and once-only memory)`),
    ...(guardsOf.some((g) => OWNER_MARKED_KINDS.includes(g.kind)) ? [`  The desk's ledger (what the owner marked received, refunds owed): state/${name}/desk.json in the relay's Docker volume`] : []),
    ...(snapshot ? [`  Nightly snapshots: ${snapshot}. The bucket's own lifecycle rule deletes them after its days (keepDays: ${server.backup!.snapshots.keepDays ?? 30}), as for any snapshot: download what you want to keep longer.`] : []),
    "",
    "Revoked (their files are deleted, and the Guards that took them are taken down):",
    ...revoked.map((f) => `  ${relative(p.root, f)}`),
    ...(openLines.length > 0 ? ["", "Open when it was removed:", ...openLines.map((l) => `  - ${l}`)] : []),
    "",
    `The agent itself runs wherever you run it; Geometer cannot stop it. Its calls to the old addresses now get errors. The name ${name} stays taken while state/state.json lists it under "removed" (its Guards' kept stores carry the name).`,
  ].join("\n");
  writeFileSync(join(kept, "README.txt"), `${readme}\n`, { mode: 0o600 });

  // 6. the server without it: its Guards and forwarders are orphans now, and `up --remove-orphans` takes them down; the services that served it are restarted with their new files
  let downProblem: string | undefined;
  if (a?.applied) {
    try {
      const composed = writeServer(ctx, server, state);
      await bringUp(ctx, state, composed, [`the server without ${name}`]);
      for (const g of guardsOf) rmSync(join(p.generated, "guards", g.service), { recursive: true, force: true });
    } catch (e) {
      downProblem = e instanceof Refused ? e.problems.map((x) => x.message).join(" ") : (e as Error).message;
    }
  }

  lines.push(
    downProblem
      ? `${name} is taken off this server's configuration and its credentials are deleted, but its Guards could not be taken down (${downProblem.slice(0, 300)}). Their kill switch was pulled first. \`geometer deploy\` takes them down when the server answers.`
      : `${name} is removed: its Guards are stopped and gone from this server's configuration, and its credentials are revoked.`,
    `Kept, not deleted: ${relative(p.root, kept)}/ (its settings, record, exports and what the deployer knew; README.txt there lists everything)${volumes.length > 0 ? `, its Guards' stores (Docker volumes ${volumes.join(", ")})` : ""}${keptSecrets.length > 0 ? `, the shop's own keys and its fingerprint key (${keptSecrets.length} files under secrets/)` : ""}${snapshot ? `, and its nightly snapshots (${snapshot}; the bucket's lifecycle rule deletes them after ${server.backup!.snapshots.keepDays ?? 30} days)` : ""}.`,
    `Nothing else was deleted. Your agent still runs wherever you run it: stop it there. Geometer's heartbeat stops reporting it from the next minute. The name ${name} stays taken while state/state.json lists it under "removed".`,
  );
  return { agent: name, keptIn: relative(p.root, kept), lines };
}

/** The files under secrets/ that remove leaves in place: the shop's own keys (handed in), its fingerprint key and the label key derived from it. Relative to the server folder. */
function keptSecretFiles(dir: string, name: string, services: string[]): string[] {
  const root = serverPaths(dir).root;
  const folders = [...services.map((s) => secretFile(dir, s)), secretFile(dir, "inbox", name), secretFile(dir, "refresher", name), secretFile(dir, "ops", name)];
  const files = folders.flatMap((f) => (existsSync(f) ? readdirSync(f).map((x) => join(f, x)) : []));
  return [...files, secretFile(dir, "person-keys", name)].filter((f) => existsSync(f)).map((f) => relative(root, f));
}
