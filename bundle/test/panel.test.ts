// What the panel needs from the bundle: its own read-only agent at each Guard, the ids it confirmed (pins.json) as the allowlists, a server-wide Google key, its stop
// requests, a status file it can read and trust, and the record exported for the monthly report. The shapes are the panel's (bundle/panel/contract.ts), checked with
// ITS checker when that file is here (after the panel is merged) or at GEOMETER_PANEL_CONTRACT.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { processStopRequests, refreshStatuses } from "../apply.ts";
import { exportShop } from "../backup/export.ts";
import { Refused, deploy } from "../deploy.ts";
import { main } from "../geometer.ts";
import { sha256Hex } from "../lib/util.ts";
import { loadState } from "../lib/state.ts";
import { readStatus } from "../lib/status.ts";
import { openStore } from "../../templates/commerce/bookings/server/store.ts";
import { CALENDAR_ID, EXAMPLE_CLIENT, PHONE_NUMBER_ID, panelRuntime, writePersonKey } from "./helpers.ts";
import { read, secretsFor, world } from "./world.ts";

const CONTRACT = [process.env.GEOMETER_PANEL_CONTRACT, new URL("../panel/contract.ts", import.meta.url).pathname].find((p) => p && existsSync(p));
const contract = CONTRACT ? await import(CONTRACT) as { parseStatus(text: string | undefined): { ok: boolean; status?: any; reason?: string }; parseStopRequest(text: string | undefined): unknown } : undefined;
const withPanel = { panel: { enabled: true } };
/** A stand-in app folder: the real templates, and a panel program only when asked (so a test does not depend on whether THIS checkout has bundle/panel/main.ts). */
function standInApp(w: ReturnType<typeof world>, panelProgram: boolean): string {
  const app = mkdtempSync(join(tmpdir(), "geo-app-"));
  symlinkSync(join(w.ctx.appDir, "templates"), join(app, "templates"));
  if (panelProgram) { mkdirSync(join(app, "bundle", "panel"), { recursive: true }); writeFileSync(join(app, "bundle", "panel", "main.ts"), "// the panel\n"); }
  return app;
}
const tomlOf = (w: ReturnType<typeof world>, svc: string) => read(join(w.paths.generated, "guards", svc, "guard.toml"));
const agentBlock = (toml: string, id: string) => toml.split("[[agents]]").find((b) => b.includes(`id = "${id}"`));

