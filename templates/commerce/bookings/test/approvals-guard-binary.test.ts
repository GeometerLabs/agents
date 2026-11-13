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
import { createFakeMessaging } from "../../../../modules/messaging/messaging.ts";
import { createFakeCalendar } from "../src/adapters/calendar.ts";
import { createRazorpayPayments } from "../../../../modules/payments/providers/razorpay/api.ts";
import { META_TEMPLATE_NAMES } from "../src/language/meta-templates.ts";
import { TEMPLATE_NAMES } from "../src/language/templates.ts";
import { parseSettings } from "../src/settings.ts";
import { LANGUAGES } from "../../../../modules/language/languages.ts";
import { systemClock } from "../../../../modules/core/clock.ts";
import { glowSalon, HARNESS_GUARD } from "../src/harness.ts";
import { gatewayLimitsSpec, refundThresholdPaise } from "../src/guard-limits.ts";
import { startServer } from "../server/server.ts";
import { startStandins } from "../standins/server.ts";
import { createGuardClient, createRuntimeClient } from "../../../../modules/approvals/clients.ts";
import { createRelay } from "../approvals/relay.ts";
import { openRelayStore } from "../../../../modules/approvals/store.ts";
import { createKit } from "./runtime-kit.ts";
import { createHmac, randomUUID } from "node:crypto";
import { GuardDeniedError, GuardHeldError } from "../../../../modules/core/faults.ts";

const BINARY = process.env.GEO_GUARD_BIN ?? "/Users/navaltharun/Work/geometer/monorepo/target/debug/geo-guard";
const skip = existsSync(BINARY) ? false : `needs the built geo-guard binary, which is not at ${BINARY} (build it in the monorepo, or set GEO_GUARD_BIN); these tests run the real Guard`;

const freePort = () => new Promise<number>((resolve, reject) => { const s = createServer(); s.once("error", reject); s.listen(0, "127.0.0.1", () => { const { port } = s.address() as { port: number }; s.close(() => resolve(port)); }); });
const credential = () => { const out = execFileSync(BINARY, ["credential"], { encoding: "utf8" }); return { token: /^token: (\S+)/mu.exec(out)![1], hash: /token_sha256 = "(\w+)"/u.exec(out)![1] }; };

interface RealGuard { agentUrl: string; adminUrl: string; agentToken: string; adminToken: string; ownerSecret: string; spec: Record<string, any>; digest: string; approvalTtlSeconds: number; stop(): Promise<void> }

/** compile + run, on a temp folder. The upstream is plain HTTP on this computer: the stand-in. */
async function startRealGuard(settings: ReturnType<typeof glowSalon>, upstreamPort: number, approvalTtlSeconds = 86_400): Promise<RealGuard> {
  const dir = mkdtempSync(join(tmpdir(), "geo-guard-it-"));
  const spec = gatewayLimitsSpec(settings, HARNESS_GUARD, { approvalTtlSeconds });
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

/**
 * The stand-in and the real Guard in front of it. When the Guard does not come up (on a loaded machine its 5 s wait can run out), the stand-in is closed before
 * the error goes on: an open stand-in server kept this test file's process alive after the failure, holding the machine's test lock for 36 minutes (14 Nov 2026).
 */
async function standinsAndGuard(settings: ReturnType<typeof glowSalon>, approvalTtlSeconds?: number): Promise<{ standins: Awaited<ReturnType<typeof startStandins>>; guard: RealGuard }> {
  const standins = await startStandins({ razorpayWebhookSecret: "x", whatsappAppSecret: "y" }, { port: 0 });
  try { return { standins, guard: await startRealGuard(settings, standins.port, approvalTtlSeconds) }; } catch (e) { await standins.close(); throw e; }
}

const admin = (g: RealGuard, path: string, init: RequestInit = {}) => fetch(`${g.adminUrl}${path}`, { ...init, headers: { authorization: `Bearer ${g.adminToken}`, "content-type": "application/json", ...(init.headers ?? {}) } });

const limited = (refundLimitInr: number) => parseSettings({ ...JSON.parse(JSON.stringify(glowSalon())), cancellation: { windowHours: 24, refundLimitInr } });

test("the generated spec compiles, and the agent's limit and the real Guard's threshold are the same line: at the limit passes, one paisa above is held", { skip }, async () => {
  const settings = limited(100);
  const { standins, guard } = await standinsAndGuard(settings);
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
    const link = (amount: number) => fetch(`${guard.agentUrl}/v1/payment_links`, { method: "POST", headers: { authorization: `Bearer ${guard.agentToken}`, "content-type": "application/json" }, body: JSON.stringify({ amount, currency: "INR", reference_id: `b-${amount}`, description: "x", part_payments: false }) });
    assert.equal((await link(20_000)).status, 200, "the deposit (₹200) is allowed");
    assert.equal((await link(20_100)).status, 403, "any other amount is refused");
    assert.equal((await link(19_900)).status, 403);
    // what the guide says the hold lasts: the approval time in the spec, to the millisecond
    const held = await (await admin(guard, "/admin/approvals?state=pending")).json() as any;
    const row = held.approvals[0];
    assert.equal(Number(row.expires_at_ms) - Number(row.requested_at_ms), guard.approvalTtlSeconds * 1000);
  } finally { await guard.stop(); await standins.close(); }
});

