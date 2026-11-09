// A Fees centre through the bundle: the files the generator writes for it (two Guards, no calendar, a runtime config Fees' own runtime accepts), the compose entries, the
// deploy on a fake machine, `shop add --template fees`, the export for the monthly report (a child's name does not leave the shop's volume), and the heartbeat's counts.
// Every check on the generated files runs Fees' OWN validator on them: a config the runtime refuses is a shop that does not start.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../geometer.ts";
import { checkShop, deploy } from "../deploy.ts";
import { exportShop } from "../backup/export.ts";
import { headOf } from "../../modules/record/ledger.ts";
import { composeServer } from "../generate/compose.ts";
import type { Dirs } from "../generate/compose.ts";
import { inboxConfig, opsConfig, refresherConfig, relayConfig } from "../generate/configs.ts";
import { planShop, reportBaseUrl } from "../generate/shop.ts";
import { KINDS, kindFor } from "../lib/kinds.ts";
import { readShop } from "../lib/server.ts";
import { realRunner } from "../lib/runner.ts";
import { loadState } from "../lib/state.ts";
import { readStatus } from "../lib/status.ts";
import { buildHeartbeat } from "../services/heartbeat.ts";
import { validateRuntimeConfig } from "../../templates/education/fees/server/config.ts";
import { createKit } from "../../templates/education/fees/test/runtime-kit.ts";
import { PARENT } from "../../templates/education/fees/test/runtime-kit.ts";
import { zonedToMs } from "../../modules/core/time.ts";
import { PHONE_NUMBER_ID, serverConfig, writePersonKey } from "./helpers.ts";
import { secretsFor, world } from "./world.ts";
import type { World } from "./world.ts";

const FEES_CLIENT = new URL("../../templates/education/fees/clients/bright-tuition.example", import.meta.url).pathname;
const feesRuntime = (change: Record<string, unknown> = {}) => ({ mode: "live", tickSeconds: 30, services: { payments: {}, messaging: { phoneNumberId: PHONE_NUMBER_ID }, timeoutMs: 20_000 }, ...change });

/** Put a Fees centre into a world's server folder, the way `shop add` or the panel would. */
function addFees(w: World, name = "bright", runtime: Record<string, unknown> | null = feesRuntime()): void {
  mkdirSync(w.paths.shop(name), { recursive: true });
  cpSync(join(FEES_CLIENT, "settings.json"), join(w.paths.shop(name), "settings.json"));
  cpSync(join(FEES_CLIENT, "pathway.lock"), join(w.paths.shop(name), "pathway.lock"));
  if (runtime) writeFileSync(join(w.paths.shop(name), "runtime.json"), JSON.stringify(runtime));
  writeFileSync(join(w.paths.shop(name), "owner.json"), JSON.stringify({ schema: 1, accountId: "acc_test", accountName: "Divya", role: "partner", createdAt: "2026-11-01T10:00:00Z", template: "fees" }));
}
/** What a Fees centre hands in: the same secrets, and no Google key. */
const feesSecrets = (name: string) => { const { "google_service_account.json": _google, ...rest } = secretsFor(name); return rest; };

const plan = (w: World, name = "bright", change: Record<string, unknown> = {}) => planShop(serverConfig(change), readShop(w.root, name));

// ---- reading the folder -------------------------------------------------------------------------------------------------------

test("a shop's settings are judged by the template its pathway.lock names; a lock for a template the bundle does not run is said by name", () => {
  const w = world({}); try {
    addFees(w);
    const shop = readShop(w.root, "bright");
    assert.deepEqual(shop.problems, []);
    assert.deepEqual(shop.lock, { pathway: "fees", version: "0.1.0" });
    assert.equal(shop.settings.batches.length, 3, "Fees' own settings, with batches and students");
    assert.equal(shop.settings.owner.language, "en");

    // Bookings' settings under a Fees lock are Fees' problem, in Fees' words
    cpSync(new URL("../../templates/commerce/bookings/clients/glow-salon.example/settings.json", import.meta.url).pathname, join(w.paths.shop("bright"), "settings.json"));
    assert.ok(readShop(w.root, "bright").problems.some((p) => /Add at least one batch/.test(p)), readShop(w.root, "bright").problems.join("|"));

    for (const lock of ["nonesuch@0.1.0", "constructor@0.1.0", "toString@0.1.0".toLowerCase()]) {
      writeFileSync(join(w.paths.shop("bright"), "pathway.lock"), `${lock}\n`);
      const p = readShop(w.root, "bright").problems;
      assert.ok(p.some((x) => x.includes(`pinned to "${lock.split("@")[0]}"`) && x.includes("bookings, fees")), `${lock}: ${p.join("|")}`);
    }
    assert.equal(kindFor("constructor"), undefined);
    assert.deepEqual(Object.keys(KINDS), ["bookings", "fees", "orders"]);
  } finally { w.done(); }
});

