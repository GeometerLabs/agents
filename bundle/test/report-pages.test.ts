// Serving the monthly report pages (B54's missing piece): the runtime writes <dataDir>/reports/<32 random hex>/<file>, and Caddy serves exactly that, read-only, at
// https://<domain>/r/<shop>/<hex>/<file>. Nothing else under /r answers anything but 404, and Caddy sees no other part of a shop's data volume.
// Caddy itself is not run here (no container is started): the generated Caddyfile is checked as text, and its one matcher is run against the addresses that matter,
// with the mounts it describes standing in for Caddy's file root.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CADDY_FILE_ROOT, REPORT_HEADERS, caddyfile, composeServer, reportsMatcher } from "../generate/compose.ts";
import type { ShopDeploy } from "../generate/compose.ts";
import { DATA_DIR, REPORTS_DIR, REPORTS_SUBPATH, names, planShop, reportBaseUrl } from "../generate/shop.ts";
import { serverConfig, tempServer } from "./helpers.ts";

const dirs = { app: "/repo", generated: "/srv/generated", secrets: "/srv/secrets", status: "/srv/status", fleet: "/srv/fleet", shops: "/srv/shops", secretsInbox: "/srv/secrets-inbox", requests: "/srv/requests", exports: "/srv/exports", panelData: "/srv/panel", config: "/srv/geometer.json" };
const shop = (name: string, index: number): ShopDeploy => ({ name, index, pathwayDir: "/repo/pathways/bookings", guards: (["razorpay", "whatsapp", "calendar"] as const).map((kind) => ({ kind, service: names.guard(name, kind), tenant: name })) });
const build = (shops: ShopDeploy[], change: Record<string, unknown> = {}) => composeServer(serverConfig({ panel: { enabled: true }, ...change }), dirs, shops, { backup: false, panel: { user: "501:20" } });
const mounts = (c: ReturnType<typeof build>, svc: string): unknown[] => (c.services[svc].block.volumes as unknown[]) ?? [];
const HEX = "3f9a1c7d2b8e4f60a1b2c3d4e5f60718";
const OTHER = "00112233445566778899aabbccddeeff";

/**
 * What Caddy does with a request for `path`, as far as the generated Caddyfile says: not under /r -> the panel's; a path that matches the one matcher -> the file in the mounts,
 * if it is there; anything else under /r -> 404. (A mount at /srv/r/<shop> makes the address the file's own path under Caddy's root /srv.)
 */
function serve(text: string, path: string, files: ReadonlySet<string>): "panel" | "404" | "served" {
  if (!/^\/r(\/|$)/iu.test(path)) return "panel";
  const pattern = /^\t\t@report-file path_regexp (.+)$/mu.exec(text)?.[1];
  if (pattern === undefined || !new RegExp(pattern, "u").test(path)) return "404";
  return files.has(path) ? "served" : "404";
}

test("Caddy serves a report file at /r/<shop>/<hex>/<file>", () => {
  const text = caddyfile(serverConfig(), [], ["glow-salon", "bright-tuition"]);
  const files = new Set([`/r/glow-salon/${HEX}/report-2026-11-en.html`, `/r/glow-salon/${HEX}/certificate-2026-11-en.txt`, `/r/glow-salon/${HEX}/report-2026-11.json`, `/r/bright-tuition/${OTHER}/report-2026-11-hi.html`]);
  for (const f of files) assert.equal(serve(text, f, files), "served", f);
  assert.equal(serve(text, "/shops", files), "panel", "the panel and the webhooks are not under /r");
  assert.equal(serve(text, "/c/glow-salon/webhooks/whatsapp", files), "panel");
});

