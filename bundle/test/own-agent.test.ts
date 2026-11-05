// An agent Geometer did not write, behind the REAL Guard. The builder's agent (bundle/examples/own-agent/agent.js, plain Node) takes a booking and a deposit and tries a refund above the
// owner's limit. Everything between it and the services is the bundle's own: the limits made by `agent add`, the specs compiled by the real `geo-guard`, the guard.toml the bundle writes,
// the approvals relay and the inbox for an agent someone else wrote, the record built from the Guards' decisions and the services' state, and the monthly report from that record.
// The services are the stand-ins. Skipped, saying so, when the built geo-guard binary is not on this computer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGuardClient } from "../../modules/approvals/clients.ts";
import { createRelay } from "../../pathways/bookings/approvals/relay.ts";
import { relayHandler } from "../../modules/approvals/server.ts";
import { openRelayStore } from "../../modules/approvals/store.ts";
import { createWhatsAppMessaging } from "../../modules/messaging/whatsapp.ts";
import { systemClock } from "../../modules/core/clock.ts";
import { startStandins } from "../../pathways/bookings/standins/server.ts";
import { addAgent } from "../agent/deploy.ts";
import { collectFacts } from "../agent/facts.ts";
import { readAgent } from "../agent/folder.ts";
import { agentInboxHandler } from "../agent/inbox.ts";
import { RECORD_READS, agentNames, planAgent } from "../agent/plan.ts";
import { ownAgentRuntime } from "../agent/relay-context.ts";
import { recordAgent } from "../agent/records.ts";
import { writeAgentReport } from "../agent/report.ts";
import type { Context } from "../deploy.ts";
import { names } from "../generate/shop.ts";
import { createAgent, run } from "../examples/own-agent/agent.js";
import { PHONE_NUMBER_ID, CALENDAR_ID, serverConfig, tempServer } from "./helpers.ts";
import { credential, skipWithoutBinary, startRealGuard } from "./real-guard.ts";

const OWNER = "+919800000001";
const CUSTOMER = "+919811111111";
const NAME = "my-agent";
const APP_SECRET = "meta-app-secret-0123456789";
const RELAY_TOKEN = "relay-token-0123456789abcdef";
const month = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit" }).format(new Date());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const listen = (handler: (req: IncomingMessage, res: ServerResponse) => void) => new Promise<{ url: string; close(): Promise<void> }>((resolve) => {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, close: () => new Promise<void>((done) => { server.closeAllConnections(); server.close(() => done()); }) }));
});

