// The one rule of the shared modules: they import nothing from a template (templates/) or from the bundle. Templates import them, never the other way round.
// If this fails, the shared code has grown a taste for one template. Move that part into the template, and give the module a hook instead.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const MODULES = new URL("../", import.meta.url).pathname.replace(/\/$/, "");

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files(path, out);
    else if (path.endsWith(".ts")) out.push(path);
  }
  return out;
}

const SPECIFIER = /(?:\bfrom|\bimport)\s*\(?\s*(["'])(\.{1,2}\/[^"'\n]*)\1/g;

test("no shared module imports a template or the bundle", () => {
  const list = files(MODULES);
  assert.ok(list.length > 30, `${list.length} files looked at`);
  const bad: string[] = [];
  for (const file of list) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(SPECIFIER)) {
      const lineStart = text.lastIndexOf("\n", m.index) + 1;
      if (/^\s*(\/\/|\*|\/\*)/.test(text.slice(lineStart, m.index + 1))) continue; // a comment may name a path
      const target = resolve(dirname(file), m[2]);
      if (!target.startsWith(MODULES + "/")) bad.push(`${relative(MODULES, file)} imports ${m[2]}`);
    }
  }
  assert.deepEqual(bad, []);
});

test("the modules folder has its own package.json, so Node reads its files as modules without a warning", () => {
  const pkg = JSON.parse(readFileSync(join(MODULES, "package.json"), "utf8")) as { type?: string; dependencies?: unknown };
  assert.equal(pkg.type, "module");
  assert.equal(pkg.dependencies, undefined, "no dependencies");
});
