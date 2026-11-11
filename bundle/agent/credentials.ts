// An own agent's credentials (B51's rest, 12 Nov 2026): one per Guard, and the one file that hands them to the agent. Used by `agent add`, the agent's deploy
// (agent/deploy.ts), `agent rotate` (agent/rotate.ts), `agent remove` (agent/remove.ts) and the crash test (crash-test/run.ts), so the layout is said once, here.
//
//   secrets/agents/<name>/<kind>_token     the credential the builder's agent presents at that one Guard (Authorization: Bearer ...). The Guard keeps only its sha256
//                                          (guard.toml). One per Guard, so a credential that leaks from one place opens one service, and each can be rotated alone.
//   secrets/agents/<name>/credentials.env  THE way credentials reach the agent: GEOMETER_<KIND>_URL and GEOMETER_<KIND>_CREDENTIAL for each Guard, mode 0600, the
//                                          deployer's user's (the user the agent runs as on this server, README step 8). The agent loads it (`node --env-file=...`,
//                                          or `set -a; . file`), or reads it on each call (GEOMETER_CREDENTIALS_FILE names it), or the builder copies it to where the agent
//                                          runs. It is rewritten only once the Guards take what is in it. NOTHING PRINTS A CREDENTIAL: not add, show, rotate or remove.
//   secrets/agents/<name>/agent_token      an agent added before 12 Nov 2026 had ONE credential for all its Guards. Each Guard's file starts as a copy of it, so the agent
//                                          keeps working through the deploy that brings this in, and credentials.env keeps GEOMETER_CREDENTIAL while every Guard still
//                                          shares it. `agent rotate` gives each Guard its own; the old file is deleted once no Guard uses it.
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { agentBaseUrl } from "../generate/compose.ts";
import type { GuardKind } from "../generate/guards.ts";
import { readSecretFile, secretFile, writeSecretFile } from "../lib/secrets.ts";
import type { ServerConfig } from "../lib/server.ts";
import { mintGuardToken, sha256Hex, writeAtomic } from "../lib/util.ts";

/** The folder that holds an agent's credentials (never mounted into any container: only the deployer and the agent's own user read it). `agent remove` deletes it whole. */
export const credentialsFolder = (dir: string, name: string): string => secretFile(dir, "agents", name);
/** One Guard's credential file. */
export const credentialFile = (dir: string, name: string, kind: string): string => secretFile(dir, "agents", name, `${kind}_token`);
/** The file the agent reads its addresses and credentials from. */
export const credentialsEnvFile = (dir: string, name: string): string => secretFile(dir, "agents", name, "credentials.env");
/** The one shared credential of an agent added before 12 Nov 2026. */
export const legacyCredentialFile = (dir: string, name: string): string => secretFile(dir, "agents", name, "agent_token");

/** `own-api` becomes OWN_API: the shell's names take letters, digits and underscores. */
const envPart = (kind: string): string => kind.toUpperCase().replace(/[^A-Z0-9]/gu, "_");
/** The name the agent reads one Guard's credential under, e.g. GEOMETER_RAZORPAY_CREDENTIAL. */
export const credentialEnvName = (kind: string): string => `GEOMETER_${envPart(kind)}_CREDENTIAL`;
/** The name the agent reads one Guard's address under, e.g. GEOMETER_RAZORPAY_URL (the crash test uses the same names). */
export const urlEnvName = (kind: string): string => `GEOMETER_${envPart(kind)}_URL`;
/** The name of the shared credential (before 12 Nov 2026), written only while every Guard still has the same one. */
export const SHARED_ENV_NAME = "GEOMETER_CREDENTIAL";

/** The credentials an agent's Guards accept now, by kind, as read from the files. A kind with no file has none yet. */
export function readAgentCredentials(dir: string, name: string, kinds: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of kinds) { const t = readSecretFile(credentialFile(dir, name, k)) ?? readSecretFile(legacyCredentialFile(dir, name)); if (t) out[k] = t; }
  return out;
}

