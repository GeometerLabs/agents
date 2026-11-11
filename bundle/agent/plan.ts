// One agent we did not write, planned: from its folder to the specs of the Guards that go in front of the services it calls. The specs come from the SAME functions the
// templates use (generate/guards.ts: gatewaySpec, whatsappSpec, calendarSpec, which for a gateway is templates/commerce/bookings/src/guard-limits.ts), so the same settings give
// the same bytes whether a template or an agent of someone else's sits behind them. A payment module the owner marks (UPI) has no API on the internet: its Guard is in front
// of the owner-marked desk (modules/payments/owner-marked/desk-guard.ts, B71 part 2), which the relay's container serves, with the same deposit and refund numbers a
// gateway's spec has. An agent's own gateway API with no module ("own-api") gets the spec its builder reviewed with the companies kit, built here from the two files by
// the kit's own function (companies/openapi-to-spec.ts); a rule in it that holds a call for a person is asked about by the approvals relay (B71 part 2). Pure: no files,
// no Docker, no clock.
import type { LimitsSpec } from "../../modules/payments/guard-limits.ts";
import { rupeesToPaise } from "../../modules/payments/guard-limits.ts";
import { calendarSpec, guardDef, gatewaySpec, ownApiGuardDef, whatsappSpec } from "../generate/guards.ts";
import type { GuardKind } from "../generate/guards.ts";
import { names, upstreamOf } from "../generate/shop.ts";
import type { GuardPlan } from "../generate/shop.ts";
import type { ServerConfig } from "../lib/server.ts";
import { stableJson } from "../lib/util.ts";
import type { Problem } from "../lib/util.ts";
import type { AgentFolder, AgentUpstream } from "./folder.ts";
import { paymentUpstreamOf } from "./folder.ts";
import { GATEWAYS, GATEWAY_KINDS, OWN_API, PROVIDERS, isGatewayKind, providerById } from "../../modules/payments/providers/index.ts";
import { DESK_GUARD, deskLimitsSpec } from "../../modules/payments/owner-marked/desk-guard.ts";
import { paymentNumbers } from "../../templates/commerce/bookings/src/guard-limits.ts";
import { heldRulesOf } from "../../modules/approvals/held-call.ts";
import { Refusal, specFromAccept } from "../../companies/openapi-to-spec.ts";
import type { Draft } from "../../companies/openapi-to-spec.ts";
import { sha256 } from "../../companies/openapi-read.ts";

/** Names of everything an agent owns, in one place. The Guards and their forwarders are named as a shop's are (`g-<name>-<kind>`), so one name can never be both. */
export const agentNames = {
  /** The credential the builder's own agent presents at its Guards. */
  agentId: (name: string) => `agent-${name}`,
  /** The reading credential of the record job and of the approvals relay's payment look-up: reads only, at the payment Guard (a gateway's or the desk's) and the Calendar's. */
  recordId: (name: string) => `record-${name}`,
  /** The internal network that holds Caddy and the agent's Guards (their agent ports), and nothing else. */
  gate: "gate",
};

/** What the reading agent may call at each Guard: look at the service's own state, change nothing. */
export const RECORD_READS: Partial<Record<string, string[]>> = {
  ...Object.fromEntries(GATEWAYS.map((g) => [g.id, g.gateway!.guard.reads.record])),
  // the desk's own lists: what the owner marked, and the refunds owed (bundle/agent/facts.ts)
  ...Object.fromEntries(PROVIDERS.filter((p) => p.ownerMarked).map((p) => [p.id, [...DESK_GUARD.reads.record]])),
  calendar: ["list", "get"],
};

/**
 * An own-API agent's Guard spec: the companies kit builds it from the draft and the accept file, exactly as `openapi-to-spec.ts build` would (the draft's bytes must be
 * the ones the accept file names, so an edited draft is refused). The deployment's identity is the plan's, as every other Guard's is: tenant, name and the version the
 * deployer raises on each change replace the accept file's. A rule that holds a call for a person (`call_bound_approval`) is kept: the approvals relay reads the held
 * call and asks the owner on WhatsApp (modules/approvals/held-call.ts, B71 part 2), and `holds` names those calls so the deploy gives the owner an approver role for them.
 */
export function ownApiSpec(ownApi: { draftText: string; acceptText: string }, id: { tenant: string; name: string; version: number }): { spec?: LimitsSpec; holds: string[]; problems: string[] } {
  let draft: Draft, accept: unknown;
  try { draft = JSON.parse(ownApi.draftText) as Draft; } catch { return { holds: [], problems: ["gateway-draft.json is not JSON."] }; }
  if (draft?.draft !== 1) return { holds: [], problems: ["gateway-draft.json is not a draft the companies kit wrote (node companies/openapi-to-spec.ts draft)."] };
  try { accept = JSON.parse(ownApi.acceptText); } catch { return { holds: [], problems: ["gateway-accept.json is not JSON."] }; }
  let built: ReturnType<typeof specFromAccept>;
  try { built = specFromAccept(draft, accept, sha256(ownApi.draftText)); } catch (e) {
    if (e instanceof Refusal) return { holds: [], problems: e.problems.map((p) => `gateway-accept.json: ${p}`) };
    throw e;
  }
  const holds = [...new Set(heldRulesOf(built.spec).rules.map((r) => r.operation))];
  return { spec: { ...built.spec, tenant: id.tenant, name: id.name, version: id.version } as unknown as LimitsSpec, holds, problems: [] };
}

