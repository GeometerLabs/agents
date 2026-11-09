// The weekly restore drill's check, inside a short-lived container: the newest nightly snapshot of each shop is fetched from the snapshot place and opened with the
// server's drill key into a scratch folder (restore-snapshot.ts), its integrity is checked, and the restored record must be the START of the live record: the live
// entry at the snapshot's last sequence number has the same digest. A backup nobody restored is not counted as a backup.
// Then (B28) the restored record is chained into its ledger (modules/record/ledger.ts) and compared with the daily fingerprints published for the shop: it must hold
// every entry of the last fingerprint published before the snapshot was taken, and its hash at the newest fingerprint it holds must be the hash that was published.
// A copy that was rewritten, or that is shorter than what was published before it, fails. A shop with no fingerprint yet is said, not failed.
//
//   node bundle/backup/drill-check.ts /job/job.json
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { mountedKey, recordFacts, stampMs, storeFor } from "./snapshot.ts";
import type { SnapshotJob } from "./snapshot.ts";
import { fetchSnapshot } from "./restore-snapshot.ts";
import type { ObjectStore } from "./store.ts";
import { hashAt, ledgerEntries } from "../../modules/record/ledger.ts";
import type { RecordEntry } from "../../modules/record/record.ts";

const digestOf = (entry: string) => createHash("sha256").update(entry).digest("hex");

/** One published daily fingerprint (state/fingerprints/<shop>.jsonl); `at` is when it was written. A file changed by hand is passed as one line with head "unreadable". */
export interface PublishedLine { seq: number; head: string; day: string; at?: string }
export interface DrillShop { name: string; restored: string; live: string; /** The shop's published fingerprints, oldest first (B28). */ published?: PublishedLine[] }
/** What the deployer hands the drill container: where the snapshots are, the drill key's file, and per shop the live database and where to restore the copy. */
export interface DrillJob { target: SnapshotJob["target"]; identityFile: string; shops: DrillShop[] }
export interface DrillResult { name: string; ok: boolean; detail: string; /** The snapshot that was restored. */ stamp?: string }

export function drillShop(shop: DrillShop, snapshotAtMs?: number): DrillResult {
  try { return check(shop, snapshotAtMs); } catch (e) { return { name: shop.name, ok: false, detail: `the restored file could not be used as a database (${(e as Error).message})` }; }
}

/** Fetch the newest snapshot into the scratch path, then check it. */
export async function drillFromSnapshot(shop: DrillShop, store: ObjectStore, identity: string): Promise<DrillResult> {
  let stamp: string;
  try {
    const got = await fetchSnapshot(store, shop.name, identity);
    stamp = got.stamp;
    mkdirSync(dirname(shop.restored), { recursive: true });
    writeFileSync(shop.restored, got.db);
  } catch (e) { return { name: shop.name, ok: false, detail: `the newest snapshot could not be restored: ${(e as Error).message}` }; }
  const r = drillShop(shop, stampMs(stamp));
  return { ...r, detail: `snapshot ${stamp}: ${r.detail}`, stamp };
}

