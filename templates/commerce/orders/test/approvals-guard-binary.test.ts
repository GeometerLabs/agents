// The whole approval, against the REAL Guard: the limits spec generated from the shop's settings, compiled by `geo-guard compile`, loaded by `geo-guard run` in front of the
// Razorpay stand-in (production profile, enforce mode). A customer's cancellation refund above the shop's limit is held (HTTP 202), the approvals relay asks the owner in the
// owner's words, the owner's "approve <code>" reaches Guard as a signed notification, the agent sends the identical call again, and the refund is recorded once.
// Same shape as Fees' test (templates/education/fees/test/approvals-guard-binary.test.ts); the numbers are read from the settings and the generator, not typed here.
//
// It needs the built binary (monorepo target/debug/geo-guard, macOS). Without it every test here is skipped, and says so. Set GEO_GUARD_BIN to use another. It needs no Docker.
// Nothing is written inside the monorepo: the binary is run on a temp folder.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHmac, randomUUID } from "node:crypto";
import { createFakeMessaging } from "../../../../modules/messaging/messaging.ts";
import { createRazorpayPayments } from "../../../../modules/payments/providers/razorpay/api.ts";
import { LANGUAGES } from "../../../../modules/language/languages.ts";
import { systemClock } from "../../../../modules/core/clock.ts";
import { createGuardClient, createRuntimeClient } from "../../../../modules/approvals/clients.ts";
import { openRelayStore } from "../../../../modules/approvals/store.ts";
import { startServer } from "../../../../modules/runtime/http.ts";
import { META_TEMPLATE_NAMES } from "../src/language/meta-templates.ts";
import { TEMPLATE_NAMES } from "../src/language/templates.ts";
import { highestOrderInr, parseSettings } from "../src/settings.ts";
import { AMIT, HARNESS_GUARD, annapurnaRazorpay } from "../src/harness.ts";
import { highestPaise, gatewayLimitsSpec, refundThresholdPaise } from "../src/guard-limits.ts";
import { createRelay } from "../approvals/relay.ts";
import { startStandins } from "../standins/server.ts";
import { createKit } from "./runtime-kit.ts";

const BINARY = process.env.GEO_GUARD_BIN ?? "/Users/navaltharun/Work/geometer/monorepo/target/debug/geo-guard";
const skip = existsSync(BINARY) ? false : `needs the built geo-guard binary, which is not at ${BINARY} (build it in the monorepo, or set GEO_GUARD_BIN); these tests run the real Guard`;

const freePort = () => new Promise<number>((resolve, reject) => { const s = createServer(); s.once("error", reject); s.listen(0, "127.0.0.1", () => { const { port } = s.address() as { port: number }; s.close(() => resolve(port)); }); });
const credential = () => { const out = execFileSync(BINARY, ["credential"], { encoding: "utf8" }); return { token: /^token: (\S+)/mu.exec(out)![1], hash: /token_sha256 = "(\w+)"/u.exec(out)![1] }; };

interface RealGuard { agentUrl: string; adminUrl: string; agentToken: string; adminToken: string; ownerSecret: string; spec: Record<string, any>; digest: string; approvalTtlSeconds: number; stop(): Promise<void> }

