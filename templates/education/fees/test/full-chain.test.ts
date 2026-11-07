// The whole local chain as real servers in one process, each on a free port (scripts/local-stack.ts):
//
//   stand-ins (Razorpay and WhatsApp wire formats) -> signed webhooks -> inbox (Meta signature mode, secrets from files)
//   -> Fees runtime server in LIVE mode -> the agent -> the live adapters -> back to the stand-ins
//
// Guard will sit between the runtime and each service in production; here the WhatsApp URL points straight at the stand-in and the refunds go through a stub Guard (the
// approvals relay beside it is the Fees one). "Done" is judged from the stand-ins' own records (the payment links, the payments, the outbox), never from what the agent said.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { signMeta, signRazorpay } from "../../../../modules/messaging/webhooks.ts";
import { fakeClock } from "../../../../modules/core/clock.ts";
import { zonedToMs } from "../../../../modules/core/time.ts";
import { languageOfScript } from "../../../../modules/language/format.ts";
import { KIRAN_PARENT, MEERA_PARENT, ROHAN_PARENT, SHARMA_PARENT, brightTuition } from "../src/harness.ts";
import { PHONE_NUMBER_ID, startLocalStack } from "../scripts/local-stack.ts";
import type { LocalStack } from "../scripts/local-stack.ts";
import { whatsappWebhookBody } from "../standins/control.ts";

const settings = brightTuition();
const at = (day: number, hour: number, minute = 0) => zonedToMs({ year: 2026, month: 11, day }, { hour, minute }, settings.timezone);
/** Mon 2 Nov 2026, 09:00 in India: the morning of the first reminder day (reminders go at 10:00; the fee is due on the 5th). */
const MORNING = at(2, 9);

/** The stand-ins and the runtime share this one fake clock, so the day is the same whatever day the test runs. */
let clock = fakeClock(MORNING);
const setClock = (ms: number) => clock.set(ms);

async function withStack(run: (s: LocalStack) => Promise<void>, options: { refundLimitInr?: number } = {}): Promise<void> {
  clock = fakeClock(MORNING);
  const stack = await startLocalStack({ clock, ...options });
  try { await run(stack); } finally { await stack.stop(); }
}

/** The agent's first tick (it notes the day it first ran), then the clock reaches the reminder hour and the month is opened. */
async function openTheMonth(s: LocalStack): Promise<void> {
  await s.runtime!.runtime.tick();
  setClock(at(2, 10, 5));
  await s.runtime!.runtime.tick();
  await s.settle();
}

/** A call to a stand-in control route (the parent writes, the parent pays, the provider sends its webhooks again). */
async function control(s: LocalStack, path: string, body?: unknown): Promise<any> {
  const reply = await fetch(s.standins.url + path, { method: body === undefined ? "GET" : "POST", body: body === undefined ? undefined : JSON.stringify(body) });
  return reply.json();
}
const statuses = (reply: { delivered: { status?: number }[] }) => reply.delivered.map((d) => d.status);

/** What the stand-ins hold. These are the witnesses. */
function witnesses(s: LocalStack) {
  const { payments, messaging } = s.standins.fakes;
  return {
    links: payments.links(),
    captured: payments.links().flatMap((l) => l.payments).filter((p) => p.status === "captured"),
    refunds: payments.refunds(),
    sentTo: (who: string) => messaging.sentTo(who),
    // everything a repeat could change, in one value
    everything: () => JSON.stringify({ links: payments.links(), refunds: payments.refunds(), outbox: messaging.outbox(), calls: payments.calls.length }),
  };
}
const linkOf = (s: LocalStack, ref: string) => witnesses(s).links.find((l) => l.reference_id === ref)!;
const ROHAN = "f-5.1"; // Rohan Mehta, class 10, ₹1,800: the fifth student of the example centre, his first link

