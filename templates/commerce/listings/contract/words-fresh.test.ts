// `words-fresh`: the owner's words the Go runtime says are packed files (go/internal/assistant/words/*.json.gz) made by go/scripts/gen_words.ts from the TypeScript words. This fails
// when a committed file is stale (someone changed a word in modules/assistant/words*.ts or modules/listings/words.ts and did not run `node go/scripts/gen_words.ts`). It compares the
// UNPACKED text, not the gzip bytes (those may differ between zlib versions), and it needs no Go and no running shop.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { OUT, generate, staleFiles } from "../../../../go/scripts/gen_words.ts";

test("words-fresh: the committed packed words equal a fresh render of the TypeScript words", () => {
  assert.deepEqual([...generate().keys()].sort(), ["en.json", "hi.json", "kn.json", "ml.json", "rules.json"]);
  assert.deepEqual(staleFiles(OUT), [], "a packed file is out of date: run  node go/scripts/gen_words.ts  and commit the result");
});

test("words-fresh: the check is not vacuous: a copy with one word changed, or one file missing, is reported stale", () => {
  const dir = mkdtempSync(join(tmpdir(), "words-fresh-"));
  try {
    cpSync(OUT, dir, { recursive: true });
    const en = gunzipSync(readFileSync(join(dir, "en.json.gz"))).toString("utf8");
    assert.ok(en.includes("Nothing needs you right now."));
    writeFileSync(join(dir, "en.json.gz"), gzipSync(Buffer.from(en.replace("Nothing needs you right now.", "Nothing needs you right now!"))));
    rmSync(join(dir, "kn.json.gz"));
    assert.deepEqual(staleFiles(dir).sort(), ["en.json", "kn.json"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
