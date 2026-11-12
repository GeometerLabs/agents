// The monthly report as a WhatsApp message (B54): the owner's lines in four languages, the two utility templates that carry the same words outside
// the 24-hour window, the document message the stand-in records, and the badge line that only the Innovator template has.
import { test } from "node:test";
import assert from "node:assert/strict";
import { glowSalon } from "../src/harness.ts";
import { ApiError, WindowClosedError } from "../../../../modules/core/faults.ts";
import { documentBody } from "../../../../modules/messaging/whatsapp.ts";
import { documentProblem } from "../../../../modules/messaging/messaging.ts";
import { fillBody, metaBody } from "../src/language/meta-templates.ts";
import { LANGUAGES } from "../../../../modules/language/languages.ts";
import type { Language } from "../../../../modules/language/languages.ts";
import type { MonthlyReport } from "../report/data.ts";
import { sampleReport } from "../report/review.ts";
import { seal } from "../../../../modules/report/sign.ts";
import { verifyLink } from "../../../../modules/report/verify-link.ts";
import { WHATSAPP_BODY_LIMIT } from "../../../../modules/report/summary-sign.ts";
import { STRINGS } from "../report/strings.ts";
import { bannedIn } from "../../../../modules/report/claims.ts";
import { badgeText } from "../../../../modules/report/text.ts";
import { MONTH_NAMES } from "../../../../modules/language/format.ts";
import { REPORT_SLOTS, REPORT_TEMPLATES, REPORT_TEMPLATE_NAMES, monthlyReportMessage, reportParameters, reportSlotsOf, reportSubmissions, reportValues } from "../report/whatsapp.ts";
import { liveWorld, PHONE_NUMBER_ID } from "./helpers/live-world.ts";

const LINK = "https://reports.example.com/r/3f9a1c7d2b8e4f60/report-2027-02-en.html";
const owner = glowSalon().owner.whatsapp;

/** The sample month (38 bookings, ₹17,600 in deposits, 5 stopped), as a live report made by Divya. */
function report(o: { innovator?: boolean; preparedBy?: string | null } = {}): MonthlyReport {
  return { ...sampleReport(), source: "live", preparedBy: o.preparedBy === undefined ? "Divya, local partner" : o.preparedBy, ...(o.innovator ? { innovator: true as const } : {}) };
}
const sealed = (o: Parameters<typeof report>[0] = {}) => seal(report(o));

test("the message is the owner's lines in every language: counts and amounts from the report, the check code, the page address, the check link, who set it up", () => {
  const env = sealed();
  for (const language of LANGUAGES) {
    const s = STRINGS[language];
    const { text } = monthlyReportMessage(env, language, { link: LINK });
    const lines = text.split("\n");
    assert.equal(lines.length, 9, `${language}: ${lines.length} lines`);
    assert.ok(lines.every((l) => l.trim() !== ""));
    assert.equal(lines[0], `${s.monthlyReport}: Glow Salon · ${MONTH_NAMES[language][1]} 2027`, "no tag for a live report");
    assert.equal(lines[1], `${s.label.bookingsMade}: 38 · ${s.label.depositsCollected}: ₹17,600`);
    assert.equal(lines[2], `${s.label.stoppedByLimits}: 5 (${s.stop["price-at-or-above-list"]}: 3 · ${s.stop["no-double-booking"]}: 1)`);
    assert.equal(lines[3], `${s.label.wasAsked}: 3 · ${s.label.approved}: 2 · ${s.label.saidNo}: 1`);
    assert.equal(lines[4], `${s.label.notConfirmed}: 1`);
    assert.ok(lines[5].startsWith(`${s.label.notChecked}: `) && lines[5].endsWith(s.handRun), lines[5]);
    assert.equal(lines[6], `${s.page.code}: ${env.code} · ${s.fullReport}: ${LINK}`);
    assert.equal(lines[7], `${s.checkGenuine}: ${verifyLink(env)}`, "an unsigned report carries the #digest link (item 17b)");
    assert.equal(lines[8], `${s.page.setUpBy}: Divya, local partner · Geometer`);
    assert.deepEqual(bannedIn(text, language), [], `${language}: a word no document may use`);
    assert.ok(!/found(ing|er)/iu.test(text));
  }
});

test("a report made in test mode or on stand-ins says so in the first line, like the owner text does", () => {
  const { text } = monthlyReportMessage(seal({ ...report(), source: "test-mode" }), "en", { link: LINK });
  assert.equal(text.split("\n")[0], "Monthly report: Glow Salon · Feb 2027 · test mode, test money");
});