test("a refund above the limit is held, the owner approves once on WhatsApp, the refund is made once, and the record and the report count it", { skip: skipWithoutBinary }, async () => {
  const folder = tempServer({});
  const dir = mkdtempSync(join(tmpdir(), "geo-own-agent-"));
  const standins = await startStandins({ razorpayWebhookSecret: "x", whatsappAppSecret: "y", phoneNumberId: PHONE_NUMBER_ID, calendarId: CALENDAR_ID }, { port: 0 });
  const closers: (() => Promise<void>)[] = [];
  try {
    // agent add: a ₹200 deposit, and the owner decides about any refund above ₹100
    addAgent(folder.root, NAME, { "owner-whatsapp": OWNER, deposit: "200", "refund-limit": "100", "whatsapp-number-id": PHONE_NUMBER_ID, "calendar-id": CALENDAR_ID }, () => "", new Date());
    const agentFolder = readAgent(folder.root, NAME);
    const plan = planAgent(serverConfig(), agentFolder);
    assert.deepEqual(plan.problems, []);
    const agent = credential(), record = credential(), relayCred = credential();
    const guard = async (kind: "razorpay" | "whatsapp" | "calendar") => {
      const g = plan.guards.find((x) => x.kind === kind)!;
      const real = await startRealGuard({
        def: g.def, spec: g.spec, tenant: NAME, deployment: g.deployment, upstreamPort: standins.port,
        agents: [{ id: agentNames.agentId(NAME), token: agent.token }, ...(kind === "whatsapp" ? [{ id: names.relayAgentId(NAME), token: relayCred.token, operations: ["send"] }] : []), ...(RECORD_READS[kind] ? [{ id: agentNames.recordId(NAME), token: record.token, operations: RECORD_READS[kind]! }] : [])],
        ...(kind === "razorpay" ? { approver: { id: names.approverId(NAME) } } : {}),
      });
      closers.push(real.stop);
      return real;
    };
    const [rz, wa, cal] = [await guard("razorpay"), await guard("whatsapp"), await guard("calendar")];

    // the approvals relay for an agent someone else wrote: it reads Guard's held refunds, asks the owner through the WhatsApp Guard, and looks the payment up at Razorpay
    const issued = await (await fetch(`${rz.adminUrl}/admin/approvers`, { method: "POST", headers: { authorization: `Bearer ${rz.adminToken}`, "content-type": "application/json" }, body: JSON.stringify({ id: `relay-${NAME}`, roles: ["shop-owner"], ttl_seconds: 3600 }) })).json() as { token: string };
    const guardClient = createGuardClient({ adminUrl: rz.adminUrl, readToken: issued.token, approverId: names.approverId(NAME), approverSecret: rz.ownerSecret!, now: () => Date.now() });
    const store = openRelayStore(dir);
    closers.push(async () => store.close());
    const relay = createRelay({
      clock: systemClock, store, ownerWhatsapp: OWNER, expectedAgent: agentNames.agentId(NAME), guard: guardClient, log: () => undefined,
      runtime: ownAgentRuntime({ guard: guardClient, razorpay: { baseUrl: rz.agentUrl, token: () => record.token }, business: { name: agentFolder.settings!.name, timeZone: agentFolder.settings!.timezone, ownerLanguage: "en" } }),
      messaging: createWhatsAppMessaging({ baseUrl: wa.agentUrl, phoneNumberId: PHONE_NUMBER_ID, agentToken: relayCred.token }, { clock: systemClock, window: { lastInboundAt: () => undefined } }),
    });
    // the inbox for this agent: WhatsApp's webhooks come here, the owner's replies go to the relay, and everything is passed on to the agent as it came
    const relayServer = await listen(relayHandler(relay, RELAY_TOKEN)); closers.push(relayServer.close);
    const passedOn: { body: string; signature: string | undefined }[] = [];
    const agentWebhook = await listen((req, res) => { const chunks: Buffer[] = []; req.on("data", (c: Buffer) => chunks.push(c)); req.on("end", () => { passedOn.push({ body: Buffer.concat(chunks).toString("utf8"), signature: req.headers["x-hub-signature-256"] as string | undefined }); res.writeHead(200); res.end(); }); });
    closers.push(agentWebhook.close);
    const inbox = await listen(agentInboxHandler({ ownerWhatsapp: OWNER, phoneNumberId: PHONE_NUMBER_ID, verification: "meta-signature", appSecret: APP_SECRET, verifyToken: "verify-token-0123456789", relayUrl: relayServer.url, relayToken: RELAY_TOKEN, forwardTo: agentWebhook.url, log: () => undefined }));
    closers.push(inbox.close);
    const webhook = async (from: string, text: string, id: string, secret = APP_SECRET) => {
      const raw = JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: PHONE_NUMBER_ID }, messages: [{ from: from.replace(/\D/gu, ""), id, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: text } }] } }] }] });
      const signature = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
      return { status: (await fetch(`${inbox.url}/webhooks/whatsapp`, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": signature }, body: raw })).status, raw, signature };
    };
    const asked = () => standins.fakes.messaging.sentTo(OWNER).filter((m) => m.templateName === "owner_approval_request");
    const refunds = () => standins.fakes.payments.refunds();

    // ---- the builder's agent, as written: only its addresses and its credential are Geometer's ------------------------------------------------------
    const sdk = createAgent({ razorpay: rz.agentUrl, calendar: cal.agentUrl, whatsapp: wa.agentUrl, credential: agent.token, calendarId: CALENDAR_ID, phoneNumberId: PHONE_NUMBER_ID });
    standins.fakes.messaging.receive(CUSTOMER, "hi"); // the customer wrote first, so a plain message can go back
    // the owner and the relay, while the agent waits: the relay asks once; a reply from another number and a badly signed one do nothing; the owner's own reply approves
    const owner = (async () => {
      for (let i = 0; i < 200 && asked().length === 0; i++) { await relay.poll(); await sleep(50); }
      assert.equal(asked().length, 1, "the relay asked the owner");
      assert.equal(refunds().length, 0, "nothing was refunded while the owner had not answered");
      const text = asked()[0].text;
      const code = /"approve ([A-Z0-9]{6})"/u.exec(text)![1];
      assert.match(text, /^Approval needed: refund ₹200 for \+919800000000 \(payment pay_\d+, [A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}, \d{1,2}:\d{2} [ap]m\)\. Reply "approve [A-Z0-9]{6}" or "deny [A-Z0-9]{6}" within 24 hours\.$/u, "who paid and when are Razorpay's own record of the payment");
      assert.equal((await webhook("+919899999999", `approve ${code}`, "wamid.forged")).status, 200);
      assert.equal((await webhook(OWNER, `approve ${code}`, "wamid.badly-signed", "not the app secret")).status, 401);
      await relay.idle();
      assert.equal(refunds().length, 0, "another number's word, and a webhook that was not signed by Meta, approve nothing");
      assert.equal((await webhook(OWNER, `approve ${code}`, "wamid.owner")).status, 200);
      await relay.idle();
    })();
    const story = await Promise.all([run(sdk, {
      customer: CUSTOMER, reference: "b-1", depositInr: 200, startsAt: Date.now() + 86_400_000, log: () => undefined, retry: { everyMs: 100, timeoutMs: 30_000 },
      paid: async (linkId: string) => { // the customer pays at Razorpay; the agent looks at its link
        standins.fakes.payments.customerPays(linkId);
        const link = await sdk.readLink(linkId);
        return { paymentId: link.json.payments[0].payment_id, amountPaise: link.json.payments[0].amount };
      },
    }), owner]).then(([r]) => r);

    assert.equal(story.link.status, 200);
    assert.equal(story.booked.status, 200);
    assert.equal(story.first.status, 202, "the refund above the limit was held, not sent");
    assert.match(story.first.held ?? "", /^ap-/u);
    assert.equal(story.result.status, 200, "the identical call, sent again after the owner said yes, went through");
    assert.equal(refunds().length, 1, "the refund was made once");
    assert.deepEqual([refunds()[0].amount, refunds()[0].receipt], [20000, "b-1"]);
    assert.equal(asked().length, 1, "and the owner was asked once");
    assert.equal((await (await fetch(`${rz.adminUrl}/admin/approvals?state=consumed`, { headers: { authorization: `Bearer ${rz.adminToken}` } })).json() as { approvals: unknown[] }).approvals.length, 1, "one approval, used once");
    // what the inbox passed on to the agent is what Meta sent, with Meta's own signature, so the agent can check it itself
    assert.ok(passedOn.length >= 1 && passedOn.every((p) => p.signature?.startsWith("sha256=")), "the webhooks the inbox accepted went on to the agent");
    assert.equal(createHmac("sha256", APP_SECRET).update(passedOn[0].body).digest("hex"), passedOn[0].signature!.slice("sha256=".length));
    // a second try with something Guard refuses: more than one deposit back
    const tooMuch = await sdk.refundOnce({ paymentId: story.result.json.payment_id, amountPaise: 20001, receipt: "b-1" });
    assert.equal(tooMuch.status, 403);
    assert.equal(refunds().length, 1);

    // ---- the record: what the Guards decided and what the services hold ------------------------------------------------------------------------------
    const facts = await collectFacts({
      agentId: agentNames.agentId(NAME), relayId: names.relayAgentId(NAME), recordToken: record.token, calendarId: CALENDAR_ID,
      guards: [{ kind: "razorpay", adminUrl: rz.adminUrl, adminToken: rz.adminToken, agentUrl: rz.agentUrl }, { kind: "whatsapp", adminUrl: wa.adminUrl, adminToken: wa.adminToken, agentUrl: wa.agentUrl }, { kind: "calendar", adminUrl: cal.adminUrl, adminToken: cal.adminToken, agentUrl: cal.agentUrl }],
    }, new Date());
    assert.deepEqual(facts.problems, []);
    const ctx = { dir: folder.root, now: () => new Date() } as unknown as Context;
    const done = await recordAgent(ctx, NAME, facts);
    assert.deepEqual(done.problems, []);
    const entries = JSON.parse(readFileSync(join(folder.root, "exports", NAME, "record.json"), "utf8")) as { action: string; outcome: string; refs: Record<string, string>; booking: string | null; notes: string }[];
    const has = (action: string, outcome: string) => entries.filter((e) => e.action === action && e.outcome === outcome);
    assert.equal(has("create_deposit_link", "confirmed").length, 1);
    assert.equal(has("record_deposit", "confirmed").length, 1, "Razorpay's own link shows the payment");
    assert.equal(has("confirm_booking", "confirmed").length, 1, "the calendar holds the event");
    assert.equal(has("refund", "held_for_owner").length, 1, "one hold, however many times the agent sent the call while it waited");
    assert.equal(has("owner_decision", "confirmed")[0].refs.command, "approve", "the owner's answer is Guard's, from the owner's signed reply");
    assert.equal(has("refund", "confirmed")[0].refs.refundId, refunds()[0].id, "the refund is the one Razorpay holds");
    assert.equal(has("refund", "blocked").length, 1, "the refund above one deposit, which Guard refused");
    assert.ok(has("send_message", "confirmed").length >= 2, "the agent's message to the customer and the relay's request to the owner");
    assert.ok(!JSON.stringify(entries).includes(CUSTOMER) && !JSON.stringify(entries).includes(OWNER), "no phone number in the record");

    // ---- the monthly report, from that record ---------------------------------------------------------------------------------------------------------
    const out = join(dir, "report");
    writeAgentReport(folder.root, NAME, { month, out, language: "en", source: "stand-in", now: Date.now() });
    const report = JSON.parse(readFileSync(join(out, `report-${month}.json`), "utf8")).document;
    assert.equal(report.pathway.name, "own-agent");
    assert.deepEqual(report.money.deposits, { count: 1, paise: 20000 });
    assert.equal(report.money.refunds.count, 1);
    assert.equal(report.money.refunds.paise, 20000);
    assert.deepEqual(report.owner, { asked: 1, approved: 1, denied: 0, retried: 0 }, "the report counts the refund the owner approved");
    assert.equal(report.bookings.made, 1);
    assert.equal(report.stopped.byRule["refund-limit"], 1, "and the one Guard refused");
    assert.equal(report.atReportTime.waitingForOwner, 0, "nothing is waiting for the owner now");
    assert.match(readFileSync(join(out, `owner-${month}-en.txt`), "utf8"), /refund/iu);
  } finally {
    for (const close of closers.reverse()) await close().catch(() => undefined);
    await standins.close(); rmSync(dir, { recursive: true, force: true }); folder.done();
  }
});
