// The unfinished-work inbox (plan B31): one list across the shops this person may see, worked out from each shop's exported record and cases
// (exports/<shop>/record.json and bookings.json, dues.json or orders.json, which the deployer writes and which carry no customer's number) by the kinds in
// modules/unfinished. Nothing is saved: the list is read again each time, so it can never disagree with the record. A shop that is stopped, or whose
// subscription lapsed, still has its last export, so it still has its list.
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { obligations } from "../../modules/unfinished/index.ts";
import type { CaseLike, Obligation, UnfinishedOptions } from "../../modules/unfinished/index.ts";
import { DEFAULT_OPTIONS } from "../../modules/unfinished/index.ts";
import type { Account } from "./accounts.ts";
import { casesOf, readExport } from "./activity.ts";
import type { Shops } from "./shops.ts";

export interface ShopInbox {
  id: string;
  name: string;
  /** When the record this list was read from was last exported (ISO). Undefined when the shop has no export yet. */
  asOf?: string;
  items: Obligation[];
  /** Kinds that could not be read for this shop, by id: said as a note, never hidden. */
  failed: string[];
}

/** The panel's setting for how long an owner's answer may wait: PANEL_APPROVAL_WAIT_HOURS, default 12. */
export const optionsFor = (approvalWaitHours?: number): UnfinishedOptions => ({ ...DEFAULT_OPTIONS, ...(approvalWaitHours !== undefined ? { approvalWaitMs: approvalWaitHours * 3_600_000 } : {}) });

// Builds one shop's to-do list from its last export on every call and stores nothing, so the list cannot disagree with the record.
export function inboxFor(shops: Shops, id: string, nowMs: number, options: UnfinishedOptions): ShopInbox {
  const name = shops.settings(id)?.name ?? id;
  const dir = shops.paths.exports(id);
  const data = readExport(dir);
  if (!data) return { id, name, items: [], failed: [] };
  const template = shops.kind(id);
  const cases = casesOf(data, template) as unknown as CaseLike[];
  const { found, failed } = obligations.detect({ template, entries: data.entries, cases, nowMs, options });
  const file = join(dir, "record.json");
  return { id, name, asOf: existsSync(file) ? new Date(statSync(file).mtimeMs).toISOString() : undefined, items: found, failed } as ShopInbox;
}

/** Every shop this account may see, those with something to do first (most items, then name). A partner's list holds only the partner's own shops. */
export function inboxAll(shops: Shops, account: Account, nowMs: number, options: UnfinishedOptions): ShopInbox[] {
  return shops.visibleTo(account).map((s) => inboxFor(shops, s.id, nowMs, options)).sort((a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name));
}
