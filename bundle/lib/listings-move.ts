// A listings-only shop's file, moving out of the shared process and into a runtime of its own: the day the shop takes an agent (Bookings, Orders, Fees, Stock orders), and the way a shop
// is let go to be restored or removed. The shop keeps its listings, its photos, its record and its owner's passkeys: they are in ONE folder (`<shared volume>/<shop>/data`: agent.db,
// owner-access.sqlite, push.sqlite, ...), laid out as any shop's data folder is, so the move is: let go, convert the saved state, copy the folder, keep the old copy.
//
//   1. LET GO     the shop's folder in generated/listings/ is taken away (letGoOfListings, pathway.lock first). The shared process, which looks every few seconds, stops the shop:
//                 its step in hand finishes and its store is closed. We WAIT until the process no longer NAMES the shop (GET /shared/shops names a shop until its store is closed),
//                 because copying a database that is still open would copy half a write. If it never lets go, the shop's folder is put back and nothing else was touched.
//   2. COPY       the shop's folder into a new volume of its own (`rt-data-<shop>`), by the app's own image as the runtime's user, mounted at /home/node as the runtime mounts it (a new
//                 volume takes the image folder's owner; a bare busybox mount would be root's). The shared volume is only READ here.
//   3. CONVERT    the COPY, offline: the SQLite file is the same file in every template (same tables, same schema number); what differs is the JSON the runtime keeps in it, which the
//                 template's own codec reads. The new template's `storeWith` writes a store holding the listings' state (`assistant`) and the AI counts (`ai`) as one step with no new
//                 record line, so the record's hash chain, the photos (a table of the same file) and the tasks stay as they were.
//   4. KEEP       only now the shared folder is renamed `.moved-<shop>-<time>` and KEPT: a person deletes it once the shop is seen to be well, never this code.
//   5. ADDRESS    the shop takes a place in the pool of network addresses (state.index was 0 for a shop on the shared process), and its secrets folder in the shared tree is removed.
// Because the source is never changed before the copy is whole and converted, ANY failure up to step 4 leaves the shop's file exactly as it was; the move then writes the shop's folder back
// (its applied state is still the listings one), the shared process starts it again, and the half-made new volume is removed.
// The deploy that follows writes the shop's own containers (compose.ts) from the new pin. Nothing here decides WHEN a shop upgrades: the Operator changes the shop's pin and settings,
// and the deploy calls this for a shop whose applied pathway is listings-only and whose new one is not.
import { rmSync } from "node:fs";
import { compose, letGoOfListings, writeServer } from "../deploy.ts";
import type { Context } from "../deploy.ts";
import { project } from "../backup/jobs.ts";
import { RUNTIME_PORT, SHARED, names, secretsHolderOf } from "../generate/shop.ts";
import { secretFile } from "./secrets.ts";
import { kindFor } from "./kinds.ts";
import type { State } from "./state.ts";
import { shopIndex, saveState } from "./state.ts";
import { loadServer } from "./server.ts";

/** The shops the shared process names now (held, or stopping with their store still open), or undefined when it cannot be asked. Asked inside its own container, on its own loopback address. */
export async function sharedHeld(ctx: Context): Promise<string[] | undefined> {
  const r = await compose(ctx, ["exec", "-T", SHARED.runtime, "wget", "-q", "-O", "-", `http://127.0.0.1:${RUNTIME_PORT}/shared/shops`], { timeoutMs: 20_000 });
  if (r.code !== 0) return undefined;
  try { const j = JSON.parse(r.stdout) as { shops?: unknown }; return Array.isArray(j.shops) ? j.shops.filter((x): x is string => typeof x === "string") : undefined; } catch { return undefined; }
}

/** What `/shared/shops` says about shops the process has PAUSED (shared-pool.ts), or undefined when it cannot be asked: the deployer copies it into the shops' status files (lib/listings-paused.ts). */
export async function sharedHeldDetail(ctx: Context): Promise<{ pausedDetail: { shop: string; why: string; until: number }[] } | undefined> {
  const r = await compose(ctx, ["exec", "-T", SHARED.runtime, "wget", "-q", "-O", "-", `http://127.0.0.1:${RUNTIME_PORT}/shared/shops`], { timeoutMs: 20_000 });
  if (r.code !== 0) return undefined;
  try {
    const j = JSON.parse(r.stdout) as { pausedDetail?: unknown };
    const list = Array.isArray(j.pausedDetail) ? j.pausedDetail : [];
    return { pausedDetail: list.filter((x): x is { shop: string; why: string; until: number } => typeof x?.shop === "string" && typeof x?.until === "number").map((x) => ({ shop: x.shop, why: String(x.why ?? "").slice(0, 300), until: x.until })) };
  } catch { return undefined; }
}

/** Is the shared container NOT running (so nothing has any shop's file open)? Only a clean "no running container" says so: an exec that failed for another reason is not an answer. */
async function sharedIsDown(ctx: Context): Promise<boolean> {
  const r = await compose(ctx, ["ps", "--status", "running", "-q", SHARED.runtime], { timeoutMs: 20_000 });
  return r.code === 0 && r.stdout.trim() === "";
}

/**
 * Let one shop go from the shared process and wait until it has: the process no longer names it (it names a shop until its store is closed), or the container is down. It FAILS
 * CLOSED: when the process cannot be asked and is not known to be down, this waits, and gives up with false, never with true.
 */