// ---- the generated files -------------------------------------------------------------------------------------------------------

test("a Fees centre gets two Guards from its settings (Razorpay and WhatsApp), no calendar, and the limits are the centre's own numbers", () => {
  const w = world({}); try {
    addFees(w);
    const p = plan(w);
    assert.deepEqual(p.problems, []);
    assert.deepEqual(p.guards.map((g) => g.kind), ["razorpay", "whatsapp"]);
    const razorpay = p.guards[0].spec;
    const rule = (id: string) => razorpay.rules.find((r: any) => r.id === id);
    assert.deepEqual([rule("fee-amount").min, rule("fee-amount").max], ["100", "190000"], "a link: ₹1 up to the dearest fee (₹1,800) with its late fee (₹100)");
    assert.equal(rule("refund-at-most-fee-paid").max, "190000");
    assert.equal(rule("refund-needs-owner").kind, "call_bound_approval");
    assert.equal(rule("refund-needs-owner").threshold, "50000", "the refund limit (₹500) is the one number the agent and Guard share");
    assert.equal(razorpay.approval_ttl_seconds, 86_400);
    assert.deepEqual(p.guards[1].spec.rules.map((r: any) => r.id), ["own-number-only", "own-number-read"]);
    for (const g of p.guards) assert.equal(g.tenant, "bright");
  } finally { w.done(); }
});

test("the generated runtime.json is one Fees' own runtime accepts: payments and messaging, no calendar, and `report` and `ai` are in it when they are asked for", () => {
  const w = world({}); try {
    addFees(w);
    const p = plan(w);
    assert.deepEqual(Object.keys(p.runtime.services as object), ["payments", "messaging", "timeoutMs"]);
    const checked = validateRuntimeConfig(p.runtime, "/");
    assert.ok(checked.ok, JSON.stringify(checked));
    assert.ok("report" in p.runtime, "the monthly report block is there (a silently dropped block would mean no report and no note)");
    assert.equal((p.runtime.report as { pageBaseUrl: string }).pageBaseUrl, reportBaseUrl(serverConfig(), "bright"));
    assert.ok(!p.notes.some((n) => /monthly report to the owner is not switched on/.test(n)), p.notes.join("|"));

    // fleet's button mode is written too, and the result is still a config Fees accepts
    mkdirSync(w.paths.fleet, { recursive: true });
    writeFileSync(join(w.paths.fleet, "bright.json"), JSON.stringify({ schema: 1, ai: "buttons", plan: "business", innovator: true, at: "2026-11-04T10:00:00Z" }));
    const withAi = planShop(serverConfig(), readShop(w.root, "bright"));
    assert.equal((withAi.runtime as { ai?: string }).ai, "buttons");
    assert.ok(validateRuntimeConfig(withAi.runtime, "/").ok);
    assert.ok(!withAi.notes.some((n) => /does not know the ai setting/.test(n)));
    assert.equal((withAi.runtime.report as { innovator: boolean }).innovator, true);
  } finally { w.done(); }
});

test("a calendar left in a Fees centre's runtime.json is left out of the generated config, and said; a centre that names no WhatsApp number id is refused by name", () => {
  const w = world({}); try {
    addFees(w, "bright", feesRuntime({ services: { payments: {}, calendar: { calendarId: "old@group.calendar.google.com" }, messaging: { phoneNumberId: PHONE_NUMBER_ID }, timeoutMs: 20_000 } }));
    const p = plan(w);
    assert.deepEqual(p.problems, []);
    assert.ok(!("calendar" in (p.runtime.services as object)));
    assert.ok(p.notes.some((n) => /the fees template has no calendar/.test(n)), p.notes.join("|"));
    assert.ok(validateRuntimeConfig(p.runtime, "/").ok);
    addFees(w, "noid", feesRuntime({ services: { payments: {}, messaging: {} } }));
    assert.deepEqual(plan(w, "noid").problems.map((x) => x.rule), ["whatsapp-number-id"], "and nothing about a calendar");
  } finally { w.done(); }
});

