// The crash-test situations for Stock orders. A situation starts a fresh world on one shop's settings, makes something go wrong on purpose, and then JUDGES FROM THE
// STAND-INS' OWN RECORDS: what the messaging outbox holds, what the record holds, what the orders hold. It never judges from what the agent said it did. The frame
// (modules/crash-test/situations.ts) and the hand check's print are shared; the situations are Stock orders' own:
//
//   lost-reply-order          the supplier send's reply is lost: one order only, then the supplier is asked about THE SAME order
//   supplier-silent           the supplier never answers: asked again twice about the same order, the owner told once, never a second order
//   budget-race               two orders racing for the last of the month's budget: one gets it
//   changed-total             the quantity changes after the card: the old card does nothing, the new one carries the new total
//   price-moved               the catalogue price changes after the card: the old approval does not count
//   unknown-supplier          a supplier not on the list: nothing is ordered, nothing is sent
//   paused-supplier           a supplier on the list but not approved: nothing is ordered
//   unit-confusion            "10" with a box and a piece on offer: the owner is asked, the total is for the unit they pick
//   redelivered-request       the owner's message delivered again: one order, one approval
//   card-tapped-twice         an approval code used again: one order message
//   over-cap                  an order above the per-order cap: no card, nothing sent
//   ack-is-not-receipt        the supplier's OK, a part delivery, the rest, a wrong item, "paid outside": five different records
//   stranger-and-bare-ok      an "ok" from a stranger, from the wrong supplier, or a bare "ok" with two orders waiting: none counts
//   supplier-stopped          the supplier asked for no more messages: the order is not sent to them; the budget is released by cancelling
//   low-stock-never-guesses   a low-stock mark with no reorder quantity asks; with one it orders that; a second mark makes no second order
//   provider-refuses-send     the provider refuses the order message: nothing went out; one more try, then one order message in all
//   supplier-declines         the supplier says no: the budget is released and the delivery cannot be marked
import { createWorld } from "../src/harness.ts";
import type { World } from "../src/harness.ts";
import { holdsBudget, reservedPaise } from "../src/order.ts";
import { parseSettings } from "../src/settings.ts";
import type { Settings } from "../src/settings.ts";
import { checker } from "../../../../modules/crash-test/situations.ts";
import type { CheckResult, HandCheckRun, Situation, Skipped } from "../../../../modules/crash-test/situations.ts";
import { runAllSituations } from "../../../../modules/crash-test/situations.ts";
import { LANGUAGES } from "../../../../modules/language/languages.ts";
import { monthOf } from "../src/order.ts";
import { planShop } from "./plan.ts";
import type { Plan } from "./plan.ts";

const inr = (n: number): string => `₹${n.toLocaleString("en-IN")}`;
const reserved = (w: World): number => reservedPaise(w.store, monthOf(w.clock.now(), w.settings.timezone));
const entries = (w: World, action: string) => w.record.entries().filter((e) => e.action === action);

/** The owner asks, then approves the card: the order's ref. */
async function orderAndApprove(w: World, text: string): Promise<string> {
  await w.ownerSays(text);
  await w.ownerSays(w.approveText());
  return [...w.store.orders.keys()].at(-1)!;
}

type Build = (p: Plan) => Situation | { skip: string; title: string };

