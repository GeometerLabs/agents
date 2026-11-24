// The parts shop's generated words (go/internal/parts/words.json, from src/words.ts by go/scripts/gen_parts_words.ts) are fresh: run  node go/scripts/gen_parts_words.ts
// after a change to src/words.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { stale } from "../../../../go/scripts/gen_parts_words.ts";

test("go/internal/parts/words.json is what src/words.ts says", () => {
  assert.equal(stale(), false, "run  node go/scripts/gen_parts_words.ts  and commit the result");
});
