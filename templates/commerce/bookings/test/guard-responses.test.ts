// How the live adapters read Guard's answers (monorepo docs/guard-for-pathways.md). Every body below is a fixture copied from that doc.
// The point: a held call is HTTP 202, a 2xx, and must never be read as the service's success; and every decision Guard makes is
// told apart in ONE place (http.ts `classify`), before any adapter parses a body.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeClock } from "../../../../modules/core/clock.ts";
import { ApiError, GuardAlreadyDoneError, GuardConflictError, GuardError, GuardHeldError, GuardOutcomeUnknownError, GuardRefusedError, GuardSuspendedError, GuardUnauthenticatedError, GuardUnavailableError, NotSentError, TimeoutError, mayHaveHappened } from "../../../../modules/core/faults.ts";
import { ensureLink } from "../../../../modules/payments/links.ts";
import { classify, createHttp } from "../../../../modules/core/http.ts";
import { createLiveAdapters } from "../src/adapters/live/index.ts";
import { createRazorpayPayments } from "../../../../modules/payments/providers/razorpay/api.ts";
import { fixture, scripted } from "./helpers/scripted-server.ts";

interface Wire { status: number; headers: Record<string, string>; body: unknown }
const guardWire = (name: string): Wire => fixture("guard-responses.json")[name];
const headersOf = (w: Wire) => ({ get: (n: string) => w.headers[n.toLowerCase()] ?? null });
const CALL = { method: "POST", path: "/v1/payments/pay_Nx1/refund", body: '{"amount":60000,"receipt":"b-1:pay_Nx1"}' };
const read = (name: string) => { const w = guardWire(name); return classify(w.status, headersOf(w), w.body, CALL); };

// ---- the classification, from the doc's own bodies ------------------------------------------------------------------------------

test("held: HTTP 202 is a GuardHeldError with the approval id, the expiry and the exact bytes that were held", () => {
  const e = read("held");
  assert.ok(e instanceof GuardHeldError && e instanceof GuardError && e instanceof ApiError, "a held call is an error, not a reply");
  assert.equal(e.status, 202);
  assert.equal(e.approval, "ap-glow-salon-razorpay-458e6ca42acc3cfc99494f529cd77ae5-3");
  assert.equal(e.expiresAtMs, 1793712060824);
  assert.equal(e.call.body, CALL.body, "the bytes to send again, unchanged");
  assert.equal(e.guard.code, "held_for_approval");
  assert.equal(e.guard.retry, "after_approval");
  assert.match(e.message, /^held by the Guard: refund-needs-owner/);
});

test("held with no approval id: a person at the server resolves it; it cannot be approved on WhatsApp", () => {
  const e = read("held_uncertain");
  assert.ok(e instanceof GuardHeldError);
  assert.equal(e.approval, null, "the Guard-Held header is empty and detail.approval is null");
  assert.equal(e.expiresAtMs, null);
});

test("refused: a rule is told apart from a limit by the words of the reason, and an unlisted route has no rule", () => {
  for (const [name, kind, ruleId] of [["refused_rule", "rule", "deposit-amount"], ["refused_no_payouts", "rule", "no-payouts"], ["refused_limit", "limit", "refund-paise-per-day"], ["refused_unlisted", "rule", undefined]] as const) {
    const e = read(name);
    assert.ok(e instanceof GuardRefusedError, name);
    assert.equal(e.status, 403);
    assert.deepEqual([e.kind, e.ruleId], [kind, ruleId], name);
    assert.equal(e.guard.sent, "no");
  }
});

test("cannot decide, busy, the service unreachable: nothing was sent, try later (Retry-After is kept)", () => {
  for (const name of ["kill_switch", "busy", "provider_unreachable"]) {
    const e = read(name);
    assert.ok(e instanceof GuardUnavailableError, name);
    assert.equal(e.guard.sent, "no");
    assert.equal(e.guard.retry, "later");
    assert.ok(!mayHaveHappened(e), "nothing was sent, so this is not an uncertain call");
  }
  assert.equal((read("busy") as GuardUnavailableError).retryAfterSeconds, 1);
  assert.equal((read("kill_switch") as GuardUnavailableError).retryAfterSeconds, undefined);
});

