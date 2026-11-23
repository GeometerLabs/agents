// The FAKE WHATSAPP GUARD of the Stock orders contract (see README.md in this folder): the one service a deployed Stock orders shop calls, as a small HTTP server the shop's runtime
// process reaches through its own runtime.json, exactly as it reaches a Guard in production. It RECORDS every request (method, path, the headers that matter, the body) and what it
// answered, so a test can say what the runtime put on the wire and a Go runtime is held to the same wire.
//
// Behind the recorder is the shared WhatsApp stand-in (modules/standins/whatsapp.ts: Meta's Cloud API wire over the in-memory fake, the 24-hour window, the approved templates) with
// this template's own approved templates (src/language/meta-templates.ts, report/whatsapp.ts). Nothing of the SHOP RUNTIME (server/, src/agent.ts) is imported. The faults answer
// from Guard's captured answers (the Bookings fixture guard-responses.json, the one copy of them), never from words typed here.
//
// Why this is not Bookings' guards.ts: that one starts payments and calendar stand-ins and a stub Guard built from Bookings' settings, and its recorder is not exported. Stock orders
// has WhatsApp only, so the 60-line recorder is repeated here with the same plans (answer, drop, loseReply, delay, down), rather than changing a file the Bookings suite owns.
import { createServer } from "node:http";
import type { IncomingHttpHeaders, IncomingMessage, Server } from "node:http";
import { readFileSync } from "node:fs";
import { systemClock } from "../../../../modules/core/clock.ts";
import { createFakeMessaging } from "../../../../modules/messaging/messaging.ts";
import type { FakeMessaging } from "../../../../modules/messaging/messaging.ts";
import { serveHandlers } from "../../../../modules/standins/http.ts";
import { approveTemplates, whatsappStandin } from "../../../../modules/standins/whatsapp.ts";
import { META_TEMPLATES } from "../src/language/meta-templates.ts";
import { REPORT_TEMPLATES } from "../report/whatsapp.ts";

/** Guard's captured answers (the one copy, in the Bookings fixtures). */
export const guardAnswer = (name: string): CapturedAnswer => (JSON.parse(readFileSync(new URL("../../bookings/test/fixtures/guard-responses.json", import.meta.url), "utf8")) as Record<string, CapturedAnswer>)[name];

export interface GuardCall {
  method: string;
  path: string;
  headers: { authorization?: string; "content-type"?: string };
  body: any;
  /** What was answered (0 when the connection was cut). */
  status: number;
  reply: string;
}
export interface CapturedAnswer { status: number; headers?: Record<string, string>; body: unknown }
type Action = { kind: "answer"; answer: CapturedAnswer } | { kind: "drop" } | { kind: "delay"; ms: number };
type Match = (c: { method: string; path: string; body: any }) => boolean;
interface Plan { match: Match; times: number; action: Action; lose?: boolean }

export interface WhatsAppGuard {
  url: string;
  phoneNumberId: string;
  calls: GuardCall[];
  /** The in-memory WhatsApp behind the recorder: the witness of what went to whom, and the people's side (`receive`). */
  fake: FakeMessaging;
  answer(answer: CapturedAnswer, o?: { times?: number; match?: Match }): void;
  drop(o?: { times?: number; match?: Match }): void;
  loseReply(o?: { times?: number; match?: Match }): void;
  delay(ms: number, o?: { times?: number; match?: Match }): void;
  down(): void;
  up(): void;
  clear(): void;
  close(): Promise<void>;
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => { const c: Buffer[] = []; req.on("data", (d: Buffer) => c.push(d)); req.on("end", () => resolve(Buffer.concat(c))); req.on("error", reject); });
}
const interesting = (h: IncomingHttpHeaders): GuardCall["headers"] => ({
  ...(typeof h.authorization === "string" ? { authorization: h.authorization } : {}),
  ...(typeof h["content-type"] === "string" ? { "content-type": h["content-type"] } : {}),
});

/** A call that sends the purchase order itself: the template the supplier gets with the order (stock_order_to_supplier). */
export const isOrderSend: Match = (c) => c.method === "POST" && /\/messages$/u.test(c.path) && c.body?.template?.name === "stock_order_to_supplier";

export async function startWhatsAppGuard(o: { phoneNumberId?: string } = {}): Promise<WhatsAppGuard> {
  const phoneNumberId = o.phoneNumberId ?? "100000000000001";
  const fake = createFakeMessaging(systemClock);
  const catalogue = { templates: [...META_TEMPLATES, ...REPORT_TEMPLATES] };
  approveTemplates(fake, catalogue);
  const standin = await serveHandlers([whatsappStandin(fake, catalogue, { phoneNumberId })]);
  const calls: GuardCall[] = [];
  const plans: Plan[] = [];
  let isDown = false;
  const server: Server = createServer(async (req, res) => {
    const raw = await readBody(req);
    const url = new URL(req.url ?? "/", "http://guard");
    const method = req.method ?? "GET";
    const text = raw.toString("utf8");
    let body: unknown = text;
    try { body = text === "" ? "" : JSON.parse(text); } catch { /* the text */ }
    const entry: GuardCall = { method, path: url.pathname, headers: interesting(req.headers), body, status: 0, reply: "" };
    calls.push(entry);
    const plan = plans.find((p) => p.times > 0 && p.match({ method, path: url.pathname, body }));
    if (plan) plan.times -= 1;
    const respond = (a: CapturedAnswer): void => {
      const out = typeof a.body === "string" ? a.body : JSON.stringify(a.body);
      entry.status = a.status; entry.reply = out;
      res.writeHead(a.status, { "content-type": "application/json", ...(a.headers ?? {}), "content-length": Buffer.byteLength(out) });
      res.end(out);
    };
    if (isDown) return respond(guardAnswer("busy"));
    if (plan?.action.kind === "answer") return respond(plan.action.answer);
    if (plan?.action.kind === "drop") { req.socket.destroy(); return; }
    if (plan?.action.kind === "delay") await new Promise((r) => setTimeout(r, (plan.action as { ms: number }).ms));
    let upstream: Response;
    try {
      upstream = await fetch(standin.url + req.url, { method, headers: { ...(raw.length > 0 ? { "content-type": String(req.headers["content-type"] ?? "application/json") } : {}), accept: "application/json" }, ...(raw.length > 0 ? { body: raw } : {}), signal: AbortSignal.timeout(15_000) });
    } catch { return respond({ status: 502, body: { error: "the stand-in could not be reached" } }); }
    const reply = Buffer.from(await upstream.arrayBuffer());
    entry.status = plan?.lose ? 0 : upstream.status; entry.reply = reply.toString("utf8");
    if (plan?.lose) { req.socket.destroy(); return; }
    res.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") ?? "application/json", "content-length": String(reply.length) });
    res.end(reply);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const all: Match = () => true;
  const add = (action: Action, p: { times?: number; match?: Match } = {}, lose = false): void => { plans.push({ match: p.match ?? all, times: p.times ?? Infinity, action, lose }); };
  return {
    url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, phoneNumberId, calls, fake,
    answer: (answer, p) => add({ kind: "answer", answer }, p),
    drop: (p) => add({ kind: "drop" }, p),
    loseReply: (p) => add({ kind: "delay", ms: 0 }, p, true),
    delay: (ms, p) => add({ kind: "delay", ms }, p),
    down: () => { isDown = true; }, up: () => { isDown = false; },
    clear: () => { plans.length = 0; isDown = false; },
    close: async () => { await new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }); await standin.close(); },
  };
}
