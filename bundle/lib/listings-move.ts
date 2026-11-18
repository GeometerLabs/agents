// A listings-only shop's file, moving out of the shared process and into a runtime of its own: the day the shop takes an agent (Bookings, Orders, Fees, Stock orders), and the way a shop
// is let go to be restored or removed. The shop keeps its listings, its photos, its record and its owner's passkeys: they are in ONE folder (`<shared volume>/<shop>/data`: agent.db,
// owner-access.sqlite, push.sqlite, ...), laid out as any shop's data folder is, so the move is: let go, convert the saved state, copy the folder, keep the old copy.
//
//   1. LET GO     the shop's folder in generated/listings/ is taken away (letGoOfListings, pathway.lock first). The shared process, which looks every few seconds, stops the shop:
//                 its step in hand finishes and its store is closed. We WAIT until the process says it no longer holds the shop (GET /shared/shops), because copying a database that
//                 is still open would copy half a write. If it never lets go, nothing is touched and the move says so.
//   2. CONVERT    the SQLite file is the same file in every template (same tables, same schema number); what differs is the JSON the runtime keeps in it, which the template's own codec
//                 reads. The new template's `storeWith` writes a new store holding the listings' state (`assistant`) and the AI counts (`ai`), and that is committed as one step,
//                 so the record's hash chain, the photos (a table of the same file) and the tasks stay as they were. Run by the app's own image, offline.
//   3. COPY       into a new volume of the shop's own (`rt-data-<shop>`), as the runtime's user; the shared copy is renamed `.moved-<shop>-<time>` and KEPT: a person deletes it once
//                 the shop is seen to be well, never this code.
//   4. ADDRESS    the shop takes a place in the pool of network addresses (state.index was 0 for a shop on the shared process).
// The deploy that follows writes the shop's own containers (compose.ts) from the new pin. Nothing here decides WHEN a shop upgrades: the Operator changes the shop's pin and settings,
// and the deploy calls this for a shop whose applied pathway is listings-only and whose new one is not.
import { compose, letGoOfListings } from "../deploy.ts";
import type { Context } from "../deploy.ts";
import { project } from "../backup/jobs.ts";
import { RUNTIME_PORT, SHARED, names } from "../generate/shop.ts";
import { kindFor } from "./kinds.ts";
import type { State } from "./state.ts";
import { shopIndex, saveState } from "./state.ts";
import { loadServer } from "./server.ts";

/** The shops the shared process holds now, or undefined when it cannot be asked (not running). Asked inside its own container, on its own loopback address. */
export async function sharedHeld(ctx: Context): Promise<string[] | undefined> {
  const r = await compose(ctx, ["exec", "-T", SHARED.runtime, "wget", "-q", "-O", "-", `http://127.0.0.1:${RUNTIME_PORT}/shared/shops`], { timeoutMs: 20_000 });
  if (r.code !== 0) return undefined;
  try { const j = JSON.parse(r.stdout) as { shops?: unknown }; return Array.isArray(j.shops) ? j.shops.filter((x): x is string => typeof x === "string") : undefined; } catch { return undefined; }
}

/**
 * Let one shop go from the shared process and wait until it has. Returns true when the process no longer holds it (or when there is no process: nothing holds the file). Never
 * returns true while the process still names the shop.
 */
export async function letGoShared(ctx: Context, shop: string, o: { keep: ReadonlySet<string>; waitSeconds?: number }): Promise<boolean> {
  letGoOfListings(ctx, new Set([...o.keep].filter((n) => n !== shop)));
  const deadline = ctx.now().getTime() + (o.waitSeconds ?? 60) * 1000;
  for (;;) {
    const held = await sharedHeld(ctx);
    if (held === undefined) return true; // the process is not running (the first deploy, or the container is down): nothing has the file open
    if (!held.includes(shop)) return true;
    if (ctx.now().getTime() >= deadline) return false;
    await ctx.sleep(2_000);
  }
}

