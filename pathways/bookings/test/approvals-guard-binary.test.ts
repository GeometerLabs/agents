// The whole approval, against the REAL Guard: the limits spec generated from the settings, compiled by `geo-guard compile`, loaded by `geo-guard run`
// in front of the Razorpay stand-in (production profile, enforce mode). A cancelled booking's refund is held (HTTP 202), the approvals relay asks the owner,
// the owner's "approve <code>" reaches Guard as a signed notification, the agent sends the identical call again, and the refund is recorded once.
//
// It needs the built binary (monorepo target/debug/geo-guard, macOS). Without it every test here is skipped, and says so. Set GEO_GUARD_BIN to use another.
// Nothing is written inside the monorepo: the binary is run on a temp folder.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakeMessaging } from "../src/adapters/messaging.ts";
import { createFakeCalendar } from "../src/adapters/calendar.ts";
import { createRazorpayPayments } from "../src/adapters/live/razorpay.ts";
import { META_TEMPLATE_NAMES } from "../src/language/meta-templates.ts";
import { TEMPLATE_NAMES } from "../src/language/templates.ts";
import { LANGUAGES, parseSettings } from "../src/settings.ts";
import { systemClock } from "../src/clock.ts";
import { glowSalon, HARNESS_GUARD } from "../src/harness.ts";
import { razorpayLimitsSpec, refundThresholdPaise } from "../src/guard-limits.ts";
import { startServer } from "../server/server.ts";
import { startStandins } from "../standins/server.ts";
import { createGuardClient, createRuntimeClient } from "../approvals/clients.ts";
import { createRelay } from "../approvals/relay.ts";
import { openRelayStore } from "../approvals/store.ts";
import { createKit } from "./runtime-kit.ts";
import { createHmac, randomUUID } from "node:crypto";

const BINARY = process.env.GEO_GUARD_BIN ?? "/Users/navaltharun/Work/geometer/monorepo/target/debug/geo-guard";
const skip = existsSync(BINARY) ? false : `needs the built geo-guard binary, which is not at ${BINARY} (build it in the monorepo, or set GEO_GUARD_BIN); these tests run the real Guard`;

const freePort = () => new Promise<number>((resolve, reject) => { const s = createServer(); s.once("error", reject); s.listen(0, "127.0.0.1", () => { const { port } = s.address() as { port: number }; s.close(() => resolve(port)); }); });
const credential = () => { const out = execFileSync(BINARY, ["credential"], { encoding: "utf8" }); return { token: /^token: (\S+)/mu.exec(out)![1], hash: /token_sha256 = "(\w+)"/u.exec(out)![1] }; };

interface RealGuard { agentUrl: string; adminUrl: string; agentToken: string; adminToken: string; ownerSecret: string; spec: Record<string, any>; digest: string; approvalTtlSeconds: number; stop(): Promise<void> }

