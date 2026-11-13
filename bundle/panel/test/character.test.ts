// The Character step of the shop setup (item 11i, decision 47): the five styles, a row of eight faces rolled for this shop (every seed starts with its id), the
// style's own colours and Auto, the five moods of the picked face with their words, a name and a personality; each press comes back to the step with the choice made
// and the name kept; Next refuses what is wrong in words; saving writes `assistant.character` and draws every mood once into the shop's own data; the shop page
// shows the saved moods and offers the "All well" PNG for the WhatsApp profile; an edit that never opens the step turns nothing on. No script on the page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { STRIP, applyCharacter, characterDraftFromSettings, characterSetting, newCharacterDraft, stripSeeds, withCharacter } from "../character.ts";
import { STYLE_INFO } from "../../../modules/assistant/character.ts";
import { readCharacterManifest } from "../../../modules/channels/character-files.ts";
import { WORDS } from "../languages.ts";
import { boot } from "./helpers.ts";
import { STEP1, STEP2, STEP3, STEP4 } from "./flow.ts";

const w = WORDS.en;

test("the step's logic: a roll is eight seeds that start with the shop's id; a style resets the colour to Auto; a face or colour from elsewhere is refused; Next needs a name", () => {
  const seeds = stripSeeds("glow-salon", "3f2a1c");
  assert.equal(seeds.length, STRIP);
  assert.ok(seeds.every((s, i) => s === `glow-salon-3f2a1c-${i}`));
  const d: { shopId: string; character?: ReturnType<typeof newCharacterDraft> } = { shopId: "glow-salon" };
  const first = applyCharacter(d, { act: "roll" }, w);
  assert.deepEqual(first, { stay: true, problems: [] });
  const c = d.character!;
  assert.ok(c.seed!.startsWith("glow-salon-") && c.roll.length === 6);
  const roll = c.roll;
  applyCharacter(d, { act: "roll" }, w);
  assert.notEqual(d.character!.roll, roll, "Roll gives a new row");
  applyCharacter(d, { pickColour: STYLE_INFO.clay.palette[2] }, w);
  assert.equal(d.character!.colour, STYLE_INFO.clay.palette[2]);
  applyCharacter(d, { pickStyle: "moods" }, w);
  assert.deepEqual([d.character!.style, d.character!.colour], ["moods", undefined], "a new style starts on Auto");
  assert.deepEqual(applyCharacter(d, { pickColour: "c4795c" }, w).problems, [w.setup.character.problems.colour], "Golu's colour is not a Moods colour");
  assert.deepEqual(applyCharacter(d, { pickFace: "other-shop-3f2a1c-0" }, w).problems, [w.setup.character.problems.face], "a face from another shop's row");
  applyCharacter(d, { pickFace: "glow-salon-aaaaaa-5", characterName: "Golu" }, w);
  assert.deepEqual([d.character!.seed, d.character!.name], ["glow-salon-aaaaaa-5", "Golu"], "the name typed is kept on every press");
  assert.deepEqual(applyCharacter(d, { characterName: "R2D2", act: "next" }, w), { stay: false, problems: [w.setup.character.problems.name] });
  assert.equal(d.character!.chosen, false);
  assert.deepEqual(applyCharacter(d, { characterName: "Golu", personality: "cheerful", act: "next" }, w), { stay: false, problems: [] });
  assert.equal(d.character!.chosen, true);
  assert.deepEqual(characterSetting(d.character!, "glow-salon"), { name: "Golu", style: "moods", seed: "glow-salon-aaaaaa-5", personality: "cheerful" });
  // Enter in the name box posts no button: that is Next
  assert.equal(applyCharacter(d, { characterName: "Golu" }, w).stay, false);
});

test("what is saved: the character only when the step was finished, and the shop's own assistant block kept as it was", () => {
  const chosen = { ...newCharacterDraft("glow"), name: "Golu", chosen: true };
  const before = { assistant: { morning: { at: "07:30" }, character: { name: "Old", style: "clay" } } };
  assert.deepEqual(withCharacter({ name: "Glow" }, chosen, before, "glow"), { name: "Glow", assistant: { morning: { at: "07:30" }, character: characterSetting(chosen, "glow") } });
  assert.deepEqual(withCharacter({ name: "Glow" }, { ...chosen, chosen: false }, before, "glow"), { name: "Glow", assistant: before.assistant }, "an edit elsewhere keeps what the shop had");
  assert.deepEqual(withCharacter({ name: "Glow" }, undefined, { name: "Glow" }, "glow"), { name: "Glow" }, "a shop with no assistant gets none from an edit");
  const back = characterDraftFromSettings({ assistant: { character: { name: "Golu", style: "sprouts", seed: "glow-abcdef-3", colour: "fda4af", personality: "brief" } } }, "glow");
  assert.deepEqual([back.style, back.seed, back.colour, back.name, back.personality, back.chosen], ["sprouts", "glow-abcdef-3", "fda4af", "Golu", "brief", true]);
  assert.equal(characterDraftFromSettings({}, "glow").chosen, false);
});

