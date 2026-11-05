// The live adapters, read against the providers' own sample payloads and a scripted local server (no real service is called).
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeClock } from "../../../modules/core/clock.ts";
import { ApiError, ConflictError, TimeoutError, WindowClosedError } from "../../../modules/core/faults.ts";
import { createLiveAdapters } from "../src/adapters/live/index.ts";
import { createRazorpayPayments, toPayment, toPaymentLink, toRefund } from "../../../modules/payments/razorpay.ts";
import { toEvent, toRfc3339 } from "../src/adapters/live/google-calendar.ts";
import { GRAPH_VERSION, templateBody } from "../../../modules/messaging/whatsapp.ts";
import { checkBaseUrl, joinUrl } from "../../../modules/core/http.ts";
import { HOUR } from "../../../modules/core/time.ts";
import { fixture, scripted } from "./helpers/scripted-server.ts";

const T0 = Date.UTC(2026, 10, 3, 4, 30);

// ---- the http layer ----

test("the base URL keeps its path prefix, and a key in it is refused", () => {
  assert.equal(joinUrl("http://127.0.0.1:8790/razorpay/", "/v1/payment_links", { reference_id: "b-1", payment_id: undefined }), "http://127.0.0.1:8790/razorpay/v1/payment_links?reference_id=b-1");
  assert.throws(() => checkBaseUrl("https://key:secret@guard.example", "Razorpay"), /Keys belong to Guard/);
  assert.throws(() => checkBaseUrl("ftp://guard.example", "Razorpay"), /http/);
  assert.throws(() => checkBaseUrl("not a url", "Razorpay"), /not a web address/);
});

test("an adapter never sends an Authorization header, and a call that cannot connect is an ApiError, not a lost reply", async () => {
  const server = await scripted(() => ({ json: { payment_links: [] } }));
  const { payments } = createLiveAdapters({ payments: { baseUrl: `${server.url}/razorpay` }, calendar: { baseUrl: server.url, calendarId: "c" }, messaging: { baseUrl: server.url, phoneNumberId: "1" } }, { clock: fakeClock(T0), window: { lastInboundAt: () => undefined } });
  await payments.listPaymentLinks({ reference_id: "b-1" });
  assert.equal(server.requests[0].url, "/razorpay/v1/payment_links?reference_id=b-1");
  assert.equal(server.requests[0].headers.authorization, undefined);
  await server.close();
  await assert.rejects(() => payments.listPaymentLinks(), (e: any) => e instanceof ApiError && e.status === 503 && !(e instanceof TimeoutError));
});

test("no reply in time, or a connection cut after the request, is a TimeoutError (the call may have happened)", async () => {
  const slow = await scripted(() => ({ json: {}, delayMs: 300 }));
  const cut = await scripted(() => ({ destroy: true }));
  const unreadable = await scripted(() => ({ status: 200, text: "{not json" }));
  try {
    for (const server of [slow, cut, unreadable]) {
      const { payments } = createLiveAdapters({ payments: { baseUrl: server.url }, calendar: { baseUrl: server.url, calendarId: "c" }, messaging: { baseUrl: server.url, phoneNumberId: "1" }, timeoutMs: 100 }, { clock: fakeClock(T0), window: { lastInboundAt: () => undefined } });
      await assert.rejects(() => payments.createPaymentLink({ amount: 20000, reference_id: "b-1", description: "x" }), TimeoutError);
    }
  } finally { await Promise.all([slow.close(), cut.close(), unreadable.close()]); }
});

// ---- Razorpay ----

test("razorpay: a payment link entity becomes ours, and its embedded payments are the thin ones the docs show", () => {
  const link = toPaymentLink(fixture("razorpay-payment-link-fetch.json"), []);
  assert.deepEqual({ id: link.id, reference_id: link.reference_id, amount: link.amount, status: link.status, short_url: link.short_url, amount_paid: link.amount_paid }, { id: "plink_KBnb7I424Rc1R9", reference_id: "111", amount: 10000, status: "paid", short_url: "https://rzp.io/i/alaBxs0i", amount_paid: 10000 });
  assert.equal(toPaymentLink(fixture("razorpay-payment-link-create.json"), []).payments.length, 0); // `payments: null` before any payment
  for (const [wire, ours] of [["created", "created"], ["paid", "paid"], ["partially_paid", "partially_paid"], ["cancelled", "cancelled"], ["expired", "cancelled"]] as const) {
    assert.equal(toPaymentLink({ ...fixture("razorpay-payment-link-fetch.json"), status: wire }, []).status, ours);
  }
  assert.throws(() => toPaymentLink({ ...fixture("razorpay-payment-link-fetch.json"), status: "weird" }, []), ApiError);
  assert.throws(() => toPaymentLink({ ...fixture("razorpay-payment-link-fetch.json"), currency: "USD" }, []), /only INR/);
});

