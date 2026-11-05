// Which folder holds the pathway code a shop is pinned to. The agents repository carries one version of each pathway (the current one). A shop pinned to
// another version needs that version beside the server: <server>/pathways/<name>@<version>/ (a checkout of the tag). The runtime refuses to start on a
// version other than its pin, so a wrong folder is caught twice.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { serverPaths } from "./server.ts";

const versionOf = (folder: string): string | undefined => {
  try { return (JSON.parse(readFileSync(join(folder, "package.json"), "utf8")) as { version?: string }).version; } catch { return undefined; }
};

export function pathwayDirFor(appDir: string, serverDir: string, lock: { pathway: string; version: string }): string | undefined {
  const current = join(appDir, "pathways", lock.pathway);
  if (existsSync(current) && versionOf(current) === lock.version) return current;
  const kept = join(serverPaths(serverDir).root, "pathways", `${lock.pathway}@${lock.version}`);
  return existsSync(kept) && versionOf(kept) === lock.version ? kept : undefined;
}

/** A pathway version's own check of a runtime config (`validateRuntimeConfig` in its server/config.ts). */
export type RuntimeCheck = (config: unknown, folder: string) => { ok: boolean; errors?: string[] };

/**
 * The runtime-config check of the version a shop is PINNED to, read from that version's own folder (the checkout beside the server for an older pin, the agents repository
 * for the current one). This is what decides whether a setting the bundle adds to the generated config (`ai`, `report`) is one that version's runtime will start with: judged
 * by the repository's current check, a shop held back on an older version would be handed a key its own runtime refuses, and would not start.
 * If the version's check cannot be loaded (another layout, a file that does not import), nothing is known about it, so the optional settings are refused with a reason, and the
 * shop starts without them.
 */
export async function pinnedRuntimeCheck(pathwayDir: string): Promise<RuntimeCheck> {
  try {
    const loaded = (await import(pathToFileURL(join(pathwayDir, "server", "config.ts")).href)) as { validateRuntimeConfig?: unknown };
    if (typeof loaded.validateRuntimeConfig !== "function") throw new Error("it has no validateRuntimeConfig");
    return loaded.validateRuntimeConfig as RuntimeCheck;
  } catch (e) {
    const why = `I could not read the runtime-config check of the pathway in ${pathwayDir} (${(e as Error).message})`;
    return (config) => ("report" in (config as object) || "ai" in (config as object) ? { ok: false, errors: [why] } : { ok: true });
  }
}
