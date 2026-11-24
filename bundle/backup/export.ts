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
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
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
import { PERSON_FORM, keyIdOf, personFingerprint } from "../../modules/record/fingerprint.ts";
import { parseKey } from "../../modules/record/key-file.ts";
import { readSnapshot } from "../../modules/runtime/store.ts";
import { shopKeyFileText } from "../../modules/runtime/shop-key.ts";

export interface ExportJob { shops: { name: string; db: string; out: string; /** The file (mounted read-only) that holds the shop's key (B69): the job file names it, never carries it. */ personKeyFile: string }[] }
/**
 * `usage`: the cost meter's cumulative counts over the whole record (lib/usage.ts), which the deployer writes into status/<shop>.json. Counts only.
 * `obligations`: the unfinished-work list's counts by kind right now (modules/unfinished `countsByKind`), worked out from the same exported record and cases the panel's
 * to-do list reads, so the heartbeat's `open_obligations` and the panel never disagree. Kind ids and counts only. The owner-wait limit is the default (12 hours): the
 * panel's own setting is the panel's, and this count is fleet's.
 * `ledger`: the head of the record's ledger (B28), or why there is none (a record with a gap is not chained).
 */
export interface Exported { name: string; ok: boolean; entries?: number; bookings?: number; dues?: number; orders?: number; usage?: UsageTotals; obligations?: Record<string, number>; error?: string; ledger?: { seq: number; head: string } | { error: string };
  /** The text of the shop's `shop-key.json` (a PRIVATE key), for the deployer only: it reads it from this job's output and writes the file itself (see shopKeyFileOf). Never logged, never in a file this job writes. */
  shopKeyFile?: string }

/** What person-form.json holds: which form this export's fingerprints use. `inputs` and `messageIds` count the record's entries by how they were written (older entries keep what they were). */
export interface PersonForm { schema: 1; form: typeof PERSON_FORM; /** Which key made this export's fingerprints (keyIdOf). */ keyId: string; inputs: { keyed: number; older: number }; messageIds: { fingerprinted: number; older: number } }

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
/**
 * Block S phase B2: the shop's OWN signing key (modules/runtime/shop-key.ts), as the text of `shop-key.json`, for the OWNER'S file only (export/build.ts adds it to a package made with the owner
 * profile and to no other). The key is the shop's identity in every directory: whoever serves the shop next needs it for the shop to stay itself. It is read from the same database as everything
 * else here and is never in record.json, listings.json or any file the Operator's package carries. A database from before the key table, or a shop that has made no key yet, gives undefined.
 *
 * It is RETURNED, not written to the exports folder. This job runs as root with only DAC_OVERRIDE and DAC_READ_SEARCH (no CHOWN), so a file it wrote would be root's and the builder of the owner's
 * file (the panel's container, or the deployer, both running as the deployer's user: lib/secrets.ts panelUser) could not read a private key at 0600, and 0644 would put it where every record
 * export sits. The deployer takes the text from this job's output and writes the file itself (backup/jobs.ts placeShopKeyFile), as its own user, 0600.
 */
export function shopKeyFileOf(dbFile: string): string | undefined {
  let text: string | undefined;
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(dbFile, { readOnly: true });
    text = (db.prepare("SELECT private_key FROM shop_key WHERE id = 1").get() as { private_key: string } | undefined)?.private_key;
  } catch { text = undefined; } finally { db?.close(); }
  return text === undefined ? undefined : shopKeyFileText(text);
}

