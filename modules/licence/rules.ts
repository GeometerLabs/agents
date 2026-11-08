// The licence lease's rules (plan B13), the same as fleet's reference (monorepo apps/fleet/src/lease.ts; ADR-0059 has the format byte for byte). Pure: no file,
// no clock and no crypto, so a template's agent can import it (the browser demo has no node:crypto). Checking a token's signature is token.ts.
//
// A lease is fleet's signed statement about one deployment's paid shops. The bundle's deployer checks it with the public key pinned in geometer.json, keeps the newest
// (newerThan), and hands each shop's runtime its entry; the runtime then works out the shop's state with its own clock (effectiveState at serverNow), so a lease
// that expires while the deployer is not running still takes effect. A shop that is not in the lease, or a server that has never taken a lease, is not restricted.

/** Where a shop is in the gentle wind-down. Day 0 is the due date of its oldest unpaid invoice. */
export const STATES = ["active", "reminder", "warning", "wind_down", "stopped"] as const;
export type LeaseState = (typeof STATES)[number];
export const PLANS = ["basic", "business", "operations"] as const;

/** One paid shop in a lease. Times are whole seconds since 1970 (UTC), each the start of a local day in fleet's time zone. */
export interface LeaseShop {
  id: string;
  plan: (typeof PLANS)[number];
  state: LeaseState;
  /** The start of day 0: the due date of the oldest unpaid invoice that charged this shop, or the date the next one would fall due. */
  paid_through: number;
  /** Days from day 0 to the wind-down (30). */
  grace_days: number;
  /** When the lease stops covering new work for the shop if nothing newer arrives. An expired lease means the wind-down at most, never the final stop. */
  expires: number;
  /** The planned final stop, from the wind-down on; null before. */
  stop_at: number | null;
  /** After the final stop, the end of the free export; null before. */
  export_until: number | null;
  /** The one notice the shop owner is due now ("wind_down" or "stop"), or null. */
  notice: "wind_down" | "stop" | null;
}

export interface LeasePayload {
  v: 1;
  kind: "lease";
  deployment: string;
  /** Rises with every new lease for the deployment: an older lease never outranks a newer one. */
  serial: number;
  issued_at: number;
  /** Sorted by id. A shop with no plan is not listed: the lease says nothing about it. */
  shops: LeaseShop[];
}

export interface ExtensionPayload {
  v: 1;
  kind: "extension";
  /** The deployments it covers, sorted, or ["*"] for every deployment. */
  deployments: string[];
  issued_at: number;
  /** No lease it covers expires before this moment. It never lifts a wind-down or a stop a lease states. */
  until: number;
}

export type Payload = LeasePayload | ExtensionPayload;

/** An id in a lease: lowercase letters, digits, `-` and `_`, starting with a letter or digit, at most 64 characters. */
export const LEASE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/u;
const isTime = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const timeOrNull = (v: unknown): boolean => v === null || isTime(v);

/** One shop's entry, field by field, exactly as version 1 lists it (nine fields, nothing more). */
export function wellFormedShop(s: unknown): s is LeaseShop {
  if (typeof s !== "object" || s === null || Array.isArray(s)) return false;
  const o = s as Record<string, unknown>;
  return Object.keys(o).length === 9 && typeof o.id === "string" && LEASE_ID.test(o.id) && (PLANS as readonly unknown[]).includes(o.plan) && (STATES as readonly unknown[]).includes(o.state)
    && isTime(o.paid_through) && isTime(o.grace_days) && isTime(o.expires) && timeOrNull(o.stop_at) && timeOrNull(o.export_until) && [null, "wind_down", "stop"].includes(o.notice as string | null);
}

/** The shape of a version-1 payload, field by field. A signed payload is fleet's own, so this is a belt to the signature's braces. */
export function wellFormed(p: Payload): boolean {
  if (p.kind === "extension") {
    return Object.keys(p).length === 5 && Array.isArray(p.deployments) && p.deployments.length > 0 && p.deployments.every((d) => d === "*" || (typeof d === "string" && LEASE_ID.test(d))) && isTime(p.issued_at) && isTime(p.until);
  }
  return Object.keys(p).length === 6 && typeof p.deployment === "string" && LEASE_ID.test(p.deployment) && isTime(p.serial) && isTime(p.issued_at) && Array.isArray(p.shops) && p.shops.every(wellFormedShop);
}

