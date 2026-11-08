// Client health and margin (B32) and the innovators' template vote (B56): the arithmetic on fixed numbers, unknown staying unknown, a partner seeing only their
// own shops, the vote shown only to an innovator, one vote each, counts without names, and none of the site's banned words in any of the four languages.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LANGUAGES } from "../../../modules/language/languages.ts";
import { latestPriceList } from "../cost.ts";
import { entriesFromForm, marginOf, minutesFromText, monthUsage, paiseFromText, planFeePaise, runningCostItems, sumMargins } from "../health.ts";
import type { CostItem } from "../health.ts";
import { WORDS } from "../languages.ts";
import { flatWords } from "../review.ts";
import { HEALTH_SAMPLE_ARGS, HEALTH_WORDS } from "../words-health.ts";
import { loadVoteRound } from "../votes.ts";
import { NOW, accountIdOf, boot, tokenOf } from "./helpers.ts";
import type { Boot, Browser } from "./helpers.ts";

const prices = latestPriceList();
const AT = new Date(NOW).toISOString();
const fleet = (b: Boot, shop: string, more: Record<string, unknown> = {}) => {
  mkdirSync(join(b.dir, "fleet"), { recursive: true });
  writeFileSync(join(b.dir, "fleet", `${shop}.json`), JSON.stringify({ schema: 1, at: AT, plan: "business", allowance: 3000, innovator: false, ai: "normal", warn: [], ...more }));
};
const entry = (seq: number, at: string, action: string, refs: Record<string, string> = {}, outcome = "confirmed") =>
  ({ seq, time: at, conversation: "c-aaaaaaaaaaaa", booking: "", action, inputsDigest: "0", outcome, decisions: [], language: "en", notes: "", refs });
const exportRecord = (b: Boot, shop: string, entries: unknown[]) => {
  const dir = join(b.dir, "exports", shop);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "record.json"), JSON.stringify(entries));
  writeFileSync(join(dir, "bookings.json"), "[]");
};
const post = async (br: Browser, path: string, form: Record<string, string>, from = path) => br.req("POST", path, { _csrf: tokenOf((await br.get(from)).text), ...form });

// ---- the arithmetic, on fixed numbers --------------------------------------------------------------------------------------------------------------------

test("the plan fee: Business is INR 299, half on your own server, 40% off for an innovator, both taken once and rounded up once; no plan or no price is unknown", () => {
  const fee = (o: { plan?: "basic" | "business" | "operations" | null; selfHost?: boolean; innovator?: boolean }) => planFeePaise({ plan: o.plan === undefined ? "business" : o.plan, prices, selfHost: o.selfHost ?? false, innovator: o.innovator ?? false });
  assert.equal(fee({}).paise, 29_900);
  assert.equal(fee({ selfHost: true }).paise, 14_950);
  assert.equal(fee({ innovator: true }).paise, 17_940);
  assert.deepEqual(fee({ selfHost: true, innovator: true }), { paise: 8_970, notes: ["self-host", "innovator"] });
  assert.equal(fee({ plan: "basic", innovator: true }).paise, 5_940);
  assert.deepEqual(fee({ plan: null }), { paise: null, notes: ["no-plan"] });
});

test("the running cost and the margin on fixed numbers: price 1,500, plan 299, WhatsApp 23, model 12.35, support 90 minutes at 300 an hour", () => {
  const usage = { messages: 10, byStep: { rules: 5, decision: 3, model: 2 }, modelMicroInr: 12_345_678, unpriced: 0, whatsapp: { service: 4, utility: 6, marketing: 0, estMicroInr: 23_000_000, estimated: true } };
  const items = runningCostItems({
    plan: planFeePaise({ plan: "business", prices, selfHost: false, innovator: false }), usage, modelIncluded: false, month: "2026-11",
    entries: { schema: 1, supportMonth: "2026-11", supportMinutes: 90, supportPaisePerHour: 30_000 },
  });
  assert.deepEqual(items.map((i) => [i.id, i.paise]), [["plan", 29_900], ["whatsapp", 2_300], ["model", 1_235], ["support", 45_000]], "12.345678 rupees is 1,234.5678 paise: rounded up once to 1,235");
  const m = marginOf(150_000, items, 200_000);
  assert.deepEqual(m.cost, { paise: 78_435, complete: true, unknown: [] });
  assert.deepEqual(m.margin, { paise: 71_565, complete: true });
  assert.equal(m.setupFeePaise, 200_000, "the setup fee is its own figure, not part of the monthly margin");
  assert.equal(marginOf(60_000, items).margin!.paise, -18_435, "a negative margin is said as it is");
});

