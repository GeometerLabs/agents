// requests/<shop>.stop.json: the panel's request to stop a shop. The deployer acts on it (the Guard kill switch), shows `stopped` in status/<shop>.json, and only then removes the file.
// The shape is the panel's (bundle/panel/contract.ts, parseStopRequest); this is the deployer's own reading of it, so the two never share code but agree on the file.
export interface StopRequest { schema: 1; requestId: string; shop: string; requestedAt: string; requestedBy: { id: string; name: string; role: string } }

const text = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max;

export function parseStopRequest(content: string | undefined, shop: string): StopRequest | undefined {
  if (content === undefined) return undefined;
  try {
    const r = JSON.parse(content) as Record<string, any>;
    if (r && r.schema === 1 && text(r.requestId, 80) && r.shop === shop && text(r.requestedAt, 40) && Number.isFinite(Date.parse(r.requestedAt)) && r.requestedBy && text(r.requestedBy.id, 80) && text(r.requestedBy.name ?? "x", 120)) return r as StopRequest;
  } catch { /* an unreadable request is no request */ }
  return undefined;
}
