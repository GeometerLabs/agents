// The owner's monthly report (B54) switched on by the bundle: the GENERATED runtime config of every shop gets a `report` block (who set the shop up, the Innovator badge from
// fleet's answer, where Caddy serves the pages), only if the pathway's own validator accepts the key; a change to either live fact redeploys the shop; and the builder's own copy
// of the report (the panel) carries the same name and badge.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { validateRuntimeConfig } from "../../pathways/bookings/server/config.ts";
import { applyOnce } from "../apply.ts";
import { checkShop, deploy, desiredHashOf } from "../deploy.ts";
import { main } from "../geometer.ts";
import { withReport, planShop } from "../generate/shop.ts";
import type { ReportFacts } from "../generate/shop.ts";
import { failed, ok } from "../lib/runner.ts";
import { DEFAULT_PREPARED_BY, readShop } from "../lib/server.ts";
import { loadState, saveState } from "../lib/state.ts";
import { preparedByOf } from "../panel/contract.ts";
import { EXAMPLE_CLIENT, serverConfig, tempServer } from "./helpers.ts";
import { world } from "./world.ts";

const NOW = "2026-11-05T10:00:00.000Z";
const answer = (more: Record<string, unknown> = {}) => ({ schema: 1, at: NOW, plan: "business", allowance: 3000, innovator: false, ai: "normal", warn: [], ...more });
const putAnswer = (paths: { fleet: string; fleetAnswer: (n: string) => string }, value: unknown, shop = "glow-salon") => { mkdirSync(paths.fleet, { recursive: true }); writeFileSync(paths.fleetAnswer(shop), typeof value === "string" ? value : JSON.stringify(value)); };
const putOwner = (paths: { shop: (n: string) => string }, more: Record<string, unknown> = {}, shop = "glow-salon") => writeFileSync(join(paths.shop(shop), "owner.json"), JSON.stringify({ schema: 1, accountId: "acc_1", accountName: "Divya", role: "partner", createdAt: "2026-11-01T10:00:00Z", template: "bookings", ...more }));
const putReportFile = (paths: { shop: (n: string) => string }, value: unknown, shop = "glow-salon") => writeFileSync(join(paths.shop(shop), "report.json"), typeof value === "string" ? value : JSON.stringify(value));
const reportOf = (p: { runtime: Record<string, unknown> }) => p.runtime.report as Record<string, unknown> | undefined;
/** A pathway version from before the report: its runtime refuses a `report` key. */
const oldPathway = (config: unknown, folder: string) => ("report" in (config as object) ? { ok: false, errors: ['runtime.json: "report" is not a setting I know.'] } : validateRuntimeConfig(config, folder));

test("every shop the bundle deploys gets a report block: the name, the badge, Caddy's address and the folder the pages go to, and the config is one the runtime accepts", () => {
  const t = tempServer(); try {
    putOwner(t.paths);
    putAnswer(t.paths, answer({ innovator: true }));
    const p = planShop(serverConfig(), t.shop("glow-salon"));
    assert.deepEqual(p.problems, []);
    assert.deepEqual(p.notes, []);
    assert.deepEqual(reportOf(p), { preparedBy: "Divya, local partner", innovator: true, pageBaseUrl: "https://shops.example.com/r/glow-salon", pagesDir: "/home/node/data/reports", source: "test-mode" });
    const checked = validateRuntimeConfig(p.runtime, "/");
    assert.equal(checked.ok, true, "so the shop starts");
    assert.equal(checked.ok && checked.config.report?.innovator, true, "and the runtime reads the badge from it");
  } finally { t.done(); }
});

test("the badge follows fleet's answer for the shop: on, off, no answer, an answer that is not a plain yes, and another shop's answer", () => {
  const t = tempServer(); try {
    putOwner(t.paths);
    const badge = () => reportOf(planShop(serverConfig(), t.shop("glow-salon")))?.innovator;
    assert.equal(badge(), false, "no answer yet: no badge");
    putAnswer(t.paths, answer({ innovator: true })); assert.equal(badge(), true);
    putAnswer(t.paths, answer({ innovator: false })); assert.equal(badge(), false);
    putAnswer(t.paths, answer({ innovator: "yes" })); assert.equal(badge(), false, "only a plain true");
    putAnswer(t.paths, answer({ innovator: 1 })); assert.equal(badge(), false);
    putAnswer(t.paths, "{ not json"); assert.equal(badge(), false);
    putAnswer(t.paths, answer({ innovator: true }), "another-shop"); assert.equal(badge(), false, "another shop's answer is not this shop's");
    putAnswer(t.paths, answer({ innovator: true, ai: "buttons", reason: "overage_unfunded" })); assert.equal(badge(), true, "button mode does not take the badge away");
  } finally { t.done(); }
});

