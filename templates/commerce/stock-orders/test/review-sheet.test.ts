// The review sheets are what a native speaker reads; they are written by scripts/review-sheet.ts from the messages themselves, so they fail here when they fall behind.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { reviewSheet } from "../scripts/review-sheet.ts";
import { LABELS } from "../src/language/labels.ts";
import { TEMPLATES } from "../src/language/templates.ts";
import type { TemplateId } from "../src/language/templates.ts";
import { metaSubmissions } from "../src/language/meta-templates.ts";
import { glowSalon } from "../src/harness.ts";
import { reportSubmissions } from "../report/whatsapp.ts";

const WARNING = "Machine-written. Waiting for a native speaker's review before any real shop sees it.";

for (const language of ["hi", "ml", "kn"] as const) {
  const committed = readFileSync(new URL(`../REVIEW-${language}.md`, import.meta.url), "utf8");
  test(`REVIEW-${language}.md carries the warning, every message id and every label`, () => {
    assert.ok(committed.includes(WARNING));
    for (const id of Object.keys(TEMPLATES[language]) as TemplateId[]) assert.ok(committed.includes(`\`${id}\``), id);
    for (const text of Object.values(LABELS[language])) assert.ok(committed.includes(text), text);
  });
  test(`REVIEW-${language}.md is what the script writes`, () => {
    assert.equal(committed.trimEnd(), reviewSheet(language).trimEnd());
  });
}

test("whatsapp-templates.json is what the script writes", () => {
  const committed = readFileSync(new URL("../whatsapp-templates.json", import.meta.url), "utf8");
  assert.equal(committed.trimEnd(), JSON.stringify([...metaSubmissions(glowSalon()), ...reportSubmissions()], null, 2)); // the same list scripts/whatsapp-templates.ts writes: the shop's messages, then the monthly report's
});
