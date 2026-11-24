// MONTHLY PLANS (group (viii) of the contract, README.md): a shop with a `plans` block takes a month of meals as one payment. The customer asks for a plan in plain words, is
// quoted the meals of the month and its price, the owner's mark on the period's payment starts it (the period's payment is an order record that never counts as a meal order),
// a skip before the cut-off is a credit and after it is refused with the cut-off's time, a plan's meals hold places in their slot, and a shop without plans reads the same words
// as ordinary words. A "fakes" UPI shop on the TEST clock at Mon 9 Nov 2026, 10:00 in India (the plan starts Tue 10 Nov: 22 weekday meals to Wed 9 Dec). Expected values from
// test/plans. Observed through the record's sent templates, /status, the owner's page and the page's offer.
import { after, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CUSTOMER, HOUR, MIN, RAJESH, at, beat, contract, makeShop } from "./harness.ts";
import type { Shop } from "./harness.ts";

const shops: Shop[] = [];
after(async () => { for (const s of shops) { await s.stop(); await s.cleanup(); } });
async function boot(o: Parameters<typeof makeShop>[0] = {}): Promise<Shop> { const s = await makeShop({ example: "plans", ...o }); shops.push(s); await s.start(); return s; }

async function subscribed(o: Parameters<typeof makeShop>[0] = {}): Promise<Shop> {
  const s = await boot(o);
  await s.inbound(CUSTOMER, "I want the monthly lunch plan");
  assert.equal(s.templatesTo(CUSTOMER).at(-1), "plan_quote", JSON.stringify(s.templatesTo(CUSTOMER)));
  const [item] = (await s.ownerView()).body.items;
  assert.deepEqual([item.kind, item.amountPaise], ["deposit", 240000], "the month's price, marked by the owner like an advance");
  assert.match(item.what, /monthly plan/u);
  await s.ownerPress("deposit", "received");
  return s;
}