test("the address is the server's: its domain, and its port when it is not 443; a live Razorpay account says live, anything else says test", () => {
  const t = tempServer(); try {
    putOwner(t.paths);
    assert.equal(reportOf(planShop(serverConfig({ ports: { https: 8443 } }), t.shop("glow-salon")))?.pageBaseUrl, "https://shops.example.com:8443/r/glow-salon");
    assert.equal(reportOf(planShop(serverConfig({ domain: "localhost" }), t.shop("glow-salon")))?.pageBaseUrl, "https://localhost/r/glow-salon");
    assert.equal(reportOf(planShop(serverConfig(), t.shop("glow-salon")))?.source, "test-mode");
    writeFileSync(join(t.paths.shop("glow-salon"), "pins.json"), JSON.stringify({ schema: 1, razorpay: { keyId: "rzp_live_abcdefghij", mode: "live" } }));
    assert.equal(reportOf(planShop(serverConfig(), t.shop("glow-salon")))?.source, "live");
    writeFileSync(join(t.paths.shop("glow-salon"), "pins.json"), JSON.stringify({ schema: 1, razorpay: { keyId: "rzp_test_abcdefghij", mode: "test" } }));
    assert.equal(reportOf(planShop(serverConfig(), t.shop("glow-salon")))?.source, "test-mode");
  } finally { t.done(); }
});

test("who set the shop up: report.json first, then the panel's attribution (a partner or a builder), then a plain default that the deploy says it used", () => {
  const t = tempServer(); try {
    const by = () => { const p = planShop(serverConfig(), t.shop("glow-salon")); return { name: reportOf(p)?.preparedBy, notes: p.notes, problems: p.problems }; };
    rmSync(join(t.paths.shop("glow-salon"), "owner.json")); // a shop made by `shop add`, not by the panel
    const none = by();
    assert.equal(none.name, DEFAULT_PREPARED_BY);
    assert.equal(DEFAULT_PREPARED_BY, "your builder");
    assert.equal(none.notes.length, 1);
    assert.match(none.notes[0], /nobody is named as having set glow-salon up .*"your builder".*--prepared-by/u);
    putOwner(t.paths);
    assert.deepEqual([by().name, by().notes], ["Divya, local partner", []]);
    putOwner(t.paths, { role: "builder", accountName: "Arjun" });
    assert.equal(by().name, "Arjun, builder");
    putReportFile(t.paths, { schema: 1, preparedBy: "Meera, Kochi partner" });
    assert.deepEqual([by().name, by().notes], ["Meera, Kochi partner", []], "a person's word beats the attribution");
    putReportFile(t.paths, "{ nope");
    assert.match(by().problems[0].message, /report\.json is not usable/u, "a file that cannot be read is said, not skipped");
    putReportFile(t.paths, { schema: 1, preparedBy: "two\nlines" });
    assert.match(by().problems[0].message, /report\.json is not usable/u);
    putReportFile(t.paths, { schema: 1, preparedBy: "x".repeat(121) });
    assert.match(by().problems[0].message, /report\.json is not usable/u);
  } finally { t.done(); }
});

test("the attribution is cut and put on one line so the runtime always accepts it", () => {
  assert.equal(preparedByOf({ accountName: "Divya", role: "partner" }), "Divya, local partner");
  assert.equal(preparedByOf({ accountName: "  Divya \n\t Nair ", role: "builder" }), "Divya Nair, builder");
  const long = preparedByOf({ accountName: "D".repeat(300), role: "partner" });
  assert.equal(long.length, 120);
  assert.ok(long.endsWith(", local partner"));
  const t = tempServer(); try {
    putOwner(t.paths, { accountName: "Divya\nNair\t" + "N".repeat(100) });
    const p = planShop(serverConfig(), t.shop("glow-salon"));
    assert.deepEqual(p.notes, []);
    assert.equal(validateRuntimeConfig(p.runtime, "/").ok, true);
    assert.equal(String(reportOf(p)?.preparedBy).length <= 120, true);
  } finally { t.done(); }
});

