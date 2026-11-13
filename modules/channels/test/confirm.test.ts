// Item 11h (decision 45): what a customer without WhatsApp keeps. The calendar file (RFC 5545 as phones read it, and never the page's bearer address), the refund
// line on the confirmation page in four languages, and the keyboard-mic hint on the owner's talk box and the Orders address box, in four languages.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bookingIcs, fold, icsText } from "../ics.ts";
import { statusPage } from "../page.ts";
import { CONFIRM, MIC_HINT } from "../words-confirm.ts";
import { talkBox } from "../../assistant/app/talk.ts";
import { LANGUAGES } from "../../language/languages.ts";
import type { BookingView, Offer } from "../backend.ts";

const offer: Offer = { shop: { name: "Glow, Salon", address: "MG Road; Kochi", timezone: "Asia/Kolkata", languages: ["en", "hi", "ml", "kn"], deposit: { amountInr: 200, holdMinutes: 60 }, cancellation: { windowHours: 24 }, payment: { kind: "upi", payee: "Glow" }, paused: false }, services: [] };
const service = { id: "haircut", names: { en: "Haircut", hi: "हेयरकट", ml: "ഹെയർകട്ട്", kn: "ಹೇರ್ ಕಟ್" }, priceInr: 450, durationMinutes: 45 };
const view = (more: Partial<Extract<BookingView, { ref: string }>> = {}): BookingView => ({ status: "booked", ref: "b-7", channel: "web", service, startMs: Date.UTC(2026, 10, 19, 5, 0), endMs: Date.UTC(2026, 10, 19, 5, 45), depositInr: 200, canCancel: true, canSayPaid: false, messages: [], ...more });

test("the calendar file: one event in UTC with a stable UID, escaped text, CRLF and folded lines; held is tentative, cancelled is cancelled; no page address", () => {
  const ics = bookingIcs({ view: view(), shop: offer.shop, language: "en", handleHash: "ab".repeat(32), host: "pages.example", nowMs: Date.UTC(2026, 10, 16, 3, 30) })!;
  assert.ok(ics.endsWith("\r\n") && !/[^\r]\n/u.test(ics), "CRLF line endings");
  assert.match(ics, /\r\nUID:b-7\.abababababababab@pages\.example\r\n/u);
  assert.match(ics, /\r\nDTSTART:20261119T050000Z\r\nDTEND:20261119T054500Z\r\n/u);
  assert.match(ics, /\r\nSUMMARY:Haircut\\, Glow\\, Salon\r\n/u, "commas escaped");
  assert.ok(ics.includes("\r\nLOCATION:MG Road\\; Kochi\r\n"), "semicolons escaped");
  assert.match(ics, /\r\nSTATUS:CONFIRMED\r\n/u);
  assert.ok(!/https?:\/\//u.test(ics), "no address in it: the page's link is the booking's bearer secret");
  assert.match(bookingIcs({ view: view({ status: "held" }), shop: offer.shop, language: "en", handleHash: "ab".repeat(32), host: "h", nowMs: 0 })!, /STATUS:TENTATIVE/u);
  assert.match(bookingIcs({ view: view({ status: "cancelled" }), shop: offer.shop, language: "en", handleHash: "ab".repeat(32), host: "h", nowMs: 0 })!, /STATUS:CANCELLED/u);
  assert.equal(bookingIcs({ view: { status: "pending" }, shop: offer.shop, language: "en", handleHash: "ab".repeat(32), host: "h", nowMs: 0 }), undefined);
  assert.match(bookingIcs({ view: view(), shop: offer.shop, language: "ml", handleHash: "ab".repeat(32), host: "h", nowMs: 0 })!, /SUMMARY:ഹെയർകട്ട്/u);
  const long = fold(`DESCRIPTION:${"ಬುಕಿಂಗ್ ".repeat(20)}`);
  assert.ok(long.split("\r\n").every((l) => Buffer.byteLength(l) <= 75), "folded at 75 octets, never inside a character");
  assert.equal(icsText("a\\b;c,d\ne"), String.raw`a\\b\;c\,d\ne`);
});

test("the confirmation page says where a refund stands, from the record, in four languages; and offers the calendar file", () => {
  for (const language of LANGUAGES) {
    for (const state of ["asked", "owed", "sent", "kept"] as const) {
      const html = statusPage({ shop: { name: "glow", publicUrl: "https://pages.example/glow" }, offer, language, handle: "h".repeat(32), view: view({ status: "cancelled", refund: { state, amountInr: 200 } }), ics: "https://pages.example/glow/b/x/booking.ics" });
      assert.ok(html.includes(CONFIRM[language].refund[state]("₹200")), `${language} ${state}`);
      assert.ok(html.includes(CONFIRM[language].ics));
    }
  }
  for (const words of Object.values(CONFIRM)) for (const f of Object.values(words.refund)) assert.doesNotMatch(f("₹200"), /\b(safe|guaranteed|proves|certified|100%|bot)\b/iu);
});

test("the keyboard-mic hint, in four languages, on the owner's talk box", () => {
  assert.deepEqual(Object.keys(MIC_HINT).sort(), [...LANGUAGES].sort());
  for (const language of LANGUAGES) {
    const box = talkBox({ base: "https://pages.example/glow/owner", language, lines: [], assistantName: "Glow's assistant" });
    assert.ok(box.includes(MIC_HINT[language].replace(/'/gu, "&#39;")), language);
    assert.match(box, /aria-describedby="talk-mic"/u);
  }
  assert.match(MIC_HINT.en, /mic on your phone's keyboard/u);
  assert.equal(new Set(Object.values(MIC_HINT)).size, 4, "each language has its own words (machine-written: for native review)");
});
