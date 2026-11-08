// The daily fingerprint: each day, one line per shop with its ledger's head (never any of its data), appended to a local file that is only
// ever added to. Optionally the same line goes to a git repository and its digest to an OpenTimestamps calendar, so people other than the
// shop hold a copy of what the head was on that day: a quiet rewrite of the record later would not match what they hold.
//
// BOTH OUTSIDE TARGETS ARE OFF unless the targets file turns them on AND records the owner's yes (who said yes, and when). Nothing leaves the
// machine otherwise, and the result says which target waits for that yes. The git target only pushes to the remote its working copy already
// has; the calendar is called with the 32-byte digest alone. Both go through what the caller hands in (a command runner, a fetch), so the
// tests run them against a local bare repository and a local calendar and nothing here reaches the network on its own.
//
// What a line holds: the day, the time, the tenant (the shop's id), the ledger's name, the entry count and the head; the signed anchor when the
// caller had the shop's key (then anyone who kept the line can run `geo-verify pack.json --anchor <the line's anchor>`); and the sha256 of
// the line before it in the same file, so the file is a chain of its own and a removed or edited line shows.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { canonicalJson } from "./record.ts";
import { LEDGER, hashAt } from "./ledger.ts";
import type { Anchor, LedgerEntry } from "./ledger.ts";

export interface FingerprintLine {
  schema: 1;
  day: string; // "2026-11-08", in the shop's time zone
  at: string; // ISO 8601, UTC
  tenant: string;
  ledger: typeof LEDGER;
  seq: number; // entries in the record at that moment
  head: string; // the ledger's head hash
  /** The signed checkpoint over the head (geometer-verify's anchor file), or null when the line was written without the shop's key. */
  anchor: Anchor | null;
  /** sha256 of the previous line's bytes in this file, or null for the first line. */
  prev: string | null;
}

export interface OwnersYes { by: string; at: string }
export interface PublishTargets {
  /** A git working copy whose remote is the public, append-only place. Each line is added to fingerprints/<tenant>.jsonl there, committed and pushed. */
  git?: { enabled: boolean; repo: string; yes?: OwnersYes };
  /** OpenTimestamps calendars (their base addresses). The line's sha256 is sent; the calendar's answer is kept beside the log as <day>-<tenant>.ots. */
  opentimestamps?: { enabled: boolean; calendars: string[]; yes?: OwnersYes };
}

export type Runner = (command: string, args: string[], options: { cwd: string }) => { code: number; stdout: string; stderr: string } | Promise<{ code: number; stdout: string; stderr: string }>;
export type Fetch = (url: string, init: { method: "POST"; headers: Record<string, string>; body: Uint8Array }) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;

export interface Published {
  /** written: a new line; same-day: today's line was already there; refused: the record no longer matches what was published (an alert, never an overwrite). */
  local: "written" | "same-day" | "refused";
  line?: FingerprintLine;
  /** What happened at each outside target, in plain words. */
  targets: { git: string; opentimestamps: string };
  alert?: string;
}

