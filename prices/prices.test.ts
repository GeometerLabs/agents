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

// Decision 36 (owner, 10 Nov 2026): the builder licence goes from INR 149 to INR 199 per live client business. The 11 Nov list is the 9 Nov list with that one
// rate changed, so a partner's price, a fair-use line or an outside rate cannot have moved with it by accident.
test("the 11 Nov list changes only the builder licence, to INR 199, and says where the decision is written", () => {
  const before = JSON.parse(readFileSync(join(PRICES_DIR, "2026-11-09.json"), "utf8"));
  const now = JSON.parse(readFileSync(join(PRICES_DIR, "2026-11-11.json"), "utf8"));
  const { date: _d1, about: _a1, rates: rates1, ...rest1 } = before;
  const { date: _d2, about: _a2, rates: rates2, ...rest2 } = now;
  assert.deepEqual(rest2, rest1, "the format, quality names, exchange rates and notPriced are the 9 Nov list's");
  assert.deepEqual(Object.keys(rates2), Object.keys(rates1), "the same ids, in the same order");
  for (const id of Object.keys(rates1).filter((x) => x !== "licence.builder.fee")) assert.deepEqual(rates2[id], rates1[id], id);
  const fee = now.rates["licence.builder.fee"];
  assert.deepEqual([fee.currency, fee.micro, fee.per], ["INR", 199_000_000, "live client business a month"]);
  assert.deepEqual([fee.source, fee.read], ["docs/plans/implementation-plan.md", "2026-11-10"]);
  assert.match(fee.note, /decision 36/u);
  assert.match(now.about, /decision 36/u);
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
