// The monthly report and certificate of an agent someone else wrote: the template's own report code (templates/commerce/bookings/report/), run on the record this bundle built from the Guards'
// decisions (agent/record.ts). The report says which agent it is of ("own-agent"), what it was counted from, and, as for a template, what it cannot say. If the agent has a go-live
// certificate (exports/<agent>/go-live-certificate.json, from `geometer agent go-live`), the report says what its checks ran on; without one it lists the go-live checks as not given.
import { existsSync, readFileSync } from "node:fs";
import { writeClientReport } from "../../templates/commerce/bookings/report/run.ts";
import { readGoLiveCertificate } from "../../templates/commerce/bookings/report/go-live.ts";
import type { Source } from "../../templates/commerce/bookings/report/data.ts";
import type { ReportLanguage } from "../../modules/report/text.ts";
import { loadPrivateKey } from "../../modules/report/sign.ts";
import type { RecordEntry } from "../../modules/record/record.ts";
import type { Booking } from "../../templates/commerce/bookings/src/booking.ts";
import { secretFile } from "../lib/secrets.ts";
import { serverPaths } from "../lib/server.ts";
import { BUNDLE_VERSION } from "../lib/server.ts";
import { readAgent } from "./folder.ts";

export interface AgentReportOptions { month: string; out: string; language: ReportLanguage; source: Source; now: number; preparedBy?: string }

/**
 * Write the report for one month into `out`. The record is the one the deployer exported (exports/<agent>/record.json), signed with the server's signing key when it has one
 * (the panel's, secrets/panel/signing_key) and unsigned, with its digest, when it has not.
 */
export function writeAgentReport(dir: string, agent: string, o: AgentReportOptions): ReturnType<typeof writeClientReport> & { goLiveSaid?: string } {
  const folder = readAgent(dir, agent);
  if (!folder.settings) throw new Error(`${agent}'s settings are not usable: ${folder.problems.join(" ")}`);
  const exported = serverPaths(dir).exportsOf(agent);
  if (!existsSync(`${exported}/record.json`)) throw new Error(`There is no record for ${agent} yet. It is made from the Guards' decisions: run \`geometer agent record ${agent}\` (the deployer also does it every five minutes).`);
  const entries = JSON.parse(readFileSync(`${exported}/record.json`, "utf8")) as RecordEntry[];
  const bookings = JSON.parse(readFileSync(`${exported}/bookings.json`, "utf8")) as Booking[];
  const keyFile = secretFile(dir, "panel", "signing_key");
  // the go-live certificate `geometer agent go-live` wrote, read the way a template's is: it must be signed, and its checks must have run on these settings
  const certificate = `${exported}/go-live-certificate.json`;
  const goLive = existsSync(certificate) ? readGoLiveCertificate(readFileSync(certificate, "utf8"), folder.settings) : undefined;
  const made = writeClientReport({
    settings: folder.settings, entries, bookings, month: o.month, language: o.language, out: o.out, source: o.source, now: o.now,
    ...(existsSync(keyFile) ? { key: loadPrivateKey(keyFile) } : {}), ...(o.preparedBy ? { preparedBy: o.preparedBy } : {}), ...(goLive ? { goLive: goLive.finding } : {}),
    pathway: { name: "own-agent", version: BUNDLE_VERSION },
  });
  return { ...made, goLiveSaid: goLive?.said };
}
