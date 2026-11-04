// Builds the Bookings demo for the browser: a folder of plain ES modules that a page loads as they are. No bundler, no dependency.
//   npm run build:web-demo --prefix pathways/bookings       (writes pathways/bookings/demo/web/dist/, which git ignores)
//   node pathways/bookings/scripts/build-web-demo.ts [outDir]
//
// The demo's code is NOT copied or rewritten. The same .ts files that run the live agent and the local-network demo are read from where
// they are, and for each one the build
//   1. takes the types out with Node's own module.stripTypeScriptTypes (the very step Node does when it runs the file), keeping every
//      other character as it was;
//   2. changes only the file names in `import ... from "x"`: a relative .ts becomes .js, node:fs and node:crypto become the two small
//      stand-ins in demo/web/shims/ (the only two Node modules the demo uses; any other `node:` makes the build stop).
// Then it writes demo/web/generated.js: the page's own script (demo/page.js), markup (the body of demo/page.ts's page) and stylesheet
// (demo/page.css with every rule moved under .geo-demo, then demo/web/embed.css), and a copy of each file the template reads with
// readFileSync (the example shop's settings), which the fs stand-in serves.
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { renderPage } from "../demo/page.ts";

const ROOT = resolve(import.meta.dirname, ".."); // pathways/bookings
export const DEFAULT_OUT = join(ROOT, "demo/web/dist");
export const ROOT_CLASS = "geo-demo";
const ENTRY = "demo/web/mount.ts";
const GENERATED = "demo/web/generated.js";
const SHIMS: Record<string, string> = { "node:fs": "demo/web/shims/fs.ts", "node:crypto": "demo/web/shims/crypto.ts" };
const MARKER = "geometer-bookings-web-demo"; // the name in the output's package.json: the build only ever deletes a folder it made

// `from "x"`, `import "x"` and `import("x")`, after the types have been taken out
const SPECIFIER = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])([^"'\n]+)\2/g;
/** True when `offset` is on a line that is a comment (this codebase writes comments as whole lines), so a sentence in one that looks like an import is left alone. */
const inComment = (code: string, offset: number) => /^\s*(\/\/|\/\*|\*)/.test(code.slice(code.lastIndexOf("\n", offset - 1) + 1, offset + 1));
const READ_FILE = /\breadFileSync\(\s*new URL\(\s*"([^"\n]+)"\s*,\s*import\.meta\.url\s*\)\s*,/g;

// ---- the stylesheet ------------------------------------------------------------------------------------------------------------

function splitSelectors(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (c === "," && depth === 0) { parts.push(list.slice(start, i)); start = i + 1; }
  }
  parts.push(list.slice(start));
  return parts.map((s) => s.trim()).filter(Boolean);
}

/**
 * Moves every rule of a stylesheet under one root class, so it cannot reach the page around it: `:root`, `html` and `body` become the
 * root itself, `*` becomes the root and everything in it, and every other selector gets the root in front. Handles plain rules and
 * @media blocks (all page.css has); anything else stops the build rather than leaking.
 */
export function scopeCss(css: string, root = `.${ROOT_CLASS}`): string {
  const scopeOne = (selector: string): string[] => {
    if (selector === "*") return [root, `${root} *`];
    const top = /^(html|body|:root)(?![\w-])/.exec(selector);
    return top ? [root + selector.slice(top[0].length)] : [`${root} ${selector}`];
  };
  const walk = (text: string): string => {
    let out = "";
    let at = 0;
    while (at < text.length) {
      const open = text.indexOf("{", at);
      if (open === -1) {
        if (text.slice(at).trim() !== "") throw new Error(`The stylesheet has text outside any rule: ${text.slice(at).trim().slice(0, 40)}`);
        break;
      }
      let depth = 1;
      let close = open + 1;
      for (; close < text.length && depth > 0; close++) depth += text[close] === "{" ? 1 : text[close] === "}" ? -1 : 0;
      if (depth !== 0) throw new Error("The stylesheet has a { without its }.");
      const head = text.slice(at, open).trim();
      const inner = text.slice(open + 1, close - 1);
      if (head.startsWith("@media")) out += `${head} {\n${walk(inner)}}\n`;
      else if (head.startsWith("@")) throw new Error(`The stylesheet uses ${head.split(/\s/)[0]}, which the scoping does not handle.`);
      else out += `${splitSelectors(head).flatMap(scopeOne).join(",\n")} {${inner}}\n`;
      at = close;
    }
    return out;
  };
  return walk(css.replace(/\/\*[\s\S]*?\*\//g, ""));
}

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

const outPath = (source: string) => source.replace(/\.ts$/, ".js");
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
        if (target.startsWith("..")) throw new Error(`${source} imports ${specifier}, which is outside pathways/bookings.`);
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
        if (target.startsWith("..")) throw new Error(`${source} reads ${m[1]}, which is outside pathways/bookings.`);
        inlined.set(target.split(sep).join("/"), readFileSync(join(ROOT, target), "utf8"));
      }
    }
    modules.set(here, code);
  }

  const css = `.${ROOT_CLASS} { all: initial; }\n${scopeCss(readFileSync(join(ROOT, "demo/page.css"), "utf8"))}${readFileSync(join(ROOT, "demo/web/embed.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").trim()}\n`;
  const generated = [
    "// Written by scripts/build-web-demo.ts from demo/page.js, demo/page.ts, demo/page.css, demo/web/embed.css and the files the template reads.",
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
  console.log("Open demo/web/index.html over http (for example  python3 -m http.server --directory pathways/bookings/demo/web ), not from a file:// address.");
}