test("outcome unknown: 504 with Guard-Outcome: unknown may have happened and is never repeated", () => {
  const e = read("outcome_unknown");
  assert.ok(e instanceof GuardOutcomeUnknownError);
  assert.equal(e.status, 504);
  assert.equal(e.guard.retry, "do_not_repeat");
  assert.equal(e.guard.sent, "unknown");
  assert.ok(mayHaveHappened(e));
  // the header alone is enough too, if the body's code were ever one this code does not know; without it that is only a GuardError
  const w = guardWire("outcome_unknown");
  const unknownCode = { guard: { decision: "deny", code: "something_new" } };
  assert.ok(classify(504, headersOf(w), unknownCode, CALL) instanceof GuardOutcomeUnknownError, "Guard-Outcome: unknown");
  const bare = classify(504, { get: () => null }, unknownCode, CALL);
  assert.ok(bare instanceof GuardError && !(bare instanceof GuardOutcomeUnknownError));
});

test("unauthenticated and conflict", () => {
  const u = read("unauthenticated");
  assert.ok(u instanceof GuardUnauthenticatedError && u.status === 401);
  const c = read("conflict");
  assert.ok(c instanceof GuardConflictError && c.status === 409 && c.guard.retry === "no");
  assert.ok(!(c instanceof GuardAlreadyDoneError), "the same action with other arguments is the plain conflict: nothing was done");
  assert.equal(c.guard.reason_code, undefined);
});

test("already_done: the identical call after a person settled it as happened is a 409 conflict that is DONE, with who settled it; never a replay", () => {
  const e = read("already_done");
  assert.ok(e instanceof GuardAlreadyDoneError, "told apart from the plain conflict by reason_code");
  assert.ok(e instanceof GuardConflictError, "and still a conflict, so code that does not know it never sends it again");
  assert.equal(e.status, 409);
  assert.equal(e.guard.code, "conflict");
  assert.equal(e.guard.reason_code, "already_done");
  assert.equal(e.confirmedBy, "operator:owner");
  assert.equal(e.intent, "intent:fa8690f73eaf");
  assert.equal(mayHaveHappened(e), false, "it is not 'may have happened': a person said it did");
  // a reason_code on any other code changes nothing
  const other = classify(409, { get: () => null }, { guard: { decision: "deny", code: "refused_by_policy", reason_code: "already_done" } }, CALL);
  assert.ok(other instanceof GuardRefusedError && !(other instanceof GuardAlreadyDoneError));
});

test("suspended: Guard's licence refusal (402) is its own error, the runtime's licence rule said by Guard: not a policy denial, nothing sent, never retried", () => {
  const e = read("suspended");
  assert.ok(e instanceof GuardSuspendedError && e instanceof GuardError && e instanceof ApiError);
  assert.ok(!(e instanceof GuardRefusedError) && !(e instanceof GuardUnavailableError), "not a rule's refusal, and not 'try later'");
  assert.equal(e.status, 402);
  assert.deepEqual([e.guard.code, e.guard.reason_code, e.guard.sent, e.guard.retry], ["subscription_suspended", "subscription_suspended", "no", "no"]);
  assert.deepEqual([e.state, e.operation], ["wind_down", "create_link"]);
  assert.equal(mayHaveHappened(e), false);
  // the reason_code alone is enough (a Guard that names the code differently still says what it is)
  assert.ok(classify(402, { get: () => null }, { guard: { decision: "deny", code: "refused", reason_code: "subscription_suspended" } }, CALL) instanceof GuardSuspendedError);
});

test("a payment link Guard refuses for the licence is asked for ONCE: no second try, and the caller is told it is the licence", async () => {
  const s = await serve("suspended");
  try {
    const payments = createRazorpayPayments({ baseUrl: s.url });
    const listed: unknown[] = [];
    const counting = { ...payments, listRequests: async (q: { reference_id?: string }) => { listed.push(q); return []; } };
    const r = await ensureLink(counting, { reference: "b-1", amountPaise: 20000, description: "deposit" });
    assert.equal(r.link, null);
    assert.ok(r.suspended instanceof GuardSuspendedError);
    assert.equal(s.requests.filter((q) => q.method === "POST").length, 1, "one create, never a second");
    assert.equal(listed.length, 1, "it looked first once, and did not look again after the refusal: nothing was sent");
  } finally { await s.close(); }
});