test("the compose file: the centre's runtime waits for its two Guards, runs the Fees pathway, and no calendar Guard or token volume is made for it; the shared services know its template", () => {
  const w = world({}); try {
    addFees(w);
    const server = serverConfig();
    const p = plan(w);
    const dirs: Dirs = { app: w.ctx.appDir, generated: w.paths.generated, secrets: w.paths.secrets, status: w.paths.status, fleet: w.paths.fleet, shops: w.paths.shops, secretsInbox: w.paths.secretsInbox, requests: w.paths.requests, exports: w.paths.exports, panelData: w.paths.panel, config: w.paths.config, licence: join(w.paths.state, "licence") };
    const deploy1 = { name: "bright", index: 1, pathwayDir: join(w.ctx.appDir, "templates", "education", "fees"), guards: p.guards.map((g) => ({ kind: g.kind, service: g.service, tenant: "bright" })) };
    const composed = composeServer(server, dirs, [deploy1], { backup: false });
    const names = Object.keys(composed.services);
    assert.ok(names.includes("g-bright-razorpay") && names.includes("g-bright-whatsapp") && names.includes("rt-bright"));
    assert.ok(!names.some((n) => n.includes("calendar")), names.join(","));
    const rt = composed.services["rt-bright"].block as any;
    assert.deepEqual(Object.keys(rt.depends_on).sort(), ["g-bright-razorpay", "g-bright-whatsapp"]);
    assert.ok(rt.volumes.includes(`${deploy1.pathwayDir}:/pathway:ro`));
    assert.ok(rt.volumes.some((v: string) => v.endsWith("/modules:/modules:ro")));
    assert.deepEqual(rt.command, ["node", "/pathway/server/main.ts", "--client", "/client"]);
    assert.ok(!composed.compose.includes("g-bright-calendar") && !composed.compose.includes("gs-bright-calendar"));

    // the shared services' configs
    const shops = [{ ...deploy1, webhooks: { verification: "meta-signature" as const, hasGoogle: false, ownGoogleKey: false }, ownerWhatsapp: "+919000000000", phoneNumberId: PHONE_NUMBER_ID, pathway: "fees", pathwayVersion: "0.1.0" }];
    const ops = JSON.parse(opsConfig(server, shops));
    assert.equal(ops.shops.bright.pathway, "fees");
    assert.deepEqual(ops.shops.bright.guards.map((g: any) => g.id), ["guard-razorpay", "guard-whatsapp", "guard-model"]);
    assert.equal(JSON.parse(relayConfig(server, shops)).shops.bright.pathway, "fees");
    assert.deepEqual(Object.keys(JSON.parse(refresherConfig(server, shops)).shops), [], "nothing for the token refresher to look after");
    assert.equal(JSON.parse(inboxConfig(server, shops)).shops.bright.runtimeUrl.endsWith(":8780"), true);
  } finally { w.done(); }
});

// ---- deploy, on a fake machine -------------------------------------------------------------------------------------------------

test("check and deploy a Fees centre: no Google key is asked for, even on a server that holds one; two Guards are proven; the status says fees@0.1.0; the runtime config on disk is Fees'", async () => {
  const w = world({}); try {
    addFees(w);
    w.handIn("bright", feesSecrets("bright"));
    const checked = await checkShop(w.ctx, "bright");
    assert.deepEqual(checked.problems, [], checked.problems.map((x) => x.message).join("\n"));
    assert.deepEqual(checked.lines.map((l) => l.split(":")[0]), ["g-bright-razorpay", "g-bright-whatsapp"]);

    const [r] = await deploy(w.ctx, "bright");
    assert.equal(r.proven.line, "8 of 8 limits proven to bite (2 cannot be tested without writing, and are not counted)");
    assert.deepEqual(Object.keys(r.guards), ["razorpay", "whatsapp"]);
    const status = readStatus(w.root, "bright")!;
    assert.deepEqual([status.deploy.state, status.versions?.pathway], ["applied", "fees@0.1.0"]);
    assert.deepEqual(status.versions?.guards, { razorpay: 1, whatsapp: 1 });
    const onDisk = JSON.parse(readFileSync(join(w.paths.generated, "shops", "bright", "client", "runtime.json"), "utf8"));
    assert.ok(validateRuntimeConfig(onDisk, "/").ok);
    assert.ok(!("calendar" in onDisk.services));
    assert.ok(!existsSync(join(w.paths.secrets, "refresher", "bright")) && !existsSync(join(w.paths.secrets, "g-bright-calendar")), "no calendar credentials or folders were made");
    assert.deepEqual(readdirSync(join(w.paths.secrets, "ops", "bright")).filter((f) => f.startsWith("admin_")).sort(), ["admin_razorpay", "admin_whatsapp"]);
    assert.deepEqual(readdirSync(join(w.paths.secrets, "rt-bright")).sort(), ["agent_model", "agent_razorpay", "agent_whatsapp", "internal_token", "record_key"]);
    const ops = JSON.parse(readFileSync(join(w.paths.generated, "ops", "ops.json"), "utf8"));
    assert.equal(ops.shops.bright.pathway, "fees");
    const state = loadState(w.root);
    assert.equal(state.shops.bright.applied?.pathway, "fees@0.1.0");
  } finally { w.done(); }
});