test("the month opens: a reminder with a payment link goes to each parent, in their language, on the stand-in WhatsApp", async () => {
  await withStack(async (s) => {
    await openTheMonth(s);
    const w = witnesses(s);
    assert.deepEqual(w.links.map((l) => [l.reference_id, l.amount]), [["f-1.1", 180_000], ["f-2.1", 120_000], ["f-3.1", 150_000], ["f-4.1", 120_000], ["f-5.1", 180_000]]);
    assert.equal(w.sentTo(SHARMA_PARENT).length, 2, "the Sharmas have two children: one reminder each");
    for (const parent of [SHARMA_PARENT, MEERA_PARENT, KIRAN_PARENT, ROHAN_PARENT]) {
      const sent = w.sentTo(parent);
      assert.ok(sent.length >= 1, parent);
      assert.equal(sent[0].kind, "template", "the parent has not written, so the 24-hour window is closed and a reminder goes as an approved template");
      assert.equal(sent[0].templateName, "fee_reminder");
    }
    assert.equal(languageOfScript(w.sentTo(SHARMA_PARENT)[0].text), "hi");
    assert.equal(languageOfScript(w.sentTo(MEERA_PARENT)[0].text), "ml");
    assert.equal(languageOfScript(w.sentTo(KIRAN_PARENT)[0].text), "kn");
    assert.ok(w.sentTo(ROHAN_PARENT)[0].text.includes(linkOf(s, ROHAN).short_url));
    assert.deepEqual(s.runtime!.runtime.status().fees, { open: 5 });
    assert.equal((await control(s, "/_standin/state")).authorizationSeen, 0, "no credential left the runtime: Guard holds those");
  });
});

test("a parent pays: the payments, the fee and the outbox all show it, and the provider's repeat changes nothing", async () => {
  await withStack(async (s) => {
    await openTheMonth(s);
    const paid = await control(s, "/_standin/razorpay/pay", { link_id: linkOf(s, ROHAN).id });
    assert.deepEqual(paid.delivered.map((d: any) => [d.event, d.status]), [["payment.captured", 200], ["payment_link.paid", 200]]);
    await s.settle();

    const w = witnesses(s);
    assert.equal(w.captured.length, 1);
    assert.equal(w.captured[0].amount, 180_000);
    assert.equal(linkOf(s, ROHAN).status, "paid");
    assert.deepEqual(s.runtime!.runtime.status().fees, { open: 4, paid: 1 });
    const receipts = w.sentTo(ROHAN_PARENT).filter((m) => m.templateName === "fee_received");
    assert.equal(receipts.length, 1, "exactly one receipt");
    assert.match(receipts[0].text, /received ₹1,800/);

    // Razorpay sends the same two events again, as it does when it did not hear back in time. The runtime has them by id: nothing runs.
    const before = w.everything();
    assert.deepEqual(statuses(await control(s, "/_standin/razorpay/deliver", { all: true })), [200, 200]);
    await s.settle();
    assert.equal(witnesses(s).everything(), before, "no call reached the services, and nothing they hold moved");
    assert.deepEqual(s.runtime!.runtime.status().tasks, { pending: 0, done: 2, failed: 0 }, "the two payment events, each once");

    // a parent who then says they paid is told what the record shows, and nothing is marked on their word
    await control(s, "/_standin/whatsapp/inbound", { from: ROHAN_PARENT, text: "I already paid the fee", id: "wamid.claim-1" });
    await s.settle();
    assert.match(witnesses(s).sentTo(ROHAN_PARENT).at(-1)!.text, /Nothing more is due/);
    assert.equal(witnesses(s).links.length, 5, "no new link for a fee that is paid");
  });
});

test("the runtime stops after the reminders and before the payment: the inbox says 503, the provider sends again after the restart, and the fee is settled once", async () => {
  await withStack(async (s) => {
    await openTheMonth(s);
    await s.stopRuntime();

    // The parent pays while the runtime is down. The money is at the provider; the inbox cannot hand the events on, so it refuses them.
    const paid = await control(s, "/_standin/razorpay/pay", { link_id: linkOf(s, ROHAN).id });
    assert.deepEqual(statuses(paid), [503, 503]);
    let w = witnesses(s);
    assert.equal(w.captured.length, 1, "the payment is real at the provider");
    assert.equal(w.sentTo(ROHAN_PARENT).filter((m) => m.templateName === "fee_received").length, 0, "but nothing has said so to the parent yet");

    // A new runtime on the same data folder (and port). It remembers the month it opened. The provider delivers again what was not accepted.
    await s.startRuntime();
    assert.deepEqual(s.runtime!.runtime.status().fees, { open: 5 }, "it remembers the five fees from before the stop");
    assert.deepEqual(statuses(await control(s, "/_standin/razorpay/deliver", { all: true })), [200, 200]);
    await s.settle();
    w = witnesses(s);
    assert.equal(w.sentTo(ROHAN_PARENT).filter((m) => m.templateName === "fee_received").length, 1);
    assert.deepEqual(s.runtime!.runtime.status().fees, { open: 4, paid: 1 });
    assert.equal(w.links.length, 5);

    // The provider's retry of the same events reaches the new process too. The saved ids make it a no-op.
    const before = w.everything();
    assert.deepEqual(statuses(await control(s, "/_standin/razorpay/deliver", { all: true })), [200, 200]);
    await s.settle();
    assert.equal(witnesses(s).everything(), before);
  });
});

