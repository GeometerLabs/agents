// B37 against the REAL geo-guard: a Bookings shop where the owner, Ravi and Meena approve, and refunds above ₹150 need two of them. The Guard runs the
// guard.toml the bundle writes for such a shop (generate/guards.ts: shop-owner up to ₹150, shop-two with approvals_needed = 2, a notify secret per person),
// the runtime is the real Bookings server over the live Razorpay adapter, and the relay is the real one with the shop's people. The services are the
// stand-ins, behind a small recorder that shows what reached Razorpay's side. Skipped, saying so, without the built binary.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { IncomingHttpHeaders } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGuardClient, createRuntimeClient } from "../../modules/approvals/clients.ts";
import { openRelayStore } from "../../modules/approvals/store.ts";
import { systemClock } from "../../modules/core/clock.ts";
import { LANGUAGES } from "../../modules/language/languages.ts";
import { createFakeMessaging } from "../../modules/messaging/messaging.ts";
import { createRazorpayPayments } from "../../modules/payments/providers/razorpay/api.ts";
import { createRelay } from "../../templates/commerce/bookings/approvals/relay.ts";
import { startServer } from "../../templates/commerce/bookings/server/server.ts";
import { glowSalon, HARNESS_GUARD } from "../../templates/commerce/bookings/src/harness.ts";
import { gatewayLimitsSpec } from "../../templates/commerce/bookings/src/guard-limits.ts";
import { META_TEMPLATE_NAMES } from "../../templates/commerce/bookings/src/language/meta-templates.ts";
import { TEMPLATE_NAMES } from "../../templates/commerce/bookings/src/language/templates.ts";
import { parseSettings } from "../../templates/commerce/bookings/src/settings.ts";
import { startStandins } from "../../templates/commerce/bookings/standins/server.ts";
import { createKit } from "../../templates/commerce/bookings/test/runtime-kit.ts";
import { guardDef } from "../generate/guards.ts";
import { credential, skipWithoutBinary, startRealGuard } from "./real-guard.ts";

const RAVI = { id: "ravi", whatsapp: "+919800000002", language: "hi" as const };
const MEENA = { id: "meena", whatsapp: "+919800000003", language: "en" as const };
const CUSTOMER = "+919811111111";
const INTERNAL = "internal-token-0123456789abcdef";
const codeIn = (text: string) => /"approve ([A-Z0-9]{6})"/u.exec(text)?.[1] ?? "";

