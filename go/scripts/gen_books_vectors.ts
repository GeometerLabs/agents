// Writes the TEST VECTORS of the Go books (go/internal/accounting/testdata/*.json), made by RUNNING the TypeScript of modules/accounting (and the Bookings legacy map) on Node:
// document numbers and periods, the journal and post() over a set of shop records, the figures, the summary, the invariants, the accountant's files, the owner's money view and its
// page, the report block and the customer's document page, and the settlement job. The Go tests compare BYTE FOR BYTE, and the thrown messages too. The words themselves and the style
// sheets are a different file (gen_books_words.ts): the page vectors here carry the style sheets as a placeholder so they stay small, and the words file is held equal to the TypeScript
// by its own freshness test.
// Run from the repository root:  node go/scripts/gen_books_vectors.ts   (--check only compares; the test words-fresh fails when it was not run after a change to modules/accounting)
// The vectors name the Node that made them (`node` in each file) and that member is left out of the freshness comparison, so a newer Node that writes the same figures is not "stale".
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LANGUAGES } from "../../modules/language/languages.ts";
import { fyOf, fyStartMs, formatNumber, parseNumber, nextNumber, SERIES } from "../../modules/accounting/numbers.ts";
import { dayRange, monthRange, monthPeriodOf, previousMonth, periodRange, exportPeriods } from "../../modules/accounting/periods.ts";
import { ACCOUNTS, accountantName, isAccount, kindOf, serviceAccount, METHOD_ACCOUNT } from "../../modules/accounting/accounts.ts";
import { groupOf } from "../../modules/accounting/tally.ts";
import { newRecord, T0 } from "./lib_books_worlds.ts";
import type { Step } from "./lib_books_worlds.ts";
import { WORLDS } from "./lib_books_data.ts";
import type { WorldDef } from "./lib_books_data.ts";
import { createAccounting } from "../../modules/accounting/post.ts";
import { journal, balances, MONEY_REFS } from "../../modules/accounting/journal.ts";
import { figuresOf, booksOnlyOf } from "../../modules/accounting/figures.ts";
import { accountingSummary, reportAccounting } from "../../modules/accounting/summary.ts";
import { booksFaults, figuresFaults } from "../../modules/accounting/invariants.ts";
import { accountantFiles, csvField, rupees } from "../../modules/accounting/export.ts";
import { xml } from "../../modules/accounting/tally.ts";
import { ownerMoney } from "../../modules/accounting/owner-money.ts";
import { ownerMoneySection } from "../../modules/accounting/owner-money-render.ts";
import { moneyBlock, MONEY_BLOCK_WORDS } from "../../modules/accounting/report-block.ts";
import { documentPage, DOC_CSS } from "../../modules/accounting/document-page.ts";
import { caseDocuments } from "../../modules/accounting/case-documents.ts";
import { formatPaise, makeDocument } from "../../modules/accounting/documents.ts";
import { readSettlementsOnce, yesterdayOf } from "../../modules/accounting/settlements.ts";
import { markObligations } from "../../modules/payments/owner-marked/obligations.ts";
import { CUSTOMER_CSS } from "../../modules/channels/look.ts";
import type { RecordEntry } from "../../modules/record/record.ts";

const here = dirname(fileURLToPath(import.meta.url));
const INTERNAL = join(here, "..", "internal");
export const OUT = INTERNAL;

/** A value or the text of what it threw, for a function that may refuse. */
export const tryIt = <T>(f: () => T): { value: T } | { error: string } => { try { return { value: f() }; } catch (e) { return { error: (e as Error).message }; } };

const ZONES = ["Asia/Kolkata", "UTC", "America/New_York", "Australia/Sydney"];
const stamp = (v: unknown): string => JSON.stringify({ node: process.version, ...(v as object) }, null, 1) + "\n";

