// The accountant's files: the CSV is parsed back by a strict RFC 4180 reader written here (it throws on anything a spreadsheet could read two ways), the totals
// are compared with the journal to the paisa, amounts are checked from integer paise, no phone number or planted name is in any file, and a restore's skipped
// numbers each have a row. The record is built the way test/accounting.test.ts builds it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeClock } from "../../core/clock.ts";
import { zonedToMs } from "../../core/time.ts";
import { createRecord } from "../../record/record.ts";
import type { ActionRecord, Outcome } from "../../record/record.ts";
import { bannedIn } from "../../report/claims.ts";
import { accountantName } from "../accounts.ts";
import { accountantFiles, csvField, exportNames, rupees } from "../export.ts";
import type { LegacyMap } from "../journal.ts";
import { RESTORE_DOC_GAP } from "../numbers.ts";
import { createAccounting } from "../post.ts";
import type { MoneyEvent } from "../post.ts";
import { OWNER_MONEY_WORDS } from "../words-owner.ts";

const TZ = "Asia/Kolkata";
const at = (month: number, day: number, hour: number, minute = 0, year = 2026) => zonedToMs({ year, month, day }, { hour, minute }, TZ);
const PHONE = "+919800000001";
const NAME = "Asha Menon";
const LEGACY: LegacyMap = { received: [{ action: "record_deposit", outcome: "confirmed", for: "advance" }] };

function world(start = at(10, 20, 11)) {
  const clock = fakeClock(start);
  const record = createRecord(clock);
  const acc = createAccounting({ record, shop: { timezone: TZ }, legacy: LEGACY, clock });
  const line = (c: string | null, action: string, outcome: Outcome, refs: Record<string, string> = {}) =>
    record.append({ conversation: PHONE, booking: c, action, inputs: { name: NAME }, outcome, language: "en", notes: `${NAME} ${PHONE}`, refs });
  const post = (event: MoneyEvent, action: string, outcome: Outcome = "confirmed") =>
    acc.post(event, (refs) => line("case" in event ? event.case : null, action, outcome, refs));
  return { clock, record: record as ActionRecord, acc, line, post };
}
const gw = (c: string, id: string, amountPaise: number): MoneyEvent => ({ kind: "received", case: c, paymentId: id, amountPaise, method: "gateway", evidence: "provider", for: "advance" });

/** A strict RFC 4180 reader: CRLF rows, a quoted field holds commas, quotes (doubled) and line breaks, a bare quote or a ragged row is an error. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let i = 0;
  let quoted = false;
  let fieldStart = true;
  while (i < text.length) {
    const ch = text[i];
    if (quoted) {
      if (ch === "\"") { if (text[i + 1] === "\"") { field += "\""; i += 2; continue; } quoted = false; i++; if (!(text[i] === "," || text[i] === "\r")) throw new Error("text after a closing quote"); continue; }
      field += ch; i++; continue;
    }
    if (ch === "\"") { if (!fieldStart) throw new Error("a quote inside an unquoted field"); quoted = true; fieldStart = false; i++; continue; }
    if (ch === ",") { row.push(field); field = ""; fieldStart = true; i++; continue; }
    if (ch === "\r") { if (text[i + 1] !== "\n") throw new Error("a bare CR"); row.push(field); rows.push(row); row = []; field = ""; fieldStart = true; i += 2; continue; }
    if (ch === "\n") throw new Error("a bare LF");
    field += ch; fieldStart = false; i++;
  }
  if (quoted) throw new Error("an unterminated quote");
  if (field !== "" || row.length > 0) throw new Error("the file does not end with CRLF");
  for (const r of rows) if (r.length !== rows[0].length) throw new Error(`a ragged row: ${r.length} fields, not ${rows[0].length}`);
  return rows;
}

/** "1234567.89" to paise, by reading the digits: the test does not use a float either. */
function paiseOf(text: string): number {
  const m = /^(-?)(\d+)\.(\d{2})$/u.exec(text);
  if (!m) throw new Error(`"${text}" is not rupees with 2 decimals`);
  return (m[1] ? -1 : 1) * (Number(m[2]) * 100 + Number(m[3]));
}

const file = (files: { name: string; content: string }[], name: string): string => files.find((f) => f.name === name)!.content;

test("rupees: paise 1, 99, 100 and 123456789 are written exactly, by integer arithmetic", () => {
  assert.equal(rupees(0), "0.00");
  assert.equal(rupees(1), "0.01");
  assert.equal(rupees(99), "0.99");
  assert.equal(rupees(100), "1.00");
  assert.equal(rupees(101), "1.01");
  assert.equal(rupees(123_456_789), "1234567.89");
  assert.equal(rupees(-250), "-2.50");
  assert.throws(() => rupees(1.5));
});

