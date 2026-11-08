// The record and the bookings (for a Fees centre, the fees), exported for the monthly report, inside a short-lived container (like snapshot.ts). The panel's report reads
// exports/<shop>/record.json and bookings.json (dues.json for Fees), and they leave the shop's volume, so they carry no customer's number: the customer field of a booking
// (the parent's number on a fee) and the conversation of a record entry become a short hash of themselves (the report's own digest of an entry already leaves the
// conversation out, so nothing in it changes). A fee also carries a CHILD's name, which the report never needs (it counts fees): the name on a fee is hashed too, and so is
// the name in a record note that names the student ("the fee for Rohan Mehta, ..."). That changes the note, so the digest of an exported Fees record is of the exported
// notes, not of the shop's own; nothing compares the two.
//
// The record's ledger (B28, modules/record/ledger.ts) is written beside them as ledger.json: the chain made from the shop's OWN entries, before anything is hidden. Its
// bodies leave out the number, the note and a page's secret address, so it carries no customer's number either, and its head is the same as the head of the exported
// record (which is what lets the panel anchor a paper made from the export). The daily fingerprint (backup/fingerprints.ts) and the restore drill read it.
//
//   node bundle/backup/export.ts /job/job.json
import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { summarizeUsage, usageRatesFrom } from "../lib/usage.ts";
import { DEFAULT_OPTIONS, countsByKind, obligations } from "../../modules/unfinished/index.ts";
import type { CaseLike } from "../../modules/unfinished/index.ts";
import type { RecordEntry } from "../../modules/record/record.ts";
import type { RateSource, UsageRates, UsageTotals } from "../lib/usage.ts";
import { latestPriceList, latestProposedPriceList } from "../panel/cost.ts";
import { ledgerEntries } from "../../modules/record/ledger.ts";

export interface ExportJob { shops: { name: string; db: string; out: string }[] }
/**
 * `usage`: the cost meter's cumulative counts over the whole record (lib/usage.ts), which the deployer writes into status/<shop>.json. Counts only.
 * `obligations`: the unfinished-work list's counts by kind right now (modules/unfinished `countsByKind`), worked out from the same exported record and cases the panel's
 * to-do list reads, so the heartbeat's `open_obligations` and the panel never disagree. Kind ids and counts only. The owner-wait limit is the default (12 hours): the
 * panel's own setting is the panel's, and this count is fleet's.
 * `ledger`: the head of the record's ledger (B28), or why there is none (a record with a gap is not chained).
 */
export interface Exported { name: string; ok: boolean; entries?: number; bookings?: number; dues?: number; usage?: UsageTotals; obligations?: Record<string, number>; error?: string; ledger?: { seq: number; head: string } | { error: string } }

export const hide = (prefix: string, value: unknown): string => `${prefix}-${createHash("sha256").update(String(value)).digest("hex").slice(0, 12)}`;

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
  // A Bookings snapshot holds `bookings`, a Fees one holds `dues`: whichever the shop's store has is exported, under its own file name.
  const saved = state ? (JSON.parse(state.snapshot) as { bookings?: [string, Record<string, unknown>][]; dues?: [string, Record<string, unknown>][] }) : {};
  const isFees = saved.dues !== undefined && saved.bookings === undefined;
  const students = isFees ? [...new Set((saved.dues ?? []).map(([, d]) => String(d.studentName ?? "")).filter((n) => n.length >= 2))].sort((a, b) => b.length - a.length) : [];
  const scrub = (text: unknown): unknown => (typeof text === "string" ? students.reduce((t, name) => t.split(name).join(hide("s", name)), text) : text);
  const entries = raw.map((e) => ({ ...e, conversation: hide("c", e.conversation), ...(isFees && "notes" in e ? { notes: scrub(e.notes) } : {}) }));
  const cases = isFees
    ? (saved.dues ?? []).map(([, d]) => ({ ...d, customer: hide("p", d.customer), studentName: hide("s", d.studentName) }))
    : (saved.bookings ?? []).map(([, b]) => ({ ...b, customer: hide("p", b.customer) }));
  mkdirSync(shop.out, { recursive: true });
  let ledger: unknown[] | undefined;
  let ledgerSaid: Exported["ledger"];
  try {
    const chain = ledgerEntries(raw as unknown as RecordEntry[], shop.name);
    ledger = chain;
    const last = chain.at(-1);
    if (last) ledgerSaid = { seq: Number(last.seq), head: last.hash };
  } catch (e) { ledgerSaid = { error: (e as Error).message }; }
  for (const [file, value] of [["record.json", entries], [isFees ? "dues.json" : "bookings.json", cases], ...(ledger ? [["ledger.json", ledger] as const] : [])] as const) {
    const tmp = join(shop.out, `.${file}.tmp`);
    writeFileSync(tmp, JSON.stringify(value), { mode: 0o644 });
    renameSync(tmp, join(shop.out, file));
  }
  let open: Record<string, number> | undefined;
  try { open = countsByKind(obligations.detect({ template: isFees ? "fees" : "bookings", entries: entries as unknown as RecordEntry[], cases: cases as unknown as CaseLike[], nowMs: Date.now(), options: DEFAULT_OPTIONS }).found); } catch { open = undefined; }
  return { name: shop.name, ok: true, entries: entries.length, ...(isFees ? { dues: cases.length } : { bookings: cases.length }), usage, ...(open ? { obligations: open } : {}), ...(ledgerSaid ? { ledger: ledgerSaid } : {}) };
}

if (import.meta.main) {
  const job = JSON.parse(readFileSync(process.argv[2], "utf8")) as ExportJob;
  console.log(JSON.stringify({ results: job.shops.map((s) => { try { return exportShop(s); } catch (e) { return { name: s.name, ok: false, error: (e as Error).message }; } }) }));
}