export async function letGoShared(ctx: Context, shop: string, o: { keep: ReadonlySet<string>; waitSeconds?: number }): Promise<boolean> {
  letGoOfListings(ctx, new Set([...o.keep].filter((n) => n !== shop)));
  const deadline = ctx.now().getTime() + (o.waitSeconds ?? 60) * 1000;
  for (;;) {
    const held = await sharedHeld(ctx);
    if (held !== undefined ? !held.includes(shop) : await sharedIsDown(ctx)) return true;
    if (ctx.now().getTime() >= deadline) return false;
    await ctx.sleep(2_000);
  }
}

/** The volume's labels compose looks for, so a volume made here is the one compose then uses (and does not warn about). */
const volumeLabels = (project: string, name: string): string[] => ["--label", `com.docker.compose.project=${project}`, "--label", `com.docker.compose.volume=${name}`];

/**
 * Move a listings-only shop into the runtime of `target` (a pathway name). Throws, in plain words. Up to the last step the shop's file in the shared volume is only read, so a
 * failure leaves it as it was and the shop is put back on the shared process (see the top of this file).
 */
export async function moveOutOfShared(ctx: Context, state: State, shop: string, target: string, o: { keep: ReadonlySet<string> }): Promise<string> {
  const kind = kindFor(target);
  if (!kind || kind.shared || !kind.storeWith) throw new Error(`${shop} cannot move into ${target}: it is not a template with its own runtime.`);
  const server = loadServer(ctx.dir);
  const p = project(server);
  const stamp = ctx.now().toISOString().replace(/[-:]|\.\d{3}/gu, "");
  const from = `${p}_${SHARED.dataVolume}`;
  const to = `${p}_${names.dataVolume(shop)}`;
  const run = (args: string[], timeoutMs: number) => ctx.runner.run(ctx.docker, ["run", "--rm", "--user", "1000:1000", "--network", "none", ...args], { timeoutMs });
  /** The shop's folder back where the shared process looks (its applied state is still the listings-only one), and the half-made volume gone. */
  const putBack = async (): Promise<void> => {
    try { writeServer(ctx, server, state); } catch { /* the next deploy writes it */ }
    try { await ctx.runner.run(ctx.docker, ["volume", "rm", "-f", to]); } catch { /* nothing to remove */ }
  };
  if (!(await letGoShared(ctx, shop, o))) { await putBack(); throw new Error(`${shop} was not moved: the shared process still holds it after a minute, and a file that is open is not copied. The shop is where it was; deploy again.`); }
  try {
    // 2. copy, as the runtime's own user, into a volume of the shop's own (the app image's /home/node gives it the right owner)
    const vol = await ctx.runner.run(ctx.docker, ["volume", "create", ...volumeLabels(p, names.dataVolume(shop)), to]);
    if (vol.code !== 0) throw new Error(`its new volume could not be made (${vol.stderr.trim().slice(0, 160)})`);
    const copy = await run(["-v", `${from}:/from:ro`, "-v", `${to}:/home/node`, server.appImage, "sh", "-c", `set -e; test -f /from/${shop}/data/agent.db; rm -rf /home/node/data; mkdir -p /home/node/data; cp -a /from/${shop}/data/. /home/node/data/; test -f /home/node/data/agent.db`], 300_000);
    if (copy.code !== 0) throw new Error(`copying its folder failed (${copy.stderr.trim().slice(0, 160)})`);
    // 3. convert the COPY
    const conv = await run(["-v", `${to}:/home/node`, "-v", `${ctx.appDir}:/app:ro`, server.appImage, "node", "/app/bundle/lib/listings-carry.ts", "/home/node/data", target], 120_000);
    if (conv.code !== 0) throw new Error(`its saved state could not be converted for ${target} (${(conv.stdout + conv.stderr).trim().split("\n").slice(-1)[0] ?? `exit ${conv.code}`})`);
    // 4. keep the shared folder under another name (the copy is whole and converted)
    const keep = await run(["-v", `${from}:/from`, "busybox:1.37.0", "sh", "-c", `mv /from/${shop} /from/.moved-${shop}-${stamp}`], 60_000);
    if (keep.code !== 0) throw new Error(`the old folder could not be set aside (${keep.stderr.trim().slice(0, 160)})`);
  } catch (e) {
    await putBack();
    throw new Error(`${shop} was not moved: ${(e as Error).message}. Its file in the shared volume was not changed and the shop is back on the shared process.`);
  }
  // 5. an address of its own, and the secrets of the shared tree gone (the shop's own runtime has made its own)
  const entry = state.shops[shop];
  entry.index = 0;
  entry.index = shopIndex(state, shop);
  saveState(ctx.dir, state);
  rmSync(secretFile(ctx.dir, secretsHolderOf(shop, true)), { recursive: true, force: true });
  return `${shop}: moved from the shared process into a runtime of its own (${target}). Its listings, photos and record came with it (the owner's passkeys too when the owner's number in the new settings is the one they were made for; otherwise the owner is given a new sign-in code); the old folder is kept in the shared volume as .moved-${shop}-${stamp} until a person removes it.`;
}

/** Is there anything to move for this shop? Its applied pathway is a shared one and the one it is going to is not. */
export const needsMove = (state: State, shop: string, nextPathway: string | undefined): boolean => {
  const was = state.shops[shop]?.applied?.pathway.split("@")[0];
  return was !== undefined && kindFor(was)?.shared === true && nextPathway !== undefined && kindFor(nextPathway)?.shared !== true;
};
