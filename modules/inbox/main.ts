// The inbox as its own process:
//
//   RUNTIME_URL=http://runtime:8787 INTERNAL_TOKEN_FILE=/run/secrets/internal_token \
//   RAZORPAY_WEBHOOK_SECRET_FILE=/run/secrets/razorpay_webhook WHATSAPP_APP_SECRET_FILE=/run/secrets/whatsapp_app_secret \
//   WHATSAPP_VERIFY_TOKEN_FILE=/run/secrets/whatsapp_verify PORT=8788 node templates/<domain>/<template>/inbox/main.ts   (or node modules/inbox/main.ts: it is the same program)
//
// WhatsApp webhooks are verified one of two ways, chosen by WHATSAPP_VERIFICATION (default meta-signature):
//   meta-signature  Meta's X-Hub-Signature-256. Needs WHATSAPP_APP_SECRET_FILE and WHATSAPP_VERIFY_TOKEN_FILE. Callback: POST /webhooks/whatsapp
//   path-token      for a provider that does not sign (Gupshup). Needs WHATSAPP_PATH_TOKEN_FILE (16+ characters of A-Z a-z 0-9 _ -).
//                   Callback: POST /webhooks/whatsapp/<token>; a wrong or missing token is 404. WEAKER than a signature: see Explanation.md.
//                   With Gupshup, set WHATSAPP_APP_ID to the shop's Gupshup app id: a callback that names another app (gs_app_id) is not forwarded. With Gupshup self-serve, set WHATSAPP_APP_NAME to the app's name: a callback whose `app` differs is not forwarded.
// Either way, WHATSAPP_ALLOWED_SOURCES (comma-separated IPs or CIDRs) refuses every other source, and WHATSAPP_SOURCE_IP_HEADER (for example
// x-forwarded-for) says which header your reverse proxy sets with the real address (the last one in it is used).
//
// The owner's replies also go to the approvals relay (modules/approvals/, with the template's own words), straight from here and never through the runtime:
//   OWNER_WHATSAPP=+919800000001 RELAY_URL=http://relay:8795 RELAY_TOKEN_FILE=/run/secrets/relay_token   (all three, or none)
// The relay's token is its own, not the runtime's: the inbox is the only thing that holds both.
//
// Secrets are read from files (never from arguments, which show up in process lists), and a trailing newline is dropped. PORT defaults to
// 8788. HOST defaults to 127.0.0.1; set HOST=0.0.0.0 inside a container. Put the HTTPS entry in front of it.
import { readFileSync } from "node:fs";
import { startInbox } from "./server.ts";

function needEnv(name: string): string {
  const v = process.env[name];
  if (!v) { console.error(`The inbox needs ${name}. See the top of modules/inbox/main.ts.`); process.exit(2); }
  return v;
}
/** A secret from a file, without its trailing newline. Only the file's name is ever mentioned in an error. */
function secretFrom(envName: string): string {
  const path = needEnv(envName);
  let text: string;
  try { text = readFileSync(path, "utf8").trim(); } catch (e) { console.error(`The inbox could not read the file named by ${envName} (${path}): ${(e as NodeJS.ErrnoException).code ?? "unreadable"}.`); process.exit(2); }
  if (text.length === 0) { console.error(`The file named by ${envName} (${path}) is empty.`); process.exit(2); }
  return text;
}

const runtimeUrl = needEnv("RUNTIME_URL");
try { new URL(runtimeUrl); } catch { console.error("RUNTIME_URL is not a web address."); process.exit(2); }
const port = Number(process.env.PORT ?? 8788);
if (!Number.isInteger(port) || port < 0 || port > 65535) { console.error("PORT must be a whole number between 0 and 65535."); process.exit(2); }

const verification = process.env.WHATSAPP_VERIFICATION ?? "meta-signature";
if (verification !== "meta-signature" && verification !== "path-token") { console.error('WHATSAPP_VERIFICATION must be "meta-signature" (the default) or "path-token".'); process.exit(2); }
if (verification === "meta-signature" && !process.env.WHATSAPP_APP_SECRET_FILE) {
  console.error("WhatsApp is not configured. Set WHATSAPP_APP_SECRET_FILE and WHATSAPP_VERIFY_TOKEN_FILE (meta-signature, the default), or WHATSAPP_VERIFICATION=path-token with WHATSAPP_PATH_TOKEN_FILE.");
  process.exit(2);
}
const relayUrl = process.env.RELAY_URL;
if (relayUrl) { try { new URL(relayUrl); } catch { console.error("RELAY_URL is not a web address."); process.exit(2); } }
if (Boolean(relayUrl) !== Boolean(process.env.OWNER_WHATSAPP) || Boolean(relayUrl) !== Boolean(process.env.RELAY_TOKEN_FILE)) {
  console.error("The approvals relay needs RELAY_URL, RELAY_TOKEN_FILE and OWNER_WHATSAPP together, or none of them.");
  process.exit(2);
}
const sources = (process.env.WHATSAPP_ALLOWED_SOURCES ?? "").split(",").map((x) => x.trim()).filter((x) => x.length > 0);

let inbox;
try {
  inbox = await startInbox({
    runtimeUrl,
    internalToken: secretFrom("INTERNAL_TOKEN_FILE"),
    razorpayWebhookSecret: secretFrom("RAZORPAY_WEBHOOK_SECRET_FILE"),
    whatsappVerification: verification,
    ...(verification === "meta-signature"
      ? { whatsappAppSecret: secretFrom("WHATSAPP_APP_SECRET_FILE"), whatsappVerifyToken: secretFrom("WHATSAPP_VERIFY_TOKEN_FILE") }
      : { whatsappPathToken: secretFrom("WHATSAPP_PATH_TOKEN_FILE") }),
    whatsappAllowedSources: sources,
    ...(relayUrl ? { relayUrl, relayToken: secretFrom("RELAY_TOKEN_FILE"), ownerWhatsapp: process.env.OWNER_WHATSAPP } : {}),
    ...(process.env.WHATSAPP_SOURCE_IP_HEADER ? { sourceIpHeader: process.env.WHATSAPP_SOURCE_IP_HEADER } : {}),
    ...(process.env.WHATSAPP_APP_NAME ? { whatsappAppName: process.env.WHATSAPP_APP_NAME } : {}),
    ...(process.env.WHATSAPP_APP_ID ? { whatsappAppId: process.env.WHATSAPP_APP_ID } : {}),
  }, { port, host: process.env.HOST ?? "127.0.0.1" });
} catch (e) { console.error((e as Error).message); process.exit(2); }
console.error(`Inbox listening on ${process.env.HOST ?? "127.0.0.1"}:${inbox.port}. Forwarding to ${new URL(runtimeUrl).origin}. WhatsApp: ${verification}${sources.length > 0 ? `, sources limited to ${sources.length} address range(s)` : ""}${relayUrl ? `, the owner's messages also go to the approvals relay at ${new URL(relayUrl).origin}` : ""}. POST /webhooks/razorpay and /webhooks/whatsapp${verification === "path-token" ? "/<token>" : ""}.`);
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { void inbox.close().then(() => process.exit(0)); });
