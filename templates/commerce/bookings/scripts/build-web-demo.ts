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
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { renderPage } from "../demo/page.ts";
import { collectModules, outPath } from "../../../../scripts/web-modules.ts";

const ROOT = resolve(import.meta.dirname, ".."); // templates/commerce/bookings
export const DEFAULT_OUT = join(ROOT, "demo/web/dist");
const ENTRY = "demo/web/mount.ts";
const GENERATED = "demo/web/generated.js";
const SHIMS: Record<string, string> = { "node:fs": "demo/web/shims/fs.ts", "node:crypto": "demo/web/shims/crypto.ts" };
const MARKER = "geometer-bookings-web-demo"; // the name in the output's package.json: the build only ever deletes a folder it made

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

// ---- the modules: followed and written by scripts/web-modules.ts -------------------------------------------------------------------

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

  const { modules, inlined } = collectModules({ root: ROOT, entry: ENTRY, shims: SHIMS, generated: [GENERATED] });

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
