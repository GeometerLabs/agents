// The approvals relay as its own process (never the runtime, and never in the runtime's network namespace), the same for every template. A template's approvals/main.ts is
// three lines: it gives this its own `createRelay` (the shared relay with the template's words).
//
//   GUARD_URL=http://127.0.0.1:8082                     Guard's admin port in front of Razorpay (reached from a sidecar that shares Guard's network)
//   GUARD_READ_TOKEN_FILE=/run/secrets/relay_read       an approver credential Guard issued (POST /admin/approvers); it reads the held calls
//   OWNER_NOTIFY_SECRET_FILE=/run/secrets/owner_notify  the owner's approver secret: the same file Guard reads as notify_secrets
//   GUARD_APPROVER_ID=owner-glow-salon                  the owner's id in Guard's approver directory
//   GUARD_AGENT_ID=runtime-glow-salon                   (optional) only holds made by this agent are asked about
//   RUNTIME_URL=http://runtime:8780  INTERNAL_TOKEN_FILE=/run/secrets/internal_token     the runtime: context in, the owner's decision out
//   OWNER_WHATSAPP=+919800000001                        the owner: the only number whose replies count
//   WHATSAPP_GUARD_URL=http://whatsapp-guard:8080  PHONE_NUMBER_ID=...  [WHATSAPP_GUARD_TOKEN_FILE=...]   the relay's OWN way out to WhatsApp
//   RELAY_TOKEN_FILE=/run/secrets/relay_token           the token the inbox must send (not the runtime's)
//   STATE_DIR=/var/lib/approvals                        where the relay keeps what it must not forget
//   PORT=8795  HOST=127.0.0.1  POLL_SECONDS=5
//
// Run:  node pathways/<template>/approvals/main.ts
// Secrets are files, never arguments or variables; a trailing newline is dropped. Nothing secret, no code and no phone number is ever logged.
import { readFileSync } from "node:fs";
import { createWhatsAppMessaging } from "../messaging/whatsapp.ts";
import { systemClock } from "../core/clock.ts";
import { createGuardClient, createRuntimeClient } from "./clients.ts";
import { startRelayServer } from "./server.ts";
import { openRelayStore } from "./store.ts";
import type { Relay, RelayOptions } from "./relay.ts";

/** `createRelay`: the template's relay, the shared one with its words (Bookings: pathways/bookings/approvals/relay.ts; Fees: pathways/fees/approvals/relay.ts). */
export async function runRelayMain(createRelay: (options: Omit<RelayOptions, "voice">) => Relay): Promise<void> {
  const need = (name: string): string => { const v = process.env[name]; if (!v) { console.error(`The approvals relay needs ${name}. See the top of modules/approvals/main.ts.`); process.exit(2); } return v; };
  function secret(envName: string, optional = false): string | undefined {
    const path = optional ? process.env[envName] : need(envName);
    if (!path) return undefined;
    let text: string;
    try { text = readFileSync(path, "utf8").trim(); } catch (e) { console.error(`The relay could not read the file named by ${envName} (${path}): ${(e as NodeJS.ErrnoException).code ?? "unreadable"}.`); process.exit(2); }
    if (text.length === 0) { console.error(`The file named by ${envName} (${path}) is empty.`); process.exit(2); }
    return text;
  }
  const url = (name: string): string => { const v = need(name); try { new URL(v); } catch { console.error(`${name} is not a web address.`); process.exit(2); } return v; };
  const pollSeconds = Number(process.env.POLL_SECONDS ?? 5);
  const port = Number(process.env.PORT ?? 8795);
  if (!(pollSeconds >= 1) || !Number.isInteger(port) || port < 0 || port > 65535) { console.error("POLL_SECONDS must be 1 or more, and PORT a port number."); process.exit(2); }

  const clock = systemClock;
  const store = openRelayStore(need("STATE_DIR"));
  const ownerWhatsapp = need("OWNER_WHATSAPP");
  const relayToken = secret("RELAY_TOKEN_FILE")!;
  if (relayToken.length < 16) { console.error("The relay token is too short to be safe. Make one with: openssl rand -hex 32"); process.exit(2); }

  const relay = createRelay({
    clock, store, ownerWhatsapp,
    guard: createGuardClient({ adminUrl: url("GUARD_URL"), readToken: secret("GUARD_READ_TOKEN_FILE")!, approverId: need("GUARD_APPROVER_ID"), approverSecret: secret("OWNER_NOTIFY_SECRET_FILE")!, now: () => clock.now() }),
    runtime: createRuntimeClient({ url: url("RUNTIME_URL"), token: secret("INTERNAL_TOKEN_FILE")! }),
    messaging: createWhatsAppMessaging({ baseUrl: url("WHATSAPP_GUARD_URL"), phoneNumberId: need("PHONE_NUMBER_ID"), agentToken: secret("WHATSAPP_GUARD_TOKEN_FILE", true) },
      { clock, window: { lastInboundAt: (phone) => (phone.replace(/\D/gu, "") === ownerWhatsapp.replace(/\D/gu, "") ? Number(store.getMeta("owner_last_inbound")) || undefined : undefined) } }),
    ...(process.env.GUARD_AGENT_ID ? { expectedAgent: process.env.GUARD_AGENT_ID } : {}),
    log: (line) => console.error(line),
  });

  let server;
  try { server = await startRelayServer(relay, { token: relayToken, host: process.env.HOST ?? "127.0.0.1", port }); } catch (e) { console.error((e as Error).message); process.exit(2); }
  relay.start(pollSeconds * 1000);
  void relay.poll();
  console.error(`Approvals relay listening on ${process.env.HOST ?? "127.0.0.1"}:${server.port}, reading Guard every ${pollSeconds} s. It holds the owner's approver secret; the runtime does not.`);
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { void relay.stop().then(() => server.close()).then(() => { store.close(); process.exit(0); }); });
}
