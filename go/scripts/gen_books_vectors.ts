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
    rounds: [...Array.from({ length: 20001 }, (_, k) => k / 100), 0.5 / 100, 1.005, 2.675, 0.285, 1.255, 12.345, 0.001, 0.005, 0.004999, 123456.789, 1e6 + 0.005, -0.005, -1.005, 0.07, 0.29, 1.1, 8.2].map((inr) => ({ inr, p: Math.round(inr * 100) })),
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

export function generate(): Map<string, string> {
  const out = new Map<string, string>();
  out.set("accounting/testdata/numbers.json", stamp(numbers()));
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
