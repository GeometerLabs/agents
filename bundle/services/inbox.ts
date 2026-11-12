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
import { frontHandler } from "../../modules/channels/front.ts";
import type { FrontShop } from "../../modules/channels/front.ts";
import { relayBackend, runtimeBackend } from "../../modules/channels/backend.ts";
import { PAGES_FILE, pagesReader } from "../../modules/channels/pages-file.ts";

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
  /** A folder with this shop's secrets: internal_token, relay_token, razorpay_webhook_secret, whatsapp_app_secret + whatsapp_verify_token or whatsapp_path_token (item 11d: and channel_token). */
  secretsDir: string;
  /**
   * Item 11d: the shop's public booking page, API, MCP endpoint and owner page, served by this process at its `publicUrl` (https://<server>/s/<shop>). The front talks to the
   * runtime with the shop's CHANNEL token only (never the internal token above, which this process also holds for the webhooks: the isolation is per token, not per
   * process; Explanation.md says what that means), and to the relay with the relay token, for a shop whose Guard holds refunds.
   */
  channel?: { publicUrl: string };
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

/**
 * Item 11d: the public front for every shop with a channel (modules/channels/front.ts), or undefined when none has one. Each shop's front reads its own channel_token.
 * A missing one costs that shop its page, said once in the log, and never the inbox: every shop's webhooks go on (a shop deployed before item 11d has none until its next deploy).
 */
export function loadFront(config: { shops: Record<string, InboxShopConfig> }, read: (path: string) => string | undefined, log: (line: string) => void): Handler | undefined {
  const shops: Record<string, FrontShop> = {};
  for (const [name, c] of Object.entries(config.shops)) {
    if (!c.channel || !c.runtimeUrl) continue;
    const token = read(`${c.secretsDir}/channel_token`);
    if (!token) { log(`${name}: no channel_token in ${c.secretsDir}, so its booking page is off until its next deploy.`); continue; }
    const relayToken = c.relayUrl ? read(`${c.secretsDir}/relay_token`) : undefined;
    // item 11f: the shop's page addresses (its slug on the pages domain, the stable page address, the WhatsApp number), written by the deployer beside its
    // secrets (lib/pages.ts) and read on every request, so a new slug takes effect without a restart
    shops[name] = { publicUrl: c.channel.publicUrl, backend: runtimeBackend({ url: c.runtimeUrl, token }), ...(c.relayUrl && relayToken ? { relay: relayBackend({ url: c.relayUrl, token: relayToken }) } : {}), pages: pagesReader(`${c.secretsDir}/${PAGES_FILE}`) };
  }
  if (Object.keys(shops).length === 0) return undefined;
  // behind Caddy: the visitor's address is the last X-Forwarded-For entry Caddy adds
  return frontHandler({ shops, sourceIpHeader: "x-forwarded-for", log: (line) => log(`[front] ${line}`) });
}

const readFile = (path: string): string | undefined => (existsSync(path) ? readFileSync(path, "utf8").trim() : undefined);

if (import.meta.main) {
  const config = JSON.parse(readFileSync(process.env.CONFIG ?? "/etc/geometer/inbox.json", "utf8")) as { shops: Record<string, InboxShopConfig> };
  let handler: Handler;
  let front: Handler | undefined;
  try { handler = loadRouter(config, readFile, (line) => console.error(line)); front = loadFront(config, readFile, (line) => console.error(line)); } catch (e) { console.error((e as Error).message); process.exit(2); }
  // /s/<shop>/... is the shops' public front (item 11d); everything else is the webhooks' router, as before
  const server = createServer((req, res) => (front && (req.url ?? "").startsWith("/s/") ? front(req, res) : handler(req, res)));
  server.requestTimeout = 10_000;
  server.headersTimeout = 5_000;
  server.listen(Number(process.env.PORT ?? 8788), process.env.HOST ?? "127.0.0.1", () => console.error(`Inbox listening for ${Object.keys(config.shops).length} shop(s) at /c/<shop>/webhooks/...`));
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { server.closeAllConnections(); server.close(() => process.exit(0)); });
}