test("razorpay: a payment record, a refunded payment, and a refund", () => {
  const p = toPayment(fixture("razorpay-payment.json"), "plink_1");
  assert.deepEqual(p, { id: "pay_DG4ZdRK8ZnXC3k", link_id: "plink_1", amount: 100, currency: "INR", status: "captured", amount_refunded: 0, created_at: 1605871409 });
  assert.equal(toPayment({ ...fixture("razorpay-payment.json"), status: "refunded", amount_refunded: 100 }, "")?.amount_refunded, 100); // a refunded payment still captured the money
  assert.equal(toPayment({ ...fixture("razorpay-payment.json"), status: "failed", captured: false }, ""), null);
  const r = toRefund(fixture("razorpay-refund-create.json"));
  assert.deepEqual(r, { id: "rfnd_FP8QHiV938haTz", payment_id: "pay_29QQoUBi66xm2f", amount: 500100, status: "processed", receipt: "Receipt No. 31", created_at: 1597078866 });
  assert.equal(toRefund({ ...fixture("razorpay-refund-create.json"), status: "pending" })?.status, "pending");
  assert.equal(toRefund({ ...fixture("razorpay-refund-create.json"), status: "failed" }), null); // no money moved: not a refund
});

test("razorpay: create sends paise, INR, the booking id and no keys; fetch fills in refunds from the payments record", async () => {
  const link = fixture("razorpay-payment-link-fetch.json");
  const server = await scripted((req) => {
    if (req.method === "POST" && req.url === "/v1/payment_links") return { json: { ...fixture("razorpay-payment-link-create.json"), amount: 20000, reference_id: "b-1", description: "Glow deposit" } };
    if (req.url === `/v1/payment_links/${link.id}`) return { json: link };
    if (req.url === "/v1/payments/pay_KBnebtRrhTEatJ") return { json: { ...fixture("razorpay-payment.json"), id: "pay_KBnebtRrhTEatJ", amount: 10000, amount_refunded: 4000 } };
    return { status: 400, json: fixture("razorpay-error-not-exist.json") };
  });
  try {
    const payments = createRazorpayPayments({ baseUrl: server.url });
    await payments.createPaymentLink({ amount: 20000, reference_id: "b-1", description: "Glow deposit" });
    const sent = JSON.parse(server.requests[0].body);
    assert.equal(sent.amount, 20000);
    assert.equal(sent.currency, "INR");
    assert.equal(sent.reference_id, "b-1");
    assert.equal(sent.description, "Glow deposit");
    assert.equal(server.requests[0].headers.authorization, undefined);
    const fetched = await payments.fetchPaymentLink(link.id);
    assert.equal(fetched?.payments.length, 1);
    assert.deepEqual({ id: fetched?.payments[0].id, link_id: fetched?.payments[0].link_id, amount_refunded: fetched?.payments[0].amount_refunded }, { id: "pay_KBnebtRrhTEatJ", link_id: link.id, amount_refunded: 4000 });
    assert.equal(await payments.fetchPaymentLink("plink_missing"), null); // Razorpay says 400 "does not exist", not 404
    assert.equal(await payments.fetchPayment("pay_missing"), null);
  } finally { await server.close(); }
});

