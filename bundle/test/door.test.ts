// The pages domain's front door (plan item 11f, bundle/services/door.ts): routing by slug and by stable page id, the extra domains, the pass-through to a
// builder's server (only a short list of headers back, the door's own no-script policy, no cookie, a redirect only onto the shop's own page, the owner's view
// sent to the builder's domain), the refusal of private and metadata addresses, fleet's answers kept through an outage, and nothing logged but the slug.
// Written 12 Nov 2026.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import type { IncomingHttpHeaders, Server } from "node:http";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { addressAllowed, doorHandler, fleetRegistry, guardedLookup, originProblem, passThroughPolicy } from "../services/door.ts";
import type { IdAnswer, SlugAnswer, Transport, Upstream } from "../services/door.ts";

const servers: Server[] = [];
after(() => { for (const s of servers) s.close(); });

const SLUGS: Record<string, SlugAnswer> = {
  "veena-salon": { state: "active", deployment_id: "partner-1", agent_id: "veena", hosting: "geometer", origin: "https://partners.example" },
  "ravi-cuts": { state: "active", deployment_id: "ravi-vps", agent_id: "ravi", hosting: "self", origin: "https://ravi.example" },
  "plain-http": { state: "active", deployment_id: "x-vps", agent_id: "x", hosting: "self", origin: "http://x.example" },
  "inside": { state: "active", deployment_id: "y-vps", agent_id: "y", hosting: "self", origin: "https://10.0.0.5" },
  "old-name": { state: "moved", to: "veena-salon" },
  "closed-shop": { state: "gone" },
};
const IDS: Record<string, IdAnswer> = { "k7m2qx9r4t": { state: "active", slug: "veena-salon" }, "s2s2s2s2s2": { state: "suspended" }, "g3g3g3g3g3": { state: "gone" } };

