// The Fees template in the panel: a partner sets up a tuition centre on a phone in the same five steps, and the folder written is the one `geometer shop add --template fees`
// writes (Fees settings, a runtime.json with no calendar, fees@<version> in the lock). The checks, "Ready to go live", the monthly report and the shop page work for it
// in four languages, and nothing of Bookings (a calendar, a cost table of bookings) leaks onto a Fees centre's pages.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { validateSettings } from "../../../templates/education/fees/src/settings.ts";
import { WORDS } from "../languages.ts";
import { STEP3, setUp } from "./flow.ts";
import { PHONE_ID, NOW, boot, papers } from "./helpers.ts";
import type { Boot, Browser } from "./helpers.ts";

const M = { token: `EAAMARKERTOKEN${"x".repeat(40)}`, app: "0a1b2c3d4e5f60718a1b2c3d4e5f6071", secret: "MARKERrzpSECRET123456789", hook: "MARKERwebhook-secret-1" };

const FEES1 = {
  name: "Sunrise Tuition", address: "12 Lake Road", batch_name_0: "Class 8", batch_fee_0: "1200", batch_name_1: "Class 10", batch_fee_1: "1800",
  students: "Aarav Sharma, 98111 11111, Class 10\nMeera Nair, +91 98222 22222, class 8",
};
const FEES2 = { dueDay: "5", graceDays: "5", lateFee: "100", reminderDays: "-3, 0, 5", reminderHour: "10", reminderMost: "4", partAllowed: "on", partMin: "300", waiver: "500", refund: "1200" };
const FEES4 = { waNumber: "+91 90000 11111", waNumberId: PHONE_ID, waToken: M.token, waAppSecret: M.app, rzpMode: "live", rzpKeyId: "rzp_live_AbCdEf123456", rzpKeySecret: M.secret, rzpWebhook: M.hook };

const applied = (o: Record<string, unknown> = {}) => ({
  updatedAt: new Date(NOW - 5 * 60_000).toISOString(), deploy: { state: "applied", at: new Date(NOW - 3600_000).toISOString() }, limits: { proven: 6, of: 6, unprovable: [] },
  versions: { pathway: "0.1.0", bundle: "0.1.0", guard: "geo-guard:0.1.0-alpha.2-pathways.1" }, backups: { lastCopyAt: new Date(NOW - 60_000).toISOString() }, ...o,
});

/** The five steps for a Fees centre, as a partner does them on a phone. */
async function setUpFees(who: Browser, b: Boot, steps: Record<string, string>[] = [FEES1, FEES2, STEP3, FEES4]) {
  const start = await who.post("/setup", { template: "fees" }, "/setup");
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
  const ids = readdirOf(join(b.dir, "shops"));
  assert.equal(ids.length, 1, ids.join());
  return ids[0];
};
const readdirOf = (dir: string): string[] => readdirSync(dir);

test("the start page offers Fees with a button, and the five steps write the folder `shop add --template fees` writes: Fees settings, no calendar, fees@version, the partner as owner", async () => {
  const b = await boot({}, { standins: true });
  try {
    const divya = await b.account("divya", "partner");
    const start = (await divya.get("/setup")).plain;
    assert.ok(start.includes(WORDS.en.setup.templateNames.fees) && start.includes(`name="template" value="fees"`), "Fees has its start button");
    const { replies } = await setUpFees(divya, b);
    const pages = replies.join("\n");
    assert.ok(pages.includes("batch_name_0") && pages.includes('name="students"') && pages.includes('name="dueDay"'), "the Fees forms are shown");
    assert.ok(!pages.includes('name="calId"') && !pages.includes("Google Calendar"), "a Fees centre is asked for no calendar");
    for (const secret of [M.token, M.secret, M.hook, M.app]) assert.ok(!pages.includes(secret), "no secret is shown back");

    const shop = shopIdOf(b);
    assert.equal(shop, "sunrise-tuition");
    const folder = join(b.dir, "shops", shop);
    const settings = validateSettings(JSON.parse(readFileSync(join(folder, "settings.json"), "utf8")));
    assert.ok(settings.ok, settings.ok ? "" : settings.errors.join("; "));
    if (!settings.ok) return;
    const s = settings.settings;
    assert.deepEqual(s.batches.map((x) => [x.id, x.monthlyFeeInr]), [["class-8", 1200], ["class-10", 1800]]);
    assert.deepEqual(s.students.map((x) => [x.name, x.parent, x.batchId]), [["Aarav Sharma", "+919811111111", "class-10"], ["Meera Nair", "+919822222222", "class-8"]]);
    assert.deepEqual([s.due.day, s.due.graceDays, s.lateFeeInr, s.waiver.limitInr, s.refund.limitInr], [5, 5, 100, 500, 1200]);
    assert.deepEqual(s.languages, ["ml", "en"]);
    const runtime = JSON.parse(readFileSync(join(folder, "runtime.json"), "utf8"));
    assert.deepEqual(runtime, { mode: "live", tickSeconds: 30, services: { payments: {}, messaging: { phoneNumberId: PHONE_ID }, timeoutMs: 20000 } });
    assert.equal(readFileSync(join(folder, "pathway.lock"), "utf8").trim(), "fees@0.1.0");
    assert.equal(JSON.parse(readFileSync(join(folder, "owner.json"), "utf8")).template, "fees");
  } finally { await b.close(); }
});

