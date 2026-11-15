// The books summary of a period (summary.ts), the "Money this month" words (report-block.ts) and the open check (check.ts), on a record built the way export.test.ts builds
// one. The summary per account must equal `balances()` over the same period; the check must pass on a pack made from the record and fail, naming the account, when one money
// line's amount in the pack is changed; a pack cut short before the report's anchor must fail; and the words must pass the claims check in four languages.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateKeyPairSync } from "node:crypto";
import { fakeClock } from "../../core/clock.ts";
import { zonedToMs } from "../../core/time.ts";
import { LANGUAGES } from "../../language/languages.ts";
import { createRecord } from "../../record/record.ts";
import type { ActionRecord, Outcome } from "../../record/record.ts";
import { evidencePack, headOf, ledgerEntries } from "../../record/ledger.ts";
import { bannedIn } from "../../report/claims.ts";
import { balances, journal } from "../journal.ts";
import type { LegacyMap } from "../journal.ts";
import { RESTORE_DOC_GAP } from "../numbers.ts";
import { createAccounting } from "../post.ts";
import type { MoneyEvent } from "../post.ts";
import { accountingSummary, reportAccounting } from "../summary.ts";
import { MONEY_BLOCK_WORDS, moneyBlock } from "../report-block.ts";
import { BadInput, checkAccounting, renderCheck } from "../check.ts";
import { esc } from "../../report/page.ts";

const TZ = "Asia/Kolkata";
const at = (month: number, day: number, hour: number, year = 2026) => zonedToMs({ year, month, day }, { hour, minute: 0 }, TZ);
const LEGACY: LegacyMap = { received: [{ action: "record_deposit", outcome: "confirmed", for: "advance" }] };
const FROM = new Date(at(11, 1, 0)).toISOString();
const TO = new Date(at(12, 1, 0)).toISOString();

function world() {
  const clock = fakeClock(at(10, 28, 11));
  const record = createRecord(clock);
  const acc = createAccounting({ record, shop: { timezone: TZ }, legacy: LEGACY, clock });
  const post = (event: MoneyEvent, action: string, outcome: Outcome = "confirmed") =>
    acc.post(event, (refs) => record.append({ conversation: "+919800000001", booking: "case" in event ? event.case : null, action, inputs: {}, outcome, language: "en", notes: "a private note", refs }));
  return { clock, record: record as ActionRecord, post };
}
const gw = (c: string, id: string, amountPaise: number): MoneyEvent => ({ kind: "received", case: c, paymentId: id, amountPaise, method: "gateway", evidence: "provider", for: "advance" });

/** An October payment, then a November of payments, a refund owed and made, one still owed, and a kept deposit. */
function busy() {
  const w = world();
  w.post(gw("b-1", "p1", 20000), "record_deposit"); // 28 Oct
  w.clock.set(at(11, 3, 10));
  w.post(gw("b-2", "p2", 30000), "record_deposit");
  w.post(gw("b-3", "p3", 25050), "record_deposit");
  w.clock.set(at(11, 9, 10));
  w.post({ kind: "refund_owed", case: "b-2", owed: "b-2:p2", paymentId: "p2", amountPaise: 30000 }, "refund", "held_for_owner");
  w.post({ kind: "refund_made", case: "b-2", owed: "b-2:p2", paymentId: "p2", amountPaise: 30000, method: "gateway", evidence: "provider", refundId: "r1" }, "refund");
  w.clock.set(at(11, 20, 10));
  w.post({ kind: "refund_owed", case: "b-3", owed: "b-3:p3", paymentId: "p3", amountPaise: 10000 }, "refund", "held_for_owner");
  w.post({ kind: "kept", case: "b-1", amountPaise: 5000, why: "late_cancellation" }, "owner_decision");
  return w;
}

