// Writes go/internal/stock/words.json: modules/stock/words.ts STOCK_LINE_WORDS (every line people read about the stock count, en/hi/ml/kn) for the Go shop runtime, so nothing is retyped.
//   node go/scripts/gen_stock_words.ts            (add --check to only compare with the committed file; templates/commerce/listings/contract/words-fresh.test.ts calls `staleFiles`)
// Plain strings (title, notices, moves, kinds ...) are copied. The words that are functions of a value (`left`, `lowMark`, `short`, `runningLow`, `reorderAsk`, `morningLow`, `unitRefused`)
// are RENDERED with probe values that cannot occur in the words ("7770001", "qzname", "qzunit", "qzsupplier") and each probe's text is turned back into a `{slot}`; the Go side only
// substitutes. A round trip (substitute the probes again, compare with the real function) is checked here, so a function that does something the slots cannot say fails the generator.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { STOCK_LINE_WORDS } from "../../modules/stock/words.ts";
import { LANGUAGES } from "../../modules/language/languages.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const OUT = join(here, "..", "internal", "stock");
const N = 7770001, NAME = "qzname", UNIT = "qzunit", SUP = "qzsupplier";

/** A probe's text turned into slots; throws when the text is not exactly the probes in their places. */
function slots(text: string, back: [string, string][]): string {
  let out = text;
  for (const [probe, slot] of back) out = out.split(probe).join(`{${slot}}`);
  if (/qz|7770001/u.test(out)) throw new Error(`a probe is left in ${out}`);
  return out;
}
const fill = (tpl: string, v: Record<string, string>): string => tpl.replace(/\{(\w+)\}/gu, (_m, k: string) => v[k]);
const same = (tpl: string, v: Record<string, string>, real: string): void => {
  if (fill(tpl, v) !== real) throw new Error(`a word does not survive its slots: ${tpl} -> ${fill(tpl, v)} != ${real}`);
};

function wordsOf(lang: (typeof LANGUAGES)[number]): Record<string, unknown> {
  const w = STOCK_LINE_WORDS[lang];
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(w)) if (typeof v === "string" || typeof v === "object") out[k] = v;
  const n: [string, string] = [String(N), "n"];
  const one = (f: string, tpl: string, v: Record<string, string>, real: string): void => { same(tpl, v, real); out[f] = tpl; };
  one("left", slots(w.left(N), [n]), { n: "5" }, w.left(5));
  out.leftUnit = slots(w.left(N, UNIT), [[UNIT, "unit"], n]);
  same(out.leftUnit as string, { n: "5", unit: "kg" }, w.left(5, "kg"));
  one("lowMark", slots(w.lowMark(N), [n]), { n: "3" }, w.lowMark(3));
  one("short", slots(w.short(N), [n]), { n: "2" }, w.short(2));
  one("runningLow", slots(w.runningLow(NAME, N), [[NAME, "name"], n]), { name: "Rice", n: "3" }, w.runningLow("Rice", 3));
  one("reorderAsk", slots(w.reorderAsk(NAME, N, SUP), [[NAME, "name"], [SUP, "supplier"], n]), { name: "Rice", n: "3", supplier: "Ravi" }, w.reorderAsk("Rice", 3, "Ravi"));
  one("morningLow", slots(w.morningLow(String(N)), [n]), { n: "2" }, w.morningLow("2"));
  one("unitRefused", slots(w.unitRefused(NAME, UNIT), [[NAME, "name"], [UNIT, "unit"]]), { name: "Rice", unit: "bag" }, w.unitRefused("Rice", "bag"));
  return out;
}

export function generate(): Map<string, string> {
  const all: Record<string, unknown> = {};
  for (const lang of LANGUAGES) all[lang] = wordsOf(lang);
  return new Map([["words.json", JSON.stringify(all, null, 1) + "\n"]]);
}

/** The files in `dir` that differ from a fresh render (or are missing). */
export function staleFiles(dir: string): string[] {
  const stale: string[] = [];
  for (const [name, text] of generate()) if (!existsSync(join(dir, name)) || readFileSync(join(dir, name), "utf8") !== text) stale.push(name);
  return stale;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes("--check")) {
    const stale = staleFiles(OUT);
    if (stale.length > 0) { console.error(`out of date: ${stale.join(", ")}  (run: node go/scripts/gen_stock_words.ts)`); process.exit(1); }
    console.log("the stock words are fresh");
  } else {
    mkdirSync(OUT, { recursive: true });
    for (const [name, text] of generate()) writeFileSync(join(OUT, name), text);
    console.log(`wrote ${OUT}/words.json`);
  }
}
