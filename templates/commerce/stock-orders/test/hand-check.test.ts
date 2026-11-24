// The hand check's situations all hold on the example shop and on a second shop of different shape (no paused supplier, no two-unit item): the ones the settings cannot
// express are named and not counted.
import { goSkip } from "../../../../modules/crash-test/go-shop.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { runOn } from "../crash-test/situations.ts";
import { glowSalon } from "../src/harness.ts";
import { parseSettings } from "../src/settings.ts";
import { readFileSync } from "node:fs";

test("every situation holds on the example shop", { skip: goSkip("stock-orders") }, async () => {
  const run = await runOn(glowSalon());
  const failed = run.results.filter((r) => !r.held);
  assert.equal(failed.length, 0, failed.map((r) => `${r.situation.title}: ${r.checks.filter((c) => !c.passed).map((c) => `${c.label} (${c.detail})`).join("; ")}`).join("\n"));
  assert.equal(run.results.length, 17);
});

test("on a smaller shop the situations it cannot express are skipped, and the rest hold", { skip: goSkip("stock-orders") }, async () => {
  const base = glowSalon() as any;
  const small = parseSettings({
    ...structuredClone(base), items: base.items.slice(0, 1), suppliers: base.suppliers.slice(0, 2),
    catalogue: [{ item: "hair-colour", supplier: "ravi-traders", unit: "box", priceInr: 450, reorderQty: 10 }],
  });
  const run = await runOn(small);
  assert.ok(run.skipped.length >= 2);
  assert.equal(run.results.filter((r) => !r.held).length, 0);
});

// 25 Nov 2026 (decision 65's starter shop found both): on a shop WITH the assistant, the situation that edits the settings reads them back in their file's shape (the checked
// assistant block is not a settings key), and the assistant's own messages (the morning line) are ones the stand-in WhatsApp knows; on a shop whose item is named with a
// number ("LED bulb 9W"), "<item> is low" orders the line's usual quantity, not the 9.
test("on a shop with the assistant every situation holds", { skip: goSkip("stock-orders") }, async () => {
  const file = JSON.parse(readFileSync(new URL("../settings/glow-salon.example.json", import.meta.url), "utf8")) as Record<string, any>;
  const run = await runOn(parseSettings({ ...file, assistant: {} }));
  const failed = run.results.filter((r) => !r.held);
  assert.equal(failed.length, 0, failed.map((r) => `${r.situation.title}: ${r.checks.filter((c) => !c.passed).map((c) => `${c.label} (${c.detail})`).join("; ")}`).join("\n"));
  assert.ok(run.results.some((r) => r.situation.id === "price-moved"));
});

test("on a shop whose item is named with a number, a low mark orders the usual quantity", { skip: goSkip("stock-orders") }, async () => {
  const file = JSON.parse(readFileSync(new URL("../settings/glow-salon.example.json", import.meta.url), "utf8")) as Record<string, any>;
  // every item's names carry a number written against a letter, as "LED bulb 9W" does: whichever line the situation picks is named so
  file.items = file.items.map((i: any) => ({ ...i, names: Object.fromEntries(Object.entries(i.names as Record<string, string[]>).map(([l, ns]) => [l, ns.map((n) => `${n} 9W`)])) }));
  const run = await runOn(parseSettings(file));
  const low = run.results.find((r) => r.situation.id === "low-stock-never-guesses");
  assert.ok(low && low.held, JSON.stringify(low?.checks.filter((c) => !c.passed)));
});