test("per account, the summary is balances() over the same lines; the closing balances and kinds follow from them", () => {
  const w = busy();
  const entries = w.record.entries();
  const j = journal(entries, LEGACY);
  const s = accountingSummary(j, FROM, TO, entries);
  const bal = balances(j.lines, FROM, TO);
  assert.deepEqual(Object.fromEntries(s.accounts.map((a) => [a.account, a.debitPaise - a.creditPaise])), Object.fromEntries(Object.entries(bal).filter(([, v]) => v !== 0 || true)));
  assert.deepEqual(s.accounts.map((a) => a.account), s.accounts.map((a) => a.account).sort(), "accounts are sorted, so the signed bytes are stable");
  assert.ok(s.accounts.every((a) => Number.isInteger(a.debitPaise) && Number.isInteger(a.creditPaise)));
  // closing: the owed refund of b-3 (10000) is still owed; the October advance of 20000 less 5000 kept is held, with November's two payments less b-2's refund and b-3's owed
  assert.equal(s.closing.refundsOwedPaise, 10000);
  assert.equal(s.closing.advancesPaise, 20000 - 5000 + 30000 + 25050 - 30000 - 10000);
  assert.equal(s.closing.receivablePaise, 0);
  assert.equal(s.byKind.find((k) => k.kind === "received")!.paise, 55050, "October's payment is not this month's");
  assert.equal(s.byKind.find((k) => k.kind === "refund_made")!.paise, 30000);
  assert.equal(s.byKind.find((k) => k.kind === "kept")!.paise, 5000);
  assert.equal(s.problems, 0);
  // the same record read twice gives the same bytes
  assert.equal(JSON.stringify(accountingSummary(journal(entries, LEGACY), FROM, TO, entries)), JSON.stringify(s));
  assert.ok(s.documents.some((d) => d.series === "RCT" && d.count === 2) && s.documents.some((d) => d.series === "CN" && d.count === 1));
});

test("documents: a restore's jump is said as a skipped range, and a problem is counted in its own period", () => {
  const w = world();
  w.post(gw("b-1", "p1", 10000), "record_deposit");
  w.clock.set(at(11, 3, 10));
  w.post(gw("b-2", "p2", 10000), "record_deposit");
  w.record.append({ conversation: "", booking: null, action: "restored", inputs: {}, outcome: "confirmed", language: "en", refs: {} });
  w.post(gw("b-3", "p3", 10000), "record_deposit");
  w.record.append({ conversation: "", booking: "b-4", action: "record_deposit", inputs: {}, outcome: "confirmed", language: "en", refs: { paymentId: "bad", amountPaise: "0" } }); // not a readable amount
  const entries = w.record.entries();
  const s = accountingSummary(journal(entries, LEGACY), FROM, TO, entries);
  const rct = s.documents.find((d) => d.series === "RCT")!;
  assert.equal(rct.count, 2);
  assert.equal(rct.skipped.length, 1);
  assert.match(rct.skipped[0].from, /\/0003$/);
  assert.match(rct.skipped[0].to, new RegExp(`/${RESTORE_DOC_GAP + 2}$`));
  assert.equal(s.problems, 1);
  const october = accountingSummary(journal(entries, LEGACY), new Date(at(10, 1, 0)).toISOString(), FROM, entries);
  assert.equal(october.problems, 0);
});

test("the report field is left out for a record with no money, and carries the legacy map when there is some", () => {
  const w = world();
  w.record.append({ conversation: "", booking: null, action: "send_message", inputs: {}, outcome: "confirmed", language: "en", refs: {} });
  assert.equal(reportAccounting(w.record.entries(), LEGACY, FROM, TO), undefined);
  const b = busy();
  const acc = reportAccounting(b.record.entries(), LEGACY, FROM, TO)!;
  assert.deepEqual(acc.legacy, LEGACY);
  assert.ok(acc.summary.accounts.length > 0);
});

// ---- the open check -----------------------------------------------------------------------------------------------------------------------------------

