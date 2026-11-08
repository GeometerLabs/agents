// Makes a centre's monthly report from the agent's saved record and fees, in the centre's language.
//   node templates/education/fees/scripts/client-report.ts --settings centre.json --record entries.json --dues dues.json \
//        --month 2026-11 --lang hi --out ./out --source stand-in --go-live ./go-live-certificate.json [--key ~/geometer-keys/report-key.pem] [--prepared-by "Divya, local partner"] [--innovator]
// --record is the whole action record (a list of entries, oldest first); --dues is the conversation store's fees (what the deploy bundle exports to exports/<shop>/dues.json).
// --lang is hi, en, ml, kn, or both (Hindi and English, as two messages and one page). --source says what the numbers were counted from (stand-in, test-mode or live) and is
// written on every layer; there is no default.
// --go-live is the go-live certificate (go-live-certificate.json from go-live-certificate.ts). Its signature is checked, and what its checks ran on (this centre's own
// settings, Bright Tuition Centre's example, or other settings) is written into the report. Without it, or with a file that is missing, unsigned, changed or not a go-live
// certificate of Fees, the script says so in one plain sentence, the report says so too, and the files are still written.
// --innovator puts the Innovator badge on the report (for the first 100 builders and partners; fleet's answer for the shop says so).
// Without --key the files are not signed, and the script says so. Files are written into --out and nowhere else.
import { parseArgs } from "node:util";
import { UsageError, main, readDues, readEntries, readGoLive, readKey, readLanguage, readNow, readSettings, readSource } from "../report/cli.ts";
import { writeFeesReport } from "../report/run.ts";
import { ledgerTenant } from "../../../../modules/report/cli.ts";

await main(async () => {
  let args;
  try {
    args = parseArgs({ args: process.argv.slice(2), options: {
      settings: { type: "string" }, record: { type: "string" }, dues: { type: "string" }, month: { type: "string" }, lang: { type: "string" }, out: { type: "string" },
      key: { type: "string" }, source: { type: "string" }, "prepared-by": { type: "string" }, innovator: { type: "boolean" }, now: { type: "string" }, "go-live": { type: "string" }, tenant: { type: "string" },
    } });
  } catch (e) { throw new UsageError(`${(e as Error).message}\nSee the first lines of templates/education/fees/scripts/client-report.ts for the options.`); }
  const o = args.values;
  if (!o.month) throw new UsageError("Say which month: --month 2026-11.");
  if (!o.out) throw new UsageError("Say which folder to write into: --out <folder>.");
  const settings = readSettings(o.settings);
  const goLive = readGoLive(o["go-live"], settings); // never stops the report: what is wrong with it is said, here and in the report
  const run = {
    settings, entries: readEntries(o.record), dues: readDues(o.dues), month: o.month, language: readLanguage(o.lang), out: o.out,
    source: readSource(o.source), key: readKey(o.key), preparedBy: o["prepared-by"], innovator: o.innovator === true, now: readNow(o.now), goLive: goLive.finding, ...ledgerTenant(o.tenant, settings.name),
  };
  const result = writeFeesReport(run);
  console.log(run.key ? "Signed with your key." : "NOT signed (no --key): the files carry a digest and a code, but nothing shows who issued them.");
  console.log(goLive.said);
  console.log(run.tenant ? `Anchored to the head of the record as ledger ${run.tenant} (pass the same --tenant to every paper of this centre).` : "Not anchored to the record's ledger: give --tenant <the centre's id>.");
  console.log(`Wrote ${result.files.length} files into ${o.out}:`);
  for (const f of result.files) console.log(`  ${f}`);
  console.log(`\nReport code ${result.code}.\n\nFor the owner, ready for WhatsApp:\n`);
  console.log(result.ownerTexts.join("\n\n"));
});
