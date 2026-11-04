// What an agent someone else wrote did, as the two places that are not the agent can tell it: each of its Guards (every call it made, and what Guard decided: allowed, held for
// the owner, refused, and the answer the service gave) and the services themselves (the payment link, the refund, the calendar event as Razorpay and Google hold them).
// Nothing here asks the agent. Run inside the `ops` container, which holds the Guards' admin credentials and is on the network where their agent ports answer; the reads
// of the services go through the Guards with the reading agent (record-<name>), which each Guard allows to look and not to change. fetch is a parameter, so the tests run it against
// the real Guard binary and the stand-ins.
import type { AgentUpstream } from "./folder.ts";

export interface GuardAccess { kind: AgentUpstream; adminUrl: string; adminToken: string; agentUrl: string }
export interface FactsConfig {
  /** The builder's own agent, as the Guards know it (`agent-<name>`). Only its calls, and the relay's messages to the owner, are the agent's record; the reading agent's reads are not. */
  agentId: string;
  relayId: string;
  recordToken: string;
  guards: GuardAccess[];
  calendarId?: string;
}

/** One Guard decision, as `GET /admin/decisions` writes it. Only the fields the record uses are named. */
export interface Decision {
  id: string;
  at_ms: string;
  operation: string;
  outcome: "allow" | "deny" | "hold";
  dispatched: boolean;
  prevented: boolean;
  principal: { workload: string };
  /** Typed values: ["int","20000"], ["str","pay_1"], ["map",{...}]. */
  arguments: Record<string, unknown>;
  call: string;
  approval?: string;
  evaluations: { rule: string; decision: string; reason: string }[];
  reasons: string[];
}
export interface Intent { intent: string; operation: string; call: string; state: string; decision: string; provider_effect?: string; detail: string }
export interface Approval { id: string; operation: string; principal: string; state: string; approver?: string; arguments: Record<string, unknown>; requested_at_ms: string; expires_at_ms: string; decided_at_ms?: string; consumed_by?: string; rule: string }

export interface GuardFacts { decisions: Decision[]; intents: Intent[]; approvals: Approval[]; counts: Record<string, number>; error?: string }
export interface LinkFact { id: string; status: string; amountPaid: number; payments: { paymentId: string; amount: number; createdAt: number }[] }
export interface RefundFact { id: string; amount: number; receipt: string | null; status: string; createdAt: number }
export interface EventFact { id: string; summary: string; start: string | null; status: string }

export interface Facts {
  at: string;
  guards: Partial<Record<AgentUpstream, GuardFacts>>;
  service: {
    /** By the reference_id the agent sent. `null`: the service could not be asked, which is not the same as "there is no such link". */
    links: Record<string, LinkFact | null>;
    /** By payment id. */
    refunds: Record<string, RefundFact[] | null>;
    /** The calendar's events, or null when it could not be read. */
    events: EventFact[] | null;
  };
  /** What could not be read, in words. Nothing secret. */
  problems: string[];
}

const TIMEOUT = 8_000;
const why = (e: unknown): string => (e as { cause?: { code?: string } })?.cause?.code ?? (e as Error)?.name ?? "error";
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The string inside a typed argument (["str","pay_1"]), or the number inside ["int","20000"]; undefined for anything else. */
export function typedText(v: unknown): string | undefined { return Array.isArray(v) && (v[0] === "str" || v[0] === "int") && typeof v[1] === "string" ? v[1] : undefined; }
export function typedMap(v: unknown): Record<string, unknown> | undefined { return Array.isArray(v) && v[0] === "map" && isObj(v[1]) ? v[1] : undefined; }

