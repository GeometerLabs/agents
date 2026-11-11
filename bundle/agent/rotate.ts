// `geometer agent rotate <agent> [--guard <kind>] [--overlap-minutes N]`: a new credential for one Guard of an own agent, or for each, with an overlap so the running agent
// does not fail mid-call; and the deployer's job that ends each overlap (finishRotations, run from apply.ts runDueJobs). The panel's "New credentials" button asks for the
// same through a request file (agent/requests.ts). Nothing here prints or logs a credential: the new ones reach the agent through its file (agent/credentials.ts).
//
// The order is the point (each step is in the state file before the next is done, so a run that stops half-way leaves nothing the agent depends on half-made):
//   1. the old credential's sha256 and the end of its overlap go into state.agents[name].credentials[kind].previous;
//   2. a new credential is written to that Guard's file (the agent's file, credentials.env, is NOT touched yet);
//   3. the checked deploy runs with both hashes in guard.toml, the old one first, and the running Guards READ IT AGAIN (POST /admin/reload) rather than restart;
//   4. only when every Guard is running what was checked does credentials.env change: the agent can only ever pick up a credential its Guard takes;
//   5. each rotated Guard is told to retire the old credential at the end of the overlap (POST /admin/credentials/retire-static with after_seconds), so Guard's own clock
//      revokes it even if the deployer is not running then;
//   6. later, the deployer drops the old hash from guard.toml (finishRotations). A failure in 2 to 4 puts the old credential back in the Guard's file and forgets the rotation.
// Guard is not changed for this: same-id entries side by side and retire-static are its rotation (monorepo ADR-0041, item 4).
import type { Context } from "../deploy.ts";
import { Refused, adminCall } from "../deploy.ts";
import { names } from "../generate/shop.ts";
import { loadServer } from "../lib/server.ts";
import { loadState, saveState } from "../lib/state.ts";
import type { AgentCredentialState } from "../lib/state.ts";
import { writeSecretFile } from "../lib/secrets.ts";
import { updateStatus } from "../lib/status.ts";
import { mintGuardToken } from "../lib/util.ts";
import { SHARED_ENV_NAME, credentialEnvName, credentialFile, credentialHash, credentialStatusOf, credentialsEnvShown, ensureAgentCredentials, readAgentCredentials, sharesOneCredential, writeCredentialsEnv } from "./credentials.ts";
import { deployAgent } from "./deploy.ts";
import { readAgent } from "./folder.ts";
import { agentNames } from "./plan.ts";

/**
 * How long an old credential keeps working after a rotation, unless --overlap-minutes says otherwise. Fifteen minutes covers a call in flight, a refund held for the owner
 * that the agent sends again every few minutes, and an agent that re-reads its file on each call or is restarted to load it. 0 ends the old one at once (a credential that
 * leaked); up to a day for an agent that runs elsewhere and has its file copied over by hand.
 */
export const ROTATION_OVERLAP_MINUTES = 15;
export const MAX_OVERLAP_MINUTES = 24 * 60;

export interface Rotated { agent: string; guards: string[]; overlapUntil: string | null; lines: string[] }

/** When an overlap still running ends, if one is: a Guard is not rotated twice at once (the retire call retires the FIRST entry with the agent's id). */
const openOverlap = (c: AgentCredentialState | undefined): string | undefined => c?.previous?.until;

