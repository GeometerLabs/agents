// Writes the TEST VECTORS of the Go Fees runtime's pure rules (go/internal/fees/testdata/rules-vectors.json.gz), made by RUNNING the TypeScript on Node (23 Nov 2026, stream FG).
// Until now internal/fees had no Go unit tests and no vectors: it was proved by the HTTP contract only, and the TypeScript unit tests that check these rules are to be deleted
// with the TypeScript runtime (decision 61). The owner's rule is that the only check on money or limits is never pruned, so each pure rule is held here, case by case:
//   - the month's fee (src/joining.ts feeForMonth under every joining rule, parseJoined) and the month's schedule (src/due.ts dueMsOf, reminderMomentsOf, lateFeeFrom,
//     backDueReminderAt) on the example centres and on centres with other reminder days, hours, grace days and time zones (one with a daylight-saving change);
//   - the limits (src/limits.ts: fee-link-matches-record, reminder-cap, waiver-limit, one-refund-per-payment, refund-limit), their verdicts and their words;
//   - the class-access rule and the grace days (src/classes/rules.ts checkClassAccess, isPastGrace), back dues with and without oldDuesStopLink;
//   - the settings (src/settings.ts validateSettings): every refusal sentence in its order for a set of wrong files (back dues, the joining rule, part payments, the limits,
//     the payment block, approvers, Classes), and the checked values of accepted ones.
// The Go test (go/internal/fees/rules_test.go) runs its twins on the same inputs and compares. The vectors name the Node that made them (left out of the comparison).
// Run from the repository root:  node go/scripts/gen_fees_vectors.ts   (--check only compares and exits 1; the listings contract's words-fresh test calls `staleFiles`)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { feeForMonth, parseJoined, JOINING_RULES } from "../../templates/education/fees/src/joining.ts";
import { backDueReminderAt, dueMsOf, lateFeeFrom, reminderMomentsOf } from "../../templates/education/fees/src/due.ts";
import { checkFeeLink, checkOneRefundPerPayment, checkRefundLimit, checkReminderCap, checkWaiver } from "../../templates/education/fees/src/limits.ts";
import { checkClassAccess, isPastGrace } from "../../templates/education/fees/src/classes/rules.ts";
import type { FeeSnapshot } from "../../templates/education/fees/src/classes/rules.ts";
import { validateSettings } from "../../templates/education/fees/src/settings.ts";
import type { Settings } from "../../templates/education/fees/src/settings.ts";
import { zonedToMs } from "../../modules/core/time.ts";
import type { LocalDate } from "../../modules/core/time.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const OUT = join(here, "..", "internal");
const FILE = "fees/testdata/rules-vectors.json.gz";
const SETTINGS = join(here, "..", "..", "templates", "education", "fees", "settings");
const example = (name: string): Record<string, any> => JSON.parse(readFileSync(join(SETTINGS, name), "utf8"));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const stamp = (v: unknown): string => JSON.stringify({ node: process.version, ...(v as object) }, null, 1) + "\n";
const EXAMPLES = ["bright-tuition.example.json", "bright-tuition-upi.example.json", "bright-tuition-classes.example.json", "maths-circle.example.json"];

// ---- the month's fee ----
function feeCases() {
  const joined: (string | null)[] = [null, "2026-11-01", "2026-11-20", "2026-11-30", "2026-02-15", "2028-02-29", "2026-12-31", "2027-01-02"];
  const months = [[2026, 10], [2026, 11], [2026, 12], [2027, 1], [2026, 2], [2028, 2]];
  const fees = [1800, 1500, 1200, 999, 1, 7];
  const out: unknown[] = [];
  for (const rule of JOINING_RULES) for (const j of joined) for (const [year, month] of months) for (const monthly of fees) {
    out.push({ rule, monthly, joined: j, year, month, out: feeForMonth(rule, monthly, j === null ? undefined : parseJoined(j), year, month) });
  }
  return out;
}
const joinedCases = () => ["2026-11-18", "2026-02-29", "2028-02-29", "2026-13-01", "2026-00-10", "2026-11-31", "2026-1-5", " 2026-11-18", "2026-11-18T00:00", "", "abcd-ef-gh", "0000-01-01"]
  .map((text) => ({ text, out: parseJoined(text) ?? null }));

