// THE BOOKING FLOW ITSELF (group iii of the contract, README.md): the free times, the opening hours and the slot grid, two customers for the last slot, the buffer, a calendar that
// shows someone else's event, cancelling a hold, a hold that nobody pays, the clock's beat (a booking over, a reminder), STOP, a booking from WhatsApp text, and the shop's own
// booking list. Two kinds of shop: a "fakes" shop on the TEST clock at Tue 3 Nov 2026, 10:00 in India (the unit tests' instant, so the free times are exact), and a "guards" shop
// for what is seen on the calendar Guard's wire. Expected values from test/booking, last-slot, capacity, own-calendar, page-link, limits and channels.
import { after, describe } from "node:test";
import assert from "node:assert/strict";
import { CUSTOMER, HOUR, MIN, OTHER_CUSTOMER, PAGE, TZ, contract, makeShop, openStart } from "./harness.ts";
import type { Shop } from "./harness.ts";
import { handleHash } from "../../../../modules/channels/handle.ts";
import { zonedToMs } from "../../../../modules/core/time.ts";

const shops: Shop[] = [];
after(async () => { for (const s of shops) { await s.stop(); await s.cleanup(); } });
async function boot(o: Parameters<typeof makeShop>[0] = {}): Promise<Shop> { const s = await makeShop(o); shops.push(s); await s.start(); return s; }
const at = (day: number, hour: number, minute = 0): number => zonedToMs({ year: 2026, month: 11, day }, { hour, minute }, TZ);
const UPI = { payment: { module: "upi", upi: { id: "glowsalon@okicici", payee: "Glow Salon" } }, calendar: { module: "own" }, deposit: { amountInr: 200, holdMinutes: 60 } };
const offer = async (s: Shop, from: string, days: number, service = "haircut") => (await s.call(`/internal/channel/offer?service=${service}&from=${from}&days=${days}`)).body;
const startsOf = (o: { days: { date: string; starts: number[] }[] }, date: string): number[] => o.days.find((d) => d.date === date)?.starts ?? [];

describe("free times", () => {
  contract("the offer lists the services and prices, and the free starts on the shop's grid: closed on Sunday, the last start leaves room to finish before closing", async () => {
    const s = await boot();
    const o = await offer(s, "2026-11-07", 3);
    assert.equal(o.shop.name, "Glow Salon");
    assert.deepEqual(o.shop.deposit, { amountInr: 200, holdMinutes: 15 });
    assert.deepEqual(o.shop.payment, { kind: "link" });
    assert.equal(o.shop.paused, false);
    assert.deepEqual(o.services.map((x: { id: string; priceInr: number }) => [x.id, x.priceInr]), [["haircut", 450], ["beard-trim", 250], ["facial", 900], ["hair-colour", 1800]]);
    const sat = startsOf(o, "2026-11-07"), sun = startsOf(o, "2026-11-08"), mon = startsOf(o, "2026-11-09");
    assert.equal(sat[0], at(7, 10), "Saturday opens at 10:00");
    assert.equal(sat.at(-1), at(7, 20), "a haircut starting at 20:00 ends 20:45, before Saturday's 21:00 closing");
    assert.equal(sat.length, 21);
    assert.deepEqual(sun, [], "Sunday is closed");
    assert.equal(mon.at(-1), at(9, 19), "Monday closes at 20:00: 19:00 is the last start of a 45-minute haircut");
    assert.ok(sat.every((t, i) => i === 0 || t - sat[i - 1] === 30 * MIN), "on the 30-minute grid");
    // a longer service has an earlier last start
    const colour = await offer(s, "2026-11-09", 1, "hair-colour");
    assert.equal(startsOf(colour, "2026-11-09").at(-1), at(9, 18, 30), "90 minutes: 18:30 ends at 20:00");
  });

  contract("today's free times start after the hold's time: nothing is offered that would begin before the customer could pay", async () => {
    const s = await boot();
    const today = await offer(s, "2026-11-03", 1);
    const starts = startsOf(today, "2026-11-03");
    assert.equal(starts[0], at(3, 10, 30), "10:00 now, a 15-minute hold: the first start after 10:15 on the grid is 10:30");
    s.advance(5 * HOUR);
    assert.equal(startsOf(await offer(s, "2026-11-03", 1), "2026-11-03")[0], at(3, 15, 30), "five hours later the day's times have moved on with the clock");
  });

  contract("an offer for a service the shop does not have lists the services and no days; days are at most 14", async () => {
    const s = await boot();
    const none = await offer(s, "2026-11-04", 3, "no-such-service");
    assert.equal(none.days, undefined);
    assert.equal(none.services.length, 4);
    const many = await offer(s, "2026-11-04", 31);
    assert.equal(many.days.length, 14, "a page never asks for more than two weeks at once");
    for (const bad of ["days=0", "days=32", "days=x", "from=04-11-2026", "service=a%20b"]) assert.equal((await s.call(`/internal/channel/offer?${bad}`)).status, 400, bad);
  });
});

