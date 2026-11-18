// The first set-up question as an Operator on a phone meets it (17 Nov 2026; views-presets.ts and the /setup routes): "What does the shop do?" as big buttons in their language, a trade
// button that fills the form with examples, "Something else" where they write the trade and pick the kind of work, and the trade kept in the shop's meta and shown on its page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { openStores } from "../server.ts";
import { boot } from "./helpers.ts";
import { CHARACTER5, STEP1, STEP2, STEP3, STEP4, setUp } from "./flow.ts";
import { PHONE_TEMPLATES, PRESETS_DIR, loadPresets } from "../presets.ts";
import { PRESET_WORDS } from "../words-presets.ts";
import { WORDS } from "../languages.ts";
import type { Draft } from "../setup.ts";

const presets = loadPresets(PRESETS_DIR, PHONE_TEMPLATES);
const draftOf = (b: Awaited<ReturnType<typeof boot>>, location: string) => openStores(b.config).store.read<Draft>(`drafts/${location.split("/")[2]}.json`)!;

test("the first screen asks what the shop does, with a big button for each trade in the Operator's language and one for something else", async () => {
  const b = await boot();
  try {
    for (const language of ["en", "hi", "ml", "kn"] as const) {
      const person = await b.account(`p${language}`, "partner", language);
      const page = (await person.get("/setup")).plain;
      assert.ok(page.includes(PRESET_WORDS[language].question), language);
      assert.ok(page.includes(PRESET_WORDS[language].other) && page.includes('href="/setup/other"'), language);
      for (const p of presets) assert.ok(page.includes(p.names[language]) && page.includes(`name="preset" value="${p.id}"`), `${language}/${p.id}`);
      assert.ok(!page.includes(WORDS[language].setup.templateNames.fees), "the template list is not the first screen any more");
    }
  } finally { await b.close(); }
});

test("a trade button starts a form filled with that trade's examples, in the reader's language, with the trade and the suggested character remembered; every box is still a box", async () => {
  const b = await boot();
  try {
    const divya = await b.account("divya", "partner", "hi");
    const start = await divya.post("/setup", { preset: "salon" }, "/setup");
    assert.equal(start.status, 303);
    const d = draftOf(b, start.location!);
    assert.deepEqual(d.trade, { preset: "salon" });
    assert.equal(d.form.services[0].name, "हेयरकट");
    assert.equal(d.form.services[0].price, "300");
    const page = await divya.get(start.location!);
    assert.ok(page.plain.includes('value="हेयरकट"') && page.plain.includes('name="svc_price_0"'), "the example is in an ordinary box");
    assert.ok(page.plain.includes(PRESET_WORDS.hi.prefillNote), "the page says the prices are examples");
    assert.equal((await divya.post("/setup", { preset: "nope" }, "/setup")).status, 404);

    const tuition = await divya.post("/setup", { preset: "tuition" }, "/setup");
    const t = draftOf(b, tuition.location!) as unknown as { fees: { batches: { name: string }[]; timetable: string }; template: string };
    assert.equal(t.template, "fees");
    assert.equal(t.fees.batches[0].name, "कक्षा 8");
    assert.ok(t.fees.timetable.includes("कक्षा 8, Mon, 16:00, 60"));
    const classes = await divya.get(tuition.location!);
    assert.ok(classes.plain.includes('name="timetable"') && classes.plain.includes("कक्षा 8, Mon, 16:00, 60"), "the Classes part is filled in the form");
  } finally { await b.close(); }
});

