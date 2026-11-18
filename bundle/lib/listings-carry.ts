// The conversion step of a move out of the shared process (bundle/lib/listings-move.ts), run offline in a short-lived container over the shop's own data folder:
//
//   node bundle/lib/listings-carry.ts <data folder> <target pathway>
//
// It opens the shop's store, takes what a listings-only store holds that any other template's store can keep (the assistant's part: the listings, cards and memory; and the month's AI
// counts), and saves a store of the TARGET template holding exactly that, as ONE step with no new record entry. The photos table, the record's chain, the tasks and the window are
// untouched: they are the same tables in every template's file. Prints one line of JSON: {"ok": true, "listings": n} or {"ok": false, "error": "..."}.
import { openStore } from "../../modules/runtime/store.ts";
import { kindFor } from "./kinds.ts";
import { FORMAT } from "../../templates/commerce/listings/server/snapshot.ts";

export function carry(dataDir: string, target: string, nowMs: number = Date.now()): { ok: true; listings: number } | { ok: false; error: string } {
  const kind = kindFor(target);
  if (!kind?.storeWith) return { ok: false, error: `${target} is not a template a shop can move into.` };
  const store = openStore(dataDir);
  try {
    const { snapshot } = store.loadState();
    if (snapshot === null) return { ok: false, error: "the shop has no saved state yet, so there is nothing to carry (start the shop once)." };
    const saved = JSON.parse(snapshot) as { format?: number; assistant?: { listings?: { items?: unknown[] } }; ai?: unknown };
    if (saved.format !== FORMAT || "orders" in saved || "bookings" in saved || "dues" in saved) return { ok: false, error: "the saved state is not a listings-only shop's." };
    store.commitStep({ snapshot: kind.storeWith({ assistant: saved.assistant, ai: saved.ai }), entries: [], nowMs });
    return { ok: true, listings: saved.assistant?.listings?.items?.length ?? 0 };
  } finally { store.close(); }
}

if (import.meta.main) {
  const [dir, target] = process.argv.slice(2);
  try {
    const r = dir && target ? carry(dir, target) : { ok: false as const, error: "usage: listings-carry.ts <data folder> <target pathway>" };
    console.log(JSON.stringify(r));
    process.exit(r.ok ? 0 : 1);
  } catch (e) { console.log(JSON.stringify({ ok: false, error: (e as Error).message })); process.exit(1); }
}
