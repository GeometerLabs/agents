import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { LANGUAGES } from "../../language/languages.ts";
import type { Language } from "../../language/languages.ts";
import type { RecordEntry } from "../../record/record.ts";
import { headOf, ledgerEntries } from "../../record/ledger.ts";
import { bannedIn } from "../../report/claims.ts";
import { envelopeFile, verifyEnvelopeText } from "../../report/sign.ts";
import type { PaperCase, TemplatePapers } from "../common.ts";
import { isPerson, visibleText } from "../common.ts";
import { personLabel } from "../../record/fingerprint.ts";
import { buildDisputeRecord, disputePage, disputeText, sealDisputeRecord } from "../dispute.ts";
import { AGENT_ID, CHOOSABLE, identityPage, newAgentId, sealIdentity, widenedLimits } from "../identity.ts";
import type { LimitFact } from "../identity.ts";
import { buildStatement, sealStatement, statementPage, statementText } from "../statement.ts";
import { REVIEW_STATUS, WORDS } from "../words.ts";

const A = "+919800000001";
const B = "+919800000002";
const OWNER = "+919800009999";
const t0 = Date.UTC(2026, 10, 3, 4, 30);
const shop = { name: "Glow Salon", timeZone: "Asia/Kolkata" };
const TOY: TemplatePapers = { pathway: { name: "bookings", version: "0.1.0" }, paidActions: ["record_deposit"], refundActions: ["refund"], actionWords: { en: { hold_slot: "time held" }, hi: {}, ml: {}, kn: {} } };

let seq = 0;
const e = (conversation: string, booking: string | null, action: string, outcome: RecordEntry["outcome"], refs: Record<string, string> = {}, decisions: RecordEntry["decisions"] = []): RecordEntry =>
  ({ seq: ++seq, time: new Date(t0 + seq * 60_000).toISOString(), conversation, booking, action, inputsDigest: "0123456789abcdef", outcome, decisions, language: "hi", notes: `note ${seq}`, refs });
const RECORD: RecordEntry[] = [
  e(A, "b-1", "receive_message", "confirmed", { messageId: "in-1" }),
  e(A, "b-1", "hold_slot", "confirmed", { eventId: "ev_1" }),
  e(A, "b-1", "create_deposit_link", "confirmed", { linkId: "plink_1", amountPaise: "50000" }),
  e(B, "b-2", "record_deposit", "confirmed", { paymentId: "pay_2", amountPaise: "40000" }),
  e(A, "b-1", "record_deposit", "confirmed", { paymentId: "pay_1", amountPaise: "50000" }),
  e(A, "b-1", "record_deposit", "confirmed", { paymentId: "pay_1", amountPaise: "50000" }), // the same payment read twice: counted once
  e(A, "b-1", "refund", "held_for_owner", { paymentId: "pay_1", amountPaise: "30000", approval: "appr_1" }, [{ ruleId: "refund-limit", verdict: "hold_for_owner", reason: "above the ₹200 limit" }]),
  e(OWNER, "b-1", "owner_decision", "confirmed", { command: "approve", to: "owner" }),
  e(A, "b-1", "refund", "confirmed", { refundId: "rf_1", paymentId: "pay_1", amountPaise: "30000" }),
  e(B, "b-3", "owner_marked_paid", "confirmed", { paymentId: "upi_1", requestId: "req_3", amountPaise: "25000", markedBy: "owner" }),
  e(B, "b-2", "send_message", "blocked", { to: "customer" }, [{ ruleId: "price-at-or-above-list", verdict: "block", reason: "a price below the list" }]),
];
const caseOf = (id: string, customer: string, language: Language = "hi"): PaperCase => ({ id, customer, language, state: "confirmed", label: (l) => `Haircut (${l}) ${id}` });
const CASES = [caseOf("b-1", A), caseOf("b-2", B, "kn"), caseOf("b-3", B, "kn")];
/** The same record and cases as the bundle's export writes them: numbers as the shop's keyed fingerprints, notes scrubbed. */
const PERSON_KEY = Buffer.alloc(32, 7);
const EXPORTED = RECORD.map((x) => ({ ...x, conversation: personLabel(PERSON_KEY, "c", x.conversation), notes: "scrubbed" }));
const EXPORTED_CASES = CASES.map((c) => ({ ...c, customer: personLabel(PERSON_KEY, "p", c.customer) }));
const { privateKey } = generateKeyPairSync("ed25519");

