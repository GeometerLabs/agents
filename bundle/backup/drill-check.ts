// The weekly restore drill's check, inside a short-lived container: the copy Litestream restored into a scratch folder is opened, its integrity is checked,
// and its last record entry is compared with the LIVE record's entry at the same sequence number. A backup nobody restored is not counted as a backup.
//
//   node bundle/backup/drill-check.ts /job/job.json
import { existsSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { recordFacts } from "./snapshot.ts";

const digestOf = (entry: string) => createHash("sha256").update(entry).digest("hex");

export interface DrillJob { shops: { name: string; restored: string; live: string }[]; /** The restored copy may be this many entries behind the live record (Litestream lags by about a second). */ maxLagEntries: number }
export interface DrillResult { name: string; ok: boolean; detail: string }

export function drillShop(shop: DrillJob["shops"][number], maxLag: number): DrillResult {
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
      if (back.lastSeq === null) return now.records === 0 ? { name: shop.name, ok: true, detail: "restored fine; both records are empty" } : { name: shop.name, ok: false, detail: `the restored record is empty but the live one has ${now.records} entries` };
      const same = live.prepare("SELECT entry FROM record WHERE seq = ?").get(back.lastSeq) as { entry: string } | undefined;
      const liveDigest = same ? digestOf(same.entry) : null;
      if (liveDigest !== back.lastEntryDigest) return { name: shop.name, ok: false, detail: `the restored record's last entry (#${back.lastSeq}) is not the live record's entry #${back.lastSeq}` };
      const lag = (now.lastSeq ?? 0) - back.lastSeq;
      if (lag > maxLag) return { name: shop.name, ok: false, detail: `the restored copy is ${lag} entries behind the live record (more than ${maxLag})` };
      return { name: shop.name, ok: true, detail: `restored ${back.records} entries, integrity ok, last entry #${back.lastSeq} matches the live record${lag > 0 ? ` (${lag} newer entries not yet copied)` : ""}` };
    } finally { live.close(); }
  } finally { restored.close(); }
}

if (import.meta.main) {
  const job = JSON.parse(readFileSync(process.argv[2], "utf8")) as DrillJob;
  console.log(JSON.stringify({ results: job.shops.map((s) => { try { return drillShop(s, job.maxLagEntries); } catch (e) { return { name: s.name, ok: false, detail: (e as Error).message }; } }) }));
}
