// End to end, as in production but with stand-ins: a customer writes or pays at the stand-in, which delivers a SIGNED webhook to the inbox,
// which checks the signature and hands the events to a runtime. First a runtime that only records what it was given, then one that feeds the
// real agent (which talks to the stand-ins through the live adapters), so a whole booking goes through every piece.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { startInbox } from "../inbox/server.ts";
import type { AgentEvent } from "../src/agent.ts";
import { liveWorld, SECRETS, CUSTOMER } from "./helpers/live-world.ts";
import type { LiveWorld } from "./helpers/live-world.ts";

const INBOX = { internalToken: "e2e-internal-token", razorpayWebhookSecret: SECRETS.razorpayWebhookSecret, whatsappAppSecret: SECRETS.whatsappAppSecret, whatsappVerifyToken: "e2e-verify" };

/** A runtime: POST /internal/events with the bearer token. It calls `take` for each event and answers 200 once they are taken. */
async function runtimeServer(take: (events: AgentEvent[]) => Promise<void>, answer: () => number = () => 200): Promise<{ url: string; close(): Promise<void>; unauthorised: number }> {
  const state = { unauthorised: 0 };
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", async () => {
      if (req.method !== "POST" || req.url !== "/internal/events") { res.writeHead(404).end(); return; }
      if (req.headers.authorization !== `Bearer ${INBOX.internalToken}`) { state.unauthorised++; res.writeHead(401).end(); return; }
      const status = answer();
      if (status === 200) await take(JSON.parse(Buffer.concat(chunks).toString("utf8")).events);
      res.writeHead(status).end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, get unauthorised() { return state.unauthorised; }, close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }) };
}

async function chain(options: { runtime: (w: () => LiveWorld) => { take(events: AgentEvent[]): Promise<void>; answer?: () => number } }, run: (t: { w: LiveWorld; inboxUrl: string }) => Promise<void>) {
  let world: LiveWorld | undefined;
  const handler = options.runtime(() => world!);
  const runtime = await runtimeServer(handler.take, handler.answer);
  const inbox = await startInbox({ runtimeUrl: runtime.url, ...INBOX, log: () => undefined }, { port: 0 });
  world = await liveWorld({ inboxUrl: inbox.url });
  try { await run({ w: world, inboxUrl: inbox.url }); } finally { await world.close(); await inbox.close(); await runtime.close(); }
}

test("a customer's WhatsApp message and a payment reach the runtime as signed, parsed events, and a duplicate delivery arrives as the same event twice", async () => {
  const seen: AgentEvent[] = [];
  await chain({ runtime: () => ({ take: async (events) => { seen.push(...events); } }) }, async ({ w }) => {
    const sent = await w.control("/_standin/whatsapp/inbound", { from: CUSTOMER, text: "haircut tomorrow at 6pm", twice: true });
    assert.deepEqual(sent.delivered.map((d: any) => d.status), [200, 200]);
    assert.equal(seen.length, 2);
    const [first, again] = seen as Extract<AgentEvent, { kind: "message" }>[];
    assert.equal(first.kind, "message");
    assert.deepEqual(first.message, again.message); // the same wamid twice: the runtime's job to notice
    assert.equal(first.message.from, CUSTOMER); // the plus is back
    assert.equal(first.message.text, "haircut tomorrow at 6pm");
    assert.equal(first.message.timestamp, Math.floor(w.clock.now() / 1000) * 1000); // epoch milliseconds, not the seconds WhatsApp wrote

    seen.length = 0;
    const link = await w.adapters.payments.createRequest({ amount: 20000, reference_id: "b-1", description: "Deposit" });
    const paid = await w.control("/_standin/razorpay/pay", { request_id: link.id });
    assert.deepEqual(paid.delivered.map((d: any) => [d.event, d.status]), [["payment.received", 200], ["request.paid", 200]]);
    const events = seen as Extract<AgentEvent, { kind: "payment_event" }>[];
    assert.deepEqual(events.map((e) => e.event.event), ["payment.received", "request.paid"]);
    assert.deepEqual(events.map((e) => e.event.id), w.fakes.payments.events.map((e) => e.id)); // the id is Razorpay's x-razorpay-event-id
    assert.equal(events[0].event.payload.payment?.request_id, undefined); // a real payment.captured does not name the link
    assert.equal(events[1].event.payload.request?.id, link.id);
    assert.equal(events[1].event.payload.request?.reference_id, "b-1");
  });
});