/** A refund call straight at Guard, as the agent would send it. */
const refundCall = (g: RealGuard, amount: number, id: string) => fetch(`${g.agentUrl}/v1/payments/${id}/refund`, { method: "POST", headers: { authorization: `Bearer ${g.agentToken}`, "content-type": "application/json" }, body: JSON.stringify({ amount, receipt: `b-1:${id}` }) });
const pendingApprovals = async (g: RealGuard) => ((await (await admin(g, "/admin/approvals?state=pending")).json()) as any).approvals.length as number;

test("a refund above the deposit is refused by the real Guard even when it is also above the owner's limit: the refusal wins over the hold, and nobody is asked", { skip }, async () => {
  const settings = limited(100); // the owner's limit (₹100) is below the deposit (₹200), so the deposit itself is held
  const { standins, guard } = await standinsAndGuard(settings);
  try {
    assert.deepEqual(guard.spec.rules.find((r: any) => r.id === "refund-at-most-deposit"), { id: "refund-at-most-deposit", kind: "argument_bound", operation: "refund", field: "amount", min: "1", max: "20000", units: { amount: "paise" } });
    // exactly the deposit is above the limit, so it waits for the owner as before
    const deposit = await refundCall(guard, 20_000, "pay_a");
    assert.equal(deposit.status, 202);
    assert.match(deposit.headers.get("guard-held") ?? "", /^ap-/u);
    assert.equal(await pendingApprovals(guard), 1);
    // one paisa more is above the limit AND above the deposit: the bound refuses it (403, not 202), in Guard's own words, and no new approval is made
    const above = await refundCall(guard, 20_001, "pay_b");
    assert.equal(above.status, 403);
    assert.equal(above.headers.get("guard-held"), null);
    const body = await above.json() as any;
    assert.equal(body.guard.decision, "deny");
    assert.equal(body.guard.code, "refused_by_policy");
    assert.match(body.guard.reason, /^refund-at-most-deposit: amount 20001 is above the highest allowed value, 20000$/u);
    assert.equal(await pendingApprovals(guard), 1, "the refused refund made no approval, so the owner is not asked about it");
    // the ₹500 a customer might claim, and nonsense amounts, are refused the same way
    for (const amount of [50_000, 1_000_000, 0, -100]) assert.equal((await refundCall(guard, amount, "pay_c")).status, 403, `amount ${amount}`);
    assert.equal(await pendingApprovals(guard), 1);
    // the refusal on pay_b did not block a valid refund of pay_b later: it is held for the owner like any first call
    assert.equal((await refundCall(guard, 20_000, "pay_b")).status, 202);
    assert.equal(await pendingApprovals(guard), 2);
  } finally { await guard.stop(); await standins.close(); }
});

