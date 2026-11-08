// Making the files: the scripts and the tests both call these. Everything is written into the one folder the caller names
// (--out) and nowhere else: file names are fixed here and never contain a path.
import type { KeyObject } from "node:crypto";
import type { Booking } from "../src/booking.ts";
import type { RecordEntry } from "../../../../modules/record/record.ts";
import type { Settings } from "../src/settings.ts";
import { buildGoLiveCertificate, buildMonthlyCertificate, goLivePage, goLiveText, monthlyCertificatePage, monthlyCertificateText } from "./certificate.ts";
import type { HandCheckSummary } from "./certificate.ts";
import { buildMonthlyReport } from "./data.ts";
import { monthRange, writer } from "../../../../modules/report/months.ts";
import type { GoLiveFinding, MonthlyReport, Source } from "./data.ts";
import { reportPage } from "./html.ts";
import { envelopeFile, seal } from "../../../../modules/report/sign.ts";
import type { Envelope } from "../../../../modules/report/sign.ts";
import { ownerText } from "./text.ts";
import { languagesOf } from "../../../../modules/report/text.ts";
import type { ReportLanguage } from "../../../../modules/report/text.ts";

export interface ReportRun {
  settings: Settings;
  entries: readonly RecordEntry[];
  bookings: readonly Booking[];
  /** "2026-11" */
  month: string;
  language: ReportLanguage;
  out: string;
  source: Source;
  key?: KeyObject;
  preparedBy?: string;
  /** The builder or partner has the Innovator badge: the report and its certificate carry it (report/data.ts). */
  innovator?: boolean;
  /** What the go-live certificate the shop was given shows (report/go-live.ts). Left out, the report and its certificate say that none was given. */
  goLive?: GoLiveFinding;
  /** Epoch milliseconds the report is made at. */
  now: number;
  /** Which agent the record is of; left out, the bookings pathway (see ReportInput.pathway). */
  pathway?: { name: string; version: string };
  /** The ledger tenant (the shop's id on the server) to anchor the report to its record's head. Left out, the report's anchor is null. */
  tenant?: string;
}

/** The monthly report (page, owner text, signed data) and the monthly record certificate (page, text, signed data). */
export function writeClientReport(run: ReportRun): { files: string[]; ownerTexts: string[]; code: string; certificateCode: string; report: Envelope<MonthlyReport> } {
  const { from, to } = monthRange(run.month, run.settings.timezone);
  const report = buildMonthlyReport({ settings: run.settings, entries: run.entries, bookings: run.bookings, from, to, source: run.source, madeAt: run.now, preparedBy: run.preparedBy, innovator: run.innovator, goLive: run.goLive, pathway: run.pathway, ...(run.tenant ? { ledger: { tenant: run.tenant } } : {}) });
  const sealed = seal(report, run.key);
  const certificate = seal(buildMonthlyCertificate(sealed, run.now), run.key);
  const w = writer(run.out);
  const langs = languagesOf(run.language);
  const suffix = run.language;
  w.write(`report-${run.month}.json`, envelopeFile(sealed));
  w.write(`report-${run.month}-${suffix}.html`, reportPage(sealed, run.language));
  for (const l of langs) w.write(`owner-${run.month}-${l}.txt`, `${ownerText(report, l)}\n`);
  w.write(`certificate-${run.month}.json`, envelopeFile(certificate));
  w.write(`certificate-${run.month}-${suffix}.html`, monthlyCertificatePage(certificate, run.language));
  for (const l of langs) w.write(`certificate-${run.month}-${l}.txt`, `${monthlyCertificateText(certificate, l)}\n`);
  return { files: w.files, ownerTexts: langs.map((l) => ownerText(report, l)), code: sealed.code, certificateCode: certificate.code, report: sealed };
}

export interface GoLiveRun {
  settings: Settings;
  handCheck: HandCheckSummary;
  language: ReportLanguage;
  out: string;
  key?: KeyObject;
  preparedBy?: string;
  now: number;
}

/** The go-live certificate (page, text, signed data) from one hand-check run. */
export function writeGoLiveCertificate(run: GoLiveRun): { files: string[]; texts: string[]; code: string } {
  const sealed = seal(buildGoLiveCertificate({ settings: run.settings, handCheck: run.handCheck, issuedAt: run.now, preparedBy: run.preparedBy }), run.key);
  const w = writer(run.out);
  const langs = languagesOf(run.language);
  w.write("go-live-certificate.json", envelopeFile(sealed));
  w.write(`go-live-certificate-${run.language}.html`, goLivePage(sealed, run.language));
  for (const l of langs) w.write(`go-live-certificate-${l}.txt`, `${goLiveText(sealed, l)}\n`);
  return { files: w.files, texts: langs.map((l) => goLiveText(sealed, l)), code: sealed.code };
}
