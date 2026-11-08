// The daily fingerprint (B28), on the host: for each shop, the head of its record's ledger (exports/<shop>/ledger.json, which the export job writes from the shop's
// own database) is appended to state/fingerprints/<shop>.jsonl, a file that is only ever added to (modules/record/publish.ts). Never the record itself.
//
// Who signs: the deployer holds no signing key. When the server has a panel with a signing key, the panel signs the checkpoint over the head (`main.ts anchor`), and
// the line then carries a geometer-verify anchor anyone who keeps it can use. Without one the line holds the head alone and says it is not an anchor.
//
// Outside targets: a git repository and OpenTimestamps calendars, set in <server>/fingerprints.json. BOTH ARE OFF unless that file turns them on AND records the
// owner's yes (who, when): nothing leaves the server otherwise, and `geometer fingerprints` says which target waits for the yes.
//   { "git": { "enabled": true, "repo": "/srv/fingerprints-repo", "yes": { "by": "Asha (owner)", "at": "2026-11-08T10:00:00Z" } },
//     "opentimestamps": { "enabled": true, "calendars": ["https://a.pool.opentimestamps.org"], "yes": { "by": "...", "at": "..." } } }
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { localParts } from "../../modules/core/time.ts";
import { lastPublished, publishFingerprint } from "../../modules/record/publish.ts";
import type { Fetch, PublishTargets, Published } from "../../modules/record/publish.ts";
import type { Anchor, LedgerEntry } from "../../modules/record/ledger.ts";
import { compose } from "../deploy.ts";
import type { Context } from "../deploy.ts";
import { loadServer, serverPaths } from "../lib/server.ts";
import { loadState } from "../lib/state.ts";
import { updateStatus } from "../lib/status.ts";

export const fingerprintFile = (dir: string, shop: string): string => join(serverPaths(dir).state, "fingerprints", `${shop}.jsonl`);
export const targetsFile = (dir: string): string => join(serverPaths(dir).root, "fingerprints.json");

/** The last fingerprint published for a shop, or undefined (none yet, or the file cannot be read: the caller says which). */
export function lastFingerprint(dir: string, shop: string): { seq: number; head: string; day: string } | undefined {
  const line = lastPublished(fingerprintFile(dir, shop), shop);
  return line ? { seq: line.seq, head: line.head, day: line.day } : undefined;
}

function readTargets(dir: string): PublishTargets {
  const file = targetsFile(dir);
  if (!existsSync(file)) return {};
  try { return JSON.parse(readFileSync(file, "utf8")) as PublishTargets; } catch { throw new Error(`${file} is not JSON: fix it, or remove it to publish to the local file only.`); }
}

const readJson = <T>(file: string): T | undefined => { try { return JSON.parse(readFileSync(file, "utf8")) as T; } catch { return undefined; } };

/** The panel signs the checkpoint over the head with its key; undefined when there is no panel, no key, or it did not answer. */
async function anchorFromPanel(ctx: Context, shop: string): Promise<{ anchor?: Anchor; said: string }> {
  if (!loadServer(ctx.dir).panel.enabled) return { said: "not signed: this server has no panel, which holds the signing key" };
  const r = await compose(ctx, ["exec", "-T", "panel", "node", "/app/bundle/panel/main.ts", "anchor", shop, "--json"], { timeoutMs: 60_000 });
  let reply: { ok: boolean; anchor?: Anchor; error?: string } | undefined;
  try { reply = JSON.parse(r.stdout.trim().split("\n").at(-1) ?? ""); } catch { reply = undefined; }
  if (!reply) return { said: `not signed: the panel did not answer (${(r.stderr.trim() || `exit ${r.code}`).slice(0, 120)})` };
  return reply.ok && reply.anchor ? { anchor: reply.anchor, said: "signed by the panel's key" } : { said: `not signed: ${reply.error ?? "the panel could not sign"}` };
}

/** The shop's fingerprint file, copied beside its exported record (exports/<shop>/fingerprints.jsonl) so the panel, which cannot see state/, puts it in the shop's export (B38). */
function copyForExport(dir: string, shop: string): void {
  const from = fingerprintFile(dir, shop);
  if (!existsSync(from)) return;
  const to = join(serverPaths(dir).exportsOf(shop), "fingerprints.jsonl");
  const tmp = `${to}.tmp`;
  writeFileSync(tmp, readFileSync(from), { mode: 0o644 });
  renameSync(tmp, to);
}

export async function runFingerprints(ctx: Context, deps: { fetch?: Fetch } = {}): Promise<{ ok: boolean; lines: string[]; results: Record<string, Published> }> {
  const paths = serverPaths(ctx.dir);
  const state = loadState(ctx.dir);
  const shops = Object.entries(state.shops).filter(([, s]) => s.applied).map(([n]) => n);
  const targets = readTargets(ctx.dir);
  const lines: string[] = [];
  const results: Record<string, Published> = {};
  let ok = true;
  for (const shop of shops) {
    const ledger = readJson<LedgerEntry[]>(join(paths.exportsOf(shop), "ledger.json"));
    if (!ledger || ledger.length === 0) { lines.push(`${shop}: no fingerprint yet (its record has not been exported, or it is empty)`); continue; }
    const tz = readJson<{ timezone?: string }>(join(paths.shop(shop), "settings.json"))?.timezone ?? "UTC";
    const now = ctx.now();
    const p = localParts(now.getTime(), tz);
    const day = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
    const before = lastFingerprint(ctx.dir, shop);
    const signed = before?.day === day ? { said: "already signed today" } : await anchorFromPanel(ctx, shop);
    let published: Published;
    try {
      published = await publishFingerprint({
        file: fingerprintFile(ctx.dir, shop), ledger, day, now: now.getTime(), anchor: signed.anchor ?? null, targets,
        run: async (command, args, o) => ctx.runner.run(command, args, { cwd: o.cwd, timeoutMs: 120_000 }), ...(deps.fetch ? { fetch: deps.fetch } : { fetch: globalThis.fetch as unknown as Fetch }),
      });
    } catch (e) { published = { local: "refused", targets: { git: "off", opentimestamps: "off" }, alert: (e as Error).message }; }
    results[shop] = published;
    copyForExport(ctx.dir, shop);
    if (published.local === "refused") {
      ok = false;
      lines.push(`${shop}: FINGERPRINT REFUSED: ${published.alert}`);
      updateStatus(ctx.dir, shop, now, (s) => { s.fingerprint = { at: now.toISOString(), ok: false, detail: published.alert }; }, false);
      continue;
    }
    const line = published.line!;
    const how = line.anchor ? "signed by the panel's key" : signed.anchor ? "not signed: the panel signed a different head (the record grew in between); the next run signs it" : signed.said;
    lines.push(`${shop}: ${published.local === "same-day" ? "today's fingerprint is already written" : `fingerprint of entry ${line.seq} written (${how})`}; git: ${published.targets.git}; OpenTimestamps: ${published.targets.opentimestamps}`);
    updateStatus(ctx.dir, shop, now, (s) => { s.fingerprint = { at: now.toISOString(), ok: true, day: line.day, seq: line.seq, head: line.head, signed: line.anchor !== null }; }, false);
  }
  return { ok, lines, results };
}
