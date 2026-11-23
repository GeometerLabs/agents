// lib/strip-app.ts and the compose commands that use its output (stream N1, 24 Nov 2026): the stripping keeps every line and column, only relative `.ts` specifiers are
// rewritten, a rebuild keeps the folder and the files that did not change and removes what is gone, every Node process of the server can be imported from the output (so
// nothing a service reaches was left out), and compose names the `.js` files and the memory flags in one place.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { APP_FOLDERS, buildAppJs, rewriteSpecifiers, stripFile } from "../lib/strip-app.ts";
import { NODE_OLD_SPACE_MB, NODE_SEMI_SPACE_MB, composeServer } from "../generate/compose.ts";
import { serverConfig } from "./helpers.ts";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const temp = (): string => mkdtempSync(join(tmpdir(), "strip-app-"));
const put = (root: string, file: string, text: string): void => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text); };

test("types are blanked in place: every line and column stays, so a stack trace in the .js points at the .ts", () => {
  const ts = "import type { A } from \"./a.ts\";\nexport function f(x: number, y?: A): string {\n  const z: Record<string, number> = {};\n  return `${x}${z}`;\n}\n";
  const js = stripFile(ts);
  assert.equal(js.split("\n").length, ts.split("\n").length);
  assert.ok(js.split("\n").every((line, i) => line.length === ts.split("\n")[i].length), "no line changed length");
  assert.doesNotMatch(js, /: number|: string|Record</u);
  assert.match(js, /return `\$\{x\}\$\{z\}`;/u);
});

test("only the specifier of a relative import is rewritten from .ts to .js", () => {
  assert.equal(rewriteSpecifiers('import { a } from "./a.ts";'), 'import { a } from "./a.js";');
  assert.equal(rewriteSpecifiers("export { b } from '../x/b.ts';"), "export { b } from '../x/b.js';");
  assert.equal(rewriteSpecifiers('import "./side.ts";'), 'import "./side.js";');
  assert.equal(rewriteSpecifiers('const m = await import("../agent/facts.ts");'), 'const m = await import("../agent/facts.js");');
  // a package, a node: module, a JSON file and plain text that merely ends in .ts stay as they are
  assert.equal(rewriteSpecifiers('import { x } from "node:fs"; import d from "./d.json" with { type: "json" }; const s = "see ./notes.ts";'), 'import { x } from "node:fs"; import d from "./d.json" with { type: "json" }; const s = "see ./notes.ts";');
});

test("a build writes a .js beside each .ts, copies other files, leaves tests out, keeps unchanged files and removes gone ones", () => {
  const from = temp(); const to = temp();
  try {
    put(from, "bundle/a.ts", 'import { b } from "./b.ts";\nexport const a: number = b;\n');
    put(from, "bundle/b.ts", "export const b: number = 1;\n");
    put(from, "bundle/data.json", '{"k":1}\n');
    put(from, "bundle/a.test.ts", "export const t = 1;\n");
    put(from, "bundle/test/helper.ts", "export const h = 1;\n");
    put(from, "elsewhere/ignored.ts", "export const i = 1;\n");
    const first = buildAppJs(from, to);
    assert.equal(first.stripped, 2);
    assert.equal(readFileSync(join(to, "bundle/a.js"), "utf8"), 'import { b } from "./b.js";\nexport const a         = b;\n');
    assert.ok(existsSync(join(to, "bundle/a.ts")), "the .ts twin is kept for the CLI's exec of .ts paths");
    assert.equal(readFileSync(join(to, "bundle/data.json"), "utf8"), '{"k":1}\n');
    for (const gone of ["bundle/a.test.js", "bundle/a.test.ts", "bundle/test/helper.ts", "elsewhere/ignored.ts"]) assert.ok(!existsSync(join(to, gone)), `${gone} is not in the output`);
    // a second build changes nothing
    const ino = statSync(join(to, "bundle/b.js")).ino;
    const second = buildAppJs(from, to);
    assert.deepEqual([second.stripped, second.written, second.removed], [0, 0, 0]);
    // a changed file is written again IN PLACE (same folder), and a deleted source takes its twins with it
    put(from, "bundle/b.ts", "export const b: number = 2;\n");
    rmSync(join(from, "bundle/data.json"));
    const third = buildAppJs(from, to);
    assert.equal(third.stripped, 1); assert.equal(third.removed, 1);
    assert.match(readFileSync(join(to, "bundle/b.js"), "utf8"), /= 2;/u);
    assert.ok(!existsSync(join(to, "bundle/data.json")));
    assert.equal(statSync(join(to, "bundle/b.js")).ino, ino, "the file is rewritten in place");
    rmSync(join(from, "bundle/b.ts"));
    buildAppJs(from, to);
    assert.ok(!existsSync(join(to, "bundle/b.js")) && !existsSync(join(to, "bundle/b.ts")), "a removed source leaves no stale .js behind");
  } finally { rmSync(from, { recursive: true, force: true }); rmSync(to, { recursive: true, force: true }); }
});

