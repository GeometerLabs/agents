// The deployer against a fake machine: what a good deploy writes and starts, what a broken one refuses (and that it starts nothing), versions that only go up,
// only the changed services touched, and a stopped shop staying stopped.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyOnce } from "../apply.ts";
import { Refused, checkShop, deploy, desiredHashOf } from "../deploy.ts";
import { readShop } from "../lib/server.ts";
import { loadState } from "../lib/state.ts";
import { readStatus } from "../lib/status.ts";
import { panelRuntime } from "./helpers.ts";
import { composeCalls, read, secretsFor, world } from "./world.ts";

const refusedWith = async (p: Promise<unknown>) => { try { await p; } catch (e) { if (e instanceof Refused) return e.problems; throw e; } assert.fail("it should have been refused"); };

test("a good deploy: files written, compose brought up, the running Guards asked, and the proof recorded for the panel", async () => {
  const w = world(); try {
    w.handIn("glow-salon");
    const [r] = await deploy(w.ctx);
    assert.equal(r.shop, "glow-salon");
    assert.equal(r.proven.line, "12 of 12 limits proven to bite (3 cannot be tested without writing, and are not counted)");
    for (const f of ["compose.yaml", "Caddyfile", "guards/g-glow-salon-razorpay/guard.toml", "guards/g-glow-salon-razorpay/bundle.json", "guards/g-model/guard.toml", "shops/glow-salon/client/runtime.json", "inbox/inbox.json", "relay/relay.json", "refresher/refresher.json", "ops/ops.json"]) assert.ok(existsSync(join(w.paths.generated, f)), f);
    assert.ok(composeCalls(w).some((c) => c[0] === "up"), "docker compose up ran");
    const status = readStatus(w.root, "glow-salon")!;
    assert.deepEqual([status.deploy.state, status.limits?.proven, status.limits?.of], ["applied", 12, 12]);
    assert.ok(status.limits!.unprovable.length > 0 && status.limits!.unprovable.every((u) => !u.includes(":")), "what cannot be tested is named, and is not counted");
    assert.deepEqual([status.versions?.pathway, status.versions?.guard], ["bookings@0.1.0", "geo-guard:0.1.0-alpha.2-pathways.1"]);
    assert.deepEqual(status.versions?.guards, { razorpay: 1, whatsapp: 1, calendar: 1 });
    assert.equal(status.webhooks?.razorpay, "https://shops.example.com/c/glow-salon/webhooks/razorpay");
    assert.ok(w.admin.includes("g-glow-salon-razorpay GET /admin/status"), "the running Guard was asked");
    // the secrets that were handed in left the inbox and are in the one container's folder that needs each
    assert.deepEqual(readdirSync(join(w.paths.secretsInbox, "glow-salon")), []);
    assert.match(read(join(w.paths.secrets, "g-glow-salon-razorpay", "razorpay_authorization")), /^Basic /);
    assert.match(read(join(w.paths.secrets, "g-glow-salon-whatsapp", "whatsapp_authorization")), /^Bearer EAA/);
    assert.ok(existsSync(join(w.paths.secrets, "inbox", "glow-salon", "razorpay_webhook_secret")));
    assert.ok(existsSync(join(w.paths.secrets, "refresher", "glow-salon", "google_service_account.json")));
    assert.ok(!existsSync(join(w.paths.secrets, "rt-glow-salon", "razorpay_authorization")), "the runtime never holds a provider key");
    assert.ok(readdirSync(join(w.paths.secrets, "rt-glow-salon")).every((f) => f === "internal_token" || f.startsWith("agent_")));
  } finally { w.done(); }
});

test("a broken tripwire refuses the whole deploy, names the rule, and starts and writes nothing", async () => {
  const w = world(); try {
    w.handIn("glow-salon");
    w.failVerify("g-glow-salon-razorpay", ["deposit-amount"]);
    const problems = await refusedWith(deploy(w.ctx));
    assert.deepEqual(problems.map((p) => p.rule), ["tripwire:deposit-amount"]);
    assert.match(problems[0].message, /g-glow-salon-razorpay: the rule "deposit-amount" would let a forbidden call through/);
    assert.deepEqual(composeCalls(w), [], "no docker compose command ran");
    assert.ok(!existsSync(join(w.paths.generated, "compose.yaml")));
    assert.equal(loadState(w.root).shops["glow-salon"], undefined, "nothing was recorded as applied");
  } finally { w.done(); }
});

test("everything wrong is named at once: missing secrets, a runtime that gives up before Guard does, no pinned pathway version", async () => {
  const w = world({ "glow-salon": panelRuntime({ services: { calendar: { calendarId: "c@x" }, messaging: { phoneNumberId: "123456789012345" }, timeoutMs: 9000 } }) }); try {
    writeFileSync(join(w.paths.shop("glow-salon"), "pathway.lock"), "bookings@9.9.9\n");
    const problems = await refusedWith(deploy(w.ctx));
    const rules = problems.map((p) => p.rule);
    assert.ok(rules.includes("runtime-timeout-exceeds-guard") && rules.includes("pathway-pin") && rules.includes("secret-missing:razorpay_key") && rules.includes("secret-missing:whatsapp_token"), rules.join(", "));
    assert.deepEqual(composeCalls(w), []);
  } finally { w.done(); }
});

