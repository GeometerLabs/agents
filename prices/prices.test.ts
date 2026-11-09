// Every price list in this folder parses, has unique ids and whole-number amounts; and prices/new.ts copies forward only.
import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkListFile, duplicateKeys } from "./check.ts";
import { isRealDay, listFiles, newList, PRICES_DIR } from "./new.ts";

test("every dated price list parses, has each key once and only whole-number amounts", () => {
  const files = listFiles(PRICES_DIR);
  assert.ok(files.length >= 1, "there is at least one price list");
  for (const f of files) assert.deepEqual(checkListFile(join(PRICES_DIR, f)), [], f);
});

test("a repeated key is found, wherever it is", () => {
  assert.deepEqual(duplicateKeys('{"rates": {"a": {"micro": 1}, "b": {}, "a": {"micro": 2}}}'), ["rates.a"]);
  assert.deepEqual(duplicateKeys('{"a": "x\\"a", "b": 1}'), [], "a key inside a string with an escaped quote is not a key");
  assert.deepEqual(duplicateKeys('{"a": [{"x": 1, "x": 2}]}'), ["a[].x"]);
});

test("the 9 Nov list holds both price lists and none of the removed terms", () => {
  const list = JSON.parse(readFileSync(join(PRICES_DIR, "2026-11-09.json"), "utf8"));
  assert.equal(list.rates["plan.basic.fee"].micro, 149_000_000);
  assert.equal(list.rates["licence.builder.fee"].micro, 149_000_000);
  assert.equal(list.rates["recharge.payment-fee"].basisPoints, 236);
  // Two price lists and nothing else: the only licence is the builder's, and the Innovator entry is its places (a badge), never a price.
  const ids = Object.keys(list.rates);
  assert.deepEqual(ids.filter((id) => id.startsWith("licence.")), ["licence.builder.fee", "licence.builder.fair-use.agents", "licence.builder.fair-use.actions"]);
  assert.deepEqual(ids.filter((id) => id.startsWith("innovator.")), ["innovator.places"]);
  // The payment fee is Razorpay's fee plus GST on it, both in the same list.
  const fee = list.rates["razorpay.platform-fee"].basisPoints, gst = list.rates["razorpay.gst-on-fee"].basisPoints;
  assert.equal(list.rates["recharge.payment-fee"].basisPoints, (fee * (10_000 + gst)) / 10_000);
});

test("new.ts copies the newest list forward and refuses to overwrite or go back", () => {
  const dir = mkdtempSync(join(tmpdir(), "prices-"));
  try {
    writeFileSync(join(dir, "2026-11-09.json"), `${JSON.stringify({ format: "geometer-price-list/1", date: "2026-11-09", rates: {} }, null, 2)}\n`);
    assert.deepEqual(newList(dir, "2026-12-01"), { from: "2026-11-09.json", to: "2026-12-01.json" });
    assert.equal(JSON.parse(readFileSync(join(dir, "2026-12-01.json"), "utf8")).date, "2026-12-01");
    assert.throws(() => newList(dir, "2026-12-01"), /dated after it/u, "the same date again");
    assert.throws(() => newList(dir, "2026-11-20"), /dated after it/u, "backwards");
    assert.throws(() => newList(dir, "2026-02-30"), /not a day/u);
    assert.equal(isRealDay("2026-12-31"), true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
