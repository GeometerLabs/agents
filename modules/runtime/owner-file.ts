// The runtime's side of "Get my shop's file" (block S): looks at the two files the deployer copied into the shop's client folder (modules/channels/owner-file.ts), says what
// state the owner's file is in, and gives the bytes to the owner's session ONCE. Reads only this shop's own client folder and data folder; it never looks at another shop.
//
// One use: the id is written to a small file in the shop's data folder BEFORE the bytes are returned, so a dropped connection cannot make a second try work (the owner asks
// again and gets a new file). The file's hash is checked against the meta first, so a half-copied file is never handed over as the owner's. This file cannot delete the
// server's copy (the client folder is read-only here); the record's "owner_file_taken" line, which the http layer asks for, tells the deployer to.
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { OWNER_FILE_BODY, OWNER_FILE_META, ownerFileState, readOwnerFileMeta } from "../channels/owner-file.ts";
import type { OwnerFileMeta, OwnerFileState } from "../channels/owner-file.ts";

export const OWNER_FILE_USED = "owner-file-used.json";

export interface OwnerFileStore {
  state(): OwnerFileState;
  /** The bytes for this id, once; undefined when the id is not the file now, it was taken, it ran out, or the bytes do not match. */
  take(id: string): { meta: OwnerFileMeta; bytes: Buffer } | undefined;
}

export function openOwnerFile(o: { clientFolder: string; dataDir: string; now: () => number }): OwnerFileStore {
  const usedFile = join(o.dataDir, OWNER_FILE_USED);
  const used = (): Set<string> => { try { return new Set(JSON.parse(readFileSync(usedFile, "utf8")) as string[]); } catch { return new Set(); } };
  const meta = () => { try { return readOwnerFileMeta(readFileSync(join(o.clientFolder, OWNER_FILE_META), "utf8")); } catch { return undefined; } };
  return {
    state: () => ownerFileState(meta(), used(), o.now()),
    take(id) {
      const m = meta();
      if (!m || m.id !== id || ownerFileState(m, used(), o.now()).state !== "ready") return undefined;
      const body = join(o.clientFolder, OWNER_FILE_BODY);
      if (!existsSync(body)) return undefined;
      const bytes = readFileSync(body);
      if (bytes.length !== m.bytes || createHash("sha256").update(bytes).digest("hex") !== m.sha256) return undefined;
      const now = used();
      now.add(id);
      writeFileSync(`${usedFile}.tmp`, JSON.stringify([...now].slice(-50)), { mode: 0o600 });
      renameSync(`${usedFile}.tmp`, usedFile);
      return { meta: m, bytes };
    },
  };
}
