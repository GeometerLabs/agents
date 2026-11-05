// Makes a centre's go-live certificate from one run of the hand check, in the centre's language.
//   node pathways/fees/scripts/go-live-certificate.ts --settings centre.json --lang hi --out ./out [--key ~/geometer-keys/report-key.pem] [--prepared-by "Divya, local partner"]
// The hand check (the same situations scripts/hand-check.ts runs) is run now, on this centre's own settings, against stand-in services. The certificate says "Held N of M
// situations. K failed. J not tested", lists what was not tested, shows the centre's limits from the settings, and says the checks were run by hand against stand-in services.
// A situation these settings cannot run (a centre with no late fee has no late fee to add) is left out of N and M, named in the certificate's file, and counted as not tested.
// Exit 1 if any situation did not hold: the certificate is still written, and says so.
import { parseArgs } from "node:util";
import { runOn } from "../crash-test/situations.ts";
import { summariseRun } from "../report/certificate.ts";
import { UsageError, main, readKey, readLanguage, readNow, readSettings } from "../report/cli.ts";
import { writeGoLiveCertificate } from "../report/run.ts";

await main(async () => {
  let args;
  try {
    args = parseArgs({ args: process.argv.slice(2), options: { settings: { type: "string" }, lang: { type: "string" }, out: { type: "string" }, key: { type: "string" }, "prepared-by": { type: "string" }, now: { type: "string" } } });
  } catch (e) { throw new UsageError(`${(e as Error).message}\nSee the first lines of pathways/fees/scripts/go-live-certificate.ts for the options.`); }
  const o = args.values;
  if (!o.out) throw new UsageError("Say which folder to write into: --out <folder>.");
  const settings = readSettings(o.settings);
  const language = readLanguage(o.lang);
  const key = readKey(o.key);
  const ran = await runOn(settings); // the situations run on THIS centre's settings
  if (ran.results.length === 0) throw new Error(`No situation could be run on these settings, so there is nothing to put in a certificate: ${ran.skipped.map((s) => s.reason).join(" ")}`);
  const handCheck = summariseRun(ran);
  const result = writeGoLiveCertificate({ settings, handCheck, language, out: o.out, key, preparedBy: o["prepared-by"], now: readNow(o.now) });
  console.log(key ? "Signed with your key." : "NOT signed (no --key): the files carry a digest and a code, but nothing shows who issued them.");
  console.log(`Wrote ${result.files.length} files into ${o.out}:`);
  for (const f of result.files) console.log(`  ${f}`);
  console.log(`\nCode ${result.code}.\n\n${result.texts.join("\n\n")}`);
  if (handCheck.notRun) console.log(`\n${handCheck.notRun.length} situation(s) cannot be run on these settings, so they are left out of the counts, named in go-live-certificate.json and listed as not tested: ${handCheck.notRun.join("; ")}.`);
  if (handCheck.held < handCheck.total) {
    console.log(`\n${handCheck.total - handCheck.held} situation(s) did not hold. The certificate says so: ${handCheck.failedTitles.join("; ")}.`);
    return 1;
  }
});