test("what is wrong with the centre's form is said in the person's own language, and nothing is written", async () => {
  const b = await boot({}, { standins: true });
  try {
    for (const language of ["hi", "ml", "kn"] as const) {
      const who = await b.account(`p-${language}`, "partner", language);
      const start = await who.post("/setup", { template: "fees" }, "/setup");
      const draft = start.location!.split("/")[2];
      const bad = await who.post(`/setup/${draft}/1`, { name: "", batch_name_0: "", batch_fee_0: "12x", students: "Aarav, 12345, Class 10\nJust a name" }, `/setup/${draft}/1`);
      assert.equal(bad.status, 400);
      assert.ok(bad.plain.includes(WORDS[language].setup.fees.problems.feeBad(1)) && bad.plain.includes(WORDS[language].setup.fees.problems.studentBad(2)), `${language}: ${bad.plain.replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ").slice(0, 900)}`);
      assert.ok(!bad.plain.includes("undefined"));
      const rules = await who.post(`/setup/${draft}/2`, FEES2, `/setup/${draft}/1`);
      assert.equal(rules.status, 303, "a later step cannot be skipped: it goes back to the first one not filled in");
      assert.ok(rules.location!.endsWith("/1"));
    }
    assert.deepEqual(readdirOf(join(b.dir, "shops")), []);
  } finally { await b.close(); }
});

test("the checks for a Fees centre have no calendar, 'Ready to go live' makes the Fees certificate, and the monthly report is the Fees report", async () => {
  const b = await boot({}, { standins: true, signing: true });
  try {
    const divya = await b.account("divya", "partner");
    const { draft } = await setUpFees(divya, b);
    const shop = shopIdOf(b);
    const checks = `/setup/${draft}/5`;
    const before = (await divya.get(checks)).plain;
    assert.ok(before.includes(WORDS.en.setup.fees.steps.business) || before.includes(WORDS.en.setup.checks.settingsOk));
    assert.ok(!before.includes(WORDS.en.cost.heading) && !before.includes(WORDS.en.setup.checks.bookingsExpected), "no bookings cost table or estimate for a Fees centre");
    assert.ok(before.includes(WORDS.en.feesShop.messages.heading), "the messages its rules allow are shown instead");
    assert.equal((await divya.post(`/setup/${draft}/ready`, {}, checks)).status, 409, "nothing is ready before the server has applied the centre");

    b.status(shop, applied());
    assert.equal((await divya.post(`/setup/${draft}/check`, {}, checks)).location, checks);
    const page = (await divya.get(checks)).plain;
    const w = WORDS.en.setup.checks;
    assert.ok(page.includes(w.whatsapp.confirmed("+919000011111")) && page.includes(w.razorpay.confirmed(WORDS.en.setup.accounts.razorpay.modeLive)), page.slice(page.indexOf("Checks"), page.indexOf("Checks") + 1500));
    assert.ok(!page.includes(w.calendar.title), "no calendar check");
    assert.ok(/Held 26 of 26 situations\. 0 failed\. \d+ not tested\./u.test(page), "the Fees hand check's own sentence");
    assert.ok(page.includes(w.readyButton));
    const pins = JSON.parse(readFileSync(join(b.dir, "shops", shop, "pins.json"), "utf8"));
    assert.deepEqual(pins.calendar, undefined);
    assert.deepEqual(pins.whatsapp, { phoneNumberId: PHONE_ID, displayNumber: "+919000011111" });

    assert.equal((await divya.post(`/setup/${draft}/ready`, {}, checks)).status, 303);
    const docs = papers(b, shop);
    const cert = JSON.parse(docs.get(shop, "go-live/go-live-certificate.json")!);
    assert.equal(cert.document.pathway.name, "fees");
    assert.equal(cert.document.shop.name, "Sunrise Tuition");
    assert.ok(cert.signatures?.length > 0 || cert.signature, "signed with the panel's key");

    // the monthly report: the Fees one, reading the certificate
    mkdirSync(join(b.dir, "exports", shop), { recursive: true });
    writeFileSync(join(b.dir, "exports", shop, "record.json"), "[]");
    writeFileSync(join(b.dir, "exports", shop, "dues.json"), "[]");
    const made = await divya.post(`/shops/${shop}/report`, { month: "2026-11" }, `/shops/${shop}`);
    assert.equal(made.status, 303, made.text.slice(0, 300));
    const monthly = docs.list(shop, "monthly");
    assert.ok(monthly.some((f) => f.endsWith(".html")), monthly.join());
    const report = JSON.parse(docs.get(shop, `monthly/2026-11/report-2026-11.json`)!);
    assert.equal(report.document.pathway.name, "fees");
    assert.equal(report.document.goLive.status, "own", "the report read the certificate the panel made, on this centre's own settings");
  } finally { await b.close(); }
});

