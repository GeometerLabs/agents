// The server's one inbox. Webhooks arrive at /c/<shop>/webhooks/..., are checked with THAT shop's own secrets, and are forwarded only to THAT shop's
// runtime. It is the pathway's own inbox (pathways/bookings/inbox/server.ts), one instance per shop, behind a router: the checks are not rewritten.
//
//   CONFIG=/etc/geometer/inbox.json PORT=8788 HOST=0.0.0.0 node bundle/services/inbox.ts
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { inboxHandler } from "../../pathways/bookings/inbox/server.ts";
import type { InboxConfig } from "../../pathways/bookings/inbox/server.ts";
import { agentInboxHandler } from "../agent/inbox.ts";
import { createRouter } from "../lib/router.ts";
import type { Handler } from "../lib/router.ts";

export interface InboxShopConfig {
  /** An agent someone else wrote has no runtime: its WhatsApp webhooks are checked here, the owner's replies kept, and the rest passed on to `forwardTo` (agent/inbox.ts). */
  kind?: "own-agent";
  forwardTo?: string;
  runtimeUrl?: string;
  relayUrl: string;
  ownerWhatsapp: string;
  phoneNumberId: string;
  verification: "meta-signature" | "path-token";
  /** A folder with this shop's secrets: internal_token, relay_token, razorpay_webhook_secret, whatsapp_app_secret + whatsapp_verify_token or whatsapp_path_token. */
  secretsDir: string;
}


/** One shop's inbox handler from its config and its secret files. A missing secret says which file, never what is in it. */
export function shopHandler(name: string, c: InboxShopConfig, read: (path: string) => string | undefined, log: (line: string) => void): Handler {
  const need = (file: string): string => {
    const v = read(`${c.secretsDir}/${file}`);
    if (!v) throw new Error(`${name}: the secret file ${file} is missing or empty in ${c.secretsDir}.`);
    return v;
  };
  if (c.kind === "own-agent") {
    return agentInboxHandler({
      ownerWhatsapp: c.ownerWhatsapp, phoneNumberId: c.phoneNumberId, verification: c.verification, relayUrl: c.relayUrl, relayToken: need("relay_token"), ...(c.forwardTo ? { forwardTo: c.forwardTo } : {}),
      ...(c.verification === "meta-signature" ? { appSecret: need("whatsapp_app_secret"), verifyToken: need("whatsapp_verify_token") } : { pathToken: need("whatsapp_path_token") }),
      log: (line) => log(`[${name}] ${line}`),
    });
  }
  const config: InboxConfig = {
    runtimeUrl: c.runtimeUrl!, internalToken: need("internal_token"), razorpayWebhookSecret: need("razorpay_webhook_secret"),
    whatsappVerification: c.verification,
    ...(c.verification === "meta-signature" ? { whatsappAppSecret: need("whatsapp_app_secret"), whatsappVerifyToken: need("whatsapp_verify_token") } : { whatsappPathToken: need("whatsapp_path_token") }),
    // Several shops can share one Meta app, and so one app secret: a valid signature does not say whose message it is, the phone number does.
    whatsappPhoneNumberId: c.phoneNumberId,
    relayUrl: c.relayUrl, relayToken: need("relay_token"), ownerWhatsapp: c.ownerWhatsapp,
    log: (line) => log(`[${name}] ${line}`),
  };
  return inboxHandler(config);
}

export function loadRouter(config: { shops: Record<string, InboxShopConfig> }, read: (path: string) => string | undefined, log: (line: string) => void): Handler {
  return createRouter(Object.fromEntries(Object.entries(config.shops).map(([name, c]) => [name, shopHandler(name, c, read, log)])), log);
}

const readFile = (path: string): string | undefined => (existsSync(path) ? readFileSync(path, "utf8").trim() : undefined);

if (import.meta.main) {
  const config = JSON.parse(readFileSync(process.env.CONFIG ?? "/etc/geometer/inbox.json", "utf8")) as { shops: Record<string, InboxShopConfig> };
  let handler: Handler;
  try { handler = loadRouter(config, readFile, (line) => console.error(line)); } catch (e) { console.error((e as Error).message); process.exit(2); }
  const server = createServer(handler);
  server.requestTimeout = 10_000;
  server.headersTimeout = 5_000;
  server.listen(Number(process.env.PORT ?? 8788), process.env.HOST ?? "127.0.0.1", () => console.error(`Inbox listening for ${Object.keys(config.shops).length} shop(s) at /c/<shop>/webhooks/...`));
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { server.closeAllConnections(); server.close(() => process.exit(0)); });
}
