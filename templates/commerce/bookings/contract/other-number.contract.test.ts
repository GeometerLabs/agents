// A booking asked about from another number, and where a UPI refund goes back to (25 Nov 2026, refund-paths; modules/record/case-asked.ts, ledger.ts refundSource), on the
// Go shop over HTTP and files. Someone at a number that holds no booking names one: they get one line that shows nothing of it, the owner is told once an hour (the approved
// template, so outside their window too), the record gets a line with the booking in refs.case and no number but the asker's own conversation, and nothing about the booking
// changes. A reference the shop does not hold gets the shop's usual answer and the owner hears nothing. A UPI refund's owner message names the account the money came from
// by its note, amount and day, under the new template name.
import { after, describe } from "node:test";
import assert from "node:assert/strict";
import { CUSTOMER, OWNER_NUMBER, TZ, contract, makeShop, openStart } from "./harness.ts";
import type { Shop } from "./harness.ts";
import { formatDate } from "../../../../modules/language/format.ts";
import { localParts } from "../../../../modules/core/time.ts";

const shops: Shop[] = [];
after(async () => { for (const s of shops) { await s.stop(); await s.cleanup(); } });
async function boot(o: Parameters<typeof makeShop>[0] = {}): Promise<Shop> { const s = await makeShop(o); shops.push(s); await s.start(); return s; }
const STRANGER = "+919833333333";
const part = (ms: number, t: string, o: Intl.DateTimeFormatOptions): string => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, ...o }).formatToParts(ms).find((x) => x.type === t)!.value;
const typed = (ms: number): string => `${part(ms, "day", { day: "numeric" })} ${part(ms, "month", { month: "short" })}`;
const NOT_SHOWN = "I can't show that booking to this number. I've told the owner, and they'll get in touch with you.";

/** A paid WhatsApp booking, b-1 of CUSTOMER, on the gateway stand-in. */
async function booked(): Promise<Shop> {
  const s = await boot({ mode: "guards" });
  const start = openStart(s.now(), 3);
  await s.inbound(CUSTOMER, `haircut on ${typed(start)} at 11am`);
  const link = s.guards!.standins.fakes.payments.links()[0];
  await s.events(s.guards!.pay(link.id).map((event) => ({ kind: "payment_event", event }))); await s.settle();
  assert.equal((await s.status()).bookings.confirmed, 1);
  return s;
}

