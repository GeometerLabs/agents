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
//                 caddy, (panel)
//
// Networks. net-<shop> and admin are `internal: true`: no route out. egress and front are not. Only the Guards (and the services that must call out:
// ops for the heartbeat, the refresher for Google) are on egress. Caddy is on front with the inbox, the relay and the panel, so
// it can reach those three and nothing else; its Caddyfile sends /c/* to the inbox and /panel/* to the panel (the relay is for the inbox to call). Item 11d: /s/* goes to
// the inbox too, where the shops' public booking pages and the owners' private pages are served (modules/channels/front.ts), each shop's with its own channel token.
// Item 11f, on a server that answers for the pages domain (geometer.json `pages`): one more container, `door` (services/door.ts), on `pages` (internal: Caddy, the door
// and the inbox only) and `egress` (fleet's lookups and builders' servers). It holds no secret and reaches no panel, relay or Guard.
//
// The monthly report pages. The runtime writes them into <data volume>/data/reports/<32 random hex digits>/. Caddy mounts that one folder of each shop's data volume,
// read-only, at /srv/r/<shop> (and nothing else of the volume: the database and the record are not in Caddy's reach), and serves https://<domain>/r/<shop>/<hex>/<file>
// from it. rd-<shop> is a one-shot that makes the folder first (a volume sub-folder must exist before Docker can start the container that mounts it, and the runtime
// makes it only when it writes its first report). Every other address under /r answers 404, so there is no folder listing and no way out of the folder (reportsMatcher).
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
import { basename, dirname, join } from "node:path";
import { CADDY_IMAGE, isLocalDomain, publicUrl } from "../lib/server.ts";
import type { ServerConfig } from "../lib/server.ts";
import { agentNames } from "../agent/plan.ts";
import { DESK_PORT, GUPSHUP_TOKEN_MOUNT, LICENCE_MOUNT, OWNER_MARKED_KINDS } from "./guards.ts";
import { OWN_API, isGatewayKind } from "../../modules/payments/providers/index.ts";
import type { GuardKind } from "./guards.ts";
import { GUARD_PORT, HOME_DIR, REPORTS_DIR, REPORTS_ROUTE, REPORTS_SUBPATH, RUNTIME_PORT, names } from "./shop.ts";
import { DOOR_PORT } from "../services/door.ts";

export const FORWARDER_IMAGE = "busybox:1.37.0";
export const ADMIN_FORWARD_PORT = 8190;
export const INBOX_PORT = 8788;
/** Item 11f: the pages domain's front door (services/door.ts), and the network only it, Caddy and the inbox are on. */
export const PAGES_NETWORK = "pages";
export const RELAY_PORT = 8795;
export const REFRESHER_PORT = 8791;
export const PANEL_PORT = 8790;
/** Where the ops container sees the deployer's status files (read-only): it reads the backup times from them for the heartbeat. */
export const OPS_STATUS_DIR = "/server/status";
/** The one folder ops can WRITE: fleet's answer for each shop (<shop>.json) and the usage baseline. The deployer and the panel read it. */
export const OPS_FLEET_DIR = "/server/fleet";
export const HEALTH_PORT = 8081;
/** A shop's three Guards, in the order that fixes each one's address on the admin network (the shop's door is the fourth). */
export const SHOP_GUARD_KINDS: readonly Exclude<GuardKind, "model">[] = ["razorpay", "whatsapp", "calendar"];
/**
 * A Guard's place among its shop's four addresses. The way money is taken is the first, whichever it is (a gateway module, the desk of a module the owner marks, or an agent's own API, B71): a shop or an
 * agent has one, so they never share it. A kind with no place is an error here, never a neighbour's address.
 */
export function slotOf(kind: Exclude<GuardKind, "model">): number {
  // the desk's Guard (an owner-marked module, B71 part 2) is the agent's way of taking money too
  if (isGatewayKind(kind) || kind === OWN_API || OWNER_MARKED_KINDS.includes(kind)) return 0;
  const i = SHOP_GUARD_KINDS.indexOf(kind);
  if (i < 0) throw new Error(`A Guard of kind ${kind} has no address slot.`);
  return i;
}
export type Slot = GuardKind | "door";