export const lineBytes = (line: FingerprintLine): string => `${canonicalJson(line)}\n`;
const sha256 = (text: string): string => `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;

/** Every line of a fingerprint file, checked: each must name the hash of the line before it. Throws, in plain words, when the file was changed. */
export function readFingerprints(file: string): FingerprintLine[] {
  if (!existsSync(file)) return [];
  const lines = readFileSync(file, "utf8").split("\n").filter((l) => l !== "");
  let prev: string | null = null;
  return lines.map((text, i) => {
    let line: FingerprintLine;
    try { line = JSON.parse(text) as FingerprintLine; } catch { throw new Error(`Line ${i + 1} of ${file} cannot be read: the fingerprint file was changed by hand.`); }
    if (`${text}\n` !== lineBytes(line) || line.prev !== prev) throw new Error(`Line ${i + 1} of ${file} does not follow the line before it: the fingerprint file was changed or a line was removed.`);
    prev = sha256(`${text}\n`);
    return line;
  });
}

/** The last fingerprint published for a tenant (what the restore drill compares with), or undefined. */
export const lastPublished = (file: string, tenant: string): FingerprintLine | undefined => readFingerprints(file).filter((l) => l.tenant === tenant).at(-1);

const live = (t: { enabled: boolean; yes?: OwnersYes } | undefined): "off" | "no-yes" | "on" =>
  !t?.enabled ? "off" : !t.yes || typeof t.yes.by !== "string" || !t.yes.by.trim() || Number.isNaN(Date.parse(t.yes.at)) ? "no-yes" : "on";

/**
 * Append today's fingerprint for one ledger, then hand it to the outside targets that are on. Before anything is written, the hash the
 * ledger has NOW at the last published entry is compared with what was published: if they differ the record was rewritten after it was
 * published, nothing is appended, and the alert says so.
 */
export async function publishFingerprint(o: {
  file: string; ledger: readonly LedgerEntry[]; day: string; now: number; anchor?: Anchor | null; targets?: PublishTargets; run?: Runner; fetch?: Fetch;
}): Promise<Published> {
  const targets = { git: "off", opentimestamps: "off" };
  const last = o.ledger.at(-1);
  if (!last) return { local: "refused", targets, alert: "The record is empty, so there is no fingerprint to publish yet." };
  const tenant = last.tenant;
  const all = readFingerprints(o.file);
  const before = all.filter((l) => l.tenant === tenant).at(-1);
  if (before) {
    const now = hashAt(o.ledger, before.seq);
    if (now !== before.head) {
      return { local: "refused", targets, alert: now === null
        ? `${tenant}'s record has ${o.ledger.length} entries, fewer than the ${before.seq} published on ${before.day}: entries were removed after their fingerprint was published. Nothing was written.`
        : `${tenant}'s record no longer matches the fingerprint published on ${before.day} (entry ${before.seq}): it was changed after it was published. Nothing was written.` };
    }
    if (before.day === o.day) return { local: "same-day", line: before, targets };
  }
  // an anchor is kept only if it is over this very head: one signed for another moment would say something the line does not
  const anchor = o.anchor && o.anchor.checkpoint.tenant === tenant && o.anchor.checkpoint.seq === last.seq && o.anchor.checkpoint.head === last.hash ? o.anchor : null;
  const line: FingerprintLine = { schema: 1, day: o.day, at: new Date(o.now).toISOString(), tenant, ledger: LEDGER, seq: Number(last.seq), head: last.hash, anchor, prev: all.length > 0 ? sha256(lineBytes(all.at(-1)!)) : null };
  mkdirSync(dirname(o.file), { recursive: true });
  appendFileSync(o.file, lineBytes(line), { mode: 0o644 });

  const git = live(o.targets?.git);
  targets.git = git === "off" ? "off" : git === "no-yes" ? "waiting for the owner's yes (git.yes: who and when): nothing was pushed" : await toGit(o.targets!.git!.repo, line, o.run);
  const ots = live(o.targets?.opentimestamps);
  targets.opentimestamps = ots === "off" ? "off" : ots === "no-yes" ? "waiting for the owner's yes (opentimestamps.yes: who and when): nothing was sent" : await toCalendars(o.targets!.opentimestamps!.calendars, line, join(dirname(o.file), "ots"), o.fetch);
  return { local: "written", line, targets };
}

async function toGit(repo: string, line: FingerprintLine, run?: Runner): Promise<string> {
  if (!run) return "not pushed: no command runner was handed in";
  if (!existsSync(join(repo, ".git"))) return `not pushed: ${repo} is not a git working copy`;
  const file = join(repo, "fingerprints", `${line.tenant}.jsonl`);
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify({ day: line.day, at: line.at, tenant: line.tenant, ledger: line.ledger, seq: line.seq, head: line.head, anchor: line.anchor })}\n`);
  const steps: [string, string[]][] = [
    ["add", ["add", "--", `fingerprints/${line.tenant}.jsonl`]],
    ["commit", ["-c", "user.name=Geometer fingerprints", "-c", "user.email=fingerprints@localhost", "commit", "-q", "-m", `${line.tenant} ${line.day}: entry ${line.seq}, ${line.head}`]],
    ["push", ["push", "-q"]],
  ];
  for (const [step, args] of steps) {
    const r = await run("git", args, { cwd: repo });
    if (r.code !== 0) return `not pushed: git ${step} failed (${(r.stderr || r.stdout).trim().split("\n").at(-1)?.slice(0, 160) || `exit ${r.code}`})`;
  }
  return "pushed";
}

async function toCalendars(calendars: string[], line: FingerprintLine, folder: string, fetch?: Fetch): Promise<string> {
  if (!fetch) return "not sent: no fetch was handed in";
  const digest = createHash("sha256").update(lineBytes(line), "utf8").digest();
  const said: string[] = [];
  for (const base of calendars) {
    try {
      const r = await fetch(`${base.replace(/\/+$/u, "")}/digest`, { method: "POST", headers: { "content-type": "application/octet-stream", accept: "application/vnd.opentimestamps.v1" }, body: digest });
      if (!r.ok) { said.push(`${base}: answered ${r.status}`); continue; }
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, `${line.day}-${line.tenant}.ots`), Buffer.from(await r.arrayBuffer()), { mode: 0o644 });
      said.push(`${base}: stamped (the calendar's answer is kept; it completes later, on the calendar's side)`);
    } catch (e) { said.push(`${base}: could not be reached (${(e as Error).message.slice(0, 80)})`); }
  }
  return said.join("; ") || "not sent: no calendar is listed";
}
