// The panel's shop parts (decision 65, panel/parts.ts and views-parts.ts): a live single-template shop takes a second part (it becomes a parts shop, its old template first and
// carried), a parts shop takes a third, the plan's parts limit refuses one too many, a part is taken out only when nothing of it is open (and never the carried or the last
// one), and the page is in four languages. The deploy's own rule (lib/server.ts readShop) is the same function (lib/parts-limit.ts), tested here on a price list's rate.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { addPart, addable, exampleBlock, openCasesOf, partsOf, removePart } from "../parts.ts";
import { partsLinkWord, partsPage } from "../views-parts.ts";
import { partsLimitFor, partsProblem } from "../../lib/parts-limit.ts";
import { validateSettings } from "../../../templates/commerce/parts/src/settings.ts";
import { LANGUAGES } from "../../../modules/language/languages.ts";

const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as Record<string, any>;
const credit = read("../../../templates/education/fees/settings/hardware-credit.example.json");
const glow = read("../../../templates/commerce/stock-orders/settings/glow-salon.example.json");
const hold = read("../../../templates/commerce/orders/settings/ganesh-electricals-hold.example.json");
// the credit book's shop as the hold's: the same shop's top (its name, owner, languages, time zone), the hold's own block
// (the credit shop speaks four languages, so every name the hold's customers may write is given in all four)
const four = (names: Record<string, string[]>) => ({ en: names.en, hi: names.en, ml: names.en, kn: names.kn ?? names.en });
const holdBlock = (() => {
  const b = structuredClone(exampleBlock("orders", hold)) as any;
  for (const m of b.menu) m.names = four(m.names);
  for (const sl of b.pickup.slots) sl.names = four(sl.names);
  return b;
})();
const stockBlock = exampleBlock("stock-orders", glow);

test("a live credit-book shop takes the pickup hold: it becomes a parts shop, the credit book first and carried, pinned to the parts template", () => {
  assert.deepEqual(addable(credit, "fees@0.2.0"), ["orders", "stock-orders"]);
  const made = addPart({ settings: credit, lock: "fees@0.2.0", part: "orders", block: holdBlock });
  assert.ok(made.ok, JSON.stringify(made));
  assert.match(made.lock, /^parts@\d+\.\d+\.\d+$/u);
  assert.equal(made.settings.carried, "fees");
  assert.deepEqual(partsOf(made.settings, made.lock), ["fees", "orders"]);
  assert.equal(made.settings.name, credit.name, "the shop's name stays the shop's");
  const checked = validateSettings(made.settings);
  assert.ok(checked.ok && checked.settings.parts[0].settings.creditBook.people.length === 3, "the credit book's people are as they were");
  // and then Stock orders: three parts
  const third = addPart({ settings: made.settings, lock: made.lock, part: "stock-orders", block: stockBlock });
  assert.ok(third.ok, JSON.stringify(third));
  assert.deepEqual(partsOf(third.settings, third.lock), ["fees", "orders", "stock-orders"]);
  assert.deepEqual(addable(third.settings, third.lock), []);
});

test("refused: a part the shop has, a template that cannot be a part, a block that is not one, a part whose settings fail its own check", () => {
  assert.ok(!addPart({ settings: credit, lock: "fees@0.2.0", part: "fees", block: {} }).ok);
  assert.ok(!addPart({ settings: credit, lock: "fees@0.2.0", part: "bookings", block: {} }).ok);
  assert.ok(!addPart({ settings: credit, lock: "fees@0.2.0", part: "orders", block: [] }).ok);
  const bad = addPart({ settings: credit, lock: "fees@0.2.0", part: "orders", block: { ...holdBlock, menu: [] } });
  assert.ok(!bad.ok && bad.errors.every((e) => e.startsWith("parts.orders: ")), JSON.stringify(bad));
  assert.deepEqual(addable(credit, "bookings@0.2.0"), [], "a Bookings shop takes no parts yet");
});