test("razorpay: a duplicate reference_id and a bad key are ApiErrors with the status; a refund and the refund list", async () => {
  const server = await scripted((req) => {
    if (req.url === "/v1/payment_links") return { status: 400, json: { error: { code: "BAD_REQUEST_ERROR", description: "payment link creation with reference ID already attempted" } } };
    if (req.url?.endsWith("/refund")) return { json: fixture("razorpay-refund-create.json") };
    if (req.url?.includes("/refunds")) return { json: { entity: "collection", count: 2, items: [fixture("razorpay-refund-create.json"), { ...fixture("razorpay-refund-create.json"), id: "rfnd_failed", status: "failed" }] } };
    return { status: 401, json: { error: { code: "BAD_REQUEST_ERROR", description: "The api key provided is invalid" } } };
  });
  try {
    const payments = createRazorpayPayments({ baseUrl: server.url });
    await assert.rejects(() => payments.createPaymentLink({ amount: 20000, reference_id: "b-1", description: "x" }), (e: any) => e instanceof ApiError && e.status === 400 && /already attempted/.test(e.message));
    await assert.rejects(() => payments.fetchPayment("pay_1"), (e: any) => e.status === 401 && /api key/.test(e.message));
    const refund = await payments.refund("pay_29QQoUBi66xm2f", { amount: 500100, receipt: "b-1:pay_29QQoUBi66xm2f" });
    assert.equal(refund.id, "rfnd_FP8QHiV938haTz");
    assert.deepEqual(JSON.parse(server.requests.at(-1)!.body), { amount: 500100, receipt: "b-1:pay_29QQoUBi66xm2f" });
    const listed = await payments.listRefunds("pay_29QQoUBi66xm2f");
    assert.deepEqual(listed.map((r) => r.id), ["rfnd_FP8QHiV938haTz"]); // the failed one is not a refund
    assert.match(server.requests.at(-1)!.url, /count=100/);
  } finally { await server.close(); }
});

// ---- Google Calendar ----

test("calendar: Google's events become ours (private properties, all-day, free, cancelled)", () => {
  const list = fixture("google-events-list.json");
  const events = list.items.map((i: any) => toEvent(i, list.timeZone));
  assert.deepEqual(events[0], { id: "e1hold", summary: "haircut · +919811111111", start: Date.parse("2026-11-10T12:30:00Z"), end: Date.parse("2026-11-10T13:15:00Z"), status: "tentative", bookingRef: "b-1", holdExpiresAt: 1793000000000 });
  assert.equal(events[1].bookingRef, "foreign"); // the owner's own entry
  assert.equal(events[1].status, "confirmed");
  assert.equal(events[2].start, Date.parse("2026-11-10T18:30:00Z")); // an all-day event is midnight to midnight in the calendar's own zone
  assert.equal(events[2].end, Date.parse("2026-11-11T18:30:00Z"));
  assert.equal(events[4], null); // cancelled
  assert.equal(toRfc3339(T0), "2026-11-03T04:30:00.000Z");
});

test("calendar: list asks for the booking's private property, the overlap bounds, every page; free events block nothing", async () => {
  const list = fixture("google-events-list.json");
  const server = await scripted((req) => {
    if (req.url?.includes("pageToken=p2")) return { json: { ...list, items: [list.items[1]] } };
    return { json: { ...list, items: [list.items[0], list.items[3]], nextPageToken: "p2" } };
  });
  try {
    const { calendar } = createLiveAdapters({ payments: { baseUrl: server.url }, calendar: { baseUrl: server.url, calendarId: "shop@example.com" }, messaging: { baseUrl: server.url, phoneNumberId: "1" } }, { clock: fakeClock(T0), window: { lastInboundAt: () => undefined } });
    const found = await calendar.list({ bookingRef: "b-1", from: T0, to: T0 + HOUR });
    assert.deepEqual(found.map((e) => e.id), ["e1hold", "e2owner"]); // e4free is "free" and dropped
    const url = new URL(server.requests[0].url, "http://x");
    assert.equal(url.pathname, "/calendar/v3/calendars/shop%40example.com/events");
    assert.equal(url.searchParams.get("privateExtendedProperty"), "bookingRef=b-1");
    assert.equal(url.searchParams.get("singleEvents"), "true");
    assert.equal(url.searchParams.get("timeMin"), toRfc3339(T0));
    assert.equal(url.searchParams.get("timeMax"), toRfc3339(T0 + HOUR));
    assert.equal(server.requests.length, 2);
    assert.equal(server.requests[0].headers.authorization, undefined);
  } finally { await server.close(); }
});

