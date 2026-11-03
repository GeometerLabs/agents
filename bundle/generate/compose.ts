// compose.yaml and the Caddyfile for a whole server, generated from the shops it holds. Nothing here touches a file or Docker: it returns text, and
// the deployer writes it. The shape of the server:
//
//   per shop      rt-<shop>               the runtime, on ONE internal network (net-<shop>) with its own Guards and the model Guard, nothing else
//                 g-<shop>-razorpay       one Guard per upstream per shop: a Guard binds one tool and one bundle, and its per-agent config
//                 g-<shop>-whatsapp       cannot restrict argument values, so a shared WhatsApp Guard could be told to send from another shop's number
//                 g-<shop>-calendar
//                 fwd-<shop>-<tool>       3 tiny forwarders, one per Guard; each owns its Guard's network namespace and is the way to its admin port (see below)
//                 door-<shop>             a tiny forwarder from the `admin` network to the runtime's port: how the inbox, the relay and ops reach the runtime
//   per server    g-model                 the model Guard (the server's key and cap; every shop's runtime is an agent of it)
//                 inbox, relay            webhooks in /c/<shop>/..., owners' approvals; each routes by shop and holds that shop's secrets
//                 refresher, ops          the Google token refresher; the heartbeat sender and the admin client the deployer reaches through `docker exec`
//                 litestream, caddy, (panel)
//
// Networks. net-<shop> and admin are `internal: true`: no route out. egress and front are not. Only the Guards (and the services that must call out:
// ops for the heartbeat, the refresher for Google, litestream for the bucket) are on egress. Caddy is on front with the inbox, the relay and the panel, so
// it can reach those three and nothing else; its Caddyfile sends /c/* to the inbox and /panel/* to the panel (the relay is for the inbox to call).
//
// The runtime's network, net-<shop>, holds ONLY the runtime, its own three Guards, the model Guard and its door. Docker has no one-way network, so a
// service that is on the runtime's network can be connected to by the runtime: the inbox, the relay and ops are therefore NOT on it. They reach the
// runtime through its door, which listens only on its address on the `admin` network (the runtime is not on that network and cannot connect to it),
// and the relay reaches the shop's WhatsApp Guard on that Guard's address on the `admin` network too. So the only things the runtime can connect to are
// its Guards and the model Guard. Each of them refuses a call without the right credential.
//
// Guard's admin port (kill switch, approvals, reload, status) is on 127.0.0.1 inside the Guard, because Guard's production profile refuses it on
// any other address without TLS on the agent port too. fwd-* is a busybox `nc` that owns the Guard's network namespace and listens only on its
// address on the `admin` network, passing bytes to 127.0.0.1:8082 (the Guard shares that loopback). The runtime is not on that network, so it cannot
// see the port at all.
import { CADDY_IMAGE, LITESTREAM_IMAGE, isLocalDomain } from "../lib/server.ts";
import type { ServerConfig } from "../lib/server.ts";
import type { GuardKind } from "./guards.ts";
import { GUARD_PORT, RUNTIME_PORT, names } from "./shop.ts";

export const FORWARDER_IMAGE = "busybox:1.37.0";
export const ADMIN_FORWARD_PORT = 8190;
export const INBOX_PORT = 8788;
export const RELAY_PORT = 8795;
export const REFRESHER_PORT = 8791;
export const PANEL_PORT = 8790;
export const HEALTH_PORT = 8081;
/** A shop's three Guards, in the order that fixes each one's address on the admin network (the shop's door is the fourth). */
export const SHOP_GUARD_KINDS: readonly Exclude<GuardKind, "model">[] = ["razorpay", "whatsapp", "calendar"];
export type Slot = GuardKind | "door";

/** A Guard as the compose file needs to know it. */
export interface GuardRef { kind: GuardKind; service: string; tenant: string }

export interface ShopDeploy {
  name: string;
  /** 1 to 199, fixed for the life of the shop (state.ts): it fixes the shop's network addresses. */
  index: number;
  guards: GuardRef[];
  /** The folder with the pathway at the version the shop is pinned to. */
  pathwayDir: string;
}

export interface Dirs {
  /** The agents repository (read-only in containers). */
  app: string;
  generated: string;
  secrets: string;
  status: string;
  shops: string;
  secretsInbox: string;
  requests: string;
  exports: string;
  /** The panel's own data folder. */
  panelData: string;
  /** geometer.json, which the panel reads (the model, and nothing secret is in it). */
  config: string;
}