test("and answers 404 for the folder, the shop's folder, /r, a shop that is not there and every way out of the folder", () => {
  const text = caddyfile(serverConfig(), [], ["glow-salon", "bright-tuition"]);
  const files = new Set([`/r/glow-salon/${HEX}/report-2026-11-en.html`, `/r/bright-tuition/${OTHER}/report-2026-11-hi.html`]);
  const refused: [string, string][] = [
    [`/r/glow-salon/${HEX}`, "the folder"], [`/r/glow-salon/${HEX}/`, "the folder, with its slash"],
    ["/r/glow-salon", "the shop's folder"], ["/r/glow-salon/", "the shop's folder, with its slash"], ["/r", "/r"], ["/r/", "/r/"], ["/R/glow-salon", "another case"],
    [`/r/glow-salon/${OTHER}/report-2026-11-en.html`, "a folder that is not there"],
    [`/r/glow-salon/${HEX.toUpperCase()}/report-2026-11-en.html`, "capital letters in the folder name"], [`/r/glow-salon/${HEX.slice(1)}/report-2026-11-en.html`, "31 digits"], [`/r/glow-salon/${HEX}0/report-2026-11-en.html`, "33 digits"],
    [`/r/other-shop/${HEX}/report-2026-11-en.html`, "a shop this server does not have"], [`/r/glow-salon-2/${HEX}/report-2026-11-en.html`, "a shop whose name only starts like one"],
    [`/r/glow-salon/${HEX}/../${OTHER}/report-2026-11-en.html`, "a step up and over to another folder"], [`/r/glow-salon/${HEX}/../../../../etc/passwd`, "up to the root"],
    [`/r/glow-salon/${HEX}/%2e%2e/%2e%2e/etc/passwd`, "the same, with the dots encoded"], [`/r/glow-salon/${HEX}/..%2f..%2fetc%2fpasswd`, "the same, with the slashes encoded"],
    [`/r/glow-salon/${HEX}/.env`, "a hidden file"], [`/r/glow-salon/${HEX}/..`, "the folder above"], [`/r/glow-salon/${HEX}/.report.html`, "a hidden report"],
    [`/r/glow-salon/${HEX}/report.pem`, "another kind of file"], [`/r/glow-salon/${HEX}/report-2026-11-en.html.bak`, "a name that only starts like a report"], [`/r/glow-salon/${HEX}/sub/report-2026-11-en.html`, "a name with a folder in it"],
    [`/r/glow-salon/data/reports/${HEX}/report-2026-11-en.html`, "the shop's data folder"], ["/r/glow-salon/../rt-data/record.json", "the shop's database"],
    [`/r/glow-salon/${HEX}/report-2026-11-en.html\n`, "a line break after the name"],
  ];
  for (const [path, why] of refused) assert.equal(serve(text, path, files), "404", `${why}: ${path}`);
  // no folder listing and no index to fall back on, and no brace quantifier inside a Caddyfile word
  assert.doesNotMatch(text, /browse/u);
  assert.doesNotMatch(text, /\{32\}/u);
});