test("each Guard has the panel's own agent, allowed its connection-check reads and nothing else; its one token is in the panel's folder only (0600), with only a hash in the Guards'", async () => {
  const w = world({ "glow-salon": panelRuntime(), "bright-tuition": panelRuntime() }, withPanel); try {
    w.handIn("glow-salon"); w.handIn("bright-tuition");
    const realApp = w.ctx.appDir; const noPanelApp = standInApp(w, false); w.ctx.appDir = noPanelApp; // the Guards and keys are made whether or not this checkout has a panel program
    await deploy(w.ctx);
    const tokenFile = join(w.paths.secrets, "panel", "guard_agent_token");
    const token = read(tokenFile).trim();
    assert.match(token, /^gg_[0-9a-f]{32}$/);
    assert.equal(statSync(tokenFile).mode & 0o777, 0o600);
    assert.equal(readdirSync(join(w.paths.secrets, "panel")).sort().join(), "data_key,guard_agent_token,person-keys,signing_key", "one folder, three files and the fingerprint keys: no per-shop token folders");
    assert.equal(readdirSync(join(w.paths.secrets, "panel", "person-keys")).sort().join(), "bright-tuition,glow-salon", "B69: one fingerprint key per shop, and nothing else in that folder");
    for (const shop of ["glow-salon", "bright-tuition"]) for (const [kind, ops] of [["razorpay", '["list_links"]'], ["whatsapp", '["read_number"]'], ["calendar", '["get_calendar", "list"]']] as const) {
      const toml = tomlOf(w, `g-${shop}-${kind}`);
      const block = agentBlock(toml, `panel-${shop}`)!;
      assert.ok(block.includes(`operations = ${ops}`), `${shop} ${kind}: ${block}`);
      assert.ok(block.includes(sha256Hex(token)) && !toml.includes(token), "the Guard has the hash, never the token");
      assert.ok(!toml.split("[[agents]]").some((b) => b.includes(`id = "runtime-${shop}"`) && b.includes(sha256Hex(token))), "and the runtime's agent is another credential");
    }
    for (const other of readdirSync(w.paths.secrets).filter((d) => d !== "panel")) {
      const hit = readdirSync(join(w.paths.secrets, other), { recursive: true, encoding: "utf8" }).filter((f) => statSync(join(w.paths.secrets, other, f)).isFile()).some((f) => read(join(w.paths.secrets, other, f)).includes(token));
      assert.ok(!hit, `the panel's token is also in secrets/${other}`);
    }
    // the keys, in the formats the panel reads (vault.ts: 32 bytes as hex; modules/report/sign.ts loadPrivateKey: an Ed25519 key it can open, mode 0600)
    assert.match(read(join(w.paths.secrets, "panel", "data_key")).trim(), /^[0-9a-f]{64}$/);
    const { createPrivateKey } = await import("node:crypto");
    assert.equal(createPrivateKey(readFileSync(join(w.paths.secrets, "panel", "signing_key"))).asymmetricKeyType, "ed25519");
    for (const key of ["data_key", "signing_key"]) assert.equal(statSync(join(w.paths.secrets, "panel", key)).mode & 0o777, 0o600, `${key}: the panel refuses a key anyone else could read`);
    const again = read(tokenFile); await deploy(w.ctx, "glow-salon");
    assert.equal(read(tokenFile), again, "kept across deploys: a token is made once");
    for (const d of ["requests", "exports", "panel"]) assert.ok(existsSync(join(w.root, d)), d);
    assert.match(read(join(w.paths.generated, "compose.yaml")), /\n  panel:\n    internal: true/, "the panel's network exists");
    assert.doesNotMatch(read(join(w.paths.generated, "compose.yaml")), /bundle\/panel\/main\.ts/, "but with no panel program in this checkout no panel container is generated");
    rmSync(noPanelApp, { recursive: true, force: true }); w.ctx.appDir = realApp;
  } finally { w.done(); }
});

test("the read routes are in the specs with the same exact-id rules as their siblings, and the specs still prove every limit", async () => {
  const w = world({ "glow-salon": panelRuntime() }, withPanel); try {
    w.handIn("glow-salon"); await deploy(w.ctx);
    const wa = JSON.parse(read(join(w.paths.generated, "guards", "g-glow-salon-whatsapp", "spec.json")));
    const cal = JSON.parse(read(join(w.paths.generated, "guards", "g-glow-salon-calendar", "spec.json")));
    assert.deepEqual(wa.rules.find((r: any) => r.operation === "read_number"), { id: "own-number-read", kind: "argument_allowlist", operation: "read_number", field: "phone_number_id", match: "exact", allowed_values: [PHONE_NUMBER_ID] });
    assert.deepEqual(cal.rules.find((r: any) => r.operation === "get_calendar"), { id: "own-calendar-get-calendar", kind: "argument_allowlist", operation: "get_calendar", field: "calendarId", match: "exact", allowed_values: [CALENDAR_ID] });
    assert.ok(cal.routes.some((r: any) => r.operation === "get_calendar") && wa.routes.some((r: any) => r.operation === "read_number"));
  } finally { w.done(); }
});

