// Writes go/internal/parts/words.json from templates/commerce/parts/src/words.ts: what each kind of part is called and the router's one question, in four languages (decision 65).
// The Go program fills `{parts}` the way words.ts `question` does; this file also carries question()'s output for each language on three names, which the Go test compares with
// its own (so the joining is proved, not retyped).
// Run from the repository root:  node go/scripts/gen_parts_words.ts   (--check only compares; templates/commerce/parts/contract/words-fresh.test.ts fails when it is stale)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LANGUAGES } from "../../modules/language/languages.ts";
import { PART_NAMES, QUESTION, question } from "../../templates/commerce/parts/src/words.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const OUT = join(here, "..", "internal", "parts", "words.json");

export function generate(): string {
  const vectors = LANGUAGES.flatMap((l) => (["owner", "customer"] as const).map((to) => ({ language: l, to, names: ["A", "B", "C"], text: question(l, to, ["A", "B", "C"]) })));
  return `${JSON.stringify({ names: PART_NAMES, question: QUESTION, vectors }, null, 1)}\n`;
}

/** True when the committed file is not what the TypeScript says now. */
export function stale(): boolean {
  try { return readFileSync(OUT, "utf8") !== generate(); } catch { return true; }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes("--check")) {
    if (stale()) { console.error(`${OUT} is out of date: run  node go/scripts/gen_parts_words.ts`); process.exit(1); }
    console.log("parts words: fresh");
  } else {
    writeFileSync(OUT, generate());
    console.log(`wrote ${OUT}`);
  }
}