test("the deposit was lowered: the real Guard refuses the older, larger refund (the same bound, the new number), lets the new deposit through, and the refused call does not use up the once-only record", { skip }, async () => {
  const lowered = parseSettings({ ...JSON.parse(JSON.stringify(glowSalon())), deposit: { ...JSON.parse(JSON.stringify(glowSalon())).deposit, amountInr: 150 }, cancellation: { windowHours: 24, refundLimitInr: 500 } });
  const { standins, guard } = await standinsAndGuard(lowered);
  try {
    assert.equal(guard.spec.rules.find((r: any) => r.id === "refund-at-most-deposit").max, "15000");
    // ₹200 was a deposit before the change: above the new deposit, so refused, though it is well inside the owner's limit (₹500)
    const older = await refundCall(guard, 20_000, "pay_x");
    assert.equal(older.status, 403);
    assert.match(((await older.json()) as any).guard.reason, /^refund-at-most-deposit: amount 20000 is above the highest allowed value, 15000$/u);
    // exactly the new deposit goes on to the service (which has no such payment, so it answers 400 itself), on the same payment: the refusal did not take its place
    const sent = await refundCall(guard, 15_000, "pay_x");
    assert.equal(sent.status, 400, "the stand-in's own answer, passed through");
    assert.equal(((await sent.json()) as any).guard, undefined);
    assert.equal((await refundCall(guard, 15_001, "pay_y")).status, 403, "one paisa above the new deposit");
    assert.equal(await pendingApprovals(guard), 0, "nothing was held: the owner's limit was never reached");
  } finally { await guard.stop(); await standins.close(); }
});

test("the longest approval time Guard accepts is 7 days; one second more is refused by the compiler", { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), "geo-guard-ttl-"));
  try {
    const compile = (seconds: number) => {
      const spec = { ...gatewayLimitsSpec(glowSalon(), HARNESS_GUARD), approval_ttl_seconds: seconds };
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
  const { standins, guard } = await standinsAndGuard(settings);
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
    assert.match(asked[0].text, /^A refund needs your OK: ₹200 to \+91 98111 11111 \(haircut, Thu 5 Nov, 6:00 pm\)\. Reply "approve [A-Z0-9]{6}" or "deny [A-Z0-9]{6}" within 24 hours\.$/u);

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
    assert.equal(whatsapp.sentTo(settings.owner.whatsapp).at(-1)!.text, "Thanks! The ₹200 refund to +91 98111 11111 is being sent, and I'll let them know.");
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
  const { standins, guard } = await standinsAndGuard(settings);
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
    // the identical refund sent again anyway (as a builder's agent does to find out): Guard refuses it as the owner's no and opens nothing (ADR-0061 addendum,
    // 12 Nov 2026). Needs a geo-guard built with that change.
    const paymentId = standins.fakes.payments.links()[0].payments[0].id;
    await assert.rejects(payments.refund(paymentId, { amount: 20_000, receipt: `b-1:${paymentId}` }), (e: unknown) => e instanceof GuardDeniedError && typeof e.approval === "string" && e.untilMs !== undefined);
    await relay.poll();
    assert.equal((await (await admin(guard, "/admin/approvals?state=pending")).json() as any).approvals.length, 0, "Guard opened no new request");
    assert.equal(whatsapp.sentTo(settings.owner.whatsapp).filter((m) => m.templateName === "owner_approval_request").length, 1, "and the owner was not asked again");
    assert.equal(standins.fakes.payments.refunds().length, 0);
  } finally {
    store.close(); await runtimeServer.close(); await runtime.close(); kit.cleanup(); rmSync(dir, { recursive: true, force: true });
    await guard.stop(); await standins.close();
  }
});

