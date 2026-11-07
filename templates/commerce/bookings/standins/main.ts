// The stand-in services as their own process:
//
//   node templates/commerce/bookings/standins/main.ts [--port 8790] [--inbox http://127.0.0.1:8788] [--system-one]
//
// Razorpay, Google Calendar and WhatsApp wire formats over HTTP, in front of the in-memory fakes. Test money, practice messages, nothing real.
// With --system-one it also answers the System One decisions API (POST /v1/systemone) like Laya or Jev would, from the rule parser, so the three steps can be tried with no model.
// Point the live adapters' base URLs at it (the same code that talks to Guard). Control routes are under /_standin/ (see control.ts).
// The webhook secrets here are made-up stand-in secrets; give the same two to the inbox. Set them with STANDIN_RAZORPAY_WEBHOOK_SECRET and
// STANDIN_WHATSAPP_APP_SECRET, or use the defaults printed below. Listens on 127.0.0.1 only.
import { startStandins } from "./server.ts";

const args = process.argv.slice(2);
const option = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const v = args[i + 1];
  if (v === undefined || v.startsWith("--")) { console.error(`--${name} needs a value.`); process.exit(2); }
  return v;
};
for (const a of args.filter((x) => x.startsWith("--"))) if (!["--port", "--inbox", "--system-one", "--help"].includes(a)) { console.error(`I don't know ${a}. Use --port, --inbox or --system-one.`); process.exit(2); }
if (args.includes("--help")) { console.log("Usage: node templates/commerce/bookings/standins/main.ts [--port 8790] [--inbox http://127.0.0.1:8788] [--system-one]"); process.exit(0); }

const port = Number(option("port") ?? 8790);
if (!Number.isInteger(port) || port < 0 || port > 65535) { console.error("--port must be a whole number between 0 and 65535."); process.exit(2); }
const inboxUrl = option("inbox");
const razorpayWebhookSecret = process.env.STANDIN_RAZORPAY_WEBHOOK_SECRET ?? "standin-razorpay-webhook-secret";
const whatsappAppSecret = process.env.STANDIN_WHATSAPP_APP_SECRET ?? "standin-whatsapp-app-secret";

const standins = await startStandins({ inboxUrl, razorpayWebhookSecret, whatsappAppSecret, ...(args.includes("--system-one") ? { systemOne: true as const } : {}) }, { port });
console.log("Geometer · stand-in services for Bookings. Test money, practice messages, nothing real is contacted.");
console.log(`  Razorpay, Google Calendar and WhatsApp wire formats:  ${standins.url}`);
console.log(`  Control routes:                                       ${standins.url}/_standin/state`);
console.log(inboxUrl ? `  Signed webhooks go to:                                ${inboxUrl}` : "  No --inbox given, so customer messages and payments are not delivered anywhere.");
console.log("  Webhook secrets: made-up stand-in values (the README lists them), or STANDIN_RAZORPAY_WEBHOOK_SECRET and STANDIN_WHATSAPP_APP_SECRET if set. Give the same two to the inbox, as files.");
console.log("Press Ctrl+C to stop.");
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { void standins.close().then(() => process.exit(0)); });
