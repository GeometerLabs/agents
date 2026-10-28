// A small in-memory copy of the service, on a local port, so the tools' real HTTP calls can be tested.
// Records come from .geometer/fixtures.json (the same ones Geometer's simulated service uses).
// GET /v1/<collection>/<id> returns a record; POST /v1/<collection>/<id>/<what> stores a body and GET of the
// same path lists what was stored. `svc.drop.reply = true` makes the next POSTs take effect but never answer.
import { readFileSync } from "node:fs";
import { createServer } from "node:http";

const fixtures = JSON.parse(readFileSync(new URL("../.geometer/fixtures.json", import.meta.url), "utf8")).collections;

export async function startService() {
  const posts: any[] = [];
  const stored: Record<string, any[]> = {};
  const drop = { reply: false };
  const server = createServer(async (req, res) => {
    const parts = req.url!.split("/").filter(Boolean); // v1, collection, id[, what]
    const send = (code: number, body: unknown) => res.writeHead(code).end(JSON.stringify(body));
    if (req.method === "GET") {
      if (parts.length === 4) return send(200, stored[req.url!] ?? []);
      const record = (fixtures[parts[1]] ?? []).find((r: any) => r.id === parts[2]);
      return record ? send(200, record) : send(404, null);
    }
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw || "{}");
    posts.push(body);
    (stored[req.url!] ??= []).push(body);
    if (drop.reply) return req.socket.destroy();
    send(201, body);
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const url = `http://127.0.0.1:${(server.address() as any).port}`;
  return { url, posts, drop, close: () => server.close() };
}
