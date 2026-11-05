// Buttons and lists (B47): the words and limits, a tap read without a model, what the webhook and the events carry, what goes on the wire to WhatsApp,
// and the agent's turns: pick a service, pick a time, are you sure, talk to the owner. The tests that need the agent use the harness, whose stand-in
// WhatsApp keeps every interactive message it was given.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createWorld, CUSTOMER, glowSalon, OTHER_CUSTOMER } from "../src/harness.ts";
import { fakeClock } from "../../../../modules/core/clock.ts";
import { ApiError } from "../../../../modules/core/faults.ts";
import { createWhatsAppMessaging, interactiveBody } from "../../../../modules/messaging/whatsapp.ts";
import { parseWhatsAppWebhook } from "../../../../modules/messaging/webhooks.ts";
import { clip, interactiveProblem, interactiveText } from "../../../../modules/language/interactive.ts";
import { ID, LABELS, buttonsFor, intentFromReply, serviceList, slotList } from "../src/language/interactive.ts";
import type { InteractiveMessage } from "../../../../modules/language/interactive.ts";
import { parseSettings } from "../src/settings.ts";
import { LANGUAGES } from "../../../../modules/language/languages.ts";
import { zonedToMs } from "../../../../modules/core/time.ts";
import { checkEvents } from "../server/events.ts";
import { startStandins } from "../standins/server.ts";

const salon = glowSalon();
const IST = "Asia/Kolkata";

// ---- the words and the limits --------------------------------------------------------------------------------------------------

test("every label fits WhatsApp's limits in all four languages, and none carries a number", () => {
  for (const language of LANGUAGES) {
    for (const [key, text] of Object.entries(LABELS[language])) {
      assert.ok([...text].length <= (key === "owner" ? 24 : 20), `${language} ${key} "${text}"`);
      assert.ok(!/\d|₹/u.test(text), `${language} ${key}`);
    }
    for (const id of ["yes", "no", "cancel", "cancelYes", "keep", "owner"] as const) assert.equal(interactiveProblem({ body: "x", buttons: buttonsFor(language, [id]) }), null, `${language} ${id}`);
    assert.equal(interactiveProblem({ body: "x", list: serviceList(salon, language) }), null);
  }
});

test("interactiveProblem refuses what Meta refuses: 4 buttons, 11 rows, long titles counted in characters, repeated ids, empty words, both kinds at once", () => {
  const b = (id: string, title = "Yes") => ({ id, title });
  assert.equal(interactiveProblem({ body: "Hi", buttons: [b("a"), b("b"), b("c")] }), null);
  assert.match(interactiveProblem({ body: "Hi", buttons: [b("a"), b("b"), b("c"), b("d")] })!, /1 to 3 buttons/);
  assert.match(interactiveProblem({ body: "Hi", buttons: [b("a", "x".repeat(21))] })!, /1 to 20 characters/);
  assert.equal(interactiveProblem({ body: "Hi", buttons: [b("a", "ബുക്കിംഗ് റദ്ദാക്കൂ")] }), null, "Malayalam is counted in letters, not in code units");
  assert.match(interactiveProblem({ body: "Hi", buttons: [b("a"), b("a")] })!, /used twice/);
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, title: `Row ${i}`, description: "d" }));
  assert.equal(interactiveProblem({ body: "Hi", list: { button: "Pick", rows: rows(10) } }), null);
  assert.match(interactiveProblem({ body: "Hi", list: { button: "Pick", rows: rows(11) } })!, /1 to 10 rows/);
  assert.match(interactiveProblem({ body: "Hi", list: { button: "Pick", rows: [{ id: "a", title: "x".repeat(25) }] } })!, /1 to 24 characters/);
  assert.match(interactiveProblem({ body: "Hi", list: { button: "Pick", rows: [{ id: "a", title: "x", description: "y".repeat(73) }] } })!, /1 to 72/);
  assert.match(interactiveProblem({ body: "", buttons: [b("a")] })!, /body/);
  assert.match(interactiveProblem({ body: "Hi", buttons: [b("a")], list: { button: "Pick", rows: rows(1) } })!, /either buttons or a list/);
  assert.equal(clip("x".repeat(30), 24).length, 24);
  assert.equal(clip("short", 24), "short");
});

