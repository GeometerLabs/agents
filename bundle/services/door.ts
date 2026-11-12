// The front door of the pages domain (plan item 11f, decision 44): https://<the pages domain>/<slug> for every shop that has a page there. It runs on Geometer's
// partner server only, as its own container (`door`, generate/compose.ts), behind Caddy's site block for the pages domain and its extra domains. It holds no
// secret and keeps nothing but a minute's memory of fleet's answers.
//
//   GET  /                        a short page: what this domain is
//   GET  /robots.txt              Disallow: /*/owner (an owner's page is nobody's search result)
//   GET  /healthz                 the process is up
//   GET  /p/<id>                  the shop's STABLE page address (QR codes carry it): redirected to its current slug; "suspended" or "gone" otherwise
//   ...  /<slug>[/<rest>]         the shop's page. A shop on this server: forwarded to the inbox's front as /s/<shop>/<rest>, with `x-geometer-door: <slug>`.
//                                 A builder's client: the customer view, the API and MCP forwarded to https://<their server>/s/<shop>/<rest> as a pure
//                                 pass-through; the owner's view (/owner..., /o/...) redirected to their own domain, so no owner sign-in crosses this door.
//   any host that is an extra domain: redirected to the primary domain, the path kept (an old or a country domain keeps every printed link working).
//
// The pages domain is never written in code: the primary and the extra domains are this service's config (geometer.json `pages`). Fleet's slug registry
// (monorepo apps/fleet, `GET /v1/page-slugs/<slug>` and `GET /v1/page-ids/<id>`) says where each slug lives; its answer is public, so the door needs no key.
//
// Going out to a builder's server, which a builder names (through their heartbeat's panel address), is the one risky thing here, so it is narrow: https only, a
// DNS name (never an IP address), the name resolved here and REFUSED when any answer is a loopback, private, link-local (the cloud metadata address), CGNAT,
// multicast, reserved or unspecified address, connected to the address checked, no redirect followed, bodies capped, nothing cached, nothing logged but the slug
// and the status. What comes back passes through a short list of headers; the door sets its own content policy (no script), so a builder's page can never run
// script on the shared origin, set a cookie there, or register a service worker (bundle/Explanation.md, "One origin for every shop").
import { createServer, request as httpRequest } from "node:http";
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import { request as httpsRequest } from "node:https";
import { lookup as dnsLookup } from "node:dns";
import type { LookupAddress } from "node:dns";
import { BlockList, isIP } from "node:net";
import { readFileSync } from "node:fs";

export const DOOR_PORT = 8797;
export const DOOR_HEADER = "x-geometer-door";
/** A request body passed on: the front's forms are 4 KB and its JSON 16 KB; anything bigger is not one of them. */
export const MAX_REQUEST_BYTES = 64 * 1024;
/** A page passed back: the booking page is tens of KB; a builder's server that sends more is cut off, not streamed for ever. */
export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

/** The same shape as fleet's rule (page-slugs.ts slugCheck), without the reserved list: fleet answers "unknown" for those, and this only spares fleet the junk. */
export const SLUG = /^(?!.*--)(?![0-9]+$)[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/u;
/** Fleet's page id alphabet and length (page-slugs.ts PAGE_ID). */
export const PAGE_ID = /^[23456789abcdefghjkmnpqrstuvwxyz]{10}$/u;

// ---- the addresses a builder's server may never resolve to ----------------------------------------------------------------------------------------------

const BLOCKED = new BlockList();
for (const [net, bits] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]] as const) BLOCKED.addSubnet(net, bits, "ipv4");
for (const [net, bits] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8], ["64:ff9b::", 96], ["100::", 64], ["2001:db8::", 32], ["2001::", 23]] as const) BLOCKED.addSubnet(net, bits, "ipv6");

/** May the door connect to this address? Only a public unicast one. An IPv4 address written inside IPv6 (::ffff:a.b.c.d) is judged as the IPv4 address. */
export function addressAllowed(ip: string): boolean {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/iu.exec(ip);
  if (mapped) return addressAllowed(mapped[1]);
  const family = isIP(ip);
  if (family === 4) return !BLOCKED.check(ip, "ipv4");
  if (family === 6) return !BLOCKED.check(ip, "ipv6");
  return false;
}

