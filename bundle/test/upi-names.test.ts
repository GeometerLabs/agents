// B71 part 2 (checkpoint item 7): what a UPI shop is shown names no gateway. Each template's monthly report and go-live certificate for a UPI shop, and the limit
// lines its papers print, are rendered in all four languages and read for any gateway's name or id (from the provider registry, so a second gateway is covered
// when it is added). A gateway shop keeps its own words: this reads only what a shop on UPI gets.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GATEWAYS } from "../../modules/payments/providers/index.ts";
import { LANGUAGES } from "../../modules/language/languages.ts";
import type { RecordEntry } from "../../modules/record/record.ts";
import * as bookingsRun from "../../templates/commerce/bookings/report/run.ts";
import * as feesRun from "../../templates/education/fees/report/run.ts";
import * as ordersRun from "../../templates/commerce/orders/report/run.ts";
import * as bookingsPapers from "../../templates/commerce/bookings/report/papers.ts";
import * as feesPapers from "../../templates/education/fees/report/papers.ts";
import * as ordersPapers from "../../templates/commerce/orders/report/papers.ts";
import { glowSalon } from "../../templates/commerce/bookings/src/harness.ts";
import { brightTuition } from "../../templates/education/fees/src/harness.ts";
import { annapurna } from "../../templates/commerce/orders/src/harness.ts";

const UPI = { module: "upi", upi: { id: "shop@okicici", payee: "Test Shop" } };
const NAMES = new RegExp([...new Set(GATEWAYS.flatMap((g) => [g.id, g.displayName])), "rzp_"].join("|"), "iu");
const upiOf = <T>(settings: T): T => ({ ...JSON.parse(JSON.stringify(settings)), payment: UPI });
const HAND_CHECK = { held: 10, total: 10, checks: 40, failedTitles: [] as string[] };
const NOW = Date.UTC(2026, 11, 1, 6, 0);

/** Every text file under `dir`, with any gateway name it holds and the words around it. */
function named(dir: string): string[] {
  const out: string[] = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { out.push(...named(p)); continue; }
    const text = readFileSync(p, "utf8");
    const m = NAMES.exec(text);
    if (m) out.push(`${f}: …${text.slice(Math.max(0, m.index - 60), m.index + 30)}…`);
  }
  return out;
}

/** A UPI shop's money in the record: a request, the owner's mark, a refund owed and marked sent. */
const UPI_RECORD = (booking: string): RecordEntry[] => {
  const at = (n: number) => new Date(Date.UTC(2026, 10, 10, 6, n)).toISOString();
  const e = (seq: number, action: string, refs: Record<string, string>, outcome: RecordEntry["outcome"] = "confirmed"): RecordEntry =>
    ({ seq, time: at(seq), conversation: "c-1", booking, action: action as RecordEntry["action"], inputsDigest: "0123456789abcdef", outcome, decisions: [], language: "en", notes: "", refs });
  return [
    e(1, "upi_request", { requestId: "upi-1", reference: booking, amountPaise: "20000" }),
    e(2, "owner_marked_paid", { paymentId: "upi-pay-2", requestId: "upi-1", amountPaise: "20000", markedBy: "owner" }),
    e(3, "upi_refund_owed", { refundId: "upr-3", paymentId: "upi-pay-2", amountPaise: "20000" }, "held_for_owner"),
    e(4, "upi_refund_marked_done", { refundId: "upr-3", paymentId: "upi-pay-2", amountPaise: "20000" }),
  ];
};

const TEMPLATES = [
  { name: "bookings", settings: () => upiOf(glowSalon()), report: (s: any, language: string, out: string, entries: RecordEntry[]) => bookingsRun.writeClientReport({ settings: s, entries, bookings: [], month: "2026-11", language: language as any, out, source: "live", now: NOW }), cert: bookingsRun.writeGoLiveCertificate, papers: bookingsPapers, ref: "b-1" },
  { name: "fees", settings: () => upiOf(brightTuition()), report: (s: any, language: string, out: string, entries: RecordEntry[]) => feesRun.writeFeesReport({ settings: s, entries, dues: [], month: "2026-11", language: language as any, out, source: "live", now: NOW } as any), cert: feesRun.writeGoLiveCertificate, papers: feesPapers, ref: "f-1" },
  { name: "orders", settings: () => upiOf(annapurna()), report: (s: any, language: string, out: string, entries: RecordEntry[]) => ordersRun.writeOrdersReport({ settings: s, entries, orders: [], month: "2026-11", language: language as any, out, source: "live", now: NOW } as any), cert: ordersRun.writeGoLiveCertificate, papers: ordersPapers, ref: "o-1" },
];

for (const t of TEMPLATES) {
  test(`B71 part 2 (${t.name}): a UPI shop's monthly report, go-live certificate and papers' limits name no gateway, in any language`, () => {
    const settings = t.settings();
    const found: string[] = [];
    for (const language of LANGUAGES) {
      for (const entries of [[], UPI_RECORD(t.ref)]) {
        const out = mkdtempSync(join(tmpdir(), `upi-names-${t.name}-`));
        try { t.report(settings, language, out, entries); found.push(...named(out).map((x) => `${language} report: ${x}`)); } finally { rmSync(out, { recursive: true, force: true }); }
      }
      const out = mkdtempSync(join(tmpdir(), `upi-names-cert-${t.name}-`));
      try { (t.cert as any)({ settings, handCheck: HAND_CHECK, language, out, now: NOW }); found.push(...named(out).map((x) => `${language} certificate: ${x}`)); } finally { rmSync(out, { recursive: true, force: true }); }
      const lines = JSON.stringify(t.papers.limitFacts(settings, language as any));
      if (NAMES.test(lines)) found.push(`${language} papers' limits: ${lines.slice(0, 200)}`);
    }
    assert.deepEqual(found, [], "nothing a UPI shop is shown names a gateway");
  });
}
