// /c/<shop>/rest goes to that shop's handler as /rest. One router for the inbox and the relay: nothing is shared between shops but this function.
import type { IncomingMessage, ServerResponse } from "node:http";

export type Handler = (req: IncomingMessage, res: ServerResponse) => void;

// Maps /c/<shop>/... to that shop's own handler and answers /healthz itself; an unknown shop gets a plain 404 so shops cannot reach one another through it. `log` is optional.
export function createRouter(shops: Record<string, Handler>, log: (line: string) => void = () => undefined): Handler {
  return (req, res) => {
    const url = req.url ?? "/";
    if (url === "/healthz" && req.method === "GET") { res.writeHead(200, { "content-type": "text/plain" }); res.end("ok"); return; }
    const match = /^\/c\/([a-z0-9][a-z0-9-]*)(\/[^?]*)?(\?.*)?$/u.exec(url);
    const handler = match && Object.hasOwn(shops, match[1]) ? shops[match[1]] : undefined;
    if (!match || !handler) { log(`${req.method} (no such shop) -> 404`); res.writeHead(404, { "content-type": "application/json" }); res.end('{"error":"not found"}'); return; }
    req.url = `${match[2] ?? "/"}${match[3] ?? ""}`;
    handler(req, res);
  };
}
