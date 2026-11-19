// Writes the vectors of the Go Guard clients (go/internal/guard, payments, messaging, calendar, standins) by RUNNING the TypeScript clients against a recording HTTP server
// (go/scripts/lib/record.ts) and writing down what they sent and what they made of the answers. The Go tests replay the same scripts and must see the same bytes. Run from the
// repository root:   node go/scripts/gen_guard_vectors.ts        (add --check to only compare with the committed files; the words-fresh test does that)
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stringify } from "./lib/record.ts";
import { byteVectors, guardCases } from "./vectors/guard.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const OUT = join(here, "..", "internal");

/** Every vector file: its path under go/internal and its text. Deterministic: the same TypeScript gives the same bytes. */
export async function generate(): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  files.set(join("guard", "testdata", "core-vectors.json"), stringify({ cases: await guardCases() }));
  files.set(join("guard", "testdata", "byte-vectors.json"), stringify(byteVectors()));
  const extra = await import("./vectors/index.ts");
  for (const [path, value] of await extra.all()) files.set(path, stringify(value));
  return files;
}

/** The files that differ from what `generate` makes (or are missing). */
export async function staleFiles(dir: string, files?: Map<string, string>): Promise<string[]> {
  const made = files ?? await generate();
  return [...made].filter(([name, text]) => !existsSync(join(dir, name)) || readFileSync(join(dir, name), "utf8") !== text).map(([name]) => name).sort();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const files = await generate();
  if (process.argv.includes("--check")) {
    const stale = await staleFiles(OUT, files);
    if (stale.length > 0) { console.error(`stale: ${stale.join(", ")}. Run: node go/scripts/gen_guard_vectors.ts`); process.exit(1); }
    console.log(`${files.size} vector files are fresh`);
  } else {
    for (const [name, text] of files) { mkdirSync(dirname(join(OUT, name)), { recursive: true }); writeFileSync(join(OUT, name), text); }
    console.log(`wrote ${files.size} vector files`);
  }
}
