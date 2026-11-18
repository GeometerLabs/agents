// The shop's model budget on the bundle's side (decision 60, "caps everywhere"): the price list of 19 Nov (the 18 Nov proposal, approved by the owner and in force from 19 Nov)
// holds the numbers and nothing else holds them; a shop's budget is worked out from the plan and the list IN FORCE, so a proposed list never gives a shop a budget; it reaches the shop's generated runtime.json only if the runtime
// knows the key; the Operator's panel line reads the runtime's status field by field; a listing's draft is counted in the usage meter; and the model Guard's wall is checked
// against the budgets. Nothing here calls a model.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, copyFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateRuntimeConfig } from "../../templates/commerce/bookings/server/config.ts";
import { isBudgetConfig } from "../../modules/budget/budget.ts";
import { planShop, withBudget } from "../generate/shop.ts";
import { WORST_CALL_MICRO_INR, budgetFor, discoveryBudgetFor, priceListNotes, wallNotes } from "../lib/budget.ts";
import { isOwnerAssistantRead, summarizeUsage, usageRatesFrom } from "../lib/usage.ts";
import { PRICES_DIR, latestPriceList, latestProposedPriceList, loadPriceList } from "../panel/cost.ts";
import { budgetOf, planView } from "../panel/plan.ts";
import { serverConfig, tempServer } from "./helpers.ts";

const proposed = loadPriceList(new URL("2026-11-18.json", PRICES_DIR).pathname);
const inForce = latestPriceList();
const before = loadPriceList(new URL("2026-11-14.json", PRICES_DIR).pathname); // the list in force before 19 Nov: no budget in it
const RUPEE = 1_000_000;

