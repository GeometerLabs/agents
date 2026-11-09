// Open a nightly snapshot, on a machine that has the secret half of the age key (it is not kept on the server).
//
//   node bundle/backup/restore-snapshot.ts <folder with the .age files, as downloaded from the bucket> --identity <key file> --out <empty folder>
//
// Every `*.age` file under the first folder is decrypted to the same relative path (without `.age`) under --out. The shop's runtime database comes out as
// `runtime/agent.db`; put it in the shop's data volume as `data/agent.db` (with the runtime stopped) to restore from it, and check it against
// `manifest.json`, which lists every file's size and sha256 and the record's length and last entry. `person_key` is the shop's fingerprint key (B69): on a new machine put it at
// `secrets/person-keys/<shop>` (mode 0600) BEFORE the first deploy or export runs, or the server makes a new key and the shop can no longer match the people already in its record.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { decrypt } from "./age.ts";

const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));

export function restoreSnapshot(from: string, identity: string, out: string): string[] {
  if (existsSync(out) && readdirSync(out).length > 0) throw new Error(`${out} is not empty: a restore goes into a new folder.`);
  const written: string[] = [];
  for (const file of walk(from).filter((f) => f.endsWith(".age"))) {
    const target = join(out, relative(from, file).replace(/\.age$/u, ""));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, decrypt(readFileSync(file), identity));
    written.push(target);
  }
  if (written.length === 0) throw new Error(`There are no .age files under ${from}.`);
  return written;
}

if (import.meta.main) {
  const a = process.argv.slice(2);
  const at = (flag: string) => a[a.indexOf(flag) + 1];
  if (a.length < 5 || !a.includes("--identity") || !a.includes("--out")) { console.error("usage: restore-snapshot.ts <folder> --identity <key file> --out <empty folder>"); process.exit(2); }
  try { const files = restoreSnapshot(resolve(a[0]), readFileSync(at("--identity"), "utf8"), resolve(at("--out"))); console.log(`${files.length} files opened under ${resolve(at("--out"))}`); } catch (e) { console.error((e as Error).message); process.exit(1); }
}