export async function rotateAgent(ctx: Context, name: string, o: { guard?: string; overlapMinutes?: number } = {}): Promise<Rotated> {
  const folder = readAgent(ctx.dir, name);
  if (!folder.agent) throw new Error(`${name}'s folder cannot be read, so its Guards are not known: ${folder.problems.join(" ")}`);
  const kinds = folder.agent.upstreams;
  if (o.guard !== undefined && !kinds.includes(o.guard)) throw new Error(`${name} has no ${o.guard} Guard. Its Guards are: ${kinds.join(", ")}.`);
  const chosen = o.guard !== undefined ? [o.guard] : [...kinds];
  const overlap = o.overlapMinutes ?? ROTATION_OVERLAP_MINUTES;
  if (!Number.isInteger(overlap) || overlap < 0 || overlap > MAX_OVERLAP_MINUTES) throw new Error(`--overlap-minutes must be a whole number of minutes from 0 to ${MAX_OVERLAP_MINUTES} (a day).`);
  const server = loadServer(ctx.dir);
  const before = readAgentCredentials(ctx.dir, name, kinds);
  const wasShared = sharesOneCredential(before);
  const state = loadState(ctx.dir);
  const a = state.agents?.[name];
  const at = ctx.now();

  // Nothing runs yet: no Guard has a hash to keep, so new credentials are all there is to it (no overlap, no deploy)
  if (!a?.applied) {
    for (const k of chosen) writeSecretFile(credentialFile(ctx.dir, name, k), mintGuardToken());
    const tokens = ensureAgentCredentials(ctx.dir, name, kinds);
    writeCredentialsEnv(ctx.dir, server, name, tokens);
    if (a) { a.credentials ??= {}; for (const k of chosen) a.credentials[k] = { since: at.toISOString() }; saveState(ctx.dir, state); }
    return { agent: name, guards: chosen, overlapUntil: null, lines: [`${name} is not deployed, so no Guard knew its old credentials: ${chosen.length === 1 ? "the" : "each"} new one is in ${credentialsEnvShown(name)} (${chosen.map(credentialEnvName).join(", ")}), and the next deploy gives it to the Guard${chosen.length === 1 ? "" : "s"}.`] };
  }
  const busy = chosen.filter((k) => openOverlap(a.credentials?.[k]) !== undefined);
  if (busy.length > 0) throw new Error(`${busy.map((k) => `The ${k} credential was rotated already; its old one keeps working until ${a.credentials![k].previous!.until}`).join(". ")}. Rotate it again after that: the deployer ends the overlap by itself.`);

  // 1. the old credentials' hashes, and when they stop, in the state file before anything else
  const until = new Date(at.getTime() + overlap * 60_000).toISOString();
  const was: Record<string, AgentCredentialState | undefined> = {};
  a.credentials ??= {};
  for (const k of chosen) {
    was[k] = a.credentials[k];
    // a Guard with no credential yet (its kind was added since the last deploy) has nothing old to keep
    a.credentials[k] = { since: at.toISOString(), ...(before[k] ? { previous: { sha256: credentialHash(before[k]), until } } : {}) };
  }
  saveState(ctx.dir, state);
  // 2. the new credentials, in the Guards' files only
  for (const k of chosen) writeSecretFile(credentialFile(ctx.dir, name, k), mintGuardToken());
  // 3 and 4. the checked deploy with both hashes, Guards reloaded; it writes credentials.env only once every Guard runs what was checked
  try {
    await deployAgent(ctx, name, { reloadGuards: true });
  } catch (e) {
    // put the old credentials back and forget the rotation: the agent's file never changed, so its credentials still work everywhere
    for (const k of chosen) if (before[k]) writeSecretFile(credentialFile(ctx.dir, name, k), before[k]);
    const fresh = loadState(ctx.dir);
    const c = (fresh.agents![name].credentials ??= {});
    for (const k of chosen) { if (was[k]) c[k] = was[k]!; else delete c[k]; }
    saveState(ctx.dir, fresh);
    const why = e instanceof Refused ? e.problems.map((p) => `[${p.rule}] ${p.message}`).join(" ") : (e as Error).message;
    throw new Error(`The rotation of ${name} was not done, and nothing changed for the agent: its file still holds the credentials it has, and they still work. Why: ${why}`);
  }
  // 5. Guard's own clock ends each old credential when the overlap does (the old entry is first in guard.toml, so it is the one retired)
  const fresh = loadState(ctx.dir);
  const notTold: string[] = [];
  for (const k of chosen) {
    const r = await adminCall(ctx, names.guard(name, k), "POST", "/admin/credentials/retire-static", { kind: "agent", subject: agentNames.agentId(name), after_seconds: overlap * 60 });
    const p = fresh.agents![name].credentials?.[k]?.previous;
    if (r.status === 200 && p) p.retired = true; else notTold.push(k);
  }
  saveState(ctx.dir, fresh);
  writeStatusCredentials(ctx, name);
  const lines = [
    `${name}: a new credential for ${chosen.length === 1 ? `its ${chosen[0]} Guard` : `each of its ${chosen.length} Guards`}. ${chosen.length === 1 ? "It is" : "They are"} in ${credentialsEnvShown(name)} (${chosen.map(credentialEnvName).join(", ")}); nothing was printed.`,
    overlap === 0
      ? `The old ${chosen.length === 1 ? "one stops" : "ones stop"} working now: your agent fails at ${chosen.length === 1 ? "that Guard" : "those Guards"} until it reads the file again.`
      : `The old ${chosen.length === 1 ? "one keeps" : "ones keep"} working for ${overlap} minutes, until ${until}, and then ${chosen.length === 1 ? "stops" : "stop"} at the Guard itself. Before then your agent must read the file again (an agent that reads it on each call needs nothing; one that loads it at the start needs a restart; one that runs elsewhere needs the file copied there).`,
    ...(wasShared && !sharesOneCredential(readAgentCredentials(ctx.dir, name, kinds)) ? [`${name}'s Guards no longer share one credential, so ${SHARED_ENV_NAME} is gone from the file: your agent must send each Guard its own (${kinds.map(credentialEnvName).join(", ")}).`] : []),
    ...(notTold.length > 0 ? [`note: ${notTold.join(", ")}'s Guard did not take the instruction to retire the old credential at ${until}; the deployer retires it then, and drops it from the Guard's configuration.`] : []),
  ];
  return { agent: name, guards: chosen, overlapUntil: overlap === 0 ? null : until, lines };
}

