// The papers (B28 statement, B35 record of one case, B36 identity paper) on a real Fees record: the busy month the report tests use. A parent's statement
// holds their own fees only, and no paper names a student (the label is the month and the batch).
import { test } from "node:test";
import assert from "node:assert/strict";
import { LANGUAGES } from "../../../../modules/language/languages.ts";
import { headOf } from "../../../../modules/record/ledger.ts";
import { bannedIn } from "../../../../modules/report/claims.ts";
import { envelopeFile } from "../../../../modules/report/sign.ts";
import { disputePage, sealDisputeRecord } from "../../../../modules/papers/dispute.ts";
import { visibleText } from "../../../../modules/papers/common.ts";
import { identityPage, newAgentId, sealIdentity } from "../../../../modules/papers/identity.ts";
import { buildStatement, sealStatement, statementPage } from "../../../../modules/papers/statement.ts";
import { buildGoLiveCertificate } from "../report/certificate.ts";
import { at, runBusyMonth } from "../report/example-month.ts";
import { FEES_PAPERS, feeCase, fromGoLive, limitFacts } from "../report/papers.ts";
import { owedPaise, paidPaise } from "../src/due.ts";

const { world: w } = await runBusyMonth();
const entries = w.record.entries();
const dues = [...w.store.dues.values()];
const cases = dues.map((d) => feeCase(d, w.settings));
const shop = { name: w.settings.name, timeZone: w.settings.timezone };
const paidEntry = entries.find((e) => e.action === "record_payment" && e.outcome === "confirmed")!;
const paidDue = dues.find((d) => d.id === paidEntry.booking)!;
const parent = paidDue.customer;
const names = [...new Set(dues.map((d) => d.studentName))];

test("a parent's statement: their own fee payments, their totals and what is still owed by the record; nothing about any other family", () => {
  const s = buildStatement({ template: FEES_PAPERS, shop, number: parent, entries, cases, now: at(12, 1, 10), tenant: "bright-tuition" });
  const mine = dues.filter((d) => d.customer === parent);
  assert.deepEqual(s.person.cases, mine.map((d) => d.id).sort());
  assert.equal(s.totals.paidPaise, mine.reduce((n, d) => n + paidPaise(d), 0), "the record's payments agree with the fees' own payments");
  assert.equal(s.totals.owedPaise, mine.filter((d) => d.state === "open").reduce((n, d) => n + Math.max(0, owedPaise(d) - paidPaise(d)), 0));
  const text = JSON.stringify(s) + statementPage(sealStatement({ template: FEES_PAPERS, shop, number: parent, entries, cases, now: at(12, 1, 10) }));
  for (const d of dues.filter((x) => x.customer !== parent)) assert.equal(text.includes(`"${d.id}"`) || text.includes(d.customer), false, `${d.id} is another family's`);
  for (const n of names) assert.equal(text.includes(n), false, "no student's name");
  assert.deepEqual(s.anchor, headOf(entries, "bright-tuition"));
});

test("the record of one fee in every language names no student, carries no banned word, and lists what it did not check", () => {
  for (const language of LANGUAGES) {
    const env = sealDisputeRecord({ template: FEES_PAPERS, shop, case: feeCase(paidDue, w.settings), entries, language, now: at(12, 1, 10), tenant: "bright-tuition" });
    const page = disputePage(env);
    for (const n of names) assert.equal(page.includes(n) || envelopeFile(env).includes(n), false, `${language}: ${n}`);
    assert.deepEqual(bannedIn(visibleText(page), language), [], language);
    assert.ok(env.document.notTested.length >= 4);
    assert.ok(env.document.rows.some((x) => x.services.some((s) => s.includes(paidEntry.refs.paymentId))));
  }
});

test("the identity paper of a Fees centre: its limits in plain words, held N of M, and who widened the waiver limit", () => {
  const cert = buildGoLiveCertificate({ settings: w.settings, handCheck: { held: 30, total: 30, checks: 90, failedTitles: [] }, issuedAt: at(11, 1, 10) });
  const { limits, checks } = fromGoLive(cert, "kn");
  const wider = { ...w.settings, waiver: { limitInr: w.settings.waiver.limitInr + 500 } };
  const { full, public: pub } = sealIdentity({ template: FEES_PAPERS, agentId: newAgentId(new Uint8Array(13).fill(1)), language: "kn", operator: { name: "Arjun", role: "builder" }, shop, limits, checks, entries,
    history: [{ at: "2026-11-01T04:00:00.000Z", by: null, settings: w.settings }, { at: "2026-11-05T04:00:00.000Z", by: { name: "Arjun", role: "builder" }, settings: wider }], limitFacts, now: at(12, 1, 10) });
  assert.equal((full.document.limitChanges as { changes: unknown[] }).changes.length, 1);
  for (const env of [full, pub]) {
    const text = envelopeFile(env) + visibleText(identityPage(env));
    for (const n of names) assert.equal(text.includes(n), false);
    for (const d of dues) assert.equal(text.includes(d.customer), false);
    assert.deepEqual(bannedIn(text, "kn"), []);
  }
});