export async function collectFacts(cfg: FactsConfig, now: Date, fetchFn: typeof fetch = fetch): Promise<Facts> {
  const facts: Facts = { at: now.toISOString(), guards: {}, service: { links: {}, refunds: {}, events: null }, problems: [] };
  const getJson = async (url: string, token: string): Promise<{ status: number; body: unknown }> => {
    try {
      const r = await fetchFn(url, { headers: { authorization: `Bearer ${token}`, accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT) });
      const text = await r.text();
      let body: unknown = null; try { body = JSON.parse(text); } catch { /* not JSON */ }
      return { status: r.status, body };
    } catch (e) { return { status: 0, body: { error: why(e) } }; }
  };
  const list = (body: unknown, key: string): unknown[] => (isObj(body) && Array.isArray(body[key]) ? body[key] as unknown[] : []);

  for (const g of cfg.guards) {
    const admin = (path: string) => getJson(`${g.adminUrl.replace(/\/+$/u, "")}${path}`, g.adminToken);
    const [decisions, intents, approvals, status] = await Promise.all([admin("/admin/decisions?limit=500"), admin("/admin/intents"), admin("/admin/approvals"), admin("/admin/status")]);
    if (decisions.status !== 200) { facts.problems.push(`${g.kind}'s Guard could not be read (${decisions.status === 0 ? "not reachable" : `HTTP ${decisions.status}`}), so its calls are not in this pass.`); continue; }
    const counts = isObj(status.body) && isObj(status.body.counts) ? Object.fromEntries(Object.entries(status.body.counts).filter(([, v]) => typeof v === "number")) as Record<string, number> : {};
    facts.guards[g.kind] = { decisions: list(decisions.body, "decisions") as Decision[], intents: list(intents.body, "intents") as Intent[], approvals: list(approvals.body, "approvals") as Approval[], counts };
  }

  const mine = (d: Decision) => d.principal?.workload === cfg.agentId;
  const dispatched = (d: Decision) => d.outcome === "allow" && d.dispatched === true;

  // Razorpay's own record of what the agent made: a link by the reference it was given, and the refunds against a payment
  const rz = cfg.guards.find((g) => g.kind === "razorpay");
  if (rz && facts.guards.razorpay) {
    const base = rz.agentUrl.replace(/\/+$/u, "");
    const refs = new Set<string>(); const payments = new Set<string>();
    for (const d of facts.guards.razorpay.decisions.filter(mine)) {
      if (d.operation === "create_link" && dispatched(d)) { const ref = typedText(d.arguments.reference_id); if (ref) refs.add(ref); }
      if (d.operation === "refund" && dispatched(d)) { const p = typedText(d.arguments.payment_id); if (p) payments.add(p); }
    }
    for (const ref of [...refs].slice(0, 200)) {
      const found = await getJson(`${base}/v1/payment_links?reference_id=${encodeURIComponent(ref)}`, cfg.recordToken);
      if (found.status !== 200) { facts.service.links[ref] = null; continue; }
      const link = list(found.body, "payment_links").find((l) => isObj(l) && l.reference_id === ref) as Record<string, unknown> | undefined;
      if (!link || typeof link.id !== "string") { facts.service.links[ref] = null; facts.problems.push(`Razorpay shows no payment link with the reference ${ref}.`); continue; }
      const paid = Number(link.amount_paid ?? 0);
      let pays: LinkFact["payments"] = [];
      // the list shows `payments: []` even on a paid link; the single read has them
      if (paid > 0) {
        const one = await getJson(`${base}/v1/payment_links/${encodeURIComponent(link.id)}`, cfg.recordToken);
        if (one.status !== 200) { facts.service.links[ref] = null; continue; }
        pays = list(one.body, "payments").filter(isObj).filter((p) => typeof p.payment_id === "string").map((p) => ({ paymentId: p.payment_id as string, amount: Number(p.amount), createdAt: Number(p.created_at) }));
      }
      facts.service.links[ref] = { id: link.id, status: String(link.status), amountPaid: paid, payments: pays };
    }
    for (const p of [...payments].slice(0, 200)) {
      const r = await getJson(`${base}/v1/payments/${encodeURIComponent(p)}/refunds`, cfg.recordToken);
      facts.service.refunds[p] = r.status === 200 ? list(r.body, "items").filter(isObj).map((i) => ({ id: String(i.id), amount: Number(i.amount), receipt: typeof i.receipt === "string" ? i.receipt : null, status: String(i.status), createdAt: Number(i.created_at) })) : null;
    }
  }

  // Google's own record of the calendar: the events it holds
  const cal = cfg.guards.find((g) => g.kind === "calendar");
  if (cal && facts.guards.calendar && cfg.calendarId && facts.guards.calendar.decisions.some((d) => mine(d) && ["insert", "patch", "delete"].includes(d.operation))) {
    const r = await getJson(`${cal.agentUrl.replace(/\/+$/u, "")}/calendar/v3/calendars/${encodeURIComponent(cfg.calendarId)}/events?maxResults=250`, cfg.recordToken);
    if (r.status === 200) facts.service.events = list(r.body, "items").filter(isObj).map((e) => ({ id: String(e.id), summary: String(e.summary ?? ""), start: isObj(e.start) && typeof e.start.dateTime === "string" ? e.start.dateTime : null, status: String(e.status ?? "") }));
    else facts.problems.push("The calendar could not be read, so its events are not confirmed in this pass.");
  }
  return facts;
}