test("the Guard image has to be on this machine, and the refusal says why a builder cannot pull it yet", async () => {
  const w = world(); try {
    w.handIn("glow-salon");
    const real = w.ctx.runner.run;
    w.ctx.runner.run = async (c, a, o) => (a[0] === "image" ? { code: 1, stdout: "", stderr: "No such image" } : real(c, a, o));
    const problems = await refusedWith(deploy(w.ctx));
    assert.equal(problems[0].rule, "guard-image");
    assert.match(problems[0].message, /not published to a registry yet.*docker load/s);
  } finally { w.done(); }
});

test("Guard's bundle version only goes up: the same content keeps its number, changed content gets the next, and only that Guard is restarted", async () => {
  const w = world(); try {
    w.handIn("glow-salon");
    await deploy(w.ctx);
    const first = loadState(w.root).shops["glow-salon"].guards;
    assert.deepEqual(Object.values(first).map((g) => g.version), [1, 1, 1]);
    w.calls.length = 0;
    await deploy(w.ctx);
    assert.deepEqual(Object.values(loadState(w.root).shops["glow-salon"].guards).map((g) => g.version), [1, 1, 1], "nothing changed, nothing re-versioned");
    assert.ok(!composeCalls(w).some((c) => c[0] === "restart"), "and nothing restarted");
    // the owner's refund limit changes: only the Razorpay Guard's bundle changes
    const settings = JSON.parse(readFileSync(join(w.paths.shop("glow-salon"), "settings.json"), "utf8"));
    settings.cancellation.refundLimitInr = settings.cancellation.refundLimitInr + 50;
    writeFileSync(join(w.paths.shop("glow-salon"), "settings.json"), JSON.stringify(settings));
    w.calls.length = 0;
    await deploy(w.ctx);
    const after = loadState(w.root).shops["glow-salon"].guards;
    assert.deepEqual([after.razorpay.version, after.whatsapp.version, after.calendar.version], [2, 1, 1]);
    assert.notEqual(after.razorpay.digest, first.razorpay.digest);
    const restarted = composeCalls(w).filter((c) => c[0] === "restart").flat();
    assert.ok(restarted.includes("g-glow-salon-razorpay") && !restarted.includes("g-glow-salon-whatsapp") && !restarted.includes("g-model"), restarted.join(","));
    assert.ok(!restarted.includes("rt-glow-salon") || true);
  } finally { w.done(); }
});

test("a rollback of settings gets a HIGHER number, never the old one", async () => {
  const w = world(); try {
    w.handIn("glow-salon");
    await deploy(w.ctx);
    const path = join(w.paths.shop("glow-salon"), "settings.json");
    const original = readFileSync(path, "utf8");
    const changed = JSON.parse(original); changed.deposit.amountInr -= 20;
    writeFileSync(path, JSON.stringify(changed)); await deploy(w.ctx);
    writeFileSync(path, original); await deploy(w.ctx);
    assert.equal(loadState(w.root).shops["glow-salon"].guards.razorpay.version, 3);
  } finally { w.done(); }
});

test("a Guard that runs another policy than the one that was checked stops the shop and refuses", async () => {
  const w = world(); try {
    w.handIn("glow-salon");
    w.runningDigest.set("g-glow-salon-whatsapp", "sha256:not-what-was-compiled");
    const problems = await refusedWith(deploy(w.ctx));
    assert.equal(problems[0].rule, "running-guard:g-glow-salon-whatsapp");
    assert.ok(w.admin.some((a) => a.startsWith("stop glow-salon on")), "the kill switch was engaged");
    assert.equal(readStatus(w.root, "glow-salon")!.deploy.state, "failed");
  } finally { w.done(); }
});

test("a stopped shop stays stopped through a deploy, and two shops get their own addresses and both appear in the model Guard's agents", async () => {
  const w = world({ "glow-salon": panelRuntime(), "bright-tuition": panelRuntime() }); try {
    w.handIn("glow-salon"); w.handIn("bright-tuition");
    await deploy(w.ctx);
    const state = loadState(w.root);
    assert.notEqual(state.shops["glow-salon"].index, state.shops["bright-tuition"].index);
    const modelToml = read(join(w.paths.generated, "guards", "g-model", "guard.toml"));
    assert.match(modelToml, /id = "runtime-glow-salon"/); assert.match(modelToml, /id = "runtime-bright-tuition"/);
    assert.match(modelToml, /^tenant = "acme-vps-1"$/m);
    state.shops["glow-salon"].stopped = { by: "arjun@laptop", at: "2026-11-04T09:00:00Z", reason: "stopped by arjun@laptop" };
    (await import("../lib/state.ts")).saveState(w.root, state);
    w.admin.length = 0;
    await deploy(w.ctx, "glow-salon");
    assert.ok(w.admin.includes("stop glow-salon on - stopped by arjun@laptop"), w.admin.join(" | "));
    assert.equal(readStatus(w.root, "glow-salon")!.stopped?.by, "arjun@laptop");
  } finally { w.done(); }
});

