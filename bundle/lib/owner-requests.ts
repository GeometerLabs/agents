// The owner's pending requests across the server, for the pilot's daily check (owner's item 2, "no Operator holds a shop hostage"). An Operator's request to remove every phone, or a
// changed owner number, waits 48 hours before the runtime applies it; the owner sees it in their app and by push, and where that is not enough (a shop that has WhatsApp
// and little push) a person at Geometer phones the owner. This reads each shop's EXPORTED record (the deployer's record.json, a few minutes old at most): the runtime writes
// `owner_session` lines named removal_asked / owner_change_asked / removal_extended when it first sees a request, and removal_cancelled / removal_applied / owner_reset when it
// ends. Nothing here asks a runtime, and nothing here changes anything.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { askEntries } from "./owner-file.ts";
import { serverPaths } from "./server.ts";
import { stableJson, writeAtomic } from "./util.ts";

export interface OwnerRequest { shop: string; kind: "removal" | "owner_change"; askedBy: string; firstSeen: string; appliesAt: string }
export const OWNER_REQUESTS_FILE = "owner-requests.json";

/** The requests still waiting in one shop's exported record, oldest first (one at a time of each kind). */
export function pendingFromRecord(shop: string, entries: readonly { time: string; action: string; refs?: Readonly<Record<string, string>> }[]): OwnerRequest[] {
  const open = new Map<"removal" | "owner_change", OwnerRequest>();
  for (const e of entries) {
    if (e.action !== "owner_session") continue;
    const what = e.refs?.what;
    if (what === "removal_asked") open.set("removal", { shop, kind: "removal", askedBy: e.refs?.by ?? "", firstSeen: e.time, appliesAt: e.refs?.effectiveAt ?? "" });
    else if (what === "owner_change_asked") open.set("owner_change", { shop, kind: "owner_change", askedBy: "the owner number was changed in the settings", firstSeen: e.time, appliesAt: e.refs?.effectiveAt ?? "" });
    else if (what === "removal_extended") { for (const r of open.values()) r.appliesAt = e.refs?.effectiveAt ?? r.appliesAt; }
    else if (what === "removal_cancelled") open.clear(); // the owner's Cancel ends whatever waited
    else if (what === "removal_applied" || what === "owner_reset") open.clear();
  }
  return [...open.values()].sort((a, b) => a.firstSeen.localeCompare(b.firstSeen));
}

/** Every shop's waiting requests, from the exported records. */
export function readOwnerRequests(dir: string, shops: readonly string[]): OwnerRequest[] {
  const out: OwnerRequest[] = [];
  for (const shop of shops) {
    const file = join(serverPaths(dir).root, "exports", shop, "record.json");
    if (!existsSync(file)) continue;
    try { out.push(...pendingFromRecord(shop, askEntries(readFileSync(file, "utf8")))); } catch { /* an unreadable record says nothing */ }
  }
  return out;
}

/** The deployer's pass: write status/owner-requests.json (only when it changed) so the pilot's daily check, and anything else that reads status/, sees them. Returns a line when it changed. */
export function writeOwnerRequests(dir: string, shops: readonly string[], now: Date): string[] {
  const requests = readOwnerRequests(dir, shops);
  const file = join(serverPaths(dir).status, OWNER_REQUESTS_FILE);
  let have = "";
  try { have = readFileSync(file, "utf8"); } catch { have = ""; }
  let before: unknown; try { before = (JSON.parse(have) as { requests?: unknown }).requests; } catch { before = undefined; }
  if (stableJson(before ?? []) === stableJson(requests) && have !== "") return [];
  writeAtomic(file, `${stableJson({ schema: 1, at: now.toISOString(), requests })}\n`);
  return [requests.length === 0 ? "No owner request is waiting any more." : `${requests.length} owner request${requests.length === 1 ? " is" : "s are"} waiting (status/${OWNER_REQUESTS_FILE}).`];
}
