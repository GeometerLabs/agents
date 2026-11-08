// The Orders template in the panel: a partner sets up a tiffin service on a phone in the same five steps (UPI is the way customers pay unless the partner chooses Razorpay), and the
// folder written is the one `geometer shop add --template orders` writes (Orders settings, a runtime.json with no calendar, orders@<version> in the lock). The checks, "Ready to go
// live", the monthly report and the shop page work for it in four languages, and nothing of Bookings (a calendar, a cost table of bookings) leaks onto an Orders shop's pages.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { validateSettings } from "../../../templates/commerce/orders/src/settings.ts";
import { WORDS } from "../languages.ts";
import { DAYS_IN_A_MONTH, MESSAGES_PER_ORDER } from "../views-orders.ts";
import { PHONE_ID, NOW, boot, papers } from "./helpers.ts";
import type { Boot, Browser } from "./helpers.ts";

const M = { token: `EAAMARKERTOKEN${"x".repeat(40)}`, app: "0a1b2c3d4e5f60718a1b2c3d4e5f6071" };

const ORDERS1 = { name: "Sunrise Tiffins", address: "12 Lake Road", menu: "Veg thali, 120, 12\nChicken meal, 160, 8\nCurd, 20, 30" };
const ORDERS2 = {
  cutoffDays: "1", cutoffTime: "20:00", pickup: "12:00-13:00, lunch\n19:00-20:00, dinner", delivery: "12:30-13:30, lunch\n19:30-20:30, dinner", area: "Kakkanad, Edappally",
  advanceMode: "part", advancePercent: "50", holdMinutes: "30", maxPerDay: "8", maxItems: "10", daysAhead: "7", windowHours: "6", refund: "300", approveOver: "1000",
};
/** The accounts step of a UPI shop: the shop's WhatsApp number and its UPI ID; no Razorpay key is asked. */
const ORDERS4 = { waNumber: "+91 90000 11111", waNumberId: PHONE_ID, waToken: M.token, waAppSecret: M.app, payMod: "upi", upiId: "sunrise@okicici", upiPayee: "Sunrise Tiffins" };

/** Malayalam and English for customers, English for messages to the owner: the hand check's UPI situations read the owner's replies in English only (said in Deferred.md), so a shop that is to pass them has an English-speaking owner line. */
const STEP3 = { primary: "ml", lang_en: "on", ownerLanguage: "en", ownerNumber: "98765 43210" };

const applied = (o: Record<string, unknown> = {}) => ({
  updatedAt: new Date(NOW - 5 * 60_000).toISOString(), deploy: { state: "applied", at: new Date(NOW - 3600_000).toISOString() }, limits: { proven: 6, of: 6, unprovable: [] },
  versions: { pathway: "0.1.0", bundle: "0.1.0", guard: "geo-guard:0.1.0-alpha.2-pathways.1" }, backups: { lastCopyAt: new Date(NOW - 60_000).toISOString() }, ...o,
});

/** The five steps for an Orders shop, as a partner does them on a phone. */
async function setUpOrders(who: Browser, _b: Boot, steps: Record<string, string>[] = [ORDERS1, ORDERS2, STEP3, ORDERS4]) {
  const start = await who.post("/setup", { template: "orders" }, "/setup");
  assert.equal(start.status, 303, start.text.slice(0, 300));
  const draft = start.location!.split("/")[2];
  const replies: string[] = [];
  for (const [i, form] of steps.entries()) {
    const path = `/setup/${draft}/${i + 1}`;
    replies.push((await who.get(path)).text);
    const r = await who.post(path, form, path);
    replies.push(r.text);
    assert.equal(r.status, 303, `step ${i + 1}: ${r.text.replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ").slice(0, 500)}`);
  }
  const saved = await who.post(`/setup/${draft}/save`, {}, `/setup/${draft}/5`);
  assert.equal(saved.location, `/setup/${draft}/5`, [...saved.plain.matchAll(/<li>([^<]*)<\/li>/gu)].map((m) => m[1]).join(" | ") || String(saved.status));
  return { draft, replies };
}

const shopIdOf = (b: Boot): string => {
  const ids = readdirSync(join(b.dir, "shops"));
  assert.equal(ids.length, 1, ids.join());
  return ids[0];
};
const exportEmpty = (b: Boot, shop: string) => {
  mkdirSync(join(b.dir, "exports", shop), { recursive: true });
  writeFileSync(join(b.dir, "exports", shop, "record.json"), "[]");
  writeFileSync(join(b.dir, "exports", shop, "orders.json"), "[]");
};