test("the Caddyfile is one handle for /r: the exact file shape is served from the mounts, the catch-all inside it is a 404, and the panel still gets everything else", () => {
  const text = caddyfile(serverConfig({ panel: { enabled: true } }), [], ["glow-salon"]);
  const lines = text.split("\n");
  const at = (needle: string) => lines.findIndex((l) => l.includes(needle));
  assert.ok(at("@report-area path /r /r/*") > at("handle /c/*"), "after the webhooks");
  assert.ok(at("@report-area path /r /r/*") < at("reverse_proxy panel:8790"), "before the panel's catch-all");
  const area = at("handle @report-area {");
  const file = at("handle @report-file {");
  const rest = lines.findIndex((l, i) => i > file && l === "\t\thandle {");
  assert.ok(area < file && file < rest, "the file handle, then the catch-all");
  assert.equal(lines[rest + 1], "\t\t\trespond 404");
  assert.equal(lines[file + 1], `\t\t\troot * ${CADDY_FILE_ROOT}`);
  assert.ok(lines.slice(file, rest).includes("\t\t\tfile_server"));
  for (const [k, v] of REPORT_HEADERS) assert.ok(text.includes(`${k} "${v}"`), k);
  assert.match(text, /Cache-Control "private, no-store"/u);
  assert.match(text, /Content-Security-Policy "default-src 'none'; style-src 'unsafe-inline'; img-src data:;/u, "the policy the panel gives the same pages: no script, nothing external");
  assert.equal(reportsMatcher(["glow-salon", "bright-tuition"]), `^/r/(?:glow-salon|bright-tuition)/${"[0-9a-f]".repeat(32)}/[A-Za-z0-9][A-Za-z0-9._-]*\\.(?:html|json|txt)$`);
  assert.match(caddyfile(serverConfig(), [], ["b-shop", "a-shop"]), /\(\?:a-shop\|b-shop\)/u, "in sorted order, so the same shops are the same text");
});

test("a server with no shop yet still answers 404 under /r, and serves nothing there", () => {
  const text = caddyfile(serverConfig({ panel: { enabled: true } }), [], []);
  assert.match(text, /handle @report-area \{\n\t\thandle \{\n\t\t\trespond 404\n\t\t\}\n\t\}/u);
  assert.doesNotMatch(text, /file_server|path_regexp/u);
  assert.equal(caddyfile(serverConfig(), [], []), caddyfile(serverConfig()), "no shops is the default");
});

test("Caddy mounts each shop's reports folder, read-only, and nothing else of its data volume", () => {
  const c = build([shop("glow-salon", 1), shop("bright-tuition", 2)]);
  assert.deepEqual(mounts(c, "caddy"), [
    "/srv/generated/Caddyfile:/etc/caddy/Caddyfile:ro", "caddy-data:/data", "caddy-config:/config",
    { type: "volume", source: "rt-data-glow-salon", target: "/srv/r/glow-salon", read_only: true, volume: { subpath: "data/reports" } },
    { type: "volume", source: "rt-data-bright-tuition", target: "/srv/r/bright-tuition", read_only: true, volume: { subpath: "data/reports" } },
  ]);
  assert.equal(REPORTS_SUBPATH, "data/reports");
  assert.equal(`/home/node/${REPORTS_SUBPATH}`, REPORTS_DIR, "the folder Caddy mounts is the folder the runtime is told to write to");
  assert.ok(!mounts(c, "caddy").some((m) => typeof m === "string" && m.includes("/srv/secrets/")), "Caddy still sees no secrets folder");
  assert.deepEqual(Object.keys(c.services.caddy.block.networks as object), ["front"], "no new network");
  assert.deepEqual(mounts(c, "rt-glow-salon"), ["/repo/pathways/bookings:/pathway:ro", "/srv/generated/shops/glow-salon/client:/client:ro", "/srv/secrets/rt-glow-salon:/run/secrets:ro", "rt-data-glow-salon:/home/node"], "the runtime's mounts are as they were");
  assert.doesNotMatch(c.compose, /docker\.sock/u);
});

test("the one-shot that makes the folder runs before Caddy, as the runtime's own user and image, with no network and no wait on anything", () => {
  const c = build([shop("glow-salon", 1), shop("bright-tuition", 2)]);
  assert.deepEqual(c.services.caddy.block.depends_on, { "rd-glow-salon": { condition: "service_completed_successfully" }, "rd-bright-tuition": { condition: "service_completed_successfully" } });
  const rd = c.services["rd-glow-salon"].block;
  assert.deepEqual(rd.command, ["mkdir", "-p", "/home/node/data/reports"]);
  assert.deepEqual(rd.volumes, ["rt-data-glow-salon:/home/node"], "the shop's own volume at the runtime's own path, so a fresh volume is owned as the runtime would own it");
  assert.equal(rd.user, "1000:1000");
  assert.equal(rd.image, serverConfig().appImage, "the runtime's own image");
  assert.equal(rd.restart, "no");
  assert.equal(rd.network_mode, "none");
  assert.equal(rd.read_only, true);
  assert.deepEqual(rd.cap_drop, ["ALL"]);
  assert.equal(rd.networks, undefined);
  assert.equal(rd.depends_on, undefined, "it waits for nothing, so a shop whose Guards are down does not hold Caddy back");
  assert.match(c.compose, /\n {4}restart: "no"/u, "quoted: a bare no is a boolean in YAML");
  assert.deepEqual(Object.keys(c.services).filter((n) => n.startsWith("rd-")).sort(), ["rd-bright-tuition", "rd-glow-salon"]);
  assert.equal(build([]).services.caddy.block.depends_on, undefined, "no shop, nothing to wait for");
});

test("the address in the message is the address Caddy serves: https://<domain>/r/<shop>, with the port when it is not 443", () => {
  assert.equal(reportBaseUrl(serverConfig(), "glow-salon"), "https://shops.example.com/r/glow-salon");
  assert.equal(reportBaseUrl(serverConfig({ ports: { https: 8443 } }), "glow-salon"), "https://shops.example.com:8443/r/glow-salon");
  assert.match(`${reportBaseUrl(serverConfig(), "glow-salon")}/${HEX}/report-2026-11-en.html`.replace("https://shops.example.com", ""), new RegExp(reportsMatcher(["glow-salon"])), "a link the job would build is a link the matcher serves");
});

test("the folder the runtime is told to write is the folder Caddy mounts", () => {
  const t = tempServer(); try {
    const p = planShop(serverConfig(), t.shop("glow-salon"));
    assert.equal(p.runtime.dataDir, DATA_DIR);
    assert.equal((p.runtime.report as { pagesDir: string }).pagesDir, REPORTS_DIR);
  } finally { t.done(); }
});