async function door(o: { remote?: (target: URL, init: Parameters<Transport>[1]) => Upstream; local?: (target: URL, init: Parameters<Transport>[1]) => Upstream; registryDown?: boolean } = {}) {
  const calls: { kind: "local" | "remote" | "slug" | "id"; target?: string; headers?: Record<string, string>; body?: string }[] = [];
  const logs: string[] = [];
  const local: Transport = async (target, init) => {
    calls.push({ kind: "local", target: target.href, headers: init.headers, ...(init.body ? { body: init.body.toString() } : {}) });
    if (o.local) return o.local(target, init);
    return { status: 200, headers: { "content-type": "text/html", "set-cookie": ["__Secure-geo-owner=abc; Path=/veena-salon/owner; HttpOnly; Secure; SameSite=Lax"], "content-security-policy": "default-src 'none'" }, body: Buffer.from("<p>our page</p>") };
  };
  const remote: Transport = async (target, init) => {
    calls.push({ kind: "remote", target: target.href, headers: init.headers, ...(init.body ? { body: init.body.toString() } : {}) });
    if (o.remote) return o.remote(target, init);
    return { status: 200, headers: { "content-type": "text/html", "set-cookie": ["track=1; Path=/"], "service-worker-allowed": "/", "access-control-allow-origin": "*", "content-security-policy": "script-src *", "clear-site-data": "\"cookies\"", "x-anything": "1" }, body: Buffer.from("<p>builder's page</p>") };
  };
  const handler = doorHandler({
    primary: "pages.example", extra: ["old.example"], deploymentId: "partner-1", localUrl: "http://inbox:8788", local, remote, log: (l) => logs.push(l),
    registry: {
      slug: async (s) => { calls.push({ kind: "slug", target: s }); return o.registryDown ? "unreachable" : SLUGS[s] ?? { state: "unknown" }; },
      id: async (i) => { calls.push({ kind: "id", target: i }); return IDS[i] ?? { state: "unknown" }; },
    },
  });
  const server = createServer(handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  const port = (server.address() as { port: number }).port;
  /** One request with the Host Caddy would pass on (fetch cannot set Host). */
  const call = (path: string, init: { method?: string; host?: string; headers?: Record<string, string>; body?: string } = {}) => new Promise<{ status: number; headers: IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method: init.method ?? "GET", headers: { host: init.host ?? "pages.example", "x-forwarded-for": "203.0.113.9", ...init.headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on("error", reject);
    req.end(init.body);
  });
  return { call, calls, logs };
}

test("the container's health check, by address and with no pages Host, is answered", async () => {
  const d = await door();
  const r = await d.call("/healthz", { host: "127.0.0.1:8797" });
  assert.deepEqual([r.status, r.body], [200, "ok"]);
  assert.equal((await d.call("/veena-salon/", { host: "127.0.0.1:8797" })).status, 404, "nothing else answers without the pages Host");
});

test("an extra domain redirects to the primary one with the path kept; another host gets nothing", async () => {
  const d = await door();
  const r = await d.call("/p/k7m2qx9r4t?x=1", { host: "old.example" });
  assert.equal(r.status, 301);
  assert.equal(r.headers.location, "https://pages.example/p/k7m2qx9r4t?x=1");
  assert.equal((await d.call("/veena-salon/", { host: "evil.example" })).status, 404);
});

test("/p/<id> always reaches the shop's current slug; a suspended id shows the suspended page and never another shop", async () => {
  const d = await door();
  const r = await d.call("/p/k7m2qx9r4t");
  assert.deepEqual([r.status, r.headers.location], [302, "https://pages.example/veena-salon/"]);
  assert.equal(r.headers["cache-control"], "no-store", "never cached: the slug behind an id may change");
  const s = await d.call("/p/s2s2s2s2s2");
  assert.equal(s.status, 410);
  assert.equal(s.headers.location, undefined);
  assert.match(s.body, /not available/u);
  assert.ok(!d.calls.some((c) => c.kind === "local" || c.kind === "remote"), "no shop's page was asked for");
  assert.equal((await d.call("/p/g3g3g3g3g3")).status, 410);
  const before = d.calls.filter((c) => c.kind === "id").length;
  assert.equal((await d.call("/p/0000000000")).status, 404, "not an id's letters");
  assert.equal(d.calls.filter((c) => c.kind === "id").length, before, "fleet is not asked about junk");
});

test("a shop on this server: forwarded to the inbox's front with the slug and the visitor's address; its own cookie comes back", async () => {
  const d = await door();
  const r = await d.call("/veena-salon/owner/in/abc?lang=hi", { headers: { cookie: "__Secure-geo-owner=s1", authorization: "Bearer stolen", "x-forwarded-for": "1.2.3.4, 203.0.113.9" } });
  assert.equal(r.status, 200);
  const c = d.calls.find((x) => x.kind === "local")!;
  assert.equal(c.target, "http://inbox:8788/s/veena/owner/in/abc?lang=hi");
  assert.equal(c.headers!["x-geometer-door"], "veena-salon");
  assert.equal(c.headers!["x-forwarded-for"], "203.0.113.9", "the last entry, Caddy's: what the visitor wrote before it is dropped");
  assert.equal(c.headers!.cookie, "__Secure-geo-owner=s1");
  assert.equal(c.headers!.authorization, undefined, "never passed on");
  assert.match(String(r.headers["set-cookie"]), /Path=\/veena-salon\/owner/u);
  assert.equal((await d.call("/veena-salon")).headers.location, "https://pages.example/veena-salon/");
  assert.equal((await d.call("/old-name/b/xyz")).headers.location, "https://pages.example/veena-salon/b/xyz", "a renamed slug moves visitors on");
  assert.equal((await d.call("/closed-shop/")).status, 410);
  assert.equal((await d.call("/nobody-here/")).status, 404);
});

test("a builder's client: a pure pass-through with only a short list of headers back, the door's no-script policy, and no cookie either way", async () => {
  const d = await door();
  const r = await d.call("/ravi-cuts/?lang=kn", { headers: { cookie: "__Secure-geo-owner=s1", "accept-language": "kn" } });
  assert.equal(r.status, 200);
  const c = d.calls.find((x) => x.kind === "remote")!;
  assert.equal(c.target, "https://ravi.example/s/ravi/?lang=kn");
  assert.equal(c.headers!.cookie, undefined, "an owner's cookie never goes to a builder's server");
  assert.equal(c.headers!["accept-language"], "kn");
  assert.equal(r.headers["set-cookie"], undefined);
  assert.equal(r.headers["service-worker-allowed"], undefined);
  assert.equal(r.headers["access-control-allow-origin"], undefined);
  assert.equal(r.headers["clear-site-data"], undefined);
  assert.equal(r.headers["x-anything"], undefined);
  assert.equal(r.headers["content-security-policy"], passThroughPolicy("pages.example", "ravi-cuts"));
  assert.match(String(r.headers["content-security-policy"]), /script-src 'none'/u);
  assert.match(String(r.headers["content-security-policy"]), /form-action https:\/\/pages\.example\/ravi-cuts\//u);
  assert.equal(r.headers["x-content-type-options"], "nosniff");
  assert.equal(r.body, "<p>builder's page</p>");
});

test("a builder's client: the owner's view is sent to the builder's own domain, never through the door", async () => {
  const d = await door();
  for (const path of ["/ravi-cuts/owner", "/ravi-cuts/owner/in/abc", "/ravi-cuts/o/token"]) {
    const r = await d.call(path, { method: "POST", body: "csrf=x" });
    assert.equal(r.status, 302, path);
    assert.equal(r.headers.location, `https://ravi.example/s/ravi${path.slice("/ravi-cuts".length)}`);
  }
  assert.ok(!d.calls.some((c) => c.kind === "remote"));
});

test("a builder's redirect may only stay on the shop's own page", async () => {
  const back = await door({ remote: () => ({ status: 303, headers: { location: "/s/ravi/b/h1?lang=en" }, body: Buffer.alloc(0) }) });
  assert.equal((await back.call("/ravi-cuts/book", { method: "POST", body: "x=1" })).headers.location, "https://pages.example/ravi-cuts/b/h1?lang=en");
  const off = await door({ remote: () => ({ status: 302, headers: { location: "https://phish.example/login" }, body: Buffer.alloc(0) }) });
  const r = await off.call("/ravi-cuts/");
  assert.equal(r.status, 502);
  assert.equal(r.headers.location, undefined);
  const other = await door({ remote: () => ({ status: 302, headers: { location: "https://pages.example/veena-salon/owner" }, body: Buffer.alloc(0) }) });
  assert.equal((await other.call("/ravi-cuts/")).status, 502, "not onto another shop's page either");
});

test("a builder's address must be https and a public name; the door refuses private, loopback and metadata addresses however the name resolves", async () => {
  const d = await door();
  assert.equal((await d.call("/plain-http/")).status, 502);
  assert.equal((await d.call("/inside/")).status, 502);
  assert.ok(!d.calls.some((c) => c.kind === "remote"), "never called");
  for (const ip of ["10.0.0.1", "127.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.1.1", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"]) assert.equal(addressAllowed(ip), false, ip);
  for (const ip of ["93.184.216.34", "2606:4700::1111"]) assert.equal(addressAllowed(ip), true, ip);
  for (const o of ["https://localhost", "https://a.internal", "https://[::1]", "https://u:p@ravi.example", "https://ravi.example/x"]) assert.ok(originProblem(o), o);
  assert.equal(originProblem("https://ravi.example:8443"), undefined);
  const resolveTo = (addresses: string[]) => guardedLookup((_h, _o, cb) => cb(null, addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }))));
  const ask = (lookup: ReturnType<typeof guardedLookup>) => new Promise<unknown>((resolve) => lookup("ravi.example", { all: true }, (err: unknown, a: unknown) => resolve(err ?? a)));
  assert.ok(await ask(resolveTo(["93.184.216.34", "10.0.0.1"])) instanceof Error, "one inside answer among good ones refuses the name");
  assert.ok(await ask(resolveTo(["169.254.169.254"])) instanceof Error);
  assert.deepEqual(await ask(resolveTo(["93.184.216.34"])), [{ address: "93.184.216.34", family: 4 }]);
});

test("nothing is logged but the slug and why: no path, no query, no body", async () => {
  const d = await door({ remote: () => { throw Object.assign(new Error("connect refused"), { code: "ECONNREFUSED" }); } });
  const r = await d.call("/ravi-cuts/book?phone=9811111111", { method: "POST", body: "name=Asha&phone=%2B919811111111&secret=s3cr3t" });
  assert.equal(r.status, 502);
  assert.ok(d.logs.length > 0);
  for (const l of d.logs) {
    assert.ok(l.includes("ravi-cuts"), l);
    assert.ok(!/book|phone|9811111111|Asha|s3cr3t|\?/u.test(l), l);
  }
});

test("fleet's answers are kept a minute, and a known answer is used through a fleet outage for up to a day", async () => {
  let t = 0;
  let up = true;
  let asked = 0;
  const reg = fleetRegistry({
    fleetUrl: "https://fleet.example", now: () => t,
    fetchImpl: (async () => { asked++; if (!up) throw new Error("down"); return new Response(JSON.stringify({ slug: "veena-salon", state: "active", deployment_id: "partner-1", agent_id: "veena", hosting: "geometer", origin: null }), { status: 200 }); }) as typeof fetch,
  });
  assert.equal((await reg.slug("veena-salon") as SlugAnswer).state, "active");
  t = 30_000;
  await reg.slug("veena-salon");
  assert.equal(asked, 1, "within the minute, fleet is not asked again");
  up = false;
  t = 2 * 60_000;
  assert.equal((await reg.slug("veena-salon") as SlugAnswer).state, "active", "fleet down: the known answer stands");
  t = 25 * 60 * 60_000;
  assert.equal(await reg.slug("veena-salon"), "unreachable", "but not for ever");
  const d = await door({ registryDown: true });
  assert.equal((await d.call("/veena-salon/")).status, 503);
});

test("the pages domain is never written in the code: no literal of the owner's domain in the bundle, modules or templates", () => {
  const word = ["adytum", "hub"].join(""); // built here, so this file does not hold it
  const root = new URL("../../", import.meta.url).pathname;
  const seen: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|json|yaml|yml|sh)$/u.test(name)) { seen.push(p); assert.ok(!readFileSync(p, "utf8").toLowerCase().includes(word), p); }
    }
  };
  for (const top of ["bundle", "modules", "templates"]) walk(join(root, top));
  assert.ok(seen.length > 100);
});