// ---- the month's schedule ----
function scheduleCases() {
  const variants: [string, Record<string, any>][] = [];
  for (const name of EXAMPLES) variants.push([name, example(name)]);
  const base = example("bright-tuition.example.json");
  const vary = (label: string, change: (s: Record<string, any>) => void) => { const s = clone(base); change(s); variants.push([`bright-tuition.example.json: ${label}`, s]); };
  vary("reminders before, on and long after, at 18:00", (s) => { s.reminders = { daysFromDue: [-7, -1, 0, 3, 20], hour: 18, maxPerMonth: 5 }; });
  vary("no grace days, due on the 28th", (s) => { s.due = { day: 28, graceDays: 0 }; });
  vary("ten grace days, due on the 1st, reminders at 06:00", (s) => { s.due = { day: 1, graceDays: 10 }; s.reminders = { daysFromDue: [0, 2], hour: 6, maxPerMonth: 2 }; });
  vary("New York (a daylight-saving change on 1 Nov 2026 and 14 Mar 2027)", (s) => { s.timezone = "America/New_York"; });
  vary("Dubai", (s) => { s.timezone = "Asia/Dubai"; s.reminders = { daysFromDue: [-3, 0], hour: 21, maxPerMonth: 2 }; });
  const dates: LocalDate[] = [{ year: 2026, month: 11, day: 5 }, { year: 2026, month: 11, day: 1 }, { year: 2026, month: 12, day: 31 }, { year: 2027, month: 2, day: 28 }, { year: 2028, month: 2, day: 29 }, { year: 2027, month: 3, day: 14 }, { year: 2026, month: 11, day: 20 }];
  const nows = [zonedToMs({ year: 2026, month: 11, day: 2 }, { hour: 9, minute: 0 }, "Asia/Kolkata"), zonedToMs({ year: 2026, month: 11, day: 2 }, { hour: 23, minute: 59 }, "Asia/Kolkata"), zonedToMs({ year: 2027, month: 3, day: 14 }, { hour: 1, minute: 30 }, "UTC")];
  const out: unknown[] = [];
  for (const [name, raw] of variants) {
    const v = validateSettings(raw);
    if (!v.ok) throw new Error(`${name}: ${v.errors.join(" ")}`);
    const s: Settings = v.settings;
    out.push({
      name, settings: raw,
      dates: dates.map((date) => ({ date, dueMs: dueMsOf(s, date), moments: reminderMomentsOf(s, date), lateFeeFrom: lateFeeFrom(s, date) })),
      backDue: nows.map((nowMs) => ({ nowMs, at: backDueReminderAt(s, nowMs) })),
    });
  }
  return out;
}

// ---- the limits ----
function limitCases() {
  const out: { check: string; input: Record<string, unknown>; out: unknown }[] = [];
  for (const [amountInr, balanceInr, highestInr] of [[1800, 1800, 1900], [0, 1800, 1900], [1700, 1800, 1900], [2000, 2000, 1900], [1, 1, 1], [1234567, 1234567, 2000000]]) out.push({ check: "feeLink", input: { amountInr, balanceInr, highestInr }, out: checkFeeLink({ amountInr, balanceInr, highestInr }) });
  for (const [sent, maxPerMonth] of [[0, 4], [3, 4], [4, 4], [5, 4], [0, 0], [1, 1]]) out.push({ check: "reminderCap", input: { sent, maxPerMonth }, out: checkReminderCap({ sent, maxPerMonth }) });
  for (const [amountInr, balanceInr, alreadyWaivedInr, limitInr, ownerApproved] of [[100, 1800, 0, 100, false], [101, 1800, 0, 100, false], [50, 1800, 60, 100, false], [40, 1800, 60, 100, false], [500, 1800, 0, 100, true], [1900, 1800, 0, 5000, false], [1900, 1800, 0, 5000, true], [0, 1800, 0, 100, false], [1800, 1800, 0, 0, false], [1, 0, 0, 100, false]] as const) {
    out.push({ check: "waiver", input: { amountInr, balanceInr, alreadyWaivedInr, limitInr, ownerApproved }, out: checkWaiver({ amountInr, balanceInr, alreadyWaivedInr, limitInr, ownerApproved }) });
  }
  for (const [paymentId, refundedPaise] of [["pay_1", 0], ["pay_2", 1], ["pay_3", 180000]] as const) out.push({ check: "oneRefund", input: { paymentId, refundedPaise }, out: checkOneRefundPerPayment({ paymentId, refundedPaise }) });
  // paidInr null is "not given" (undefined in the TypeScript); a paid amount in paise that is not whole rupees is how a part payment reads
  for (const [amountInr, limitInr, paidInr, ownerApproved] of [[400, 500, 1800, false], [500, 500, 1800, false], [501, 500, 1800, false], [501, 500, 1800, true], [1900, 500, 1800, true], [1801, 5000, 1800.5, false], [1800, 5000, 1800.5, false], [0, 500, 1800, false], [-5, 500, null, false], [700, 500, null, false], [700, 500, null, true]] as const) {
    out.push({ check: "refundLimit", input: { amountInr, limitInr, paidInr, ownerApproved }, out: checkRefundLimit({ amountInr, limitInr, ...(paidInr !== null ? { paidInr } : {}), ownerApproved }) });
  }
  return out;
}