test("the list of services holds the shop's own services and prices, reserves its last row for the owner, and a twelfth service is reached by typing", () => {
  const list = serviceList(salon, "en");
  assert.deepEqual(list.rows.map((r) => r.id), ["svc:haircut", "svc:beard-trim", "svc:facial", "svc:hair-colour", "owner"]);
  assert.deepEqual(list.rows.slice(0, 4).map((r) => r.description), ["₹450", "₹250", "₹900", "₹1,800"]);
  const many = parseSettings({ ...JSON.parse(JSON.stringify(salon)), services: Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, names: { hi: [`सेवा${i}`], en: [`service${i}`], ml: [`സേവനം${i}`], kn: [`ಸೇವೆ${i}`] }, priceInr: 300 + i, durationMinutes: 30 })) });
  const wide = serviceList(many, "en");
  assert.equal(wide.rows.length, 10);
  assert.equal(wide.rows.at(-1)!.id, "owner");
  assert.equal(interactiveProblem({ body: "x", list: wide }), null);
});

test("the list of free times shows the time as the title and the day under it, in the customer's language", () => {
  const slots = [zonedToMs({ year: 2026, month: 11, day: 10 }, { hour: 18, minute: 0 }, IST), zonedToMs({ year: 2026, month: 11, day: 11 }, { hour: 10, minute: 30 }, IST)];
  const en = slotList(slots, IST, "en");
  assert.deepEqual(en.rows.map((r) => [r.title, r.description]), [["6:00 pm", "Tue 10 Nov"], ["10:30 am", "Wed 11 Nov"], ["Talk to the owner", undefined]]);
  assert.equal(en.rows[0].id, `slot:${slots[0]}`);
  for (const language of LANGUAGES) assert.equal(interactiveProblem({ body: "x", list: slotList(slots, IST, language) }), null, language);
  assert.equal(interactiveText({ body: "Pick", list: en }), "Pick\n6:00 pm: Tue 10 Nov\n10:30 am: Wed 11 Nov\nTalk to the owner");
});

// ---- a tap is read by looking it up ----------------------------------------------------------------------------------------------

test("a button or list id becomes an Intent with no words read; an id that is none of ours is nothing", () => {
  assert.deepEqual(intentFromReply(ID.yes, salon), { kind: "yes" });
  assert.deepEqual(intentFromReply(ID.no, salon), { kind: "no" });
  assert.deepEqual(intentFromReply(ID.cancel, salon), { kind: "cancel", ask: true });
  assert.deepEqual(intentFromReply(ID.cancelYes, salon), { kind: "cancel" });
  assert.deepEqual(intentFromReply(ID.keep, salon), { kind: "keep" });
  assert.deepEqual(intentFromReply(ID.owner, salon), { kind: "owner" });
  assert.deepEqual(intentFromReply("svc:facial", salon), { kind: "book", serviceId: "facial" });
  const start = zonedToMs({ year: 2026, month: 11, day: 10 }, { hour: 18, minute: 30 }, IST);
  assert.deepEqual(intentFromReply(`slot:${start}`, salon), { kind: "book", date: { kind: "calendar", day: 10, month: 11 }, time: { hour: 6, minute: 30, period: "pm" } });
  const noon = zonedToMs({ year: 2026, month: 11, day: 10 }, { hour: 12, minute: 0 }, IST);
  assert.deepEqual(intentFromReply(`slot:${noon}`, salon)!.time, { hour: 12, minute: 0, period: "pm" });
  for (const id of ["svc:teleport", "svc:", "slot:", "slot:abc", "slot:-5", "cancel yes", "YES", "", "slot:99999999999999999999"]) assert.equal(intentFromReply(id, salon), null, id);
});

// ---- what the webhook and the events carry ---------------------------------------------------------------------------------------

const webhook = (message: object) => ({ object: "whatsapp_business_account", entry: [{ id: "1", changes: [{ field: "messages", value: { messages: [{ from: "919811111111", id: "wamid.x", timestamp: "1749416383", ...message }] } }] }] });

