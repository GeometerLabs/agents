// Orders's monthly report and its books summary: the report data carries it (left out when the record has no money), the page shows the "Money this month" block in four
// languages without a banned word, and the open check (modules/accounting/check.ts) agrees with the report on the example month's evidence pack, fails when one money line's
// amount in the pack is changed (naming the account) and fails when the pack stops before the report's record head.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { LANGUAGES } from "../../../../modules/language/languages.ts";
import { checkAccounting, renderCheck } from "../../../../modules/accounting/check.ts";
import { MONEY_BLOCK_WORDS } from "../../../../modules/accounting/report-block.ts";
import { cutShort, packOf, withChangedAmount } from "../../../../modules/accounting/test/pack-helpers.ts";
import { bannedIn } from "../../../../modules/report/claims.ts";
import { monthRange } from "../../../../modules/report/months.ts";
import { seal } from "../../../../modules/report/sign.ts";
import type { RecordEntry } from "../../../../modules/record/record.ts";
import { buildOrdersReport } from "../report/data.ts";
import { at, runBusyMonth } from "../report/example-month.ts";
import { reportSection } from "../report/html.ts";
import { STRINGS } from "../report/strings.ts";
import type { World } from "../src/harness.ts";

const TENANT = "example-shop";
let month: World;
test.before(async () => { month = (await runBusyMonth()).world; });

const build = (entries: readonly RecordEntry[], ledger = true) =>
  buildOrdersReport({ settings: month.settings, entries, orders: [...month.store.orders.values()], ...monthRange("2026-11", month.settings.timezone), source: "stand-in", madeAt: at(12, 1, 10), ...(ledger ? { ledger: { tenant: TENANT } } : {}) });

test("the report carries the books summary and the legacy map, and leaves them out of a record with no money", () => {
  const r = build(month.record.entries());
  assert.ok(r.accounting, "the example month has money");
  assert.ok(r.accounting.summary.accounts.length > 0 && Array.isArray(r.accounting.legacy.received));
  assert.equal(JSON.stringify(r.accounting).includes("+91"), false, "no phone number");
  assert.equal("accounting" in build([], false), false, "left out, so a report made without money keeps its bytes");
});

test("the page shows Money this month in four languages, in the words of strings.ts, with no banned word", () => {
  const key = generateKeyPairSync("ed25519").privateKey;
  const envelope = seal(build(month.record.entries()), key);
  for (const language of LANGUAGES) {
    const html = reportSection(envelope as never, language);
    const s = STRINGS[language].moneyBlock;
    assert.equal(s, MONEY_BLOCK_WORDS[language]);
    assert.ok(html.includes(s.heading) && html.includes(s.received) && html.includes(s.givenBack) && html.includes(s.owedBack), language);
    assert.deepEqual(bannedIn([s.heading, s.received, s.givenBack, s.kept, s.owedBack, s.toCome].join(" "), language), []);
    assert.equal(html.includes(s.toCome), false, "only Fees shows what is still to come");
  }
  assert.equal(reportSection(seal(build([], false), key) as never, "en").includes(MONEY_BLOCK_WORDS.en.heading), false, "no block without a summary");
});

test("the open check agrees with the report on the evidence pack, fails when one amount is changed, and fails when the pack is cut short", () => {
  const entries = month.record.entries();
  const report = JSON.parse(JSON.stringify({ document: build(entries) }));
  const pack = packOf(entries, TENANT);
  const ok = checkAccounting(pack, report);
  assert.equal(ok.ok, true, renderCheck(ok));
  const changed = checkAccounting(withChangedAmount(pack), report);
  assert.equal(changed.ok, false);
  assert.match(renderCheck(changed), /DIFFERENT: Account "[a-z_:]+"/);
  const short = checkAccounting(cutShort(pack, pack.entries.length - 3), report);
  assert.equal(short.ok, false);
  assert.match(renderCheck(short), /cut short/);
});
