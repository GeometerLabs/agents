// Read-only connection checks, against the stand-ins over real HTTP (and small stubs for what a stand-in does not do: Guard's own answers, a
// provider that shows another account, a reply that holds the credential). The point of every test: a different account is an error with its
// own code, and nothing is ever sent, charged or booked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createFakeCalendar } from "../../../pathways/bookings/src/adapters/calendar.ts";
import { createFakeMessaging } from "../../../modules/messaging/messaging.ts";
import { createFakePayments } from "../../../modules/payments/payments.ts";
import { fakeClock } from "../../../modules/core/clock.ts";
import { startStandins } from "../../../pathways/bookings/standins/server.ts";
import { checkCalendar, checkConnections, checkRazorpay, checkWhatsApp } from "../checks.ts";

const SECRETS = { razorpayWebhookSecret: "standin-rzp-secret", whatsappAppSecret: "standin-wa-secret" };
const PHONE_ID = "100000000000001";
const NUMBER = "+919876543210";
const CALENDAR = "glowsalon@group.calendar.google.com";

async function world(change: Record<string, unknown> = {}) {
  const clock = fakeClock(Date.UTC(2026, 10, 3, 4, 30));
  const fakes = { payments: createFakePayments(clock), calendar: createFakeCalendar(), messaging: createFakeMessaging(clock) };
  const standins = await startStandins({ clock, fakes, ...SECRETS, phoneNumberId: PHONE_ID, displayPhoneNumber: "+91 98765 43210", verifiedName: "Glow Salon", calendarId: CALENDAR, ...change }, { port: 0 });
  return { standins, fakes, url: standins.url, close: () => standins.close() };
}

async function stub(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }) };
}
const json = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => { res.writeHead(status, { "content-type": "application/json", ...headers }); res.end(JSON.stringify(body)); };

test("all three confirm against the stand-ins, and the ids they report are the pins", async () => {
  const w = await world();
  try {
    const report = await checkConnections({
      whatsapp: { baseUrl: w.url, phoneNumberId: PHONE_ID, businessNumber: NUMBER },
      razorpay: { baseUrl: w.url, keyId: "rzp_live_AbCdEf123456", expectedMode: "live" },
      calendar: { baseUrl: w.url, calendarId: CALENDAR },
    });
    assert.equal(report.allOk, true);
    assert.deepEqual(report.results.map((r) => [r.service, r.code]), [["whatsapp", "confirmed"], ["razorpay", "confirmed"], ["calendar", "confirmed"]]);
    assert.deepEqual(report.pins, {
      whatsapp: { phoneNumberId: PHONE_ID, displayNumber: NUMBER },
      razorpay: { keyId: "rzp_live_AbCdEf123456", mode: "live" },
      calendar: { calendarId: CALENDAR },
    });
    assert.equal(report.results[0].confirmed?.verifiedName, "Glow Salon");
    assert.equal(report.results[2].confirmed?.accessRole, "owner");
    // What a read cannot show is named, never glossed over.
    assert.ok(report.results[0].notChecked.includes("sending") && report.results[0].notChecked.includes("templates-approved"));
    assert.deepEqual(report.results[1].notChecked, ["payments-account"]);
    assert.ok(report.results.every((r) => r.sentNothing === true));
  } finally { await w.close(); }
});

test("nothing is sent, charged or booked: every request is a GET, and the stand-ins' records are untouched", async () => {
  const w = await world();
  const methods: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => { methods.push(`${init?.method ?? "GET"} ${new URL(String(input)).pathname}`); return realFetch(input, init); }) as typeof fetch;
  try {
    await checkConnections({
      whatsapp: { baseUrl: w.url, phoneNumberId: PHONE_ID, businessNumber: NUMBER },
      razorpay: { baseUrl: w.url, keyId: "rzp_test_AbCdEf123456", expectedMode: "test" },
      calendar: { baseUrl: w.url, calendarId: CALENDAR },
    });
  } finally { globalThis.fetch = realFetch; }
  try {
    assert.ok(methods.length >= 4);
    assert.ok(methods.every((m) => m.startsWith("GET ")), methods.join(", "));
    assert.equal(w.fakes.messaging.outbox().length, 0);
    assert.equal(w.fakes.payments.links().length, 0);
    assert.equal(w.fakes.payments.refunds().length, 0);
    assert.equal(w.fakes.calendar.events().length, 0);
    assert.ok(w.fakes.payments.calls.every((c) => c.op === "listPaymentLinks"));
  } finally { await w.close(); }
});