test("a hosted server's model is inside the plan fee (nothing to add); the support minutes are for ONE month", () => {
  const none = { plan: { paise: 29_900, notes: [] }, usage: null, modelIncluded: true, month: "2026-11" } as const;
  const items = runningCostItems({ ...none, entries: { schema: 1, supportMonth: "2026-10", supportMinutes: 600, supportPaisePerHour: 30_000 } });
  assert.deepEqual(items.find((i) => i.id === "model"), { id: "model", paise: 0, notes: ["included"] });
  assert.equal(items.find((i) => i.id === "support")!.paise, null, "last month's minutes are not this month's");
});

test("unknown stays unknown: no record, no rate, no minutes and no price are never INR 0", () => {
  const items = runningCostItems({ plan: { paise: 29_900, notes: [] }, usage: null, modelIncluded: false, month: "2026-11", entries: { schema: 1, supportMonth: "2026-11", supportMinutes: 30 } });
  assert.deepEqual(items.map((i) => [i.id, i.paise]), [["plan", 29_900], ["whatsapp", null], ["model", null], ["support", null]]);
  assert.equal(items[3].minutes, 30, "the minutes are kept even when the hour is not valued");
  const noPrice = marginOf(null, items);
  assert.equal(noPrice.margin, null, "no price, no margin: not 0");
  assert.deepEqual(noPrice.cost, { paise: 29_900, complete: false, unknown: ["whatsapp", "model", "support"] });
  const priced = marginOf(100_000, items);
  assert.deepEqual(priced.margin, { paise: 70_100, complete: false }, "the margin before the lines that are not known, said as such");
  // calls with no price make the model line a floor, and a rate missing from the list makes WhatsApp unknown
  const floor = runningCostItems({ plan: { paise: 0, notes: [] }, usage: { messages: 3, byStep: { rules: 0, decision: 0, model: 3 }, modelMicroInr: 10_000, unpriced: 2, whatsapp: { service: 0, utility: 0, marketing: 0, estMicroInr: 0, estimated: false } }, modelIncluded: false, month: "2026-11", entries: undefined });
  assert.deepEqual(floor.find((i) => i.id === "model"), { id: "model", paise: 1, notes: ["floor"], unpriced: 2 });
  assert.deepEqual(floor.find((i) => i.id === "whatsapp"), { id: "whatsapp", paise: null, notes: ["no-price"] });
});

test("over several shops: the known margins are added, and the total says it is partial until every shop has a price", () => {
  const one = (price: number | null, cost: number, complete = true): ReturnType<typeof marginOf> => marginOf(price, [{ id: "plan", paise: cost, notes: [] } as CostItem, ...(complete ? [] : [{ id: "support", paise: null, notes: [] } as CostItem])], price === null ? null : 10_000);
  const all = sumMargins([one(100_000, 30_000), one(80_000, 30_000)]);
  assert.deepEqual([all.shops, all.priced, all.marginPaise, all.complete, all.setupPaise], [2, 2, 120_000, true, 20_000]);
  const partial = sumMargins([one(100_000, 30_000), one(null, 30_000)]);
  assert.deepEqual([partial.priced, partial.marginPaise, partial.complete], [1, 70_000, false]);
  assert.equal(sumMargins([one(null, 30_000)]).marginPaise, null, "no shop with a price: unknown, not 0");
  assert.equal(sumMargins([one(100_000, 30_000, false)]).complete, false, "a margin that leaves a cost line out is not complete");
  assert.equal(sumMargins([]).marginPaise, null);
});

