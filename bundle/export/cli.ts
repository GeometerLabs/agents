// `geometer export <shop> [--out <folder>]`: write a shop's export (build.ts) to this machine, as a folder and as a .tar.gz.
//
// Where it runs. The papers the panel made (the go-live certificate, the monthly reports) live in the panel's own store, which is sealed when the panel has a data key, so only the
// panel can open it: on a server with a panel this asks the running panel container to build the package and hands it back, and the package is written here. A server with no panel
// builds it straight from the server's files (it then has no papers the panel made, and says so). Either way nothing is sent to any service, so it works for a shop that is stopped
// and for a shop whose plan lapsed.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { compose } from "../deploy.ts";
import type { Context } from "../deploy.ts";
import { loadServer } from "../lib/server.ts";
import { buildExport, packageTarGz } from "./build.ts";
import { checkPackage, readPackage } from "./check.ts";
import { sourcesFor } from "./sources.ts";

export interface Exported { folder: string; archive: string; files: number; notes: string[]; warnings: string[]; whole: boolean }

// Builds the export, re-checks it before writing, and writes both a folder and a .tar.gz. Checking before handing it over means a bad export is reported to the person who made it, not to whoever receives it.
export async function exportCommand(ctx: Context, shop: string, out: string): Promise<Exported> {
  const now = ctx.now().getTime();
  const target = resolve(out);
  let archive: Buffer;
  let name: string;
  let warnings: string[] = [];
  const notes: string[] = [];
  if (loadServer(ctx.dir).panel.enabled) {
    const r = await compose(ctx, ["exec", "-T", "panel", "node", "/app/bundle/panel/main.ts", "export", shop, "--json"], { timeoutMs: 120_000 });
    let reply: { ok: boolean; error?: string; name?: string; warnings?: string[]; tgz?: string } | undefined;
    try { reply = JSON.parse(r.stdout.trim().split("\n").at(-1) ?? ""); } catch { /* said below */ }
    if (!reply) throw new Error(`The panel did not answer (${(r.stderr.trim() || r.stdout.trim() || `exit ${r.code}`).slice(0, 300)}). Is it running? \`geometer status\` says; \`geometer deploy\` starts it.`);
    if (!reply.ok || !reply.tgz || !reply.name) throw new Error(reply.error ?? "The panel could not make the export.");
    archive = Buffer.from(reply.tgz, "base64");
    name = reply.name;
    warnings = reply.warnings ?? [];
  } else {
    const built = buildExport(sourcesFor(ctx.dir, shop), { shop, now, exportedBy: { name: "geometer export", role: "server" } });
    archive = packageTarGz(built, now);
    name = built.name;
    warnings = built.warnings;
    notes.push("This server has no panel, so the reports and certificates the panel makes are not in this package.");
  }
  mkdirSync(target, { recursive: true });
  const archiveFile = join(target, `${name}.tar.gz`);
  writeFileSync(archiveFile, archive, { mode: 0o644 });
  const files = readPackage(archiveFile);
  for (const [path, content] of files) {
    const file = join(target, name, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content, { mode: 0o644 });
  }
  const check = checkPackage(files);
  return { folder: join(target, name), archive: archiveFile, files: files.size, notes, warnings, whole: check.ok };
}
