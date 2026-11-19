// `words-fresh`: the owner's words the Go runtime says are packed files (go/internal/assistant/words/*.json.gz) made by go/scripts/gen_words.ts from the TypeScript words. This fails
// when a committed file is stale (someone changed a word in modules/assistant/words*.ts or modules/listings/words.ts and did not run `node go/scripts/gen_words.ts`). It compares the
// UNPACKED text, not the gzip bytes (those may differ between zlib versions), and it needs no Go and no running shop.
// The TypeScript's built patterns the Go runtime matches with (go/internal/language/patterns.json, and the vectors its matcher is tested on), made by
// go/scripts/gen_patterns.ts, are checked the same way: run  node go/scripts/gen_patterns.ts  after a change to one of the patterns it names.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { OUT, generate, staleFiles } from "../../../../go/scripts/gen_words.ts";
import * as patterns from "../../../../go/scripts/gen_patterns.ts";

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

test("words-fresh: the committed patterns and their vectors equal a fresh render of the TypeScript patterns", () => {
  assert.deepEqual([...patterns.generate().keys()].sort(), ["patterns.json", join("testdata", "pattern-vectors.json")]);
  assert.deepEqual(patterns.staleFiles(patterns.OUT), [], "a pattern file is out of date: run  node go/scripts/gen_patterns.ts  and commit the result");
  const dir = mkdtempSync(join(tmpdir(), "patterns-fresh-"));
  try {
    cpSync(patterns.OUT, dir, { recursive: true });
    const p = readFileSync(join(dir, "patterns.json"), "utf8");
    writeFileSync(join(dir, "patterns.json"), p.replace("tomorrow", "tomorrrow"));
    assert.deepEqual(patterns.staleFiles(dir), ["patterns.json"], "the check is not vacuous");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("words-fresh: the Bookings unit vectors (go/internal/bookings/testdata) equal a fresh run of the TypeScript Bookings functions", async () => {
  const bookings = await import("../../../../go/scripts/gen_bookings_vectors.ts");
  assert.deepEqual([...(await bookings.generate()).keys()].sort(), ["coerce-vectors.json", "guard-spec-vectors.json", "limits-vectors.json", "ondc-vectors.json", "parser-vectors.json", "report-vectors.json", "runner-vectors.json", "scenarios-vectors.json", "settings-vectors.json", "templates-vectors.json"]);
  assert.deepEqual(await bookings.staleFiles(bookings.OUT), [], "a Bookings vector file is out of date: run  node go/scripts/gen_bookings_vectors.ts  and commit the result");
});

test("words-fresh: the Bookings words and the shared formats (go/internal/bookings/words, go/internal/language/formats.json) equal a fresh render of the TypeScript", async () => {
  const bookings = await import("../../../../go/scripts/gen_bookings_words.ts");
  assert.deepEqual([...bookings.generate().keys()].sort(), ["go/internal/bookings/words/en.json.gz", "go/internal/bookings/words/hi.json.gz", "go/internal/bookings/words/kn.json.gz", "go/internal/bookings/words/ml.json.gz", "go/internal/language/formats.json"]);
  assert.deepEqual(bookings.staleFiles(), [], "a Bookings words file is out of date: run  node go/scripts/gen_bookings_words.ts  and commit the result");
  // the check is not vacuous: a copy with one word changed is reported stale
  const dir = mkdtempSync(join(tmpdir(), "bookings-words-fresh-"));
  try {
    const files = bookings.generate();
    const name = "go/internal/language/formats.json";
    writeFileSync(join(dir, "formats.json"), files.get(name)!.replace("Sun", "Sunn"));
    assert.deepEqual(bookings.staleFiles(dir, new Map([["formats.json", files.get(name)!]])), ["formats.json"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
