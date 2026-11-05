// The command line: init makes a server folder (and a key pair for snapshots), shop add copies a client folder in and refuses names fleet would refuse,
// stop says who stopped the shop, rollback goes back one lock.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../geometer.ts";
import { loadServer } from "../lib/server.ts";
import { loadState } from "../lib/state.ts";
import { readStatus } from "../lib/status.ts";
import { deploy } from "../deploy.ts";
import { fakeRunner } from "../lib/runner.ts";
import { EXAMPLE_CLIENT, panelRuntime } from "./helpers.ts";
import { world } from "./world.ts";

async function quiet<T>(work: () => Promise<T>): Promise<{ result: T; out: string; err: string }> {
  const out: string[] = []; const err: string[] = [];
  const [log, error] = [console.log, console.error];
  console.log = (...a: unknown[]) => out.push(a.join(" ")); console.error = (...a: unknown[]) => err.push(a.join(" "));
  try { return { result: await work(), out: out.join("\n"), err: err.join("\n") }; } finally { console.log = log; console.error = error; }
}

test("init makes a server folder, a key pair for the snapshots (the secret half in a file with mode 0600), and a geometer.json that loads", async () => {
  const root = mkdtempSync(join(tmpdir(), "geo-init-")); const folder = join(root, "acme-vps-1"); const identity = join(root, "age-identity.txt");
  try {
    const r = await quiet(() => main(["init", folder, "--domain", "shops.example.com", "--reviewed-by", "builder-arjun", "--model-wire", "openai", "--model", "gpt-4o-mini", "--stream-url", "s3://stream/acme", "--snapshots-url", "s3://snaps/acme", "--age-identity-out", identity]));
    assert.equal(r.result, 0, r.err);
    assert.match(r.out, /secret half is in .*age-identity\.txt/);
    assert.match(readFileSync(identity, "utf8"), /^AGE-SECRET-KEY-1/);
    assert.equal(statSync(identity).mode & 0o777, 0o600);
    const server = loadServer(folder);
    assert.deepEqual([server.id, server.domain, server.approvalHours, server.model.model], ["acme-vps-1", "shops.example.com", 24, "gpt-4o-mini"]);
    assert.match(server.backup!.ageRecipient, /^age1/);
    assert.equal(statSync(join(folder, "secrets")).mode & 0o777, 0o700, "secrets/ is private to the user");
    assert.ok(!readFileSync(join(folder, "geometer.json"), "utf8").includes("AGE-SECRET-KEY"), "the secret half is not in the server folder");
    assert.equal((await quiet(() => main(["init", folder, "--domain", "x", "--reviewed-by", "a", "--model", "m"]))).result, 1, "not twice");
    const bad = await quiet(() => main(["init", join(root, "other"), "--domain", "x.example.com", "--model", "m"]));
    assert.equal(bad.result, 1); assert.match(bad.err, /reviewedBy/);
    const noKey = await quiet(() => main(["init", join(root, "third"), "--domain", "x.example.com", "--reviewed-by", "a", "--model", "m", "--stream-url", "s3://a/b", "--snapshots-url", "s3://c/d"]));
    assert.equal(noKey.result, 1); assert.match(noKey.err, /--age-identity-out/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("shop add copies a client folder in, and refuses a name the heartbeat would refuse, a twin, and a folder with no settings", async () => {
  const w = world({}); try {
    const add = (...a: string[]) => quiet(() => main(["shop", "add", ...a, "--server", w.root]));
    assert.equal((await add("glow-salon", "--from", EXAMPLE_CLIENT)).result, 0);
    for (const f of ["settings.json", "runtime.json", "pathway.lock"]) assert.ok(existsSync(join(w.paths.shop("glow-salon"), f)), f);
    assert.match((await add("glow-salon", "--from", EXAMPLE_CLIENT)).err, /already a shop/);
    assert.match((await add("shop-98765-43210", "--from", EXAMPLE_CLIENT)).err, /looks like a phone number/);
    assert.match((await add("Bad Name", "--from", EXAMPLE_CLIENT)).err, /not a usable shop name/);
    const empty = mkdtempSync(join(tmpdir(), "geo-empty-"));
    assert.match((await add("x-shop", "--from", empty)).err, /settings\.json is missing/);
    rmSync(empty, { recursive: true });
  } finally { w.done(); }
});

test("stop engages the kill switch and records who; start releases it; both are in the state and in the panel's status", async () => {
  const w = world(); try {
    w.handIn("glow-salon"); await deploy(w.ctx);
    const stopped = await quiet(() => main(["stop", "glow-salon", "--reason", "owner asked", "--server", w.root], w.ctx));
    assert.equal(stopped.result, 0, stopped.err);
    assert.match(stopped.out, /glow-salon is stopped: nothing new goes out\. stopped by /);
    assert.ok(w.admin.some((a) => /^stop glow-salon on \S+@\S+ owner asked$/.test(a)), w.admin.join(" | "));
    const by = loadState(w.root).shops["glow-salon"].stopped!;
    assert.match(by.by, /@/); assert.equal(readStatus(w.root, "glow-salon")!.stopped?.by, by.by);
    assert.equal((await quiet(() => main(["start", "glow-salon", "--server", w.root], w.ctx))).result, 0);
    assert.equal(loadState(w.root).shops["glow-salon"].stopped, undefined);
    assert.equal(readStatus(w.root, "glow-salon")!.stopped, undefined);
  } finally { w.done(); }
});

test("rollback puts the previous pathway.lock back and deploys; with none to go back to it says so", async () => {
  const w = world(); try {
    w.handIn("glow-salon"); await deploy(w.ctx);
    const none = await quiet(() => main(["rollback", "glow-salon", "--server", w.root], w.ctx));
    assert.equal(none.result, 1); assert.match(none.err, /no earlier pathway\.lock/);
    // a second version of the pathway exists beside the server, and the shop is moved to it
    const { cpSync } = await import("node:fs");
    cpSync(join(w.ctx.appDir, "templates", "commerce", "bookings"), join(w.root, "templates", "commerce", "bookings@0.2.0"), { recursive: true });
    const pkg = join(w.root, "templates", "commerce", "bookings@0.2.0", "package.json");
    writeFileSync(pkg, readFileSync(pkg, "utf8").replaceAll('"version": "0.1.0"', '"version": "0.2.0"'));
    writeFileSync(join(w.paths.shop("glow-salon"), "pathway.lock"), "bookings@0.2.0\n");
    await deploy(w.ctx);
    assert.equal(loadState(w.root).shops["glow-salon"].applied?.pathway, "bookings@0.2.0");
    const back = await quiet(() => main(["rollback", "glow-salon", "--server", w.root], w.ctx));
    assert.equal(back.result, 0, back.err);
    assert.match(back.out, /Back to bookings@0\.1\.0/);
    assert.equal(readFileSync(join(w.paths.shop("glow-salon"), "pathway.lock"), "utf8").trim(), "bookings@0.1.0");
    assert.equal(loadState(w.root).shops["glow-salon"].applied?.pathway, "bookings@0.1.0");
  } finally { w.done(); }
});

test("a refused deploy prints every broken rule by name and exits 1", async () => {
  const w = world(); try {
    const r = await quiet(() => main(["deploy", "--server", w.root], w.ctx));
    assert.equal(r.result, 1);
    assert.match(r.err, /This was refused, and nothing was started or changed:/);
    assert.match(r.err, /\[secret-missing:razorpay_key\]/);
  } finally { w.done(); }
});

test("check runs the generator's checks, then the panel's connection checks inside the panel container once the shop is deployed; it says plainly when they could not run", async () => {
  const w = world({ "glow-salon": panelRuntime() }, { panel: { enabled: true } }); try {
    const check = (ctx = w.ctx) => quiet(() => main(["check", "glow-salon", "--server", w.root], ctx));
    w.handIn("glow-salon");
    const before = await check();
    assert.equal(before.result, 0, before.err); assert.match(before.out, /Connection checks: not run\. glow-salon is not deployed yet/);
    await deploy(w.ctx);
    const answer = (stdout: string, code = 0) => ({ ...w.ctx, runner: fakeRunner((command, args, options) => args.includes("/app/bundle/services/connection-check.ts") ? { code, stdout, stderr: code ? "service \"panel\" is not running" : "" } : w.ctx.runner.run(command, args, options)) });
    const good = answer(`${JSON.stringify({ connections: [{ service: "whatsapp", ok: true, code: "confirmed", notChecked: ["sending"] }, { service: "calendar", ok: true, code: "confirmed", notChecked: [] }] })}\n`);
    const passed = await check(good);
    assert.equal(passed.result, 0, passed.err); assert.match(passed.out, /all passed[\s\S]*whatsapp: confirmed; not checked: sending/);
    const exec = good.runner.calls.find((c) => c.args.includes("/app/bundle/services/connection-check.ts"))!;
    assert.deepEqual(exec.args.slice(exec.args.indexOf("exec")), ["exec", "-T", "panel", "node", "/app/bundle/services/connection-check.ts", "glow-salon"], "it runs in the panel container, the only one on the Guards' network with the token");
    const bad = answer(JSON.stringify({ connections: [{ service: "whatsapp", ok: false, code: "account_mismatch", notChecked: [] }] }));
    const failed = await check(bad);
    assert.equal(failed.result, 1); assert.match(failed.out, /FAILED[\s\S]*whatsapp: NOT confirmed \(account_mismatch\)[\s\S]*connection checks above failed/);
    // a shop made by `shop add` has no business number in the panel yet: WhatsApp cannot be checked, which is "not run", not a failure
    const bare = await check(answer(JSON.stringify({ connections: [{ service: "whatsapp", ok: false, code: "not_configured", notChecked: [] }, { service: "calendar", ok: true, code: "confirmed", notChecked: [] }] })));
    assert.equal(bare.result, 0, bare.out); assert.match(bare.out, /none failed, but some could not run[\s\S]*whatsapp: NOT RUN \(the panel does not have what it needs/); assert.doesNotMatch(bare.out, /recorded the confirmed ids/);
    assert.match(passed.out + passed.err, /recorded the confirmed ids in the shop's pins\.json/, "when everything confirms the panel has written the pins, and the output says so");
    const down = await check(answer("", 1));
    assert.equal(down.result, 0); assert.match(down.out, /not run\. The panel did not answer \(service "panel" is not running\)/);
    const none = world({ "glow-salon": panelRuntime() }); none.handIn("glow-salon");
    try { const r = await quiet(() => main(["check", "glow-salon", "--server", none.root], none.ctx)); assert.match(r.out, /This server has no panel/); } finally { none.done(); }
  } finally { w.done(); }
});

test("panel invite asks the running panel for a one-time link (the first builder's way in) and says what is wrong when it cannot", async () => {
  const w = world({ "glow-salon": panelRuntime() }, { panel: { enabled: true } }); try {
    const calls: string[][] = [];
    const ctx = { ...w.ctx, runner: fakeRunner((_c, args) => { calls.push(args); return args.includes("/app/bundle/panel/main.ts") ? { code: 0, stdout: "https://shops.example.com/join/abc123\n\nThis link works once.\n", stderr: "" } : { code: 0, stdout: "", stderr: "" }; }) };
    const r = await quiet(() => main(["panel", "invite", "--role", "builder", "--note", "Arjun", "--server", w.root], ctx));
    assert.equal(r.result, 0, r.err); assert.match(r.out, /^https:\/\/shops\.example\.com\/join\/abc123/);
    const exec = calls.at(-1)!;
    assert.deepEqual(exec.slice(exec.indexOf("exec")), ["exec", "-T", "panel", "node", "/app/bundle/panel/main.ts", "invite", "--role", "builder", "--note", "Arjun"]);
    assert.match((await quiet(() => main(["panel", "invite", "--server", w.root], ctx))).err, /Say who the invitation is for/);
    const down = { ...w.ctx, runner: fakeRunner(() => ({ code: 1, stdout: "", stderr: 'service "panel" is not running' })) };
    assert.match((await quiet(() => main(["panel", "invite", "--role", "partner", "--server", w.root], down))).err, /did not make a link .*not running/);
    const none = world({ "glow-salon": panelRuntime() });
    try { assert.match((await quiet(() => main(["panel", "invite", "--role", "builder", "--server", none.root], none.ctx))).err, /This server has no panel/); } finally { none.done(); }
  } finally { w.done(); }
});

test("agent add prints the addresses and the one credential, check says what is missing, deploy and show print the addresses again, stop and status know the agent, and a shop's name is refused", async () => {
  const w = world({ "glow-salon": panelRuntime() }); try {
    const cli = (...args: string[]) => quiet(() => main([...args, "--server", w.root], w.ctx));
    const added = await cli("agent", "add", "my-agent", "--deposit", "200", "--refund-limit", "100", "--owner-whatsapp", "+919800000001", "--whatsapp-number-id", "123456789012345", "--calendar-id", "shop@group.calendar.google.com");
    assert.equal(added.result, 0, added.err);
    const credential = /gg_[0-9a-f]{32}/u.exec(added.out)?.[0];
    assert.ok(credential, "the credential is printed");
    for (const kind of ["razorpay", "whatsapp", "calendar"]) assert.ok(added.out.includes(`https://shops.example.com/g/my-agent/${kind}`));
    assert.match(added.out, /send the refund with a "receipt", and send the identical call again after the 202/);
    assert.equal((await cli("agent", "add", "glow-salon", "--deposit", "200", "--refund-limit", "100", "--owner-whatsapp", "+919800000001", "--whatsapp-number-id", "1", "--calendar-id", "x")).result, 1);
    assert.equal((await cli("agent", "add", "x-agent", "--upstreams", "razorpay")).result, 1, "a refund needs WhatsApp");
    const check = await cli("check", "my-agent");
    assert.equal(check.result, 1);
    assert.match(check.out, /\[secret-missing:razorpay_key\]/);
    w.handIn("my-agent", { razorpay_key: "rzp_test_abcdefghij:supersecretvalue123", whatsapp_token: "EAAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", whatsapp_app_secret: "meta-app-secret-0123456789", whatsapp_verify_token: "verify-token-0123456789", "google_service_account.json": JSON.stringify({ client_email: "a@x.iam.gserviceaccount.com", private_key: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n", token_uri: "https://oauth2.googleapis.com/token" }) });
    const ok = await cli("agent", "check", "my-agent");
    assert.equal(ok.result, 0, ok.out + ok.err);
    assert.match(ok.out, /g-my-agent-razorpay: 4 of 4 limits proven to bite/);
    const deployed = await cli("deploy", "my-agent");
    assert.equal(deployed.result, 0, deployed.err);
    assert.match(deployed.out, /my-agent: 12 of 12 limits proven to bite/);
    assert.ok(!deployed.out.includes(credential), "deploy does not print the credential");
    assert.ok((await cli("agent", "show", "my-agent", "--credential")).out.includes(credential));
    assert.ok(!(await cli("agent", "show", "my-agent")).out.includes(credential));
    const stopped = await cli("stop", "my-agent", "--reason", "owner asked");
    assert.equal(stopped.result, 0, stopped.err);
    assert.match(stopped.out, /my-agent is stopped/);
    assert.ok(w.admin.some((a) => /^stop my-agent on \S+@\S+ owner asked$/.test(a)));
    assert.match(loadState(w.root).agents!["my-agent"].stopped!.by, /@/);
    assert.equal((await cli("start", "my-agent")).result, 0);
    assert.equal(loadState(w.root).agents!["my-agent"].stopped, undefined);
    assert.equal((await cli("agent", "show", "nobody")).result, 1);
    assert.equal((await cli("agent", "frobnicate", "my-agent")).result, 1);
  } finally { w.done(); }
});
