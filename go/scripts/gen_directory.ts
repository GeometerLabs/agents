// Writes what the Go directory (go/internal/directory) takes from the TypeScript that is still its source, instead of retyping it (the rule of decision 61: words, tables and specs are
// GENERATED, once, from the TypeScript source, and a test fails when a committed file is out of date). Run from the repository root:   node go/scripts/gen_directory.ts   (--check compares)
//
//   internal/directory/words/pack.json.gz  the page's words in four languages and the languages' names (modules/discovery/words.ts, which the review sheet bundle/panel/review.ts also
//                                          reads; each function-valued line RENDERED at sentinel values and turned into a template with slots, every plural form checked against the real
//                                          function for n = 0..1000), the languages and the kinds (modules/discovery/types.ts), the shops' own style sheet (modules/channels/look.ts
//                                          CUSTOMER_CSS), the shops' paints (modules/channels/chat-paint.ts PAINTS) and the MCP versions (modules/channels/mcp.ts)
//   internal/directory/words/baloo-2-latin-wght-normal.woff2   the page's one font, copied from modules/channels/fonts (go:embed cannot reach outside the Go module)
//
// The rest of what the directory serves (the page's own style, its script, the MCP tools, the Agent Card, the assistant's prompt) and the Latin-fold tables have had no TypeScript source
// since the TypeScript directory was deleted (19 Nov 2026, wave 1c): they are Go source in internal/directory (words/*.css, *.js, *.json, romanise_tables.go), cut out of what this script
// made from the TypeScript before then.
import { gunzipSync, gzipSync } from "node:zlib";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DIRECTORY_WORDS, LANGUAGE_LABEL } from "../../modules/discovery/words.ts";
import { MCP_VERSIONS } from "../../modules/channels/mcp.ts";
import { CUSTOMER_CSS } from "../../modules/channels/look.ts";
import { PAINTS } from "../../modules/channels/chat-paint.ts";
import { CATEGORIES, LANGS } from "../../modules/discovery/types.ts";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "internal", "directory");
const check = process.argv.includes("--check");
let stale = false;
function write(file: string, data: string | Buffer): void {
  const path = join(OUT, file);
  mkdirSync(dirname(path), { recursive: true });
  if (check) {
    const same = existsSync(path) && (typeof data === "string" ? readFileSync(path, "utf8") === data : Buffer.compare(readFileSync(path), data) === 0);
    if (!same) { stale = true; console.error(`stale: ${file}`); }
    return;
  }
  writeFileSync(path, data);
}

// ---- words: strings, lists, maps as they are; functions rendered into templates ----
const O = "\uE000", C = "\uE001"; // private-use characters, which no word of ours holds
const slot = (name: string): string => `${O}${name}${C}`;
const N = 7654321;
type Spec = { n?: true; strings: string[]; nullable?: string[] };
const FUNCTIONS: Record<string, Spec> = {
  km: { n: true, strings: [] }, resultsFor: { n: true, strings: ["q"] }, resultsNoWords: { n: true, strings: [] }, confirmedDays: { n: true, strings: [] }, away: { strings: ["km"] }, inTown: { strings: ["town"] },
  chatLabel: { strings: ["shop", "item"] }, photoOf: { strings: ["item"] }, unanswered: { n: true, strings: [] }, askLine: { n: true, strings: ["what"], nullable: ["town", "km"] },
};
const slotsOf = (text: string): string => text.replace(new RegExp(`${O}(\\w+)${C}`, "gu"), "{$1}").replaceAll(String(N), "{n}");
const slots = (text: string): string => {
  if (/[{}]/u.test(text.replace(new RegExp(`${O}\\w+${C}`, "gu"), ""))) throw new Error(`a word holds a brace, which the templates use for slots: ${text}`);
  return slotsOf(text);
};
const BUCKETS = ["0", "1", "2", "3"];
function fnTemplates(f: (...a: any[]) => string, spec: Spec, lang: string, key: string): Record<string, Record<string, string>> {
  const flagSets: string[][] = [[]];
  for (const nb of spec.nullable ?? []) flagSets.push(...flagSets.map((fs) => [...fs, nb]));
  const out: Record<string, Record<string, string>> = {};
  const call = (n: number | undefined, present: string[], real: Record<string, string>) => {
    const args: unknown[] = [];
    if (spec.n) args.push(n);
    for (const s of spec.strings) args.push(real[s] ?? slot(s));
    for (const nb of spec.nullable ?? []) args.push(present.includes(nb) ? (real[nb] ?? slot(nb)) : null);
    return f(...args);
  };
  for (const present of flagSets) {
    const variant = [...present].sort().join(",");
    out[variant] = {};
    for (const b of spec.n ? [...BUCKETS, "*"] : [""]) out[variant][b] = slots(call(b === "*" ? N : b === "" ? undefined : Number(b), present, {}));
    // every n from 0 to 1000 and some awkward string values must come out the same from the template as from the function
    const real = { q: "a $& \"b\" {x}", km: "1.4", town: "Thrissur $1", item: "I'm", shop: "S&S", what: "kitten {n}" };
    for (let n = 0; n <= (spec.n ? 1000 : 0); n++) {
      const t = out[variant][spec.n ? (n <= 3 ? String(n) : "*") : ""];
      const want = call(spec.n ? n : undefined, present, real);
      const got = t.replace(/\{(\w+)\}/gu, (_m, name: string) => (name === "n" ? String(n) : real[name as keyof typeof real] ?? `{${name}}`));
      if (got !== want) throw new Error(`${key} in ${lang} is not reproduced by its template for n=${n}: ${got} vs ${want}`);
    }
  }
  return out;
}
const words: Record<string, Record<string, unknown>> = {};
for (const lang of LANGS) {
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(DIRECTORY_WORDS[lang])) {
    if (typeof v === "function") {
      const spec = FUNCTIONS[key];
      if (!spec) throw new Error(`a new function-valued line, ${key}: describe its arguments in FUNCTIONS`);
      out[key] = { fn: fnTemplates(v as never, spec, lang, key) };
    } else out[key] = v;
  }
  words[lang] = out;
}
for (const key of Object.keys(FUNCTIONS)) if (typeof (DIRECTORY_WORDS.en as unknown as Record<string, unknown>)[key] !== "function") throw new Error(`${key} is no longer a function`);

const pack = { langs: LANGS, categories: CATEGORIES, languageLabel: LANGUAGE_LABEL, words, shopCss: CUSTOMER_CSS, paints: PAINTS, mcpVersions: MCP_VERSIONS };
const json = JSON.stringify(pack);
// gzip is deterministic for the same input and level, but its header carries no time (node writes zeros), so the committed bytes can be compared
const packed = gzipSync(Buffer.from(json), { level: 9 });
if (check) {
  const path = join(OUT, "words", "pack.json.gz");
  const same = existsSync(path) && readFileSync(path).equals(packed) || (existsSync(path) && gunzipSync(readFileSync(path)).toString() === json);
  if (!same) { stale = true; console.error("stale: words/pack.json.gz"); }
} else write("words/pack.json.gz", packed);
const font = readFileSync(join(here, "..", "..", "modules", "channels", "fonts", "baloo-2-latin-wght-normal.woff2"));
write("words/baloo-2-latin-wght-normal.woff2", font);
if (check) { if (stale) process.exit(1); console.log("fresh"); } else console.log(`wrote the directory pack: ${packed.length} bytes packed, ${json.length} bytes of JSON`);
