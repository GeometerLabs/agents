// The inbox as its own process:
//
//   RUNTIME_URL=http://runtime:8787 INTERNAL_TOKEN_FILE=/run/secrets/internal_token \
//   RAZORPAY_WEBHOOK_SECRET_FILE=/run/secrets/razorpay_webhook WHATSAPP_APP_SECRET_FILE=/run/secrets/whatsapp_app_secret \
//   WHATSAPP_VERIFY_TOKEN_FILE=/run/secrets/whatsapp_verify PORT=8788 node pathways/bookings/inbox/main.ts
//
// Secrets are read from files (never from arguments, which show up in process lists), and a trailing newline is dropped. PORT defaults to
// 8788. HOST defaults to 127.0.0.1; set HOST=0.0.0.0 inside a container. Put the HTTPS entry in front of it.
import { readFileSync } from "node:fs";
import { startInbox } from "./server.ts";

function needEnv(name: string): string {
  const v = process.env[name];
  if (!v) { console.error(`The inbox needs ${name}. See the top of pathways/bookings/inbox/main.ts.`); process.exit(2); }
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

const inbox = await startInbox({
  runtimeUrl,
  internalToken: secretFrom("INTERNAL_TOKEN_FILE"),
  razorpayWebhookSecret: secretFrom("RAZORPAY_WEBHOOK_SECRET_FILE"),
  whatsappAppSecret: secretFrom("WHATSAPP_APP_SECRET_FILE"),
  whatsappVerifyToken: secretFrom("WHATSAPP_VERIFY_TOKEN_FILE"),
}, { port, host: process.env.HOST ?? "127.0.0.1" });
console.error(`Inbox listening on ${process.env.HOST ?? "127.0.0.1"}:${inbox.port}. Forwarding to ${new URL(runtimeUrl).origin}. POST /webhooks/razorpay and /webhooks/whatsapp, GET /webhooks/whatsapp for Meta's check.`);
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { void inbox.close().then(() => process.exit(0)); });
