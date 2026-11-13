// The shop character's pictures through the pages domain's front door (item 11i): https://<pages domain>/<slug>/character/<mood>.<format> reaches the shop's own
// server unchanged, for a shop on this server and for a builder's client, and its caching headers come back (type, length, cache life, ETag), so Streetlist and
// WhatsApp get the same picture the shop's own address gives. A browser's If-None-Match goes through and a 304 comes back. The door stores nothing: every request
// is forwarded. This needed no change to bundle/services/door.ts; the test holds it to that. Kept apart from door.test.ts, which another job edits.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import type { IncomingHttpHeaders, Server } from "node:http";
import { doorHandler } from "../services/door.ts";
import type { SlugAnswer, Transport, Upstream } from "../services/door.ts";

const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });

const SLUGS: Record<string, SlugAnswer> = {
  "veena-salon": { state: "active", deployment_id: "partner-1", agent_id: "veena", hosting: "geometer", origin: "https://partners.example" },
  "ravi-cuts": { state: "active", deployment_id: "ravi-vps", agent_id: "ravi", hosting: "self", origin: "https://ravi.example" },
};
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const ETAG = "\"0123456789abcdef0123456789abcdef\"";

/** The shop's front as the door sees it: the picture, or 304 when the ETag matches. Every call is kept. */
function front(calls: { target: string; headers: Record<string, string> }[]): Transport {
  return async (target, init): Promise<Upstream> => {
    calls.push({ target: target.href, headers: init.headers });
    const headers = { "content-type": "image/png", "cache-control": "public, max-age=86400", etag: ETAG, "x-content-type-options": "nosniff", "cross-origin-resource-policy": "cross-origin" };
    if (init.headers["if-none-match"] === ETAG) return { status: 304, headers, body: Buffer.alloc(0) };
    return { status: 200, headers: { ...headers, "content-length": String(PNG.length) }, body: PNG };
  };
}

async function door() {
  const local: { target: string; headers: Record<string, string> }[] = [];
  const remote: { target: string; headers: Record<string, string> }[] = [];
  const handler = doorHandler({
    primary: "pages.example", extra: [], deploymentId: "partner-1", localUrl: "http://inbox:8788", local: front(local), remote: front(remote), log: () => undefined,
    registry: { slug: async (s) => SLUGS[s] ?? { state: "unknown" }, id: async () => ({ state: "unknown" }) },
  });
  const server = createServer(handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  const port = (server.address() as { port: number }).port;
  const call = (path: string, headers: Record<string, string> = {}, method = "GET") => new Promise<{ status: number; headers: IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method, headers: { host: "pages.example", "x-forwarded-for": "203.0.113.9", ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.end();
  });
  return { call, local, remote };
}

test("a shop on this server: the picture's address is the shop's own, its headers come back, and If-None-Match gives a 304", async () => {
  const d = await door();
  const r = await d.call("/veena-salon/character/well.png?v=0123456789abcdef");
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, PNG);
  assert.equal(d.local[0].target, "http://inbox:8788/s/veena/character/well.png?v=0123456789abcdef");
  assert.equal(r.headers["content-type"], "image/png");
  assert.equal(r.headers["cache-control"], "public, max-age=86400");
  assert.equal(r.headers.etag, ETAG);
  assert.equal(r.headers["cross-origin-resource-policy"], "cross-origin");
  const again = await d.call("/veena-salon/character/well.png", { "if-none-match": ETAG });
  assert.equal(again.status, 304);
  assert.equal(d.local[1].headers["if-none-match"], ETAG, "the browser's ETag goes through");
  assert.equal(d.local.length, 2, "nothing is kept at the door: each request is forwarded");
});

test("a builder's client: the picture comes back with its type, cache life and ETag, under the door's own no-script policy", async () => {
  const d = await door();
  const r = await d.call("/ravi-cuts/character/now.svg");
  assert.equal(r.status, 200);
  assert.equal(d.remote[0].target, "https://ravi.example/s/ravi/character/now.svg");
  assert.equal(r.headers["cache-control"], "public, max-age=86400");
  assert.equal(r.headers.etag, ETAG);
  assert.match(String(r.headers["content-security-policy"]), /script-src 'none'/u);
  assert.equal((await d.call("/ravi-cuts/character/now.svg", { "if-none-match": ETAG })).status, 304);
});
