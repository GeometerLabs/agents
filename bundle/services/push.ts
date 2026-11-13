// The server's push sender (plan item 11h, decision 45): the one container that reaches the browsers' push services, and only from behind a shop's push Guard.
// A shop's runtime encrypts each push for its phone (RFC 8291) and signs it with the shop's VAPID key (RFC 8292); its push Guard checks the push service's host
// against an exact list and counts the push against the shop's daily caps (generate/guards.ts pushSpec); only then does Guard pass the small JSON here
// (modules/push/hosts.ts PushCall), and this turns it into the real request:
//
//   POST https://<host><path>   TTL, Urgency, Topic, Content-Encoding: aes128gcm, Authorization: <the shop's VAPID header>, the encrypted bytes
//
// and answers Guard (and so the runtime) with the push service's own status: 201 sent, 404/410 the phone dropped the subscription, 413/400 refused, 429/5xx try
// later. Why it exists at all: Guard decides only on what it can read exactly, and a push's body is binary ciphertext, which Guard refuses; and Guard removes the
// caller's Authorization header, where VAPID's signature goes. So the decision stays Guard's, and this does only the wire.
//
// What keeps it narrow: it listens only on the `push` network, which only the shops' push Guards share (generate/compose.ts); it holds no secret (the VAPID header
// comes with each call, and the body is ciphertext it cannot read); the host is taken ONLY from the field Guard checked, and checked again against the same list;
// the address is https on port 443 of that host, no redirect followed, no body read back beyond a few KB, nothing logged but the host and the status.
//
// The proof's stand-in push service enters through the server's `upstreams` (geometer.json, the seam that already points Guards at stand-ins): `push-service`
// there becomes PUSH_SERVICE_OVERRIDE (http://<host>:<port>), and every push goes to it instead, with the real host in `x-push-host`. Never set on a real server.
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { pushCallProblem } from "../../modules/push/hosts.ts";
import type { PushCall } from "../../modules/push/hosts.ts";

/** The routes Guard passes on (the push Guard's spec has exactly these). */
const ROUTES = new Set(["/v1/push/owner", "/v1/push/customer"]);
const MAX_BODY = 16 * 1024;

function readBody(req: IncomingMessage): Promise<string | undefined> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => { size += c.length; if (size > MAX_BODY) { resolve(undefined); req.destroy(); return; } chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => resolve(undefined));
  });
}

const answer = (res: ServerResponse, status: number, value: unknown) => {
  const body = JSON.stringify(value);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body), "cache-control": "no-store" });
  res.end(body);
};

/** The request this sends for one call: the address (from the checked host only) and the headers. Exported for the tests. */
export function pushRequest(call: PushCall, override?: string): { url: string; headers: Record<string, string>; body: Buffer } {
  const real = new URL(call.path, `https://${call.host}`);
  // the path cannot move the request to another host: a path that tried ("//other", "@other") is refused by pushCallProblem; this is the last word
  if (real.hostname !== call.host || real.protocol !== "https:" || real.port !== "") throw new Error("The path would leave the push service's host.");
  const url = override ? `${override.replace(/\/+$/u, "")}${real.pathname}${real.search}` : real.href;
  return {
    url,
    headers: {
      ttl: String(call.ttl), urgency: call.urgency, ...(call.topic ? { topic: call.topic } : {}),
      "content-encoding": "aes128gcm", "content-type": "application/octet-stream", authorization: call.vapid,
      ...(override ? { "x-push-host": call.host } : {}),
    },
    body: Buffer.from(call.body, "base64url"),
  };
}

export function pushHandler(o: { override?: string; fetchImpl?: typeof fetch; log?: (line: string) => void } = {}) {
  const fetchImpl = o.fetchImpl ?? fetch;
  const log = o.log ?? (() => undefined);
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const path = new URL(req.url ?? "/", "http://push").pathname;
    if (path === "/healthz") return answer(res, 200, { ok: true });
    if (!ROUTES.has(path)) return answer(res, 404, { error: "There is nothing here." });
    if (req.method !== "POST") return answer(res, 405, { error: "POST" });
    const text = await readBody(req);
    let call: unknown;
    try { call = text === undefined ? undefined : JSON.parse(text); } catch { call = undefined; }
    const problem = pushCallProblem(call);
    if (problem) return answer(res, 400, { error: problem });
    let request: ReturnType<typeof pushRequest>;
    try { request = pushRequest(call as PushCall, o.override); } catch (e) { return answer(res, 400, { error: (e as Error).message }); }
    try {
      const r = await fetchImpl(request.url, { method: "POST", headers: request.headers, body: new Uint8Array(request.body), redirect: "error", signal: AbortSignal.timeout(10_000) });
      await r.arrayBuffer().catch(() => undefined);
      log(`push to ${(call as PushCall).host}: ${r.status}`);
      // the push service's status, as it is: the runtime tells sent from gone from later by it
      return answer(res, r.status, { status: r.status });
    } catch (e) {
      log(`push to ${(call as PushCall).host}: not reached (${(e as Error).name})`);
      return answer(res, 502, { error: "The push service could not be reached." });
    }
  };
}

if (import.meta.main) {
  const override = process.env.PUSH_SERVICE_OVERRIDE;
  const handle = pushHandler({ ...(override ? { override } : {}), log: (line) => console.error(line) });
  const server = createServer((req, res) => { handle(req, res).catch(() => { if (!res.headersSent) answer(res, 500, { error: "The push sender failed." }); }); });
  server.listen(Number(process.env.PORT ?? 8798), process.env.HOST ?? "127.0.0.1", () => console.error(`The push sender listens${override ? ` (every push goes to ${override}: a test server)` : ""}.`));
  const stop = () => server.close(() => process.exit(0));
  process.on("SIGTERM", stop); process.on("SIGINT", stop);
}
