// What every builder shares: the caller's inputs for one message, the shape a builder returns, the context block of each wire dialect, and a few small writers.
//
// Why the caller's inputs are separate from the shop's record: a message needs things only the request being answered knows (the transaction and message ids, the buyer app's
// address, the buyer's own name, phone and address). They are handed in for ONE message and echoed; they are never read from our store, so a customer's phone number cannot
// leave the shop by accident (the rule: customer phone numbers never leave the shop as themselves). Without them the `c` paths of contract.ts are simply left out.
import type { Gap, Gaps } from "./gaps.ts";
import { collector } from "./gaps.ts";
import { B2B_VERSION, RETAIL_CORE_VERSION, SERVICES_VERSION } from "./sources.ts";
import type { OndcFacts, Party } from "./types.ts";

export interface Buyer {
  name: string;
  phone: string;
  email?: string;
  address: { name?: string; building: string; locality: string; city: string; state: string; country: string; areaCode: string };
  gps?: string;
  /** When the buyer gave these details (ISO), echoed into billing.created_at and updated_at. */
  at: string;
}
export interface Caller {
  transactionId: string;
  messageId: string;
  timestampMs: number;
  bapId: string;
  bapUri: string;
  bppId: string;
  bppUri: string;
  /** ONDC's city code of the search or order being answered ("std:080"). */
  cityCode: string;
  buyer?: Buyer;
  /** The instrument the buyer app pays through or to: a UPI link or a gateway's link, when the record has none. */
  pay?: { uri: string; method: "upi" | "http/get"; reference?: string };
  /** Seller-side terms a B2B confirm echoes from the supplier's on_init (cancellation terms, seller terms tags). */
  supplierTerms?: { cancellation_terms?: unknown; tags?: unknown };
}

/** Something the mapping noticed and did not hide: a record that does not add up, an order with no ONDC counterpart. */
export interface Flag { kind: "record_total_mismatch" | "no_ondc_order"; detail: string }

export interface Out {
  action: string;
  context: Record<string, unknown>;
  message: Record<string, unknown>;
  gaps: Gap[];
  flags: Flag[];
  /** The complete request or response: `{ context, message }`. */
  body: { context: Record<string, unknown>; message: Record<string, unknown> };
}

export const iso = (ms: number): string => new Date(ms).toISOString();
export const hhmm = (clock: string): string => clock.replace(":", "");
export const factsOf = (p: Party): OndcFacts => p.ondc ?? {};

/** Drop what is undefined, and arrays and objects left empty by that, so a gap leaves no hole in the message. */
export function clean<T>(v: T): T | undefined {
  if (Array.isArray(v)) { const a = v.map((x) => clean(x)).filter((x) => x !== undefined); return (a.length > 0 ? a : undefined) as T | undefined; }
  if (typeof v === "object" && v !== null) {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) { const c = clean(x); if (c !== undefined) o[k] = c; }
    return (Object.keys(o).length > 0 ? o : undefined) as T | undefined;
  }
  return v === undefined ? undefined : v;
}

/** A tag in the retail dialect and in the services and B2B dialect (which name codes under `descriptor`). */
export const rTag = (code: string, list: Record<string, string | undefined>) => ({ code, list: Object.entries(list).filter(([, v]) => v !== undefined).map(([c, value]) => ({ code: c, value })) });
export const sTag = (code: string, list: Record<string, string | undefined>) => ({ descriptor: { code }, list: Object.entries(list).filter(([, v]) => v !== undefined).map(([c, value]) => ({ descriptor: { code: c }, value })) });

export function retailContext(action: string, c: Caller, domain: string | undefined) {
  return clean({ domain, country: "IND", city: c.cityCode, action, core_version: RETAIL_CORE_VERSION, bap_id: c.bapId, bap_uri: c.bapUri, bpp_id: c.bppId, bpp_uri: c.bppUri, transaction_id: c.transactionId, message_id: c.messageId, timestamp: iso(c.timestampMs), ttl: "PT30S" })!;
}
export function newContext(action: string, c: Caller, domain: string | undefined, version: "services" | "b2b") {
  return clean({ domain, location: { city: { code: c.cityCode }, country: { code: "IND" } }, action, version: version === "services" ? SERVICES_VERSION : B2B_VERSION, bap_id: c.bapId, bap_uri: c.bapUri, bpp_id: c.bppId, bpp_uri: c.bppUri, transaction_id: c.transactionId, message_id: c.messageId, timestamp: iso(c.timestampMs), ttl: "PT30S" })!;
}

export function finish(action: string, context: Record<string, unknown>, message: unknown, g: Gaps, flags: Flag[]): Out {
  const m = (clean(message) ?? {}) as Record<string, unknown>;
  return { action, context, message: m, gaps: g.list(), flags, body: { context, message: m } };
}
export { collector };

/** The shop's address as ONDC's structured address, only when every part is held; otherwise the gap is recorded and nothing is written. */
export function structuredAddress(g: Gaps, f: OndcFacts) {
  const a = f.address;
  const whole = a?.locality && a.city && a.state && a.areaCode ? a : undefined;
  g.need("shop_address_parts", whole);
  return whole ? { locality: whole.locality, city: whole.city, state: whole.state, area_code: whole.areaCode, ...(whole.building ? { building: whole.building } : {}) } : undefined;
}
