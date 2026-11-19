// The FAKE GUARDS of the Bookings contract (see README.md in this folder): the three services a deployed Bookings shop calls (payments, the calendar, WhatsApp), as small HTTP
// servers the shop's runtime process reaches through its own runtime.json, exactly as it reaches a Guard in production. Each server RECORDS every request it is sent (method, path,
// query, the headers that matter, the body) and what it answered, so a test can say what the runtime put on the wire, and a Go runtime is held to the same wire.
//
// What stands behind the recorders is the stand-ins (templates/commerce/bookings/standins: Razorpay's, Google Calendar's and WhatsApp's wire formats over in-memory fakes, tested
// against the providers' own sample payloads in test/fixtures) and, in front of the refunds, the stub Guard (modules/standins/guard.ts: Guard's documented hold, refusal and
// outcome-unknown behaviour, built from the limits spec generated from the shop's own settings). They are the other side of the wire: nothing of the SHOP RUNTIME (server/, src/agent.ts) is imported. What IS imported, and a deletion wave must keep: the stand-ins and the stub Guard, `gatewayLimitsSpec` and `Settings` (the deployer's limits spec), and the Razorpay stand-in's and the inbox's webhook readers (README.md section 7 lists them).
// What the Guards answer normally comes from the stand-ins (the providers' wire formats, tested against the providers' sample payloads in test/fixtures by test/live-adapters and test/standins); only the FAULTS answer from fixtures (the captured Guard answers in test/fixtures/guard-responses.json: a refusal, a busy Guard, a kill switch, a licence refusal), never from words typed here.
//
// Why a proxy in front of each: the stand-ins do not record headers or bodies, and a test must also make a Guard slow, down or wrong at a chosen moment. A recorder is a
// 60-line reverse proxy; the faults are plans ("the next 2 calls to the calendar answer 503").
import { createServer } from "node:http";
import type { IncomingHttpHeaders, IncomingMessage, Server } from "node:http";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { systemClock } from "../../../../modules/core/clock.ts";
import { startStubGuard } from "../../../../modules/standins/guard.ts";
import type { RunningStubGuard } from "../../../../modules/standins/guard.ts";
import { startStandins } from "../standins/server.ts";
import type { RunningStandins } from "../standins/server.ts";
import { gatewayLimitsSpec } from "../src/guard-limits.ts";
import type { Settings } from "../src/settings.ts";
import { razorpayWebhookBody } from "../../../../modules/payments/providers/razorpay/standin.ts";
import { parseRazorpayEvent } from "../../../../modules/payments/providers/razorpay/webhook.ts";
import type { PaymentEvent } from "../../../../modules/payments/payments.ts";

export type Service = "payments" | "calendar" | "messaging";

/** A fixture from test/fixtures (the providers' own sample payloads, and Guard's captured answers). */
export const fixture = (name: string): any => JSON.parse(readFileSync(new URL(`../test/fixtures/${name}`, import.meta.url), "utf8"));

/** One request a fake Guard heard, and what it answered. */
export interface GuardCall {
  service: Service;
  method: string;
  /** The path without its query. */
  path: string;
  query: Record<string, string>;
  /** Only the headers that say something about the call: authorization, geo-requested-by, content-type. */
  headers: { authorization?: string; "geo-requested-by"?: string; "content-type"?: string };
  /** The body as JSON when it is JSON, else the text ("" for none). */
  body: any;
  /** What was answered: the status (0 when the connection was cut) and the body text. */
  status: number;
  reply: string;
}

/** A captured answer of Guard (guard-responses.json): its status, headers and body. */
export interface CapturedAnswer { status: number; headers?: Record<string, string>; body: unknown }

/** What a fault does to a call that matches: answer something else, cut the connection, or wait first. */
type Action = { kind: "answer"; answer: CapturedAnswer } | { kind: "drop" } | { kind: "delay"; ms: number };
interface Plan { match: (c: { method: string; path: string }) => boolean; times: number; action: Action }

