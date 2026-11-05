// What Guard decided, written to a folder a reviewer can read.
//
//   node companies/export-record.ts --admin http://127.0.0.1:8082 --token-file ./secrets/admin_token --out ./review/2026-11
//        [--backup-dir /var/lib/geo-guard/export [--backup-read-dir ./evidence]]
//
// It asks Guard's admin port for its decisions, approvals and uncertain calls and writes:
//   decisions.json, approvals.json, intents.json   exactly what Guard said
//   record.jsonl                                   one line per decision, oldest first, in plain words (sent / refused / held / replayed / not_sent / unknown)
//   summary.txt                                    counts, and what this export cannot show
//   manifest.json                                  the sha256 of each file above
// With --backup-dir it also asks Guard for a backup in a NEW subfolder of that folder (the path as Guard sees it; Guard must be able to write there), and copies
// the two files a reviewer needs, evidence-pack.json and anchor.json, into <out>/evidence/. Nothing else is copied. The rest of the backup is Guard's store and
// its evidence keys: it is for restoring Guard, it stays with the operator, and it must not go to reviewers. Guard refuses a backup into a folder that is not
// empty, which is why every run makes its own subfolder.
//
// A reviewer checks the pack with the open geo-verify. An anchor from the same export only shows the pack was not changed after Guard wrote it. To catch a rewrite
// of Guard's own records, keep each export's anchor where the company's engineers cannot change it and check a later pack against an EARLIER anchor.
//
// This is not the Bookings pathway's record (bundle/agent/record.ts). That one judges "done" from what three known services hold, and is written
// for a shop's monthly report. Here Guard's own word is all there is; nothing reads the company's API back (see Deferred.md).
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, posix, resolve } from "node:path";
import { parseArgs } from "node:util";

type Obj = Record<string, any>;

/** The most decisions Guard lists at once. If a list is exactly this long, older decisions may exist that this export cannot see. */
export const WINDOW = 500;

export type Outcome = "sent" | "refused" | "held" | "replayed" | "not_sent" | "unknown";

export interface RecordLine {
  seq: number;
  time: string;
  agent: string;
  operation: string;
  outcome: Outcome;
  /** The API's own status, when Guard sent the call and got an answer. */
  status?: number;
  /** The rule that refused or held it. */
  rule?: string;
  why: string;
  approval?: string | null;
  /** Guard's digest of the exact call. */
  call: string;
  arguments: Record<string, string>;
}

const scalar = (v: unknown): string => (Array.isArray(v) ? (typeof v[1] === "string" ? v[1] : JSON.stringify(v[1])) : String(v));

/**
 * One Guard decision in plain words. Guard's own text is kept in `why`. "replayed" is only for a call answered from the record of an earlier one; a call the rules
 * allowed but Guard did not send for another reason (the API was unreachable) is "not_sent", with Guard's reason.
 */
export function lineOf(d: Obj, seq: number): RecordLine {
  const reasons: string[] = Array.isArray(d.reasons) ? d.reasons : [];
  const text = reasons.join("; ");
  const answered = /the provider answered (\d{3})/u.exec(text);
  const deciding = (d.evaluations ?? []).find((e: Obj) => e.decision === (d.outcome === "hold" ? "hold" : "deny"));
  let outcome: Outcome;
  if (d.outcome === "deny") outcome = "refused";
  else if (d.outcome === "hold") outcome = "held";
  else if (/outcome unknown/u.test(text)) outcome = "unknown";
  else if (d.dispatched) outcome = "sent";
  else if (/the recorded reply is returned/u.test(text)) outcome = "replayed";
  else outcome = "not_sent";
  return {
    seq, time: new Date(Number(d.at_ms)).toISOString(), agent: d.principal?.workload ?? "", operation: d.operation, outcome,
    ...(outcome === "sent" && answered ? { status: Number(answered[1]) } : {}),
    ...(deciding ? { rule: deciding.rule } : {}),
    why: (deciding?.reason ?? reasons.at(-1) ?? "").slice(0, 400),
    ...(d.outcome === "hold" ? { approval: d.approval ?? null } : {}),
    call: d.call,
    arguments: Object.fromEntries(Object.entries(d.arguments ?? {}).map(([k, v]) => [k, scalar(v)])),
  };
}

