// The server's one approvals relay: the pathway's own relay (templates/commerce/bookings/approvals/), one instance per shop, each with that shop's owner, that
// shop's Guard and its own state folder, behind /c/<shop>. Each owner's approver secret is in its own file and only that shop's relay reads it.
//
// An agent someone else wrote has an entry too (kind "own-agent"), with what its way of taking money needs (B71):
//   - a gateway with a module: the relay asks the owner about a refund its Guard holds, with the payment read from the gateway's own record (agent/relay-context.ts);
//   - its own API (B71 part 2): the relay asks the owner about a call its reviewed spec holds, in words that say only what Guard holds (modules/approvals/own-api-voice.ts);
//   - a module the owner marks (UPI, B71 part 2): no relay; the owner-marked desk (services/desk.ts), which takes the owner's replies here and serves the agent's
//     desk Guard on a port of its own (DESK_PORT), never this one.
//
//   CONFIG=/etc/geometer/relay.json PORT=8795 HOST=0.0.0.0 [DESK_PORT=8796] node bundle/services/relay.ts
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { createGuardClient, createRuntimeClient } from "../../modules/approvals/clients.ts";
import type { GuardClient } from "../../modules/approvals/clients.ts";
import { createRelay as bookingsRelay } from "../../templates/commerce/bookings/approvals/relay.ts";
import { createRelay as feesRelay } from "../../templates/education/fees/approvals/relay.ts";
import { createRelay as ordersRelay } from "../../templates/commerce/orders/approvals/relay.ts";
import { createRelay as sharedRelay, lastInboundKey } from "../../modules/approvals/relay.ts";
import type { Relay, RelayOptions, RelayPerson } from "../../modules/approvals/relay.ts";
import { readHeldCall } from "../../modules/approvals/held-call.ts";
import type { HeldCallSpec } from "../../modules/approvals/held-call.ts";
import { ownApiVoice } from "../../modules/approvals/own-api-voice.ts";
import { names } from "../generate/shop.ts";
import { relayHandler } from "../../modules/approvals/server.ts";
import { ownerSessionChecker } from "../../modules/channels/owner-access.ts";
import { openRelayStore } from "../../modules/approvals/store.ts";
import { createLiveMessaging } from "../../modules/messaging/providers.ts";
import { systemClock } from "../../modules/core/clock.ts";
import type { Clock } from "../../modules/core/clock.ts";
import { ownAgentRuntime, ownApiRuntime } from "../agent/relay-context.ts";
import { createDeskHost, deskServer } from "./desk.ts";
import type { DeskConfig, DeskHost } from "./desk.ts";
import { createRouter } from "../lib/router.ts";
import { OWNER_LINK_FILE, readOwnerLink } from "../../modules/channels/owner-link.ts";
import type { Handler } from "../lib/router.ts";

/** The words each template's relay asks the owner in. An agent someone else wrote on a gateway has none of its own, and is asked in Bookings' words. */
const RELAYS: Record<string, (options: Omit<RelayOptions, "voice">) => Relay> = { bookings: bookingsRelay, fees: feesRelay, orders: ordersRelay };

export interface RelayShopConfig {
  /** Which template's words the owner is asked in ("bookings" when left out). */
  pathway?: string;
  /** An agent someone else wrote has no runtime: the context of a held call is read from Guard and the provider (agent/relay-context.ts). */
  kind?: "own-agent";
  /** The money Guard's admin port, where held calls are read. Left out for an agent whose money the owner marks: it has the desk and no relay. */
  guardAdminUrl?: string;
  approverId?: string;
  agentId: string;
  runtimeUrl?: string;
  /** An own agent on a gateway with a module: its id, and its Guard's agent port, where the reading agent reads a payment (who paid, and when). */
  gateway?: { id: string; guardUrl: string };
  /** An own agent on its own API (B71 part 2): the Guard's tool and the calls its reviewed spec holds for the owner. */
  ownApi?: HeldCallSpec;
  /** An own agent on a module the owner marks (UPI, B71 part 2): its desk. */
  desk?: DeskConfig;
  business?: { name: string; timeZone: string; ownerLanguage: "en" | "hi" | "ml" | "kn" };
  whatsappGuardUrl: string;
  ownerWhatsapp: string;
  phoneNumberId: string;
  /** Item 11b: the shop's WhatsApp Guard fronts Gupshup (with the shop's Gupshup app id). Left out: Meta direct. */
  provider?: "gupshup";
  appId?: string;
  /** Folder with internal_token, relay_token, owner_notify_secret, read_token and agent_whatsapp for this shop (B37: and approver_<id>_notify_secret for each other approver; B71: desk_token for a desk). */
  secretsDir: string;
  stateDir: string;
  /** B37: the shop's other approvers. `approverId` is then the owner's id among them ("owner"). Left out: the owner alone. */
  approvers?: RelayPerson[];
}