test("the step on a phone: styles, the row of faces, colours and Roll as buttons with words, the five moods with their words, the name and the personality; no script", async () => {
  const b = await boot({}, { standins: true });
  try {
    const divya = await b.account("divya", "partner", "en");
    const start = await divya.post("/setup", { template: "bookings" }, "/setup");
    const draft = start.location!.split("/")[2];
    for (const [i, form] of [STEP1, STEP2, STEP3, STEP4].entries()) assert.equal((await divya.post(`/setup/${draft}/${i + 1}`, form)).status, 303, `step ${i + 1}`);
    const step = `/setup/${draft}/5`;
    const page = await divya.get(step);
    assert.equal(page.status, 200);
    assert.ok(!/<script/iu.test(page.text), "no script");
    assert.match(page.plain, /Step 5 of 6/u);
    assert.match(page.plain, /The shop's assistant/u);
    for (const s of ["Golu", "Critters", "Sprouts", "Moods", "Pixel"]) assert.match(page.plain, new RegExp(`name="pickStyle" value="[a-z]+" aria-pressed="(true|false)"><img [^>]*><span>${s}`, "u"), s);
    assert.ok(!/Pixel ?Bot|Pixelbot/iu.test(page.plain.replace(/value="pixelbot"|\/pixelbot\//gu, "")), "never 'bot' in words");
    const faces = [...page.text.matchAll(/name="pickFace" value="([a-z0-9-]+)" aria-pressed="(true|false)" aria-label="Face (\d) of 8"/gu)];
    assert.equal(faces.length, 8);
    assert.ok(faces.every((f) => f[1].startsWith("hosahalli-beauty-")), "every face is rolled for this shop");
    assert.equal(faces.filter((f) => f[2] === "true").length, 1, "one face picked, said by aria-pressed");
    assert.match(page.plain, /Picked/u, "and in words, not by colour alone");
    assert.equal([...page.text.matchAll(/name="pickColour"/gu)].length, 9, "eight colours and Auto");
    assert.match(page.text, /aria-label="Auto: the style's own colour"|aria-label="Auto: the style&#39;s own colour"/u);
    assert.match(page.text, /name="act" value="roll"/u);
    for (const m of ["All well", "Needs you", "Something wrong", "Closed", "Busy"]) assert.match(page.plain, new RegExp(`alt="Mithra: ${m}"><span>${m}</span>`, "u"), m);
    assert.match(page.text, /name="characterName"/u);
    assert.equal([...page.text.matchAll(/name="personality"/gu)].length, 3);
    assert.match(page.plain, /It says: Hello! I'm Mithra, Hosahalli Beauty's assistant, happy to help\./u, "the personality's own greeting, as a sample");
    // every picture on the page is the panel's own, cached, and DiceBear's drawing
    const src = page.text.match(/src="(\/character\/preview\/[^"]+)"/u)![1];
    const pic = await divya.bytes(src);
    assert.equal(pic.status, 200);
    assert.equal(pic.headers.get("content-type"), "image/svg+xml");
    assert.match(pic.headers.get("cache-control") ?? "", /max-age=604800/u);
    assert.match(pic.body.toString(), /^<svg xmlns/u);
    assert.equal((await divya.bytes("/character/preview/avataaars/auto/x/well.svg")).status, 404, "only the approved styles");
    assert.equal((await divya.bytes("/character/preview/clay/fda4af/x/well.svg")).status, 404, "only the style's own colours");
    assert.equal((await b.browser().bytes(src)).status !== 200, true, "not for someone signed out");

    // a press comes back to the step with the choice made and the name kept
    const styled = await divya.post(step, { pickStyle: "critters", characterName: "Golu" });
    assert.equal(styled.status, 303);
    assert.match(styled.location!, new RegExp(`^${step}#`, "u"));
    const after = await divya.get(step);
    assert.match(after.text, /name="pickStyle" value="critters" aria-pressed="true"/u);
    assert.match(after.text, /name="characterName"[^>]*value="Golu"|value="Golu"[^>]*name="characterName"/u);
    const before = faces.map((f) => f[1]);
    await divya.post(step, { act: "roll", characterName: "Golu" });
    const rolled = [...(await divya.get(step)).text.matchAll(/name="pickFace" value="([a-z0-9-]+)"/gu)].map((m) => m[1]);
    assert.ok(rolled.filter((s) => before.includes(s)).length <= 1, "Roll: a new row (the picked face may stay in it)");
    assert.equal((await divya.post(step, { pickColour: "c4795c" })).status, 400, "a colour that is not the style's");
    const refused = await divya.post(step, { act: "next", characterName: "" });
    assert.equal(refused.status, 400);
    assert.match(refused.plain, /Give the assistant a name/u);
    assert.equal((await divya.post(step, { act: "next", characterName: "Golu", personality: "brief" })).location, `/setup/${draft}/6`);

    // saving writes the character and draws every mood into the shop's own data
    assert.equal((await divya.post(`/setup/${draft}/save`, {}, `/setup/${draft}/6`)).location, `/setup/${draft}/6`);
    const folder = join(b.dir, "shops", "hosahalli-beauty");
    const settings = JSON.parse(readFileSync(join(folder, "settings.json"), "utf8"));
    assert.equal(settings.assistant.character.name, "Golu");
    assert.equal(settings.assistant.character.style, "critters");
    assert.equal(settings.assistant.character.personality, "brief");
    assert.ok(settings.assistant.character.seed.startsWith("hosahalli-beauty-"));
    const m = readCharacterManifest(readFileSync(join(folder, "character", "character.json"), "utf8"))!;
    assert.deepEqual(m.look, { style: "critters", seed: settings.assistant.character.seed });
    assert.equal(readdirSync(join(folder, "character")).length, 16, "five moods in three formats, and the manifest");

    // the shop page: the saved moods with their words, and the profile photo to set by hand
    const shopPage = await divya.get("/shops/hosahalli-beauty");
    assert.match(shopPage.plain, /The shop's assistant/u);
    for (const mood of ["All well", "Needs you", "Something wrong", "Closed", "Busy"]) assert.match(shopPage.plain, new RegExp(`alt="Golu: ${mood}"`, "u"));
    const dl = shopPage.text.match(/href="(\/shops\/hosahalli-beauty\/character\/well\.png\?v=[0-9a-f]{16}&amp;download=1)"/u);
    assert.ok(dl, "the PNG download");
    const png = await divya.bytes(dl![1].replace(/&amp;/gu, "&"));
    assert.equal(png.headers.get("content-type"), "image/png");
    assert.match(png.headers.get("content-disposition") ?? "", /attachment; filename="hosahalli-beauty-whatsapp-photo\.png"/u);
    assert.match(shopPage.plain, /The panel can't set it for you yet/u);

    // an edit that never opens the Character step keeps the character as it is
    const arjun = await b.account("arjun", "builder");
    const edit = await arjun.post("/shops/hosahalli-beauty/edit", {}, "/shops/hosahalli-beauty");
    const d2 = edit.location!.split("/")[2];
    await arjun.post(`/setup/${d2}/save`, {}, `/setup/${d2}/6`);
    assert.deepEqual(JSON.parse(readFileSync(join(folder, "settings.json"), "utf8")).assistant, settings.assistant);
  } finally { await b.close(); }
});

test("a shop saved before item 11i, with no assistant, is not given one by an edit elsewhere, and its page says it has none yet", async () => {
  const b = await boot({}, { standins: true });
  try {
    const divya = await b.account("divya", "partner", "en");
    const start = await divya.post("/setup", { template: "bookings" }, "/setup");
    const draft = start.location!.split("/")[2];
    for (const [i, form] of [STEP1, STEP2, STEP3, STEP4, { act: "next", characterName: "Mithra" }].entries()) assert.equal((await divya.post(`/setup/${draft}/${i + 1}`, form)).status, 303, `step ${i + 1}`);
    await divya.post(`/setup/${draft}/save`, {}, `/setup/${draft}/6`);
    const file = join(b.dir, "shops", "hosahalli-beauty", "settings.json");
    const { assistant: _gone, ...without } = JSON.parse(readFileSync(file, "utf8"));
    writeFileSync(file, JSON.stringify(without));
    const edit = await divya.post("/shops/hosahalli-beauty/edit", {}, "/shops/hosahalli-beauty");
    const d2 = edit.location!.split("/")[2];
    await divya.post(`/setup/${d2}/save`, {}, `/setup/${d2}/6`);
    assert.equal(JSON.parse(readFileSync(file, "utf8")).assistant, undefined);
    assert.match((await divya.get("/shops/hosahalli-beauty")).plain, /This shop has no assistant yet/u);
    assert.ok(existsSync(join(b.dir, "shops", "hosahalli-beauty", "character")), "the pictures drawn before stay with the shop's data");
  } finally { await b.close(); }
});
