// Writes go/internal/runtime/chatwords/words.json: the few words the chat's own code says (modules/channels/words-chat.ts CHAT.rate and QUICK, words-chat-more.ts voiceNote), so the
// Go runtime's chat says them byte for byte and they are never typed twice. Run from the repository root:   node go/scripts/gen_chat_words.ts        (add --check to only compare)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LANGUAGES } from "../../modules/language/languages.ts";
import { CHAT, QUICK } from "../../modules/channels/words-chat.ts";
import { CHAT_MORE } from "../../modules/channels/words-chat-more.ts";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "internal", "runtime", "chatwords", "words.json");
const by = (f: (l: (typeof LANGUAGES)[number]) => string) => Object.fromEntries(LANGUAGES.map((l) => [l, f(l)]));
const words = { rate: by((l) => CHAT[l].rate), voiceNote: by((l) => CHAT_MORE[l].voiceNote), quick: QUICK };
const text = `${JSON.stringify(words, null, 1)}\n`;
if (process.argv.includes("--check")) {
  if (readFileSync(OUT, "utf8") !== text) { console.error(`${OUT} is out of date: run node go/scripts/gen_chat_words.ts`); process.exit(1); }
  console.log("chat words are fresh");
} else { writeFileSync(OUT, text); console.log(`wrote ${OUT}`); }
