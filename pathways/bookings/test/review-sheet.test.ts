// The review sheets (REVIEW-ml.md, REVIEW-kn.md) are what a native speaker reads before a real shop uses a language.
// They are written by scripts/review-sheet.ts from the templates and word lists themselves; these tests fail if a sheet
// has fallen behind (a template, a word or a sample sentence is missing from it) or lost its warning line.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SAYS } from "../crash-test/situations.ts";
import { EXAMPLES, reviewSheet, sampleFacts } from "../scripts/review-sheet.ts";
import type { ReviewLanguage } from "../scripts/review-sheet.ts";
import { TEMPLATES, render } from "../src/language/templates.ts";
import type { TemplateId } from "../src/language/templates.ts";
import { WORDS } from "../src/language/words.ts";

const WARNING = "Machine-written. Must be reviewed by a native speaker before any real shop sees it.";

for (const language of ["ml", "kn"] as const satisfies readonly ReviewLanguage[]) {
  const committed = readFileSync(new URL(`../REVIEW-${language}.md`, import.meta.url), "utf8");

  test(`REVIEW-${language}.md opens with the machine-written warning and has a column for the native reviewer`, () => {
    assert.ok(committed.split("\n").slice(0, 4).join("\n").includes(WARNING));
    assert.ok(committed.includes("Native reviewer: OK / change to …"));
  });

  test(`REVIEW-${language}.md lists every template, as the agent really writes it`, () => {
    for (const id of Object.keys(TEMPLATES[language]) as TemplateId[]) {
      assert.ok(committed.includes(`\`${id}\``), `${id} is not in REVIEW-${language}.md`);
      assert.ok(committed.includes(render(id, sampleFacts(language, id))), `${id} reads differently now: run  node pathways/bookings/scripts/review-sheet.ts ${language} > pathways/bookings/REVIEW-${language}.md  (and keep any reviewer notes)`);
      assert.ok(committed.includes(render(id, sampleFacts("en", id))), `the English meaning of ${id} is missing`);
    }
  });

  test(`REVIEW-${language}.md lists every word the parser knows and every sample sentence`, () => {
    const w = WORDS[language];
    for (const word of [...w.today, ...w.tomorrow, ...w.dayAfterTomorrow, ...w.yesterday, ...w.weekdays.flat(), ...w.next, ...w.thisWeek, ...w.months.flat(), ...w.morning, ...w.afternoon, ...w.evening, ...w.night,
      ...w.greetingsWithTime, ...w.oclock, ...w.yes, ...w.no, ...w.greeting, ...w.book, ...w.cancel, ...w.reschedule, ...w.stop, ...w.stopPhrases, ...w.free, ...w.rupee, ...w.overrideTopics, ...w.overrideVerbs, ...w.hints]) {
      assert.ok(committed.includes(word), `"${word}" is missing from REVIEW-${language}.md`);
    }
    for (const [sentence] of EXAMPLES[language]) assert.ok(committed.includes(sentence), sentence);
    for (const sentence of Object.values(SAYS[language])) assert.ok(committed.includes(sentence), `the hand check types "${sentence}" but REVIEW-${language}.md does not list it`);
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
