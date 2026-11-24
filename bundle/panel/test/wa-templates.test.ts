// The panel submits each shop's WhatsApp message templates to the shop's own account and shows their state (25 Nov 2026; panel/wa-templates.ts, lib/wa-templates.ts).
// The panel's Guard address points straight at a template stand-in here (modules/standins/meta-templates.ts, gupshup-templates.ts), in the Guard's place; the Guard's own
// routes for it are proved on the real Guard in bundle/test/wa-templates-guard.test.ts. What is proved: the setup's save submits the shop's set once, in its languages; a
// second save submits nothing; a shop set up before new templates gets just those from the shop page's button; Meta direct and Gupshup both; the shop page counts the
// states, read again only when what it has is old; a rejected template is named with the provider's reason and what to do; a refused key stops with a plain line and
// sends nothing; a Guard that is not running yet is "waiting" until the button; a shop with no account id is told what to add; the checks page warns and does not block.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { boot, NOW } from "./helpers.ts";
import { STEP1, STEP2, STEP3, STEP4, setUp } from "./flow.ts";
import { startMetaTemplateStandin } from "../../../modules/standins/meta-templates.ts";
import { startGupshupTemplateStandin } from "../../../modules/standins/gupshup-templates.ts";
import { readEntries, shopLanguages } from "../../lib/wa-templates.ts";

