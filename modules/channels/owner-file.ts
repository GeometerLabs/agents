// The owner's file, the shared part (block S, "Get my shop's file", 18 Nov 2026): what the server hands the shop's runtime, and what the runtime says about it. Used by the
// deployer (bundle/lib/owner-file.ts), which makes the file with the owner profile and copies two files into the shop's client folder, by the runtime (runtime/owner-file.ts),
// which checks them and serves the bytes to the owner's SESSION once, and by the owner's page, which shows the state.
//
//   owner-file.json     {"schema":1,"ask":"ask_...","id":"<token>","name":"<shop>-shop-file-20261118.tar.gz","bytes":N,"sha256":"...","madeAt","expiresAt"}
//   owner-file.tar.gz   the package itself (bundle/export/build.ts, owner profile)
//
// The `id` is the link's last part. It is a random token, but it is not what keeps the file safe: the runtime serves it only to a signed-in owner's session (never to the
// panel's link, which the Operator made), once, and before it expires. The id only makes sure one link means one file, and that an old link never opens a newer file.
// No customer name or number is in the file as itself (the owner profile keeps the record's keyed fingerprints), and no key or secret is in it at all.
import { randomBytes } from "node:crypto";

export const OWNER_FILE_META = "owner-file.json";
export const OWNER_FILE_BODY = "owner-file.tar.gz";
export const OWNER_FILE_ID = /^[A-Za-z0-9_-]{32,64}$/u;
export const newOwnerFileId = (): string => randomBytes(24).toString("base64url");

export interface OwnerFileMeta { schema: 1; ask: string; id: string; name: string; bytes: number; sha256: string; madeAt: string; expiresAt: string }

const isTime = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));
/** The meta file's content, field by field; anything that does not read is no file (a broken meta offers nothing to anyone). */
export function readOwnerFileMeta(text: string | undefined): OwnerFileMeta | undefined {
  if (text === undefined) return undefined;
  let f: Record<string, unknown>;
  try { f = JSON.parse(text) as Record<string, unknown>; } catch { return undefined; }
  if (typeof f !== "object" || f === null || f.schema !== 1) return undefined;
  const { ask, id, name, bytes, sha256, madeAt, expiresAt } = f;
  if (typeof ask !== "string" || typeof id !== "string" || !OWNER_FILE_ID.test(id) || typeof name !== "string" || !/^[A-Za-z0-9._-]{1,120}$/u.test(name)) return undefined;
  if (typeof bytes !== "number" || !Number.isSafeInteger(bytes) || bytes <= 0 || typeof sha256 !== "string" || !/^[0-9a-f]{64}$/u.test(sha256) || !isTime(madeAt) || !isTime(expiresAt)) return undefined;
  return { schema: 1, ask, id, name, bytes, sha256, madeAt, expiresAt };
}

/** What the owner's page shows: nothing, a file ready to take (until when), or one that was taken or ran out (a new ask makes a new one). */
export type OwnerFileState = { state: "none" } | { state: "ready"; id: string; name: string; bytes: number; expiresAt: string } | { state: "taken" } | { state: "expired" };

export function ownerFileState(meta: OwnerFileMeta | undefined, used: ReadonlySet<string>, nowMs: number): OwnerFileState {
  if (!meta) return { state: "none" };
  if (used.has(meta.id)) return { state: "taken" };
  if (nowMs >= Date.parse(meta.expiresAt)) return { state: "expired" };
  return { state: "ready", id: meta.id, name: meta.name, bytes: meta.bytes, expiresAt: meta.expiresAt };
}
