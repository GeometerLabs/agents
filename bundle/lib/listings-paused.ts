// Telling the Operator that a listings-only shop is PAUSED. The shared process (modules/runtime/shared.ts) pauses a shop that kept stopping its worker thread, and names it in
// `GET /shared/shops` (`paused`, `pausedDetail`). It has no way to message anyone, so the deployer's loop does what it already does for `usage` and `obligations`: it asks, and writes
// the answer into the shop's status file (lib/status.ts), which the panel reads (panel/contract.ts `paused`, panel/views.ts: one plain line on the shop's page). A shop that is no longer
// paused has the field removed, so the line goes by itself when the pause ends or the shop's files change. A process that cannot be asked changes nothing: silence is not "fine" and not "paused".
import { sharedHeldDetail } from "./listings-move.ts";
import type { Context } from "../deploy.ts";
import { readStatus, updateStatus } from "./status.ts";

/** One pass: copy the paused shops from the shared process into their status files, and clear those no longer paused. Returns a line for each change. */
export async function syncListingsPaused(ctx: Context, shops: string[]): Promise<string[]> {
  const lines: string[] = [];
  const asked = await sharedHeldDetail(ctx);
  if (!asked) return lines;
  const paused = new Map(asked.pausedDetail.map((p) => [p.shop, p]));
  for (const shop of shops) {
    const was = readStatus(ctx.dir, shop)?.paused;
    const now = paused.get(shop);
    if (!now && !was) continue;
    if (now && was && was.until === new Date(now.until).toISOString()) continue; // already written
    // confirm=false: this is not the deployer confirming the shop from its Guards, so `updatedAt` must not be refreshed by it
    updateStatus(ctx.dir, shop, ctx.now(), (s) => { if (now) s.paused = { until: new Date(now.until).toISOString(), why: now.why, at: was?.at ?? ctx.now().toISOString() }; else delete s.paused; }, false);
    lines.push(now ? `${shop}: paused by the shared process until ${new Date(now.until).toISOString()}.` : `${shop}: no longer paused.`);
  }
  return lines;
}
