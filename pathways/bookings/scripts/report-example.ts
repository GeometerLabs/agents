// A sample set of reports and certificates, made from a busy month scripted on the demo world (src/harness.ts, stand-in
// services, test money). It writes into pathways/bookings/report-sample/ (ignored by git) unless --out names another folder.
//   node pathways/bookings/scripts/report-example.ts [--out <folder>]
// The files are signed with a throwaway key made in memory and thrown away: the private key is never written anywhere. Check one with
//   node pathways/bookings/scripts/verify-report.ts <out>/report-2026-11.json --trust-key <out>/example-public-key.pem
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { runAll } from "../crash-test/situations.ts";
import { summariseHandCheck } from "../report/certificate.ts";
import { UsageError, main } from "../report/cli.ts";
import { runBusyMonth, at } from "../report/example-month.ts";
import { readGoLiveCertificate } from "../report/go-live.ts";
import { writeClientReport, writeGoLiveCertificate } from "../report/run.ts";
import { keyIdOf, publicKeyHex } from "../report/sign.ts";

await main(async () => {
  let args;
  try { args = parseArgs({ args: process.argv.slice(2), options: { out: { type: "string" } } }); } catch (e) { throw new UsageError((e as Error).message); }
  const out = args.values.out ?? fileURLToPath(new URL("../report-sample/", import.meta.url));
  mkdirSync(out, { recursive: true });
  const { world } = await runBusyMonth();
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  writeFileSync(join(out, "example-public-key.pem"), publicKey.export({ type: "spki", format: "pem" }));
  const now = at(12, 2, 10);
  const common = { settings: world.settings, out, source: "stand-in" as const, key: privateKey, preparedBy: "Divya, local partner (example)", now };
  const files: string[] = [];
  const handCheck = summariseHandCheck(await runAll());
  for (const language of ["hi", "en", "ml", "kn", "both"] as const) files.push(...writeGoLiveCertificate({ ...common, handCheck, language }).files);
  // The monthly reports are told what the go-live checks ran on the way a shop's would be: they read the go-live certificate that was just written.
  const goLive = readGoLiveCertificate(readFileSync(join(out, "go-live-certificate.json"), "utf8"), world.settings);
  for (const language of ["hi", "en", "ml", "kn", "both"] as const) {
    files.push(...writeClientReport({ ...common, entries: world.record.entries(), bookings: [...world.store.bookings.values()], month: "2026-11", language, goLive: goLive.finding }).files);
  }
  console.log(`An example month (Glow Salon, November 2026) on stand-in services and test money. ${new Set(files).size} files in ${out}.`);
  console.log(goLive.said);
  console.log(`Signed with a throwaway key (${keyIdOf(publicKeyHex(privateKey))}); its private half was never written down.`);
  console.log(`Open ${join(out, "report-2026-11-both.html")} in a browser. Check the data with:\n  node pathways/bookings/scripts/verify-report.ts ${join(out, "report-2026-11.json")} --trust-key ${join(out, "example-public-key.pem")}`);
});
