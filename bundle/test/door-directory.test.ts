// The door's routes for the directory of local shops (block S, written 18 Nov 2026; not run): /search, /order, /feed-changed, /mcp and the Agent Card go to the directory
// BEFORE any name is taken for a shop's (so none of them is ever a shop here), with only the headers the directory needs; the directory's own port reads this server's shops
// without the visitors' limits; a server with no directory answers the friendly 404; the services file names the directory as the door's alone.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import type { IncomingHttpHeaders, Server } from "node:http";
import { DIRECTORY_PORT, DOOR_INTERNAL_PORT, DOOR_ROBOTS_DISALLOW, doorHandler, isDirectoryPath } from "../services/door.ts";
import type { Transport } from "../services/door.ts";

const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });

async function door(o: { directoryUrl?: string; internal?: boolean; directoryDown?: boolean } = {}) {
  const calls: { kind: string; target?: string; headers?: Record<string, string>; body?: string; method?: string }[] = [];
  const local: Transport = async (target, init) => {
    calls.push({ kind: target.href.startsWith("http://directory") ? "directory" : "local", target: target.href, headers: init.headers, method: init.method, ...(init.body ? { body: init.body.toString() } : {}) });
    if (target.href.startsWith("http://directory") && o.directoryDown) throw Object.assign(new Error("down"), { code: "ECONNREFUSED" });
    if (target.href.startsWith("http://directory")) return { status: 200, headers: { "content-type": "text/html", "set-cookie": ["x=1"], "referrer-policy": "no-referrer", "content-security-policy": "default-src 'none'" }, body: Buffer.from("<p>the directory</p>") };
    return { status: 200, headers: { "content-type": "application/json" }, body: Buffer.from("{}") };
  };
  const handler = doorHandler({
    primary: "pages.example", extra: ["old.example"], deploymentId: "partner-1", localUrl: "http://inbox:8788", local, remote: async () => { throw new Error("no builder here"); },
    ...(o.directoryUrl ? { directoryUrl: o.directoryUrl } : {}), ...(o.internal ? { internal: true } : {}),
    registry: {
      slug: async (s) => { calls.push({ kind: "slug", target: s }); return s === "search" || s === "order" || s === "mcp" ? { state: "active", deployment_id: "partner-1", agent_id: "sneaky", hosting: "geometer", origin: null } : s === "veena-salon" ? { state: "active", deployment_id: "partner-1", agent_id: "veena", hosting: "geometer", origin: null } : { state: "unknown" }; },
      id: async () => ({ state: "unknown" }), card: async () => ({ state: "unknown" }),
    },
  });
  const server = createServer(handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  const port = (server.address() as { port: number }).port;
  const call = (path: string, init: { method?: string; host?: string; headers?: Record<string, string>; body?: string } = {}) => new Promise<{ status: number; headers: IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method: init.method ?? "GET", headers: { host: init.host ?? "pages.example", "x-forwarded-for": "203.0.113.9", ...init.headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on("error", reject);
    req.end(init.body);
  });
  return { call, calls };
}
const DIRECTORY = `http://directory:${DIRECTORY_PORT}`;

test("every directory address goes to the directory, with its query, before fleet is asked about any name", async () => {
  const d = await door({ directoryUrl: DIRECTORY });
  for (const path of ["/search", "/search?q=persian+kitten&lang=ml", "/search/font.woff2", "/order", "/order?lang=hi", "/mcp", "/feed-changed", "/.well-known/agent-card.json"]) {
    const r = await d.call(path, { method: path === "/mcp" || path === "/feed-changed" ? "POST" : "GET", headers: { "content-type": "application/json" }, ...(path === "/mcp" || path === "/feed-changed" ? { body: '{"a":1}' } : {}) });
    assert.equal(r.status, 200, path);
    assert.equal(r.body, "<p>the directory</p>", path);
  }
  const sent = d.calls.filter((c) => c.kind === "directory").map((c) => c.target);
  assert.deepEqual(sent, [`${DIRECTORY}/search`, `${DIRECTORY}/search?q=persian+kitten&lang=ml`, `${DIRECTORY}/search/font.woff2`, `${DIRECTORY}/order`, `${DIRECTORY}/order?lang=hi`, `${DIRECTORY}/mcp`, `${DIRECTORY}/feed-changed`, `${DIRECTORY}/.well-known/agent-card.json`]);
  assert.ok(!d.calls.some((c) => c.kind === "slug" || c.kind === "local"), "fleet was not asked and no shop was reached");
  assert.deepEqual(["/search", "/search/x", "/order", "/order/", "/mcp", "/feed-changed", "/.well-known/agent-card.json"].map(isDirectoryPath), [true, true, true, true, true, true, true]);
  assert.deepEqual(["/searching", "/orders", "/mcp/x", "/feed-changed/x", "/.well-known/other", "/veena-salon/search"].map(isDirectoryPath), [false, false, false, false, false, false]);
});

test("a shop can never take these names here, even if fleet were to say a slug is active", async () => {
  const d = await door({ directoryUrl: DIRECTORY });
  for (const name of ["search", "order", "mcp"]) assert.equal((await d.call(`/${name}/`)).body, "<p>the directory</p>", name);
  assert.ok(!d.calls.some((c) => c.kind === "slug"));
  assert.equal((await d.call("/veena-salon/")).status, 200, "a real shop still works");
  assert.ok(d.calls.some((c) => c.kind === "slug" && c.target === "veena-salon"));
});

test("only what the directory needs is passed on: the visitor's address, language and type; never a cookie, Authorization or Origin; and it cannot set a cookie back", async () => {
  const d = await door({ directoryUrl: DIRECTORY });
  const r = await d.call("/search?q=x", { headers: { cookie: "__Secure-geo-owner=s1", authorization: "Bearer stolen", origin: "https://evil.example", "accept-language": "ml", accept: "application/json", "x-forwarded-for": "1.2.3.4, 203.0.113.9" } });
  const sent = d.calls.find((c) => c.kind === "directory")!;
  assert.deepEqual(Object.keys(sent.headers!).sort(), ["accept", "accept-language", "x-forwarded-for", "x-forwarded-proto"]);
  assert.equal(sent.headers!["x-forwarded-for"], "203.0.113.9", "the last entry, which Caddy appended");
  assert.equal(r.headers["set-cookie"], undefined);
  assert.equal(r.headers["referrer-policy"], "no-referrer", "the directory's own headers come back");
  assert.equal(r.headers["strict-transport-security"], "max-age=31536000");
});

test("a POST's body is passed on, and a body over 64 KB is refused before the directory sees it", async () => {
  const d = await door({ directoryUrl: DIRECTORY });
  const ok = await d.call("/feed-changed", { method: "POST", headers: { "content-type": "application/json" }, body: '{"format":"shop-feed-changed/1"}' });
  assert.equal(ok.status, 200);
  assert.equal(d.calls.find((c) => c.kind === "directory")!.body, '{"format":"shop-feed-changed/1"}');
  const big = await d.call("/mcp", { method: "POST", body: "x".repeat(70_000) });
  assert.equal(big.status, 413);
  assert.equal(d.calls.filter((c) => c.kind === "directory").length, 1);
});

test("a server with no directory, and the directory's own port, answer the friendly 404 for these names (no loop, no shop)", async () => {
  const none = await door();
  const r = await none.call("/search?q=x");
  assert.equal(r.status, 404);
  assert.equal(r.headers["x-geometer-nothing"], "1");
  const inner = await door({ directoryUrl: DIRECTORY, internal: true });
  assert.equal((await inner.call("/search")).status, 404);
  assert.ok(![...none.calls, ...inner.calls].some((c) => c.kind === "slug"), "never taken for a shop's name");
});

test("a directory that is down is a plain 'not answering' page, not a shop's", async () => {
  const d = await door({ directoryUrl: DIRECTORY, directoryDown: true });
  const r = await d.call("/search?q=x");
  assert.equal(r.status, 502);
  assert.equal(r.headers["retry-after"], "60");
});

test("the visitor's limit still applies to these paths, and an extra domain still redirects with the query kept", async () => {
  const d = await door({ directoryUrl: DIRECTORY });
  let last = 200;
  for (let i = 0; i < 245; i++) last = (await d.call("/order")).status;
  assert.equal(last, 429, "240 a minute for one visitor, as for every page");
  const redirect = await door({ directoryUrl: DIRECTORY });
  const r = await redirect.call("/search?q=kitten", { host: "old.example" });
  assert.deepEqual([r.status, r.headers.location], [301, "https://pages.example/search?q=kitten"]);
});

test("the directory's own port: no per-visitor limits, any Host is the pages domain, and a shop of this server is read like a visitor would", async () => {
  const d = await door({ directoryUrl: DIRECTORY, internal: true });
  let last = 200;
  for (let i = 0; i < 300; i++) last = (await d.call("/veena-salon/listings.json", { host: "door:8798" })).status;
  assert.equal(last, 200, "more than the visitors' 240 a minute from one address");
  assert.ok(d.calls.some((c) => c.kind === "local" && c.target === "http://inbox:8788/s/veena/listings.json"), "read from the inbox's front, as the shop's own address");
  assert.equal(DOOR_INTERNAL_PORT, 8798);
});

test("robots.txt keeps search results out of search engines but leaves the page that states the order findable", async () => {
  assert.ok(DOOR_ROBOTS_DISALLOW.includes("/search"));
  assert.ok(!DOOR_ROBOTS_DISALLOW.includes("/order"), "the owner's rule page is meant to be found");
});
