// The review sheets (REVIEW-hi.md, REVIEW-ml.md, REVIEW-kn.md) are what a native speaker reads before a real shop uses a language. They are written by scripts/review-sheet.ts
// from the templates and word lists themselves; these tests fail if a sheet has fallen behind or lost its warning line. Hindi, Malayalam and Kannada are all machine-written.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { reportStringRows, sampleOwnerText } from "../report/review.ts";
import { sampleMessage } from "../report/whatsapp.ts";
import { EXAMPLES, reviewSheet } from "../scripts/review-sheet.ts";
import type { ReviewLanguage } from "../scripts/review-sheet.ts";
import { annapurna } from "../src/harness.ts";
import { LABELS } from "../src/language/interactive.ts";
import { exampleFacts } from "../src/language/meta-templates.ts";
import { TEMPLATES } from "../src/language/templates.ts";
import type { TemplateId } from "../src/language/templates.ts";

const WARNING = "Machine-written. Waiting for a native speaker's review before any real shop sees it.";
const shop = annapurna();

for (const language of ["hi", "ml", "kn"] as const satisfies readonly ReviewLanguage[]) {
  const committed = readFileSync(new URL(`../REVIEW-${language}.md`, import.meta.url), "utf8");

  test(`REVIEW-${language}.md opens with the machine-written warning and has a column for the native reviewer`, () => {
    assert.ok(committed.split("\n").slice(0, 4).join("\n").includes(WARNING));
    assert.ok(committed.includes("Native reviewer: OK / change to …"));
  });

  test(`REVIEW-${language}.md lists every message id, every button label and every sample sentence`, () => {
    for (const id of Object.keys(TEMPLATES[language]) as TemplateId[]) {
      assert.ok(committed.includes(`\`${id}\``), `${id} is not in REVIEW-${language}.md`);
      assert.ok(committed.includes(exampleFacts(shop, language).businessName));
    }
    for (const text of Object.values(LABELS[language])) assert.ok(committed.includes(text), text);
    for (const [sentence] of EXAMPLES[language]) assert.ok(committed.includes(sentence), sentence);
  });

  test(`REVIEW-${language}.md lists every word of the monthly report and the sample owner text`, () => {
    const rows = reportStringRows(language);
    assert.ok(rows.length > 60, "the report strings were found");
    for (const row of rows) assert.ok(committed.includes(`\`${row.id}\``) && committed.includes(row.text), `${row.id} is missing: run  node templates/commerce/orders/scripts/review-sheet.ts ${language} > templates/commerce/orders/REVIEW-${language}.md`);
    assert.ok(committed.includes(sampleOwnerText(language)));
    assert.ok(committed.includes(sampleMessage(language)));
  });

  test(`reviewSheet(${language}) is what is committed, apart from what reviewers fill in`, () => {
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