/** A Guard as the compose file needs to know it. */
export interface GuardRef { kind: GuardKind; service: string; tenant: string }

/**
 * The shared modules a template imports (agents/modules) sit three folders up from it: <app>/templates/commerce/bookings and <app>/modules, or a kept checkout laid out the
 * same way, <server>/templates/commerce/bookings@0.1.0 and <server>/modules. A kept checkout from before the templates were grouped by domain, <server>/pathways/bookings@0.1.0,
 * has them two folders up (<server>/modules). In the container the template is /pathway and the modules are /modules, and the template's relative imports
 * (../../../../modules/...) go past the root of the container, where a path stops, so they find /modules whichever layout the folder came from.
 */
export const modulesOf = (pathwayDir: string): string => {
  const parent = dirname(pathwayDir);
  return join(basename(parent) === "pathways" ? dirname(parent) : dirname(dirname(parent)), "modules");
};

export interface ShopDeploy {
  name: string;
  /** 1 to 199, fixed for the life of the shop (state.ts): it fixes the shop's network addresses. */
  index: number;
  guards: GuardRef[];
  /** The folder with the template at the version the shop is pinned to. The shared modules (agents/modules) are the folder called modules above it (`modulesOf`). */
  pathwayDir: string;
  /** Follow-up 2: its WhatsApp Guard reads a Gupshup app token the refresher renews (from the `gupshup-auth` volume), as a Calendar Guard reads Google's. */
  gupshupRenewed?: boolean;
}

/**
 * An agent someone else wrote, as the compose file needs to know it: its Guards and nothing else (no runtime, no door). Its Guards' agent ports are on the `gate` network
 * (internal, with Caddy), where Caddy sends /g/<name>/<service>/... to them; the builder's agent presents its Guard credential there instead of the service's own key.
 */
export interface AgentDeploy {
  name: string;
  /** From the same pool as the shops' index: it fixes the agent's addresses on the admin network. */
  index: number;
  guards: GuardRef[];
}

export interface Dirs {
  /** The agents repository (read-only in containers). */
  app: string;
  generated: string;
  secrets: string;
  status: string;
  /** Fleet's answers (<server>/fleet): written by ops, read by the deployer (button mode) and the panel (plan, badge, warnings). */
  fleet: string;
  shops: string;
  secretsInbox: string;
  requests: string;
  exports: string;
  /** The panel's own data folder. */
  panelData: string;
  /** geometer.json, which the panel reads (the model, and nothing secret is in it). */
  config: string;
  /**
   * The server's state/licence/ (B13): the kept lease, seen.json and the extensions. Each per-shop Guard mounts the FOLDER read-only at LICENCE_MOUNT (the deployer
   * replaces the files by rename, and a single-file bind mount keeps showing the old one). The model Guard does not get it.
   */
  licence: string;
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
    subnets: { front: `${base}.238.0/24`, egress: `${base}.239.0/24`, admin: `${base}.240.0/20`, panel: `${base}.224.0/21`, gate: `${base}.232.0/24`, speech: `${base}.233.0/24`, pages: `${base}.236.0/24` },
    panelIp(kind, index) {
      const n = 16 + index * 4 + slotOf(kind);
      return `${base}.${224 + (n >> 8)}.${n & 255}`;
    },
    adminIp(_shop, slot, index = 0) {
      const n = slot === "model" ? 8 : 16 + index * 4 + (slot === "door" ? 3 : slotOf(slot));
      return `${base}.${240 + (n >> 8)}.${n & 255}`;
    },
  };
}
// Each shop gets its own /24 so one shop's containers cannot reach another's; the index is the shop's fixed slot.
export const shopSubnet = (server: ServerConfig, index: number) => `${server.network.base}.${index}.0/24`;

// ---- a very small YAML writer: scalars as JSON, so quoting is never wrong -------------------------------------------------------------------

