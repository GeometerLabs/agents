// Builds the Bookings demo for the browser: a folder of plain ES modules that a page loads as they are. No bundler, no dependency.
//   npm run build:web-demo --prefix templates/commerce/bookings       (writes templates/commerce/bookings/demo/web/dist/, which git ignores)
//   node templates/commerce/bookings/scripts/build-web-demo.ts [outDir]
//
// The demo's code is NOT copied or rewritten. The same .ts files that run the live agent and the local-network demo are read from where
// they are, and for each one the build
//   1. takes the types out with Node's own module.stripTypeScriptTypes (the very step Node does when it runs the file), keeping every
//      other character as it was;
//   2. changes only the file names in `import ... from "x"`: a relative .ts becomes .js, node:fs and node:crypto become the two small
//      stand-ins in demo/web/shims/ (the only two Node modules the demo uses; any other `node:` makes the build stop).
// Then it writes demo/web/generated.js: the page's own script (demo/page.js), markup (the body of demo/page.ts's page) and stylesheet
// (demo/web/theme.css: its own look for the browser, every rule under .geo-demo and every colour a custom property), and a copy of each
// file the template reads with readFileSync (the example shop's settings), which the fs stand-in serves.
// The template's code imports the shared modules (agents/modules/). The build follows those imports too, and writes them under modules/ in the output, so the
// output has the same two parts: the template's own folders (src/, demo/) and modules/. Nothing else outside templates/commerce/bookings is followed.
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { renderPage } from "../demo/page.ts";

const ROOT = resolve(import.meta.dirname, ".."); // templates/commerce/bookings
export const DEFAULT_OUT = join(ROOT, "demo/web/dist");
const ENTRY = "demo/web/mount.ts";
const GENERATED = "demo/web/generated.js";
const SHIMS: Record<string, string> = { "node:fs": "demo/web/shims/fs.ts", "node:crypto": "demo/web/shims/crypto.ts" };
const MARKER = "geometer-bookings-web-demo"; // the name in the output's package.json: the build only ever deletes a folder it made