function check(shop: DrillShop, snapshotAtMs?: number): DrillResult {
  if (!existsSync(shop.restored)) return { name: shop.name, ok: false, detail: "nothing was restored: the snapshot has no database for this shop" };
  const published = shop.published ?? [];
  const restored = new DatabaseSync(shop.restored, { readOnly: true });
  try {
    const integrity = (restored.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check;
    if (integrity !== "ok") return { name: shop.name, ok: false, detail: `the restored database failed its integrity check (${integrity})` };
    const back = recordFacts(restored);
    if (!existsSync(shop.live)) return { name: shop.name, ok: back.records === 0, detail: back.records === 0 ? "restored fine; the live record does not exist yet" : "the live database is missing but the copy has entries" };
    const live = new DatabaseSync(shop.live, { readOnly: true });
    try {
      const now = recordFacts(live);
      if (back.lastSeq === null) {
        if (now.records > 0) return { name: shop.name, ok: false, detail: `the restored record is empty but the live one has ${now.records} entries` };
        const last = published.at(-1);
        return last ? { name: shop.name, ok: false, detail: `both records are empty, but a fingerprint of ${last.seq} entries was published on ${last.day}` } : { name: shop.name, ok: true, detail: "restored fine; both records are empty" };
      }
      const same = live.prepare("SELECT entry FROM record WHERE seq = ?").get(back.lastSeq) as { entry: string } | undefined;
      const liveDigest = same ? digestOf(same.entry) : null;
      if (liveDigest !== back.lastEntryDigest) return { name: shop.name, ok: false, detail: `the restored record's last entry (#${back.lastSeq}) is not the live record's entry #${back.lastSeq}` };
      // a snapshot is up to a day old: the live record has gone on since, and the copy is good if it is the start of the live one
      const since = (now.lastSeq ?? 0) - back.lastSeq;
      const said = `restored ${back.records} entries, integrity ok, last entry #${back.lastSeq} matches the live record${since > 0 ? ` (${since} newer entries since the snapshot)` : ""}`;
      const fingerprint = compareFingerprints(restored, shop.name, published, snapshotAtMs);
      return fingerprint.ok ? { name: shop.name, ok: true, detail: `${said}; ${fingerprint.detail}` } : { name: shop.name, ok: false, detail: fingerprint.detail };
    } finally { live.close(); }
  } finally { restored.close(); }
}

/** The restored record's ledger against the published fingerprints: the one published before the snapshot must be inside it, and the newest it holds must match. */
function compareFingerprints(db: DatabaseSync, tenant: string, published: readonly PublishedLine[], snapshotAtMs?: number): { ok: boolean; detail: string } {
  if (published.length === 0) return { ok: true, detail: "no fingerprint of its record has been published yet, so none was compared" };
  if (published.some((p) => p.head === "unreadable")) return { ok: false, detail: "the server's fingerprint file for this shop was changed by hand or a line was taken out, so the restored record could not be compared with what was published" };
  const rows = db.prepare("SELECT entry FROM record ORDER BY seq").all() as { entry: string }[];
  let chain;
  try { chain = ledgerEntries(rows.map((r) => JSON.parse(r.entry) as RecordEntry), tenant); } catch (e) { return { ok: false, detail: `the restored record could not be chained into its ledger (${(e as Error).message})` }; }
  // published before the snapshot was taken: the snapshot must hold all of it (a line without a time counts as before)
  const before = published.filter((p) => snapshotAtMs === undefined || p.at === undefined || Date.parse(p.at) <= snapshotAtMs).at(-1);
  if (before && hashAt(chain, before.seq) === null) return { ok: false, detail: `the restored record has ${chain.length} entries, fewer than the ${before.seq} its fingerprint of ${before.day} covers` };
  const held = published.filter((p) => hashAt(chain, p.seq) !== null).at(-1);
  if (!held) return { ok: true, detail: "the fingerprints published so far are all newer than this snapshot, so none was compared" };
  if (hashAt(chain, held.seq) !== held.head) return { ok: false, detail: `the restored record does not match the fingerprint published on ${held.day} (entry ${held.seq}): it was changed after that fingerprint` };
  return { ok: true, detail: `its chain matches the fingerprint published on ${held.day} (entry ${held.seq})` };
}

if (import.meta.main) {
  const job = JSON.parse(readFileSync(process.argv[2], "utf8")) as DrillJob;
  const results: DrillResult[] = [];
  let store: ObjectStore | undefined;
  let identity = "";
  try { store = storeFor(job.target, mountedKey()); identity = readFileSync(job.identityFile, "utf8"); } catch (e) { for (const s of job.shops) results.push({ name: s.name, ok: false, detail: `the snapshot place could not be read: ${(e as Error).message}` }); }
  if (store) for (const s of job.shops) { try { results.push(await drillFromSnapshot(s, store, identity)); } catch (e) { results.push({ name: s.name, ok: false, detail: (e as Error).message }); } }
  console.log(JSON.stringify({ results }));
}