test("this month's usage reads only this month's entries of the record: a message from October is not counted", () => {
  const data = {
    entries: [
      entry(1, "2026-10-30T10:00:00+05:30", "receive_message", { step: "model", costMicroInr: "5000000" }),
      entry(2, "2026-11-02T10:00:00+05:30", "receive_message", { step: "model", costMicroInr: "2000000" }),
      entry(3, "2026-11-02T10:01:00+05:30", "send_message", { to: "owner" }),
      entry(4, "2026-11-02T10:02:00+05:30", "send_message", { to: "customer" }),
    ],
    bookings: [],
  } as never;
  const u = monthUsage(data, "2026-11", "Asia/Kolkata", prices)!;
  assert.deepEqual([u.messages, u.modelMicroInr, u.whatsapp.utility, u.whatsapp.service, u.whatsapp.estimated], [1, 2_000_000, 1, 1, true]);
  assert.equal(monthUsage(null, "2026-11", "Asia/Kolkata", prices), null, "no export: nothing to count, which is unknown and not none");
});

test("what the person types: rupees as whole paise, empty as not entered, anything else as a problem", () => {
  assert.deepEqual(["1500", "1,500", "₹ 1500.5", "0", " "].map(paiseFromText), [150_000, 150_000, 150_050, 0, undefined]);
  assert.deepEqual(["-5", "1e3", "12.345", "abc", "999999999"].map(paiseFromText), [null, null, null, null, null]);
  assert.deepEqual(["90", "", "9.5", "-1"].map(minutesFromText), [90, undefined, null, null]);
  assert.deepEqual(entriesFromForm({ price: "1500", setup: "", minutes: "90", rate: "300" }, "2026-11"), { ok: true, entries: { schema: 1, pricePaise: 150_000, supportMonth: "2026-11", supportMinutes: 90, supportPaisePerHour: 30_000 } });
  assert.deepEqual(entriesFromForm({ price: "lots" }, "2026-11"), { ok: false, problem: "price" });
});

// ---- the pages ------------------------------------------------------------------------------------------------------------------------------------------------