type Y = string | number | boolean | null | Y[] | { [key: string]: Y | undefined };
// Hand-written YAML writer so the bundle needs no dependency; scalars go out as JSON strings, which YAML accepts and which cannot be mis-quoted.
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
/** Follow-up 2: the volume the refresher writes renewed Gupshup app tokens into (one sub-folder per shop), and where it is inside the refresher. */
export const GUPSHUP_AUTH_VOLUME = "gupshup-auth";
export const REFRESHER_GUPSHUP_DIR = "/run/gupshup-out";
/** The `node` user of the node image: every node service runs as it, and the backup jobs write the relay's volume as it (backup/jobs.ts). */
export const nodeUser = "1000:1000";
/** The relay's volume (its home folder): the approvals relay's store and each owner-marked desk's ledger (state/<name>/desk.json), which the nightly snapshot reads. */
export const RELAY_STATE_VOLUME = "relay-state";
const guardUser = "65532:65532"; // the user the Guard image runs as
const healthWget = (port: number, path: string) => ({ test: ["CMD", "wget", "-q", "-O", "/dev/null", `http://127.0.0.1:${port}${path}`], interval: "10s", timeout: "3s", retries: 3, start_period: "10s" });

export interface Composed {
  compose: string;
  caddyfile: string;
  /** Every service, with the host files whose contents it reads (compose does not notice a changed bind-mounted file, so the deployer hashes these). */
  services: Record<string, { block: Service; files: string[] }>;
}

/**
 * The optional speech-to-text service (plan 11d). `image` is built from bundle/services/speech/Dockerfile; `modelsDir` is a host folder filled by the operator's fetch-models
 * and mounted READ-ONLY (the service never writes models and the image holds none); `tokenFile` only when the service is not on the same private network as its Guard.
 */
export interface SpeechOptions { image: string; modelsDir: string; tokenFile?: string }
/** The service's name on the `speech` network, and the name the speech Guard's upstream uses (modules/voice/geometer.ts GEOMETER_SPEECH_UPSTREAM: geometer-speech:8080). */
export const SPEECH_SERVICE = "geometer-speech";
export const SPEECH_PORT = 8080;

export interface PanelOptions {
  /** `uid:gid` the panel container runs as (the user who runs the deployer; see lib/secrets.ts panelUser). */
  user: string;
  /** The server-wide Google service account's address, when there is one: the panel tells people to share a calendar with it. */
  shareAddress?: string;
  /** False when this checkout has no panel program (bundle/panel/main.ts): the panel's network, agents and keys are still made, the container is not. */
  run?: boolean;
}

