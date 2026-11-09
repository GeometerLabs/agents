// The record and the bookings (for a Fees centre, the fees), exported for the monthly report, inside a short-lived container (like snapshot.ts). The panel's report reads
// exports/<shop>/record.json and bookings.json (dues.json for Fees, orders.json for Orders), and they leave the shop's volume, so they carry no customer's number: the customer field of a booking
// (the parent's number on a fee) and the conversation of a record entry become a fingerprint of themselves (modules/record/fingerprint.ts: HMAC-SHA256 under the shop's key, B69), which nobody
// without that key can work back and the shop's own tools can still match. The key is mounted into this container read-only for this one job and is never written anywhere. A fee also carries a
// CHILD's name, which the report never needs (it counts fees): the name on a fee is fingerprinted too, and so is the name in a record note that names the student ("the fee for Rohan Mehta,
// ..."). A number or a name the shop or a customer wrote into free text elsewhere is not covered by this: see README.txt in a package (export/build.ts).
//
// person-form.json says which form these files use, so an export from before B69 cannot be mistaken for one after it.
//
// The record's ledger (B28, modules/record/ledger.ts) is written beside them as ledger.json: the chain made from the shop's OWN entries, before anything is hidden. Its
// bodies leave out the number, the note and a page's secret address, so it carries no customer's number either, and its head is the same as the head of the exported
// record (which is what lets the panel anchor a paper made from the export). The daily fingerprint (backup/fingerprints.ts) and the restore drill read it.
//
//   node bundle/backup/export.ts /job/job.json
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
import { PERSON_FORM, parseKey, personFingerprint } from "../../modules/record/fingerprint.ts";

export interface ExportJob { shops: { name: string; db: string; out: string; /** The file (mounted read-only) that holds the shop's key (B69): the job file names it, never carries it. */ personKeyFile: string }[] }
/**
 * `usage`: the cost meter's cumulative counts over the whole record (lib/usage.ts), which the deployer writes into status/<shop>.json. Counts only.
 * `obligations`: the unfinished-work list's counts by kind right now (modules/unfinished `countsByKind`), worked out from the same exported record and cases the panel's
 * to-do list reads, so the heartbeat's `open_obligations` and the panel never disagree. Kind ids and counts only. The owner-wait limit is the default (12 hours): the
 * panel's own setting is the panel's, and this count is fleet's.
 * `ledger`: the head of the record's ledger (B28), or why there is none (a record with a gap is not chained).
 */
export interface Exported { name: string; ok: boolean; entries?: number; bookings?: number; dues?: number; orders?: number; usage?: UsageTotals; obligations?: Record<string, number>; error?: string; ledger?: { seq: number; head: string } | { error: string } }

/** What person-form.json holds: which form this export's fingerprints use. `inputs` and `messageIds` count the record's entries by how they were written (older entries keep what they were). */
export interface PersonForm { schema: 1; form: typeof PERSON_FORM; inputs: { keyed: number; older: number }; messageIds: { fingerprinted: number; older: number } }

/**
 * Fingerprints for one export, under the shop's key: `(prefix, value) => "<prefix>-<12 hex>"`. Twelve digits are enough with a key in place (nobody outside can try values, so only two people
 * of the one shop could ever land on the same one, about one chance in tens of millions at a shop's size); a shop where they do is refused, never exported with two people merged.
 */
export function fingerprints(key: Buffer, hexOf: (key: Buffer, value: string) => string = personFingerprint): (prefix: "c" | "p" | "s", value: unknown) => string {
  const seen = new Map<string, string>();
  return (prefix, value) => {
    const text = String(value);
    const hex = hexOf(key, text);
    const was = seen.get(hex);
    if (was !== undefined && was !== text) throw new Error("two different people of this shop got the same fingerprint, so nothing was exported: lengthen the fingerprint (modules/record/fingerprint.ts) before exporting this shop");
    seen.set(hex, text);
    return `${prefix}-${hex}`;
  };
}

/** The WhatsApp rates the estimate needs, from the newest price lists that have them (the proposed list adds marketing and GST). A list that cannot be read leaves a rate out; the estimate then says it is not one. */
function priceRates(): UsageRates {
  const lists: RateSource[] = [];
  for (const read of [latestProposedPriceList, latestPriceList]) { try { const l = read(); if (l) lists.push(l); } catch { /* no list: those rates are unknown */ } }
  return usageRatesFrom(lists);
}