const { privateKey } = generateKeyPairSync("ed25519");
/** The pack, and the signed-shape report data a template would make from this record. */
function packAndReport(entries: ReturnType<ActionRecord["entries"]>) {
  const pack = JSON.parse(JSON.stringify(evidencePack(ledgerEntries(entries, "glow-salon"), { tenant: "glow-salon", now: Date.now(), key: privateKey })));
  const report = { document: { period: { from: FROM, to: TO }, accounting: reportAccounting(entries, LEGACY, FROM, TO), anchor: headOf(entries, "glow-salon") } };
  return { pack, report: JSON.parse(JSON.stringify(report)) };
}

test("a pack made from the record passes the check, though its bodies leave out the notes and the conversation", () => {
  const { pack, report } = packAndReport(busy().record.entries());
  assert.ok(!JSON.stringify(pack).includes("a private note") && !JSON.stringify(pack).includes("+919800000001"));
  const r = checkAccounting(pack, report);
  assert.equal(r.ok, true, renderCheck(r));
  assert.match(renderCheck(r), /geo-verify pack\.json --anchor anchor\.json/);
});

test("changing one money line's amount in the pack makes the check fail, naming the account", () => {
  const { pack, report } = packAndReport(busy().record.entries());
  const i = pack.entries.findIndex((e: { body: string }) => /"amountPaise":"25050"/.test(e.body));
  assert.ok(i >= 0);
  pack.entries[i].body = pack.entries[i].body.replace('"amountPaise":"25050"', '"amountPaise":"25000"');
  const r = checkAccounting(pack, report);
  assert.equal(r.ok, false);
  const text = renderCheck(r);
  assert.match(text, /DIFFERENT: Account "advances", credits: the report says ₹.* but the pack adds up to ₹/);
  assert.match(text, /DIFFERENT: Account "gateway"/);
});

test("a pack cut short before the report's anchor fails, and so does one of another record", () => {
  const entries = busy().record.entries();
  const { pack, report } = packAndReport(entries);
  const short = { ...pack, entries: pack.entries.slice(0, 4) };
  const r = checkAccounting(short, report);
  assert.equal(r.ok, false);
  assert.match(renderCheck(r), /cut short/);
  const other = JSON.parse(JSON.stringify(pack));
  other.entries.at(-1).hash = "sha256:" + "0".repeat(64);
  assert.match(renderCheck(checkAccounting(other, report)), /not of the same record/);
});

test("a report with a summary but a pack with no money, and bad files, are told apart", () => {
  const { pack, report } = packAndReport(busy().record.entries());
  assert.throws(() => checkAccounting({ format: "nope" }, report), BadInput);
  assert.throws(() => checkAccounting(pack, { document: {} }), BadInput);
  const noLegacy = JSON.parse(JSON.stringify(report));
  delete noLegacy.document.accounting.legacy;
  assert.throws(() => checkAccounting(pack, noLegacy), BadInput);
  const emptyRecord = world().record.entries();
  const none = { document: { period: { from: FROM, to: TO }, anchor: null } };
  const p = JSON.parse(JSON.stringify(evidencePack(ledgerEntries(emptyRecord.length ? emptyRecord : [], "glow-salon"), { tenant: "glow-salon", now: 1 })));
  assert.equal(checkAccounting(p, none).lines.filter((l) => !l.ok).length, 1, "only the missing record head is said, since there is no money on either side");
});

