// "Settled by <who>, by their word" on the Bookings documents (B75; 12 Nov 2026). A refund a person at the server settled as made (Guard's already_done) is never a
// refund made: the report page lists it one row per person, the unconfirmed row it settled says who, and the owner's WhatsApp message says it inside the
// not-confirmed value, so the approved template bodies do not change. Hindi, Malayalam and Kannada are machine-written. Written 12 Nov 2026, not run yet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { LANGUAGES } from "../../../../modules/language/languages.ts";
import { seal } from "../../../../modules/report/sign.ts";
import { SETTLED_BY_SOMEONE, SETTLED_BY_WORD } from "../../../../modules/report/text.ts";
import type { MonthlyReport } from "../report/data.ts";
import { reportSection } from "../report/html.ts";
import { sampleReport } from "../report/review.ts";
import { REPORT_TEMPLATES, monthlyReportMessage } from "../report/whatsapp.ts";

const LINK = "https://reports.example.com/r/3f9a1c7d2b8e4f60/report-2027-02-en.html";

/** The sample month with one refund settled by Ravi's word: in the money, and on the unconfirmed row it settled. */
function settledMonth(): MonthlyReport {
  const base = sampleReport();
  return {
    ...base, source: "live", preparedBy: "Divya, Sri Sai Digital",
    money: { ...base.money, settledByWord: [{ by: "operator:ravi", count: 1, paise: 20_000 }] },
    unconfirmed: { ...base.unconfirmed, settledLater: 1, rows: [...base.unconfirmed.rows, { seq: 12, action: "refund", outcome: "unconfirmed", booking: "b-4", settledLater: true, settledByWord: "operator:ravi" }] },
  };
}

test("the report page: one money row per person, 'Settled by ravi, by their word', and the unconfirmed row it settled says the same instead of 'Settled by a later step'", () => {
  const html = reportSection(seal(settledMonth()), "en");
  assert.match(html, /<td>Settled by ravi, by their word<\/td><td[^>]*><strong>1<\/strong><\/td><td[^>]*><strong>₹200<\/strong><\/td>/u);
  assert.ok(!html.includes("operator:ravi"), "who, as a person reads it: the id without Guard's operator: prefix");
  const row = html.split("<tr>").find((r) => r.includes("<code>refund</code>") && r.includes("b-4")) ?? "";
  assert.match(row, /Settled by ravi, by their word/u);
  assert.ok(!row.includes("Settled by a later step"));
  for (const language of LANGUAGES) assert.ok(reportSection(seal(settledMonth()), language).includes(SETTLED_BY_WORD[language]("ravi")), language);
  // a month with none has neither
  assert.ok(!reportSection(seal(sampleReport()), "en").includes("by their word"));
});

test("the owner's WhatsApp message says who settled what by their word, in the not-confirmed line, in every language and template; a month with none is as before", () => {
  for (const t of REPORT_TEMPLATES.filter((x) => !x.upi)) {
    for (const language of LANGUAGES) {
      const r = { ...settledMonth(), ...(t.badge ? { innovator: true as const } : {}) };
      const m = monthlyReportMessage(seal(r), language, { link: LINK });
      assert.equal(m.template.name, t.name, "the same approved template: no new body");
      assert.ok(m.text.includes(`${SETTLED_BY_WORD[language]("ravi")}: 1 (₹200)`), `${t.name} (${language}): ${m.text}`);
      assert.equal(m.template.text, m.text);
      const plain = monthlyReportMessage(seal({ ...sampleReport(), source: "live" as const, preparedBy: "Divya, Sri Sai Digital", ...(t.badge ? { innovator: true as const } : {}) }), language, { link: LINK });
      assert.ok(!plain.text.includes(SETTLED_BY_SOMEONE[language]) && !plain.text.includes(SETTLED_BY_WORD[language]("ravi")), "nothing added when nobody settled anything");
    }
  }
});