const BUILDERS: Build[] = [
  (p) => ({
    id: "lost-reply-order", planNumber: 1, title: "The reply to the order message is lost: one order only, and the supplier is asked about the same order",
    how: "the stand-in WhatsApp takes the order message but loses the reply; the owner uses the card again, asks to send it again, and time passes",
    async run() {
      const { results, expect } = checker();
      const w = createWorld({ settings: p.settings });
      w.messaging.inject("sendTemplate", "lostReply");
      const ref = await orderAndApprove(w, p.say());
      const to = p.supplier.whatsapp;
      expect("The order message reached the supplier once", w.orderMessagesTo(to).length === 1, `${w.orderMessagesTo(to).length} order messages`);
      expect("The order is marked as maybe-sent, not sent", w.order(ref)?.state === "send_unknown", `state ${w.order(ref)?.state}`);
      expect("The record says the send is unconfirmed", entries(w, "send_order").some((e) => e.outcome === "unconfirmed"), "no unconfirmed send_order entry");
      expect("The owner was told it may not have reached them", w.lastTextTo(w.owner).includes(ref) && /may or may not|WhatsApp did not confirm/u.test(w.lastTextTo(w.owner)), w.lastTextTo(w.owner));
      await w.ownerSays(w.approveText());
      await w.ownerSays(`send ${ref}`);
      expect("Using the card again, or asking to send it again, sent no second order", w.orderMessagesTo(to).length === 1, `${w.orderMessagesTo(to).length} order messages`);
      await w.advance(5 * 60);
      const asked = w.messaging.sentTo(to).filter((m) => m.templateName === "stock_order_reminder");
      expect("After the follow-up time the supplier was asked about the same order, as a reminder", asked.length === 1 && asked[0].text.includes(ref), `${asked.length} reminders`);
      expect("Still only one order message in all", w.orderMessagesTo(to).length === 1, `${w.orderMessagesTo(to).length}`);
      await w.supplierSays(to, "ok");
      expect("The supplier's OK was recorded against that order", w.order(ref)?.ack === "accepted" && w.order(ref)?.state === "sent", `ack ${w.order(ref)?.ack}, state ${w.order(ref)?.state}`);
      expect("The budget is reserved once, for the order's total", reserved(w) === Math.round(p.totalInr * 100), `${reserved(w)} paise held`);
      const amounts = [...w.messaging.outbox().flatMap((m) => [...m.text.matchAll(/₹\s*([\d,.]+)/gu)].map((x) => x[1]))];
      expect("Every amount sent is the unit price, the total, the budget or what is left", amounts.every((a) => [p.line.priceInr, p.totalInr, p.settings.limits.monthlyBudgetInr, p.settings.limits.monthlyBudgetInr - p.totalInr, 0].some((v) => a.replace(/,/gu, "") === String(v) || Number(a.replace(/,/gu, "")) === v)), amounts.join(", "));
      return results;
    },
  }),
  (p) => ({
    id: "supplier-silent", planNumber: 2, title: "The supplier never answers: asked again about the same order, the owner told once, no second order",
    how: "the order goes out; the supplier says nothing; four hours and then a day pass",
    async run() {
      const { results, expect } = checker();
      const w = createWorld({ settings: p.settings });
      const ref = await orderAndApprove(w, p.say());
      const to = p.supplier.whatsapp;
      const [first, last] = [p.settings.followUpHours[0], p.settings.followUpHours.at(-1)!];
      await w.advance(first * 60 + 1);
      await w.advance((last - first) * 60);
      await w.advance(60);
      const reminders = w.messaging.sentTo(to).filter((m) => m.templateName === "stock_order_reminder" || /^(?:Reminder|पहले भेजे|നേരത്തെ|ಈ ಮೊದಲು)/u.test(m.text));
      expect("The supplier was asked once for each follow-up time", reminders.length === p.settings.followUpHours.length, `${reminders.length} reminders`);
      expect("Every reminder names the same order", reminders.every((m) => m.text.includes(ref)), reminders.map((m) => m.text).join(" | "));
      expect("There is still exactly one order message", w.orderMessagesTo(to).length === 1, `${w.orderMessagesTo(to).length}`);
      expect("The owner was told about the silence once", w.textsTo(w.owner).filter((t) => /No answer yet/u.test(t)).length === 1, w.textsTo(w.owner).join(" | "));
      expect("The order is not marked confirmed", w.order(ref)?.ack === "none", `ack ${w.order(ref)?.ack}`);
      return results;
    },
  }),
  (p) => p.raceQty === undefined ? { title: "Two orders racing for the last of the month's budget", skip: "no allowed quantity makes two orders together more than the month's budget on these limits" } : ({
    id: "budget-race", planNumber: 3, title: "Two orders racing for the last of the month's budget: only one gets it",
    how: "two cards are open; the owner's two approvals are handled at the same moment",
    async run() {
      const { results, expect } = checker();
      const w = createWorld({ settings: p.settings });
      await w.ownerSays(p.say({ qty: p.raceQty }));
      const c1 = w.cardCode();
      await w.ownerSays(p.say({ qty: p.raceQty }));
      const c2 = w.cardCode();
      await Promise.all([w.ownerSays(`yes ${c1}`), w.ownerSays(`yes ${c2}`)]);
      const approved = w.orders().filter(holdsBudget);
      expect("Exactly one of the two orders was approved", approved.length === 1, `${approved.length} approved`);
      expect("The month's reserved total stays within the budget", reserved(w) <= p.settings.limits.monthlyBudgetInr * 100, `${reserved(w)} paise reserved of ${p.settings.limits.monthlyBudgetInr * 100}`);
      expect("Only one order message went to the supplier", w.orderMessagesTo(p.supplier.whatsapp).length === 1, `${w.orderMessagesTo(p.supplier.whatsapp).length}`);
      expect("The other order was not sent and holds no budget", w.orders().filter((o) => !holdsBudget(o) && o.state === "void").length === 1, w.orders().map((o) => `${o.id}:${o.state}`).join(", "));
      expect("The owner was told the budget was short", w.textsTo(w.owner).some((t) => /left of this month|budget \(/u.test(t) && /Nothing was ordered/u.test(t)), w.textsTo(w.owner).slice(-2).join(" | "));
      return results;
    },
  }),
  (p) => ({
    id: "changed-total", planNumber: 4, title: "The quantity changes after the card: the old approval does nothing and the new card carries the new total",
    how: "the owner asks for one quantity, then changes it; the first card's code is used",
    async run() {
      const { results, expect } = checker();
      const w = createWorld({ settings: p.settings });
      await w.ownerSays(p.say());
      const old = w.cardCode();
      const more = p.qty + 2;
      await w.ownerSays(`change po-1 ${more}`);
      const fresh = w.cardCode();
      expect("A new card was made with a new code", fresh !== old, "the same code");
      await w.ownerSays(`yes ${old}`);
      expect("The old card's code did nothing: no order message, nothing reserved", w.orderMessagesTo(p.supplier.whatsapp).length === 0 && reserved(w) === 0, `${w.orderMessagesTo(p.supplier.whatsapp).length} messages, ${reserved(w)} paise`);
      await w.ownerSays(`yes ${fresh}`);
      const sent = w.orderMessagesTo(p.supplier.whatsapp);
      const newTotal = (Math.round(p.line.priceInr * 100) * more) / 100;
      expect("The order that went out is for the new quantity", sent.length === 1 && sent[0].text.includes(String(more)) && w.order("po-1")?.qty === more, sent[0]?.text ?? "no order message");
      expect("The reserved budget is the new total", reserved(w) === Math.round(newTotal * 100), `${reserved(w)} paise`);
      await w.ownerSays(`change po-1 ${more + 1}`);
      expect("A change after approval is refused and changes nothing", w.order("po-1")?.qty === more, `qty ${w.order("po-1")?.qty}`);
      return results;
    },
  }),
  (p) => ({
    id: "price-moved", planNumber: 5, title: "The catalogue's price moves after the card: the old approval does not count",
    how: "the settings are edited and the shop restarted between the card and the owner's yes",
    async run() {
      const { results, expect } = checker();
      const w = createWorld({ settings: p.settings });
      await w.ownerSays(p.say());
      const old = w.cardCode();
      const edited = structuredClone(p.settings) as Settings;
      const target = edited.catalogue.find((l) => l.item === p.line.item && l.supplier === p.line.supplier && l.unit === p.line.unit)!;
      target.priceInr = Math.round((target.priceInr + 1) * 100) / 100;
      w.reload(parseSettings(edited));
      await w.ownerSays(`yes ${old}`);
      expect("Nothing was sent on the old card", w.orderMessagesTo(p.supplier.whatsapp).length === 0, `${w.orderMessagesTo(p.supplier.whatsapp).length} order messages`);
      expect("The owner was shown a new card", w.cardCode() !== old, "no new card");
      expect("The order now holds the new price", w.order("po-1")?.unitPaise === Math.round(target.priceInr * 100), `${w.order("po-1")?.unitPaise}`);
      await w.ownerSays(w.approveText());
      expect("The new approval sent one order message at the new price", w.orderMessagesTo(p.supplier.whatsapp).length === 1 && w.order("po-1")?.state === "sent", w.order("po-1")?.state ?? "no order");
      return results;
    },
  }),
  (p) => ({
    id: "unknown-supplier", planNumber: 6, title: "A supplier who is not on the list: nothing is ordered and nothing is sent",
    how: "the owner asks for the usual item from a name the catalogue does not hold",
    async run() {
      const { results, expect } = checker();
      const w = createWorld({ settings: p.settings });
      await w.ownerSays(`order ${p.qty} ${p.unit} ${p.item} from Sharma Stores`);
      expect("No order was made", w.orders().length === 0, `${w.orders().length} orders`);
      expect("Nothing was sent to any supplier", p.settings.suppliers.every((s) => w.textsTo(s.whatsapp).length === 0), "a supplier was messaged");
      expect("The record shows the supplier rule blocked it", entries(w, "propose_order").some((e) => e.outcome === "blocked" && e.decisions.some((d) => d.ruleId === "approved-supplier-only" && d.verdict === "block")), "no blocked decision");
      expect("The owner was told", /not on your approved supplier list/u.test(w.lastTextTo(w.owner)), w.lastTextTo(w.owner));
      return results;
    },
  }),
  (p) => !p.paused ? { title: "A supplier on the list but not approved", skip: "every supplier on the list is approved, so there is no paused one to try" } : ({
    id: "paused-supplier", planNumber: 7, title: "A supplier on the list but not approved: nothing is ordered",
    how: "the owner asks for an item from the paused supplier by name",
    async run() {
      const { results, expect } = checker();
      const w = createWorld({ settings: p.settings });
      const l = p.paused!.line;
      const names = { item: p.settings.items.find((i) => i.id === l.item)!.names.en[0], unit: p.settings.units.find((u) => u.id === l.unit)!.names.en[0] };
      await w.ownerSays(`order 3 ${names.unit} ${names.item} from ${p.paused!.supplier.name}`);
      expect("No order was made", w.orders().length === 0, `${w.orders().length}`);
      expect("The paused supplier was sent nothing", w.textsTo(p.paused!.supplier.whatsapp).length === 0, "messaged");
      expect("The owner was told it is not approved", /not on your approved supplier list, or is paused/u.test(w.lastTextTo(w.owner)), w.lastTextTo(w.owner));
      return results;
    },
  }),
  (p) => !p.twoUnits ? { title: "A number with no unit when the item comes in two", skip: "no item comes in two units from one supplier, so there is no unit to confuse" } : ({
    id: "unit-confusion", planNumber: 8, title: "\"10\" when the item comes by the box and by the piece: the owner is asked, and the total is for the unit they pick",
    how: "the owner gives a number and no unit; then picks the second way from the list",
    async run() {
      const { results, expect } = checker();
      const w = createWorld({ settings: p.settings });
      const t = p.twoUnits!;
      const item = p.settings.items.find((i) => i.id === t.item)!.names.en[0];
      await w.ownerSays(`order 10 ${item} from ${t.supplier.name}`);
      expect("The owner was asked which unit, and no order was made", w.orders().length === 0 && w.store.asking?.kind === "line", `${w.orders().length} orders, asking ${w.store.asking?.kind}`);
      expect("The question lists every way to order it", (w.messaging.sentTo(w.owner).at(-1)?.interactive?.list?.rows.length ?? 0) === t.lines.length, `${w.messaging.sentTo(w.owner).at(-1)?.interactive?.list?.rows.length} rows`);
      await w.ownerTaps("pick:1");
      const o = w.order("po-1");
      const chosen = t.lines[1];
      expect("The order is for the unit that was picked, never converted", o?.unit === chosen.unit && o?.qty === 10, `${o?.unit} × ${o?.qty}`);
      expect("Its total is the quantity times that unit's price", o?.totalPaise === Math.round(chosen.priceInr * 100) * 10, `${o?.totalPaise}`);
      expect("The card shows that total", w.lastTextTo(w.owner).includes(inr(chosen.priceInr * 10)) || w.lastTextTo(w.owner).includes((chosen.priceInr * 10).toLocaleString("en-IN")), w.lastTextTo(w.owner));
      expect("Nothing has gone to the supplier yet", w.orderMessagesTo(t.supplier.whatsapp).length === 0, "sent");
      return results;
    },
  }),
  (p) => ({
    id: "redelivered-request", planNumber: 9, title: "The owner's request and approval delivered twice: one order, one order message",
    how: "the provider delivers the same two inbound messages again",
    async run() {
      const { results, expect } = checker();
      const w = createWorld({ settings: p.settings });
      const first = await w.ownerSays(p.say());
      await w.redeliver(first);
      await w.redeliver(first);
      expect("One order and one card", w.orders().length === 1 && w.textsTo(w.owner).length === 1, `${w.orders().length} orders, ${w.textsTo(w.owner).length} messages`);
      const yes = await w.ownerSays(w.approveText());
      await w.redeliver(yes);
      expect("One order message to the supplier", w.orderMessagesTo(p.supplier.whatsapp).length === 1, `${w.orderMessagesTo(p.supplier.whatsapp).length}`);
      expect("The budget was reserved once", reserved(w) === Math.round(p.totalInr * 100), `${reserved(w)}`);
      return results;
    },
  }),
  (p) => ({
    id: "card-tapped-twice", planNumber: 10, title: "An approval used a second time, and after a no: nothing more is sent",
    how: "the code is typed again as a new message; a declined card's code is then typed as a yes",
    async run() {
      const { results, expect } = checker();
      const w = createWorld({ settings: p.settings });
      await w.ownerSays(p.say());
      const code = w.cardCode();
      await w.ownerSays(`yes ${code}`);
      await w.ownerSays(`yes ${code}`);
      expect("The second use did not send a second order message", w.orderMessagesTo(p.supplier.whatsapp).length === 1, `${w.orderMessagesTo(p.supplier.whatsapp).length}`);
      await w.ownerSays(p.say());
      const second = w.cardCode();
      await w.ownerSays(`no ${second}`);
      await w.ownerSays(`yes ${second}`);
      expect("A declined order is not sent when its code is used as a yes", w.order("po-2")?.state === "declined" && w.orderMessagesTo(p.supplier.whatsapp).length === 1, `${w.order("po-2")?.state}`);
      expect("A made-up code does nothing", await (async () => { await w.ownerSays("yes ZZZZZZ"); return w.orders().length === 2; })(), "an order appeared");
      return results;
    },
  }),
  (p) => p.capQty === undefined ? { title: "An order above the per-order cap", skip: "no allowed quantity is above the per-order cap on these limits" } : ({
    id: "over-cap", planNumber: 11, title: "An order above the per-order cap: no card, nothing sent",
    how: "the owner asks for one more than the cap allows",
    async run() {
      const { results, expect } = checker();
      const w = createWorld({ settings: p.settings });
      await w.ownerSays(p.say({ qty: p.capQty }));
      expect("No order and no card", w.orders().length === 0 && !/yes [A-Z0-9]{4,6}/u.test(w.lastTextTo(w.owner)), w.lastTextTo(w.owner));
      expect("The record shows the cap blocked it", entries(w, "propose_order").some((e) => e.decisions.some((d) => d.ruleId === "per-order-cap" && d.verdict === "block")), "no cap decision");
      expect("The supplier was sent nothing", w.textsTo(p.supplier.whatsapp).length === 0, "messaged");
      return results;
    },
  }),
  (p) => ({
    id: "ack-is-not-receipt", planNumber: 12, title: "The supplier's OK, a part delivery, the rest, a wrong item and \"paid outside\" are five different records",
    how: "the supplier accepts; the owner marks part, then the rest; a second order gets a wrong item; the owner says they paid",
    async run() {
      const { results, expect } = checker();
      const w = createWorld({ settings: p.settings });
      const to = p.supplier.whatsapp;
      const ref = await orderAndApprove(w, p.say({ qty: Math.max(p.qty, 2) }));
      const qty = w.order(ref)!.qty;
      await w.supplierSays(to, "OK");
      expect("The supplier's OK did not make it received", w.order(ref)?.ack === "accepted" && w.order(ref)?.receipt === "none" && w.order(ref)?.receivedQty === 0, `${w.order(ref)?.receipt}`);
      await w.ownerSays(`received ${ref} 1`);
      expect("A part delivery is a part receipt", w.order(ref)?.receipt === "part" && w.order(ref)?.receivedQty === 1, `${w.order(ref)?.receipt} ${w.order(ref)?.receivedQty}`);
      await w.ownerSays(`received ${ref} ${qty + 5}`);
      expect("More than is still to come is refused and changes nothing", w.order(ref)?.receivedQty === 1, `${w.order(ref)?.receivedQty}`);
      await w.ownerSays(`received ${ref}`);
      expect("The rest makes it fully received", w.order(ref)?.receipt === "full" && w.order(ref)?.receivedQty === qty, `${w.order(ref)?.receipt} ${w.order(ref)?.receivedQty}`);
      expect("Receipt did not mark it paid", w.order(ref)?.paidOutsideMs === undefined, "paid");
      await w.ownerSays(`paid ${ref}`);
      const paid = entries(w, "mark_paid_outside");
      expect("\"paid\" is the owner's own mark and nothing else", w.order(ref)?.paidOutsideMs !== undefined && paid.length === 1 && paid[0].refs.evidence === "owner_marked" && !w.messaging.outbox().some((m) => m.to !== w.owner && m.to !== to), `${paid.length} marks`);
      const ref2 = await orderAndApprove(w, p.say());
      await w.supplierSays(to, "ok");
      await w.ownerSays(`wrong ${ref2}`);
      expect("A wrong item is recorded as such and is not received", w.order(ref2)?.receipt === "wrong_item" && w.order(ref2)?.receivedQty === 0, `${w.order(ref2)?.receipt}`);
      expect("The receipt marks are recorded as the owner's evidence", entries(w, "mark_receipt").every((e) => e.refs.evidence === "owner_marked") && entries(w, "supplier_reply").every((e) => e.refs.evidence === "supplier_reply"), "evidence labels differ");
      return results;
    },
  }),
  (p) => ({
    id: "stranger-and-bare-ok", planNumber: 13, title: "An \"ok\" from a stranger or the wrong supplier, or a bare \"ok\" with two orders waiting: none of them counts",
    how: "a stranger and another supplier answer; then the supplier writes a bare \"ok\" with two orders open, and then taps one order's button",
    async run() {
      const { results, expect } = checker();
      const w = createWorld({ settings: p.settings });
      const to = p.supplier.whatsapp;
      const r1 = await orderAndApprove(w, p.say());
      await w.supplierSays("+919000000000", "ok");
      expect("A stranger's OK counted for nothing and got no reply", w.order(r1)?.ack === "none" && w.textsTo("+919000000000").length === 0, `${w.order(r1)?.ack}`);
      const another = p.settings.suppliers.find((s) => s.id !== p.supplier.id);
      if (another) {
        await w.supplierSays(another.whatsapp, `ok ${r1}`);
        expect("Another supplier cannot answer for this order", w.order(r1)?.ack === "none", `${w.order(r1)?.ack}`);
      }
      const r2 = await orderAndApprove(w, p.say());
      await w.supplierSays(to, "ok");
      expect("A bare \"ok\" with two orders waiting counted for neither", w.order(r1)?.ack === "none" && w.order(r2)?.ack === "none", `${w.order(r1)?.ack} ${w.order(r2)?.ack}`);
      expect("The supplier was asked which order they mean", /po-1/u.test(w.lastTextTo(to)) && /po-2/u.test(w.lastTextTo(to)), w.lastTextTo(to));
      await w.supplierSays(to, "OK", { reply: { id: `ack:${r1}`, kind: "button" } });
      expect("The button answered for its own order only", w.order(r1)?.ack === "accepted" && w.order(r2)?.ack === "none", `${w.order(r1)?.ack} ${w.order(r2)?.ack}`);
      return results;
    },
  }),
  (p) => ({
    id: "supplier-stopped", planNumber: 14, title: "The supplier asked for no more messages: the order is not sent to them, and cancelling releases the budget",
    how: "the supplier writes STOP; the owner then orders from them and approves",
    async run() {
      const { results, expect } = checker();
      const w = createWorld({ settings: p.settings });
      const to = p.supplier.whatsapp;
      await w.supplierSays(to, "STOP");
      expect("The owner was told", w.textsTo(w.owner).length === 1, w.textsTo(w.owner).join(" | "));
      const ref = await orderAndApprove(w, p.say());
      expect("Nothing was sent to the supplier after STOP", !w.messaging.outbox().some((m) => m.to === to && m.afterOptOut) && w.orderMessagesTo(to).length === 0, "a message went");
      expect("The order is held back, not marked sent", w.order(ref)?.state === "send_blocked", `${w.order(ref)?.state}`);
      await w.ownerSays(`cancel ${ref}`);
      expect("Cancelling releases the budget", w.order(ref)?.state === "cancelled" && reserved(w) === 0, `${w.order(ref)?.state} ${reserved(w)}`);
      return results;
    },
  }),
  (p) => (p.noReorder === undefined && p.withReorder === undefined) ? { title: "A low-stock mark", skip: "no catalogue line is usable for a low-stock mark" } : ({
    id: "low-stock-never-guesses", planNumber: 15, title: "A low-stock mark with no reorder quantity asks how many; with one it orders that; a second mark makes no second order",
    how: "the owner writes that an item is low, for a line with and without a usual quantity",
    leftOut: [...(p.noReorder ? [] : ["a line with no usual quantity: every line here has one"]), ...(p.withReorder ? [] : ["a line with a usual quantity: none has one"])],
    async run() {
      const { results, expect } = checker();
      const w = createWorld({ settings: p.settings });
      const word = (l: typeof p.line) => `${p.settings.items.find((i) => i.id === l.item)!.names.en[0]} from ${p.settings.suppliers.find((s) => s.id === l.supplier)!.name}`;
      if (p.noReorder) {
        await w.ownerSays(`${word(p.noReorder)} is low`);
        expect("With no usual quantity the owner is asked how many, and no order exists", w.orders().length === 0 && w.store.asking?.kind === "qty", `${w.orders().length} orders`);
        await w.ownerSays("3");
        expect("The number they gave is the quantity", w.order("po-1")?.qty === 3, `${w.order("po-1")?.qty}`);
      }
      if (p.withReorder) {
        const before = w.orders().length;
        await w.ownerSays(`${word(p.withReorder)} is low`);
        expect("With a usual quantity the order uses it", w.orders().length === before + 1 && w.orders().at(-1)?.qty === p.withReorder.reorderQty, `${w.orders().at(-1)?.qty}`);
        await w.ownerSays(`${word(p.withReorder)} is low`);
        expect("A second mark while one is open makes no second order", w.orders().length === before + 1, `${w.orders().length} orders`);
      }
      return results;
    },
  }),
  (p) => ({
    id: "provider-refuses-send", planNumber: 16, title: "The provider refuses the order message: nothing went out, one more try, one order message in all",
    how: "the order template is not approved at first; the owner asks to send it again once it is",
    async run() {
      const { results, expect } = checker();
      const w = createWorld({ settings: p.settings, unapproved: ["stock_order_to_supplier"] });
      const to = p.supplier.whatsapp;
      const ref = await orderAndApprove(w, p.say());
      await w.advance(60); // send once: a refusal is tried again an hour later, three tries in all, and only then is the order marked not sent
      await w.advance(60);
      expect("The order is marked not sent and no order message went out", w.order(ref)?.state === "send_failed" && w.orderMessagesTo(to).length === 0, `${w.order(ref)?.state}`);
      expect("The budget stays reserved", reserved(w) === Math.round(p.totalInr * 100), `${reserved(w)}`);
      for (const l of LANGUAGES) w.messaging.approve("stock_order_to_supplier", l);
      await w.ownerSays(`send ${ref}`);
      expect("Sent again once, and now marked sent", w.order(ref)?.state === "sent" && w.orderMessagesTo(to).length === 1, `${w.order(ref)?.state}, ${w.orderMessagesTo(to).length}`);
      await w.ownerSays(`send ${ref}`);
      expect("A further send is refused", w.orderMessagesTo(to).length === 1, `${w.orderMessagesTo(to).length}`);
      return results;
    },
  }),
  (p) => ({
    id: "supplier-declines", planNumber: 17, title: "The supplier says no: the budget is released and the delivery cannot be marked",
    how: "the supplier answers NO to the order",
    async run() {
      const { results, expect } = checker();
      const w = createWorld({ settings: p.settings });
      const ref = await orderAndApprove(w, p.say());
      expect("The budget was held", reserved(w) > 0, "nothing reserved");
      await w.supplierSays(p.supplier.whatsapp, "no");
      expect("The order is marked declined by the supplier and releases the budget", w.order(ref)?.state === "supplier_declined" && w.order(ref)?.ack === "declined" && reserved(w) === 0, `${w.order(ref)?.state} ${reserved(w)}`);
      await w.ownerSays(`received ${ref}`);
      expect("A delivery cannot be marked on it", w.order(ref)?.receipt === "none", `${w.order(ref)?.receipt}`);
      return results;
    },
  }),
];

/** Build every situation the shop's settings can express, and name the ones they cannot. */
export function buildSituations(settings: Settings): { situations: Situation[]; skipped: Skipped[] } {
  const planned = planShop(settings);
  if ("problem" in planned) return { situations: [], skipped: [{ id: "all", title: "Every situation", reason: planned.problem }] };
  const situations: Situation[] = [];
  const skipped: Skipped[] = [];
  for (const build of BUILDERS) {
    const s = build(planned.plan);
    if ("skip" in s) skipped.push({ id: "skipped", title: s.title, reason: s.skip });
    else situations.push(s);
  }
  return { situations, skipped };
}

/** Run every situation on one shop's settings. */
export async function runOn(settings: Settings): Promise<HandCheckRun<Settings>> {
  return runAllSituations(buildSituations(settings), settings);
}

export type { CheckResult };
