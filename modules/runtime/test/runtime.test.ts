// The shared runtime, tried with a toy template instead of Bookings or Fees: its store fields, its services and its cases are given, and the shared code does the rest.
// (Bookings and Fees try the same code through their own agents; this is the part that does not need either.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fakeClock } from "../../core/clock.ts";
import { GuardSuspendedError } from "../../core/faults.ts";
import { createFakeMessaging } from "../../messaging/messaging.ts";
import { createRecord } from "../../record/record.ts";
import { BOOKINGS_SERVICES, FEES_SERVICES, readRuntimeConfig } from "../config.ts";
import { countRefunds, createRuntimeCore } from "../core.ts";
import { checkEvents, eventKey } from "../events.ts";
import { readRecordKey } from "../start.ts";
import { snapshotCodec } from "../snapshot.ts";
import { openStore } from "../store.ts";

interface Toy { orders: Map<string, { id: string; state: string; pending: { kind: string }[] }>; seen: Set<string>; next: number; started?: number; ai?: Record<string, unknown> }
const codec = snapshotCodec<Toy>(1, [{ name: "orders", kind: "map" }, { name: "seen", kind: "set" }, { name: "next", kind: "count" }, { name: "started", kind: "optional-number" }, { name: "ai", kind: "optional-ai" }]);

test("a snapshot writes the fields in the order given, reads them back, and refuses a format or a counter it cannot read", () => {
  const store: Toy = { orders: new Map([["o-2", { id: "o-2", state: "open", pending: [] }], ["o-1", { id: "o-1", state: "done", pending: [] }]]), seen: new Set(["b", "a"]), next: 3, started: 1234 };
  const json = codec.serialize(store);
  assert.deepEqual(Object.keys(JSON.parse(json)), ["format", "orders", "seen", "next", "started"], "the order is the order given, and a field that is not set is left out");
  const back = codec.parse(json);
  assert.deepEqual([...back.orders.keys()], ["o-2", "o-1"], "a Map keeps its order");
  assert.deepEqual([...back.seen], ["b", "a"]);
  assert.equal(back.started, 1234);
  assert.equal(codec.serialize(back), json);
  assert.notEqual(back.orders, store.orders, "nothing is shared with the store it was saved from");
  const bare = JSON.parse(json) as Record<string, unknown>;
  delete bare.started;
  assert.equal(codec.parse(JSON.stringify(bare)).started, undefined, "an optional field may be missing");
  for (const broken of [{ ...bare, format: 2 }, { ...bare, orders: {} }, { ...bare, next: "3" }, { ...bare, next: 1.5 }]) assert.throws(() => codec.parse(JSON.stringify(broken)), /not in a format this version can read/);
});

