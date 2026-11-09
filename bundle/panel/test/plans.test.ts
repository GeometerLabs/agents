// The plan lists (B48). The list of 5 Nov was written as a proposal; the owner decided it the same day and the list of 7 Nov put it in force. On 9 Nov the owner made it two
// price lists, partners and builders, and the list of 9 Nov is in force. A proposal must still load and be skipped by the running-cost line; each list in force carries the
// terms it was decided with; and fleet's copy of every list from 9 Nov on is this repo's file, byte for byte (prices/README.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { glowSalon } from "../../../templates/commerce/bookings/src/harness.ts";
import { PRICES_DIR, latestPriceList, latestProposedPriceList, loadPriceList, monthlyCost } from "../cost.ts";
import { fleetFile } from "../../test/monorepo.ts";

const byName = (date: string) => loadPriceList(new URL(`${date}.json`, PRICES_DIR).pathname);
const proposed = byName("2026-11-05");
const rate = (id: string) => proposed.rates[id];
const NUMBERS = ["currency", "micro", "basisPoints", "count", "freePerMonth", "per"] as const;
const numbersOf = (r: unknown) => Object.fromEntries(NUMBERS.map((k) => [k, (r as Record<string, unknown> | undefined)?.[k]]));

test("the list of 5 Nov loads, is marked proposed and links the economics document", () => {
  assert.equal(proposed.status, "proposed");
  assert.equal(proposed.proposal, "docs/product/economics-and-pricing.md");
  assert.equal(proposed.date, "2026-11-05");
  assert.match(readFileSync(proposed.file, "utf8"), /"status": "proposed"/u);
});

test("its plan numbers are the economics document's of 5 Nov (sections 1, 2 and 4)", () => {
  const rupees = (id: string) => rate(id).micro! / 1_000_000;
  assert.deepEqual(["basic", "business", "operations"].map((p) => rupees(`plan.${p}.fee`)), [99, 299, 999]);
  assert.deepEqual(["basic", "business", "operations"].map((p) => rate(`plan.${p}.allowance`).count), [1000, 3000, 10_000]);
  assert.equal(rupees("overage.extra"), 49);
  assert.equal(rate("overage.extra").per, "1000 messages");
  assert.equal(rate("innovator.places").count, 100);
  assert.equal(rate("whatsapp.pass-through").basisPoints, 10_000, "at cost");
  assert.equal(rate("whatsapp.in.gst").basisPoints, 1800);
  assert.equal(rate("whatsapp.in.utility").micro, 115_000);
  assert.equal(rate("whatsapp.in.service").freePerMonth, 1000);
  assert.equal(proposed.exchange.USD?.paisePerUnit, 8800, "the economics document assumes 88 to the dollar");
});

test("every other rate of the 4 Nov list is carried over unchanged, each with the day it was read; the flat fee is not carried", () => {
  const before = byName("2026-11-04");
  for (const [id, r] of Object.entries(before.rates)) {
    if (id === "geometer.fee") assert.equal(proposed.rates[id], undefined, "a plan replaces the flat fee");
    else assert.deepEqual(proposed.rates[id], r, id);
  }
  assert.doesNotMatch(readFileSync(proposed.file, "utf8"), new RegExp("found" + "ing", "iu"), "the word is not used for the innovators");
});

test("a proposed list never prices the running costs: the 5 Nov proposal is skipped, and the cost line reads the newest list in force", () => {
  const live = latestPriceList();
  assert.equal(live.status, "in-force");
  assert.equal(live.proposal, undefined);
  assert.ok(live.date >= "2026-11-09", "the owner's decision of 9 Nov or later is in force");
  const c = monthlyCost({ settings: glowSalon() }, live);
  assert.equal(c.priceList.date, live.date);
  assert.equal(c.lines.find((l) => l.id === "geometer")!.paise, live.rates["plan.business.fee"].micro! / 10_000, "Glow Salon takes a deposit: Business, at the list's price");
  assert.equal(latestProposedPriceList(), null, "nothing newer than the list in force is waiting");
  const dir = mkdtempSync(join(tmpdir(), "geo-prices-"));
  copyFileSync(new URL("2026-11-04.json", PRICES_DIR).pathname, join(dir, "2026-11-04.json"));
  copyFileSync(new URL("2026-11-05.json", PRICES_DIR).pathname, join(dir, "2026-11-05.json"));
  assert.equal(latestPriceList(dir).date, "2026-11-04", "while only the proposal is there, the flat fee stays in force");
  assert.equal(latestProposedPriceList(dir)?.date, "2026-11-05");
});

test("the list of 7 Nov carries every term of the 5 Nov proposal unchanged, as the owner decided them", () => {
  const decided = byName("2026-11-07");
  for (const [id, r] of Object.entries(proposed.rates)) assert.deepEqual(numbersOf(decided.rates[id]), numbersOf(r), id);
  assert.doesNotMatch(readFileSync(decided.file, "utf8"), new RegExp("found" + "ing|found" + "er|proposed", "iu"));
});

