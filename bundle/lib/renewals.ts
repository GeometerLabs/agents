// How the Gupshup token renewals are doing, passed from the token refresher to the people who must act (follow-up 2, 12 Nov 2026). Used by ops (services/ops.ts),
// which reads the refresher's /healthz every minute and writes fleet/_renewals.json (the one folder ops can write), and counts a renewal that needs a person in the
// heartbeat's open work; and by the panel (panel/inbox.ts), which shows it on the shop's unfinished-work list. One file, one rule (`renewalWork`), so the list and
// the heartbeat never disagree. Nothing here is a secret: times, and a few plain words from the refresher (never a token, never a reply body).
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { writeAtomic } from "./util.ts";

/** In the fleet folder: a shop's id never starts with "_", so it cannot be taken for a shop's answer file. */
export const RENEWALS_FILE = "_renewals.json";
/** The universal token is said to need replacing this long before its own end. */
export const CREDENTIAL_WARN_MS = 7 * 24 * 3_600_000;

/** One shop's renewal: when its token in use ends, the last failure and since when it fails, and when the server's universal token ends. Epoch ms; null when unknown. */
export interface RenewalNote { validUntil: number | null; lastError: string | null; failingSince: number | null; credentialValidUntil: number | null }
export interface RenewalsFile { schema: 1; at: string; shops: Record<string, RenewalNote> }

/** The two kinds of work a renewal can need (also the heartbeat's `open_obligations` kind ids: lowercase words joined by _, as fleet takes them). */
export type RenewalKind = "whatsapp_token_renewal" | "whatsapp_token_credential";

const SHOP = /^[a-z0-9][a-z0-9_-]{0,63}$/u;
const time = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);

/** The refresher's `gupshup` map (or the file's `shops`), field by field: a shop name that is not a shop's, or a field of the wrong kind, is dropped or null. */
export function parseRenewalNotes(raw: unknown): Record<string, RenewalNote> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, RenewalNote> = {};
  for (const [shop, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!SHOP.test(shop) || typeof v !== "object" || v === null) continue;
    const n = v as Record<string, unknown>;
    out[shop] = { validUntil: time(n.validUntil), lastError: typeof n.lastError === "string" ? n.lastError.slice(0, 300) : null, failingSince: time(n.failingSince), credentialValidUntil: time(n.credentialValidUntil) };
  }
  return out;
}

/**
 * What a person must do about one shop's renewal, if anything. Renewing fails (or there is no token, or it has ended): `whatsapp_token_renewal`, with the hours the
 * token in use has left (0 when none). Otherwise the server's universal token ends within 7 days: `whatsapp_token_credential`, with the hours to that end.
 */
export function renewalWork(note: RenewalNote, nowMs: number): { kind: RenewalKind; hoursLeft: number; sinceMs: number | null } | undefined {
  const hours = (until: number | null) => (until === null ? 0 : Math.max(0, Math.floor((until - nowMs) / 3_600_000)));
  if (note.lastError !== null || note.validUntil === null || note.validUntil <= nowMs) return { kind: "whatsapp_token_renewal", hoursLeft: hours(note.validUntil), sinceMs: note.failingSince };
  if (note.credentialValidUntil !== null && note.credentialValidUntil - nowMs <= CREDENTIAL_WARN_MS) return { kind: "whatsapp_token_credential", hoursLeft: hours(note.credentialValidUntil), sinceMs: null };
  return undefined;
}

export function readRenewalsFile(fleetDir: string): RenewalsFile | undefined {
  const path = join(fleetDir, RENEWALS_FILE);
  if (!existsSync(path)) return undefined;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as { schema?: unknown; at?: unknown; shops?: unknown };
    return raw.schema === 1 && typeof raw.at === "string" ? { schema: 1, at: raw.at, shops: parseRenewalNotes(raw.shops) } : undefined;
  } catch { return undefined; }
}

/**
 * No shop's token is renewed here any more (the last one went back to a static token, or the universal token was taken away): the file goes, so the panel's list never
 * shows an old renewal as failing once its token's end has passed.
 */
export function clearRenewalsFile(fleetDir: string): void {
  rmSync(join(fleetDir, RENEWALS_FILE), { force: true });
}

export function writeRenewalsFile(fleetDir: string, shops: Record<string, RenewalNote>, now: Date): void {
  writeAtomic(join(fleetDir, RENEWALS_FILE), `${JSON.stringify({ schema: 1, at: now.toISOString(), shops } satisfies RenewalsFile, null, 2)}\n`);
}

/**
 * The refresher's word, as ops reads it each minute. When the refresher does not answer, nothing is renewed: each shop it knew is said to be failing, with that as the
 * reason and its first failure kept, so the list says so instead of going quiet.
 */
export async function readRefresherRenewals(refresherUrl: string, previous: Record<string, RenewalNote>, nowMs: number, fetchFn: typeof fetch = fetch): Promise<Record<string, RenewalNote>> {
  try {
    const r = await fetchFn(`${refresherUrl.replace(/\/+$/u, "")}/healthz`, { signal: AbortSignal.timeout(4_000) });
    const body = await r.json().catch(() => undefined) as { gupshup?: unknown } | undefined;
    if (body && body.gupshup !== undefined) return parseRenewalNotes(body.gupshup);
  } catch { /* said below */ }
  return Object.fromEntries(Object.entries(previous).map(([shop, n]) => [shop, { ...n, lastError: "the token refresher is not answering, so nothing is renewed", failingSince: n.failingSince ?? nowMs }]));
}