test("calendar: insert keeps the booking id and hold on the event; update re-sends the booking id and clears the hold with null; get of a cancelled event is null", async () => {
  const stored: any = { id: "e1", status: "tentative", summary: "x", start: { dateTime: "2026-11-10T18:00:00+05:30" }, end: { dateTime: "2026-11-10T18:45:00+05:30" }, extendedProperties: { private: { bookingRef: "b-1", holdExpiresAt: "5" } } };
  const server = await scripted((req) => {
    if (req.method === "GET" && req.url?.startsWith("/calendar/v3/calendars/c/events/gone")) return { json: { id: "gone", status: "cancelled" } };
    if (req.method === "GET" && req.url?.startsWith("/calendar/v3/calendars/c/events/missing")) return { status: 404, json: { error: { code: 404, message: "Not Found" } } };
    if (req.method === "DELETE") return { status: 410, json: { error: { code: 410, message: "Resource has been deleted" } } };
    return { json: stored };
  });
  try {
    const { calendar } = createLiveAdapters({ payments: { baseUrl: server.url }, calendar: { baseUrl: server.url, calendarId: "c" }, messaging: { baseUrl: server.url, phoneNumberId: "1" } }, { clock: fakeClock(T0), window: { lastInboundAt: () => undefined } });
    await calendar.insert({ summary: "x", start: T0, end: T0 + HOUR, status: "tentative", bookingRef: "b-1", holdExpiresAt: 5 });
    const inserted = JSON.parse(server.requests[0].body);
    assert.deepEqual(inserted.extendedProperties.private, { bookingRef: "b-1", holdExpiresAt: "5" });
    assert.equal(inserted.status, "tentative");
    assert.equal(inserted.start.dateTime, toRfc3339(T0));
    await calendar.update("e1", { status: "confirmed", holdExpiresAt: undefined });
    const patch = server.requests.find((r) => r.method === "PATCH")!;
    assert.deepEqual(JSON.parse(patch.body), { status: "confirmed", extendedProperties: { private: { bookingRef: "b-1", holdExpiresAt: null } } });
    assert.equal(await calendar.get("gone"), null);
    assert.equal(await calendar.get("missing"), null);
    await calendar.delete("e1"); // 410: already deleted is what was asked
  } finally { await server.close(); }
});

test("calendar: free/busy with an error is not 'free'; a 409 is a ConflictError; a 500 is an ApiError", async () => {
  const busy = fixture("google-freebusy.json");
  const server = await scripted((req) => {
    if (req.url === "/calendar/v3/freeBusy") return { json: busy };
    if (req.method === "POST") return { status: 409, json: { error: { code: 409, message: "The requested identifier already exists." } } };
    return { status: 500, json: { error: { code: 500, message: "Backend Error" } } };
  });
  try {
    const mk = (calendarId: string) => createLiveAdapters({ payments: { baseUrl: server.url }, calendar: { baseUrl: server.url, calendarId }, messaging: { baseUrl: server.url, phoneNumberId: "1" } }, { clock: fakeClock(T0), window: { lastInboundAt: () => undefined } }).calendar;
    assert.deepEqual(await mk("shop@example.com").freeBusy(T0, T0 + 24 * HOUR), [{ start: Date.parse("2026-11-10T04:30:00Z"), end: Date.parse("2026-11-10T05:30:00Z") }]);
    await assert.rejects(() => mk("broken@example.com").freeBusy(T0, T0 + HOUR), (e: any) => e instanceof ApiError && /notFound/.test(e.message));
    await assert.rejects(() => mk("shop@example.com").insert({ summary: "x", start: T0, end: T0 + HOUR, status: "tentative", bookingRef: "b-1" }), ConflictError);
    await assert.rejects(() => mk("shop@example.com").list(), (e: any) => e instanceof ApiError && e.status === 500);
  } finally { await server.close(); }
});

// ---- WhatsApp ----