describe("a monthly plan", () => {
  contract("asked in words, quoted, and started by the owner's mark: the period's payment is a record and never a meal order", async () => {
    const s = await subscribed();
    assert.equal(s.templatesTo(CUSTOMER).at(-1), "plan_active");
    assert.ok(s.templatesTo(CUSTOMER, "owner").some((t) => t.startsWith("owner_plan")), JSON.stringify(s.templatesTo(CUSTOMER, "owner")));
    assert.equal(s.record().filter((r) => r.action === "confirm_order").length, 0, "a plan's payment is not an order confirmed");
    assert.deepEqual((await s.ownerView()).body.items, []);
    const st = (await s.status()).orders;
    assert.equal(st.confirmed, undefined, "no meal order is confirmed");
  });

  contract("a skip before the cut-off is recorded; after the cut-off it is refused and nothing changes", async () => {
    const s = await subscribed({ tickSeconds: 1 });
    await s.inbound(CUSTOMER, "skip tomorrow");
    assert.equal(s.templatesTo(CUSTOMER).at(-1), "plan_skip_done");
    s.advance(at({ year: 2026, month: 11, day: 10 }, 21) - s.now()); await beat(); // Tue 9 pm: Wednesday's cut-off was Tue 8 pm
    await s.inbound(CUSTOMER, "skip tomorrow");
    assert.equal(s.templatesTo(CUSTOMER).at(-1), "plan_cutoff_refused");
  });

  contract("a plan's meals hold places in their slot: with the slot's last place taken by the plan, a one-off order for that slot is refused", async () => {
    const s = await subscribed({ settings: { pickup: { slots: [{ id: "lunch", from: "12:00", to: "13:00", names: { en: ["lunch"] }, cutoff: { daysBefore: 0, time: "09:00" }, maxOrders: 1 }, { id: "dinner", from: "19:00", to: "20:00", names: { en: ["dinner"] }, cutoff: { daysBefore: 0, time: "15:00" } }] } } });
    const lunch = (await s.call("/internal/channel/offer")).body.days[1].slots.find((x: { id: string }) => x.id === "lunch");
    assert.equal(lunch.open, false, "the plan's meal fills Tuesday's lunch");
    const { hash } = await s.order();
    const v = (await s.request(hash)).body;
    assert.equal(v.status, "not_held");
    assert.match(v.messages.at(-1).text, /is full/u);
  });

  contract("a slot full of plan meals starts no second plan, and a day the plan skips gives its place back to a one-off order", async () => {
    const s = await subscribed({ settings: { pickup: { slots: [{ id: "lunch", from: "12:00", to: "13:00", names: { en: ["lunch"] }, cutoff: { daysBefore: 0, time: "09:00" }, maxOrders: 1 }, { id: "dinner", from: "19:00", to: "20:00", names: { en: ["dinner"] }, cutoff: { daysBefore: 0, time: "15:00" } }] } } });
    await s.inbound(RAJESH, "I want the monthly lunch plan");
    assert.equal(s.templatesTo(RAJESH).at(-1), "plan_full", "a day of the month has no place left");
    assert.ok(s.record().some((r) => r.action === "plan_start" && r.outcome === "blocked"));
    await s.inbound(CUSTOMER, "skip tomorrow");
    const lunch = (await s.call("/internal/channel/offer")).body.days[1].slots.find((x: { id: string }) => x.id === "lunch");
    assert.equal(lunch.open, true, "Tuesday's place is free again");
    const { hash } = await s.order();
    assert.equal((await s.request(hash)).body.status, "held");
  });

  // 23 Nov 2026 (stream OG): the plan paths no contract test reached, so the TypeScript unit tests (test/plans) were their only check. Expected values: creditInr(2400, 22,
  // days) = floor(2400 x days / 22), so one day is ₹109 and five are ₹545. The plan's first month is Tue 10 Nov to Wed 9 Dec; its last cut-off is Tue 8 Dec 8 pm, so the
  // renewal is asked on the first beat after it, and the renewal's pay-by time is the cut-off of its first meal (Thu 10 Dec), Wed 9 Dec 8 pm.
  const items = async (s: Shop, kind: string) => ((await s.ownerView()).body.items as { kind: string; amountPaise: number }[]).filter((i) => i.kind === kind);
  const count = (s: Shop, template: string) => s.templatesTo(CUSTOMER).filter((t) => t === template).length;
  const DEC8 = at({ year: 2026, month: 12, day: 8 }, 21);

  contract("the renewal: asked once when the month's credit is final, the day skipped carried off the price, and paid by the owner's mark", async () => {
    const s = await subscribed({ tickSeconds: 1 });
    await s.inbound(CUSTOMER, "skip 12 nov");
    assert.equal(s.templatesTo(CUSTOMER).at(-1), "plan_skip_done");
    s.advance(DEC8 - s.now()); await beat();
    assert.equal(count(s, "plan_renewal"), 1);
    assert.deepEqual((await items(s, "deposit")).map((i) => i.amountPaise), [229100], "₹2,400 less the ₹109 carried");
    const credit = s.record().filter((r) => r.action === "plan_credit");
    assert.deepEqual(credit.map((r) => [r.refs.kind, r.refs.amountPaise]), [["carried", "10900"]], "the month is settled once, as carried");
    await beat();
    assert.equal(count(s, "plan_renewal"), 1, "a second beat never asks for the same month again");
    assert.equal((await items(s, "deposit")).length, 1);
    await s.ownerPress("deposit", "received");
    assert.equal(s.templatesTo(CUSTOMER).at(-1), "plan_active");
    assert.deepEqual(await items(s, "refund_owed"), [], "nothing is owed back: the credit was used");
    assert.equal(s.record().filter((r) => r.action === "plan_paid" && r.outcome === "confirmed").length, 2);
  });

  contract("a renewal not paid in time: one reminder, then it lapses at its pay-by time, charges nothing, and the carried credit is owed back", async () => {
    const s = await subscribed({ tickSeconds: 1 });
    await s.inbound(CUSTOMER, "skip 12 nov");
    s.advance(DEC8 - s.now()); await beat();
    assert.equal(count(s, "plan_renewal"), 1);
    s.advance(at({ year: 2026, month: 12, day: 9 }, 9) - s.now()); await beat(); // half way to the pay-by time: the one reminder
    assert.equal(count(s, "plan_renewal"), 2, "the reminder is the renewal's words again");
    await beat();
    assert.equal(count(s, "plan_renewal"), 2, "the reminder goes once");
    s.advance(at({ year: 2026, month: 12, day: 9 }, 21) - s.now()); await beat();
    assert.deepEqual(s.templatesTo(CUSTOMER).slice(-2), ["plan_lapsed", "upi_refund_owed"], "told it lapsed, then that the credit comes back from the owner");
    assert.ok(s.record().some((r) => r.action === "plan_lapse" && r.refs.period === "1"));
    assert.deepEqual(await items(s, "deposit"), [], "the renewal's payment is no longer asked for");
    assert.deepEqual((await items(s, "refund_owed")).map((i) => i.amountPaise), [10900], "the credit carried and not used goes back");
  });

  contract("a cancel in the middle of the month: the days whose cut-off is ahead are cancelled, and what is unused is owed back once (a skipped day is counted once)", async () => {
    const s = await subscribed();
    await s.inbound(CUSTOMER, "skip 16 nov");
    s.advance(at({ year: 2026, month: 11, day: 11 }, 21) - s.now()); // Wed 9 pm: Tue, Wed and Thu have closed; 19 days are still ahead, one of them skipped
    await s.inbound(CUSTOMER, "cancel my plan");
    assert.equal(s.templatesTo(CUSTOMER).at(-1), "plan_cancelled");
    assert.ok(s.templatesTo(CUSTOMER, "owner").includes("owner_plan_cancelled"), JSON.stringify(s.templatesTo(CUSTOMER, "owner")));
    assert.deepEqual(s.record().filter((r) => r.action === "plan_cancel").map((r) => r.refs.days), ["18"], "the skipped day is not cancelled again");
    assert.deepEqual((await items(s, "refund_owed")).map((i) => i.amountPaise), [207200], "19 days not taken (18 cancelled, 1 skipped): floor(2400 x 19 / 22) = ₹2,072");
    assert.deepEqual(s.record().filter((r) => r.action === "plan_credit").map((r) => r.refs.kind), ["refunded"], "a cancelled plan's credit is refunded, never carried as well");
  });

  contract("a cancel while the renewal waits: its reminder never goes out, the credit it was to take is owed back, and nothing more is asked", async () => {
    const s = await subscribed({ tickSeconds: 1 });
    await s.inbound(CUSTOMER, "skip 12 nov");
    s.advance(DEC8 - s.now()); await beat();
    assert.equal(count(s, "plan_renewal"), 1);
    await s.inbound(CUSTOMER, "cancel my plan");
    assert.equal(s.templatesTo(CUSTOMER).at(-1), "plan_cancelled");
    assert.deepEqual(await items(s, "deposit"), [], "the renewal's payment is given up");
    assert.deepEqual((await items(s, "refund_owed")).map((i) => i.amountPaise), [10900], "the ₹109 carried comes back to the customer");
    s.advance(at({ year: 2026, month: 12, day: 9 }, 21) - s.now()); await beat();
    assert.equal(count(s, "plan_renewal"), 1, "no reminder after the cancel");
    assert.ok(!s.templatesTo(CUSTOMER).includes("plan_lapsed"), "a cancelled plan does not lapse as well");
  });

  contract("a pause and a resume: the paused days are recorded, and at the renewal they are credited once, off the next month's price", async () => {
    const s = await subscribed({ tickSeconds: 1 });
    await s.inbound(CUSTOMER, "pause from 16 nov");
    assert.equal(s.templatesTo(CUSTOMER).at(-1), "plan_pause_done");
    await s.inbound(CUSTOMER, "resume from 23 nov");
    assert.equal(s.templatesTo(CUSTOMER).at(-1), "plan_resume_done");
    assert.deepEqual(s.record().filter((r) => r.action === "plan_pause" || r.action === "plan_resume").map((r) => [r.action, r.outcome, r.refs.days]), [["plan_pause", "confirmed", "18"], ["plan_resume", "confirmed", "13"]]);
    s.advance(DEC8 - s.now()); await beat();
    assert.deepEqual((await items(s, "deposit")).map((i) => i.amountPaise), [185500], "five weekdays paused (16 to 20 Nov): ₹2,400 less ₹545");
    s.advance(at({ year: 2026, month: 12, day: 8 }, 23) - s.now());
    await s.inbound(CUSTOMER, "pause from 9 dec");
    assert.equal(s.templatesTo(CUSTOMER).at(-1), "plan_cutoff_refused", "a pause whose first day has closed is refused with its cut-off");
  });

  contract("a shop without plans reads the same words as a message, and keeps no plans", async () => {
    const s = await makeShop({ example: "upi" }); shops.push(s); await s.start();
    await s.inbound(CUSTOMER, "I want the monthly lunch plan");
    assert.ok(!s.templatesTo(CUSTOMER).some((t) => t.startsWith("plan_")));
    assert.ok(!s.record().some((r) => r.action.startsWith("plan")));
  });
});