export interface Recorder {
  url: string;
  calls: GuardCall[];
  /** Answer the next `times` calls that match (default: every call) with a captured Guard answer, instead of passing them on. */
  answer(answer: CapturedAnswer, o?: { times?: number; match?: Plan["match"] }): void;
  /** Cut the connection on the next `times` matching calls, BEFORE passing them on (the service never heard them). */
  drop(o?: { times?: number; match?: Plan["match"] }): void;
  /** Pass the next `times` matching calls on, but cut the connection instead of answering (the service did it; the runtime sees no answer: "lost reply"). */
  loseReply(o?: { times?: number; match?: Plan["match"] }): void;
  /** Wait `ms` before passing the next `times` matching calls on. */
  delay(ms: number, o?: { times?: number; match?: Plan["match"] }): void;
  /** Take every planned fault away (down, an answer, a delay, a lost reply). */
  clear(): void;
  /** Down: every call answers 503 with Guard's captured "busy" answer (nothing was sent, try again) until `up()`: a Guard that is restarting, which the shop WAITS for. */
  down(): void;
  /** Stopped on purpose: every call answers Guard's captured kill-switch answer until `up()`: a person stopped the shop, so the shop does NOT wait. */
  stopped(): void;
  up(): void;
  close(): Promise<void>;
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => { const c: Buffer[] = []; req.on("data", (d: Buffer) => c.push(d)); req.on("end", () => resolve(Buffer.concat(c))); req.on("error", reject); });
}

const interesting = (h: IncomingHttpHeaders): GuardCall["headers"] => ({
  ...(typeof h.authorization === "string" ? { authorization: h.authorization } : {}),
  ...(typeof h["geo-requested-by"] === "string" ? { "geo-requested-by": h["geo-requested-by"] } : {}),
  ...(typeof h["content-type"] === "string" ? { "content-type": h["content-type"] } : {}),
});

async function recorder(service: Service, target: string, calls: GuardCall[]): Promise<Recorder> {
  const plans: Plan[] = [];
  let isDown: "busy" | "kill_switch" | false = false;
  const server: Server = createServer(async (req, res) => {
    const raw = await readBody(req);
    const url = new URL(req.url ?? "/", "http://guard");
    const method = req.method ?? "GET";
    const text = raw.toString("utf8");
    let body: unknown = text;
    try { body = text === "" ? "" : JSON.parse(text); } catch { /* the text */ }
    const entry: GuardCall = { service, method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: interesting(req.headers), body, status: 0, reply: "" };
    calls.push(entry);
    const down = (): CapturedAnswer => fixture("guard-responses.json")[isDown === "kill_switch" ? "kill_switch" : "busy"] as CapturedAnswer;
    const plan = plans.find((p) => p.times > 0 && p.match({ method, path: url.pathname }));
    if (plan) plan.times -= 1;
    const respond = (a: CapturedAnswer): void => {
      const out = typeof a.body === "string" ? a.body : JSON.stringify(a.body);
      entry.status = a.status; entry.reply = out;
      res.writeHead(a.status, { "content-type": "application/json", ...(a.headers ?? {}), "content-length": Buffer.byteLength(out) });
      res.end(out);
    };
    if (isDown) return respond(down());
    if (plan?.action.kind === "answer") return respond(plan.action.answer);
    if (plan?.action.kind === "drop") { req.socket.destroy(); return; }
    if (plan?.action.kind === "delay") await new Promise((r) => setTimeout(r, (plan.action as { ms: number }).ms));
    const lose = (plan as (Plan & { lose?: boolean }) | undefined)?.lose === true;
    let upstream: Response;
    try {
      upstream = await fetch(target + req.url, { method, headers: { ...(typeof req.headers.authorization === "string" ? { authorization: req.headers.authorization } : {}), ...(typeof req.headers["geo-requested-by"] === "string" ? { "geo-requested-by": req.headers["geo-requested-by"] } : {}), ...(raw.length > 0 ? { "content-type": String(req.headers["content-type"] ?? "application/json") } : {}), accept: "application/json" }, ...(raw.length > 0 ? { body: raw } : {}), signal: AbortSignal.timeout(15_000) });
    } catch { return respond({ status: 502, body: { error: "the stand-in could not be reached" } }); }
    const reply = Buffer.from(await upstream.arrayBuffer());
    entry.status = lose ? 0 : upstream.status; entry.reply = reply.toString("utf8");
    if (lose) { req.socket.destroy(); return; }
    const headers: Record<string, string> = { "content-length": String(reply.length) };
    for (const [k, v] of upstream.headers) if (k === "content-type" || k.startsWith("guard-")) headers[k] = v;
    res.writeHead(upstream.status, headers);
    res.end(reply);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const everything = (): boolean => true;
  const add = (action: Action, o: { times?: number; match?: Plan["match"] } = {}, extra: object = {}): void => { plans.push({ match: o.match ?? everything, times: o.times ?? Infinity, action, ...extra } as Plan); };
  return {
    url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, calls,
    answer: (answer, o) => add({ kind: "answer", answer }, o),
    drop: (o) => add({ kind: "drop" }, o),
    loseReply: (o) => add({ kind: "delay", ms: 0 }, o, { lose: true }),
    delay: (ms, o) => add({ kind: "delay", ms }, o),
    clear: () => { plans.length = 0; isDown = false; },
    down: () => { isDown = "busy"; }, stopped: () => { isDown = "kill_switch"; }, up: () => { isDown = false; },
    close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }),
  };
}