test("a Fees centre and a Bookings salon on one server: each has its own Guards and words, and only the salon's calendar Guard needs the Google key", async () => {
  const w = world(); try {
    addFees(w);
    w.handIn("glow-salon");
    w.handIn("bright", feesSecrets("bright"));
    const results = await deploy(w.ctx);
    assert.deepEqual(results.map((r) => [r.shop, Object.keys(r.guards).join("+")]), [["bright", "razorpay+whatsapp"], ["glow-salon", "razorpay+whatsapp+calendar"]]);
    const refresher = JSON.parse(readFileSync(join(w.paths.generated, "refresher", "refresher.json"), "utf8"));
    assert.deepEqual(Object.keys(refresher.shops), ["glow-salon"]);
    const relay = JSON.parse(readFileSync(join(w.paths.generated, "relay", "relay.json"), "utf8"));
    assert.equal(relay.shops.bright.pathway, "fees");
    assert.equal(relay.shops["glow-salon"].pathway, undefined, "Bookings' entry is as it always was");
    const ops = JSON.parse(readFileSync(join(w.paths.generated, "ops", "ops.json"), "utf8"));
    assert.deepEqual([ops.shops.bright.pathway, ops.shops["glow-salon"].pathway], ["fees", "bookings"]);
    assert.equal(ops.shops["glow-salon"].guards.length, 4);
    assert.equal(ops.shops.bright.guards.length, 3);
    const compose = readFileSync(join(w.paths.generated, "compose.yaml"), "utf8");
    assert.ok(compose.includes("g-glow-salon-calendar") && !compose.includes("g-bright-calendar"));
  } finally { w.done(); }
});

test("a Fees centre that is missing its WhatsApp or Razorpay secrets is refused by name, exactly as a salon is", async () => {
  const w = world({}); try {
    addFees(w);
    const { whatsapp_token: _token, ...without } = feesSecrets("bright");
    w.handIn("bright", without);
    const checked = await checkShop(w.ctx, "bright");
    assert.deepEqual(checked.problems.map((p) => p.rule), ["secret-missing:whatsapp_token"]);
  } finally { w.done(); }
});

// ---- shop add --template ---------------------------------------------------------------------------------------------------------

async function quiet<T>(work: () => Promise<T>): Promise<{ result: T; out: string; err: string }> {
  const out: string[] = []; const err: string[] = [];
  const [log, error] = [console.log, console.error];
  console.log = (...a: unknown[]) => out.push(a.join(" ")); console.error = (...a: unknown[]) => err.push(a.join(" "));
  try { return { result: await work(), out: out.join("\n"), err: err.join("\n") }; } finally { console.log = log; console.error = error; }
}

