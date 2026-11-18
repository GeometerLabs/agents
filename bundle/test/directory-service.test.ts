// The directory service in the bundle (block S, written 18 Nov 2026; not run): what compose.ts makes of it (its own container on the pages and egress networks only, a volume of
// its own that no backup copies, no secret mounted, reached through the door and not named in Caddy), its config, the geometer.json `directory` setting, its network rules
// (a shop of this server through the door's own port with the pages Host; anything else directly and only to a public address) and its signing key file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DIRECTORY_DATA_DIR, DIRECTORY_VOLUME, caddyfile, composeServer } from "../generate/compose.ts";
import { directoryConfig } from "../generate/configs.ts";
import { parseServer } from "../lib/server.ts";
import { directoryFetcher, loadKey } from "../services/directory.ts";
import type { Transport } from "../services/door.ts";
import { serverConfig } from "./helpers.ts";

const DIRS = { app: "/repo", generated: "/srv/generated", secrets: "/srv/secrets", status: "/srv/status", fleet: "/srv/fleet", shops: "/srv/shops", secretsInbox: "/srv/secrets-inbox", requests: "/srv/requests", exports: "/srv/exports", panelData: "/srv/panel", config: "/srv/geometer.json", licence: "/srv/state/licence", home: "/srv/home" };
const hosted = (extra: Record<string, unknown> = {}) => serverConfig({ panel: { enabled: true, mode: "hosted" }, fleet: { url: "https://fleet.example", keyFile: "fleet.key" }, pages: { domain: "pages.example", extraDomains: ["old.example"] }, ...extra });

test("the directory is its own container on the pages and egress networks, with a volume of its own, no secret, and nothing else reaches it but the door", () => {
  const c = composeServer(hosted(), DIRS, [], {});
  const d = c.services.directory.block as { command: string[]; networks: Record<string, unknown>; volumes: string[]; healthcheck: { test: string[] }; environment: Record<string, string>; user: string; read_only: boolean };
  assert.deepEqual(d.command, ["node", "/app/bundle/services/directory.ts"]);
  assert.deepEqual(Object.keys(d.networks).sort(), ["egress", "pages"], "no admin, front, panel or shop network: it reaches no runtime, Guard, relay or panel");
  assert.ok(!d.volumes.some((v) => v.includes("/secrets")), "no secret is mounted");
  assert.ok(d.volumes.includes(`${DIRECTORY_VOLUME}:/home/node`), "its cache and its key are in a volume of its own");
  assert.ok(d.volumes.includes("/srv/generated/directory:/etc/geometer:ro"));
  assert.ok(d.volumes.includes("/repo:/app:ro"));
  assert.equal(d.read_only, true);
  assert.equal(d.user, "1000:1000");
  assert.equal(d.environment.PORT, "8799");
  assert.ok(d.healthcheck.test.join(" ").includes("127.0.0.1:8799/healthz"));
  assert.match(c.compose, new RegExp(`\\n  ${DIRECTORY_VOLUME}:`, "u"), "the volume is declared");
  assert.deepEqual(c.services.directory.files, ["/srv/generated/directory/directory.json"], "a changed config restarts it");
  const door = c.services.door.block as { environment: Record<string, string>; networks: Record<string, unknown> };
  assert.equal(door.environment.INTERNAL_PORT, "8798");
  assert.deepEqual(Object.keys(door.networks).sort(), ["egress", "pages"]);
  // nothing but the door names the directory: Caddy sends everything under the pages domain to the door
  assert.ok(!caddyfile(hosted(), [], ["veena"]).includes("directory"), "Caddy does not name the directory");
});

test("a server with no pages domain has no directory, no volume and no door port", () => {
  const builder = serverConfig({ panel: { enabled: true } });
  const c = composeServer(builder, DIRS, [], {});
  assert.equal(c.services.directory, undefined);
  assert.equal(c.services.door, undefined);
  assert.ok(!c.compose.includes(DIRECTORY_VOLUME));
  assert.equal(directoryConfig(builder), undefined);
});

test("the directory's volume is a cache that no backup copies", () => {
  const jobs = readFileSync(new URL("../backup/jobs.ts", import.meta.url), "utf8");
  assert.ok(!jobs.includes(DIRECTORY_VOLUME) && !/directory-data|DIRECTORY_VOLUME/u.test(jobs), "backup/jobs.ts names the volumes it copies, and this is not one");
  assert.match(readFileSync(new URL("../generate/compose.ts", import.meta.url), "utf8"), /that no backup copies/u);
});