/** compile + run, on a temp folder. The upstream is plain HTTP on this computer: the stand-in. */
async function startRealGuard(settings: ReturnType<typeof annapurnaRazorpay>, upstreamPort: number, approvalTtlSeconds = 86_400): Promise<RealGuard> {
  const dir = mkdtempSync(join(tmpdir(), "geo-guard-orders-"));
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
deployment = "annapurna-razorpay"
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
id = "runtime-${HARNESS_GUARD.tenant}"
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
id = "owner-${HARNESS_GUARD.tenant}"
roles = ["shop-owner"]
[notify_secrets]
owner-${HARNESS_GUARD.tenant} = "\${file:${join(dir, "owner_notify_secret")}}"
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
async function standinsAndGuard(settings: ReturnType<typeof annapurnaRazorpay>, approvalTtlSeconds?: number): Promise<{ standins: Awaited<ReturnType<typeof startStandins>>; guard: RealGuard }> {
  const standins = await startStandins({ gatewayWebhookSecret: "x", whatsappAppSecret: "y" }, { port: 0 });
  try { return { standins, guard: await startRealGuard(settings, standins.port, approvalTtlSeconds) }; } catch (e) { await standins.close(); throw e; }
}

const admin = (g: RealGuard, path: string, init: RequestInit = {}) => fetch(`${g.adminUrl}${path}`, { ...init, headers: { authorization: `Bearer ${g.adminToken}`, "content-type": "application/json", ...(init.headers ?? {}) } });
const agentCall = (g: RealGuard, path: string, body: unknown) => fetch(`${g.agentUrl}${path}`, { method: "POST", headers: { authorization: `Bearer ${g.agentToken}`, "content-type": "application/json" }, body: JSON.stringify(body) });
const refundCall = (g: RealGuard, amount: number, id: string) => agentCall(g, `/v1/payments/${id}/refund`, { amount });
const linkCall = (g: RealGuard, amount: number, reference = `f-0.${randomUUID().slice(0, 6)}`) => agentCall(g, "/v1/payment_links", { amount, currency: "INR", reference_id: reference });
const pendingApprovals = async (g: RealGuard) => ((await (await admin(g, "/admin/approvals?state=pending")).json()) as any).approvals.length as number;

const settingsWithLimit = (limitInr: number) => parseSettings({ ...JSON.parse(readFileSync(new URL("../settings/annapurna-tiffins-razorpay.example.json", import.meta.url), "utf8")), refund: { limitInr } });

test("the generated spec compiles, and the shop's refund limit and the real Guard's threshold are the same line: at the limit passes, one paisa above is held, above the dearest order is refused", { skip }, async () => {
  const settings = annapurnaRazorpay();
  const { standins, guard } = await standinsAndGuard(settings);
  try {
    const limit = refundThresholdPaise(settings);
    const highest = highestPaise(settings);
    assert.equal(limit, settings.refund.limitInr * 100);
    assert.equal(highest, highestOrderInr(settings) * 100, "the dearest order the shop can take: the most items, all of the dearest item");
    // at the limit the refund goes on to the service (which has no such payment, so it answers 400 itself); one paisa above it waits for the owner
    const atTheLimit = await refundCall(guard, limit, "pay_a");
    assert.notEqual(atTheLimit.status, 202, "at the limit it is not held");
    assert.equal(atTheLimit.status, 400, "the stand-in's own answer, passed through");
    assert.equal(((await atTheLimit.json()) as any).guard, undefined);
    const above = await refundCall(guard, limit + 1, "pay_b");
    assert.equal(above.status, 202);
    assert.match(above.headers.get("guard-held") ?? "", /^ap-/u);
    // above the dearest order is refused outright, in Guard's own words, and no approval is made for it
    const tooMuch = await refundCall(guard, highest + 1, "pay_c");
    assert.equal(tooMuch.status, 403);
    assert.equal(tooMuch.headers.get("guard-held"), null);
    const body = await tooMuch.json() as any;
    assert.equal(body.guard.decision, "deny");
    const ruleId = "refund-at-most-order";
    assert.ok(JSON.stringify(guard.spec).includes(ruleId), "the generator names this rule (src/guard-limits.ts)");
    assert.match(body.guard.reason, new RegExp(`^${ruleId}: amount ${highest + 1} is above the highest allowed value, ${highest}$`, "u"));
    for (const amount of [0, -100]) assert.equal((await refundCall(guard, amount, "pay_d")).status, 403, `amount ${amount}`);
    assert.equal(await pendingApprovals(guard), 1, "only the one refund above the limit waits for the owner");
    // a payment link is bounded to a range, not a list: the lowest link up to the dearest order
    assert.equal((await linkCall(guard, highest)).status, 200, "the dearest order is allowed");
    assert.equal((await linkCall(guard, 100)).status, 200, "₹1 is allowed");
    assert.equal((await linkCall(guard, highest + 100)).status, 403, "one rupee above the dearest is refused");
    assert.equal((await linkCall(guard, 99)).status, 403, "less than ₹1 is refused");
    // what the guide says the hold lasts: the approval time in the spec, to the millisecond
    const held = await (await admin(guard, "/admin/approvals?state=pending")).json() as any;
    const row = held.approvals[0];
    assert.equal(Number(row.expires_at_ms) - Number(row.requested_at_ms), guard.approvalTtlSeconds * 1000);
  } finally { await guard.stop(); await standins.close(); }
});

test("the owner's limit is the shop's own: lowered to ₹100, a ₹101 refund is held, and the spec says so", { skip }, async () => {
  const settings = settingsWithLimit(100);
  const { standins, guard } = await standinsAndGuard(settings);
  try {
    assert.equal((await refundCall(guard, 10_000, "pay_a")).status, 400, "at the limit it goes on");
    assert.equal((await refundCall(guard, 10_100, "pay_b")).status, 202);
    assert.equal(await pendingApprovals(guard), 1);
  } finally { await guard.stop(); await standins.close(); }
});

test("the longest approval time Guard accepts is 7 days; one second more is refused by the compiler", { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), "geo-guard-orders-ttl-"));
  try {
    const compile = (seconds: number) => {
      const spec = { ...gatewayLimitsSpec(annapurnaRazorpay(), HARNESS_GUARD), approval_ttl_seconds: seconds };
      writeFileSync(join(dir, "spec.json"), JSON.stringify(spec));
      return (() => { try { execFileSync(BINARY, ["compile", "--spec", join(dir, "spec.json"), "--out", join(dir, "bundle.json")], { encoding: "utf8", stdio: "pipe" }); return ""; } catch (e) { return String((e as { stderr?: unknown }).stderr); } })();
    };
    assert.equal(compile(604_800), "");
    assert.match(compile(604_801), /approval_ttl_seconds: must be between 60 and 604800/);
    assert.equal(compile(86_400), "", "the 24 hours this pathway uses");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

/** A runtime on the real Guard, a relay beside it, and a customer whose paid order is cancelled: everything up to the refund request. The shop's limit is ₹100, below the 50% advance. */
async function withRealApproval(run: (a: { guard: RealGuard; standins: Awaited<ReturnType<typeof startStandins>>; kit: ReturnType<typeof createKit>; runtime: any; relay: ReturnType<typeof createRelay>; whatsapp: ReturnType<typeof createFakeMessaging>; owner: string; lines: string[]; stage: () => Promise<number> }) => Promise<void>): Promise<void> {
  const settings = settingsWithLimit(100);
  const { standins, guard } = await standinsAndGuard(settings);
  const kit = createKit(settings);
  const dir = mkdtempSync(join(tmpdir(), "geo-relay-orders-"));
  const whatsapp = createFakeMessaging(kit.clock);
  for (const name of [...Object.values(TEMPLATE_NAMES), ...META_TEMPLATE_NAMES]) for (const language of LANGUAGES) whatsapp.approve(name, language);
  const lines: string[] = [];
  const payments = createRazorpayPayments({ baseUrl: guard.agentUrl, agentToken: guard.agentToken });
  const { runtime } = kit.open({ settings, services: { payments, messaging: kit.messaging }, log: (l) => lines.push(l) });
  const INTERNAL = "internal-token-0123456789abcdef";
  const runtimeServer = await startServer(runtime, { token: INTERNAL, port: 0 });
  const store = openRelayStore(dir);
  try {
    // the relay's reading credential: an approver credential Guard issues from its admin port, which expires; the relay never holds the admin token
    const issued = await (await admin(guard, "/admin/approvers", { method: "POST", body: JSON.stringify({ id: "owner-phone", roles: ["shop-owner"], ttl_seconds: 3600 }) })).json() as any;
    assert.match(issued.token, /^gg_/u);
    // the relay runs on the real clock because Guard checks the time of a notification; the runtime keeps its own fake days
    const relay = createRelay({
      clock: systemClock, store, ownerWhatsapp: settings.owner.whatsapp, messaging: whatsapp, expectedAgent: `runtime-${HARNESS_GUARD.tenant}`, log: (l) => lines.push(`relay: ${l}`),
      guard: createGuardClient({ adminUrl: guard.adminUrl, readToken: issued.token, approverId: `owner-${HARNESS_GUARD.tenant}`, approverSecret: guard.ownerSecret, now: () => Date.now() }),
      runtime: createRuntimeClient({ url: runtimeServer.url, token: INTERNAL }),
    });
    // the order goes through the real Guard (the advance link must be inside the range the generator wrote), and the customer pays it; the answer is the advance in paise
    const stage = async () => {
      await kit.say(runtime, "2 veg thali 10 nov 12:00 pm pickup");
      const link = standins.fakes.payments.links().find((l) => l.reference_id === "o-1");
      assert.ok(link, "the link was made at the stand-in, through the real Guard");
      standins.fakes.payments.customerPays(link.id);
      runtime.submit(standins.fakes.payments.events.map((event) => ({ kind: "payment_event" as const, event })));
      runtime.kick(); await runtime.idle();
      assert.deepEqual(runtime.status().orders, { confirmed: 1 });
      return link.amount;
    };
    await run({ guard, standins, kit, runtime, relay, whatsapp, owner: settings.owner.whatsapp, lines, stage });
  } finally {
    store.close(); await runtimeServer.close(); await runtime.close(); kit.cleanup(); rmSync(dir, { recursive: true, force: true });
    await guard.stop(); await standins.close();
  }
}

const codeOf = (text: string) => /"approve ([A-Z0-9]{6})"/u.exec(text)![1];

test("held → relay asks once → the owner approves → a signed notify → the identical call again → the refund is made once, and the owner was asked exactly once", { skip }, async () => {
  await withRealApproval(async ({ guard, standins, kit, runtime, relay, whatsapp, owner, lines, stage }) => {
    const advance = await stage();
    assert.ok(advance > 10_000, "the advance is above the ₹100 limit, so its refund is held");
    // the customer cancels inside the window: the whole advance is to go back, above the limit, so the real Guard holds the refund
    await kit.say(runtime, "cancel");
    assert.equal(standins.fakes.payments.refunds().length, 0);
    assert.deepEqual(runtime.status().refunds, { waitingForOwner: 1, beingSentAgain: 0, needBuilder: { total: 0 } });
    assert.deepEqual(whatsapp.sentTo(owner), [], "the agent did not ask the owner");

    // the relay reads Guard's held refunds, checks them against the runtime, and asks the owner, once
    await relay.poll(); await relay.poll();
    const asked = whatsapp.sentTo(owner);
    assert.equal(asked.length, 1);
    assert.equal(asked[0].templateName, "owner_order_refund_approval");
    const code = codeOf(asked[0].text);
    assert.match(asked[0].text, new RegExp(`refund ₹${(advance / 100).toLocaleString("en-IN")} for ${AMIT.replace("+", "\\+")} \\(order o-1`, "u"));

    // a forged notification: signed with the wrong secret, then a stale one; the real Guard refuses both
    const approval = (await (await admin(guard, "/admin/approvals?state=pending")).json() as any).approvals[0].id as string;
    const notify = (secret: string, atMs: number, nonce = randomUUID()) => {
      const raw = JSON.stringify({ approval, decision: "approve", approver: `owner-${HARNESS_GUARD.tenant}`, at_ms: String(atMs), nonce });
      return fetch(`${guard.adminUrl}/admin/notify`, { method: "POST", body: raw, headers: { "content-type": "application/json", "x-geo-signature": createHmac("sha256", secret).update(raw).digest("hex") } });
    };
    assert.equal((await notify("not the owner's secret", Date.now())).status, 401);
    assert.equal((await notify(guard.ownerSecret, Date.now() - 10 * 60_000)).status, 401);
    assert.equal(standins.fakes.payments.refunds().length, 0);

    // another number with the right code does nothing; the owner's number does
    relay.receive([{ id: "wamid.forged", from: "+919899999999", text: `approve ${code}`, timestamp: Date.now() }]);
    await relay.idle();
    assert.equal(standins.fakes.payments.refunds().length, 0);
    const reply = whatsapp.receive(owner, `approve ${code}`);
    relay.receive([reply]);
    runtime.submit([{ kind: "message", message: reply }]); runtime.kick(); // the inbox's copy to the runtime: the agent ignores a code
    await relay.idle(); await runtime.idle();

    // the identical call went through once; the stand-in recorded one refund of the whole advance against the right payment
    const refunds = standins.fakes.payments.refunds();
    assert.equal(refunds.length, 1);
    assert.equal(refunds[0].amount, advance);
    assert.equal(refunds[0].receipt, `o-1:${refunds[0].payment_id}`);
    const states = (await (await admin(guard, "/admin/approvals")).json() as any).approvals.map((a: any) => a.state);
    assert.deepEqual(states, ["consumed"], "one approval, used once");
    assert.deepEqual(runtime.status().refunds, { waitingForOwner: 0, beingSentAgain: 0, needBuilder: { total: 0 } });
    assert.equal(whatsapp.sentTo(owner).filter((m) => m.templateName === "owner_order_refund_approval").length, 1, "the owner was asked exactly once");
    // everything the relay and the agent did leaves no code or secret in a log line
    assert.ok(!lines.join("\n").includes(code) && !lines.join("\n").includes(guard.ownerSecret));
    // nothing more happens, however long it is left
    for (let i = 0; i < 3; i++) { await relay.poll(); await runtime.tick(); }
    assert.equal(standins.fakes.payments.refunds().length, 1);
    assert.equal((await (await admin(guard, "/admin/approvals?state=pending")).json() as any).approvals.length, 0, "and Guard holds nothing new");
  });
});

test("a denied refund against the real Guard: the owner says no, nothing is refunded, and Guard is not asked again", { skip }, async () => {
  await withRealApproval(async ({ guard, standins, kit, runtime, relay, whatsapp, owner, stage }) => {
    await stage();
    await kit.say(runtime, "cancel");
    await relay.poll();
    const code = codeOf(whatsapp.sentTo(owner)[0].text);
    relay.receive([whatsapp.receive(owner, `deny ${code}`)]);
    await relay.idle(); await runtime.idle();
    assert.equal(standins.fakes.payments.refunds().length, 0);
    for (let i = 0; i < 3; i++) { await relay.poll(); await runtime.tick(); }
    assert.equal((await (await admin(guard, "/admin/approvals?state=pending")).json() as any).approvals.length, 0, "the agent did not ask Guard again, so Guard holds nothing new");
    assert.equal(whatsapp.sentTo(owner).filter((m) => m.templateName === "owner_order_refund_approval").length, 1);
  });
});
