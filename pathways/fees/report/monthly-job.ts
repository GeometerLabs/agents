// The monthly job for Fees: last month's report goes to the owner on WhatsApp, once, from 09:00 on the 1st. When it may go, the claim before the send and the ending
// after, the retries and the quiet month are the same for every template (modules/report/monthly-job.ts, which explains them). This file gives that job the Fees
// report: the page and the signed data (report/run.ts), and the message built from the report's own counts (report/whatsapp.ts).
import { randomBytes } from "node:crypto";
import type { KeyObject } from "node:crypto";
import { join } from "node:path";
import { createMonthlyJob } from "../../../modules/report/monthly-job.ts";
import type { MonthlyJobContext, MonthlyResult } from "../../../modules/report/monthly-job.ts";
import type { Store } from "../src/due.ts";
import type { Settings } from "../src/settings.ts";
import type { GoLiveFinding, Source } from "./data.ts";
import { writeFeesReport } from "./run.ts";
import { monthlyReportMessage } from "./whatsapp.ts";

export interface MonthlyReportSetup {
  /** What the numbers were counted from: written on the report and in the message. */
  source: Source;
  /** Where the report folders go (one folder per report, named by a random token) and the address that folder is served at (https, no trailing slash). */
  pages: { dir: string; baseUrl: string };
  /** Read when the report is made, so a change to the badge or the name needs no restart. */
  options: () => { preparedBy: string; innovator: boolean };
  /** Signs the report. Left out, it carries a digest and a code and says it is not signed. */
  key?: KeyObject;
  /** What the go-live certificate the centre was given shows. Left out, the report says none was given. */
  goLive?: () => GoLiveFinding;
  /** Test seam: the random part of the folder name. */
  token?: () => string;
}

export interface MonthlyReportContext extends MonthlyJobContext {
  settings: Settings;
  store: Store;
}

export type { MonthlyResult };

export function createMonthlyReport(setup: MonthlyReportSetup) {
  return createMonthlyJob<MonthlyReportContext>({
    make(ctx, { month, language, now }) {
      const { preparedBy, innovator } = setup.options();
      const token = (setup.token ?? (() => randomBytes(16).toString("hex")))();
      const folder = join(setup.pages.dir, token);
      const made = writeFeesReport({
        settings: ctx.settings, entries: ctx.record.entries(), dues: [...ctx.store.dues.values()], month, language, out: folder, source: setup.source,
        preparedBy, innovator, now, ...(setup.key ? { key: setup.key } : {}), ...(setup.goLive ? { goLive: setup.goLive() } : {}),
      });
      const message = monthlyReportMessage(made.report, language, { link: `${setup.pages.baseUrl}/${token}/report-${month}-${language}.html` });
      return { code: made.code, page: token, folder, message };
    },
  });
}