test("the shop page of a Fees centre, in four languages: its batches, its rules in the certificate's words, this month's counts, the messages its rules allow, and no bookings cost table", async () => {
  const b = await boot({}, { standins: true });
  try {
    const divya = await b.account("divya", "partner");
    await setUpFees(divya, b);
    const shop = shopIdOf(b);
    b.status(shop, applied());
    mkdirSync(join(b.dir, "exports", shop), { recursive: true });
    writeFileSync(join(b.dir, "exports", shop, "record.json"), "[]");
    writeFileSync(join(b.dir, "exports", shop, "dues.json"), "[]");
    for (const language of ["en", "hi", "ml", "kn"] as const) {
      await divya.get(`/lang/${language}?next=/shops`);
      const page = (await divya.get(`/shops/${shop}`)).plain;
      const w = WORDS[language];
      assert.ok(page.includes("Class 8") || page.includes("class 8"), `${language}: the batches`);
      assert.ok(page.includes(w.shop.summaryFees) && page.includes(w.shop.summaryRules) && page.includes(w.feesShop.studentsIn(1)), `${language}: ${page.slice(0, 200)}`);
      assert.ok(page.includes(w.feesShop.activity.paidInFull) && page.includes(w.feesShop.messages.heading), `${language}: this month and the messages`);
      assert.ok(page.includes("₹1,800"), `${language}: a fee in rupees as given`);
      assert.ok(!page.includes('class="cost"') && !page.includes(w.cost.heading), `${language}: no bookings cost table`);
      assert.ok(!page.includes("undefined") && !page.includes("NaN"), `${language}`);
    }
  } finally { await b.close(); }
});

test("changing a Fees centre's settings is the same steps from what it has, and keeps the pin it has", async () => {
  const b = await boot({}, { standins: true });
  try {
    const divya = await b.account("divya", "partner");
    await setUpFees(divya, b);
    const shop = shopIdOf(b);
    const edit = await divya.post(`/shops/${shop}/edit`, {}, `/shops/${shop}`);
    const d2 = edit.location!.split("/")[2];
    const first = (await divya.get(`/setup/${d2}/1`)).plain;
    assert.ok(first.includes("Sunrise Tuition") && first.includes("Aarav Sharma") && first.includes("Class 10"), "the form comes back as it was saved");
    assert.equal((await divya.post(`/setup/${d2}/1`, { ...FEES1, batch_fee_0: "1300" }, `/setup/${d2}/1`)).status, 303);
    for (const n of [2, 3, 4]) await divya.post(`/setup/${d2}/${n}`, n === 2 ? FEES2 : n === 3 ? STEP3 : { ...FEES4, waToken: "", waAppSecret: "", rzpKeySecret: "", rzpWebhook: "" }, `/setup/${d2}/${n}`);
    assert.equal((await divya.post(`/setup/${d2}/save`, {}, `/setup/${d2}/5`)).status, 303);
    const settings = JSON.parse(readFileSync(join(b.dir, "shops", shop, "settings.json"), "utf8"));
    assert.equal(settings.batches[0].monthlyFeeInr, 1300);
    assert.equal(readFileSync(join(b.dir, "shops", shop, "pathway.lock"), "utf8").trim(), "fees@0.1.0");
  } finally { await b.close(); }
});
