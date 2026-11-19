// MONEY, as the outside sees it: what a Bookings shop asks its payments Guard for, and what it does with the provider's word. Group (i) of the contract (README.md).
// A "guards" shop (runtime.json live, the real clock) against the fake Guards (guards.ts) that record every request: a booking with a deposit (the hold, the link for
// exactly the deposit), the webhook that marks it paid (read as the inbox reads it, then checked at the provider), the same webhook again, a forged or unknown one, a
// second payment on a paid link, a cancellation that is refunded within the limit, the provider's own refund word, the amount the model or a page can never change, and a UPI
// shop where the owner marks the money. Expected values come from the TypeScript unit tests (test/live-adapters, payment-events, refund-held, money-clarity, channels, upi).
// Which service is called with what is the WIRE a Go runtime must put out: the bodies below are the ones the live adapters send today.
import { after, describe } from "node:test";
import assert from "node:assert/strict";
import { CUSTOMER, MIN, contract, makeShop, openStart } from "./harness.ts";
import type { Shop } from "./harness.ts";
import { fixture } from "./guards.ts";
import { parseRazorpayEvent } from "../../../../modules/payments/providers/razorpay/webhook.ts";
import { handleHash, newHandle } from "../../../../modules/channels/handle.ts";

const shops: Shop[] = [];
after(async () => { for (const s of shops) { await s.stop(); await s.cleanup(); } });
async function boot(o: Parameters<typeof makeShop>[0] = {}): Promise<Shop> { const s = await makeShop({ mode: "guards", ...o }); shops.push(s); await s.start(); return s; }

/** The payment events the provider made since the last call, handed to the shop as the inbox hands them. */
async function deliver(s: Shop, events: unknown[]): Promise<void> {
  const answer = await s.events(events.map((event) => ({ kind: "payment_event", event })));
  assert.equal(answer.status, 200, JSON.stringify(answer.body));
  await s.settle();
}
const writes = (s: Shop) => s.guards!.calls.filter((c) => c.method !== "GET");
const link = (s: Shop, n = 0) => s.guards!.standins.fakes.payments.links()[n];

