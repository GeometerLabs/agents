// The shop's plan on its page (B48, B56): what fleet last said (fleet/<shop>.json, written by ops), the Innovator badge, the plan price,
// button mode in plain words, and the warnings. Fleet saying nothing is not "no plan".
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseFleetAnswer } from "../contract.ts";
import { latestPriceList } from "../cost.ts";
import { planView } from "../plan.ts";
import { WORDS } from "../languages.ts";
import { boot } from "./helpers.ts";
import type { Boot } from "./helpers.ts";

const AT = "2026-11-05T10:00:00.000Z";
const answer = (more: Record<string, unknown> = {}) => ({ schema: 1, at: AT, plan: "business", allowance: 3000, innovator: false, ai: "normal", warn: [], ...more });
const fleet = (b: Boot, value: unknown, shop = "glow-salon") => { mkdirSync(join(b.dir, "fleet"), { recursive: true }); writeFileSync(join(b.dir, "fleet", `${shop}.json`), typeof value === "string" ? value : JSON.stringify(value)); };
const en = WORDS.en.plan;

test("the panel reads fleet's file field by field: a wrong field is dropped, an unknown ai is nothing, and a missing file says nothing", () => {
  assert.equal(parseFleetAnswer(undefined), undefined);
  assert.equal(parseFleetAnswer("{ not json"), undefined);
  assert.equal(parseFleetAnswer(JSON.stringify(answer({ ai: "turbo" }))), undefined);
  assert.equal(parseFleetAnswer(JSON.stringify(answer({ schema: 2 }))), undefined);
  assert.equal(parseFleetAnswer(JSON.stringify(answer({ at: "yesterday" }))), undefined);
  assert.deepEqual(parseFleetAnswer(JSON.stringify(answer({ plan: "platinum", allowance: -1, innovator: "yes", reason: "overage_unfunded", warn: ["balance_80", 5, "has spaces"] }))), { at: AT, plan: null, allowance: null, innovator: false, ai: "normal", warn: ["balance_80"] }, "a reason belongs to buttons only");
  assert.deepEqual(parseFleetAnswer(JSON.stringify(answer({ ai: "buttons", reason: "overage_unfunded" }))), { at: AT, plan: "business", allowance: 3000, innovator: false, ai: "buttons", reason: "overage_unfunded", warn: [] });
});

test("the plan view: fleet's facts and the plan price, with the Innovator discount only for an innovator, and no price when there is no list", () => {
  const proposed = latestPriceList();
  const read = (more: Record<string, unknown>) => parseFleetAnswer(JSON.stringify(answer(more)));
  assert.equal(planView(undefined, proposed), undefined);
  assert.deepEqual(planView(read({}), proposed)!.price, { listPaise: 29_900, yoursPaise: 29_900 });
  assert.deepEqual(planView(read({ innovator: true }), proposed)!.price, { listPaise: 29_900, yoursPaise: 17_940 }, "40% off, in whole paise");
  assert.deepEqual(planView(read({ plan: "basic", allowance: 1000, innovator: true }), proposed)!.price, { listPaise: 9_900, yoursPaise: 5_940 });
  assert.equal(planView(read({}), null)!.price, undefined);
  assert.equal(planView(read({ plan: null, allowance: null }), proposed)!.price, undefined, "no plan, no price");
});

test("a shop with no word from fleet shows no plan section at all, and a garbled file is the same", async () => {
  const b = await boot();
  try {
    const arjun = await b.account("arjun", "builder"); b.addShop("glow-salon", { name: "Glow Salon" });
    assert.ok(!(await arjun.get("/shops/glow-salon")).plain.includes(en.priceNote));
    fleet(b, "{ garbage");
    const page = (await arjun.get("/shops/glow-salon")).plain;
    assert.ok(!page.includes(en.priceNote) && !page.includes(en.none));
  } finally { await b.close(); }
});

test("a shop on a plan: the plan, the included messages, the plan price, and the Innovator badge only when fleet says so", async () => {
  const b = await boot();
  try {
    const arjun = await b.account("arjun", "builder"); b.addShop("glow-salon", { name: "Glow Salon" });
    fleet(b, answer());
    const plain = (await arjun.get("/shops/glow-salon")).plain;
    assert.ok(plain.includes(en.is("Business")) && plain.includes(en.included(3000)));
    assert.ok(plain.includes(en.price("₹299.00")) && plain.includes(en.priceNote), "the price says how a shop is counted");
    assert.ok(!plain.includes(en.innovator) && !plain.includes(en.buttons));
    fleet(b, answer({ innovator: true }));
    const badge = (await arjun.get("/shops/glow-salon")).plain;
    assert.ok(badge.includes(en.innovator) && badge.includes(en.priceInnovator("₹299.00", "₹179.40")));
    // (the plan section never uses that word for the innovators)
    for (const l of ["en", "hi", "ml", "kn"] as const) assert.doesNotMatch(JSON.stringify(Object.values(WORDS[l].plan).map((v) => (typeof v === "function" ? v("x", "y") : v))), new RegExp("found" + "ing", "iu"));
    fleet(b, answer({ plan: null, allowance: null }));
    const none = (await arjun.get("/shops/glow-salon")).plain;
    assert.ok(none.includes(en.none) && !none.includes(en.priceNote));
    // the running-cost line is on the list in force, and names the plan
    assert.ok(none.includes("2026-11-07"));
  } finally { await b.close(); }
});

test("button mode is said in plain words with its reason, and so are the warnings; a code the panel does not know is not shown", async () => {
  const b = await boot();
  try {
    const arjun = await b.account("arjun", "builder"); b.addShop("glow-salon", { name: "Glow Salon" });
    fleet(b, answer({ ai: "buttons", reason: "overage_unfunded", warn: ["allowance_80", "balance_80", "whatsapp_unsettled", "from_the_future"] }));
    const plain = (await arjun.get("/shops/glow-salon")).plain;
    assert.ok(plain.includes(en.buttons) && plain.includes(en.buttonsWhy.overage_unfunded));
    for (const k of ["allowance_80", "balance_80", "whatsapp_unsettled"] as const) assert.ok(plain.includes(en.warn[k]), k);
    assert.ok(!plain.includes("from_the_future"));
    fleet(b, answer({ ai: "buttons", reason: "something_new" }));
    assert.ok((await arjun.get("/shops/glow-salon")).plain.includes(en.buttonsWhy.other), "any other reason is said generally");
    fleet(b, answer({ ai: "normal" }));
    assert.ok(!(await arjun.get("/shops/glow-salon")).plain.includes(en.buttons));
  } finally { await b.close(); }
});

test("the plan section is in the reader's language", async () => {
  const b = await boot();
  try {
    const divya = await b.account("divya", "builder", "hi"); b.addShop("glow-salon", { name: "Glow Salon" });
    fleet(b, answer({ innovator: true, ai: "buttons", reason: "overage_unfunded", warn: ["balance_80"] }));
    const plain = (await divya.get("/shops/glow-salon")).plain;
    const hi = WORDS.hi.plan;
    for (const line of [hi.is(hi.names.business), hi.included(3000), hi.innovator, hi.buttons, hi.buttonsWhy.overage_unfunded, hi.warn.balance_80, hi.priceNote]) assert.ok(plain.includes(line), line);
  } finally { await b.close(); }
});
