// The weekly restore drill's check, inside a short-lived container: the copy Litestream restored into a scratch folder is opened, its integrity is checked,
// and its last record entry is compared with the LIVE record's entry at the same sequence number. A backup nobody restored is not counted as a backup.
// Then (B28) the restored record is chained into its ledger (modules/record/ledger.ts) and its hash at the last PUBLISHED fingerprint's entry must be the hash that was
// published: a copy that was rewritten, or one that is shorter than what was published, fails. A shop with no fingerprint yet is said, not failed.
//
//   node bundle/backup/drill-check.ts /job/job.json
import { existsSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { recordFacts } from "./snapshot.ts";
import { hashAt, ledgerEntries } from "../../modules/record/ledger.ts";
import type { RecordEntry } from "../../modules/record/record.ts";

const digestOf = (entry: string) => createHash("sha256").update(entry).digest("hex");

export interface DrillJob { shops: { name: string; restored: string; live: string; /** The last daily fingerprint of the shop's ledger (B28), if one was published. */ published?: { seq: number; head: string; day: string } }[]; /** The restored copy may be this many entries behind the live record (Litestream lags by about a second). */ maxLagEntries: number }
export interface DrillResult { name: string; ok: boolean; detail: string }

export function drillShop(shop: DrillJob["shops"][number], maxLag: number): DrillResult {
  try { return check(shop, maxLag); } catch (e) { return { name: shop.name, ok: false, detail: `the restored file could not be used as a database (${(e as Error).message})` }; }
}

function check(shop: DrillJob["shops"][number], maxLag: number): DrillResult {
  if (!existsSync(shop.restored)) return { name: shop.name, ok: false, detail: "nothing was restored: the continuous copy has no database for this shop" };
  const restored = new DatabaseSync(shop.restored, { readOnly: true });
  try {
    const integrity = (restored.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check;
    if (integrity !== "ok") return { name: shop.name, ok: false, detail: `the restored database failed its integrity check (${integrity})` };
    const back = recordFacts(restored);
    if (!existsSync(shop.live)) return { name: shop.name, ok: back.records === 0, detail: back.records === 0 ? "restored fine; the live record does not exist yet" : "the live database is missing but the copy has entries" };
    const live = new DatabaseSync(shop.live, { readOnly: true });
    try {
      const now = recordFacts(live);
      if (back.lastSeq === null) return now.records === 0 ? (shop.published ? { name: shop.name, ok: false, detail: `both records are empty, but a fingerprint of ${shop.published.seq} entries was published on ${shop.published.day}` } : { name: shop.name, ok: true, detail: "restored fine; both records are empty" }) : { name: shop.name, ok: false, detail: `the restored record is empty but the live one has ${now.records} entries` };
      const same = live.prepare("SELECT entry FROM record WHERE seq = ?").get(back.lastSeq) as { entry: string } | undefined;
      const liveDigest = same ? digestOf(same.entry) : null;
      if (liveDigest !== back.lastEntryDigest) return { name: shop.name, ok: false, detail: `the restored record's last entry (#${back.lastSeq}) is not the live record's entry #${back.lastSeq}` };
      const lag = (now.lastSeq ?? 0) - back.lastSeq;
      if (lag > maxLag) return { name: shop.name, ok: false, detail: `the restored copy is ${lag} entries behind the live record (more than ${maxLag})` };
      const said = `restored ${back.records} entries, integrity ok, last entry #${back.lastSeq} matches the live record${lag > 0 ? ` (${lag} newer entries not yet copied)` : ""}`;
      const fingerprint = compareFingerprint(restored, shop.name, shop.published);
      return fingerprint.ok ? { name: shop.name, ok: true, detail: `${said}; ${fingerprint.detail}` } : { name: shop.name, ok: false, detail: fingerprint.detail };
    } finally { live.close(); }
  } finally { restored.close(); }
}

/** The restored record's ledger hash at the published fingerprint's entry, against the hash that was published. */
function compareFingerprint(db: DatabaseSync, tenant: string, published: DrillJob["shops"][number]["published"]): { ok: boolean; detail: string } {
  if (!published) return { ok: true, detail: "no fingerprint of its record has been published yet, so none was compared" };
  const rows = db.prepare("SELECT entry FROM record ORDER BY seq").all() as { entry: string }[];
  let chain;
  try { chain = ledgerEntries(rows.map((r) => JSON.parse(r.entry) as RecordEntry), tenant); } catch (e) { return { ok: false, detail: `the restored record could not be chained into its ledger (${(e as Error).message})` }; }
  const hash = hashAt(chain, published.seq);
  if (hash === null) return { ok: false, detail: `the restored record has ${chain.length} entries, fewer than the ${published.seq} its fingerprint of ${published.day} covers` };
  if (hash !== published.head) return { ok: false, detail: `the restored record does not match the fingerprint published on ${published.day} (entry ${published.seq}): it was changed after that fingerprint` };
  return { ok: true, detail: `its chain matches the fingerprint published on ${published.day} (entry ${published.seq})` };
}

if (import.meta.main) {
  const job = JSON.parse(readFileSync(process.argv[2], "utf8")) as DrillJob;
  console.log(JSON.stringify({ results: job.shops.map((s) => { try { return drillShop(s, job.maxLagEntries); } catch (e) { return { name: s.name, ok: false, detail: (e as Error).message }; } }) }));
}