export function recordLines(decisions: Obj[]): RecordLine[] {
  // Guard lists newest first; a record reads oldest first
  return [...decisions].sort((a, b) => Number(a.at_ms) - Number(b.at_ms) || (a.id < b.id ? -1 : 1)).map((d, i) => lineOf(d, i + 1));
}

export function summaryText(lines: RecordLine[], o: { approvals: Obj[]; intents: Obj[]; windowFull: boolean; evidence: boolean }): string {
  const count = (k: Outcome) => lines.filter((l) => l.outcome === k).length;
  const out = [
    `Guard's decisions: ${lines.length} (${count("sent")} sent, ${count("refused")} refused, ${count("held")} held, ${count("replayed")} answered from the record, ${count("not_sent")} allowed but not sent, ${count("unknown")} with an unknown outcome).`,
    `Approvals: ${o.approvals.length} (${["pending", "approved", "denied", "consumed", "expired"].map((s) => `${o.approvals.filter((a) => a.state === s).length} ${s}`).join(", ")}).`,
    `Uncertain calls still open: ${o.intents.filter((i) => i.state === "outcome_unknown").length}.`,
    ``,
    `What this does not show:`,
    `- It shows what Guard decided and what the API answered to Guard. It does not read the API back, so "sent" means the API answered, not that the money moved.`,
    `- It shows only calls that went through this Guard.`,
    o.windowFull ? `- Guard lists only its ${WINDOW} most recent decisions, and this list is that long: older decisions exist that this file does not hold. The evidence pack has them.` : `- Guard lists at most its ${WINDOW} most recent decisions; this list is shorter, so that limit did not cut it.`,
    o.evidence
      ? `- evidence/ holds Guard's evidence pack and anchor. An anchor from this same export only shows the pack was not changed after Guard wrote it. To catch a rewrite of Guard's own records, check a later pack against an anchor you saved from an EARLIER export, kept where your engineers cannot change it. Without an anchor, geo-verify says "unverifiable".\n- Guard's full backup (its store and its evidence keys) was written to the operator's backup folder. It is for restoring Guard and is not part of this export.`
      : `- No evidence pack was asked for (--backup-dir). Without it, nothing here is tamper-evident: these are files anyone with access to this folder could edit.`,
  ];
  return `${out.join("\n")}\n`;
}

const sha256 = (data: string) => createHash("sha256").update(data).digest("hex");

