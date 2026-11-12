// The sell guides are made from their source files and the price list in force (render.ts): every placeholder is a rate in the list, amounts are written the way the
// guides write them, every guide in the templates has a source, and none is behind its source or the list.
import { strict as assert } from "node:assert";
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { cardFiles } from "../modules/ask-card/render.ts";
import { REPO, dayWords, formatRate, listInForce, render, sources, stale } from "./render.ts";

const LIST = listInForce();

test("a rate is written as the guides write it: rupees with Indian grouping, a share as a percent, a count with grouping", () => {
  assert.equal(formatRate("a", { currency: "INR", micro: 149_000_000 }), "₹149");
  assert.equal(formatRate("a", { currency: "INR", micro: 1_499_000_000 }), "₹1,499");
  assert.equal(formatRate("a", { currency: "INR", micro: 4_900_000 }), "₹4.90");
  assert.equal(formatRate("a", { currency: "INR", micro: 150_000_000_000 }), "₹1,50,000");
  assert.equal(formatRate("a", { basisPoints: 236 }), "2.36%");
  assert.equal(formatRate("a", { basisPoints: 8000 }), "80%");
  assert.equal(formatRate("a", { count: 10_000 }), "10,000");
  assert.throws(() => formatRate("a", { currency: "USD", micro: 1000 }), /rupees only/u);
  assert.equal(dayWords("2026-11-09"), "9 November 2026");
});

test("a placeholder the list does not have stops the render and names the file and the id; {{date}} is the list's day", () => {
  assert.equal(render("Basic {{plan.basic.fee}}, from the list of {{date}}.", LIST), `Basic ${formatRate("plan.basic.fee", LIST.rates["plan.basic.fee"])}, from the list of ${dayWords(LIST.date)}.`);
  assert.throws(() => render("{{plan.gold.fee}} and {{guide.nothing.here}}", LIST, "guide.xx.src.md"), /guide\.xx\.src\.md names \{\{plan\.gold\.fee\}\}, \{\{guide\.nothing\.here\}\}/u);
  assert.throws(() => render("{{ plan.basic.fee }}", LIST), /not written \{\{id\}\}/u);
});

test("every sell guide in the templates has a source file, and every source renders with the list in force", () => {
  const made = new Set(sources().map((s) => relative(REPO, s).replace(/\.src\.md$/u, ".md")));
  // The "What to ask the shop for" cards (sell/ask-card.<lang>.md, B72) sit beside the guides but are made by another generator, from
  // modules/ask-card/list.ts, with their own drift test. They carry no list price, so they need no {{id}} source here; if one ever names a
  // rupee figure, it must come from the list and this exemption stops it.
  const cards = cardFiles();
  for (const c of cards) assert.doesNotMatch(c.text, /₹\s?\d/u, `${c.path} names a rupee figure: a price belongs in a guide's source with {{id}} placeholders`);
  const byOtherGenerator = new Set(cards.map((c) => c.path));
  const guides: string[] = [];
  for (const domain of readdirSync(join(REPO, "templates"), { withFileTypes: true }).filter((e) => e.isDirectory())) {
    for (const name of readdirSync(join(REPO, "templates", domain.name), { withFileTypes: true }).filter((e) => e.isDirectory())) {
      const sell = join("templates", domain.name, name.name, "sell");
      let files: string[];
      try { files = readdirSync(join(REPO, sell), { recursive: true }) as string[]; } catch { continue; }
      for (const f of files) if (/(^|\/)(guide|[a-z-]+)\.[a-z]{2}\.md$/u.test(f) && !f.endsWith(".src.md") && !byOtherGenerator.has(join(sell, f))) guides.push(join(sell, f));
    }
  }
  assert.ok(guides.length >= 16, `${guides.length} guides`);
  for (const g of guides) assert.ok(made.has(g), `${g} has no source file: write ${g.replace(/\.md$/u, ".src.md")} with {{id}} placeholders`);
});

test("no guide is behind its source or the price list in force (node prices/render.ts writes them)", () => {
  assert.deepEqual(stale(), []);
});
