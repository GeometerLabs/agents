// The three layers of the monthly report, in all four languages and in "both": the owner's five lines, the printable page, and
// the words no document may use. The numbers come from the scripted busy month; every amount in the output is checked
// against the amounts the record holds.
import { test } from "node:test";
import assert from "node:assert/strict";
import { NOT_TESTED } from "../crash-test/not-tested.ts";
import { MONTH_NAMES, formatInr } from "../src/language/format.ts";
import { glowSalon } from "../src/harness.ts";
import { LANGUAGES, parseSettings } from "../src/settings.ts";
import { buildMonthlyReport, monthRange, NOT_COUNTED, RULE_IDS } from "../report/data.ts";
import type { MonthlyReport, Source } from "../report/data.ts";
import { at, runBusyMonth } from "../report/example-month.ts";
import { reportPage } from "../report/html.ts";
import { seal } from "../report/sign.ts";
import { BANNED, STRINGS, bannedIn } from "../report/strings.ts";
import { languagesOf, ownerText, ownerTexts } from "../report/text.ts";
import type { ReportLanguage } from "../report/text.ts";

const settings = glowSalon();
const ALL: ReportLanguage[] = [...LANGUAGES, "both"];

let cached: Promise<MonthlyReport> | undefined;
function novemberReport(source: Source = "stand-in"): Promise<MonthlyReport> | MonthlyReport {
  const make = async (s: Source) => {
    const { world } = await runBusyMonth();
    const { from, to } = monthRange("2026-11", settings.timezone);
    return buildMonthlyReport({ settings, entries: world.record.entries(), bookings: [...world.store.bookings.values()], from, to, source: s, madeAt: at(12, 2, 10), preparedBy: "Divya, local partner" });
  };
  if (source !== "stand-in") return make(source);
  return (cached ??= make("stand-in"));
}

/** The visible words of a page: no style block, no tags, entities turned back. */
const words = (html: string) => html.replace(/<style>[\s\S]*?<\/style>/g, " ").replace(/<[^>]*>/g, " ").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const amountsIn = (text: string) => [...text.matchAll(/₹[\d,]+/g)].map((m) => m[0]);

test("the owner text is five lines or fewer in every language, and in both", async () => {
  const report = await novemberReport();
  for (const language of ALL) {
    const texts = ownerTexts(report, language);
    assert.equal(texts.length, language === "both" ? 2 : 1);
    for (const text of texts) {
      const lines = text.split("\n");
      assert.ok(lines.length <= 5 && lines.length >= 4, `${language}: ${lines.length} lines`);
      assert.ok(lines.every((l) => l.trim() !== ""));
      assert.ok(lines[0].startsWith("Glow Salon"));
    }
  }
  assert.deepEqual(languagesOf("both"), ["hi", "en"]);
});

test("the owner text leads with bookings and money, and carries the counts, in the shop's words", async () => {
  const report = await novemberReport();
  for (const language of LANGUAGES) {
    const s = STRINGS[language];
    const text = ownerText(report, language);
    const [title, money, asked, stopped, notChecked] = text.split("\n");
    assert.ok(title.includes(`${MONTH_NAMES[language][10]} 2026`), `${language}: month and year in ${title}`);
    assert.ok(title.includes(s.sourceTag["stand-in"]), `${language}: says where the numbers come from`);
    assert.ok(money.includes(`${s.label.bookingsMade}: 26`) && money.includes(`${s.label.cancelled}: 6`), money);
    assert.ok(money.includes(`${s.label.depositsCollected}: ₹5,400`) && money.includes(`${s.label.givenBack}: ₹1,000`), money);
    assert.ok(asked.includes(`${s.label.wasAsked}: 3`) && asked.includes(`${s.label.approved}: 1`) && asked.includes(`${s.label.saidNo}: 1`) && asked.includes(`${s.label.notConfirmed}: 1`), asked);
    assert.ok(stopped.includes(`${s.label.stoppedByLimits}: 10`) && stopped.includes(`${s.stop["price-at-or-above-list"]}: 3`), stopped);
    assert.ok(notChecked.startsWith(s.label.notChecked) && notChecked.includes(s.notTested["voice-calls"]) && notChecked.includes(s.notTested["walk-ins"]) && notChecked.includes(s.handRun), notChecked);
  }
});