test("whatsapp: text goes to /v26.0/{phone number id}/messages, with no Authorization; the local copy is keyed by the wamid", async () => {
  const server = await scripted(() => ({ json: fixture("whatsapp-send-reply.json") }));
  try {
    const clock = fakeClock(T0);
    const last = new Map<string, number>([["+16505551234", T0 - HOUR]]);
    const { messaging } = createLiveAdapters({ payments: { baseUrl: server.url }, calendar: { baseUrl: server.url, calendarId: "c" }, messaging: { baseUrl: server.url, phoneNumberId: "106540352242922" } }, { clock, window: { lastInboundAt: (p) => last.get(p) } });
    const sent = await messaging.sendText("+16505551234", "Hello");
    assert.equal(GRAPH_VERSION, "v26.0");
    assert.equal(server.requests[0].url, "/v26.0/106540352242922/messages");
    assert.equal(server.requests[0].headers.authorization, undefined);
    assert.deepEqual(JSON.parse(server.requests[0].body), { messaging_product: "whatsapp", recipient_type: "individual", to: "+16505551234", type: "text", text: { body: "Hello", preview_url: false } });
    assert.equal(sent.id, "wamid.HBgLMTY0NjcwNDM1OTUVAgARGBI4MjZGRDA0OUE2OTQ3RkEyMzcA");
    assert.equal(sent.acceptedAs, "accepted"); // accepted, not delivered
    assert.equal((await messaging.getMessage(sent.id))?.text, "Hello");
    assert.equal(await messaging.getMessage("wamid.unknown"), null);
  } finally { await server.close(); }
});

test("whatsapp: the 24-hour window comes from the runtime's own store; a closed window is refused before any call, and Meta's own refusal (131047) means the same", async () => {
  const server = await scripted(() => ({ status: 400, json: { error: { message: "(#131047) Re-engagement message", type: "OAuthException", code: 131047, error_data: { messaging_product: "whatsapp", details: "More than 24 hours have passed since the recipient last replied to the sender number." }, fbtrace_id: "x" } } }));
  try {
    const clock = fakeClock(T0);
    const last = new Map<string, number>();
    const { messaging } = createLiveAdapters({ payments: { baseUrl: server.url }, calendar: { baseUrl: server.url, calendarId: "c" }, messaging: { baseUrl: server.url, phoneNumberId: "1" } }, { clock, window: { lastInboundAt: (p) => last.get(p) } });
    assert.equal(await messaging.isWindowOpen("+911"), false);
    await assert.rejects(() => messaging.sendText("+911", "hi"), WindowClosedError);
    assert.equal(server.requests.length, 0);
    last.set("+911", T0);
    assert.equal(await messaging.isWindowOpen("+911"), true);
    clock.advance(23 * HOUR);
    assert.equal(await messaging.isWindowOpen("+911"), true);
    clock.advance(2 * HOUR);
    assert.equal(await messaging.isWindowOpen("+911"), false);
    last.set("+911", clock.now());
    await assert.rejects(() => messaging.sendText("+911", "hi"), WindowClosedError); // we thought it open; Meta said it was not
  } finally { await server.close(); }
});

test("whatsapp: a template goes out by name, language code and body parameters; line breaks in a value are flattened; a missing template is an ApiError", async () => {
  const server = await scripted((req) => (JSON.parse(req.body).template?.name === "booking_update"
    ? { status: 404, json: { error: { message: "(#132001) Template name does not exist in the translation", type: "OAuthException", code: 132001 } } }
    : { json: fixture("whatsapp-send-reply.json") }));
  try {
    const { messaging } = createLiveAdapters({ payments: { baseUrl: server.url }, calendar: { baseUrl: server.url, calendarId: "c" }, messaging: { baseUrl: server.url, phoneNumberId: "1" } }, { clock: fakeClock(T0), window: { lastInboundAt: () => undefined } });
    const sent = await messaging.sendTemplate("+911", { name: "booking_reminder", language: "ml", text: "whole text", parameters: ["Glow Salon", "Haircut\nand colour", "Tue 10 Nov, 6:00 pm"] });
    assert.deepEqual(JSON.parse(server.requests[0].body), {
      messaging_product: "whatsapp", recipient_type: "individual", to: "+911", type: "template",
      template: { name: "booking_reminder", language: { code: "ml" }, components: [{ type: "body", parameters: [{ type: "text", text: "Glow Salon" }, { type: "text", text: "Haircut and colour" }, { type: "text", text: "Tue 10 Nov, 6:00 pm" }] }] },
    });
    assert.equal(sent.kind, "template");
    assert.equal(sent.templateName, "booking_reminder");
    assert.equal(sent.text, "whole text");
    assert.deepEqual(templateBody("+911", { name: "x", language: "en", text: "t" }).template, { name: "x", language: { code: "en" } }); // no parameters, no components
    await assert.rejects(() => messaging.sendTemplate("+911", { name: "booking_update", language: "en", text: "t" }), (e: any) => e instanceof ApiError && e.status === 404 && /does not exist/.test(e.message));
  } finally { await server.close(); }
});