// The whole server as compose services plus the files each needs. Pure: it returns text and touches neither disk nor Docker, so a deploy can be checked before anything starts.
export function composeServer(server: ServerConfig, dirs: Dirs, shops: ShopDeploy[], features: { panel?: PanelOptions; /** `uid:gid` ops runs as, so it can write the fleet folder. Left out: the node image's user. */ opsUser?: string; /** agents someone else wrote: their Guards, nothing more */ agents?: AgentDeploy[]; /** Geometer's speech service (bundle/services/speech): left out = no container and no network. */ speech?: SpeechOptions }): Composed {
  const agents = features.agents ?? [];
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

  // the lease's folder, read-only, on every per-shop Guard (a shop's and an agent's someone else wrote), never on the model Guard
  const licenceVolume = `${dirs.licence}:${LICENCE_MOUNT}:ro`;
  for (const shop of shops) {
    for (const g of shop.guards) {
      guard(
        g, [names.net(shop.name)], net.adminIp(shop.name, g.kind, shop.index),
        [licenceVolume, ...(g.kind === "calendar" ? [{ type: "volume", source: "google-auth", target: "/run/google", read_only: true, volume: { subpath: shop.name } }] : []),
          // a renewed Gupshup shop's WhatsApp Guard: its own sub-folder of the refresher's Gupshup tokens, read-only, as the Calendar Guard's Google token
          ...(g.kind === "whatsapp" && shop.gupshupRenewed ? [{ type: "volume", source: GUPSHUP_AUTH_VOLUME, target: GUPSHUP_TOKEN_MOUNT, read_only: true, volume: { subpath: shop.name } }] : [])],
        g.kind === "calendar" || (g.kind === "whatsapp" && shop.gupshupRenewed) ? { refresher: { condition: "service_healthy" } } : undefined,
        features.panel ? net.panelIp(g.kind as Exclude<GuardKind, "model">, shop.index) : undefined,
      );
    }
    const doorIp = net.adminIp(shop.name, "door", shop.index);
    add(names.door(shop.name), {
      image: FORWARDER_IMAGE, ...hardened, user: guardUser,
      command: ["nc", "-ll", "-s", doorIp, "-p", String(RUNTIME_PORT), "-e", "nc", names.runtime(shop.name), String(RUNTIME_PORT)],
      networks: { [names.net(shop.name)]: {}, admin: { ipv4_address: doorIp } },
    });
    // makes <data volume>/data/reports as the runtime's own user, in the runtime's own image, so a fresh volume gets the same owner the runtime would give it. No network, no Guard, no secret.
    add(names.reportsDir(shop.name), node(["mkdir", "-p", REPORTS_DIR], { restart: "no", network_mode: "none", volumes: [`${names.dataVolume(shop.name)}:${HOME_DIR}`] }));
    const own = shop.guards.map((g) => g.service);
    add(names.runtime(shop.name), node(["node", "/pathway/server/main.ts", "--client", "/client"], {
      // RECORD_KEY_FILE: the record's key (a key derived from the shop's own, B69; lib/secrets.ts): the runtime writes the inputs' digest and message ids with it, and never holds the key itself
      // CHANNEL_TOKEN_FILE (item 11d): what the public front presents for the shop's booking page and owner page, and nothing else (modules/channels)
      environment: { INTERNAL_TOKEN_FILE: "/run/secrets/internal_token", RECORD_KEY_FILE: "/run/secrets/record_key", CHANNEL_TOKEN_FILE: "/run/secrets/channel_token" },
      volumes: [`${shop.pathwayDir}:/pathway:ro`, `${modulesOf(shop.pathwayDir)}:/modules:ro`, `${dirs.generated}/shops/${shop.name}/client:/client:ro`, `${secretDir(names.runtime(shop.name))}:/run/secrets:ro`, `${names.dataVolume(shop.name)}:/home/node`],
      networks: { [names.net(shop.name)]: {} },
      healthcheck: healthWget(RUNTIME_PORT, "/readyz"),
      // its own three Guards must be healthy before it starts (fail closed). The model Guard is shared and the runtime reads messages with its built-in rules
      // when the model cannot be asked, so a model outage must not stop every shop from starting.
      depends_on: Object.fromEntries(own.map((s) => [s, { condition: "service_healthy" }])),
    }), [`${dirs.generated}/shops/${shop.name}/client/runtime.json`, `${dirs.generated}/shops/${shop.name}/client/settings.json`, `${dirs.generated}/shops/${shop.name}/client/pathway.lock`]);
  }
  // An agent someone else wrote: the same Guards, on the `gate` network instead of a runtime's. There is no runtime, no door and no model Guard for it.
  for (const agent of agents) {
    for (const g of agent.guards) {
      guard(g, [agentNames.gate], net.adminIp(agent.name, g.kind, agent.index), [licenceVolume, ...(g.kind === "calendar" ? [{ type: "volume", source: "google-auth", target: "/run/google", read_only: true, volume: { subpath: agent.name } }] : [])],
        g.kind === "calendar" ? { refresher: { condition: "service_healthy" } } : undefined);
    }
  }
  // the model Guard serves the shops' runtimes; a server that holds only agents someone else wrote has no use for it
  if (shops.length > 0) guard(modelGuard, shopNets, net.adminIp(undefined, "model"), []);

  // -- the shared services
  const appVolume = `${dirs.app}:/app:ro`;
  add("inbox", node(["node", "/app/bundle/services/inbox.ts"], {
    environment: { CONFIG: "/etc/geometer/inbox.json", PORT: String(INBOX_PORT), HOST: "0.0.0.0" },
    volumes: [appVolume, `${dirs.generated}/inbox:/etc/geometer:ro`, `${secretDir("inbox")}:/run/secrets:ro`],
    networks: { front: {}, admin: {}, ...(server.pages && server.fleet ? { [PAGES_NETWORK]: {} } : {}) }, healthcheck: healthWget(INBOX_PORT, "/healthz"),
  }), [`${dirs.generated}/inbox/inbox.json`]);
  // DESK_PORT: the owner-marked desk (B71 part 2), served by the relay's process on a port of its own, for the agents' desk Guards (they reach it over `admin`)
  add("relay", node(["node", "/app/bundle/services/relay.ts"], {
    environment: { CONFIG: "/etc/geometer/relay.json", PORT: String(RELAY_PORT), HOST: "0.0.0.0", ...(agents.some((a) => a.guards.some((g) => OWNER_MARKED_KINDS.includes(g.kind))) ? { DESK_PORT: String(DESK_PORT) } : {}) },
    volumes: [appVolume, `${dirs.generated}/relay:/etc/geometer:ro`, `${secretDir("relay")}:/run/secrets:ro`, `${RELAY_STATE_VOLUME}:/home/node`],
    networks: { front: {}, admin: {} }, healthcheck: healthWget(RELAY_PORT, "/healthz"),
  }), [`${dirs.generated}/relay/relay.json`]);
  // follow-up 2: with a renewed Gupshup shop the refresher also writes its app tokens (gupshup-auth), and its first start may take a minute or two (Gupshup's limit of
  // mints a minute), so it is given longer before it counts as unhealthy. A server with none keeps exactly the block it had.
  const gupshupRenewed = shops.some((s) => s.gupshupRenewed);
  add("refresher", node(["node", "/app/bundle/services/refresher.ts"], {
    environment: { CONFIG: "/etc/geometer/refresher.json", PORT: String(REFRESHER_PORT), HOST: "0.0.0.0" },
    volumes: [appVolume, `${dirs.generated}/refresher:/etc/geometer:ro`, `${secretDir("refresher")}:/run/secrets:ro`, "google-auth:/home/node", ...(gupshupRenewed ? [`${GUPSHUP_AUTH_VOLUME}:${REFRESHER_GUPSHUP_DIR}`] : [])],
    networks: { admin: {}, egress: {} }, healthcheck: { ...healthWget(REFRESHER_PORT, "/healthz"), start_period: gupshupRenewed ? "180s" : "30s" },
  }), [`${dirs.generated}/refresher/refresher.json`]);
  add("ops", node(["node", "/app/bundle/services/ops.ts", "run"], {
    environment: { CONFIG: "/etc/geometer/ops.json" },
    // ops writes only the fleet folder, as the user who runs the deployer (like the panel), so the deployer and the panel can read what it writes
    volumes: [appVolume, `${dirs.generated}/ops:/etc/geometer:ro`, `${secretDir("ops")}:/run/secrets:ro`, `${dirs.status}:${OPS_STATUS_DIR}:ro`, `${dirs.fleet}:${OPS_FLEET_DIR}`],
    ...(features.opsUser ? { user: features.opsUser } : {}),
    networks: { admin: {}, egress: {} },
  }), [`${dirs.generated}/ops/ops.json`]);
  if (server.panel.enabled && features.panel && features.panel.run !== false) {
    // The panel writes the desired state, the secrets inbox and stop requests; it reads the results and the exports; it keeps its own data. It sees NONE of the
    // server's other folders (not secrets/, not state/, not generated/), has no Docker socket, and its network holds only the Guards' agent ports, where it
    // presents its own agent (`panel-<shop>`: three reads and nothing else). Its keys are in secrets/panel/, 0600, readable by the user it runs as.
    add("panel", {
      image: server.appImage, user: features.panel.user, init: true, ...hardened, command: ["node", "/app/bundle/panel/main.ts"],
      environment: {
        PANEL_SERVER_DIR: "/server", PANEL_MODE: server.panel.mode, PANEL_HOST: "0.0.0.0", PANEL_PORT: String(PANEL_PORT), PANEL_PUBLIC_URL: publicUrl(server), PANEL_TRUST_PROXY: "1",
        PANEL_DATA_KEY_FILE: "/run/secrets/data_key", PANEL_SIGNING_KEY_FILE: "/run/secrets/signing_key", PANEL_TEMPLATES_DIR: "/app/templates", PANEL_PERSON_KEYS_DIR: "/run/secrets/person-keys",
        PANEL_GUARD_URL: `http://g-{shop}-{kind}:${GUARD_PORT}`, PANEL_GUARD_AGENT_TOKEN_FILE: `/run/secrets/${names.panelGuardToken}`, PANEL_WEBHOOK_URL: `${publicUrl(server)}/c/{shop}/webhooks/{kind}`,
        ...(features.panel.shareAddress ? { PANEL_CALENDAR_SHARE_ADDRESS: features.panel.shareAddress } : {}),
      },
      volumes: [appVolume, `${secretDir("panel")}:/run/secrets:ro`, `${dirs.shops}:/server/shops`, `${dirs.secretsInbox}:/server/secrets-inbox`, `${dirs.requests}:/server/requests`, `${dirs.status}:/server/status:ro`, `${dirs.fleet}:/server/fleet:ro`, `${dirs.exports}:/server/exports:ro`, `${dirs.panelData}:/server/panel`, `${dirs.config}:/server/geometer.json:ro`],
      networks: { front: {}, panel: {} },
      healthcheck: healthWget(PANEL_PORT, "/healthz"),
    });
  }
  // item 11f: the pages domain's front door, only where geometer.json names a pages domain and fleet is known (it asks fleet where each slug lives)
  const door = server.pages && server.fleet;
  if (door) {
    add("door", node(["node", "/app/bundle/services/door.ts"], {
      environment: { CONFIG: "/etc/geometer/door.json", PORT: String(DOOR_PORT), HOST: "0.0.0.0" },
      volumes: [appVolume, `${dirs.generated}/door:/etc/geometer:ro`],
      networks: { [PAGES_NETWORK]: {}, egress: {} }, healthcheck: healthWget(DOOR_PORT, "/healthz"),
    }), [`${dirs.generated}/door/door.json`]);
  }
  // -- the speech service (optional). It sits alone on `speech`, a network with no route out, and publishes no port: the speech Guard joins that network and is the only caller. It has no
  // secrets of its own (a shared token only when asked), no Docker socket, a read-only root, and its models folder is mounted read-only. Memory is capped because the Indic model holds
  // about 2.5 GB when loaded and a runaway request must not take the whole server's RAM.
  if (features.speech) {
    const sp = features.speech;
    add(SPEECH_SERVICE, {
      image: sp.image, restart: "unless-stopped", read_only: true, cap_drop: ["ALL"], security_opt: ["no-new-privileges:true"], tmpfs: ["/tmp:size=64m"], init: true,
      environment: { SPEECH_MODELS_DIR: "/models", SPEECH_PORT: String(SPEECH_PORT), ...(sp.tokenFile ? { SPEECH_TOKEN_FILE: "/run/secrets/speech_token", SPEECH_REQUIRE_TOKEN: "1" } : {}) },
      volumes: [`${sp.modelsDir}:/models:ro`, ...(sp.tokenFile ? [`${sp.tokenFile}:/run/secrets/speech_token:ro`] : [])],
      networks: { speech: {} }, mem_limit: "6g", pids_limit: 256,
      healthcheck: { test: ["CMD", "python", "-c", `import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:${SPEECH_PORT}/healthz', timeout=4).status == 200 else 1)`], interval: "30s", timeout: "5s", retries: 3, start_period: "120s" },
    }, sp.tokenFile ? [sp.tokenFile] : []);
  }
  add("caddy", {
    image: CADDY_IMAGE, restart: "unless-stopped", security_opt: ["no-new-privileges:true"],
    ports: [`${server.ports.http}:80`, `${server.ports.https}:443`],
    // each shop's reports folder, and only that folder of its data volume, read-only
    volumes: [`${dirs.generated}/Caddyfile:/etc/caddy/Caddyfile:ro`, "caddy-data:/data", "caddy-config:/config", ...shops.map((s): Y => ({ type: "volume", source: names.dataVolume(s.name), target: `${REPORTS_MOUNT}/${s.name}`, read_only: true, volume: { subpath: REPORTS_SUBPATH } }))],
    networks: { front: {}, ...(agents.length > 0 ? { [agentNames.gate]: {} } : {}), ...(door ? { [PAGES_NETWORK]: {} } : {}) },
    ...(shops.length > 0 ? { depends_on: Object.fromEntries(shops.map((s) => [names.reportsDir(s.name), { condition: "service_completed_successfully" }])) } : {}),
  }, [`${dirs.generated}/Caddyfile`]);

  // -- networks and volumes
  const networks: Record<string, Y> = {
    front: { ipam: { config: [{ subnet: net.subnets.front }] } },
    egress: { ipam: { config: [{ subnet: net.subnets.egress }] } },
    admin: { internal: true, ipam: { config: [{ subnet: net.subnets.admin }] } },
    ...(server.panel.enabled && features.panel ? { panel: { internal: true, ipam: { config: [{ subnet: net.subnets.panel }] } } } : {}),
    ...(agents.length > 0 ? { [agentNames.gate]: { internal: true, ipam: { config: [{ subnet: net.subnets.gate }] } } } : {}),
    ...(door ? { [PAGES_NETWORK]: { internal: true, ipam: { config: [{ subnet: net.subnets.pages }] } } } : {}),
    ...(features.speech ? { speech: { internal: true, ipam: { config: [{ subnet: net.subnets.speech }] } } } : {}),
  };
  for (const s of shops) networks[names.net(s.name)] = { internal: true, ipam: { config: [{ subnet: shopSubnet(server, s.index) }] } };
  const volumes: Record<string, Y> = { "google-auth": {}, [RELAY_STATE_VOLUME]: {}, "caddy-data": {}, "caddy-config": {}, [names.modelStateVolume]: {}, ...(shops.some((s) => s.gupshupRenewed) ? { [GUPSHUP_AUTH_VOLUME]: {} } : {}) };
  for (const s of shops) {
    volumes[names.dataVolume(s.name)] = {};
    for (const g of s.guards) volumes[names.stateVolume(s.name, g.kind as Exclude<GuardKind, "model">)] = {};
  }
  for (const a of agents) for (const g of a.guards) volumes[names.stateVolume(a.name, g.kind as Exclude<GuardKind, "model">)] = {};

  const body: Record<string, Y> = { name: `geometer-${server.id.replace(/_/gu, "-")}`, services: Object.fromEntries(Object.entries(services).map(([n, s]) => [n, s.block as Y])), networks, volumes };
  return {
    compose: `# Written by the Geometer deploy bundle on every deploy. Do not edit: change a shop's files and deploy again.\n${yaml(body)}\n`,
    caddyfile: caddyfile(server, agents, shops.map((s) => s.name)),
    services,
  };
}

