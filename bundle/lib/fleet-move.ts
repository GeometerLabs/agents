// Telling fleet about a move (block S, 18 Nov 2026; closes bundle/Deferred.md "Telling fleet about a handover"). When an owner agreed to another Operator and the panel moved the
// shop, fleet still bills the OLD Operator until it is told. The panel writes what it knows (shops/<shop>/fleet-move.json: the move's code hash, the new Operator's id IN FLEET
// from their account, `fleetPartner`) and the deployer, which alone holds the deployment key, makes the call on its next passes:
//   POST /v1/shops/{agent}/partner  {partner}   (monorepo apps/fleet/src/billing-api.ts; the server's own key, its own shops, the plan kept)
// and writes what came of it for the panel (status/fleet-move/<shop>.json). Asked once per move (the code hash names the move) and safe to ask again: fleet answers "moved: false"
// when it already holds it.
//   told       fleet moved it (or already had): the new Operator is billed, the old one is not
//   waiting    fleet could not be reached, did not know the route yet (404, before the fleet deploy) or answered 5xx: asked again in RETRY_MS
//   refused    fleet said no in words (the Operator does not serve here yet, is paused, is at their limit): not asked again for this move; Geometer's admin gives the shop with the
//              plan call, and the panel shows the words
//   no_id      the new account has no Operator id in fleet (a builder's passphrase account): nothing to send; shown so Geometer's admin can do it by hand
//   no_fleet   this server is not paired with fleet: nothing to tell
// The heartbeat is not used (fleet refuses a heartbeat with a field it does not know, bundle/Deferred.md).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { callFleet } from "./pages.ts";
import { serverPaths } from "./server.ts";
import type { ServerConfig } from "./server.ts";
import { stableJson, writeAtomic } from "./util.ts";

export interface FleetMoveFile { schema: 1; codeHash: string; /** The new Operator's id in fleet, or null when their account has none. */ partner: string | null; /** The new Operator's name, for the panel's words. */ to: string; at: string }
export interface FleetMoveStatus { schema: 1; codeHash: string; state: "told" | "waiting" | "refused" | "no_id" | "no_fleet"; at: string; message?: string }

export const RETRY_MS = 10 * 60_000;
export const fleetMoveFile = (dir: string, shop: string): string => join(serverPaths(dir).shop(shop), "fleet-move.json");
export const fleetMoveStatusFile = (dir: string, shop: string): string => join(serverPaths(dir).root, "status", "fleet-move", `${shop}.json`);

/** The panel's side: what it knows of a finished move. */
export function writeFleetMove(dir: string, shop: string, m: Omit<FleetMoveFile, "schema">): void {
  writeAtomic(fleetMoveFile(dir, shop), `${stableJson({ schema: 1, ...m })}\n`);
}
const readJson = <T>(file: string): T | undefined => { try { return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) as T : undefined; } catch { return undefined; } };
export const readFleetMove = (dir: string, shop: string): FleetMoveFile | undefined => { const m = readJson<FleetMoveFile>(fleetMoveFile(dir, shop)); return m?.schema === 1 && typeof m.codeHash === "string" ? m : undefined; };
export const readFleetMoveStatus = (dir: string, shop: string): FleetMoveStatus | undefined => { const s = readJson<FleetMoveStatus>(fleetMoveStatusFile(dir, shop)); return s?.schema === 1 ? s : undefined; };

/** The deployer's pass: for each shop with a move fleet has not settled, one call. Returns a line for each thing that changed, for the deployer's log. */
export async function syncFleetMoves(o: { dir: string; server: ServerConfig; shops: readonly string[]; now: Date; fetchImpl?: typeof fetch }): Promise<string[]> {
  const lines: string[] = [];
  const t = o.now.getTime();
  for (const shop of o.shops) {
    const move = readFleetMove(o.dir, shop);
    if (!move) continue;
    const had = readFleetMoveStatus(o.dir, shop);
    const mine = had?.codeHash === move.codeHash ? had : undefined;
    if (mine && (mine.state === "told" || mine.state === "refused" || mine.state === "no_id" || mine.state === "no_fleet")) continue; // settled for this move
    if (mine?.state === "waiting" && t - Date.parse(mine.at) < RETRY_MS) continue;
    const save = (state: FleetMoveStatus["state"], message?: string) => writeAtomic(fleetMoveStatusFile(o.dir, shop), `${stableJson({ schema: 1, codeHash: move.codeHash, state, at: o.now.toISOString(), ...(message ? { message } : {}) })}\n`);
    if (!o.server.fleet) { save("no_fleet", "This server is not paired with fleet, so there is nobody to tell."); continue; }
    if (!move.partner) { save("no_id", `${move.to}'s account has no Operator id in fleet, so fleet was not told: Geometer's admin gives the shop with the plan call.`); lines.push(`${shop}: fleet was not told about the move to ${move.to}: their account has no Operator id in fleet.`); continue; }
    const r = await callFleet(o.server, o.dir, `/v1/shops/${encodeURIComponent(shop)}/partner`, { partner: move.partner }, o.fetchImpl ?? fetch);
    const said = typeof r.answer.error === "string" ? r.answer.error.slice(0, 300) : undefined;
    if (r.status === 200) { save("told"); lines.push(`${shop}: fleet now bills ${move.to}.`); }
    else if (r.status === 400 || r.status === 403) { save("refused", said ?? "Fleet did not take the move."); lines.push(`${shop}: fleet did not take the move to ${move.to}: ${said ?? `http ${r.status}`}`); }
    else { save("waiting", said ?? (r.status === 0 ? "Fleet could not be reached." : `Fleet answered ${r.status}.`)); lines.push(`${shop}: fleet was not told yet (${r.status === 0 ? "unreachable" : r.status}); asked again in ten minutes.`); }
  }
  return lines;
}
