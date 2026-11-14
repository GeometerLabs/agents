// The part of "build a template's demo for the browser" that every template shares: follow the entry file's imports, take the types out of each file with Node's own
// module.stripTypeScriptTypes, change only the file names in `import ... from "x"` (a relative .ts becomes .js; node:fs and node:crypto become the small stand-ins),
// and hand back the text of every module. It writes nothing; the callers (templates/commerce/bookings/scripts/build-web-demo.ts, scripts/build-demo.ts) add their own
// files and write the folder. It was written for Bookings first and moved here, unchanged in what it does, so Orders and Fees do not carry a second copy.
//
// The code is NOT copied or rewritten: the same .ts files that run the live agent are read from where they are. A template's own files keep their place in the output
// and the shared modules (agents/modules/) go under modules/. Nothing else outside the template is followed, and a shared module may never import a template.
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { dirname, join, posix, relative, resolve, sep } from "node:path";

// `from "x"`, `import "x"` and `import("x")`, after the types have been taken out
// (a `from` right after a quote or a dot is a word inside a string or a property, as in the message `"from": "12:00"`, never an import)
const SPECIFIER = /((?<![\w"'.])from\s*|\bimport\s*\(\s*|\bimport\s+)(["'])([^"'\n]+)\2/g;
/** True when `offset` is on a line that is a comment (this codebase writes comments as whole lines), so a sentence in one that looks like an import is left alone. */
const inComment = (code: string, offset: number) => /^\s*(\/\/|\/\*|\*)/.test(code.slice(code.lastIndexOf("\n", offset - 1) + 1, offset + 1));
const READ_FILE = /\breadFileSync\(\s*new URL\(\s*"([^"\n]+)"\s*,\s*import\.meta\.url\s*\)\s*,/g;

/** A file of the shared modules, as the build names its source: relative to a template's folder (two folders under templates/), so it starts with ../../../modules */
export const MODULES_PREFIX = "../../../modules/";
/** Where a source file lands in the output: the template's own files keep their place, the shared modules go under modules/. */
export const outPath = (source: string) => (source.startsWith(MODULES_PREFIX) ? source.slice(MODULES_PREFIX.length - "modules/".length) : source).replace(/\.ts$/, ".js");
export const specifierBetween = (fromOut: string, toOut: string): string => {
  const rel = posix.relative(posix.dirname(fromOut), toOut);
  return rel.startsWith(".") ? rel : `./${rel}`;
};

export interface CollectOptions {
  /** The template's folder (templates/<domain>/<name>). */
  root: string;
  /** The first file (or files), relative to root. */
  entry: string | string[];
  /** What `node:fs` and `node:crypto` become, as sources relative to root. */
  shims: Record<string, string>;
  /** Files the build writes itself (not .ts), that a followed file may import: sources relative to root, as an import reaches them (for example "demo/web/generated.js"). */
  generated: readonly string[];
}

export interface Collected {
  /** Output path (relative to the output folder) -> the module's text. */
  modules: Map<string, string>;
  /** A file the template reads with readFileSync -> its text, for the fs stand-in. Keyed by the path relative to root. */
  inlined: Map<string, string>;
}

export function collectModules(o: CollectOptions): Collected {
  const { root, entry, shims, generated } = o;
  const modules = new Map<string, string>();
  const inlined = new Map<string, string>();
  const pending = [entry].flat();
  const seen = new Set<string>();
  while (pending.length > 0) {
    const source = pending.pop()!;
    if (seen.has(source)) continue;
    seen.add(source);
    const file = join(root, source);
    const stripped = stripTypeScriptTypes(readFileSync(file, "utf8"), { mode: "strip" });
    const here = outPath(source);

    let takesFs = false;
    const code = stripped.replace(SPECIFIER, (all, lead: string, quote: string, specifier: string, offset: number, whole: string) => {
      if (inComment(whole, offset)) return all;
      let target: string;
      let written: string | undefined; // the name to write instead, when it is not just the old one ending in .js
      if (specifier === "node:fs") takesFs = true;
      if (specifier.startsWith("node:")) {
        if (!shims[specifier]) throw new Error(`${source} imports ${specifier}, which the browser build has no stand-in for. Add one to modules/demo/shims/ (or take the import out of the demo's code).`);
        target = shims[specifier];
        written = specifierBetween(here, outPath(target));
      } else if (specifier.startsWith(".")) {
        target = posix.normalize(posix.join(posix.dirname(source), specifier));
        if (generated.includes(target)) return all.replace(specifier, specifierBetween(here, outPath(target)));
        if (!target.endsWith(".ts")) throw new Error(`${source} imports ${specifier}: the browser build follows only .ts files (and ${generated.join(", ") || "nothing it writes itself"}).`);
        if (target.startsWith("..") && !target.startsWith(MODULES_PREFIX)) throw new Error(`${source} imports ${specifier}, which is outside the template and the shared modules.`);
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
        const target = relative(root, resolve(dirname(file), m[1]));
        if (target.startsWith("..")) throw new Error(`${source} reads ${m[1]}, which is outside the template.`);
        inlined.set(target.split(sep).join("/"), readFileSync(join(root, target), "utf8"));
      }
    }
    modules.set(here, code);
  }
  return { modules, inlined };
}