test("a quiet month still reads: zeros are shown, and the not-checked line is still there", () => {
  const quiet = buildMonthlyReport({ settings, entries: [], bookings: [], ...monthRange("2026-11", settings.timezone), source: "live", madeAt: 0 });
  for (const language of LANGUAGES) {
    const lines = ownerText(quiet, language).split("\n");
    assert.equal(lines.length, 5);
    assert.ok(lines[0] === `Glow Salon · ${MONTH_NAMES[language][10]} 2026`, "a live report carries no stand-in or test tag");
    assert.ok(lines[1].includes(`${STRINGS[language].label.depositsCollected}: ₹0`) && lines[3].endsWith(": 0"));
    assert.ok(lines[4].startsWith(STRINGS[language].label.notChecked));
  }
});

test("no banned word appears in the owner text, the page or the certificate words, in any language", async () => {
  const report = await novemberReport();
  for (const language of ALL) {
    for (const l of languagesOf(language)) {
      assert.deepEqual(bannedIn(ownerText(report, l), l), [], `owner text ${l}`);
      assert.deepEqual(bannedIn(words(reportPage(seal(report), l)), l), [], `page ${l}`);
      const s = STRINGS[l];
      const everything = JSON.stringify([s, Object.values(s.notTested), Object.values(s.notCounted), s.cert.held(33, 33, 0, 14), s.cert.floor("x"), s.cert.deposit("x", 1), s.cert.cancel(1), s.cert.refund("x"), s.cert.countedIntro("x"), s.more(3)]);
      assert.deepEqual(bannedIn(everything, l), [], `strings ${l}`);
    }
  }
  // the list itself works: it catches the words it is for, and lets "certificate" and the confirm verbs through
  for (const bad of ["It is safe", "guaranteed results", "certified", "100% sure", "Earn more", "profit", "secure"]) assert.ok(bannedIn(bad, "en").length > 0, bad);
  assert.deepEqual(bannedIn("Go-live certificate. Confirmed bookings. Checks were run by hand.", "en"), []);
  assert.ok(bannedIn("यह सुरक्षित है", "hi").length > 0 && bannedIn("गारंटी", "hi").length > 0 && bannedIn("कमाई", "hi").length > 0);
  assert.ok(bannedIn("സുരക്ഷിതം", "ml").length > 0 && bannedIn("ഗ്യാരണ്ടി", "ml").length > 0 && bannedIn("വരുമാനം", "ml").length > 0);
  assert.ok(bannedIn("ಸುರಕ್ಷಿತ", "kn").length > 0 && bannedIn("ಗ್ಯಾರಂಟಿ", "kn").length > 0 && bannedIn("ಆದಾಯ", "kn").length > 0);
  assert.deepEqual(bannedIn("बुकिंग पक्की हो गई", "hi"), []);
  assert.deepEqual(bannedIn("ബുക്കിംഗ് ഉറപ്പിക്കാൻ", "ml"), []);
  assert.deepEqual(bannedIn("ಬುಕಿಂಗ್ ಖಚಿತಪಡಿಸಲು", "kn"), []);
  assert.ok(Object.keys(BANNED).length === 5);
});

test("every ₹ amount in the output is an amount the record holds", async () => {
  const report = await novemberReport();
  const held = new Set([report.money.deposits.paise, report.money.refunds.paise, report.money.refunds.ofDeposits.paise, report.money.refunds.ofSecondPayments.paise, 0].map((p) => formatInr(p / 100)));
  assert.deepEqual([...held].sort(), ["₹0", "₹1,000", "₹200", "₹5,400", "₹800"].sort());
  for (const language of ALL) {
    for (const l of languagesOf(language)) {
      for (const a of amountsIn(ownerText(report, l))) assert.ok(held.has(a), `${a} in the ${l} owner text`);
      for (const a of amountsIn(words(reportPage(seal(report), l)))) assert.ok(held.has(a), `${a} in the ${l} page`);
    }
  }
  // and the deposits and refunds that the stand-in payments service holds, in rupees, are exactly the ones printed
  const { world } = await runBusyMonth();
  const { from, to } = monthRange("2026-11", settings.timezone);
  const inMonth = (s: number) => s * 1000 >= from && s * 1000 < to;
  const refundedRupees = world.payments.refunds().filter((r) => inMonth(r.created_at)).reduce((n, r) => n + r.amount, 0) / 100;
  assert.ok(ownerText(report, "en").includes(`Given back: ${formatInr(refundedRupees)}`));
});

