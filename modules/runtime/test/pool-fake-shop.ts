// A stand-in shop for the worker pool's tests (shared-pool.test.ts), loaded INSIDE a pool worker as its `startModule`. What it does is named by "mode" in its settings.json:
//   ok     answers every request with its own name and what it was sent
//   spin   answers, except GET /spin which loops forever (a blocked event loop)
//   leak   answers, except GET /leak which allocates without limit (an out-of-memory)
// Stopping it takes `stopMs` (settings.json) and then writes a file named `closed` beside the client folder: the proof that its "store" was closed, and when.
import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface Paths { name: string; clientFolder: string }

export async function start(p: Paths, _listen: unknown, log: (line: string) => void): Promise<{ server: { port: number }; stop(): Promise<void> }> {
  const settings = JSON.parse(readFileSync(join(p.clientFolder, "settings.json"), "utf8")) as { mode: string; stopMs?: number };
  const server = createServer((req, res) => {
    if (req.url === "/spin" && settings.mode === "spin") { for (;;) { /* a shop that never gives the event loop back */ } }
    if (req.url === "/leak" && settings.mode === "leak") {
      const keep: number[][] = [];
      // allocate in the shop's own callbacks (not one synchronous loop), as a real leak is: it must be found through the slot, not by luck
      const grow = (): void => { keep.push(new Array(500_000).fill(1)); setImmediate(grow); };
      grow();
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ shop: p.name, path: req.url, auth: req.headers.authorization ?? null }));
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  log("started");
  return {
    server: { port: (server.address() as { port: number }).port },
    stop: async () => {
      await new Promise<void>((ok) => setTimeout(ok, settings.stopMs ?? 0));
      await new Promise<void>((ok) => { server.closeAllConnections(); server.close(() => ok()); });
      writeFileSync(join(p.clientFolder, "..", "closed"), String(Date.now()));
    },
  };
}