test("the owner's app (items 11d and 11e): a shop of this server keeps its own page's nonce policy; a builder's page never gets script; only the local owner's recording may be bigger", async () => {
  const ours = "default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-abc123'; worker-src https://pages.example/veena-salon/owner/sw.js";
  const d = await door({
    local: () => ({ status: 200, headers: { "content-type": "text/html", "content-security-policy": ours }, body: Buffer.from("<p>the owner's app</p>") }),
    remote: () => ({ status: 200, headers: { "content-type": "text/html", "content-security-policy": "script-src 'nonce-abc123'" }, body: Buffer.from("<script nonce=\"abc123\">x</script>") }),
  });
  assert.equal((await d.call("/veena-salon/owner/")).headers["content-security-policy"], ours, "our own front's policy, with its nonce, passes as it is");
  const builder = await d.call("/ravi-cuts/");
  assert.equal(builder.headers["content-security-policy"], passThroughPolicy("pages.example", "ravi-cuts"), "a builder's page asking for a nonce still gets the door's no-script policy");
  const recording = "x".repeat(150 * 1024);
  const sized = { "content-length": String(recording.length) };
  const voice = await d.call("/veena-salon/owner/voice", { method: "POST", headers: { "content-type": "audio/ogg", ...sized }, body: recording });
  assert.equal(voice.status, 200, "a recording up to the front's own limit reaches this server's front");
  assert.equal(d.calls.filter((c) => c.kind === "local").at(-1)!.body!.length, recording.length);
  assert.equal((await d.call("/veena-salon/book", { method: "POST", headers: sized, body: recording })).status, 413, "any other post keeps the small limit");
  assert.equal((await d.call("/ravi-cuts/owner/voice", { method: "POST", headers: sized, body: recording })).status, 302, "a builder's owner view is sent to its own domain, its body never read");
});

