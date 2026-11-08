// The plugin and marketplace files against the shape Claude Code documents (code.claude.com/docs/en/plugins-reference and /plugin-marketplaces), and the skills'
// frontmatter. When the `claude` program is on the machine, its own validator is run too.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/u, "");
const PLUGIN = join(ROOT, "plugin");
const plugin = JSON.parse(readFileSync(join(PLUGIN, ".claude-plugin", "plugin.json"), "utf8"));
const market = JSON.parse(readFileSync(join(ROOT, ".claude-plugin", "marketplace.json"), "utf8"));
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/u;

test("plugin.json has the documented shape", () => {
  assert.match(plugin.name, KEBAB);
  assert.ok(!/^(claude-|anthropic-|anthropics-|cc-plugin-)/u.test(plugin.name) && !["claude", "anthropic", "anthropics", "claude-code", "claude-mods"].includes(plugin.name), "not a reserved name");
  assert.equal(typeof plugin.version, "string");
  assert.ok(plugin.description.length > 20);
  assert.equal(typeof plugin.author.name, "string");
  assert.doesNotThrow(() => new URL(plugin.homepage));
  assert.equal(plugin.license, "Apache-2.0");
  for (const [key, o] of Object.entries<any>(plugin.userConfig)) {
    assert.match(key, /^[A-Za-z_][A-Za-z0-9_]*$/u);
    assert.ok(["string", "number", "boolean", "directory", "file"].includes(o.type), key);
    assert.ok(o.title && o.description, key);
    assert.deepEqual(Object.keys(o).filter((k) => !["type", "title", "description", "required", "default", "options", "multiple", "sensitive", "min", "max"].includes(k)), [], `${key} has an unknown key`);
  }
  const server = plugin.mcpServers.geometer;
  assert.equal(server.command, "node");
  assert.ok(server.args[0].startsWith("${CLAUDE_PLUGIN_ROOT}/"));
  assert.ok(existsSync(join(PLUGIN, server.args[0].replace("${CLAUDE_PLUGIN_ROOT}/", ""))), "the server file exists");
  for (const v of Object.values<string>(server.env)) assert.match(v, /^\$\{user_config\.(\w+)\}$/u);
  for (const v of Object.values<string>(server.env)) assert.ok(v.slice(14, -1) in plugin.userConfig, `${v} is declared in userConfig`);
  // no path escapes the plugin
  assert.ok(!JSON.stringify(plugin).includes(".."));
});

test("marketplace.json has the documented shape and lists this plugin", () => {
  assert.match(market.name, KEBAB);
  assert.ok(!/^(claude-plugins-official|anthropic-)/u.test(market.name));
  assert.equal(typeof market.owner.name, "string");
  assert.equal(market.plugins.length, 1);
  const entry = market.plugins[0];
  assert.equal(entry.name, plugin.name, "the entry name and the manifest name are the same");
  assert.ok(entry.source.startsWith("./") && !entry.source.includes(".."));
  assert.ok(existsSync(join(ROOT, entry.source, ".claude-plugin", "plugin.json")), "the source folder holds the plugin");
});

test("every skill is a folder with a SKILL.md whose name is the folder's and whose description says when to use it", () => {
  const dirs = readdirSync(join(PLUGIN, "skills"), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  assert.deepEqual(dirs, ["client-report", "crash-test", "go-live", "set-limits", "set-up-template"]);
  for (const d of dirs) {
    const text = readFileSync(join(PLUGIN, "skills", d, "SKILL.md"), "utf8");
    const m = /^---\nname: (.+)\ndescription: (.+)\n---\n/u.exec(text);
    assert.ok(m, `${d} has frontmatter`);
    assert.equal(m[1], d);
    assert.match(m[2], /Use when/u);
    assert.ok(text.includes("GEOMETER-DATA"), `${d} tells Claude that tool text is data`);
  }
});

test("the skills hold the reply rules: never loosen a limit, never 'safe', list what was not tested, nothing is confirmed from the chat", () => {
  const read = (d: string) => readFileSync(join(PLUGIN, "skills", d, "SKILL.md"), "utf8");
  assert.match(read("set-limits"), /Never loosen a limit/u);
  assert.match(read("set-limits"), /Never open the confirmation link yourself/u);
  assert.match(read("crash-test"), /What was not tested\.\*\* Always list it/u);
  assert.match(read("crash-test"), /Never say "safe"/u);
  assert.match(read("crash-test"), /What happened to the customer/u);
  assert.match(read("go-live"), /Never open the link, press its button, or tick its boxes/u);
  assert.match(read("go-live"), /whether Meta has approved the WhatsApp templates/u);
  for (const d of ["set-up-template", "set-limits", "crash-test", "go-live", "client-report"]) assert.match(read(d), /Never edit|Do not edit/u, d);
  // words the product does not use about itself
  for (const d of ["set-up-template", "set-limits", "crash-test", "go-live", "client-report"]) for (const bad of [/\bproves?\b/iu, /100%/u, /\bfounder\b/iu, /\bfounding\b/iu, /\bguaranteed\b(?! ")/iu]) {
    const text = read(d).replace(/Never say "safe", "guaranteed", "proves" or "certified"\./u, "");
    assert.ok(!bad.test(text), `${d}: ${bad}`);
  }
});

const claude = spawnSync("claude", ["--version"], { encoding: "utf8" });
test("Claude Code's own validator passes the plugin and the marketplace", { skip: claude.status !== 0 && "the claude program is not on this machine" }, () => {
  for (const target of [PLUGIN, ROOT]) {
    const r = spawnSync("claude", ["plugin", "validate", target], { encoding: "utf8", timeout: 60_000 });
    assert.equal(r.status, 0, `${target}\n${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /Validation passed/u);
  }
});
