// What the proof's Guards call instead of the internet, run in a container on the egress network (and on `front`, to hand webhooks to the inbox) by test/proof/run.ts.
//
//   8790  the template's Razorpay, WhatsApp and Calendar stand-ins, ONE SET PER SHOP, as each real shop has its own Razorpay account, WhatsApp number and calendar.
//         A call is given to its shop's set by the credential its Guard added (shops.ts, shopOfAuthorization), so booking b-1 of one shop never meets b-1 of another.
//         /_proof/<shop>/_standin/... reaches that shop's control routes (play the customer, pay a link, read the state); /_standin/... with no prefix is glow-salon's.
//         /_proof/totals counts every shop's calls, links, events, refunds and messages.
//   8791  a Google token endpoint (a token names the shop whose service account asked) and a model endpoint.
// Test money, practice messages, a made-up model.
import { createServer, request } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { startStandins } from "../../../templates/commerce/bookings/standins/server.ts";
import type { RunningStandins } from "../../../templates/commerce/bookings/standins/server.ts";
import { calendarOf, phoneOf, secretsOf, shopIndex, shopName, shopOfAuthorization } from "./shops.ts";

const sets = new Map<string, Promise<RunningStandins>>();
/** The shop's own stand-ins, made the first time the shop is called. Their webhooks go to the inbox under the shop's own path, as the shop's providers would send them. */
function setOf(shop: string): Promise<RunningStandins> | undefined {
  const i = shopIndex(shop);
  if (i === undefined) return undefined;
  let s = sets.get(shop);
  if (!s) {
    const secrets = secretsOf(i);
    s = startStandins({ inboxUrl: `http://inbox:8788/c/${shop}`, razorpayWebhookSecret: secrets.razorpay_webhook_secret, whatsappAppSecret: secrets.whatsapp_app_secret, phoneNumberId: phoneOf(i), calendarId: calendarOf(i), calendarAccessRole: "writer" }, { port: 9000 + i, host: "127.0.0.1" });
    sets.set(shop, s);
  }
  return s;
}

/** Pass the request on to the shop's own stand-ins as it came, and the answer back as it came (a cut connection stays a cut connection: a lost reply). */
function pass(req: IncomingMessage, res: ServerResponse, port: number, path: string): void {
  const up = request({ host: "127.0.0.1", port, method: req.method, path, headers: req.headers }, (answer) => {
    answer.on("error", () => res.destroy()); // the shop's stand-in cut the connection half way: so does this one
    res.writeHead(answer.statusCode ?? 502, answer.headers); answer.pipe(res);
  });
  up.on("error", () => req.socket.destroy());
  req.on("error", () => up.destroy());
  res.on("error", () => up.destroy());
  req.pipe(up);
}
// a stand-in that stops would make every later check fail for the proof's own reason, not the bundle's: an error is written down and the server goes on
process.on("uncaughtException", (e) => console.error(`stand-ins: ${e.stack ?? e}`));

const json = (res: ServerResponse, status: number, body: unknown) => { const t = JSON.stringify(body); res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(t) }); res.end(t); };

createServer(async (req, res) => {
  const url = req.url ?? "/";
  if (url === "/_proof/totals") {
    const shops: Record<string, unknown> = {};
    for (const [shop, s] of sets) {
      const f = (await s).fakes;
      shops[shop] = { links: f.payments.links().length, refunds: f.payments.refunds().length, events: f.calendar.events().length, messages: f.messaging.outbox().length, calls: { payments: f.payments.calls.length, calendar: f.calendar.calls.length } };
    }
    return json(res, 200, { shops });
  }
  const prefixed = /^\/_proof\/([a-z0-9-]+)(\/_standin\/.*)$/u.exec(url);
  const shop = prefixed ? prefixed[1] : url.startsWith("/_standin/") ? shopName(1) : shopOfAuthorization(req.headers.authorization);
  const set = shop ? setOf(shop) : undefined;
  if (!set) { req.resume(); return json(res, 404, { error: `the proof's stand-ins do not know which shop ${req.method} ${url} is for` }); }
  pass(req, res, (await set).port, prefixed ? prefixed[2] : url);
}).listen(8790, "0.0.0.0");

let tokens = 0; const modelCalls: string[] = [];
createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks).toString();
    if (req.url === "/oauth2/token") {
      // the shop is the one whose service account signed the assertion (its client_email is <shop>@proof.iam.gserviceaccount.com)
      let shop = "unknown";
      try { const claims = JSON.parse(Buffer.from(new URLSearchParams(body).get("assertion")!.split(".")[1], "base64url").toString()); shop = String(claims.iss).split("@")[0]; } catch { /* a malformed assertion still gets a token no shop's calls will match */ }
      return json(res, 200, { access_token: `ya29.proof-${shop}-${++tokens}-0123456789`, expires_in: 3599, token_type: "Bearer" });
    }
    if (req.url === "/v1/chat/completions") { modelCalls.push(String((JSON.parse(body || "{}") as { model?: string }).model)); return json(res, 200, { choices: [{ message: { content: "{}" } }] }); }
    if (req.url === "/_state") return json(res, 200, { tokens, modelCalls: modelCalls.length });
    json(res, 404, {});
  });
}).listen(8791, "0.0.0.0");
console.log("stand-ins on 8790 (one set per shop) and 8791");
