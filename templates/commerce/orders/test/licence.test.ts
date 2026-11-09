// The licence's wind-down and final stop in an Orders shop (plan B13; modules/licence): in the wind-down no new order, hold or link (and nothing kept to do later); an order
// already paid is still counted and receipted; in the final stop the open advance links are closed and nothing more is sent.
import { test } from "node:test";
import assert from "node:assert/strict";
import { AMIT, annapurnaRazorpay, createWorld } from "../src/harness.ts";
import { GuardSuspendedError } from "../../../../modules/core/faults.ts";
import { LICENCE_RULE, UNRESTRICTED } from "../../../../modules/licence/rules.ts";
import type { LicenceNow } from "../../../../modules/licence/rules.ts";
import { TEMPLATES } from "../src/language/templates.ts";

const PAID_THROUGH = 1_796_668_200;
let state: LicenceNow = UNRESTRICTED;
const set = (s: LicenceNow["state"]) => { state = s === "active" ? UNRESTRICTED : { state: s, restricted: true, takesNewWork: false, paidThrough: PAID_THROUGH, exportUntil: PAID_THROUGH + 90 * 86400, partner: "Divya, local partner" } as LicenceNow; };
const world = () => { state = UNRESTRICTED; return createWorld({ settings: annapurnaRazorpay(), licence: () => state }); };
const ORDER = "2 veg thali 10 nov 12:00 pm pickup";

test("in the wind-down a new order is answered 'contact the shop', no hold or link is made, and nothing is kept for later", async () => {
  const w = world();
  set("wind_down");
  await w.say(ORDER);
  assert.equal(w.lastTextTo(AMIT), "Online ordering is paused for now. Please contact Annapurna Tiffins directly.");
  assert.equal(w.payments.links().length, 0);
  assert.equal(w.store.orders.size, 0);
  assert.equal(w.record.entries().find((e) => e.action === "new_work")!.decisions[0].ruleId, LICENCE_RULE);
  set("active");
  await w.say(ORDER);
  assert.equal(w.orderOf(AMIT)!.state, "awaiting_advance", "ordering again works once the licence is in order");
});

test("an order held before the wind-down is still paid, confirmed and receipted", async () => {
  const w = world();
  await w.say(ORDER);
  set("wind_down");
  w.pays(AMIT);
  await w.deliverPaymentEvents();
  assert.equal(w.orderOf(AMIT)!.state, "confirmed");
});

test("the final stop closes the open advance links once and sends nothing more", async () => {
  const w = world();
  await w.say(ORDER);
  set("stopped");
  const sent = w.messaging.outbox().length;
  await w.tick();
  await w.tick();
  const closed = w.record.entries().filter((e) => e.action === "cancel_advance_link" && e.refs.licence === `stop:${PAID_THROUGH}`);
  assert.equal(closed.length, 1);
  assert.ok(w.payments.links().every((l) => l.status === "cancelled"));
  await w.say("hello");
  assert.equal(w.messaging.outbox().length, sent);
});

test("the licence messages exist in four languages, name the partner, and are never about money", () => {
  for (const language of ["en", "hi", "ml", "kn"] as const) {
    const facts = { language, timeZone: "Asia/Kolkata", businessName: "Annapurna", menu: [], partner: "Divya, local partner", upcomingCount: 4 };
    for (const id of ["orders_paused", "owner_licence_paused", "owner_licence_stopped"] as const) {
      const text = TEMPLATES[language][id](facts);
      if (id !== "orders_paused") assert.ok(text.includes("Divya, local partner"), `${language} ${id}`);
      assert.doesNotMatch(text, /₹|invoice|safe|guarantee/iu, `${language} ${id}`);
    }
  }
});

test("Guard refuses the advance link for the licence (402) while the runtime's own file says 'in order': asked once, the customer told 'contact the shop', the owner not asked to do anything", async () => {
  const w = world();
  let creates = 0;
  w.payments.createRequest = async () => {
    creates++;
    throw new GuardSuspendedError(402, "refused by the Guard: subscription_suspended: the licence for shop annapurna-tiffins is in its wind-down, so create_link (new work) is refused",
      { decision: "deny", code: "subscription_suspended", reason_code: "subscription_suspended", sent: "no", retry: "no", reason: "subscription_suspended: the licence for shop annapurna-tiffins is in its wind-down, so create_link (new work) is refused" }, { method: "POST", path: "/v1/payment_links" });
  };
  const ownerBefore = w.messaging.sentTo(w.owner).length;
  await w.say(ORDER);
  assert.equal(creates, 1, "never tried again");
  assert.equal(w.lastTextTo(AMIT), "Online ordering is paused for now. Please contact Annapurna Tiffins directly.");
  const link = w.record.entries().filter((e) => e.action === "create_advance_link").at(-1)!;
  assert.deepEqual([link.outcome, link.decisions[0]?.ruleId], ["blocked", LICENCE_RULE]);
  assert.match(link.decisions[0].reason, /^Guard refused it for the shop's licence/u);
  assert.equal(w.messaging.sentTo(w.owner).length, ownerBefore, "no 'link failed' to the owner: the licence held it back");
  assert.ok(![...w.store.orders.values()].some((o) => o.state === "awaiting_advance" || o.state === "confirmed"), "nothing is kept to do later");
});
