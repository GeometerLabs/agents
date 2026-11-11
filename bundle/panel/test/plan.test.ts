// The shop's plan on its page (B48, B56): what fleet last said (fleet/<shop>.json, written by ops), the Innovator badge, the plan price,
// button mode in plain words, and the warnings. Fleet saying nothing is not "no plan".
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseFleetAnswer } from "../contract.ts";
import { PRICES_DIR, latestPriceList, loadPriceList } from "../cost.ts";
import { planView } from "../plan.ts";
import { WORDS } from "../languages.ts";
import { accountIdOf, boot } from "./helpers.ts";
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

test("the plan view: fleet's facts and Geometer's charge, the plan's fee on Geometer's server and the builder licence on a builder's own, the same for an innovator, and no price when there is no list", () => {
  // By name: a dated list never changes. The 11 Nov list's builder licence differs from every plan's fee (on 9 Nov it equalled Basic's), so a builder's price
  // below can only be the licence. It is read from the list, never written here.
  const list = loadPriceList(new URL("2026-11-11.json", PRICES_DIR).pathname);
  const licence = list.rates["licence.builder.fee"].micro! / 10_000;
  const read = (more: Record<string, unknown>) => parseFleetAnswer(JSON.stringify(answer(more)));
  assert.equal(planView(undefined, list), undefined);
  assert.deepEqual(planView(read({}), list)!.price, { paise: 29_900, licence: false });
  assert.deepEqual(planView(read({ innovator: true }), list)!.price, { paise: 29_900, licence: false }, "the Innovator badge is a badge, not a price");
  assert.deepEqual(planView(read({ plan: "basic", allowance: 1000 }), list)!.price, { paise: 14_900, licence: false });
  assert.ok(!["basic", "business", "operations"].some((p) => list.rates[`plan.${p}.fee`].micro! / 10_000 === licence), "the licence is not a plan's fee on this list");
  for (const plan of ["basic", "business", "operations"]) assert.deepEqual(planView(read({ plan }), list, true)!.price, { paise: licence, licence: true }, plan);
  assert.equal(planView(read({}), null)!.price, undefined);
  assert.equal(planView(read({ plan: null, allowance: null }), list)!.price, undefined, "no plan, no price");
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
    const live = latestPriceList();
    const rupees = (id: string) => `₹${(live.rates[id].micro! / 1_000_000).toLocaleString("en-IN")}.00`;
    fleet(b, answer());
    const plain = (await arjun.get("/shops/glow-salon")).plain;
    assert.ok(plain.includes(en.is("Business")) && plain.includes(en.included(3000)));
    assert.ok(plain.includes(en.priceBuilder(rupees("licence.builder.fee"))) && plain.includes(en.priceNote), "a panel on a builder's own server: the builder licence, and how a shop is counted");
    assert.ok(plain.includes(`(${en.builderLicence})`), "the running-cost line says it is the builder licence");
    assert.ok(!plain.includes(en.innovator) && !plain.includes(en.buttons));
    fleet(b, answer({ innovator: true }));
    const badge = (await arjun.get("/shops/glow-salon")).plain;
    assert.ok(badge.includes(en.innovator) && badge.includes(en.priceBuilder(rupees("licence.builder.fee"))), "the badge, and the same price");
    // (the plan section never uses that word for the innovators)
    for (const l of ["en", "hi", "ml", "kn"] as const) assert.doesNotMatch(JSON.stringify(Object.values(WORDS[l].plan).map((v) => (typeof v === "function" ? v("x", "y") : v))), new RegExp("found" + "ing", "iu"));
    fleet(b, answer({ plan: null, allowance: null }));
    const none = (await arjun.get("/shops/glow-salon")).plain;
    assert.ok(none.includes(en.none) && !none.includes(en.priceNote));
    // the running-cost line is on the list in force
    assert.ok(none.includes(live.date));
  } finally { await b.close(); }
  const hosted = await boot({}, { mode: "hosted" });
  try {
    const divya = await hosted.account("divya", "partner"); hosted.addShop("glow-salon", { name: "Glow Salon", ownerId: accountIdOf(hosted, "divya"), ownerName: "Divya", ownerRole: "partner" });
    fleet(hosted, answer());
    const page = (await divya.get("/shops/glow-salon")).plain;
    const live = latestPriceList();
    assert.ok(page.includes(en.price(`₹${(live.rates["plan.business.fee"].micro! / 1_000_000).toLocaleString("en-IN")}.00`)), "on Geometer's server: the plan's fee");
    assert.ok(!page.includes(en.builderLicence));
  } finally { await hosted.close(); }
});

test("button mode is said in plain words with its reason, and so are the warnings; a code the panel does not know is not shown", async () => {
  const b = await boot();
  try {
    const arjun = await b.account("arjun", "builder"); b.addShop("glow-salon", { name: "Glow Salon" });
    fleet(b, answer({ ai: "buttons", reason: "overage_unfunded", warn: ["allowance_80", "balance_80", "whatsapp_unsettled", "ai_cap", "from_the_future"] }));
    const plain = (await arjun.get("/shops/glow-salon")).plain;
    assert.ok(plain.includes(en.buttons) && plain.includes(en.buttonsWhy.overage_unfunded));
    for (const k of ["allowance_80", "balance_80", "whatsapp_unsettled", "ai_cap"] as const) assert.ok(plain.includes(en.warn[k]), k);
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