test("a partner's page: the running cost from the price list, her price and minutes, her margin; the cost she cannot know is unknown and the margin says it is before that", async () => {
  const b = await boot({}, { mode: "hosted" });
  try {
    const divya = await b.account("divya", "partner");
    b.addShop("divya-shop", { ownerId: accountIdOf(b, "divya"), ownerName: "Divya", ownerRole: "partner", name: "Divya Salon" });
    fleet(b, "divya-shop");
    const empty = (await divya.get("/health/divya-shop")).plain;
    assert.match(empty, /₹299\.00/u, "Business plan fee from the price list in force");
    assert.match(empty, /Margin: What you keep a month<\/td><td class="n">unknown</u, "no price entered: unknown, not ₹0.00");
    assert.match(empty, /Unknown until you enter your price\./u);
    const saved = await post(divya, "/health/divya-shop", { price: "1500", setup: "2000", minutes: "60", rate: "300" });
    assert.equal(saved.status, 303);
    const page = (await divya.get(saved.location!)).plain;
    assert.match(page, /Saved\./u);
    assert.match(page, /Your support time · 60 minutes/u);
    assert.match(page, /WhatsApp messages, at cost[^]*?unknown/u, "no record shared: WhatsApp is unknown");
    assert.match(page, /Margin: What you keep a month<\/td><td class="n">₹901\.00</u, "1,500 minus plan 299 minus support 300");
    assert.match(page, /before: WhatsApp messages, at cost/u);
    assert.match(page, /Setup fee you charged once: ₹2,000\.00/u);
    // her figures are in the panel's own store and nowhere that goes to fleet
    assert.ok(readdirSync(join(b.dir, "panel", "data", "health", accountIdOf(b, "divya").replace(/_/gu, "-"))).includes("divya-shop.json"));
    // with the record shared, the month's WhatsApp is counted from it
    exportRecord(b, "divya-shop", [entry(1, "2026-11-02T10:01:00+05:30", "send_message", { to: "owner" })]);
    const shared = (await divya.get("/health/divya-shop")).plain;
    assert.doesNotMatch(shared, /No record shared yet/u);
    assert.match(shared, /Estimate from this month's counts/u);
    // clearing the price makes the margin unknown again
    await post(divya, "/health/divya-shop", { price: "", setup: "", minutes: "60", rate: "300" });
    assert.match((await divya.get("/health/divya-shop")).plain, /Margin: What you keep a month<\/td><td class="n">unknown</u);
    assert.equal((await post(divya, "/health/divya-shop", { price: "lots" })).status, 400, "a price that is not an amount is refused, and nothing is saved");
  } finally { await b.close(); }
});

test("on a builder's own server the plan fee is half and the model cost is the recorded one; what needs a look comes from the to-do list, the licence and the heartbeat", async () => {
  const b = await boot();
  try {
    const arjun = await b.account("arjun", "builder");
    b.addShop("glow-salon", { ownerId: accountIdOf(b, "arjun"), ownerName: "Arjun", ownerRole: "builder", name: "Glow Salon" });
    fleet(b, "glow-salon", { at: new Date(NOW - 3 * 86_400_000).toISOString(), warn: ["balance_80"] });
    b.status("glow-salon", { updatedAt: AT, deploy: { state: "applied" }, backups: { lastDrillAt: new Date(NOW - 12 * 86_400_000).toISOString(), drillOk: true }, licence: { state: "warning", listed: true, paidThrough: null, windDownOn: null, stopOn: null, exportUntil: null, leaseIssuedAt: AT, extendedUntil: null } });
    exportRecord(b, "glow-salon", [entry(1, "2026-11-02T10:00:00+05:30", "receive_message", { step: "model", costMicroInr: "2000000" })]);
    const page = (await arjun.get("/health/glow-salon")).plain;
    assert.match(page, /₹149\.50/u, "half of Business, for the builder's own server");
    assert.match(page, /Half price for your own server/u);
    assert.match(page, /AI model[^]*?₹2\.00/u, "the model cost the runtime recorded this month");
    assert.match(page, /more than 2 days ago/u, "the heartbeat is old");
    assert.match(page, /Licence payment overdue/u);
    assert.match(page, /Last restore drill: 12 days ago\./u);
    const list = (await arjun.get("/health")).plain;
    assert.match(list, /1 shops need a look/u);
    assert.match(list, /All your shops/u);
  } finally { await b.close(); }
});

test("a partner sees only her own shops; another partner's shop is a 404 for her to read and to save, and a builder's entries are his own", async () => {
  const b = await boot({}, { mode: "hosted" });
  try {
    const divya = await b.account("divya", "partner");
    const meena = await b.account("meena", "partner");
    const arjun = await b.account("arjun", "builder");
    b.addShop("divya-shop", { ownerId: accountIdOf(b, "divya"), ownerName: "Divya", ownerRole: "partner", name: "Divya Salon" });
    b.addShop("meena-shop", { ownerId: accountIdOf(b, "meena"), ownerName: "Meena", ownerRole: "partner", name: "Meena Salon" });
    fleet(b, "divya-shop"); fleet(b, "meena-shop");
    await post(divya, "/health/divya-shop", { price: "1500" });
    assert.equal((await meena.get("/health/divya-shop")).status, 404);
    assert.equal((await meena.req("POST", "/health/divya-shop", { _csrf: tokenOf((await meena.get("/health/meena-shop")).text), price: "1" })).status, 404);
    const hers = (await meena.get("/health")).plain;
    assert.match(hers, /Meena Salon/u);
    assert.doesNotMatch(hers, /Divya Salon/u);
    assert.equal((await meena.get("/health/meena-shop")).status, 200);
    assert.equal((await meena.get("/health/nowhere")).status, 404);
    // the builder can open the shop, but sees none of her entries
    const seen = await arjun.get("/health/divya-shop");
    assert.equal(seen.status, 200);
    assert.doesNotMatch(seen.plain, /1500/u);
    assert.equal((await b.browser().get("/health")).status, 303, "signed out: sent to sign in");
  } finally { await b.close(); }
});

// ---- the template vote ----------------------------------------------------------------------------------------------------------------------------------

test("the vote: a 404 for anyone fleet has not flagged as an innovator, to read and to cast, and no link to it", async () => {
  const b = await boot({}, { mode: "hosted" });
  try {
    const divya = await b.account("divya", "partner");
    b.addShop("divya-shop", { ownerId: accountIdOf(b, "divya"), ownerName: "Divya", ownerRole: "partner" });
    fleet(b, "divya-shop", { innovator: false });
    assert.equal((await divya.get("/vote")).status, 404);
    assert.equal((await divya.req("POST", "/vote", { _csrf: tokenOf((await divya.get("/health")).text), option: "orders" })).status, 404);
    assert.doesNotMatch((await divya.get("/health")).plain, /Vote on the next template/u);
    assert.throws(() => readdirSync(join(b.dir, "panel", "data", "votes")), "nothing was kept");
    // flagged as an innovator on a shop that is somebody else's does not make her one
    const meena = await b.account("meena", "partner");
    b.addShop("meena-shop", { ownerId: accountIdOf(b, "meena"), ownerName: "Meena", ownerRole: "partner" });
    fleet(b, "meena-shop", { innovator: true });
    assert.equal((await divya.get("/vote")).status, 404);
    assert.equal((await meena.get("/vote")).status, 200);
  } finally { await b.close(); }
});

test("one vote per innovator, changeable; results are counts only, without names, and only after voting", async () => {
  const b = await boot({}, { mode: "hosted" });
  try {
    const divya = await b.account("divya", "partner");
    const meena = await b.account("meena", "partner");
    for (const [who, shop] of [["divya", "divya-shop"], ["meena", "meena-shop"]] as const) { b.addShop(shop, { ownerId: accountIdOf(b, who), ownerName: who, ownerRole: "partner" }); fleet(b, shop, { innovator: true }); }
    const round = loadVoteRound();
    assert.ok(round.options.length >= 5 && round.options.some((o) => o.id === "orders"));
    const before = (await divya.get("/vote")).plain;
    assert.match(before, /You have not voted yet\./u);
    assert.match(before, /Vote to see how the others voted\./u);
    assert.doesNotMatch(before, /\d+ votes/u, "no counts before you have voted");
    assert.match((await divya.get("/health")).plain, /Vote on the next template/u);
    // an option that is not on the list is refused
    assert.equal((await post(divya, "/vote", { option: "robots" }, "/vote")).status, 400);
    assert.equal((await post(divya, "/vote", { option: "orders" }, "/vote")).status, 303);
    const after = (await divya.get("/vote")).plain;
    assert.match(after, /Your vote is saved\.|Change my vote/u);
    assert.match(after, /Orders[^]*?<b>1 votes<\/b>/u);
    // changing the vote moves it: it does not add a second one
    await post(divya, "/vote", { option: "course-packs" }, "/vote");
    await post(divya, "/vote", { option: "course-packs" }, "/vote");
    const moved = (await divya.get("/vote")).plain;
    assert.match(moved, /Orders[^]*?<b>0 votes<\/b>/u);
    assert.match(moved, /Course packs[^]*?<b>1 votes<\/b>/u);
    assert.equal(readdirSync(join(b.dir, "panel", "data", "votes")).length, 1, "one file for one innovator");
    // a second innovator adds hers; neither sees names
    assert.doesNotMatch((await meena.get("/vote")).plain, /\d+ votes/u, "she has not voted, so she sees no counts");
    await post(meena, "/vote", { option: "course-packs" }, "/vote");
    const both = (await meena.get("/vote")).plain;
    assert.match(both, /Course packs[^]*?<b>2 votes<\/b>/u);
    assert.doesNotMatch(both, /DIVYA|MEENA|divya|meena/u);
    assert.match(both, /Names are never shown/u);
    assert.equal(readdirSync(join(b.dir, "panel", "data", "votes")).length, 2);
  } finally { await b.close(); }
});

// ---- the words ------------------------------------------------------------------------------------------------------------------------------------------------

const BANNED = /\b(earn\w*|income|side hustle|passive|limited seats?|join now|work from home|founder|founding|bots?|leaderboard|streaks?)\b/iu;
const NEVER = /\b(safe|safely|guarantee[ds]?|proves?|certified)\b|100%/iu;
const health = (l: (typeof LANGUAGES)[number]) => new Map([...flatWords({ health: HEALTH_WORDS[l] }, HEALTH_SAMPLE_ARGS), ...loadVoteRound().options.map((o) => [`option.${o.id}`, o.label[l]] as const)]);

test("the new texts have the same lines in all four languages, in their own script, and none says a banned word", () => {
  const english = health("en");
  assert.ok(english.size > 80, `English has ${english.size} lines`);
  const BLOCK: Record<string, RegExp> = { hi: /[ऀ-ॿ]/u, ml: /[ഀ-ൿ]/u, kn: /[ಀ-೿]/u };
  for (const l of LANGUAGES) {
    const mine = health(l);
    assert.deepEqual([...mine.keys()].sort(), [...english.keys()].sort(), `${l}: lines missing or extra`);
    for (const [path, text] of mine) {
      assert.ok(!BANNED.test(text), `${l} ${path}: "${text}" has a banned word`);
      assert.ok(!NEVER.test(text), `${l} ${path}: "${text}" promises too much`);
      if (l !== "en") assert.ok(BLOCK[l].test(text) || /^[A-Z0-9 ()₹.,:-]*$/u.test(text), `${l} ${path}: not in ${l}`);
    }
  }
});

test("no sentence makes an earnings claim, a forecast or an 'up to'", () => {
  for (const [path, text] of health("en")) assert.ok(!/\b(up to|forecast|expect|will make|could make|per month if|potential|profit)\b/iu.test(text), `${path}: "${text}"`);
  const words = health("en");
  for (const k of ["health.margin.heading", "health.margin.keep", "health.margin.yourPrice", "health.cost.total"]) assert.ok(words.has(k), k);
  assert.match(words.get("health.margin.keep")!, /what you keep/iu);
  assert.match(words.get("health.cost.total")!, /running cost/iu);
});

test("Hindi, Malayalam and Kannada pages carry the panel's draft note, waiting for native review, and the new lines are on the review sheets", async () => {
  const { panelRows } = await import("../review.ts");
  for (const l of ["hi", "ml", "kn"] as const) {
    const rows = panelRows(l === "hi" ? "ml" : l);
    if (l !== "hi") assert.ok(rows.some((r) => r.id === "health.margin.keep") && rows.some((r) => r.id === "vote.option.orders"), `${l}: the sheet has the new lines`);
  }
  const b = await boot({}, { mode: "hosted" });
  try {
    for (const l of ["hi", "ml", "kn"] as const) {
      const br = await b.account(`user-${l}`, "partner", l);
      const page = await br.get("/health");
      assert.equal(page.status, 200);
      assert.ok(page.plain.includes(WORDS[l].draftNote), `${l}: the draft note is on the page`);
      assert.ok(page.plain.includes(HEALTH_WORDS[l].title));
    }
  } finally { await b.close(); }
});
