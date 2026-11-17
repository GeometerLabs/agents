// The runtime container mounts two folders and nothing else: the pathway at /pathway and the shared modules at /modules (bundle/generate/compose.ts). A Stock orders file that
// imports from anywhere else (Orders, the bundle, a test) would pass every test here and crash at start on a real server. This reads the imports of the program a Stock orders
// shop runs (server/main.ts) and of the live adapter the runtime loads when it starts, follows them, and fails on any that leaves those two folders. It also checks the agent's own
// import graph (src/agent.ts, assistant.ts, channel.ts): the browser demo is built from the agent, so it must read no disk and use no node:sqlite and no server file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const PATHWAY = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/u, "");
const MODULES = resolve(PATHWAY, "..", "..", "..", "modules");

/**
 * Every file reachable from these by a relative import (static `import`/`export ... from`, or a dynamic `import("./x.ts")` with a plain string), as Node loads them.
 * A whole `import type ... from` or `export type ... from` statement is left out: type stripping erases it before the file runs, so it loads nothing (owner's decision,
 * 18 Nov 2026, after shared type files came to reach server files through their own imports). A mixed `import { type A, b }` still loads its module and is followed.
 */
function reachable(entries: string[]): Map<string, { imports: string[]; text: string }> {
  const seen = new Map<string, { imports: string[]; text: string }>();
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    const text = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//gu, "").replace(/(^|[^:])\/\/.*$/gmu, "$1")
      .replace(/^\s*(?:import|export)\s+type\s[^;]*?\bfrom\s+["'][^"']+["'];?/gmu, "");
    const imports = [...text.matchAll(/(?:\bfrom\s+|\bimport\s+|\bimport\(\s*)["'](\.{1,2}\/[^"']+)["']/gu)].map((m) => m[1]);
    seen.set(file, { imports, text });
    for (const spec of imports) {
      const target = resolve(dirname(file), spec);
      if (existsSync(target) && /\.(ts|js|mjs)$/u.test(target)) queue.push(target);
    }
  }
  return seen;
}

test("what a Stock orders shop runs imports only from its own pathway and from modules/: nothing from another template, the bundle or a test", () => {
  const graph = reachable(["server/main.ts", "src/adapters/live/index.ts"].map((f) => join(PATHWAY, f)));
  assert.ok(graph.size > 30, `the walk found ${graph.size} files, which is too few to be walking the real graph`);
  const outside: string[] = [];
  for (const [file, { imports }] of graph) {
    for (const spec of imports) {
      const target = resolve(dirname(file), spec);
      const inside = target === PATHWAY || target.startsWith(PATHWAY + sep) || target === MODULES || target.startsWith(MODULES + sep);
      if (!inside) outside.push(`${relative(PATHWAY, file)} imports ${spec}`);
      if (inside && target.startsWith(PATHWAY + sep) && /\/(test|standins|scripts)\//u.test(target.slice(PATHWAY.length))) outside.push(`${relative(PATHWAY, file)} imports ${spec} (a test or script file)`);
    }
  }
  assert.deepEqual(outside, []);
});

test("the agent, its assistant skill and its owner page read no disk, no database and no server file", () => {
  const graph = reachable(["src/agent.ts", "src/assistant.ts", "src/channel.ts"].map((f) => join(PATHWAY, f)));
  const bad: string[] = [];
  for (const [file, { text, imports }] of graph) {
    if (/node:sqlite|node:fs|node:child_process|node:net|node:http/u.test(text) && !file.endsWith(`${sep}modules${sep}core${sep}faults.ts`)) bad.push(`${relative(PATHWAY, file)} reads disk or the network`);
    for (const spec of imports) if (/\/server\//u.test(spec)) bad.push(`${relative(PATHWAY, file)} imports ${spec}`);
  }
  assert.deepEqual(bad, []);
});