test("the command line exits 0 on a match, 1 on a difference and 2 on a file that is not readable", () => {
  const { pack, report } = packAndReport(busy().record.entries());
  const dir = mkdtempSync(join(tmpdir(), "geo-check-"));
  try {
    const script = fileURLToPath(new URL("../check.ts", import.meta.url));
    const write = (name: string, v: unknown) => { const p = join(dir, name); writeFileSync(p, JSON.stringify(v)); return p; };
    const run = (...args: string[]) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
    const good = run(write("pack.json", pack), write("report.json", report));
    assert.equal(good.status, 0, good.stdout + good.stderr);
    const bad = JSON.parse(JSON.stringify(pack));
    bad.entries[2].body = bad.entries[2].body.replace(/"amountPaise":"\d+"/, '"amountPaise":"1"');
    const diff = run(write("bad.json", bad), write("report.json", report));
    assert.equal(diff.status, 1, diff.stdout);
    assert.match(diff.stdout, /DIFFERENT/);
    assert.equal(run(join(dir, "missing.json"), write("report.json", report)).status, 2);
    assert.equal(run().status, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the Money this month block: bold figures from the summary, in four languages, with none of the banned words", () => {
  const { report } = packAndReport(busy().record.entries());
  const summary = report.document.accounting.summary;
  for (const language of LANGUAGES) {
    const words = MONEY_BLOCK_WORDS[language];
    const html = moneyBlock(summary, words, { toCome: true });
    const text = html.replace(/<[^>]+>/g, " ");
    assert.deepEqual(bannedIn(text, language), [], language);
    assert.match(html, /<strong>₹550\.50<\/strong>/, "received, from integer paise");
    assert.match(html, /<strong>₹100<\/strong>/, "still owed back");
    assert.ok(html.includes(words.heading) && html.includes(words.owedBack) && html.includes(words.toCome));
    assert.doesNotMatch(text, /debit|credit|ledger|journal|receivable|liabilit/i);
  }
  assert.ok(!moneyBlock(summary, MONEY_BLOCK_WORDS.en).includes(MONEY_BLOCK_WORDS.en.toCome), "only Fees shows what is still to come");
});

test("the lines under the block say why it differs from the report's rows, in four languages, only for money there was", () => {
  const { report } = packAndReport(busy().record.entries());
  const summary = report.document.accounting.summary;
  const booksOnly = { paidTwicePaise: 20_000, markedReceivedPaise: 5_050, markedGivenBackPaise: 0 };
  for (const language of LANGUAGES) {
    const words = MONEY_BLOCK_WORDS[language];
    const html = moneyBlock(summary, words, { booksOnly });
    assert.deepEqual(bannedIn(html.replace(/<[^>]+>/g, " "), language), [], language);
    assert.ok(html.includes(esc(words.paidTwice.replace("{amount}", "₹200"))), `${language}: the payment made twice`);
    assert.ok(html.includes(esc(words.markedReceived.replace("{amount}", "₹50.50"))), `${language}: the owner's own marks`);
    assert.ok(!html.includes(esc(words.markedGivenBack.split("{amount}")[0])), `${language}: no line for money there was not`);
    for (const w of [words.paidTwice, words.markedReceived, words.markedGivenBack]) assert.equal(w.split("{amount}").length, 2, `${language}: one amount in "${w}"`);
  }
  assert.ok(!moneyBlock(summary, MONEY_BLOCK_WORDS.en).includes('class="small"'), "no booksOnly: no line");
});

test("a refund made on a person's word only is counted on its own and left out of the block's \"given back\", as the owner's Money section does", () => {
  const w = busy();
  w.clock.set(at(11, 22, 10));
  // b-3's owed ₹100 is settled on a person's word: no provider's or owner's record shows the money moved
  w.post({ kind: "refund_made", case: "b-3", owed: "b-3:p3", paymentId: "p3", amountPaise: 10000, method: "gateway", evidence: "person_word" }, "refund");
  const summary = accountingSummary(journal(w.record.entries(), LEGACY), FROM, TO, w.record.entries());
  assert.deepEqual(summary.byWord, { entries: 1, paise: 10000 });
  assert.equal(summary.byKind.find((k) => k.kind === "refund_made")?.paise, 40000, "the journal still holds both refunds");
  const en = MONEY_BLOCK_WORDS.en;
  const cards = [...moneyBlock(summary, en).matchAll(/<strong>([^<]+)<\/strong><span>([^<]+)<\/span>/g)].map((m) => [m[2], m[1]]);
  assert.deepEqual(Object.fromEntries(cards)[en.givenBack], "₹300", "given back: the provider's refund only");
  assert.deepEqual(Object.fromEntries(cards)[esc(en.byWord)], "₹100", "the person's-word refund on its own card");
  // the open check re-adds it from the pack as well
  const { pack, report } = packAndReport(w.record.entries());
  assert.equal(checkAccounting(pack, report).ok, true);
});