const WABA = "102290129340398";
const APP = "11111111-aaaa-bbbb-cccc-222222222222";
const BOOKINGS = new URL("../../../templates/commerce/bookings/", import.meta.url).pathname;
/** STEP3's languages: Malayalam first, English too, the owner in Malayalam. */
const SET = readEntries(BOOKINGS).filter((e) => shopLanguages({ languages: ["ml", "en"], owner: { language: "ml" } }).includes(e.language));
const plainText = (html: string) => html.replace(/<[^>]+>/gu, " ").replace(/&#39;/gu, "'").replace(/&quot;/gu, '"').replace(/&amp;/gu, "&").replace(/\s+/gu, " ");

test("Meta direct: the save submits the shop's set once, in its languages; a second save sends nothing; the shop page counts what Meta says, read again only when old", async () => {
  const meta = await startMetaTemplateStandin({ wabaId: WABA });
  let clock = NOW;
  const b = await boot({ guardUrl: meta.url, templatesPause: async () => {}, now: () => clock });
  try {
    const arjun = await b.account("arjun", "builder");
    const f = await setUp(b, arjun, [STEP1, STEP2, STEP3, { ...STEP4, waWabaId: WABA }]);
    await arjun.post(`/setup/${f.draft}/save`, {}, `/setup/${f.draft}/6`);
    await b.panel.settled();
    assert.match(readFileSyncText(join(b.dir, "shops", f.shop, "runtime.json")), /"wabaId": "102290129340398"/u, "runtime.json names the account (who things are)");
    assert.equal(meta.created.length, SET.length, `the whole set in Malayalam and English (${SET.length}), once`);
    assert.ok(meta.created.every((c) => c.wabaId === WABA && c.authorization === undefined), "to the shop's own account; the panel sends no key (the Guard adds it)");
    assert.deepEqual([...new Set(meta.created.map((c) => c.body.language))].sort(), ["en", "ml"]);
    // what was sent is the template file's words and samples, nothing of a customer's
    for (const c of meta.created) assert.deepEqual(c.body, (({ name, language, category, parameter_format, components }) => ({ name, language, category, parameter_format, components }))(SET.find((e) => e.name === c.body.name && e.language === c.body.language)!));

    await arjun.post(`/setup/${f.draft}/save`, {}, `/setup/${f.draft}/6`);
    await b.panel.settled();
    assert.equal(meta.created.length, SET.length, "a second save submits nothing");

    // the shop page: kept state (fresh), so no new read; ten minutes later it reads again and counts what Meta says now
    const reads = () => meta.paths.filter((p) => p.startsWith("GET")).length;
    const before = reads();
    let page = plainText((await arjun.get(`/shops/${f.shop}`)).text);
    assert.equal(reads(), before, "not on every request");
    assert.match(page, new RegExp(`${SET.length} Waiting for approval`, "u"));
    meta.setState(SET[0].name, SET[0].language, "APPROVED");
    meta.setState(SET[1].name, SET[1].language, "REJECTED", "INVALID_FORMAT");
    clock += 11 * 60_000;
    page = plainText((await arjun.get(`/shops/${f.shop}`)).text);
    assert.equal(reads(), before + 1);
    assert.match(page, /1 Approved/u); assert.match(page, /1 Rejected/u); assert.match(page, new RegExp(`${SET.length - 2} Waiting for approval`, "u"));
    assert.ok(page.includes(`${SET[1].name} (${SET[1].language}): INVALID_FORMAT`), "a rejected one is named with Meta's reason");
    assert.match(page, /What to do: open WhatsApp Manager/u);
    // the checks page warns and does not block
    const checks = plainText((await arjun.get(`/setup/${f.draft}/6`)).text);
    assert.match(checks, new RegExp(`WhatsApp wordings: 1 of ${SET.length} approved\\. You can still go live`, "u"));
  } finally { await b.close(); await meta.close(); }
});

test("a shop set up before new templates gets just those, from the shop page's button", async () => {
  const meta = await startMetaTemplateStandin({ wabaId: WABA });
  const b = await boot({ guardUrl: meta.url, templatesPause: async () => {} });
  try {
    const arjun = await b.account("arjun", "builder");
    b.addShop("glow", { ownerId: "x" });
    const runtime = join(b.dir, "shops", "glow", "runtime.json");
    const r = JSON.parse(readFileSyncText(runtime)); r.services.messaging.wabaId = WABA; writeFileSync(runtime, JSON.stringify(r));
    const settings = JSON.parse(readFileSyncText(join(b.dir, "shops", "glow", "settings.json")));
    const set = readEntries(BOOKINGS).filter((e) => shopLanguages(settings).includes(e.language));
    const newer = new Set(set.map((e) => e.name).slice(-6));
    for (const e of set) if (!newer.has(e.name)) meta.seed(e.name, e.language, "APPROVED");
    const page = plainText((await arjun.get("/shops/glow")).text);
    const missing = set.filter((e) => newer.has(e.name)).length;
    assert.match(page, new RegExp(`Send the ${missing} not sent yet`, "u"));
    assert.equal(meta.created.length, 0, "opening the page sends nothing");
    const sent = await arjun.post("/shops/glow/wa-templates", {}, "/shops/glow");
    assert.equal(sent.status, 303);
    await b.panel.settled();
    assert.deepEqual(new Set(meta.created.map((c) => c.body.name as string)), newer, "only the new ones");
    assert.equal(meta.created.length, missing);
  } finally { await b.close(); await meta.close(); }
});

test("Gupshup self-serve: the save submits to the shop's own app (with the app id from the WhatsApp step), and the shop page shows them waiting", async () => {
  const g = await startGupshupTemplateStandin({ appId: APP });
  const b = await boot({ guardUrl: g.url, templatesPause: async () => {} });
  try {
    const arjun = await b.account("arjun", "builder");
    const { waNumberId: _id, waToken: _t, waAppSecret: _s, ...rest } = STEP4;
    const f = await setUp(b, arjun, [STEP1, STEP2, STEP3, { ...rest, waProvider: "gupshup-selfserve", waAppName: "Glow_Salon", waAppId: APP, waApiKey: "k".repeat(32), waPathToken: "Zk3-mQ9_vT7xLp2Rw8YdNa5c" }]);
    await arjun.post(`/setup/${f.draft}/save`, {}, `/setup/${f.draft}/6`);
    await b.panel.settled();
    assert.match(readFileSyncText(join(b.dir, "shops", f.shop, "runtime.json")), new RegExp(`"appId": "${APP}"`, "u"));
    assert.equal(g.created.length, SET.length);
    assert.ok(g.created.every((c) => c.appId === APP && c.apikey === undefined));
    const page = plainText((await arjun.get(`/shops/${f.shop}`)).text);
    assert.match(page, new RegExp(`${SET.length} Waiting for approval`, "u")); assert.match(page, /As Gupshup said at/u);
  } finally { await b.close(); await g.close(); }
});

test("a key the provider refuses stops at once with a plain line, and nothing is sent", async () => {
  const meta = await startMetaTemplateStandin({ wabaId: WABA, token: "Bearer the-shop-token" }); // the panel presents no key, so Meta answers 190
  const b = await boot({ guardUrl: meta.url, templatesPause: async () => {} });
  try {
    const arjun = await b.account("arjun", "builder");
    const f = await setUp(b, arjun, [STEP1, STEP2, STEP3, { ...STEP4, waWabaId: WABA }]);
    await arjun.post(`/setup/${f.draft}/save`, {}, `/setup/${f.draft}/6`);
    await b.panel.settled();
    assert.equal(meta.created.length, 0);
    const page = plainText((await arjun.get(`/shops/${f.shop}`)).text);
    assert.match(page, /Meta did not accept the shop's key\. Hand it in again in the shop's WhatsApp step/u);
    assert.match(page, /Ask again now/u);
  } finally { await b.close(); await meta.close(); }
});

test("a Guard that is not running yet is 'waiting'; the button sends once it runs; a shop with no account id is told what to add and nothing is called", async () => {
  const meta = await startMetaTemplateStandin({ wabaId: WABA });
  const b = await boot({ guardUrl: "http://127.0.0.1:9", templatesPause: async () => {} });
  try {
    const arjun = await b.account("arjun", "builder");
    const f = await setUp(b, arjun, [STEP1, STEP2, STEP3, { ...STEP4, waWabaId: WABA }]);
    await arjun.post(`/setup/${f.draft}/save`, {}, `/setup/${f.draft}/6`);
    await b.panel.settled();
    let page = plainText((await arjun.get(`/shops/${f.shop}`)).text);
    assert.match(page, /The shop's WhatsApp connection is not running yet, so nothing was sent/u);
    b.config.guardUrl = meta.url; // the deployer applied the shop: its Guard answers now
    await arjun.post(`/shops/${f.shop}/wa-templates`, {}, `/shops/${f.shop}`);
    await b.panel.settled();
    assert.equal(meta.created.length, SET.length);
    page = plainText((await arjun.get(`/shops/${f.shop}`)).text);
    assert.doesNotMatch(page, /not running yet/u);

    const g = await setUp(b, arjun, [{ ...STEP1, name: "Second Salon" }, STEP2, STEP3, STEP4]);
    await arjun.post(`/setup/${g.draft}/save`, {}, `/setup/${g.draft}/6`);
    await b.panel.settled();
    page = plainText((await arjun.get(`/shops/${g.shop}`)).text);
    assert.match(page, /Add the shop's WhatsApp Business Account ID in its WhatsApp step/u);
    assert.equal(meta.created.length, SET.length, "nothing was called for it");
    // a bad account id is refused in the step, in words
    const h = await setUp(b, arjun, [{ ...STEP1, name: "Third Salon" }, STEP2, STEP3]);
    const bad = await arjun.post(`/setup/${h.draft}/4`, { ...STEP4, waWabaId: "12ab" }, `/setup/${h.draft}/4`);
    assert.equal(bad.status, 400); assert.match(bad.plain, /The WhatsApp Business Account ID is digits only/u);
  } finally { await b.close(); await meta.close(); }
});

function readFileSyncText(file: string): string { return readFileSync(file, "utf8"); }
