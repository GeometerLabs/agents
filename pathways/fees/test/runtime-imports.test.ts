// The runtime container mounts two folders and nothing else: the pathway at /pathway and the shared modules at /modules (bundle/generate/compose.ts). A Fees file that
// imports from anywhere else (Bookings, the bundle, a test) would pass every test here and crash at start on a real server. So this reads the imports of the three programs
// a Fees centre runs (the runtime, the inbox, the relay) and of the live adapters the runtime loads when it starts, follows them, and fails on any that leaves those two folders.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const PATHWAY = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/u, "");
const MODULES = resolve(PATHWAY, "..", "..", "modules");

/** Every file reachable from these by a relative import (static `import`/`export ... from`, or a dynamic `import("./x.ts")` with a plain string). */
function reachable(entries: string[]): Map<string, string[]> {
  const seen = new Map<string, string[]>();
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    const text = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//gu, "").replace(/(^|[^:])\/\/.*$/gmu, "$1");
    const imports = [...text.matchAll(/(?:\bfrom\s+|\bimport\s+|\bimport\(\s*)["'](\.{1,2}\/[^"']+)["']/gu)].map((m) => m[1]);
    seen.set(file, imports);
    for (const spec of imports) {
      const target = resolve(dirname(file), spec);
      if (existsSync(target) && /\.(ts|js|mjs)$/u.test(target)) queue.push(target);
    }
  }
  return seen;
}

test("what a Fees centre runs imports only from its own pathway and from modules/: nothing from Bookings, the bundle or a test", () => {
  const entries = ["server/main.ts", "inbox/main.ts", "approvals/main.ts", "src/adapters/live/index.ts"].map((f) => join(PATHWAY, f));
  const graph = reachable(entries);
  assert.ok(graph.size > 40, `the walk found ${graph.size} files, which is too few to be walking the real graph`);
  const outside: string[] = [];
  for (const [file, imports] of graph) {
    for (const spec of imports) {
      const target = resolve(dirname(file), spec);
      const inside = target === PATHWAY || target.startsWith(PATHWAY + sep) || target === MODULES || target.startsWith(MODULES + sep);
      if (!inside) outside.push(`${relative(PATHWAY, file)} imports ${spec}`);
      if (inside && target.startsWith(PATHWAY + sep) && /\/(test|standins|scripts)\//u.test(target.slice(PATHWAY.length))) outside.push(`${relative(PATHWAY, file)} imports ${spec} (a test or script file: it is not on the server)`);
    }
  }
  assert.deepEqual(outside, []);
  // and the files the stand-ins and the stack import from Bookings are not among the ones above
  for (const file of graph.keys()) assert.ok(!file.includes(`${sep}pathways${sep}bookings${sep}`), file);
});