describe("a booking named from a number that holds none", () => {
  contract("a real reference: one line that shows nothing, the owner told once an hour, a record line with no other number, and nothing changed", async () => {
    const s = await booked();
    const ownerBefore = s.sent(OWNER_NUMBER).length;
    await s.inbound(STRANGER, "Hi, what about B1? My son booked it");
    const reply = s.sent(STRANGER);
    assert.equal(reply.length, 1);
    assert.equal(reply[0].text, NOT_SHOWN);
    assert.doesNotMatch(reply[0].text, /haircut|₹|98111|b-1|11:00/iu, "nothing of the booking reaches the asker");
    const told = s.sent(OWNER_NUMBER).slice(ownerBefore);
    assert.equal(told.length, 1);
    assert.equal(told[0].templateName, "owner_booking_asked_elsewhere", "the approved template, so it reaches the owner outside their window");
    assert.equal(told[0].text, "Someone at +91 98333 33333 asks about b-1 (booked from +91 98111 11111). Check before you help.");
    const lines = s.record().filter((r) => r.action === "case_asked_elsewhere");
    assert.equal(lines.length, 1);
    assert.equal(lines[0].outcome, "confirmed");
    assert.equal(lines[0].booking, null, "the booking's own lines stay its customer's");
    assert.equal(lines[0].conversation, STRANGER);
    assert.deepEqual(lines[0].refs, { case: "b-1", via: "reference", to: "owner" });
    assert.doesNotMatch(lines[0].notes + JSON.stringify(lines[0].refs), /9811111111|98111 11111/u, "no other number in the line");
    // the same ask again within the hour: the same line, the owner not told again
    await s.inbound(STRANGER, "booking b-1 please");
    assert.equal(s.sent(STRANGER).at(-1)!.text, NOT_SHOWN);
    assert.equal(s.sent(OWNER_NUMBER).length, ownerBefore + 1, "at most once an hour per asker and booking");
    assert.equal(s.record().filter((r) => r.action === "case_asked_elsewhere").at(-1)!.outcome, "blocked");
    const status = await s.status();
    assert.equal(status.bookings.confirmed, 1, "the booking is as it was");
    assert.equal(s.guards!.of("payments", "POST", /\/refund$/u).length, 0, "no money moved");
  });

  contract("the payment id the record holds names the booking too", async () => {
    const s = await booked();
    const paymentId = s.record().find((r) => r.booking === "b-1" && r.refs.paymentId?.startsWith("pay_"))?.refs.paymentId;
    assert.ok(paymentId, JSON.stringify(s.record().map((r) => r.refs)));
    await s.inbound(STRANGER, `I paid with ${paymentId}, is it booked?`);
    assert.equal(s.sent(STRANGER).at(-1)!.text, NOT_SHOWN);
    assert.equal(s.record().filter((r) => r.action === "case_asked_elsewhere")[0].refs.via, "payment");
  });

  contract("a reference the shop does not hold: the usual answer, and the owner hears nothing", async () => {
    const s = await booked();
    const ownerBefore = s.sent(OWNER_NUMBER).length;
    await s.inbound(STRANGER, "what about b-7?");
    assert.notEqual(s.sent(STRANGER).at(-1)!.text, NOT_SHOWN);
    assert.equal(s.sent(OWNER_NUMBER).length, ownerBefore, "guessing references gives nothing away");
    assert.equal(s.record().filter((r) => r.action === "case_asked_elsewhere").length, 0);
  });

  contract("the customer who holds the booking is answered as before", async () => {
    const s = await booked();
    const ownerBefore = s.sent(OWNER_NUMBER).length;
    await s.inbound(CUSTOMER, "what about b-1?");
    assert.notEqual(s.sent(CUSTOMER).at(-1)!.text, NOT_SHOWN);
    assert.equal(s.sent(OWNER_NUMBER).length, ownerBefore);
  });
});

describe("a UPI refund goes back to the account that paid", () => {
  const upi = { payment: { module: "upi", upi: { id: "glowsalon@okicici", payee: "Glow Salon" } }, calendar: { module: "own" }, deposit: { amountInr: 200, holdMinutes: 60 } };

  contract("the owner's refund message names the payment's note, amount and day, under owner_upi_refund_to_account", async () => {
    const s = await boot({ mode: "guards", settings: upi });
    const { hash } = await s.book({ phone: CUSTOMER });
    const items = (await s.ownerView()).body.items;
    const before = Date.now();
    await s.channelEvents([{ kind: "owner_action", id: "m-1", action: "received", case: "b-1", digest: items[0].digest }], { owner: true }); await s.settle();
    const after = Date.now();
    assert.equal((await s.request(hash)).body.status, "booked");
    await s.channelEvents([{ kind: "channel_request", id: "cancel-1", channel: "web", op: "cancel", handle: hash }]); await s.settle();
    const told = s.sent(OWNER_NUMBER).filter((m) => m.templateName === "owner_upi_refund_to_account");
    assert.equal(told.length, 1, JSON.stringify(s.sent(OWNER_NUMBER).map((m) => m.templateName)));
    const days = [before, after].map((ms) => formatDate(localParts(ms, TZ), "en"));
    assert.ok(days.some((d) => told[0].text.startsWith(`Refund to send: ₹200 back to the account that paid you ₹200 on ${d} with the note b-1. `)), told[0].text);
    assert.match(told[0].text, /I'll tell the customer \(\+91 98111 11111\) once it's marked sent\./u);
    assert.doesNotMatch(told[0].text, /by UPI to \+91/u, "never told to send it to the customer's number");
  });
});
