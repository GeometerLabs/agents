// The server's one approvals relay: the pathway's own relay (pathways/bookings/approvals/), one instance per shop, each with that shop's owner, that
// shop's Guard and its own state folder, behind /c/<shop>. Each owner's approver secret is in its own file and only that shop's relay reads it.
//
//   CONFIG=/etc/geometer/relay.json PORT=8795 HOST=0.0.0.0 node bundle/services/relay.ts
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createGuardClient, createRuntimeClient } from "../../pathways/bookings/approvals/clients.ts";
import type { GuardClient } from "../../pathways/bookings/approvals/clients.ts";
import { createRelay } from "../../pathways/bookings/approvals/relay.ts";
import type { Relay } from "../../pathways/bookings/approvals/relay.ts";
import { relayHandler } from "../../pathways/bookings/approvals/server.ts";
import { openRelayStore } from "../../pathways/bookings/approvals/store.ts";
import { createWhatsAppMessaging } from "../../pathways/bookings/src/adapters/live/whatsapp.ts";
import { systemClock } from "../../pathways/bookings/src/clock.ts";
import { createRouter } from "../lib/router.ts";
import type { Handler } from "../lib/router.ts";

export interface RelayShopConfig {
  guardAdminUrl: string;
  approverId: string;
  agentId: string;
  runtimeUrl: string;
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
  const relay = createRelay({
    clock: systemClock, store, ownerWhatsapp: c.ownerWhatsapp, expectedAgent: c.agentId,
    guard: rereadingGuardClient(c, read),
    runtime: createRuntimeClient({ url: c.runtimeUrl, token: need("internal_token") }),
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