test("B69: a live runtime refuses to start without the record's key; a local run with stand-in services needs none; a key file that is not a key is refused", () => {
  assert.throws(() => readRecordKey("live", undefined), /RECORD_KEY_FILE/u);
  assert.equal(readRecordKey("fakes", undefined), undefined);
  const dir = mkdtempSync(join(tmpdir(), "geo-record-key-"));
  try {
    const good = join(dir, "good"); writeFileSync(good, `${"ab".repeat(32)}\n`);
    assert.deepEqual(readRecordKey("live", good), Buffer.alloc(32, 0xab));
    const bad = join(dir, "bad"); writeFileSync(bad, "not a key");
    assert.throws(() => readRecordKey("live", bad), /32 bytes/u);
    assert.throws(() => readRecordKey("fakes", join(dir, "absent")), /could not read/u, "a named file that is missing is a mistake, even locally");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a runtime config is read the same way for every template; only the services it must name differ", () => {
  const live = (services: Record<string, unknown>) => readRuntimeConfig({ mode: "live", services }, "/client", services.calendar ? BOOKINGS_SERVICES : FEES_SERVICES);
  const payments = { baseUrl: "http://g-payments:8080", agentTokenFile: "tokens/payments" };
  const messaging = { baseUrl: "http://g-messaging:8080", phoneNumberId: "123456789012345" };
  const fees = live({ payments, messaging, timeoutMs: 20000 });
  assert.ok(fees.ok);
  if (fees.ok) assert.equal((fees.config.services as any).payments.agentTokenFile, "/client/tokens/payments", "a relative credential file is measured from the client folder");
  assert.ok(live({ payments, calendar: { baseUrl: "http://g-calendar:8080", calendarId: "c@x" }, messaging }).ok);
  // the same services, read as Bookings: the calendar is missing, and said so
  const asBookings = readRuntimeConfig({ mode: "live", services: { payments, messaging } }, "/client", BOOKINGS_SERVICES);
  assert.ok(!asBookings.ok);
  if (!asBookings.ok) assert.ok(asBookings.errors.some((e) => /add "calendar" with its "baseUrl" and "calendarId"/.test(e)), asBookings.errors.join("|"));
  // a calendar given to a template that has none is an unknown setting, not silently kept
  const asFees = readRuntimeConfig({ mode: "live", services: { payments, messaging, calendar: { baseUrl: "http://g:1", calendarId: "c" } } }, "/client", FEES_SERVICES);
  assert.ok(!asFees.ok);
  if (!asFees.ok) assert.ok(asFees.errors.some((e) => /"calendar" means in services/.test(e)));
  assert.match((readRuntimeConfig({ mode: "live" }, "/client", FEES_SERVICES) as { errors: string[] }).errors[0], /payments and messaging/);
  assert.match((readRuntimeConfig({ mode: "live" }, "/client", BOOKINGS_SERVICES) as { errors: string[] }).errors[0], /payments, the calendar and messaging/);
  // the settings every template shares are accepted by both shapes
  for (const shape of [FEES_SERVICES, BOOKINGS_SERVICES]) assert.ok(readRuntimeConfig({ mode: "fakes", ai: "buttons", allowance: { messages: 100 }, pauseMinutes: 5, report: { preparedBy: "Divya, local partner", pageBaseUrl: "https://reports.example.com/r" } }, "/client", shape).ok);
});

test("events are checked for shape before anything is saved, and an event's key is its own id", () => {
  const ok = checkEvents({ events: [{ kind: "message", message: { id: "wamid.1", from: "+919800000000", text: "hello", timestamp: 1 } }, { kind: "approval_decision", approval: "ap-x-1", decision: "approve", id: "r1" }] });
  assert.ok(ok.ok);
  if (ok.ok) assert.deepEqual(ok.events.map(eventKey), ["message:wamid.1", "approval_decision:ap-x-1:approve:r1"]);
  for (const bad of [{}, { events: [] }, { events: [{ kind: "tick" }] }, { events: [{ kind: "message", message: { id: "x" } }] }, { events: [{ kind: "approval_decision", approval: "../etc", decision: "approve" }] }]) assert.ok(!checkEvents(bad).ok, JSON.stringify(bad));
});

test("refunds are counted the same way for any case that has a pending list", () => {
  const counts = countRefunds([
    { pending: [{ kind: "guard_hold" }, { kind: "waiver" }] },
    { pending: [{ kind: "refund_retry" }], refundIssues: [{ kind: "refused", paymentId: "pay_1", amountInr: 10, at: "x", note: "" } as never] },
    { pending: [] },
  ]);
  assert.deepEqual(counts, { waitingForOwner: 1, beingSentAgain: 1, needBuilder: { refused: 1, total: 1 } });
});

test("a runtime core over a toy template saves each step whole, runs events one at a time, and picks up a saved task after a restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "geo-runtime-core-"));
  const clock = fakeClock(Date.parse("2026-11-02T04:30:00Z"));
  const messaging = createFakeMessaging(clock);
  const seen: string[] = [];
  const open = () => {
    const db = openStore(join(dir, "data"));
    const runtime = createRuntimeCore<Toy, { timezone: string }, never>({
      settings: { timezone: "Asia/Kolkata" }, store: db, clock, messaging, pathwayVersion: "0.0.1", retryDelaysMs: [0],
      kit: {
        pathway: "toy", casesName: "orders",
        createStore: () => ({ orders: new Map(), seen: new Set(), next: 1 }), serialize: codec.serialize, parse: codec.parse,
        createAgent: ({ store, record }) => ({
          async handle(event) {
            if (event.kind !== "message") return;
            seen.push(event.message.text);
            const id = `o-${store.next++}`;
            store.orders.set(id, { id, state: "open", pending: [] });
            record.append({ conversation: event.message.from, booking: id, action: "receive_message", inputs: {}, outcome: "confirmed", language: "en" });
          },
        }),
        countCases: (store) => Object.fromEntries([...store.orders.values()].map((o) => [o.state, 1])), casesOf: (store) => store.orders.values(), refundContext: () => null,
      },
    });
    return { runtime, db };
  };
  try {
    const first = open();
    const message = (text: string, id: string) => ({ kind: "message" as const, message: { id, from: "+919800000000", text, timestamp: clock.now() } });
    first.runtime.submit([message("one", "m1"), message("two", "m2")]);
    first.runtime.kick();
    await first.runtime.idle();
    assert.deepEqual(seen, ["one", "two"]);
    assert.deepEqual(first.runtime.status().orders, { open: 1 });
    assert.equal((first.runtime.status() as { refunds: unknown }).refunds !== undefined, true);
    first.runtime.submit([message("three", "m3")]); // saved, never run: the process dies here
    first.db.close();
    const second = open();
    assert.equal(second.runtime.status().tasks.pending, 1);
    second.runtime.kick();
    await second.runtime.idle();
    assert.deepEqual(seen, ["one", "two", "three"]);
    assert.equal(second.db.loadState().record.length, 3, "the record came back whole and grew");
    assert.equal(codec.parse(second.db.loadState().snapshot!).next, 4, "the counter survived the restart: the next order is o-4");
    assert.deepEqual(second.runtime.submit([message("one", "m1")]), { saved: 0, duplicates: 1 });
    assert.equal(createRecord(clock, second.db.loadState().record).entries().length, 3);
    await second.runtime.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a step that Guard refused for the shop's licence (402) is not tried again: it would be refused the same way, and nothing is kept to do later", async () => {
  const dir = mkdtempSync(join(tmpdir(), "geo-runtime-licence-"));
  const clock = fakeClock(Date.parse("2026-11-02T04:30:00Z"));
  let tries = 0;
  const db = openStore(join(dir, "data"));
  const runtime = createRuntimeCore<Toy, { timezone: string }, never>({
    settings: { timezone: "Asia/Kolkata" }, store: db, clock, messaging: createFakeMessaging(clock), pathwayVersion: "0.0.1", retryDelaysMs: [0, 0, 0],
    kit: {
      pathway: "toy", casesName: "orders",
      createStore: () => ({ orders: new Map(), seen: new Set(), next: 1 }), serialize: codec.serialize, parse: codec.parse,
      createAgent: () => ({
        async handle() {
          tries++;
          throw new GuardSuspendedError(402, "refused by the Guard: subscription_suspended: the licence for shop toy is in its wind-down", { decision: "deny", code: "subscription_suspended", reason_code: "subscription_suspended", sent: "no", retry: "no" }, { method: "POST", path: "/v1/payment_links" });
        },
      }),
      countCases: () => ({}), casesOf: (store) => store.orders.values(), refundContext: () => null,
    },
  });
  try {
    runtime.submit([{ kind: "message" as const, message: { id: "m1", from: "+919800000000", text: "book", timestamp: clock.now() } }]);
    runtime.kick();
    await runtime.idle();
    assert.equal(tries, 1, "tried once, where anything else would have three more tries");
    assert.deepEqual(runtime.status().tasks, { pending: 0, done: 0, failed: 1 });
    await runtime.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("after a restore from a snapshot the runtime moves every id counter on and writes one `restored` entry before any step, once; nothing else of the store changes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "geo-runtime-restored-"));
  const clock = fakeClock(Date.parse("2026-11-05T04:30:00Z"));
  const lines: string[] = [];
  const open = () => {
    const db = openStore(join(dir, "data"));
    const runtime = createRuntimeCore<Toy, { timezone: string; owner: { whatsapp: string; language: "en" } }, never>({
      settings: { timezone: "Asia/Kolkata", owner: { whatsapp: "+919800000001", language: "en" } }, store: db, clock, messaging: createFakeMessaging(clock), pathwayVersion: "0.0.1", retryDelaysMs: [0], log: (l) => lines.push(l),
      kit: {
        pathway: "toy", casesName: "orders",
        createStore: () => ({ orders: new Map(), seen: new Set(), next: 1 }), serialize: codec.serialize, parse: codec.parse, skipCounters: codec.skipCounters,
        createAgent: ({ store, record }) => ({ async handle(event) { if (event.kind !== "message") return; const id = `o-${store.next++}`; store.orders.set(id, { id, state: "open", pending: [] }); record.append({ conversation: event.message.from, booking: id, action: "receive_message", inputs: {}, outcome: "confirmed", language: "en" }); } }),
        countCases: () => ({}), casesOf: (store) => store.orders.values(), refundContext: () => null,
      },
    });
    return { runtime, db };
  };
  const note = JSON.stringify({ snapshot: "20261104T013000Z", restoredAt: "2026-11-05T04:00:00.000Z", lastSeq: 1 });
  try {
    const moved = JSON.parse(codec.skipCounters(codec.serialize({ orders: new Map(), seen: new Set(["a"]), next: 7, started: 5 }), 100_000));
    assert.deepEqual([moved.next, moved.seen, moved.started], [100_007, ["a"], 5], "a count moves; nothing else does");
    const first = open();
    first.runtime.submit([{ kind: "message" as const, message: { id: "m1", from: "+919800000000", text: "x", timestamp: clock.now() } }]);
    first.runtime.kick(); await first.runtime.idle(); await first.runtime.close();
    writeFileSync(join(dir, "data", "restored.json"), note);
    const second = open();
    const saved = second.db.loadState();
    assert.equal(codec.parse(saved.snapshot!).next, 100_002, "the next order is o-100002, not o-2, which may have been used after the snapshot");
    assert.deepEqual(saved.record.map((e) => [e.seq, e.action, e.outcome]), [[1, "receive_message", "confirmed"], [2, "restored", "confirmed"]]);
    assert.deepEqual(saved.record[1].refs, { snapshot: "20261104T013000Z", restoredAt: "2026-11-05T04:00:00.000Z", idGap: "100000" });
    assert.equal(saved.record[1].conversation, "+919800000001");
    assert.match(lines.join("\n"), /Restored from the snapshot of 20261104T013000Z: ids moved on by 100000/);
    assert.ok(!existsSync(join(dir, "data", "restored.json")) && readdirSync(join(dir, "data")).some((f) => f.startsWith("restored.json.done-")), "the note is kept under another name");
    second.runtime.submit([{ kind: "message" as const, message: { id: "m2", from: "+919800000000", text: "y", timestamp: clock.now() } }]);
    second.runtime.kick(); await second.runtime.idle();
    assert.equal(second.db.loadState().record.at(-1)!.booking, "o-100002");
    await second.runtime.close();
    // the process stopped after the entry was saved but before the note was renamed: the next start does not move the ids again
    writeFileSync(join(dir, "data", "restored.json"), note);
    const third = open();
    assert.equal(codec.parse(third.db.loadState().snapshot!).next, 100_003);
    assert.equal(third.db.loadState().record.filter((e) => e.action === "restored").length, 1);
    await third.runtime.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("once a day the text of a conversation that ended more than 30 days ago is deleted (a failed message's words, a template's words on a finished case); the record is kept whole", async () => {
  const dir = mkdtempSync(join(tmpdir(), "geo-runtime-compact-"));
  const clock = fakeClock(Date.parse("2026-11-02T04:30:00Z"));
  const compacted: number[] = [];
  const db = openStore(join(dir, "data"));
  const runtime = createRuntimeCore<Toy, { timezone: string }, never>({
    settings: { timezone: "Asia/Kolkata" }, store: db, clock, messaging: createFakeMessaging(clock), pathwayVersion: "0.0.1", retryDelaysMs: [0],
    kit: {
      pathway: "toy", casesName: "orders",
      createStore: () => ({ orders: new Map(), seen: new Set(), next: 1 }), serialize: codec.serialize, parse: codec.parse,
      createAgent: ({ store, record }) => ({
        async handle(event) {
          if (event.kind !== "message") return;
          if (event.message.text.startsWith("bad")) throw new Error("the agent could not read this");
          const id = `o-${store.next++}`; store.orders.set(id, { id, state: "done", pending: [] });
          record.append({ conversation: event.message.from, booking: id, action: "receive_message", inputs: { text: event.message.text }, outcome: "confirmed", language: "en" });
        },
      }),
      countCases: () => ({}), casesOf: (store) => store.orders.values(), refundContext: () => null,
      compactStore: (_store, before) => { compacted.push(before); return 0; },
    },
  });
  const payloads = () => { const read = new DatabaseSync(db.file, { readOnly: true }); try { return read.prepare("SELECT id, state, payload FROM tasks ORDER BY seq").all() as { id: string; state: string; payload: string }[]; } finally { read.close(); } };
  try {
    runtime.submit([{ kind: "message" as const, message: { id: "m1", from: "+919800000000", text: "bad: my address is 12 MG Road", timestamp: clock.now() } }, { kind: "message" as const, message: { id: "m2", from: "+919800000000", text: "fine", timestamp: clock.now() } }]);
    runtime.kick(); await runtime.idle();
    assert.deepEqual(payloads().map((t) => [t.id, t.state, t.payload.includes("MG Road")]), [["message:m1", "failed", true], ["message:m2", "done", false]], "a failed message keeps its words for a person to look at; a done one never does");
    await runtime.tick();
    assert.equal(compacted.length, 1, "the first beat compacts");
    assert.equal(payloads()[0].payload.includes("MG Road"), true, "a day old: kept");
    clock.advance(12 * 3_600_000); await runtime.tick();
    assert.equal(compacted.length, 1, "not again within the day");
    clock.advance(31 * 24 * 3_600_000); await runtime.tick();
    assert.equal(compacted.length, 2);
    assert.equal(compacted[1], clock.now() - 30 * 24 * 3_600_000, "the template is asked about cases that ended 30 days ago");
    assert.deepEqual(payloads().map((t) => [t.id, t.state, t.payload]), [["message:m1", "failed", "{}"], ["message:m2", "done", "{}"]], "the words are gone; what happened (the task, its state) stays");
    assert.equal(db.loadState().record.length, 1, "the record is untouched");
    await runtime.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
