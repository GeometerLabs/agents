// One agent we did not write, planned: from its folder to the specs of the Guards that go in front of the services it calls. The specs come from the SAME functions the
// templates use (generate/guards.ts: razorpaySpec, whatsappSpec, calendarSpec, which for Razorpay is pathways/bookings/src/guard-limits.ts), so the same settings give the
// same bytes whether a template or an agent of someone else's sits behind them. Pure: no files, no Docker, no clock.
import type { LimitsSpec } from "../../pathways/bookings/src/guard-limits.ts";
import { rupeesToPaise } from "../../pathways/bookings/src/guard-limits.ts";
import { calendarSpec, guardDef, razorpaySpec, whatsappSpec } from "../generate/guards.ts";
import type { GuardKind } from "../generate/guards.ts";
import { names, upstreamOf } from "../generate/shop.ts";
import type { GuardPlan } from "../generate/shop.ts";
import type { ServerConfig } from "../lib/server.ts";
import { stableJson } from "../lib/util.ts";
import type { Problem } from "../lib/util.ts";
import type { AgentFolder, AgentUpstream } from "./folder.ts";

/** Names of everything an agent owns, in one place. The Guards and their forwarders are named as a shop's are (`g-<name>-razorpay`), so one name can never be both. */
export const agentNames = {
  /** The credential the builder's own agent presents at its Guards. */
  agentId: (name: string) => `agent-${name}`,
  /** The reading credential of the record job and of the approvals relay's payment look-up: reads only, at the Razorpay and Calendar Guards. */
  recordId: (name: string) => `record-${name}`,
  /** The internal network that holds Caddy and the agent's Guards (their agent ports), and nothing else. */
  gate: "gate",
};

/** What the reading agent may call at each Guard: look at the service's own state, change nothing. */
export const RECORD_READS: Partial<Record<Exclude<GuardKind, "model">, string[]>> = { razorpay: ["list_links", "read_link", "read_payment", "list_refunds"], calendar: ["list", "get"] };

export interface AgentPlan {
  agent: string;
  guards: GuardPlan[];
  problems: Problem[];
}

/** Plan one agent. `versions` are the bundle versions Guard will be given (raise them on every change; see lib/state.ts). */
export function planAgent(server: ServerConfig, folder: AgentFolder, versions: Partial<Record<GuardKind, number>> = {}): AgentPlan {
  const problems: Problem[] = folder.problems.map((message) => ({ rule: "agent-folder", message }));
  const guards: GuardPlan[] = [];
  const { agent, settings } = folder;
  if (!agent || !settings || problems.length > 0) return { agent: folder.name, guards, problems };
  const identity = (kind: GuardKind) => ({ tenant: folder.name, name: `${folder.name}-${kind}`, version: versions[kind] ?? 1, reviewedBy: server.reviewedBy });
  const caps = agent.caps ?? {};
  const make = (kind: AgentUpstream): LimitsSpec | undefined => {
    try {
      switch (kind) {
        case "razorpay": return razorpaySpec(settings, identity("razorpay"), server.approvalHours, caps.linksPerHour ?? server.limits.razorpayLinksPerHour,
          { ...(caps.refundInrPerDay !== undefined ? { refundPaisePerDay: rupeesToPaise(caps.refundInrPerDay) } : {}), ...(caps.refundsPerDay !== undefined ? { refundsPerDay: caps.refundsPerDay } : {}) });
        case "whatsapp": return whatsappSpec(identity("whatsapp"), { phoneNumberId: agent.whatsapp!.phoneNumberId, messagesPerHour: caps.messagesPerHour ?? server.limits.whatsappMessagesPerHour });
        case "calendar": return calendarSpec(identity("calendar"), { calendarId: agent.calendar!.calendarId, createdPerHour: caps.eventsCreatedPerHour ?? server.limits.calendarEventsCreatedPerHour, deletedPerDay: caps.eventsDeletedPerDay ?? server.limits.calendarEventsDeletedPerDay });
      }
    } catch (e) { problems.push({ rule: `${kind}-limits`, message: (e as Error).message }); return undefined; }
  };
  // always in the same order, so a shop-like index maps to the same address for the same Guard
  for (const kind of (["razorpay", "whatsapp", "calendar"] as const).filter((k) => agent.upstreams.includes(k))) {
    const spec = make(kind);
    if (!spec) continue;
    const def = guardDef(kind);
    guards.push({ kind, service: names.guard(folder.name, kind), tenant: folder.name, deployment: `${folder.name}-${kind}`, def, upstream: upstreamOf(server, kind, def), spec, specText: stableJson(spec) });
  }
  return { agent: folder.name, guards, problems };
}