describe("the last slot, the buffer and someone else's event", () => {
  contract("two customers for the same time: the first is held, the second is told it is taken, and only one hold exists", async () => {
    const s = await boot({ mode: "guards" });
    const start = openStart(s.now());
    const a = await s.book({ startMs: start });
    const b = await s.book({ startMs: start, name: "Ravi", phone: OTHER_CUSTOMER });
    assert.equal((await s.request(a.hash)).body.status, "held");
    const second = (await s.request(b.hash)).body;
    assert.equal(second.status, "not_held", "the second customer's request is answered: the time is taken");
    assert.equal(second.pay, undefined);
    assert.equal(s.guards!.of("calendar", "POST", /\/events$/u).length, 1, "one hold was ever written");
    assert.equal(s.guards!.of("payments", "POST", /^\/v1\/payment_links$/u).length, 1, "and one link");
  });

  contract("the buffer between bookings: a start inside the previous booking's time plus the buffer is refused, one just after it is held", async () => {
    const s = await boot({ settings: UPI });
    const a = await s.book({ startMs: at(4, 11) });                   // 11:00 to 11:45
    const inside = await s.book({ startMs: at(4, 11, 30), phone: OTHER_CUSTOMER, name: "Ravi" });
    const nextGrid = await s.book({ startMs: at(4, 12), phone: "+919833333333", name: "Meera" }); // 12:00: more than the 10-minute buffer after 11:45
    assert.equal((await s.request(a.hash)).body.status, "held");
    assert.equal((await s.request(inside.hash)).body.status, "not_held");
    assert.equal((await s.request(nextGrid.hash)).body.status, "held");
  });

  contract("a time the shop is closed, off its grid, in the past or for a service it does not have is refused, and nothing is held", async () => {
    const s = await boot({ settings: UPI });
    const refused = async (o: Parameters<Shop["book"]>[0]): Promise<string> => { const b = await s.book(o); return (await s.request(b.hash)).body.status; };
    assert.equal(await refused({ startMs: at(8, 11) }), "refused", "Sunday");
    assert.equal(await refused({ startMs: at(4, 9) }), "refused", "before opening");
    assert.equal(await refused({ startMs: at(4, 19, 30) }), "refused", "would end after closing");
    assert.equal(await refused({ startMs: at(4, 11, 10) }), "refused", "off the 30-minute grid");
    assert.equal(await refused({ startMs: at(3, 9) }), "refused", "already past");
    assert.equal(await refused({ startMs: at(4, 11), serviceId: "massage" }), "refused", "no such service");
    assert.deepEqual((await s.status()).bookings, {}, "no booking exists");
  });

  contract("an event someone else wrote on the calendar blocks that time, and a booking on it is refused with no hold written", async () => {
    const s = await boot({ mode: "guards" });
    const start = openStart(s.now());
    s.guards!.standins.fakes.calendar.insert({ summary: "Dentist", start, end: start + HOUR, status: "confirmed", bookingRef: "foreign" } as never);
    const b = await s.book({ startMs: start });
    assert.equal((await s.request(b.hash)).body.status, "not_held");
    assert.equal(s.guards!.of("calendar", "POST", /\/events$/u).length, 0, "no hold on someone else's time");
    const o = await s.call(`/internal/channel/offer?service=haircut&from=${new Date(start + 5.5 * HOUR).toISOString().slice(0, 10)}&days=1`);
    assert.ok(!o.body.days.flatMap((d: { starts: number[] }) => d.starts).includes(start), "and the page no longer offers it");
  });

  contract("a calendar that cannot be read: the offer says so and lists no day, rather than showing times that may be taken", async () => {
    const s = await boot({ mode: "guards", tickSeconds: 1 });
    s.guards!.calendar.down();
    const o = await offer(s, "2026-11-07", 2);
    assert.equal(o.calendarUnread, true);
    assert.deepEqual(o.days, []);
    s.guards!.calendar.up();
    assert.ok(startsOf(await offer(s, "2026-11-07", 2), "2026-11-07").length > 0, "and when it is back the times are offered again");
  });

  contract("a hold nobody pays ends by itself: on the beat of the clock the booking expires, the calendar hold is let go, and the time is free again", async () => {
    const s = await boot({ mode: "guards", tickSeconds: 1, settings: { deposit: { amountInr: 200, holdMinutes: 1 } } });
    const start = openStart(s.now());
    const { hash } = await s.book({ startMs: start });
    assert.equal((await s.request(hash)).body.status, "held");
    for (let i = 0; i < 90 && (await s.status()).bookings.expired !== 1; i++) await new Promise((r) => setTimeout(r, 1000));
    assert.deepEqual((await s.status()).bookings, { expired: 1 });
    assert.equal((await s.request(hash)).body.status, "expired");
    assert.equal(s.guards!.of("calendar", "DELETE").length, 1, "the tentative event is deleted");
    const again = await s.book({ startMs: start, name: "Ravi", phone: OTHER_CUSTOMER });
    assert.equal((await s.request(again.hash)).body.status, "held", "the next customer gets the time");
  });
});