/** The volume's name as docker knows it, and the labels compose looks for, so a volume made here is the one compose then uses (and does not warn about). */
const volumeLabels = (project: string, name: string): string[] => ["--label", `com.docker.compose.project=${project}`, "--label", `com.docker.compose.volume=${name}`];

/**
 * Move a listings-only shop into the runtime of `target` (a pathway name). Throws, in plain words, and leaves the shop where it is, if the shared process does not let it go or any
 * step fails before the copy is complete.
 */
export async function moveOutOfShared(ctx: Context, state: State, shop: string, target: string, o: { keep: ReadonlySet<string> }): Promise<string> {
  const kind = kindFor(target);
  if (!kind || kind.shared || !kind.storeWith) throw new Error(`${shop} cannot move into ${target}: it is not a template with its own runtime.`);
  const server = loadServer(ctx.dir);
  const p = project(server);
  const stamp = ctx.now().toISOString().replace(/[-:]|\.\d{3}/gu, "");
  const from = `${p}_${SHARED.dataVolume}`;
  const to = `${p}_${names.dataVolume(shop)}`;
  if (!(await letGoShared(ctx, shop, o))) throw new Error(`${shop} was not moved: the shared process still holds it after a minute, and a file that is open is not copied. Nothing was changed; deploy again.`);
  // 2. convert the saved state, offline, as the runtime's user
  const conv = await ctx.runner.run(ctx.docker, ["run", "--rm", "--user", "1000:1000", "--network", "none", "-v", `${from}:/data/all`, "-v", `${ctx.appDir}:/app:ro`, server.appImage, "node", "/app/bundle/lib/listings-carry.ts", `/data/all/${shop}/data`, target], { timeoutMs: 120_000 });
  if (conv.code !== 0) throw new Error(`${shop} was not moved: its saved state could not be converted for ${target} (${conv.stderr.trim().split("\n").slice(-1)[0] ?? `exit ${conv.code}`}). Nothing was changed; the old folder is as it was.`);
  // 3. copy into the shop's own volume; keep the old folder under another name
  const vol = await ctx.runner.run(ctx.docker, ["volume", "create", ...volumeLabels(p, names.dataVolume(shop)), to]);
  if (vol.code !== 0) throw new Error(`${shop} was not moved: its new volume could not be made (${vol.stderr.trim().slice(0, 160)}).`);
  const copy = await ctx.runner.run(ctx.docker, ["run", "--rm", "--user", "1000:1000", "--network", "none", "-v", `${from}:/from`, "-v", `${to}:/to`, "busybox:1.37.0", "sh", "-c",
    `set -e; test -f /from/${shop}/data/agent.db; mkdir -p /to/data; cp -a /from/${shop}/data/. /to/data/; test -f /to/data/agent.db; mv /from/${shop} /from/.moved-${shop}-${stamp}`], { timeoutMs: 300_000 });
  if (copy.code !== 0) throw new Error(`${shop} was not moved: copying its folder failed (${copy.stderr.trim().slice(0, 160)}). The old folder is kept as it was.`);
  // 4. an address of its own
  const entry = state.shops[shop];
  entry.index = 0;
  entry.index = shopIndex(state, shop);
  saveState(ctx.dir, state);
  return `${shop}: moved from the shared process into a runtime of its own (${target}). Its listings, photos, record and the owner's passkeys came with it; the old folder is kept in the shared volume as .moved-${shop}-${stamp} until a person removes it.`;
}

/** Is there anything to move for this shop? Its applied pathway is a shared one and the one it is going to is not. */
export const needsMove = (state: State, shop: string, nextPathway: string | undefined): boolean => {
  const was = state.shops[shop]?.applied?.pathway.split("@")[0];
  return was !== undefined && kindFor(was)?.shared === true && nextPathway !== undefined && kindFor(nextPathway)?.shared !== true;
};
