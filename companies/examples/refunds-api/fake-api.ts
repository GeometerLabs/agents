// A tiny stand-in for the made-up Brightside refunds API, plain Node. It is NOT a copy of anything real: it keeps what it was asked in memory so a test (or
// you, by hand) can see exactly what reached "the company's API" and what did not.
//
//   node companies/examples/refunds-api/fake-api.ts --port 4010 --key sk_test_brightside
//
// Two things it does on purpose:
//   - it needs its own key (Authorization: Bearer <key>), so you can see that the agent never holds it;
//   - it does NOT honour the Idempotency-Key header. A repeat that reaches it makes a second refund. So when a test shows one refund, the repeat was
//     stopped by Guard, not forgiven by the API.
// `loseReplyFor` names charges whose refund is made and then the connection is dropped with no answer: the reply is lost.
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { parseArgs } from "node:util";

export interface Seen { method: string; path: string; authorization: string | undefined; idempotencyKey: string | undefined; body: any; answered: boolean }
export interface Refund { id: string; charge_id: string; amount: number; reason?: string; status: string; idempotency_key?: string }

export interface FakeApi {
  url: string;
  port: number;
  /** Every request, in order, including ones refused for a wrong key. */
  seen: Seen[];
  refunds: Refund[];
  transfers: unknown[];
  deletedCustomers: string[];
  /** Charges whose refund is made and then never answered. */
  loseReplyFor: Set<string>;
  close(): Promise<void>;
}

const readBody = (req: IncomingMessage) => new Promise<string>((resolve) => { let t = ""; req.on("data", (c) => { t += c; }); req.on("end", () => resolve(t)); });

export function startFakeApi(o: { apiKey: string; port?: number }): Promise<FakeApi> {
  const api: Omit<FakeApi, "url" | "port" | "close"> = { seen: [], refunds: [], transfers: [], deletedCustomers: [], loseReplyFor: new Set() };
  const send = (res: ServerResponse, status: number, body?: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(body === undefined ? undefined : JSON.stringify(body)); };

  const server = createServer(async (req, res) => {
    const text = await readBody(req);
    let body: any;
    try { body = text ? JSON.parse(text) : undefined; } catch { body = undefined; }
    const url = new URL(req.url ?? "/", "http://fake");
    const seen: Seen = { method: req.method ?? "", path: url.pathname, authorization: req.headers.authorization, idempotencyKey: req.headers["idempotency-key"] as string | undefined, body, answered: false };
    api.seen.push(seen);
    if (req.headers.authorization !== `Bearer ${o.apiKey}`) { seen.answered = true; return send(res, 401, { error: "bad key" }); }
    const parts = url.pathname.split("/").filter(Boolean); // ["v1", "refunds", "re_1", "cancel"]
    const m = req.method;

    if (m === "GET" && parts[1] === "charges" && parts.length === 3) { seen.answered = true; return send(res, 200, { id: parts[2], amount: 25000, currency: "usd", status: "paid" }); }
    if (m === "GET" && parts[1] === "charges" && parts[3] === "refunds") { seen.answered = true; return send(res, 200, { data: api.refunds.filter((r) => r.charge_id === parts[2]) }); }
    if (m === "POST" && url.pathname === "/v1/refunds") {
      if (typeof body?.charge_id !== "string" || !Number.isInteger(body?.amount) || body.amount < 1) { seen.answered = true; return send(res, 422, { error: "charge_id and a whole-cent amount are needed" }); }
      const refund: Refund = { id: `re_${api.refunds.length + 1}`, charge_id: body.charge_id, amount: body.amount, ...(body.reason ? { reason: body.reason } : {}), status: "pending", ...(seen.idempotencyKey ? { idempotency_key: seen.idempotencyKey } : {}) };
      api.refunds.push(refund);
      if (api.loseReplyFor.has(body.charge_id)) { req.socket.destroy(); return; } // made, and never answered
      seen.answered = true;
      return send(res, 201, refund);
    }
    if (m === "GET" && parts[1] === "refunds" && parts.length === 3) {
      const r = api.refunds.find((x) => x.id === parts[2]);
      seen.answered = true;
      return r ? send(res, 200, r) : send(res, 404, { error: "no such refund" });
    }
    if (m === "POST" && parts[1] === "refunds" && parts[3] === "cancel") {
      const r = api.refunds.find((x) => x.id === parts[2]);
      seen.answered = true;
      if (!r) return send(res, 404, { error: "no such refund" });
      r.status = "canceled";
      return send(res, 200, r);
    }
    if (m === "POST" && url.pathname === "/v1/transfers") { api.transfers.push(body); seen.answered = true; return send(res, 201, { id: `tr_${api.transfers.length}`, ...body }); }
    if (m === "DELETE" && parts[1] === "customers" && parts.length === 3) { api.deletedCustomers.push(parts[2]!); seen.answered = true; return send(res, 204); }
    seen.answered = true;
    return send(res, 404, { error: "not found" });
  });

  return new Promise((resolve) => {
    server.listen(o.port ?? 0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      resolve({ ...api, url: `http://127.0.0.1:${port}`, port, close: () => new Promise<void>((done) => { server.closeAllConnections(); server.close(() => done()); }) });
    });
  });
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { port: { type: "string", default: "4010" }, key: { type: "string", default: "sk_test_brightside" } } });
  const api = await startFakeApi({ apiKey: values.key!, port: Number(values.port) });
  console.log(`The made-up refunds API is at ${api.url}. Its key is "${values.key}". It keeps everything in memory and does not honour Idempotency-Key.`);
}
