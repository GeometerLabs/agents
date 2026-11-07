// A throwaway HTTP server on a free local port for tests: it records every request and answers as the test's handler says.
// Nothing here is a real service.
import { createServer } from "node:http";
import type { IncomingHttpHeaders, Server } from "node:http";
import { readFileSync } from "node:fs";

export interface Recorded { method: string; url: string; headers: IncomingHttpHeaders; body: string }
export type Answer = { status?: number; json?: unknown; text?: string; delayMs?: number; destroy?: boolean };
export interface Scripted { url: string; requests: Recorded[]; close(): Promise<void> }

export async function scripted(handler: (request: Recorded) => Answer | Promise<Answer>): Promise<Scripted> {
  const requests: Recorded[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", async () => {
      const recorded: Recorded = { method: req.method ?? "", url: req.url ?? "", headers: req.headers, body: Buffer.concat(chunks).toString("utf8") };
      requests.push(recorded);
      const answer = await handler(recorded);
      if (answer.delayMs) await new Promise((r) => setTimeout(r, answer.delayMs));
      if (answer.destroy) { req.socket.destroy(); return; }
      res.writeHead(answer.status ?? 200, { "content-type": "application/json" });
      res.end(answer.text ?? (answer.json === undefined ? "" : JSON.stringify(answer.json)));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}`, requests,
    close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}

/** A sample payload from test/fixtures/. */
export const fixture = (name: string): any => JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8"));
export const fixtureText = (name: string): string => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");
