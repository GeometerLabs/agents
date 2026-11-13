// A shop's page on the pages domain, the server's side (plan item 11f, bundle/lib/pages.ts and geometer.json `pages`): the deployer claims the panel's short name
// at fleet with the deployment key and hands the shop's runtime and front their addresses; a confirmed name is not asked again for a day, a refused one not for
// ten minutes; "own" and a removed shop give the name back; the panel's "sign out every device" reaches the runtime; the owner's view is on the pages domain only
// for a shop this server's door serves; and the pages domain is a setting of Geometer's partner server, never geometer.dev. Written 12 Nov 2026.
import { makeOwnerRecovery, makeOwnerSetup, removeOwnerPasskeys } from "../lib/pages.ts";
import { grantInFile, readOwnerGrants } from "../../modules/channels/owner-grants.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLAIM_RETRY_MS, endOwnerSessions, pagesCopies, pagesFileFor, pagesStatusFile, readPageSettings, readPagesStatus, syncPages, writePageSettings } from "../lib/pages.ts";
import { parseServer } from "../lib/server.ts";
import type { ServerConfig } from "../lib/server.ts";
import { readPagesFile } from "../../modules/channels/pages-file.ts";
import { caddyfile, composeServer } from "../generate/compose.ts";
import { doorConfig } from "../generate/configs.ts";
import { serverConfig } from "./helpers.ts";

const T0 = new Date("2026-11-12T05:00:00Z");
const KEY = "geo_dep_testkey";

