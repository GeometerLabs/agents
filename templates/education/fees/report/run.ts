// Making the files: the scripts and the tests both call this. Everything is written into the one folder the caller names (--out) and nowhere else: file names are
// fixed here and never contain a path.
import type { KeyObject } from "node:crypto";
import type { RecordEntry } from "../../../../modules/record/record.ts";
import { monthRange, writer } from "../../../../modules/report/months.ts";
import { envelopeFile, seal } from "../../../../modules/report/sign.ts";
import type { Envelope } from "../../../../modules/report/sign.ts";
import { languagesOf } from "../../../../modules/report/text.ts";
import type { ReportLanguage } from "../../../../modules/report/text.ts";
import type { Due } from "../src/due.ts";
import type { Settings } from "../src/settings.ts";
import { buildGoLiveCertificate, goLivePage, goLiveText } from "./certificate.ts";
import type { HandCheckSummary } from "./certificate.ts";
import { buildFeesReport } from "./data.ts";
import type { FeesReport, GoLiveFinding, Source } from "./data.ts";
import { reportPage } from "./html.ts";
import { ownerText } from "./text.ts";

export interface ReportRun {
  settings: Settings;
  entries: readonly RecordEntry[];
  /** The fees as they are now: what is still to collect is read from them. */
  dues: readonly Due[];
  /** "2026-11" */
  month: string;
  language: ReportLanguage;
  out: string;
  source: Source;
  key?: KeyObject;
  preparedBy?: string;
  /** The builder or partner has the Innovator badge: the report carries it. */
  innovator?: boolean;
  /** What the go-live certificate the centre was given shows (report/go-live.ts). Left out, the report says that none was given. */
  goLive?: GoLiveFinding;
  /** Epoch milliseconds the report is made at. */
  now: number;
  /** The ledger tenant (the centre's id on the server) to anchor the report to its record's head. Left out, the report's anchor is null. */
  tenant?: string;
}

/** The monthly report: the page, the owner text in each language, and the signed data. */
export function writeFeesReport(run: ReportRun): { files: string[]; ownerTexts: string[]; code: string; report: Envelope<FeesReport> } {
  const { from, to } = monthRange(run.month, run.settings.timezone);
  const report = buildFeesReport({ settings: run.settings, entries: run.entries, dues: run.dues, from, to, source: run.source, madeAt: run.now, preparedBy: run.preparedBy, innovator: run.innovator, goLive: run.goLive, ...(run.tenant ? { ledger: { tenant: run.tenant } } : {}) });
  const sealed = seal(report, run.key);
  const w = writer(run.out);
  const langs = languagesOf(run.language);
  w.write(`report-${run.month}.json`, envelopeFile(sealed));
  w.write(`report-${run.month}-${run.language}.html`, reportPage(sealed, run.language));
  for (const l of langs) w.write(`owner-${run.month}-${l}.txt`, `${ownerText(report, l)}\n`);
  return { files: w.files, ownerTexts: langs.map((l) => ownerText(report, l)), code: sealed.code, report: sealed };
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