test("a decision this code does not know is still a GuardError: a 2xx with a guard object is never a success", () => {
  const e = classify(200, { get: () => null }, { guard: { decision: "allow", code: "from_the_future" } }, CALL);
  assert.ok(e instanceof GuardError);
  assert.equal(classify(200, { get: () => null }, { guard: "not an object" }, CALL), undefined, "a service's own key called guard is not Guard's");
  assert.equal(classify(200, { get: () => null }, { guard: { decision: 1, code: 2 } }, CALL), undefined);
});

test("a provider's own reply is not Guard's: a 5xx, a 4xx and a success pass through for the adapter to read", () => {
  const w = guardWire("provider_500");
  assert.equal(classify(w.status, headersOf(w), w.body, CALL), undefined);
  assert.equal(classify(200, { get: () => null }, { id: "rfd_1", entity: "refund" }, CALL), undefined);
  assert.equal(classify(400, { get: () => null }, { error: { code: "BAD_REQUEST_ERROR", description: "x" } }, CALL), undefined);
});

// ---- over HTTP: what each adapter does with them ------------------------------------------------------------------------------

/** A scripted answer with the status and body of a fixture (no headers: use `withHeaders` when the headers matter). */
const serve = (name: string) => scripted(() => ({ status: guardWire(name).status, json: guardWire(name).body }));

/** A server that answers with a fixture's status, headers and body. */
async function withHeaders(name: string) {
  const { createServer } = await import("node:http");
  const w = guardWire(name);
  const requests: { url: string; body: string }[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => { requests.push({ url: req.url ?? "", body: Buffer.concat(chunks).toString("utf8") }); res.writeHead(w.status, w.headers); res.end(JSON.stringify(w.body)); });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { url, requests, close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }) };
}

test("over HTTP, a held refund (202) is thrown by the Razorpay adapter, with the bytes it sent; the same bytes can be sent again", async () => {
  const guard = await withHeaders("held");
  try {
    const payments = createRazorpayPayments({ baseUrl: guard.url });
    await assert.rejects(() => payments.refund("pay_Nx1", { amount: 60000, receipt: "b-1:pay_Nx1" }), (e: any) => {
      assert.ok(e instanceof GuardHeldError, "202 is a 2xx, and it is still not a refund");
      assert.equal(e.call.body, '{"amount":60000,"receipt":"b-1:pay_Nx1"}');
      assert.equal(e.call.path, "/v1/payments/pay_Nx1/refund");
      return true;
    });
    const held = guard.requests[0].body;
    await assert.rejects(() => payments.resendRefund("pay_Nx1", held), GuardHeldError);
    assert.equal(guard.requests[1].body, held, "byte for byte");
    // and a body written differently is sent as written, not tidied: Guard binds an approval to the call, and 60000 is not "60000"
    const odd = '{ "receipt": "b-1:pay_Nx1",  "amount": "60000" }';
    await assert.rejects(() => payments.resendRefund("pay_Nx1", odd), GuardHeldError);
    assert.equal(guard.requests[2].body, odd);
  } finally { await guard.close(); }
});

test("over HTTP, a replay is the service's first reply, marked replayed", async () => {
  const guard = await withHeaders("replayed");
  try {
    const refund = await createRazorpayPayments({ baseUrl: guard.url }).refund("pay_Nx1", { amount: 60000, receipt: "b-1:pay_Nx1" });
    assert.equal(refund.id, "rfnd_Nx1");
    assert.equal(refund.replayed, true);
  } finally { await guard.close(); }
});

test("a refund the service itself answered is not marked replayed", async () => {
  const server = await serve("provider_500");
  const ok = await scripted(() => ({ status: 200, json: { id: "rfd_2", entity: "refund", amount: 100, payment_id: "pmt_1", status: "processed", created_at: 1 } }));
  try {
    const refund = await createRazorpayPayments({ baseUrl: ok.url }).refund("pmt_1", { amount: 100 });
    assert.equal(refund.replayed, undefined);
    await assert.rejects(() => createRazorpayPayments({ baseUrl: server.url }).refund("pmt_1", { amount: 100 }), (e: any) => e instanceof ApiError && !(e instanceof GuardError) && e.status === 500, "a provider 5xx stays a plain ApiError: it may have happened, and the agent knows that of a refund");
  } finally { await server.close(); await ok.close(); }
});

