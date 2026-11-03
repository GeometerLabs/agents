// Small things every part of the bundle shares: names, tokens, files and the plain-words problem list.
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** A refusal with a rule name, so a deploy that is stopped says WHICH rule stopped it. */
export interface Problem { rule: string; message: string }

/** Thrown when a deploy is refused. Carries every problem, not only the first. */
export class Refused extends Error {
  problems: Problem[];
  constructor(problems: Problem[]) {
    super(problems.map((p) => `[${p.rule}] ${p.message}`).join("\n"));
    this.problems = problems;
  }
}

export const sha256Hex = (text: string): string => createHash("sha256").update(text).digest("hex");

/** A credential in the form Guard issues: `gg_` and 32 hex characters. Guard stores only its sha256. */
export const mintGuardToken = (): string => `gg_${randomBytes(16).toString("hex")}`;
/** A secret for services that talk to each other (the runtime's internal token, the relay's token, an approver's signing secret). */
export const mintSecret = (): string => randomBytes(32).toString("hex");
/** An Ed25519 private key in PEM (PKCS8): what the panel signs its go-live certificates with. */
export const mintSigningKey = (): string => generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString();

/**
 * Shop names go into container names, DNS names, URLs and the fleet heartbeat. Fleet refuses a whole heartbeat for one id that looks like an
 * email address or a phone number (seven digits in a row, with at most a space, dot, dash or bracket between them), and a server whose heartbeats
 * are refused looks quiet. So a bad name is refused here, when the shop is added, and not later by an alert.
 */
export function shopNameProblem(name: string): string | undefined {
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/u.test(name)) return `"${name}" is not a usable shop name: use lowercase letters, digits and dashes, starting with a letter or digit, at most 40 characters (it becomes part of container names and web addresses).`;
  if (/\d(?:[ .\-()]?\d){6,}/u.test(name)) return `"${name}" has seven or more digits in a row (dashes between them count), so it looks like a phone number and Geometer's heartbeat would refuse it. Use a name without a number.`;
  return undefined;
}

/** A server id has the same rules (it is the deployment id fleet knows), up to 64 characters. */
export function serverIdProblem(id: string): string | undefined {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(id)) return `"${id}" is not a usable server id: lowercase letters, digits, dashes and underscores, at most 64 characters.`;
  if (/\d(?:[ .\-()]?\d){6,}/u.test(id)) return `"${id}" looks like a phone number (seven or more digits in a row). Use a name without a long number.`;
  return undefined;
}

/** JSON with sorted keys at every level and a trailing newline: the same value is always the same bytes. */
export function stableJson(value: unknown): string {
  const sort = (v: unknown): unknown => Array.isArray(v) ? v.map(sort) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, x]) => [k, sort(x)])) : v;
  return `${JSON.stringify(sort(value), null, 2)}\n`;
}

/** Write a file by writing a temporary one beside it and renaming it over: a reader never sees half a file. */
export function writeAtomic(path: string, content: string | Uint8Array, mode = 0o644): void {
  ensureDirs(dirname(path));
  const tmp = join(dirname(path), `.${Math.random().toString(36).slice(2)}.tmp`);
  writeFileSync(tmp, content, { mode });
  chmodSync(tmp, mode);
  renameSync(tmp, path);
}

/** Folders that hold secrets: a 0700 parent keeps other users of the machine out; the leaf is 0755 and its files 0644 so the container's user (not root) can read them. */
export function ensureDir(path: string, mode = 0o755): void {
  mkdirSync(path, { recursive: true, mode });
  chmodSync(path, mode);
}

/** Make a folder and every missing parent 0755, whatever the umask is: a container's own user (not root) has to be able to read what is under it. */
export function ensureDirs(path: string): void {
  const missing: string[] = [];
  for (let p = path; !existsSync(p); p = dirname(p)) missing.unshift(p);
  for (const p of missing) { mkdirSync(p, { mode: 0o755 }); chmodSync(p, 0o755); }
}

export const hostId = (): string => `${process.env.USER ?? "someone"}@${process.env.HOSTNAME ?? "this-machine"}`;
