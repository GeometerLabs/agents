// The server's one inbox. Webhooks arrive at /c/<shop>/webhooks/..., are checked with THAT shop's own secrets, and are forwarded only to THAT shop's
// runtime. It is the inbox every template shares (modules/inbox/server.ts), one instance per shop, behind a router: the checks are not rewritten.
//
//   CONFIG=/etc/geometer/inbox.json PORT=8788 HOST=0.0.0.0 node bundle/services/inbox.ts
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { inboxHandler } from "../../modules/inbox/server.ts";
import type { InboxConfig } from "../../modules/inbox/server.ts";
import { agentInboxHandler } from "../agent/inbox.ts";
import { createRouter } from "../lib/router.ts";
import type { Handler } from "../lib/router.ts";

export interface InboxShopConfig {
  /** An agent someone else wrote has no runtime: its WhatsApp webhooks are checked here, the owner's replies kept, and the rest passed on to `forwardTo` (agent/inbox.ts). */
  kind?: "own-agent";
  forwardTo?: string;
  runtimeUrl?: string;
  /** Left out for a shop with no approvals relay (a UPI shop, B33). */
  relayUrl?: string;
  ownerWhatsapp: string;
  /** B37: the shop's other approvers' numbers, whose replies go to the relay too. */
  approverWhatsapps?: string[];
  phoneNumberId: string;
  /** Item 11b, a Gupshup shop: its Gupshup app id. A callback that names another app (gs_app_id) is not forwarded. */
  gupshupAppId?: string;
  verification: "meta-signature" | "path-token";
  /** B29: the shop has voice on, so a voice note carries where its audio is (modules/messaging/webhooks.ts mediaOf). The bundle writes it only when it places the speech Guards (generate/speech.ts). */
  voiceMedia?: boolean;
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
    // Several shops can share one Meta app, and so one app secret: a valid signature does not say whose message it is, the phone number does. A Gupshup shop's callbacks
    // name its Gupshup app, which is checked instead (item 11b): the app id is what its Guard allows, and Meta's number id is not something Gupshup shows a partner plainly.
    ...(c.gupshupAppId ? { whatsappAppId: c.gupshupAppId } : { whatsappPhoneNumberId: c.phoneNumberId }),
    ...(c.voiceMedia ? { voiceMedia: true } : {}),
    // a shop with no approvals relay (a UPI shop, B33) sends its owner's messages to the runtime only; B37: the other approvers' replies go to the relay too
    ...(c.relayUrl ? { relayUrl: c.relayUrl, relayToken: need("relay_token"), ownerWhatsapp: c.ownerWhatsapp, ...(c.approverWhatsapps && c.approverWhatsapps.length > 0 ? { approverWhatsapps: c.approverWhatsapps } : {}) } : {}),
    log: (line) => log(`[${name}] ${line}`),
  };
  return inboxHandler(config);
}

// Wires the config into the router: one handler per shop, each with its own secrets, so a webhook can only ever reach the shop whose secret it matched.
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
