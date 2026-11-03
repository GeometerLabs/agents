// Which folder holds the pathway code a shop is pinned to. The agents repository carries one version of each pathway (the current one). A shop pinned to
// another version needs that version beside the server: <server>/pathways/<name>@<version>/ (a checkout of the tag). The runtime refuses to start on a
// version other than its pin, so a wrong folder is caught twice.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
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