test("item 11h: service workers are ours only: a local shop's owner worker and a booking page's alerts worker pass with our policy; a builder's never reach the shared origin", async () => {
  const ownerWorker = "default-src 'none'; connect-src https://pages.example/veena-salon/owner/";
  const d = await door({
    local: (target) => ({ status: 200, headers: { "content-type": "text/javascript; charset=utf-8", "content-security-policy": target.pathname.includes("/owner/") ? ownerWorker : "default-src 'none'" }, body: Buffer.from("self.addEventListener('push', () => {});") }),
    remote: () => ({ status: 200, headers: { "content-type": "text/javascript", "service-worker-allowed": "/" }, body: Buffer.from("self.addEventListener('fetch', () => {});") }),
  });
  const owner = await d.call("/veena-salon/owner/sw.js");
  assert.equal(owner.status, 200);
  assert.equal(owner.headers["content-security-policy"], ownerWorker, "the owner's worker comes from our front, scoped to that shop's owner view");
  assert.equal((await d.call(`/veena-salon/b/${"A".repeat(32)}/sw.js`)).status, 200, "a booking page's alerts worker of this server passes too");
  for (const path of ["/ravi-cuts/sw.js", `/ravi-cuts/b/${"A".repeat(32)}/sw.js`, "/ravi-cuts/owner/sw.js"]) {
    const r = await d.call(path);
    assert.notEqual(r.status, 200, `${path}: no worker of a builder's server is served on the shared origin`);
    assert.equal(r.headers["service-worker-allowed"], undefined);
  }
  assert.ok(!d.calls.some((c) => c.kind === "remote" && c.target?.endsWith("/sw.js")), "the builder's server is not even asked for one");
  assert.match(passThroughPolicy("pages.example", "ravi-cuts"), /worker-src 'none'/u, "and a builder's page could not register one anyway");
});
