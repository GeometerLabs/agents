// The crash-test situations of a shop that takes UPI, marked paid by the owner (plan B33). Like every situation they start a fresh world, make something go wrong
// on purpose and judge from the stand-ins' own records: the calendar, the WhatsApp outbox (the QR picture and every word), the record, and the shop's UPI ledger,
// which holds the owner's marks and nothing else (a UPI shop has no payment service the agent can read: the owner's mark IS its payment record).
//
// The situations the plan names: a screenshot sent as proof, the owner confirming a different amount, never confirming, confirming twice, confirming after the hold
// was released. Around them: a normal UPI booking in every language the shop speaks, a refund the owner owes (reminded, and "sent" only after the owner's mark),
// the calendar failing silently on the hold, and the same message twice. The situations written around a Razorpay payment link do not run on a UPI shop: they are
// listed as not run, with the reason (situations.ts).
import { createWorld, CUSTOMER } from "../src/harness.ts";
import type { World } from "../src/harness.ts";
import { checker } from "../../../../modules/crash-test/situations.ts";
import type { Situation } from "../../../../modules/crash-test/situations.ts";
import { formatInr, formatSlot } from "../../../../modules/language/format.ts";
import { languageList } from "./says.ts";
import { readUpiLink } from "../../../../modules/payments/providers/upi/link.ts";
import { textQrPng } from "../../../../modules/qr/png.ts";
import { memoryQrImages } from "../../../../modules/payments/owner-marked/qr-image.ts";
import { MARK_ACTIONS, markObligations } from "../../../../modules/payments/owner-marked/obligations.ts";
import { REFUND_REMINDERS_MAX } from "../../../../modules/payments/owner-marked/ledger.ts";
import { ownerMarkedOf } from "../../../../modules/payments/providers/index.ts";
import type { Language } from "../../../../modules/language/languages.ts";
import type { Shop, Slot } from "./shop.ts";

type Built = Situation | { id: string; title: string; skip: string };

/** The words a customer books with, in a language (the shop's own sayings: situations.ts hands them in). */
export type BookWords = (language: Language, slot: Slot) => string;

const confirmedEvents = (w: World) => w.calendar.events().filter((e) => e.status === "confirmed" && e.bookingRef !== "foreign");
const bookingEvents = (w: World) => w.calendar.events().filter((e) => e.bookingRef !== "foreign");
/** Messages that went (confirmed in the record) made from this template, to this person. Language-free: the record names the template. */
const sent = (w: World, template: string, to: "customer" | "owner" = "customer") =>
  w.record.entries().filter((e) => e.action === "send_message" && e.outcome === "confirmed" && e.refs.to === to && (e.refs.templates ?? "").split("+").includes(template)).length;
const toldBooked = (w: World) => sent(w, "upi_booked");
const entries = (w: World, action: string, outcome?: string) => w.record.entries().filter((e) => e.action === action && (!outcome || e.outcome === outcome));
const markedPaise = (w: World, ref: string) => w.upiRequest(ref)?.marks.reduce((n, m) => n + m.amountPaise, 0) ?? 0;
const open = (w: World) => markObligations(w.record.entries()).map((o) => `${o.kind} ${o.case} ${o.amountPaise}`);
/** The owner wrote to the shop's number today, so their 24-hour window is open and the agent's notice comes with buttons. (Otherwise it comes as a WhatsApp template, which asks them to type the reply.) */
const ownerWroteToday = (w: World) => { w.messaging.receive(w.owner, "ok"); };