test("the start page offers Orders with a button, and the five steps write the folder `shop add --template orders` writes: Orders settings with UPI, no calendar, orders@version, the partner as owner", async () => {
  const b = await boot({}, { standins: true });
  try {
    const divya = await b.account("divya", "partner");
    const start = (await divya.get("/setup")).plain;
    assert.ok(start.includes(WORDS.en.setup.templateNames.orders) && start.includes(`name="template" value="orders"`), "Orders has its start button");
    const { replies } = await setUpOrders(divya, b);
    const pages = replies.join("\n");
    assert.ok(pages.includes('name="menu"') && pages.includes('name="pickup"') && pages.includes('name="advanceMode"'), "the Orders forms are shown");
    assert.ok(/name="payMod" value="upi" checked/u.test(pages), "UPI is the way customers pay unless the partner chooses otherwise");
    assert.ok(!pages.includes('name="calId"') && !pages.includes("Google Calendar"), "an Orders shop is asked for no calendar");
    for (const secret of [M.token, M.app]) assert.ok(!pages.includes(secret), "no secret is shown back");

    const shop = shopIdOf(b);
    assert.equal(shop, "sunrise-tiffins");
    const folder = join(b.dir, "shops", shop);
    const settings = validateSettings(JSON.parse(readFileSync(join(folder, "settings.json"), "utf8")));
    assert.ok(settings.ok, settings.ok ? "" : settings.errors.join("; "));
    if (!settings.ok) return;
    const s = settings.settings;
    assert.deepEqual(s.menu.map((x) => [x.id, x.priceInr, x.dailyStock]), [["veg-thali", 120, 12], ["chicken-meal", 160, 8], ["curd", 20, 30]]);
    assert.deepEqual(s.languages, ["ml", "en"]);
    assert.deepEqual(s.menu[0].names, { ml: ["Veg thali"], en: ["Veg thali"] }, "the item's name is its name in every language the shop speaks");
    assert.deepEqual(s.payment, { module: "upi", upi: { id: "sunrise@okicici", payee: "Sunrise Tiffins" } });
    assert.deepEqual(s.delivery?.slots.map((x) => x.id), ["lunch-2", "dinner-2"]);
    assert.deepEqual(JSON.parse(readFileSync(join(folder, "runtime.json"), "utf8")), { mode: "live", tickSeconds: 30, services: { payments: {}, messaging: { phoneNumberId: PHONE_ID }, timeoutMs: 20000 } });
    assert.equal(readFileSync(join(folder, "pathway.lock"), "utf8").trim(), "orders@0.1.0");
    assert.equal(JSON.parse(readFileSync(join(folder, "owner.json"), "utf8")).template, "orders");
  } finally { await b.close(); }
});

test("what is wrong with the shop's form is said in the person's own language, and nothing is written", async () => {
  const b = await boot({}, { standins: true });
  try {
    for (const language of ["hi", "ml", "kn"] as const) {
      const who = await b.account(`p-${language}`, "partner", language);
      const start = await who.post("/setup", { template: "orders" }, "/setup");
      const draft = start.location!.split("/")[2];
      const bad = await who.post(`/setup/${draft}/1`, { name: "", menu: "Thali, 12x, 5\nJust a name" }, `/setup/${draft}/1`);
      assert.equal(bad.status, 400);
      assert.ok(bad.plain.includes(WORDS[language].setup.orders.problems.priceBad(1)) && bad.plain.includes(WORDS[language].setup.orders.problems.itemBad(2)), `${language}: ${bad.plain.replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ").slice(0, 900)}`);
      assert.ok(!bad.plain.includes("undefined"));
      const rules = await who.post(`/setup/${draft}/2`, ORDERS2, `/setup/${draft}/1`);
      assert.equal(rules.status, 303, "a later step cannot be skipped: it goes back to the first one not filled in");
      assert.ok(rules.location!.endsWith("/1"));
    }
    assert.deepEqual(readdirSync(join(b.dir, "shops")), []);
  } finally { await b.close(); }
});