/** Where the builder's agent calls a service instead of the service itself: https://<domain>/g/<agent>/<service> (the prefix is cut off before the Guard sees the path). */
export const agentBaseUrl = (server: ServerConfig, agent: string, kind: GuardKind): string => `${publicUrl(server)}/g/${agent}/${kind}`;

/** In Caddy's container: its file root, and where each shop's reports folder is mounted (/srv/r/<shop>), so the address /r/<shop>/<hex>/<file> is the path of the file. */
export const CADDY_FILE_ROOT = "/srv";
const REPORTS_MOUNT = `${CADDY_FILE_ROOT}${REPORTS_ROUTE}`;
/** The headers a report page is served with: private, not stored or indexed, and the same policy the panel gives the same pages (no script, nothing external, no frame). */
export const REPORT_HEADERS: readonly (readonly [string, string])[] = [
  ["Cache-Control", "private, no-store"], ["X-Content-Type-Options", "nosniff"], ["X-Robots-Tag", "noindex"], ["Referrer-Policy", "no-referrer"],
  ["Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"],
];

/**
 * The ONE address shape Caddy serves under /r: /r/<a shop of this server>/<32 hex digits>/<a plain file name ending .html, .json, .txt or .png>, which is what the
 * runtime writes and nothing else. The folder itself, the shop's folder, a name with a slash or `..` in it, a hidden file, any other extension and any other shop do not
 * match, and Caddy answers 404 for everything under /r that does not (reportsHandlers). The 32 digits are written out, not `{32}`, so no curly brace sits in a Caddyfile word.
 * `.png` (14 Nov 2026): a UPI shop's QR picture is written into the same folder under its own 32-digit name (modules/payments/owner-marked/qr-image.ts) and WhatsApp
 * fetches it by this address; without the extension here every QR picture was a 404 and the customer got the words alone.
 */