// B74 (11 Nov): the owner's yes covers ONE exact call. The relay gives Guard the owner's signed answer for an approval id and nothing else (no amount, no
// payment), so what binds the yes to the money is Guard: it holds a call by its digest and releases only the identical call. A changed amount, another
// payment (whose payer the refund goes to) or another receipt is a different call: it is held again under a NEW approval, which the owner has not given,
// and nothing is sent. Razorpay's refund body has no currency (a refund is in its payment's currency) and no fee field; any other field added would change
// the bytes in the same way. The runtime never builds the call again: it sends the saved bytes (modules/payments/refunds.ts, resendRefund).
test("B74: after the owner approves, a changed amount, another payment or another receipt is held again under a new approval and nothing is sent; only the identical call is released, once", { skip }, async () => {
  const settings = limited(100); // ₹200 deposit, owner's limit ₹100: a refund above ₹100 is held
  const { standins, guard } = await standinsAndGuard(settings);
  try {
    const payments = createRazorpayPayments({ baseUrl: guard.agentUrl, agentToken: guard.agentToken });
    // two paid deposits, both through the real Guard (₹200 is the only amount the deposit bound lets through)
    const paid = [];
    for (const ref of ["b-1", "b-2"]) {
      const link = await payments.createRequest({ amount: 20_000, reference_id: ref, description: "deposit" });
      paid.push(standins.fakes.payments.customerPays(link.id).id);
    }
    const [p1, p2] = paid;
    const heldId = async (paymentId: string, amount: number, receipt: string): Promise<string> => {
      try { await payments.refund(paymentId, { amount, receipt }); } catch (e) { if (e instanceof GuardHeldError && e.approval) return e.approval; throw e; }
      throw new Error(`a refund of ${amount} on ${paymentId} was sent, not held`);
    };
    const approve = async (approval: string) => {
      const raw = JSON.stringify({ approval, decision: "approve", approver: "owner-glow-salon", at_ms: String(Date.now()), nonce: randomUUID() });
      const r = await fetch(`${guard.adminUrl}/admin/notify`, { method: "POST", body: raw, headers: { "content-type": "application/json", "x-geo-signature": createHmac("sha256", guard.ownerSecret).update(raw).digest("hex") } });
      assert.equal(r.status, 200, await r.text());
    };
    const states = async () => Object.fromEntries(((await (await admin(guard, "/admin/approvals")).json() as any).approvals as any[]).map((a) => [a.id, a.state]));

    const asked = await heldId(p1, 20_000, `b-1:${p1}`);
    await approve(asked);
    assert.equal((await states())[asked], "approved");

    // the same refund with any material field changed: held again, each under an approval of its own, and the owner's yes is not used up
    const changed = [await heldId(p1, 15_000, `b-1:${p1}`), await heldId(p2, 20_000, `b-1:${p1}`), await heldId(p1, 20_000, `b-9:${p1}`)];
    for (const id of changed) assert.notEqual(id, asked, "a changed call never reuses the approval the owner gave");
    assert.equal(new Set(changed).size, 3, "each changed call is its own approval");
    assert.equal(standins.fakes.payments.refunds().length, 0, "nothing was sent: an approval for one call is not an approval for another");
    const after = await states();
    assert.equal(after[asked], "approved", "the owner's yes is still for the original call");
    for (const id of changed) assert.equal(after[id], "pending", "the changed calls wait for a yes the owner has not given");

    // the identical call is released, once
    const refund = await payments.refund(p1, { amount: 20_000, receipt: `b-1:${p1}` });
    assert.equal(refund.amount, 20_000);
    assert.deepEqual(standins.fakes.payments.refunds().map((r) => [r.payment_id, r.amount, r.receipt]), [[p1, 20_000, `b-1:${p1}`]]);
    assert.equal((await states())[asked], "consumed");
  } finally {
    await guard.stop(); await standins.close();
  }
});
