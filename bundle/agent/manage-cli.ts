// The command line of an own agent's upkeep (B51's rest, 12 Nov 2026), kept out of geometer.ts so the main command file only dispatches:
//   geometer agent rotate <name> [--guard <kind>] [--overlap-minutes N]    a new credential for each Guard (or one), with an overlap (agent/rotate.ts)
//   geometer agent remove <name> [--force]                                 take the agent off this server, keeping its record (agent/remove.ts)
// Neither prints a credential.
import type { Context } from "../deploy.ts";
import { removeAgent } from "./remove.ts";
import { ROTATION_OVERLAP_MINUTES, rotateAgent } from "./rotate.ts";

type Values = Record<string, string | boolean | undefined>;

export const MANAGE_SUBCOMMANDS = ["rotate", "remove"] as const;

/** `agent rotate|remove <name>`. Returns the exit code; a refusal is thrown with its words, as the other agent commands do. */
export async function manageCommand(ctx: Context, sub: (typeof MANAGE_SUBCOMMANDS)[number], name: string, values: Values): Promise<number> {
  const str = (k: string) => (typeof values[k] === "string" ? values[k] as string : undefined);
  if (sub === "rotate") {
    const minutes = str("overlap-minutes");
    if (minutes !== undefined && !/^\d+$/u.test(minutes)) throw new Error(`--overlap-minutes must be a whole number of minutes (the default is ${ROTATION_OVERLAP_MINUTES}).`);
    const r = await rotateAgent(ctx, name, { ...(str("guard") ? { guard: str("guard") } : {}), ...(minutes !== undefined ? { overlapMinutes: Number(minutes) } : {}) });
    r.lines.forEach((l) => console.log(l));
    return 0;
  }
  const r = await removeAgent(ctx, name, { force: values.force === true });
  r.lines.forEach((l) => console.log(l));
  return 0;
}