// ---- the class-access rule ----
function accessCases() {
  const tz = "Asia/Kolkata";
  const at = (day: number, hour: number) => zonedToMs({ year: 2026, month: 11, day }, { hour, minute: 0 }, tz);
  const ordinary = (day: number, state: FeeSnapshot["state"] = "open", balancePaise = 180_000): FeeSnapshot => ({ state, dueDate: { year: 2026, month: 11, day }, balancePaise });
  const back = (state: FeeSnapshot["state"] = "open"): FeeSnapshot => ({ state, dueDate: { year: 2026, month: 9, day: 1 }, balancePaise: state === "open" ? 90_000 : 0, backDue: true });
  const grace: unknown[] = [];
  for (const fee of [ordinary(5), ordinary(5, "paid", 0), ordinary(5, "open", 0), ordinary(5, "closed"), back(), back("paid")]) for (const graceDays of [0, 5, 10]) for (const nowMs of [at(5, 9), at(10, 23), at(11, 0), at(11, 1), at(16, 0)]) {
    grace.push({ fee, graceDays, nowMs, tz, out: isPastGrace(fee, graceDays, nowMs, tz) });
  }
  const access: unknown[] = [];
  const base = { inBatch: true, consent: "yes" as const, readOk: true, graceDays: 5, timeZone: tz, nowMs: at(12, 9) };
  const inputs = [
    { ...base, fees: [] }, { ...base, inBatch: false, fees: [] }, { ...base, consent: "no" as const, fees: [] }, { ...base, consent: "waiting" as const, fees: [] }, { ...base, consent: "adult" as const, fees: [ordinary(10)] },
    { ...base, readOk: false, fees: [] }, { ...base, fees: [ordinary(5)] }, { ...base, fees: [ordinary(10)] }, { ...base, fees: [back(), ordinary(10)] }, { ...base, oldDuesStopLink: false, fees: [back()] },
    { ...base, oldDuesStopLink: true, fees: [back(), ordinary(10)] }, { ...base, fees: [back(), ordinary(5)] }, { ...base, oldDuesStopLink: true, fees: [back(), ordinary(5)] },
    { ...base, fees: [back("paid"), ordinary(10)] }, { ...base, oldDuesStopLink: true, fees: [back("closed"), ordinary(10)] }, { ...base, fees: [ordinary(5, "paid", 0), ordinary(5, "closed")] },
  ];
  for (const input of inputs) access.push({ input, out: checkClassAccess(input) });
  return { grace, access };
}