export interface Addressing {
  subnets: Record<string, string>;
  adminIp: (shop: string | undefined, slot: Slot, index?: number) => string;
  /** A Guard's address on the panel's network: its agent port is reachable there, and nothing else is listening on that address. */
  panelIp: (kind: Exclude<GuardKind, "model">, index: number) => string;
}

/** Fixed small subnets for every network, so a busy Docker host never runs out of default pools, and the forwarders know their address. */
export function addressing(server: ServerConfig): Addressing {
  const base = server.network.base;
  return {
    subnets: { front: `${base}.238.0/24`, egress: `${base}.239.0/24`, admin: `${base}.240.0/20`, panel: `${base}.224.0/21` },
    panelIp(kind, index) {
      const n = 16 + index * 4 + SHOP_GUARD_KINDS.indexOf(kind);
      return `${base}.${224 + (n >> 8)}.${n & 255}`;
    },
    adminIp(_shop, slot, index = 0) {
      const n = slot === "model" ? 8 : 16 + index * 4 + (slot === "door" ? 3 : SHOP_GUARD_KINDS.indexOf(slot));
      return `${base}.${240 + (n >> 8)}.${n & 255}`;
    },
  };
}
export const shopSubnet = (server: ServerConfig, index: number) => `${server.network.base}.${index}.0/24`;

// ---- a very small YAML writer: scalars as JSON, so quoting is never wrong -------------------------------------------------------------------

type Y = string | number | boolean | null | Y[] | { [key: string]: Y | undefined };
export function yaml(value: Y, indent = 0): string {
  const pad = "  ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return value.map((v) => `${pad}- ${typeof v === "object" && v !== null ? yaml(v, indent + 1).trimStart() : JSON.stringify(v)}`).join("\n");
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return "{}";
    return entries.map(([k, v]) => {
      const key = /^[A-Za-z0-9_.-]+$/u.test(k) ? k : JSON.stringify(k);
      if (Array.isArray(v) && v.length > 0) return `${pad}${key}:\n${yaml(v, indent + 1)}`;
      if (typeof v === "object" && v !== null && !Array.isArray(v) && Object.keys(v).length > 0) return `${pad}${key}:\n${yaml(v, indent + 1)}`;
      return `${pad}${key}: ${yaml(v as Y, 0)}`;
    }).join("\n");
  }
  return JSON.stringify(value);
}

// ---- the services ----------------------------------------------------------------------------------------------------------------------------

type Service = Record<string, Y | undefined>;
const hardened = { restart: "unless-stopped", read_only: true, cap_drop: ["ALL"], security_opt: ["no-new-privileges:true"], tmpfs: ["/tmp"] };
const nodeUser = "1000:1000"; // the `node` user of the node image
const guardUser = "65532:65532"; // the user the Guard image runs as
const healthWget = (port: number, path: string) => ({ test: ["CMD", "wget", "-q", "-O", "/dev/null", `http://127.0.0.1:${port}${path}`], interval: "10s", timeout: "3s", retries: 3, start_period: "10s" });

export interface Composed {
  compose: string;
  caddyfile: string;
  /** Every service, with the host files whose contents it reads (compose does not notice a changed bind-mounted file, so the deployer hashes these). */
  services: Record<string, { block: Service; files: string[] }>;
}

export interface PanelOptions {
  /** `uid:gid` the panel container runs as (the user who runs the deployer; see lib/secrets.ts panelUser). */
  user: string;
  /** The server-wide Google service account's address, when there is one: the panel tells people to share a calendar with it. */
  shareAddress?: string;
  /** False when this checkout has no panel program (bundle/panel/main.ts): the panel's network, agents and keys are still made, the container is not. */
  run?: boolean;
}

