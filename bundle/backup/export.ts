// The record and the bookings, exported for the monthly report, inside a short-lived container (like snapshot.ts). The panel's report reads
// exports/<shop>/record.json and bookings.json, and they leave the shop's volume, so they carry no customer's number: the customer field of a booking and the
// conversation of a record entry become a short hash of themselves (the report's own digest of an entry already leaves the conversation out, so nothing in it changes).
//
//   node bundle/backup/export.ts /job/job.json
import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { summarizeUsage, usageRatesFrom } from "../lib/usage.ts";
import type { RateSource, UsageRates, UsageTotals } from "../lib/usage.ts";
import { latestPriceList, latestProposedPriceList } from "../panel/cost.ts";

export interface ExportJob { shops: { name: string; db: string; out: string }[] }
/** `usage`: the cost meter's cumulative counts over the whole record (lib/usage.ts), which the deployer writes into status/<shop>.json. Counts only. */
export interface Exported { name: string; ok: boolean; entries?: number; bookings?: number; usage?: UsageTotals; error?: string }

const hide = (prefix: string, value: unknown): string => `${prefix}-${createHash("sha256").update(String(value)).digest("hex").slice(0, 12)}`;

/** The WhatsApp rates the estimate needs, from the newest price lists that have them (the proposed list adds marketing and GST). A list that cannot be read leaves a rate out; the estimate then says it is not one. */
function priceRates(): UsageRates {
  const lists: RateSource[] = [];
  for (const read of [latestProposedPriceList, latestPriceList]) { try { const l = read(); if (l) lists.push(l); } catch { /* no list: those rates are unknown */ } }
  return usageRatesFrom(lists);
}

/** One consistent read of the shop's record and state, written as two files, each by writing a temporary file and renaming it. */
export function exportShop(shop: ExportJob["shops"][number], rates: UsageRates = priceRates()): Exported {
  if (!existsSync(shop.db)) return { name: shop.name, ok: false, error: "no database yet" };
  const db = new DatabaseSync(shop.db, { readOnly: true });
  let rows: { entry: string }[]; let state: { snapshot: string } | undefined;
  try {
    db.exec("PRAGMA busy_timeout = 5000; BEGIN");
    state = db.prepare("SELECT snapshot FROM state WHERE id = 1").get() as { snapshot: string } | undefined;
    rows = db.prepare("SELECT entry FROM record ORDER BY seq").all() as { entry: string }[];
    db.exec("COMMIT");
  } finally { db.close(); }
  const raw = rows.map((r) => JSON.parse(r.entry) as Record<string, unknown>);
  const usage = summarizeUsage(raw, rates); // counted before the conversation is hidden, and it reads no text
  const entries = raw.map((e) => ({ ...e, conversation: hide("c", e.conversation) }));
  const pairs = state ? (JSON.parse(state.snapshot) as { bookings: [string, Record<string, unknown>][] }).bookings : [];
  const bookings = pairs.map(([, b]) => ({ ...b, customer: hide("p", b.customer) }));
  mkdirSync(shop.out, { recursive: true });
  for (const [file, value] of [["record.json", entries], ["bookings.json", bookings]] as const) {
    const tmp = join(shop.out, `.${file}.tmp`);
    writeFileSync(tmp, JSON.stringify(value), { mode: 0o644 });
    renameSync(tmp, join(shop.out, file));
  }
  return { name: shop.name, ok: true, entries: entries.length, bookings: bookings.length, usage };
}

if (import.meta.main) {
  const job = JSON.parse(readFileSync(process.argv[2], "utf8")) as ExportJob;
  console.log(JSON.stringify({ results: job.shops.map((s) => { try { return exportShop(s); } catch (e) { return { name: s.name, ok: false, error: (e as Error).message }; } }) }));
}