test("the list of 9 Nov: two price lists. Every rate of 7 Nov that is still true is carried over; only Basic's fee changes; the discount, its cap and the own-server discount are gone", () => {
  const before = byName("2026-11-07");
  const now = byName("2026-11-09");
  const gone = Object.keys(before.rates).filter((id) => now.rates[id] === undefined);
  assert.equal(gone.length, 3);
  for (const id of gone) assert.match(id, /^(licence\.(?!builder\.)|innovator\.(?!places$))/u, `${id}: only the old licence and the Innovator price terms are dropped`);
  for (const id of Object.keys(before.rates).filter((x) => now.rates[x] !== undefined && x !== "plan.basic.fee")) {
    const { per: _a, ...was } = numbersOf(before.rates[id]);
    const { per: _b, ...is } = numbersOf(now.rates[id]);
    assert.deepEqual(is, was, id);
  }
  assert.deepEqual(["basic", "business", "operations"].map((p) => now.rates[`plan.${p}.fee`].micro! / 1_000_000), [149, 299, 999]);
  assert.equal(now.rates["licence.builder.fee"].micro, 149_000_000);
  assert.equal(now.rates["ai.cap"].micro, 15_000_000);
  assert.equal(now.status, "in-force");
  assert.doesNotMatch(readFileSync(now.file, "utf8"), new RegExp("found" + "ing|found" + "er", "iu"));
});

test("with no newer proposal there is none to show, and a folder of proposals alone is refused", () => {
  const dir = mkdtempSync(join(tmpdir(), "geo-prices-"));
  copyFileSync(new URL("2026-11-04.json", PRICES_DIR).pathname, join(dir, "2026-11-04.json"));
  assert.equal(latestProposedPriceList(dir), null);
  const only = mkdtempSync(join(tmpdir(), "geo-prices-"));
  copyFileSync(new URL("2026-11-05.json", PRICES_DIR).pathname, join(only, "2026-11-05.json"));
  assert.throws(() => latestPriceList(only), /only proposed/u);
});

test("the loader checks the new forms: a count is a whole number, a rate has exactly one form, a proposal says where it is written", () => {
  const dir = mkdtempSync(join(tmpdir(), "geo-prices-"));
  const write = (value: unknown) => { const p = join(dir, "2026-12-01.json"); writeFileSync(p, JSON.stringify(value)); return p; };
  const base = { format: "geometer-price-list/1", date: "2026-12-01", exchange: {}, rates: {} };
  const one = { per: "shop", quality: "assumed", source: "docs/product/economics-and-pricing.md", read: "2026-12-01", note: "a note" };
  assert.equal(loadPriceList(write({ ...base, rates: { a: { ...one, count: 5 } } })).rates.a.count, 5);
  assert.throws(() => loadPriceList(write({ ...base, rates: { a: { ...one, count: 5.5 } } })), /count as a whole number/u);
  assert.throws(() => loadPriceList(write({ ...base, rates: { a: { ...one, count: 5, basisPoints: 100 } } })), /exactly one of/u);
  assert.throws(() => loadPriceList(write({ ...base, rates: { a: one } })), /exactly one of/u);
  assert.throws(() => loadPriceList(write({ ...base, status: "maybe" })), /"in-force" or "proposed"/u);
  assert.throws(() => loadPriceList(write({ ...base, status: "proposed" })), /where the proposal is written/u);
  assert.throws(() => loadPriceList(write({ ...base, proposal: "docs/x.md" })), /only a proposed list has a proposal/u);
  assert.equal(loadPriceList(write({ ...base, status: "proposed", proposal: "docs/x.md" })).status, "proposed");
});

// Fleet keeps a byte-for-byte copy of every list from 9 Nov 2026 on (apps/fleet/prices/list/<date>.json, made by `npm run prices:sync` in apps/fleet). Fleet's own drift
// test compares the same files from its side. The lists of 3 to 7 Nov are not copied: fleet's own tables of 5 and 7 Nov priced those months.
const FLEET_LIST = fleetFile("prices", "list");
const FIRST_SHARED = "2026-11-09";
test("fleet's copy of every price list from 9 Nov on is this repo's file, byte for byte", { skip: FLEET_LIST && existsSync(FLEET_LIST) ? false : "the monorepo's apps/fleet/prices/list/ is not here (set GEOMETER_MONOREPO, or it is not synced yet)" }, () => {
  const ours = readdirSync(PRICES_DIR).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/u.test(f) && f.slice(0, 10) >= FIRST_SHARED).sort();
  assert.ok(ours.length >= 1);
  for (const f of ours) {
    const theirs = join(FLEET_LIST!, f);
    assert.ok(existsSync(theirs), `fleet has no copy of prices/${f}: run npm run prices:sync in apps/fleet`);
    assert.ok(readFileSync(theirs).equals(readFileSync(new URL(f, PRICES_DIR))), `fleet's copy of ${f} differs from prices/${f}: a list is never edited, so one side is wrong`);
  }
});