test("a statement holds this person's own payments and refunds, once each, and their own totals; nothing of anyone else", () => {
  const s = buildStatement({ template: TOY, shop, number: A, entries: RECORD, cases: CASES, now: t0 + 86_400_000, tenant: "glow-salon" });
  assert.equal(s.language, "hi", "the person's own language");
  assert.deepEqual(s.items.map((i) => [i.kind, i.amountPaise, i.ref, i.by]), [["paid", 50000, "pay_1", "provider"], ["refunded", 30000, "rf_1", "provider"]]);
  assert.deepEqual(s.totals, { paidPaise: 50000, refundedPaise: 30000, netPaise: 20000 });
  assert.deepEqual(s.person, { number: "…0001", cases: ["b-1"] });
  const text = JSON.stringify(s);
  for (const other of ["b-2", "b-3", "pay_2", "upi_1", "40000", "25000", B, A, "9800000002"]) assert.equal(text.includes(other), false, `${other} must not be in A's statement`);
  assert.ok(s.notTested.includes(WORDS.hi.not.others));
  assert.deepEqual(s.anchor, headOf(RECORD, "glow-salon"));
});

test("the same statement comes out of the bundle's export (hashed numbers, scrubbed notes), and the ledger head is the same", () => {
  const raw = buildStatement({ template: TOY, shop, number: B, entries: RECORD, cases: CASES, now: t0, tenant: "glow-salon" });
  const fromExport = buildStatement({ template: TOY, shop, number: B, entries: EXPORTED, cases: EXPORTED_CASES, personKey: PERSON_KEY, now: t0, tenant: "glow-salon" });
  assert.deepEqual(fromExport, raw);
  assert.equal(raw.language, "kn");
  assert.deepEqual(raw.items.map((i) => [i.kind, i.by]), [["paid", "provider"], ["paid", "owner-marked"]]);
  assert.ok(raw.notTested.includes(WORDS.kn.not.upi), "a UPI amount says it was marked by the owner, and the paper says what that does not show");
  assert.equal(headOf(EXPORTED, "glow-salon")!.head, headOf(RECORD, "glow-salon")!.head);
  assert.ok(isPerson(personLabel(PERSON_KEY, "p", B), B, PERSON_KEY) && isPerson(B, B) && !isPerson(personLabel(PERSON_KEY, "p", A), B, PERSON_KEY));
  assert.ok(!isPerson(personLabel(PERSON_KEY, "p", B), B), "without the key a fingerprint in an export matches nobody");
  assert.ok(!isPerson(personLabel(Buffer.alloc(32, 8), "p", B), B, PERSON_KEY), "another shop's key gives another fingerprint");
});

test("a number with nothing recorded gets a statement that says so, not someone else's", () => {
  const s = buildStatement({ template: TOY, shop, number: "+919811111111", entries: RECORD, cases: CASES, now: t0 });
  assert.deepEqual(s.items, []);
  assert.equal(s.anchor, null);
  assert.ok(s.notTested.includes(WORDS.en.not.noLedger));
  assert.match(statementText(sealStatement({ template: TOY, shop, number: "+919811111111", entries: RECORD, cases: CASES, now: t0 })), new RegExp(WORDS.en.statement.none));
});