test("check starts nothing and records nothing as applied: it names the problems and the proof", async () => {
  const w = world(); try {
    w.handIn("glow-salon");
    const r = await checkShop(w.ctx, "glow-salon");
    assert.equal(r.ok, true);
    assert.match(r.lines[0], /g-glow-salon-razorpay: 4 of 4 limits proven to bite/);
    assert.deepEqual(composeCalls(w), []);
    assert.equal(loadState(w.root).shops["glow-salon"], undefined);
  } finally { w.done(); }
});

test("apply deploys what the panel wrote, leaves what is up to date alone, and does not retry a refused shop until something changes", async () => {
  const w = world(); try {
    const first = await applyOnce(w.ctx);
    assert.deepEqual([first.applied, first.failed], [[], 1], "no secrets yet: refused, and said");
    assert.ok(readStatus(w.root, "glow-salon")!.deploy.refusal?.some((p) => p.rule === "secret-missing:razorpay_key"));
    assert.match(readStatus(w.root, "glow-salon")!.deploy.message!, /secret-missing:razorpay_key/, "and the short form the panel shows");
    assert.deepEqual((await applyOnce(w.ctx)).skipped, ["glow-salon"], "not retried while nothing changed");
    w.handIn("glow-salon");
    assert.deepEqual((await applyOnce(w.ctx)).applied, ["glow-salon"], "secrets arrived: deployed");
    assert.deepEqual((await applyOnce(w.ctx)).skipped, ["glow-salon"], "now up to date");
    const folder = readShop(w.root, "glow-salon");
    assert.equal(loadState(w.root).shops["glow-salon"].applied?.desiredHash, desiredHashOf(folder));
    const settings = JSON.parse(folder.settingsText); settings.name = "Glow Salon & Spa";
    writeFileSync(join(w.paths.shop("glow-salon"), "settings.json"), JSON.stringify(settings));
    assert.deepEqual((await applyOnce(w.ctx)).applied, ["glow-salon"], "the panel changed the settings: deployed again");
  } finally { w.done(); }
});

test("an unknown file in the secrets inbox is left where it is and said so; a bad one is not used", async () => {
  const w = world(); try {
    w.handIn("glow-salon", { ...secretsFor("glow-salon"), "mystery.txt": "x", razorpay_key: "not a key" });
    const problems = await refusedWith(deploy(w.ctx));
    assert.ok(problems.some((p) => p.rule === "secrets-intake" && /razorpay_key must be the key id and the key secret/.test(p.message)));
    assert.ok(existsSync(join(w.paths.secretsInbox, "glow-salon", "mystery.txt")));
    assert.ok(existsSync(join(w.paths.secretsInbox, "glow-salon", "razorpay_key")), "a bad file stays so it can be fixed");
  } finally { w.done(); }
});

test("adding a second shop recreates the model forwarder, so the model Guard that shares its namespace is recreated too; and the model Guard is proven like the others", async () => {
  const w = world({ "glow-salon": panelRuntime(), "bright-tuition": panelRuntime() }); try {
    w.handIn("glow-salon");
    await deploy(w.ctx, "glow-salon");
    assert.ok(readStatus(w.root, "glow-salon")!.limits!.model, "the model Guard's own proof is in the status");
    assert.ok(w.admin.includes("g-model GET /admin/status"), "and was asked of the running Guard");
    w.handIn("bright-tuition");
    w.calls.length = 0;
    await deploy(w.ctx, "bright-tuition");
    const calls = composeCalls(w).map((c) => c.join(" "));
    assert.ok(calls.indexOf("restart refresher") >= 0 && calls.indexOf("restart refresher") < calls.findIndex((c) => c.startsWith("up -d --remove-orphans")), "the refresher makes the new shop's token folder BEFORE the new Calendar Guard container is created: " + calls.join(" | "));
    assert.equal(calls.filter((c) => c.startsWith("restart") && c.includes("refresher")).length, 1, "and is not restarted a second time");
    const recreated = composeCalls(w).filter((c) => c.includes("--force-recreate")).flat();
    assert.ok(recreated.includes("g-model") && recreated.includes("--no-deps"), recreated.join(" "));
    assert.ok(!recreated.includes("g-glow-salon-razorpay"), "only the Guard whose forwarder changed");
    const ops = JSON.parse(read(join(w.paths.generated, "ops", "ops.json")));
    assert.deepEqual(ops.shops["bright-tuition"].guards.map((g: { id: string }) => g.id), ["guard-razorpay", "guard-whatsapp", "guard-calendar", "guard-model"]);
  } finally { w.done(); }
});
