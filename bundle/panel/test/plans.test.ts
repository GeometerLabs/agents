// The proposed price list of 5 Nov (B48): the plans, the allowances, the extra-message price, the licence, the innovators' discount. It waits for the owner's yes,
// so it must load, say it is proposed, and never reach the running-cost line.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { glowSalon } from "../../../pathways/bookings/src/harness.ts";
import { PRICES_DIR, latestPriceList, latestProposedPriceList, loadPriceList, monthlyCost } from "../cost.ts";
import { fleetFile } from "../../test/monorepo.ts";

const proposed = loadPriceList(new URL("2026-11-05.json", PRICES_DIR).pathname);
const rate = (id: string) => proposed.rates[id];

test("the list of 5 Nov loads, is marked proposed and links the economics document", () => {
  assert.equal(proposed.status, "proposed");
  assert.equal(proposed.proposal, "docs/product/economics-and-pricing.md");
  assert.equal(proposed.date, "2026-11-05");
  assert.match(readFileSync(proposed.file, "utf8"), /"status": "proposed"/u);
});

test("its numbers are the economics document's (sections 1, 2, 4 and 7)", () => {
  const rupees = (id: string) => rate(id).micro! / 1_000_000;
  assert.deepEqual(["basic", "business", "operations"].map((p) => rupees(`plan.${p}.fee`)), [99, 299, 999]);
  assert.deepEqual(["basic", "business", "operations"].map((p) => rate(`plan.${p}.allowance`).count), [1000, 3000, 10_000]);
  assert.equal(rupees("overage.extra"), 49);
  assert.equal(rate("overage.extra").per, "1000 messages");
  assert.equal(rate("licence.self-host").basisPoints, 5000, "half the plan price");
  assert.equal(rate("innovator.discount").basisPoints, 4000);
  assert.equal(rate("innovator.max-shops").count, 25);
  assert.equal(rate("innovator.places").count, 100);
  assert.equal(rate("whatsapp.pass-through").basisPoints, 10_000, "at cost");
  assert.equal(rate("whatsapp.in.gst").basisPoints, 1800);
  assert.equal(rate("whatsapp.in.utility").micro, 115_000);
  assert.equal(rate("whatsapp.in.service").freePerMonth, 1000);
  assert.equal(proposed.exchange.USD?.paisePerUnit, 8800, "the economics document assumes 88 to the dollar");
  // 40% off Basic and Business leaves INR 59 and INR 179 (the document's table, rounded down to the rupee)
  assert.deepEqual([99, 299].map((p) => Math.floor(p * (10_000 - 4000) / 10_000)), [59, 179]);
});

test("every other rate of the 4 Nov list is carried over unchanged, each with the day it was read; the flat fee is not carried", () => {
  const before = loadPriceList(new URL("2026-11-04.json", PRICES_DIR).pathname);
  for (const [id, r] of Object.entries(before.rates)) {
    if (id === "geometer.fee") assert.equal(proposed.rates[id], undefined, "a plan replaces the flat fee");
    else assert.deepEqual(proposed.rates[id], r, id);
  }
  assert.doesNotMatch(readFileSync(proposed.file, "utf8"), new RegExp("found" + "ing", "iu"), "the word is not used for the innovators");
});

test("a proposed list never prices the running costs: the newest in-force list is still 2026-11-04, and the cost line is the flat fee", () => {
  const live = latestPriceList();
  assert.equal(live.date, "2026-11-04");
  assert.equal(live.status, "in-force");
  const c = monthlyCost({ settings: glowSalon() }, live);
  assert.equal(c.priceList.date, "2026-11-04");
  assert.equal(c.lines.find((l) => l.id === "geometer")!.paise, 19_900);
  assert.equal(latestProposedPriceList()?.date, "2026-11-05");
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

// Fleet keeps the same plan terms in its own dated table (apps/fleet/prices/2026-11-05.json); the two must say the same numbers.
const FLEET_PRICES = fleetFile("prices", "2026-11-05.json");
const TERMS = ["plan.basic.fee", "plan.business.fee", "plan.operations.fee", "plan.basic.allowance", "plan.business.allowance", "plan.operations.allowance", "overage.extra", "licence.self-host", "innovator.discount", "innovator.max-shops", "innovator.places", "whatsapp.pass-through", "whatsapp.in.gst", "whatsapp.in.marketing", "whatsapp.in.utility", "whatsapp.in.service"];
test("fleet's cost table and this list agree on every plan term", { skip: FLEET_PRICES ? false : "the monorepo's apps/fleet is not at a sibling path (set GEOMETER_MONOREPO)" }, (t) => {
  let fleet: { rates?: Record<string, Record<string, unknown>> };
  try { fleet = JSON.parse(readFileSync(FLEET_PRICES!, "utf8")); } catch { t.skip("fleet has no apps/fleet/prices/2026-11-05.json yet"); return; }
  for (const id of TERMS) {
    const theirs = fleet.rates?.[id];
    assert.ok(theirs, `fleet's table has no ${id}`);
    for (const key of ["micro", "basisPoints", "count", "freePerMonth"] as const) assert.equal(theirs[key], (rate(id) as unknown as Record<string, unknown>)[key], `${id}.${key}`);
  }
});