test("the Innovator badge is one more line, the last, and only when the report carries the flag", () => {
  for (const language of LANGUAGES) {
    const plain = monthlyReportMessage(sealed(), language, { link: LINK });
    const badged = monthlyReportMessage(sealed({ innovator: true }), language, { link: LINK });
    assert.equal(plain.template.name, "monthly_report");
    assert.equal(badged.template.name, "monthly_report_innovator");
    assert.ok(!plain.text.includes(badgeText(language)), `${language}: no badge by default`);
    const lines = badged.text.split("\n");
    assert.equal(lines.length, 10);
    assert.equal(lines[9], badgeText(language));
    assert.ok(/^★ \S/u.test(lines[9]));
    assert.deepEqual(bannedIn(badged.text, language), []);
  }
  assert.ok(!monthlyReportMessage(sealed({ innovator: false }), "en", { link: LINK }).text.includes("★"));
});

test("a report that names no one who set the agent up is not turned into a message", () => {
  assert.throws(() => monthlyReportMessage(sealed({ preparedBy: null }), "en", { link: LINK }), /who set the agent up/);
  assert.throws(() => monthlyReportMessage(sealed({ preparedBy: "   " }), "en", { link: LINK }), /who set the agent up/);
});

test("a name typed with a line break or a run of spaces is one line in the message (Meta refuses a break in a value)", () => {
  const { text, template } = monthlyReportMessage(sealed({ preparedBy: "Divya\n  Nair,\t   local partner" }), "en", { link: LINK });
  assert.equal(text.split("\n").length, 9);
  assert.ok(text.includes("Set up by: Divya Nair, local partner · Geometer"));
  for (const p of template.parameters!) assert.ok(!/[\n\t\r]| {2}/u.test(p), p);
});

test("the template variables: one value for each {{n}}, in order, and filling the template gives back the plain text, in every language", () => {
  const env = sealed();
  for (const t of REPORT_TEMPLATES) {
    for (const language of LANGUAGES) {
      const message = monthlyReportMessage(seal({ ...report(), ...(t.badge ? { innovator: true as const } : {}), ...(t.upi ? { paidBy: "owner-marked" as const } : {}) }), language, { link: LINK });
      assert.equal(message.template.name, t.name);
      assert.equal(message.template.language, language);
      const slots = reportSlotsOf(t.bodies[language]);
      assert.equal(message.template.parameters!.length, slots.length);
      assert.deepEqual(slots, [...REPORT_SLOTS], `${t.name} (${language}) names every value once, in the order the values come`);
      assert.equal(fillBody(metaBody(t.bodies[language]), message.template.parameters!), message.text, `${t.name} (${language})`);
      assert.equal(message.template.text, message.text);
      const values = reportValues(report(), language, { code: env.code, link: LINK, check: verifyLink(env), builder: "Divya, local partner" });
      assert.deepEqual(reportParameters(t, language, values), slots.map((slot) => values[slot]));
    }
  }
});

test("each report template follows Meta's rules: a lowercase name, numbered values used once, fixed words at both ends, never two values side by side, values with no line break", () => {
  assert.deepEqual([...REPORT_TEMPLATE_NAMES], ["monthly_report", "monthly_report_innovator", "monthly_report_upi", "monthly_report_upi_innovator"]); // the last two: a UPI shop's (B33)
  for (const t of REPORT_TEMPLATES) {
    assert.match(t.name, /^[a-z0-9_]+$/);
    for (const language of LANGUAGES) {
      const body = metaBody(t.bodies[language]);
      const numbers = [...body.matchAll(/\{\{(\d+)\}\}/gu)].map((m) => Number(m[1]));
      assert.deepEqual(numbers, numbers.map((_n, i) => i + 1), `${t.name} (${language}) numbers`);
      assert.equal(numbers.length, REPORT_SLOTS.length);
      assert.ok(!body.startsWith("{{") && !body.endsWith("}}"), `${t.name} (${language}) starts or ends with a value`);
      assert.ok(!/\}\}\s*\{\{/u.test(body), `${t.name} (${language}) has two values side by side`);
      assert.ok(body.length <= 1024, `${t.name} (${language}) is ${body.length} characters`);
      const fixed = body.replace(/\{\{\d+\}\}/gu, "").replace(/\s+/gu, "");
      assert.ok(fixed.length >= 3 * numbers.length * 5, `${t.name} (${language}) has too little fixed wording for its ${numbers.length} values (${fixed.length} letters)`);
    }
  }
});

