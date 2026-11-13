// The REAL Caddy (caddy:2.8.4-alpine, the image the partner server runs) in front of the REAL door, serving a small Streetlist build: every row of the path matrix of
// before-launch item 6 (the clean URLs, the redirects, the headers and cache rules of firebase.json, the friendly 404, robots.txt, and the paths that must reach the door).
// Text goldens cannot show that Caddy behaves as the generated file says, so this does. It needs Docker and the image; it runs only when REAL_CADDY=1 (one container,
// a few seconds) and says so when it does not. Written 14 Nov 2026.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPack, homePaths, installHome } from "../lib/home.ts";
import { CADDY_IMAGE } from "../lib/server.ts";
import { pagesSites } from "../generate/compose.ts";
import { doorHandler } from "../services/door.ts";
import { WHATSAPP_LINE } from "../services/card-page.ts";

const ON = process.env.REAL_CADDY === "1";
const PORT = 18080 + (process.pid % 500);
const text = (s: string) => Buffer.from(s);
const build = (marker: string) => buildPack([
  { path: "index.html", data: text(`<p>HOME ${marker}</p>`) }, { path: "404.html", data: text("<p>STREETLIST-404</p>") }, { path: "shops.html", data: text("<p>SHOPS</p>") },
  { path: "partners.html", data: text("<p>PARTNERS</p>") }, { path: "privacy.html", data: text("<p>PRIVACY</p>") }, { path: "examples/glow-salon.html", data: text("<p>GLOW</p>") },
  { path: "assets/main-Ab_1.js", data: text("console.log('" + "x".repeat(2000) + "')") }, { path: "favicon.svg", data: text("<svg/>") },
  { path: "robots.txt", data: text("User-agent: *\nAllow: /\nDisallow: /examples/\n") },
], "5f49032");

let doorServer: Server; let container = ""; let dir = ""; let base = "";
const doorPort = 19000 + (process.pid % 500);