export function reportsMatcher(shops: readonly string[]): string {
  return `^${REPORTS_ROUTE}/(?:${shops.join("|")})/${"[0-9a-f]".repeat(32)}/[A-Za-z0-9][A-Za-z0-9._-]*\\.(?:html|json|txt|png)$`;
}

/**
 * Caddy's lines for /r. One `handle` takes the whole area. Inside it, a request that is exactly a report file is served from the shops' read-only mounts by `file_server`
 * (no `browse`, so a folder is never listed; a folder with no index file is a 404 even if one did match), and anything else in the area is a 404. The inner catch-all has no
 * matcher, which Caddy always evaluates last, so the order does not depend on Caddy's sorting of handles.
 */
function reportsHandlers(shops: readonly string[]): string[] {
  return [
    `\t# monthly report pages: only the exact file shape below is served, from each shop's reports folder (read-only); everything else under /r is a 404`,
    `\t@report-area path ${REPORTS_ROUTE} ${REPORTS_ROUTE}/*`,
    `\thandle @report-area {`,
    ...(shops.length > 0 ? [
      `\t\t@report-file path_regexp ${reportsMatcher(shops)}`,
      `\t\thandle @report-file {`, `\t\t\troot * ${CADDY_FILE_ROOT}`, `\t\t\theader {`, ...REPORT_HEADERS.map(([k, v]) => `\t\t\t\t${k} "${v}"`), `\t\t\t}`, `\t\t\tfile_server`, `\t\t}`,
    ] : []),
    `\t\thandle {`, `\t\t\trespond 404`, `\t\t}`,
    `\t}`,
  ];
}

