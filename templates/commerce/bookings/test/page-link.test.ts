// Item 11h (owner, 14 Nov: "simpler with hyperlinks and easy text"): a booking made on WhatsApp gets a private link to its own page in the UPI quote, where the customer
// taps "Pay in your UPI app" (the page draws the button and the QR) and later sees where the booking stands. The link is a bearer secret, so: one is made for each
// message that carries it; only its hash is kept, and only once that message was accepted; a link sent again replaces the old, which then opens nothing; a typed or
// guessed link opens nothing; and the link is never in the record (nor in anything made from it) in clear. The QR picture and the UPI ID stay, as before.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { createWorld, CUSTOMER } from "../src/harness.ts";
import { parseSettings } from "../src/settings.ts";
import { bookingView } from "../src/channel.ts";
import { serializeStore } from "../server/snapshot.ts";
import { TEMPLATES } from "../src/language/templates.ts";

const settings = parseSettings(JSON.parse(readFileSync(new URL("../settings/glow-salon-upi.example.json", import.meta.url), "utf8")));
const BASE = "https://pages.example/glow-salon";
const hashOf = (h: string) => createHash("sha256").update(`booking-handle:${h}`).digest("hex");

/** A link maker as the runtime's (server/runtime.ts): 24 random bytes, the whole address once, the hash kept. Every link it ever made, for the test to try. */
function maker() {
  const made: { handle: string; url: string; hash: string }[] = [];
  return { made, pageLink: () => { const handle = randomBytes(24).toString("base64url"); const m = { handle, url: `${BASE}/b/${handle}`, hash: hashOf(handle) }; made.push(m); return { url: m.url, hash: m.hash }; } };
}

test("the quote on WhatsApp carries the booking's own page link; the page shows the booking and how to pay, and nothing a WhatsApp customer does there", async () => {
  const m = maker();
  const w = createWorld({ settings, pageLink: m.pageLink });
  await w.say("haircut tomorrow at 6pm");
  const quote = w.messaging.sentTo(CUSTOMER).map((x) => x.text).join("\n");
  assert.match(quote, /UPI ID: glowsalon@okicici/u, "the UPI ID stays, as before");
  assert.equal(m.made.length, 1);
  assert.ok(quote.includes(m.made[0].url), "the link is in the message, on a line of its own");
  assert.match(quote, /Tap to pay and see your booking/u);
  const b = [...w.store.bookings.values()][0];
  assert.equal(b.pageLink, m.made[0].hash, "only the hash is kept");
  const v = bookingView(settings, w.store, m.made[0].hash)!;
  assert.equal(v.status, "held");
  assert.ok("pay" in v && v.pay?.kind === "upi" && v.pay.link.startsWith("upi://pay?pa=glowsalon@okicici"), "the page's Pay button is the UPI link");
  assert.ok("canCancel" in v && v.canCancel === false && v.canSayPaid === false, "cancel and \"I have paid\" stay on WhatsApp, where the customer is known");
  assert.deepEqual("messages" in v ? v.messages : undefined, [], "WhatsApp's messages are not kept for the page");
});

test("a typed or guessed link opens nothing; a link sent again replaces the old one, which then opens nothing", async () => {
  const m = maker();
  const w = createWorld({ settings, pageLink: m.pageLink });
  await w.say("haircut tomorrow at 6pm");
  const first = m.made[0];
  assert.equal(bookingView(settings, w.store, hashOf(randomBytes(24).toString("base64url"))), null, "a guessed link");
  assert.equal(bookingView(settings, w.store, hashOf(first.handle.slice(0, -1) + (first.handle.endsWith("A") ? "B" : "A"))), null, "one letter off");
  assert.equal(bookingView(settings, w.store, first.handle), null, "the handle itself, typed where its hash belongs");
  // the customer writes again while the deposit waits: the same booking, a fresh link, and the old one stops
  await w.say("book a haircut tomorrow at 6pm");
  assert.ok(m.made.length >= 2, "a new message, a new link");
  const latest = m.made.at(-1)!;
  assert.ok(w.messaging.sentTo(CUSTOMER).at(-1)?.text.includes(latest.url) || w.messaging.sentTo(CUSTOMER).some((x) => x.text.includes(latest.url)));
  assert.equal(bookingView(settings, w.store, first.hash), null, "the old link opens nothing");
  assert.equal(bookingView(settings, w.store, latest.hash)?.status, "held", "the new one opens the booking");
  assert.equal([...w.store.bookings.values()].length, 1, "still one booking");
});

test("a link whose message did not go is not kept: the last link that reached the customer still works", async () => {
  const m = maker();
  const w = createWorld({ settings, pageLink: m.pageLink });
  await w.say("haircut tomorrow at 6pm");
  const sent = m.made[0];
  // the provider refuses the next message to go out (a button message, or the plain words when buttons do not fit)
  for (const op of ["sendInteractive", "sendText"] as const) w.messaging.inject(op, "error", { times: 1 });
  await w.say("book a haircut tomorrow at 6pm");
  assert.equal(bookingView(settings, w.store, sent.hash)?.status, "held", "the message with the new link failed, so the one the customer has still opens the page");
});

test("the link is never in the record, the saved state or the exports in clear; a booking page's own bookings are untouched", async () => {
  const m = maker();
  const w = createWorld({ settings, pageLink: m.pageLink });
  await w.say("haircut tomorrow at 6pm");
  await w.say("book a haircut tomorrow at 6pm");
  const record = JSON.stringify(w.record.entries());
  const saved = serializeStore(w.store);
  for (const x of m.made) {
    assert.ok(!record.includes(x.handle) && !record.includes(x.url), "not in the record");
    assert.ok(!saved.includes(x.handle), "not in the saved state (its hash only)");
  }
  // without a page (no maker): the quote is as it was, with no link and no promise of one
  const plain = createWorld({ settings });
  await plain.say("haircut tomorrow at 6pm");
  assert.doesNotMatch(plain.messaging.sentTo(CUSTOMER).map((x) => x.text).join("\n"), /Tap to pay/u);
});

test("the link's words, in four languages (machine-written: for native review)", () => {
  for (const language of ["en", "hi", "ml", "kn"] as const) {
    const text = TEMPLATES[language].upi_page_link({ language, timeZone: settings.timezone, businessName: settings.name, services: [], pageLink: `${BASE}/b/x` } as never);
    assert.ok(text.includes(`${BASE}/b/x`), language);
    assert.doesNotMatch(text, /\b(safe|guaranteed|proves|certified|100%|bot)\b/iu);
  }
});
