// Webhook signatures and the readers for Razorpay and WhatsApp payloads, tested on the providers' own sample payloads.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRazorpayEvent, parseWhatsAppWebhook, signMeta, signRazorpay, toE164, verifyMetaSignature, verifyRazorpaySignature } from "../src/adapters/live/webhooks.ts";
import { fixture, fixtureText } from "./helpers/scripted-server.ts";

const body = (s: string) => Buffer.from(s, "utf8");

test("signatures: HMAC-SHA256 in hex over the raw body (known vector), Meta's with the sha256= prefix", () => {
  // the standard example from the HMAC literature: key "key", message "The quick brown fox jumps over the lazy dog"
  const raw = body("The quick brown fox jumps over the lazy dog");
  const expected = "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8";
  assert.equal(signRazorpay(raw, "key"), expected);
  assert.equal(verifyRazorpaySignature(raw, expected, "key"), true);
  assert.equal(verifyRazorpaySignature(raw, expected.toUpperCase(), "key"), true);
  assert.equal(signMeta(raw, "key"), `sha256=${expected}`);
  assert.equal(verifyMetaSignature(raw, `sha256=${expected}`, "key"), true);
});

test("signatures: a wrong secret, a changed body, a missing, short, long, non-hex or unprefixed header, and an empty secret all fail", () => {
  const raw = body(fixtureText("razorpay-webhook-payment_link.paid.json"));
  const good = signRazorpay(raw, "whsec");
  assert.equal(verifyRazorpaySignature(raw, good, "whsec"), true);
  assert.equal(verifyRazorpaySignature(raw, good, "other"), false);
  assert.equal(verifyRazorpaySignature(body(raw.toString() + " "), good, "whsec"), false); // one more space is another body: sign the raw bytes
  assert.equal(verifyRazorpaySignature(raw, undefined, "whsec"), false);
  assert.equal(verifyRazorpaySignature(raw, "", "whsec"), false);
  assert.equal(verifyRazorpaySignature(raw, good.slice(1), "whsec"), false);
  assert.equal(verifyRazorpaySignature(raw, good + "00", "whsec"), false);
  assert.equal(verifyRazorpaySignature(raw, "z".repeat(64), "whsec"), false);
  assert.equal(verifyRazorpaySignature(raw, signRazorpay(raw, ""), ""), false);
  const meta = signMeta(raw, "appsecret");
  assert.equal(verifyMetaSignature(raw, meta, "appsecret"), true);
  assert.equal(verifyMetaSignature(raw, meta.replace("sha256=", ""), "appsecret"), false);
  assert.equal(verifyMetaSignature(raw, meta.replace("sha256=", "sha1="), "appsecret"), false);
  assert.equal(verifyMetaSignature(raw, meta, "wrong"), false);
  assert.equal(verifyMetaSignature(raw, undefined, "appsecret"), false);
  assert.equal(verifyMetaSignature(raw, signMeta(raw, ""), ""), false);
});

test("razorpay: payment_link.paid, payment.captured and refund.processed become events; the id is the header, or a digest a retry repeats", () => {
  const paid = parseRazorpayEvent(fixture("razorpay-webhook-payment_link.paid.json"), "evt_header_1");
  assert.deepEqual(paid, { id: "evt_header_1", event: "payment_link.paid", created_at: 1749618314, payload: { payment_link: { id: "plink_QflcnnZqCekuvL", reference_id: "23" }, payment: { id: "pay_Qfldmt5StKZFCB", link_id: "plink_QflcnnZqCekuvL" } } });
  const captured = parseRazorpayEvent(fixture("razorpay-webhook-payment.captured.json"), "evt_header_2");
  assert.deepEqual(captured, { id: "evt_header_2", event: "payment.captured", created_at: 1567675356, payload: { payment: { id: "pay_DESyzxuld02Zul" } } });
  assert.equal(captured?.payload.payment?.link_id, undefined); // the real body does not name the link
  const refund = parseRazorpayEvent(fixture("razorpay-webhook-refund.processed.json"), "evt_header_3");
  assert.deepEqual(refund, { id: "evt_header_3", event: "refund.processed", created_at: 1597734071, payload: { refund: { id: "rfnd_FS8TWyPrCsa0OB", payment_id: "pay_FPoJKWQQ8lK13n" } } });
  const a = parseRazorpayEvent(fixture("razorpay-webhook-payment.captured.json"));
  const b = parseRazorpayEvent(fixture("razorpay-webhook-payment.captured.json"));
  assert.match(a!.id, /^evt_[0-9a-f]{32}$/);
  assert.equal(a!.id, b!.id);
  assert.notEqual(a!.id, parseRazorpayEvent(fixture("razorpay-webhook-refund.processed.json"))!.id);
});

