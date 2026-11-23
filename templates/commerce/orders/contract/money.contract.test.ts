// MONEY, as the outside sees it (group (i) of the contract, README.md): what an Orders shop on a gateway (Razorpay, through its payments Guard) asks for and what it does with the
// provider's word. A "guards" shop (runtime.json live, the real clock) against the fake Guards of guards.ts that record every request: the advance link for exactly the advance,
// the webhook that is only a reason to look, the same webhook again, a forged one, a second payment on a paid link, a cancellation refunded through Guard, a refund above the
// owner's limit held for the owner and answered through the approvals relay, a late cancellation the owner decides, and the balance paid at pickup by a link of its own.
// The orders are for two days ahead (the real clock: no cut-off or "days ahead" rule depends on when this runs). Expected values from test/agent, runtime, reminder-balance,
// money-clarity, guard-outage and the situations. The bodies are the WIRE a Go runtime must put out.
import { after, describe } from "node:test";
import assert from "node:assert/strict";
import { CUSTOMER, OWNER_NUMBER, contract, dayAhead, makeShop } from "./harness.ts";
import { createRuntimeClient } from "../../../../modules/approvals/clients.ts";
import type { Shop } from "./harness.ts";

const shops: Shop[] = [];
after(async () => { for (const s of shops) { await s.stop(); await s.cleanup(); } });
async function boot(o: Parameters<typeof makeShop>[0] = {}): Promise<Shop> { const s = await makeShop({ mode: "guards", ...o }); shops.push(s); await s.start(); return s; }

async function deliver(s: Shop, events: unknown[]): Promise<void> {
  const answer = await s.events(events.map((event) => ({ kind: "payment_event", event })));
  assert.equal(answer.status, 200, JSON.stringify(answer.body));
  await s.settle();
}
const link = (s: Shop, n = 0) => s.guards!.standins.fakes.payments.links()[n];
/** An order from the page, paid in full by the customer: the view and the payment id. */
async function paid(s: Shop, o: Parameters<Shop["order"]>[0] = {}): Promise<{ hash: string; paymentId: string }> {
  const { hash } = await s.order(o);
  await deliver(s, s.guards!.pay(link(s).id));
  assert.equal((await s.request(hash)).body.status, "confirmed");
  return { hash, paymentId: link(s).payments[0].id };
}