test("shop add --template fees starts a centre from the template: the example settings, the pin to the version here, a runtime.json for the WhatsApp number, and a name for who set it up", async () => {
  const w = world({}); try {
    const add = (...a: string[]) => quiet(() => main(["shop", "add", ...a, "--server", w.root]));
    const r = await add("bright", "--template", "fees", "--whatsapp-number-id", PHONE_NUMBER_ID, "--prepared-by", "Divya, local partner");
    assert.equal(r.result, 0, r.err);
    assert.match(r.out, /somebody else's made-up centre/);
    const dir = w.paths.shop("bright");
    assert.equal(readFileSync(join(dir, "pathway.lock"), "utf8"), "fees@0.1.0\n");
    assert.deepEqual(JSON.parse(readFileSync(join(dir, "runtime.json"), "utf8")), { mode: "live", tickSeconds: 30, services: { payments: {}, messaging: { phoneNumberId: PHONE_NUMBER_ID }, timeoutMs: 20_000 } });
    assert.equal(readFileSync(join(dir, "settings.json"), "utf8"), readFileSync(new URL("../../templates/education/fees/settings/bright-tuition.example.json", import.meta.url), "utf8"));
    assert.deepEqual(JSON.parse(readFileSync(join(dir, "report.json"), "utf8")), { schema: 1, preparedBy: "Divya, local partner" });
    assert.deepEqual(readShop(w.root, "bright").problems, [], "the shop reads cleanly");
    w.handIn("bright", feesSecrets("bright"));
    assert.deepEqual((await checkShop(w.ctx, "bright")).problems, [], "and it passes the generator's checks");

    // the settings can be a file of its own; it is checked first, and a bad one makes no folder
    const mine = join(w.root, "mine.json");
    writeFileSync(mine, JSON.stringify({ ...JSON.parse(readFileSync(join(dir, "settings.json"), "utf8")), name: "Sunrise Tuition" }));
    const second = await add("sunrise", "--template", "fees", "--settings", mine, "--whatsapp-number-id", "999999999999");
    assert.equal(second.result, 0, second.err);
    assert.equal(readShop(w.root, "sunrise").settings.name, "Sunrise Tuition");
    writeFileSync(mine, JSON.stringify({ name: "x" }));
    const bad = await add("third", "--template", "fees", "--settings", mine);
    assert.equal(bad.result, 1);
    assert.match(bad.err, /These fees settings need fixing/);
    assert.ok(!existsSync(w.paths.shop("third")), "nothing was made");

    // a salon starts the same way, with its calendar
    const salon = await add("glow", "--template", "bookings", "--whatsapp-number-id", PHONE_NUMBER_ID, "--calendar-id", "glow@group.calendar.google.com");
    assert.equal(salon.result, 0, salon.err);
    assert.equal(JSON.parse(readFileSync(join(w.paths.shop("glow"), "runtime.json"), "utf8")).services.calendar.calendarId, "glow@group.calendar.google.com");
    assert.equal(readFileSync(join(w.paths.shop("glow"), "pathway.lock"), "utf8"), "bookings@0.1.0\n");

    // the refusals, each in a sentence
    assert.match((await add("a1", "--template", "fees", "--calendar-id", "x@y")).err, /no calendar/);
    assert.match((await add("a2", "--template", "nonesuch")).err, /no template called "nonesuch".*bookings, fees/);
    assert.match((await add("a3", "--template", "fees", "--from", FEES_CLIENT)).err, /once/);
    assert.match((await add("a4")).err, /Say where the shop starts/);
    assert.match((await add("a5", "--template", "fees", "--whatsapp-number-id", "12ab")).err, /digits only/);
    assert.equal((await add("a6", "--from", FEES_CLIENT)).result, 0, "--from still copies a client folder, a Fees one too");
    assert.deepEqual(readShop(w.root, "a6").problems, []);
  } finally { w.done(); }
});

// ---- the export for the monthly report ---------------------------------------------------------------------------------------------

test("the export for a Fees centre is dues.json: the parent's number and the child's name are hashed, in the fees and in the record's notes, and Bookings still gets bookings.json", async () => {
  const kit = createKit();
  const out = mkdtempSync(join(tmpdir(), "geo-export-"));
  try {
    const { runtime, db } = kit.open();
    await runtime.tick();
    kit.clock.set(zonedToMs({ year: 2026, month: 11, day: 2 }, { hour: 10, minute: 5 }, "Asia/Kolkata"));
    await runtime.tick();
    const names = ["Aarav Sharma", "Anaya Sharma", "Meera Nair", "Kiran Gowda", "Rohan Mehta"];
    const wrote = db.loadState().record.map((e) => e.notes).join("\n");
    assert.ok(names.some((n) => wrote.includes(n)), "the record's own notes do name a student (that is what the export has to hide)");

    const result = exportShop({ name: "bright", db: db.file, out, personKeyFile: writePersonKey(mkdtempSync(join(tmpdir(), "geo-key-"))) });
    assert.equal(result.ok, true);
    assert.deepEqual([result.dues, result.bookings], [5, undefined]);
    assert.deepEqual(readdirSync(out).sort(), ["dues.json", "ledger.json", "person-form.json", "record.json"]);
    const exported = readFileSync(join(out, "dues.json"), "utf8") + readFileSync(join(out, "record.json"), "utf8") + readFileSync(join(out, "ledger.json"), "utf8");
    // B28: the ledger is chained from the centre's OWN record (names in its notes), and its head is the head of the exported record (names hashed): one fingerprint for both
    const own = headOf(db.loadState().record, "bright")!;
    assert.equal(headOf(JSON.parse(readFileSync(join(out, "record.json"), "utf8")), "bright")!.head, own.head);
    assert.equal((JSON.parse(readFileSync(join(out, "ledger.json"), "utf8")) as { hash: string }[]).at(-1)!.hash, own.head);
    assert.deepEqual(result.ledger, { seq: own.seq, head: own.head });
    for (const name of names) assert.ok(!exported.includes(name), `${name} left the volume`);
    assert.ok(!exported.includes(PARENT) && !exported.includes("+9198"), "no parent's number left the volume");
    const dues = JSON.parse(readFileSync(join(out, "dues.json"), "utf8")) as { studentName: string; customer: string; feeInr: number }[];
    assert.ok(dues.every((d) => /^s-[0-9a-f]{12}$/.test(d.studentName) && /^p-[0-9a-f]{12}$/.test(d.customer) && d.feeInr > 0), "the amounts stay: the report counts them");
    // the same student is the same hash, so two fees of one child can still be told apart from two children
    assert.equal(new Set(dues.map((d) => d.studentName)).size, 5);
  } finally { kit.cleanup(); rmSync(out, { recursive: true, force: true }); }
});

// ---- the heartbeat -------------------------------------------------------------------------------------------------------------------

test("the heartbeat carries a Fees runtime's fees by state where the fleet contract has the shop's cases, and says the pathway is fees", () => {
  const now = new Date("2026-11-04T10:00:00Z");
  const shop = { id: "bright", pathway: "fees", pathwayVersion: "0.1.0", up: true, ready: true, status: { pathway: "fees", version: "0.1.0", fees: { open: 4, paid: 1 }, tasks: { pending: 0, failed: 0 }, steps: 3, errors: 0, startedAt: "2026-11-04T09:00:00Z" }, guards: [] };
  const { body } = buildHeartbeat({ deploymentId: "acme-vps-1", bundleVersion: "0.1.0", now, shops: [shop], baseline: {}, lastKnown: {}, usageBaseline: {} } as never);
  const agent = (body as { agents: { id: string; pathway: string; runtime: { bookings: Record<string, number> } }[] }).agents[0];
  assert.deepEqual([agent.pathway, agent.runtime.bookings], ["fees", { open: 4, paid: 1 }]);
});

// ---- geometer update ------------------------------------------------------------------------------------------------------------

test("geometer update moves a Fees centre: the real Fees hand check runs at both versions on the centre's own settings, and the pin moves only when it holds", async () => {
  const w = world({}); try {
    addFees(w);
    w.handIn("bright", feesSecrets("bright"));
    await deploy(w.ctx);
    // version 0.2.0 on the server: a copy of the template, as a checkout of a tag would give, with the modules it imports beside it
    const kept = join(w.root, "templates", "education", "fees@0.2.0");
    cpSync(join(w.ctx.appDir, "templates", "education", "fees"), kept, { recursive: true });
    if (!existsSync(join(w.root, "modules"))) cpSync(join(w.ctx.appDir, "modules"), join(w.root, "modules"), { recursive: true });
    const pkg = join(kept, "package.json");
    writeFileSync(pkg, readFileSync(pkg, "utf8").replaceAll('"version": "0.1.0"', '"version": "0.2.0"'));
    const next = w.ctx.runner.run.bind(w.ctx.runner);
    w.ctx.runner.run = (command, args, options) => (command === process.execPath ? realRunner.run(command, args, options) : next(command, args, options));
    const r = await quiet(() => main(["update", "--to", "0.2.0", "--server", w.root], w.ctx));
    assert.equal(r.result, 0, r.out + r.err);
    assert.equal(readFileSync(join(w.paths.shop("bright"), "pathway.lock"), "utf8").trim(), "fees@0.2.0");
    const step = loadState(w.root).update!.steps.bright;
    assert.ok(step.after && step.after.held === step.after.of && step.after.of >= 20, JSON.stringify(step));
    assert.ok(step.layout && step.layout.from > 0 && step.layout.from === step.layout.to, "the Fees runtime's saved-data layout was asked of both versions");
  } finally { w.done(); }
});