test("a webhook signed with the wrong secret is turned away at the inbox, and the runtime never hears of it", async () => {
  const seen: AgentEvent[] = [];
  let world: LiveWorld | undefined;
  const runtime = await runtimeServer(async (events) => { seen.push(...events); });
  const inbox = await startInbox({ runtimeUrl: runtime.url, ...INBOX, razorpayWebhookSecret: "not what the stand-in signs with", whatsappAppSecret: "nor this", log: () => undefined }, { port: 0 });
  try {
    world = await liveWorld({ inboxUrl: inbox.url });
    const sent = await world.control("/_standin/whatsapp/inbound", { from: CUSTOMER, text: "hello" });
    assert.deepEqual(sent.delivered.map((d: any) => d.status), [401]);
    const link = await world.adapters.payments.createRequest({ amount: 20000, reference_id: "b-1", description: "Deposit" });
    const paid = await world.control("/_standin/razorpay/pay", { request_id: link.id });
    assert.deepEqual(paid.delivered.map((d: any) => d.status), [401, 401]);
    assert.equal(seen.length, 0);
  } finally { await world?.close(); await inbox.close(); await runtime.close(); }
});

test("if the runtime does not take the events, the stand-in (standing for the provider) is told 503 and can send them again", async () => {
  let down = true;
  const seen: AgentEvent[] = [];
  await chain({ runtime: () => ({ take: async (events) => { seen.push(...events); }, answer: () => (down ? 503 : 200) }) }, async ({ w }) => {
    assert.deepEqual((await w.control("/_standin/whatsapp/inbound", { from: CUSTOMER, text: "hello", id: "wamid.same" })).delivered.map((d: any) => d.status), [503]);
    assert.equal(seen.length, 0);
    down = false;
    assert.deepEqual((await w.control("/_standin/whatsapp/inbound", { from: CUSTOMER, text: "hello", id: "wamid.same" })).delivered.map((d: any) => d.status), [200]); // the provider's retry
    assert.equal(seen.length, 1);
  });
});

test("a whole booking through every piece: WhatsApp message -> signed webhook -> inbox -> runtime -> agent -> live adapters -> stand-ins, then the payment the same way", async () => {
  const dedupe = new Set<string>();
  await chain({
    runtime: (world) => ({
      // what the real runtime does: save (here: de-duplicate and note when the customer wrote), run the agent, answer
      take: async (events) => {
        for (const e of events) {
          const key = e.kind === "message" ? e.message.id : e.kind === "payment_event" ? e.event.id : "";
          if (key && dedupe.has(key)) continue;
          if (key) dedupe.add(key);
          if (e.kind === "message") world().noteInbound(e.message.from, e.message.timestamp);
          await world().agent.handle(e);
        }
      },
    }),
  }, async ({ w }) => {
    await w.control("/_standin/whatsapp/inbound", { from: CUSTOMER, text: "haircut tomorrow at 6pm", twice: true });
    assert.equal(w.fakes.calendar.events().length, 1, "one hold, though the message arrived twice");
    assert.equal(w.fakes.payments.links().length, 1);
    const link = w.linkFor("b-1")!;
    const sent = w.fakes.messaging.sentTo(CUSTOMER);
    assert.equal(sent.length, 1);
    assert.ok(sent[0].text.includes(link.pay_url));

    await w.control("/_standin/razorpay/pay", { request_id: link.id });
    assert.equal(w.confirmedEvents().length, 1);
    assert.equal(w.linkFor("b-1")!.payments.length, 1);
    assert.match(w.textsTo(CUSTOMER).at(-1)!, /Booked!/);

    // a second payment on the same link, and the provider sending its webhooks twice
    await w.control("/_standin/razorpay/pay", { request_id: link.id, twice: true });
    assert.equal(w.fakes.payments.refunds().length, 1);
    assert.equal(w.fakes.payments.refunds()[0].amount, 20000);
    await w.control("/_standin/razorpay/deliver", { twice: true }); // the refund.processed event
    assert.equal(w.fakes.payments.refunds().length, 1);
    assert.equal((await w.control("/_standin/state")).authorizationSeen, 0);
  });
});
