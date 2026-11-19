// The Go Bookings runtime reads a customer's message with the rule parser's patterns, the decision model's questions and the language model's prompt and schema as the
// TypeScript built them (go/internal/bookings/reading.json, made by go/scripts/gen_bookings_reading.ts). This fails when the committed file is out of date: run
// node go/scripts/gen_bookings_reading.ts  after a change to rule-parser.ts, reading.ts, model.ts or model-prompt.ts, and commit the result. It needs no Go.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OUT, stale } from "../../../../go/scripts/gen_bookings_reading.ts";

test("the Go Bookings reading (reading.json) equals a fresh render of the TypeScript", async () => {
  assert.equal(await stale(), false, "go/internal/bookings/reading.json is out of date: run  node go/scripts/gen_bookings_reading.ts  and commit the result");
});

test("the check is not vacuous: a copy with one word changed is stale", async () => {
  const dir = mkdtempSync(join(tmpdir(), "reading-fresh-"));
  try {
    const copy = join(dir, "reading.json");
    writeFileSync(copy, readFileSync(OUT, "utf8").replace("wants to cancel a booking", "wants to cancel a bookin"));
    assert.equal(await stale(copy), true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
