// WhatsApp's later reports on what a shop sent (item 11b): reading Meta's and Gupshup's v3 status callbacks and Gupshup's v3 messages from their documented
// examples (fixtures/README.md), checking them as runtime events, recording each against the message it is about, the owner's to-do item for a failure the shop
// counted on, the inbox forwarding them, and a runtime core that records them without handing them to the agent. Nothing here touches a real service.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeClock } from "../../core/clock.ts";
import { HOUR } from "../../core/time.ts";
import { createFakeMessaging } from "../messaging.ts";
import type { MessageStatus } from "../messaging.ts";
import { recordMessageStatus } from "../statuses.ts";
import { parseWhatsAppStatuses, parseWhatsAppWebhook } from "../webhooks.ts";
import { createRecord } from "../../record/record.ts";
import { messageFingerprint } from "../../record/fingerprint.ts";
import { checkEvents, eventKey } from "../../runtime/events.ts";
import { createRuntimeCore } from "../../runtime/core.ts";
import { snapshotCodec } from "../../runtime/snapshot.ts";
import { openStore } from "../../runtime/store.ts";
import { inboxHandler } from "../../inbox/server.ts";
import { DEFAULT_OPTIONS, obligations } from "../../unfinished/index.ts";

const fixture = (name: string): any => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const bookingsFixture = (name: string): any => JSON.parse(readFileSync(new URL(`../../../templates/commerce/bookings/test/fixtures/${name}`, import.meta.url), "utf8"));
const CUSTOMER = "+919800000001";
const OWNER = "+919800000009";
const APPROVER = "+919800000002";
const T0 = Date.parse("2026-11-11T05:00:00Z");

// ---- reading the callbacks -----------------------------------------------------------------------------------------------------

test("Gupshup v3 statuses: delivered, read and failed are kept with both ids; enqueued, sent and the set-callback check give nothing; times in seconds or milliseconds", () => {
  for (const nothing of ["gupshup-v3-status-set-callback.json", "gupshup-v3-status-enqueued.json", "gupshup-v3-status-sent.json"]) assert.deepEqual(parseWhatsAppStatuses(fixture(nothing)), [], nothing);
  assert.deepEqual(parseWhatsAppStatuses(fixture("gupshup-v3-status-delivered.json")), [{ ids: ["7daeb742-f2dc-4c09-90e0-d879d20f7b98", "wamid.HBgMOTE5MTYzODA1ODczFQIAERgSMDQ4Rj"], status: "delivered", to: CUSTOMER, timestamp: 1710930462000 }]);
  assert.deepEqual(parseWhatsAppStatuses(fixture("gupshup-v3-status-read.json")), [{ ids: ["7b8f0910-db98-4cce-be5f-e6e1e847b4bd", "wamid.HBgMOTE5MTYzODA1ODczFQIAERgSMUUzNz"], status: "read", to: CUSTOMER, timestamp: 1720779817000 }]);
  assert.deepEqual(parseWhatsAppStatuses(fixture("gupshup-v3-status-failed.json")), [{ ids: ["91f58e90-f5ba-4cfc-9ca7-e4ab965b9449", "wamid.HBgMOTE3OTgwODkwOTc4FQIAERgSNERF"], status: "failed", to: CUSTOMER, timestamp: 1710941507000, error: { code: 131047, title: "Message failed to send..." } }]);
  assert.deepEqual(parseWhatsAppStatuses(fixture("gupshup-v3-status-failed-internal.json")), [{ ids: ["ad6b9f16-33ce-4405-9abd-5f90f88195c8"], status: "failed", to: CUSTOMER, timestamp: 1725367035088, error: { code: 4003, title: "Message Sending failed as template did not match" } }], "Gupshup's own refusal: no wamid, a time in milliseconds");
  assert.deepEqual(parseWhatsAppStatuses(fixture("gupshup-v3-status-read-passthrough.json"))[0].ids, ["3de985af-d06e-41e1-acaf-c379b429668a", "fc46fadf-5075-4bb6-9cff-f3ff8c6f6478"], "the pass-through page's second UUID is kept too");
  for (const f of ["gupshup-v3-status-delivered.json", "gupshup-v3-status-failed.json"]) assert.deepEqual(parseWhatsAppWebhook(fixture(f)), [], "a status is not a message");
});