// ---- stage 1: numbers, periods, accounts, JavaScript numbers ----
function numbers(): unknown {
  // the year end in India: 31 March 18:30 UTC is midnight of 1 April
  const instants = [0, T0, Date.UTC(2026, 2, 31, 18, 29, 59, 999), Date.UTC(2026, 2, 31, 18, 30), Date.UTC(2027, 2, 31, 18, 29, 59, 999), Date.UTC(2027, 2, 31, 18, 30), Date.UTC(2026, 11, 31, 23, 59), Date.UTC(2027, 0, 1), Date.UTC(2099, 11, 31, 20), Date.UTC(2000, 2, 31, 18, 30), Date.UTC(1999, 11, 1)];
  const fy = ZONES.flatMap((tz) => instants.map((ms) => ({ tz, ms, fy: fyOf(ms, tz), start: fyStartMs(fyOf(ms, tz), tz) })));
  const formats = [{ series: "RCT", fy: "26-27", n: 1 }, { series: "RCT", fy: "26-27", n: 7 }, { series: "BILL", fy: "26-27", n: 99999 }, { series: "CN", fy: "26-27", n: 100000 }, { series: "RCT", fy: "26-27", n: 999999 }, { series: "RCT", fy: "26-27", n: 1000000 },
    { series: "RCT", fy: "26-27", n: 0 }, { series: "RCT", fy: "26-27", n: -5 }, { series: "RCT", fy: "26-27", n: 1.5 }, { series: "BILL", fy: "26-27", n: 10000 }, { series: "BILL", fy: "26-27", n: 10001 }, { series: "RCT", fy: "99-00", n: 12 }, { series: "RCT", fy: "26-27", n: 2 ** 53 }];
  const parses = ["RCT/26-27/0007", "RCT/26-27/7", "RCT/26-28/0007", "RCT/99-00/0007", "RCT/26-27/000007", "RCT/26-27/0000007", "BILL/26-27/1234", "CN/00-01/0001", "CN/00-02/0001", "XYZ/26-27/0001", " RCT/26-27/0007", "RCT/26-27/0007\n", "RCT/26-27/٠٠٠٧", "", "J-12", "RCT/09-10/0001", "RCT/25-26/123456"];
  const periods = ["2026-11", "2026-12", "2026-01", "2026-00", "2026-13", "26-27", "27-28", "99-00", "00-01", "26-28", "26-26", "2026-1", "202-11", "2026-11 ", "", "26-27\n", "٢٦-٢٧", "2026-09", "25-26"];
  // a record with documents, a restore, and a series that jumps
  const r = newRecord(T0);
  const doc = (at: number, n: number, series = "RCT", fyy = "26-27", extra: Record<string, string> = {}) => r.append(at, { action: "x", outcome: "confirmed", refs: { doc: `${series}/${fyy}/${String(n).padStart(4, "0")}`, ...extra } });
  doc(T0 + 1000, 1); doc(T0 + 2000, 2); doc(T0 + 3000, 1, "BILL"); doc(T0 + 4000, 3, "RCT", "25-26"); r.append(T0 + 5000, { action: "x", outcome: "confirmed", refs: { doc: "" } }); r.append(T0 + 6000, { action: "x", outcome: "confirmed", refs: { doc: "garbage" } });
  const before = r.entries().length;
  const e1 = r.entries();
  r.append(T0 + 7000, { action: "restored", outcome: "confirmed" });
  doc(T0 + 8000, 10005); doc(T0 + 9000, 3, "CN");
  r.append(Date.UTC(2027, 3, 2), { action: "restored", outcome: "confirmed" }); // after the next year starts
  r.append(Date.UTC(2026, 2, 20), { action: "restored", outcome: "confirmed" }); // seq later than all, but its time is before the year
  const nextCases = [e1, r.entries().slice(0, before + 1), r.entries().slice(0, before + 3), r.entries(), r.entries().slice(0, before + 4)].flatMap((entries, i) =>
    SERIES.flatMap((series) => ["26-27", "25-26", "27-28"].map((fyy) => ({ upTo: entries.length, series, fy: fyy, next: nextNumber(entries, series, fyy, fyStartMs(fyy, "Asia/Kolkata")) }))).map((c) => ({ ...c, case: i })));
  const jsTexts = ["", " ", "5", " 5 ", "\t5\n", "+5", "-5", "05", "5.", ".5", "1e3", "1E3", "1e-3", "0x10", "0X1f", "0o17", "0b101", "+0x10", "-0x10", "0x", "1_000", "1,5", "abc", "1e", "Infinity", "-Infinity", "+Infinity", "infinity", "1e999", "-0", "1.5", "9007199254740993", "123456789012345678901", "1e21", "1.5e300", "1e-7", "0.000001", "\u00a05\u00a0", "5 5", "٥", "0.1e1", "1e+3", "1e3.5", "00", "0b102", "0o8", "\ufeff7", "\u20287\u2029", "\u200b7", "9007199254740991", "9007199254740992", "-9007199254740991", "1e15", "123456789012345678", "0.5e1", "5e-1", ".e1", "e1", "+", "-", ".", "- 5", "0x1G"];
  const jsFloats = [0.1 + 0.2, 1e21, 123e-20, 100, 5e-324, 1.7976931348623157e308, -1.5, 1234567890123456800000, 1e-6, 1.5e-7, 123456789.123, 0.000123, 2 ** 53, 2 ** 70, -(2 ** 70), 1 / 3, 4.35, 0.5, 1e20, 123456789012345680000, 99.99999999999999];
  return {
    js: jsTexts.map((t) => ({ text: t, str: String(Number(t)), negZero: Object.is(Number(t), -0), safe: Number.isSafeInteger(Number(t)), canonical: Number.isSafeInteger(Number(t)) && String(Number(t)) === t })),
    floats: jsFloats.map((f) => ({ f, str: String(f) })),
    // Math.round(inr * 100), the way owner-money toPaise does it: every k/100 up to 200 rupees, and some values with more places and halves
    rounds: [...Array.from({ length: 6001 }, (_, k) => k / 100), ...Array.from({ length: 3000 }, (_, k) => Math.round(((k * 7919) % 100000) * 1000 / 7) / 1000), 0.5 / 100, 1.005, 2.675, 0.285, 1.255, 12.345, 0.001, 0.005, 0.004999, 123456.789, 1e6 + 0.005, -0.005, -1.005, 0.07, 0.29, 1.1, 8.2].map((inr) => ({ inr, p: Math.round(inr * 100) })),
    fy,
    formats: formats.map((f) => ({ in: f, out: tryIt(() => formatNumber(f as never)) })),
    parses: parses.map((t) => ({ text: t, out: parseNumber(t) })),
    periods: ZONES.flatMap((tz) => periods.map((p) => ({ tz, period: p, range: periodRange(p, tz) }))),
    days: ZONES.flatMap((tz) => instants.map((ms) => ({ tz, ms, day: dayRange(ms, tz), month: monthPeriodOf(ms, tz) }))),
    months: ZONES.flatMap((tz) => [[2026, 1], [2026, 2], [2026, 3], [2026, 4], [2026, 11], [2026, 12], [2027, 3]].map(([y, m]) => ({ tz, y, m, range: monthRange(y, m, tz) }))),
    previous: ["2026-11", "2026-01", "2026-12", "2000-01", "2026-10"].map((p) => ({ p, out: previousMonth(p) })),
    exportPeriods: ["2026-11", "2026-04", "2026-03", "2026-01", "2026-12", "2099-03", "2000-01", "2000-04"].map((p) => ({ p, out: exportPeriods(p) })),
    nextRecord: r.entries().map((e) => ({ seq: e.seq, time: e.time, action: e.action, doc: e.refs.doc ?? null })),
    next: nextCases,
    accounts: {
      fixed: Object.values(ACCOUNTS), method: METHOD_ACCOUNT,
      names: [...Object.values(ACCOUNTS).map((a) => a.code), "revenue:haircut", "revenue:", "revenue:Bad", "revenue:" + "a".repeat(100), "revenue:" + "a".repeat(101), "nothing", "", "tax_out:cgst", "cash "].map((c) => ({ code: c, is: isAccount(c), name: accountantName(c), kind: kindOf(c), group: groupOf(c) })),
      services: ["haircut", "a", "0", "-x", "_x", "x-y_z", "Haircut", "x y", "", "a".repeat(100), "a".repeat(101), "é", "x\n", "orders"].map((s) => ({ s, out: tryIt(() => serviceAccount(s)) })),
    },
  };
}