// ---- the settings: refusal sentences and checked values ----
function settingsCases() {
  const muts: [string, string, (s: Record<string, any>) => void][] = [
    ["bright-tuition.example.json", "as it is", () => {}],
    ["bright-tuition-upi.example.json", "as it is", () => {}],
    ["bright-tuition-classes.example.json", "as it is", () => {}],
    ["maths-circle.example.json", "as it is", () => {}],
    ["bright-tuition.example.json", "back dues: one each, the most there may be, and none", (s) => { s.students[0].backDues = [{ month: "2026-09", amountInr: 1800 }]; s.students[1].backDues = Array.from({ length: 12 }, (_, i) => ({ month: `2025-${String(i + 1).padStart(2, "0")}`, amountInr: 1200 })); s.students[2].backDues = []; }],
    ["bright-tuition.example.json", "back dues that are wrong", (s) => { s.students[0].backDues = [{ month: "2026-9", amountInr: 1800 }, { month: "2026-09", amountInr: 0 }, { month: "2026-09", amountInr: 1800 }, { amountInr: 5 }, "x"]; s.students[1].backDues = Array.from({ length: 13 }, (_, i) => ({ month: `2024-${String((i % 12) + 1).padStart(2, "0")}`, amountInr: 1200 })); s.students[2].backDues = { month: "2026-09" }; }],
    ["bright-tuition.example.json", "the joining rule and joining days", (s) => { s.joiningMidMonth = "prorata"; s.students[0].joined = "2026-11-18"; s.students[1].joined = "2026-02-30"; s.students[2].joined = 20261118; }],
    ["bright-tuition.example.json", "an unknown joining rule", (s) => { s.joiningMidMonth = "half"; }],
    ["bright-tuition.example.json", "part payments above the cheapest fee", (s) => { s.partPayments = { allowed: true, minInr: 5000 }; }],
    ["bright-tuition.example.json", "part payments in a wrong shape", (s) => { s.partPayments = { allowed: "yes", minInr: -1, extra: 1 }; }],
    ["bright-tuition.example.json", "a waiver limit above the cheapest fee, no refund limit", (s) => { s.waiver = { limitInr: 5000 }; delete s.refund; }],
    ["bright-tuition.example.json", "limits that are not whole rupees", (s) => { s.waiver = { limitInr: 10.5 }; s.refund = { limitInr: "500" }; s.lateFeeInr = -1; }],
    ["bright-tuition.example.json", "a due day and grace days out of range", (s) => { s.due = { day: 31, graceDays: 40 }; }],
    ["bright-tuition.example.json", "reminders out of range and twice", (s) => { s.reminders = { daysFromDue: [-40, 0, 0, 3.5], hour: 25, maxPerMonth: 0 }; }],
    ["bright-tuition.example.json", "no reminder days", (s) => { s.reminders = { daysFromDue: [], hour: 10, maxPerMonth: 4 }; }],
    ["bright-tuition.example.json", "a null payment block", (s) => { s.payment = null; }],
    ["bright-tuition.example.json", "an empty payment block", (s) => { s.payment = {}; }],
    ["bright-tuition.example.json", "no payment block", (s) => { delete s.payment; }],
    ["bright-tuition.example.json", "a UPI block with a bad id", (s) => { s.payment = { module: "upi", upi: { id: "not an id", payee: "" } }; }],
    ["bright-tuition.example.json", "an approver who is a parent", (s) => { s.approvers = { people: [{ id: "ravi", whatsapp: s.students[0].parent, language: "en" }] }; }],
    ["bright-tuition.example.json", "an approver who is not a parent", (s) => { s.approvers = { people: [{ id: "ravi", whatsapp: "+919800000002", language: "en" }] }; }],
    ["bright-tuition.example.json", "a student in no batch, twice, and with an unknown language", (s) => { s.students.push({ name: "Zed", parent: "+919800000009", batch: "class-12" }); s.students.push({ ...s.students[0] }); s.students[1].language = "fr"; }],
    ["bright-tuition.example.json", "a parent who is the owner", (s) => { s.students[0].parent = s.owner.whatsapp; }],
    ["bright-tuition-classes.example.json", "a classes block with an unknown key and a wrong lead time", (s) => { s.classes.when = 1; s.classes.linkLeadMinutes = 0; }],
    ["bright-tuition-classes.example.json", "old dues stop the link", (s) => { s.classes.oldDuesStopLink = true; }],
    ["bright-tuition.example.json", "unknown top-level keys and no name", (s) => { s.colour = "red"; s.name = "  "; }],
    // the credit book (src/credit/settings.ts): the example as it is, the defaults, and every refusal
    ["hardware-credit.example.json", "as it is", () => {}],
    ["hardware-credit.example.json", "an empty block: the defaults and nobody yet", (s) => { s.creditBook = {}; }],
    ["hardware-credit.example.json", "a Razorpay shop with a due rule given", (s) => { s.payment = { module: "razorpay" }; s.due = { day: 10 }; }],
    ["hardware-credit.example.json", "a block that is not an object", (s) => { s.creditBook = [1]; }],
    ["hardware-credit.example.json", "limits out of range and an unknown key", (s) => { s.creditBook.maxPerPersonInr = 0; s.creditBook.remindEveryDays = 61; s.creditBook.colour = 1; }],
    ["hardware-credit.example.json", "people who are wrong", (s) => { s.creditBook.people.push({ name: "  ramesh ", phone: "+919845044444", amountInr: 10 }, { name: "Ravi 2", phone: s.owner.whatsapp, amountInr: 0.5 }, { name: "Bina", phone: "+919845011111", amountInr: 60000, language: "fr", city: "x" }, "x", { phone: "98450" }); }],
    ["hardware-credit.example.json", "people that are not a list", (s) => { s.creditBook.people = { name: "Ramesh" }; }],
    ["hardware-credit.example.json", "what a credit shop has not", (s) => { s.batches = []; s.students = []; s.lateFeeInr = 50; s.joiningMidMonth = "full"; s.classes = {}; s.waiver = { limitInr: 100 }; }],
    ["hardware-credit.example.json", "a late fee of 0 and a waiver limit of 0", (s) => { s.lateFeeInr = 0; s.waiver = { limitInr: 0 }; }],
  ];
  return muts.map(([file, label, change]) => {
    const s = example(file);
    change(s);
    const text = JSON.stringify(s);
    const v = validateSettings(JSON.parse(text));
    return {
      name: `${file}: ${label}`, text,
      ...(v.ok
        ? { errors: [], checked: { joiningMidMonth: v.settings.joiningMidMonth ?? "usual", payment: v.settings.payment.module, due: v.settings.due, reminders: v.settings.reminders, lateFeeInr: v.settings.lateFeeInr, waiverInr: v.settings.waiver.limitInr, refundInr: v.settings.refund.limitInr, partPayments: v.settings.partPayments, students: v.settings.students.map((x) => ({ name: x.name, batch: x.batchId, language: x.language ?? null, joined: x.joined ?? null, backDues: x.backDues ?? [] })), oldDuesStopLink: v.settings.classes?.oldDuesStopLink ?? null, credit: v.settings.creditBook ?? null } }
        : { errors: v.errors }),
    };
  });
}