test("Meta's own statuses read the same way: one wamid, the recipient, the error's code and title and never its details", () => {
  assert.deepEqual(parseWhatsAppStatuses(bookingsFixture("whatsapp-webhook-status-delivered.json")), [{ ids: ["wamid.HBgLMTY1MDM4Nzk0MzkVAgARGBI3MTE5MjVBOTE3MDk5QUVFM0YA"], status: "delivered", to: "+16505551234", timestamp: 1750263773000 }]);
  assert.deepEqual(parseWhatsAppStatuses(fixture("meta-status-failed.json")), [{ ids: ["wamid.HBgLMTY1MDM4Nzk0MzkVAgARGBI0QUQ2MjA4NEYyRkExNjMyREUA"], status: "failed", to: "+16505551234", timestamp: 1751142888000, error: { code: 131049, title: "This message was not delivered to maintain healthy ecosystem engagement." } }]);
  const played = bookingsFixture("whatsapp-webhook-status-delivered.json");
  played.entry[0].changes[0].value.statuses[0].status = "played";
  assert.deepEqual(parseWhatsAppStatuses(played), [], "a voice message played: not one of the three");
  const odd = bookingsFixture("whatsapp-webhook-status-delivered.json");
  odd.entry[0].changes[0].value.statuses[0].id = "wamid.x y\n";
  assert.deepEqual(parseWhatsAppStatuses(odd), [], "an id that could confuse a key or a log line is dropped");
  for (const junk of [null, 5, [], {}, { entry: "x" }, { entry: [{ changes: [{ field: "statuses", value: { statuses: [{ id: "a", status: "read" }] } }] }] }]) assert.deepEqual(parseWhatsAppStatuses(junk), []);
});

test("Gupshup v3 messages map to the same inbound messages the templates read: text, a voice note and a picture as facts only, and an interactive we do not use is left out", () => {
  assert.deepEqual(parseWhatsAppWebhook(fixture("gupshup-v3-message-text.json")), [{ id: "wamid.HBgMOTE5OTcwNzU0NDQ0FQIAEhgUM0E1NjIzMTY1N0VGNUE5NjY1M0EA", from: CUSTOMER, text: "Hi", timestamp: 1705574871000 }]);
  assert.deepEqual(parseWhatsAppWebhook(fixture("gupshup-v3-message-audio.json")), [{ id: "wamid.HBgMOTE3NTA2MDgwNDgwFQIAEhgUM0E2QjQ5NUUyMUZDQzg2MDJEMjEA", from: CUSTOMER, text: "", timestamp: 1782372953000, voiceNote: true }], "no media id, no Gupshup file link");
  assert.deepEqual(parseWhatsAppWebhook(fixture("gupshup-v3-message-image.json")), [{ id: "wamid.HBgMOTE3NTA2MDgwNDgwFQIAEhgUM0FGQkI0QTUyM0NCNjlCMkNBNkMA", from: CUSTOMER, text: "", timestamp: 1782372910000, image: true }]);
  assert.deepEqual(parseWhatsAppWebhook(fixture("gupshup-v3-message-call-permission-reply.json")), []);
  // Gupshup documents no v3 example of a tapped button or list row: Meta's own, inside Gupshup's envelope (fixtures/README.md)
  for (const [name, id, kind] of [["whatsapp-webhook-button-reply.json", "button", "button"], ["whatsapp-webhook-list-reply.json", "list", "list"]] as const) {
    const body = { ...bookingsFixture(name), gs_app_id: "82ed52f4-30c0-4f12-81b4-e7ad07bd41de" };
    const [m] = parseWhatsAppWebhook(body);
    assert.equal(m.reply?.kind, kind, id);
    assert.deepEqual(parseWhatsAppWebhook(bookingsFixture(name)), [m], "the envelope changes nothing");
  }
});

