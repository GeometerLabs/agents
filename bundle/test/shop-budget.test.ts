// One shop's own model budget (19 Nov 2026): the budget grows with the messages the shop bought this month (the same rule as fleet's cap), and the server admin may give ONE shop numbers of
// its own, in shops/<shop>/budget-override.json, with `geometer shop budget`. Covers the scaling, the override file (valid, invalid, clear), the merge for an agent shop and a
// listings-only shop, the read of fleet's `bought`, the redeploy on a change, the command, and the Operator's read-only panel line. Nothing here calls a model, a service or Docker.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isBudgetConfig } from "../../modules/budget/budget.ts";
import { main } from "../geometer.ts";
import { desiredHashOf } from "../deploy.ts";
import { budgetFor, planBudget } from "../lib/budget.ts";
import { OVERRIDE_FILE, applyOverride, clearOverride, parseOverride, readOverride, writeOverride } from "../lib/budget-override.ts";
import type { BudgetOverride } from "../lib/budget-override.ts";
import { parseShopAnswer } from "../lib/fleet.ts";
import { readShop } from "../lib/server.ts";
import { latestPriceList } from "../panel/cost.ts";
import { planView } from "../panel/plan.ts";
import { WORDS } from "../panel/languages.ts";
import { tempServer } from "./helpers.ts";

const RUPEE = 1_000_000;
const inForce = latestPriceList();
const OVERRIDE: BudgetOverride = { monthlyInr: 40, reason: "busy shop, owner asked", setBy: "Naval", date: "2026-11-19" };
/** A moment inside the month of the answer files below, so the "answer from an earlier month" rule does not apply. */
const NOW = new Date("2026-11-20T12:00:00Z");

/** Fleet's answer file for a shop, as ops writes it. */
function answer(t: ReturnType<typeof tempServer>, shop: string, fields: Record<string, unknown>, at = "2026-11-20T10:00:00.000Z"): void {
  mkdirSync(t.paths.fleet, { recursive: true });
  writeFileSync(t.paths.fleetAnswer(shop), JSON.stringify({ schema: 1, at, plan: "basic", allowance: 1000, innovator: false, ai: "normal", warn: [], ...fields }));
}

test("the budget grows with the messages bought, the way fleet's cap does: monthly = ai.budget.<plan> x (allowance + bought) / allowance, rounded up; the per-1,000 daily caps follow", () => {
  assert.deepEqual(budgetFor("basic", inForce), budgetFor("basic", inForce, { bought: 0 }), "nothing bought: exactly the list's numbers");
  const basic = budgetFor("basic", inForce, { bought: 1000 })!;
  assert.equal(basic.monthlyMicroInr, 40 * RUPEE, "Basic: 1,000 bought doubles INR 20, and fleet's cap is INR 40 for 2,000 messages");
  assert.deepEqual(basic.daily, { owner_talk: 30, listing_draft: 10, customer_talk: 120, router: 200 }, "customer_talk and router follow the message count; the owner's talk and drafts do not");
  assert.equal(budgetFor("business", inForce, { bought: 500 })!.monthlyMicroInr, 80 * RUPEE, "Business: 500 bought counts as one step of 1,000 (BOUGHT_STEP), so 60 x 4,000 / 3,000");
  assert.deepEqual(budgetFor("business", inForce, { bought: 100 }), budgetFor("business", inForce, { bought: 1000 }), "every block inside one step gives the same budget, so it redeploys the shop once a step");
  assert.equal(isBudgetConfig(basic), true);
  // fleet's own wall for the same shop is never below the shop's budget: ai.cap x messages / 1,000
  assert.equal(basic.monthlyMicroInr, Math.ceil((inForce.rates["ai.cap"].micro! * 2000) / 1000));
  // rounded UP: a list number that does not divide leaves the shop a hair more, never less than fleet's own rounding
  const odd = { rates: { ...inForce.rates, "ai.budget.basic": { micro: 1_000_001 } } };
  assert.equal(budgetFor("basic", odd, { bought: 1 })!.monthlyMicroInr, Math.ceil((1_000_001 * 2000) / 1000), "1 bought is one whole step of 1,000");
  // a wrong number is ignored, never guessed at
  for (const bad of [-5, 1.5, Number.NaN]) assert.deepEqual(budgetFor("basic", inForce, { bought: bad }), budgetFor("basic", inForce), String(bad));
  // a listings-only shop is free and buys nothing
  assert.deepEqual(budgetFor("listings-only", inForce, { bought: 5000 }), budgetFor("listings-only", inForce));
  assert.equal(planBudget("basic", inForce, 1000)!.monthlyMicroInr, 40 * RUPEE, "the plan's own numbers, before any override");
});