test("the not-tested and not-counted lists are always on the page, in the shop's words, and the owner text points to them", async () => {
  const report = await novemberReport();
  for (const language of LANGUAGES) {
    const s = STRINGS[language];
    const page = words(reportPage(seal(report), language));
    for (const n of NOT_TESTED) assert.ok(page.includes(s.notTested[n.id]), `${language}: ${n.id}`);
    for (const id of NOT_COUNTED) assert.ok(page.includes(s.notCounted[id]), `${language}: ${id}`);
    assert.ok(page.includes(s.notTested["own-settings"]) === false, "nothing says the checks ran on the example shop");
    assert.ok(page.includes(s.notTested["no-go-live-certificate"]), `${language}: this report was given no go-live certificate, and says so in the list`);
    assert.ok(ownerText(report, language).split("\n")[4].includes(String(report.notTested.length + report.notCounted.length - 2)));
  }
  assert.ok(new Set(Object.keys(STRINGS.en.notTested)).size === NOT_TESTED.length + 5, "the hand check's list, and the five ways the checks on this shop's own settings are or are not shown (test/report-go-live.test.ts)");
});

test("a monthly report that is not told what the go-live checks ran on says so, for Glow Salon and for any other shop; it no longer claims they ran on Glow Salon", async () => {
  const other = parseSettings({ ...JSON.parse(JSON.stringify(settings)), name: "Another Salon", deposit: { amountInr: 100, holdMinutes: 15 } });
  for (const shop of [settings, other]) {
    const r = buildMonthlyReport({ settings: shop, entries: [], bookings: [], ...monthRange("2026-11", settings.timezone), source: "stand-in", madeAt: 0 });
    assert.deepEqual(r.goLive, { status: "none" });
    assert.ok(r.notTested.includes("no-go-live-certificate") && !r.notTested.includes("own-settings") && r.notTested.length === NOT_TESTED.length + 1);
    for (const language of LANGUAGES) {
      const text = words(reportPage(seal(r), language));
      assert.ok(text.includes(STRINGS[language].notTested["no-go-live-certificate"]) && text.includes(STRINGS[language].goLive.none), language);
      assert.ok(!text.includes(STRINGS[language].notTested["own-settings"]));
    }
  }
});

test("every language renders a self-contained page: same numbers, no script, no link, no external file", async () => {
  const report = await novemberReport();
  for (const language of ALL) {
    const html = reportPage(seal(report), language);
    assert.ok(html.startsWith("<!doctype html>") && html.includes('<meta charset="utf-8">') && html.includes("width=device-width") && html.includes(`<html lang="${languagesOf(language)[0]}">`));
    for (const forbidden of ["<script", "<link", "<img", "<iframe", "url(", "@import", "src=", "href="]) assert.ok(!html.includes(forbidden), `${language} page has ${forbidden}`);
    assert.ok(!/https?:|\/\/[a-z]/i.test(html), `${language} page names an address`);
    assert.ok(html.includes("default-src 'none'"), "a content policy forbids everything but its own style");
    for (const l of languagesOf(language)) {
      const s = STRINGS[l];
      assert.ok(html.includes(`<section class="doc" lang="${l}">`));
      assert.ok(html.includes(`<summary>${s.page.showWhatWeDid}</summary>`), `${l}: the "show what we did" section`);
      assert.ok(html.includes(s.label.bookingsMade) && html.includes(report.shop.name) && html.includes(s.page.stoppedHeading));
    }
    assert.ok(html.includes("<details>") && html.includes("Show what we did ▸") === languagesOf(language).includes("en"));
    for (const l of languagesOf(language)) assert.ok(html.includes(STRINGS[l].sourceTag["stand-in"]), `${l}: the source is stated on the page`);
  }
});