// ---- the runtime event ---------------------------------------------------------------------------------------------------------

test("a message_status event is checked for shape, and its key makes the same report sent again one, while delivered and read are two", () => {
  const delivered = { kind: "message_status", status: { ids: ["gs-1", "wamid.A"], status: "delivered", to: CUSTOMER, timestamp: T0 } };
  const ok = checkEvents({ events: [delivered, { ...delivered, status: { ...delivered.status, status: "failed", error: { code: 131047, title: "Message failed to send..." } } }] });
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.deepEqual(ok.events[0], delivered);
    assert.notEqual(eventKey(ok.events[0]), eventKey(ok.events[1]));
    assert.equal(eventKey(ok.events[0]), eventKey(checkEvents({ events: [delivered] }).ok ? (checkEvents({ events: [delivered] }) as any).events[0] : null));
    assert.equal(eventKey(ok.events[0]), "message_status:gs-1|wamid.A:delivered");
  }
  for (const bad of [
    { ...delivered.status, ids: [] }, { ...delivered.status, ids: ["a", "b", "c", "d"] }, { ...delivered.status, ids: ["a b"] }, { ...delivered.status, status: "sent" },
    { ...delivered.status, timestamp: "1" }, { ...delivered.status, to: "919800000001" }, { ...delivered.status, error: { code: 1 } },
    { ...delivered.status, status: "failed", error: { code: 1.5 } }, { ...delivered.status, status: "failed", error: { title: "x".repeat(201) } },
  ]) assert.equal(checkEvents({ events: [{ kind: "message_status", status: bad }] }).ok, false, JSON.stringify(bad));
  const checked = checkEvents({ events: [{ kind: "message_status", status: { ...delivered.status, extra: "dropped" } }] });
  assert.ok(checked.ok && !("extra" in (checked.events[0] as any).status), "only the known fields go on");
});

// ---- the record and the to-do list -----------------------------------------------------------------------------------------------

const KEY = Buffer.alloc(32, 7);
const ctx = { owner: { whatsapp: OWNER, language: "hi" as const }, approvers: [APPROVER], recordKey: KEY };
const failed = (ids: string[], to?: string, code = 131047): MessageStatus => ({ ids, status: "failed", ...(to ? { to } : {}), timestamp: T0, error: { code, title: "Message failed to send..." } });
const listed = (entries: ReturnType<ReturnType<typeof createRecord>["entries"]>, nowMs: number) => obligations.detect({ template: "bookings", entries, cases: [], nowMs, options: DEFAULT_OPTIONS }).found.filter((o) => o.kind === "message_not_delivered");