export interface FakeGuards {
  /** Every call to any of the three, oldest first. */
  calls: GuardCall[];
  payments: Recorder;
  calendar: Recorder;
  messaging: Recorder;
  /** The credential the payments Guard wants from the runtime (the shop's runtime.json names its file). The other two want none. */
  agentToken: string;
  /** The in-memory services behind the recorders: the witnesses ("done" is judged from what they hold) and the customer's side (a customer pays, a customer writes). */
  standins: RunningStandins;
  stub: RunningStubGuard;
  /** The WhatsApp number id the shop's runtime.json must name. */
  phoneNumberId: string;
  /** The calls to one service, optionally filtered by method and a path pattern. */
  of(service: Service, method?: string, path?: RegExp): GuardCall[];
  /** The customer pays the payment link `linkId` (the money moves at the provider), and the provider's webhook events, read as the inbox reads them, are returned: post them to /internal/events. */
  pay(linkId: string, o?: { amountPaise?: number }): PaymentEvent[];
  /** Every provider webhook event the fakes made that `pay` or a refund has not returned yet, as the inbox reads them (ready for `{kind: "payment_event", event}`). */
  newPaymentEvents(): PaymentEvent[];
  close(): Promise<void>;
}

/**
 * Start the three fake Guards for a shop with these settings. The refund limit and the deposit in the settings make the stub Guard's threshold and bounds, as the deployer
 * generates them (src/guard-limits.ts gatewayLimitsSpec), so a refund above the owner's limit is HELD, and one above the deposit is REFUSED.
 */
export async function startGuards(settings: Settings, o: { phoneNumberId?: string; calendarId?: string } = {}): Promise<FakeGuards> {
  const phoneNumberId = o.phoneNumberId ?? "100000000000001";
  const agentToken = randomBytes(16).toString("hex");
  const standins = await startStandins({ clock: systemClock, razorpayWebhookSecret: "contract-rzp", whatsappAppSecret: "contract-wa", phoneNumberId, calendarId: o.calendarId ?? "shop@example.com" }, { port: 0 });
  const stub = await startStubGuard({
    clock: systemClock, upstreamUrl: standins.url, spec: gatewayLimitsSpec(settings, { tenant: "contract", version: 1, reviewedBy: "contract" }), agentToken,
    approver: { id: "owner-contract", secret: randomBytes(16).toString("hex") }, readToken: randomBytes(16).toString("hex"),
  });
  const calls: GuardCall[] = [];
  const payments = await recorder("payments", stub.agentUrl, calls);
  const calendar = await recorder("calendar", standins.url, calls);
  const messaging = await recorder("messaging", standins.url, calls);
  let delivered = 0;
  const newPaymentEvents = (): PaymentEvent[] => {
    const fresh = standins.fakes.payments.events.slice(delivered);
    delivered = standins.fakes.payments.events.length;
    // as the inbox reads a Razorpay webhook (it checked the signature; the runtime never holds the secret): the provider's body, then the neutral event
    return fresh.flatMap((e) => { const p = parseRazorpayEvent(JSON.parse(razorpayWebhookBody(e, standins.fakes.payments)), e.id); return p ? [p] : []; });
  };
  return {
    calls, payments, calendar, messaging, agentToken, standins, stub, phoneNumberId,
    of: (service, method, path) => calls.filter((c) => c.service === service && (!method || c.method === method) && (!path || path.test(c.path))),
    pay(linkId, po = {}) { standins.fakes.payments.customerPays(linkId, po.amountPaise !== undefined ? { amount: po.amountPaise } : {}); return newPaymentEvents(); },
    newPaymentEvents,
    async close() { for (const r of [payments, calendar, messaging]) await r.close(); await stub.close(); await standins.close(); },
  };
}
