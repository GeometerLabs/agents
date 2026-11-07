// Stand-in for the one thing the template takes from node:fs, for the browser build. The build points `node:fs` here.
//
// The template reads its example shop (settings/glow-salon.example.json) with readFileSync(new URL("...", import.meta.url)). A
// browser has no files to read, so the build copies every file the template reads this way into ./generated.js, and this finds it
// by the end of its path. Anything the build did not copy is an error, the same as a file that is missing.
import { INLINE_FILES } from "../generated.js"; // written by scripts/build-web-demo.ts; it is not in the source tree

export function readFileSync(path: string | URL, encoding?: string): string {
  if (encoding !== "utf8" && encoding !== "utf-8") throw new Error("The browser build can read the copied files as text only: pass \"utf8\".");
  const where = path instanceof URL ? path.pathname : String(path);
  const found = Object.keys(INLINE_FILES).filter((key) => where === key || where.endsWith(`/${key}`)).sort((a, b) => b.length - a.length)[0];
  if (found === undefined) throw Object.assign(new Error(`ENOENT: the browser build has no copy of ${where}`), { code: "ENOENT" });
  return INLINE_FILES[found];
}
