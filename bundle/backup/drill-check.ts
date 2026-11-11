// The weekly drill, inside a short-lived container, WITHOUT the key: the owner's age key is kept off the server, so nothing here can open a snapshot. What it checks
// of each shop's newest snapshot, from the seal the snapshot job handed back (snapshot.ts) and the live database:
//   1. every object of the snapshot is read back from the snapshot place and has the sha256 it had when it was uploaded. A store that refuses the read makes a drill
//      that could not complete, with the store's reason (and fleet alerts on it as on any failed drill);
//   2. the copy was a sound database: SQLite's integrity_check passed on the plain copy when it was made (the snapshot is not written otherwise);
//   3. its record is the START of the live record: the live entry at the copy's last sequence number has the same digest, and the live record's hash chain at that
//      entry is the copy's chain head (so every entry before it is the same too);
//   4. (B28) against the daily fingerprints published for the shop: the copy holds every entry of the last fingerprint published before it was made, and the chain
//      matches the newest fingerprint it holds;
//   5. (B69) the fingerprint key: the seal names the key the manifest holds by a one-way id, and the deployer hands over the id of the key this server holds, so the
//      drill says whether a restore would bring back the key in use, without either key in this container.
// What it cannot check is that the snapshot opens: that is the full restore test, done by a person with the owner's key, monthly, on their own machine
// (bundle/README.md, "Backups").
//
// An agent someone else wrote (B51) is drilled the same way: its live record is the deployer's file (state/records/<agent>.json, mounted read-only) instead of a runtime's
// database, read the way the snapshot read it (snapshot.ts, agentRecordOf). No fingerprint is published for an agent, so step 4 says none was compared.
//
//   node bundle/backup/drill-check.ts /job/job.json
import { existsSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { agentRecordOf, chainOf, mountedKey, recordFacts, stampMs, storeFor } from "./snapshot.ts";
import type { RecordFacts, Seal, SnapshotJob } from "./snapshot.ts";
import type { ObjectStore } from "./store.ts";
import { hashAt, ledgerEntries } from "../../modules/record/ledger.ts";
import { canonicalJson } from "../../modules/record/record.ts";

const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");

/** One published daily fingerprint (state/fingerprints/<shop>.jsonl); `at` is when it was written. A file changed by hand is passed as one line with head "unreadable". */
export interface PublishedLine { seq: number; head: string; day: string; at?: string }
export interface DrillShop {
  name: string;
  /** The live record: a shop's runtime database, or (`ownAgent`) the deployer's record file of an agent someone else wrote. */
  live: string;
  ownAgent?: boolean;
  /** The newest snapshot's seal, as the deployer kept it; none before the first snapshot. */ seal?: Seal;
  /** The shop's published fingerprints, oldest first (B28). */ published?: PublishedLine[];
  /** The id of the fingerprint key this server holds for it (lib/secrets.ts, keyIdOf); absent when it holds none. Never the key. */ keyId?: string;
}
/** What the deployer hands the drill container: where the snapshots are, and per shop or agent its live record, its newest seal, its fingerprints and its key's id. */
export interface DrillJob { target: SnapshotJob["target"]; shops: DrillShop[] }
export interface DrillResult { name: string; ok: boolean; detail: string; /** The snapshot that was checked. */ stamp?: string }

export async function drillShop(shop: DrillShop, store: ObjectStore): Promise<DrillResult> {
  const fail = (detail: string): DrillResult => ({ name: shop.name, ok: false, detail, ...(shop.seal ? { stamp: shop.seal.stamp } : {}) });
  const seal = shop.seal;
  if (!seal) return fail(`no snapshot of this ${shop.ownAgent ? "agent" : "shop"} has been made yet, so there is nothing to check`);
  for (const o of seal.objects) {
    let got: Buffer | undefined;
    try { got = await store.get(o.key); } catch (e) { return fail(`the drill could not complete: the snapshot place would not let it read ${o.key} back (${(e as Error).message})`); }
    if (!got) return fail(`${o.key} of the snapshot of ${seal.stamp} is not in the snapshot place`);
    if (sha256(got) !== o.sha256) return fail(`${o.key} in the snapshot place is not the object that was written (its sha256 differs)`);
  }
  let r: { ok: boolean; detail: string };
  try { r = checkRecord(shop.name, seal, shop.live, shop.published ?? [], stampMs(seal.stamp), shop.ownAgent); } catch (e) { r = { ok: false, detail: `the live ${shop.ownAgent ? "record" : "database"} could not be read (${(e as Error).message})` }; }
  if (!r.ok) return { name: shop.name, ok: false, stamp: seal.stamp, detail: `snapshot ${seal.stamp}: ${r.detail}` };
  const key = checkKey(seal, shop.keyId);
  return { name: shop.name, ok: key?.ok ?? true, stamp: seal.stamp, detail: `snapshot ${seal.stamp}: its ${seal.objects.length} objects read back unchanged; ${r.detail}${key ? `; ${key.detail}` : ""}` };
}

/**
 * The key the manifest holds against the key in use, by their ids (B69). Nothing is said when neither side has one (a shop from before the key). A different key, or none
 * on the server, fails the drill: a restore would put back a key the shop's later papers were not made with, or the server has lost the key that matches its people. A seal
 * with no id (written before the seal named the key) is only said: the next night's snapshot carries one.
 */
function checkKey(seal: Seal, live: string | undefined): { ok: boolean; detail: string } | undefined {
  if (!seal.keyId && !live) return undefined;
  if (!seal.keyId) return { ok: true, detail: "its seal does not say which fingerprint key its manifest holds (it was written before the seal named the key), so the key was not compared" };
  if (!live) return { ok: false, detail: "its manifest holds a fingerprint key, but this server has none for it: `restore` puts the snapshot's back" };
  return seal.keyId === live ? { ok: true, detail: "its manifest holds the fingerprint key this server uses" } : { ok: false, detail: "its manifest holds a fingerprint key other than the one this server uses: the key was changed after the snapshot, and a restore would put the older one back" };
}

/** The live record, read the same way for a shop (the runtime's database) and an agent (the deployer's record file), so one comparison serves both. */
interface LiveRecord { facts: RecordFacts; digestAt(seq: number): string | undefined; chain(): ReturnType<typeof chainOf>; close(): void }
function openLive(tenant: string, path: string, ownAgent: boolean): LiveRecord {
  if (ownAgent) {
    const read = agentRecordOf(readFileSync(path, "utf8"), tenant);
    return { facts: read.facts, digestAt: (seq) => { const e = read.entries.find((x) => Number(x.seq) === seq); return e ? sha256(canonicalJson(e)) : undefined; }, chain: () => ledgerEntries(read.entries, tenant), close: () => undefined };
  }
  const db = new DatabaseSync(path, { readOnly: true });
  return {
    facts: recordFacts(db),
    digestAt: (seq) => { const row = db.prepare("SELECT entry FROM record WHERE seq = ?").get(seq) as { entry: string } | undefined; return row ? sha256(row.entry) : undefined; },
    chain: () => chainOf(db, tenant),
    close: () => db.close(),
  };
}

/** The copy's record, as the seal says it was, against the live record and the published fingerprints. `ownAgent`: `livePath` is an agent's record file. */
export function checkRecord(tenant: string, seal: Seal, livePath: string, published: readonly PublishedLine[], snapshotAtMs: number, ownAgent = false): { ok: boolean; detail: string } {
  const copy = seal.record;
  const words = ownAgent
    ? { none: "the snapshot holds no record, but the agent has one", neither: "no record yet, in the snapshot or live", emptyLive: "an empty record; the live record does not exist yet", missing: "the live record is missing but the snapshot's has entries", emptyCopy: "an empty record, made before its first entry", sound: (n: number) => `a sound record of ${n} entries (read and checked when it was made)` }
    : { none: "the snapshot holds no runtime database, but the shop has one", neither: "no runtime database yet, in the snapshot or live", emptyLive: "a sound empty database; the live record does not exist yet", missing: "the live database is missing but the snapshot's has entries", emptyCopy: "a sound empty database, made before the record's first entry", sound: (n: number) => `a sound database of ${n} entries (integrity checked when it was made)` };
  if (!copy) return existsSync(livePath) ? { ok: false, detail: words.none } : { ok: true, detail: words.neither };
  if (!existsSync(livePath)) return { ok: copy.records === 0, detail: copy.records === 0 ? words.emptyLive : words.missing };
  const live = openLive(tenant, livePath, ownAgent);
  try {
    const now = live.facts;
    if (copy.lastSeq === null) {
      // made before the record's first entry: good, unless a fingerprint of some entries had been published before it was made
      const fp = compareFingerprints([], 0, published, snapshotAtMs);
      return fp.ok ? { ok: true, detail: `${words.emptyCopy}${now.records > 0 ? ` (the live record has ${now.records} now)` : ""}` } : fp;
    }
    if (live.digestAt(copy.lastSeq) !== copy.lastEntryDigest) return { ok: false, detail: `the snapshot's last entry (#${copy.lastSeq}) is not the live record's entry #${copy.lastSeq}` };
    let chain;
    try { chain = live.chain(); } catch (e) { return { ok: false, detail: `the live record could not be chained into its ledger (${(e as Error).message})` }; }
    if (copy.head === null) return { ok: false, detail: "the snapshot's record could not be chained into its ledger when it was made" };
    if (hashAt(chain, copy.lastSeq) !== copy.head) return { ok: false, detail: `the snapshot's record is not the start of the live record: their hash chains differ before entry #${copy.lastSeq}` };
    const since = (now.lastSeq ?? 0) - copy.lastSeq;
    const said = `${words.sound(copy.records)}, the start of the live record (the chain matches at #${copy.lastSeq}${since > 0 ? `; ${since} newer entries since` : ""})`;
    // an agent's record has no daily fingerprint (backup/fingerprints.ts publishes the shops'): there is nothing published to compare it with
    if (ownAgent) return { ok: true, detail: `${said}; no fingerprint is published for an agent's record, so none was compared` };
    const fp = compareFingerprints(chain, copy.lastSeq, published, snapshotAtMs);
    return fp.ok ? { ok: true, detail: `${said}; ${fp.detail}` } : fp;
  } finally { live.close(); }
}

/** The snapshot must hold the last fingerprint published before it was made; and the chain it shares with the live record must match the newest fingerprint it holds. */
function compareFingerprints(chain: ReturnType<typeof chainOf>, lastSeq: number, published: readonly PublishedLine[], snapshotAtMs: number): { ok: boolean; detail: string } {
  if (published.length === 0) return { ok: true, detail: "no fingerprint of its record has been published yet, so none was compared" };
  if (published.some((p) => p.head === "unreadable")) return { ok: false, detail: "the server's fingerprint file for this shop was changed by hand or a line was taken out, so the record could not be compared with what was published" };
  // published before the snapshot was taken: the snapshot must hold all of it (a line without a time counts as before)
  const before = published.filter((p) => p.at === undefined || Date.parse(p.at) <= snapshotAtMs).at(-1);
  if (before && before.seq > lastSeq) return { ok: false, detail: `the snapshot has ${lastSeq} entries, fewer than the ${before.seq} its fingerprint of ${before.day} covers` };
  const held = published.filter((p) => p.seq <= lastSeq).at(-1);
  if (!held) return { ok: true, detail: "the fingerprints published so far are all newer than this snapshot, so none was compared" };
  if (hashAt(chain, held.seq) !== held.head) return { ok: false, detail: `the record does not match the fingerprint published on ${held.day} (entry ${held.seq}): it was changed after that fingerprint` };
  return { ok: true, detail: `its chain matches the fingerprint published on ${held.day} (entry ${held.seq})` };
}

if (import.meta.main) {
  const job = JSON.parse(readFileSync(process.argv[2], "utf8")) as DrillJob;
  const results: DrillResult[] = [];
  let store: ObjectStore | undefined;
  try { store = storeFor(job.target, mountedKey()); } catch (e) { for (const s of job.shops) results.push({ name: s.name, ok: false, detail: `the drill could not complete: ${(e as Error).message}` }); }
  if (store) for (const s of job.shops) { try { results.push(await drillShop(s, store)); } catch (e) { results.push({ name: s.name, ok: false, detail: (e as Error).message }); } }
  console.log(JSON.stringify({ results }));
}
