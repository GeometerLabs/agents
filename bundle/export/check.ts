// Check a shop export (build.ts): every file is the one the manifest names (sha256 and size), nothing is missing or extra, and every signed paper in it still verifies the way the
// report verifier checks one (modules/report/sign.ts: unchanged since the key named in it signed it; that does not show who holds the key or that the numbers are true).
//
//   node bundle/export/check.ts <the exported folder | the .tar.gz>
//
// Exit 0: the package is whole. 1: something was changed, is missing or is extra. 64: it was not asked a question it can answer.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { verifyEnvelopeText } from "../../modules/report/sign.ts";
import { EXPORT_FORMAT } from "./build.ts";
import type { Manifest } from "./build.ts";
import { fromTarGz } from "./tar.ts";

export interface PackageCheck {
  ok: boolean;
  problems: string[];
  /** Signed papers found, with what the report verifier said of each. */
  papers: { path: string; unchanged: boolean; signed: boolean; keyId: string | null; summary: string }[];
  manifest?: Manifest;
}

const sha = (data: Buffer) => createHash("sha256").update(data).digest("hex");

function walk(dir: string, base = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name), base) : [relative(base, join(dir, e.name)).split("\\").join("/")]));
}

/** The files of a package, by path, from a folder or a .tar.gz (whose files sit inside one folder, which is taken off). */
export function readPackage(where: string): Map<string, Buffer> {
  if (statSync(where).isDirectory()) return new Map(walk(where).map((p) => [p, readFileSync(join(where, p))]));
  const all = fromTarGz(readFileSync(where));
  const top = new Set([...all.keys()].map((p) => p.split("/")[0]));
  if (top.size !== 1) return all;
  const [folder] = [...top];
  return new Map([...all].map(([p, c]) => [p.slice(folder.length + 1), c]));
}

export function checkPackage(files: ReadonlyMap<string, Buffer>): PackageCheck {
  const problems: string[] = [];
  const papers: PackageCheck["papers"] = [];
  const manifestFile = files.get("manifest.json");
  if (!manifestFile) return { ok: false, problems: ["There is no manifest.json, so this is not a shop export."], papers };
  let manifest: Manifest;
  try { manifest = JSON.parse(manifestFile.toString("utf8")) as Manifest; } catch { return { ok: false, problems: ["manifest.json cannot be read."], papers }; }
  if (manifest.format !== EXPORT_FORMAT || !Array.isArray(manifest.files)) return { ok: false, problems: [`manifest.json is not ${EXPORT_FORMAT}.`], papers };

  const named = new Set<string>();
  for (const f of manifest.files) {
    named.add(f.path);
    const content = files.get(f.path);
    if (!content) problems.push(`${f.path} is missing.`);
    else if (content.length !== f.bytes || sha(content) !== f.sha256) problems.push(`${f.path} is not the file the manifest names: it has been changed.`);
  }
  for (const path of files.keys()) if (!named.has(path) && path !== "manifest.json" && path !== "SHA256SUMS") problems.push(`${path} is in the package but not in the manifest.`);

  const sums = files.get("SHA256SUMS")?.toString("utf8");
  if (sums === undefined) problems.push("SHA256SUMS is missing.");
  else {
    const listed = new Map<string, string>();
    for (const line of sums.split("\n").filter((l) => l !== "")) { const m = /^([0-9a-f]{64})  (.+)$/u.exec(line); if (m) listed.set(m[2], m[1]); else problems.push(`SHA256SUMS has a line this check cannot read: ${line.slice(0, 40)}`); }
    for (const [path, content] of files) if (path !== "SHA256SUMS" && listed.get(path) !== sha(content)) problems.push(`SHA256SUMS does not match ${path}.`);
  }

  for (const [path, content] of files) {
    if (!/^(reports\/[^/]+|certificates\/go-live)\/[^/]+\.json$/u.test(path)) continue;
    const v = verifyEnvelopeText(content.toString("utf8"));
    papers.push({ path, unchanged: v.unchanged, signed: v.signed, keyId: v.keyId, summary: v.summary });
    if (!v.unchanged) problems.push(`${path}: ${v.summary}`);
  }
  return { ok: problems.length === 0, problems, papers, manifest };
}

export function describe(check: PackageCheck): string {
  const lines = [check.ok ? "Whole: every file is the one the manifest names." : "NOT whole:", ...check.problems.map((p) => `  - ${p}`)];
  if (check.manifest) lines.push(`Shop ${check.manifest.shop}, made ${check.manifest.exportedAt}; ${check.manifest.counts.recordEntries} record entries, ${check.manifest.counts.cases} cases, ${check.manifest.counts.reports} reports, ${check.manifest.counts.certificates} certificates.`);
  for (const p of check.papers) lines.push(`  ${p.unchanged ? "unchanged" : "CHANGED  "}  ${p.path}${p.signed ? ` (signed by ${p.keyId})` : " (not signed)"}`);
  if (check.papers.length > 0) lines.push("A signature shows a paper is unchanged since its key signed it. It does not show who holds the key, or that the numbers are true.");
  return lines.join("\n");
}

if (import.meta.main) {
  const where = process.argv[2];
  if (!where) { console.error("Say which export to check: node bundle/export/check.ts <folder | .tar.gz>"); process.exitCode = 64; }
  else {
    let check: PackageCheck;
    try { check = checkPackage(readPackage(where)); } catch (e) { console.error(`I cannot read ${where}: ${(e as Error).message}`); process.exit(64); }
    console.log(describe(check));
    process.exitCode = check.ok ? 0 : 1;
  }
}