describe("the advance", () => {
  contract("the link is for exactly the advance, with the order's id as its reference and the agent's own credential; the page shows the link and nothing goes to WhatsApp", async () => {
    const s = await boot();
    const { hash } = await s.order();
    const links = s.guards!.of("payments", "POST", /^\/v1\/payment_links$/u);
    assert.equal(links.length, 1);
    assert.deepEqual(links[0].body, { amount: 12000, currency: "INR", reference_id: "o-1", description: "Annapurna Tiffins advance", accept_partial: false, notify: { sms: false, email: false }, reminder_enable: false }, "half of ₹240 in paise, never the total");
    assert.equal(links[0].headers.authorization, `Bearer ${s.guards!.agentToken}`);
    const view = (await s.request(hash)).body;
    assert.deepEqual([view.status, view.totalInr, view.advanceInr], ["held", 240, 120]);
    assert.deepEqual(view.pay, { kind: "link", url: link(s).pay_url });
    assert.equal(view.canSayPaid, false, "a gateway shop's page has no 'I have paid'");
    assert.deepEqual(s.guards!.of("messaging"), [], "a customer of the page is never written to on WhatsApp");
    assert.deepEqual((await s.ownerView()).body.items, [], "a gateway confirms by itself: nothing for the owner to mark");
  });

  contract("the webhook is a reason to look: the shop reads the link at the provider, confirms the order once, and a repeat of the webhook changes nothing", async () => {
    const s = await boot();
    const { hash } = await s.order();
    const before = s.guards!.calls.length;
    const events = s.guards!.pay(link(s).id);
    await deliver(s, events);
    const after = s.guards!.calls.slice(before);
    assert.ok(after.some((c) => c.method === "GET" && c.path === `/v1/payment_links/${link(s).id}`), "the link is read at the provider");
    assert.equal((await s.request(hash)).body.status, "confirmed");
    assert.deepEqual((await s.status()).orders, { confirmed: 1 });
    assert.deepEqual(s.record().filter((r) => r.action === "record_payment").map((r) => r.outcome), ["confirmed"]);
    const settled = s.guards!.calls.length;
    const again = await s.events(events.map((event) => ({ kind: "payment_event", event })));
    assert.deepEqual([again.body.saved, again.body.duplicates], [0, events.length]);
    await s.settle();
    assert.equal(s.guards!.calls.length, settled, "nothing reached any Guard");
  });

  contract("a webhook for a link that is not ours moves nothing and is recorded as blocked", async () => {
    const s = await boot();
    const { hash } = await s.order();
    const calls = s.guards!.calls.length;
    await deliver(s, [{ id: "evt_forged", event: "request.paid", created_at: 1, payload: { request: { id: "req_nope", reference_id: "o-1" }, payment: { id: "pmt_nope", request_id: "req_nope" } } }]);
    assert.equal((await s.request(hash)).body.status, "held");
    assert.equal(s.guards!.calls.slice(calls).filter((c) => c.method !== "GET").length, 0);
    assert.ok(s.record().some((r) => r.action === "receive_payment_event" && r.outcome === "blocked"));
  });

  contract("a second payment on a paid link is refunded in full, once, with the order and the payment in the receipt", async () => {
    const s = await boot();
    await s.order();
    const first = s.guards!.pay(link(s).id);
    const second = s.guards!.pay(link(s).id);
    await deliver(s, first);
    await deliver(s, second);
    const refunds = s.guards!.of("payments", "POST", /\/refund$/u);
    assert.equal(refunds.length, 1);
    const secondPayment = link(s).payments[1].id;
    assert.equal(refunds[0].path, `/v1/payments/${secondPayment}/refund`);
    assert.deepEqual(refunds[0].body, { amount: 12000, receipt: `o-1:${secondPayment}` });
    assert.deepEqual((await s.status()).orders, { confirmed: 1 });
  });

  contract("on WhatsApp: the quote names the items, the day and the total with the link; the customer's 'I have paid' only makes the shop look; the payment confirms and the owner hears what to prepare", async () => {
    const s = await boot();
    const day = s.orderDay();
    await s.inbound(CUSTOMER, `2 veg thali ${day.words} 12:00 pm pickup`);
    const quote = s.sent(CUSTOMER).at(-1)!;
    assert.match(quote.text, /2 × veg thali for .*12:00 pm to 1:00 pm, pickup\. Total ₹240\. To confirm, pay ₹120 here: /u);
    assert.ok(quote.text.includes(link(s).pay_url), "the link is in the message");
    assert.deepEqual(quote.interactive.buttons.map((b: { id: string }) => b.id), ["cancel", "owner"]);
    const reads = s.guards!.of("payments", "GET").length;
    await s.inbound(CUSTOMER, "I have paid");
    assert.ok(s.guards!.of("payments", "GET").length > reads, "the shop looked at the payment record");
    assert.deepEqual((await s.status()).orders, { awaiting_advance: 1 }, "a word is not a payment");
    await deliver(s, s.guards!.pay(link(s).id));
    assert.match(s.sent(CUSTOMER).at(-1)!.text, /^Confirmed! 2 × veg thali .*₹120 is to pay on pickup/u);
    assert.match(s.sent(OWNER_NUMBER).at(-1)!.text, /New order o-1 from \+919844444444/u);
  });

  contract("a bakery that takes the whole order up front asks for all of it: the link is the total", async () => {
    const s = await boot({ example: "bakery" });
    // three days ahead: the bakery's cut-off is 18:00 two days before (sweet-crumbs.example.json), so the harness's usual day (two ahead) has closed after 18:00
    const day = dayAhead(s.now(), 3);
    await s.inbound(CUSTOMER, `2 plum cake ${day.words} 10:00 am`);
    const links = s.guards!.of("payments", "POST", /^\/v1\/payment_links$/u);
    assert.equal(links.length, 1, JSON.stringify(s.sent(CUSTOMER).map((m) => m.text)));
    assert.equal(links[0].body.amount, 90000);
    await deliver(s, s.guards!.pay(link(s).id));
    assert.match(s.sent(CUSTOMER).at(-1)!.text, /Paid in full/u);
  });
});

