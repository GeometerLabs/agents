// The Streetlist home on the partner server (before-launch item 6, lib/home.ts): a build reaches the server as one pinned pack file, is checked, installed beside the
// one served, switched to atomically and rolled back; its names cannot shadow a shop's; and the Caddy side is the streetlist repository's firebase.json, ported.
// Written 14 Nov 2026. The tests that read the streetlist repository or fleet's slug list look for them beside this repository and say so when they are not there.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { HOME_FILES, HOME_RULES_SHA, HOME_ROBOTS_DISALLOW, HOME_TOP, HomeRefused, buildPack, homePaths, homeStatus, installHome, makePack, readSource, rollbackHome, rulesShaOf, verifyPack } from "../lib/home.ts";
import { HOME_ASSET_CACHE, HOME_CSP, HOME_SECURITY_HEADERS, caddyfile, mergedRobots } from "../generate/compose.ts";
import { homeCommand } from "../home-cli.ts";
import { DOOR_ROBOTS_DISALLOW, SLUG } from "../services/door.ts";
import { serverConfig } from "./helpers.ts";

/** A folder beside this repository's checkout (the monorepo, the streetlist repository), found by walking up: worktrees sit several folders deep. */
function beside(...parts: string[]): string | undefined {
  for (let d = dirname(new URL(import.meta.url).pathname); d !== dirname(d); d = dirname(d)) { const p = join(d, ...parts); if (existsSync(p)) return p; }
  return process.env.GEOMETER_ROOT && existsSync(join(process.env.GEOMETER_ROOT, ...parts)) ? join(process.env.GEOMETER_ROOT, ...parts) : undefined;
}

const text = (s: string) => Buffer.from(s);
/** A small build: every kind of file the home has. `change` replaces or adds files; null removes one. */
function files(change: Record<string, string | null> = {}): { path: string; data: Uint8Array }[] {
  const base: Record<string, string | null> = {
    "index.html": "<p>HOME one</p>", "404.html": "<p>NOT FOUND</p>", "shops.html": "<p>shops</p>", "partners.html": "<p>partners</p>", "privacy.html": "<p>privacy</p>",
    "examples/glow-salon.html": "<p>glow</p>", "assets/main-Ab_1.js": "console.log(1)", "assets/site-x.css": "body{}", "favicon.svg": "<svg/>", "robots.txt": "User-agent: *\nAllow: /\nDisallow: /examples/\n",
  };
  return Object.entries({ ...base, ...change }).filter(([, v]) => v !== null).map(([path, v]) => ({ path, data: text(v!) }));
}
/** A pack written WITHOUT the maker's own check, so a test can hand the server what a careless or hostile maker could. */
const raw = (f: { path: string; data: Uint8Array }[], rules = HOME_RULES_SHA) => buildPack(f, "5f49032", rules, false);
const pack = (change: Record<string, string | null> = {}, commit = "5f49032") => buildPack(files(change), commit);
const server = () => mkdtempSync(join(tmpdir(), "geo-home-"));

// ---- what the home owns, and the one source of truth ---------------------------------------------------------------------------------------------------