test("the runtime is down over the reminder hour: the first tick after the restart still chases the month, because the day the agent first ran was saved", async () => {
  await withStack(async (s) => {
    await s.runtime!.runtime.tick(); // 09:00: the agent notes the day it first ran
    await s.stopRuntime();
    setClock(at(2, 13)); // the process was down over 10:00
    await s.startRuntime();
    await s.runtime!.runtime.tick();
    await s.settle();
    const w = witnesses(s);
    assert.equal(w.links.length, 5);
    assert.ok(w.sentTo(ROHAN_PARENT).length >= 1, "the parent was reminded");
    assert.deepEqual(s.runtime!.runtime.status().fees, { open: 5 });
  });
});

test("a webhook with a bad signature changes nothing: a forged payment does not settle a fee and a forged message is not answered", async () => {
  await withStack(async (s) => {
    await openTheMonth(s);
    const link = linkOf(s, ROHAN);
    const before = witnesses(s).everything();

    const paidBody = JSON.stringify({ event: "payment_link.paid", created_at: 1, payload: { payment_link: { entity: { id: link.id, reference_id: "f-5.1" } }, payment: { entity: { id: "pay_forged" } } } });
    const forgedPayment = await fetch(`${s.inbox.url}/webhooks/razorpay`, {
      method: "POST", body: paidBody, headers: { "x-razorpay-signature": signRazorpay(Buffer.from(paidBody), "a secret the forger guessed"), "x-razorpay-event-id": "evt_forged" },
    });
    assert.equal(forgedPayment.status, 401);
    const unsigned = await fetch(`${s.inbox.url}/webhooks/razorpay`, { method: "POST", body: paidBody, headers: { "x-razorpay-event-id": "evt_forged_2" } });
    assert.equal(unsigned.status, 401);

    const wrote = whatsappWebhookBody({ id: "wamid.forged", from: ROHAN_PARENT, text: "I want to talk to the owner", timestamp: at(2, 11) }, PHONE_NUMBER_ID);
    const forgedMessage = await fetch(`${s.inbox.url}/webhooks/whatsapp`, { method: "POST", body: wrote, headers: { "x-hub-signature-256": signMeta(Buffer.from(wrote), "a secret the forger guessed") } });
    assert.equal(forgedMessage.status, 401);

    await s.settle();
    assert.equal(witnesses(s).everything(), before, "nothing the services hold moved, and no call was made");
    assert.deepEqual(s.runtime!.runtime.status().fees, { open: 5 }, "the fee is still open");

    // the real payment afterwards still settles it
    assert.deepEqual(statuses(await control(s, "/_standin/razorpay/pay", { link_id: link.id })), [200, 200]);
    await s.settle();
    assert.deepEqual(s.runtime!.runtime.status().fees, { open: 4, paid: 1 });
  });
});

