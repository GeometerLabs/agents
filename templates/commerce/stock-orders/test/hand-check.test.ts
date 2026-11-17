// The hand check's situations all hold on the example shop and on a second shop of different shape (no paused supplier, no two-unit item): the ones the settings cannot
// express are named and not counted.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runOn } from "../crash-test/situations.ts";
import { glowSalon } from "../src/harness.ts";
import { parseSettings } from "../src/settings.ts";

test("every situation holds on the example shop", async () => {
  const run = await runOn(glowSalon());
  const failed = run.results.filter((r) => !r.held);
  assert.equal(failed.length, 0, failed.map((r) => `${r.situation.title}: ${r.checks.filter((c) => !c.passed).map((c) => `${c.label} (${c.detail})`).join("; ")}`).join("\n"));
  assert.equal(run.results.length, 17);
});

test("on a smaller shop the situations it cannot express are skipped, and the rest hold", async () => {
  const base = glowSalon() as any;
  const small = parseSettings({
    ...structuredClone(base), items: base.items.slice(0, 1), suppliers: base.suppliers.slice(0, 2),
    catalogue: [{ item: "hair-colour", supplier: "ravi-traders", unit: "box", priceInr: 450, reorderQty: 10 }],
  });
  const run = await runOn(small);
  assert.ok(run.skipped.length >= 2);
  assert.equal(run.results.filter((r) => !r.held).length, 0);
});
