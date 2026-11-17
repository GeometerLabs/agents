// Small helpers the report scripts share, and a small command line of their own. The command-line frame and the readers of the options every script takes (a JSON file, the
// record, the language, what the numbers were counted from, the key, the time) are the same for every template (modules/report/cli.ts); this file adds Stock orders' own: its
// settings, its orders, its go-live certificate.
//
//   node templates/commerce/stock-orders/report/cli.ts report --settings shop.json --record entries.json --orders orders.json --month 2026-11 --lang en --out ./out --source stand-in \
//        [--go-live ./go-live-certificate.json] [--key key.pem] [--prepared-by "Divya, local Operator"] [--innovator] [--tenant glow-salon] [--now 2026-12-02T10:00:00+05:30]
//   node templates/commerce/stock-orders/report/cli.ts go-live --settings shop.json --lang en --out ./out [--key key.pem] [--prepared-by "Divya, local Operator"] [--now ...]
//
// "report" makes the monthly report from the agent's saved record and orders. "go-live" runs the hand check on this shop's own settings and writes the go-live certificate.
// Files are written into --out and nowhere else. Without --key the files are not signed, and the command says so.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { UsageError, ledgerTenant, main, readEntries, readJson, readKey, readLanguage, readNow, readSource } from "../../../../modules/report/cli.ts";
import type { PurchaseOrder } from "../src/order.ts";
import { validateSettings } from "../src/settings.ts";
import type { Settings } from "../src/settings.ts";
import { summariseRun } from "./certificate.ts";
import { noReading, readGoLiveCertificate, untrustedReading } from "./go-live.ts";
import type { GoLiveReading } from "./go-live.ts";
import { writeGoLiveCertificate, writeStockReport } from "./run.ts";

export { UsageError, main, readEntries, readJson, readKey, readLanguage, readNow, readSource };

export function readSettings(path: string | undefined): Settings {
  const result = validateSettings(readJson(path, "the settings file", "--settings"));
  if (!result.ok) throw new UsageError(`The settings need fixing:\n- ${result.errors.join("\n- ")}`);
  return result.settings;
}

/** The order store's orders (orders.json): a list, or an object with "orders" as a list or as [id, order] pairs (a Map saved as JSON). */
export function readOrders(path: string | undefined): PurchaseOrder[] {
  const value = readJson(path, "the orders", "--orders");
  const list = Array.isArray(value) ? value : (value as { orders?: unknown })?.orders;
  if (!Array.isArray(list)) throw new UsageError(`The orders at ${path} should be a list of orders (or an object with "orders").`);
  return list.map((o) => (Array.isArray(o) ? o[1] : o)) as PurchaseOrder[];
}

/**
 * The go-live certificate for a monthly report. Unlike the other inputs, a file that is missing, unreadable, unsigned, changed or not a go-live certificate is NOT a
 * reason to stop: it becomes a reading that says the certificate could not be trusted, the report says so, and it is still made.
 */
export function readGoLive(path: string | undefined, settings: Settings): GoLiveReading {
  if (!path) return noReading();
  let text: string;
  try { text = readFileSync(path, "utf8"); } catch { return untrustedReading(`I cannot read ${path}`); }
  return readGoLiveCertificate(text, settings);
}

const OPTIONS = {
  settings: { type: "string" as const }, record: { type: "string" as const }, orders: { type: "string" as const }, month: { type: "string" as const }, lang: { type: "string" as const }, out: { type: "string" as const },
  key: { type: "string" as const }, source: { type: "string" as const }, "prepared-by": { type: "string" as const }, innovator: { type: "boolean" as const }, now: { type: "string" as const },
  "go-live": { type: "string" as const }, tenant: { type: "string" as const },
};

/** The command line: `report` or `go-live` (see the top of this file). Returns the exit code. */
export async function runCli(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  let o;
  try { o = parseArgs({ args: rest, options: OPTIONS }).values; } catch (e) { throw new UsageError(`${(e as Error).message}\nSee the first lines of templates/commerce/stock-orders/report/cli.ts for the options.`); }
  if (command !== "report" && command !== "go-live") throw new UsageError("Say what to make: report or go-live (see the first lines of templates/commerce/stock-orders/report/cli.ts).");
  if (!o.out) throw new UsageError("Say which folder to write into: --out <folder>.");
  const settings = readSettings(o.settings);
  const language = readLanguage(o.lang);
  const key = readKey(o.key);
  console.log(key ? "Signed with your key." : "NOT signed (no --key): the files carry a digest and a code, but nothing shows who issued them.");
  if (command === "go-live") {
    // loaded only here: the runtime server imports readGoLive from this file and must not pull the whole crash-test in with it
    const { runOn } = await import("../crash-test/situations.ts");
    const ran = await runOn(settings); // the situations run on THIS shop's settings
    if (ran.results.length === 0) throw new Error(`No situation could be run on these settings, so there is nothing to put in a certificate: ${ran.skipped.map((s) => s.reason).join(" ")}`);
    const handCheck = summariseRun(ran);
    const result = writeGoLiveCertificate({ settings, handCheck, language, out: o.out, key, preparedBy: o["prepared-by"], now: readNow(o.now) });
    console.log(`Wrote ${result.files.length} files into ${o.out}:`);
    for (const f of result.files) console.log(`  ${f}`);
    console.log(`\nCode ${result.code}.\n\n${result.texts.join("\n\n")}`);
    if (handCheck.held < handCheck.total) { console.log(`\n${handCheck.total - handCheck.held} situation(s) did not hold: ${handCheck.failedTitles.join("; ")}.`); return 1; }
    return 0;
  }
  if (!o.month) throw new UsageError("Say which month: --month 2026-11.");
  const goLive = readGoLive(o["go-live"], settings); // never stops the report: what is wrong with it is said here and in the report
  const result = writeStockReport({
    settings, entries: readEntries(o.record), orders: readOrders(o.orders), month: o.month, language, out: o.out, source: readSource(o.source), key, preparedBy: o["prepared-by"],
    innovator: o.innovator === true, now: readNow(o.now), goLive: goLive.finding, ...ledgerTenant(o.tenant, settings.name),
  });
  console.log(goLive.said);
  console.log(`Wrote ${result.files.length} files into ${o.out}:`);
  for (const f of result.files) console.log(`  ${f}`);
  console.log(`\nReport code ${result.code}.\n\nFor the owner, ready for WhatsApp:\n`);
  console.log(result.ownerTexts.join("\n\n"));
  return 0;
}

// Run as a script: node templates/commerce/stock-orders/report/cli.ts <report|go-live> ...  (importing this file for its readers runs nothing)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main(() => runCli(process.argv.slice(2)));