/** Caddy: HTTPS for the builder's domain (a local certificate for localhost), and only a few places behind it: the inbox, the shops' report pages, a Guard of an agent someone else wrote, and the panel. */
export function caddyfile(server: ServerConfig, agents: AgentDeploy[] = [], shops: readonly string[] = []): string {
  const local = isLocalDomain(server.domain);
  return [
    `# Written by the Geometer deploy bundle. Caddy reaches the inbox, the relay and the panel (the only containers on its network), and serves each shop's report pages from a read-only folder.`,
    `{`, `\tadmin off`, ...(local ? [`\tauto_https disable_redirects`] : []), `}`, ``,
    `${local ? "https://" : ""}${server.domain} {`,
    ...(local ? [`\ttls internal`] : []),
    `\thandle /c/* {`, `\t\treverse_proxy inbox:${INBOX_PORT}`, `\t}`,
    // item 11d: each shop's public booking page, its API, its MCP endpoint and the owner's private page, served by the inbox process (modules/channels/front.ts)
    ...(shops.length > 0 ? [`\thandle /s/* {`, `\t\treverse_proxy inbox:${INBOX_PORT}`, `\t}`] : []),
    ...reportsHandlers([...shops].sort()),
    // an agent someone else wrote calls Guard here, not the service: each of its Guards has its own path, and only that Guard's agent port is behind it
    ...agents.flatMap((a) => a.guards.flatMap((g) => [`\thandle_path /g/${a.name}/${g.kind}/* {`, `\t\treverse_proxy ${g.service}:${GUARD_PORT}`, `\t}`])),
    // everything else is the panel's, when there is one: it serves from the root of its own address
    ...(server.panel.enabled ? [`\thandle {`, `\t\treverse_proxy panel:${PANEL_PORT}`, `\t}`] : [`\thandle {`, `\t\trespond "Geometer" 404`, `\t}`]), `}`, ``,
    // item 11f: the pages domain and its extra domains, a site of their own that reaches ONLY the front door: no /c, /s, /r, /g or panel there
    ...(server.pages && server.fleet ? [`${[server.pages.domain, ...server.pages.extraDomains].join(", ")} {`, `\treverse_proxy door:${DOOR_PORT}`, `}`, ``] : []),
  ].join("\n");
}

