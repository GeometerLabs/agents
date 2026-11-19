// Where a shop's generated client folder is (settings.json, runtime.json, pathway.lock, and the files the deployer hands the running shop: pages.json, owner-grants.json,
// licence.json, ...). For most shops that is generated/shops/<shop>/client, mounted into the shop's own container. A listings-only shop has no container of its own: it runs on the
// server's one shared process (go/cmd/listings-shared), which mounts ONE folder, generated/listings/, holding only listings-only shops. Keeping them in a folder of their own
// means the shared process can see no other shop's settings, and a new shop is a new folder in a mount that is already there (no container to change).
//
// The answer follows what is APPLIED (state.json), and the pin file only before the first apply, so a shop that takes an agent keeps its old folder until the deploy that moves it.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isShared } from "./kinds.ts";
import { serverPaths } from "./server.ts";
import { loadState } from "./state.ts";
import type { State } from "./state.ts";

/** The pathway a shop runs now (`listings`), or the one it is pinned to when nothing has been applied; undefined for a folder that has neither. */
export function pathwayOfShop(dir: string, shop: string, state?: State): string | undefined {
  const applied = (state ?? loadState(dir)).shops[shop]?.applied?.pathway;
  if (applied) return applied.split("@")[0];
  const lock = join(serverPaths(dir).shop(shop), "pathway.lock");
  if (!existsSync(lock)) return undefined;
  const line = readFileSync(lock, "utf8").split("\n").map((l) => l.trim()).find((l) => l !== "" && !l.startsWith("#"));
  return line?.split("@")[0];
}

/** The folder the shop's running runtime reads its client files from. */
/** `state`: the deployer's state in memory, mid-deploy, when what is applied is not on disk yet (a shop moving from the shared process to a runtime of its own). */
export const clientDir = (dir: string, shop: string, state?: State): string => join(serverPaths(dir).generated, isShared(pathwayOfShop(dir, shop, state)) ? "listings" : "shops", shop, "client");