test("every name the home serves is reserved in fleet's slug list, so a shop can never take it (and none is a valid slug by accident)", (t) => {
  const slugs = beside("monorepo", "apps", "fleet", "src", "page-slugs.ts");
  if (!slugs) return t.skip("fleet's page-slugs.ts is not beside this repository (set GEOMETER_ROOT)");
  const source = readFileSync(slugs, "utf8");
  const list = source.slice(source.indexOf("RESERVED_SLUGS"), source.indexOf("];", source.indexOf("RESERVED_SLUGS")));
  const reserved = new Set([...list.matchAll(/"([^"]+)"/g)].map((m) => m[1]));
  assert.deepEqual(HOME_TOP.filter((n) => !reserved.has(n)), [], "a name the home serves is not in RESERVED_SLUGS: a shop could claim it");
  // the names that are not slug-shaped (a dot) cannot clash; the others must all be reserved
  for (const n of ["index", "404", ...HOME_FILES]) assert.ok(reserved.has(n) || !SLUG.test(n), `${n} could be claimed as a shop name`);
});

test("the Caddy port is the streetlist repository's firebase.json: the rules hash, the headers, the cache rule, the redirect and the robots lines", (t) => {
  const repo = beside("streetlist", "firebase.json");
  if (!repo) return t.skip("the streetlist repository is not beside this one (set GEOMETER_ROOT)");
  const hosting = JSON.parse(readFileSync(repo, "utf8")).hosting;
  assert.equal(rulesShaOf(hosting), HOME_RULES_SHA, "firebase.json's rules changed: update generate/compose.ts's homeHandlers and lib/home.ts's HOME_RULES_SHA in a reviewed commit");
  const rules = hosting.headers as { source?: string; regex?: string; headers: { key: string; value: string }[] }[];
  const all = Object.fromEntries(rules.find((r) => r.source === "**")!.headers.map((h) => [h.key, h.value]));
  assert.deepEqual(Object.entries(all), HOME_SECURITY_HEADERS.map(([k, v]) => [k, v]));
  const pages = Object.fromEntries(rules.find((r) => r.regex)!.headers.map((h) => [h.key, h.value]));
  assert.equal(pages["Content-Security-Policy"], HOME_CSP);
  assert.equal(pages["Cache-Control"], "no-cache");
  assert.equal(rules.find((r) => r.source === "/assets/**")!.headers[0].value, HOME_ASSET_CACHE);
  assert.deepEqual(hosting.redirects, [{ source: "/examples", destination: "/examples/glow-salon", type: 302 }]);
  assert.equal(hosting.cleanUrls, true);
  assert.equal(hosting.trailingSlash, false);
  const robots = readFileSync(join(dirname(repo), "public", "robots.txt"), "utf8").split("\n").filter((l) => /^disallow:/iu.test(l)).map((l) => l.replace(/^disallow:\s*/iu, "").trim());
  assert.deepEqual(robots, [...HOME_ROBOTS_DISALLOW]);
});

test("the repository's real build, when it has been built, packs and installs (every file valid, every top-level name owned)", (t) => {
  const repo = beside("streetlist", "dist", "index.html");
  if (!repo) return t.skip("streetlist/dist is not built");
  const made = makePack(join(dirname(repo), ".."), { commit: "5f49032" });
  assert.ok(made.pack.files.every((f) => !f.path.split("/").some((p) => p.startsWith("."))), "no dot file (dist/.vite) is packed");
  const dir = server();
  assert.equal(installHome(dir, made.bytes, { expectSha: made.sha256 }).changed, true);
  assert.ok(existsSync(join(homePaths(dir).current, "site", "index.html")));
  assert.equal(makePack(join(dirname(repo), ".."), { commit: "5f49032" }).sha256, made.sha256, "the same build packs to the same bytes, so a second person can check the pin");
});

test("robots.txt on the pages domain says both the door's and the home's disallowed paths", () => {
  const robots = mergedRobots();
  for (const d of [...DOOR_ROBOTS_DISALLOW, ...HOME_ROBOTS_DISALLOW]) assert.ok(robots.includes(`Disallow: ${d}\n`), d);
  assert.ok(robots.startsWith("User-agent: *\n"));
});

// ---- installing, switching, rolling back -----------------------------------------------------------------------------------------------------------

test("install: checked, written beside the served one, switched by a relative symlink, the one before kept, older ones removed, and the same build again changes nothing", () => {
  const dir = server();
  const a = pack(); const b = pack({ "index.html": "<p>HOME two</p>" }, "aaaaaaa"); const c = pack({ "index.html": "<p>HOME three</p>" }, "bbbbbbb");
  const p = homePaths(dir);
  assert.equal(installHome(dir, a.bytes, { expectSha: a.sha256 }).changed, true);
  assert.equal(readlinkSync(p.current), `releases/${a.sha256.slice(0, 16)}`, "relative, so it holds inside Caddy's container");
  assert.equal(readFileSync(join(p.current, "site", "index.html"), "utf8"), "<p>HOME one</p>");
  assert.equal(installHome(dir, a.bytes, { expectSha: a.sha256 }).changed, false);
  installHome(dir, b.bytes, { expectSha: b.sha256 });
  assert.equal(readFileSync(join(p.current, "site", "index.html"), "utf8"), "<p>HOME two</p>");
  assert.equal(readFileSync(join(p.previous, "site", "index.html"), "utf8"), "<p>HOME one</p>");
  installHome(dir, c.bytes, { expectSha: c.sha256 });
  assert.deepEqual(readdirSync(p.releases).sort(), [b.sha256.slice(0, 16), c.sha256.slice(0, 16)].sort(), "only the served and the one before stay");
  assert.equal(homeStatus(dir).current?.commit, "bbbbbbb");
  assert.equal(homeStatus(dir).previous?.commit, "aaaaaaa");
  assert.ok(readdirSync(p.root).every((n) => !n.endsWith(".tmp")), "no temporary link is left");
});

test("rollback goes back to the build before, a second rollback goes forward again, and with no earlier build it refuses", () => {
  const dir = server();
  const a = pack(); const b = pack({ "index.html": "<p>HOME two</p>" }, "aaaaaaa");
  installHome(dir, a.bytes, { expectSha: a.sha256 });
  assert.throws(() => rollbackHome(dir), /no earlier Streetlist build/u);
  installHome(dir, b.bytes, { expectSha: b.sha256 });
  const p = homePaths(dir);
  assert.equal(rollbackHome(dir).commit, "5f49032");
  assert.equal(readFileSync(join(p.current, "site", "index.html"), "utf8"), "<p>HOME one</p>");
  assert.equal(rollbackHome(dir).commit, "aaaaaaa");
  assert.equal(readFileSync(join(p.current, "site", "index.html"), "utf8"), "<p>HOME two</p>");
});

test("a checksum that is not the pin is refused, and NOTHING is written under the server folder (a served build stays the served build)", () => {
  const dir = server();
  const a = pack();
  assert.throws(() => installHome(dir, a.bytes, { expectSha: "0".repeat(64) }), (e: unknown) => e instanceof HomeRefused && /checksum is [0-9a-f]{64}, not the pinned 0{64}/u.test(e.message));
  assert.equal(existsSync(homePaths(dir).root), false);
  installHome(dir, a.bytes, { expectSha: a.sha256 });
  const b = pack({ "index.html": "<p>other</p>" }, "aaaaaaa");
  assert.throws(() => installHome(dir, b.bytes, { expectSha: a.sha256 }), HomeRefused);
  assert.equal(readFileSync(join(homePaths(dir).current, "site", "index.html"), "utf8"), "<p>HOME one</p>");
  assert.deepEqual(readdirSync(homePaths(dir).releases), [a.sha256.slice(0, 16)]);
});

test("a build that is damaged, unsafe, or would shadow a shop is refused with the reason, whatever its checksum", () => {
  const dir = server();
  const refused = (bytes: Buffer, why: RegExp) => assert.throws(() => installHome(dir, bytes), (e: unknown) => e instanceof HomeRefused && why.test(e.message), String(why));
  // a file whose bytes were changed after its checksum was written
  const tampered = JSON.parse(pack().bytes.toString()); tampered.files[0].data = Buffer.from("changed").toString("base64");
  refused(Buffer.from(JSON.stringify(tampered)), /does not match its checksum/u);
  // paths: a parent folder, a hidden file, an absolute path, a backslash
  for (const path of ["../outside.html", "assets/../../x.html", ".hidden", "assets/.vite/manifest.json", "/etc/passwd", "assets\\x.js"]) refused(raw([...files(), { path, data: text("x") }]).bytes, /path inside the site|hidden/u);
  // a name the home does not own: it could answer where a shop's page should
  refused(raw([...files(), { path: "admin.html", data: text("x") }]).bytes, /does not own/u);
  refused(raw([...files(), { path: "veena-salon/index.html", data: text("x") }]).bytes, /does not own/u);
  refused(raw([...files(), { path: "shops", data: text("x") }]).bytes, /would shadow the name "shops"/u);
  refused(raw([...files(), { path: "examples/deep/x.html", data: text("x") }]).bytes, /not an example page/u);
  refused(raw([...files(), { path: "examples/x.txt", data: text("x") }]).bytes, /not an example page/u);
  // missing pages, other rules, another robots.txt, not a pack at all
  refused(raw(files({ "404.html": null })).bytes, /no 404\.html/u);
  refused(raw(files({ "index.html": null })).bytes, /no index\.html/u);
  refused(raw(files(), "f".repeat(64)).bytes, /hosting rules/u);
  refused(raw(files({ "robots.txt": "User-agent: *\nDisallow: /\n" })).bytes, /robots\.txt disallows/u);
  refused(text("not json"), /not readable/u);
  refused(text(JSON.stringify({ format: 2 })), /not a pack/u);
  assert.equal(existsSync(homePaths(dir).releases) ? readdirSync(homePaths(dir).releases).length : 0, 0, "a refused build left nothing behind");
});

test("packing: refuses a link, leaves dot entries out, and the same files give the same bytes", () => {
  const root = server(); const dist = join(root, "dist");
  mkdirSync(join(dist, "assets"), { recursive: true }); mkdirSync(join(dist, ".vite"), { recursive: true });
  for (const f of files()) { mkdirSync(dirname(join(dist, f.path)), { recursive: true }); writeFileSync(join(dist, f.path), f.data); }
  writeFileSync(join(dist, ".vite", "manifest.json"), "{}");
  writeFileSync(join(root, "firebase.json"), JSON.stringify({ hosting: { cleanUrls: true } }));
  assert.throws(() => makePack(root, { commit: "5f49032" }), /hosting rules/u, "a different firebase.json is refused at pack time too");
  assert.equal(rulesShaOf({ cleanUrls: true }).length, 64);
  const direct = buildPack(files(), "5f49032");
  assert.equal(buildPack([...files()].reverse(), "5f49032").sha256, direct.sha256);
  assert.ok(!direct.pack.files.some((f) => f.path.startsWith(".")));
  symlinkSync("/etc/passwd", join(dist, "assets", "link.js"));
  writeFileSync(join(root, "firebase.json"), JSON.stringify({ hosting: { cleanUrls: true } }));
  assert.throws(() => makePack(root, { commit: "5f49032" }), /is a link/u);
  verifyPack(direct.bytes);
});

test("a build is read from a file or an https address only, with a size cap", async () => {
  const dir = server(); const f = join(dir, "pack.json"); writeFileSync(f, "abc");
  assert.equal((await readSource(f)).toString(), "abc");
  await assert.rejects(readSource("http://example.test/x"), /Only an https address/u);
  await assert.rejects(readSource("file:///etc/passwd"), /Only an https address/u);
  await assert.rejects(readSource(join(dir, "missing")), /not there/u);
  assert.equal((await readSource("https://example.test/p", async () => ({ ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode("xyz").buffer }))).toString(), "xyz");
  await assert.rejects(readSource("https://example.test/p", async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) })), /answered 404/u);
});