/**
 * Whether a lease may replace the one already kept: a higher serial, and an issue time no earlier. The same serial is the same lease (fleet hands the same token back
 * until something changes); anything lower is an old lease played back and is never taken.
 */
export const newerThan = (incoming: Pick<LeasePayload, "serial" | "issued_at">, kept: Pick<LeasePayload, "serial" | "issued_at"> | undefined | null): boolean =>
  kept === undefined || kept === null || (incoming.serial > kept.serial && incoming.issued_at >= kept.issued_at);

/** The moment a lease is judged at: the later of the server's own clock and the newest `issued_at` it has ever taken, so a clock set back never stretches a lease. */
export const serverNow = (clockS: number, newestIssuedAtS: number): number => Math.max(clockS, newestIssuedAtS);

/** Fleet's rule for one shop: a stated wind-down or stop holds; otherwise the shop winds down once its expiry (pushed out by any extension) passes. Never the final stop from dates alone. */
export function effectiveState(shop: LeaseShop, nowS: number, extensionUntil = 0): LeaseState {
  if (shop.state === "wind_down" || shop.state === "stopped") return shop.state;
  return nowS >= Math.max(shop.expires, extensionUntil) ? "wind_down" : shop.state;
}

/** Whether a state lets the agent take new work (new bookings, new deposit or fee links). */
export const takesNewWork = (state: LeaseState): boolean => state === "active" || state === "reminder" || state === "warning";

/**
 * Whether a state lets the agent finish what it already owes: refunds owed, cancellations, existing bookings, and payments arriving from links sent earlier. True in
 * EVERY state, the final stop included: a lease never blocks money owed to a customer.
 */
export const allowsRecovery = (_state: LeaseState): boolean => true;

// ---- what the runtime is handed ----------------------------------------------------------------------------------------------------------------------------------

/**
 * What the deployer writes for one shop into its client folder (`licence.json`, read-only to the runtime): the shop's entry in the kept lease (or null when the lease
 * does not list it), the newest `issued_at` the server has taken, the latest `until` of the good extensions that cover this server, and who the owner should contact.
 * The runtime works the state out itself (`licenceNow`), with its own clock.
 */
export interface LicenceFile {
  schema: 1;
  shop: LeaseShop | null;
  newest_issued_at: number;
  extension_until: number;
  /** The builder or partner who set the shop up ("Divya, local partner"): the owner's notices name them. */
  partner: string;
}

/** The shop's licence right now, as the agent uses it. `restricted` is false for a shop the lease does not list (or no lease at all): nothing changes for it. */
export interface LicenceNow {
  state: LeaseState;
  restricted: boolean;
  takesNewWork: boolean;
  /** The lease's `paid_through` for this shop: the owner's notice goes once for each. Null when the shop is not in a lease. */
  paidThrough: number | null;
  exportUntil: number | null;
  partner: string;
}

export const UNRESTRICTED: LicenceNow = { state: "active", restricted: false, takesNewWork: true, paidThrough: null, exportUntil: null, partner: "" };

/** The shop's state at `nowMs`, from what the deployer handed over. No file, or a shop the lease does not list, is not restricted. */
export function licenceNow(file: LicenceFile | undefined, nowMs: number): LicenceNow {
  if (!file || !file.shop) return file ? { ...UNRESTRICTED, partner: file.partner } : UNRESTRICTED;
  const state = effectiveState(file.shop, serverNow(Math.floor(nowMs / 1000), file.newest_issued_at), file.extension_until);
  return { state, restricted: !takesNewWork(state), takesNewWork: takesNewWork(state), paidThrough: file.shop.paid_through, exportUntil: file.shop.export_until, partner: file.partner };
}

/** Read a licence.json's contents field by field. Anything that does not fit is undefined: then the runtime keeps the last good reading (licenceReader). */
export function parseLicenceFile(raw: unknown): LicenceFile | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  if (o.schema !== 1 || !isTime(o.newest_issued_at) || !isTime(o.extension_until) || typeof o.partner !== "string" || o.partner.length > 120) return undefined;
  if (o.shop !== null && !wellFormedShop(o.shop)) return undefined;
  return { schema: 1, shop: o.shop as LeaseShop | null, newest_issued_at: o.newest_issued_at, extension_until: o.extension_until, partner: o.partner.trim() };
}

/** The record's name for the runtime's licence check, so a refusal reads the same as Guard's will (`subscription_suspended`). */
export const LICENCE_RULE = "subscription_suspended";