test("pins.json wins: the Guards AND the runtime are pinned to the ids the checks confirmed, and a runtime.json that says otherwise is told so; a changed pin is a new deploy", async () => {
  const w = world(); try {
    w.handIn("glow-salon");
    writeFileSync(join(w.paths.shop("glow-salon"), "pins.json"), JSON.stringify({ schema: 1, checkedAt: "2026-11-04T09:00:00Z", whatsapp: { phoneNumberId: "999888777666555", displayNumber: "+91 98000 00000" }, calendar: { calendarId: "confirmed@group.calendar.google.com" } }));
    const notes: string[] = []; w.ctx.log = (l) => notes.push(l);
    await deploy(w.ctx);
    const wa = JSON.parse(read(join(w.paths.generated, "guards", "g-glow-salon-whatsapp", "spec.json")));
    assert.deepEqual(wa.rules.map((r: any) => r.allowed_values), [["999888777666555"], ["999888777666555"]]);
    const cal = JSON.parse(read(join(w.paths.generated, "guards", "g-glow-salon-calendar", "spec.json")));
    assert.ok(cal.rules.every((r: any) => r.allowed_values[0] === "confirmed@group.calendar.google.com"));
    const runtime = JSON.parse(read(join(w.paths.generated, "shops", "glow-salon", "client", "runtime.json")));
    assert.deepEqual([runtime.services.messaging.phoneNumberId, runtime.services.calendar.calendarId], ["999888777666555", "confirmed@group.calendar.google.com"], "the runtime calls what the Guard allows");
    assert.ok(notes.some((n) => /another WhatsApp number id than the one the connection check confirmed/.test(n)));
    const before = loadState(w.root).shops["glow-salon"].guards.whatsapp.version;
    writeFileSync(join(w.paths.shop("glow-salon"), "pins.json"), JSON.stringify({ schema: 1, checkedAt: "2026-11-05T09:00:00Z", whatsapp: { phoneNumberId: "111222333444555", displayNumber: "x" } }));
    await deploy(w.ctx);
    assert.equal(loadState(w.root).shops["glow-salon"].guards.whatsapp.version, before + 1);
  } finally { w.done(); }
});

test("a Razorpay key that is not the account the check confirmed is refused by name; so is a key of the other mode", async () => {
  const w = world(); try {
    w.handIn("glow-salon");
    writeFileSync(join(w.paths.shop("glow-salon"), "pins.json"), JSON.stringify({ schema: 1, checkedAt: "2026-11-04T09:00:00Z", razorpay: { keyId: "rzp_test_someoneelse", mode: "test" } }));
    try { await deploy(w.ctx); assert.fail("it should be refused"); } catch (e) { assert.ok(e instanceof Refused); assert.equal(e.problems[0].rule, "razorpay-key-matches-pin"); assert.match(e.problems[0].message, /not the account the connection check confirmed/); }
    writeFileSync(join(w.paths.shop("glow-salon"), "pins.json"), JSON.stringify({ schema: 1, checkedAt: "2026-11-04T09:00:00Z", razorpay: { keyId: "rzp_test_abcdefghij", mode: "live" } }));
    try { await deploy(w.ctx); assert.fail("it should be refused"); } catch (e) { assert.ok(e instanceof Refused); assert.match(e.problems[0].message, /not a live-mode key/); }
    writeFileSync(join(w.paths.shop("glow-salon"), "pins.json"), JSON.stringify({ schema: 1, checkedAt: "2026-11-04T09:00:00Z", razorpay: { keyId: "rzp_test_abcdefghij", mode: "test" } }));
    await deploy(w.ctx);
  } finally { w.done(); }
});