/** One consistent read of the shop's record and state, written as two files, each by writing a temporary file and renaming it. A shop with no readable key is not exported, never exported unkeyed. */
export function exportShop(shop: ExportJob["shops"][number], rates: UsageRates = priceRates()): Exported {
  if (!existsSync(shop.db)) return { name: shop.name, ok: false, error: "no database yet" };
  let keyText: string;
  try { keyText = readFileSync(shop.personKeyFile, "utf8"); } catch { return { name: shop.name, ok: false, error: "the shop's fingerprint key is missing, so it was not exported" }; }
  const hide = fingerprints(parseKey(keyText, "The shop's fingerprint key"));
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
  // A Bookings snapshot holds `bookings`, a Fees one holds `dues`, an Orders one holds `orders`: whichever the shop's store has is exported, under its own file name.
  const saved = state ? (JSON.parse(state.snapshot) as { bookings?: [string, Record<string, unknown>][]; dues?: [string, Record<string, unknown>][]; orders?: [string, Record<string, unknown>][] }) : {};
  const isOrders = saved.orders !== undefined;
  const isFees = !isOrders && saved.dues !== undefined && saved.bookings === undefined;
  const casesFile = isOrders ? "orders.json" : isFees ? "dues.json" : "bookings.json";
  const students = isFees ? [...new Set((saved.dues ?? []).map(([, d]) => String(d.studentName ?? "")).filter((n) => n.length >= 2))].sort((a, b) => b.length - a.length) : [];
  const scrub = (text: unknown): unknown => (typeof text === "string" ? students.reduce((t, name) => t.split(name).join(hide("s", name)), text) : text);
  const entries = raw.map((e) => ({ ...e, conversation: hide("c", e.conversation), ...(isFees && "notes" in e ? { notes: scrub(e.notes) } : {}) }));
  // An order also carries the delivery address a customer wrote: it is the shop's, for the owner, and never leaves the shop's volume (only the place on the delivery list does).
  const cases = isOrders
    ? (saved.orders ?? []).map(([, o]) => { const { address: _address, ...rest } = o; return { ...rest, customer: hide("p", o.customer) }; })
    : isFees
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
  const digests = raw.map((e) => String(e.inputsDigest ?? ""));
  const ids = raw.map((e) => (e.refs as { messageId?: string } | undefined)?.messageId).filter((m): m is string => typeof m === "string");
  const form: PersonForm = { schema: 1, form: PERSON_FORM, inputs: { keyed: digests.filter((d) => d.startsWith("k-")).length, older: digests.filter((d) => !d.startsWith("k-")).length }, messageIds: { fingerprinted: ids.filter((m) => /^m-[0-9a-f]{12}$/u.test(m)).length, older: ids.filter((m) => !/^m-[0-9a-f]{12}$/u.test(m)).length } };
  for (const [file, value] of [["record.json", entries], [casesFile, cases], ["person-form.json", form], ...(ledger ? [["ledger.json", ledger] as const] : [])] as const) {
    const tmp = join(shop.out, `.${file}.tmp`);
    writeFileSync(tmp, JSON.stringify(value), { mode: 0o644 });
    renameSync(tmp, join(shop.out, file));
  }
  let open: Record<string, number> | undefined;
  try { open = countsByKind(obligations.detect({ template: isOrders ? "orders" : isFees ? "fees" : "bookings", entries: entries as unknown as RecordEntry[], cases: cases as unknown as CaseLike[], nowMs: Date.now(), options: DEFAULT_OPTIONS }).found); } catch { open = undefined; }
  return { name: shop.name, ok: true, entries: entries.length, ...(isOrders ? { orders: cases.length } : isFees ? { dues: cases.length } : { bookings: cases.length }), usage, ...(open ? { obligations: open } : {}), ...(ledgerSaid ? { ledger: ledgerSaid } : {}) };
}

if (import.meta.main) {
  const job = JSON.parse(readFileSync(process.argv[2], "utf8")) as ExportJob;
  console.log(JSON.stringify({ results: job.shops.map((s) => { try { return exportShop(s); } catch (e) { return { name: s.name, ok: false, error: (e as Error).message }; } }) }));
}
