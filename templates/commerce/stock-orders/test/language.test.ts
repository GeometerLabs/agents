// The messages: every template renders in all four languages, passes the outgoing check against its own facts, and every WhatsApp template body starts and ends with
// fixed words and fills back into the very text.
import { test } from "node:test";
import assert from "node:assert/strict";
import { LANGUAGES } from "../../../../modules/language/languages.ts";
import { checkMessageMatchesRecord } from "../src/limits.ts";
import { META_TEMPLATES, fillBody, metaBody, parametersFor, slotsOf } from "../src/language/meta-templates.ts";
import { TEMPLATES, render } from "../src/language/templates.ts";
import type { TemplateId } from "../src/language/templates.ts";
import { sampleFacts } from "../scripts/review-sheet.ts";

test("every template renders in every language and passes the outgoing check", () => {
  for (const language of LANGUAGES) {
    const facts = sampleFacts(language as "en" | "hi" | "ml" | "kn");
    for (const id of Object.keys(TEMPLATES[language]) as TemplateId[]) {
      const text = render(id, facts);
      const d = checkMessageMatchesRecord({ text, facts });
      assert.equal(d.verdict, "allow", `${language} ${id}: ${d.reason}`);
    }
  }
});

test("a different amount in a message fails the check", () => {
  const facts = sampleFacts("en");
  const d = checkMessageMatchesRecord({ text: render("sent_ok", facts) + " Total ₹9,999.", facts });
  assert.equal(d.verdict, "block");
});

test("the WhatsApp templates start and end with fixed words and fill back into the message", () => {
  for (const t of META_TEMPLATES) for (const language of LANGUAGES) {
    const body = t.bodies[language];
    assert.ok(!/^\{/u.test(body) && !/\}[.\s]*$/u.test(body), `${t.name} ${language} starts or ends with a value`);
    const facts = sampleFacts(language as "en" | "hi" | "ml" | "kn");
    const filled = fillBody(metaBody(body), parametersFor(t, language, facts));
    assert.equal(filled, render(t.usedFor, facts), `${t.name} ${language}`);
    assert.ok(slotsOf(body).length > 0);
  }
});

test("no banned word is in any message", () => {
  const banned = /\b(safe|guaranteed|proves|certified|bot|founder|earn|income)\b|100%/iu;
  for (const language of LANGUAGES) for (const id of Object.keys(TEMPLATES[language]) as TemplateId[]) assert.ok(!banned.test(render(id, sampleFacts(language as "en" | "hi" | "ml" | "kn"))), `${language} ${id}`);
});