/** How long the deployer waits before trying again to drop an old credential from guard.toml after that deploy failed. */
export const FINISH_RETRY_MS = 10 * 60_000;

/**
 * The deployer's half (apply.ts runDueJobs, every pass; it only reads the state file unless an overlap is over): for each Guard whose old credential's time has come,
 * tell Guard to retire it now (again, even if it was told at the rotation: a store put back by `restore` may have lost that; harmless otherwise), while the old entry is still
 * FIRST in guard.toml, so the call cannot retire the new one; then drop it from the state and deploy, so guard.toml no longer lists it. A deploy that fails puts the old hash
 * back in the state (it is still in the Guard's file, retired) and is tried again after FINISH_RETRY_MS.
 */
export async function finishRotations(ctx: Context): Promise<string[]> {
  const lines: string[] = [];
  const now = ctx.now().getTime();
  for (const [name, a] of Object.entries(loadState(ctx.dir).agents ?? {})) {
    const due = Object.entries(a.credentials ?? {}).filter(([, c]) => c.previous && Date.parse(c.previous.until) <= now && !(c.previous.retryAfter && Date.parse(c.previous.retryAfter) > now)).map(([k]) => k);
    if (due.length === 0 || !a.applied) continue;
    const ready: string[] = [];
    for (const k of due) {
      const r = await adminCall(ctx, names.guard(name, k), "POST", "/admin/credentials/retire-static", { kind: "agent", subject: agentNames.agentId(name), after_seconds: 0 });
      if (r.status === 200) ready.push(k); else lines.push(`${name}: the ${k} Guard did not take the instruction to retire the old credential (HTTP ${r.status}); it is asked again on the next pass.`);
    }
    if (ready.length === 0) continue;
    const kept: Record<string, NonNullable<AgentCredentialState["previous"]>> = {};
    const st = loadState(ctx.dir);
    for (const k of ready) { kept[k] = st.agents![name].credentials![k].previous!; delete st.agents![name].credentials![k].previous; }
    saveState(ctx.dir, st);
    try {
      await deployAgent(ctx, name, { reloadGuards: true });
      writeStatusCredentials(ctx, name);
      lines.push(`${name}: the old ${ready.join(", ")} credential${ready.length === 1 ? " has" : "s have"} ended, and ${ready.length === 1 ? "is" : "are"} no longer in the Guard's configuration.`);
    } catch (e) {
      // the old hash is still in the Guard's file (retired at the Guard): keep it in the state, so the next try still lists it first, and try again later
      const back = loadState(ctx.dir);
      for (const k of ready) { const c = back.agents?.[name]?.credentials?.[k]; if (c) c.previous = { ...kept[k], retired: true, retryAfter: new Date(now + FINISH_RETRY_MS).toISOString() }; }
      saveState(ctx.dir, back);
      lines.push(`${name}: the old ${ready.join(", ")} credential${ready.length === 1 ? " has" : "s have"} ended at the Guard, but the deploy that drops ${ready.length === 1 ? "it" : "them"} from guard.toml did not go through (${(e as Error).message.slice(0, 200)}). It is tried again in ${FINISH_RETRY_MS / 60_000} minutes.`);
    }
  }
  return lines;
}

/** What the panel shows about each Guard's credential (status/<agent>.json `own.credentials`), after a rotation or the end of an overlap. Never a credential or a hash. */
export function writeStatusCredentials(ctx: Context, name: string): void {
  const c = loadState(ctx.dir).agents?.[name]?.credentials;
  const tokens = readAgentCredentials(ctx.dir, name, readAgent(ctx.dir, name).agent?.upstreams ?? Object.keys(c ?? {}));
  updateStatus(ctx.dir, name, ctx.now(), (s) => { if (s.own) s.own.credentials = credentialStatusOf(c, tokens); }, false);
}