test("its config: the pages domains it serves, the door's own port, its folder, the feeds named in geometer.json, who runs it; no secret", () => {
  const text = directoryConfig(hosted({ directory: { feeds: ["https://shops.example/s/ravi/listings.json"], area: "Kerala" } }))!;
  assert.deepEqual(JSON.parse(text), { origin: "https://pages.example", served: ["pages.example", "old.example"], doorUrl: "http://door:8798", dataDir: DIRECTORY_DATA_DIR, feeds: ["https://shops.example/s/ravi/listings.json"], provider: { organization: "Geometer", url: "https://pages.example" }, area: "Kerala" });
  assert.deepEqual(JSON.parse(directoryConfig(hosted())!).feeds, []);
  assert.ok(!/key|secret|token|password/iu.test(text.replace("dataDir", "")));
});

test("geometer.json `directory`: feeds are https addresses, at most 200, and it needs the pages domain", () => {
  const base = { schema: 1, id: "partner-1", domain: "partners.example", reviewedBy: "t", panel: { enabled: true, mode: "hosted" }, fleet: { url: "https://fleet.example", keyFile: "fleet.key" }, pages: { domain: "pages.example", extraDomains: [] } };
  const errors = (directory: unknown, withPages = true) => parseServer({ ...base, ...(withPages ? {} : { pages: undefined }), directory }).errors.join(" ");
  assert.equal(errors({ feeds: ["https://shops.example/s/ravi/listings.json"], area: "Kerala" }), "");
  assert.equal(errors({}), "", "both parts are optional");
  assert.match(errors({ feeds: ["http://shops.example/x/listings.json"] }), /"directory" must say/u);
  assert.match(errors({ feeds: ["not an address"] }), /"directory" must say/u);
  assert.match(errors({ feeds: Array.from({ length: 201 }, (_, i) => `https://x.example/${i}/listings.json`) }), /"directory" must say/u);
  assert.match(errors({ feeds: [], extra: 1 }), /"directory" must say/u);
  assert.match(errors("yes"), /"directory" must say/u);
  assert.match(errors({ feeds: [] }, false), /needs "pages"/u);
  assert.deepEqual(parseServer({ ...base, directory: { feeds: ["https://a.example/b/listings.json"], area: "Kerala" } }).config.directory, { feeds: ["https://a.example/b/listings.json"], area: "Kerala" });
});

test("its way out: this server's shops through the door's own port with the pages domain as Host; anything else straight out, and only to a public address", async () => {
  const seen: { target: string; headers: Record<string, string>; body?: string; which: string }[] = [];
  const t = (which: string): Transport => async (target, init) => {
    seen.push({ target: target.href, headers: init.headers, ...(init.body ? { body: init.body.toString() } : {}), which });
    return { status: 200, headers: { ETag: '"v1"', "Content-Type": "application/json" } as never, body: Buffer.from('{"ok":true}') };
  };
  const fetch = directoryFetcher({ served: ["pages.example", "old.example"], doorUrl: "http://door:8798", local: t("door"), remote: t("direct") });
  const a = await fetch("https://pages.example/rani-pets/listings.json", { method: "GET", headers: { accept: "application/json", "if-none-match": '"v1"' }, timeoutMs: 1000, maxBytes: 1_000_000 });
  assert.deepEqual([seen[0].which, seen[0].target, seen[0].headers.host, seen[0].headers["if-none-match"]], ["door", "http://door:8798/rani-pets/listings.json", "pages.example", '"v1"']);
  assert.deepEqual([a.status, a.headers.etag, a.body], [200, '"v1"', '{"ok":true}'], "header names are lower case, the body is text");
  await fetch("https://pages.example/rani-pets/api/v1/check", { method: "POST", headers: { "content-type": "application/json" }, body: '{"format":"shop-check/1","ids":["l-3"]}', timeoutMs: 1000, maxBytes: 65536 });
  assert.equal(seen[1].body, '{"format":"shop-check/1","ids":["l-3"]}');
  assert.equal(seen[1].headers["content-length"], String(Buffer.byteLength(seen[1].body!)));
  await fetch("https://shops.example/s/ravi/listings.json", { method: "GET", timeoutMs: 1000, maxBytes: 1_000_000 });
  assert.deepEqual([seen[2].which, seen[2].target], ["direct", "https://shops.example/s/ravi/listings.json"]);
  for (const bad of ["https://10.0.0.5/x/listings.json", "https://localhost/x", "http://shops.example/x", "https://169.254.169.254/latest/meta-data", "https://shops.internal/x"]) await assert.rejects(() => fetch(bad, { method: "GET", timeoutMs: 1000, maxBytes: 1000 }), /not an address the directory reads/u, bad);
  assert.equal(seen.length, 3, "a refused address was never called");
  await assert.rejects(() => fetch("https://shops.example/s/ravi/listings.json", { method: "GET", timeoutMs: 1000, maxBytes: 5 }), /too big/u);
});

test("its signing key is made on the first start in its own folder with mode 0600, and the same key is read after", () => {
  const dir = mkdtempSync(join(tmpdir(), "directory-key-"));
  try {
    const first = loadKey(dir);
    const file = join(dir, "directory.key");
    assert.ok(existsSync(file));
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(loadKey(dir).keyId, first.keyId);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