export function exportShop(shop: ExportJob["shops"][number], rates: UsageRates = priceRates()): Exported {
  if (!existsSync(shop.db)) return { name: shop.name, ok: false, error: "no database yet" };
  let keyText: string;
  try { keyText = readFileSync(shop.personKeyFile, "utf8"); } catch { return { name: shop.name, ok: false, error: "the shop's fingerprint key is missing, so it was not exported" }; }
  const personKey = parseKey(keyText, "The shop's fingerprint key");
  const hide = fingerprints(personKey);
  const db = new DatabaseSync(shop.db, { readOnly: true });
  let rows: { entry: string }[]; let state: { snapshot: string } | undefined;
  try {
    db.exec("PRAGMA busy_timeout = 5000; BEGIN");
    // the runtime's own reader, which knows both layouts: a shop held back on an older version keeps the one-row table, a newer one keeps the snapshot in pieces
    const snapshot = readSnapshot(db);
    state = snapshot === null ? undefined : { snapshot };
    rows = db.prepare("SELECT entry FROM record ORDER BY seq").all() as { entry: string }[];
    db.exec("COMMIT");
  } finally { db.close(); }
  const raw = rows.map((r) => JSON.parse(r.entry) as Record<string, unknown>);
  const usage = summarizeUsage(raw, rates); // counted before the conversation is hidden, and it reads no text
  // A Bookings snapshot holds `bookings`, a Fees one holds `dues`, an Orders one holds `orders`: whichever the shop's store has is exported, under its own file name.
  const whole = state ? (JSON.parse(state.snapshot) as Saved & { parts?: Record<string, Saved> }) : {};
  // decision 65: a shop of several parts keeps each part's store under `parts.<name>`; each part's cases are exported as its own template's are, under parts/<name>/. The shop's
  // router (its question waiting for an answer holds a message's words) is never exported.
  const partStores = whole.parts && typeof whole.parts === "object" ? Object.entries(whole.parts) : [];
  const own = casesOf(whole, hide);
  const partCases = partStores.map(([name, saved]) => ({ name, ...casesOf(saved, hide) }));
  const isListingsOnly = state !== undefined && own.kind === "none" && partStores.length === 0;
  const students = [...new Set([...own.students, ...partCases.flatMap((p) => p.students)])].sort((a, b) => b.length - a.length);
  const isFees = own.kind === "fees" || partCases.some((p) => p.kind === "fees");
  const scrub = (text: unknown): unknown => (typeof text === "string" ? students.reduce((t, name) => t.split(name).join(hide("s", name)), text) : text);
  const entries = raw.map((e) => ({ ...e, conversation: hide("c", e.conversation), ...(isFees && "notes" in e ? { notes: scrub(e.notes) } : {}) }));
  const casesFile = own.file;
  const cases = own.cases;
  const isStock = own.kind === "stock";
  const isOrders = own.kind === "orders";
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
  const form: PersonForm = { schema: 1, form: PERSON_FORM, keyId: keyIdOf(personKey), inputs: { keyed: digests.filter((d) => d.startsWith("k-")).length, older: digests.filter((d) => !d.startsWith("k-")).length }, messageIds: { fingerprinted: ids.filter((m) => /^m-[0-9a-f]{12}$/u.test(m)).length, older: ids.filter((m) => !/^m-[0-9a-f]{12}$/u.test(m)).length } };
  for (const [file, value] of [["record.json", entries], ...(isListingsOnly || partStores.length > 0 ? [] : [[casesFile, cases] as const]), ["person-form.json", form], ...(ledger ? [["ledger.json", ledger] as const] : [])] as const) {
    const tmp = join(shop.out, `.${file}.tmp`);
    writeFileSync(tmp, JSON.stringify(value), { mode: 0o644 });
    renameSync(tmp, join(shop.out, file));
  }
  for (const p of partCases) {
    if (p.kind === "none") continue;
    const dir = join(shop.out, "parts", p.name);
    mkdirSync(dir, { recursive: true });
    const tmp = join(dir, `.${p.file}.tmp`);
    writeFileSync(tmp, JSON.stringify(p.cases), { mode: 0o644 });
    renameSync(tmp, join(dir, p.file));
  }
  // Block S: the shop's listings (the owner's whole copy: drafts and hidden ones too, never a removed one's words) and their photos, read from the same consistent database. Only a
  // shop that has listings gets the files, so every other shop's export is as it was.
  const holder = (state ? (JSON.parse(state.snapshot) as { assistant?: { listings?: { items?: { state?: string }[] } } }).assistant?.listings : undefined);
  if (holder && (holder.items?.length ?? 0) > 0) {
    const kept = { ...holder, items: (holder.items ?? []).filter((l) => l.state !== "removed") };
    const tmp = join(shop.out, ".listings.json.tmp");
    writeFileSync(tmp, JSON.stringify(kept), { mode: 0o644 });
    renameSync(tmp, join(shop.out, "listings.json"));
    const dir = join(shop.out, "listing-photos");
    rmSync(dir, { recursive: true, force: true }); // a photo that left the shop's listings does not stay in the export
    mkdirSync(dir, { recursive: true });
    const pdb = new DatabaseSync(shop.db, { readOnly: true });
    try {
      const wanted = new Set((kept.items as { photos?: { id: string }[] }[]).flatMap((l) => (l.photos ?? []).map((p) => p.id)));
      for (const r of pdb.prepare("SELECT id, type, bytes FROM listing_photos").all() as { id: string; type: string; bytes: Uint8Array }[]) {
        if (wanted.has(r.id) && /^ph-[0-9a-f]{12}$/u.test(r.id)) writeFileSync(join(dir, `${r.id}.${r.type === "image/webp" ? "webp" : "jpg"}`), r.bytes, { mode: 0o644 });
      }
    } catch { /* a runtime older than the photo table has none to export */ } finally { pdb.close(); }
  }
  // Block S phase B2: the shop's own signing key, for the owner's file. Handed back in the result for the deployer to write (see shopKeyFileOf); a key that cannot be read leaves the owner's file without it, and the file says so.
  let shopKeyFile: string | undefined;
  try { shopKeyFile = shopKeyFileOf(shop.db); } catch { shopKeyFile = undefined; }
  // Block S phase A3: the shop's own stock count (its lines, low marks and last movements) in the owner's file, so leaving with the shop keeps the count. Only a shop that counts something gets it.
  const stockState = (state ? (JSON.parse(state.snapshot) as { assistant?: { stock?: { lines?: unknown[] } } }).assistant?.stock : undefined);
  if (stockState && (stockState.lines?.length ?? 0) > 0) {
    const tmp = join(shop.out, ".stock.json.tmp");
    writeFileSync(tmp, JSON.stringify(stockState), { mode: 0o644 });
    renameSync(tmp, join(shop.out, "stock.json"));
  }
  let open: Record<string, number> | undefined;
  // a parts shop's to-do list is each part's (not counted here yet: bundle Deferred.md, decision 65)
  if (!isListingsOnly && partStores.length === 0) try { open = countsByKind(obligations.detect({ template: isStock ? "stock-orders" : isOrders ? "orders" : own.kind === "fees" ? "fees" : "bookings", entries: entries as unknown as RecordEntry[], cases: cases as unknown as CaseLike[], nowMs: Date.now(), options: DEFAULT_OPTIONS }).found); } catch { open = undefined; }
  return { name: shop.name, ok: true, entries: entries.length, ...(isListingsOnly || partStores.length > 0 ? {} : isOrders || isStock ? { orders: cases.length } : own.kind === "fees" ? { dues: cases.length } : { bookings: cases.length }), usage, ...(open ? { obligations: open } : {}), ...(ledgerSaid ? { ledger: ledgerSaid } : {}), ...(shopKeyFile ? { shopKeyFile } : {}) };
}

