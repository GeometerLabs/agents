// Helpers for the templates' report tests of the open check (check.ts): an evidence pack made from a record the way the shop's export writes it, and a copy of it with one money
// line's amount changed. Shared so Bookings, Orders and Fees each test the same three things (passes, fails when changed, fails when cut short) without three copies.
import { generateKeyPairSync } from "node:crypto";
import type { RecordEntry } from "../../record/record.ts";
import { evidencePack, ledgerEntries } from "../../record/ledger.ts";

const { privateKey } = generateKeyPairSync("ed25519");

/** The pack as a file would hold it (through JSON once), for a record and a tenant. */
export const packOf = (entries: readonly RecordEntry[], tenant: string): any =>
  JSON.parse(JSON.stringify(evidencePack(ledgerEntries(entries, tenant), { tenant, now: Date.now(), key: privateKey })));

/** A copy of the pack with the first received payment's amount made 100 paise larger: what a careless or dishonest edit would look like. Its hashes are left as they were. */
export function withChangedAmount(pack: any): any {
  const copy = JSON.parse(JSON.stringify(pack));
  const e = copy.entries.find((x: { body: string }) => /"money":"received"/.test(x.body));
  if (!e) throw new Error("the pack has no received payment to change");
  e.body = e.body.replace(/"amountPaise":"(\d+)"/, (_m: string, n: string) => `"amountPaise":"${Number(n) + 100}"`);
  return copy;
}

/** A copy cut short: only the first `count` entries. */
export const cutShort = (pack: any, count: number): any => ({ ...pack, entries: pack.entries.slice(0, count) });