test("every adapter raises Guard's decisions: Razorpay, Google Calendar and WhatsApp", async () => {
  const held = await withHeaders("held");
  const refused = await withHeaders("refused_rule");
  const unknown = await withHeaders("outcome_unknown");
  const clock = fakeClock(Date.UTC(2026, 10, 3, 4, 30));
  try {
    const at = (server: { url: string }) => createLiveAdapters({ payments: { baseUrl: server.url }, calendar: { baseUrl: server.url, calendarId: "c" }, messaging: { baseUrl: server.url, phoneNumberId: "1" } }, { clock, window: { lastInboundAt: () => clock.now() } });
    // held (a 2xx): none of them may call it done
    const h = at(held);
    await assert.rejects(() => h.payments.createRequest({ amount: 20000, reference_id: "b-1", description: "x" }), GuardHeldError);
    await assert.rejects(() => h.payments.listRequests({ reference_id: "b-1" }), GuardHeldError);
    await assert.rejects(() => h.calendar.insert({ summary: "s", start: clock.now(), end: clock.now() + 3600_000, status: "tentative", bookingRef: "b-1" }), GuardHeldError);
    await assert.rejects(() => h.calendar.list({ bookingRef: "b-1" }), GuardHeldError);
    await assert.rejects(() => h.messaging.sendText("+919800000001", "hi"), GuardHeldError);
    // refused
    const r = at(refused);
    await assert.rejects(() => r.payments.fetchPayment("pmt_1"), GuardRefusedError);
    await assert.rejects(() => r.calendar.delete("evt_1"), GuardRefusedError);
    await assert.rejects(() => r.messaging.sendTemplate("+919800000001", { name: "booking_update", language: "en", text: "x" }), GuardRefusedError);
    // outcome unknown
    const u = at(unknown);
    await assert.rejects(() => u.messaging.sendText("+919800000001", "hi"), (e: any) => e instanceof GuardOutcomeUnknownError && mayHaveHappened(e));
    await assert.rejects(() => u.calendar.insert({ summary: "s", start: clock.now(), end: clock.now() + 3600_000, status: "tentative", bookingRef: "b-1" }), GuardOutcomeUnknownError);
  } finally { await Promise.all([held.close(), refused.close(), unknown.close()]); }
});

test("a payment record that Guard will not show is raised, not quietly read as 'no refunds yet'", async () => {
  const { createServer } = await import("node:http");
  const refusedWire = guardWire("refused_rule");
  const link = { id: "req_1", reference_id: "b-1", amount: 20000, currency: "INR", description: "d", status: "paid", pay_url: "https://rzp.io/l/x", amount_paid: 20000, created_at: 1, payments: [{ payment_id: "pmt_1", amount: 20000, status: "captured", created_at: 1 }] };
  const server = createServer((req, res) => {
    if ((req.url ?? "").startsWith("/v1/payments/")) { res.writeHead(refusedWire.status, refusedWire.headers); res.end(JSON.stringify(refusedWire.body)); return; }
    res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(link));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const payments = createRazorpayPayments({ baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}` });
    await assert.rejects(() => payments.fetchRequest("req_1"), GuardRefusedError);
  } finally { server.closeAllConnections(); server.close(); }
});

test("no Guard answer at all: refused is 'nothing was sent', a timeout is 'it may have happened'", async () => {
  const slow = await scripted(() => ({ json: {}, delayMs: 300 }));
  const down = await scripted(() => ({ json: {} }));
  const refusedUrl = down.url;
  await down.close();
  try {
    await assert.rejects(() => createHttp(refusedUrl, "Razorpay", 200).request("GET", "/v1/x"), (e: any) => e instanceof NotSentError && e instanceof ApiError && e.status === 503 && !(e instanceof TimeoutError) && !mayHaveHappened(e));
    await assert.rejects(() => createHttp(slow.url, "Razorpay", 100).request("GET", "/v1/x"), (e: any) => e instanceof TimeoutError && mayHaveHappened(e));
  } finally { await slow.close(); }
});

test("the agent credential is sent to Guard only when one is given, and it is never a service key", async () => {
  const server = await scripted(() => ({ json: { payment_links: [] } }));
  try {
    await createRazorpayPayments({ baseUrl: server.url }).listRequests();
    await createRazorpayPayments({ baseUrl: server.url, agentToken: "gg_agent_token" }).listRequests();
    assert.equal(server.requests[0].headers.authorization, undefined);
    assert.equal(server.requests[1].headers.authorization, "Bearer gg_agent_token");
  } finally { await server.close(); }
});