// ---- the worlds ----
const DEFAULT_CONVERSATION = "919800000001";
const iso = (ms: number): string => new Date(ms).toISOString();
const dayKeyOf = (d: { year: number; month: number; day: number }): string => `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;

interface Run { def: WorldDef; steps: Step[]; entries: RecordEntry[]; labels: Record<string, number>; jobs: unknown[] }

/** Runs one world's story through the real createAccounting and record (and its settlement ticks), on a fake clock. */
async function runWorld(def: WorldDef): Promise<Run> {
  const r = newRecord(Date.parse("2026-01-01T00:00:00Z"));
  const labels: Record<string, number> = {};
  const acc = createAccounting({ record: { entries: r.entries }, shop: { timezone: def.timezone, ...(def.status ? { status: def.status } : {}) }, legacy: def.legacy, clock: r.clock });
  const steps: Step[] = [];
  const seqOf = (l: string): number => { if (labels[l] === undefined) throw new Error(`no step labelled ${l}`); return labels[l]; };
  for (const s of def.steps) {
    const at = Date.parse(s.at);
    r.clock.set(at);
    const line = { conversation: DEFAULT_CONVERSATION, language: "en", notes: "", ...s.line, refs: { ...(s.line.refs ?? {}) } };
    const append = (extra: { booking?: string | null; refs?: Record<string, string> } = {}) => r.append(at, { action: line.action, outcome: line.outcome, conversation: line.conversation, language: line.language as never, notes: line.notes, booking: extra.booking !== undefined ? extra.booking : line.booking ?? null, refs: extra.refs ?? line.refs });
    const before = r.entries().length;
    const step: Step = { at, op: s.op, line };
    if (s.op === "raw") append();
    else {
      const event = s.event!(seqOf);
      step.event = event;
      const mode = line.mode ?? "";
      try {
        const res = acc.post(event as never, (money) => {
          const refs = { ...line.refs, ...money };
          if (mode === "none") return;
          if (mode === "twice") { append({ refs }); append({ refs }); return; }
          if (mode === "wrongCase") { append({ refs, booking: "other-case" }); return; }
          if (mode.startsWith("drop:")) for (const k of mode.slice(5).split(",")) delete (refs as Record<string, string>)[k];
          if (mode.startsWith("alter:")) for (const k of mode.slice(6).split(",")) if (k in refs) (refs as Record<string, string>)[k] = "tampered"; else (refs as Record<string, string>)[k] = "tampered";
          append({ refs });
        });
        step.result = res as never;
      } catch (e) { step.result = { error: (e as Error).message }; }
    }
    if (s.label) labels[s.label] = before + 1;
    steps.push(step);
  }
  const jobs: unknown[] = [];
  for (const job of def.jobs ?? []) {
    const nowMs = Date.parse(job.nowIso);
    r.clock.set(nowMs);
    const asked: string[] = [];
    const payments = {
      capabilities: { readsSettlements: true },
      readSettlements: async (day: { year: number; month: number; day: number }) => {
        const key = dayKeyOf(day);
        asked.push(key);
        const rows = job.days[key];
        if (rows === undefined) throw new Error(`no rows scripted for ${key}`);
        if (!Array.isArray(rows)) throw new Error(rows.error);
        return rows;
      },
    };
    const before = r.entries().length;
    const result = await readSettlementsOnce({ payments: payments as never, accounting: acc, record: r.record, conversation: DEFAULT_CONVERSATION, language: "en", nowMs, timeZone: def.timezone });
    jobs.push({ nowMs, scripted: job.days, result, asked, written: r.entries().length - before });
  }
  return { def, steps, entries: [...r.entries()], labels, jobs };
}

const RUNS: Run[] = await Promise.all(WORLDS.map(runWorld));

const WHOLE = { from: "1970-01-01T00:00:00.000Z", to: "2100-01-01T00:00:00.000Z" };
const LANGS = LANGUAGES as readonly string[];
const jsonSafe = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** The months (as "2026-04") and years the record's entries fall in, in the shop's time zone, and the half-open ISO ranges of each. */
function rangesOf(run: Run): { name: string; from: string; to: string }[] {
  const tz = run.def.timezone;
  const months = [...new Set(run.entries.map((e) => monthPeriodOf(Date.parse(e.time), tz)))];
  const years = [...new Set(run.entries.map((e) => fyOf(Date.parse(e.time), tz)))];
  const out = [{ name: "whole", ...WHOLE }];
  for (const p of [...months, ...years]) { const rg = periodRange(p, tz)!; out.push({ name: p, from: iso(rg.fromMs), to: iso(rg.toMs) }); }
  return out;
}

const SHOP = { name: "Anita's <Salon> & \"Spa\"", address: "12 MG Road, Kochi\n682001", phone: "+91 98765 43210" };
const whatFor = (caseId: string, language: string): string => `Haircut for <${caseId}> & more (${language})`;
const PEOPLE: Record<string, string> = { "b-1": "Anita Sharma <A&B>", "b-3": "Ravi \"R\" Kumar", "f-1": "Meera", "f-3": "Kavya's mother" };
const person = (c: string): string | undefined => PEOPLE[c];

function derive(run: Run): { core: unknown; files: unknown; pages: unknown } {
  const { def, entries } = run;
  const tz = def.timezone;
  const j = journal(entries, def.legacy);
  const seqOfLabel = (l: string) => run.labels[l];
  const oldDueBySeq: Record<number, string> = {};
  for (const [label, month] of Object.entries(def.oldDue ?? {})) oldDueBySeq[seqOfLabel(label)] = month;
  const oldDueOf = (e: RecordEntry): string | undefined => oldDueBySeq[e.seq];
  const ranges = rangesOf(run);
  const cases = [...new Set(entries.map((e) => e.booking))];
  const owedKeys = [...new Set(entries.flatMap((e) => [e.refs.owed, e.refs.refundId, e.booking && e.refs.paymentId ? `${e.booking}:${e.refs.paymentId}` : undefined].filter((x): x is string => x !== undefined)).concat(["nothing", "k1"]))];
  const accountsSeen = [...new Set(j.lines.map((l) => l.account))];
  const journalOut = {
    lines: j.lines, documents: j.documents, problems: j.problems, seen: j.seen, identities: [...j.identities], owedList: j.owedList(),
    balances: cases.flatMap((c) => accountsSeen.map((a) => ({ case: c, account: a, paise: j.caseBalance(c, a) }))),
    cases: cases.filter((c): c is string => c !== null).map((c) => ({ case: c, advances: j.advancesOf(c), receivable: j.receivableOf(c) })),
    openOwed: owedKeys.map((k) => ({ key: k, open: j.openOwed(k) })),
    linesOf: entries.map((e) => ({ seq: e.seq, n: j.linesOf(e.seq).length })).concat([{ seq: 0, n: j.linesOf(0).length }, { seq: 99999, n: j.linesOf(99999).length }]),
    balancesAll: balances(j.lines), balancesBy: ranges.map((r) => ({ name: r.name, from: r.from, to: r.to, out: balances(j.lines, r.from, r.to) })), balancesFrom: balances(j.lines, "2026-05-01T00:00:00.000Z"), balancesTo: balances(j.lines, undefined, "2026-05-01T00:00:00.000Z"),
  };
  // the same record read in two halves, as post.ts keeps one journal and feeds it the new entries: it must give the same lines
  const half = Math.floor(entries.length / 2);
  const stepwise = (() => { const k = journal(entries.slice(0, half), def.legacy); k.addAll(entries); return { lines: k.lines.length, problems: k.problems.length, seen: k.seen }; })();
  const fys = [...new Set([...entries.map((e) => fyOf(Date.parse(e.time), tz)), "26-27", "27-28", "25-26"])];
  const next = SERIES.flatMap((series) => fys.map((fy) => ({ series, fy, next: nextNumber(entries, series, fy, fyStartMs(fy, tz)) })));
  const summaries = ranges.map((r) => ({ ...r, summary: accountingSummary(j, r.from, r.to, entries) }));
  const reportAcc = ranges.slice(0, 3).map((r) => ({ ...r, out: reportAccounting(entries, def.legacy, r.from, r.to) ?? null }));
  const figures = ranges.flatMap((r) => [false, true].flatMap((fromPayment) => [undefined, true, false].map((ownerMarks) => {
    const options = { ...(fromPayment ? { refundAmountFromPayment: true } : {}), ...(ownerMarks !== undefined ? { ownerMarks } : {}) };
    return { name: r.name, from: r.from, to: r.to, options, out: figuresOf(j, entries, def.legacy, r.from, r.to, options), booksOnly: booksOnlyOf(figuresOf(j, entries, def.legacy, r.from, r.to, options)) ?? null };
  })));
  // damaged copies of the record, so the faults are found where the TypeScript finds them
  const clone = (): RecordEntry[] => entries.map((e) => ({ ...e, refs: { ...e.refs } }));
  const variants: { name: string; entries: RecordEntry[] }[] = [{ name: "as written", entries }];
  const dropped = clone(); const firstDoc = dropped.findIndex((e) => e.refs.doc); if (firstDoc >= 0) { dropped.splice(firstDoc, 1); variants.push({ name: "first document's entry removed", entries: dropped }); }
  const twice = clone(); const docs = twice.filter((e) => e.refs.doc); if (docs.length >= 2) { docs[1].refs.doc = docs[0].refs.doc; variants.push({ name: "a document number used twice", entries: twice }); }
  const swapped = clone(); const dd = swapped.filter((e) => e.refs.doc && e.refs.doc.startsWith("RCT")); if (dd.length >= 2) { const a = dd[0].refs.doc, b = dd[1].refs.doc; dd[0].refs.doc = b; dd[1].refs.doc = a; variants.push({ name: "two receipts' numbers swapped", entries: swapped }); }
  const phone = clone(); const target = phone.find((e) => e.refs.money); if (target) { target.refs.note = `call ${target.conversation.slice(-10)} please`; variants.push({ name: "a ref carries a phone number", entries: phone }); }
  const named = clone(); const t2 = named.find((e) => e.refs.money); if (t2) { t2.refs.who = "Anita Sharma"; variants.push({ name: "a ref carries a name", entries: named }); }
  const noDoc = clone().map((e) => { const refs = { ...e.refs }; delete refs.paymentId; return { ...e, refs }; }); variants.push({ name: "no payment ids", entries: noDoc });
  const prefixes = [Math.floor(entries.length / 3), Math.floor((2 * entries.length) / 3)].map((n) => ({ name: `first ${n} entries`, entries: entries.slice(0, n) }));
  const privateText = ["Anita Sharma", "ab", " x ", "  Sharma  ", "Ravi \"R\" Kumar", "Kavya"];
  const faults = [...variants, ...prefixes].map((v) => ({
    name: v.name, entries: v.name === "as written" ? null : v.entries,
    books: booksFaults(v.entries, def.legacy), booksPrivate: booksFaults(v.entries, def.legacy, { privateText }),
    figures: figuresFaults(v.entries, def.legacy), figuresFromPayment: figuresFaults(v.entries, def.legacy, { refundAmountFromPayment: true }),
  }));
  const obligations = markObligations(entries);
  // the owner's money view at each moment, with and without refunds the customer was not told of
  const untoldSets = [[], [{ case: "b-1", amountInr: 12.5 }, { case: "b-2", amountInr: 0.29 }, { case: "f-3", amountInr: 1234.57 }]];
  const views = def.nows.flatMap((now, i) => untoldSets.map((u, k) => ({ nowMs: Date.parse(now), untold: u, view: ownerMoney({ journal: j, entries, refundsUntold: u, nowMs: Date.parse(now), timeZone: tz }), key: `${i}.${k}` })));

  const core = {
    def: { name: def.name, timezone: tz, status: def.status ?? null, legacy: def.legacy, nows: def.nows, oldDue: oldDueBySeq, labels: run.labels },
    steps: run.steps, jobs: run.jobs, entries, journal: journalOut, stepwise, next, summaries, reportAccounting: reportAcc, figures, faults, obligations, views,
  };

  // ---- the accountant's files ----
  const periods = [...new Set([...ranges.map((r) => r.name).filter((n) => n !== "whole"), "2026-13", "26-28", "", "2026-1", "00-01"])];
  const tallies: { name: string; tally: unknown }[] = [{ name: "none", tally: undefined }, { name: "empty", tally: {} }, { name: "company", tally: { company: "Acme & Co <Test> \"q\" 'x'", ledgerNames: { cash: "Cash A/c", "revenue:haircut": "Hair & Co", upi: "  Bank UPI  " } } }];
  if (def.name === "bookings") { tallies.push({ name: "empty name", tally: { ledgerNames: { cash: "   " } } }, { name: "two groups", tally: { ledgerNames: { cash: "Same", upi: "Same" } } }); }
  if (def.oldDue) tallies.push({ name: "own old due", tally: { company: "X", oldDueOf: { "1": "2026-01", "2": "2026-02" } } });
  const filesOut = periods.flatMap((period) => tallies.flatMap((t) => [false, true].filter((withOld) => !withOld || def.oldDue).map((withOld) => {
    const tallyOpts = t.tally === undefined ? undefined : { ...(t.tally as object), ...((t.tally as { oldDueOf?: Record<string, string> }).oldDueOf ? { oldDueOf: (e: RecordEntry) => (t.tally as { oldDueOf: Record<string, string> }).oldDueOf[String(e.seq)] } : {}) };
    const out = tryIt(() => accountantFiles({ journal: j, entries, period, timeZone: tz, ...(tallyOpts ? { tally: tallyOpts } : {}), ...(withOld ? { oldDueOf } : {}) } as never));
    return { period, tally: t.name, oldDue: withOld, out };
  })));
  // a different time zone cuts the same record differently
  const otherZone = ["America/New_York", "UTC"].flatMap((z) => ["2026-04", "26-27", "2027-03"].map((period) => ({ period, tz: z, out: tryIt(() => accountantFiles({ journal: j, entries, period, timeZone: z } as never)) })));
  const files = { periods, tallies: tallies.map((t) => ({ name: t.name, tally: t.tally ?? null })), out: filesOut, otherZone };

  // ---- the pages ----
  const sectionLinks = [{ base: "/owner/accounting" }, undefined, { base: "/o/acc&unt'ing \"x\"" }];
  const sections = views.flatMap((v, vi) => LANGS.flatMap((lang, li) => {
    const picks = vi === 0 ? sectionLinks : [sectionLinks[(vi + li) % 2]];
    return picks.map((links) => ({ view: v.key, lang, links: links ?? null, html: ownerMoneySection(v.view, lang as never, links, tz) }));
  }));
  const boStd = { paidTwicePaise: 12345, markedReceivedPaise: 700, markedGivenBackPaise: 5 };
  const blocks = summaries.flatMap((s) => LANGS.flatMap((lang) => {
    const bo = booksOnlyOf(figuresOf(j, entries, def.legacy, s.from, s.to, { ownerMarks: false }));
    return [{ toCome: false, booksOnly: null }, { toCome: true, booksOnly: null }, { toCome: false, booksOnly: bo ?? null }, { toCome: true, booksOnly: boStd }, { toCome: false, booksOnly: { paidTwicePaise: 0, markedReceivedPaise: 3, markedGivenBackPaise: 0 } }]
      .map((o) => ({ range: s.name, lang, options: o, html: moneyBlock(s.summary, MONEY_BLOCK_WORDS[lang as never], { ...(o.toCome ? { toCome: true } : {}), ...(o.booksOnly ? { booksOnly: o.booksOnly } : {}) }) }));
  }));
  const shop = (status: "unregistered" | "composition") => ({ ...SHOP, timezone: tz, status });
  const strip = (page: string): string => page.replace(CUSTOMER_CSS + DOC_CSS, "{{CSS}}");
  const pages: unknown[] = [];
  j.documents.forEach((doc, i) => {
    for (const status of (i < 3 ? ["unregistered", "composition"] : [def.status ?? "unregistered"]) as ("unregistered" | "composition")[]) {
      for (const lang of LANGS) {
        const d = makeDocument({ doc, documents: j.documents, shop: shop(status), language: lang as never, whatFor, person });
        pages.push({ number: doc.number, status, lang, document: d, html: strip(documentPage(d)) });
      }
    }
  });
  const cd = (cs: string[], lang: string, withPerson: boolean) => ({ cases: cs, lang, withPerson, out: caseDocuments({ journal: j, cases: cs, shop: { ...SHOP, timezone: tz, status: def.status ?? "unregistered" }, language: lang as never, whatFor, ...(withPerson ? { person } : {}) }) });
  const caseDocs = [cd([], "en", false), cd([cases.find((c) => c !== null) as string], "hi", true), cd(cases.filter((c): c is string => c !== null), "en", true), cd(cases.filter((c): c is string => c !== null), "ml", false), cd(["nothing"], "kn", true)];
  const pagesOut = { sections, blocks, pages, caseDocs, css: { customerLength: CUSTOMER_CSS.length, docLength: DOC_CSS.length } };
  return { core: jsonSafe(core), files: jsonSafe(files), pages: jsonSafe(pagesOut) };
}

// ---- things with no world: formatPaise, the XML escaper, CSV, rupees, yesterday ----
function misc(): unknown {
  const xmlTexts = ["plain", "a & b < c > d \"e\" 'f'", "tab\there\nnew\rline", "nul\u0000x", "\u000b\u000c", "bell\u0007", "space \u0020 ok", "\ud7ff\ue000\ufffd\ufffe\uffff", "emoji \u{1F600} and \u{10000} and \u{10ffff}", "\u0085\u2028\u2029", "é ñ ಕ ക क", "&amp; already", "<![CDATA[x]]>", "", "\u001f\u0020", "a\u{1F600}b"];
  const csvs = ["plain", "a,b", "a\"b", "a\nb", "a\rb", "", " lead", "tr ail ", "é", "1,5", "'"];
  const rup = [0, 1, 9, 10, 99, 100, 101, 12345, 99999, 100000, 123456789, -1, -100, -12345, 9007199254740991, -9007199254740991, 9007199254740992];
  const fmt = [0, 1, 99, 100, 101, 1050, 45000, 45050, 99999, 100000, 100001, 123456789, 1234567890, 100000000000, 9007199254740991, -1, -100, 9007199254740992];
  const yesterdays = ["Asia/Kolkata", "UTC", "America/New_York"].flatMap((tz) => [Date.UTC(2026, 10, 10, 5), Date.UTC(2026, 2, 31, 18, 29), Date.UTC(2026, 2, 31, 18, 30), Date.UTC(2027, 0, 1, 0, 0), Date.UTC(2028, 2, 1, 0, 30), Date.UTC(2026, 10, 1, 4, 0)].map((ms) => ({ tz, ms, out: yesterdayOf(ms, tz) })));
  const docMisc = [{ status: "composition" as const, language: "hi" }, { status: undefined, language: "en" }].map((o) => {
    const rct = { number: "RCT/26-27/0001", series: "RCT", fy: "26-27", n: 1, seq: 1, at: "2026-11-02T05:00:00.000Z", case: "b-1", kind: "received", amountPaise: 45050, evidence: "provider", paymentId: "p1", method: "gateway" };
    const cn = { number: "CN/26-27/0001", series: "CN", fy: "26-27", n: 1, seq: 2, at: "2026-11-03T05:00:00.000Z", case: "b-1", kind: "refund_made", amountPaise: 100, evidence: "owner_mark", paymentId: "p1", method: "upi" };
    const cn2 = { ...cn, number: "CN/26-27/0002", seq: 3, case: "b-2" }; // another case: it must not cite b-1's receipt
    const noCase = { ...cn, number: "CN/26-27/0003", seq: 4, case: null, paymentId: undefined };
    return { ...o, docs: [rct, cn, cn2, noCase].map((doc) => ({ doc: jsonSafe(doc), out: makeDocument({ doc: doc as never, documents: [rct, cn, cn2, noCase] as never, shop: { ...SHOP, timezone: "Asia/Kolkata", ...(o.status ? { status: o.status } : {}) }, language: o.language as never, whatFor, person }) })) };
  });
  return {
    xml: xmlTexts.map((t) => ({ text: t, out: xml(t) })), csv: csvs.map((t) => ({ text: t, out: csvField(t) })),
    rupees: rup.map((p) => ({ paise: p, out: tryIt(() => rupees(p)) })), formatPaise: fmt.map((p) => ({ paise: p, out: tryIt(() => formatPaise(p)) })),
    yesterdays, docMisc, css: { customer: CUSTOMER_CSS.length, doc: DOC_CSS.length },
  };
}

export function generate(): Map<string, string> {
  const out = new Map<string, string>();
  out.set("accounting/testdata/numbers.json", stamp(numbers()));
  out.set("accounting/testdata/misc.json", stamp(misc()));
  for (const run of RUNS) {
    const d = derive(run);
    out.set(`accounting/testdata/world-${run.def.name}.json`, stamp(d.core));
    out.set(`accounting/testdata/files-${run.def.name}.json`, stamp(d.files));
    out.set(`accounting/testdata/pages-${run.def.name}.json`, stamp(d.pages));
  }
  return out;
}

/** The text of a vector file without its `node` member, so a newer Node that writes the same figures is not reported stale. */
const withoutNode = (text: string): string => { const o = JSON.parse(text); delete o.node; return JSON.stringify(o); };

export function staleFiles(root = INTERNAL): string[] {
  return [...generate()].filter(([name, text]) => !existsSync(join(root, name)) || withoutNode(readFileSync(join(root, name), "utf8")) !== withoutNode(text)).map(([name]) => name);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--check")) {
    const stale = staleFiles();
    if (stale.length) { console.error(`out of date: ${stale.join(", ")}  (run node go/scripts/gen_books_vectors.ts)`); process.exit(1); }
  } else {
    for (const [name, text] of generate()) { mkdirSync(dirname(join(INTERNAL, name)), { recursive: true }); writeFileSync(join(INTERNAL, name), text); }
    console.log(`written with Node ${process.version}`);
  }
}
