// The shop's model budget on the bundle's side (decision 60, "caps everywhere"): the proposed price list of 18 Nov holds the numbers and nothing else holds them; a shop's
// budget is worked out from the plan and the list IN FORCE (so nothing changes until the owner says yes); it reaches the shop's generated runtime.json only if the runtime
// knows the key; the Operator's panel line reads the runtime's status field by field; a listing's draft is counted in the usage meter; and the model Guard's wall is checked
// against the budgets. Nothing here calls a model.
import { test } from "node:test";
import assert from "node:assert/strict";
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
const RUPEE = 1_000_000;

test("the 18 Nov list is a proposal: it waits for the owner's yes, and until then nothing is priced or capped from it", () => {
  assert.equal(proposed.status, "proposed");
  assert.equal(latestProposedPriceList()?.date, "2026-11-18");
  assert.notEqual(inForce.date, "2026-11-18");
  assert.equal(inForce.rates["ai.budget.basic"], undefined, "the list in force has no budget");
  for (const [id, r] of Object.entries(proposed.rates)) if (id.startsWith("ai.budget.") || id.startsWith("ai.daily.")) assert.match(r.note, /Needs the owner's yes/u, id);
});

test("the proposed numbers: a budget for each plan, equal to ai.cap for the plan's allowance, a small one for a listings-only shop, and the directory's", () => {
  const r = proposed.rates;
  assert.equal(r["ai.cap"].micro, 20 * RUPEE);
  for (const plan of ["basic", "business", "operations"] as const) {
    assert.equal(r[`ai.budget.${plan}`].micro, (r["ai.cap"].micro! * r[`plan.${plan}.allowance`].count!) / 1000, `${plan}: the shop's own budget is the same rupee as fleet's outer wall`);
    assert.ok(r[`ai.budget.${plan}`].micro! < r[`plan.${plan}.fee`].micro! / 4, `${plan}: a budget well under a quarter of the plan's fee`);
  }
  assert.ok(r["ai.budget.listings-only"].micro! < r["ai.budget.basic"].micro!);
  assert.ok(r["ai.budget.discovery"].micro! > 0 && r["ai.daily.discovery.per-buyer"].count! > 0);
});

test("a shop's budget is worked out from its plan and the list; a number the list lacks is never made up", () => {
  const basic = budgetFor("basic", proposed)!;
  assert.equal(basic.monthlyMicroInr, 20 * RUPEE);
  assert.deepEqual(basic.daily, { owner_talk: 30, listing_draft: 10, customer_talk: 60, router: 100 }, "customers' and the router's caps scale with the 1,000 messages");
  assert.deepEqual(budgetFor("business", proposed)!.daily, { owner_talk: 30, listing_draft: 10, customer_talk: 180, router: 300 });
  assert.deepEqual(budgetFor("operations", proposed)!.daily, { owner_talk: 30, listing_draft: 10, customer_talk: 600, router: 1000 });
  assert.deepEqual(budgetFor("listings-only", proposed), { monthlyMicroInr: 6 * RUPEE, daily: { owner_talk: 10, listing_draft: 10, customer_talk: 30 } });
  for (const b of ["basic", "business", "operations", "listings-only"] as const) assert.equal(isBudgetConfig(budgetFor(b, proposed)), true, b);
  assert.equal(budgetFor("basic", inForce), undefined, "the list in force has none, so no shop gets one yet");
  assert.equal(budgetFor(null, proposed), undefined);
  assert.equal(budgetFor("platinum", proposed), undefined);
  const lacking = { rates: { ...proposed.rates, "ai.daily.router": undefined } };
  assert.equal(budgetFor("basic", lacking), undefined);
  const d = discoveryBudgetFor(proposed)!;
  assert.deepEqual([d.monthlyMicroInr, d.daily.buyer, d.perBuyerPerDay], [2500 * RUPEE, 1500, 12]);
  assert.equal(discoveryBudgetFor(inForce), undefined);
});

test("a shop folder reads no budget while the list in force has none, and the plan with a budget writes it into the generated runtime config only", () => {
  const t = tempServer(); try {
    const shop = t.shop("glow-salon");
    assert.equal(shop.budget, undefined, "until the owner's yes");
    assert.equal("budget" in planShop(serverConfig(), shop).runtime, false);
    const withIt = planShop(serverConfig(), { ...shop, budget: budgetFor("business", proposed)! });
    assert.deepEqual(withIt.runtime.budget, budgetFor("business", proposed));
    assert.equal(validateRuntimeConfig(withIt.runtime, "/").ok, true, "so the shop starts");
    assert.deepEqual([withIt.notes, withIt.problems], [[], []]);
  } finally { t.done(); }
});

test("an older template that does not know budget: it is skipped, the shop starts, and a note says why", () => {
  const notes: string[] = [];
  const runtime = { mode: "fakes" };
  const old = (c: unknown) => ("budget" in (c as object) ? { ok: false } : { ok: true });
  assert.deepEqual(withBudget(runtime, budgetFor("basic", proposed), old, notes), runtime);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /does not know the budget setting yet, so only fleet's cap limits its model spend/u);
  assert.deepEqual(withBudget({}, budgetFor("basic", proposed), old, []), {}, "no runtime, nothing to add to");
  assert.deepEqual(withBudget(runtime, undefined, old, []), runtime);
});

test("the runtime's own check refuses a budget that is not whole numbers of known features", () => {
  const base = { mode: "fakes" };
  assert.equal(validateRuntimeConfig({ ...base, budget: budgetFor("basic", proposed) }, "/").ok, true);
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
  const budgets = Array.from({ length: 40 }, () => budgetFor("business", proposed));
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