describe("a booking with a deposit", () => {
  contract("the hold is a tentative calendar event, the link is for exactly the settings' deposit, and the page shows how to pay", async () => {
    const s = await boot();
    const startMs = openStart(s.now());
    const { hash } = await s.book({ startMs });
    const events = s.guards!.of("calendar", "POST", /\/events$/u);
    assert.equal(events.length, 1, "one hold");
    assert.deepEqual(events[0].query, { sendUpdates: "none" });
    const hold = events[0].body;
    assert.equal(hold.status, "tentative");
    assert.equal(hold.start.dateTime, new Date(startMs).toISOString());
    assert.equal(hold.end.dateTime, new Date(startMs + 45 * MIN).toISOString(), "the haircut takes 45 minutes");
    assert.equal(hold.extendedProperties.private.bookingRef, "b-1");
    assert.ok(Number(hold.extendedProperties.private.holdExpiresAt) > s.now() + 14 * MIN && Number(hold.extendedProperties.private.holdExpiresAt) < s.now() + 16 * MIN, "held for the settings' 15 minutes");
    assert.match(hold.summary, /haircut/u);

    const links = s.guards!.of("payments", "POST", /^\/v1\/payment_links$/u);
    assert.equal(links.length, 1, "one link");
    assert.deepEqual(links[0].body, { amount: 20000, currency: "INR", reference_id: "b-1", description: "Glow Salon deposit", accept_partial: false, notify: { sms: false, email: false }, reminder_enable: false }, "₹200 in paise, the booking id as the reference, never the ₹450 price");
    assert.equal(links[0].headers.authorization, `Bearer ${s.guards!.agentToken}`, "the agent's own credential for this Guard");
    for (const c of s.guards!.calls.filter((x) => x.service !== "payments")) assert.equal(c.headers.authorization, undefined, `no credential goes to the ${c.service} service`);
    // the Guard answered what the provider's own sample says it answers (the fixture's keys are all there)
    const sample = fixture("razorpay-payment-link-create.json");
    const made = JSON.parse(s.guards!.of("payments", "POST")[0].reply);
    for (const key of ["id", "amount", "currency", "reference_id", "status"]) assert.ok(key in sample && key in made, key);

    const view = (await s.request(hash)).body;
    assert.equal(view.status, "held");
    assert.equal(view.ref, "b-1");
    assert.equal(view.depositInr, 200);
    assert.deepEqual(view.pay, { kind: "link", url: link(s).pay_url });
    assert.equal(view.startMs, startMs);
    assert.ok(view.holdExpiresAt > s.now() && view.holdExpiresAt < s.now() + 16 * MIN);
    assert.deepEqual(s.guards!.of("messaging"), [], "a customer of the page is never written to on WhatsApp");
  });

  contract("the webhook that marks it paid: the shop checks the payment at the provider, confirms the calendar event, and a repeat of the webhook changes nothing", async () => {
    const s = await boot();
    const { hash } = await s.book();
    const before = s.guards!.calls.length;
    const events = s.guards!.pay(link(s).id);
    assert.deepEqual(events.map((e) => e.event), ["payment.received", "request.paid"], "what the provider sends, as the inbox reads it");
    await deliver(s, events);
    const after = s.guards!.calls.slice(before);
    assert.ok(after.some((c) => c.service === "payments" && c.method === "GET" && /^\/v1\/payments\/pmt_\d+$/u.test(c.path)), "the payment is looked at, not believed from the webhook alone");
    const confirm = after.filter((c) => c.service === "calendar" && c.method === "PATCH");
    assert.equal(confirm.length, 1, "one confirmation");
    assert.equal(confirm[0].body.status, "confirmed");
    assert.equal(confirm[0].body.extendedProperties.private.holdExpiresAt, null, "the hold's expiry is taken off");
    assert.equal((await s.request(hash)).body.status, "booked");
    assert.deepEqual((await s.status()).bookings, { confirmed: 1 });
    assert.deepEqual(s.record().filter((r) => r.action === "record_deposit").map((r) => r.outcome), ["confirmed"]);
    // the provider sends the same two events again
    const settled = s.guards!.calls.length;
    const again = await s.events(events.map((event) => ({ kind: "payment_event", event })));
    assert.deepEqual([again.body.saved, again.body.duplicates], [0, 2], "an event id seen before is a no-op");
    await s.settle();
    assert.equal(s.guards!.calls.length, settled, "nothing reached any Guard");
    assert.deepEqual(writes(s).filter((c) => c.method === "POST" && c.path === "/v1/payment_links").length, 1);
  });

  contract("a webhook for a link that is not ours is recorded as blocked and moves nothing; a payment on no link of ours is not matched to a booking", async () => {
    const s = await boot();
    const { hash } = await s.book();
    const calls = s.guards!.calls.length;
    await deliver(s, [
      { id: "evt_forged", event: "request.paid", created_at: 1, payload: { request: { id: "req_nope", reference_id: "b-1" }, payment: { id: "pmt_nope", request_id: "req_nope" } } },
      { id: "evt_other", event: "payment.received", created_at: 1, payload: { payment: { id: "pay_other_business" } } },
    ]);
    assert.equal((await s.request(hash)).body.status, "held", "still waiting for its own deposit");
    assert.equal(s.guards!.calls.slice(calls).filter((c) => c.method !== "GET").length, 0, "nothing was written to a Guard");
    assert.ok(s.record().filter((r) => r.action === "receive_payment_event").some((r) => r.outcome === "blocked"));
    assert.equal(s.guards!.standins.fakes.payments.refunds().length, 0, "nobody is refunded money this shop never took");
    // the same webhook as the provider documents it (its own sample), read as the inbox reads it, names a link this shop never made: it too is blocked
    const sample = parseRazorpayEvent(fixture("razorpay-webhook-payment_link.paid.json"), "evt_sample");
    assert.equal(sample?.event, "request.paid");
    await deliver(s, [sample]);
    assert.equal((await s.request(hash)).body.status, "held");
    assert.equal(s.record().filter((r) => r.action === "receive_payment_event" && r.outcome === "blocked").length, 3);
  });

  contract("a second payment on a paid link is refunded in full, once, with the booking and payment in the receipt", async () => {
    const s = await boot();
    await s.book();
    const first = s.guards!.pay(link(s).id);
    const second = s.guards!.pay(link(s).id);
    await deliver(s, first);
    await deliver(s, second);
    const refunds = s.guards!.of("payments", "POST", /\/refund$/u);
    assert.equal(refunds.length, 1);
    const secondPayment = link(s).payments[1].id;
    assert.equal(refunds[0].path, `/v1/payments/${secondPayment}/refund`);
    assert.deepEqual(refunds[0].body, { amount: 20000, receipt: `b-1:${secondPayment}` });
    assert.deepEqual(s.guards!.standins.fakes.payments.refunds().map((r) => [r.payment_id, r.amount]), [[secondPayment, 20000]]);
    assert.equal((await s.status()).bookings.confirmed, 1, "the booking is the first payment's");
  });
});

