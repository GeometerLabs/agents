// The licence's wind-down and final stop in a Bookings shop (plan B13; modules/licence). The runtime's own check of the lease: no new work in the wind-down, refunds,
// cancellations, existing bookings and payments from earlier links go on, nothing is kept to do later, and in the final stop the open links are closed and nothing more
// is sent but the owner's one notice. Guard's own offline check (monorepo ADR-0062) answers 402 `subscription_suspended`: the tests near the end give the runtime
// that answer and check it is taken as the runtime's own pause. The real Guard's answer is the Docker proof's (bundle/test/proof/run.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorld, CUSTOMER } from "../src/harness.ts";
import { GuardSuspendedError } from "../../../../modules/core/faults.ts";
import { LICENCE_RULE, UNRESTRICTED, licenceNow } from "../../../../modules/licence/rules.ts";
import type { LeaseShop, LicenceFile, LicenceNow } from "../../../../modules/licence/rules.ts";
import { licenceReader } from "../../../../modules/runtime/config.ts";
import { TEMPLATES } from "../src/language/templates.ts";
import { createKit } from "./runtime-kit.ts";
import { buildMonthlyReport } from "../report/data.ts";
import { monthRange } from "../../../../modules/report/months.ts";

const BOOK = "haircut tomorrow at 6pm";
const PAID_THROUGH = 1_796_668_200;
let state: LicenceNow = UNRESTRICTED;
const set = (s: LicenceNow["state"], exportUntil: number | null = null) => { state = { state: s, restricted: s === "wind_down" || s === "stopped", takesNewWork: s !== "wind_down" && s !== "stopped", paidThrough: PAID_THROUGH, exportUntil, partner: "Divya, local partner" }; };
const world = () => { state = UNRESTRICTED; return createWorld({ licence: () => state }); };
const entries = (w: ReturnType<typeof createWorld>, action: string) => w.record.entries().filter((e) => e.action === action);

test("in the wind-down a request to book is answered 'paused, contact the shop': no booking, no hold, no link, and nothing kept to do later", async () => {
  const w = world();
  set("wind_down");
  await w.say(BOOK);
  assert.equal(w.lastTextTo(CUSTOMER), "Sorry, online booking is paused for now. Please contact Glow Salon directly.");
  assert.equal(w.store.bookings.size, 0, "no draft is kept as a promise");
  assert.equal(w.payments.links().length, 0);
  assert.equal(w.calendar.events().length, 0);
  const refused = entries(w, "new_work");
  assert.equal(refused.length, 1);
  assert.equal(refused[0].outcome, "blocked");
  assert.equal(refused[0].decisions[0].ruleId, LICENCE_RULE);
  assert.equal(entries(w, "send_message").at(-1)!.outcome, "confirmed", "the customer is told, and WhatsApp shows it");
  await w.say("hi");
  assert.equal(w.lastTextTo(CUSTOMER), "Sorry, online booking is paused for now. Please contact Glow Salon directly.", "no menu that would end in 'paused'");
  assert.deepEqual(entries(w, "licence").map((e) => e.refs.state), ["wind_down"], "one record line for the change, not one per message");
});

