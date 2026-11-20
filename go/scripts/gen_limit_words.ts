// Writes go/internal/runtime/limitwords/words.json: the words of the limits a template may let its owner change (modules/limits/chat-limit-kinds.ts LIMIT_WORDS, the name and the
// rule of each kind in four languages, `{v}` where the value goes, and the words that name it in the owner's message, which the assistant's limit card reads), so the Go runtime's limits page says them byte for byte and they are never typed twice. Run from the repository
// root:   node go/scripts/gen_limit_words.ts        (add --check to only compare with the committed file)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LIMIT_WORDS } from "../../modules/limits/chat-limit-kinds.ts";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "internal", "runtime", "limitwords", "words.json");
const kinds = Object.fromEntries(Object.entries(LIMIT_WORDS).map(([k, w]) => [k, { name: w.name, rule: w.rule, words: w.words }]));
const text = `${JSON.stringify(kinds, null, 1)}\n`;
if (process.argv.includes("--check")) {
  if (readFileSync(OUT, "utf8") !== text) { console.error(`${OUT} is out of date: run node go/scripts/gen_limit_words.ts`); process.exit(1); }
  console.log("limit words are fresh");
} else { writeFileSync(OUT, text); console.log(`wrote ${OUT}`); }