test("razorpay: events the agent does not use, and things that are not events, give null", () => {
  assert.equal(parseRazorpayEvent(fixture("razorpay-webhook-payment_link.expired.json"), "e"), null);
  for (const junk of [null, 5, "x", [], {}, { event: "payment.captured" }, { event: "payment.captured", payload: {} }, { event: "refund.processed", payload: { refund: { entity: { id: "r" } } } }, { event: "payment_link.paid", payload: { payment_link: { entity: {} } } }]) {
    assert.equal(parseRazorpayEvent(junk, "e"), null, JSON.stringify(junk));
  }
});

test("whatsapp: a text message, with the number given back its plus and the time in milliseconds", () => {
  assert.deepEqual(parseWhatsAppWebhook(fixture("whatsapp-webhook-text.json")), [
    { id: "wamid.HBgLMTY1MDM4Nzk0MzkVAgASGBQzQTRBNjU5OUFFRTAzODEwMTQ0RgA=", from: "+16505551234", text: "Does it come in another color?", timestamp: 1749416383000 },
  ]);
});

test("whatsapp: a tapped button, a list row and a template button count as what the customer said; statuses and other types give nothing", () => {
  assert.deepEqual(parseWhatsAppWebhook(fixture("whatsapp-webhook-button-reply.json")).map((m) => m.text), ["Cancel"]);
  assert.deepEqual(parseWhatsAppWebhook(fixture("whatsapp-webhook-list-reply.json")).map((m) => m.text), ["Priority Mail Express"]);
  assert.deepEqual(parseWhatsAppWebhook(fixture("whatsapp-webhook-template-button.json")).map((m) => [m.from, m.text]), [["+16505551234", "Unsubscribe"]]);
  assert.deepEqual(parseWhatsAppWebhook(fixture("whatsapp-webhook-status-delivered.json")), []);
  const image = fixture("whatsapp-webhook-text.json");
  image.entry[0].changes[0].value.messages[0] = { from: "16505551234", id: "wamid.x", timestamp: "1", type: "image", image: { id: "1" } };
  assert.deepEqual(parseWhatsAppWebhook(image), []);
  for (const junk of [null, 5, [], {}, { entry: "x" }, { entry: [{ changes: [{ field: "other", value: {} }] }] }]) assert.deepEqual(parseWhatsAppWebhook(junk), []);
});

test("whatsapp: a sender that is not a phone number, a message with no id, and several messages in one webhook", () => {
  const hook = fixture("whatsapp-webhook-text.json");
  const base = hook.entry[0].changes[0].value.messages[0];
  hook.entry[0].changes[0].value.messages = [
    { ...base, id: "wamid.a", from: "919811111111", timestamp: "10" },
    { ...base, id: "wamid.b", from: "not-a-number" },
    { ...base, id: undefined },
    { ...base, id: "wamid.d", from: "+919822222222", text: { body: "STOP" } },
  ];
  assert.deepEqual(parseWhatsAppWebhook(hook).map((m) => [m.id, m.from, m.text, m.timestamp]), [
    ["wamid.a", "+919811111111", "Does it come in another color?", 10000],
    ["wamid.d", "+919822222222", "STOP", 1749416383000],
  ]);
  assert.equal(toE164("919811111111"), "+919811111111");
  assert.equal(toE164(5), undefined);
});