function folder(mode: "hosted" | "own") {
  const dir = mkdtempSync(join(tmpdir(), "pages-"));
  writeFileSync(join(dir, "fleet.key"), KEY);
  const parsed = parseServer({
    schema: 1, id: "partner-1", domain: "partners.example", reviewedBy: "t", panel: { enabled: true, mode },
    fleet: { url: "https://fleet.example", keyFile: "fleet.key" }, ...(mode === "hosted" ? { pages: { domain: "pages.example", extraDomains: ["old.example"] } } : {}),
  });
  assert.deepEqual(parsed.errors, []);
  for (const shop of ["veena", "ravi"]) {
    mkdirSync(join(dir, "shops", shop), { recursive: true });
    mkdirSync(join(dir, "generated", "shops", shop, "client"), { recursive: true });
    mkdirSync(join(dir, "secrets", "inbox", shop), { recursive: true });
  }
  const calls: { path: string; auth: string | null; body: Record<string, unknown> }[] = [];
  let answer: (path: string, body: Record<string, unknown>) => { status: number; json: unknown } = (path, body) =>
    path.endsWith("/release") ? { status: 200, json: { ok: true, released: "x" } } : { status: 200, json: { ok: true, slug: body.slug, url: `https://pages.example/${String(body.slug)}`, page_id: "k7m2qx9r4t", page_url: "https://pages.example/p/k7m2qx9r4t", new: true } };
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push({ path, auth: new Headers(init?.headers).get("authorization"), body });
    const a = answer(path, body);
    return new Response(JSON.stringify(a.json), { status: a.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const sync = (shops: string[], at: Date) => syncPages({ dir, server: parsed.config, shops, now: at, fetchImpl });
  return { dir, server: parsed.config, calls, sync, setAnswer: (f: typeof answer) => { answer = f; }, done: () => rmSync(dir, { recursive: true, force: true }) };
}

const pagesOf = (path: string) => readPagesFile(readFileSync(path, "utf8"));

test("on the partner server a shop is on the pages domain by default; a builder's is on its own domain unless it chooses", () => {
  const p = folder("hosted");
  const b = folder("own");
  try {
    assert.equal(readPageSettings(p.dir, "veena", true).pages, "hub");
    assert.equal(readPageSettings(b.dir, "veena", false).pages, "own");
    writePageSettings(b.dir, "veena", { pages: "hub", slug: "ravi-cuts", whatsapp: "+919800000002" });
    assert.deepEqual(readPageSettings(b.dir, "veena", false), { pages: "hub", slug: "ravi-cuts", whatsapp: "+919800000002" });
    writeFileSync(join(b.dir, "shops", "veena", "page.json"), JSON.stringify({ pages: "hub", slug: "Bad Name", whatsapp: "12345" }));
    assert.deepEqual(readPageSettings(b.dir, "veena", false), { pages: "hub" }, "a field in the wrong shape is dropped, never guessed");
  } finally { p.done(); b.done(); }
});

test("the deployer claims the name with the deployment key, writes what came of it, and hands the runtime and the front their addresses", async () => {
  const p = folder("hosted");
  try {
    writePageSettings(p.dir, "veena", { pages: "hub", slug: "veena-salon", whatsapp: "+919800000002" });
    const lines = await p.sync(["veena"], T0);
    assert.deepEqual(p.calls.map((c) => [c.path, c.auth, c.body]), [["/v1/page-slugs", `Bearer ${KEY}`, { agent_id: "veena", slug: "veena-salon" }]]);
    assert.ok(lines.some((l) => l.includes("https://pages.example/veena-salon")));
    const status = readPagesStatus(p.dir, "veena")!;
    assert.deepEqual([status.slug, status.url, status.pageUrl], ["veena-salon", "https://pages.example/veena-salon", "https://pages.example/p/k7m2qx9r4t"]);
    for (const copy of pagesCopies(p.dir, "veena")) {
      const f = pagesOf(copy)!;
      assert.equal(f.base, "https://partners.example/s/veena");
      assert.equal(f.ownerBase, "https://pages.example/veena-salon/owner", "the door serves this shop from here, so the owner's view is on the pages domain");
      assert.equal(f.pageUrl, "https://pages.example/p/k7m2qx9r4t");
      assert.equal(f.whatsapp, "+919800000002");
      assert.equal(f.panelUrl, "https://partners.example/shops/veena");
    }
    await p.sync(["veena"], new Date(T0.getTime() + 60_000));
    assert.equal(p.calls.length, 1, "a confirmed name is not asked again within the day");
    await p.sync(["veena"], new Date(T0.getTime() + 25 * 60 * 60_000));
    assert.equal(p.calls.length, 2, "once a day it is (the claim changes nothing at fleet)");
  } finally { p.done(); }
});

test("a refused name is shown to the panel and not asked again for ten minutes, unless the partner picks another", async () => {
  const p = folder("hosted");
  try {
    p.setAnswer(() => ({ status: 409, json: { error: "That page name is taken. Pick another.", code: "taken" } }));
    writePageSettings(p.dir, "veena", { pages: "hub", slug: "veena-salon" });
    await p.sync(["veena"], T0);
    assert.deepEqual(readPagesStatus(p.dir, "veena")!.problem, { code: "taken", message: "That page name is taken. Pick another." });
    assert.equal(pagesOf(pagesCopies(p.dir, "veena")[0])!.slug, undefined, "no slug the front would accept from the door");
    assert.equal(pagesOf(pagesCopies(p.dir, "veena")[0])!.ownerBase, "https://partners.example/s/veena/owner");
    await p.sync(["veena"], new Date(T0.getTime() + CLAIM_RETRY_MS - 1));
    assert.equal(p.calls.length, 1);
    writePageSettings(p.dir, "veena", { pages: "hub", slug: "veena-hair" });
    await p.sync(["veena"], new Date(T0.getTime() + 1000));
    assert.equal(p.calls.length, 2, "a new name is asked at once");
  } finally { p.done(); }
});

test("a builder's client on the pages domain keeps the owner's view on the builder's own domain", async () => {
  const b = folder("own");
  try {
    writePageSettings(b.dir, "ravi", { pages: "hub", slug: "ravi-cuts" });
    await b.sync(["ravi"], T0);
    const f = pagesOf(pagesCopies(b.dir, "ravi")[0])!;
    assert.equal(f.url, "https://pages.example/ravi-cuts");
    assert.equal(f.ownerBase, "https://partners.example/s/ravi/owner", "this server does not answer for the pages domain");
  } finally { b.done(); }
});

test("\"own\", or a shop removed from the server, gives the name back; the panel's sign-out of every device reaches the runtime", async () => {
  const b = folder("own");
  try {
    writePageSettings(b.dir, "ravi", { pages: "hub", slug: "ravi-cuts" });
    await b.sync(["ravi"], T0);
    writePageSettings(b.dir, "ravi", { pages: "own", slug: "ravi-cuts" });
    await b.sync(["ravi"], new Date(T0.getTime() + 1000));
    assert.deepEqual(b.calls.at(-1)!.path, "/v1/page-slugs/release");
    assert.deepEqual(b.calls.at(-1)!.body, { agent_id: "ravi", reason: "removed" });
    assert.equal(readPagesStatus(b.dir, "ravi")!.slug, undefined);
    // removed from the server while holding a name
    writePageSettings(b.dir, "veena", { pages: "hub", slug: "veena-salon" });
    await b.sync(["veena"], T0);
    rmSync(join(b.dir, "shops", "veena"), { recursive: true, force: true });
    await b.sync([], new Date(T0.getTime() + 2000));
    assert.deepEqual(b.calls.at(-1)!.body, { agent_id: "veena", reason: "removed" });
    assert.equal(existsSync(pagesStatusFile(b.dir, "veena")), false);
    // sign out every device: the panel's file, handed to the runtime and taken away again
    endOwnerSessions(b.dir, "ravi", T0);
    await b.sync(["ravi"], new Date(T0.getTime() + 3000));
    const copy = join(b.dir, "generated", "shops", "ravi", "client", "owner-sessions.json");
    assert.equal(JSON.parse(readFileSync(copy, "utf8")).endBefore, T0.toISOString());
    rmSync(join(b.dir, "shops", "ravi", "owner-sessions.json"));
    await b.sync(["ravi"], new Date(T0.getTime() + 4000));
    assert.equal(existsSync(copy), false);
    // item 11h: the partner's setup QR and recovery card (hashes only) go the same way, so a QR shown on the panel works within one pass
    const made = makeOwnerSetup(b.dir, "ravi", T0);
    const codes = makeOwnerRecovery(b.dir, "ravi", T0);
    await b.sync(["ravi"], new Date(T0.getTime() + 5000));
    const grants = join(b.dir, "generated", "shops", "ravi", "client", "owner-grants.json");
    const handed = readFileSync(grants, "utf8");
    assert.ok(!handed.includes(made.token) && !codes.some((c) => handed.includes(c)), "hashes only");
    assert.equal(grantInFile({ kind: "setup", token: made.token }, readOwnerGrants(handed), T0.getTime() + 5000), "valid");
    removeOwnerPasskeys(b.dir, "ravi", new Date(T0.getTime() + 6000));
    await b.sync(["ravi"], new Date(T0.getTime() + 7000));
    assert.equal(readOwnerGrants(readFileSync(grants, "utf8"))!.passkeysBefore, new Date(T0.getTime() + 6000).toISOString());
  } finally { b.done(); }
});

test("the pages file for a shop with no name is still written: its base and its owner's view on the server's own address", () => {
  const p = folder("hosted");
  try {
    const f = pagesFileFor(p.server as ServerConfig, "veena", { pages: "hub" }, undefined);
    assert.deepEqual([f.base, f.ownerBase, f.slug], ["https://partners.example/s/veena", "https://partners.example/s/veena/owner", undefined]);
  } finally { p.done(); }
});

test("geometer.json: the pages domain is the partner server's setting, a list of a primary and extra domains, never geometer.dev or the server's own", () => {
  const base = { schema: 1, id: "partner-1", domain: "partners.example", reviewedBy: "t", panel: { enabled: true, mode: "hosted" } };
  const errors = (pages: unknown, mode = "hosted") => parseServer({ ...base, panel: { enabled: true, mode }, pages }).errors.join(" ");
  assert.equal(errors({ domain: "pages.example", extraDomains: ["old.example"] }), "");
  assert.deepEqual(parseServer({ ...base, pages: { domain: "pages.example", extraDomains: ["old.example"] } }).config.pages, { domain: "pages.example", extraDomains: ["old.example"] });
  assert.match(errors({ domain: "shops.geometer.dev" }), /cannot be geometer\.dev/u);
  assert.match(errors({ domain: "pages.example", extraDomains: ["geometer.dev"] }), /cannot be geometer\.dev/u);
  assert.match(errors({ domain: "partners.example" }), /own domain/u);
  assert.match(errors({ domain: "https://pages.example" }), /small letters/u);
  assert.match(errors({ domain: "pages.example", extraDomains: ["pages.example"] }), /twice/u);
  assert.match(errors({ domain: "pages.example" }, "own"), /partner server/u);
});

test("generated: the pages domain's site reaches only the door, the door is on its own network and egress with no secret, and a server without it has none", () => {
  const hosted = serverConfig({ panel: { enabled: true, mode: "hosted" }, fleet: { url: "https://fleet.example", keyFile: "fleet.key" }, pages: { domain: "pages.example", extraDomains: ["old.example"] } });
  const caddy = caddyfile(hosted, [], ["veena"]);
  // the primary domain's site: the Streetlist home first (when a build is installed), then the door; the extra domain's site reaches the door alone (it redirects to the primary)
  const primary = caddy.slice(caddy.indexOf("pages.example {"), caddy.indexOf("old.example {"));
  assert.ok(primary.startsWith("pages.example {"), caddy);
  assert.equal([...primary.matchAll(/reverse_proxy door:8797/gu)].length, 2, "the door, twice: after the home's rules, and alone when no build is installed");
  assert.ok(!/\/c\/|\/s\/|\/r\/|\/g\/|panel:/u.test(primary), "no /c, /s, /r, /g or panel on the pages domain");
  const extra = caddy.slice(caddy.indexOf("old.example {"));
  assert.deepEqual(extra.slice(0, extra.indexOf("\n}") + 2).split("\n").map((l) => l.trim()).filter(Boolean), ["old.example {", "reverse_proxy door:8797", "}"], "nothing but the door: the home is never served under another name");
  const dirs = { app: "/repo", generated: "/srv/generated", secrets: "/srv/secrets", status: "/srv/status", fleet: "/srv/fleet", shops: "/srv/shops", secretsInbox: "/srv/secrets-inbox", requests: "/srv/requests", exports: "/srv/exports", panelData: "/srv/panel", config: "/srv/geometer.json", licence: "/srv/state/licence", home: "/srv/home" };
  const c = composeServer(hosted, dirs, [], {});
  const door = c.services.door.block as { networks: Record<string, unknown>; volumes: string[] };
  assert.deepEqual(Object.keys(door.networks).sort(), ["egress", "pages"]);
  assert.ok(!door.volumes.some((v) => v.includes("/secrets")), "no secret is mounted into the door");
  assert.ok(Object.keys((c.services.caddy.block as { networks: Record<string, unknown> }).networks).includes("pages"));
  // item 6: Caddy reads the installed Streetlist build from the home/ FOLDER, read-only (not the `current` link: Docker resolves a bind-mounted link once, at start)
  assert.ok((c.services.caddy.block as { volumes: unknown[] }).volumes.includes("/srv/home:/srv/home:ro"));
  assert.ok(!((composeServer(serverConfig({ panel: { enabled: true } }), dirs, [], {}).services.caddy.block as { volumes: unknown[] }).volumes).includes("/srv/home:/srv/home:ro"), "a server with no pages domain mounts none");
  assert.match(c.compose, /\n  pages:\n    internal: true/u, "the pages network has no way out of its own");
  assert.deepEqual(JSON.parse(doorConfig(hosted)!), { primary: "pages.example", extra: ["old.example"], deploymentId: "acme-vps-1", fleetUrl: "https://fleet.example", localUrl: "http://inbox:8788" });
  const builder = serverConfig({ panel: { enabled: true } });
  assert.equal(doorConfig(builder), undefined);
  assert.ok(!caddyfile(builder).includes("door:"));
  assert.equal(composeServer(builder, dirs, [], {}).services.door, undefined);
});