// `from "x"`, `import "x"` and `import("x")`, after the types have been taken out
const SPECIFIER = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])([^"'\n]+)\2/g;
/** True when `offset` is on a line that is a comment (this codebase writes comments as whole lines), so a sentence in one that looks like an import is left alone. */
const inComment = (code: string, offset: number) => /^\s*(\/\/|\/\*|\*)/.test(code.slice(code.lastIndexOf("\n", offset - 1) + 1, offset + 1));
const READ_FILE = /\breadFileSync\(\s*new URL\(\s*"([^"\n]+)"\s*,\s*import\.meta\.url\s*\)\s*,/g;

// ---- the page's own parts --------------------------------------------------------------------------------------------------------

/** The page's markup: what the server demo sends between <body> and its script, without the "needs JavaScript" notice. */
function pageMarkup(): string {
  const html = renderPage("x");
  const start = html.indexOf("<body>");
  const end = html.indexOf('<script nonce="x">');
  if (start === -1 || end === -1 || end < start) throw new Error("demo/page.ts no longer has a <body> followed by its script: the build cannot take its markup.");
  const markup = html.slice(start + "<body>".length, end).replace(/<noscript>[\s\S]*?<\/noscript>/, "").trim();
  if (!markup.includes('id="banner"') || /<script/i.test(markup)) throw new Error("The page's markup is not what the build expects.");
  return markup;
}

// ---- the modules ---------------------------------------------------------------------------------------------------------------------

/** A file of the shared modules, as the build names its source: relative to templates/commerce/bookings, so it starts with ../../../../modules */
const MODULES_PREFIX = "../../../../modules/";
/** Where a source file lands in the output: the template's own files keep their place, the shared modules go under modules/. */
const outPath = (source: string) => (source.startsWith(MODULES_PREFIX) ? source.slice(MODULES_PREFIX.length - "modules/".length) : source).replace(/\.ts$/, ".js");
const specifierBetween = (fromOut: string, toOut: string): string => {
  const rel = posix.relative(posix.dirname(fromOut), toOut);
  return rel.startsWith(".") ? rel : `./${rel}`;
};

export interface BuildResult {
  outDir: string;
  /** Every file written, relative to outDir. */
  files: string[];
  bytes: number;
  /** Each file gzipped on its own, added up: what a server that compresses each response sends. */
  gzipBytes: number;
}

export function buildWebDemo(outDir: string = DEFAULT_OUT): BuildResult {
  const out = resolve(outDir);
  let existing: string[] = [];
  try { existing = readdirSync(out); } catch (e) { if ((e as { code?: string }).code !== "ENOENT") throw e; }
  if (existing.length > 0) {
    let name: unknown;
    try { name = JSON.parse(readFileSync(join(out, "package.json"), "utf8")).name; } catch { /* not one of ours */ }
    if (name !== MARKER) throw new Error(`${out} already holds other files. The build writes only into an empty folder or its own earlier output.`);
  }

  const modules = new Map<string, string>(); // output path (relative to the folder) -> source text
  const inlined = new Map<string, string>(); // a file the template reads -> its text
  const pending = [ENTRY];
  const seen = new Set<string>();
  while (pending.length > 0) {
    const source = pending.pop()!;
    if (seen.has(source)) continue;
    seen.add(source);
    const file = join(ROOT, source);
    const stripped = stripTypeScriptTypes(readFileSync(file, "utf8"), { mode: "strip" });
    const here = outPath(source);

    let takesFs = false;
    const code = stripped.replace(SPECIFIER, (all, lead: string, quote: string, specifier: string, offset: number, whole: string) => {
      if (inComment(whole, offset)) return all;
      let target: string;
      let written: string | undefined; // the name to write instead, when it is not just the old one ending in .js
      if (specifier === "node:fs") takesFs = true;
      if (specifier.startsWith("node:")) {
        if (!SHIMS[specifier]) throw new Error(`${source} imports ${specifier}, which the browser build has no stand-in for. Add one to demo/web/shims/ (or take the import out of the demo's code).`);
        target = SHIMS[specifier];
        written = specifierBetween(here, outPath(target));
      } else if (specifier.startsWith(".")) {
        target = posix.normalize(posix.join(posix.dirname(source), specifier));
        if (target === GENERATED) return all.replace(specifier, specifierBetween(here, GENERATED));
        if (!target.endsWith(".ts")) throw new Error(`${source} imports ${specifier}: the browser build follows only .ts files (and ${GENERATED}).`);
        if (target.startsWith("..") && !target.startsWith(MODULES_PREFIX)) throw new Error(`${source} imports ${specifier}, which is outside templates/commerce/bookings and the shared modules.`);
        if (source.startsWith(MODULES_PREFIX) && !target.startsWith(MODULES_PREFIX)) throw new Error(`${source} imports ${specifier}: the shared modules must not import a template.`);
        // The template's files keep their place in the output and the modules go under modules/, so a template's import of a module is written from the output's layout.
        if (target.startsWith(MODULES_PREFIX) && !source.startsWith(MODULES_PREFIX)) written = specifierBetween(here, outPath(target));
      } else {
        throw new Error(`${source} imports "${specifier}": the demo has no dependencies, so there is nothing to bundle.`);
      }
      pending.push(target);
      return `${lead}${quote}${written ?? specifier.replace(/\.ts$/, ".js")}${quote}`;
    });
    if (/\bimport\s*\(\s*[^"')\s]/.test(code)) throw new Error(`${source} has an import() the build cannot follow.`);

    // A module that takes readFileSync from node:fs may read only files named in the code, so the build can copy them.
    if (takesFs) {
      const named = [...stripped.matchAll(READ_FILE)];
      const calls = stripped.match(/\breadFileSync\(/g)?.length ?? 0;
      if (named.length !== calls) throw new Error(`${source} calls readFileSync in a way the build cannot copy: use readFileSync(new URL("relative/path", import.meta.url), "utf8").`);
      for (const m of named) {
        const target = relative(ROOT, resolve(dirname(file), m[1]));
        if (target.startsWith("..")) throw new Error(`${source} reads ${m[1]}, which is outside templates/commerce/bookings.`);
        inlined.set(target.split(sep).join("/"), readFileSync(join(ROOT, target), "utf8"));
      }
    }
    modules.set(here, code);
  }

  const css = `${readFileSync(join(ROOT, "demo/web/theme.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\n\s*\n/g, "\n").trim()}\n`;
  const generated = [
    "// Written by scripts/build-web-demo.ts from demo/page.js, demo/page.ts, demo/web/theme.css and the files the template reads.",
    "// Do not edit: build again.",
    `export const MARKUP = ${JSON.stringify(pageMarkup())};`,
    `export const CSS = ${JSON.stringify(css)};`,
    `export const INLINE_FILES = ${JSON.stringify(Object.fromEntries(inlined), null, 2)};`,
    "// The page's own script, as it is served by the local-network demo, with the browser's page, window, fetch and timers handed in.",
    "export function startPage(document, window, fetch, setTimeout, clearTimeout) {",
    readFileSync(join(ROOT, "demo/page.js"), "utf8"),
    "}",
    "",
  ].join("\n");
  modules.set(GENERATED, generated);
  modules.set("index.js", `export { mountDemo } from "./${outPath(ENTRY)}";\n`);
  modules.set("package.json", `${JSON.stringify({ name: MARKER, private: true, type: "module", description: "Built by scripts/build-web-demo.ts. Do not edit." }, null, 2)}\n`);

  rmSync(out, { recursive: true, force: true });
  let bytes = 0;
  let gzipBytes = 0;
  for (const [path, text] of modules) {
    const target = join(out, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
    bytes += Buffer.byteLength(text);
    gzipBytes += gzipSync(text).length;
  }
  return { outDir: out, files: [...modules.keys()].sort(), bytes, gzipBytes };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = buildWebDemo(process.argv[2]);
  console.log(`Built the browser demo: ${result.files.length} files, ${result.bytes} bytes (${result.gzipBytes} gzipped) in ${result.outDir}`);
  console.log("Open demo/web/index.html over http (for example  python3 -m http.server --directory templates/commerce/bookings/demo/web ), not from a file:// address.");
}
