// Stand-in for the one thing a template takes from node:fs, for the browser demos of the templates that have no page of their own to carry it (Orders, Fees).
// The build points `node:fs` here. A template reads its example shop with readFileSync(new URL("...", import.meta.url)); a browser has no files, so the build
// copies every file read that way into ../inline-files.js and this finds it by the end of its path. Anything the build did not copy is an error, as a missing file is.
import { INLINE_FILES } from "../inline-files.js"; // written by scripts/build-web-demo.ts (collectModules); it is not in the source tree

export function readFileSync(path: string | URL, encoding?: string): string {
  if (encoding !== "utf8" && encoding !== "utf-8") throw new Error("The browser build can read the copied files as text only: pass \"utf8\".");
  const where = path instanceof URL ? path.pathname : String(path);
  const found = Object.keys(INLINE_FILES).filter((key) => where === key || where.endsWith(`/${key}`)).sort((a, b) => b.length - a.length)[0];
  if (found === undefined) throw Object.assign(new Error(`ENOENT: the browser build has no copy of ${where}`), { code: "ENOENT" });
  return INLINE_FILES[found];
}