// ---- the command ---------------------------------------------------------------------------------------------------------------------------------------

test("`geometer home`: install follows the pin, refuses a source that is not the pin, a server with no pages domain, and says what is served", async () => {
  const dir = server();
  writeFileSync(join(dir, "geometer.json"), JSON.stringify({ schema: 1, id: "partner-1", domain: "partners.example", reviewedBy: "me", model: { wire: "openai", model: "x" }, panel: { enabled: true, mode: "hosted" }, fleet: { url: "https://fleet.example", keyFile: "k" }, pages: { domain: "streetlist.example", extraDomains: [] } }));
  const a = pack(); const file = join(dir, "a.json"); writeFileSync(file, a.bytes);
  const out: string[] = [];
  const io = (pin: { commit: string; sha256: string; url: string }) => ({ log: (l: string) => out.push(l), pin: () => pin });
  await assert.rejects(homeCommand(dir, "install", [file], {}, io({ commit: "", sha256: "", url: "" })), /pins no build/u);
  await assert.rejects(homeCommand(dir, "install", [file], {}, io({ commit: "5f49032", sha256: "1".repeat(64), url: "" })), /checksum is/u, "the file is not the pin");
  await assert.rejects(homeCommand(dir, "install", [file], { sha256: "2".repeat(64) }, io({ commit: "5f49032", sha256: a.sha256, url: "" })), /not what this bundle pins/u, "the command line cannot override a pin");
  assert.equal(await homeCommand(dir, "install", [file], {}, io({ commit: "5f49032", sha256: a.sha256, url: "" })), 0);
  assert.match(out.at(-1)!, /Installed Streetlist commit 5f49032/u);
  assert.equal(await homeCommand(dir, "install", [file], {}, io({ commit: "5f49032", sha256: a.sha256, url: "" })), 0);
  assert.match(out.at(-1)!, /already the one served/u);
  await homeCommand(dir, "status", [], {}, io({ commit: "5f49032", sha256: a.sha256, url: "" }));
  assert.ok(out.some((l) => /Served now: Streetlist commit 5f49032/u.test(l)) && out.some((l) => /that is what is served/u.test(l)), out.join("\n"));
  // pack from a folder (the CLI's own path, used on the owner's machine)
  writeFileSync(join(dir, "geometer.json"), JSON.stringify({ schema: 1, id: "builder", domain: "shops.example", reviewedBy: "me", model: { wire: "openai", model: "x" } }));
  await assert.rejects(homeCommand(dir, "status", [], {}, io({ commit: "", sha256: "", url: "" })), /no pages domain/u);
});