test("a failed report on a booking's confirmation is recorded against that send line, in words that keep accepted and delivered apart, and the owner's to-do list shows it", () => {
  const clock = fakeClock(T0);
  const record = createRecord(clock, [], { key: KEY });
  record.append({ conversation: CUSTOMER, booking: "b-3", action: "send_message", inputs: {}, outcome: "confirmed", language: "ml", refs: { messageId: "91f58e90-f5ba-4cfc-9ca7-e4ab965b9449", to: "customer", templates: "confirmed" } });
  const [status] = parseWhatsAppStatuses(fixture("gupshup-v3-status-failed.json"));
  const line = recordMessageStatus(record, status, ctx)!;
  assert.deepEqual([line.action, line.outcome, line.booking, line.conversation, line.language], ["message_status", "failed", "b-3", CUSTOMER, "ml"]);
  assert.deepEqual(line.refs, { messageId: messageFingerprint(KEY, "91f58e90-f5ba-4cfc-9ca7-e4ab965b9449"), status: "failed", to: "customer", sent: "1", reportedAt: "2024-03-20T13:31:47.000Z", errorCode: "131047" });
  assert.equal(line.refs.messageId, record.entries()[0].refs.messageId, "the same fingerprint as the send line");
  assert.match(line.notes, /never reached the person's phone, although it was accepted when it was sent/);
  assert.match(line.notes, /Nothing is sent again by itself/);
  assert.match(line.notes, /to-do list/);
  assert.ok(!JSON.stringify(line.refs).includes("9800000001"), "no number in the refs");
  const items = listed(record.entries(), T0 + HOUR);
  assert.deepEqual(items.map((o) => [o.caseId, o.facts, o.actions]), [["b-3", { case: "b-3", to: "customer", code: 131047 }, []]], "no action: nothing re-sends it");
  assert.deepEqual(listed(record.entries(), T0 + 8 * 24 * HOUR), [], "it leaves by age, like message_unanswered");
});

test("delivered and read are recorded as confirmed with their own words; the same report twice is one line; the second id finds the send line too", () => {
  const record = createRecord(fakeClock(T0), []);
  record.append({ conversation: CUSTOMER, booking: "b-1", action: "send_message", inputs: {}, outcome: "confirmed", language: "en", refs: { messageId: "fc46fadf-5075-4bb6-9cff-f3ff8c6f6478", to: "customer" } });
  const [read] = parseWhatsAppStatuses(fixture("gupshup-v3-status-read-passthrough.json")); // gs_id is another id; `id` is the one the send gave
  const delivered: MessageStatus = { ...read, status: "delivered" };
  const d = recordMessageStatus(record, delivered)!;
  assert.deepEqual([d.outcome, d.refs.sent, d.refs.messageId], ["confirmed", "1", "fc46fadf-5075-4bb6-9cff-f3ff8c6f6478"]);
  assert.match(d.notes, /delivered to the person's phone\. When it was sent, WhatsApp had only accepted it/);
  assert.equal(recordMessageStatus(record, { ...delivered, ids: [...delivered.ids].reverse() }), undefined, "the same report again, ids in another order: no second line");
  const r = recordMessageStatus(record, read)!;
  assert.deepEqual([r.outcome, r.refs.status], ["confirmed", "read"]);
  assert.match(r.notes, /read on the person's phone/);
  assert.equal(record.entries().length, 3);
  assert.deepEqual(listed(record.entries(), T0), [], "nothing to do when a message arrived");
});

test("a failure on a message no line of the record sent is still kept: to the owner or an approver it is listed (the relay asks them itself), to someone else with no case it is not", () => {
  const record = createRecord(fakeClock(T0), [], { key: KEY });
  const owner = recordMessageStatus(record, failed(["gs-owner"], OWNER), ctx)!;
  const approver = recordMessageStatus(record, failed(["gs-approver"], APPROVER), ctx)!;
  const stranger = recordMessageStatus(record, failed(["gs-stranger"], CUSTOMER), ctx)!;
  const nobody = recordMessageStatus(record, failed(["gs-internal"]), ctx)!;
  assert.deepEqual([owner.refs.to, approver.refs.to, stranger.refs.to, nobody.refs.to], ["owner", "approver", "customer", "unknown"]);
  assert.deepEqual([owner.booking, owner.conversation, owner.language], [null, OWNER, "hi"], "the owner's language when there is no send line to copy it from");
  assert.match(owner.notes, /No line in this record sent a message with this id: .*approvals relay/);
  assert.equal(owner.refs.sent, undefined);
  assert.deepEqual(listed(record.entries(), T0).map((o) => [o.caseId, o.facts.to]), [[`#${owner.seq}`, "owner"], [`#${approver.seq}`, "approver"]]);
  // a send line to the owner (the monthly report) with no `to` ref is the owner's by its conversation
  const r2 = createRecord(fakeClock(T0), []);
  r2.append({ conversation: OWNER, action: "send_message", inputs: { to: "owner" }, outcome: "confirmed", language: "en", refs: { messageId: "gs-report", report: "2026-10" } });
  assert.equal(recordMessageStatus(r2, failed(["gs-report"]), { owner: ctx.owner, approvers: ctx.approvers })!.refs.to, "owner", "a record with no key keeps ids as they are, and so are they looked for");
});

// ---- the inbox ---------------------------------------------------------------------------------------------------------------

test("the inbox forwards Gupshup's reports as message_status in path-token mode, checks the app id when it is named, and answers the set-callback check with nothing to forward", async () => {
  const received: unknown[] = [];
  const runtime = createServer((req, res) => { let raw = ""; req.on("data", (c) => { raw += c; }); req.on("end", () => { received.push(...JSON.parse(raw).events); res.writeHead(200).end("{}"); }); });
  await new Promise<void>((resolve) => runtime.listen(0, "127.0.0.1", resolve));
  const TOKEN = "Zk3-mQ9_vT7xLp2Rw8YdNa5c";
  const inbox = createServer(inboxHandler({
    runtimeUrl: `http://127.0.0.1:${(runtime.address() as { port: number }).port}`, internalToken: "internal-token-1", razorpayWebhookSecret: "razorpay-secret-1",
    whatsappVerification: "path-token", whatsappPathToken: TOKEN, whatsappAppId: "82ed52f4-30c0-4f12-81b4-e7ad07bd41de", log: () => undefined,
  }));
  await new Promise<void>((resolve) => inbox.listen(0, "127.0.0.1", resolve));
  const post = async (body: unknown) => {
    const r = await fetch(`http://127.0.0.1:${(inbox.address() as { port: number }).port}/webhooks/whatsapp/${TOKEN}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return [r.status, await r.json()];
  };
  try {
    assert.deepEqual(await post(fixture("gupshup-v3-status-set-callback.json")), [200, { forwarded: 0 }]);
    assert.deepEqual(await post(fixture("gupshup-v3-status-sent.json")), [200, { forwarded: 0 }]);
    assert.deepEqual(await post(fixture("gupshup-v3-status-failed.json")), [200, { forwarded: 1 }]);
    assert.deepEqual(await post(fixture("gupshup-v3-status-failed-internal.json")), [200, { forwarded: 1 }], "no gs_app_id at all: Gupshup's own early failure still comes in");
    assert.deepEqual(await post({ ...fixture("gupshup-v3-status-delivered.json"), gs_app_id: "another-app-0000" }), [200, { forwarded: 0 }], "another app's report is not this shop's");
    assert.deepEqual(received.map((e: any) => [e.kind, e.status.status, e.status.ids[0]]), [["message_status", "failed", "91f58e90-f5ba-4cfc-9ca7-e4ab965b9449"], ["message_status", "failed", "ad6b9f16-33ce-4405-9abd-5f90f88195c8"]]);
    assert.ok(checkEvents({ events: received }).ok, "what the inbox sends, the runtime takes");
  } finally {
    inbox.closeAllConnections(); runtime.closeAllConnections();
    await Promise.all([new Promise((r) => inbox.close(r)), new Promise((r) => runtime.close(r))]);
  }
});

// ---- the runtime core --------------------------------------------------------------------------------------------------------

test("a runtime core records a status without handing it to the agent, saves it with its task, and keeps the window shut (a report is not the person writing)", async () => {
  interface Toy { orders: Map<string, { id: string; state: string; pending: { kind: string }[] }>; next: number }
  const codec = snapshotCodec<Toy>(1, [{ name: "orders", kind: "map" }, { name: "next", kind: "count" }]);
  const dir = mkdtempSync(join(tmpdir(), "geo-status-core-"));
  const clock = fakeClock(T0);
  const handled: string[] = [];
  const db = openStore(join(dir, "data"));
  const runtime = createRuntimeCore<Toy, { timezone: string; owner: { whatsapp: string; language: "en" } }, never>({
    settings: { timezone: "Asia/Kolkata", owner: { whatsapp: OWNER, language: "en" } }, store: db, clock, messaging: createFakeMessaging(clock), pathwayVersion: "0.0.1", retryDelaysMs: [0], recordKey: KEY,
    kit: {
      pathway: "toy", casesName: "orders",
      createStore: () => ({ orders: new Map(), next: 1 }), serialize: codec.serialize, parse: codec.parse,
      createAgent: () => ({ async handle(event) { handled.push(event.kind); } }),
      countCases: () => ({}), casesOf: (store) => store.orders.values(), refundContext: () => null,
    },
  });
  try {
    const status = { kind: "message_status" as const, status: failed(["gs-owner-ask"], OWNER) };
    assert.deepEqual(runtime.submit([status, status]), { saved: 1, duplicates: 1 });
    runtime.kick();
    await runtime.idle();
    assert.deepEqual(handled, [], "the agent never saw it");
    const record = db.loadState().record;
    assert.deepEqual(record.map((e) => [e.action, e.outcome, e.refs.to]), [["message_status", "failed", "owner"]]);
    assert.equal(record[0].refs.messageId, messageFingerprint(KEY, "gs-owner-ask"), "kept as a fingerprint under the shop's key");
    assert.equal(runtime.window.lastInboundAt(OWNER), undefined, "a report does not open the owner's 24-hour window");
    assert.equal(runtime.status().tasks.pending, 0);
  } finally { await runtime.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("a runtime too old to know delivery reports (a shop pinned to an earlier version) refuses them with a 400: the messages still go in, the reports are dropped and said once, and the provider is not made to retry for ever", async () => {
  const batchesSeen: string[][] = [];
  const runtime = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      const kinds = (JSON.parse(raw).events as { kind: string }[]).map((e) => e.kind);
      batchesSeen.push(kinds);
      res.writeHead(kinds.includes("message_status") ? 400 : 200).end("{}"); // what an older checkEvents answers: the whole request refused
    });
  });
  await new Promise<void>((resolve) => runtime.listen(0, "127.0.0.1", resolve));
  const logs: string[] = [];
  const TOKEN = "Zk3-mQ9_vT7xLp2Rw8YdNa5c";
  const inbox = createServer(inboxHandler({
    runtimeUrl: `http://127.0.0.1:${(runtime.address() as { port: number }).port}`, internalToken: "internal-token-1", razorpayWebhookSecret: "razorpay-secret-1",
    whatsappVerification: "path-token", whatsappPathToken: TOKEN, whatsappPhoneNumberId: "105523045970845", log: (l) => logs.push(l),
  }));
  await new Promise<void>((resolve) => inbox.listen(0, "127.0.0.1", resolve));
  const post = async (body: unknown) => {
    const r = await fetch(`http://127.0.0.1:${(inbox.address() as { port: number }).port}/webhooks/whatsapp/${TOKEN}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return [r.status, await r.json()];
  };
  try {
    // one body with a customer's picture and a report on what the shop sent: the message goes first and alone, then the report
    const both = fixture("gupshup-v3-message-image.json");
    both.entry[0].changes[0].value.statuses = fixture("gupshup-v3-status-delivered.json").entry[0].changes[0].value.statuses;
    assert.deepEqual(await post(both), [200, { forwarded: 2 }]);
    assert.deepEqual(batchesSeen, [["message"], ["message_status"]]);
    assert.ok(logs.some((l) => /refused 1 WhatsApp delivery report\(s\).*dropped/.test(l)), logs.join("\n"));
    // a body for another number is answered 200, and the log says why rather than "nothing to forward"
    assert.deepEqual(await post(fixture("gupshup-v3-status-failed.json")), [200, { forwarded: 0 }]);
    assert.ok(logs.some((l) => /not forwarded: it names another WhatsApp number id/.test(l)), logs.join("\n"));
    assert.ok(!logs.join("\n").includes(TOKEN));
  } finally {
    inbox.closeAllConnections(); runtime.closeAllConnections();
    await Promise.all([new Promise((r) => inbox.close(r)), new Promise((r) => runtime.close(r))]);
  }
});