test("the 18 Nov proposal is superseded by the 19 Nov list in force, with the same numbers; a proposed list never gives a shop a budget", () => {
  assert.equal(proposed.status, "proposed", "the 18 Nov file stays what it was");
  assert.equal(latestProposedPriceList(), null, "nothing is waiting any more");
  assert.equal(inForce.date, "2026-11-19");
  assert.equal(inForce.status, "in-force");
  for (const [id, r] of Object.entries(proposed.rates)) {
    if (!id.startsWith("ai.")) continue;
    // every number, unit and source is the proposal's; what the owner's yes changes is the note, the read day and how sure we are ("assumed" became "official": decided by the owner)
    const { note: _a, read: _b, quality: _q1, ...was } = r as unknown as Record<string, unknown>;
    const { note: _c, read: _d, quality: _q2, ...now } = inForce.rates[id] as unknown as Record<string, unknown>;
    assert.deepEqual(now, was, `${id}: approved as proposed, no number moved`);
    assert.equal(inForce.rates[id].quality, "official", `${id}: a number the owner decided`);
    assert.doesNotMatch(inForce.rates[id].note, /Needs the owner's yes|PROPOSED/u, id);
  }
  // from 19 Nov a plan's budget applies; before it, and in a folder where the only newer list is a proposal, nothing does
  assert.notEqual(budgetFor("basic", inForce), undefined);
  assert.equal(budgetFor("basic", before), undefined);
  const dir = mkdtempSync(join(tmpdir(), "geo-prices-"));
  for (const f of ["2026-11-14.json", "2026-11-18.json"]) copyFileSync(new URL(f, PRICES_DIR).pathname, join(dir, f));
  assert.equal(latestPriceList(dir).date, "2026-11-14", "a proposed list never prices or caps anything");
  assert.equal(budgetFor("basic", latestPriceList(dir)), undefined, "so a shop gets no budget from a proposal");
});

test("the proposed numbers: a budget for each plan, equal to ai.cap for the plan's allowance, a small one for a listings-only shop, and the directory's", () => {
  const r = inForce.rates;
  assert.equal(r["ai.cap"].micro, 20 * RUPEE);
  for (const plan of ["basic", "business", "operations"] as const) {
    assert.equal(r[`ai.budget.${plan}`].micro, (r["ai.cap"].micro! * r[`plan.${plan}.allowance`].count!) / 1000, `${plan}: the shop's own budget is the same rupee as fleet's outer wall`);
    assert.ok(r[`ai.budget.${plan}`].micro! < r[`plan.${plan}.fee`].micro! / 4, `${plan}: a budget well under a quarter of the plan's fee`);
  }
  assert.ok(r["ai.budget.listings-only"].micro! < r["ai.budget.basic"].micro!);
  assert.ok(r["ai.budget.discovery"].micro! > 0 && r["ai.daily.discovery.per-buyer"].count! > 0);
});

test("a shop's budget is worked out from its plan and the list; a number the list lacks is never made up", () => {
  const basic = budgetFor("basic", inForce)!;
  assert.equal(basic.monthlyMicroInr, 20 * RUPEE);
  assert.deepEqual(basic.daily, { owner_talk: 30, listing_draft: 10, customer_talk: 60, router: 100 }, "customers' and the router's caps scale with the 1,000 messages");
  assert.deepEqual(budgetFor("business", inForce)!.daily, { owner_talk: 30, listing_draft: 10, customer_talk: 180, router: 300 });
  assert.deepEqual(budgetFor("operations", inForce)!.daily, { owner_talk: 30, listing_draft: 10, customer_talk: 600, router: 1000 });
  assert.deepEqual(budgetFor("listings-only", inForce), { monthlyMicroInr: 6 * RUPEE, daily: { owner_talk: 10, listing_draft: 10, customer_talk: 30 } });
  for (const b of ["basic", "business", "operations", "listings-only"] as const) assert.equal(isBudgetConfig(budgetFor(b, inForce)), true, b);
  assert.equal(budgetFor("basic", before), undefined, "the list before 19 Nov has none");
  assert.equal(budgetFor(null, inForce), undefined);
  assert.equal(budgetFor("platinum", inForce), undefined);
  const lacking = { rates: { ...inForce.rates, "ai.daily.router": undefined } };
  assert.equal(budgetFor("basic", lacking), undefined);
  const d = discoveryBudgetFor(inForce)!;
  assert.deepEqual([d.monthlyMicroInr, d.daily.buyer, d.perBuyerPerDay], [2500 * RUPEE, 1500, 12]);
  assert.equal(discoveryBudgetFor(before), undefined);
});

test("a shop with a plan from fleet reads its budget from the list in force, and it is written into the generated runtime config only; a shop with no plan gets none", () => {
  const t = tempServer(); try {
    const answer = (plan: string | null) => { mkdirSync(t.paths.fleet, { recursive: true }); writeFileSync(t.paths.fleetAnswer("glow-salon"), JSON.stringify({ schema: 1, at: "2026-11-20T10:00:00.000Z", plan, allowance: 3000, innovator: false, ai: "normal", warn: [] })); };
    answer(null);
    assert.equal(t.shop("glow-salon").budget, undefined, "a builder's own shop has no plan from fleet: it brings its own AI key");
    answer("business");
    const shop = t.shop("glow-salon");
    assert.deepEqual(shop.budget, budgetFor("business", inForce));
    const withIt = planShop(serverConfig(), shop);
    assert.deepEqual(withIt.runtime.budget, budgetFor("business", inForce));
    assert.equal(validateRuntimeConfig(withIt.runtime, "/").ok, true, "so the shop starts");
    assert.deepEqual([withIt.notes, withIt.problems], [[], []]);
    assert.equal("budget" in planShop(serverConfig(), { ...shop, budget: undefined }).runtime, false);
  } finally { t.done(); }
});

test("an older template that does not know budget: it is skipped, the shop starts, and a note says why", () => {
  const notes: string[] = [];
  const runtime = { mode: "fakes" };
  const old = (c: unknown) => ("budget" in (c as object) ? { ok: false } : { ok: true });
  assert.deepEqual(withBudget(runtime, budgetFor("basic", inForce), old, notes), runtime);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /does not know the budget setting yet, so only fleet's cap limits its model spend/u);
  assert.deepEqual(withBudget({}, budgetFor("basic", inForce), old, []), {}, "no runtime, nothing to add to");
  assert.deepEqual(withBudget(runtime, undefined, old, []), runtime);
});

test("the runtime's own check refuses a budget that is not whole numbers of known features", () => {
  const base = { mode: "fakes" };
  assert.equal(validateRuntimeConfig({ ...base, budget: budgetFor("basic", inForce) }, "/").ok, true);
  for (const bad of [{ monthlyMicroInr: 1.5, daily: {} }, { monthlyMicroInr: 1, daily: { owner_talk: 0 } }, { monthlyMicroInr: 1, daily: { x: 3 } }, "20", { daily: {} }]) {
    const r = validateRuntimeConfig({ ...base, budget: bad }, "/");
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.match((r as { errors: string[] }).errors.join(" "), /"budget" must be/u);
  }
});

test("a listing draft is counted in the shop's AI spend like a talk turn, so fleet's cap and its 50% alert see it", () => {
  const draft = { seq: 1, time: "2026-11-18T03:00:00Z", conversation: "owner", booking: null, action: "listing_draft", inputsDigest: "d", outcome: "confirmed", language: "en", refs: { step: "model", provider: "deepinfra", model: "m", inputTokens: "800", outputTokens: "900", costMicroInr: "98000", result: "checked" } };
  assert.equal(isOwnerAssistantRead(draft), true);
  const t = summarizeUsage([draft], usageRatesFrom([inForce]));
  assert.equal(t.messages, 0, "a draft is not a customer message");
  assert.equal(t.modelMicroInr, 98000);
});

test("the Operator's panel line: read field by field from the runtime's status, only the two levels that need an eye, never invented", () => {
  const summary = (level: string, used: number) => ({ monthlyMicroInr: 20 * RUPEE, usedMicroInr: used, basisPoints: 8000, level, features: {} });
  assert.deepEqual(budgetOf(summary("warn", 16 * RUPEE)), { level: "warn", usedPaise: 1600, limitPaise: 2000 });
  assert.deepEqual(budgetOf(summary("full", 20 * RUPEE)), { level: "full", usedPaise: 2000, limitPaise: 2000 });
  for (const odd of [summary("ok", 1), undefined, null, "warn", { level: "warn" }, summary("warn", -1), summary("warn", 1.5)]) assert.equal(budgetOf(odd), undefined, JSON.stringify(odd));
  const fleet = { at: "2026-11-18", plan: "basic" as const, allowance: 1000, innovator: false, ai: "normal" as const, warn: [] };
  assert.deepEqual(planView(fleet, null, false, summary("warn", 16 * RUPEE))!.budget, { level: "warn", usedPaise: 1600, limitPaise: 2000 });
  assert.equal(planView(fleet, null, false, summary("ok", 1 * RUPEE))!.budget, undefined);
  assert.equal("budget" in planView(fleet, null)!, false, "a shop with no budget reads as before");
});

test("the model Guard's wall is checked against the shops' budgets and said in plain words, never refused", () => {
  const budgets = Array.from({ length: 40 }, () => budgetFor("business", inForce));
  assert.deepEqual(wallNotes(undefined, budgets), [], "2,000 calls a day (the default) pays for the shops' budgets");
  assert.deepEqual(wallNotes(undefined, [undefined, undefined]), [], "shops with no budget add nothing to say");
  const notes = wallNotes(50, budgets);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /50 calls a day/u);
  assert.equal(WORST_CALL_MICRO_INR >= 140_000, true, "the dearest call is at least the table's own price for the longest prompt and reply");
});

test("an unreadable price list is said in the deploy, not hidden as 'no budget'", () => {
  assert.deepEqual(priceListNotes(() => inForce), []);
  const notes = priceListNotes(() => { throw new Error("no such folder"); });
  assert.equal(notes.length, 1);
  assert.match(notes[0], /could not be read \(no such folder\).*no shop was given a model budget/u);
});
