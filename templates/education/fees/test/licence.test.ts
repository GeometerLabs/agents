// The licence's wind-down and final stop in a Fees centre (plan B13; modules/licence). The runtime's own check of the lease: in the wind-down no new fee link, no month's
// fees opened, no late fee and no reminder (and none kept to send later); payments from links sent earlier are still counted and receipted; in the final stop the open
// fee links are closed and nothing more is sent but the owner's one notice. Guard's offline check is not built yet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ROHAN_PARENT, createWorld } from "../src/harness.ts";
import { LICENCE_RULE, UNRESTRICTED } from "../../../../modules/licence/rules.ts";
import type { LicenceNow } from "../../../../modules/licence/rules.ts";
import { TEMPLATES } from "../src/language/templates.ts";
import { createKit } from "./runtime-kit.ts";

const PAID_THROUGH = 1_796_668_200;
let state: LicenceNow = UNRESTRICTED;
const set = (s: LicenceNow["state"]) => { state = s === "active" ? UNRESTRICTED : { state: s, restricted: true, takesNewWork: false, paidThrough: PAID_THROUGH, exportUntil: PAID_THROUGH + 150 * 86_400, partner: "Divya, local partner" }; };
const world = () => { state = UNRESTRICTED; return createWorld({ licence: () => state }); };
const entries = (w: ReturnType<typeof createWorld>, action: string) => w.record.entries().filter((e) => e.action === action);
const PAUSED = "Online fee payment is paused for now. Please contact Bright Tuition Centre directly.";

test("in the wind-down no month's fees are opened, no reminder goes, and none is kept to send later; back to normal, the centre's own schedule goes on", async () => {
  const w = world();
  set("wind_down");
  await w.advance(61); // the first reminder's moment
  assert.equal(w.store.dues.size, 0, "no new fees in the wind-down");
  assert.equal(w.payments.links().length, 0);
  assert.equal(w.textsTo(ROHAN_PARENT).length, 0);
  set("active");
  await w.tick();
  assert.equal(w.store.dues.size, 5, "the month's fees are the centre's own schedule: opened once it is in order again");
  assert.equal(w.textsTo(ROHAN_PARENT).length, 1, "one reminder, not one for each beat that passed");
  assert.deepEqual(entries(w, "licence").map((e) => e.refs.state), ["wind_down", "active"]);
});

test("a fee open before the wind-down: its reminder is passed over, the parent who asks to pay is told to contact the centre, and a payment on the earlier link is still receipted", async () => {
  const w = world();
  await w.advance(61);
  const sent = w.textsTo(ROHAN_PARENT).length;
  set("wind_down");
  await w.goto({ year: 2026, month: 11, day: 10 });
  assert.equal(w.textsTo(ROHAN_PARENT).length, sent, "no reminder in the wind-down");
  assert.equal(w.dueOf("Rohan Mehta")!.lateFeeInr, 0, "no late fee is added while online payment is paused");
  await w.say("I want to pay", { from: ROHAN_PARENT });
  assert.equal(w.lastTextTo(ROHAN_PARENT), PAUSED);
  assert.equal(entries(w, "new_work").at(-1)!.decisions[0].ruleId, LICENCE_RULE);
  w.pays("Rohan Mehta");
  await w.deliverPaymentEvents();
  assert.equal(w.dueOf("Rohan Mehta")!.state, "paid", "money paid on a link sent earlier is counted");
  assert.match(w.lastTextTo(ROHAN_PARENT), /received/iu, "and the parent gets the receipt");
});

test("the final stop closes the open fee links once and sends nothing more", async () => {
  const w = world();
  await w.advance(61);
  set("stopped");
  const sent = w.messaging.outbox().length;
  await w.tick();
  await w.tick();
  const closed = entries(w, "cancel_fee_link").filter((e) => e.refs.licence === `stop:${PAID_THROUGH}`);
  assert.equal(closed.length, 5, "each open fee's link, once");
  assert.ok(closed.every((e) => e.outcome === "confirmed"));
  assert.ok(w.payments.links().every((l) => l.status === "cancelled"));
  await w.say("hello", { from: ROHAN_PARENT });
  assert.equal(w.messaging.outbox().length, sent, "nothing more is sent");
});

test("every licence message has its words in all four languages; the owner's notices name the partner and are never about money", () => {
  for (const language of ["en", "hi", "ml", "kn"] as const) {
    const facts = { language, timeZone: "Asia/Kolkata", businessName: "Bright Tuition", partner: "Divya, local partner", openFeesCount: 4, openCount: 1, licenceDateMs: Date.UTC(2027, 2, 4, 18, 30) };
    for (const id of ["fee_paused", "owner_licence_paused", "owner_licence_stopped"] as const) {
      const text = TEMPLATES[language][id](facts);
      if (id !== "fee_paused") assert.ok(text.includes("Divya, local partner"), `${language} ${id}`);
      assert.doesNotMatch(text, /₹|invoice|safe|guarantee/iu, `${language} ${id}`);
    }
  }
});

test("the runtime sends the owner the wind-down's notice once, as the utility template", async () => {
  const kit = createKit();
  try {
    for (const name of ["owner_fee_service_paused", "owner_fee_service_stopped"]) for (const l of ["en", "hi", "ml", "kn"]) kit.messaging.approve(name, l);
    let now: LicenceNow = UNRESTRICTED;
    const { runtime } = kit.open({ licence: () => now });
    const owner = kit.settings.owner.whatsapp;
    const notices = () => kit.messaging.sentTo(owner).filter((m) => m.templateName?.startsWith("owner_fee_service_"));
    now = { state: "wind_down", restricted: true, takesNewWork: false, paidThrough: PAID_THROUGH, exportUntil: null, partner: "Divya, local partner" };
    await runtime.tick();
    await runtime.tick();
    assert.equal(notices().length, 1);
    assert.equal(notices()[0].text, "Notice: online fee payment for Bright Tuition Centre is paused for now. Fees already paid, and refunds, still go through. Please contact Divya, local partner about it.");
  } finally { kit.cleanup(); }
});