test("the override file: valid, whole numbers and known features only, a reason, a name and a real day; plain-word errors", () => {
  assert.equal(parseOverride(JSON.stringify({ ...OVERRIDE, daily: { owner_talk: 50 } })).ok, true);
  assert.equal(parseOverride(OVERRIDE).ok, true, "daily is optional");
  const errors = (v: unknown): string => { const r = parseOverride(v); assert.equal(r.ok, false, JSON.stringify(v)); return (r as { errors: string[] }).errors.join(" | "); };
  assert.match(errors("{nope"), /not valid JSON/u);
  assert.match(errors([]), /must be a JSON object/u);
  assert.match(errors({ ...OVERRIDE, monthlyInr: 40.5 }), /monthlyInr.*whole number of rupees/u);
  assert.match(errors({ ...OVERRIDE, monthlyInr: 0 }), /monthlyInr/u);
  assert.match(errors({ ...OVERRIDE, monthlyInr: 10_000_000 }), /monthlyInr/u);
  assert.match(errors({ ...OVERRIDE, daily: { chatting: 5 } }), /"chatting" is not a feature/u);
  assert.match(errors({ ...OVERRIDE, daily: { buyer: 5 } }), /"buyer" is not a feature a shop/u);
  assert.match(errors({ ...OVERRIDE, daily: { owner_talk: 0 } }), /daily cap for owner_talk/u);
  assert.match(errors({ ...OVERRIDE, daily: { owner_talk: 2.5 } }), /daily cap for owner_talk/u);
  assert.match(errors({ ...OVERRIDE, reason: "" }), /"reason"/u);
  assert.match(errors({ ...OVERRIDE, reason: "two\nlines" }), /"reason"/u);
  assert.match(errors({ ...OVERRIDE, setBy: "" }), /"setBy"/u);
  assert.match(errors({ ...OVERRIDE, date: "2026-02-30" }), /"date" must be a real day/u);
  assert.match(errors({ ...OVERRIDE, extra: 1 }), /"extra" is not something/u);
  const { monthlyInr: _gone, ...none } = OVERRIDE;
  assert.match(errors(none), /monthlyInr/u);
});