test("a waiver above the limit is the owner's call and does not go through the relay: the agent asks, and the owner's `approve q-1` through the inbox takes the money off", async () => {
  await withStack(async (s) => {
    await openTheMonth(s);
    // Kiran (Kannada, class 8, ₹1,200) asks for ₹500 off: above the ₹100 limit
    await control(s, "/_standin/whatsapp/inbound", { from: KIRAN_PARENT, text: "Please take ₹500 off the fee", id: "wamid.waiver-1" });
    await s.settle();
    const owner = () => s.standins.fakes.messaging.sentTo(s.owner);
    const asked = owner().filter((m) => m.text.includes("approve q-"));
    assert.equal(asked.length, 1, "the agent asked the owner itself, once");
    assert.match(asked[0].text, /approve q-1/);
    assert.equal(witnesses(s).refunds.length, 0);

    // another number says it: nothing. The owner says it: the inbox gives it to the runtime (and the relay, which has no code for it and says nothing).
    await control(s, "/_standin/whatsapp/inbound", { from: "+919899999999", text: "approve q-1", id: "wamid.forged-q" });
    await s.settle();
    assert.equal(owner().filter((m) => /taken off|Done/u.test(m.text)).length, 0, "a stranger cannot approve");
    assert.deepEqual(statuses(await control(s, "/_standin/whatsapp/inbound", { from: s.owner, text: "approve q-1", id: "wamid.owner-q1" })), [200]);
    await s.settle(); await s.relay.idle();
    assert.match(witnesses(s).sentTo(KIRAN_PARENT).at(-1)!.text, /₹500/u, "the parent is told the amount that was taken off");
    assert.deepEqual(witnesses(s).links.filter((l) => l.reference_id.startsWith("f-4.")).map((l) => [l.reference_id, l.amount]), [["f-4.1", 120_000], ["f-4.2", 70_000]], "a new link for what is left: ₹1,200 less ₹500");
    assert.equal(s.standins.fakes.messaging.sentTo(s.owner).filter((m) => m.templateName === "owner_fee_approval_request").length, 0, "the relay asked nothing: a waiver is not a held refund");
  });
});

test("a refund above the limit: the stub Guard holds it, the relay asks the owner once on WhatsApp, the owner's reply reaches the relay from the inbox, and the refund is made once", async () => {
  await withStack(async (s) => {
    await openTheMonth(s);
    await control(s, "/_standin/razorpay/pay", { link_id: linkOf(s, ROHAN).id });
    await s.settle();
    assert.deepEqual(s.runtime!.runtime.status().fees, { open: 4, paid: 1 });

    // Rohan's parent asks for all ₹1,800 back: above the ₹500 limit, so the refund is held (and the agent does not ask the owner itself)
    assert.deepEqual(statuses(await control(s, "/_standin/whatsapp/inbound", { from: ROHAN_PARENT, text: "I want ₹1800 refunded", id: "wamid.refund-1" })), [200]);
    await s.settle();
    const owner = () => s.standins.fakes.messaging.sentTo(s.owner);
    assert.equal(witnesses(s).refunds.length, 0, "held, not sent");
    assert.equal(s.guard.model.reviews("x", true).length, 1);
    assert.equal(owner().length, 0, "the agent did not ask");
    assert.match(witnesses(s).sentTo(ROHAN_PARENT).at(-1)!.text, /₹1,800/);
    assert.deepEqual(s.runtime!.runtime.status().refunds, { waitingForOwner: 1, beingSentAgain: 0, needBuilder: { total: 0 } });

    // the relay reads the stub Guard, asks the runtime what the refund is about, and asks the owner, once
    await s.pollRelay(); await s.pollRelay();
    assert.equal(owner().length, 1);
    assert.equal(owner()[0].templateName, "owner_fee_approval_request");
    const code = /"approve ([A-Z0-9]{6})"/u.exec(owner()[0].text)![1];
    assert.equal(owner()[0].text, `Approval needed: refund ₹1,800 for ${ROHAN_PARENT} (Rohan Mehta, Nov 2026). Reply "approve ${code}" or "deny ${code}" within 24 hours.`);

    // another number sends the code: nothing. The owner sends it: the inbox gives it to the runtime AND the relay, and the refund goes once.
    await control(s, "/_standin/whatsapp/inbound", { from: "+919899999999", text: `approve ${code}`, id: "wamid.forged-1" });
    await s.settle(); await s.relay.idle();
    assert.equal(witnesses(s).refunds.length, 0);
    assert.deepEqual(statuses(await control(s, "/_standin/whatsapp/inbound", { from: s.owner, text: `approve ${code}`, id: "wamid.owner-1" })), [200]);
    await s.settle(); await s.relay.idle(); await s.settle();
    const w = witnesses(s);
    assert.equal(w.refunds.length, 1);
    assert.equal(w.refunds[0].amount, 180_000);
    assert.equal(w.refunds[0].receipt, `f-5:${w.captured[0].id}`);
    assert.equal(s.guard.accepted.length, 1);
    assert.equal(owner().filter((m) => m.templateName === "owner_fee_approval_request").length, 1, "asked exactly once");
    assert.equal(owner().at(-1)!.text, `Thank you. The ₹1,800 refund for ${ROHAN_PARENT} is being sent, and they will be told.`);
    assert.ok(owner().every((m) => !/understand/u.test(m.text)), "the agent saw the code too, and said nothing");
    assert.match(w.sentTo(ROHAN_PARENT).at(-1)!.text, /₹1,800/);
    // the same webhook delivered again, and time, change nothing
    await control(s, "/_standin/whatsapp/inbound", { from: s.owner, text: `approve ${code}`, id: "wamid.owner-1" });
    await s.pollRelay();
    assert.equal(witnesses(s).refunds.length, 1);
    assert.deepEqual(s.runtime!.runtime.status().refunds, { waitingForOwner: 0, beingSentAgain: 0, needBuilder: { total: 0 } });
    assert.deepEqual(s.runtime!.runtime.status().fees, { open: 4, paid: 1 }, "a refund does not open a paid fee again");
  });
});