test("Something else: the Operator writes the trade, then picks the kind of work; the form starts empty and the trade is theirs, length-bounded", async () => {
  const b = await boot();
  try {
    const divya = await b.account("divya", "partner", "en");
    const other = (await divya.get("/setup/other")).plain;
    assert.ok(other.includes(PRESET_WORDS.en.typedLabel) && other.includes(PRESET_WORDS.en.kindQuestion));
    for (const id of ["bookings", "fees", "orders", "stock-orders"]) assert.ok(other.includes(`name="template" value="${id}"`), id);
    assert.ok(other.includes(WORDS.en.setup.templateNames.bookings) && other.includes(WORDS.en.setup.templateNames["stock-orders"]), "the kinds of work are in plain words");

    const start = await divya.post("/setup", { trade: "  tailor  ", template: "bookings" }, "/setup/other");
    assert.equal(start.status, 303);
    const d = draftOf(b, start.location!);
    assert.deepEqual(d.trade, { typed: "tailor" });
    assert.ok(d.form.name === "" && d.form.services.every((r) => r.name === "" && r.price === "") && d.form.deposit === "", "the form starts empty");
    assert.equal(d.suggestCharacter, undefined);

    const long = await divya.post("/setup", { trade: "z".repeat(300), template: "orders" }, "/setup/other");
    assert.equal(Array.from(draftOf(b, long.location!).trade!.typed!).length, 40);
    assert.ok(!(await divya.get(long.location!)).plain.includes(PRESET_WORDS.en.prefillNote), "no examples, so no note about them");

    const nothing = await divya.post("/setup", { trade: "   ", template: "bookings" }, "/setup/other");
    assert.equal(nothing.status, 400);
    assert.ok(nothing.plain.includes(PRESET_WORDS.en.typedEmpty));
    const noKind = await divya.post("/setup", { trade: "florist <b>", template: "" }, "/setup/other");
    assert.equal(noKind.status, 400, "Enter pressed before a kind was picked chooses nothing");
    assert.ok(noKind.plain.includes(PRESET_WORDS.en.kindQuestion) && noKind.text.includes('value="florist &lt;b&gt;"'), "what was written comes back, escaped");
    assert.equal((await divya.post("/setup", { trade: "florist", template: "elsewhere" }, "/setup/other")).status, 404);
    assert.equal((await divya.post("/setup", { template: "bookings" }, "/setup")).status, 303, "a bare template starts as it always did");
  } finally { await b.close(); }
});

test("the trade is kept in the shop's meta, never in its settings, and the shop's page shows it: a preset in the reader's language, the typed words escaped", async () => {
  const b = await boot();
  try {
    const divya = await b.account("divya", "partner", "ml");
    const fromPreset = await setUp(b, divya, [STEP1, STEP2, STEP3, STEP4], { preset: "salon" });
    assert.equal((await divya.post(`/setup/${fromPreset.draft}/save`, {}, `/setup/${fromPreset.draft}/6`)).status, 303, "the shop is saved");
    const stores = openStores(b.config).store;
    assert.deepEqual(stores.read<{ trade?: unknown }>(`meta/${fromPreset.shop}.json`)!.trade, { preset: "salon" });
    const page = (await divya.get(`/shops/${fromPreset.shop}`)).plain;
    assert.ok(page.includes(presets.find((p) => p.id === "salon")!.names.ml) && page.includes(PRESET_WORDS.ml.tradeLabel));
    const settings = JSON.parse(readFileSync(`${b.dir}/shops/${fromPreset.shop}/settings.json`, "utf8"));
    assert.ok(!JSON.stringify(settings).includes("trade") && !JSON.stringify(settings).includes("salon"), "the settings the agent runs are untouched by a trade");

    const typed = await setUp(b, divya, [{ ...STEP1, name: "Hosahalli Tailors" }, STEP2, STEP3, STEP4, CHARACTER5], { trade: "<b>tailor</b> & co", template: "bookings" });
    assert.equal((await divya.post(`/setup/${typed.draft}/save`, {}, `/setup/${typed.draft}/6`)).status, 303, "the shop is saved");
    assert.deepEqual(stores.read<{ trade?: unknown }>(`meta/${typed.shop}.json`)!.trade, { typed: "<b>tailor</b> & co" });
    const shopPage = (await divya.get(`/shops/${typed.shop}`)).text;
    assert.ok(shopPage.includes("&lt;b&gt;tailor&lt;/b&gt; &amp; co") && !shopPage.includes("<b>tailor</b>"), "the Operator's words are escaped on the page");
  } finally { await b.close(); }
});