test("the parts limit: one setting in the price list in force, absent is no limit, and one part too many is refused", () => {
  const list = { rates: { "plan.basic.parts": { count: 1 }, "plan.business.parts": { count: 3 } } };
  assert.equal(partsLimitFor("basic", list), 1);
  assert.equal(partsLimitFor("operations", list), undefined, "a plan with no such rate has no limit");
  assert.equal(partsLimitFor(null, list), undefined, "a shop with no plan (a builder's own server) has no limit");
  assert.equal(partsLimitFor("basic", { rates: {} }), undefined);
  assert.equal(partsProblem(3, "business", 3), undefined);
  assert.match(partsProblem(2, "basic", 1)!, /runs 2 parts and its plan \(basic\) allows 1/u);
  const refused = addPart({ settings: credit, lock: "fees@0.2.0", part: "orders", block: holdBlock, plan: "basic", limit: partsLimitFor("basic", list) });
  assert.ok(!refused.ok && /allows 1/u.test(refused.errors[0]));
  assert.ok(addPart({ settings: credit, lock: "fees@0.2.0", part: "orders", block: holdBlock, plan: "business", limit: partsLimitFor("business", list) }).ok);
});

test("taking a part out: only when none of its cases is open, never the carried part or the last one; what is left is checked", () => {
  const two = addPart({ settings: credit, lock: "fees@0.2.0", part: "orders", block: holdBlock });
  assert.ok(two.ok);
  const three = addPart({ settings: two.settings, lock: two.lock, part: "stock-orders", block: stockBlock });
  assert.ok(three.ok);
  const counts = { "orders:confirmed": 1, "orders:completed": 4, "stock-orders:received": 2, "fees:open": 3 };
  assert.equal(openCasesOf(counts, "orders"), 1);
  assert.equal(openCasesOf(counts, "stock-orders"), 0);
  assert.equal(openCasesOf({ "orders:a_state_not_known": 1 }, "orders"), 1, "a state not known as finished is open");
  assert.match((removePart({ settings: three.settings, lock: three.lock, part: "orders", openCases: 1 }) as { errors: string[] }).errors[0], /still has 1 open case/u);
  assert.ok(!removePart({ settings: three.settings, lock: three.lock, part: "orders", openCases: undefined }).ok, "a runtime that cannot be asked takes nothing out");
  assert.match((removePart({ settings: three.settings, lock: three.lock, part: "fees", openCases: 0 }) as { errors: string[] }).errors[0], /before it had parts/u);
  const out = removePart({ settings: three.settings, lock: three.lock, part: "stock-orders", openCases: 0 });
  assert.ok(out.ok);
  assert.deepEqual(partsOf(out.settings, out.lock), ["fees", "orders"]);
  assert.ok(!removePart({ settings: credit, lock: "fees@0.2.0", part: "fees", openCases: 0 }).ok, "a single-template shop has no part to take out");
});

test("the parts page is in four languages, lists the parts, marks the carried one, and offers only what can be added", () => {
  const made = addPart({ settings: credit, lock: "fees@0.2.0", part: "orders", block: holdBlock });
  assert.ok(made.ok);
  for (const lang of LANGUAGES) {
    const c = { lang, csrf: "t", w: { common: { back: "back" } } } as never;
    const page = partsPage(c, { id: "lakshmi", name: "Sri Lakshmi Hardware", parts: partsOf(made.settings, made.lock), carried: "fees", addable: [{ part: "stock-orders", block: "{}" }], limit: 3 });
    assert.match(page, /action="\/shops\/lakshmi\/parts\/add"/u);
    assert.match(page, /name="part" value="stock-orders"/u);
    assert.match(page, /action="\/shops\/lakshmi\/parts\/remove"[^]*name="part" value="orders"/u, "the hold can be taken out");
    assert.doesNotMatch(page, /name="part" value="fees"><button/u, "the carried credit book has no remove button");
    assert.ok(partsLinkWord(lang).length > 0);
  }
});
