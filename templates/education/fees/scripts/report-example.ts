// A sample set of monthly reports, made from a busy month scripted on the demo world (src/harness.ts, stand-in services, test money). It writes into
// templates/education/fees/report-sample/ (ignored by git) unless --out names another folder.
//   node templates/education/fees/scripts/report-example.ts [--out <folder>]
// The files are signed with a throwaway key made in memory and thrown away: the private key is never written anywhere. Check one with Bookings' checker, which reads
// any signed Geometer document:
//   node templates/commerce/bookings/scripts/verify-report.ts <out>/report-2026-11.json --trust-key <out>/example-public-key.pem
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { UsageError, main } from "../../../../modules/report/cli.ts";
import { keyIdOf, publicKeyHex } from "../../../../modules/report/sign.ts";
import { at, runBusyMonth } from "../report/example-month.ts";
import { writeFeesReport } from "../report/run.ts";

await main(async () => {
  let args;
  try { args = parseArgs({ args: process.argv.slice(2), options: { out: { type: "string" } } }); } catch (e) { throw new UsageError((e as Error).message); }
  const out = args.values.out ?? fileURLToPath(new URL("../report-sample/", import.meta.url));
  mkdirSync(out, { recursive: true });
  const { world } = await runBusyMonth();
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  writeFileSync(join(out, "example-public-key.pem"), publicKey.export({ type: "spki", format: "pem" }));
  const files: string[] = [];
  for (const language of ["hi", "en", "ml", "kn", "both"] as const) {
    files.push(...writeFeesReport({
      settings: world.settings, entries: world.record.entries(), dues: [...world.store.dues.values()], month: "2026-11", language, out, source: "stand-in",
      key: privateKey, preparedBy: "Divya, local partner (example)", now: at(12, 1, 10),
    }).files);
  }
  console.log(`An example month (Bright Tuition Centre, November 2026) on stand-in services and test money. ${new Set(files).size} files in ${out}.`);
  console.log(`Signed with a throwaway key (${keyIdOf(publicKeyHex(privateKey))}); its private half was never written down.`);
  console.log(`Open ${join(out, "report-2026-11-both.html")} in a browser. Check the data with:\n  node templates/commerce/bookings/scripts/verify-report.ts ${join(out, "report-2026-11.json")} --trust-key ${join(out, "example-public-key.pem")}`);
});
