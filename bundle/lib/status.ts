// status/<shop>.json: what the deployer tells the panel. The panel only reads it, and reads it with its own checker (bundle/panel/contract.ts,
// `parseStatus`), so the first six fields below are exactly its shape: `updatedAt`, `deploy {state, at, message}`, `limits {proven, of, unprovable}`,
// `versions`, `stopped {at, requestId}` and `backups`. Fields it does not know are extra detail for `geometer status` and are ignored by it.
//
// `updatedAt` is the last time the deployer CONFIRMED the shop from its running Guards. The panel shows "Not confirmed yet" when it is old (30 minutes by
// default), so the deployer's loop refreshes it every minute while everything answers, and does not touch it when something does not: a quiet file
// is never read as "fine".
import { existsSync, readFileSync } from "node:fs";
import { serverPaths } from "./server.ts";
import { stableJson, writeAtomic } from "./util.ts";
import type { Problem } from "./util.ts";

export interface GuardProof { passed: number; of: number; notSelfTestable: string[]; policyDigest: string; version: number; ready: boolean }

export interface ShopStatus {
  shop: string;
  updatedAt: string;
  deploy: { state: "applied" | "failed" | "in-progress" | "never"; at?: string; message?: string; /** every broken rule, by name (the message is the short form the panel shows) */ refusal?: Problem[] };
  /** "N of M limits proven to bite", read from the RUNNING Guards (their tripwires). `unprovable` names what a tripwire cannot test without writing; those are never counted. */
  limits?: { proven: number; of: number; unprovable: string[]; line: string; perGuard: Record<string, GuardProof>; /** The shared model Guard, proven the same way (not part of the shop's total). */ model?: GuardProof };
  versions?: { pathway: string; bundle: string; guard: string; guards: Record<string, number> };
  stopped?: { at: string; requestId?: string; by?: string; reason?: string };
  backups?: { lastCopyAt: string | null; lastDrillAt: string | null; drillOk: boolean | null; drillDetail?: string };
  /** Where the providers should send webhooks (no token in it: a path-token shop adds its own token at the end). */
  webhooks?: { razorpay: string; whatsapp: string };
  /** An agent someone else wrote (no runtime, no pathway): where its own agent calls Guard instead of each service, and where WhatsApp sends the shop's webhooks. The panel ignores it. */
  own?: { baseUrls: Record<string, string>; whatsappWebhook?: string };
}

export const emptyStatus = (shop: string, now: Date): ShopStatus => ({ shop, updatedAt: now.toISOString(), deploy: { state: "never" }, backups: { lastCopyAt: null, lastDrillAt: null, drillOk: null } });

export function readStatus(dir: string, shop: string): ShopStatus | undefined {
  const path = serverPaths(dir).statusFile(shop);
  try { return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as ShopStatus : undefined; } catch { return undefined; }
}

/** Change a shop's status. `confirm` says whether this moment also counts as the deployer having confirmed the shop (it moves `updatedAt`). */
export function updateStatus(dir: string, shop: string, now: Date, change: (s: ShopStatus) => void, confirm = true): ShopStatus {
  const status = readStatus(dir, shop) ?? emptyStatus(shop, now);
  change(status);
  if (confirm) status.updatedAt = now.toISOString();
  writeAtomic(serverPaths(dir).statusFile(shop), stableJson(status));
  return status;
}

/** The short form of a refusal for the panel (its checker drops a message over 500 characters). */
export const refusalMessage = (problems: Problem[]): string => problems.map((p) => `[${p.rule}] ${p.message}`).join(" ").slice(0, 480);