describe("a refund", () => {
  contract("a cancellation in time refunds the whole deposit straight through the payments Guard, frees the slot, and the provider's own refund word changes nothing more", async () => {
    const s = await boot();
    const { hash } = await s.book();
    await deliver(s, s.guards!.pay(link(s).id));
    const paymentId = link(s).payments[0].id;
    const cancel = await s.channelEvents([{ kind: "channel_request", id: "cancel-1", channel: "web", op: "cancel", handle: hash }]);
    assert.equal(cancel.status, 200);
    await s.settle();
    const refunds = s.guards!.of("payments", "POST", /\/refund$/u);
    assert.equal(refunds.length, 1, "one refund call");
    assert.equal(refunds[0].path, `/v1/payments/${paymentId}/refund`);
    assert.deepEqual(refunds[0].body, { amount: 20000, receipt: `b-1:${paymentId}` });
    assert.equal(refunds[0].headers["geo-requested-by"], undefined, "the customer asked; no approver is named");
    assert.equal(refunds[0].status, 200);
    assert.equal(s.guards!.of("calendar", "DELETE").length, 1, "the calendar event goes");
    const view = (await s.request(hash)).body;
    assert.equal(view.status, "cancelled");
    assert.ok(view.messages.at(-1).text.includes("200"), view.messages.at(-1).text);
    assert.deepEqual(s.record().filter((r) => r.action === "refund").map((r) => r.outcome), ["attempted", "confirmed"]);
    assert.deepEqual((await s.status()).refunds, { waitingForOwner: 0, beingSentAgain: 0, needBuilder: { total: 0 } });
    // the provider says the refund is processed: the shop's own record already has it, so nothing is sent again
    const calls = s.guards!.calls.length;
    await deliver(s, s.guards!.newPaymentEvents());
    assert.equal(s.guards!.of("payments", "POST", /\/refund$/u).length, 1);
    assert.equal(s.guards!.calls.slice(calls).filter((c) => c.method !== "GET").length, 0);
  });

  contract("the refund is never more than the deposit that was paid, and a refund call is never repeated by a second cancel", async () => {
    const s = await boot();
    const { hash } = await s.book();
    await deliver(s, s.guards!.pay(link(s).id));
    for (const id of ["cancel-a", "cancel-b"]) await s.channelEvents([{ kind: "channel_request", id, channel: "web", op: "cancel", handle: hash }]);
    await s.settle();
    assert.equal(s.guards!.of("payments", "POST", /\/refund$/u).length, 1, "two presses, one refund");
    assert.equal(s.guards!.standins.fakes.payments.refunds().reduce((n, r) => n + r.amount, 0), 20000);
  });
});

describe("the documents of a booking's page", () => {
  contract("a paid booking has a receipt and a refund has its note, newest first, only for the page that holds the handle; a handle nobody holds has none", async () => {
    const s = await boot();
    const { hash } = await s.book();
    const docs = async (h: string, lang = "en") => (await s.call(`/internal/channel/documents?handle=${h}&lang=${lang}`));
    assert.deepEqual((await docs(hash)).body, { documents: [] }, "nothing is owed or paid yet");
    await deliver(s, s.guards!.pay(link(s).id));
    const paid = (await docs(hash)).body.documents;
    assert.equal(paid.length, 1, JSON.stringify(paid));
    await s.channelEvents([{ kind: "channel_request", id: "cancel-1", channel: "web", op: "cancel", handle: hash }]); await s.settle();
    const after = (await docs(hash)).body.documents;
    assert.equal(after.length, 2, "the refund note is the second");
    assert.notDeepEqual(after[0], paid[0], "newest first");
    assert.deepEqual((await docs("f".repeat(64))).body, { documents: [] });
    assert.equal((await s.call("/internal/channel/documents")).status, 400, "send handle or link");
    assert.equal((await s.call(`/internal/channel/documents?handle=${hash}&link=${hash}`)).status, 400, "not both");
    assert.equal((await s.call("/internal/channel/documents?handle=zz")).status, 400);
    assert.equal((await s.call(`/internal/channel/documents?handle=${hash}&lang=fr`)).status, 400);
    for (const lang of ["hi", "ml", "kn"]) assert.equal((await docs(hash, lang)).status, 200, lang);
  });
});

