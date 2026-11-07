// Which folder holds the template code a shop is pinned to ("pathway" is still the name in a shop's pin: pathway.lock, `bookings@0.1.0`).
// The agents repository carries one version of each template (the current one) at templates/<domain>/<name>, for example templates/commerce/bookings. A shop pinned to
// another version needs that version beside the server, laid out the same way: <server>/templates/<domain>/<name>@<version>/ (a checkout of the tag) with the shared
// modules at <server>/modules. A server set up before the templates were grouped by domain keeps them at <server>/pathways/<name>@<version>/; those are still found.
// The runtime refuses to start on a version other than its pin, so a wrong folder is caught twice.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { serverPaths } from "./server.ts";

const versionOf = (folder: string): string | undefined => {
  try { return (JSON.parse(readFileSync(join(folder, "package.json"), "utf8")) as { version?: string }).version; } catch { return undefined; }
};

/** The domain folders under <root>/templates (commerce, education, community, ...), in a fixed order. */
const domainsUnder = (root: string): string[] => {
  try { return readdirSync(join(root, "templates"), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort(); } catch { return []; }
};

/** Every folder <root>/templates/<domain>/<leaf> that exists. */
const foldersCalled = (root: string, leaf: string): string[] => domainsUnder(root).map((d) => join(root, "templates", d, leaf)).filter((f) => existsSync(f));

/** The current checkout's folder for a template, whatever its domain: templates/<domain>/<name>. */
export function checkoutDirOf(appDir: string, name: string): string | undefined {
  return foldersCalled(appDir, name).find((f) => versionOf(f) !== undefined);
}

export function pathwayDirFor(appDir: string, serverDir: string, lock: { pathway: string; version: string }): string | undefined {
  const current = foldersCalled(appDir, lock.pathway).find((f) => versionOf(f) === lock.version);
  if (current) return current;
  const root = serverPaths(serverDir).root;
  const kept = `${lock.pathway}@${lock.version}`;
  return [...foldersCalled(root, kept), join(root, "pathways", kept)].find((f) => versionOf(f) === lock.version);
}

/** Where to put a checkout of a version the server does not have: the domain is the one the current checkout keeps the template in (<domain> when it has none). */
export function keptDirFor(appDir: string, serverDir: string, name: string, version: string): string {
  const current = checkoutDirOf(appDir, name);
  return join(serverPaths(serverDir).root, "templates", current ? basename(dirname(current)) : "<domain>", `${name}@${version}`);
}

/**
 * The folder a shop that is already running uses. The state file stores the folder it was deployed from, as an absolute path. That folder may be gone or empty (the checkout was
 * updated to the layout grouped by domain, a kept version was removed), and a bind mount of a missing folder is made empty by Docker, so the runtime would die with a missing module.
 * So the stored folder is used only if it still holds the version the shop was applied at; otherwise it is looked up again from the pin, and undefined says the server no longer
 * has that version at all.
 */
export function appliedPathwayDir(appDir: string, serverDir: string, applied: { pathway: string; pathwayDir: string }): string | undefined {
  const [pathway, version] = applied.pathway.split("@");
  return versionOf(applied.pathwayDir) === version ? applied.pathwayDir : pathwayDirFor(appDir, serverDir, { pathway, version });
}

/** A template version's own check of a runtime config (`validateRuntimeConfig` in its server/config.ts). */
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
    const why = `I could not read the runtime-config check of the template in ${pathwayDir} (${(e as Error).message})`;
    return (config) => ("report" in (config as object) || "ai" in (config as object) ? { ok: false, errors: [why] } : { ok: true });
  }
}
