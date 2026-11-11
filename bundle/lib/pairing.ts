// This server's side of pairing with Geometer's fleet service (plan item 14b, "the builder's one-step setup"). Used by `geometer pair` and `geometer init --pairing`,
// which install.sh runs; a builder can run them by hand too.
//
// The builder asks for a one-time code on their account page (geometer.dev/account, "Add a server") and pastes it into the install. `pair` sends it ONCE to fleet's
// `POST /v1/pair` (the monorepo's apps/fleet/src/server-pairing-api.ts) and keeps the answer in the new server folder before anything else happens, because the code
// cannot be used twice:
//
//   <server>/fleet_key       this server's deployment key (gfk_...), mode 0600: the one secret in the answer. It goes to the ops container only (deploy.ts writeServer).
//   <server>/pairing.json    the rest, none of it secret: the deployment id fleet gave this server (it becomes geometer.json's `id`, which every heartbeat names),
//                            fleet's address, the public half of fleet's licence key (pinned at init), the trial lease (decision 39) and the account's name.
//
// The code itself is read from standard input, never from the command line (where other users of the machine can see it), and is never written anywhere. It opens
// nothing but this exchange: not the panel, not fleet's other routes.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { serverIdProblem } from "./util.ts";

export interface PairingFile {
  schema: 1;
  deploymentId: string;
  fleetUrl: string;
  /** Fleet's licence keys' public halves, 64 hex characters each. Empty: fleet signs no lease, so none is kept here. */
  licenceKeys: string[];
  /** A signed trial lease (`gl1.`...) for this server, or null when fleet gave none. */
  trialLease: string | null;
  accountName: string;
  pairedAt: string;
}

export const pairingPaths = (dir: string) => ({ key: join(dir, "fleet_key"), info: join(dir, "pairing.json") });

const CODE = /^gfp_[a-z2-9-]{24,40}$/iu;
const KEY = /^gfk_[A-Za-z0-9_-]{43}$/u;
const HEX64 = /^[0-9a-f]{64}$/u;
/** A lease or extension token's shape (modules/licence/token.ts): prefix, key id, payload, signature. Checked properly, with the pinned key, when it is taken. */
const TOKEN = /^gl1\.[0-9a-f]{16}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u;

/** The address a deployment key may be sent to: https, or plain http only on this machine (a test's fleet). The same rule as geometer.json's fleet.url. */
export function fleetUrlProblem(url: string): string | undefined {
  let u: URL;
  try { u = new URL(url); } catch { return `"${url}" is not a web address.`; }
  if (u.origin !== url.replace(/\/+$/u, "")) return `${url} must be fleet's address alone (no path), like https://fleet.geometer.dev.`;
  if (u.protocol === "https:") return undefined;
  if (u.protocol === "http:" && ["localhost", "127.0.0.1", "host.docker.internal"].includes(u.hostname)) return undefined;
  return `${url} must start with https:// (the answer carries this server's key).`;
}

/** Check fleet's answer field by field: nothing from the network is written to disk until it has the shape it must have. */
export function checkAnswer(body: unknown, pairedWith: string): { ok: true; key: string; file: Omit<PairingFile, "pairedAt"> } | { ok: false; problem: string } {
  const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const id = typeof b.deployment_id === "string" ? b.deployment_id : "";
  if (!id || serverIdProblem(id)) return { ok: false, problem: "fleet's answer has no usable server id." };
  if (typeof b.deployment_key !== "string" || !KEY.test(b.deployment_key)) return { ok: false, problem: "fleet's answer has no usable deployment key." };
  const fleetUrl = b.fleet_url === null || b.fleet_url === undefined ? pairedWith : b.fleet_url;
  if (typeof fleetUrl !== "string" || fleetUrlProblem(fleetUrl)) return { ok: false, problem: "fleet's answer names an address for the heartbeats that is not https." };
  const keys = Array.isArray(b.licence_keys) ? b.licence_keys : [];
  if (!keys.every((k) => typeof k === "string" && HEX64.test(k)) || keys.length > 4) return { ok: false, problem: "fleet's answer has a licence key that is not 64 hex characters." };
  const lease = b.trial_lease ?? null;
  if (lease !== null && (typeof lease !== "string" || lease.length > 16_384 || !TOKEN.test(lease))) return { ok: false, problem: "fleet's answer has a trial lease that is not a lease." };
  const name = typeof b.account_name === "string" && /^[^\n\r]{1,120}$/u.test(b.account_name) ? b.account_name : "your account";
  return { ok: true, key: b.deployment_key, file: { schema: 1, deploymentId: id, fleetUrl: fleetUrl.replace(/\/+$/u, ""), licenceKeys: keys as string[], trialLease: lease as string | null, accountName: name } };
}