test("the webhook keeps the id and kind of a tapped button or row, besides its title; plain text has none", () => {
  const button = parseWhatsAppWebhook(webhook({ type: "interactive", interactive: { type: "button_reply", button_reply: { id: "yes", title: "Yes" } } }));
  assert.deepEqual(button, [{ id: "wamid.x", from: "+919811111111", text: "Yes", timestamp: 1749416383000, reply: { id: "yes", kind: "button" } }]);
  const row = parseWhatsAppWebhook(webhook({ type: "interactive", interactive: { type: "list_reply", list_reply: { id: "svc:haircut", title: "Haircut", description: "₹450" } } }));
  assert.deepEqual(row[0].reply, { id: "svc:haircut", kind: "list" });
  assert.equal(row[0].text, "Haircut");
  assert.ok(!("reply" in parseWhatsAppWebhook(webhook({ type: "text", text: { body: "hello" } }))[0]));
  assert.ok(!("reply" in parseWhatsAppWebhook(webhook({ type: "interactive", interactive: { type: "button_reply", button_reply: { id: "has space", title: "Yes" } } }))[0]), "an id that is not a short plain id is dropped, and the title is read as words");
});

test("the runtime accepts a reply and checks its shape: a short plain id and a kind, never on a voice note", () => {
  const event = (message: object) => checkEvents({ events: [{ kind: "message", message: { id: "m", from: "+919811111111", text: "Yes", timestamp: 1, ...message } }] });
  const ok = event({ reply: { id: "slot:1793682000000", kind: "list" } });
  assert.ok(ok.ok && (ok.events[0] as { message: { reply?: unknown } }).message.reply !== undefined);
  assert.ok(event({}).ok);
  for (const reply of [{ id: "x y", kind: "list" }, { id: "x", kind: "tap" }, { id: 5, kind: "list" }, "yes", { kind: "list" }, { id: "x".repeat(201), kind: "list" }]) assert.ok(!event({ reply }).ok, JSON.stringify(reply));
  assert.ok(!event({ text: "", voiceNote: true, reply: { id: "yes", kind: "button" } }).ok);
});

// ---- on the wire ------------------------------------------------------------------------------------------------------------------

