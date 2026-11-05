// The server's one approvals relay: the pathway's own relay (pathways/bookings/approvals/), one instance per shop, each with that shop's owner, that
// shop's Guard and its own state folder, behind /c/<shop>. Each owner's approver secret is in its own file and only that shop's relay reads it.
//
//   CONFIG=/etc/geometer/relay.json PORT=8795 HOST=0.0.0.0 node bundle/services/relay.ts
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createGuardClient, createRuntimeClient } from "../../modules/approvals/clients.ts";
import type { GuardClient } from "../../modules/approvals/clients.ts";
import { createRelay as bookingsRelay } from "../../pathways/bookings/approvals/relay.ts";
import { createRelay as feesRelay } from "../../pathways/fees/approvals/relay.ts";
import type { Relay, RelayOptions } from "../../modules/approvals/relay.ts";
import { relayHandler } from "../../modules/approvals/server.ts";
import { openRelayStore } from "../../modules/approvals/store.ts";
import { createWhatsAppMessaging } from "../../modules/messaging/whatsapp.ts";
import { systemClock } from "../../modules/core/clock.ts";
import { ownAgentRuntime } from "../agent/relay-context.ts";
import { createRouter } from "../lib/router.ts";
import type { Handler } from "../lib/router.ts";

/** The words each template's relay asks the owner in. An agent someone else wrote has none of its own, and is asked in Bookings' words. */
const RELAYS: Record<string, (options: Omit<RelayOptions, "voice">) => Relay> = { bookings: bookingsRelay, fees: feesRelay };

export interface RelayShopConfig {
  /** Which template's words the owner is asked in ("bookings" when left out). */
  pathway?: string;
  /** An agent someone else wrote has no runtime: the context of a held refund is Razorpay's record of the payment (agent/relay-context.ts). */
  kind?: "own-agent";
  guardAdminUrl: string;
  approverId: string;
  agentId: string;
  runtimeUrl?: string;
  razorpayGuardUrl?: string;
  business?: { name: string; timeZone: string; ownerLanguage: "en" | "hi" | "ml" | "kn" };
  whatsappGuardUrl: string;
  ownerWhatsapp: string;
  phoneNumberId: string;
  /** Folder with internal_token, relay_token, owner_notify_secret, read_token and agent_whatsapp for this shop. */
  secretsDir: string;
  stateDir: string;
}

/**
 * A Guard client that reads the approver credential from its file on every call. The credential Guard issues expires (the production profile requires
 * it), and the deployer writes a fresh one to the file before that: the relay never holds an admin token and never has to restart.
 */
export function rereadingGuardClient(c: RelayShopConfig, read: (path: string) => string | undefined): GuardClient {
  const make = () => createGuardClient({ adminUrl: c.guardAdminUrl, readToken: read(`${c.secretsDir}/read_token`) ?? "", approverId: c.approverId, approverSecret: read(`${c.secretsDir}/owner_notify_secret`) ?? "", now: () => Date.now() });
  return { reviews: () => make().reviews(), notify: (approval, decision) => make().notify(approval, decision) };
}

export function shopRelay(name: string, c: RelayShopConfig, read: (path: string) => string | undefined, log: (line: string) => void): { relay: Relay; handler: Handler; close(): void } {
  const need = (file: string): string => {
    const v = read(`${c.secretsDir}/${file}`);
    if (!v) throw new Error(`${name}: the secret file ${file} is missing or empty in ${c.secretsDir}.`);
    return v;
  };
  const store = openRelayStore(c.stateDir);
  const guard = rereadingGuardClient(c, read);
  const pathway = c.pathway ?? "bookings";
  if (!Object.hasOwn(RELAYS, pathway)) throw new Error(`${name}: the approvals relay has no words for the pathway "${pathway}".`);
  const relay = RELAYS[pathway]({
    clock: systemClock, store, ownerWhatsapp: c.ownerWhatsapp, expectedAgent: c.agentId, guard,
    runtime: c.kind === "own-agent"
      ? ownAgentRuntime({ guard, razorpay: { baseUrl: c.razorpayGuardUrl!, token: () => need("record_token") }, business: c.business! })
      : createRuntimeClient({ url: c.runtimeUrl!, token: need("internal_token") }),
    messaging: createWhatsAppMessaging({ baseUrl: c.whatsappGuardUrl, phoneNumberId: c.phoneNumberId, agentToken: need("agent_whatsapp") },
      { clock: systemClock, window: { lastInboundAt: (phone) => (phone.replace(/\D/gu, "") === c.ownerWhatsapp.replace(/\D/gu, "") ? Number(store.getMeta("owner_last_inbound")) || undefined : undefined) } }),
    log: (line) => log(`[${name}] ${line}`),
  });
  need("owner_notify_secret"); // the reading credential is issued by the deployer once the Guard is up (and renewed before it expires), so it may not exist yet
  return { relay, handler: relayHandler(relay, need("relay_token")), close: () => store.close() };
}

const readFile = (path: string): string | undefined => (existsSync(path) ? readFileSync(path, "utf8").trim() : undefined);

if (import.meta.main) {
  const config = JSON.parse(readFileSync(process.env.CONFIG ?? "/etc/geometer/relay.json", "utf8")) as { shops: Record<string, RelayShopConfig> };
  const log = (line: string) => console.error(line);
  const running: ReturnType<typeof shopRelay>[] = [];
  try { for (const [name, c] of Object.entries(config.shops)) running.push(shopRelay(name, c, readFile, log)); } catch (e) { console.error((e as Error).message); process.exit(2); }
  const handler = createRouter(Object.fromEntries(Object.keys(config.shops).map((name, i) => [name, running[i].handler])));
  const server = createServer(handler);
  server.requestTimeout = 10_000;
  server.headersTimeout = 5_000;
  for (const r of running) { r.relay.start(5_000); void r.relay.poll(); }
  server.listen(Number(process.env.PORT ?? 8795), process.env.HOST ?? "127.0.0.1", () => log(`Approvals relay for ${running.length} shop(s), reading each shop's Guard every 5 s. Each owner's approver secret is read by that shop's relay only.`));
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { server.closeAllConnections(); void Promise.all(running.map((r) => r.relay.stop())).then(() => { running.forEach((r) => r.close()); server.close(() => process.exit(0)); }); });
}
