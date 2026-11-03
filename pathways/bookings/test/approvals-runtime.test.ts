// The runtime's side of the owner's approvals: the approval_decision event and its checks, the read-only refund-context endpoint the relay
// cross-checks against Guard, and the counts in /status (a refund that needs the builder is counted and logged, never sent to the owner).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createFakePayments } from "../src/adapters/payments.ts";
import { createGuardModel } from "../src/adapters/guard-model.ts";
import { CUSTOMER, glowSalon, HARNESS_GUARD } from "../src/harness.ts";
import { razorpayLimitsSpec } from "../src/guard-limits.ts";
import { parseSettings } from "../src/settings.ts";
import { checkEvents, eventKey } from "../server/events.ts";
import { startServer } from "../server/server.ts";
import { createKit } from "./runtime-kit.ts";

const TOKEN = "test-token-0123456789abcdef";
const auth = { authorization: `Bearer ${TOKEN}` };
const settings = parseSettings({ ...JSON.parse(JSON.stringify(glowSalon())), cancellation: { windowHours: 24, refundLimitInr: 100 } });

async function boot() {
  const kit = createKit();
  const guard = createGuardModel(razorpayLimitsSpec(settings, HARNESS_GUARD), kit.clock);
  const payments = createFakePayments(kit.clock, { guard });
  const lines: string[] = [];
  const { runtime } = kit.open({ settings, services: { calendar: kit.calendar, payments, messaging: kit.messaging }, log: (l) => lines.push(l) });
  const server = await startServer(runtime, { token: TOKEN, port: 0 });
  const get = (path: string, headers: Record<string, string> = auth) => fetch(`${server.url}${path}`, { headers });
  const post = (body: unknown) => fetch(`${server.url}/internal/events`, { method: "POST", headers: { "content-type": "application/json", ...auth }, body: JSON.stringify(body) });
  async function paidAndCancelled() {
    await kit.say(runtime, "haircut day after tomorrow at 6pm");
    payments.customerPays(payments.links()[0].id);
    const fresh = payments.events.slice(0);
    runtime.submit(fresh.map((event) => ({ kind: "payment_event" as const, event })));
    runtime.kick(); await runtime.idle();
    await kit.say(runtime, "cancel my booking");
  }
  return { kit, runtime, guard, payments, lines, server, get, post, paidAndCancelled, close: async () => { await server.close(); await runtime.close(); kit.cleanup(); } };
}

test("an approval_decision is a checked event of its own, saved like the others, once per answer", () => {
  const ok = checkEvents({ events: [{ kind: "approval_decision", approval: "ap-glow-salon-razorpay-458e6ca42acc3cfc99494f529cd77ae5-3", decision: "approve" }] });
  assert.ok(ok.ok);
  assert.deepEqual(ok.ok && ok.events, [{ kind: "approval_decision", approval: "ap-glow-salon-razorpay-458e6ca42acc3cfc99494f529cd77ae5-3", decision: "approve" }]);
  assert.equal(eventKey({ kind: "approval_decision", approval: "ap-1", decision: "approve" }), "approval_decision:ap-1:approve");
  assert.notEqual(eventKey({ kind: "approval_decision", approval: "ap-1", decision: "approve" }), eventKey({ kind: "approval_decision", approval: "ap-1", decision: "deny" }));
  for (const bad of [
    { kind: "approval_decision", approval: "ap-1", decision: "maybe" },
    { kind: "approval_decision", approval: "", decision: "approve" },
    { kind: "approval_decision", approval: "../etc/passwd", decision: "approve" },
    { kind: "approval_decision", approval: "ap 1", decision: "approve" },
    { kind: "approval_decision", approval: "x".repeat(201), decision: "approve" },
    { kind: "approval_decision", approval: 7, decision: "deny" },
    { kind: "approval_decision", decision: "deny" },
    { kind: "tick" },
  ]) assert.equal(checkEvents({ events: [bad] }).ok, false, JSON.stringify(bad));
});