export function generate(): Map<string, Buffer> {
  const access = accessCases();
  const body = { fees: feeCases(), joined: joinedCases(), schedule: scheduleCases(), limits: limitCases(), grace: access.grace, access: access.access, settings: settingsCases() };
  return new Map([[FILE, gzipSync(Buffer.from(stamp(body)), { level: 9 })]]);
}

const withoutNode = (text: string): string => { const o = JSON.parse(text); delete o.node; return JSON.stringify(o); };

export function staleFiles(root = OUT): string[] {
  const stale: string[] = [];
  for (const [name, v] of generate()) {
    const path = join(root, name);
    if (!existsSync(path) || withoutNode(gunzipSync(readFileSync(path)).toString("utf8")) !== withoutNode(gunzipSync(v).toString("utf8"))) stale.push(name);
  }
  return stale;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--check")) {
    const stale = staleFiles();
    if (stale.length) { console.error(`out of date: ${stale.join(", ")}  (run node go/scripts/gen_fees_vectors.ts)`); process.exit(1); }
    console.log("the Fees rules vectors are fresh");
  } else {
    for (const [name, v] of generate()) { mkdirSync(dirname(join(OUT, name)), { recursive: true }); writeFileSync(join(OUT, name), v); }
    console.log(`written with Node ${process.version}`);
  }
}