async function ask(admin: string, token: string, method: string, path: string, body?: unknown): Promise<Obj> {
  const r = await fetch(`${admin}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const text = await r.text();
  if (!r.ok) throw new Error(`Guard answered ${r.status} to ${method} ${path}: ${text.slice(0, 200)}`);
  return JSON.parse(text) as Obj;
}

/** The only two files of Guard's backup that go to reviewers. The rest (state.db, evidence/keys) never leaves the operator. */
export const REVIEWER_FILES = ["evidence-pack.json", "anchor.json"] as const;

export interface ExportOptions {
  admin: string;
  token: string;
  out: string;
  /** A folder Guard can write to, as Guard sees its path. Each export makes a new subfolder in it. */
  backupDir?: string;
  /** The same folder as this process sees it, when that differs (a read-only mount). Default: backupDir. */
  backupReadDir?: string;
  /** For a test: the name of this export's subfolder. */
  stamp?: string;
}

export async function exportRecord(o: ExportOptions): Promise<{ files: string[]; lines: number; windowFull: boolean; backup?: { guardPath: string; readPath: string } }> {
  // an export is kept, not overwritten: its anchor is what a later pack is checked against
  if (existsSync(o.out) && readdirSync(o.out).length > 0) throw new Error(`${o.out} is not empty. Each export goes in a new folder (a dated name works), because the anchor in an old export is what a later one is checked against.`);
  const decisions = ((await ask(o.admin, o.token, "GET", `/admin/decisions?limit=${WINDOW}`)).decisions ?? []) as Obj[];
  const approvals = ((await ask(o.admin, o.token, "GET", "/admin/approvals")).approvals ?? []) as Obj[];
  const intents = ((await ask(o.admin, o.token, "GET", "/admin/intents")).intents ?? []) as Obj[];
  const lines = recordLines(decisions);
  const windowFull = decisions.length >= WINDOW;

  let backup: { guardPath: string; readPath: string } | undefined;
  if (o.backupDir) {
    const name = `backup-${o.stamp ?? new Date().toISOString().replace(/[:.]/gu, "-")}`;
    backup = { guardPath: posix.join(o.backupDir, name), readPath: join(o.backupReadDir ?? o.backupDir, name) };
    await ask(o.admin, o.token, "POST", "/admin/backup", { to: backup.guardPath });
    const missing = REVIEWER_FILES.filter((f) => !existsSync(join(backup!.readPath, f)));
    if (missing.length > 0) throw new Error(`Guard wrote its backup to ${backup.guardPath}, but this process cannot read ${missing.join(" and ")} at ${backup.readPath}. Give this process a (read-only) mount of the same folder and pass it as --backup-read-dir.`);
    mkdirSync(join(o.out, "evidence"), { recursive: true });
    for (const f of REVIEWER_FILES) copyFileSync(join(backup.readPath, f), join(o.out, "evidence", f));
  }

  const files: Record<string, string> = {
    "decisions.json": `${JSON.stringify({ decisions }, null, 2)}\n`,
    "approvals.json": `${JSON.stringify({ approvals }, null, 2)}\n`,
    "intents.json": `${JSON.stringify({ intents }, null, 2)}\n`,
    "record.jsonl": lines.map((l) => JSON.stringify(l)).join("\n") + (lines.length > 0 ? "\n" : ""),
    "summary.txt": summaryText(lines, { approvals, intents, windowFull, evidence: !!backup }),
  };
  mkdirSync(o.out, { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(o.out, name), text);
  writeFileSync(join(o.out, "manifest.json"), `${JSON.stringify({ files: Object.fromEntries(Object.entries(files).map(([n, t]) => [n, `sha256:${sha256(t)}`])) }, null, 2)}\n`);
  return { files: [...Object.keys(files), "manifest.json"], lines: lines.length, windowFull, ...(backup ? { backup } : {}) };
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { admin: { type: "string" }, "token-file": { type: "string" }, out: { type: "string" }, "backup-dir": { type: "string" }, "backup-read-dir": { type: "string" } } });
  if (!values.admin || !values["token-file"] || !values.out) {
    console.error("Usage: node companies/export-record.ts --admin http://127.0.0.1:8082 --token-file <file holding the admin token> --out <folder> [--backup-dir <folder Guard can write> [--backup-read-dir <the same folder as this process sees it>]]");
    process.exit(2);
  }
  const r = await exportRecord({ admin: values.admin, token: readFileSync(values["token-file"], "utf8").trim(), out: resolve(values.out), ...(values["backup-dir"] ? { backupDir: values["backup-dir"] } : {}), ...(values["backup-read-dir"] ? { backupReadDir: values["backup-read-dir"] } : {}) });
  console.log(`Wrote ${r.files.join(", ")} to ${resolve(values.out)} (${r.lines} decisions${r.windowFull ? ", the list is full: older ones are not here" : ""}).`);
  if (r.backup) console.log(`Copied evidence-pack.json and anchor.json to ${join(resolve(values.out), "evidence")}. Guard's full backup (store and keys) is at ${r.backup.guardPath}: keep it with the operator.`);
}