test("a pathway whose validator refuses the report key keeps the shop starting: no block, and a note that says why", () => {
  const t = tempServer(); try {
    putOwner(t.paths);
    putAnswer(t.paths, answer({ innovator: true }));
    const p = planShop(serverConfig(), t.shop("glow-salon"), {}, oldPathway);
    assert.equal("report" in p.runtime, false);
    assert.equal(validateRuntimeConfig(p.runtime, "/").ok, true, "it is a config that pathway starts with");
    assert.equal(p.notes.length, 1);
    assert.match(p.notes[0], /monthly report to the owner is not switched on for this shop: this pathway version did not accept the report setting \(runtime\.json: "report" is not a setting I know\.\)/u);
    assert.deepEqual(p.problems, [], "a note, not a refusal");
    // the button-mode key and the report key are judged one at a time: a pathway that knows one and not the other keeps the one it knows
    putAnswer(t.paths, answer({ ai: "buttons", reason: "overage_unfunded" }));
    const both = planShop(serverConfig(), t.shop("glow-salon"), {}, oldPathway);
    assert.equal(both.runtime.ai, "buttons");
    assert.equal("report" in both.runtime, false);
  } finally { t.done(); }
});

/** A version kept beside the server, which is where B53 leaves a client it held back: today's pathway copied, with the report setting taken out of what its runtime knows. */
function keepOldVersion(w: ReturnType<typeof world>, version: string, edit: (configText: string) => string = (t) => t.replace('"pauseMinutes", "report"]', '"pauseMinutes"]')): string {
  const dir = join(w.root, "pathways", `bookings@${version}`);
  cpSync(join(w.ctx.appDir, "pathways", "bookings"), dir, { recursive: true });
  const pkg = join(dir, "package.json");
  writeFileSync(pkg, readFileSync(pkg, "utf8").replaceAll('"version": "0.1.0"', `"version": "${version}"`));
  const config = join(dir, "server", "config.ts");
  const before = readFileSync(config, "utf8");
  const after = edit(before);
  assert.notEqual(after, before, "the copy was changed, or this test tests nothing");
  writeFileSync(config, after);
  writeFileSync(join(w.paths.shop("glow-salon"), "pathway.lock"), `bookings@${version}\n`);
  return dir;
}
const generatedRuntime = (w: ReturnType<typeof world>) => JSON.parse(readFileSync(join(w.root, "generated", "shops", "glow-salon", "client", "runtime.json"), "utf8")) as Record<string, unknown>;