test("a deposit paid from a link sent before the wind-down still books, and a cancellation in the wind-down still refunds", async () => {
  const w = world();
  await w.say(BOOK);
  const link = w.linkFor("b-1")!;
  set("wind_down");
  w.payments.customerPays(link.id);
  await w.deliverPaymentEvents();
  assert.equal(w.store.bookings.get("b-1")!.state, "confirmed", "money owed to the customer's booking is honoured: the earlier link's payment books");
  assert.match(w.lastTextTo(CUSTOMER), /^You're booked!/u);
  await w.say("cancel my booking");
  assert.equal(w.store.bookings.get("b-1")!.state, "cancelled");
  assert.ok(entries(w, "refund").length > 0 && entries(w, "refund").every((e) => e.outcome !== "blocked"), "the deposit's refund goes on in the wind-down");
});

test("a request that was waiting for 'yes' when the wind-down began is not held: the customer is told, and nothing is made", async () => {
  const w = world();
  await w.say("haircut tomorrow at 6"); // 6 with no am or pm: a time to confirm
  assert.equal(w.store.bookings.get("b-1")?.state, "confirming_details");
  set("wind_down");
  await w.say("yes");
  assert.equal(w.store.bookings.get("b-1")!.state, "enquiry");
  assert.equal(w.payments.links().length, 0);
  assert.equal(w.lastTextTo(CUSTOMER), "Sorry, online booking is paused for now. Please contact Glow Salon directly.");
});

test("back to normal: new bookings are taken at once, and nothing asked in the wind-down is done by itself", async () => {
  const w = world();
  set("wind_down");
  await w.say(BOOK);
  set("active");
  state = UNRESTRICTED;
  await w.tick();
  assert.equal(w.store.bookings.size, 0, "the refused request is not replayed");
  await w.say(BOOK);
  assert.equal(w.store.bookings.get("b-1")!.state, "awaiting_deposit");
  assert.deepEqual(entries(w, "licence").map((e) => e.refs.state), ["wind_down", "active"]);
});

test("the final stop closes the open deposit links once, through the payments service, and sends nothing more; a payment made before is still recorded", async () => {
  const w = world();
  await w.say(BOOK);
  await w.say("facial tomorrow at 2pm", { from: "+919822222222" });
  w.payments.customerPays(w.linkFor("b-2")!.id); // paid just before the stop; its webhook comes after
  set("stopped", PAID_THROUGH + 150 * 86_400);
  const before = w.textsTo(CUSTOMER).length;
  await w.tick();
  const closed = entries(w, "cancel_deposit_link").filter((e) => e.refs.licence === `stop:${PAID_THROUGH}`);
  assert.deepEqual(closed.map((e) => [e.booking, e.outcome]), [["b-1", "confirmed"], ["b-2", "unconfirmed"]], "the paid one could not be closed: it is paid");
  assert.equal(w.linkFor("b-1")!.status, "cancelled");
  await w.tick();
  assert.equal(entries(w, "cancel_deposit_link").length, 2, "once for each paid_through");
  await w.deliverPaymentEvents();
  assert.ok(w.record.isConfirmed("b-2", "record_deposit"), "the payment is recorded");
  await w.say("hello");
  assert.equal(w.textsTo(CUSTOMER).length, before, "nothing more is sent");
  const blocked = entries(w, "send_message").filter((e) => e.outcome === "blocked" && e.decisions.some((d) => d.ruleId === LICENCE_RULE));
  assert.ok(blocked.length >= 1, "and the record says each one that was held back");
});

test("every licence message has its words in all four languages, and the owner's notices name the partner and are never about money", () => {
  for (const language of ["en", "hi", "ml", "kn"] as const) {
    const facts = { language, timeZone: "Asia/Kolkata", businessName: "Glow Salon", services: [], partner: "Divya, local partner", upcomingCount: 3 };
    for (const id of ["booking_paused", "owner_licence_paused", "owner_licence_stopped"] as const) {
      const text = TEMPLATES[language][id](facts);
      assert.ok(text.length > 20, `${language} ${id}`);
      if (id !== "booking_paused") assert.ok(text.includes("Divya, local partner"), `${language} ${id} names the partner`);
      assert.doesNotMatch(text, /₹|invoice|pay |payment|safe|guarantee/iu, `${language} ${id}`);
    }
  }
});

// ---- the runtime: the owner's notice, once for each paid_through ----------------------------------------------------------------------------------------------------

test("the runtime sends the owner one service notice at the wind-down and one at the final stop, once each, and again only for a new paid_through", async () => {
  const kit = createKit();
  try {
    for (const name of ["owner_service_paused", "owner_service_stopped"]) for (const l of ["en", "hi", "ml", "kn"]) kit.messaging.approve(name, l);
    let now: LicenceNow = UNRESTRICTED;
    const { runtime } = kit.open({ licence: () => now });
    const owner = kit.settings.owner.whatsapp;
    await runtime.tick();
    assert.equal(kit.messaging.sentTo(owner).length, 0, "nothing to say while the shop is in order");
    now = { state: "wind_down", restricted: true, takesNewWork: false, paidThrough: PAID_THROUGH, exportUntil: null, partner: "Divya, local partner" };
    await runtime.tick();
    await runtime.tick();
    const first = kit.messaging.sentTo(owner);
    assert.equal(first.length, 1, "once");
    assert.equal(first[0].templateName, "owner_service_paused", "the owner has not written today, so it goes as the utility template");
    assert.equal(first[0].text, "Heads up: online booking for Glow Salon is paused for now. Bookings you already have, cancellations and refunds still go through. To sort it out, please contact Divya, local partner.");
    now = { ...now, state: "stopped", exportUntil: PAID_THROUGH + 150 * 86_400 };
    await runtime.tick();
    await runtime.tick();
    const all = kit.messaging.sentTo(owner);
    assert.equal(all.length, 2);
    assert.equal(all[1].templateName, "owner_service_stopped");
    assert.equal(all[1].text, "Heads up: online booking for Glow Salon has stopped, because the service from Divya, local partner has ended. Bookings still in your calendar after today: 0. To keep it going with another local partner, write to hello@geometer.dev and Geometer will put you in touch.");
    assert.doesNotMatch(all[1].text, /copy|export|records|owe|pay|keys/iu, "no money, no blame, no copy or export for the owner");
    now = { ...now, state: "wind_down", paidThrough: PAID_THROUGH + 40 * 86_400, exportUntil: null };
    await runtime.tick();
    assert.equal(kit.messaging.sentTo(owner).length, 3, "a later lapse is a new paid_through, and a new notice");
  } finally { kit.cleanup(); }
});

// ---- the reader: client/licence.json ------------------------------------------------------------------------------------------------------------------------------

test("the runtime reads client/licence.json by its modified time and judges it with its own clock; no file, or a file that does not check, never restricts by accident", () => {
  const dir = mkdtempSync(join(tmpdir(), "geo-licence-reader-"));
  try {
    let clockMs = (PAID_THROUGH + 10 * 86_400) * 1000;
    const read = licenceReader(dir, { now: () => clockMs });
    assert.deepEqual(read(), UNRESTRICTED, "no file: not restricted");
    const shop: LeaseShop = { id: "glow-salon", plan: "business", state: "active", paid_through: PAID_THROUGH, grace_days: 30, expires: PAID_THROUGH + 30 * 86_400, stop_at: null, export_until: null, notice: null };
    const file: LicenceFile = { schema: 1, shop, newest_issued_at: PAID_THROUGH, extension_until: 0, partner: "Divya, local partner" };
    writeFileSync(join(dir, "licence.json"), JSON.stringify(file));
    assert.equal(read().state, "active");
    clockMs = (PAID_THROUGH + 31 * 86_400) * 1000;
    assert.equal(read().state, "wind_down", "the lease ran out while nothing was written: the runtime's own clock says so");
    writeFileSync(join(dir, "licence.json"), "{ half");
    utimesSync(join(dir, "licence.json"), new Date(), new Date(Date.now() + 5_000));
    assert.equal(read().state, "wind_down", "a file that does not read leaves the last good reading standing");
    assert.equal(licenceNow({ ...file, shop: null }, clockMs).restricted, false, "a shop the lease does not list");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---- Guard's own check (ADR-0062): the same refusal, made outside the runtime. Here the runtime's file says the shop is in order (a builder edited it, or the
// runtime has not read the newer lease yet) and Guard answers 402 `subscription_suspended`. The runtime treats it as its own pause: once, plainly, nothing kept.

const PAUSED = "Sorry, online booking is paused for now. Please contact Glow Salon directly.";
const suspended = (operation: string) => new GuardSuspendedError(402, `refused by the Guard: subscription_suspended: the licence for shop glow-salon is in its wind-down, so ${operation} (new work) is refused`,
  { decision: "deny", code: "subscription_suspended", reason_code: "subscription_suspended", sent: "no", retry: "no", reason: `subscription_suspended: the licence for shop glow-salon is in its wind-down, so ${operation} (new work) is refused`, detail: { state: "wind_down", shop: "glow-salon", operation } },
  { method: "POST", path: "/x" });

test("Guard refuses the hold for the licence while the runtime's own file says 'in order': the customer is told 'paused', the calendar is asked once, the owner is not asked to do anything", async () => {
  const w = world();
  let inserts = 0;
  w.calendar.insert = async () => { inserts++; throw suspended("insert"); };
  const ownerBefore = w.messaging.sentTo(w.owner).length;
  await w.say(BOOK);
  assert.equal(inserts, 1, "never tried again");
  assert.equal(w.lastTextTo(CUSTOMER), PAUSED);
  assert.equal(w.payments.links().length, 0, "no deposit link either");
  const hold = entries(w, "hold_slot").at(-1)!;
  assert.equal(hold.outcome, "blocked");
  assert.ok(hold.decisions.some((d) => d.ruleId === LICENCE_RULE && /^Guard refused it for the shop's licence/u.test(d.reason)), JSON.stringify(hold.decisions));
  const refused = entries(w, "new_work").at(-1)!;
  assert.deepEqual([refused.outcome, refused.decisions[0].ruleId], ["blocked", LICENCE_RULE]);
  assert.equal(w.messaging.sentTo(w.owner).length, ownerBefore, "no 'could not book' to the owner: nothing failed, the licence held it back");
  assert.ok(![...w.store.bookings.values()].some((b) => b.state === "awaiting_deposit" || b.state === "confirmed" || b.pending.length > 0), "nothing is kept to do later");
});

test("Guard refuses the deposit link for the licence: asked once, the slot is let go, and the customer is told 'paused'", async () => {
  const w = world();
  let creates = 0;
  w.payments.createRequest = async () => { creates++; throw suspended("create_link"); };
  await w.say(BOOK);
  assert.equal(creates, 1, "never tried again");
  assert.equal(w.lastTextTo(CUSTOMER), PAUSED);
  assert.equal(w.calendar.events().filter((e) => e.bookingRef === "b-1").length, 0, "the hold was let go (a delete, which no licence refuses)");
  const link = entries(w, "create_deposit_link").at(-1)!;
  assert.deepEqual([link.outcome, link.decisions[0]?.ruleId], ["blocked", LICENCE_RULE]);
});

test("in Guard's final stop a send to a customer is refused: recorded once as blocked, and not sent again as plain text", async () => {
  const w = world();
  let texts = 0;
  const realText = w.messaging.sendText.bind(w.messaging);
  w.messaging.sendText = async (to, text) => { if (to === CUSTOMER) { texts++; throw suspended("send"); } return realText(to, text); };
  if (w.messaging.sendInteractive) w.messaging.sendInteractive = async () => { throw suspended("send"); };
  await w.say("hi");
  assert.equal(texts, 0, "buttons Guard held back are not tried again as text");
  const sent = entries(w, "send_message").at(-1)!;
  assert.equal(sent.outcome, "blocked");
  assert.ok(sent.decisions.some((d) => d.ruleId === LICENCE_RULE));
});

test("the monthly report of a month with a wind-down is made, and never counts a licence refusal as one of the shop's limits that held", async () => {
  const w = world();
  await w.say(BOOK); // a booking while in order: nothing stopped
  set("wind_down");
  await w.say(BOOK, { from: "+919822222222" });
  await w.say("hi", { from: "+919833333333" });
  set("stopped");
  await w.tick();
  await w.say("hello");
  const { from, to } = monthRange("2026-11", w.settings.timezone);
  const report = buildMonthlyReport({ settings: w.settings, entries: w.record.entries(), bookings: [...w.store.bookings.values()], from, to, source: "stand-in", madeAt: to });
  assert.equal(report.stopped.total, 0, "the licence's refusals are not the shop's limits");
  assert.equal(Object.values(report.stopped.byRule).reduce((a, b) => a + b, 0), 0);
});
