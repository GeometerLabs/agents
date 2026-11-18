// `words-fresh`: the owner's words the Go runtime says are packed files (go/internal/assistant/words/*.json.gz) made by go/scripts/gen_words.ts from the TypeScript words. This fails
// when a committed file is stale (someone changed a word in modules/assistant/words*.ts or modules/listings/words.ts and did not run `node go/scripts/gen_words.ts`). It compares the
// UNPACKED text, not the gzip bytes (those may differ between zlib versions), and it needs no Go and no running shop.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { OUT, generate } from "../../../../go/scripts/gen_words.ts";

test("words-fresh: the committed packed words equal a fresh render of the TypeScript words", () => {
  const fresh = generate();
  assert.deepEqual([...fresh.keys()].sort(), ["en.json", "hi.json", "kn.json", "ml.json", "rules.json"]);
  for (const [name, text] of fresh) {
    const have = gunzipSync(readFileSync(join(OUT, `${name}.gz`))).toString("utf8");
    assert.equal(have, text, `${name}.gz is out of date: run  node go/scripts/gen_words.ts  and commit the result`);
  }
});

test("words-fresh: a changed word is noticed (the check is not vacuous)", () => {
  const fresh = generate();
  const have = gunzipSync(readFileSync(join(OUT, "en.json.gz"))).toString("utf8");
  assert.notEqual(have.replace("Nothing needs you right now.", "Nothing needs you right now!"), fresh.get("en.json"));
  assert.ok(fresh.get("en.json")!.includes("Nothing needs you right now."));
});