test("the worst message still fits what WhatsApp takes once the values are in: the longest wording (Malayalam), a 120-character name, a 60-character shop name, big numbers, the stand-in tag and a real 32-digit folder name", () => {
  const base = sampleReport();
  const worst: MonthlyReport = {
    ...base, source: "stand-in", preparedBy: "B".repeat(120), innovator: true, shop: { ...base.shop, name: "N".repeat(60) },
    bookings: { ...base.bookings, made: 99999 }, money: { ...base.money, deposits: { count: 99999, paise: 9_999_999_900 } },
    stopped: { ...base.stopped, total: 99999 }, owner: { asked: 99999, approved: 99999, denied: 99999, retried: 0 }, unconfirmed: { ...base.unconfirmed, openOnBookings: 99999 },
  };
  const link = `https://reports.example.com/r/${"a".repeat(32)}/report-2026-11-en.html`;
  // B75 (12 Nov 2026): refunds people settled by their word go inside the not-confirmed value; one person with a 60-character name, and three people
  const one = [{ by: `operator:${"A".repeat(60)}`, count: 99999, paise: 9_999_999_900 }];
  const three = [...one, { by: `operator:${"R".repeat(60)}`, count: 99999, paise: 9_999_999_900 }, { by: "operator:meena", count: 1, paise: 100 }];
  const months = [worst, { ...worst, money: { ...worst.money, settledByWord: one } }, { ...worst, money: { ...worst.money, settledByWord: three } }];
  const lengths = LANGUAGES.flatMap((language) => months.map((m, i) => [`${language} (${["none", "one person", "three people"][i]})`, [...monthlyReportMessage(seal(m), language, { link }).text].length] as const));
  // The bound is the limit itself since the check line (item 17b) took most of the old 900's headroom. Measured 12 Nov 2026: with nobody settling by their word the
  // worst is 963 in Malayalam with the #digest link; with one person, named, 1010 (Malayalam, #digest link); with three, the names give way first (settledByWordWords),
  // 994 (Hindi, #code link). The longer signed summary link goes in only when the filled message still fits (messageCheckLink; report-summary.test.ts holds that).
  for (const [which, length] of lengths) assert.ok(length <= WHATSAPP_BODY_LIMIT, `${which}: ${length} characters, and the limit WhatsApp checks after the values are in is ${WHATSAPP_BODY_LIMIT}`);
  for (const language of LANGUAGES) assert.match(monthlyReportMessage(seal(months[2]), language, { link }).text, new RegExp(`${STRINGS[language].label.notConfirmed}: 99999 · `, "u"), "the settled words are there, after what is still open");
});

test("the examples Meta reviews are a believable month, one line each, in the template's own language, and the checked-in list holds them", () => {
  const submissions = reportSubmissions();
  assert.equal(submissions.length, REPORT_TEMPLATES.length * LANGUAGES.length);
  for (const entry of submissions) {
    const examples = entry.components[0].example.body_text[0];
    assert.equal(examples.length, REPORT_SLOTS.length);
    assert.equal(entry.category, "UTILITY");
    assert.ok(examples.every((e) => e.trim() === e && e.length > 0 && !/[\n\t]| {4}/u.test(e)), JSON.stringify(examples));
    assert.ok(examples.includes("Divya, Sri Sai Digital") && examples.includes("7K2M-9QXD") && examples.some((e) => e.startsWith("https://")));
  }
  const hindi = submissions.find((e) => e.name === "monthly_report" && e.language === "hi")!;
  assert.ok(hindi.components[0].example.body_text[0][0].includes(`${MONTH_NAMES.hi[1]} 2027`), hindi.components[0].example.body_text[0][0]);
  assert.ok(hindi.components[0].example.body_text[0].includes("₹17,600"));
});

// ---- the stand-in, over HTTP: the template and the document message ----