export interface AgentPlan {
  agent: string;
  guards: GuardPlan[];
  /** The payment module the owner marks (UPI), when the agent takes money that way: its Guard is in front of the owner-marked desk (B71 part 2). */
  desk?: { module: string };
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
      // a gateway's limits come from the settings the same way a shop's do: the template's own numbers in the neutral rules, written for that gateway
      if (isGatewayKind(kind)) return gatewaySpec(settings, identity(kind), server.approvalHours, caps.linksPerHour ?? server.limits.razorpayLinksPerHour, // geometer.json's key keeps its old name (lib/server.ts): an outside contract
        { ...(caps.refundInrPerDay !== undefined ? { refundPaisePerDay: rupeesToPaise(caps.refundInrPerDay) } : {}), ...(caps.refundsPerDay !== undefined ? { refundsPerDay: caps.refundsPerDay } : {}) });
      if (kind === OWN_API) {
        const made = ownApiSpec(folder.ownApi ?? { draftText: "", acceptText: "" }, identity(kind));
        problems.push(...made.problems.map((message) => ({ rule: `${kind}-spec`, message })));
        // a held call is asked about on WhatsApp: without it nobody could ever be asked, and the call would wait until it expired
        if (made.holds.length > 0 && !agent.upstreams.includes("whatsapp")) problems.push({ rule: `${kind}-spec`, message: `gateway-accept.json holds ${made.holds.join(", ")} for the owner's approval, and the owner is asked on WhatsApp: add whatsapp to the agent's upstreams, or keep a bound instead of the hold.` });
        return made.spec;
      }
      // the owner-marked desk's Guard: the deposit and refund numbers a gateway's spec would have, in the desk's own routes
      if (providerById(kind)?.ownerMarked) {
        if (!agent.upstreams.includes("whatsapp")) { problems.push({ rule: `${kind}-desk`, message: `The owner marks each ${providerById(kind)!.displayName} payment received on WhatsApp, so the agent's upstreams must include whatsapp.` }); return undefined; }
        // requests per hour default to the server's links-per-hour, as a gateway agent's do (geometer.json keeps its old key name, razorpayLinksPerHour: lib/server.ts)
        const n = paymentNumbers(settings, { caps: { linksPerHour: caps.linksPerHour ?? server.limits.razorpayLinksPerHour, ...(caps.refundInrPerDay !== undefined ? { refundPaisePerDay: rupeesToPaise(caps.refundInrPerDay) } : {}), ...(caps.refundsPerDay !== undefined ? { refundsPerDay: caps.refundsPerDay } : {}) } });
        return deskLimitsSpec({ tenant: folder.name, name: `${folder.name}-${kind}`, version: identity(kind).version, reviewedBy: server.reviewedBy }, n);
      }
      switch (kind) {
        case "whatsapp": return whatsappSpec(identity("whatsapp"), { phoneNumberId: agent.whatsapp!.phoneNumberId, messagesPerHour: caps.messagesPerHour ?? server.limits.whatsappMessagesPerHour });
        case "calendar": return calendarSpec(identity("calendar"), { calendarId: agent.calendar!.calendarId, createdPerHour: caps.eventsCreatedPerHour ?? server.limits.calendarEventsCreatedPerHour, deletedPerDay: caps.eventsDeletedPerDay ?? server.limits.calendarEventsDeletedPerDay });
      }
    } catch (e) { problems.push({ rule: `${kind}-limits`, message: (e as Error).message }); return undefined; }
  };
  // always in the same order (the way money is taken first), so a shop-like index maps to the same address for the same Guard
  const ownerMarkedKinds = PROVIDERS.filter((p) => p.ownerMarked).map((p) => p.id);
  for (const kind of [...GATEWAY_KINDS, ...ownerMarkedKinds, OWN_API, "whatsapp", "calendar"].filter((k) => agent.upstreams.includes(k))) {
    const spec = make(kind);
    if (!spec) continue;
    const def = kind === OWN_API ? ownApiGuardDef(spec.tool, agent.ownApi!.upstream) : guardDef(kind);
    guards.push({ kind, service: names.guard(folder.name, kind), tenant: folder.name, deployment: `${folder.name}-${kind}`, def, upstream: upstreamOf(server, kind, def), spec, specText: stableJson(spec) });
  }
  const paying = paymentUpstreamOf(agent.upstreams);
  return { agent: folder.name, guards, ...(paying?.ownerMarked ? { desk: { module: paying.id } } : {}), problems };
}
