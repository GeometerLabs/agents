// status/<shop>.json: what the deployer tells the panel. The panel only reads it. Counts and names, never a secret.
import { existsSync, readFileSync } from "node:fs";
import { serverPaths } from "./server.ts";
import { stableJson, writeAtomic } from "./util.ts";

export interface GuardProof { passed: number; of: number; notSelfTestable: string[]; policyDigest: string; version: number; ready: boolean }

export interface ShopStatus {
  shop: string;
  updatedAt: string;
  lastDeploy: { at: string; ok: boolean; refusal: { rule: string; message: string }[] | null } | null;
  /** "N of M limits proven to bite", read from the RUNNING Guards after a deploy. The go-live certificate quotes `line`. */
  tripwires: { source: "running Guards" | "offline check"; passed: number; of: number; line: string; perGuard: Record<string, GuardProof>; /** The server's shared model Guard, proven the same way (not part of the shop's total). */ model?: GuardProof } | null;
  versions: { pathway: string; bundle: string; guardImage: string; guards: Record<string, number> } | null;
  stopped: { by: string; at: string; reason: string } | null;
  backup: { lastBackupAt: string | null; lastDrill: { at: string; ok: boolean; detail: string } | null };
  /** Where the providers should send webhooks (no token in it: a path-token shop adds its own token at the end). */
  webhooks: { razorpay: string; whatsapp: string } | null;
}

export const emptyStatus = (shop: string, now: Date): ShopStatus => ({ shop, updatedAt: now.toISOString(), lastDeploy: null, tripwires: null, versions: null, stopped: null, backup: { lastBackupAt: null, lastDrill: null }, webhooks: null });

export function readStatus(dir: string, shop: string): ShopStatus | undefined {
  const path = serverPaths(dir).statusFile(shop);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) as ShopStatus : undefined;
}

export function updateStatus(dir: string, shop: string, now: Date, change: (s: ShopStatus) => void): ShopStatus {
  const status = readStatus(dir, shop) ?? emptyStatus(shop, now);
  change(status);
  status.updatedAt = now.toISOString();
  writeAtomic(serverPaths(dir).statusFile(shop), stableJson(status));
  return status;
}
