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
import { buildFeesReport } from "./data.ts";
import type { FeesReport, Source } from "./data.ts";
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
  /** Epoch milliseconds the report is made at. */
  now: number;
}

/** The monthly report: the page, the owner text in each language, and the signed data. */
export function writeFeesReport(run: ReportRun): { files: string[]; ownerTexts: string[]; code: string; report: Envelope<FeesReport> } {
  const { from, to } = monthRange(run.month, run.settings.timezone);
  const report = buildFeesReport({ settings: run.settings, entries: run.entries, dues: run.dues, from, to, source: run.source, madeAt: run.now, preparedBy: run.preparedBy, innovator: run.innovator });
  const sealed = seal(report, run.key);
  const w = writer(run.out);
  const langs = languagesOf(run.language);
  w.write(`report-${run.month}.json`, envelopeFile(sealed));
  w.write(`report-${run.month}-${run.language}.html`, reportPage(sealed, run.language));
  for (const l of langs) w.write(`owner-${run.month}-${l}.txt`, `${ownerText(report, l)}\n`);
  return { files: w.files, ownerTexts: langs.map((l) => ownerText(report, l)), code: sealed.code, report: sealed };
}
