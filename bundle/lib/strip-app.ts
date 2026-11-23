// The app's TypeScript, stripped to JavaScript once per deploy instead of at every process start (24 Nov 2026, stream N1, item 1).
//
// Why: the server's seven Node processes (door, inbox, relay, refresher, push, ops, the panel) ran `.ts` files, so each start read every file, stripped its types
// and kept both the source and the stripped text in memory. Here the stripping is done once, with Node's own `module.stripTypeScriptTypes` (built in, no download), into a
// folder the containers mount as /app (generate/compose.ts `Dirs.appJs`). The repository stays TypeScript; tests and the checkout are untouched.
//
// What the output is: a mirror of the folders the services reach (APP_FOLDERS) with, beside every `.ts` file, its `.js` twin. The `.ts` file is copied too, because the
// `docker compose exec ... node /app/bundle/panel/main.ts export ...` commands of the CLI still name `.ts` files (they run rarely, so they may strip at start). Every other
// file (JSON, CSS, a template's data) is copied as it is, because the code reads some of them next to itself (import.meta.url) and the panel reads /app/templates.
// Test files and test folders are left out: nothing a service imports lives there (the unit test of this file imports every service's whole graph from the output to prove it).
//
// Positions: mode "strip" blanks the types with spaces and keeps every line and column, so a stack trace in a `.js` file points at the same line and column of the `.ts`
// file. Because of that NO source map is shipped (it would only carry the identity mapping, and loading it costs memory at every start).
//
// The only text rewritten is the specifier of a relative import: "./x.ts" becomes "./x.js" (Node does not rewrite them, and the `.ts` twin would be stripped again at start).
//
// In place, not replace: a container holds the folder it was started on, so a rebuild writes only the files whose bytes changed and removes files that are gone, and keeps
// the folder itself. A manifest of source sizes and times makes an unchanged checkout cost one walk of the tree and no stripping.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { stripTypeScriptTypes } from "node:module";

/** The top folders of a checkout the services reach (the closure of services/*.ts and panel/main.ts is under these, checked by the unit test). */
export const APP_FOLDERS: readonly string[] = ["bundle", "modules", "companies", "templates", "specs", "prices"];
const MANIFEST = ".strip-manifest.json";
/** Bump to make every file be stripped again (a change to how this file rewrites). */
const MANIFEST_VERSION = 1;
/**
 * Folders that are named like tests but that a service imports, kept: modules/test holds the shared process starter, the test clock's file and the fake model that the panel's
 * go-live hand check runs each situation with (modules/crash-test/go-shop.ts, go-world.ts; 24 Nov 2026). The unit test of this file proves the panel's graph is whole.
 */
const KEPT_TEST_FOLDERS: readonly string[] = [join("modules", "test")];
/** A folder or file the output does not need: tests (never imported by a service) and the checkout's own noise. `rel` is the folder's path in the checkout. */
const skipped = (name: string, isDir: boolean, rel: string): boolean => (isDir ? (name === "test" || name === "tests" || name === "node_modules" || name === ".git") && !KEPT_TEST_FOLDERS.includes(rel) : /\.test\.ts$/u.test(name) || name === ".DS_Store" || /\.d\.ts$/u.test(name));

/** `./x.ts` to `./x.js` in the specifier of an import, an export-from, a side-effect import and a dynamic import(); nothing else in the text is touched. */
export function rewriteSpecifiers(code: string): string {
  return code.replace(/(\b(?:from|import)\s*\(?\s*)(["'])(\.{1,2}\/[^"'\n]*?)\.ts\2/gu, "$1$2$3.js$2");
}

/** One file's TypeScript as JavaScript: types blanked in place (same lines and columns), relative `.ts` specifiers pointing at the `.js` twins. */
export function stripFile(source: string): string {
  return rewriteSpecifiers(stripTypeScriptTypes(source, { mode: "strip" }));
}

export interface StripResult { written: number; removed: number; unchanged: number; stripped: number }

function* walk(root: string, dir: string): Generator<string> {
  for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
    const rel = join(dir, e.name);
    if (skipped(e.name, e.isDirectory(), rel)) continue;
    if (e.isDirectory()) yield* walk(root, rel);
    else if (e.isFile()) yield rel;
  }
}

function writeIfChanged(path: string, data: string | Buffer): boolean {
  if (existsSync(path)) {
    const old = readFileSync(path);
    if (old.equals(typeof data === "string" ? Buffer.from(data) : data)) return false;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
  return true;
}

/**
 * Mirror `from` (a checkout) into `to` as described at the top. Returns what it did. A `.ts` file that Node cannot strip (it uses a TypeScript-only feature such as an enum)
 * stops the build with its name: such a file could not run under Node's own stripping either.
 */
export function buildAppJs(from: string, to: string, folders: readonly string[] = APP_FOLDERS): StripResult {
  const result: StripResult = { written: 0, removed: 0, unchanged: 0, stripped: 0 };
  const manifestPath = join(to, MANIFEST);
  let old: Record<string, string> = {};
  try { const m = JSON.parse(readFileSync(manifestPath, "utf8")) as { v?: number; files?: Record<string, string> }; if (m.v === MANIFEST_VERSION && m.files) old = m.files; } catch { /* first build */ }
  const now: Record<string, string> = {};
  mkdirSync(to, { recursive: true });
  for (const top of folders) {
    if (!existsSync(join(from, top))) continue;
    for (const rel of walk(from, top)) {
      const src = join(from, rel);
      const st = statSync(src);
      const stamp = `${st.size}:${Math.round(st.mtimeMs)}`;
      now[rel] = stamp;
      const isTs = rel.endsWith(".ts");
      const outputs = isTs ? [rel, `${rel.slice(0, -3)}.js`] : [rel];
      if (old[rel] === stamp && outputs.every((o) => existsSync(join(to, o)))) { result.unchanged += 1; continue; }
      const bytes = readFileSync(src);
      if (writeIfChanged(join(to, rel), bytes)) result.written += 1;
      if (isTs) {
        let js: string;
        try { js = stripFile(bytes.toString("utf8")); } catch (e) { throw new Error(`${rel} cannot be stripped of its types: ${(e as Error).message}`); }
        result.stripped += 1;
        if (writeIfChanged(join(to, outputs[1]), js)) result.written += 1;
      }
    }
  }
  // files that are no longer in the checkout (or no longer wanted) go, with their `.js` twins
  for (const top of folders) {
    if (!existsSync(join(to, top))) continue;
    for (const rel of walk(to, top)) {
      const source = rel.endsWith(".js") && now[`${rel.slice(0, -3)}.ts`] !== undefined ? `${rel.slice(0, -3)}.ts` : rel;
      if (now[source] === undefined && !(rel.endsWith(".js") && now[rel] !== undefined)) { rmSync(join(to, rel)); result.removed += 1; }
    }
  }
  writeFileSync(manifestPath, JSON.stringify({ v: MANIFEST_VERSION, files: now }));
  return result;
}

/** `node bundle/lib/strip-app.ts <checkout> <output folder>`: the same build by hand (the deployer calls buildAppJs itself). */
if (import.meta.main) {
  const [from, to] = process.argv.slice(2);
  if (!from || !to) { console.error("usage: node bundle/lib/strip-app.ts <checkout> <output folder>"); process.exit(2); }
  const r = buildAppJs(from, to);
  console.log(`${r.stripped} files stripped, ${r.written} written, ${r.unchanged} unchanged, ${r.removed} removed (${relative(process.cwd(), to) || to})`);
}