test("the refund-context endpoint needs the token, answers only for a refund that is held, and says what the relay may know", async () => {
  const t = await boot();
  try {
    await t.paidAndCancelled();
    const held = t.guard.reviews("runtime-glow-salon", true)[0];
    const receipt = (held.arguments[1].receipt as [string, string])[1];
    assert.equal((await fetch(`${t.server.url}/internal/refund-context?receipt=${encodeURIComponent(receipt)}`)).status, 401, "no token");
    assert.equal((await t.get(`/internal/refund-context?receipt=${encodeURIComponent(receipt)}`, { authorization: "Bearer nope" })).status, 401);
    assert.equal((await t.get("/internal/refund-context")).status, 400);
    assert.equal((await t.get("/internal/refund-context?receipt=b-9:pay_x")).status, 404);
    assert.equal((await t.get("/internal/refund-context?receipt=not-a-receipt")).status, 404);
    const reply = await t.get(`/internal/refund-context?receipt=${encodeURIComponent(receipt)}`);
    assert.equal(reply.status, 200);
    const context = await reply.json() as any;
    assert.deepEqual(context, {
      booking: "b-1", customerPhone: CUSTOMER, businessName: "Glow Salon", timeZone: "Asia/Kolkata", ownerLanguage: "en", serviceName: "haircut",
      slotMs: context.slotMs, paymentId: held.arguments[1].payment_id[1], amountPaise: 20000, approval: held.id, expiresAtMs: Number(held.expires_at_ms),
    });
    assert.equal(context.approval, held.id, "the runtime holds the same approval Guard does");
    assert.equal((await fetch(`${t.server.url}/internal/refund-context?receipt=x`, { method: "POST", headers: auth })).status, 405, "read-only");
    // once it is answered and sent, nothing is held under that receipt any more
    t.guard.decide(held.id, true, "owner");
    t.runtime.submit([{ kind: "approval_decision", approval: held.id, decision: "approve" }]);
    t.runtime.kick(); await t.runtime.idle();
    assert.equal((await t.get(`/internal/refund-context?receipt=${encodeURIComponent(receipt)}`)).status, 404);
    assert.equal(t.payments.refunds().length, 1);
  } finally { await t.close(); }
});

test("an approval_decision over HTTP is saved, handled once, and a repeat of it is a no-op", async () => {
  const t = await boot();
  try {
    await t.paidAndCancelled();
    const id = t.guard.reviews("runtime-glow-salon", true)[0].id;
    t.guard.decide(id, true, "owner");
    const body = { events: [{ kind: "approval_decision", approval: id, decision: "approve" }] };
    assert.deepEqual(await (await t.post(body)).json(), { saved: 1, duplicates: 0 });
    await t.runtime.idle();
    assert.equal(t.payments.refunds().length, 1);
    assert.deepEqual(await (await t.post(body)).json(), { saved: 0, duplicates: 1 });
    await t.runtime.idle();
    assert.equal(t.payments.refunds().length, 1);
    assert.equal((await t.post({ events: [{ kind: "approval_decision", approval: id, decision: "perhaps" }] })).status, 400);
  } finally { await t.close(); }
});

test("status counts refunds waiting for the owner, as numbers only", async () => {
  const t = await boot();
  try {
    await t.paidAndCancelled();
    const status = await (await t.get("/status")).json() as any;
    assert.deepEqual(status.refunds, { waitingForOwner: 1, beingSentAgain: 0, needBuilder: { total: 0 } });
    const text = JSON.stringify(status);
    for (const secret of ["haircut", CUSTOMER.slice(3), "plink", "pay_", "ap-stub"]) assert.ok(!text.includes(secret), `status leaked ${secret}`);
    assert.equal(t.lines.filter((l) => /needs the builder/.test(l)).length, 0, "no line: nothing needed the builder");
  } finally { await t.close(); }
});

test("a refund that needs the builder is counted by why, logged in a plain line, and the owner hears nothing", async () => {
  const kit = createKit();
  const lines: string[] = [];
  const guard = createGuardModel(razorpayLimitsSpec(glowSalon(), HARNESS_GUARD), kit.clock);
  const payments = createFakePayments(kit.clock, { guard });
  const { runtime } = kit.open({ services: { calendar: kit.calendar, payments, messaging: kit.messaging }, log: (l) => lines.push(l) });
  try {
    await kit.say(runtime, "haircut day after tomorrow at 6pm");
    payments.customerPays(payments.links()[0].id);
    runtime.submit(payments.events.map((event) => ({ kind: "payment_event" as const, event })));
    runtime.kick(); await runtime.idle();
    payments.inject("refund", "uncertainHold");
    await kit.say(runtime, "cancel my booking");
    assert.deepEqual(runtime.status().refunds, { waitingForOwner: 0, beingSentAgain: 0, needBuilder: { uncertain: 1, total: 1 } });
    assert.equal(lines.filter((l) => /A refund needs the builder, not the owner \(1 uncertain\)/.test(l)).length, 1, lines.join("\n"));
    assert.deepEqual(kit.messaging.sentTo(glowSalon().owner.whatsapp).map((m) => m.text), [], "never the owner");
  } finally { await runtime.close(); kit.cleanup(); }
});
