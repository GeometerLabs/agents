// Write the Razorpay limits spec for one client, from that client's settings (the one place the refund threshold comes from).
//
//   node pathways/bookings/scripts/guard-spec.ts --client clients/glow-salon.example --tenant glow-salon --reviewed-by builder-arjun [--version 1] [--approval-hours 24] > spec.json
//   geo-guard compile --spec spec.json --out bundle.json
//
// It only reads the client's settings.json and prints JSON. `reviewed_by` is the builder's own declaration that a person read the numbers.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseSettings } from "../src/settings.ts";
import { razorpayLimitsSpec } from "../src/guard-limits.ts";

const args = process.argv.slice(2);
const option = (name: string): string | undefined => { const i = args.indexOf(`--${name}`); return i === -1 ? undefined : args[i + 1]; };
const known = ["--client", "--tenant", "--reviewed-by", "--version", "--approval-hours", "--help"];
if (args.includes("--help") || args.some((a) => a.startsWith("--") && !known.includes(a))) {
  console.log("Usage: node pathways/bookings/scripts/guard-spec.ts --client <folder> --tenant <id> --reviewed-by <id> [--version 1] [--approval-hours 24]\nPrints the Razorpay limits spec for that client's settings; give it to `geo-guard compile --spec`.");
  process.exit(args.includes("--help") ? 0 : 2);
}
const client = option("client"); const tenant = option("tenant"); const reviewedBy = option("reviewed-by");
if (!client || !tenant || !reviewedBy) { console.error("Give --client, --tenant and --reviewed-by (see --help)."); process.exit(2); }
try {
  const settings = parseSettings(JSON.parse(readFileSync(join(resolve(client), "settings.json"), "utf8")));
  const hours = option("approval-hours");
  console.log(JSON.stringify(razorpayLimitsSpec(settings, { tenant, reviewedBy, version: Number(option("version") ?? 1) }, hours ? { approvalTtlSeconds: Math.round(Number(hours) * 3600) } : {}), null, 2));
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