test("the page lists each limit, the digests, the entries' fingerprints and the counts by action", async () => {
  const report = await novemberReport();
  const html = reportPage(seal(report), "en");
  for (const id of RULE_IDS) assert.ok(html.includes(`<code>${id}</code>`), id);
  assert.ok(html.includes(report.policyDigest) && html.includes(report.record.digest));
  const some = report.record.rows[100];
  assert.ok(html.includes(some.digest.slice(7, 23)) && html.includes(`<code>${some.action}</code>`));
  assert.ok(html.includes("<code>confirm_booking</code>") && html.includes("Set up by") && html.includes("Divya, local partner"));
  assert.ok(html.includes("/verify/") && html.includes("Not signed"));
  assert.ok(!/\+91\d/.test(html), "no phone number on the page");
});

test("everything typed into the settings is escaped on the page", async () => {
  const hostile = parseSettings({ ...JSON.parse(JSON.stringify(settings)), name: `<script>alert("x")</script> & "Co" '` });
  const r = buildMonthlyReport({ settings: hostile, entries: [], bookings: [], ...monthRange("2026-11", settings.timezone), source: "stand-in", madeAt: 0, preparedBy: "<b>me</b>" });
  const html = reportPage(seal(r), "both");
  assert.ok(!html.includes("<script") && !html.includes("<b>me"));
  assert.ok(html.includes("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &quot;Co&quot; &#39;"));
  assert.ok(html.includes("&lt;b&gt;me&lt;/b&gt;"));
});

test("the source is stated on every layer: stand-in and test mode say so, and the report data carries it", async () => {
  const stand = await novemberReport("stand-in");
  const test_ = await novemberReport("test-mode");
  for (const language of LANGUAGES) {
    assert.ok(ownerText(stand, language).split("\n")[0].includes(STRINGS[language].sourceTag["stand-in"]));
    assert.ok(ownerText(test_, language).split("\n")[0].includes(STRINGS[language].sourceTag["test-mode"]));
    assert.ok(reportPage(seal(stand), language).includes(STRINGS[language].sourceLong["stand-in"]));
  }
  assert.equal(stand.source, "stand-in");
  assert.equal(test_.source, "test-mode");
});

test("every string table is complete in all four languages", () => {
  const keys = (o: object) => Object.keys(o).sort().join(",");
  for (const language of LANGUAGES) {
    const s = STRINGS[language];
    assert.equal(keys(s.label), keys(STRINGS.en.label));
    assert.equal(keys(s.page), keys(STRINGS.en.page));
    assert.equal(keys(s.cert), keys(STRINGS.en.cert));
    assert.equal(keys(s.stop), keys(STRINGS.en.stop));
    assert.equal(keys(s.notTested), keys(STRINGS.en.notTested));
    assert.equal(keys(s.notCounted), keys(STRINGS.en.notCounted));
    assert.equal(keys(s.languageName), LANGUAGES.slice().sort().join(","));
    for (const text of [...Object.values(s.label), ...Object.values(s.page), ...Object.values(s.stop), ...Object.values(s.notTested), ...Object.values(s.notCounted)]) assert.ok(text.trim() !== "");
  }
});

test("a line break typed into a shop's name cannot make a sixth line", () => {
  const odd = parseSettings({ ...JSON.parse(JSON.stringify(settings)), name: "Glow\nSalon\r\n\u2028Kochi" });
  const r = buildMonthlyReport({ settings: odd, entries: [], bookings: [], ...monthRange("2026-11", settings.timezone), source: "live", madeAt: 0, preparedBy: "Divya\nlocal partner" });
  for (const language of LANGUAGES) assert.equal(ownerText(r, language).split(/\r?\n|\u2028/).length, 5);
});
