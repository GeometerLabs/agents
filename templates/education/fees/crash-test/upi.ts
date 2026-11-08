// The crash-test situations of a centre that takes UPI, marked paid by the owner (plan B33). Like every situation they start a fresh world, make something go wrong
// on purpose and judge from the stand-ins' own records: the WhatsApp outbox (the QR picture and every word), the record, and the centre's UPI ledger, which holds
// the owner's marks and nothing else (a UPI centre has no payment service the agent can read: the owner's mark IS its payment record).
//
// The plan's five: a screenshot sent as proof, the owner confirming a different amount, never confirming (the normal reminders go on), confirming twice, and
// confirming a request after it was closed (for Fees, a request replaced when the late fee changed the amount: the money still counts toward the fee). Around
// them: a fee paid by UPI in every language the centre speaks, and a refund the owner owes. The situations written around a Razorpay payment link do not run on a
// UPI centre: they are listed as not run, with the reason (situations.ts).
import { MINUTE } from "../../../../modules/core/time.ts";
import { checker } from "../../../../modules/crash-test/situations.ts";
import type { CheckResult, Situation } from "../../../../modules/crash-test/situations.ts";
import { formatInr } from "../../../../modules/language/format.ts";
import { LANGUAGE_NAMES } from "../../../../modules/language/languages.ts";
import type { Language } from "../../../../modules/language/languages.ts";
import { readUpiLink } from "../../../../modules/payments/upi/link.ts";
import { REFUND_REMINDERS_MAX } from "../../../../modules/payments/upi/ledger.ts";
import { UPI_ACTIONS, upiObligations } from "../../../../modules/payments/upi/obligations.ts";
import { textQrPng } from "../../../../modules/payments/qr/png.ts";
import { memoryQrImages } from "../../../../modules/payments/upi/qr-image.ts";
import { upiOf } from "../../../../modules/payments/upi/settings.ts";
import { createWorld } from "../src/harness.ts";
import type { World } from "../src/harness.ts";
import { SAYS } from "./says.ts";
import type { Shop } from "./shop.ts";

type Built = Situation | { id: string; title: string; skip: string };

/** Why a situation written around a Razorpay payment link does not run on a UPI centre. */
export const RAZORPAY_ONLY = "this centre takes UPI, marked paid by the owner: the situation is written around a Razorpay payment link (a link paid, a webhook, a refund through Guard). The UPI situations cover the fee here; this one runs on a Razorpay centre";