test("every Node process of the server (six services and the panel) can be imported from the stripped copy of this checkout", () => {
  const to = temp();
  try {
    buildAppJs(APP, to, APP_FOLDERS);
    const entries = ["inbox", "relay", "refresher", "push", "ops", "door"].map((s) => `bundle/services/${s}.js`).concat("bundle/panel/server.js", "bundle/panel/ondemand.js");
    // importing runs no server: each service starts only under import.meta.main. The panel's main.js starts the program whenever it is imported (it has no such guard), so the test
    // imports server.js, the file main.js builds the panel from (it reaches the same pages, sign-in and setup code), and checks that main.js exists and is stripped.
    const code = `const files = ${JSON.stringify(entries.map((e) => join(to, e)))}; for (const f of files) await import(f);`;
    const r = spawnSync(process.execPath, ["--input-type=module", "--disable-warning=ExperimentalWarning", "-e", code], { encoding: "utf8", timeout: 60_000 });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(join(to, "bundle/panel/main.js")));
    // and the .js files are plain JavaScript: none still imports a `.ts` file
    for (const e of [...entries, "bundle/panel/main.js"]) assert.doesNotMatch(readFileSync(join(to, e), "utf8"), /from "\.[^"]*\.ts"/u, e);
  } finally { rmSync(to, { recursive: true, force: true }); }
});

const dirs = { app: "/repo", generated: "/srv/generated", secrets: "/srv/secrets", status: "/srv/status", fleet: "/srv/fleet", shops: "/srv/shops", secretsInbox: "/srv/secrets-inbox", requests: "/srv/requests", exports: "/srv/exports", panelData: "/srv/panel", config: "/srv/geometer.json", licence: "/srv/licence", home: "/srv/home" };
const compose = (extra: Record<string, unknown> = {}) => composeServer(serverConfig({ panel: { enabled: true, mode: "hosted" }, fleet: { url: "https://fleet.example", keyFile: "fleet.key" }, pages: { domain: "pages.example", extraDomains: [] } } as never), { ...dirs, ...extra } as never, [
  { name: "glow-salon", index: 1, pathwayDir: "/repo/templates/commerce/bookings", guards: [] },
], { panel: { user: "501:20" }, goImage: "geo-go:1" });
const cmd = (c: ReturnType<typeof compose>, s: string): string[] => c.services[s].block.command as string[];

test("compose gives every Node process the same memory flags from one table, and the .js file only when the stripped copy is there", () => {
  const services = ["inbox", "relay", "refresher", "push", "ops", "door", "panel"] as const;
  const file = { inbox: "services/inbox", relay: "services/relay", refresher: "services/refresher", push: "services/push", ops: "services/ops", door: "services/door", panel: "panel/main" };
  const plain = compose();
  const stripped = compose({ appJs: "/srv/app-js" });
  for (const s of services) {
    const flags = ["node", `--max-semi-space-size=${NODE_SEMI_SPACE_MB}`, `--max-old-space-size=${NODE_OLD_SPACE_MB[s]}`];
    assert.deepEqual(cmd(plain, s).slice(0, 3), flags, `${s} flags`);
    assert.equal(cmd(plain, s)[3], `/app/bundle/${file[s]}.ts`);
    assert.deepEqual(cmd(stripped, s).slice(0, 3), flags);
    assert.equal(cmd(stripped, s)[3], `/app/bundle/${file[s]}.js`);
    const volumes = (stripped.services[s].block.volumes as string[]).filter((v) => v.endsWith(":/app:ro"));
    assert.deepEqual(volumes, ["/srv/app-js:/app:ro"], `${s} mounts the stripped copy as /app`);
    assert.deepEqual((plain.services[s].block.volumes as string[]).filter((v) => v.endsWith(":/app:ro")), ["/repo:/app:ro"]);
  }
  assert.deepEqual(cmd(stripped, "ops").slice(4), ["run"]);
});