// ---- the generated Caddy text --------------------------------------------------------------------------------------------------------------------------

const hosted = (pages: { domain: string; extraDomains: string[] }) => serverConfig({ panel: { enabled: true, mode: "hosted" }, fleet: { url: "https://fleet.example", keyFile: "fleet.key" }, pages });

test("Caddyfile golden: the pages domain's site is the home first (only when a build is installed), then the door; extra domains reach the door alone", () => {
  const caddy = caddyfile(hosted({ domain: "streetlist.in", extraDomains: ["streetlist.co.in"] }), [], ["veena"]);
  const golden = new URL("./fixtures/pages-caddyfile.golden.txt", import.meta.url).pathname;
  const site = caddy.slice(caddy.indexOf("streetlist.in {"));
  if (process.env.UPDATE_GOLDEN === "1") writeFileSync(golden, site);
  assert.equal(site, readFileSync(golden, "utf8"), "the pages domain's Caddy text changed: if on purpose, UPDATE_GOLDEN=1 and review the diff");
  // the extra domain never gets the home
  const extra = site.slice(site.indexOf("streetlist.co.in {"));
  assert.deepEqual(extra.split("\n").map((l) => l.trim()).filter(Boolean), ["streetlist.co.in {", "reverse_proxy door:8797", "}"]);
  // the static rules are inside the home-live handle, and the plain door is the fallback after it
  assert.ok(site.indexOf("handle @home-live") < site.indexOf("# no home installed"));
  // no domain is written in the generator: the same shape for another domain
  assert.equal(caddyfile(hosted({ domain: "pages.example", extraDomains: [] }), [], []).includes("streetlist"), false);
});