export function buildUpiSituations(shop: Shop, book: BookWords): Built[] {
  const upi = ownerMarkedOf(shop.settings.payment)!.payTo; // who the customer pays: the shop's UPI ID and name
  const D = shop.depositInr;
  const hold = shop.settings.deposit.holdMinutes;
  const slot = shop.pick({ minLeadMs: (hold + 60) * 60_000 });
  const en = shop.lang("en");
  const noSlot = "the shop has no day in the next two weeks with a time that fits the service on its slot grid";
  const world = () => { const qr = memoryQrImages(); return { w: createWorld({ settings: shop.settings, qrImage: qr.make }), qr }; };
  const out: Built[] = [];
  const add = (id: string, title: string, how: string, run: Situation["run"]) => out.push(!slot ? { id, title, skip: noSlot } : { id, title, how, run });

  // 1. A normal UPI booking, in every language the shop speaks
  add("upi-booking-works", `A UPI booking, in ${languageList(shop.languages)}: booked only when the owner marks the deposit received`, "No faults; the customer pays the shop's own UPI ID and the owner taps Received", async () => {
    const { results, expect } = checker();
    for (const [i, language] of shop.inOrder(["hi", "en", "ml", "kn"]).entries()) {
      const { w, qr } = world();
      const taps = i % 2 === 0; // half the languages: the owner's window is open and they tap; the other half: a template, and they type "received <code>"
      if (taps) ownerWroteToday(w);
      await w.say(book(language, slot!));
      const request = w.upiRequest("b-1");
      const out = w.messaging.sentTo(CUSTOMER);
      const link = request ? readUpiLink(request.link) : null;
      expect(`(${language}) The link asks for exactly ${formatInr(D)}, to the shop's UPI ID, with the booking number and no code`, link?.pa === upi.id && link?.am === `${D}.00` && link?.tn === "b-1" && link.cu === "INR" && !request!.link.includes(request!.code ?? "-"), request?.link ?? "no request");
      expect(`(${language}) The customer got the QR picture first, and it is the picture of that very link`, out[0]?.kind === "image" && !!request && qr.files.get(out[0].image!.link)?.equals(textQrPng(request.link)) === true, JSON.stringify(out.map((m) => m.kind)));
      // 14 Nov 2026: the words carry the UPI ID and the amount, and never the upi:// link itself: WhatsApp does not open it, so it only read as a long broken string (the QR above is that link)
      expect(`(${language}) The words carry the UPI ID and the amount, and no upi:// link (WhatsApp does not open one; the QR picture is that link)`, !!request && out[1]?.text.includes(upi.id) && out[1].text.includes(formatInr(D)) && !out[1].text.includes("upi://") && !w.textsTo(CUSTOMER).some((t) => t.includes("upi://")), out[1]?.text ?? "");
      expect(`(${language}) The owner was told what to look for, with a code no customer message carries`, !!request?.code && w.textsTo(w.owner).some((t) => t.includes(request.code!)) && !w.textsTo(CUSTOMER).some((t) => t.includes(request.code!)));
      expect(`(${language}) Nothing is booked before the owner's mark: the slot is only held`, confirmedEvents(w).length === 0 && bookingEvents(w).length === 1 && toldBooked(w) === 0);
      await w.ownerMarksReceived("b-1", { tap: taps });
      expect(`(${language}) After the owner ${taps ? "taps Received" : "replies \"received <code>\""}: one confirmed calendar event at ${formatSlot(slot!.startMs, shop.tz, "en")}`, confirmedEvents(w).length === 1 && confirmedEvents(w)[0].start === slot!.startMs, JSON.stringify(w.calendar.events()));
      expect(`(${language}) The customer was told it is booked, once`, toldBooked(w) === 1);
      expect(`(${language}) The record says the deposit was marked paid by the owner, once, for ${formatInr(D)}`, entries(w, MARK_ACTIONS.marked, "confirmed").length === 1 && entries(w, MARK_ACTIONS.marked)[0].refs.amountPaise === String(D * 100) && entries(w, MARK_ACTIONS.marked)[0].refs.markedBy === "owner");
    }
    return results;
  });

  // 2. A screenshot sent as proof
  add("upi-screenshot", "A screenshot sent as proof books nothing: the owner is asked to look", "The customer sends a picture of a payment, then taps \"I have paid\" and writes that they paid", async () => {
    const { results, expect } = checker();
    const { w } = world();
    await w.say(book(en, slot!));
    await w.say("", { image: true });
    expect("The customer was told the owner will confirm, and that a screenshot is not proof", sent(w, "upi_paid_claim") === 1);
    expect("Nothing was marked paid: no mark in the ledger or the record, and the slot is only held", markedPaise(w, "b-1") === 0 && entries(w, MARK_ACTIONS.marked).length === 0 && confirmedEvents(w).length === 0 && bookingEvents(w).length === 1);
    expect("The owner was asked to look in their UPI app, with the code", sent(w, "owner_upi_claim", "owner") === 1);
    await w.tap("paid");
    await w.say("I have paid");
    expect("Tapping \"I have paid\" and writing it change nothing either, and the owner is not asked again within the hour", markedPaise(w, "b-1") === 0 && toldBooked(w) === 0 && sent(w, "owner_upi_claim", "owner") === 1 && sent(w, "upi_paid_claim") === 3);
    expect("The customer was never told it is booked", toldBooked(w) === 0);
    await w.advance(11);
    expect("The unfinished work lists it: a UPI payment not yet confirmed by the owner", open(w).includes(`upi_payment_unconfirmed b-1 ${D * 100}`), open(w).join(" | "));
    await w.ownerMarksReceived("b-1");
    expect("Only the owner's mark books it, once", toldBooked(w) === 1 && confirmedEvents(w).length === 1 && open(w).length === 0, open(w).join(" | "));
    return results;
  });

  // 3. The owner confirms a different amount
  const part = Math.max(1, Math.floor(D / 2));
  add("upi-different-amount", "The owner confirms a different amount: not paid in full, the hold stays and the owner is asked", `The owner replies "received <code> ${part}" for a ${formatInr(D)} deposit; then the rest, or not; and another time more than the deposit`, async () => {
    const { results, expect } = checker();
    // (a) less, then the rest
    const a = world().w;
    await a.say(book(en, slot!));
    const first = a.upiRequest("b-1")!.code!;
    await a.ownerMarksReceived("b-1", { amountInr: part });
    expect(`Less (${formatInr(part)}): not booked, and the slot is still held`, toldBooked(a) === 0 && confirmedEvents(a).length === 0 && bookingEvents(a).length === 1);
    const second = a.upiRequest("b-1")!.code;
    expect(`The owner was asked for the other ${formatInr(D - part)}, with a new code and a button for that amount`, !!second && second !== first && sent(a, "owner_upi_part", "owner") === 1 && a.messaging.sentTo(a.owner).at(-1)?.interactive?.buttons?.[0].id === `upi-received:${second}` && (a.messaging.sentTo(a.owner).at(-1)?.interactive?.buttons?.[0].title ?? "").includes(formatInr(D - part)));
    await a.ownerMarksReceived("b-1", { code: first });
    expect("The first code again counts nothing", markedPaise(a, "b-1") === part * 100 && sent(a, "owner_upi_already", "owner") === 1);
    await a.ownerMarksReceived("b-1", { tap: true });
    expect("With the rest marked it is booked, once, and the marks add up to the deposit", toldBooked(a) === 1 && confirmedEvents(a).length === 1 && markedPaise(a, "b-1") === D * 100);
    // (b) less, and the hold runs out
    const b = world().w;
    await b.say(book(en, slot!));
    await b.ownerMarksReceived("b-1", { amountInr: part });
    await b.advance(hold + 1);
    expect("Less, and the hold runs out: released, the calendar holds nothing, the customer was told", bookingEvents(b).length === 0 && sent(b, "upi_hold_expired") === 1 && toldBooked(b) === 0);
    expect(`The ${formatInr(part)} marked is owed back by the owner, and the agent sent no money (the refund is owed, not sent)`, b.upiRefunds("b-1").length === 1 && b.upiRefunds("b-1")[0].amountPaise === part * 100 && b.upiRefunds("b-1")[0].state === "owed" && sent(b, "upi_refund_sent") === 0);
    // (c) more than the deposit
    const c = world().w;
    await c.say(book(en, slot!));
    await c.ownerMarksReceived("b-1", { amountInr: D + 50 });
    expect(`More (${formatInr(D + 50)}): booked once, and the extra ${formatInr(50)} is owed back by the owner`, toldBooked(c) === 1 && c.upiRefunds("b-1").length === 1 && c.upiRefunds("b-1")[0].amountPaise === 5000 && sent(c, "upi_extra_refund_owed") === 1);
    return results;
  });

  // 4. The owner never confirms
  add("upi-never-confirmed", "The owner never confirms: the hold is released when its time runs out", `Nobody marks the deposit; ${hold + 1} minutes pass`, async () => {
    const { results, expect } = checker();
    const { w } = world();
    await w.say(book(en, slot!));
    await w.advance(hold - 1);
    expect("Before the hold ends the slot is still held", bookingEvents(w).length === 1 && confirmedEvents(w).length === 0);
    await w.advance(2);
    expect("When the hold ends the calendar holds nothing", bookingEvents(w).length === 0, JSON.stringify(w.calendar.events()));
    expect("The request is closed in the record (a later mark is still recorded, and never books by itself)", entries(w, MARK_ACTIONS.closed, "confirmed").length === 1 && w.upiRequest("b-1")?.status === "cancelled");
    expect("The customer was told the hold ended because the owner had not confirmed it, once, and never that it is booked", sent(w, "upi_hold_expired") === 1 && toldBooked(w) === 0);
    expect("Nothing is owed back, and nothing is left on the unfinished list", w.upiRefunds("b-1").length === 0 && open(w).length === 0, open(w).join(" | "));
    return results;
  });

  // 5. The owner confirms twice
  add("upi-confirmed-twice", "The owner confirms twice: it counts once", "The owner taps Received, taps it again, and also types the code", async () => {
    const { results, expect } = checker();
    const { w } = world();
    ownerWroteToday(w);
    await w.say(book(en, slot!));
    const code = w.upiRequest("b-1")!.code!;
    await w.ownerMarksReceived("b-1", { tap: true });
    await w.ownerMarksReceived("b-1", { tap: true, code });
    await w.ownerMarksReceived("b-1", { code });
    expect("One mark in the ledger, one in the record", w.upiRequest("b-1")!.marks.length === 1 && entries(w, MARK_ACTIONS.marked, "confirmed").length === 1);
    expect("One confirmed calendar event, and the customer told once", confirmedEvents(w).length === 1 && toldBooked(w) === 1);
    expect("The owner was told twice that it was already counted", sent(w, "owner_upi_already", "owner") === 2);
    expect("Nothing is owed back", w.upiRefunds("b-1").length === 0);
    return results;
  });

  // 6. The owner confirms after the hold was released
  add("upi-confirmed-after-release", "The owner confirms after the hold was released: recorded as received, not booked again by itself, the owner and the partner told", `The hold runs out (${hold + 1} minutes), then the owner taps Received`, async () => {
    const { results, expect } = checker();
    const { w } = world();
    await w.say(book(en, slot!));
    await w.advance(hold + 1);
    await w.ownerMarksReceived("b-1");
    expect(`Recorded as received: ${formatInr(D)}, marked paid by the owner, after the request was closed`, entries(w, MARK_ACTIONS.marked, "confirmed").length === 1 && w.upiRequest("b-1")!.marks[0].afterClose === true);
    expect("Not booked again by itself: no event in the calendar, and no \"booked\"", bookingEvents(w).length === 0 && toldBooked(w) === 0);
    expect("The customer was told the owner will contact them", sent(w, "upi_late_received") === 1);
    expect("The owner was told, with Refund sent and Kept for booking", sent(w, "owner_upi_late", "owner") === 1 && (w.messaging.sentTo(w.owner).at(-1)?.interactive?.buttons ?? []).map((b) => b.id.split(":")[0]).join(",") === "upi-refunded,upi-kept");
    const issue = w.store.bookings.get("b-1")?.refundIssues?.find((i) => i.kind === "late_upi");
    expect("The partner is told: the shop's status counts it for the builder, and the unfinished work lists the money as owed back", !!issue && open(w).includes(`upi_refund_owed b-1 ${D * 100}`), open(w).join(" | "));
    await w.ownerMarksRefund("b-1", { tap: true, kept: true });
    expect("When the owner keeps it for a booking made by hand, nothing is owed and the customer is not told it was refunded", open(w).length === 0 && sent(w, "upi_refund_sent") === 0 && entries(w, MARK_ACTIONS.refundKept, "confirmed").length === 1);
    return results;
  });

  // 7. A refund the owner owes
  add("upi-refund-tracked", "A UPI refund: owed by the owner, reminded, and \"sent\" only after the owner marks it", "A paid booking is cancelled inside the window; the owner does nothing for days, then marks the refund sent", async () => {
    const { results, expect } = checker();
    const { w } = world();
    await w.say(book(en, slot!));
    await w.ownerMarksReceived("b-1");
    await w.say("cancel");
    expect("The customer was told the owner will send it back, and never that it was refunded or sent", sent(w, "upi_cancelled_refund_owed") === 1 && sent(w, "upi_refund_sent") === 0 && sent(w, "cancelled_refund") === 0);
    expect(`The ledger shows ${formatInr(D)} owed by the owner; the agent sent nothing`, w.upiRefunds("b-1").length === 1 && w.upiRefunds("b-1")[0].state === "owed" && w.payments.refunds().length === 0);
    expect("The owner was told what to send, with a code and a Refund sent button", sent(w, "owner_upi_refund_owed", "owner") === 1);
    for (let day = 0; day < REFUND_REMINDERS_MAX + 2; day++) await w.advance(24 * 60);
    expect(`The owner was reminded once a day, ${REFUND_REMINDERS_MAX} times at most`, sent(w, "owner_upi_refund_reminder", "owner") === REFUND_REMINDERS_MAX && entries(w, MARK_ACTIONS.refundReminder).length === REFUND_REMINDERS_MAX);
    expect("It stays on the unfinished list: a refund owed by the owner, not yet marked done", open(w).includes(`upi_refund_owed b-1 ${D * 100}`), open(w).join(" | "));
    expect("Still no message says it was sent", sent(w, "upi_refund_sent") === 0);
    await w.ownerMarksRefund("b-1");
    await w.ownerMarksRefund("b-1");
    expect("After the owner's mark the customer is told it was sent, once, and the list is clear", sent(w, "upi_refund_sent") === 1 && open(w).length === 0 && entries(w, MARK_ACTIONS.refundDone, "confirmed").length === 1);
    return results;
  });

  // 8. The calendar fails silently on the hold
  add("upi-calendar-silent-failure-on-hold", "Calendar silently fails to hold the slot: no UPI request is made", "The calendar says ok to the hold but stores nothing (twice)", async () => {
    const { results, expect } = checker();
    const { w } = world();
    w.calendar.inject("insert", "silentFailure", { times: 2 });
    await w.say(book(en, slot!));
    expect("No UPI request, no QR picture, and no link for a slot that is not held", (w.store.upi?.requests.length ?? 0) === 0 && !w.messaging.sentTo(CUSTOMER).some((m) => m.kind === "image" || m.text.includes("upi://")));
    expect("The owner was told nothing is booked, and not told to expect a payment", sent(w, "owner_not_booked", "owner") === 1 && sent(w, "owner_upi_expected", "owner") === 0);
    return results;
  });

  // 9. The same message twice
  add("upi-duplicate-inbound", "Same WhatsApp message arrives twice: one UPI request, not two", "The provider delivers the same message id twice", async () => {
    const { results, expect } = checker();
    const { w, qr } = world();
    const m = await w.say(book(en, slot!));
    await w.redeliver(m);
    expect("One request, one QR picture, one message to the owner", (w.store.upi?.requests.length ?? 0) === 1 && qr.files.size === 1 && sent(w, "owner_upi_expected", "owner") === 1);
    expect("One hold in the calendar", bookingEvents(w).length === 1);
    return results;
  });

  return out;
}

/** Why a situation written around a Razorpay payment link does not run on a UPI shop. */
export const RAZORPAY_ONLY = "this shop takes UPI, marked paid by the owner: the situation is written around a Razorpay payment link (a link paid, a webhook, a refund through Guard). The UPI situations cover the deposit here; this one runs on a Razorpay shop";
