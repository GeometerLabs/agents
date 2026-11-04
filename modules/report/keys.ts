// Making the signing key pair, and refusing to put it anywhere near a repository. The private key is a secret that signs
// every report and certificate a shop is shown: it lives in a folder the person names, outside any git work tree, with
// permissions only they can use. It is never generated into this repository, and never overwritten.
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { keyIdOf, publicKeyHex } from "./sign.ts";

export const PRIVATE_KEY_FILE = "report-key.pem";
export const PUBLIC_KEY_FILE = "report-key.pub.pem";

/** The real path of something that may not exist yet: the nearest folder that does, resolved, with the rest put back. */
function realPathEvenIfMissing(path: string): string {
  let existing = resolve(path);
  const rest: string[] = [];
  while (!existsSync(existing)) { rest.unshift(basename(existing)); existing = dirname(existing); }
  return join(realpathSync(existing), ...rest);
}

/** The folder of the git work tree this path is inside, or null. In a worktree .git is a file, so any entry named .git counts. */
export function gitRootOf(path: string): string | null {
  let dir = realPathEvenIfMissing(path);
  for (;;) {
    if (existsSync(join(dir, ".git"))) return dir;
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/** The root of the repository these scripts live in (modules/report is two levels down), even if its .git were missing. */
const THIS_REPOSITORY = realpathSync(fileURLToPath(new URL("../..", import.meta.url)));

/** Throws, in plain words, when the folder is inside a git work tree or inside this repository. */
export function assertOutsideRepository(folder: string): void {
  const real = realPathEvenIfMissing(folder);
  const root = gitRootOf(folder) ?? (real === THIS_REPOSITORY || real.startsWith(`${THIS_REPOSITORY}/`) ? THIS_REPOSITORY : null);
  if (root) throw new Error(`${folder} is inside the git repository ${root}. A signing key must never live in a repository. Name a folder outside it, for example ~/geometer-keys.`);
}

export interface KeyFiles { privateKeyPath: string; publicKeyPath: string; keyId: string; publicKey: string }

/** Make a key pair in `folder` (created if missing). Refuses a folder inside a repository, and refuses to overwrite a key. */
export function generateKeyFiles(folder: string): KeyFiles {
  assertOutsideRepository(folder);
  const dir = resolve(folder);
  const privateKeyPath = join(dir, PRIVATE_KEY_FILE);
  const publicKeyPath = join(dir, PUBLIC_KEY_FILE);
  if (existsSync(privateKeyPath) || existsSync(publicKeyPath)) throw new Error(`There is already a key in ${dir}. It is not overwritten: a new key would make every document signed with the old one look foreign. Pick another folder if you want a second key.`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  writeFileSync(privateKeyPath, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600, flag: "wx" });
  writeFileSync(publicKeyPath, publicKey.export({ type: "spki", format: "pem" }), { mode: 0o644, flag: "wx" });
  const hex = publicKeyHex(privateKey);
  return { privateKeyPath, publicKeyPath, keyId: keyIdOf(hex), publicKey: hex };
}