test("a server with no pages domain has no home or door rules in its Caddyfile, and the shop's own site block is unchanged by them", () => {
  const plain = caddyfile(serverConfig({ panel: { enabled: true } }), [], ["veena"]);
  assert.ok(!plain.includes("home-live") && !plain.includes("door:"));
  const withPages = caddyfile(hosted({ domain: "streetlist.in", extraDomains: [] }), [], ["veena"]);
  assert.equal(withPages.slice(0, withPages.indexOf("streetlist.in {")).trimEnd(), caddyfile(serverConfig({ panel: { enabled: true, mode: "hosted" }, fleet: { url: "https://fleet.example", keyFile: "fleet.key" } }), [], ["veena"]).trimEnd(), "everything before the pages block is identical");
});

// ---- setting a server up with the pages domain ------------------------------------------------------------------------------------------------------------

test("init --pages-domain writes geometer.json's pages (extra domains after it), and refuses it on a builder's server; no domain is ever assumed", async () => {
  const { main } = await import("../geometer.ts");
  const { loadServer } = await import("../lib/server.ts");
  const { TEST_PUBLIC_HEX } = await import("./licence-helpers.ts");
  const root = mkdtempSync(join(tmpdir(), "geo-init-pages-"));
  const log = console.log; console.log = () => undefined;
  try {
    const common = ["--domain", "partners.example", "--reviewed-by", "owner", "--model-wire", "openai", "--model", "gpt-4o-mini", "--licence-key", TEST_PUBLIC_HEX, "--fleet-url", "https://fleet.example", "--fleet-key-file", "fleet_key"];
    assert.equal(await main(["init", join(root, "hosted"), ...common, "--panel", "--panel-mode", "hosted", "--pages-domain", "streetlist.in", "--pages-extra", "streetlist.co.in, Streetlist.org.in"]), 0);
    assert.deepEqual(loadServer(join(root, "hosted")).pages, { domain: "streetlist.in", extraDomains: ["streetlist.co.in", "streetlist.org.in"] });
    assert.equal(await main(["init", join(root, "plain"), ...common, "--panel", "--panel-mode", "hosted"]), 0);
    assert.equal(loadServer(join(root, "plain")).pages, undefined, "nothing is assumed");
  } finally { console.log = log; }
  const err = console.error; const lines: string[] = []; console.error = (l: string) => { lines.push(String(l)); };
  try { assert.equal(await main(["init", join(root, "builder"), "--domain", "shops.example", "--reviewed-by", "o", "--model", "m", "--licence-key", TEST_PUBLIC_HEX, "--pages-domain", "streetlist.in"]), 1); } finally { console.error = err; }
  assert.match(lines.join("\n"), /partner server/u);
});
