// The Fees block of the shop page (views-fees.ts activityFees): "Collected" is this month's own fees; when old dues were paid the report's `money.oldDues` is shown under it, in the
// report's own word for it (templates/education/fees/report/strings.ts), in each language, and nothing extra is shown when none were paid.
import { test } from "node:test";
import assert from "node:assert/strict";
import { activityFees } from "../views-fees.ts";
import { STRINGS } from "../../../templates/education/fees/report/strings.ts";
import { WORDS } from "../languages.ts";
import { LANGUAGES } from "../../../modules/language/languages.ts";

const report = (oldDues?: { count: number; paise: number }): any => ({
  fees: { opened: 4, paidInFull: 2, partlyPaid: 1, stillOpen: 1, stillToCollect: { count: 2, paise: 300_000 } },
  money: { collected: { count: 3, paise: 360_000 }, givenBack: { count: 0, paise: 0 }, ...(oldDues ? { oldDues } : {}) },
  reminders: { sent: 5 }, stopped: { total: 0 }, owner: { asked: 0, approved: 0, denied: 0 },
});

test("old dues collected are shown under Collected, with the report's own words, only when some were paid", () => {
  for (const language of LANGUAGES) {
    const c = { w: WORDS[language], lang: language } as any;
    const with_ = activityFees(c, report({ count: 1, paise: 100_000 })).lines;
    const label = STRINGS[language].label.oldDuesCollected;
    assert.ok(with_.some((l: string) => l.startsWith(`${label}: `) && l.includes("1,000")), `${language}: ${with_.join(" | ")}`);
    assert.ok(with_.some((l: string) => l.includes("3,600")), "this month's own fees are still shown as Collected");
    assert.equal(activityFees(c, report()).lines.length, with_.length - 1, `${language}: no old-dues line when none were paid`);
  }
});
