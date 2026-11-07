// FOUNDER'S LAPTOP ONLY. This is the one place in the pathway that reads or sends a model key, and only for the eval
// (scripts/model-eval.ts). The runtime model parser (src/adapters/model-llm.ts) holds no key and sends none: in production it
// points at a Guard instance, and Guard adds the key. Keys come from a local .env at the repo root, which git ignores.
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

/** The KEY=value lines of a .env file; {} when there is no file. Nothing from the shell's own environment is used. */
export function readEnvFile(path: URL | string): Record<string, string> {
  try { return parseEnv(readFileSync(path, "utf8")) as Record<string, string>; } catch { return {}; }
}

export type AuthHeader = "authorization" | "x-api-key" | "api-subscription-key";

/** A fetch that adds the key to every request. "authorization" sends "Bearer <key>"; the others send the key as it is. */
export function keyedFetch(header: AuthHeader, key: string, base: typeof fetch = globalThis.fetch): typeof fetch {
  const value = header === "authorization" ? `Bearer ${key}` : key;
  return ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => base(input, { ...init, headers: { ...(init?.headers as Record<string, string>), [header]: value } })) as typeof fetch;
}
