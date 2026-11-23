// "Get my shop's file" on the server's side (block S, 18 Nov 2026): the deployer's part. On every pass it looks at each shop's exported record for the owner's ask
// (modules/approvals/leave.ts: `owner_file_asked`), has the file built with the OWNER profile (bundle/export/build.ts) by whoever can read the shop's files and the papers (the
// panel's container, or this process when the server has no panel), and copies it into THAT SHOP'S OWN client folder (generated/shops/<shop>/client/owner-file.*), where its
// runtime serves it to the owner's session once (go/internal/runtime). The runtime never reads another shop's files, and nobody here reads the owner's session.
//
//   asked      the record has `owner_file_asked` (the owner's words, from WhatsApp or the app) that this server has not answered yet
//   made       the file is in the client folder for 72 hours; status/leave/<shop>.json says so (no file content in it) for the Operator's panel
//   taken      the record has `owner_file_taken` for that ask: the server's copy is deleted at once
//   expired    72 hours passed: deleted; a new ask makes a new file
// The file never stays longer than that. A build that fails (no keyed record yet, no shop folder) is told in the status and tried again in a few minutes, never forgotten and
// never half-copied: the body is written first and the meta last, and the runtime ignores a body with no meta. A redeploy that clears the client folder makes the file again.
// The lag is the record's own: the deployer exports it every quarter of an hour, so "about half an hour" is what the owner is told.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { FILE_HOURS, fileTaken, latestAsk } from "../../modules/approvals/leave.ts";
import type { AskEntry } from "../../modules/approvals/leave.ts";
import { OWNER_FILE_BODY, OWNER_FILE_META, newOwnerFileId } from "../../modules/channels/owner-file.ts";
import { serverPaths } from "./server.ts";
import { stableJson, writeAtomic } from "./util.ts";
import { clientDir } from "./client-dir.ts";

/** What the deployer knows about one shop's file, for the panel: never the file, its link or its id. */
export interface LeaveStatus {
  schema: 1;
  file?: { ask: string; state: "ready" | "taken" | "expired" | "problem"; askedAt: string; madeAt?: string; expiresAt?: string; problem?: string; triedAt?: string };
}
export const leaveStatusFile = (dir: string, shop: string): string => join(serverPaths(dir).root, "status", "leave", `${shop}.json`);
export function readLeaveStatus(dir: string, shop: string): LeaveStatus | undefined {
  try { const s = JSON.parse(readFileSync(leaveStatusFile(dir, shop), "utf8")) as LeaveStatus; return s.schema === 1 ? s : undefined; } catch { return undefined; }
}

/** A failed build is tried again after this long. */
export const RETRY_MS = 3 * 60_000;

/** The exported record's entries (the deployer's `record.json` is a list of entries, or of [seq, entry] pairs), as far as an ask is read from them. */
export function askEntries(text: string | undefined): AskEntry[] {
  if (text === undefined) return [];
  try {
    const list = JSON.parse(text) as unknown;
    return Array.isArray(list) ? list.map((x) => (Array.isArray(x) ? x[1] : x)).filter((e): e is AskEntry => typeof e === "object" && e !== null && typeof (e as AskEntry).action === "string" && typeof (e as AskEntry).time === "string") : [];
  } catch { return []; }
}

/** The hands: build the shop's file with the owner profile and give back where it was staged (a file this process may read and delete). */
export interface OwnerFileIO { build(shop: string): Promise<{ ok: true; name: string; staged: string; warnings: string[] } | { ok: false; error: string }> }

export async function syncOwnerFiles(o: { dir: string; shops: readonly string[]; now: Date; io: OwnerFileIO }): Promise<string[]> {
  const lines: string[] = [];
  const t = o.now.getTime();
  for (const shop of o.shops) {
    const client = clientDir(o.dir, shop);
    if (!existsSync(client)) continue; // not deployed yet: nothing to hand a file to
    const metaPath = join(client, OWNER_FILE_META);
    const bodyPath = join(client, OWNER_FILE_BODY);
    const entries = askEntries(readText(join(serverPaths(o.dir).root, "exports", shop, "record.json")));
    const status = readLeaveStatus(o.dir, shop);
    const have = status?.file;
    const save = (file: NonNullable<LeaveStatus["file"]>) => writeAtomic(leaveStatusFile(o.dir, shop), `${stableJson({ schema: 1, file })}\n`);
    const drop = () => { rmSync(metaPath, { force: true }); rmSync(bodyPath, { force: true }); };

    // 1. a file that was taken, or ran out, goes at once
    if (have?.state === "ready") {
      if (fileTaken(entries, have.ask)) { drop(); save({ ...have, state: "taken" }); lines.push(`${shop}: the owner took their file; the server's copy is deleted.`); continue; }
      if (t >= Date.parse(have.expiresAt ?? "")) { drop(); save({ ...have, state: "expired" }); lines.push(`${shop}: the owner's file ran out and is deleted.`); continue; }
      if (existsSync(metaPath)) continue; // ready and there: nothing to do (a redeploy that cleared the folder falls through and makes it again)
    }

    // 2. an ask this server has not answered
    const ask = latestAsk(entries, "file");
    if (!ask || fileTaken(entries, ask.id)) continue;
    if (have?.ask === ask.id && (have.state === "taken" || have.state === "expired")) continue;
    if (have?.ask === ask.id && have.state === "problem" && have.triedAt !== undefined && t - Date.parse(have.triedAt) < RETRY_MS) continue;
    const built = await o.io.build(shop);
    if (!built.ok) {
      save({ ask: ask.id, state: "problem", askedAt: ask.at, problem: built.error.slice(0, 300), triedAt: o.now.toISOString() });
      lines.push(`${shop}: the owner's file could not be made yet (${built.error.slice(0, 120)}); it is tried again in a few minutes.`);
      continue;
    }
    const bytes = readFileSync(built.staged);
    rmSync(built.staged, { force: true });
    const expiresAt = new Date(t + FILE_HOURS * 3_600_000).toISOString();
    const meta = { schema: 1, ask: ask.id, id: newOwnerFileId(), name: `${built.name}.tar.gz`, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), madeAt: o.now.toISOString(), expiresAt };
    writeAtomic(bodyPath, bytes, 0o644);
    writeAtomic(metaPath, `${stableJson(meta)}\n`, 0o644); // last: the runtime offers nothing until the meta is there
    save({ ask: ask.id, state: "ready", askedAt: ask.at, madeAt: meta.madeAt, expiresAt });
    lines.push(`${shop}: the owner's file is ready in the shop's own folder (${bytes.length} bytes, until ${expiresAt}).${built.warnings.length > 0 ? ` ${built.warnings.length} warning(s).` : ""}`);
  }
  return lines;
}

const readText = (file: string): string | undefined => { try { return readFileSync(file, "utf8"); } catch { return undefined; } };
/** Folders of staged files the panel leaves beside the shop's own settings (`shops/<shop>/owner-file-staged`): the deployer clears any left over (a build that was never collected). */
export const STAGED = "owner-file-staged.tar.gz";
export const stagedPath = (dir: string, shop: string): string => join(serverPaths(dir).shop(shop), STAGED);
export function clearStale(dir: string, shops: readonly string[]): void { for (const s of shops) rmSync(stagedPath(dir, s), { force: true }); }