test("the checks for an Orders shop have no calendar and no Razorpay, 'Ready to go live' makes the Orders certificate, and the monthly report is the Orders report", async () => {
  const b = await boot({}, { standins: true, signing: true });
  try {
    const divya = await b.account("divya", "partner");
    const { draft } = await setUpOrders(divya, b);
    const shop = shopIdOf(b);
    const checks = `/setup/${draft}/5`;
    const before = (await divya.get(checks)).plain;
    assert.ok(!before.includes(WORDS.en.cost.heading) && !before.includes(WORDS.en.setup.checks.bookingsExpected), "no bookings cost table or estimate for an Orders shop");
    assert.ok(before.includes(WORDS.en.ordersShop.messages.heading), "the messages its rules allow are shown instead");
    assert.equal((await divya.post(`/setup/${draft}/ready`, {}, checks)).status, 409, "nothing is ready before the server has applied the shop");

    b.status(shop, applied());
    assert.equal((await divya.post(`/setup/${draft}/check`, {}, checks)).location, checks);
    const page = (await divya.get(checks)).plain;
    const w = WORDS.en.setup.checks;
    assert.ok(page.includes(w.whatsapp.confirmed("+919000011111")), page.slice(page.indexOf("Checks"), page.indexOf("Checks") + 1500));
    assert.ok(!page.includes(w.calendar.title) && !page.includes(w.razorpay.title), "no calendar check, and no Razorpay check for a UPI shop");
    const held = /Held (\d+) of (\d+) situations\. 0 failed\./u.exec(page);
    assert.ok(held && held[1] === held[2] && Number(held[1]) > 0, "the Orders hand check's own sentence");
    assert.ok(page.includes(w.readyButton));
    const pins = JSON.parse(readFileSync(join(b.dir, "shops", shop, "pins.json"), "utf8"));
    assert.deepEqual(pins.calendar, undefined);

    assert.equal((await divya.post(`/setup/${draft}/ready`, {}, checks)).status, 303);
    const docs = papers(b, shop);
    const cert = JSON.parse(docs.get(shop, "go-live/go-live-certificate.json")!);
    assert.equal(cert.document.pathway.name, "orders");
    assert.equal(cert.document.shop.name, "Sunrise Tiffins");
    assert.ok(cert.signatures?.length > 0 || cert.signature, "signed with the panel's key");

    // the monthly report: the Orders one, reading the certificate
    exportEmpty(b, shop);
    const made = await divya.post(`/shops/${shop}/report`, { month: "2026-11" }, `/shops/${shop}`);
    assert.equal(made.status, 303, made.text.slice(0, 300));
    assert.ok(docs.list(shop, "monthly").some((f) => f.endsWith(".html")), docs.list(shop, "monthly").join());
    const report = JSON.parse(docs.get(shop, `monthly/2026-11/report-2026-11.json`)!);
    assert.equal(report.document.pathway.name, "orders");
    assert.equal(report.document.goLive.status, "own", "the report read the certificate the panel made, on this shop's own settings");
    assert.equal(report.document.paidBy, "owner-marked", "a UPI shop's money is what the owner marked");
  } finally { await b.close(); }
});

test("the shop page of an Orders shop, in four languages: its menu, its rules in the certificate's words, this month's counts, the messages its rules allow, and no bookings cost table", async () => {
  const b = await boot({}, { standins: true });
  try {
    const divya = await b.account("divya", "partner");
    await setUpOrders(divya, b);
    const shop = shopIdOf(b);
    b.status(shop, applied());
    exportEmpty(b, shop);
    for (const language of ["en", "hi", "ml", "kn"] as const) {
      await divya.get(`/lang/${language}?next=/shops`);
      const page = (await divya.get(`/shops/${shop}`)).plain;
      const w = WORDS[language];
      assert.ok(page.includes("Chicken meal"), `${language}: the menu`);
      assert.ok(page.includes(w.ordersShop.summaryMenu) && page.includes(w.ordersShop.summaryRules) && page.includes(w.ordersShop.perDay(8)), `${language}: ${page.slice(0, 200)}`);
      assert.ok(page.includes(w.ordersShop.activity.taken) && page.includes(w.ordersShop.messages.heading), `${language}: this month and the messages`);
      assert.ok(page.includes(w.ordersShop.messages.ceiling(8, MESSAGES_PER_ORDER, 8 * DAYS_IN_A_MONTH * MESSAGES_PER_ORDER)), `${language}: what to plan for: 8 orders a day, a 31-day month, about 3 messages each`);
      assert.ok(page.includes("₹160"), `${language}: a price in rupees as given`);
      assert.ok(!page.includes('class="cost"') && !page.includes(w.cost.heading), `${language}: no bookings cost table`);
      assert.ok(!page.includes("undefined") && !page.includes("NaN"), `${language}`);
    }
  } finally { await b.close(); }
});

test("changing an Orders shop's settings is the same steps from what it has, and keeps the pin it has", async () => {
  const b = await boot({}, { standins: true });
  try {
    const divya = await b.account("divya", "partner");
    await setUpOrders(divya, b);
    const shop = shopIdOf(b);
    const edit = await divya.post(`/shops/${shop}/edit`, {}, `/shops/${shop}`);
    const d2 = edit.location!.split("/")[2];
    const first = (await divya.get(`/setup/${d2}/1`)).plain;
    assert.ok(first.includes("Sunrise Tiffins") && first.includes("Chicken meal, 160, 8"), "the form comes back as it was saved");
    assert.equal((await divya.post(`/setup/${d2}/1`, { ...ORDERS1, menu: ORDERS1.menu.replace("Veg thali, 120", "Veg thali, 130") }, `/setup/${d2}/1`)).status, 303);
    for (const n of [2, 3, 4]) await divya.post(`/setup/${d2}/${n}`, n === 2 ? ORDERS2 : n === 3 ? STEP3 : { ...ORDERS4, waToken: "", waAppSecret: "" }, `/setup/${d2}/${n}`);
    assert.equal((await divya.post(`/setup/${d2}/save`, {}, `/setup/${d2}/5`)).status, 303);
    const settings = JSON.parse(readFileSync(join(b.dir, "shops", shop, "settings.json"), "utf8"));
    assert.equal(settings.menu[0].priceInr, 130);
    assert.equal(settings.menu[0].id, "veg-thali");
    assert.equal(readFileSync(join(b.dir, "shops", shop, "pathway.lock"), "utf8").trim(), "orders@0.1.0");
  } finally { await b.close(); }
});