test("WhatsApp: another number id is not_found, and another number behind the right id is an account_mismatch that shows only its last four digits", async () => {
  const w = await world();
  try {
    const other = await checkWhatsApp({ baseUrl: w.url, phoneNumberId: "100000000000999", businessNumber: NUMBER });
    assert.deepEqual([other.ok, other.code], [false, "not_found"]);
    const wrong = await checkWhatsApp({ baseUrl: w.url, phoneNumberId: PHONE_ID, businessNumber: "+919811112222" });
    assert.deepEqual([wrong.ok, wrong.code, wrong.foundEnding, wrong.confirmed], [false, "account_mismatch", "3210", undefined]);
    assert.ok(!JSON.stringify(wrong).includes("98765"), "a whole number that is not the shop's is not repeated");
    const unset = await checkWhatsApp({ baseUrl: w.url, phoneNumberId: "abc", businessNumber: NUMBER });
    assert.equal(unset.code, "not_configured");
  } finally { await w.close(); }
});

test("a different account is never pinned: a failed check leaves the pins empty", async () => {
  const w = await world();
  try {
    const report = await checkConnections({ whatsapp: { baseUrl: w.url, phoneNumberId: PHONE_ID, businessNumber: "+919811112222" }, calendar: { baseUrl: w.url, calendarId: "someone-else@gmail.com" } });
    assert.equal(report.allOk, false);
    assert.deepEqual(report.pins, {});
  } finally { await w.close(); }
});

test("Razorpay: a practice key where a live one is needed is refused before any call; a different key than the confirmed one is an account_mismatch", async () => {
  const dead = "http://127.0.0.1:1"; // nothing listens: a call would be `unreachable`, so these codes prove no call was made
  const test1 = await checkRazorpay({ baseUrl: dead, keyId: "rzp_test_AbCdEf123456", expectedMode: "live" });
  assert.deepEqual([test1.code, test1.confirmed?.mode], ["wrong_mode", "test"]);
  const changed = await checkRazorpay({ baseUrl: dead, keyId: "rzp_live_Second123456", pinnedKeyId: "rzp_live_AbCdEf123456", expectedMode: "live" });
  assert.equal(changed.code, "account_mismatch");
  assert.equal((await checkRazorpay({ baseUrl: dead, keyId: "not a key", expectedMode: "live" })).code, "not_configured");
});

test("Razorpay: a key that no longer works is not_allowed, and the result says it could not tell whose account it is", async () => {
  const w = await world();
  try {
    w.fakes.payments.inject("listPaymentLinks", "error");
    const bad = await checkRazorpay({ baseUrl: w.url, keyId: "rzp_live_AbCdEf123456", expectedMode: "live" });
    assert.deepEqual([bad.ok, bad.code], [false, "not_allowed"]);
    const good = await checkRazorpay({ baseUrl: w.url, keyId: "rzp_live_AbCdEf123456", expectedMode: "live" });
    assert.equal(good.ok, true);
    assert.deepEqual(good.notChecked, ["payments-account"]);
  } finally { await w.close(); }
});

test("Calendar: the id Google reports is what gets pinned; a calendar the account cannot see is not_found; a read-only share is not_writable", async () => {
  const w = await world();
  try {
    const typed = await checkCalendar({ baseUrl: w.url, calendarId: CALENDAR.toUpperCase() });
    assert.deepEqual([typed.ok, typed.confirmed?.calendarId], [true, CALENDAR]); // pinned as Google writes it, not as it was typed
    const lost = await checkCalendar({ baseUrl: w.url, calendarId: "someone-else@gmail.com" });
    assert.deepEqual([lost.ok, lost.code], [false, "not_found"]);
  } finally { await w.close(); }
  for (const [role, ok] of [["reader", false], ["freeBusyReader", false], ["writerWithoutPrivateAccess", false], ["writer", true], ["owner", true]] as const) {
    const r = await world({ calendarAccessRole: role });
    try {
      const c = await checkCalendar({ baseUrl: r.url, calendarId: CALENDAR });
      assert.deepEqual([c.ok, c.code], [ok, ok ? "confirmed" : "not_writable"], role);
      if (!ok) assert.equal(c.detail, role);
    } finally { await r.close(); }
  }
});

