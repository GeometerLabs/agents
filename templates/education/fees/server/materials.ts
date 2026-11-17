// Classes' reading material: the teacher's own files, on the centre's own server, handed out by the shop's front on a private page (modules/channels/front-fees.ts, the
// "/m/<batch>" route of a parent's private link). This is the only place Classes reads the disk, so the agent's import graph stays clean (the browser demo is built from it).
//
// Layout: <the centre's folder>/materials/<batch id>/<file>. The teacher (or the Operator) puts a file in the batch's folder and it is there; takes it out and it is gone.
// There is no list to keep in sync, and nothing the page asks for is ever turned into a path: a request names a batch (checked against the settings first) and a file by an
// id that is the hash of a name found in that folder by listing it now. So a request cannot reach a file the listing did not show, nor anything outside the folder.
//
// What is handed out: only regular files (never a link or a folder), only these kinds (a PDF, a picture, a text or an Office file), each no larger than the centre's limit
// (settings classes.materialMaxMb). A larger file is not listed, and the page says how many were left out. A file goes as a download with its own type and "nosniff", so a
// browser never runs it. The teacher shares only material they have the right to share (docs/product/education-experiment.md); nothing here checks that.
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** The kinds handed out, by extension, with the type the download carries. */
export const MATERIAL_TYPES: Record<string, string> = {
  pdf: "application/pdf", txt: "text/plain; charset=utf-8", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export interface MaterialFile { id: string; name: string; bytes: number; type: string }
export interface MaterialList { files: MaterialFile[]; /** Files in the folder that are not handed out: too large, or a kind that is not allowed. */ left: number }
export interface MaterialDownload { name: string; type: string; bytes: Buffer }

export interface Materials {
  list(batchId: string): MaterialList;
  /** The file with this id in the batch's folder, or undefined. The id is looked up in a fresh listing; it is never a path. */
  read(batchId: string, fileId: string): MaterialDownload | undefined;
}

const BATCH = /^[a-z0-9-]+$/u;
const idOf = (name: string): string => createHash("sha256").update(name).digest("hex").slice(0, 12);

/** `dir` is the centre's materials folder; `maxBytes` the largest file handed out. A folder that does not exist is simply empty. */
export function createMaterials(dir: string, maxBytes: number): Materials {
  function scan(batchId: string): { files: (MaterialFile & { path: string })[]; left: number } {
    if (!BATCH.test(batchId)) return { files: [], left: 0 };
    const folder = join(dir, batchId);
    let names: string[];
    try { names = readdirSync(folder).sort(); } catch { return { files: [], left: 0 }; }
    const files: (MaterialFile & { path: string })[] = [];
    let left = 0;
    for (const name of names) {
      if (name.startsWith(".")) continue;
      const path = join(folder, name);
      const type = MATERIAL_TYPES[(name.split(".").pop() ?? "").toLowerCase()];
      let stat;
      try { stat = lstatSync(path); } catch { continue; }
      if (!stat.isFile()) continue; // a link or a folder is never handed out
      if (!type || stat.size > maxBytes || stat.size === 0) { left++; continue; }
      files.push({ id: idOf(name), name, bytes: stat.size, type, path });
    }
    return { files, left };
  }
  return {
    list(batchId) { const { files, left } = scan(batchId); return { files: files.map(({ path: _path, ...file }) => file), left }; },
    read(batchId, fileId) {
      const found = scan(batchId).files.find((f) => f.id === fileId);
      if (!found) return undefined;
      try { return { name: found.name, type: found.type, bytes: readFileSync(found.path) }; } catch { return undefined; }
    },
  };
}