/** The world: stand-ins behind a recorder, the real Guard with the bundle's group guard.toml, the Bookings runtime, the relay with the shop's people. */
async function world() {
  const base = JSON.parse(JSON.stringify(glowSalon()));
  const settings = parseSettings({ ...base, cancellation: { windowHours: 24, refundLimitInr: 100 }, approvers: { people: [RAVI, MEENA], twoAboveInr: 150 } });
  const standins = await startStandins({ razorpayWebhookSecret: "x", whatsappAppSecret: "y" }, { port: 0 });
  // what reached Razorpay's side of Guard, header by header
  const seen: { path: string; headers: IncomingHttpHeaders }[] = [];
  const recorder = createServer((req, res) => {
    seen.push({ path: req.url ?? "", headers: req.headers });
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", async () => {
      const body = Buffer.concat(chunks);
      const forwarded = await fetch(`${standins.url}${req.url}`, { method: req.method, headers: { ...(body.length > 0 ? { "content-type": "application/json" } : {}) }, ...(body.length > 0 ? { body } : {}) });
      res.writeHead(forwarded.status, { "content-type": "application/json" });
      res.end(Buffer.from(await forwarded.arrayBuffer()));
    });
  });
  const recorderPort = await new Promise<number>((resolve) => recorder.listen(0, "127.0.0.1", () => resolve((recorder.address() as { port: number }).port)));
  const agent = credential();
  const guard = await startRealGuard({
    def: guardDef("razorpay"), spec: gatewayLimitsSpec(settings, HARNESS_GUARD), tenant: HARNESS_GUARD.tenant, deployment: "glow-salon-razorpay", upstreamPort: recorderPort,
    agents: [{ id: "runtime-glow-salon", token: agent.token }], approver: { id: "owner", group: { people: [RAVI.id, MEENA.id], twoAbovePaise: 15_000 } },
  });
  const admin = (path: string, init: RequestInit = {}) => fetch(`${guard.adminUrl}${path}`, { ...init, headers: { authorization: `Bearer ${guard.adminToken}`, "content-type": "application/json" } });
  // the relay's reading credential holds the lower role only, as ops `issue-approver` gives it
  const issued = await (await admin("/admin/approvers", { method: "POST", body: JSON.stringify({ id: "relay-glow-salon", roles: ["shop-owner"], ttl_seconds: 3600 }) })).json() as { token: string };
  const kit = createKit();
  const payments = createRazorpayPayments({ baseUrl: guard.agentUrl, agentToken: agent.token });
  const { runtime } = kit.open({ settings, services: { calendar: kit.calendar, payments, messaging: kit.messaging } });
  const runtimeServer = await startServer(runtime, { token: INTERNAL, port: 0 });
  const whatsapp = createFakeMessaging(kit.clock);
  for (const name of [...Object.values(TEMPLATE_NAMES), ...META_TEMPLATE_NAMES]) for (const language of LANGUAGES) whatsapp.approve(name, language);
  const dir = mkdtempSync(join(tmpdir(), "geo-relay-group-"));
  const store = openRelayStore(dir);
  const relay = createRelay({
    clock: systemClock, store, ownerWhatsapp: settings.owner.whatsapp, messaging: whatsapp, expectedAgent: "runtime-glow-salon", approvers: [RAVI, MEENA], ownerApproverId: "owner",
    guard: createGuardClient({ adminUrl: guard.adminUrl, readToken: issued.token, approverId: "owner", approverSecret: guard.ownerSecret!, secretOf: (id) => guard.secrets?.[id], now: () => Date.now() }),
    runtime: createRuntimeClient({ url: runtimeServer.url, token: INTERNAL }),
  });
  /** A person writes from their own number: the relay's copy and the runtime's copy, as the inbox gives them. Ids of their own: the kit's fake numbers its messages from the same start, and the runtime drops an id it has seen. */
  let written = 0;
  const writes = async (from: string, text: string) => {
    const m = whatsapp.receive(from, text, { id: `wamid.person-${++written}` });
    relay.receive([m]);
    runtime.submit([{ kind: "message", message: m }]); runtime.kick();
    await relay.idle(); await runtime.idle();
  };
  /** A customer books and pays. `beforePaying` runs between the two (the calendar's fault goes there: the booking's own hold must not use it up). */
  const bookAndPay = async (beforePaying: () => void = () => undefined) => {
    await kit.say(runtime, "haircut day after tomorrow at 6pm");
    beforePaying();
    standins.fakes.payments.customerPays(standins.fakes.payments.links().at(-1)!.id);
    runtime.submit(standins.fakes.payments.events.map((event) => ({ kind: "payment_event" as const, event }))); runtime.kick(); await runtime.idle();
  };
  const reviews = async () => ((await (await fetch(`${guard.adminUrl}/admin/reviews`, { headers: { authorization: `Bearer ${issued.token}` } })).json()) as { reviews: any[] }).reviews;
  const close = async () => {
    store.close(); await runtimeServer.close(); await runtime.close(); kit.cleanup(); rmSync(dir, { recursive: true, force: true });
    await guard.stop(); await new Promise<void>((done) => { recorder.closeAllConnections(); recorder.close(() => done()); }); await standins.close();
  };
  return { settings, standins, seen, guard, admin, kit, runtime, whatsapp, relay, writes, bookAndPay, reviews, close, owner: settings.owner.whatsapp };
}

