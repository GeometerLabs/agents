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
import { BOOKINGS_SERVICES, FEES_SERVICES, loadClientFolder, readRuntimeConfig } from "../config.ts";
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
  // the same services, read as Bookings: since B72 runtime.json may leave the calendar out (a shop on its own booking list has none), as a UPI shop leaves out
  // payments; whether this shop needs one is decided by loadClientFolder from settings.json (checked below), not here
  assert.ok(readRuntimeConfig({ mode: "live", services: { payments, messaging } }, "/client", BOOKINGS_SERVICES).ok);
  // a calendar that is named still needs its calendar id
  const noId = readRuntimeConfig({ mode: "live", services: { payments, messaging, calendar: { baseUrl: "http://g-calendar:8080" } } }, "/client", BOOKINGS_SERVICES);
  assert.ok(!noId.ok);
  if (!noId.ok) assert.ok(noId.errors.some((e) => /calendarId/u.test(e)), noId.errors.join("|"));
  // a calendar given to a template that has none is an unknown setting, not silently kept
  const asFees = readRuntimeConfig({ mode: "live", services: { payments, messaging, calendar: { baseUrl: "http://g:1", calendarId: "c" } } }, "/client", FEES_SERVICES);
  assert.ok(!asFees.ok);
  if (!asFees.ok) assert.ok(asFees.errors.some((e) => /"calendar" means in services/.test(e)));
  // item 11h: push is one of the services too, and (like WhatsApp) one a shop may lack
  assert.match((readRuntimeConfig({ mode: "live" }, "/client", FEES_SERVICES) as { errors: string[] }).errors[0], /payments, messaging and push/);
  assert.match((readRuntimeConfig({ mode: "live" }, "/client", BOOKINGS_SERVICES) as { errors: string[] }).errors[0], /payments, the calendar, messaging and push/);
  assert.ok(readRuntimeConfig({ mode: "live", services: { payments } }, "/client", FEES_SERVICES).ok, "a shop with no WhatsApp and no push Guard: runtime.json names neither");
  assert.ok(readRuntimeConfig({ mode: "live", services: { push: { baseUrl: "http://g-push:8080" } } }, "/client", BOOKINGS_SERVICES).ok, "a UPI shop on its own booking list with no WhatsApp: its push Guard alone");
  // the settings every template shares are accepted by both shapes
  for (const shape of [FEES_SERVICES, BOOKINGS_SERVICES]) assert.ok(readRuntimeConfig({ mode: "fakes", ai: "buttons", allowance: { messages: 100 }, pauseMinutes: 5, report: { preparedBy: "Divya, local Operator", pageBaseUrl: "https://reports.example.com/r" } }, "/client", shape).ok);
});

test("B72: a Google Calendar shop (settings say nothing, or google) in live mode is asked for its calendar service; one on its own booking list is not", () => {
  const dir = mkdtempSync(join(tmpdir(), "geo-client-"));
  try {
    writeFileSync(join(dir, "pathway.lock"), "bookings@0.1.0\n");
    writeFileSync(join(dir, "settings.json"), "{}"); // read from disk, then replaced by each case's settings through the template's validator
    writeFileSync(join(dir, "runtime.json"), JSON.stringify({ mode: "live", services: { payments: { baseUrl: "http://g-payments:8080" }, messaging: { baseUrl: "http://g-messaging:8080", phoneNumberId: "123456789012345" } } }));
    const load = (settings: unknown) => loadClientFolder(dir, { pathway: "bookings", version: "0.1.0" }, { validateSettings: () => ({ ok: true as const, settings }), services: BOOKINGS_SERVICES });
    for (const settings of [{}, { calendar: { module: "google" } }]) {
      assert.throws(() => load(settings), /add "calendar" with its "baseUrl" and "calendarId"/u, JSON.stringify(settings));
    }
    assert.equal(load({ calendar: { module: "own" } }).runtime.services?.calendar, undefined, "a shop on its own booking list loads without a calendar service");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("events are checked for shape before anything is saved, and an event's key is its own id", () => {
  const ok = checkEvents({ events: [{ kind: "message", message: { id: "wamid.1", from: "+919800000000", text: "hello", timestamp: 1 } }, { kind: "approval_decision", approval: "ap-x-1", decision: "approve", id: "r1" }] });
  assert.ok(ok.ok);
  if (ok.ok) assert.deepEqual(ok.events.map(eventKey), ["message:wamid.1", "approval_decision:ap-x-1:approve:r1"]);
  for (const bad of [{}, { events: [] }, { events: [{ kind: "tick" }] }, { events: [{ kind: "message", message: { id: "x" } }] }, { events: [{ kind: "approval_decision", approval: "../etc", decision: "approve" }] }]) assert.ok(!checkEvents(bad).ok, JSON.stringify(bad));
});