// 25 Nov 2026: the four plan messages that go to the customer unasked, outside their 24-hour window (the lapse, the hold that ran out, and the credit going back, done or waiting
// for the owner). They had no WhatsApp template, so they went under the generic name, which WhatsApp refuses outside the window. These cases run the shop as the hand check does,
// on the test clock with its Guards as stand-ins (`onClock`): the shop's window is the day since the customer last wrote, so a month on the clock closes it, and the stand-in
// WhatsApp shows the name each message went under and the values it carried. Each case checks the name, that the list to submit to Meta (whatsapp-templates.json) holds that
// name with as many values as the shop sent, and that the body filled with them is the very text the shop wrote.
describe("the plan messages that go out unasked, in a closed window, go as their own templates", () => {
  const registered = JSON.parse(readFileSync(new URL("../whatsapp-templates.json", import.meta.url), "utf8")) as { name: string; language: string; components: { type: string; text?: string }[] }[];
  const bodyOf = (name: string): string => registered.find((t) => t.name === name && t.language === "en")?.components.find((c) => c.type === "BODY")?.text ?? assert.fail(`${name} is not in the list to submit`);
  const MONTH = "weekday lunch"; // the plan the example shop quotes for "the monthly lunch plan" (the messages add the word "plan" themselves)
  const count = (s: Shop, template: string) => s.templatesTo(CUSTOMER).filter((t) => t === template).length;
  const DEC8 = at({ year: 2026, month: 12, day: 8 }, 21); // the last cut-off of the first month, as above
  /** The one message the shop sent the customer under `name`: it went as a template, with these values, filling the registered body into the text it wrote. */
  function wentAs(s: Shop, name: string, values: string[]): void {
    const sent = s.sent(CUSTOMER).filter((m) => m.templateName === name);
    assert.equal(sent.length, 1, `${name} went ${sent.length} times: ${JSON.stringify(s.sent(CUSTOMER).map((m) => [m.kind, m.templateName]))}`);
    const wire = s.guards!.of("messaging", "POST").map((c) => c.body).filter((b) => b.to === CUSTOMER && b.type === "template" && b.template?.name === name);
    assert.equal(wire.length, 1, `${name} went to WhatsApp ${wire.length} times`);
    const sentValues = wire[0].template.components.filter((c: { type: string }) => c.type === "body").flatMap((c: { parameters: { text: string }[] }) => c.parameters.map((p) => p.text));
    assert.deepEqual(sentValues, values, `${name}'s values`);
    const body = bodyOf(name);
    assert.equal((body.match(/\{\{\d+\}\}/gu) ?? []).length, values.length, `${name}: the registered body has as many values as the shop sent`);
    assert.ok(!/^\{\{|\}\}$/u.test(body), `${name} starts or ends with a value, which Meta rejects`);
    assert.equal(body.replace(/\{\{(\d+)\}\}/gu, (_m, n: string) => values[Number(n) - 1]), sent[0].text, `${name}: the registered body filled is the text the shop wrote`);
  }
  /** A plan on the test clock whose customer last wrote at the start (and then skips `skipDays` days, carried as credit); the month's renewal is asked for, never paid, and lapses. */
  async function lapsedPlan(razorpay: boolean, skipDays: number): Promise<Shop> {
    const s = await boot({ mode: "guards", onClock: true, tickSeconds: 1, ...(razorpay ? RAZORPAY : {}) });
    await s.inbound(CUSTOMER, "I want the monthly lunch plan");
    if (razorpay) await payFirstLink(s); else await s.ownerPress("deposit", "received");
    assert.equal(s.templatesTo(CUSTOMER).at(-1), "plan_active");
    for (const d of ["12", "13", "16"].slice(0, skipDays)) await s.inbound(CUSTOMER, `skip ${d} nov`);
    s.advance(DEC8 - s.now()); await beat();
    assert.equal(count(s, "plan_renewal"), 1);
    s.advance(at({ year: 2026, month: 12, day: 9 }, 21) - s.now()); await beat();
    assert.ok(s.record().some((r) => r.action === "plan_lapse" && r.refs.period === "1"));
    return s;
  }
  const payFirstLink = async (s: Shop): Promise<void> => { await s.events(s.guards!.pay(s.guards!.standins.fakes.payments.links()[0].id).map((event) => ({ kind: "payment_event", event }))); await s.settle(); };
  const RAZORPAY = { example: "plans", settings: { payment: { module: "razorpay", upi: null } } } as const;

  contract("a renewal not paid in time: 'not renewed' goes as plan_lapsed, with the plan's name", async () => {
    const s = await lapsedPlan(false, 1);
    wentAs(s, "plan_lapsed", [MONTH]);
  });

  contract("a first payment that never came: the hold that ran out goes as plan_hold_expired, with the plan's name", async () => {
    const s = await boot({ mode: "guards", onClock: true, tickSeconds: 1 });
    // the hold is 30 minutes, so the window the customer's own message opened would still be open when it ends: their message is stamped a day old, as a customer who wrote
    // yesterday and left it (the shop keeps the window from that stamp)
    await s.inbound(CUSTOMER, "I want the monthly lunch plan", { extra: { timestamp: s.now() - 25 * HOUR } });
    s.advance(40 * MIN); await beat();
    assert.ok(s.record().some((r) => r.action === "plan_lapse" && r.refs.period === "0"));
    wentAs(s, "plan_hold_expired", [MONTH]);
  });

  // ₹109 is a day of the ₹2,400 plan (floor(2400 / 22)), and the shop's own refund limit is ₹300: one carried day goes back at once, three (₹327) wait for the owner
  contract("the credit of a lapsed plan going back, within the refund limit: plan_credit_refund, with the amount and the plan's name", async () => {
    const s = await lapsedPlan(true, 1);
    wentAs(s, "plan_credit_refund", ["₹109", MONTH]);
  });

  contract("the credit of a lapsed plan above the refund limit waits for the owner: plan_credit_refund_pending, with the amount and the plan's name", async () => {
    const s = await lapsedPlan(true, 3);
    wentAs(s, "plan_credit_refund_pending", ["₹327", MONTH]);
  });
});