export function composeServer(server: ServerConfig, dirs: Dirs, shops: ShopDeploy[], features: { backup: boolean; panel?: PanelOptions }): Composed {
  const modelGuard: GuardRef = { kind: "model", service: names.modelGuard, tenant: server.id };
  const net = addressing(server);
  const services: Composed["services"] = {};
  const add = (name: string, block: Service, files: string[] = []) => { services[name] = { block, files }; };
  const shopNets = shops.map((s) => names.net(s.name));
  const secretDir = (name: string) => `${dirs.secrets}/${name}`;
  const node = (command: string[], extra: Service): Service => ({ image: server.appImage, user: nodeUser, init: true, ...hardened, command, ...extra });

  // -- the Guards (per shop and the model) and their forwarders. The forwarder OWNS the network namespace (as the TLS front does in deploy/compose) and the
  // Guard joins it: a Guard that restarts or crashes leaves the namespace, its addresses and the forwarder as they were. The Guard's name on the shop's
  // network is an alias on the forwarder.
  const guard = (g: GuardRef, attach: string[], adminAddress: string, extraVolumes: Y[], dependsOn?: Record<string, Y>, panelAddress?: string) => {
    const fwd = `fwd-${g.service.replace(/^g-/u, "")}`;
    add(fwd, {
      image: FORWARDER_IMAGE, ...hardened, user: guardUser,
      command: ["nc", "-ll", "-s", adminAddress, "-p", String(ADMIN_FORWARD_PORT), "-e", "nc", "127.0.0.1", "8082"],
      // the panel's network carries only the Guard's agent port (the forwarder listens on the admin address alone); the panel reaches the Guard by name there
      networks: { ...Object.fromEntries(attach.map((n) => [n, { aliases: [g.service] }])), egress: {}, admin: { ipv4_address: adminAddress }, ...(panelAddress ? { panel: { ipv4_address: panelAddress, aliases: [g.service] } } : {}) },
    });
    add(g.service, {
      image: server.guardImage, ...hardened, user: guardUser, stop_grace_period: "30s", network_mode: `service:${fwd}`,
      volumes: [`${dirs.generated}/guards/${g.service}:/etc/geo-guard:ro`, `${g.kind === "model" ? names.modelStateVolume : names.stateVolume(g.tenant, g.kind)}:/var/lib/geo-guard`, `${secretDir(g.service)}:/run/secrets:ro`, ...extraVolumes],
      healthcheck: { test: ["CMD", "/usr/local/bin/geo-guard", "health", `127.0.0.1:${HEALTH_PORT}/readyz`], interval: "10s", timeout: "3s", retries: 3, start_period: "10s" },
      depends_on: { [fwd]: { condition: "service_started" }, ...dependsOn },
    }, [`${dirs.generated}/guards/${g.service}/guard.toml`, `${dirs.generated}/guards/${g.service}/bundle.json`]);
  };

  for (const shop of shops) {
    for (const g of shop.guards) {
      guard(
        g, [names.net(shop.name)], net.adminIp(shop.name, g.kind, shop.index),
        g.kind === "calendar" ? [{ type: "volume", source: "google-auth", target: "/run/google", read_only: true, volume: { subpath: shop.name } }] : [],
        g.kind === "calendar" ? { refresher: { condition: "service_healthy" } } : undefined,
        features.panel ? net.panelIp(g.kind as Exclude<GuardKind, "model">, shop.index) : undefined,
      );
    }
    const doorIp = net.adminIp(shop.name, "door", shop.index);
    add(names.door(shop.name), {
      image: FORWARDER_IMAGE, ...hardened, user: guardUser,
      command: ["nc", "-ll", "-s", doorIp, "-p", String(RUNTIME_PORT), "-e", "nc", names.runtime(shop.name), String(RUNTIME_PORT)],
      networks: { [names.net(shop.name)]: {}, admin: { ipv4_address: doorIp } },
    });
    const own = shop.guards.map((g) => g.service);
    add(names.runtime(shop.name), node(["node", "/pathway/server/main.ts", "--client", "/client"], {
      environment: { INTERNAL_TOKEN_FILE: "/run/secrets/internal_token" },
      volumes: [`${shop.pathwayDir}:/pathway:ro`, `${dirs.generated}/shops/${shop.name}/client:/client:ro`, `${secretDir(names.runtime(shop.name))}:/run/secrets:ro`, `${names.dataVolume(shop.name)}:/home/node`],
      networks: { [names.net(shop.name)]: {} },
      healthcheck: healthWget(RUNTIME_PORT, "/readyz"),
      // its own three Guards must be healthy before it starts (fail closed). The model Guard is shared and the runtime reads messages with its built-in rules
      // when the model cannot be asked, so a model outage must not stop every shop from starting.
      depends_on: Object.fromEntries(own.map((s) => [s, { condition: "service_healthy" }])),
    }), [`${dirs.generated}/shops/${shop.name}/client/runtime.json`, `${dirs.generated}/shops/${shop.name}/client/settings.json`, `${dirs.generated}/shops/${shop.name}/client/pathway.lock`]);
  }
  guard(modelGuard, shopNets, net.adminIp(undefined, "model"), []);

  // -- the shared services
  const appVolume = `${dirs.app}:/app:ro`;
  add("inbox", node(["node", "/app/bundle/services/inbox.ts"], {
    environment: { CONFIG: "/etc/geometer/inbox.json", PORT: String(INBOX_PORT), HOST: "0.0.0.0" },
    volumes: [appVolume, `${dirs.generated}/inbox:/etc/geometer:ro`, `${secretDir("inbox")}:/run/secrets:ro`],
    networks: { front: {}, admin: {} }, healthcheck: healthWget(INBOX_PORT, "/healthz"),
  }), [`${dirs.generated}/inbox/inbox.json`]);
  add("relay", node(["node", "/app/bundle/services/relay.ts"], {
    environment: { CONFIG: "/etc/geometer/relay.json", PORT: String(RELAY_PORT), HOST: "0.0.0.0" },
    volumes: [appVolume, `${dirs.generated}/relay:/etc/geometer:ro`, `${secretDir("relay")}:/run/secrets:ro`, "relay-state:/home/node"],
    networks: { front: {}, admin: {} }, healthcheck: healthWget(RELAY_PORT, "/healthz"),
  }), [`${dirs.generated}/relay/relay.json`]);
  add("refresher", node(["node", "/app/bundle/services/refresher.ts"], {
    environment: { CONFIG: "/etc/geometer/refresher.json", PORT: String(REFRESHER_PORT), HOST: "0.0.0.0" },
    volumes: [appVolume, `${dirs.generated}/refresher:/etc/geometer:ro`, `${secretDir("refresher")}:/run/secrets:ro`, "google-auth:/home/node"],
    networks: { admin: {}, egress: {} }, healthcheck: { ...healthWget(REFRESHER_PORT, "/healthz"), start_period: "30s" },
  }), [`${dirs.generated}/refresher/refresher.json`]);
  add("ops", node(["node", "/app/bundle/services/ops.ts", "run"], {
    environment: { CONFIG: "/etc/geometer/ops.json" },
    volumes: [appVolume, `${dirs.generated}/ops:/etc/geometer:ro`, `${secretDir("ops")}:/run/secrets:ro`],
    networks: { admin: {}, egress: {} },
  }), [`${dirs.generated}/ops/ops.json`]);
  if (features.backup) {
    add("litestream", {
      image: LITESTREAM_IMAGE, user: nodeUser, ...hardened, command: ["replicate", "-config", "/etc/litestream.yml"],
      volumes: [`${secretDir("litestream")}/litestream.yml:/etc/litestream.yml:ro`, ...shops.map((s) => `${names.dataVolume(s.name)}:/data/${s.name}`)],
      networks: { egress: {} },
      depends_on: Object.fromEntries(shops.map((s) => [names.runtime(s.name), { condition: "service_healthy" }])),
    }, [`${secretDir("litestream")}/litestream.yml`]);
  }
  if (server.panel.enabled && features.panel && features.panel.run !== false) {
    const publicUrl = `https://${server.domain}${server.ports.https === 443 ? "" : `:${server.ports.https}`}`;
    // The panel writes the desired state, the secrets inbox and stop requests; it reads the results and the exports; it keeps its own data. It sees NONE of the
    // server's other folders (not secrets/, not state/, not generated/), has no Docker socket, and its network holds only the Guards' agent ports, where it
    // presents its own agent (`panel-<shop>`: three reads and nothing else). Its keys are in secrets/panel/, 0600, readable by the user it runs as.
    add("panel", {
      image: server.appImage, user: features.panel.user, init: true, ...hardened, command: ["node", "/app/bundle/panel/main.ts"],
      environment: {
        PANEL_SERVER_DIR: "/server", PANEL_MODE: server.panel.mode, PANEL_HOST: "0.0.0.0", PANEL_PORT: String(PANEL_PORT), PANEL_PUBLIC_URL: publicUrl, PANEL_TRUST_PROXY: "1",
        PANEL_DATA_KEY_FILE: "/run/secrets/data_key", PANEL_SIGNING_KEY_FILE: "/run/secrets/signing_key", PANEL_PATHWAYS_DIR: "/app/pathways",
        PANEL_GUARD_URL: `http://g-{shop}-{kind}:${GUARD_PORT}`, PANEL_GUARD_AGENT_TOKEN_FILE: "/run/secrets/{shop}/{kind}", PANEL_WEBHOOK_URL: `${publicUrl}/c/{shop}/webhooks/{kind}`,
        ...(features.panel.shareAddress ? { PANEL_CALENDAR_SHARE_ADDRESS: features.panel.shareAddress } : {}),
      },
      volumes: [appVolume, `${secretDir("panel")}:/run/secrets:ro`, `${dirs.shops}:/server/shops`, `${dirs.secretsInbox}:/server/secrets-inbox`, `${dirs.requests}:/server/requests`, `${dirs.status}:/server/status:ro`, `${dirs.exports}:/server/exports:ro`, `${dirs.panelData}:/server/panel`, `${dirs.config}:/server/geometer.json:ro`],
      networks: { front: {}, panel: {} },
      healthcheck: healthWget(PANEL_PORT, "/healthz"),
    });
  }
  add("caddy", {
    image: CADDY_IMAGE, restart: "unless-stopped", security_opt: ["no-new-privileges:true"],
    ports: [`${server.ports.http}:80`, `${server.ports.https}:443`],
    volumes: [`${dirs.generated}/Caddyfile:/etc/caddy/Caddyfile:ro`, "caddy-data:/data", "caddy-config:/config"],
    networks: { front: {} },
  }, [`${dirs.generated}/Caddyfile`]);

  // -- networks and volumes
  const networks: Record<string, Y> = {
    front: { ipam: { config: [{ subnet: net.subnets.front }] } },
    egress: { ipam: { config: [{ subnet: net.subnets.egress }] } },
    admin: { internal: true, ipam: { config: [{ subnet: net.subnets.admin }] } },
    ...(server.panel.enabled && features.panel ? { panel: { internal: true, ipam: { config: [{ subnet: net.subnets.panel }] } } } : {}),
  };
  for (const s of shops) networks[names.net(s.name)] = { internal: true, ipam: { config: [{ subnet: shopSubnet(server, s.index) }] } };
  const volumes: Record<string, Y> = { "google-auth": {}, "relay-state": {}, "caddy-data": {}, "caddy-config": {}, [names.modelStateVolume]: {} };
  for (const s of shops) {
    volumes[names.dataVolume(s.name)] = {};
    for (const g of s.guards) volumes[names.stateVolume(s.name, g.kind as Exclude<GuardKind, "model">)] = {};
  }

  const body: Record<string, Y> = { name: `geometer-${server.id.replace(/_/gu, "-")}`, services: Object.fromEntries(Object.entries(services).map(([n, s]) => [n, s.block as Y])), networks, volumes };
  return {
    compose: `# Written by the Geometer deploy bundle on every deploy. Do not edit: change a shop's files and deploy again.\n${yaml(body)}\n`,
    caddyfile: caddyfile(server),
    services,
  };
}

/** Caddy: HTTPS for the builder's domain (a local certificate for localhost), and only three places behind it. */
export function caddyfile(server: ServerConfig): string {
  const local = isLocalDomain(server.domain);
  return [
    `# Written by the Geometer deploy bundle. Caddy reaches the inbox, the relay and the panel (the only containers on its network), and routes two places.`,
    `{`, `\tadmin off`, ...(local ? [`\tauto_https disable_redirects`] : []), `}`, ``,
    `${local ? "https://" : ""}${server.domain} {`,
    ...(local ? [`\ttls internal`] : []),
    `\thandle /c/* {`, `\t\treverse_proxy inbox:${INBOX_PORT}`, `\t}`,
    // everything else is the panel's, when there is one: it serves from the root of its own address
    ...(server.panel.enabled ? [`\thandle {`, `\t\treverse_proxy panel:${PANEL_PORT}`, `\t}`] : [`\thandle {`, `\t\trespond "Geometer" 404`, `\t}`]), `}`, ``,
  ].join("\n");
}