test("the real Guard with the bundle's guard.toml: the owner's own command names the owner, Ravi and Meena are asked, one approval waits, the second sends the refund once", { skip: skipWithoutBinary }, async () => {
  const w = await world();
  try {
    // the calendar will not confirm the paid booking; the owner answers "approve b-1" (cancel and refund): ₹200, above ₹150, so two people, and not the owner
    await w.bookAndPay(() => w.kit.calendar.inject("update", "silentFailure", { times: 2 }));
    await w.writes(w.owner, "approve b-1");
    const items = await w.reviews();
    assert.equal(items.length, 1);
    const item = items[0];
    assert.equal(item.waiting_for, "shop-two");
    assert.deepEqual([item.approvals_needed, item.approvals_given, item.requested_by, item.may_still_decide], [2, 0, ["owner"], ["meena", "ravi"]], "Guard heard Geo-Requested-By: owner; the reading credential does not hold shop-two");
    await w.relay.poll();
    assert.equal(w.whatsapp.sentTo(w.owner).filter((m) => /Approval needed/u.test(m.text)).length, 0, "the owner, who asked, is not asked");
    const [ravi, meena] = [w.whatsapp.sentTo(RAVI.whatsapp), w.whatsapp.sentTo(MEENA.whatsapp)];
    assert.deepEqual([ravi.length, meena.length], [1, 1]);
    assert.notEqual(codeIn(ravi[0].text), codeIn(meena[0].text));

    // Ravi approves: Guard records the vote and waits for one more; the runtime is not told, nothing is sent
    await w.writes(RAVI.whatsapp, `approve ${codeIn(ravi[0].text)}`);
    assert.equal(w.standins.fakes.payments.refunds().length, 0);
    assert.match(w.whatsapp.sentTo(RAVI.whatsapp).at(-1)!.text, /दूसरों से अभी इतनी मंज़ूरी और चाहिए: 1।/u);
    assert.deepEqual((await w.reviews())[0].may_still_decide, ["meena"]);

    // Meena approves with her own code and secret: approved, the runtime sends the identical call again, the refund is made once
    await w.writes(MEENA.whatsapp, `approve ${codeIn(meena[0].text)}`);
    const refunds = w.standins.fakes.payments.refunds();
    assert.equal(refunds.length, 1);
    assert.equal(refunds[0].amount, 20_000);
    const states = ((await (await w.admin("/admin/approvals")).json()) as { approvals: { state: string }[] }).approvals.map((a) => a.state);
    assert.deepEqual(states, ["consumed"], "one approval, of two people, used once");
    assert.match(w.kit.messaging.sentTo(CUSTOMER).at(-1)!.text, /refund/);
    assert.match(w.whatsapp.sentTo(RAVI.whatsapp).at(-1)!.text, /^धन्यवाद। /u);
    assert.ok(w.seen.length > 0 && w.seen.every((s) => s.headers["geo-requested-by"] === undefined), "Guard never forwarded Geo-Requested-By to Razorpay's side");
    for (let i = 0; i < 3; i++) { await w.relay.poll(); await w.runtime.tick(); }
    assert.equal(w.standins.fakes.payments.refunds().length, 1);
  } finally { await w.close(); }
});

test("the real Guard: one no refuses a refund that needs two, whoever approved first; nothing is sent and the others are told", { skip: skipWithoutBinary }, async () => {
  const w = await world();
  try {
    await w.bookAndPay();
    await w.kit.say(w.runtime, "cancel my booking"); // in time: ₹200 back, above ₹150, nobody named
    const item = (await w.reviews())[0];
    assert.deepEqual([item.approvals_needed, item.requested_by, item.may_still_decide], [2, [], ["meena", "owner", "ravi"]]);
    await w.relay.poll();
    await w.writes(w.owner, `approve ${codeIn(w.whatsapp.sentTo(w.owner)[0].text)}`);
    assert.match(w.whatsapp.sentTo(w.owner).at(-1)!.text, /Approvals still needed from the others: 1\./u);
    await w.writes(MEENA.whatsapp, `deny ${codeIn(w.whatsapp.sentTo(MEENA.whatsapp)[0].text)}`);
    assert.equal(w.standins.fakes.payments.refunds().length, 0);
    const states = ((await (await w.admin("/admin/approvals")).json()) as { approvals: { state: string }[] }).approvals.map((a) => a.state);
    assert.deepEqual(states, ["denied"]);
    assert.match(w.kit.messaging.sentTo(CUSTOMER).at(-1)!.text, /decided not to refund/);
    assert.match(w.whatsapp.sentTo(w.owner).at(-1)!.text, /was refused by one of the people who approve refunds/u);
    assert.match(w.whatsapp.sentTo(RAVI.whatsapp).at(-1)!.text, /मना कर दिया है/u);
    // Ravi's code is closed: his late answer reaches nobody
    await w.writes(RAVI.whatsapp, `approve ${codeIn(w.whatsapp.sentTo(RAVI.whatsapp)[0].text)}`);
    assert.equal(w.standins.fakes.payments.refunds().length, 0);
  } finally { await w.close(); }
});
