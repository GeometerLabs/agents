// Checks a report or certificate file (the .json that client-report.ts and go-live-certificate.ts write) and says plainly
// what was checked and what was not.
//   node pathways/bookings/scripts/verify-report.ts report-2026-11.json [--trust-key <public key file | 64-digit key | key:id>]...
// A signature shows who issued the document and that it has not changed since. It does NOT show the numbers are true.
// Without --trust-key it can only say "unchanged since key X signed it": a key written inside a file proves nothing about
// whose it is. Exit 0: unchanged (and signed by a key you named, if you named one). 1: changed, or not a key you named.
// 3: unchanged but not signed. 64: it was not asked a question it can answer.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { UsageError, main } from "../report/cli.ts";
import { trustedKeyId, verifyEnvelopeText } from "../report/sign.ts";

await main(async () => {
  let args;
  try { args = parseArgs({ args: process.argv.slice(2), options: { "trust-key": { type: "string", multiple: true } }, allowPositionals: true }); } catch (e) { throw new UsageError((e as Error).message); }
  const [file] = args.positionals;
  if (!file || args.positionals.length > 1) throw new UsageError("Say which file to check:\n  node pathways/bookings/scripts/verify-report.ts <file.json> [--trust-key <public key>]");
  let text: string;
  try { text = readFileSync(file, "utf8"); } catch { throw new UsageError(`I cannot read ${file}.`); }
  const trust = (args.values["trust-key"] ?? []).map((spec) => { try { return trustedKeyId(spec); } catch (e) { throw new UsageError((e as Error).message); } });
  const v = verifyEnvelopeText(text, trust);

  console.log(`File: ${file}`);
  if (v.envelope) console.log(`Code: ${v.envelope.code}   Digest: ${v.envelope.digest}`);
  console.log("\nWhat was checked:");
  for (const c of v.checks) console.log(`  ${c.ok ? "yes" : "NO "}  ${c.name}`);
  console.log("\nWhat was NOT checked:");
  for (const n of v.notChecked) console.log(`  - ${n}`);
  console.log(`\n${v.unchanged ? "Result" : "FAILED"}: ${v.summary}`);
  if (!v.unchanged) return 1;
  if (trust.length > 0 && !v.trusted) return 1;
  return v.signed ? 0 : 3;
});