describe("refunds", () => {
  contract("a confirmed order cancelled inside the window is refunded through Guard, exactly the advance, once; the owner is told not to prepare it", async () => {
    const s = await boot();
    const { hash, paymentId } = await paid(s);
    await s.channelEvents([{ kind: "channel_request", id: "cancel-1", channel: "web", op: "cancel", handle: hash }]); await s.settle();
    const refunds = s.guards!.of("payments", "POST", /\/refund$/u);
    assert.equal(refunds.length, 1);
    assert.equal(refunds[0].path, `/v1/payments/${paymentId}/refund`);
    assert.deepEqual(refunds[0].body, { amount: 12000, receipt: `o-1:${paymentId}` });
    assert.equal(refunds[0].headers["geo-requested-by"], undefined, "the customer asked, not the owner");
    const view = (await s.request(hash)).body;
    assert.equal(view.status, "cancelled");
    assert.match(view.messages.at(-1).text, /cancelled\. Your ₹120 advance is being refunded/u);
    assert.equal(s.guards!.standins.fakes.payments.refunds().length, 1);
  });

  contract("a refund above the owner's limit is held by Guard; the relay can read what it is; the owner's yes at Guard releases exactly the held call, and a stranger's 'approve' sends nothing", async () => {
    const s = await boot({ settings: { refund: { limitInr: 100 } } });
    const { hash, paymentId } = await paid(s);
    await s.channelEvents([{ kind: "channel_request", id: "cancel-1", channel: "web", op: "cancel", handle: hash }]); await s.settle();
    assert.equal(s.guards!.standins.fakes.payments.refunds().length, 0, "₹120 above a ₹100 limit: held, not sent");
    assert.match((await s.request(hash)).body.messages.at(-1).text, /owner will confirm your ₹120 refund/u);
    const st = (await s.status()).refunds;
    assert.equal(st.waitingForOwner, 1);
    const [review] = s.guards!.stub.model.reviews("x", true);
    const ctx = await s.call(`/internal/refund-context?receipt=${encodeURIComponent(`o-1:${paymentId}`)}`);
    assert.equal(ctx.status, 200);
    assert.deepEqual([ctx.body.booking, ctx.body.customerPhone, ctx.body.businessName, ctx.body.timeZone, ctx.body.ownerLanguage, ctx.body.paymentId, ctx.body.amountPaise, ctx.body.approval], ["o-1", "+919811111111", "Annapurna Tiffins", "Asia/Kolkata", "en", paymentId, 12000, review.id]);
    assert.equal((await s.call("/internal/refund-context?receipt=o-9:pay_x")).status, 404);
    // the relay's own client (modules/approvals/clients.ts, what bundle/services/relay.ts runs) reads the same context, and its shape check passes on the shop's answer
    const client = createRuntimeClient({ url: `http://127.0.0.1:${s.port}`, token: s.internal });
    assert.deepEqual(await client.context(`o-1:${paymentId}`), { kind: "found", context: ctx.body });
    assert.deepEqual(await client.context("o-9:pay_x"), { kind: "missing" });
    assert.equal((await s.call("/internal/refund-context")).status, 400);
    await s.events([{ kind: "approval_decision", approval: review.id, decision: "approve" }]); await s.settle();
    assert.equal(s.guards!.standins.fakes.payments.refunds().length, 0, "Guard has no yes on record: nothing goes");
    assert.equal(s.guards!.stub.model.decide(review.id, true, "owner-contract").status, 200);
    assert.equal(await client.decided(review.id, "approve", "d-relay"), true, "the shop took the decision from the relay's own client"); await s.settle();
    assert.deepEqual(s.guards!.standins.fakes.payments.refunds().map((r) => [r.payment_id, r.amount]), [[paymentId, 12000]]);
    assert.equal((await s.status()).refunds.waitingForOwner, 0);
  });

  contract("a late cancellation (inside the hours before the slot) is the owner's call: the owner's page shows it, and the owner's approve sends the refund", async () => {
    const s = await boot({ settings: { cancellation: { windowHours: 96 } } });
    const { hash, paymentId } = await paid(s);
    await s.channelEvents([{ kind: "channel_request", id: "cancel-1", channel: "web", op: "cancel", handle: hash }]); await s.settle();
    assert.equal(s.guards!.of("payments", "POST", /\/refund$/u).length, 0, "nothing is refunded before the owner decides");
    assert.match((await s.request(hash)).body.messages.at(-1).text, /the owner will decide about your ₹120 advance/u);
    const [item] = (await s.ownerView()).body.items;
    assert.deepEqual([item.kind, item.amountPaise, item.actions], ["late_refund", 12000, ["approve", "deny"]]);
    await s.ownerPress("late_refund", "approve");
    assert.deepEqual(s.guards!.of("payments", "POST", /\/refund$/u).map((c) => c.body), [{ amount: 12000, receipt: `o-1:${paymentId}` }]);
    assert.match((await s.request(hash)).body.messages.at(-1).text, /approved your refund/u);
    assert.ok(s.record().some((r) => r.action === "owner_decision" && r.outcome === "confirmed" && r.refs.command === "approve"));
  });

  contract("the owner's deny on a late cancellation keeps the advance, and the customer is told", async () => {
    const s = await boot({ settings: { cancellation: { windowHours: 96 } } });
    const { hash } = await paid(s);
    await s.channelEvents([{ kind: "channel_request", id: "cancel-1", channel: "web", op: "cancel", handle: hash }]); await s.settle();
    await s.inbound(OWNER_NUMBER, "deny o-1");
    assert.equal(s.guards!.of("payments", "POST", /\/refund$/u).length, 0);
    assert.match((await s.request(hash)).body.messages.at(-1).text, /decided not to refund/u);
    await s.inbound(OWNER_NUMBER, "approve o-1");
    assert.equal(s.guards!.of("payments", "POST", /\/refund$/u).length, 0, "nothing waits any more");
    assert.match(s.sent(OWNER_NUMBER).at(-1)!.text, /didn't understand/u);
  });
});

describe("the balance at pickup", () => {
  contract("the owner asks for a link for the balance; the payments service's own list shows it paid; it is recorded on its own line as the provider's, and nothing is refunded", async () => {
    const s = await boot();
    const { hash } = await paid(s);
    await s.inbound(OWNER_NUMBER, "balance o-1 link");
    const links = s.guards!.of("payments", "POST", /^\/v1\/payment_links$/u);
    assert.equal(links.length, 2);
    assert.deepEqual([links[1].body.amount, links[1].body.reference_id, links[1].body.description], [12000, "o-1.b", "Annapurna Tiffins balance"]);
    assert.match((await s.request(hash)).body.messages.at(-1).text, /The balance for your order .* is ₹120\. You can pay it here: /u);
    await deliver(s, s.guards!.pay(link(s, 1).id));
    const line = s.record().find((r) => r.action === "record_balance" && r.outcome === "confirmed");
    assert.ok(line);
    assert.deepEqual([line.refs.by, line.refs.balancePaise], ["provider", "12000"]);
    assert.equal(s.guards!.of("payments", "POST", /\/refund$/u).length, 0);
    assert.match((await s.request(hash)).body.messages.at(-1).text, /balance of ₹120 .* is received/u);
    await s.inbound(OWNER_NUMBER, "balance o-1 cash");
    assert.match(s.sent(OWNER_NUMBER).at(-1)!.text, /no balance to mark/u, "once only");
  });
});
