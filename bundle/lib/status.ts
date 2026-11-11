// status/<shop>.json: what the deployer tells the panel. The panel only reads it, and reads it with its own checker (bundle/panel/contract.ts,
// `parseStatus`), so the first six fields below are exactly its shape: `updatedAt`, `deploy {state, at, message}`, `limits {proven, of, unprovable}`,
// `versions`, `stopped {at, requestId}` and `backups`. Fields it does not know are extra detail for `geometer status` and are ignored by it.
//
// `updatedAt` is the last time the deployer CONFIRMED the shop from its running Guards. The panel shows "Not confirmed yet" when it is old (30 minutes by
// default), so the deployer's loop refreshes it every minute while everything answers, and does not touch it when something does not: a quiet file
// is never read as "fine".
import { existsSync, readFileSync } from "node:fs";
import { serverPaths } from "./server.ts";
import type { UsageTotals } from "./usage.ts";
import type { StatusLicence } from "./licence.ts";
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
  /** The last daily fingerprint of the record's ledger (B28, backup/fingerprints.ts): what was written, or why it was refused (the record changed after it was published). */
  fingerprint?: { at: string; ok: boolean; day?: string; seq?: number; head?: string; signed?: boolean; detail?: string };
  /** The cost meter's cumulative counts over the shop's whole record, as of the last export (every 15 minutes). Counts only (lib/usage.ts). Ops sends the difference to fleet. */
  usage?: UsageTotals & { at: string };
  /** The unfinished-work list's counts by kind, as of the last export (modules/unfinished). Ops sends them as `open_obligations`. Kind ids and counts only. */
  obligations?: { counts: Record<string, number>; at: string };
  /** The shop's licence (B13), worked out on this server from the signed lease (lib/licence.ts). The panel shows it; the runtime reads its own copy (client/licence.json). */
  licence?: StatusLicence & { at: string };
  /** Where the providers should send webhooks (no token in it: a path-token shop adds its own token at the end). */
  webhooks?: { razorpay: string; whatsapp: string };
  /**
   * An agent someone else wrote (no runtime, no pathway): where its own agent calls Guard instead of each service, and where WhatsApp sends the shop's webhooks. Since
   * 12 Nov 2026 the panel shows own agents from this block (bundle/panel/agents.ts): each Guard's credential's dates (when made, an old one's end; never a credential or a
   * hash) and the calls its Guards held for the owner at the last minute's look. The last crash test and the version in service are in exports/<agent>/ (agent/requests.ts).
   */
  own?: {
    baseUrls: Record<string, string>; whatsappWebhook?: string;
    credentials?: { shared: boolean; guards: Record<string, { since?: string; oldUntil?: string }> };
    held?: { calls: number; at: string };
  };
}

// The status of a shop the deployer has not touched yet: deploy state "never" and no backups, so the panel shows "not deployed" rather than nothing.
export const emptyStatus = (shop: string, now: Date): ShopStatus => ({ shop, updatedAt: now.toISOString(), deploy: { state: "never" }, backups: { lastCopyAt: null, lastDrillAt: null, drillOk: null } });

// Reads a shop's status; a missing or damaged file is undefined, because the deployer rewrites it on its next run.
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
