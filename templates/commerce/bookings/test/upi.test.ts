// UPI, marked paid by the owner (B33), on the paths production uses: a screenshot through the WhatsApp webhook and the runtime's event check, a restart that keeps
// the ledger (a live code, the marks and a refund owed), and the unfinished work read from the record as the deployer exports it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createWorld, CUSTOMER } from "../src/harness.ts";
import { parseSettings } from "../src/settings.ts";
import { parseStore, serializeStore } from "../server/snapshot.ts";
import { checkEvents } from "../../../../modules/runtime/events.ts";
import { parseWhatsAppWebhook } from "../../../../modules/messaging/webhooks.ts";
import { UPI_ACTIONS, upiObligations } from "../../../../modules/payments/upi/obligations.ts";
import { DEFAULT_OPTIONS, obligations } from "../../../../modules/unfinished/index.ts";
import { notTestedFor } from "../report/data.ts";
import { STRINGS } from "../report/strings.ts";

const settings = parseSettings(JSON.parse(readFileSync(new URL("../settings/glow-salon-upi.example.json", import.meta.url), "utf8")));

test("a screenshot comes through the webhook and the runtime's event check as a picture, and on a UPI shop asks the owner to look", async () => {
  const w = createWorld({ settings });
  await w.say("haircut tomorrow at 6pm");
  const body = { object: "whatsapp_business_account", entry: [{ id: "1", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: "1" }, messages: [{ from: CUSTOMER.replace("+", ""), id: "wamid.pic", timestamp: "1793750400", type: "image", image: { id: "media-1", caption: "paid", mime_type: "image/jpeg" } }] } }] }] };
  const [message] = parseWhatsAppWebhook(body);
  const checked = checkEvents({ events: [{ kind: "message", message }] });
  assert.ok(checked.ok, JSON.stringify(checked));
  const event = checked.ok ? checked.events[0] : undefined;
  assert.ok(event?.kind === "message" && event.message.image === true && event.message.text === "", "only the fact of the picture is carried");
  assert.equal(JSON.stringify(event).includes("media-1"), false, "no media id reaches the runtime");
  w.messaging.receive(CUSTOMER, ""); // the customer's window, as the provider would see it
  await w.agent.handle(event as never);
  assert.equal(w.record.entries().filter((e) => e.action === UPI_ACTIONS.claim && e.refs.via === "screenshot").length, 1);
  assert.equal(w.record.entries().filter((e) => e.action === UPI_ACTIONS.marked).length, 0, "a screenshot marks nothing paid");
  assert.equal(checkEvents({ events: [{ kind: "message", message: { ...message, image: "yes" } }] }).ok, false);
  assert.equal(checkEvents({ events: [{ kind: "message", message: { ...message, text: "hi" } }] }).ok, false, "a picture carries no words");
});

test("\"I paid\" in words asks the owner to look; \"I have not paid yet\" does not", async () => {
  const w = createWorld({ settings });
  await w.say("haircut tomorrow at 6pm");
  await w.say("I have not paid yet");
  assert.equal(w.record.entries().filter((e) => e.action === UPI_ACTIONS.claim).length, 0);
  await w.say("I have paid");
  assert.equal(w.record.entries().filter((e) => e.action === UPI_ACTIONS.claim && e.refs.via === "words").length, 1);
});

test("a go-live certificate of a UPI shop says that automatic payment checking does not apply, in the shop's words", () => {
  const ids = notTestedFor(settings);
  assert.ok(ids.includes("upi-not-automatic") && ids.includes("real-upi") && !ids.includes("real-razorpay") && !ids.includes("payments-outside-razorpay"));
  for (const language of ["en", "hi", "ml", "kn"] as const) assert.ok(STRINGS[language].notTested["upi-not-automatic"].length > 0);
  assert.match(STRINGS.en.notTested["upi-not-automatic"], /automatic payment checking/);
  assert.ok(!notTestedFor(parseSettings(JSON.parse(readFileSync(new URL("../settings/glow-salon.example.json", import.meta.url), "utf8")))).includes("upi-not-automatic"), "a Razorpay shop's list is as it was");
});

test("a restart keeps the ledger: the live code, the marks and a refund owed come back byte for byte, and the owner's next mark still counts once", async () => {
  const w = createWorld({ settings });
  await w.say("haircut tomorrow at 6pm");
  await w.ownerMarksReceived("b-1", { amountInr: 150 });
  await w.say("I want a facial tomorrow at 11am", { from: "+919822222222" });
  await w.ownerMarksReceived("b-2", { amountInr: 250 }); // more than the deposit: booked, and ₹50 owed back
  const json = serializeStore(w.store);
  assert.ok("upi" in JSON.parse(json), "the ledger is saved");
  const back = parseStore(json);
  assert.deepEqual(back.upi, w.store.upi);
  assert.equal(serializeStore(back), json, "read back and written again: the same bytes");
  assert.ok(back.upi!.requests[0].code && back.upi!.refunds.length === 1 && back.upi!.refunds[0].state === "owed");
  const bare = parseStore(serializeStore(createWorld().store));
  assert.equal(bare.upi, undefined, "a Razorpay shop's snapshot has no ledger, as before");
});

test("the unfinished work is read from the record as the deployer exports it (the customer's number hashed): a claim not confirmed, and a refund owed", async () => {
  const w = createWorld({ settings });
  await w.say("haircut tomorrow at 6pm");
  await w.say("", { image: true });
  await w.say("I want a facial tomorrow at 11am", { from: "+919822222222" });
  await w.ownerMarksReceived("b-2");
  await w.say("cancel", { from: "+919822222222" });
  w.clock.advanceMinutes(15);
  // what bundle/backup/export.ts writes: every entry, with its refs, and the conversation turned into a fingerprint
  const exported = JSON.parse(JSON.stringify(w.record.entries().map((e) => ({ ...e, conversation: "c-aaaaaaaaaaaa" }))));
  const found = obligations.detect({ template: "bookings", entries: exported, cases: JSON.parse(JSON.stringify([...w.store.bookings.values()])), nowMs: w.clock.now(), options: DEFAULT_OPTIONS }).found;
  assert.deepEqual(found.filter((o) => o.kind.startsWith("upi_")).map((o) => [o.kind, o.caseId, o.facts.amountInr]), [["upi_payment_unconfirmed", "b-1", 200], ["upi_refund_owed", "b-2", 200]]);
  assert.equal(found.filter((o) => o.kind === "refund_failed").length, 0, "nothing is listed twice");
  assert.equal(upiObligations(exported).length, 2);
});