describe("the clock's beat on the shop's own list", () => {
  /** A UPI shop on its own list, booked and marked paid by the owner: no Guard at all, so the test clock can move it. */
  async function booked(start: number, o: Parameters<typeof makeShop>[0] = {}): Promise<{ s: Shop; hash: string }> {
    const s = await boot({ settings: UPI, tickSeconds: 1, ...o });
    const { hash } = await s.book({ startMs: start });
    const [item] = (await s.ownerView()).body.items;
    await s.channelEvents([{ kind: "owner_action", id: "m-1", action: "received", case: "b-1", digest: item.digest }], { owner: true }); await s.settle();
    assert.equal((await s.request(hash)).body.status, "booked");
    return { s, hash };
  }
  const beat = async (): Promise<void> => { await new Promise((r) => setTimeout(r, 2200)); };

  contract("a hold that runs out on the shop's clock expires: the page says so and the time is free for the next customer", async () => {
    const s = await boot({ settings: UPI, tickSeconds: 1 });
    const { hash } = await s.book({ startMs: at(4, 11) });
    assert.equal((await s.status()).bookings.awaiting_deposit, 1);
    s.advance(61 * MIN); await beat();
    assert.deepEqual((await s.status()).bookings, { expired: 1 });
    assert.equal((await s.request(hash)).body.status, "expired");
    assert.ok(startsOf(await offer(s, "2026-11-04", 1), "2026-11-04").includes(at(4, 11)));
  });

  contract("a booked time that has passed becomes completed on the beat, and a reminder reaches the customer's page before it", async () => {
    const { s, hash } = await booked(at(4, 18));
    const before = (await s.request(hash)).body.messages.length;
    s.advance(8 * HOUR + 5 * MIN); await beat();                       // Tue 18:05: 24 hours before the booking is Tue 18:00
    const during = (await s.request(hash)).body.messages;
    assert.equal(during.length, before + 1, JSON.stringify(during.map((m: { text: string }) => m.text)));
    assert.match(during.at(-1).text, /reminder|tomorrow|18:00|6:00/iu);
    assert.deepEqual((await s.status()).bookings, { confirmed: 1 });
    s.advance(26 * HOUR); await beat();                                // Wed 20:05, after the booking's end
    assert.deepEqual((await s.status()).bookings, { completed: 1 });
    assert.equal((await s.request(hash)).body.status, "done");
    const record = s.record();
    assert.ok(record.some((r) => r.action === "complete_booking" && r.outcome === "confirmed"));
  });

  contract("cancelling a held request on the page frees the slot at once and the shop writes it in the record", async () => {
    const s = await boot({ settings: UPI });
    const { hash } = await s.book({ startMs: at(4, 11) });
    await s.channelEvents([{ kind: "channel_request", id: "c-1", channel: "web", op: "cancel", handle: hash }]); await s.settle();
    assert.equal((await s.request(hash)).body.status, "cancelled");
    assert.deepEqual((await s.status()).bookings, { cancelled: 1 });
    assert.ok(startsOf(await offer(s, "2026-11-04", 1), "2026-11-04").includes(at(4, 11)));
    assert.ok(s.record().some((r) => r.action === "cancel_booking" && r.outcome === "confirmed"));
    // a cancel for a handle nobody holds changes nothing
    const nobody = await s.channelEvents([{ kind: "channel_request", id: "c-2", channel: "web", op: "cancel", handle: "0".repeat(64) }]);
    assert.equal(nobody.status, 200);
    await s.settle();
    assert.deepEqual((await s.status()).bookings, { cancelled: 1 });
  });
});

