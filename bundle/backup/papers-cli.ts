// `geometer paper dispute|identity|ledger <shop> [--case b-3] [--lang en] [--out <folder>]`: ask the running panel for a paper (it holds the signing key, the papers it
// keeps and the shop's export) and write the files here. Like `geometer export`, nothing is sent to any service. A person's statement is made in the panel only, so the
// person's number never sits in a command line or a shell's history.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { compose } from "../deploy.ts";
import type { Context } from "../deploy.ts";
import { loadServer } from "../lib/server.ts";

export async function paperCommand(ctx: Context, kind: string, shop: string, o: { caseId?: string; lang?: string; out: string }): Promise<string[]> {
  if (!["dispute", "identity", "ledger"].includes(kind)) throw new Error("Say which paper: paper dispute <shop> --case b-3 | paper identity <shop> | paper ledger <shop>. A person's statement is made in the panel.");
  if (kind === "dispute" && !o.caseId) throw new Error("Say which case: paper dispute <shop> --case b-3 (a booking's or a fee's id, as the shop's page lists them).");
  if (!loadServer(ctx.dir).panel.enabled) throw new Error("This server has no panel, which holds the signing key and the shop's papers: the template's own script makes them from files (templates/<template>/scripts/papers.ts).");
  const r = await compose(ctx, ["exec", "-T", "panel", "node", "/app/bundle/panel/main.ts", "paper", kind, shop, ...(o.caseId ? ["--case", o.caseId] : []), ...(o.lang ? ["--lang", o.lang] : []), "--json"], { timeoutMs: 120_000 });
  let reply: { ok: boolean; error?: string; files?: { file: string; text: string }[] } | undefined;
  try { reply = JSON.parse(r.stdout.trim().split("\n").at(-1) ?? ""); } catch { reply = undefined; }
  if (!reply) throw new Error(`The panel did not answer (${(r.stderr.trim() || r.stdout.trim() || `exit ${r.code}`).slice(0, 300)}). Is it running? \`geometer status\` says; \`geometer deploy\` starts it.`);
  if (!reply.ok || !reply.files) throw new Error(reply.error ?? "The panel could not make the paper.");
  const out = resolve(o.out);
  mkdirSync(out, { recursive: true });
  return reply.files.map((f) => {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/u.test(f.file)) throw new Error(`The panel named a file "${f.file}" that is not a plain file name; nothing more was written.`);
    writeFileSync(join(out, f.file), f.text, { mode: 0o644 });
    return join(out, f.file);
  });
}