test("a client held back on a version from before the report is judged by THAT version's check: no block, one note, and it starts; moved to today's version it gets the block", async () => {
  const w = world();
  try {
    keepOldVersion(w, "0.0.9");
    putAnswer(w.paths, answer({ ai: "buttons", reason: "overage_unfunded", innovator: true }));
    w.handIn("glow-salon");
    const checked = await checkShop(w.ctx, "glow-salon");
    assert.deepEqual(checked.problems, [], "a note, not a refusal");
    const noted = checked.notes.filter((n) => /monthly report to the owner is not switched on/u.test(n));
    assert.equal(noted.length, 1, checked.notes.join("\n"));
    assert.match(noted[0], /did not accept the report setting \(I don't know what "report" means in runtime\.json\./u, "in that version's own words");
    await deploy(w.ctx);
    const old = generatedRuntime(w);
    assert.equal("report" in old, false, "the older runtime would refuse the key and not start");
    assert.equal(old.ai, "buttons", "while a setting that version does know is still written");
    assert.equal(loadState(w.root).shops["glow-salon"].applied!.pathway, "bookings@0.0.9");
    // the same client, moved to today's version
    writeFileSync(join(w.paths.shop("glow-salon"), "pathway.lock"), "bookings@0.1.0\n");
    await deploy(w.ctx);
    assert.equal((generatedRuntime(w).report as Record<string, unknown>).innovator, true);
  } finally { w.done(); }
});

test("a pinned version whose runtime-config check cannot be read gets neither optional setting, and the note says why", async () => {
  const w = world();
  try {
    keepOldVersion(w, "0.0.8", () => 'throw new Error("this file does not load");\n');
    putAnswer(w.paths, answer({ ai: "buttons", reason: "overage_unfunded" }));
    w.handIn("glow-salon");
    const checked = await checkShop(w.ctx, "glow-salon");
    assert.deepEqual(checked.problems, []);
    assert.ok(checked.notes.some((n) => /monthly report .* not switched on .*\(I could not read the runtime-config check of the pathway in .*bookings@0\.0\.8 \(this file does not load\)\)/u.test(n)), checked.notes.join("\n"));
    assert.ok(checked.notes.some((n) => /fleet asked for button mode, but this pathway version does not know the ai setting yet/u.test(n)), "button mode is skipped the same way");
    await deploy(w.ctx);
    const generated = generatedRuntime(w);
    assert.equal("report" in generated || "ai" in generated, false);
  } finally { w.done(); }
});

test("withReport adds nothing to nothing, or to a config that was broken before the block was added", () => {
  const facts: ReportFacts = { preparedBy: "Divya, local partner", innovator: false, pageBaseUrl: "https://shops.example.com/r/glow-salon", source: "test-mode" };
  const notes: string[] = [];
  assert.deepEqual(withReport({}, facts, oldPathway, notes), {});
  const broken = { mode: "nonsense" };
  assert.equal(withReport(broken, facts, oldPathway, notes), broken);
  assert.deepEqual(notes, [], "a config that was never valid is somebody else's problem and is not blamed on the pathway");
  const ok = withReport({ mode: "fakes" }, facts, validateRuntimeConfig, notes);
  assert.deepEqual(ok.report, { ...facts, pagesDir: "/home/node/data/reports" });
});

test("the name and the badge are part of what a shop is asked to be: either changing changes the desired hash, and changing back restores it", () => {
  const t = tempServer(); try {
    putOwner(t.paths);
    const plain = desiredHashOf(t.shop("glow-salon"));
    putAnswer(t.paths, answer({ innovator: false }));
    assert.equal(desiredHashOf(t.shop("glow-salon")), plain, "an answer that changes nothing changes nothing");
    putAnswer(t.paths, answer({ innovator: true }));
    const badge = desiredHashOf(t.shop("glow-salon"));
    assert.notEqual(badge, plain);
    putAnswer(t.paths, answer({ innovator: false }));
    assert.equal(desiredHashOf(t.shop("glow-salon")), plain);
    putOwner(t.paths, { accountName: "Meera" });
    assert.notEqual(desiredHashOf(t.shop("glow-salon")), plain, "a different name");
    putOwner(t.paths);
    assert.equal(desiredHashOf(t.shop("glow-salon")), plain);
    putReportFile(t.paths, { schema: 1, preparedBy: "Arjun, builder" });
    assert.notEqual(desiredHashOf(t.shop("glow-salon")), plain, "report.json");
  } finally { t.done(); }
});

test("the deployer writes the block into the generated runtime.json, redeploys the shop when fleet flips the badge, and the panel's runtime.json is never touched", async () => {
  const w = world();
  try {
    putOwner(w.paths);
    const panelFile = join(w.paths.shop("glow-salon"), "runtime.json");
    const panelBefore = readFileSync(panelFile, "utf8");
    w.handIn("glow-salon");
    await deploy(w.ctx);
    const generated = () => JSON.parse(readFileSync(join(w.root, "generated", "shops", "glow-salon", "client", "runtime.json"), "utf8")) as { report: Record<string, unknown> };
    assert.deepEqual(generated().report, { innovator: false, pageBaseUrl: "https://shops.example.com/r/glow-salon", pagesDir: "/home/node/data/reports", preparedBy: "Divya, local partner", source: "test-mode" });
    const first = loadState(w.root).shops["glow-salon"].applied!.desiredHash;
    assert.deepEqual((await applyOnce(w.ctx)).skipped, ["glow-salon"], "nothing changed");
    putAnswer(w.paths, answer({ innovator: true }));
    assert.deepEqual((await applyOnce(w.ctx)).applied, ["glow-salon"], "fleet's flip of the badge is a change");
    assert.equal(generated().report.innovator, true);
    assert.notEqual(loadState(w.root).shops["glow-salon"].applied!.desiredHash, first);
    putOwner(w.paths, { accountName: "Meera" });
    assert.deepEqual((await applyOnce(w.ctx)).applied, ["glow-salon"], "and so is a new name");
    assert.equal(generated().report.preparedBy, "Meera, local partner");
    putAnswer(w.paths, answer({ innovator: false }));
    putOwner(w.paths);
    assert.deepEqual((await applyOnce(w.ctx)).applied, ["glow-salon"], "and flipping both back");
    assert.equal(loadState(w.root).shops["glow-salon"].applied!.desiredHash, first);
    assert.equal(readFileSync(panelFile, "utf8"), panelBefore, "the panel's file is the panel's");
    // the Caddyfile and the compose file that were written serve the same address
    assert.match(readFileSync(join(w.root, "generated", "Caddyfile"), "utf8"), /path_regexp \^\/r\/\(\?:glow-salon\)\//u);
    assert.match(readFileSync(join(w.root, "generated", "compose.yaml"), "utf8"), /\n {2}rd-glow-salon:\n/u);
  } finally { w.done(); }
});

test("a shop deployed before the report existed is redeployed once by the deployer, which is what writes its block", async () => {
  const w = world();
  try {
    putOwner(w.paths);
    w.handIn("glow-salon");
    await deploy(w.ctx);
    // the state a bundle before this one left behind: the hash of a shop asked to be its four files and nothing more
    const state = loadState(w.root);
    state.shops["glow-salon"].applied!.desiredHash = "hash-from-the-bundle-before";
    saveState(w.root, state);
    assert.deepEqual((await applyOnce(w.ctx)).applied, ["glow-salon"]);
    assert.deepEqual((await applyOnce(w.ctx)).skipped, ["glow-salon"], "and then it is up to date");
  } finally { w.done(); }
});

test("when `docker compose up` fails, the message does not list the folder-making one-shots (they exit 0 on purpose) among the services that are not running well", async () => {
  const w = world();
  try {
    w.handIn("glow-salon");
    const inner = w.ctx.runner;
    w.ctx.runner = { run: async (command, args, options) => {
      const line = args.join(" ");
      if (args[0] === "compose" && / up -d/u.test(line) && !line.includes("--force-recreate")) return failed("rd-glow-salon exited\ncaddy could not start");
      if (args[0] === "compose" && / ps -a /u.test(line)) return ok("rd-glow-salon\tExited (0) 3 seconds ago\ncaddy\tExited (1) 2 seconds ago\nrt-glow-salon\tUp 3 seconds (healthy)");
      if (args[0] === "compose" && / logs /u.test(line)) return ok("caddy  | cannot start");
      return inner.run(command, args, options);
    } };
    await assert.rejects(() => deploy(w.ctx), (e: Error) => /Not running well: caddy: Exited \(1\)/u.test(e.message) && !/rd-glow-salon: Exited/u.test(e.message));
  } finally { w.done(); }
});

test("`shop add --prepared-by` writes report.json, which the shop's plan reads; without it the command says who the message will name", async () => {
  const w = world({});
  const quiet = async <T>(work: () => Promise<T>): Promise<{ result: T; out: string; err: string }> => {
    const out: string[] = []; const err: string[] = []; const [log, error] = [console.log, console.error];
    console.log = (...a: unknown[]) => out.push(a.join(" ")); console.error = (...a: unknown[]) => err.push(a.join(" "));
    try { return { result: await work(), out: out.join("\n"), err: err.join("\n") }; } finally { console.log = log; console.error = error; }
  };
  try {
    const plain = await quiet(() => main(["shop", "add", "glow-salon", "--from", EXAMPLE_CLIENT, "--server", w.root]));
    assert.equal(plain.result, 0, plain.err);
    assert.match(plain.out, /monthly report will say "your builder" set it up/u);
    const named = await quiet(() => main(["shop", "add", "chai-point", "--from", EXAMPLE_CLIENT, "--prepared-by", "Divya, local partner", "--server", w.root]));
    assert.equal(named.result, 0, named.err);
    assert.doesNotMatch(named.out, /your builder/u);
    assert.deepEqual(JSON.parse(readFileSync(join(w.paths.shop("chai-point"), "report.json"), "utf8")), { schema: 1, preparedBy: "Divya, local partner" });
    const bad = await quiet(() => main(["shop", "add", "tea-stall", "--from", EXAMPLE_CLIENT, "--prepared-by", "two\nlines", "--server", w.root]));
    assert.equal(bad.result, 1);
    assert.match(bad.err, /--prepared-by must be the name/u);
    assert.deepEqual([readShop(w.root, "chai-point").preparedBy, readShop(w.root, "chai-point").preparedBySource], ["Divya, local partner", "report.json"]);
    assert.deepEqual([readShop(w.root, "glow-salon").preparedBy, readShop(w.root, "glow-salon").preparedBySource], ["your builder", "default"]);
  } finally { w.done(); }
});
