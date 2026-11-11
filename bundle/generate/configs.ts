// The small config files the shared services read (inbox, relay, refresher, ops), and the secret files they and the shops' containers get. None of the
// config files holds a secret: they name the secret FILES. Pure text in, text out; the deployer writes them.
import { agentNames } from "../agent/plan.ts";
import { BUNDLE_VERSION } from "../lib/server.ts";
import type { ServerConfig } from "../lib/server.ts";
import { ADMIN_FORWARD_PORT, HEALTH_PORT, INBOX_PORT, OPS_FLEET_DIR, OPS_STATUS_DIR, RELAY_PORT, REFRESHER_PORT, SHOP_GUARD_KINDS, addressing } from "./compose.ts";
import type { AgentDeploy, ShopDeploy } from "./compose.ts";
import { GUARD_PORT, RUNTIME_PORT, names } from "./shop.ts";
import { stableJson } from "../lib/util.ts";
import type { ApproverPerson } from "../../modules/approvals/people.ts";
import type { WhatsAppRoute } from "./guards.ts";
import type { HeldCallSpec } from "../../modules/approvals/held-call.ts";
import { OWN_API, isGatewayKind } from "../../modules/payments/providers/index.ts";
import { OWNER_MARKED_KINDS } from "./guards.ts";

export interface ShopWebhooks {
  verification: "meta-signature" | "path-token";
  /** True when a Google service account key is available to this shop: its own, or the server-wide one. */
  hasGoogle: boolean;
  /** True when the shop handed in a key of its own; otherwise the server-wide one is used. */
  ownGoogleKey: boolean;
}

/** An agent someone else wrote, with what the shared services need to know about it. */
export interface AgentFacts extends AgentDeploy {
  createdAt: string;
  ownerWhatsapp: string;
  phoneNumberId?: string;
  calendarId?: string;
  verification: ShopWebhooks["verification"];
  hasGoogle: boolean;
  ownGoogleKey: boolean;
  /** Where the agent's own WhatsApp webhooks go after the inbox has kept the owner's replies. */
  forwardTo?: string;
  business: { name: string; timeZone: string; ownerLanguage: string };
  /** B71 part 2: the agent's payment block (its settings'), for the owner-marked desk: the shop's UPI ID and the name its customers see. Nothing secret. */
  payment?: unknown;
  /** B71 part 2: the calls the reviewed spec of the agent's own API holds for the owner, read from the spec that was applied (approvals/held-call.ts). */
  ownApi?: HeldCallSpec;
}

/**
 * What the relay does for an agent someone else wrote, decided once here so the inbox and the relay agree (an inbox that sends the owner's messages to a relay
 * with no entry would answer 503 for ever): ask about a refund its gateway's Guard holds, ask about a call its own API's Guard holds (only when its spec holds
 * any), or keep its owner-marked desk. Nothing without WhatsApp: the owner is asked, and marks, on WhatsApp.
 */
export function agentRelayRole(a: AgentFacts): { kind: "gateway" | "own-api" | "desk"; guard: string } | undefined {
  if (!hasGuard(a, "whatsapp")) return undefined;
  const money = a.guards.find((g) => isGatewayKind(g.kind) || g.kind === OWN_API || OWNER_MARKED_KINDS.includes(g.kind));
  if (!money) return undefined;
  if (isGatewayKind(money.kind)) return { kind: "gateway", guard: money.kind };
  if (money.kind === OWN_API) return a.ownApi && a.ownApi.rules.length > 0 ? { kind: "own-api", guard: money.kind } : undefined;
  return { kind: "desk", guard: money.kind };
}

type Three = (typeof SHOP_GUARD_KINDS)[number];

const url = (ip: string, port: number) => `http://${ip}:${port}`;
const agentIp = (server: ServerConfig, a: AgentDeploy, kind: Three) => addressing(server).adminIp(a.name, kind, a.index);
const hasGuard = (a: AgentDeploy, kind: string) => a.guards.some((g) => g.kind === kind);

/** Where the shared services reach a shop's runtime: its door, on the admin network. */
const runtimeUrl = (server: ServerConfig, shop: ShopDeploy) => url(addressing(server).adminIp(shop.name, "door", shop.index), RUNTIME_PORT);

/** Where each Guard's admin port is reached: the forwarder's address on the admin network. */
export function guardAdmin(server: ServerConfig, shop: Pick<ShopDeploy, "name" | "index">, kind: Three) {
  const ip = addressing(server).adminIp(shop.name, kind, shop.index);
  return { adminUrl: url(ip, ADMIN_FORWARD_PORT), healthUrl: url(ip, HEALTH_PORT) };
}

/** B37: a shop's other approvers, as the inbox and the relay need them (their secrets are files in the relay's folder, never in a config). */
type Approvers = { approvers?: ApproverPerson[] };
/** Item 11b: a shop whose WhatsApp goes through Gupshup. Left out (Meta direct), the configs are exactly as before. */
type Route = { whatsappRoute?: WhatsAppRoute };