test("csvField: a comma, quote or line break quotes the field and doubles the quotes; a plain field is left alone", () => {
  assert.equal(csvField("plain"), "plain");
  assert.equal(csvField("a,b"), "\"a,b\"");
  assert.equal(csvField("say \"hi\""), "\"say \"\"hi\"\"\"");
  assert.equal(csvField("two\nlines"), "\"two\nlines\"");
  assert.equal(csvField(7), "7");
  assert.deepEqual(parseCsv("a,\"b,\"\"c\"\"\r\nd\",e\r\n"), [["a", "b,\"c\"\r\nd", "e"]].map((r) => r.length === 3 ? r : r));
});

function shop() {
  const w = world();
  w.post(gw("b-7", "pay_7", 1), "record_deposit"); // 20 Oct, 1 paisa
  w.clock.set(at(11, 15, 0, 30)); // 00:30 in India is still 14 Nov in UTC: the date must be the shop's
  w.post(gw("b-1", "pay_1", 99), "record_deposit");
  w.post(gw("b-2", "pay_2", 123_456_789), "record_deposit");
  w.post({ kind: "refund_owed", case: "b-2", owed: "b-2:pay_2", paymentId: "pay_2", amountPaise: 100 }, "refund", "attempted");
  w.post({ kind: "refund_made", case: "b-2", owed: "b-2:pay_2", paymentId: "pay_2", refundId: "rfd_2", amountPaise: 100, method: "gateway", evidence: "provider" }, "refund");
  w.post({ kind: "applied", case: "b-1", amountPaise: 99, service: "haircut" }, "complete_booking");
  w.post({ kind: "received", case: PHONE, paymentId: "up_x", amountPaise: 500, method: "upi", evidence: "owner_mark", for: "advance" }, "owner_marked_paid"); // a case that is a phone number
  return w;
}

test("journal CSV: parsed back strictly; one row per line of the month; totals equal the journal to the paisa; the shop's date; names in the accountant's words", () => {
  const w = shop();
  const j = w.acc.journal();
  const files = accountantFiles({ journal: j, entries: w.record.entries(), period: "2026-11", timeZone: TZ });
  assert.deepEqual(files.map((f) => f.name), ["journal-2026-11.csv", "documents-2026-11.csv", "README.txt"]);
  assert.deepEqual(exportNames("26-27"), { journal: "journal-26-27.csv", documents: "documents-26-27.csv", readme: "README.txt" });
  const rows = parseCsv(file(files, "journal-2026-11.csv"));
  assert.deepEqual(rows[0], ["date", "voucher_no", "voucher_type", "account", "debit", "credit", "method", "evidence", "case_ref", "payment_id", "refund_id", "record_seq"]);
  const lines = j.lines.filter((l) => l.at >= new Date(at(11, 1, 0)).toISOString());
  assert.equal(rows.length - 1, lines.length);
  const body = rows.slice(1);
  const debit = body.reduce((n, r) => n + paiseOf(r[4]), 0);
  const credit = body.reduce((n, r) => n + paiseOf(r[5]), 0);
  assert.equal(debit, lines.reduce((n, l) => n + l.debitPaise, 0));
  assert.equal(credit, lines.reduce((n, l) => n + l.creditPaise, 0));
  assert.equal(debit, credit);
  body.forEach((r, k) => assert.equal(r[3], accountantName(lines[k].account)));
  assert.ok(body.some((r) => r[3] === "Bank (UPI receipts, marked by owner)"), "an account name with a comma comes back whole");
  const first = body.find((r) => r[2] === "Receipt" && r[9] === "pay_1")!;
  assert.equal(first[0], "2026-11-15");
  assert.equal(first[1], "RCT/26-27/0002");
  assert.equal(first[6], "gateway");
  assert.equal(first[7], "provider");
  assert.equal(first[8], "b-1");
  const big = body.find((r) => r[9] === "pay_2" && paiseOf(r[4]) > 0)!;
  assert.equal(big[4], "1234567.89");
  assert.equal(big[5], "0.00");
  const refund = body.find((r) => r[2] === "Credit note" && paiseOf(r[5]) > 0)!;
  assert.equal(refund[10], "rfd_2");
  assert.ok(refund[1].startsWith("CN/26-27/"));
  const owedLine = body.find((r) => r[2] === "Journal" && r[0] === "2026-11-15");
  assert.ok(owedLine && /^J-\d+$/u.test(owedLine[1]), "a line with no document is numbered J-<record seq>");
  assert.equal(body.find((r) => r[8] === "" && r[9] === "up_x") !== undefined, true, "a case that looks like a phone number is left out");
});

