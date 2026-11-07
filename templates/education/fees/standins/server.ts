// The stand-ins for Fees: the Razorpay and WhatsApp wire formats over HTTP, in front of the existing in-memory fakes. One process, one port, two sets of paths that do not
// collide: /v1/... (Razorpay), /v26.0/{id}/messages (WhatsApp), and /_standin/... (control). There is no new state: createFakePayments and createFakeMessaging are the only
// source of it, so the tests of the fakes keep their meaning. Fees has no calendar, so there is no Google stand-in here.
//
// A fault the fake plans as "lost reply" makes the server cut the connection AFTER the fake stored the change, so the client sees no answer (and the live adapter raises
// TimeoutError), exactly the case the agent must look before it retries.
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { systemClock } from "../../../../modules/core/clock.ts";
import type { Clock } from "../../../../modules/core/clock.ts";
import { createFakeMessaging } from "../../../../modules/messaging/messaging.ts";
import { createFakePayments } from "../../../../modules/payments/payments.ts";
import { LostReply } from "../../../../modules/standins/http.ts";
import type { Handler, StandinReply } from "../../../../modules/standins/http.ts";
import { razorpayStandin } from "../../../../modules/standins/razorpay.ts";
import { approveTemplates, whatsappStandin } from "../../../../modules/standins/whatsapp.ts";
import { META_TEMPLATES } from "../src/language/meta-templates.ts";
import { REPORT_TEMPLATES } from "../report/whatsapp.ts";
import { controlStandin } from "./control.ts";
import type { Fakes } from "./control.ts";

export interface StandinsConfig {
  clock?: Clock;
  /** Where signed webhooks are delivered (the inbox), for example http://127.0.0.1:8788. */
  inboxUrl?: string;
  razorpayWebhookSecret: string;
  whatsappAppSecret: string;
  phoneNumberId?: string;
  /** What reading the WhatsApp number's own details shows (a connection check compares them with what the centre gave). */
  displayPhoneNumber?: string;
  verifiedName?: string;
  /** Use these fakes instead of new ones, so a test can read and change them directly. */
  fakes?: Partial<Fakes>;
}

export interface RunningStandins { server: Server; port: number; url: string; fakes: Fakes; close(): Promise<void> }

/** The templates the provider has approved: the fee messages and the owner's monthly report. */
const STANDIN_TEMPLATES = { templates: [...META_TEMPLATES, ...REPORT_TEMPLATES] };

const MAX_BODY = 1024 * 1024;

function readJson(req: IncomingMessage): Promise<{ ok: true; body: unknown } | { ok: false }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => { size += c.length; if (size > MAX_BODY) { resolve({ ok: false }); req.destroy(); } else chunks.push(c); });
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (text.length === 0) { resolve({ ok: true, body: undefined }); return; }
      try { resolve({ ok: true, body: JSON.parse(text) }); } catch { resolve({ ok: false }); }
    });
    req.on("error", () => resolve({ ok: false }));
  });
}

function send(res: ServerResponse, reply: StandinReply): void {
  if (reply.body === undefined) { res.writeHead(reply.status); res.end(); return; }
  const text = JSON.stringify(reply.body);
  res.writeHead(reply.status, { "content-type": "application/json; charset=UTF-8", "content-length": Buffer.byteLength(text) });
  res.end(text);
}

export async function startStandins(config: StandinsConfig, listen: { port: number; host?: string }): Promise<RunningStandins> {
  const clock = config.clock ?? systemClock;
  const fakes: Fakes = { payments: config.fakes?.payments ?? createFakePayments(clock), messaging: config.fakes?.messaging ?? createFakeMessaging(clock) };
  approveTemplates(fakes.messaging, STANDIN_TEMPLATES);
  let authorizationSeen = 0;
  const handlers: Handler[] = [
    razorpayStandin(fakes.payments),
    whatsappStandin(fakes.messaging, STANDIN_TEMPLATES, { phoneNumberId: config.phoneNumberId, displayPhoneNumber: config.displayPhoneNumber, verifiedName: config.verifiedName }),
    controlStandin({ fakes, inboxUrl: config.inboxUrl, razorpayWebhookSecret: config.razorpayWebhookSecret, whatsappAppSecret: config.whatsappAppSecret, phoneNumberId: config.phoneNumberId, authorizationSeen: () => authorizationSeen }),
  ];

  const server = createServer(async (req, res) => {
    if (req.headers.authorization !== undefined) authorizationSeen++;
    const url = new URL(req.url ?? "/", "http://standin");
    const parsed = await readJson(req);
    if (!parsed.ok) { send(res, { status: 400, body: { error: "the body is not JSON, or is too large" } }); return; }
    try {
      for (const handler of handlers) {
        const reply = await handler({ method: req.method ?? "GET", path: url.pathname, query: url.searchParams, body: parsed.body, headers: req.headers });
        if (reply) { send(res, reply); return; }
      }
      send(res, { status: 404, body: { error: `the stand-ins have no ${req.method} ${url.pathname}` } });
    } catch (e) {
      if (e instanceof LostReply) { req.socket.destroy(); return; }
      send(res, { status: 500, body: { error: (e as Error).message } });
    }
  });

  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(listen.port, listen.host ?? "127.0.0.1", resolve); });
  const port = (server.address() as { port: number }).port;
  return { server, port, url: `http://127.0.0.1:${port}`, fakes, close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }) };
}
