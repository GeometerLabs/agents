// The outgoing check's links (modules/language/check.ts): sentence punctuation after a link is not part of it, in every language the templates write. Added 17 Nov 2026,
// when Fees' Hindi family reminder put the danda ("।") straight after its last payment link and the check read "<link>।" as an unknown link, so the reminder was held back.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkText } from "../check.ts";
import type { CheckFacts } from "../check.ts";

const LINK = "https://rzp.io/l/fee-ab12cd";
const facts = (language: CheckFacts["language"]): CheckFacts => ({ language, timeZone: "Asia/Kolkata", amountsInr: [], counts: [], momentsMs: [], links: [LINK], literals: [] });

test("a link followed by the Hindi danda, single or double, is the record's link", () => {
  for (const end of ["।", "॥", "। ", ".", ","]) {
    const r = checkText(`बाकी फीस: ${LINK}${end} STOP लिखें`, facts("hi"));
    assert.equal(r.ok, true, `"${end}" after the link: ${r.problems.join(" ")}`);
  }
});

test("a different link is still refused, with or without the danda", () => {
  for (const text of ["बाकी फीस: https://rzp.io/l/other।", "Open fees: https://rzp.io/l/other."]) {
    const r = checkText(text, facts(text.includes("फीस") ? "hi" : "en"));
    assert.equal(r.ok, false, text);
    assert.match(r.problems.join(" "), /not the payment link in the record/u);
  }
});
