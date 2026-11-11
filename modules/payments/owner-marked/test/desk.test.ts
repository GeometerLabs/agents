// The owner-marked desk an agent someone else wrote calls for UPI (B71): "paid" only after the owner's own mark, a claim marks nothing, the same mark twice counts once,
// a mark after the close is kept apart, a refund is owed (never sent) and never more than was marked, and the record carries the templates' own names.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeClock } from "../../../core/clock.ts";
import { createDesk } from "../desk.ts";
import type { DeskEntry, DeskNotice } from "../desk.ts";
import { emptyMarkState, REFUND_REMINDERS_MAX, REFUND_REMINDER_EVERY_MS } from "../ledger.ts";
import { MARK_ACTIONS, markObligations } from "../obligations.ts";
import { markButtonId } from "../owner.ts";

const OWNER = "+919800000000";
const CUSTOMER = "+919811111111";

function world() {
  const clock = fakeClock(Date.UTC(2026, 10, 10, 4, 30));
  const state = emptyMarkState();
  const told: DeskNotice[] = [];
  const entries: DeskEntry[] = [];
  let saves = 0;
  const desk = createDesk({
    clock, owner: OWNER, state, payment: { module: "upi", upi: { id: "glowsalon@okicici", payee: "Glow Salon" } },
    save: () => { saves++; }, record: (e) => entries.push(e), tellOwner: async (n) => { told.push(n); return true; }, labels: { received: "Received", refundSent: "Refund sent" },
  });
  const records = () => entries.map((e, i) => ({ seq: i + 1, time: new Date(clock.now()).toISOString(), conversation: e.conversation, booking: e.booking, action: e.action, outcome: e.outcome, refs: e.refs, inputs: {}, language: "en", decisions: [] }) as never);
  return { clock, state, told, entries, desk, records, saves: () => saves };
}

test("a request: the pay link to the shop's own UPI ID; asked again for the same reference and amount, the same request; nobody but the owner can make it paid", async () => {
  const w = world();
  const made = await w.desk.handle("POST", "/requests", new URLSearchParams(), { reference: "b-1", amount_paise: 20_000, customer: CUSTOMER, service: "Haircut", slot_ms: Date.UTC(2026, 10, 11, 12) });
  assert.equal(made.status, 200);
  const r = made.body as { id: string; pay_url: string; pay_to: { id: string }; paid: boolean };
  assert.match(r.pay_url, /^upi:\/\/pay\?pa=glowsalon@okicici&/u);
  assert.ok(!r.pay_url.includes(w.state.requests[0].code!), "the owner's code is never in the customer's link");
  assert.equal(r.pay_to.id, "glowsalon@okicici");
  assert.equal(r.paid, false);
  const again = await w.desk.handle("POST", "/requests", new URLSearchParams(), { reference: "b-1", amount_paise: 20_000, customer: CUSTOMER });
  assert.equal((again.body as { id: string }).id, r.id, "one request per reference and amount");
  assert.deepEqual(w.told.map((n) => n.template), ["owner_upi_expected"], "the owner is told to expect it, with the Received button");
  assert.equal((await w.desk.handle("POST", "/requests", new URLSearchParams(), { reference: "b 1", amount_paise: 0, customer: "x" })).status, 400);
  // the customer's claim (a screenshot) marks nothing and asks the owner to look
  const claimed = await w.desk.handle("POST", `/requests/${r.id}/claim`, new URLSearchParams(), { via: "screenshot" });
  assert.equal((claimed.body as { paid: boolean }).paid, false);
  assert.equal(w.told.at(-1)?.template, "owner_upi_claim");
  // a message from anyone else, with the right code, marks nothing
  assert.equal(await w.desk.ownerSays({ from: CUSTOMER, text: `received ${w.state.requests[0].code}` }), "not_ours");
  assert.equal((w.desk.view(w.state.requests[0])).paid, false);
});

