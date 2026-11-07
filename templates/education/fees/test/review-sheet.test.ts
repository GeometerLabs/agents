// The review sheets (REVIEW-ml.md, REVIEW-kn.md) are what a native speaker reads before a real centre uses a language. They are written by scripts/review-sheet.ts from
// the templates and word lists themselves; these tests fail if a sheet has fallen behind (a template, a word or a sample sentence is missing from it) or lost its
// warning line.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { WORDS } from "../../../../modules/language/words.ts";
import { SAYS } from "../crash-test/says.ts";
import { reportStringRows, sampleOwnerText } from "../report/review.ts";
import { sampleMessage } from "../report/whatsapp.ts";
import { EXAMPLES, reviewSheet } from "../scripts/review-sheet.ts";
import type { ReviewLanguage } from "../scripts/review-sheet.ts";
import { FEE_WORDS } from "../src/adapters/rule-parser.ts";
import { brightTuition } from "../src/harness.ts";
import { LABELS } from "../src/language/interactive.ts";
import { exampleFacts } from "../src/language/meta-templates.ts";
import { TEMPLATES, render } from "../src/language/templates.ts";
import type { TemplateId } from "../src/language/templates.ts";

const WARNING = "Machine-written. Must be reviewed by a native speaker before any real centre sees it.";
const centre = brightTuition();

for (const language of ["ml", "kn"] as const satisfies readonly ReviewLanguage[]) {
  const committed = readFileSync(new URL(`../REVIEW-${language}.md`, import.meta.url), "utf8");

  test(`REVIEW-${language}.md opens with the machine-written warning and has a column for the native reviewer`, () => {
    assert.ok(committed.split("\n").slice(0, 4).join("\n").includes(WARNING));
    assert.ok(committed.includes("Native reviewer: OK / change to …"));
  });

  test(`REVIEW-${language}.md lists every template, as the agent really writes it`, () => {
    for (const id of Object.keys(TEMPLATES[language]) as TemplateId[]) {
      assert.ok(committed.includes(`\`${id}\``), `${id} is not in REVIEW-${language}.md`);
      assert.ok(committed.includes(render(id, exampleFacts(centre, language))), `${id} reads differently now: run  node templates/education/fees/scripts/review-sheet.ts ${language} > templates/education/fees/REVIEW-${language}.md`);
      assert.ok(committed.includes(render(id, exampleFacts(centre, "en"))), `the English meaning of ${id} is missing`);
    }
  });

  test(`REVIEW-${language}.md lists every word on a button, and each fits WhatsApp's limits`, () => {
    for (const [key, text] of Object.entries(LABELS[language])) {
      assert.ok(committed.includes(text), `the ${key} label "${text}" is not in REVIEW-${language}.md`);
      assert.ok([...text].length <= (key === "owner" ? 24 : 20), `${key} "${text}" is longer than WhatsApp allows`);
      assert.ok(!/\d|₹/u.test(text), `${key} "${text}" has a number in it: a label may not carry an amount, a date or a time`);
    }
  });

  test(`REVIEW-${language}.md lists every word the parser knows and every sample sentence`, () => {
    const w = WORDS[language];
    for (const word of [...w.yes, ...w.no, ...w.greeting, ...w.stop, ...w.stopPhrases, ...w.rupee, ...w.overrideTopics, ...w.overrideVerbs, ...w.hints]) {
      assert.ok(committed.includes(word), `"${word}" is missing from REVIEW-${language}.md`);
    }
    // the sheet lists a language's own letters and the Latin letters people type; the Hindi words belong to the Hindi review
    const ownLetters = language === "ml" ? /[\u0D00-\u0D7F]/u : /[\u0C80-\u0CFF]/u;
    for (const word of Object.values(FEE_WORDS).flat().filter((x) => ownLetters.test(x) || /^[\x20-\x7E]+$/u.test(x))) assert.ok(committed.includes(word), `the fee word "${word}" is missing from REVIEW-${language}.md`);
    for (const [sentence] of EXAMPLES[language]) assert.ok(committed.includes(sentence), sentence);
    for (const sentence of Object.values(SAYS[language]).map((say) => (typeof say === "function" ? say(200) : say))) assert.ok(committed.includes(sentence), `the hand check types "${sentence}" but REVIEW-${language}.md does not list it`);
  });

  test(`REVIEW-${language}.md lists every word of the monthly report and the sample owner text`, () => {
    const rows = reportStringRows(language);
    assert.ok(rows.length > 90, "the report strings were found");
    for (const row of rows) {
      assert.ok(committed.includes(`\`${row.id}\``) && committed.includes(row.text), `${row.id} is missing from REVIEW-${language}.md: run  node templates/education/fees/scripts/review-sheet.ts ${language} > templates/education/fees/REVIEW-${language}.md`);
      assert.ok(row.english !== "", `${row.id} has no English meaning`);
    }
    assert.ok(committed.includes(sampleOwnerText(language)));
    assert.ok(committed.includes(sampleMessage(language)), "the WhatsApp message is on the sheet");
    assert.equal(sampleOwnerText(language).split("\n").length, 5);
  });

  test(`reviewSheet(${language}) is what is committed, apart from what reviewers fill in`, () => {
    // Reviewers fill the last column of each row; the generated sheet has it empty, so compare with that column removed.
    const generated = reviewSheet(language).trimEnd().split("\n");
    const lines = committed.trimEnd().split("\n");
    assert.equal(lines.length, generated.length, "the committed sheet has a different number of lines");
    for (let i = 0; i < generated.length; i++) {
      if (!generated[i].startsWith("|")) { assert.equal(lines[i], generated[i], `line ${i + 1}`); continue; }
      const cellsOf = (line: string) => line.split(/(?<!\\)\|/u).slice(1, -1).map((c) => c.trim());
      assert.deepEqual(cellsOf(lines[i]).slice(0, -1), cellsOf(generated[i]).slice(0, -1), `line ${i + 1}`);
    }
  });
}