/**
 * Exchange the code with fleet, and keep the answer in `dir` (made if needed). Refuses before sending anything when the folder is already set up or already paired:
 * pairing is for a new server, and a second code would make a second deployment in fleet.
 */
export async function pairServer(o: { dir: string; fleetUrl: string; code: string; now: Date; fetchImpl?: typeof fetch; timeoutMs?: number }): Promise<PairingFile> {
  const paths = pairingPaths(o.dir);
  if (existsSync(join(o.dir, "geometer.json"))) throw new Error(`${o.dir} is already a server folder, so it is not paired again. Pairing is for a new server.`);
  if (existsSync(paths.key) || existsSync(paths.info)) throw new Error(`${o.dir} is already paired (${existsSync(paths.info) ? "pairing.json" : "fleet_key"} is there). Nothing was sent. To start over, move the folder away first.`);
  const problem = fleetUrlProblem(o.fleetUrl);
  if (problem) throw new Error(problem);
  const code = o.code.trim();
  if (!CODE.test(code)) throw new Error("That is not a pairing code: it starts with gfp_ (copy it from your account page, geometer.dev/account, \"Add a server\"). Nothing was sent.");
  const base = o.fleetUrl.replace(/\/+$/u, "");
  let answer: Response;
  try {
    answer = await (o.fetchImpl ?? fetch)(`${base}/v1/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }), redirect: "error", signal: AbortSignal.timeout(o.timeoutMs ?? 30_000) });
  } catch (e) {
    throw new Error(`Fleet could not be reached at ${base} (${(e as Error).message}). The code was not used: try again when the network is back.`);
  }
  let body: unknown;
  try { body = await answer.json(); } catch { body = undefined; }
  if (!answer.ok) {
    const said = typeof (body as { error?: unknown } | undefined)?.error === "string" ? (body as { error: string }).error.slice(0, 400) : `HTTP ${answer.status}`;
    throw new Error(`Fleet did not pair this server: ${said}`);
  }
  const checked = checkAnswer(body, base);
  // The code is spent at this point. An answer of the wrong shape is said plainly: a new code is needed, and the server Geometer made for it is harmless (it never hears a heartbeat).
  if (!checked.ok) throw new Error(`Fleet's answer could not be used (${checked.problem}). The code is used up: get a new one, and write to support if it happens again.`);
  const file: PairingFile = { ...checked.file, pairedAt: o.now.toISOString() };
  mkdirSync(o.dir, { recursive: true, mode: 0o700 });
  // the key first, so a stop between the two leaves the secret kept rather than lost; `wx` never replaces a key
  writeFileSync(paths.key, `${checked.key}\n`, { mode: 0o600, flag: "wx" });
  writeFileSync(paths.info, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  return file;
}

/** The pairing kept in a server folder, checked again (it may have been edited by hand). */
export function readPairing(dir: string): PairingFile {
  const paths = pairingPaths(dir);
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(paths.info, "utf8")); } catch { throw new Error(`${paths.info} is not there or not readable: run \`geometer pair\` first, or set the server up by hand (init --fleet-url --fleet-key-file --licence-key).`); }
  const r = raw as Partial<PairingFile>;
  const checked = checkAnswer({ deployment_id: r.deploymentId, deployment_key: readFileSync(paths.key, "utf8").trim(), fleet_url: r.fleetUrl, licence_keys: r.licenceKeys, trial_lease: r.trialLease, account_name: r.accountName }, r.fleetUrl ?? "");
  if (!checked.ok || r.schema !== 1) throw new Error(`${paths.info} (or fleet_key beside it) is not a pairing this bundle can use${checked.ok ? "" : `: ${checked.problem}`}.`);
  return { ...checked.file, pairedAt: typeof r.pairedAt === "string" ? r.pairedAt : "" };
}