before(async () => {
  if (!ON) return;
  dir = mkdtempSync(join(tmpdir(), "geo-caddy-"));
  const handler = doorHandler({
    primary: "localhost", extra: [], deploymentId: "partner-1", localUrl: "http://inbox:8788",
    local: async () => ({ status: 200, headers: { "content-type": "text/html" }, body: Buffer.from("<p>our page</p>") }),
    remote: async () => ({ status: 200, headers: {}, body: Buffer.from("") }),
    registry: {
      slug: async (s) => s === "veena-salon" ? { state: "active", deployment_id: "partner-1", agent_id: "veena", hosting: "geometer", origin: "https://p.example" } : { state: "unknown" },
      id: async (i) => i === "k7m2qx9r4t" ? { state: "active", slug: "veena-salon" } : { state: "unknown" },
      card: async (h) => h === "asha-digital" ? { state: "active", handle: "asha-digital", name: "Asha", intro: "Hi", face: { style: "clay", svg: "<svg xmlns=\"http://www.w3.org/2000/svg\"><circle r=\"4\"/></svg>" }, area: "Palayam", languages: ["en"], whatsapp: "919876543210", services: [], shop_count: 0, shops: [] } : { state: "unknown" },
    },
  });
  doorServer = createServer(handler);
  await new Promise<void>((r) => doorServer.listen(doorPort, "0.0.0.0", r));
  // the generated site block for a pages domain "localhost", on plain http for the test (no certificate), with the door where the container can reach it
  const site = pagesSites({ domain: "http://localhost", extraDomains: [] }).join("\n").replaceAll("door:8797", `host.docker.internal:${doorPort}`);
  writeFileSync(join(dir, "Caddyfile"), `{\n\tadmin off\n\tauto_https off\n}\n\n${site}\n`);
  installHome(dir, build("one").bytes);
  execFileSync("docker", ["run", "--rm", "-v", `${join(dir, "Caddyfile")}:/etc/caddy/Caddyfile:ro`, CADDY_IMAGE, "caddy", "validate", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"], { stdio: "pipe" });
  container = execFileSync("docker", ["run", "-d", "--rm", "--add-host", "host.docker.internal:host-gateway", "-p", `${PORT}:80`, "-v", `${join(dir, "Caddyfile")}:/etc/caddy/Caddyfile:ro`, "-v", `${join(dir, "home")}:/srv/home:ro`, CADDY_IMAGE], { encoding: "utf8" }).trim();
  base = `http://localhost:${PORT}`;
  for (let i = 0; i < 50; i++) { try { await fetch(`${base}/robots.txt`); break; } catch { await new Promise((r) => setTimeout(r, 200)); } }
});
after(() => { if (container) execFileSync("docker", ["rm", "-f", container], { stdio: "ignore" }); doorServer?.close(); });

/** Wait for a page to show a marker. On Linux a switched link shows at once; Docker Desktop's file sharing on a Mac may keep the old link for a moment (checked: it is the sharing layer, not Caddy). */
const shows = async (path: string, marker: string): Promise<boolean> => { for (let i = 0; i < 40; i++) { if ((await get(path)).body.includes(marker)) return true; await new Promise((r) => setTimeout(r, 250)); } return false; };
const get = async (path: string, init: RequestInit = {}) => { const r = await fetch(`${base}${path}`, { redirect: "manual", ...init }); return { status: r.status, h: r.headers, body: await r.text() }; };
const SECURITY = { "x-content-type-options": "nosniff", "referrer-policy": "strict-origin-when-cross-origin", "x-frame-options": "DENY", "cross-origin-opener-policy": "same-origin" };

test("Caddy validates the generated pages site, and serves the home's pages with firebase.json's headers", { skip: !ON && "REAL_CADDY=1 not set (needs Docker and the caddy image)" }, async () => {
  for (const [path, marker] of [["/", "HOME one"], ["/shops", "SHOPS"], ["/partners", "PARTNERS"], ["/privacy", "PRIVACY"], ["/examples/glow-salon", "GLOW"]] as const) {
    const r = await get(path);
    assert.equal(r.status, 200, path);
    assert.ok(r.body.includes(marker), `${path}: ${r.body}`);
    assert.match(r.h.get("content-security-policy") ?? "", /^default-src 'none'; script-src 'self'/u, path);
    assert.equal(r.h.get("cache-control"), "no-cache", path);
    for (const [k, v] of Object.entries(SECURITY)) assert.equal(r.h.get(k), v, `${path} ${k}`);
    assert.equal(r.h.get("permissions-policy"), "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
    assert.equal(r.h.get("strict-transport-security"), "max-age=31536000");
  }
});

test("assets: a year, immutable, no page policy, the security headers, compressed; a missing one is the 404 page and is not cached for a year", { skip: !ON && "REAL_CADDY=1 not set" }, async () => {
  const a = await get("/assets/main-Ab_1.js", { headers: { "accept-encoding": "gzip" } });
  assert.equal(a.status, 200);
  assert.equal(a.h.get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal(a.h.get("content-security-policy"), null);
  assert.equal(a.h.get("x-frame-options"), "DENY");
  assert.equal(a.h.get("content-encoding"), "gzip", "Firebase compresses; so does this");
  const miss = await get("/assets/missing.js");
  assert.equal(miss.status, 404);
  assert.ok(miss.body.includes("STREETLIST-404"));
  assert.equal(miss.h.get("cache-control"), "no-cache");
  assert.equal((await get("/favicon.svg")).status, 200);
});

test("clean URLs, trailing slash and /examples behave as on Firebase: one clean address, 301 from the others, 302 for /examples", { skip: !ON && "REAL_CADDY=1 not set" }, async () => {
  const to = async (path: string, status: number, location: string) => { const r = await get(path); assert.equal(r.status, status, path); assert.equal(r.h.get("location"), location, path); };
  await to("/shops.html", 301, "/shops"); await to("/partners.html", 301, "/partners"); await to("/privacy.html", 301, "/privacy"); await to("/index.html", 301, "/");
  await to("/examples/glow-salon.html", 301, "/examples/glow-salon");
  await to("/shops/", 301, "/shops"); await to("/partners/", 301, "/partners"); await to("/examples/", 301, "/examples"); await to("/examples/glow-salon/", 301, "/examples/glow-salon");
  await to("/examples", 302, "/examples/glow-salon");
});

test("what is missing under the home's own addresses is the 404 page (status 404), never a listing or the door", { skip: !ON && "REAL_CADDY=1 not set" }, async () => {
  for (const path of ["/examples/nope", "/assets", "/assets/", "/assets/sub/x.js"]) {
    const r = await get(path);
    assert.equal(r.status, 404, path);
    assert.ok(r.body.includes("STREETLIST-404"), `${path}: ${r.body}`);
    assert.ok(!r.body.includes("Index of"), path);
    assert.equal(r.h.get("x-frame-options"), "DENY", path);
  }
});

test("robots.txt is one merged answer (the door's disallowed paths and the home's)", { skip: !ON && "REAL_CADDY=1 not set" }, async () => {
  const r = await get("/robots.txt");
  assert.equal(r.status, 200);
  assert.match(r.h.get("content-type") ?? "", /^text\/plain/u);
  for (const line of ["Disallow: /*/owner", "Disallow: /*/o/", "Disallow: /*/fee/", "Disallow: /*/order/", "Disallow: /examples/"]) assert.ok(r.body.includes(line), line);
});

test("everything else goes to the door unchanged: a shop's page, /p/<id>, /@handle, an unknown name (with the home's 404 page), a POST on a page", { skip: !ON && "REAL_CADDY=1 not set" }, async () => {
  const shop = await get("/veena-salon/");
  assert.equal(shop.status, 200); assert.ok(shop.body.includes("our page"));
  assert.equal(shop.h.get("x-frame-options"), null, "the shop's page keeps the door's own headers, not the home's");
  const bare = await get("/veena-salon");
  assert.equal(bare.status, 301); assert.equal(bare.h.get("location"), "https://localhost/veena-salon/");
  const id = await get("/p/k7m2qx9r4t");
  assert.equal(id.status, 302); assert.equal(id.h.get("location"), "https://localhost/veena-salon/");
  const card = await get("/@asha-digital");
  assert.equal(card.status, 200); assert.ok(card.body.includes("Asha"));
  assert.ok((await get("/%40asha-digital")).body.includes("Asha"));
  const nocard = await get("/@nobody");
  assert.equal(nocard.status, 404); assert.ok(!nocard.body.includes("STREETLIST-404"), "the door's own friendly card 404 is kept");
  const unknown = await get("/no-such-shop/x");
  assert.equal(unknown.status, 404); assert.ok(unknown.body.includes("STREETLIST-404"), "an unknown name shows the home's 404 page, as it did on Firebase");
  assert.equal(unknown.h.get("x-geometer-nothing"), null);
  assert.equal((await get("/.vite/manifest.json")).status, 404, "a hidden path is never a file");
  assert.equal((await get("/shops", { method: "POST", body: "x" })).status, 405, "a page takes GET and HEAD; the door answers the rest");
  assert.equal((await get("/veena-salon/book", { method: "POST", body: "x" })).status, 200, "a POST to a shop's page reaches the shop");
  void WHATSAPP_LINE;
});

test("a new build or a rollback shows at once, with no restart of Caddy; with no build the domain is the door's alone", { skip: !ON && "REAL_CADDY=1 not set" }, async () => {
  const b = build("two");
  installHome(dir, b.bytes, { expectSha: b.sha256 });
  assert.ok(await shows("/", "HOME two"), "switched by the symlink rename alone");
  // the one before is back by moving the link, as `home rollback` does
  const { rollbackHome } = await import("../lib/home.ts");
  rollbackHome(dir);
  assert.ok(await shows("/", "HOME one"), "rolled back");
  // no build installed: the folder is empty
  const p = homePaths(dir);
  renameSync(p.current, `${p.current}.away`);
  assert.ok(await shows("/", "Shop pages"), "the door's own home page");
  const shops = await get("/shops/"); // the door treats a name as a shop's; fleet does not know it (reserved)
  assert.equal(shops.status, 404); assert.ok(!shops.body.includes("STREETLIST-404"));
  renameSync(`${p.current}.away`, p.current);
  assert.ok(await shows("/", "HOME one"), "back when the link is back");
  void mkdirSync; void symlinkSync;
});