test("a refund the owner denies is never sent, and the parent is told", async () => {
  await withStack(async (s) => {
    await openTheMonth(s);
    await control(s, "/_standin/razorpay/pay", { link_id: linkOf(s, "f-3.1").id }); // Meera, ₹1,500
    await s.settle();
    await control(s, "/_standin/whatsapp/inbound", { from: MEERA_PARENT, text: "എനിക്ക് ₹1500 റീഫണ്ട് വേണം", id: "wamid.refund-ml" });
    await s.settle();
    await s.pollRelay(); await s.pollRelay();
    const owner = () => s.standins.fakes.messaging.sentTo(s.owner);
    const code = /"approve ([A-Z0-9]{6})"/u.exec(owner()[0].text)![1];
    assert.match(owner()[0].text, /^Approval needed: refund ₹1,500 for \+919822222222 \(Meera Nair, Nov 2026\)\./);
    await control(s, "/_standin/whatsapp/inbound", { from: s.owner, text: `deny ${code}`, id: "wamid.owner-deny" });
    await s.settle(); await s.relay.idle(); await s.settle();
    assert.equal(witnesses(s).refunds.length, 0);
    assert.deepEqual(s.guard.accepted.map((a) => a.decision), ["deny"], "Guard recorded the owner's no, and nothing else");
    assert.match(owner().at(-1)!.text, /will not be sent/);
    assert.equal(languageOfScript(witnesses(s).sentTo(MEERA_PARENT).at(-1)!.text), "ml");
    assert.deepEqual(s.runtime!.runtime.status().refunds, { waitingForOwner: 0, beingSentAgain: 0, needBuilder: { total: 0 } });
  });
});

test("npm run stack: the command prints where everything is and Ctrl+C stops it and removes its secrets", async () => {
  const child = spawn(process.execPath, [new URL("../scripts/local-stack.ts", import.meta.url).pathname, "--free-ports"], { stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (c) => { out += c; });
  child.stderr.on("data", (c) => { out += c; });
  const exited = new Promise<number | null>((resolve) => child.on("close", resolve));
  try {
    for (let i = 0; i < 1500 && !out.includes("Press Ctrl+C"); i++) await new Promise((resolve) => setTimeout(resolve, 10));
    const standins = /Stand-ins .*?(http:\/\/\S+)/u.exec(out)?.[1];
    const dir = /Secrets and data: (\S+)/u.exec(out)?.[1];
    assert.ok(standins && dir, out);
    assert.ok(existsSync(dir));
    assert.match(out, /Fees · local stack for Bright Tuition Centre/);
    // the printed curl, as printed: a parent writes, and the runtime (live mode) answers through the stand-in
    const printed = /whatsapp\/inbound -d '(\{"from":"\+919811111111".*?\})'/u.exec(out)?.[1];
    assert.ok(printed, out);
    const wrote = await (await fetch(`${standins}/_standin/whatsapp/inbound`, { method: "POST", body: printed })).json() as any;
    assert.deepEqual(statuses(wrote), [200]);
    let state: any = {};
    for (let i = 0; i < 500 && !(state.outbox?.length > 0); i++) { await new Promise((resolve) => setTimeout(resolve, 10)); state = await (await fetch(`${standins}/_standin/state`)).json(); }
    assert.ok(state.outbox.length > 0, "the agent answered the parent");
    assert.equal(state.authorizationSeen, 0);
    child.kill("SIGTERM");
    assert.equal(await exited, 0);
    assert.ok(!existsSync(dir), "the temp folder with the secrets and the data is gone");
  } finally { child.kill("SIGKILL"); }
});
