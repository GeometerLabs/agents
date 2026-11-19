// The fixtures the Guard-client vector cases are built from: Guard's own answers and the providers' sample bodies that the Bookings template keeps in test/fixtures (reproduced from
// the providers' documentation and from Guard's docs). Read here once, so every case takes a copy.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Scripted } from "../lib/record.ts";

const dir = fileURLToPath(new URL("../../../templates/commerce/bookings/test/fixtures/", import.meta.url));
export const fixture = (name: string): any => JSON.parse(readFileSync(dir + name, "utf8"));
const guardAnswers = fixture("guard-responses.json");

/** One of Guard's answers as a scripted reply (status, headers, body), by its name in guard-responses.json. */
export function guardReply(name: string): Scripted {
  const g = guardAnswers[name];
  if (!g) throw new Error(`no Guard answer called ${name}`);
  return { status: g.status, headers: { ...g.headers }, body: structuredClone(g.body) };
}
export const guardNames: string[] = Object.keys(guardAnswers).filter((k) => !k.startsWith("_"));

/** A 200 JSON reply. */
export const ok = (body: unknown, headers: Record<string, string> = {}): Scripted => ({ status: 200, body, headers });
/** A reply with this status and JSON body. */
export const status = (code: number, body?: unknown, headers: Record<string, string> = {}): Scripted => ({ status: code, ...(body !== undefined ? { body } : {}), headers });