/**
 * A Guard client that reads the approver credential from its file on every call. The credential Guard issues expires (the production profile requires
 * it), and the deployer writes a fresh one to the file before that: the relay never holds an admin token and never has to restart.
 */
export function rereadingGuardClient(c: RelayShopConfig, read: (path: string) => string | undefined): GuardClient {
  const make = () => createGuardClient({
    adminUrl: c.guardAdminUrl ?? "", readToken: read(`${c.secretsDir}/read_token`) ?? "", approverId: c.approverId ?? "", approverSecret: read(`${c.secretsDir}/owner_notify_secret`) ?? "", now: () => Date.now(),
    ...(c.approvers && c.approvers.length > 0 ? { secretOf: (id: string) => (c.approvers!.some((p) => p.id === id) ? read(`${c.secretsDir}/${names.approverSecretFile(id)}`) : undefined) } : {}),
  });
  return { reviews: () => make().reviews(), notify: (approval, decision, approver) => make().notify(approval, decision, approver) };
}

/** One entry of relay.json, running: the approvals relay (a shop, or an own agent on a gateway or its own API), or the desk (an own agent on UPI), never both. */
export interface RunningShop { relay?: Relay; desk?: DeskHost; /** The desk's token, read from its file on every call. */ deskToken?: () => string | undefined; handler: Handler; close(): void }

// Builds one shop's relay (and its owner-marked desk when it has one) from that shop's own secrets. Throws at start if a secret file is missing, so a misconfigured shop fails at deploy and not on the first refund.
export function shopRelay(name: string, c: RelayShopConfig, read: (path: string) => string | undefined, log: (line: string) => void, clock: Clock = systemClock): RunningShop {
  const need = (file: string): string => {
    const v = read(`${c.secretsDir}/${file}`);
    if (!v) throw new Error(`${name}: the secret file ${file} is missing or empty in ${c.secretsDir}.`);
    return v;
  };
  // the relay and the desk speak the shop's own WhatsApp Guard, so they use its provider (item 11b: Gupshup, or Meta direct when left out)
  const whatsapp = (window: { lastInboundAt(phone: string): number | undefined }) => createLiveMessaging({ baseUrl: c.whatsappGuardUrl, phoneNumberId: c.phoneNumberId, ...(c.provider ? { provider: c.provider, appId: c.appId } : {}), agentToken: need("agent_whatsapp") }, { clock, window });

  // an own agent whose money the owner marks: the desk, and no relay (nothing is ever held for the owner: the owner sends every refund)
  if (c.desk) {
    if (c.kind !== "own-agent" || !c.business) throw new Error(`${name}: a desk is for an agent someone else wrote, with its business in relay.json.`);
    const desk = createDeskHost({ name, config: c.desk, ownerWhatsapp: c.ownerWhatsapp, business: c.business, file: join(c.stateDir, "desk.json"), messaging: whatsapp, clock, log });
    need("desk_token");
    return { desk, deskToken: () => read(`${c.secretsDir}/desk_token`), handler: relayHandler(desk, need("relay_token")), close: () => undefined };
  }

  if (!c.guardAdminUrl || !c.approverId) throw new Error(`${name}: relay.json names no Guard to read held calls from.`);
  const store = openRelayStore(c.stateDir);
  const guard = rereadingGuardClient(c, read);
  const messaging = whatsapp({ lastInboundAt: (phone) => Number(store.getMeta(lastInboundKey(phone, c.ownerWhatsapp))) || undefined });
  const common = {
    clock, store, ownerWhatsapp: c.ownerWhatsapp, expectedAgent: c.agentId, guard, messaging,
    ...(c.approvers && c.approvers.length > 0 ? { approvers: c.approvers, ownerApproverId: c.approverId } : {}),
    log: (line: string) => log(`[${name}] ${line}`),
  };
  let relay: Relay;
  if (c.kind === "own-agent" && c.ownApi) {
    // its own API: the calls its reviewed spec holds, in words that say only what Guard holds; after a yes the agent sends the identical call again
    const spec = c.ownApi;
    relay = sharedRelay({ ...common, voice: ownApiVoice, readHeld: (item) => readHeldCall(item, spec), runtime: ownApiRuntime({ guard, spec, business: c.business! }) });
  } else {
    const pathway = c.pathway ?? "bookings";
    if (!Object.hasOwn(RELAYS, pathway)) throw new Error(`${name}: the approvals relay has no words for the pathway "${pathway}".`);
    relay = RELAYS[pathway]({
      ...common,
      runtime: c.kind === "own-agent"
        ? ownAgentRuntime({ guard, gateway: { id: c.gateway!.id, baseUrl: c.gateway!.guardUrl, token: () => need("record_token") }, business: c.business! })
        : createRuntimeClient({ url: c.runtimeUrl!, token: need("internal_token") }),
    });
  }
  need("owner_notify_secret"); // the reading credential is issued by the deployer once the Guard is up (and renewed before it expires), so it may not exist yet
  for (const p of c.approvers ?? []) need(names.approverSecretFile(p.id));
  // item 11d: the owner's private page may show and answer this shop's asks, with the owner's link, checked against the deployer's copy of its hash (lib/owner-link.ts)
  const ownerLink = () => readOwnerLink(read(`${c.secretsDir}/${OWNER_LINK_FILE}`));
  // item 11f: an owner signed in on the shop's page answers with a session, which only the runtime can vouch for (with the internal token the relay already holds)
  const ownerSession = c.runtimeUrl && c.kind !== "own-agent" ? ownerSessionChecker({ url: c.runtimeUrl, token: need("internal_token") }) : undefined;
  return { relay, handler: relayHandler(relay, need("relay_token"), { ownerLink, ...(ownerSession ? { ownerSession } : {}) }), close: () => store.close() };
}

