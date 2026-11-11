// requests/<shop>.stop.json: the panel's request to stop a shop. The deployer acts on it (the Guard kill switch), shows `stopped` in status/<shop>.json, and only then removes the file.
// The shape is the panel's (bundle/panel/contract.ts, parseStopRequest); this is the deployer's own reading of it, so the two never share code but agree on the file.
export interface StopRequest { schema: 1; requestId: string; shop: string; requestedAt: string; requestedBy: { id: string; name: string; role: string } }

const text = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max;

// The deployer's own check of a stop request; it must also match the shop its file name claims, so a request cannot stop another shop.
export function parseStopRequest(content: string | undefined, shop: string): StopRequest | undefined {
  if (content === undefined) return undefined;
  try {
    const r = JSON.parse(content) as Record<string, any>;
    if (r && r.schema === 1 && text(r.requestId, 80) && r.shop === shop && text(r.requestedAt, 40) && Number.isFinite(Date.parse(r.requestedAt)) && r.requestedBy && text(r.requestedBy.id, 80) && text(r.requestedBy.name ?? "x", 120)) return r as StopRequest;
  } catch { /* an unreadable request is no request */ }
  return undefined;
}

/**
 * requests/<shop>.recover.<id>.json: the panel's request that a shop's agent look again or ask again about one booking or fee (the to-do list, plan B31). The deployer carries it to the
 * shop's runtime through `ops` (the runtime's bearer token is ops's, never the panel's), then removes the file. The panel writes a name and an id; it never writes a message, a number or an
 * amount, and the runtime's agent decides whether the action fits and does it through Guard and the normal limits.
 */
export interface RecoveryRequest { schema: 1; requestId: string; shop: string; case: string; action: string; requestedAt: string; requestedBy: { id: string; name: string; role: string } }

export const RECOVERY_FILE = /^([a-z0-9][a-z0-9-]{0,39})\.recover\.([A-Za-z0-9-]{1,64})\.json$/u;

// The deployer's own check of a recovery request: only a name, a case id and an action, and the file name's shop and id must match the content.
export function parseRecoveryRequest(content: string | undefined, shop: string, id: string): RecoveryRequest | undefined {
  if (content === undefined) return undefined;
  try {
    const r = JSON.parse(content) as Record<string, any>;
    if (r && r.schema === 1 && r.requestId === id && r.shop === shop && typeof r.case === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/u.test(r.case) && typeof r.action === "string" && /^[a-z][a-z0-9_]{1,39}$/u.test(r.action)
      && text(r.requestedAt, 40) && Number.isFinite(Date.parse(r.requestedAt)) && r.requestedBy && text(r.requestedBy.id, 80) && text(r.requestedBy.name ?? "x", 120)) return r as RecoveryRequest;
  } catch { /* an unreadable request is no request */ }
  return undefined;
}
