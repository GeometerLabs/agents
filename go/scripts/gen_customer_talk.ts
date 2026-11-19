// Writes go/internal/assistant/customerwords/words.json: a customer's talk prompt (modules/assistant/talk-prompt.ts customerPrompt) rendered by the TypeScript itself for every personality,
// with and without the character's name, in each of the four languages, with {shop}, {name} and {sources} left as slots, and the answer schema the model is held to. The Go runtime fills
// the slots, so the prompt is never typed twice. (The owner's prompt is in the assistant's word packs, go/scripts/gen_words.ts; a customer's differs by the customer's language, so it has
// its own small file and the packs are not touched.) Run from the repository root:   node go/scripts/gen_customer_talk.ts        (add --check to only compare with the committed file)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LANGUAGES } from "../../modules/language/languages.ts";
import { PERSONALITIES } from "../../modules/assistant/personality.ts";
import { CUSTOMER_CHARS, customerPrompt } from "../../modules/assistant/talk-prompt.ts";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "internal", "assistant", "customerwords", "words.json");
const SHOP = "SHOPNAME_SLOT", NAME = "CHARNAME_SLOT", SRC = "SOURCES_SLOT";
const system: Record<string, string> = {};
let schema: unknown;
for (const language of LANGUAGES) for (const personality of PERSONALITIES) for (const named of [true, false]) {
  const shop = { name: SHOP, character: { ...(named ? { name: NAME } : {}), personality } };
  const made = customerPrompt({ shop, language, sources: [{ id: "SRC", kind: "note", text: SRC }] });
  if (!made.system.endsWith(`\n[SRC] ${SRC}`)) throw new Error("the sources are not the prompt's last lines");
  const text = made.system.slice(0, -`[SRC] ${SRC}`.length).split(SHOP).join("{shop}").split(NAME).join("{name}") + "{sources}";
  if (/[{}]/u.test(text.replace(/\{(?:shop|name|sources)\}/gu, ""))) throw new Error("the prompt has a brace of its own");
  system[`${language}.${personality}.${named ? "named" : "plain"}`] = text;
  schema = made.schema;
}
const text = `${JSON.stringify({ chars: CUSTOMER_CHARS, schema, system }, null, 1)}\n`;
if (process.argv.includes("--check")) {
  if (readFileSync(OUT, "utf8") !== text) { console.error(`${OUT} is out of date: run node go/scripts/gen_customer_talk.ts`); process.exit(1); }
  console.log("customer talk words are fresh");
} else { writeFileSync(OUT, text); console.log(`wrote ${OUT}`); }
