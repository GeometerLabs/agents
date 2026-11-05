// What Guard decided, written to a folder a reviewer can read.
//
//   node companies/export-record.ts --admin http://127.0.0.1:8082 --token-file ./secrets/admin_token --out ./review-2026-11
//        [--evidence-dir /var/lib/geo-guard/export]
//
// It asks Guard's admin port for its decisions, approvals and uncertain calls and writes:
//   decisions.json, approvals.json, intents.json   exactly what Guard said
//   record.jsonl                                   one line per decision, oldest first, in plain words (sent / refused / held / replayed / unknown)
//   summary.txt                                    counts, and what this export cannot show
//   manifest.json                                  the sha256 of each file above
// With --evidence-dir it also asks Guard to write its tamper-evident evidence pack and a signed anchor there (the folder must be one Guard can write
// to, so on Compose or Kubernetes a volume you can also read). A reviewer then checks the pack with the open geo-verify, using an anchor kept somewhere
// the company's engineers cannot change.
//
// This is not the Bookings pathway's record (bundle/agent/record.ts). That one judges "done" from what three known services hold, and is written
// for a shop's monthly report. Here Guard's own word is all there is; nothing reads the company's API back (see Deferred.md).
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

type Obj = Record<string, any>;

/** The most decisions Guard lists at once. If a list is exactly this long, older decisions may exist that this export cannot see. */
export const WINDOW = 500;

export interface RecordLine {
  seq: number;
  time: string;
  agent: string;
  operation: string;
  outcome: "sent" | "refused" | "held" | "replayed" | "unknown";
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

/** One Guard decision in plain words. Guard's own text is kept in `why`. */
export function lineOf(d: Obj, seq: number): RecordLine {
  const reasons: string[] = Array.isArray(d.reasons) ? d.reasons : [];
  const text = reasons.join("; ");
  const answered = /the provider answered (\d{3})/u.exec(text);
  const deciding = (d.evaluations ?? []).find((e: Obj) => e.decision === (d.outcome === "hold" ? "hold" : "deny"));
  let outcome: RecordLine["outcome"];
  if (d.outcome === "deny") outcome = "refused";
  else if (d.outcome === "hold") outcome = "held";
  else if (/outcome unknown/u.test(text)) outcome = "unknown";
  else if (d.dispatched) outcome = "sent";
  else outcome = "replayed"; // allowed, and nothing was sent: the first call's recorded answer was returned
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
  const count = (k: RecordLine["outcome"]) => lines.filter((l) => l.outcome === k).length;
  const out = [
    `Guard's decisions: ${lines.length} (${count("sent")} sent, ${count("refused")} refused, ${count("held")} held, ${count("replayed")} answered from the record, ${count("unknown")} with an unknown outcome).`,
    `Approvals: ${o.approvals.length} (${["pending", "approved", "denied", "consumed", "expired"].map((s) => `${o.approvals.filter((a) => a.state === s).length} ${s}`).join(", ")}).`,
    `Uncertain calls still open: ${o.intents.filter((i) => i.state === "outcome_unknown").length}.`,
    ``,
    `What this does not show:`,
    `- It shows what Guard decided and what the API answered to Guard. It does not read the API back, so "sent" means the API answered, not that the money moved.`,
    `- It shows only calls that went through this Guard.`,
    o.windowFull ? `- Guard lists only its ${WINDOW} most recent decisions, and this list is that long: older decisions exist that this file does not hold. The evidence pack has them.` : `- Guard lists at most its ${WINDOW} most recent decisions; this list is shorter, so that limit did not cut it.`,
    o.evidence ? `- The evidence pack and anchor are in the evidence folder. Keep the anchor where your engineers cannot change it; without an anchor, geo-verify says "unverifiable".` : `- No evidence pack was asked for (--evidence-dir). Without it, nothing here is tamper-evident: these are files anyone with access to this folder could edit.`,
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

export async function exportRecord(o: { admin: string; token: string; out: string; evidenceDir?: string }): Promise<{ files: string[]; lines: number; windowFull: boolean }> {
  const decisions = ((await ask(o.admin, o.token, "GET", `/admin/decisions?limit=${WINDOW}`)).decisions ?? []) as Obj[];
  const approvals = ((await ask(o.admin, o.token, "GET", "/admin/approvals")).approvals ?? []) as Obj[];
  const intents = ((await ask(o.admin, o.token, "GET", "/admin/intents")).intents ?? []) as Obj[];
  const lines = recordLines(decisions);
  const windowFull = decisions.length >= WINDOW;
  if (o.evidenceDir) await ask(o.admin, o.token, "POST", "/admin/backup", { to: resolve(o.evidenceDir) });
  const files: Record<string, string> = {
    "decisions.json": `${JSON.stringify({ decisions }, null, 2)}\n`,
    "approvals.json": `${JSON.stringify({ approvals }, null, 2)}\n`,
    "intents.json": `${JSON.stringify({ intents }, null, 2)}\n`,
    "record.jsonl": lines.map((l) => JSON.stringify(l)).join("\n") + (lines.length > 0 ? "\n" : ""),
    "summary.txt": summaryText(lines, { approvals, intents, windowFull, evidence: !!o.evidenceDir }),
  };
  mkdirSync(o.out, { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(o.out, name), text);
  writeFileSync(join(o.out, "manifest.json"), `${JSON.stringify({ files: Object.fromEntries(Object.entries(files).map(([n, t]) => [n, `sha256:${sha256(t)}`])) }, null, 2)}\n`);
  return { files: [...Object.keys(files), "manifest.json"], lines: lines.length, windowFull };
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { admin: { type: "string" }, "token-file": { type: "string" }, out: { type: "string" }, "evidence-dir": { type: "string" } } });
  if (!values.admin || !values["token-file"] || !values.out) {
    console.error("Usage: node companies/export-record.ts --admin http://127.0.0.1:8082 --token-file <file holding the admin token> --out <folder> [--evidence-dir <folder Guard can write>]");
    process.exit(2);
  }
  const r = await exportRecord({ admin: values.admin, token: readFileSync(values["token-file"], "utf8").trim(), out: resolve(values.out), ...(values["evidence-dir"] ? { evidenceDir: values["evidence-dir"] } : {}) });
  console.log(`Wrote ${r.files.join(", ")} to ${resolve(values.out)} (${r.lines} decisions${r.windowFull ? ", the list is full: older ones are not here" : ""}).`);
}