export function inboxConfig(server: ServerConfig, shops: (ShopDeploy & { webhooks: ShopWebhooks; ownerWhatsapp: string; phoneNumberId: string } & Approvers & Route)[], agents: AgentFacts[] = []): string {
  return stableJson({
    shops: Object.fromEntries([
      ...shops.map((s) => [s.name, {
        runtimeUrl: runtimeUrl(server, s),
        // a UPI shop (B33) has no approvals relay (no refund is ever held for its owner): the owner's messages go to the runtime only
        ...(s.guards.some((g) => isGatewayKind(g.kind)) ? { relayUrl: `http://relay:${RELAY_PORT}/c/${s.name}` } : {}),
        ownerWhatsapp: s.ownerWhatsapp, phoneNumberId: s.phoneNumberId, verification: s.webhooks.verification,
        // a Gupshup callback names its app (gs_app_id): one that names another app is not this shop's
        ...(s.whatsappRoute ? { gupshupAppId: s.whatsappRoute.appId } : {}),
        // B37: the other approvers' replies go to the relay too (their codes are the relay's, never the runtime's)
        ...(s.approvers && s.approvers.length > 0 ? { approverWhatsapps: s.approvers.map((p) => p.whatsapp) } : {}),
        secretsDir: `/run/secrets/${s.name}`,
      }]),
      // an agent someone else wrote has no runtime: its WhatsApp number's webhook comes here, the owner's replies go to the relay (when the relay has something
      // for it: a held call to ask about, or the desk), and the rest goes on to the agent itself
      ...agents.filter((a) => hasGuard(a, "whatsapp")).map((a) => [a.name, {
        kind: "own-agent", ...(agentRelayRole(a) ? { relayUrl: `http://relay:${RELAY_PORT}/c/${a.name}` } : {}), ownerWhatsapp: a.ownerWhatsapp, phoneNumberId: a.phoneNumberId, verification: a.verification, secretsDir: `/run/secrets/${a.name}`,
        ...(a.forwardTo ? { forwardTo: a.forwardTo } : {}),
      }]),
    ]),
  });
}

export function relayConfig(server: ServerConfig, shops: (ShopDeploy & { ownerWhatsapp: string; phoneNumberId: string; pathway?: string } & Approvers & Route)[], agents: AgentFacts[] = []): string {
  return stableJson({
    shops: Object.fromEntries([
      // a shop on a gateway: the relay asks its owner about the refunds that gateway's Guard holds (by kind, from the registry: B71 part 2)
      ...shops.filter((s) => s.guards.some((g) => isGatewayKind(g.kind))).map((s) => [s.name, {
        // which template's words the relay asks the owner in (services/relay.ts); left out for Bookings, as it always was
        ...(s.pathway && s.pathway !== "bookings" ? { pathway: s.pathway } : {}),
        guardAdminUrl: guardAdmin(server, s, s.guards.find((g) => isGatewayKind(g.kind))!.kind as Three).adminUrl,
        approverId: names.ownerApproverId(s.name, (s.approvers?.length ?? 0) > 0), agentId: names.agentId(s.name),
        // B37: each other approver signs with approver_<id>_notify_secret in this shop's secrets folder
        ...(s.approvers && s.approvers.length > 0 ? { approvers: s.approvers.map((p) => ({ id: p.id, whatsapp: p.whatsapp, language: p.language })) } : {}),
        runtimeUrl: runtimeUrl(server, s),
        // the relay is not on the shop's network: it reaches the WhatsApp Guard's agent port on the Guard's address on the admin network
        whatsappGuardUrl: url(addressing(server).adminIp(s.name, "whatsapp", s.index), GUARD_PORT),
        ownerWhatsapp: s.ownerWhatsapp, phoneNumberId: s.phoneNumberId,
        // the relay asks the owner through the shop's own WhatsApp Guard, so it speaks that Guard's provider
        ...(s.whatsappRoute ? { provider: s.whatsappRoute.provider, appId: s.whatsappRoute.appId } : {}),
        secretsDir: `/run/secrets/${s.name}`, stateDir: `/home/node/state/${s.name}`,
      }]),
      // An agent someone else wrote (B71): held calls are read from its money Guard and the owner is asked through its WhatsApp Guard, or, when the owner marks its
      // money (UPI), the desk keeps its ledger and takes the owner's replies. There is no runtime to ask for the booking: for a gateway, who paid and when is read
      // from the gateway's own record of the payment (through the reading agent); for its own API, from the held call itself. The business is the settings'.
      ...agents.flatMap((a) => {
        const role = agentRelayRole(a);
        if (!role) return [];
        const where = { whatsappGuardUrl: url(agentIp(server, a, "whatsapp"), GUARD_PORT), ownerWhatsapp: a.ownerWhatsapp, phoneNumberId: a.phoneNumberId, business: a.business, secretsDir: `/run/secrets/${a.name}`, stateDir: `/home/node/state/${a.name}` };
        if (role.kind === "desk") return [[a.name, { kind: "own-agent", agentId: agentNames.agentId(a.name), desk: { payment: a.payment }, ...where }]];
        const asks = { kind: "own-agent", guardAdminUrl: guardAdmin(server, a, role.guard as Three).adminUrl, approverId: names.approverId(a.name), agentId: agentNames.agentId(a.name) };
        if (role.kind === "own-api") return [[a.name, { ...asks, ownApi: a.ownApi, ...where }]];
        return [[a.name, { ...asks, gateway: { id: role.guard, guardUrl: url(agentIp(server, a, role.guard as Three), GUARD_PORT) }, ...where }]];
      }),
    ]),
  });
}

