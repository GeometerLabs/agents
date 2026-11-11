// The shop runtime's copy of the server's paper key (item 17b; follow-up 6, 12 Nov 2026), for signing the owner's WhatsApp monthly report. Used by deploy.ts
// (prepareShop) on every deploy of a server whose panel is on; `geometer check` does not call it (it starts nothing).
//
// Why a container: the runtime runs as the node image's user (uid 1000) and modules/report/sign.ts loadPrivateKey takes only a key file its own user owns and
// nobody else can read (0600). The deployer can make such a file itself only when it IS uid 1000 or root. A cloud-init server's builder is uid 1001, and a
// builder's own machine may be anything, so the deployer hands the key to a short-lived container instead: root inside, no network, a read-only root, every
// capability dropped but CHOWN and DAC_OVERRIDE (to write into the deployer's folder and give the file to uid 1000), the runtime's own image. The key goes in on
// standard input, never on a command line or in the environment. The container writes `secrets/rt-<shop>/report_signing_key` owned by uid 1000, 0600,
// atomically (a temporary file, then a rename), and prints what it wrote: the sha256 of the bytes, the owner and the mode. The deployer, which cannot read that
// file afterwards (unless it is root or uid 1000), judges the copy by that answer and by the sha256 of the key it sent. Nothing on the host reads the file
// back: it is mounted read-only into that one runtime at /run/secrets/report_signing_key.
//
// A copy that did not happen (Docker refused it, rootless Docker could not give the file to uid 1000, the answer does not match) is never a stop: the report goes
// out unsigned, with its digest and code link, and the deploy says why (generate/shop.ts). The runtime is never told about a key it cannot read, which would
// stop it from starting. A copy left from before is taken away then, so what is on disk always matches what runtime.json says.
import { createHash } from "node:crypto";
import { rmSync } from "node:fs";
import { dirname } from "node:path";
import type { Runner } from "./runner.ts";
import { RUNTIME_SIGNING_KEY_FILE, ensurePanelSigningKey, secretFile } from "./secrets.ts";
import { ensureDir } from "./util.ts";

/** The user every node service runs as, the shop runtimes included (generate/compose.ts nodeUser, the node image's `node`). */
export const RUNTIME_UID = 1000;
export const RUNTIME_GID = 1000;
/** The label that names this job on the machine (and that a test's fake Docker answers to). */
export const REPORT_KEY_JOB = "geometer.job=report-key";

/**
 * What runs inside the container: read the key from standard input, write it as `<name>` in /out for uid:gid with mode 0600, atomically, and print the sha256 of
 * what was written, its owner and its mode, as one JSON line. Any failure exits non-zero with a few plain words on stderr.
 */
export const COPY_SCRIPT = [
  "const fs=require('node:fs'),crypto=require('node:crypto');",
  "const [name,uid,gid]=process.argv.slice(1);",
  "const chunks=[];process.stdin.on('data',(c)=>chunks.push(c));process.stdin.on('end',()=>{",
  "try{const key=Buffer.concat(chunks);if(key.length<32)throw new Error('no key on standard input');",
  "const tmp='/out/.'+name+'.'+process.pid;const fd=fs.openSync(tmp,'wx',0o600);",
  "try{fs.writeSync(fd,key);fs.fchownSync(fd,Number(uid),Number(gid));fs.fchmodSync(fd,0o600);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}",
  "fs.renameSync(tmp,'/out/'+name);const st=fs.statSync('/out/'+name);",
  "process.stdout.write(JSON.stringify({sha256:crypto.createHash('sha256').update(fs.readFileSync('/out/'+name)).digest('hex'),uid:st.uid,gid:st.gid,mode:st.mode&0o777})+'\\n');",
  "}catch(e){process.stderr.write(String(e&&e.message||e));process.exit(1);}});",
].join("");

export type ReportKeyPlaced = { readable: true } | { readable: false; why: string };

/**
 * Put the server's paper key where a shop's runtime reads it (`runtimeFolder`: secrets/rt-<shop>), owned by the runtime's user, whoever the deployer is. `panelOn` false: there is no paper key to give, and a
 * copy left from before is removed. Returns whether the runtime can read the key now, and if not, why in a few plain words (the deploy's note says it).
 */
export async function placeRuntimeReportKey(o: { runner: Runner; docker: string; image: string; dir: string; runtimeFolder: string; panelOn: boolean }): Promise<ReportKeyPlaced> {
  const target = secretFile(o.dir, o.runtimeFolder, RUNTIME_SIGNING_KEY_FILE);
  // the deployer owns the folder, so it may always remove a file in it, even one owned by uid 1000
  const takeAway = (why: string): ReportKeyPlaced => { rmSync(target, { force: true }); return { readable: false, why }; };
  if (!o.panelOn) return takeAway("this server has no panel, so it has no paper key");
  const key = ensurePanelSigningKey(o.dir);
  const bytes = key.endsWith("\n") ? key : `${key}\n`; // as writeSecretFile writes a key, so loadPrivateKey reads the same PEM either way
  // the folder must exist before Docker mounts it: a missing one would be made by the Docker daemon, as root
  ensureDir(dirname(target), 0o755);
  const run = await o.runner.run(o.docker, [
    "run", "--rm", "-i", "--label", REPORT_KEY_JOB, "--network", "none", "--read-only", "--user", "0", "--cap-drop", "ALL", "--cap-add", "CHOWN", "--cap-add", "DAC_OVERRIDE",
    "--security-opt", "no-new-privileges:true", "-v", `${dirname(target)}:/out`, o.image,
    "node", "-e", COPY_SCRIPT, RUNTIME_SIGNING_KEY_FILE, String(RUNTIME_UID), String(RUNTIME_GID),
  ], { input: bytes, timeoutMs: 120_000 });
  if (run.code !== 0) return takeAway(`the copy job did not run (${(run.stderr.trim().split("\n").at(-1) ?? "").slice(0, 160) || `exit ${run.code}`})`);
  let seen: { sha256?: unknown; uid?: unknown; gid?: unknown; mode?: unknown };
  try { seen = JSON.parse(run.stdout.trim().split("\n").at(-1) ?? ""); } catch { return takeAway("the copy job's answer could not be read"); }
  const sent = createHash("sha256").update(bytes).digest("hex");
  if (seen.sha256 !== sent) return takeAway("the copy is not the key that was sent");
  // rootless Docker maps root to the deployer and uid 1000 to another user: the file would not be the runtime's, so it is not used
  if (seen.uid !== RUNTIME_UID || seen.gid !== RUNTIME_GID || seen.mode !== 0o600) return takeAway(`the copy is owned by ${String(seen.uid)}:${String(seen.gid)} with mode ${typeof seen.mode === "number" ? seen.mode.toString(8) : "?"}, not ${RUNTIME_UID}:${RUNTIME_GID} 600 (rootless Docker?)`);
  return { readable: true };
}
