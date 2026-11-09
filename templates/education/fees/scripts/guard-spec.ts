// Write the Razorpay limits spec for one centre, from that centre's settings (the one place the refund threshold comes from).
//
//   node templates/education/fees/scripts/guard-spec.ts --settings templates/education/fees/settings/bright-tuition.example.json --tenant bright-tuition --reviewed-by builder-arjun [--version 1] [--approval-hours 24] > spec.json
//   geo-guard compile --spec spec.json --out bundle.json
//
// It only reads the settings file and prints JSON. `reviewed_by` is the builder's own declaration that a person read the numbers.
import { readFileSync } from "node:fs";
import { parseSettings } from "../src/settings.ts";
import { gatewayLimitsSpec } from "../src/guard-limits.ts";

const args = process.argv.slice(2);
const option = (name: string): string | undefined => { const i = args.indexOf(`--${name}`); return i === -1 ? undefined : args[i + 1]; };
const known = ["--settings", "--tenant", "--reviewed-by", "--version", "--approval-hours", "--help"];
if (args.includes("--help") || args.some((a) => a.startsWith("--") && !known.includes(a))) {
  console.log("Usage: node templates/education/fees/scripts/guard-spec.ts --settings <file> --tenant <id> --reviewed-by <id> [--version 1] [--approval-hours 24]\nPrints the Razorpay limits spec for that centre: links from ₹1 up to the dearest fee with its late fee, refunds at most that, one refund per payment, no payouts, and a refund above the centre's refund limit held for the owner.");
  process.exit(args.includes("--help") ? 0 : 2);
}
const file = option("settings"); const tenant = option("tenant"); const reviewedBy = option("reviewed-by");
if (!file || !tenant || !reviewedBy) { console.error("Give --settings, --tenant and --reviewed-by (see --help)."); process.exit(2); }
try {
  const settings = parseSettings(JSON.parse(readFileSync(file, "utf8")));
  const hours = option("approval-hours");
  console.log(JSON.stringify(gatewayLimitsSpec(settings, { tenant, reviewedBy, version: Number(option("version") ?? 1) }, hours ? { approvalTtlSeconds: Math.round(Number(hours) * 3600) } : {}), null, 2));
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