test("the stand-in takes both report templates in every language, refuses a wrong number of values, and keeps the words the owner would read", async () => {
  const w = await liveWorld();
  try {
    const { messaging } = w.adapters;
    for (const t of REPORT_TEMPLATES) {
      for (const language of LANGUAGES) {
        const message = monthlyReportMessage(seal({ ...report(), ...(t.badge ? { innovator: true as const } : {}), ...(t.upi ? { paidBy: "owner-marked" as const } : {}) }), language, { link: LINK });
        const sent = await messaging.sendTemplate(owner, message.template);
        const kept = w.fakes.messaging.outbox().find((m) => m.id === sent.id)!;
        assert.equal(kept.kind, "template");
        assert.equal(kept.templateName, t.name);
        assert.equal(kept.text, message.text, `${t.name} (${language}): the outbox holds what the owner reads`);
      }
    }
    const message = monthlyReportMessage(sealed(), "en", { link: LINK });
    await assert.rejects(() => messaging.sendTemplate(owner, { ...message.template, parameters: message.template.parameters!.slice(1) }), (e: any) => e instanceof ApiError && e.status === 400);
    // the live adapter turns a line break in a value into a space before it sends; a raw call that keeps one is refused in Meta's words (132018)
    const raw = { messaging_product: "whatsapp", to: owner, type: "template", template: { name: "monthly_report", language: { code: "en" }, components: [{ type: "body", parameters: message.template.parameters!.map((p, i) => ({ type: "text", text: i === 3 ? "two\nlines" : p })) }] } };
    const refused = await fetch(`${w.standins.url}/v26.0/${PHONE_NUMBER_ID}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(raw) });
    assert.equal(refused.status, 400);
    assert.equal(((await refused.json()) as any).error.code, 132018);
    await assert.rejects(() => messaging.sendTemplate(owner, { ...message.template, name: "monthly_report_unregistered" }), (e: any) => e instanceof ApiError && e.status === 404);
  } finally { await w.close(); }
});

test("a document is a session message: the stand-in records the file, and WhatsApp's window rule and link rule hold, over the live adapter", async () => {
  const w = await liveWorld();
  try {
    const { messaging } = w.adapters;
    const doc = { link: "https://reports.example.com/r/3f9a1c7d2b8e4f60/certificate-2027-02-en.txt", filename: "certificate-2027-02-en.txt", caption: "Monthly record certificate · Code: 7K2M-9QXD" };
    await assert.rejects(() => messaging.sendDocument!(owner, doc), WindowClosedError); // the owner has not written
    w.listen(owner, "hi");
    const sent = await messaging.sendDocument!(owner, doc);
    const kept = w.fakes.messaging.outbox().find((m) => m.id === sent.id)!;
    assert.equal(kept.kind, "document");
    assert.deepEqual(kept.document, doc);
    assert.equal(kept.text, doc.caption);
    assert.equal((await messaging.getMessage(sent.id))?.kind, "document");
    assert.deepEqual(documentBody(owner, doc), { messaging_product: "whatsapp", recipient_type: "individual", to: owner, type: "document", document: { link: doc.link, filename: doc.filename, caption: doc.caption } });
    await assert.rejects(() => messaging.sendDocument!(owner, { ...doc, link: "http://reports.example.com/x.txt" }), (e: any) => e instanceof ApiError && e.status === 400);
    assert.equal(w.fakes.messaging.outbox().length, 1, "a document with a bad link never went out");
  } finally { await w.close(); }
});

test("the stand-in refuses a document that has no link or file name, in Meta's words", async () => {
  const w = await liveWorld();
  try {
    w.listen(owner, "hi");
    const reply = await fetch(`${w.standins.url}/v26.0/${PHONE_NUMBER_ID}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messaging_product: "whatsapp", to: owner, type: "document", document: { filename: "x.txt" } }) });
    assert.equal(reply.status, 400);
    assert.equal(((await reply.json()) as any).error.code, 131009);
    assert.equal(w.fakes.messaging.outbox().length, 0);
  } finally { await w.close(); }
});

test("documentProblem: https only, a file name with no slash, a caption of 1 to 1024 characters", () => {
  const ok = { link: "https://a.example/x.txt", filename: "x.txt" };
  assert.equal(documentProblem(ok), null);
  assert.equal(documentProblem({ ...ok, caption: "Hello" }), null);
  assert.match(documentProblem({ ...ok, link: "http://a.example/x.txt" })!, /https/);
  assert.match(documentProblem({ ...ok, link: "https://a.example/a b.txt" })!, /https/);
  assert.match(documentProblem({ ...ok, filename: "a/b.txt" })!, /file name/);
  assert.match(documentProblem({ ...ok, filename: "" })!, /file name/);
  assert.match(documentProblem({ ...ok, caption: "x".repeat(1025) })!, /caption/);
  assert.match(documentProblem({ ...ok, caption: " " })!, /caption/);
});

test("every report string a language needs is there: the badge and the full-report label are in all four", () => {
  for (const language of LANGUAGES as readonly Language[]) {
    assert.ok(STRINGS[language].fullReport.length > 0 && STRINGS[language].innovator.length > 0);
  }
});