if (import.meta.main) {
  const job = JSON.parse(readFileSync(process.argv[2], "utf8")) as ExportJob;
  console.log(JSON.stringify({ results: job.shops.map((s) => { try { return exportShop(s); } catch (e) { return { name: s.name, ok: false, error: (e as Error).message }; } }) }));
}

/** A template's saved store, as far as the export reads it. */
type Saved = { bookings?: [string, Record<string, unknown>][]; dues?: [string, Record<string, unknown>][]; orders?: [string, Record<string, unknown>][]; seq?: unknown; nextOrder?: unknown };

/**
 * One template's store's cases as they leave the shop's volume, and the file they go in: what the export did inline until decision 65 made it once per part. A number leaves only
 * as its fingerprint (`hide`); a name a customer typed, an order's address and a handle's hash stay in the shop's volume.
 */
function casesOf(saved: Saved, hide: (kind: string, value: unknown) => unknown): { kind: "stock" | "orders" | "fees" | "bookings" | "none"; file: string; cases: unknown[]; students: string[] } {
  // Stock orders (17 Nov 2026) also keeps an `orders` map (its purchase orders), told apart by its own counter `seq` (an Orders store has `nextOrder`): it must never be exported as Orders'
  const isStock = saved.orders !== undefined && saved.seq !== undefined && saved.nextOrder === undefined;
  // A listings-only shop (18 Nov 2026) has a saved state (its assistant and AI counts) and none of the three maps: it has no cases, so no cases file is written for it.
  const none = saved.bookings === undefined && saved.dues === undefined && saved.orders === undefined;
  const isOrders = saved.orders !== undefined && !isStock;
  const isFees = !isOrders && !isStock && saved.dues !== undefined && saved.bookings === undefined;
  const file = isStock ? "purchase-orders.json" : isOrders ? "orders.json" : isFees ? "dues.json" : "bookings.json";
  const students = isFees ? [...new Set((saved.dues ?? []).map(([, d]) => String(d.studentName ?? "")).filter((n) => n.length >= 2))] : [];
  // An order also carries the delivery address a customer wrote: it is the shop's, for the owner, and never leaves the shop's volume (only the place on the delivery list does).
  // Item 11h: an order from the shop's page carries the name and number its customer typed and its handle's hash too: as for a page booking below, the name and the hash
  // stay in the shop's volume and the number leaves only as a fingerprint.
  // a purchase order names a supplier by id and carries no customer: only the owner's WhatsApp message id that asked for it (`requestId`) is left out
  const cases = isStock
    ? (saved.orders ?? []).map(([, o]) => { const { requestId: _requestId, ...rest } = o as Record<string, unknown>; return rest; })
    : isOrders
    ? (saved.orders ?? []).map(([, o]) => { const { address: _address, contact, handle: _handle, ...rest } = o as Record<string, unknown> & { contact?: { phone?: string } }; return { ...rest, customer: hide("p", o.customer), ...(contact?.phone ? { contact: { phone: hide("p", contact.phone) } } : {}) }; })
    : isFees
    ? (saved.dues ?? []).map(([, d]) => ({ ...d, customer: hide("p", d.customer), studentName: hide("s", d.studentName) }))
    // item 11d: a booking from the page also carries the name and number its customer typed, and its handle's hash: the name and the hash stay in the shop's volume,
    // and the number leaves only as a fingerprint, the same as a WhatsApp customer's (so a person's statement can still find it)
    : (saved.bookings ?? []).map(([, b]) => { const { contact, handle: _handle, ...rest } = b as Record<string, unknown> & { contact?: { phone?: string } }; return { ...rest, customer: hide("p", b.customer), ...(contact?.phone ? { contact: { phone: hide("p", contact.phone) } } : {}) }; });
  return { kind: none ? "none" : isStock ? "stock" : isOrders ? "orders" : isFees ? "fees" : "bookings", file, cases, students };
}