test("with no Google key in a shop's inbox the server-wide key is used (hosted mode); with neither the deploy is refused by name", async () => {
  const w = world({ "glow-salon": panelRuntime() }, withPanel); try {
    const { "google_service_account.json": _google, ...withoutGoogle } = secretsFor("glow-salon");
    w.handIn("glow-salon", withoutGoogle);
    try { await deploy(w.ctx); assert.fail("it should be refused"); } catch (e) { assert.ok(e instanceof Refused); assert.ok(e.problems.some((p) => p.rule === "secret-missing:google_service_account.json")); }
    const key = join(tmpdir(), `geo-sa-${Math.random()}.json`);
    writeFileSync(key, JSON.stringify({ client_email: "hosted@project.iam.gserviceaccount.com", private_key: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n", token_uri: "https://oauth2.googleapis.com/token" }));
    assert.equal(await main(["google-key", key, "--server", w.root], w.ctx), 0); rmSync(key);
    // a checkout that has the panel program: a stand-in app folder with the real templates and a bundle/panel/main.ts
    const app = standInApp(w, true);
    w.ctx.appDir = app;
    await deploy(w.ctx);
    rmSync(app, { recursive: true, force: true });
    const refresher = JSON.parse(read(join(w.paths.generated, "refresher", "refresher.json")));
    assert.equal(refresher.shops["glow-salon"].serviceAccountFile, "/run/secrets/_server/google_service_account.json");
    assert.match(read(join(w.paths.generated, "compose.yaml")), /PANEL_CALENDAR_SHARE_ADDRESS: "hosted@project\.iam\.gserviceaccount\.com"/);
  } finally { w.done(); }
});

test("shop add refuses a name whose secrets inbox already holds files (a setup someone else started)", async () => {
  const w = world({}); try {
    mkdirSync(join(w.paths.secretsInbox, "glow-salon"), { recursive: true }); writeFileSync(join(w.paths.secretsInbox, "glow-salon", "razorpay_key"), "rzp_test_a:b");
    const out: string[] = []; const err = console.error; console.error = (...a: unknown[]) => out.push(a.join(" "));
    try { assert.equal(await main(["shop", "add", "glow-salon", "--from", EXAMPLE_CLIENT, "--server", w.root], w.ctx), 1); } finally { console.error = err; }
    assert.match(out.join(), /secrets inbox for glow-salon already holds files/);
    assert.ok(!existsSync(w.paths.shop("glow-salon")));
  } finally { w.done(); }
});

const stopRequest = (shop: string, extra: object = {}) => JSON.stringify({ schema: 1, requestId: "req-7f3a", shop, requestedAt: "2026-11-04T09:59:00Z", requestedBy: { id: "acct-1", name: "Divya", role: "partner" }, ...extra });

test("a stop request is carried out on every Guard, shown as stopped in status with its request id, and only then removed; a request that fails stays", async () => {
  const w = world({ "glow-salon": panelRuntime() }, withPanel); try {
    w.handIn("glow-salon"); await deploy(w.ctx);
    mkdirSync(join(w.root, "requests"), { recursive: true });
    const file = join(w.root, "requests", "glow-salon.stop.json");
    writeFileSync(file, stopRequest("glow-salon"));
    w.stopStatuses.splice(0, 4, 200, 200, 503, 200); // one Guard could not be reached
    assert.deepEqual(await processStopRequests(w.ctx), []);
    assert.ok(existsSync(file), "a request that was not carried out on every Guard is kept");
    assert.equal(readStatus(w.root, "glow-salon")!.stopped, undefined, "and the status does not say stopped");
    w.stopStatuses.splice(0, 4, 200, 200, 200, 200);
    assert.deepEqual(await processStopRequests(w.ctx), ["glow-salon"]);
    assert.ok(!existsSync(file));
    const s = readStatus(w.root, "glow-salon")!;
    assert.deepEqual([s.stopped?.requestId, s.stopped?.by], ["req-7f3a", "Divya (partner, from the panel)"]);
    assert.match(s.stopped!.reason!, /request req-7f3a/);
    assert.equal(loadState(w.root).shops["glow-salon"].stopped?.requestId, "req-7f3a");
    assert.ok(w.admin.includes("stop glow-salon on Divya (partner, from the panel) request req-7f3a"));
    // a request that is not one is left alone, and a deploy keeps the shop stopped
    writeFileSync(join(w.root, "requests", "glow-salon.stop.json"), "{not json");
    assert.deepEqual(await processStopRequests(w.ctx), []);
    assert.ok(existsSync(join(w.root, "requests", "glow-salon.stop.json")));
    writeFileSync(join(w.root, "requests", "other-shop.stop.json"), stopRequest("glow-salon"));
    assert.deepEqual(await processStopRequests(w.ctx), [], "a request filed under another shop's name is not obeyed");
    w.admin.length = 0; await deploy(w.ctx, "glow-salon");
    assert.ok(w.admin.some((a) => a.startsWith("stop glow-salon on - ")), "a deploy puts the stop back");
    assert.equal(readStatus(w.root, "glow-salon")!.stopped?.requestId, "req-7f3a");
  } finally { w.done(); }
});

test("a stop request for a shop that has no Guards yet is carried out as a mark, applied when it is first deployed", async () => {
  const w = world({ "glow-salon": panelRuntime() }, withPanel); try {
    mkdirSync(join(w.root, "requests"), { recursive: true });
    writeFileSync(join(w.root, "requests", "glow-salon.stop.json"), stopRequest("glow-salon"));
    assert.deepEqual(await processStopRequests(w.ctx), ["glow-salon"]);
    assert.deepEqual(w.admin, [], "no Guard to ask");
    w.handIn("glow-salon"); await deploy(w.ctx);
    assert.ok(w.admin.some((a) => a.startsWith("stop glow-salon on - ")));
  } finally { w.done(); }
});

const obs = (id: string, over: Record<string, unknown> = {}) => ({ id, up: true, ready: true, guards: ["guard-razorpay", "guard-whatsapp", "guard-calendar", "guard-model"].map((g) => ({ id: g, healthReady: true, admin: { tripwires: { ran: true, ok: true, passed: 4, of: 4, not_self_testable_items: [{ item: "rule refund-once" }] } } })), ...over });

test("the deployer's refresh moves updatedAt only when the runtime and all three Guards answer; a failed tripwire is shown at once; silence is never refreshed", async () => {
  let t = Date.parse("2026-11-04T10:00:00Z");
  const w = world(); try {
    w.ctx.now = () => new Date(t);
    w.handIn("glow-salon"); await deploy(w.ctx);
    const at = () => readStatus(w.root, "glow-salon")!.updatedAt;
    const first = at();
    t += 60_000; w.observe.shops = [obs("glow-salon")];
    assert.deepEqual(await refreshStatuses(w.ctx), ["glow-salon"]);
    assert.notEqual(at(), first);
    const s = readStatus(w.root, "glow-salon")!;
    assert.deepEqual([s.limits!.proven, s.limits!.of, s.limits!.unprovable], [12, 12, ["rule refund-once"]]);
    const confirmed = at();
    t += 60_000; w.observe.shops = [obs("glow-salon", { up: false, ready: false })];
    assert.deepEqual(await refreshStatuses(w.ctx), []); assert.equal(at(), confirmed, "a runtime that does not answer: the file goes quiet");
    t += 60_000; w.observe.shops = [obs("glow-salon", { guards: obs("x").guards.map((g, i) => (i === 1 ? { ...g, healthReady: false, admin: null } : g)) })];
    assert.deepEqual(await refreshStatuses(w.ctx), []); assert.equal(at(), confirmed, "a Guard that does not answer: quiet too");
    t += 60_000; w.observe.shops = [obs("glow-salon", { ready: false, guards: obs("x").guards.map((g, i) => (i === 0 ? { ...g, healthReady: false, admin: { tripwires: { ran: true, ok: false, passed: 2, of: 4, not_self_testable_items: [] } } } : g)) })];
    assert.deepEqual(await refreshStatuses(w.ctx), ["glow-salon"], "a failed tripwire is news");
    assert.deepEqual([readStatus(w.root, "glow-salon")!.limits!.proven, readStatus(w.root, "glow-salon")!.limits!.of], [10, 12]);
  } finally { w.done(); }
});

test("status/<shop>.json and the stop request are in the panel's own shape (its checker, when it is here)", { skip: contract ? false : "bundle/panel/contract.ts is not in this branch yet (set GEOMETER_PANEL_CONTRACT to a copy)" }, async () => {
  const w = world({ "glow-salon": panelRuntime() }, withPanel); try {
    w.handIn("glow-salon"); await deploy(w.ctx);
    const read1 = contract!.parseStatus(readFileSync(w.paths.statusFile("glow-salon"), "utf8"));
    assert.equal(read1.ok, true);
    const s = read1.status;
    assert.deepEqual([s.deploy.state, s.limits.proven, s.limits.of, s.versions.pathway, typeof s.versions.guard, typeof s.versions.bundle], ["applied", 12, 12, "bookings@0.1.0", "string", "string"]);
    assert.ok(s.limits.unprovable.length > 0 && s.updatedAt);
    assert.deepEqual(Object.keys(s.backups ?? {}).sort(), ["drillOk", "lastCopyAt", "lastDrillAt"]);
    mkdirSync(join(w.root, "requests"), { recursive: true });
    writeFileSync(join(w.root, "requests", "glow-salon.stop.json"), stopRequest("glow-salon"));
    assert.ok(contract!.parseStopRequest(readFileSync(join(w.root, "requests", "glow-salon.stop.json"), "utf8")), "the request the panel's checker accepts is one the deployer obeys");
    await processStopRequests(w.ctx);
    const stopped = contract!.parseStatus(readFileSync(w.paths.statusFile("glow-salon"), "utf8")).status;
    assert.equal(stopped.stopped.requestId, "req-7f3a");
    // a failed deploy is `failed` with a message the panel keeps (500 characters at most)
    const folder = join(w.paths.shop("glow-salon"), "pathway.lock"); writeFileSync(folder, "bookings@9.9.9\n");
    await assert.rejects(deploy(w.ctx, "glow-salon"));
    const failed = contract!.parseStatus(readFileSync(w.paths.statusFile("glow-salon"), "utf8")).status;
    assert.equal(failed.deploy.state, "failed"); assert.match(failed.deploy.message, /pathway-pin/);
  } finally { w.done(); }
});

test("the export for the monthly report has the record and the bookings and no customer's number, in the shapes scripts/client-report.ts reads", () => {
  const dir = mkdtempSync(join(tmpdir(), "geo-export-")); try {
    const data = join(dir, "rt"); const store = openStore(data);
    store.commitStep({ snapshot: JSON.stringify({ format: 1, bookings: [["b-1", { id: "b-1", customer: "+919811111111", state: "confirmed", serviceId: "haircut", depositInr: 200, reminders: [], pending: [], handledPayments: [] }]], customers: [], seenMessages: [], seenEvents: [], nextBooking: 2 }), entries: [{ seq: 1, time: "2026-11-04T10:00:00Z", conversation: "+919811111111", booking: "b-1", action: "send_message", inputsDigest: "d", outcome: "confirmed", decisions: [], language: "en", notes: "", refs: {} } as never], nowMs: Date.now() });
    store.close();
    const personKeyFile = writePersonKey(dir);
    const r = exportShop({ name: "s", db: join(data, "agent.db"), out: join(dir, "out", "s"), personKeyFile });
    assert.deepEqual([r.ok, r.entries, r.bookings], [true, 1, 1]);
    const record = JSON.parse(readFileSync(join(dir, "out", "s", "record.json"), "utf8")); const bookings = JSON.parse(readFileSync(join(dir, "out", "s", "bookings.json"), "utf8"));
    assert.ok(!JSON.stringify([record, bookings]).includes("919811111111"), "no number in either file");
    assert.match(record[0].conversation, /^c-[0-9a-f]{12}$/); assert.match(bookings[0].customer, /^p-[0-9a-f]{12}$/);
    assert.deepEqual([record[0].seq, bookings[0].id, bookings[0].state], [1, "b-1", "confirmed"]);
    assert.equal(exportShop({ name: "n", db: join(dir, "absent.db"), out: join(dir, "out", "n"), personKeyFile }).ok, false);
    assert.equal(exportShop({ name: "s", db: join(data, "agent.db"), out: join(dir, "out", "t"), personKeyFile: join(dir, "no-such-key") }).ok, false, "a shop without its key is not exported, never exported unkeyed");
    assert.ok(!existsSync(join(dir, "out", "t")));
    assert.ok(!existsSync(join(dir, "out", "n")), "nothing is written for a shop with no database yet: the panel says 'not shared yet'");
    assert.ok(DatabaseSync);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