describe("the amounts nobody can change", () => {
  contract("a price or deposit typed into the page's request is never read: the link is the settings' deposit", async () => {
    const s = await boot();
    const raw = newHandle();
    const answer = await s.channelEvents([{ kind: "channel_request", id: "req-greedy", channel: "web", op: "book", handle: handleHash(raw), serviceId: "facial", startMs: openStart(s.now()), name: "Asha", phone: CUSTOMER, language: "en", priceInr: 1, depositInr: 1, amountPaise: 100, amount: 100 }]);
    assert.equal(answer.status, 200);
    await s.settle();
    const links = s.guards!.of("payments", "POST", /^\/v1\/payment_links$/u);
    assert.equal(links.length, 1);
    assert.equal(links[0].body.amount, 20000, "the settings' ₹200 deposit, not ₹1 and not the facial's ₹900");
    assert.equal((await s.request(handleHash(raw))).body.depositInr, 200);
  });

  contract("a customer who offers less on WhatsApp is told the price stands; the link, if any, is still the deposit", async () => {
    const s = await boot();
    const at = openStart(s.now(), 3);
    const day = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" }).format(at);
    await s.inbound(CUSTOMER, `haircut on ${day} at 11am for 100`);
    for (const l of s.guards!.of("payments", "POST", /^\/v1\/payment_links$/u)) assert.equal(l.body.amount, 20000);
    const said = s.sent(CUSTOMER).map((m) => m.text).join("\n");
    assert.match(said, /450/u, "the shop says what the price is");
    assert.ok(s.record().every((r) => r.action !== "send_message" || r.outcome !== "failed"), "the replies reached the customer");
  });
});

describe("a UPI shop: the owner marks the money", () => {
  const upi = { payment: { module: "upi", upi: { id: "glowsalon@okicici", payee: "Glow Salon" } }, calendar: { module: "own" }, deposit: { amountInr: 200, holdMinutes: 60 } };

  contract("the page shows a UPI address and the exact amount, no Guard is called, and the owner's tap of exactly what was shown books it", async () => {
    const s = await boot({ settings: upi });
    assert.deepEqual(s.guards!.calls, []);
    const { hash } = await s.book();
    const held = (await s.request(hash)).body;
    assert.equal(held.status, "held");
    assert.equal(held.pay.kind, "upi");
    assert.deepEqual(held.pay.payTo, { id: "glowsalon@okicici", name: "Glow Salon" });
    assert.equal(held.pay.amountPaise, 20000);
    assert.deepEqual(s.guards!.calls.filter((c) => c.service !== "messaging"), [], "no payments or calendar call: a UPI shop on its own booking list has neither Guard");
    // the one thing it does say, to the owner, outside their window: the approved template that asks them to look, with the one-use code
    const told = s.guards!.of("messaging");
    assert.equal(told.length, 1);
    assert.equal(told[0].body.type, "template");
    assert.equal(told[0].body.to, "+919000000000");
    assert.equal(told[0].body.template.name, "owner_upi_check");
    const params = told[0].body.template.components[0].parameters.map((p: { text: string }) => p.text);
    assert.deepEqual([params[0], params[2], params[3]], ["haircut", "+91 98111 11111", "₹200"]);
    assert.match(params[4], /^[A-Z0-9]{6}$/u);
    const items = (await s.ownerView()).body.items;
    assert.equal(items.length, 1);
    assert.equal(items[0].kind, "deposit");
    assert.equal(items[0].amountPaise, 20000);
    assert.ok(!("code" in items[0]), "the one-use code never leaves the runtime");
    // a stranger cannot mark money; a stale digest does nothing; the owner's own press does
    const press = (owner: boolean, digest: string, id: string) => s.channelEvents([{ kind: "owner_action", id, action: "received", case: "b-1", digest }], owner ? { owner: true } : {});
    assert.equal((await press(false, items[0].digest, "m-0")).status, 403);
    await press(true, "0".repeat(32), "m-1"); await s.settle();
    assert.equal((await s.request(hash)).body.status, "held", "another digest than the one shown does nothing");
    assert.equal((await press(true, items[0].digest, "m-2")).status, 200); await s.settle();
    assert.equal((await s.request(hash)).body.status, "booked");
    assert.equal((await s.ownerView()).body.items.length, 0);
    assert.ok(s.record().some((r) => r.action.includes("mark") && r.outcome === "confirmed"), JSON.stringify(s.record().map((r) => r.action)));
  });

  contract("the customer saying \"I have paid\" asks the owner to look and marks nothing", async () => {
    const s = await boot({ settings: upi });
    const { hash } = await s.book();
    await s.channelEvents([{ kind: "channel_request", id: "paid-1", channel: "web", op: "paid", handle: hash, upiRef: "123456789012" }]);
    await s.settle();
    const view = (await s.request(hash)).body;
    assert.equal(view.status, "held", "nothing is marked paid by the customer's word");
    assert.equal(view.claimed, true);
    const item = (await s.ownerView()).body.items[0];
    assert.equal(item.upiRef, "123456789012");
    assert.ok(typeof item.claimedAtMs === "number");
  });
});
