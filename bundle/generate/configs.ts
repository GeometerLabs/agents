// The small config files the shared services read (inbox, relay, refresher, ops), and the secret files they and the shops' containers get. None of the
// config files holds a secret: they name the secret FILES. Pure text in, text out; the deployer writes them.
import { BUNDLE_VERSION } from "../lib/server.ts";
import type { ServerConfig } from "../lib/server.ts";
import { ADMIN_FORWARD_PORT, HEALTH_PORT, INBOX_PORT, RELAY_PORT, REFRESHER_PORT, SHOP_GUARD_KINDS, addressing } from "./compose.ts";
import type { ShopDeploy } from "./compose.ts";
import { GUARD_PORT, RUNTIME_PORT, names } from "./shop.ts";
import { stableJson } from "../lib/util.ts";

export interface ShopWebhooks {
  verification: "meta-signature" | "path-token";
  /** True when the Google service account key was handed in for this shop. */
  hasGoogle: boolean;
}

const url = (ip: string, port: number) => `http://${ip}:${port}`;

/** Where the shared services reach a shop's runtime: its door, on the admin network. */
const runtimeUrl = (server: ServerConfig, shop: ShopDeploy) => url(addressing(server).adminIp(shop.name, "door", shop.index), RUNTIME_PORT);

/** Where each Guard's admin port is reached: the forwarder's address on the admin network. */
export function guardAdmin(server: ServerConfig, shop: ShopDeploy, kind: (typeof SHOP_GUARD_KINDS)[number]) {
  const ip = addressing(server).adminIp(shop.name, kind, shop.index);
  return { adminUrl: url(ip, ADMIN_FORWARD_PORT), healthUrl: url(ip, HEALTH_PORT) };
}

export function inboxConfig(server: ServerConfig, shops: (ShopDeploy & { webhooks: ShopWebhooks; ownerWhatsapp: string; phoneNumberId: string })[]): string {
  return stableJson({
    shops: Object.fromEntries(shops.map((s) => [s.name, {
      runtimeUrl: runtimeUrl(server, s),
      relayUrl: `http://relay:${RELAY_PORT}/c/${s.name}`,
      ownerWhatsapp: s.ownerWhatsapp, phoneNumberId: s.phoneNumberId, verification: s.webhooks.verification,
      secretsDir: `/run/secrets/${s.name}`,
    }])),
  });
}

export function relayConfig(server: ServerConfig, shops: (ShopDeploy & { ownerWhatsapp: string; phoneNumberId: string })[]): string {
  return stableJson({
    shops: Object.fromEntries(shops.map((s) => [s.name, {
      guardAdminUrl: guardAdmin(server, s, "razorpay").adminUrl,
      approverId: names.approverId(s.name), agentId: names.agentId(s.name),
      runtimeUrl: runtimeUrl(server, s),
      // the relay is not on the shop's network: it reaches the WhatsApp Guard's agent port on the Guard's address on the admin network
      whatsappGuardUrl: url(addressing(server).adminIp(s.name, "whatsapp", s.index), GUARD_PORT),
      ownerWhatsapp: s.ownerWhatsapp, phoneNumberId: s.phoneNumberId,
      secretsDir: `/run/secrets/${s.name}`, stateDir: `/home/node/state/${s.name}`,
    }])),
  });
}

export function refresherConfig(server: ServerConfig, shops: (ShopDeploy & { webhooks: ShopWebhooks })[], overrides: { scope?: string } = {}): string {
  return stableJson({
    outDir: "/home/node", refreshMinutes: 45, scope: overrides.scope ?? "https://www.googleapis.com/auth/calendar",
    shops: Object.fromEntries(shops.filter((s) => s.webhooks.hasGoogle).map((s) => [s.name, {
      serviceAccountFile: `/run/secrets/${s.name}/google_service_account.json`,
      guardAdminUrl: guardAdmin(server, s, "calendar").adminUrl, adminTokenFile: `/run/secrets/${s.name}/admin_token`,
    }])),
  });
}

export function opsConfig(server: ServerConfig, shops: (ShopDeploy & { pathwayVersion: string })[]): string {
  const net = addressing(server);
  return stableJson({
    deploymentId: server.id, bundleVersion: BUNDLE_VERSION, heartbeatSeconds: server.heartbeatSeconds,
    ...(server.fleet ? { fleet: { url: server.fleet.url, keyFile: "/run/secrets/fleet_key" } } : {}),
    shops: Object.fromEntries(shops.map((s) => [s.name, {
      pathway: "bookings", pathwayVersion: s.pathwayVersion,
      runtimeUrl: runtimeUrl(server, s), internalTokenFile: `/run/secrets/${s.name}/internal_token`,
      guards: SHOP_GUARD_KINDS.map((kind) => ({ id: `guard-${kind}`, service: names.guard(s.name, kind), ...guardAdmin(server, s, kind), adminTokenFile: `/run/secrets/${s.name}/admin_${kind}` })),
    }])),
    model: { id: "guard-model", service: names.modelGuard, adminUrl: url(net.adminIp(undefined, "model"), ADMIN_FORWARD_PORT), healthUrl: url(net.adminIp(undefined, "model"), HEALTH_PORT), adminTokenFile: "/run/secrets/_model/admin_token" },
  });
}

export { INBOX_PORT, REFRESHER_PORT };