/**
 * Each Guard's credential, made when missing. An agent from before 12 Nov 2026 has agent_token: a Guard with no file of its own starts with a copy of it, so the agent's one
 * credential keeps working at every Guard (and at a Guard added later). Otherwise each Guard gets a new credential of its own.
 */
export function ensureAgentCredentials(dir: string, name: string, kinds: readonly string[]): Record<string, string> {
  const legacy = readSecretFile(legacyCredentialFile(dir, name));
  const out: Record<string, string> = {};
  for (const k of kinds) {
    const have = readSecretFile(credentialFile(dir, name, k));
    if (have) { out[k] = have; continue; }
    const made = legacy ?? mintGuardToken();
    writeSecretFile(credentialFile(dir, name, k), made);
    out[k] = made;
  }
  return out;
}

/** Whether every Guard still takes the same one credential (an agent from before 12 Nov 2026 that has not been rotated yet). One Guard alone shares nothing. */
export const sharesOneCredential = (tokens: Record<string, string>): boolean => Object.keys(tokens).length > 1 && new Set(Object.values(tokens)).size === 1;

/**
 * credentials.env: the addresses and the credentials, one pair per Guard, in the shell's KEY=value form (no quotes are needed: the values are URLs and gg_ tokens). Written
 * atomically, mode 0600, and only when it changes, so an agent that watches the file is not woken for nothing. Returns whether it changed.
 */
export function writeCredentialsEnv(dir: string, server: ServerConfig, name: string, tokens: Record<string, string>): boolean {
  const kinds = Object.keys(tokens);
  const lines = [
    `# ${name}: where this agent sends its calls, and the credential for each Guard. Written by Geometer; do not edit (\`geometer agent rotate ${name}\` changes it).`,
    "# Load it (node --env-file=<this file> ...), or read it on each call (GEOMETER_CREDENTIALS_FILE). Keep it private: each credential opens one of the shop's services.",
    ...kinds.flatMap((k) => [`${urlEnvName(k)}=${agentBaseUrl(server, name, k as GuardKind)}`, `${credentialEnvName(k)}=${tokens[k]}`]),
    // the one name an agent from before 12 Nov 2026 reads: kept only while it is true for every Guard
    ...(sharesOneCredential(tokens) || kinds.length === 1 ? [`${SHARED_ENV_NAME}=${tokens[kinds[0]]}`] : []),
  ];
  const text = `${lines.join("\n")}\n`;
  const path = credentialsEnvFile(dir, name);
  let before = "";
  try { before = readFileSync(path, "utf8"); } catch { /* the first time */ }
  if (before === text) return false;
  writeAtomic(path, text, 0o600);
  return true;
}

/** The shared credential's file, deleted once no Guard of the agent uses it any more (after every Guard has been rotated). */
export function dropUnusedLegacyCredential(dir: string, name: string, tokens: Record<string, string>): boolean {
  const legacy = readSecretFile(legacyCredentialFile(dir, name));
  if (legacy === undefined || Object.values(tokens).includes(legacy)) return false;
  rmSync(legacyCredentialFile(dir, name), { force: true });
  return true;
}

/**
 * The credentials block of status/<agent>.json (lib/status.ts ShopStatus.own.credentials) for the panel: whether the Guards still share one, and for each Guard since when its
 * credential is in force and until when an old one still works. No credential and no hash is in it.
 */
export function credentialStatusOf(state: Record<string, { since: string; previous?: { until: string } }> | undefined, tokens: Record<string, string>): { shared: boolean; guards: Record<string, { since?: string; oldUntil?: string }> } {
  return { shared: sharesOneCredential(tokens), guards: Object.fromEntries(Object.keys(tokens).map((k) => [k, { ...(state?.[k]?.since ? { since: state[k].since } : {}), ...(state?.[k]?.previous ? { oldUntil: state[k].previous!.until } : {}) }])) };
}

/** The hash a Guard keeps for a credential. */
export const credentialHash = (token: string): string => sha256Hex(token);

/** The file's path as the builder reads it in the output: relative to the server folder. */
export const credentialsEnvShown = (name: string): string => join("secrets", "agents", name, "credentials.env");