test("the override file is written, read back, replaced and cleared; a broken one is a problem in words and never half-applied", () => {
  const dir = mkdtempSync(join(tmpdir(), "geo-override-"));
  try {
    assert.deepEqual(readOverride(dir), {}, "no file, no override");
    assert.equal(clearOverride(dir), false);
    writeOverride(dir, { ...OVERRIDE, daily: { owner_talk: 50 } });
    assert.deepEqual(readOverride(dir), { override: { ...OVERRIDE, daily: { owner_talk: 50 } } });
    writeOverride(dir, OVERRIDE);
    assert.equal(readOverride(dir).override?.daily, undefined, "replaced, not merged");
    assert.throws(() => writeOverride(dir, { ...OVERRIDE, monthlyInr: -1 }), /not usable/u);
    assert.equal(clearOverride(dir), true);
    assert.equal(existsSync(join(dir, OVERRIDE_FILE)), false);
    writeFileSync(join(dir, OVERRIDE_FILE), '{"monthlyInr": "lots"}');
    const bad = readOverride(dir);
    assert.equal(bad.override, undefined);
    assert.match(bad.problem!, /budget-override\.json is not usable: .*monthlyInr.*--clear/u);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the override replaces the numbers it names and leaves the plan's others; with no plan budget it still gives the budget it names", () => {
  const plan = budgetFor("basic", inForce)!;
  const merged = budgetFor("basic", inForce, { override: { ...OVERRIDE, daily: { owner_talk: 50 } } })!;
  assert.equal(merged.monthlyMicroInr, 40 * RUPEE);
  assert.deepEqual(merged.daily, { ...plan.daily, owner_talk: 50 });
  assert.equal(isBudgetConfig(merged), true);
  // it replaces, it does not scale: bought messages do not move a number the admin chose
  assert.equal(budgetFor("basic", inForce, { bought: 1000, override: OVERRIDE })!.monthlyMicroInr, 40 * RUPEE);
  assert.equal(budgetFor("basic", inForce, { bought: 1000, override: OVERRIDE })!.daily.customer_talk, 120, "the daily caps it does not name still follow the plan and the messages bought");
  assert.deepEqual(applyOverride(undefined, OVERRIDE), { monthlyMicroInr: 40 * RUPEE, daily: {} });
  assert.equal(applyOverride(plan, undefined), plan);
});

test("an agent shop: fleet's bought messages and the override reach the shop's budget when its folder is read; a stale answer from an earlier month is not trusted", () => {
  const t = tempServer(); try {
    answer(t, "glow-salon", { bought: 1000 });
    assert.equal(readShop(t.root, "glow-salon", NOW).budget!.monthlyMicroInr, 40 * RUPEE, "a top-up bought mid-month: the next read has the larger budget");
    assert.equal(readShop(t.root, "glow-salon", NOW).boughtThisMonth, 1000);
    assert.equal(readShop(t.root, "glow-salon", new Date("2026-12-01T00:30:00Z")).budget!.monthlyMicroInr, 20 * RUPEE, "the month turned and fleet has not answered yet: back to the plan's");
    answer(t, "glow-salon", {});
    assert.equal(readShop(t.root, "glow-salon", NOW).budget!.monthlyMicroInr, 20 * RUPEE, "nothing bought");
    writeOverride(t.paths.shop("glow-salon"), { ...OVERRIDE, daily: { owner_talk: 50 } });
    const f = readShop(t.root, "glow-salon", NOW);
    assert.equal(f.budget!.monthlyMicroInr, 40 * RUPEE);
    assert.equal(f.budget!.daily.owner_talk, 50);
    assert.equal(f.budget!.daily.customer_talk, 60, "what the override does not name stays the plan's");
    assert.deepEqual(f.planBudget, budgetFor("basic", inForce), "the plan's numbers stay visible beside it");
    assert.deepEqual(f.problems, []);
    // a change of the budget is a change of what the shop is asked to be, so the deployer redeploys it on its next pass (no manual deploy)
    const before = desiredHashOf({ ...f, budget: planBudget("basic", inForce) });
    assert.notEqual(desiredHashOf(f), before);
    clearOverride(t.paths.shop("glow-salon"));
    assert.equal(readShop(t.root, "glow-salon", NOW).budget!.monthlyMicroInr, 20 * RUPEE);
    // a file that cannot be used stops being silently ignored: it is said, and the plan's budget is what is applied meanwhile
    writeFileSync(join(t.paths.shop("glow-salon"), OVERRIDE_FILE), "{}");
    const broken = readShop(t.root, "glow-salon", NOW);
    assert.equal(broken.budget!.monthlyMicroInr, 20 * RUPEE);
    assert.ok(broken.problems.some((p) => /budget-override\.json is not usable/u.test(p)));
  } finally { t.done(); }
});

test("a listings-only shop honours the override too (it has no plan at fleet: its plan is the fixed id listings-only)", () => {
  const t = tempServer(); try {
    writeFileSync(join(t.paths.shop("glow-salon"), "pathway.lock"), "listings@0.1.0\n");
    const plain = readShop(t.root, "glow-salon", NOW).budget!;
    assert.deepEqual(plain, budgetFor("listings-only", inForce));
    writeOverride(t.paths.shop("glow-salon"), { ...OVERRIDE, monthlyInr: 12, daily: { customer_talk: 99 } });
    const shop = readShop(t.root, "glow-salon", NOW).budget!;
    assert.equal(shop.monthlyMicroInr, 12 * RUPEE);
    assert.deepEqual(shop.daily, { ...plain.daily, customer_talk: 99 });
  } finally { t.done(); }
});

test("fleet's `bought` is read whole and above zero only, from an answer that has it; an older answer without it reads as before", () => {
  const base = { plan: "basic", allowance: 1000, innovator: false, ai: "normal", warn: [] };
  assert.equal(parseShopAnswer({ ...base, bought: 1000 })!.bought, 1000);
  assert.equal("bought" in parseShopAnswer(base)!, false);
  for (const bad of [0, -1, 1.5, "1000", null, 1e12]) assert.equal("bought" in parseShopAnswer({ ...base, bought: bad })!, false, String(bad));
});

/** Run `geometer ...` in process against a temp server and collect what it says. */
async function geometer(root: string, ...args: string[]): Promise<{ code: number; out: string }> {
  const out: string[] = []; const log = console.log;
  console.log = (...a: unknown[]) => out.push(a.join(" "));
  try { const code = await main([...args, "--server", root]); return { code, out: out.join("\n") }; } finally { console.log = log; }
}

test("geometer shop budget: shows the plan's numbers, sets the override with a reason, says when fleet's cap must be raised too, and clears", async () => {
  const t = tempServer(); try {
    answer(t, "glow-salon", {}, new Date().toISOString());
    const shown = await geometer(t.root, "shop", "budget", "glow-salon");
    assert.equal(shown.code, 0);
    assert.match(shown.out, /the plan's model budget/u);
    assert.match(shown.out, /a month: INR 20/u);
    assert.match(shown.out, /no budget of its own/u);
    const set = await geometer(t.root, "shop", "budget", "glow-salon", "--monthly-inr", "40", "--reason", "busy shop, owner asked", "--set-by", "Naval", "--daily", "owner_talk=50");
    assert.equal(set.code, 0, set.out);
    assert.match(set.out, /INR 40 a month/u);
    assert.match(set.out, /fleet's cap for this shop must be raised too.*shop ai-cap acme-vps-1 glow-salon --monthly-inr 40/u, "40 is above Basic's INR 20 at fleet");
    const file = JSON.parse(readFileSync(join(t.paths.shop("glow-salon"), OVERRIDE_FILE), "utf8"));
    assert.deepEqual([file.monthlyInr, file.daily, file.reason, file.setBy], [40, { owner_talk: 50 }, "busy shop, owner asked", "Naval"]);
    assert.match(file.date, /^\d{4}-\d{2}-\d{2}$/u);
    const again = await geometer(t.root, "shop", "budget", "glow-salon");
    assert.match(again.out, /set by Naval on .*busy shop, owner asked/u);
    assert.match(again.out, /The result/u);
    // a number at or under fleet's cap needs no fleet command
    const low = await geometer(t.root, "shop", "budget", "glow-salon", "--monthly-inr", "15", "--reason", "quiet", "--set-by", "Naval");
    assert.doesNotMatch(low.out, /fleet's cap/u);
    // refusals in plain words
    assert.match((await geometer(t.root, "shop", "budget", "glow-salon", "--monthly-inr", "4.5", "--reason", "x", "--set-by", "N")).out, /whole number of rupees/u);
    assert.equal((await geometer(t.root, "shop", "budget", "glow-salon", "--monthly-inr", "40", "--set-by", "N")).code, 1, "a reason is required");
    assert.equal((await geometer(t.root, "shop", "budget", "glow-salon", "--monthly-inr", "40", "--reason", "x", "--set-by", "N", "--daily", "chatting=5")).code, 1);
    assert.equal((await geometer(t.root, "shop", "budget", "glow-salon", "--clear", "--monthly-inr", "40")).code, 1, "--clear stands alone");
    assert.equal((await geometer(t.root, "shop", "budget", "no-such-shop")).code, 1);
    const cleared = await geometer(t.root, "shop", "budget", "glow-salon", "--clear");
    assert.match(cleared.out, /back on its plan's model budget/u);
    assert.equal(existsSync(join(t.paths.shop("glow-salon"), OVERRIDE_FILE)), false);
    assert.match((await geometer(t.root, "shop", "budget", "glow-salon", "--clear")).out, /had no budget of its own/u);
  } finally { t.done(); }
});

test("the Operator's panel line is read-only: the override's amount, day and reason, nothing to change it, and none for a shop without one", () => {
  const fleet = { at: "2026-11-20", plan: "basic" as const, allowance: 1000, innovator: false, ai: "normal" as const, warn: [] };
  assert.deepEqual(planView(fleet, null, false, undefined, OVERRIDE)!.ownBudget, { monthlyPaise: 4000, date: "2026-11-19", reason: "busy shop, owner asked" });
  assert.equal("ownBudget" in planView(fleet, null)!, false);
  assert.equal(WORDS.en.plan.budget.own("₹40", "2026-11-19", "busy shop, owner asked"), "Model budget: ₹40 a month, set for this shop on 2026-11-19: busy shop, owner asked");
  for (const l of ["hi", "ml", "kn"] as const) assert.match(WORDS[l].plan.budget.own("₹40", "2026-11-19", "busy shop"), /₹40.*2026-11-19.*busy shop/u, l);
});