/** compile + run, on a temp folder. The upstream is plain HTTP on this computer: the stand-in. */
async function startRealGuard(settings: ReturnType<typeof glowSalon>, upstreamPort: number, approvalTtlSeconds = 86_400): Promise<RealGuard> {
  const dir = mkdtempSync(join(tmpdir(), "geo-guard-it-"));
  const spec = razorpayLimitsSpec(settings, HARNESS_GUARD, { approvalTtlSeconds });
  writeFileSync(join(dir, "spec.json"), JSON.stringify(spec));
  const summary = JSON.parse(execFileSync(BINARY, ["compile", "--spec", join(dir, "spec.json"), "--out", join(dir, "bundle.json")], { encoding: "utf8" })) as { digest: string };
  const agent = credential(); const admin = credential();
  const ownerSecret = `owner-notify-secret-${randomUUID()}`;
  writeFileSync(join(dir, "razorpay_authorization"), "Basic dGVzdDp0ZXN0", { mode: 0o600 });
  writeFileSync(join(dir, "owner_notify_secret"), ownerSecret, { mode: 0o600 });
  const [listen, adminListen] = [await freePort(), await freePort()];
  writeFileSync(join(dir, "guard.toml"), `schema = 2
profile = "production"
listen = "127.0.0.1:${listen}"
admin_listen = "127.0.0.1:${adminListen}"
deployment = "glow-salon-razorpay"
tenant = "${HARNESS_GUARD.tenant}"
tool = "razorpay"
mode = "enforce"
upstream = "127.0.0.1:${upstreamPort}"
upstream_timeout_ms = 15000
state = "${join(dir, "state.db")}"
bundle = "${join(dir, "bundle.json")}"
bundle_digest = "${summary.digest}"
unlisted_tools = "deny"
[[admins]]
id = "ops"
token_sha256 = "${admin.hash}"
[[agents]]
id = "runtime-glow-salon"
token_sha256 = "${agent.hash}"
tenant = "${HARNESS_GUARD.tenant}"
[upstream_headers]
Authorization = "\${file:${join(dir, "razorpay_authorization")}}"
[[roles]]
id = "shop-owner"
tools = ["razorpay"]
operations = ["refund"]
rules = ["*"]
tenants = ["${HARNESS_GUARD.tenant}"]
[[approvers]]
id = "owner-glow-salon"
roles = ["shop-owner"]
[notify_secrets]
owner-glow-salon = "\${file:${join(dir, "owner_notify_secret")}}"
`);
  const child: ChildProcess = spawn(BINARY, ["run", "--config", join(dir, "guard.toml")], { stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout!.on("data", (c: Buffer) => { output += c; });
  child.stderr!.on("data", (c: Buffer) => { output += c; });
  const stop = async () => {
    if (child.exitCode === null) { child.kill("SIGTERM"); await new Promise<void>((resolve) => { const t = setTimeout(() => { child.kill("SIGKILL"); }, 3000); child.once("exit", () => { clearTimeout(t); resolve(); }); }); }
    rmSync(dir, { recursive: true, force: true });
  };
  for (let i = 0; i < 100 && !/geo-guard ready/u.test(output); i++) {
    if (child.exitCode !== null) { await stop(); throw new Error(`geo-guard did not start: ${output.slice(0, 600)}`); }
    await new Promise((r) => setTimeout(r, 50));
  }
  if (!/geo-guard ready/u.test(output)) { await stop(); throw new Error(`geo-guard was not ready in 5 s: ${output.slice(0, 600)}`); }
  return { agentUrl: `http://127.0.0.1:${listen}`, adminUrl: `http://127.0.0.1:${adminListen}`, agentToken: agent.token, adminToken: admin.token, ownerSecret, spec, digest: summary.digest, approvalTtlSeconds, stop };
}

const admin = (g: RealGuard, path: string, init: RequestInit = {}) => fetch(`${g.adminUrl}${path}`, { ...init, headers: { authorization: `Bearer ${g.adminToken}`, "content-type": "application/json", ...(init.headers ?? {}) } });

const limited = (refundLimitInr: number) => parseSettings({ ...JSON.parse(JSON.stringify(glowSalon())), cancellation: { windowHours: 24, refundLimitInr } });

test("the generated spec compiles, and the agent's limit and the real Guard's threshold are the same line: at the limit passes, one paisa above is held", { skip }, async () => {
  const settings = limited(100);
  const standins = await startStandins({ razorpayWebhookSecret: "x", whatsappAppSecret: "y" }, { port: 0 });
  const guard = await startRealGuard(settings, standins.port);
  try {
    assert.equal(refundThresholdPaise(settings), 10_000);
    const refund = (amount: number, id = "pay_nobody") => fetch(`${guard.agentUrl}/v1/payments/${id}/refund`, { method: "POST", headers: { authorization: `Bearer ${guard.agentToken}`, "content-type": "application/json" }, body: JSON.stringify({ amount, receipt: `b-1:${id}` }) });
    const atTheLimit = await refund(10_000, "pay_a");
    assert.notEqual(atTheLimit.status, 202, "at the limit it is not held: it went on to the service, which has no such payment");
    assert.equal(atTheLimit.status, 400, "the stand-in's own answer, passed through");
    assert.equal((await atTheLimit.json() as any).guard, undefined);
    const above = await refund(10_001, "pay_b");
    assert.equal(above.status, 202);
    assert.match(above.headers.get("guard-held") ?? "", /^ap-/u);
    // the deposit bound is the settings' deposit, and nothing else
    const link = (amount: number) => fetch(`${guard.agentUrl}/v1/payment_links`, { method: "POST", headers: { authorization: `Bearer ${guard.agentToken}`, "content-type": "application/json" }, body: JSON.stringify({ amount, currency: "INR", reference_id: `b-${amount}`, description: "x", accept_partial: false }) });
    assert.equal((await link(20_000)).status, 200, "the deposit (₹200) is allowed");
    assert.equal((await link(20_100)).status, 403, "any other amount is refused");
    assert.equal((await link(19_900)).status, 403);
    // what the guide says the hold lasts: the approval time in the spec, to the millisecond
    const held = await (await admin(guard, "/admin/approvals?state=pending")).json() as any;
    const row = held.approvals[0];
    assert.equal(Number(row.expires_at_ms) - Number(row.requested_at_ms), guard.approvalTtlSeconds * 1000);
  } finally { await guard.stop(); await standins.close(); }
});

test("the longest approval time Guard accepts is 7 days; one second more is refused by the compiler", { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), "geo-guard-ttl-"));
  try {
    const compile = (seconds: number) => {
      const spec = { ...razorpayLimitsSpec(glowSalon(), HARNESS_GUARD), approval_ttl_seconds: seconds };
      writeFileSync(join(dir, "spec.json"), JSON.stringify(spec));
      return (() => { try { execFileSync(BINARY, ["compile", "--spec", join(dir, "spec.json"), "--out", join(dir, "bundle.json")], { encoding: "utf8", stdio: "pipe" }); return ""; } catch (e) { return String((e as { stderr?: unknown }).stderr); } })();
    };
    assert.equal(compile(604_800), "");
    assert.match(compile(604_801), /approval_ttl_seconds: must be between 60 and 604800/);
    assert.match(compile(59), /must be between 60 and 604800/);
    assert.equal(compile(86_400), "", "the 24 hours this pathway uses");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("held → relay asks once → the owner approves → a signed notify → the identical call again → the refund is made once, and the owner was asked exactly once", { skip }, async () => {
  const settings = limited(100);
  const standins = await startStandins({ razorpayWebhookSecret: "x", whatsappAppSecret: "y" }, { port: 0 });
  const guard = await startRealGuard(settings, standins.port);
  const kit = createKit();
  const dir = mkdtempSync(join(tmpdir(), "geo-relay-it-"));
  const whatsapp = createFakeMessaging(kit.clock);
  for (const name of [...Object.values(TEMPLATE_NAMES), ...META_TEMPLATE_NAMES]) for (const language of LANGUAGES) whatsapp.approve(name, language);
  const lines: string[] = [];
  const payments = createRazorpayPayments({ baseUrl: guard.agentUrl, agentToken: guard.agentToken });
  const { runtime } = kit.open({ settings, services: { calendar: createFakeCalendar(), payments, messaging: kit.messaging }, log: (l) => lines.push(l) });
  const INTERNAL = "internal-token-0123456789abcdef";
  const runtimeServer = await startServer(runtime, { token: INTERNAL, port: 0 });
  const store = openRelayStore(dir);
  try {
    // the relay's reading credential: an approver credential Guard issues from its admin port, which expires; the relay never holds the admin token
    const issued = await (await admin(guard, "/admin/approvers", { method: "POST", body: JSON.stringify({ id: "owner-phone", roles: ["shop-owner"], ttl_seconds: 3600 }) })).json() as any;
    assert.match(issued.token, /^gg_/u);
    // the relay runs on the real clock because Guard checks the time of a notification; the runtime keeps its own fake days
    const relay = createRelay({
      clock: systemClock, store, ownerWhatsapp: settings.owner.whatsapp, messaging: whatsapp, expectedAgent: "runtime-glow-salon", log: (l) => lines.push(`relay: ${l}`),
      guard: createGuardClient({ adminUrl: guard.adminUrl, readToken: issued.token, approverId: "owner-glow-salon", approverSecret: guard.ownerSecret, now: () => Date.now() }),
      runtime: createRuntimeClient({ url: runtimeServer.url, token: INTERNAL }),
    });

    // a customer books and pays (the deposit link goes through Guard: ₹200 is the deposit bound the generator wrote)
    await kit.say(runtime, "haircut day after tomorrow at 6pm");
    const link = standins.fakes.payments.links()[0];
    assert.ok(link, "the link was made at the stand-in, through the real Guard");
    standins.fakes.payments.customerPays(link.id);
    runtime.submit(standins.fakes.payments.events.map((event) => ({ kind: "payment_event" as const, event })));
    runtime.kick(); await runtime.idle();
    assert.equal(runtime.status().bookings.confirmed, 1);

    // cancelled in time: ₹200 is above the ₹100 limit, so the real Guard holds the refund
    await kit.say(runtime, "cancel my booking");
    assert.equal(standins.fakes.payments.refunds().length, 0);
    assert.deepEqual(runtime.status().refunds, { waitingForOwner: 1, beingSentAgain: 0, needBuilder: { total: 0 } });
    assert.deepEqual(whatsapp.sentTo(settings.owner.whatsapp), [], "the agent did not ask the owner");

    // the relay reads Guard's held refunds, checks them against the runtime, and asks the owner, once
    await relay.poll(); await relay.poll();
    const asked = whatsapp.sentTo(settings.owner.whatsapp);
    assert.equal(asked.length, 1);
    assert.equal(asked[0].templateName, "owner_approval_request");
    const code = /"approve ([A-Z0-9]{6})"/u.exec(asked[0].text)![1];
    assert.match(asked[0].text, /refund ₹200 for \+919811111111 \(haircut, Thu 5 Nov, 6:00 pm\)\. Reply "approve [A-Z0-9]{6}" or "deny [A-Z0-9]{6}" within 24 hours\.$/u);

    // a forged notification: signed with the wrong secret, then a stale one; the real Guard refuses both
    const approval = (await (await admin(guard, "/admin/approvals?state=pending")).json() as any).approvals[0].id as string;
    const notify = (secret: string, atMs: number, nonce = randomUUID()) => {
      const raw = JSON.stringify({ approval, decision: "approve", approver: "owner-glow-salon", at_ms: String(atMs), nonce });
      return fetch(`${guard.adminUrl}/admin/notify`, { method: "POST", body: raw, headers: { "content-type": "application/json", "x-geo-signature": createHmac("sha256", secret).update(raw).digest("hex") } });
    };
    assert.equal((await notify("not the owner's secret", Date.now())).status, 401);
    assert.equal((await notify(guard.ownerSecret, Date.now() - 10 * 60_000)).status, 401);
    assert.equal(standins.fakes.payments.refunds().length, 0);

    // another number with the right code does nothing; the owner's number does
    relay.receive([{ id: "wamid.forged", from: "+919899999999", text: `approve ${code}`, timestamp: Date.now() }]);
    await relay.idle();
    assert.equal(standins.fakes.payments.refunds().length, 0);
    const reply = whatsapp.receive(settings.owner.whatsapp, `approve ${code}`);
    relay.receive([reply]);
    runtime.submit([{ kind: "message", message: reply }]); runtime.kick(); // the inbox's copy to the runtime: the agent ignores a code
    await relay.idle(); await runtime.idle();

    // the identical call went through once; the stand-in recorded one refund of ₹200 against the right payment and receipt
    const refunds = standins.fakes.payments.refunds();
    assert.equal(refunds.length, 1);
    assert.equal(refunds[0].amount, 20_000);
    assert.equal(refunds[0].receipt, `b-1:${refunds[0].payment_id}`);
    const states = (await (await admin(guard, "/admin/approvals")).json() as any).approvals.map((a: any) => a.state);
    assert.deepEqual(states, ["consumed"], "one approval, used once");
    assert.deepEqual(runtime.status().refunds, { waitingForOwner: 0, beingSentAgain: 0, needBuilder: { total: 0 } });
    assert.equal(whatsapp.sentTo(settings.owner.whatsapp).filter((m) => m.templateName === "owner_approval_request").length, 1, "the owner was asked exactly once");
    assert.equal(whatsapp.sentTo(settings.owner.whatsapp).at(-1)!.text, "Thank you. The ₹200 refund for +919811111111 is being sent, and they will be told.");
    assert.match(kit.messaging.sentTo("+919811111111").at(-1)!.text, /owner approved your refund/);
    // everything the relay and the agent did leaves no code or secret in a log line
    assert.ok(!lines.join("\n").includes(code) && !lines.join("\n").includes(guard.ownerSecret));
    // nothing more happens, however long it is left
    for (let i = 0; i < 3; i++) { await relay.poll(); await runtime.tick(); }
    assert.equal(standins.fakes.payments.refunds().length, 1);
    assert.equal((await (await admin(guard, "/admin/approvals?state=pending")).json() as any).approvals.length, 0, "and Guard holds nothing new");
  } finally {
    store.close(); await runtimeServer.close(); await runtime.close(); kit.cleanup(); rmSync(dir, { recursive: true, force: true });
    await guard.stop(); await standins.close();
  }
});

test("a denied refund against the real Guard: the owner says no, nothing is refunded, and Guard is not asked again", { skip }, async () => {
  const settings = limited(100);
  const standins = await startStandins({ razorpayWebhookSecret: "x", whatsappAppSecret: "y" }, { port: 0 });
  const guard = await startRealGuard(settings, standins.port);
  const kit = createKit();
  const dir = mkdtempSync(join(tmpdir(), "geo-relay-it-"));
  const whatsapp = createFakeMessaging(kit.clock);
  for (const name of [...Object.values(TEMPLATE_NAMES), ...META_TEMPLATE_NAMES]) for (const language of LANGUAGES) whatsapp.approve(name, language);
  const payments = createRazorpayPayments({ baseUrl: guard.agentUrl, agentToken: guard.agentToken });
  const { runtime } = kit.open({ settings, services: { calendar: createFakeCalendar(), payments, messaging: kit.messaging } });
  const runtimeServer = await startServer(runtime, { token: "internal-token-0123456789abcdef", port: 0 });
  const store = openRelayStore(dir);
  try {
    const issued = await (await admin(guard, "/admin/approvers", { method: "POST", body: JSON.stringify({ id: "owner-phone", roles: ["shop-owner"], ttl_seconds: 3600 }) })).json() as any;
    const relay = createRelay({
      clock: systemClock, store, ownerWhatsapp: settings.owner.whatsapp, messaging: whatsapp,
      guard: createGuardClient({ adminUrl: guard.adminUrl, readToken: issued.token, approverId: "owner-glow-salon", approverSecret: guard.ownerSecret, now: () => Date.now() }),
      runtime: createRuntimeClient({ url: runtimeServer.url, token: "internal-token-0123456789abcdef" }),
    });
    await kit.say(runtime, "haircut day after tomorrow at 6pm");
    standins.fakes.payments.customerPays(standins.fakes.payments.links()[0].id);
    runtime.submit(standins.fakes.payments.events.map((event) => ({ kind: "payment_event" as const, event }))); runtime.kick(); await runtime.idle();
    await kit.say(runtime, "cancel my booking");
    await relay.poll();
    const code = /"approve ([A-Z0-9]{6})"/u.exec(whatsapp.sentTo(settings.owner.whatsapp)[0].text)![1];
    relay.receive([whatsapp.receive(settings.owner.whatsapp, `deny ${code}`)]);
    await relay.idle(); await runtime.idle();
    assert.equal(standins.fakes.payments.refunds().length, 0);
    assert.match(kit.messaging.sentTo("+919811111111").at(-1)!.text, /decided not to refund the ₹200/);
    await kit.say(runtime, "cancel my booking");
    for (let i = 0; i < 3; i++) { await relay.poll(); await runtime.tick(); }
    assert.equal((await (await admin(guard, "/admin/approvals?state=pending")).json() as any).approvals.length, 0, "the agent did not ask Guard again, so Guard holds nothing new");
    assert.equal(whatsapp.sentTo(settings.owner.whatsapp).filter((m) => m.templateName === "owner_approval_request").length, 1);
  } finally {
    store.close(); await runtimeServer.close(); await runtime.close(); kit.cleanup(); rmSync(dir, { recursive: true, force: true });
    await guard.stop(); await standins.close();
  }
});
