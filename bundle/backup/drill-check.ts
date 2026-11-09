// The weekly drill, inside a short-lived container, WITHOUT the key: the owner's age key is kept off the server, so nothing here can open a snapshot. What it checks
// of each shop's newest snapshot, from the seal the snapshot job handed back (snapshot.ts) and the live database:
//   1. every object of the snapshot is read back from the snapshot place and has the sha256 it had when it was uploaded. A store that refuses the read makes a drill
//      that could not complete, with the store's reason (and fleet alerts on it as on any failed drill);
//   2. the copy was a sound database: SQLite's integrity_check passed on the plain copy when it was made (the snapshot is not written otherwise);
//   3. its record is the START of the live record: the live entry at the copy's last sequence number has the same digest, and the live record's hash chain at that
//      entry is the copy's chain head (so every entry before it is the same too);
//   4. (B28) against the daily fingerprints published for the shop: the copy holds every entry of the last fingerprint published before it was made, and the chain
//      matches the newest fingerprint it holds.
// What it cannot check is that the snapshot opens: that is the full restore test, done by a person with the owner's key, monthly, on their own machine
// (bundle/README.md, "Backups").
//
//   node bundle/backup/drill-check.ts /job/job.json
import { existsSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { chainOf, mountedKey, recordFacts, stampMs, storeFor } from "./snapshot.ts";
import type { Seal, SnapshotJob } from "./snapshot.ts";
import type { ObjectStore } from "./store.ts";
import { hashAt } from "../../modules/record/ledger.ts";

const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");

/** One published daily fingerprint (state/fingerprints/<shop>.jsonl); `at` is when it was written. A file changed by hand is passed as one line with head "unreadable". */
export interface PublishedLine { seq: number; head: string; day: string; at?: string }
export interface DrillShop { name: string; live: string; /** The newest snapshot's seal, as the deployer kept it; none before the first snapshot. */ seal?: Seal; /** The shop's published fingerprints, oldest first (B28). */ published?: PublishedLine[] }
/** What the deployer hands the drill container: where the snapshots are, and per shop its live database, its newest seal and its fingerprints. */
export interface DrillJob { target: SnapshotJob["target"]; shops: DrillShop[] }
export interface DrillResult { name: string; ok: boolean; detail: string; /** The snapshot that was checked. */ stamp?: string }

export async function drillShop(shop: DrillShop, store: ObjectStore): Promise<DrillResult> {
  const fail = (detail: string): DrillResult => ({ name: shop.name, ok: false, detail, ...(shop.seal ? { stamp: shop.seal.stamp } : {}) });
  const seal = shop.seal;
  if (!seal) return fail("no snapshot of this shop has been made yet, so there is nothing to check");
  for (const o of seal.objects) {
    let got: Buffer | undefined;
    try { got = await store.get(o.key); } catch (e) { return fail(`the drill could not complete: the snapshot place would not let it read ${o.key} back (${(e as Error).message})`); }
    if (!got) return fail(`${o.key} of the snapshot of ${seal.stamp} is not in the snapshot place`);
    if (sha256(got) !== o.sha256) return fail(`${o.key} in the snapshot place is not the object that was written (its sha256 differs)`);
  }
  let r: { ok: boolean; detail: string };
  try { r = checkRecord(shop.name, seal, shop.live, shop.published ?? [], stampMs(seal.stamp)); } catch (e) { r = { ok: false, detail: `the live database could not be read (${(e as Error).message})` }; }
  return { name: shop.name, ok: r.ok, stamp: seal.stamp, detail: `snapshot ${seal.stamp}: ${r.ok ? `its ${seal.objects.length} objects read back unchanged; ${r.detail}` : r.detail}` };
}

/** The copy's record, as the seal says it was, against the live record and the published fingerprints. */
export function checkRecord(tenant: string, seal: Seal, livePath: string, published: readonly PublishedLine[], snapshotAtMs: number): { ok: boolean; detail: string } {
  const copy = seal.record;
  if (!copy) return existsSync(livePath) ? { ok: false, detail: "the snapshot holds no runtime database, but the shop has one" } : { ok: true, detail: "no runtime database yet, in the snapshot or live" };
  if (!existsSync(livePath)) return { ok: copy.records === 0, detail: copy.records === 0 ? "a sound empty database; the live record does not exist yet" : "the live database is missing but the snapshot's has entries" };
  const live = new DatabaseSync(livePath, { readOnly: true });
  try {
    const now = recordFacts(live);
    if (copy.lastSeq === null) {
      // made before the record's first entry: good, unless a fingerprint of some entries had been published before it was made
      const fp = compareFingerprints([], 0, published, snapshotAtMs);
      return fp.ok ? { ok: true, detail: `a sound empty database, made before the record's first entry${now.records > 0 ? ` (the live record has ${now.records} now)` : ""}` } : fp;
    }
    const same = live.prepare("SELECT entry FROM record WHERE seq = ?").get(copy.lastSeq) as { entry: string } | undefined;
    if (!same || sha256(same.entry) !== copy.lastEntryDigest) return { ok: false, detail: `the snapshot's last entry (#${copy.lastSeq}) is not the live record's entry #${copy.lastSeq}` };
    let chain;
    try { chain = chainOf(live, tenant); } catch (e) { return { ok: false, detail: `the live record could not be chained into its ledger (${(e as Error).message})` }; }
    if (copy.head === null) return { ok: false, detail: "the snapshot's record could not be chained into its ledger when it was made" };
    if (hashAt(chain, copy.lastSeq) !== copy.head) return { ok: false, detail: `the snapshot's record is not the start of the live record: their hash chains differ before entry #${copy.lastSeq}` };
    const since = (now.lastSeq ?? 0) - copy.lastSeq;
    const said = `a sound database of ${copy.records} entries (integrity checked when it was made), the start of the live record (the chain matches at #${copy.lastSeq}${since > 0 ? `; ${since} newer entries since` : ""})`;
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