test("the record of one case puts the customer, the agent, the limits and Guard, the owner and the services side by side, each row tied to its ledger hash", () => {
  const r = buildDisputeRecord({ template: TOY, shop, case: CASES[0], entries: RECORD, language: "en", now: t0, tenant: "glow-salon" });
  const ledger = ledgerEntries(RECORD, "glow-salon");
  assert.deepEqual(r.rows.map((x) => x.seq), [1, 2, 3, 5, 6, 7, 8, 9], "only this case's entries");
  for (const row of r.rows) assert.equal(row.ledgerHash, ledger[row.seq - 1].hash);
  const col = (k: "customer" | "agent" | "limits" | "owner" | "services") => r.rows.flatMap((x) => x[k]).join(" | ");
  assert.match(col("customer"), /its words are not kept/);
  assert.match(col("agent"), /time held: done/);
  assert.match(col("limits"), /refund-limit: held for the owner, above the ₹200 limit/);
  assert.match(col("limits"), /Guard held it for the owner \(approval appr_1\)/);
  assert.match(col("owner"), /owner answered approve/);
  assert.match(col("services"), /calendar's own record showed ev_1/);
  assert.match(col("services"), /payments service's own record showed rf_1, pay_1 \(₹300\)/);
  assert.equal(r.notTested[0], WORDS.en.not.whoIsRight);
  assert.ok(r.notTested.includes(WORDS.en.not.guardLog) && r.notTested.includes(WORDS.en.not.providers) && r.notTested.includes(WORDS.en.not.words));
  assert.equal(r.case.customer, A, "the customer as the record keeps it");
  const fromExport = buildDisputeRecord({ template: TOY, shop, case: EXPORTED_CASES[0], entries: EXPORTED, language: "en", now: t0, tenant: "glow-salon" });
  assert.equal(fromExport.case.customer, personLabel(PERSON_KEY, "p", A), "the fingerprint where the export holds one");
  assert.deepEqual(fromExport.rows, r.rows);
});

test("the record of a UPI case says marked paid by owner and that no payment service has a record of it", () => {
  const r = buildDisputeRecord({ template: TOY, shop, case: CASES[2], entries: RECORD, language: "en", now: t0 });
  assert.match(r.rows[0].owner.join(" "), /owner marked the payment received \(no payment service record\) \(₹250\)/);
  assert.deepEqual(r.rows[0].services, []);
  assert.ok(r.notTested.includes(WORDS.en.not.upi));
});

test("no paper decides who is right, grades or promises: no such field, and no such word in any language", () => {
  const verdictWords = /\b(fault|guilty|liable|liability|to blame|wins?|loses?|in the right|wrong|score|grade|rank|rating|level|trust ?score)\b/i;
  for (const language of LANGUAGES) {
    const dispute = sealDisputeRecord({ template: TOY, shop, case: CASES[0], entries: RECORD, language, now: t0, tenant: "glow-salon" }, privateKey);
    const statement = sealStatement({ template: TOY, shop, number: A, entries: RECORD, cases: CASES, language, now: t0 }, privateKey);
    const identity = sealIdentity(identityInput({ language, show: [...CHOOSABLE] }), privateKey);
    const texts = [visibleText(disputePage(dispute)), disputeText(dispute), visibleText(statementPage(statement)), statementText(statement), visibleText(identityPage(identity.full)), visibleText(identityPage(identity.public)), JSON.stringify(WORDS[language])];
    for (const t of texts) {
      assert.deepEqual(bannedIn(t, language), [], `${language}: ${bannedIn(t, language)}`);
      if (language === "en") assert.equal(verdictWords.test(t.replace(/does not decide who is right|who is right\. This paper/giu, "")), false, t.match(verdictWords)?.[0]);
    }
    const keys = JSON.stringify([dispute.document, identity.full.document].map((d) => Object.keys(d)));
    assert.equal(/verdict|winner|fault|score|grade|rank|rating|level/i.test(keys), false, keys);
  }
});

const historyFacts = (settings: unknown, language: Language): LimitFact[] => {
  const s = settings as { refund: number; window: number };
  return [{ key: "refund", label: `refund (${language})`, value: s.refund, wider: "higher", show: `₹${s.refund}` }, { key: "window", label: "window", value: s.window, wider: "lower", show: `${s.window} h` }];
};
function identityInput(o: { language?: Language; show?: (typeof CHOOSABLE)[number][] } = {}) {
  return {
    template: TOY, agentId: newAgentId(new Uint8Array(13).fill(7)), language: o.language ?? "en", operator: { name: "Divya", role: "partner" }, shop,
    limits: ["Never below the list price", "Refunds up to ₹200 alone"], checks: { held: 38, total: 38, on: { year: 2026, month: 11, day: 2 }, notTested: ["real WhatsApp delivery"] },
    entries: RECORD, now: t0 + 3_600_000, tenant: "glow-salon", limitFacts: historyFacts, published: { day: "2026-11-03", seq: 9, head: ledgerEntries(RECORD, "glow-salon")[8].hash },
    history: [
      { at: "2026-11-01T05:00:00.000Z", by: { name: "Divya", role: "partner" }, settings: { refund: 200, window: 24 } },
      { at: "2026-11-02T05:00:00.000Z", by: { name: "Divya", role: "partner" }, settings: { refund: 150, window: 24 } }, // narrower: not listed
      { at: "2026-11-03T05:00:00.000Z", by: { name: "Arjun", role: "builder" }, settings: { refund: 500, window: 12 } }, // both wider
    ],
    ...(o.show ? { show: o.show } : {}),
  };
}

test("the identity paper: a stable id, facts and counts, who widened which limit and when, and only the fields the operator chose in the public paper", () => {
  const { full, public: pub } = sealIdentity(identityInput(), privateKey);
  assert.match(full.document.agent.id, AGENT_ID);
  assert.deepEqual(full.document.live, { since: RECORD[0].time, entries: 11, payments: 3, refunds: 1, stopped: 1, heldForOwner: 1 });
  assert.deepEqual((full.document.limitChanges as { changes: unknown[] }).changes, [
    { at: "2026-11-03T05:00:00.000Z", by: "Arjun (builder)", what: "refund (en): ₹150 → ₹500" },
    { at: "2026-11-03T05:00:00.000Z", by: "Arjun (builder)", what: "window: 24 h → 12 h" },
  ]);
  assert.deepEqual(pub.document.shown, ["limits", "checks", "limitChanges"], "by default the facts about the agent, not the business");
  for (const f of ["operator", "shop", "live", "ledger"] as const) assert.deepEqual(pub.document[f], { shown: false });
  assert.equal(pub.document.anchor, null, "the anchor names the record's length: kept back with the ledger");
  assert.match(identityPage(pub), new RegExp(WORDS.en.identity.hidden));
  for (const env of [full, pub]) {
    const text = envelopeFile(env);
    for (const number of [A, B, OWNER, "9800000001"]) assert.equal(text.includes(number), false);
    assert.equal(verifyEnvelopeText(text).unchanged, true);
  }
  assert.deepEqual(widenedLimits({ history: [], limitFacts: historyFacts, language: "en" }), []);
  const none = sealIdentity({ ...identityInput(), history: [] }).full.document;
  assert.ok(none.notTested.includes(WORDS.en.identity.noHistory), "no history is said, never read as no change");
});

test("agent ids are random, stable in form, and never made from the shop", () => {
  const a = newAgentId(randomBytes(13));
  assert.match(a, AGENT_ID);
  assert.notEqual(a, newAgentId(randomBytes(13)));
  assert.throws(() => newAgentId(new Uint8Array(4)));
});

test("Hindi, Malayalam and Kannada words are marked machine-written and waiting for native review, and every language has every word", () => {
  for (const l of ["hi", "ml", "kn"] as const) assert.equal(REVIEW_STATUS[l], "machine-written, waiting for native review");
  const shape = (o: unknown): unknown => (typeof o === "object" && o !== null ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, shape(v)]).sort()) : typeof o);
  for (const l of LANGUAGES) assert.deepEqual(shape(WORDS[l]), shape(WORDS.en), l);
  const page = statementPage(sealStatement({ template: TOY, shop, number: A, entries: RECORD, cases: CASES, now: t0 }));
  assert.match(page, new RegExp(WORDS.hi.common.draft), "a machine-written language says so on the page");
  // the shared seal block: the QR of the full link, the link itself, and the short path in the text
  const sealed = sealStatement({ template: TOY, shop, number: A, entries: RECORD, cases: CASES, now: t0, tenant: "glow-salon" }, privateKey);
  const html = statementPage(sealed);
  assert.ok(html.includes("<svg") && html.includes(`https://geometer.dev/verify/#${sealed.digest}`), "the QR and the link to the full digest");
  assert.ok(html.includes("glow-salon #"), "the ledger anchor as a row of the seal");
  assert.ok(statementText(sealed).includes(`/verify/#${sealed.code}`));
  const record = sealDisputeRecord({ template: TOY, shop, case: CASES[0], entries: RECORD, language: "kn", now: t0 }, privateKey);
  assert.ok(disputePage(record).includes(`https://geometer.dev/verify/#${record.digest}`) && disputeText(record).includes(`/verify/#${record.code}`));
  const ids = sealIdentity(identityInput(), privateKey);
  assert.ok(identityPage(ids.public).includes(`https://geometer.dev/verify/#${ids.public.digest}`));
});

