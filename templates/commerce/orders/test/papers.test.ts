// The papers (B28 statement, B35 record of one case, B36 identity paper) on a real Orders record: the busy month the report tests use. A customer's statement holds
// their own orders only, and no paper carries a number or a UPI id (the label is what was ordered and when).
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
import { ORDERS_PAPERS, fromGoLive, limitFacts, orderCase } from "../report/papers.ts";

const { world: w } = await runBusyMonth();
const entries = w.record.entries();
const orders = [...w.store.orders.values()];
const cases = orders.map((o) => orderCase(o, w.settings));
const shop = { name: w.settings.name, timeZone: w.settings.timezone };
const paidEntry = entries.find((e) => e.action === "owner_marked_paid" && e.outcome === "confirmed")!;
const paidOrder = orders.find((o) => o.id === paidEntry.booking)!;
const customer = paidOrder.customer;

test("a customer's statement: their own advances and refunds and their totals; nothing about any other customer", () => {
  const s = buildStatement({ template: ORDERS_PAPERS, shop, number: customer, entries, cases, now: at(12, 1, 10), tenant: "annapurna" });
  const mine = orders.filter((o) => o.customer === customer);
  assert.deepEqual(s.person.cases, mine.map((o) => o.id).sort());
  const marked = entries.filter((e) => e.action === "owner_marked_paid" && e.outcome === "confirmed" && mine.some((o) => o.id === e.booking)).reduce((n, e) => n + Number(e.refs.amountPaise), 0);
  assert.equal(s.totals.paidPaise, marked, "the statement's money is the record's own marks");
  const text = JSON.stringify(s) + statementPage(sealStatement({ template: ORDERS_PAPERS, shop, number: customer, entries, cases, now: at(12, 1, 10) }));
  for (const o of orders.filter((x) => x.customer !== customer)) assert.equal(text.includes(`"${o.id}"`) || text.includes(o.customer), false, `${o.id} is another customer's`);
  assert.deepEqual(s.anchor, headOf(entries, "annapurna"));
});

test("the record of one order in every language carries no number, names what it did not check, and has no banned word", () => {
  for (const language of LANGUAGES) {
    const env = sealDisputeRecord({ template: ORDERS_PAPERS, shop, case: orderCase(paidOrder, w.settings), entries, language, now: at(12, 1, 10), tenant: "annapurna" });
    const page = disputePage(env);
    for (const o of orders.filter((x) => x.customer !== customer)) assert.equal(page.includes(o.customer) || envelopeFile(env).includes(o.customer), false, `${language}: another customer ${o.customer}`);
    assert.deepEqual(bannedIn(visibleText(page), language), [], language);
    assert.ok(env.document.notTested.length >= 4);
    assert.ok(env.document.rows.length > 0, "the order's own entries are listed");
  }
  const label = orderCase(paidOrder, w.settings).label("en");
  assert.match(label, /^\d+ × .+, .+ 2026, \d+:\d\d (am|pm)$/, label);
});

test("the identity paper of an Orders shop: its limits in plain words, held N of M, and who widened the refund limit", () => {
  const cert = buildGoLiveCertificate({ settings: w.settings, handCheck: { held: 17, total: 17, checks: 120, failedTitles: [] }, issuedAt: at(11, 1, 10) });
  const { limits, checks } = fromGoLive(cert, "kn");
  assert.equal(limits.length, 9);
  const wider = { ...w.settings, refund: { limitInr: w.settings.refund.limitInr + 200 } };
  const { full, public: pub } = sealIdentity({ template: ORDERS_PAPERS, agentId: newAgentId(new Uint8Array(13).fill(1)), language: "kn", operator: { name: "Arjun", role: "builder" }, shop, limits, checks, entries,
    history: [{ at: "2026-11-01T04:00:00.000Z", by: null, settings: w.settings }, { at: "2026-11-05T04:00:00.000Z", by: { name: "Arjun", role: "builder" }, settings: wider }], limitFacts, now: at(12, 1, 10) });
  assert.equal((full.document.limitChanges as { changes: unknown[] }).changes.length, 1);
  for (const env of [full, pub]) {
    const text = envelopeFile(env) + visibleText(identityPage(env));
    for (const o of orders) assert.equal(text.includes(o.customer), false);
    assert.equal(text.includes("annapurna@okicici"), false);
    assert.deepEqual(bannedIn(text, "kn"), []);
  }
});

test("the limits a change is read against: refund, cancellation window, approval line (0 is the widest) and orders a day, in every language; partial settings give fewer facts", () => {
  for (const language of LANGUAGES) {
    const facts = limitFacts(w.settings, language);
    assert.deepEqual(facts.map((f) => f.key), ["refund-limit", "cancel-window", "approve-over", "max-per-day"], language);
    assert.ok(facts.every((f) => f.label !== "" && f.show !== ""));
  }
  const never = limitFacts({ ...w.settings, owner: { ...w.settings.owner, approveOverInr: 0 } }, "en").find((f) => f.key === "approve-over")!;
  const asks = limitFacts(w.settings, "en").find((f) => f.key === "approve-over")!;
  assert.ok(never.value > asks.value && never.wider === "higher", "never asking is wider than asking above ₹1,000");
  assert.deepEqual(limitFacts({ refund: { limitInr: 300 } }, "en").map((f) => f.key), ["refund-limit"]);
  assert.deepEqual(limitFacts(null, "en"), []);
});