test("the owner's marks: another amount is a part with a new code; the rest makes it paid; the same mark twice counts once; a mark after the close is kept apart", async () => {
  const w = world();
  const r = (await w.desk.handle("POST", "/requests", new URLSearchParams(), { reference: "b-1", amount_paise: 20_000, customer: CUSTOMER })).body as { id: string };
  const first = w.state.requests[0].code!;
  assert.equal(await w.desk.ownerSays({ from: OWNER, text: `received ${first} 50` }), "marked");
  assert.equal(w.told.at(-1)?.template, "owner_upi_part");
  const view = () => w.desk.view(w.state.requests[0]);
  assert.deepEqual([view().paid, view().left_paise], [false, 15_000]);
  assert.equal(await w.desk.ownerSays({ from: OWNER, text: "x", reply: { id: markButtonId("received", w.state.requests[0].code!) } }), "marked");
  assert.equal(view().paid, true);
  assert.equal(await w.desk.ownerSays({ from: OWNER, text: `received ${first}` }), "already", "a used code counts nothing");
  assert.equal(view().paid_paise, 20_000);
  // after the close
  const late = (await w.desk.handle("POST", "/requests", new URLSearchParams(), { reference: "b-2", amount_paise: 20_000, customer: CUSTOMER })).body as { id: string };
  const code = w.state.requests[1].code!;
  await w.desk.handle("POST", `/requests/${late.id}/close`, new URLSearchParams(), {});
  assert.equal(await w.desk.ownerSays({ from: OWNER, text: `received ${code}` }), "marked");
  const after = w.desk.view(w.state.requests[1]);
  assert.deepEqual([after.paid, after.status, after.payments[0].after_close], [false, "cancelled", true], "kept apart: it pays nothing open");
  assert.equal(w.told.at(-1)?.template, "owner_upi_late");
  // B71 part 2: as in a template, the late money is owed back (or kept), and the owner's message carries that refund's own code
  assert.deepEqual(w.state.refunds.map((x) => [x.paymentId, x.amountPaise, x.state, x.keepAllowed]), [[after.payments[0].id, 20_000, "owed", true]]);
  assert.equal(w.told.at(-1)?.facts.upiCode, w.state.refunds[0].code);
  assert.ok(r.id && w.saves() > 0);
});

test("a refund: owed by the owner, never more than was marked on that payment, reminded at most three times, and only then marked sent; the record reads as a template's", async () => {
  const w = world();
  await w.desk.handle("POST", "/requests", new URLSearchParams(), { reference: "b-1", amount_paise: 20_000, customer: CUSTOMER });
  await w.desk.ownerSays({ from: OWNER, text: `received ${w.state.requests[0].code}` });
  const paymentId = w.state.requests[0].marks[0].id;
  assert.equal((await w.desk.handle("POST", "/refunds", new URLSearchParams(), { payment_id: paymentId, amount_paise: 20_001 })).status, 409, "more than was marked");
  const owed = await w.desk.handle("POST", "/refunds", new URLSearchParams(), { payment_id: paymentId, amount_paise: 20_000, why: "cancelled" });
  assert.equal(owed.status, 200);
  assert.equal((await w.desk.handle("POST", "/refunds", new URLSearchParams(), { payment_id: paymentId, amount_paise: 1 })).status, 409, "the same money is never owed twice");
  for (let d = 0; d < 6; d++) { w.clock.advance(REFUND_REMINDER_EVERY_MS); await w.desk.tick(); }
  assert.equal(w.told.filter((n) => n.template === "owner_upi_refund_reminder").length, REFUND_REMINDERS_MAX);
  assert.deepEqual(markObligations(w.records()).map((o) => o.kind), ["upi_refund_owed"], "the unfinished-work list sees it");
  const refundCode = w.state.refunds[0].code!;
  assert.equal(await w.desk.ownerSays({ from: OWNER, text: `refunded ${refundCode}` }), "refund");
  assert.deepEqual(((await w.desk.handle("GET", "/refunds", new URLSearchParams({ payment_id: paymentId }), undefined)).body as { refunds: { sent: boolean }[] }).refunds.map((x) => x.sent), [true]);
  assert.deepEqual(markObligations(w.records()), []);
  assert.ok(w.entries.some((e) => e.action === MARK_ACTIONS.marked && e.refs.markedBy === "owner"));
});