// ---- the site's own checker (public-web/src/shopPaper/check.ts), when that repository is beside this one --------------------------------
const ROOT = new URL("../../../", import.meta.url).pathname;
const SITE = [process.env.GEOMETER_PUBLIC_WEB, join(ROOT, "..", "public-web"), join(ROOT, "..", "..", "..", "..", "public-web")].filter((x): x is string => !!x).find((c) => existsSync(join(c, "src", "shopPaper", "check.ts")));
test("the site's checker reads every paper as unchanged and signed, and lists what each paper says it did not check", { skip: SITE ? false : "public-web is not beside this repository (set GEOMETER_PUBLIC_WEB)" }, async () => {
  const site = await import(join(SITE as string, "src", "shopPaper", "check.ts"));
  const identity = sealIdentity(identityInput(), privateKey);
  const papers = [
    sealStatement({ template: TOY, shop, number: A, entries: RECORD, cases: CASES, now: t0, tenant: "glow-salon" }, privateKey),
    sealDisputeRecord({ template: TOY, shop, case: CASES[0], entries: RECORD, language: "ml", now: t0, tenant: "glow-salon" }, privateKey),
    identity.full, identity.public,
  ];
  for (const env of papers) {
    const result = await site.checkPaperText(envelopeFile(env));
    assert.equal(result.verdict, "unchanged-signed", result.summary);
    assert.deepEqual(result.paperNotTested, env.document.notTested);
    const changed = await site.checkPaperText(envelopeFile(env).replace("\"notTested\":[\"", "\"notTested\":[\"x"));
    assert.equal(changed.verdict, "changed");
  }
});