test("the live adapter sends Meta's interactive body, and the stand-in takes it, keeps it in its outbox and refuses a body Meta would refuse", async () => {
  const clock = fakeClock(1000);
  const s = await startStandins({ razorpayWebhookSecret: "x", whatsappAppSecret: "y", phoneNumberId: "PN1", clock }, { port: 0 });
  after(s.close);
  const whatsapp = createWhatsAppMessaging({ baseUrl: s.url, phoneNumberId: "PN1" }, { clock, window: { lastInboundAt: () => 1000 } });
  s.fakes.messaging.receive(CUSTOMER, "hi");
  const buttons: InteractiveMessage = { body: "Cancel your booking?", buttons: buttonsFor("en", ["cancelYes", "keep"]) };
  const sent = await whatsapp.sendInteractive!(CUSTOMER, buttons);
  assert.equal(sent.kind, "interactive");
  const seen = s.fakes.messaging.outbox().at(-1)!;
  assert.deepEqual([seen.kind, seen.text, seen.interactive], ["interactive", "Cancel your booking?", buttons]);
  const list: InteractiveMessage = { body: "Which service?", list: serviceList(salon, "en") };
  await whatsapp.sendInteractive!(CUSTOMER, list);
  assert.deepEqual(s.fakes.messaging.outbox().at(-1)!.interactive, list);

  assert.deepEqual(interactiveBody("+919811111111", buttons), {
    messaging_product: "whatsapp", recipient_type: "individual", to: "+919811111111", type: "interactive",
    interactive: { type: "button", body: { text: "Cancel your booking?" }, action: { buttons: [{ type: "reply", reply: { id: "cancel_yes", title: "Yes, cancel" } }, { type: "reply", reply: { id: "keep", title: "No, keep it" } }] } },
  });
  const wire = interactiveBody("+919811111111", list) as { interactive: { type: string; action: { button: string; sections: { rows: { id: string }[] }[] } } };
  assert.equal(wire.interactive.type, "list");
  assert.equal(wire.interactive.action.button, "Pick a service");
  assert.equal(wire.interactive.action.sections.length, 1);
  assert.equal(wire.interactive.action.sections[0].rows.length, 5);

  // the adapter will not send what Meta would refuse (and says why), and a closed window is the window's error, as for text
  await assert.rejects(whatsapp.sendInteractive!(CUSTOMER, { body: "x", buttons: buttonsFor("en", ["yes", "no", "cancel", "owner"]) }), (e: unknown) => e instanceof ApiError && /1 to 3 buttons/.test((e as Error).message));
  const closed = createWhatsAppMessaging({ baseUrl: s.url, phoneNumberId: "PN1" }, { clock, window: { lastInboundAt: () => undefined } });
  await assert.rejects(closed.sendInteractive!(CUSTOMER, buttons), /24|window/i);

  // the stand-in itself refuses a body that breaks the limits, in Meta's words (131009)
  const post = (interactive: object) => fetch(`${s.url}/v26.0/PN1/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messaging_product: "whatsapp", to: CUSTOMER, type: "interactive", interactive }) });
  const tooMany = await post({ type: "button", body: { text: "x" }, action: { buttons: Array.from({ length: 4 }, (_, i) => ({ type: "reply", reply: { id: `b${i}`, title: "T" } })) } });
  assert.equal(tooMany.status, 400);
  assert.equal(((await tooMany.json()) as { error: { code: number } }).error.code, 131009);
  const odd = await post({ type: "carousel", body: { text: "x" }, action: {} });
  assert.equal(odd.status, 400);
});

// ---- the agent's turns ---------------------------------------------------------------------------------------------------------------

const lastOf = (w: ReturnType<typeof createWorld>, who = CUSTOMER) => w.messaging.sentTo(who).at(-1)!;
const rowIds = (w: ReturnType<typeof createWorld>, who = CUSTOMER) => (lastOf(w, who).interactive?.list?.rows ?? []).map((r) => r.id);

test("hello shows the services to tap; a service tap shows free times; a time tap holds it and sends the link; one reply for each message", async () => {
  const w = createWorld();
  await w.say("hello");
  assert.equal(lastOf(w).kind, "interactive");
  assert.deepEqual(rowIds(w), ["svc:haircut", "svc:beard-trim", "svc:facial", "svc:hair-colour", "owner"]);
  assert.match(lastOf(w).text, /Welcome to Glow Salon\. Which service would you like\?/);
  await w.tap("svc:haircut");
  const times = rowIds(w);
  assert.ok(times.length >= 3 && times.at(-1) === "owner" && times.slice(0, -1).every((id) => id.startsWith("slot:")), times.join());
  const first = Number(times[0].slice("slot:".length));
  assert.ok(first > w.clock.now(), "a time in the past is never offered");
  await w.tap(times[0]);
  assert.equal(w.calendar.events().filter((e) => e.status === "tentative").length, 1);
  assert.equal(w.calendar.events()[0].start, first);
  assert.match(lastOf(w).text, /rzp\.io/);
  assert.deepEqual((lastOf(w).interactive?.buttons ?? []).map((b) => b.id), ["cancel", "owner"]);
  assert.equal(w.textsTo(CUSTOMER).length, 3, "three taps, three replies");
});

test("a list never offers a time that is taken, a hold included, or one outside the opening hours or off the shop's grid", async () => {
  const w = createWorld();
  await w.say("haircut tomorrow at 6pm", { from: OTHER_CUSTOMER }); // a hold on Wed 4 Nov 6pm
  await w.say("hello");
  await w.tap("svc:haircut");
  const offered = rowIds(w).filter((id) => id.startsWith("slot:")).map((id) => Number(id.slice(5)));
  const held = w.calendar.events()[0];
  assert.ok(offered.length > 0);
  for (const start of offered) {
    assert.ok(start + 45 * 60_000 + 10 * 60_000 <= held.start || start >= held.end + 10 * 60_000, `${new Date(start).toISOString()} clashes with the hold`);
    const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: IST, hour: "2-digit", hour12: false }).format(start));
    assert.ok(hour >= 10 && hour < 20, "inside 10:00 to 20:00");
    assert.equal(((start - zonedToMs({ year: 2026, month: 11, day: 1 }, { hour: 0, minute: 0 }, IST)) / 60_000) % 30, 0, "on the 30-minute grid");
  }
  assert.ok(offered.length <= 9 && new Set(offered).size === offered.length);
});

test("the checked text of a list is the whole message: dates and times are the offered ones, and a record that is wrong would be held", async () => {
  const w = createWorld();
  await w.say("hello");
  await w.tap("svc:haircut");
  const decisions = w.record.entries().filter((e) => e.action === "send_message").at(-1)!.decisions;
  assert.ok(decisions.some((d) => d.ruleId === "message-matches-record" && d.verdict === "allow"));
  assert.equal(w.record.entries().filter((e) => e.action === "send_message").at(-1)!.refs.interactive, "list");
  assert.equal(w.textsTo(w.owner).length, 0, "nothing was held back, so the owner heard nothing");
});

test("an unclear sentence, a bare yes with nothing pending and an unknown service tap each get the services to tap, never silence", async () => {
  const w = createWorld();
  await w.say("asdf qwer zxcv");
  assert.equal(rowIds(w)[0], "svc:haircut");
  await w.say("yes");
  assert.equal(rowIds(w)[0], "svc:haircut");
  await w.say("no");
  assert.equal(rowIds(w)[0], "svc:haircut");
  const before = w.textsTo(CUSTOMER).length;
  await w.say("Haircut", { id: "wamid.forged" }); // an ordinary text message
  assert.equal(w.textsTo(CUSTOMER).length, before + 1);
  // a forged service id is read as the words on the row
  const forged = w.messaging.receive(CUSTOMER, "Haircut", { reply: { id: "svc:teleport", kind: "list" } });
  await w.agent.handle({ kind: "message", message: forged });
  assert.equal(w.textsTo(CUSTOMER).length, before + 2);
  assert.match(w.record.entries().filter((e) => e.action === "receive_message").at(-1)!.refs.step, /rules/);
});

test("a read-back that needs a yes comes with Yes and No buttons, and the buttons work", async () => {
  const w = createWorld();
  await w.say("haircut next Tuesday at 6pm"); // a weekday: read back with the full date
  assert.deepEqual((lastOf(w).interactive?.buttons ?? []).map((b) => b.id), ["yes", "no"]);
  assert.match(lastOf(w).text, /Is that right\?/);
  await w.tap("yes");
  assert.match(lastOf(w).text, /rzp\.io/);
  const v = createWorld();
  await v.say("haircut next Tuesday at 6pm");
  await v.tap("no");
  assert.ok(rowIds(v).length > 1, "No takes the customer back to the list of times");
  assert.equal(v.calendar.events().length, 0);
});

test("Cancel booking asks once with two buttons and cancels nothing; Yes, cancel does what typing cancel does; Keep leaves the booking", async () => {
  const w = createWorld();
  await w.say("hello");
  await w.tap("svc:haircut");
  await w.tap(rowIds(w)[0]);
  w.payments.customerPays(w.linkFor("b-1")!.id);
  await w.deliverPaymentEvents();
  assert.match(lastOf(w).text, /Booked!/);
  assert.deepEqual((lastOf(w).interactive?.buttons ?? []).map((b) => b.id), ["cancel", "owner"]);
  await w.tap("cancel");
  assert.deepEqual((lastOf(w).interactive?.buttons ?? []).map((b) => b.id), ["cancel_yes", "keep"]);
  assert.equal(w.store.bookings.get("b-1")!.state, "confirmed", "nothing is cancelled by the first tap");
  await w.tap("keep");
  assert.equal(w.store.bookings.get("b-1")!.state, "confirmed");
  assert.match(lastOf(w).text, /stays as it is/);
  await w.tap("cancel");
  await w.tap("cancel_yes");
  assert.equal(w.store.bookings.get("b-1")!.state, "cancelled");
  assert.equal(w.calendar.events().length, 0);
  const other = createWorld();
  await other.say("hello");
  const forged = other.messaging.receive(CUSTOMER, "Cancel booking", { reply: { id: "cancel", kind: "button" } });
  await other.agent.handle({ kind: "message", message: forged });
  assert.match(lastOf(other).text, /couldn't find a booking/, "Cancel with nothing to cancel says so, and offers the services");
});

test("Talk to the owner tells the owner, and the customer, and a second tap within the hour tells the owner nothing more", async () => {
  const w = createWorld();
  await w.say("hello");
  await w.tap("owner");
  assert.equal(w.textsTo(w.owner).length, 1);
  assert.match(w.textsTo(w.owner)[0], /Customer \+919811111111 would like to talk to you/);
  assert.match(lastOf(w).text, /told the owner/);
  await w.say("hello");
  await w.tap("owner");
  assert.equal(w.textsTo(w.owner).length, 1, "the owner is not told twice in an hour");
  assert.match(lastOf(w).text, /told the owner/, "the customer is still answered");
  await w.advance(61);
  await w.say("hello");
  await w.tap("owner");
  assert.equal(w.textsTo(w.owner).length, 2);
  assert.equal(w.record.entries().filter((e) => e.action === "ask_owner" && e.outcome === "confirmed").length, 3);
});

test("if the owner cannot be told, the customer is told that and not that the owner will write", async () => {
  const w = createWorld();
  await w.say("hello");
  w.messaging.inject("sendTemplate", "error", { times: 3 }); // the owner's window is closed, so the notice goes as a template
  await w.tap("owner");
  assert.match(lastOf(w).text, /couldn't reach the owner/);
  assert.ok(!/will message you/.test(lastOf(w).text));
  assert.equal(w.record.entries().filter((e) => e.action === "ask_owner").at(-1)!.outcome, "failed");
});

test("where buttons cannot go, the same words go as plain text: no provider support, a refusal, and a closed window", async () => {
  const none = createWorld({ interactive: false });
  await none.say("hello");
  assert.equal(lastOf(none).kind, "text");
  assert.match(lastOf(none).text, /Hello! Welcome to Glow Salon\. We offer: haircut ₹450/, "the full menu, as before buttons existed");

  const refused = createWorld();
  refused.messaging.sendInteractive = async () => { throw new ApiError(400, "Parameter value is not valid"); };
  await refused.say("hello");
  assert.equal(lastOf(refused).kind, "text");
  assert.match(lastOf(refused).text, /We offer: haircut ₹450, beard trim ₹250, facial ₹900, hair colour ₹1,800/, "the plain menu names every service and price, so nothing is lost");

  const lost = createWorld();
  lost.messaging.inject("sendInteractive", "lostReply");
  await lost.say("hello");
  assert.equal(lost.messaging.sentTo(CUSTOMER).length, 1, "a lost reply may have gone out, so it is not sent again as text");
  assert.equal(lost.record.entries().filter((e) => e.action === "send_message").at(-1)!.outcome, "unconfirmed");

  // a payment that comes after the customer's 24 hours: "Booked!" would carry buttons, but outside the window only a template can go
  const late = createWorld();
  await late.say("haircut tomorrow at 6pm");
  late.payments.customerPays(late.linkFor("b-1")!.id); // paid in time, but the notice does not arrive until the hold has ended
  await late.advance(25 * 60); // the hold ends, the payments record is read, and by then the customer's window has closed
  assert.equal(lastOf(late).kind, "template", "outside the window a message goes as its template, with no buttons");
  assert.ok(lastOf(late).interactive === undefined && /Booked!/.test(lastOf(late).text));
});

test("a tapped time that has since been taken is refused like a typed one, and the customer gets another list", async () => {
  const w = createWorld();
  await w.say("hello");
  await w.tap("svc:haircut");
  const row = rowIds(w)[0];
  const start = Number(row.slice(5));
  w.calendar.addForeignEvent(start, start + 45 * 60_000, "someone else"); // the owner's own entry, made after the list was shown
  await w.tap(row);
  assert.match(lastOf(w).text, /not available/);
  assert.ok(rowIds(w).length > 1 && !rowIds(w).includes(row), "the list now leaves the taken time out");
  assert.equal(w.payments.links().length, 0, "no link for a time that is not ours");
});