test("a provider that shows another calendar, a reply that is not what was asked for, and a reply that holds the credential are all errors", async () => {
  const other = await stub((_req, res) => json(res, 200, { kind: "calendar#calendar", id: "not-yours@gmail.com", summary: "Someone else", timeZone: "Asia/Kolkata" }));
  const junk = await stub((_req, res) => json(res, 200, { hello: "world" }));
  const leaky = await stub((_req, res) => json(res, 200, { id: PHONE_ID, display_phone_number: "+91 98765 43210", verified_name: "token gg_0123456789abcdef" }));
  try {
    assert.equal((await checkCalendar({ baseUrl: other.url, calendarId: CALENDAR })).code, "account_mismatch");
    assert.equal((await checkCalendar({ baseUrl: junk.url, calendarId: CALENDAR })).code, "unexpected_response");
    assert.equal((await checkWhatsApp({ baseUrl: junk.url, phoneNumberId: PHONE_ID, businessNumber: NUMBER })).code, "unexpected_response");
    assert.equal((await checkRazorpay({ baseUrl: junk.url, expectedMode: "live" })).code, "unexpected_response");
    const leak = await checkWhatsApp({ baseUrl: leaky.url, phoneNumberId: PHONE_ID, businessNumber: NUMBER }, { agentToken: "gg_0123456789abcdef" });
    assert.equal(leak.code, "unexpected_response");
    assert.equal(leak.confirmed, undefined);
  } finally { await other.close(); await junk.close(); await leaky.close(); }
});

test("Guard's own answers are told apart: a route it does not list is refused_by_guard with its words, a bad panel credential is not_allowed", async () => {
  const refused = await stub((_req, res) => json(res, 403, { error: "no", guard: { decision: "deny", code: "refused_by_policy", sent: "no", retry: "no", reason: "the route GET /v26.0/{phone_number_id} is not listed" } }));
  const unauth = await stub((_req, res) => json(res, 401, { error: "no", guard: { decision: "deny", code: "unauthenticated", sent: "no", retry: "no", reason: "bad agent token" } }));
  try {
    const r = await checkWhatsApp({ baseUrl: refused.url, phoneNumberId: PHONE_ID, businessNumber: NUMBER });
    assert.deepEqual([r.code, r.detail], ["refused_by_guard", "the route GET /v26.0/{phone_number_id} is not listed"]);
    assert.equal((await checkCalendar({ baseUrl: unauth.url, calendarId: CALENDAR })).code, "not_allowed");
  } finally { await refused.close(); await unauth.close(); }
});

test("a service that cannot be reached, or does not answer, is unreachable, not a crash", async () => {
  assert.equal((await checkCalendar({ baseUrl: "http://127.0.0.1:1", calendarId: CALENDAR })).code, "unreachable");
  const silent = await stub(() => undefined);
  try { assert.equal((await checkWhatsApp({ baseUrl: silent.url, phoneNumberId: PHONE_ID, businessNumber: NUMBER }, { timeoutMs: 150 })).code, "unreachable"); } finally { await silent.close(); }
});

test("the panel's Guard credential is sent as a bearer token, and a stand-in without one sees no Authorization header", async () => {
  const seen: (string | undefined)[] = [];
  const s = await stub((req, res) => { seen.push(req.headers.authorization); json(res, 200, { payment_links: [] }); });
  try {
    await checkRazorpay({ baseUrl: s.url, expectedMode: "live" });
    await checkRazorpay({ baseUrl: s.url, expectedMode: "live" }, { agentToken: "gg_panel_credential_1" });
    assert.deepEqual(seen, [undefined, "Bearer gg_panel_credential_1"]);
  } finally { await s.close(); }
});