const readFile = (path: string): string | undefined => (existsSync(path) ? readFileSync(path, "utf8").trim() : undefined);

if (import.meta.main) {
  const config = JSON.parse(readFileSync(process.env.CONFIG ?? "/etc/geometer/relay.json", "utf8")) as { shops: Record<string, RelayShopConfig> };
  const log = (line: string) => console.error(line);
  const running: RunningShop[] = [];
  try { for (const [name, c] of Object.entries(config.shops)) running.push(shopRelay(name, c, readFile, log)); } catch (e) { console.error((e as Error).message); process.exit(2); }
  const handler = createRouter(Object.fromEntries(Object.keys(config.shops).map((name, i) => [name, running[i].handler])));
  const server = createServer(handler);
  server.requestTimeout = 10_000;
  server.headersTimeout = 5_000;
  const relays = running.flatMap((r) => (r.relay ? [r.relay] : []));
  for (const r of relays) { r.start(5_000); void r.poll(); }
  // the desks: their own port (the desk Guards are its only callers), and a tick a minute for the owner's reminders and any reply left unhandled
  const desks = running.flatMap((r) => (r.desk ? [{ host: r.desk, token: r.deskToken! }] : []));
  let deskServerRunning: ReturnType<typeof createServer> | undefined;
  if (desks.length > 0) {
    if (!process.env.DESK_PORT) { console.error("relay.json has an agent's desk, but DESK_PORT is not set: its Guard could not reach it."); process.exit(2); }
    deskServerRunning = createServer(deskServer(desks));
    deskServerRunning.requestTimeout = 10_000;
    deskServerRunning.headersTimeout = 5_000;
    deskServerRunning.listen(Number(process.env.DESK_PORT), process.env.HOST ?? "127.0.0.1", () => log(`Owner-marked desk for ${desks.length} agent(s) on port ${process.env.DESK_PORT}.`));
    const tick = setInterval(() => { for (const d of desks) void d.host.tick().catch((e) => log(`A desk tick failed: ${(e as Error).message}`)); }, 60_000);
    tick.unref();
    for (const d of desks) void d.host.tick().catch(() => undefined); // owner messages left unhandled by a restart are handled now
  }
  server.listen(Number(process.env.PORT ?? 8795), process.env.HOST ?? "127.0.0.1", () => log(`Approvals relay for ${relays.length} shop(s), reading each shop's Guard every 5 s. Each owner's approver secret is read by that shop's relay only.`));
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
    server.closeAllConnections(); deskServerRunning?.closeAllConnections();
    void Promise.all([...relays.map((r) => r.stop()), ...desks.map((d) => d.host.idle())]).then(() => { running.forEach((r) => r.close()); deskServerRunning?.close(); server.close(() => process.exit(0)); });
  });
}
