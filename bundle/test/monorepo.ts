// Where Geometer's monorepo is, when this repo's tests may read it (set GEOMETER_MONOREPO, or have it beside this repo). The bundle and fleet share a few
// facts (the heartbeat contract, the plan terms); a test that compares them skips, and says why, when the monorepo is not there.
import { existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../../", import.meta.url).pathname;

export const MONOREPO: string | undefined = [process.env.GEOMETER_MONOREPO, join(ROOT, "..", "monorepo"), join(ROOT, "..", "..", "monorepo"), join(ROOT, "..", "..", "geometer", "monorepo"), join(ROOT, "..", "geometer", "monorepo")]
  .filter((x): x is string => !!x).find((c) => existsSync(join(c, "apps", "fleet", "src", "schema.ts")));

export const fleetFile = (...parts: string[]): string | undefined => (MONOREPO ? join(MONOREPO, "apps", "fleet", ...parts) : undefined);

/** Fleet's own heartbeat checker, if the monorepo is here. */
export async function fleetChecker(): Promise<{ checkHeartbeat(input: unknown): { ok: boolean; problems?: unknown[] } } | undefined> {
  const file = fleetFile("src", "schema.ts");
  return file ? await import(file) : undefined;
}
