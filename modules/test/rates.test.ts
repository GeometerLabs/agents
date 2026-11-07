// The one dated table of model prices (modules/understanding/rates/): every file is listed, pinned and checked, and the lines say what the economics note says. The bundle's price lists and the evaluation's candidates are checked against it in their own tests (bundle/panel/test/cost.test.ts,
// templates/commerce/bookings/test/model-eval.test.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { RATES, RATE_LISTS, costMicroInr, rateFor } from "../understanding/rates.ts";
import { problemsIn } from "../understanding/rates-check.ts";

const DIR = new URL("../understanding/rates/", import.meta.url);

// The sha256 of each committed file. A file is never edited after it is committed; a changed price is a new file with a new date, and a new line here.
const PINNED: Record<string, string> = {
  "2026-11-05.json": "df267f7a4c3c7f357b98289e646832decfa1acfbf810b740da52b7bc735f2242",
};

test("every file in rates/ is loaded by rates.ts, is named for its date, and has the bytes it was committed with", () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".json")).sort();
  assert.deepEqual(files, Object.keys(PINNED), "a file is in rates/ that is not pinned here (or the reverse)");
  assert.deepEqual(RATE_LISTS.map((l) => `${l.date}.json`), files, "rates.ts must list every file in rates/ (its FILES), oldest first");
  for (const file of files) {
    const actual = createHash("sha256").update(readFileSync(new URL(file, DIR))).digest("hex");
    assert.equal(actual, PINNED[file], `modules/understanding/rates/${file} was edited. Never edit a rate file after it is committed: add a new file with a new date.`);
  }
});

const good = () => JSON.parse(readFileSync(new URL("2026-11-05.json", DIR), "utf8")) as Record<string, any>;

test("every committed file passes the checker, and a file with a mistake is told what to fix", () => {
  for (const file of Object.keys(PINNED)) assert.deepEqual(problemsIn(JSON.parse(readFileSync(new URL(file, DIR), "utf8"))), [], file);
  const bad = (change: (f: Record<string, any>) => void, message: RegExp) => {
    const f = good();
    change(f);
    assert.match(problemsIn(f).join("\n"), message);
  };
  assert.match(problemsIn({ format: "other" })[0], /not a Geometer model rate table/);
  bad((f) => { f.date = "5 Nov"; }, /needs a date/);
  bad((f) => { delete f.rates[0].source; }, /must say where it was read/);
  bad((f) => { f.rates[0].quality = "great"; }, /must say how sure we are/);
  bad((f) => { f.rates[1].inputUsdPerMillion = -1; }, /numbers of 0 or more/);
  bad((f) => { f.rates[1].outputUsdPerMillion = "0.04"; }, /numbers of 0 or more/);
  bad((f) => { f.rates[1].read = "2026-12-01"; }, /not after the file's own date/);
  bad((f) => { f.rates[1].cost = 5; }, /a field this table does not know: cost/);
  bad((f) => { f.rates[2].modelPattern = "("; }, /is not a pattern/);
  bad((f) => { f.rates[3].modelPattern = "haiku"; }, /a modelPattern goes with model "\*"/);
  bad((f) => { f.inrPerUsd.rate = 0; }, /must be a number above zero/);
  bad((f) => { f.rates = []; }, /at least one line/);
  bad((f) => { f.notPriced = { "no-slash": "why" }; }, /must be provider\/model/);
  bad((f) => { f.rates[0].note = " "; }, /needs a note/);
});

test("the lines are the economics note's (section 3.2) and the evaluation's candidates", () => {
  const day = "2026-11-05";
  const deepseek = rateFor("deepinfra", "deepseek-ai/DeepSeek-V4.1-Flash", day)!;
  assert.deepEqual([deepseek.inputUsdPerMillion, deepseek.outputUsdPerMillion, deepseek.cachedInputUsdPerMillion], [0.16, 0.48, 0.004]);
  assert.equal(rateFor("deepinfra", "DeepSeek-V4.1-Flash", day)?.inputUsdPerMillion, 0.16, "any id that names DeepSeek V4.1 Flash: the exact id is a guess");
  assert.equal(rateFor("deepinfra", "meta-llama/Llama-3.1-8B", day), null, "another DeepInfra model is unknown, not free");
  assert.deepEqual([rateFor("jev", "clm-latest", day)?.inputUsdPerMillion, rateFor("jev", "anything", day)?.outputUsdPerMillion], [0.042, 0.042]);
  assert.deepEqual([rateFor("laya", "laya", day)?.inputUsdPerMillion, rateFor("laya", "laya", day)?.outputUsdPerMillion], [0, 0], "Laya has no per-call charge: a price of nothing, written down");
  for (const [provider, model, input, output] of [["anthropic", "claude-haiku-5-5", 0.1, 0.5], ["google", "gemini-3.1-flash-lite", 0.25, 1.5], ["google", "gemini-3.5-flash-lite", 0.3, 2.5], ["openai", "gpt-6-luna", 0.1, 0.5]] as const) {
    const r = rateFor(provider, model, day);
    assert.deepEqual([r?.inputUsdPerMillion, r?.outputUsdPerMillion], [input, output], `${provider}/${model}`);
  }
  assert.equal(rateFor("jev", "clm-latest", "2026-11-04"), null, "a line holds from its file's date, so an older record is unpriced, not guessed");
  assert.equal(rateFor("sarvam", "sarvam-105b-conversations", day), null);
  assert.ok(RATE_LISTS.some((l) => "sarvam/sarvam-105b-conversations" in l.notPriced && "groq/openai/gpt-oss-20b" in l.notPriced), "what has no price says so");
  assert.equal(RATES.length, RATE_LISTS.flatMap((l) => l.rates).length);
});

test("a line carries the rupee rate of its own file, so a later file can change the rate without changing what an older record cost", () => {
  const usage = { inputTokens: 1_000_000, outputTokens: 0 };
  const line = { provider: "p", model: "*", from: "2026-01-01", inputUsdPerMillion: 1, outputUsdPerMillion: 1, source: "docs/x" };
  assert.equal(costMicroInr({ ...line, inrPerUsd: 80 }, usage), 80_000_000);
  assert.equal(costMicroInr({ ...line, inrPerUsd: 90 }, usage), 90_000_000);
  assert.equal(costMicroInr(line, usage), 87_000_000, "a line with no rate of its own uses the newest file's");
});
