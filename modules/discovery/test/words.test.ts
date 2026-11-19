// The directory's words (words.ts, the one TypeScript file of the directory kept: the source of the Go directory's words and of the review sheet) in all four languages: every language
// has every line, none is empty, none is a copy of English, and none uses a word we never use. Carried over from page.test.ts when the TypeScript directory was deleted (19 Nov 2026).
import { test } from "node:test";
import assert from "node:assert/strict";
import { DIRECTORY_WORDS } from "../words.ts";
import { LANGS } from "../types.ts";

test("every language has every line, none empty, none a copy of English, and none of the words that are never used", () => {
  const flat = (w: unknown, path = ""): [string, string][] => typeof w === "string" ? [[path, w]] : typeof w === "function" ? [[path, (w as (...a: unknown[]) => string)(3, "kitten", 1.4)]] : Array.isArray(w) ? w.flatMap((x, i) => flat(x, `${path}.${i}`)) : Object.entries(w as object).flatMap(([k, v]) => flat(v, `${path}.${k}`));
  const english = new Map(flat(DIRECTORY_WORDS.en));
  for (const lang of LANGS) {
    const mine = flat(DIRECTORY_WORDS[lang]);
    assert.deepEqual(mine.map(([k]) => k), [...english.keys()], `${lang} has the same lines as English`);
    for (const [k, text] of mine) {
      assert.ok(text.trim() !== "", `${lang} ${k} is empty`);
      assert.ok(!/\b(safe|guaranteed|proves?|certified|100%|earn|income|bot|founder)\b/iu.test(text), `${lang} ${k} uses a word we never use`);
      if (lang !== "en" && !["km", "language"].includes(k.slice(1)) && english.get(k)!.length > 12) assert.notEqual(text, english.get(k), `${lang} ${k} is English`);
    }
  }
});