test("a financial year holds the October line too, and the two months add up to it", () => {
  const w = shop();
  const j = w.acc.journal();
  const e = w.record.entries();
  const year = parseCsv(file(accountantFiles({ journal: j, entries: e, period: "26-27", timeZone: TZ }), "journal-26-27.csv")).length - 1;
  const nov = parseCsv(file(accountantFiles({ journal: j, entries: e, period: "2026-11", timeZone: TZ }), "journal-2026-11.csv")).length - 1;
  const oct = parseCsv(file(accountantFiles({ journal: j, entries: e, period: "2026-10", timeZone: TZ }), "journal-2026-10.csv")).length - 1;
  assert.equal(year, j.lines.length);
  assert.equal(oct + nov, year);
  assert.equal(oct, 2);
  assert.equal(parseCsv(file(accountantFiles({ journal: j, entries: e, period: "27-28", timeZone: TZ }), "journal-27-28.csv")).length, 1);
  for (const bad of ["2026-13", "26-28", "2026", "nov", "26-27x"]) assert.throws(() => accountantFiles({ journal: j, entries: e, period: bad, timeZone: TZ }), /not a period/);
});

test("no phone number and no planted name in any file", () => {
  const w = shop();
  const files = accountantFiles({ journal: w.acc.journal(), entries: w.record.entries(), period: "26-27", timeZone: TZ });
  for (const f of files) {
    assert.equal(f.content.includes("9800000001"), false, f.name);
    assert.equal(f.content.includes("Asha"), false, f.name);
    assert.equal(f.content.includes("Menon"), false, f.name);
  }
});

test("documents CSV: every number with its date, type and amount", () => {
  const w = shop();
  const files = accountantFiles({ journal: w.acc.journal(), entries: w.record.entries(), period: "2026-11", timeZone: TZ });
  const rows = parseCsv(file(files, "documents-2026-11.csv"));
  assert.deepEqual(rows[0], ["number", "date", "type", "amount", "note"]);
  const byNumber = Object.fromEntries(rows.slice(1).map((r) => [r[0], r]));
  assert.deepEqual(byNumber["RCT/26-27/0002"], ["RCT/26-27/0002", "2026-11-15", "Receipt", "0.99", ""]);
  assert.equal(byNumber["RCT/26-27/0003"][3], "1234567.89");
  assert.equal(byNumber["CN/26-27/0001"][2], "Credit note");
  assert.equal(byNumber["RCT/26-27/0001"], undefined, "the October receipt is not in November's file");
});

test("a restore: each number skipped has its own row, saying why; a gap with no restore is \"missing\"", () => {
  const w = world(at(11, 2, 10));
  w.post(gw("b-1", "p1", 100), "record_deposit");
  w.post(gw("b-2", "p2", 200), "record_deposit");
  w.clock.set(at(11, 5, 10));
  w.line(null, "restored", "confirmed", { snapshot: "2026-11-04" });
  w.post(gw("b-3", "p3", 300), "record_deposit");
  assert.equal(w.acc.journal().documents.at(-1)!.number, `RCT/26-27/${2 + RESTORE_DOC_GAP + 1}`);
  // a hand-made line that skips two numbers with no restore between
  w.line("b-4", "record_deposit", "confirmed", { money: "received", amountPaise: "400", paymentId: "p4", method: "gateway", evidence: "provider", for: "advance", doc: `RCT/26-27/${2 + RESTORE_DOC_GAP + 4}` });
  const j = w.acc.journal();
  assert.equal(j.problems.length, 0);
  const rows = parseCsv(file(accountantFiles({ journal: j, entries: w.record.entries(), period: "2026-11", timeZone: TZ }), "documents-2026-11.csv")).slice(1);
  const restored = rows.filter((r) => r[4] === "not used: the shop's data was restored");
  const missing = rows.filter((r) => r[4] === "missing");
  assert.equal(restored.length, RESTORE_DOC_GAP);
  assert.equal(restored[0][0], "RCT/26-27/0003");
  assert.equal(restored.at(-1)![0], `RCT/26-27/${2 + RESTORE_DOC_GAP}`);
  assert.equal(restored[0][1], "2026-11-05");
  assert.equal(restored[0][3], "");
  assert.deepEqual(missing.map((r) => r[0]), [`RCT/26-27/${2 + RESTORE_DOC_GAP + 2}`, `RCT/26-27/${2 + RESTORE_DOC_GAP + 3}`]);
  assert.equal(rows.filter((r) => r[4] === "").length, 4, "the four numbers issued are listed once each");
});

test("README: what the files are, the scope line, rupees, and nothing a customer is; no banned word", () => {
  const w = shop();
  const readme = file(accountantFiles({ journal: w.acc.journal(), entries: w.record.entries(), period: "2026-11", timeZone: TZ }), "README.txt");
  assert.ok(readme.includes(OWNER_MONEY_WORDS.en.scope));
  assert.ok(readme.includes("journal-2026-11.csv") && readme.includes("documents-2026-11.csv"));
  assert.ok(/rupees/.test(readme));
  assert.ok(/never in these files/.test(readme));
  assert.deepEqual(bannedIn(readme, "en"), []);
});