describe("a booking from WhatsApp", () => {
  contract("a customer's text books the haircut: a hold, a link, and the reply carries the link; STOP ends every message to them", async () => {
    const s = await boot({ mode: "guards" });
    const start = openStart(s.now(), 3);
    const day = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "numeric", month: "short" }).format(start);
    await s.inbound(CUSTOMER, `haircut on ${day} at 11am`);
    const said = s.sent(CUSTOMER);
    assert.ok(said.length >= 1, "the shop answered");
    assert.ok(said.some((m) => m.text.includes(s.guards!.standins.fakes.payments.links()[0].pay_url)), "the link is in the message");
    assert.equal(s.guards!.of("calendar", "POST", /\/events$/u).length, 1);
    assert.equal(s.guards!.of("calendar", "POST", /\/events$/u)[0].body.start.dateTime, new Date(start).toISOString());
    const before = s.sent(CUSTOMER).length;
    await s.inbound(CUSTOMER, "STOP");
    assert.equal(s.sent(CUSTOMER).length, before, "not even a reply to STOP");
    assert.ok(s.record().some((r) => r.action === "opt_out"));
    await s.inbound(CUSTOMER, "haircut again");
    assert.equal(s.sent(CUSTOMER).length, before, "nothing more while opted out");
  });

  contract("a UPI quote on WhatsApp carries the booking's own page link, and only its hash opens the page", async () => {
    const s = await boot({ mode: "guards", settings: UPI });
    const start = openStart(s.now(), 3);
    const day = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "numeric", month: "short" }).format(start);
    await s.inbound(CUSTOMER, `haircut on ${day} at 11am`);
    const text = s.sent(CUSTOMER).map((m) => m.text).join("\n");
    const found = new RegExp(`${PAGE.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}/b/([A-Za-z0-9_-]{32})`, "u").exec(text);
    assert.ok(found, text);
    assert.match(text, /glowsalon@okicici/u);
    const view = (await s.request(handleHash(found![1]))).body;
    assert.equal(view.status, "held");
    assert.equal(view.pay.kind, "upi");
    assert.equal(view.canCancel, false, "cancelling and \"I have paid\" stay on WhatsApp");
    assert.equal((await s.request(handleHash("x".repeat(32)))).status, 404, "a typed or guessed link opens nothing");
    assert.deepEqual(s.guards!.calls.filter((c) => c.service !== "messaging"), [], "a UPI shop on its own list reaches no Guard but WhatsApp");
  });
});

