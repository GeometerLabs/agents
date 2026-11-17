// The two limits the owner may tighten by a tap (src/chat-limits.ts): the per-order cap and the monthly budget. Whatever the owner taps, the settings that result must still be a
// shop that starts (the settings check refuses a cap below the dearest line and a cap above the budget), so the bounds are tested against the real settings check.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CHAT_LIMITS } from "../src/chat-limits.ts";
import { glowSalon } from "../src/harness.ts";
import { validateSettings } from "../src/settings.ts";
import { applyInForce, baseValues, isStrictlyTighter, withinBounds } from "../../../../modules/limits/chat-limits.ts";

const [cap, budget] = CHAT_LIMITS;

test("both limits are declared, as lower-is-tighter amounts in rupees, at the settings' own paths", () => {
  assert.deepEqual(CHAT_LIMITS.map((l) => [l.id, l.path, l.unit, l.tighter]), [["order_cap", "limits.maxPerOrderInr", "inr", "lower"], ["monthly_budget", "limits.monthlyBudgetInr", "inr", "lower"]]);
  for (const l of CHAT_LIMITS) for (const lang of ["en", "hi", "ml", "kn"] as const) { assert.ok(l.name[lang] && l.rule[lang].includes("{v}"), `${l.id} ${lang}`); }
});

test("the cap cannot be tapped below the dearest catalogue line, nor the budget below the cap", () => {
  const s = glowSalon();
  const dearest = Math.ceil(Math.max(...s.catalogue.map((l) => l.priceInr)));
  assert.equal(cap.bounds(s).min, dearest);
  assert.ok(!withinBounds(cap, s, dearest - 1));
  assert.ok(withinBounds(cap, s, dearest));
  assert.equal(budget.bounds(s).min, s.limits.maxPerOrderInr);
  assert.ok(!withinBounds(budget, s, s.limits.maxPerOrderInr - 1));
});

test("every value inside the bounds makes settings that still pass the settings check", () => {
  const s = glowSalon();
  const raw = () => JSON.parse(JSON.stringify(s)) as Record<string, any>;
  for (const to of [cap.bounds(s).min, Math.floor((cap.bounds(s).min + s.limits.maxPerOrderInr) / 2), s.limits.maxPerOrderInr - 1]) {
    if (!isStrictlyTighter(cap, s.limits.maxPerOrderInr, to)) continue;
    const next = raw(); next.limits.maxPerOrderInr = to;
    assert.equal(validateSettings(next).ok, true, `cap ${to}`);
  }
  const tighterBudget = budget.bounds(s).min;
  const next = raw(); next.limits.monthlyBudgetInr = tighterBudget;
  assert.equal(validateSettings(next).ok, true, "budget at its lowest");
  assert.deepEqual(applyInForce(CHAT_LIMITS, raw(), baseValues(CHAT_LIMITS, s), []), [], "nothing in force changes nothing");
});

test("the settings now ask for whole rupees in both limits", () => {
  const raw = JSON.parse(JSON.stringify(glowSalon()));
  raw.limits.maxPerOrderInr = 120.5;
  assert.equal(validateSettings(raw).ok, false);
});