export function refresherConfig(server: ServerConfig, shops: (ShopDeploy & { webhooks: ShopWebhooks })[], overrides: { scope?: string } = {}, agents: AgentFacts[] = []): string {
  const entry = (s: Pick<ShopDeploy, "name" | "index">, own: boolean) => [s.name, {
    serviceAccountFile: own ? `/run/secrets/${s.name}/google_service_account.json` : "/run/secrets/_server/google_service_account.json",
    guardAdminUrl: guardAdmin(server, s, "calendar").adminUrl, adminTokenFile: `/run/secrets/${s.name}/admin_token`,
  }];
  return stableJson({
    outDir: "/home/node", refreshMinutes: 45, scope: overrides.scope ?? "https://www.googleapis.com/auth/calendar",
    shops: Object.fromEntries([
      ...shops.filter((s) => s.webhooks.hasGoogle).map((s) => entry(s, s.webhooks.ownGoogleKey)),
      ...agents.filter((a) => a.hasGoogle && hasGuard(a, "calendar")).map((a) => entry(a, a.ownGoogleKey)),
    ]),
  });
}

export function opsConfig(server: ServerConfig, shops: (ShopDeploy & { pathwayVersion: string; pathway?: string })[], agents: AgentFacts[] = []): string {
  const net = addressing(server);
  const modelGuard = { id: "guard-model", service: names.modelGuard, adminUrl: url(net.adminIp(undefined, "model"), ADMIN_FORWARD_PORT), healthUrl: url(net.adminIp(undefined, "model"), HEALTH_PORT), adminTokenFile: "/run/secrets/_model/admin_token" };
  return stableJson({
    deploymentId: server.id, bundleVersion: BUNDLE_VERSION, heartbeatSeconds: server.heartbeatSeconds,
    ...(server.fleet ? { fleet: { url: server.fleet.url, keyFile: "/run/secrets/fleet_key" } } : {}),
    fleetDir: OPS_FLEET_DIR,
    shops: Object.fromEntries(shops.map((s) => [s.name, {
      pathway: s.pathway ?? "bookings", pathwayVersion: s.pathwayVersion,
      runtimeUrl: runtimeUrl(server, s), internalTokenFile: `/run/secrets/${s.name}/internal_token`,
      // where the deployer records the shop's backup times (the heartbeat reports their ages)
      statusFile: `${OPS_STATUS_DIR}/${s.name}.json`,
      // the shop's three Guards, and the server's model Guard (shared, so it is listed under every shop: if it is not ready, every shop says so)
      guards: [...SHOP_GUARD_KINDS.filter((kind) => s.guards.some((g) => g.kind === kind)).map((kind) => ({ id: `guard-${kind}`, service: names.guard(s.name, kind), ...guardAdmin(server, s, kind), adminTokenFile: `/run/secrets/${s.name}/admin_${kind}` })), modelGuard],
    }])),
    model: modelGuard,
    // Agents someone else wrote: their Guards only. `agentUrl` is where the reading agent (record-<name>) looks at the service's own state through the Guard.
    ...(agents.length > 0 ? {
      ownAgents: Object.fromEntries(agents.map((a) => [a.name, {
        createdAt: a.createdAt, recordTokenFile: `/run/secrets/${a.name}/record_token`, labelKeyFile: `/run/secrets/${a.name}/label_key`, ownerWhatsapp: a.ownerWhatsapp, ...(a.calendarId ? { calendarId: a.calendarId } : {}),
        // as a shop's: the deployer's status file, where the snapshot and the drill of its Guards and record are written (B51), so the heartbeat reports their ages
        statusFile: `${OPS_STATUS_DIR}/${a.name}.json`,
        guards: a.guards.map((g) => ({
          id: `guard-${g.kind}`, service: g.service, ...guardAdmin(server, a, g.kind as Three), agentUrl: url(agentIp(server, a, g.kind as Three), GUARD_PORT), adminTokenFile: `/run/secrets/${a.name}/admin_${g.kind}`,
        })),
      }])),
    } : {}),
  });
}

export { INBOX_PORT, REFRESHER_PORT };