export function buildUpiSituations(shop: Shop): Built[] {
  const upi = upiOf(shop.settings.payment)!;
  const name = shop.student.name;
  const fee = shop.feeInr;
  const out: Built[] = [];
  const add = (id: string, title: string, how: string, run: () => Promise<CheckResult[]>) => out.push({ id, title, how, run });

  const world = (language?: Language) => {
    const qr = memoryQrImages();
    const settings = language ? { ...shop.settings, students: shop.settings.students.map((s) => (s.name === name ? { ...s, language } : s)) } : shop.settings;
    return { w: createWorld({ settings, nowMs: shop.startMs, qrImage: qr.make }), qr };
  };
  const at = async (w: World, ms: number) => { w.clock.set(ms); await w.tick(); };
  const atReminder = (w: World, n: number) => at(w, shop.moments[n] + MINUTE);
  const due = (w: World) => w.dueOf(name)!;
  /** Messages that went (confirmed in the record) made from this template. Language-free: the record names the template. */
  const sent = (w: World, template: string, to: "customer" | "owner" = "customer") =>
    w.record.entries().filter((e) => e.action === "send_message" && e.outcome === "confirmed" && e.refs.to === to && (e.booking === due(w).id || to === "owner") && (e.refs.templates ?? "").split("+").includes(template)).length;
  const entries = (w: World, action: string, outcome?: string) => w.record.entries().filter((e) => e.booking === due(w).id && e.action === action && (!outcome || e.outcome === outcome));
  const open = (w: World) => upiObligations(w.record.entries()).filter((o) => o.case === due(w).id).map((o) => `${o.kind} ${o.amountPaise}`);
  const remindersSent = (w: World) => due(w).remindersSent;
  const parentWroteToday = (w: World) => w.messaging.receive(shop.parent, "ok"); // the parent's window is open: the QR picture can go
  const ownerWroteToday = (w: World) => w.messaging.receive(w.owner, "ok"); // the owner's window is open: the notice comes with buttons

  // 1. A fee paid by UPI, in every language the centre speaks
  add("fee-upi-paid", `A fee paid by UPI, in ${shop.settings.languages.map((l) => LANGUAGE_NAMES[l]).join(", ")}: paid only when the owner marks it received`, "No faults; the parent pays the centre's own UPI ID and the owner taps Received", async () => {
    const all: CheckResult[] = [];
    for (const [i, lang] of shop.settings.languages.entries()) {
      const { results, expect } = checker();
      const { w, qr } = world(lang);
      const taps = i % 2 === 0;
      if (taps) ownerWroteToday(w);
      await atReminder(w, 0);
      const request = w.upiRequest(name);
      const link = request ? readUpiLink(request.link) : null;
      expect(`The request asks for exactly ${formatInr(fee)}, to the centre's UPI ID, with the fee's reference and no code`, link?.pa === upi.id && link?.am === `${fee}.00` && (link?.tn ?? "").startsWith(`${due(w).id}.`) && !request!.link.includes(request!.code ?? "-"), request?.link ?? "no request");
      expect("The reminder carries the link and the UPI ID as words", w.messaging.sentTo(shop.parent).some((m) => !!request && m.text.includes(request.link) && m.text.includes(upi.id)));
      expect("The owner was told what to look for, with a code no parent message carries", !!request?.code && sent(w, "owner_fee_upi_expected", "owner") >= 1 && !w.messaging.sentTo(shop.parent).some((m) => m.text.includes(request.code!)));
      parentWroteToday(w);
      await w.say(SAYS[lang].pay, { from: shop.parent });
      const picture = w.messaging.sentTo(shop.parent).find((m) => m.kind === "image");
      expect("Asked for the link, the parent gets the QR picture of that very request", !!picture && !!request && qr.files.get(picture.image!.link)?.equals(textQrPng(request.link)) === true);
      expect("Nothing is marked paid before the owner's mark", due(w).state === "open" && entries(w, UPI_ACTIONS.marked).length === 0);
      await w.ownerMarksReceived(name, { tap: taps });
      expect(`After the owner ${taps ? "taps Received" : "replies \"received <code>\""} the fee is paid, and the parent got one receipt`, due(w).state === "paid" && sent(w, "fee_received") === 1);
      expect("The record says it was marked paid by the owner, once, for the fee", entries(w, UPI_ACTIONS.marked, "confirmed").length === 1 && entries(w, UPI_ACTIONS.marked)[0].refs.amountPaise === String(fee * 100) && entries(w, UPI_ACTIONS.marked)[0].refs.markedBy === "owner");
      const before = remindersSent(w);
      for (const m of shop.moments.slice(1)) await at(w, m + MINUTE);
      expect("No reminder goes out once the owner has marked it paid", remindersSent(w) === before);
      all.push(...results.map((r) => ({ ...r, label: `[${LANGUAGE_NAMES[lang]}] ${r.label}` })));
    }
    return all;
  });

  // 2. A screenshot sent as proof
  add("fee-upi-screenshot", "A screenshot sent as proof marks nothing paid: the owner is asked to look", "The parent sends a picture of a payment, then writes that they paid", async () => {
    const { results, expect } = checker();
    const { w } = world();
    await atReminder(w, 0);
    await w.say("", { from: shop.parent, image: true });
    expect("The parent was told the owner will confirm, and that a screenshot is not proof", sent(w, "fee_upi_claim") === 1);
    expect("Nothing was marked paid: the fee is open and the record has no mark", due(w).state === "open" && entries(w, UPI_ACTIONS.marked).length === 0 && sent(w, "fee_received") === 0);
    expect("The owner was asked to look in their UPI app, with the code", sent(w, "owner_fee_upi_claim", "owner") === 1);
    await w.say(SAYS[shop.language].paid, { from: shop.parent });
    expect("Writing \"I already paid\" changes nothing either, and the owner is not asked again within the hour", due(w).state === "open" && sent(w, "owner_fee_upi_claim", "owner") === 1 && sent(w, "fee_upi_claim") === 2);
    await w.advance(11);
    expect("The unfinished work lists it: a UPI payment not yet confirmed by the owner", open(w).includes(`upi_payment_unconfirmed ${fee * 100}`), open(w).join(" | "));
    const before = remindersSent(w);
    await atReminder(w, 1);
    expect("The normal reminders go on until the owner marks it", remindersSent(w) === before + 1);
    await w.ownerMarksReceived(name);
    expect("Only the owner's mark settles it, with one receipt, and the list is clear", due(w).state === "paid" && sent(w, "fee_received") === 1 && open(w).length === 0, open(w).join(" | "));
    return results;
  });

  // 3. The owner confirms a different amount
  const part = Math.max(1, Math.floor(fee / 3));
  add("fee-upi-different-amount", "The owner confirms a different amount: less is a part payment; more settles the fee and the extra is owed back", `The owner replies "received <code> ${part}" for a ${formatInr(fee)} fee, then the rest; another time ${formatInr(fee + 100)}`, async () => {
    const { results, expect } = checker();
    const a = world().w;
    await atReminder(a, 0);
    const first = a.upiRequest(name)!.code!;
    await a.ownerMarksReceived(name, { amountInr: part });
    expect(`Less (${formatInr(part)}): not paid in full, the parent got a part receipt`, due(a).state === "open" && sent(a, "fee_part_received") === 1 && sent(a, "fee_received") === 0);
    const rest = a.upiRequest(name);
    expect(`The rest has a request of its own for exactly ${formatInr(fee - part)}, since a UPI app cannot change the amount`, rest?.amountPaise === (fee - part) * 100 && readUpiLink(rest!.link)?.am === `${fee - part}.00`);
    expect("The owner was told what is still to come, with the rest's code", sent(a, "owner_fee_upi_part", "owner") === 1 && !!rest?.code && a.messaging.sentTo(a.owner).at(-1)?.text.includes(rest.code));
    await a.ownerMarksReceived(name, { code: first });
    expect("The first code again counts nothing", entries(a, UPI_ACTIONS.marked).length === 1 && sent(a, "owner_fee_upi_already", "owner") === 1);
    const before = remindersSent(a);
    await atReminder(a, 1);
    expect("The normal reminders go on, for the rest", remindersSent(a) === before + 1);
    await a.ownerMarksReceived(name);
    expect("With the rest marked the fee is paid, once", due(a).state === "paid" && sent(a, "fee_received") === 1);
    const b = world().w;
    await atReminder(b, 0);
    await b.ownerMarksReceived(name, { amountInr: fee + 100 });
    expect(`More (${formatInr(fee + 100)}): the fee is paid, and the extra ${formatInr(100)} is owed back by the owner, not sent by the agent`, due(b).state === "paid" && b.upiRefunds(name).length === 1 && b.upiRefunds(name)[0].amountPaise === 10_000 && b.upiRefunds(name)[0].state === "owed" && sent(b, "fee_upi_refund_owed") === 1 && sent(b, "fee_upi_refund_sent") === 0);
    return results;
  });

  // 4. The owner never confirms
  add("fee-upi-never-confirmed", "The owner never confirms: the normal reminders go on, and nothing is marked paid", "Nobody marks the fee; every reminder moment of the month passes", async () => {
    const { results, expect } = checker();
    const { w } = world();
    for (const m of shop.moments) await at(w, m + MINUTE);
    expect("The fee stays open, and nothing is marked paid", due(w).state === "open" && entries(w, UPI_ACTIONS.marked).length === 0 && sent(w, "fee_received") === 0);
    expect(`The reminders went as on any centre, ${shop.settings.reminders.maxPerMonth} at most`, remindersSent(w) >= 1 && remindersSent(w) <= shop.settings.reminders.maxPerMonth);
    expect("Nobody said they paid, so it is not on the owner's unfinished list", open(w).length === 0, open(w).join(" | "));
    return results;
  });

  // 5. The owner confirms twice
  add("fee-upi-confirmed-twice", "The owner confirms twice: it counts once", "The owner taps Received, taps it again, and types the code", async () => {
    const { results, expect } = checker();
    const { w } = world();
    ownerWroteToday(w);
    await atReminder(w, 0);
    const code = w.upiRequest(name)!.code!;
    await w.ownerMarksReceived(name, { tap: true });
    await w.ownerMarksReceived(name, { tap: true, code });
    await w.ownerMarksReceived(name, { code });
    expect("One mark in the record, and the fee paid by exactly the fee", entries(w, UPI_ACTIONS.marked, "confirmed").length === 1 && due(w).state === "paid" && due(w).payments.reduce((n, p) => n + p.amountPaise, 0) === fee * 100);
    expect("One receipt to the parent", sent(w, "fee_received") === 1);
    expect("The owner was told twice that it was already counted", sent(w, "owner_fee_upi_already", "owner") === 2);
    expect("Nothing is owed back", w.upiRefunds(name).length === 0);
    return results;
  });

  // 6. The owner confirms a request after it was replaced
  if (shop.lateFeeAtMs === undefined || shop.lateFeeInr <= 0) out.push({ id: "fee-upi-confirmed-after-replaced", title: "The owner confirms a request after it was replaced", skip: "the centre has no late fee, so a request is never replaced by one for a new amount" });
  else add("fee-upi-confirmed-after-replaced", "The owner confirms a request after it was replaced (the late fee changed the amount): it counts toward the fee, once", "The late fee is added and a new request made; then the owner marks the first request's code", async () => {
    const { results, expect } = checker();
    const { w } = world();
    await atReminder(w, 0);
    const first = w.upiRequest(name)!;
    const code = first.code!;
    await at(w, shop.lateFeeAtMs! + MINUTE);
    const second = w.upiRequest(name)!;
    expect("The late fee made a new request for the new amount, and the first was closed in the record", second.id !== first.id && second.amountPaise === (fee + shop.lateFeeInr) * 100 && entries(w, UPI_ACTIONS.closed, "confirmed").some((e) => e.refs.requestId === first.id));
    await w.ownerMarksReceived(name, { code });
    expect(`Recorded as received: ${formatInr(fee)} marked paid by the owner on the first request`, entries(w, UPI_ACTIONS.marked, "confirmed").length === 1 && entries(w, UPI_ACTIONS.marked)[0].refs.requestId === first.id);
    expect(`It counts toward the fee: ${formatInr(shop.lateFeeInr)} is still to pay, and the parent was told`, due(w).state === "open" && due(w).payments.reduce((n, p) => n + p.amountPaise, 0) === fee * 100 && sent(w, "fee_part_received") === 1);
    await w.ownerMarksReceived(name, { code });
    expect("The same code again counts nothing", entries(w, UPI_ACTIONS.marked).length === 1);
    return results;
  });

  // 7. A refund the owner owes
  add("fee-upi-refund-tracked", "A UPI refund: owed by the owner, reminded, and \"sent\" only after the owner marks it", "The fee is paid; the parent asks for some back and the owner approves; the owner does nothing for days, then marks it sent", async () => {
    const { results, expect } = checker();
    const { w } = world();
    await atReminder(w, 0);
    await w.ownerMarksReceived(name);
    const back = Math.min(shop.refundLimitInr, fee);
    await w.say(SAYS.en.refund(back), { from: shop.parent });
    const q = due(w).pending.find((p) => p.kind === "refund_request");
    expect("The parent's request went to the owner (approve or deny), as every refund on a UPI centre does", !!q);
    if (q) await w.ownerSays(`approve ${q.id}`);
    expect("The parent was told the owner will send it, and never that it was refunded or sent", sent(w, "fee_upi_refund_owed") === 1 && sent(w, "fee_upi_refund_sent") === 0 && sent(w, "fee_refund_done") === 0);
    expect(`The ledger shows ${formatInr(back)} owed by the owner; the agent sent nothing`, w.upiRefunds(name).length === 1 && w.upiRefunds(name)[0].state === "owed" && w.payments.refunds().length === 0);
    for (let day = 0; day < REFUND_REMINDERS_MAX + 2; day++) await w.advance(24 * 60);
    expect(`The owner was reminded once a day, ${REFUND_REMINDERS_MAX} times at most`, sent(w, "owner_fee_upi_refund_reminder", "owner") === REFUND_REMINDERS_MAX);
    expect("It stays on the unfinished list: a refund owed by the owner, not yet marked done", open(w).includes(`upi_refund_owed ${back * 100}`), open(w).join(" | "));
    await w.ownerMarksRefund(name);
    await w.ownerMarksRefund(name);
    expect("After the owner's mark the parent is told it was sent, once, and the list is clear", sent(w, "fee_upi_refund_sent") === 1 && open(w).length === 0);
    return results;
  });

  return out;
}
