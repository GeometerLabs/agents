// The shared runtime, tried with a toy template instead of Bookings or Fees: its store fields, its services and its cases are given, and the shared code does the rest.
// (Bookings and Fees try the same code through their own agents; this is the part that does not need either.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeClock } from "../../core/clock.ts";
import { createFakeMessaging } from "../../messaging/messaging.ts";
import { createRecord } from "../../record/record.ts";
import { BOOKINGS_SERVICES, FEES_SERVICES, readRuntimeConfig } from "../config.ts";
import { countRefunds, createRuntimeCore } from "../core.ts";
import { checkEvents, eventKey } from "../events.ts";
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