/** Why fleet's origin for a builder's server is not one the door will call, or undefined. https, a DNS name with a dot, no user, path, query or fragment. */
export function originProblem(origin: unknown): string | undefined {
  if (typeof origin !== "string") return "no address";
  let u: URL;
  try { u = new URL(origin); } catch { return "not an address"; }
  if (u.protocol !== "https:") return "not https";
  if (u.username || u.password || (u.pathname !== "/" && u.pathname !== "") || u.search || u.hash) return "more than an origin";
  const host = u.hostname.replace(/^\[|\]$/gu, "");
  if (isIP(host) !== 0) return "an IP address, not a name";
  if (!host.includes(".") || /\.(localhost|local|internal|home|lan|arpa)$/iu.test(host) || host === "localhost") return "not a public name";
  return undefined;
}

type Lookup = (hostname: string, options: { all: true; verbatim?: boolean }, cb: (err: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void) => void;
/**
 * The `lookup` the outgoing request uses: the name is resolved HERE, and refused when ANY answer is not allowed (one bad answer among good ones is how a name is
 * pointed at the inside, so it is not picked around). The connection then goes to an address this function checked, so a second, different answer cannot slip in.
 */
export function guardedLookup(resolve: Lookup = dnsLookup as unknown as Lookup) {
  return (hostname: string, options: { all?: boolean } | number, cb: (...a: unknown[]) => void): void => {
    resolve(hostname, { all: true, verbatim: true }, (err, addresses) => {
      if (err) return cb(err);
      if (addresses.length === 0 || addresses.some((a) => !addressAllowed(a.address))) {
        const e = Object.assign(new Error(`${hostname} resolves to an address the door does not call`), { code: "EDOORREFUSED" });
        return cb(e);
      }
      if (typeof options === "object" && options.all) return cb(null, addresses);
      return cb(null, addresses[0].address, addresses[0].family);
    });
  };
}

// ---- fleet's answers, kept a minute ---------------------------------------------------------------------------------------------------------------------

export type SlugAnswer =
  | { state: "active"; deployment_id: string; agent_id: string; hosting: string; origin: string | null }
  | { state: "moved"; to: string } | { state: "gone" } | { state: "unknown" };
export type IdAnswer = { state: "active"; slug: string } | { state: "suspended" } | { state: "gone" } | { state: "unknown" };
export interface Registry { slug(slug: string): Promise<SlugAnswer | "unreachable">; id(id: string): Promise<IdAnswer | "unreachable"> }

/**
 * Fleet's public lookups with a short memory: an answer is used for FRESH_MS (unknown and gone for UNKNOWN_MS), and when fleet cannot be reached a known answer
 * is used for up to STALE_MS, so the partners' shop pages do not go down with fleet. At most MAX_KEPT answers are kept (the oldest go first).
 */
export function fleetRegistry(o: { fleetUrl: string; fetchImpl?: typeof fetch; now?: () => number; freshMs?: number; unknownMs?: number; staleMs?: number; maxKept?: number }): Registry {
  const fetchImpl = o.fetchImpl ?? fetch;
  const now = o.now ?? Date.now;
  const fresh = o.freshMs ?? 60_000;
  const unknown = o.unknownMs ?? 30_000;
  const stale = o.staleMs ?? 24 * 60 * 60_000;
  const max = o.maxKept ?? 10_000;
  const kept = new Map<string, { answer: { state: string }; at: number }>();
  const base = o.fleetUrl.replace(/\/+$/u, "");
  async function get<T extends { state: string }>(key: string, path: string): Promise<T | "unreachable"> {
    const hit = kept.get(key);
    const t = now();
    if (hit && t - hit.at < (hit.answer.state === "active" || hit.answer.state === "moved" ? fresh : unknown)) return hit.answer as T;
    try {
      const r = await fetchImpl(`${base}${path}`, { signal: AbortSignal.timeout(3_000), headers: { accept: "application/json" } });
      if (r.status !== 200 && r.status !== 404) throw new Error(`fleet answered ${r.status}`);
      const answer = await r.json() as T;
      if (typeof answer?.state !== "string") throw new Error("fleet's answer had no state");
      kept.delete(key);
      kept.set(key, { answer, at: t });
      if (kept.size > max) kept.delete(kept.keys().next().value as string);
      return answer;
    } catch {
      return hit && t - hit.at < stale ? hit.answer as T : "unreachable";
    }
  }
  return {
    slug: (slug) => get<SlugAnswer>(`s:${slug}`, `/v1/page-slugs/${slug}`),
    id: (id) => get<IdAnswer>(`p:${id}`, `/v1/page-ids/${id}`),
  };
}

// ---- forwarding -------------------------------------------------------------------------------------------------------------------------------------------

export interface Upstream { status: number; headers: IncomingHttpHeaders; body: Buffer }
export type Transport = (target: URL, init: { method: string; headers: Record<string, string>; body?: Buffer; timeoutMs: number }) => Promise<Upstream>;

/** http(s).request, the body read whole (capped), no redirect followed. `lookup` is the guarded one for a builder's server. */
export function nodeTransport(lookup?: ReturnType<typeof guardedLookup>): Transport {
  return (target, init) => new Promise((resolve, reject) => {
    const req = (target.protocol === "https:" ? httpsRequest : httpRequest)(target, { method: init.method, headers: init.headers, timeout: init.timeoutMs, ...(lookup ? { lookup: lookup as never } : {}) }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (c: Buffer) => { size += c.length; if (size > MAX_RESPONSE_BYTES) { res.destroy(); reject(new Error("the answer was too big")); return; } chunks.push(c); });
      res.on("end", () => resolve({ status: res.statusCode ?? 502, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("timed out")));
    req.on("error", reject);
    if (init.body) req.end(init.body); else req.end();
  });
}

/** Headers a visitor's request may carry on: what the shop's front reads, nothing else (never Authorization, never a forwarded-for the visitor wrote). */
const REQUEST_HEADERS = ["accept", "accept-language", "content-type", "origin", "if-none-match"];
/** For a shop on this server only: the owner's cookie and the form token of a JSON answer (a builder's server never sees an owner's request through here). */
const LOCAL_ONLY_HEADERS = ["cookie", "x-owner-csrf"];
/** What a builder's server may say back, and nothing more. */
const RESPONSE_HEADERS = ["content-type", "content-length", "cache-control", "etag", "last-modified", "retry-after", "allow", "content-language", "x-robots-tag"];
const HOP_BY_HOP = new Set(["connection", "keep-alive", "transfer-encoding", "upgrade", "proxy-connection", "te", "trailer"]);

export interface DoorOptions {
  /** The pages domain new links use (the first of geometer.json's `pages`). */
  primary: string;
  /** Domains the door still answers for, by redirecting to the primary. */
  extra: string[];
  /** This server's id at fleet: a slug that fleet places on this deployment is served from here. */
  deploymentId: string;
  registry: Registry;
  /** The inbox's front, where this server's shops are: http://inbox:8788. */
  localUrl: string;
  /** How to reach this server's front (plain http on the private network) and a builder's server (https, guarded). Tests give their own. */
  local?: Transport;
  remote?: Transport;
  log?: (line: string) => void;
  now?: () => number;
}

const PAGE_CSS = "body{margin:0;font:17px/1.5 system-ui,sans-serif;color:#10231a}main{max-width:32rem;margin:0 auto;padding:32px 16px}";
const pageOf = (title: string, text: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${PAGE_CSS}</style></head><body><main><h1>${title}</h1><p>${text}</p></main></body></html>`;
/** The door's own pages: no script, nothing loaded, never framed. */
const OWN_POLICY = "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
/** What a builder's page gets on the shared origin, whatever it asked for: no script, no worker, forms and fetches only to its own slug, never framed. */
export const passThroughPolicy = (primary: string, slug: string) => `default-src 'none'; script-src 'none'; worker-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action https://${primary}/${slug}/; connect-src 'none'; frame-ancestors 'none'; base-uri 'none'`;
const HSTS = "max-age=31536000";

/** The visitor's address as Caddy saw it: the LAST X-Forwarded-For entry (Caddy appends it; anything before it is the visitor's own claim). */
const visitorOf = (req: IncomingMessage): string => String(req.headers["x-forwarded-for"] ?? "").split(",").map((x) => x.trim()).filter(Boolean).at(-1) ?? req.socket.remoteAddress ?? "unknown";

/** A visitor's requests at the door: generous for pages (a booking takes a few), tight for unknown names (someone guessing slugs or ids costs fleet). */
const LIMITS = { all: { max: 240, perMs: 60_000 }, posts: { max: 40, perMs: 10 * 60_000 }, unknown: { max: 30, perMs: 60 * 60_000 } } as const;
function doorLimiter(now: () => number) {
  const seen = new Map<string, number[]>();
  let swept = 0;
  const within = (kind: keyof typeof LIMITS, who: string, t: number) => (seen.get(`${kind} ${who}`) ?? []).filter((x) => t - x < LIMITS[kind].perMs);
  return {
    /** One more of this kind now, if the visitor is under the limit (and it is counted). */
    take(kind: keyof typeof LIMITS, who: string): boolean {
      const t = now();
      if (t - swept > 60_000) { swept = t; for (const [k, v] of seen) { const keep = v.filter((x) => t - x < LIMITS[k.split(" ")[0] as keyof typeof LIMITS].perMs); if (keep.length) seen.set(k, keep); else seen.delete(k); } }
      const times = within(kind, who, t);
      if (times.length >= LIMITS[kind].max) { seen.set(`${kind} ${who}`, times); return false; }
      times.push(t); seen.set(`${kind} ${who}`, times); return true;
    },
    /** Only look: is the visitor at the limit already? (Unknown names are counted after the answer, and looked at before asking fleet.) */
    over: (kind: keyof typeof LIMITS, who: string): boolean => within(kind, who, now()).length >= LIMITS[kind].max,
  };
}

function readRequestBody(req: IncomingMessage): Promise<Buffer | "too_big"> {
  return new Promise((resolve, reject) => {
    if (Number(req.headers["content-length"] ?? 0) > MAX_REQUEST_BYTES) { resolve("too_big"); return; }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => { size += c.length; if (size > MAX_REQUEST_BYTES) { resolve("too_big"); req.destroy(); return; } chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** The door as one request handler. */
export function doorHandler(o: DoorOptions): (req: IncomingMessage, res: ServerResponse) => void {
  const log = o.log ?? (() => undefined);
  const now = o.now ?? Date.now;
  const limits = doorLimiter(now);
  const take = limits.take;
  const local = o.local ?? nodeTransport();
  const remote = o.remote ?? nodeTransport(guardedLookup());
  const primaryOrigin = `https://${o.primary}`;

  const own = (res: ServerResponse, status: number, body: string, type = "text/html; charset=utf-8", extra: Record<string, string> = {}) => {
    res.writeHead(status, { "content-type": type, "content-length": Buffer.byteLength(body), "content-security-policy": OWN_POLICY, "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "strict-transport-security": HSTS, "cache-control": "no-store", ...extra });
    res.end(body);
  };
  const go = (res: ServerResponse, status: 301 | 302 | 303, location: string) => { res.writeHead(status, { location, "cache-control": status === 301 ? "public, max-age=3600" : "no-store", "strict-transport-security": HSTS }); res.end(); };
  const nothing = (res: ServerResponse, status = 404) => own(res, status, pageOf("There is no shop page here", "Check the address, or ask the shop for its link."));
  const gone = (res: ServerResponse) => own(res, 410, pageOf("This shop page is closed", "The shop no longer has a page at this address."));
  const suspended = (res: ServerResponse) => own(res, 410, pageOf("This shop page is not available", "It has been taken down while a report about it is looked at."));
  const unreachable = (res: ServerResponse) => own(res, 503, pageOf("Shop pages are not reachable just now", "Please try again in a few minutes."), "text/html; charset=utf-8", { "retry-after": "120" });

  /** Pass a request on and its answer back. `local`: this server's own front (our code: its headers pass); otherwise a builder's server (a short list passes). */
  async function forward(req: IncomingMessage, res: ServerResponse, a: { target: URL; slug: string; local: boolean; visitor: string; body?: Buffer }): Promise<void> {
    const headers: Record<string, string> = { [DOOR_HEADER]: a.slug, "x-forwarded-for": a.visitor, "x-forwarded-proto": "https" };
    for (const h of [...REQUEST_HEADERS, ...(a.local ? LOCAL_ONLY_HEADERS : [])]) { const v = req.headers[h]; if (typeof v === "string") headers[h] = v; }
    if (a.body) headers["content-length"] = String(a.body.length);
    let up: Upstream;
    try {
      up = await (a.local ? local : remote)(a.target, { method: req.method ?? "GET", headers, ...(a.body ? { body: a.body } : {}), timeoutMs: 10_000 });
    } catch (e) {
      log(`door: ${a.slug} could not be reached (${(e as { code?: string }).code ?? "error"})`); // the slug and why, never the path or the visitor
      return own(res, 502, pageOf("This shop's page is not answering", "Please try again in a few minutes."), "text/html; charset=utf-8", { "retry-after": "60" });
    }
    const out: Record<string, string | string[]> = {};
    if (a.local) {
      for (const [k, v] of Object.entries(up.headers)) if (v !== undefined && !HOP_BY_HOP.has(k)) out[k] = v;
    } else {
      for (const k of RESPONSE_HEADERS) { const v = up.headers[k]; if (typeof v === "string") out[k] = v; }
      out["content-security-policy"] = passThroughPolicy(o.primary, a.slug);
      out["x-content-type-options"] = "nosniff";
      out["referrer-policy"] = "no-referrer";
      if (!out["cache-control"]) out["cache-control"] = "no-store";
      // a redirect may only stay on this shop's own page: its server's own address is rewritten to the pages address, anything else is refused
      const location = up.headers.location;
      if (typeof location === "string") {
        const rewritten = rewriteLocation(location, a.target, a.slug);
        if (!rewritten) { log(`door: ${a.slug} redirected off its own page; refused`); return own(res, 502, pageOf("This shop's page is not answering", "Please try again in a few minutes.")); }
        out.location = rewritten;
      }
    }
    out["strict-transport-security"] = HSTS;
    out["content-length"] = String(up.body.length);
    res.writeHead(up.status, out);
    res.end(req.method === "HEAD" ? undefined : up.body);
    if (up.status >= 500) log(`door: ${a.slug} answered ${up.status}`);
  }

  /** A builder's server's Location, kept only when it stays on the shop's page: its own /s/<shop>/... becomes https://<primary>/<slug>/... */
  function rewriteLocation(location: string, target: URL, slug: string): string | undefined {
    let u: URL;
    try { u = new URL(location, target); } catch { return undefined; }
    const shopPath = target.pathname.match(/^\/s\/[^/]+/u)?.[0];
    const mine = `${primaryOrigin}/${slug}`;
    if (u.origin === target.origin && shopPath && (u.pathname === shopPath || u.pathname.startsWith(`${shopPath}/`))) return `${mine}${u.pathname.slice(shopPath.length)}${u.search}`;
    if (u.origin === primaryOrigin && (u.pathname === `/${slug}` || u.pathname.startsWith(`/${slug}/`))) return u.href;
    return undefined;
  }

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const host = String(req.headers.host ?? "").toLowerCase().replace(/:\d+$/u, "");
    const url = new URL(req.url ?? "/", primaryOrigin);
    const method = req.method ?? "GET";
    // an extra domain: the same path on the primary one, so old printed links and codes keep working after a domain change
    if (o.extra.includes(host)) return go(res, 301, `${primaryOrigin}${url.pathname}${url.search}`);
    if (host !== o.primary) return nothing(res);
    if (url.pathname === "/healthz") return own(res, 200, "ok", "text/plain; charset=utf-8");
    if (method !== "GET" && method !== "HEAD" && method !== "POST") return own(res, 405, pageOf("Not here", "Use the page's links and buttons."), "text/html; charset=utf-8", { allow: "GET, HEAD, POST" });
    if (url.pathname === "/robots.txt") return own(res, 200, "User-agent: *\nDisallow: /*/owner\nDisallow: /*/o/\n", "text/plain; charset=utf-8", { "cache-control": "public, max-age=3600" });
    if (url.pathname === "/") return own(res, 200, pageOf("Shop pages", "Each shop's page is at its own short name, like /veena-salon. Shops set theirs up with their local partner."), "text/html; charset=utf-8", { "cache-control": "public, max-age=3600" });
    const visitor = visitorOf(req);
    if (!take("all", visitor)) return own(res, 429, pageOf("Too many requests", "Please wait a minute."), "text/html; charset=utf-8", { "retry-after": "60" });

    // the stable page address: always the shop's current slug, never another shop's
    const p = /^\/p\/([^/]+)\/?$/u.exec(url.pathname);
    if (p) {
      if (limits.over("unknown", visitor)) return own(res, 429, pageOf("Too many requests", "Please wait a while."), "text/html; charset=utf-8", { "retry-after": "600" });
      if (!PAGE_ID.test(p[1])) { take("unknown", visitor); return nothing(res); }
      const a = await o.registry.id(p[1]);
      if (a === "unreachable") return unreachable(res);
      // 302, not 301: the slug behind an id may change, and the browser must ask again next time
      if (a.state === "active") return go(res, 302, `${primaryOrigin}/${a.slug}/${url.search}`);
      if (a.state === "suspended") return suspended(res);
      if (a.state === "gone") return gone(res);
      take("unknown", visitor);
      return nothing(res);
    }

    const m = /^\/([^/]+)(\/.*)?$/u.exec(url.pathname);
    if (limits.over("unknown", visitor)) return own(res, 429, pageOf("Too many requests", "Please wait a while."), "text/html; charset=utf-8", { "retry-after": "600" });
    if (!m || !SLUG.test(m[1])) { take("unknown", visitor); return nothing(res); }
    const slug = m[1];
    const rest = m[2] ?? "";
    if (rest === "") return go(res, 301, `${primaryOrigin}/${slug}/${url.search}`);
    const a = await o.registry.slug(slug);
    if (a === "unreachable") return unreachable(res);
    if (a.state === "unknown") { take("unknown", visitor); return nothing(res); }
    if (a.state === "gone") return gone(res);
    if (a.state === "moved") return go(res, 301, `${primaryOrigin}/${a.to}${rest}${url.search}`);

    if (method === "POST" && !take("posts", visitor)) return own(res, 429, pageOf("Too many requests", "Please wait a few minutes."), "text/html; charset=utf-8", { "retry-after": "300" });
    const isLocal = a.deployment_id === o.deploymentId;
    const shopPath = `/s/${encodeURIComponent(a.agent_id)}${rest}${url.search}`;
    if (!isLocal) {
      const problem = originProblem(a.origin);
      if (problem) { log(`door: ${slug} has no address the door will call (${problem})`); return own(res, 502, pageOf("This shop's page is not answering", "Please try again later.")); }
      // the owner's view of a builder's client lives on the builder's own domain: no owner sign-in or session ever crosses this door
      if (/^\/(owner|o)(\/|$)/u.test(rest)) return go(res, 302, `${a.origin}${shopPath}`);
    }
    let body: Buffer | undefined;
    if (method === "POST") {
      const read = await readRequestBody(req);
      if (read === "too_big") return own(res, 413, pageOf("Too big", "That is more than a shop's page takes."));
      body = read;
    }
    const target = new URL(shopPath, isLocal ? o.localUrl : a.origin!);
    return forward(req, res, { target, slug, local: isLocal, visitor, ...(body ? { body } : {}) });
  }

  return (req, res) => {
    route(req, res).catch((e) => {
      log(`door: a request could not be answered (${(e as Error).name})`);
      if (!res.headersSent) own(res, 500, pageOf("Something went wrong", "Please try again."));
    });
  };
}

/** The door's config file (generate/configs.ts doorConfig writes it): the domains, this server's id at fleet, fleet's address and the inbox's front. */
export interface DoorConfig { primary: string; extra: string[]; deploymentId: string; fleetUrl: string; localUrl: string }

if (import.meta.main) {
  const config = JSON.parse(readFileSync(process.env.CONFIG ?? "/etc/geometer/door.json", "utf8")) as DoorConfig;
  const server = createServer(doorHandler({ ...config, registry: fleetRegistry({ fleetUrl: config.fleetUrl }), log: (line) => console.error(line) }));
  server.requestTimeout = 15_000;
  server.headersTimeout = 5_000;
  server.listen(Number(process.env.PORT ?? DOOR_PORT), process.env.HOST ?? "127.0.0.1", () => console.error(`The front door listens for ${[config.primary, ...config.extra].join(", ")}.`));
}
