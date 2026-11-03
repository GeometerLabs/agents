import { test } from "node:test";
import assert from "node:assert/strict";
import { checkMessage } from "../src/language/check.ts";
import { TEMPLATES, render } from "../src/language/templates.ts";
import type { MessageFacts, TemplateId } from "../src/language/templates.ts";
import { zonedToMs } from "../src/time.ts";
import { LANGUAGES } from "../src/settings.ts";

const TZ = "Asia/Kolkata";
const SLOT = zonedToMs({ year: 2026, month: 11, day: 10 }, { hour: 18, minute: 0 }, TZ); // Tue 10 Nov, 6:00 pm

function facts(language: "hi" | "en", change: Partial<MessageFacts> = {}): MessageFacts {
  return {
    language, timeZone: TZ, businessName: "Glow Salon",
    services: [{ name: language === "hi" ? "हेयरकट" : "haircut", priceInr: 450 }], // as in a real message: only this booking's own service
    serviceName: language === "hi" ? "हेयरकट" : "haircut",
    priceInr: 450, depositInr: 200, refundInr: 200, slotMs: SLOT,
    link: "https://rzp.io/l/plink3", holdMinutes: 15, windowHours: 24, bookingRef: "b-3", customerPhone: "+919811111111",
    ...change,
  };
}

const ids = Object.keys(TEMPLATES.en) as TemplateId[];

/** The facts a message is checked against: only the menu may state every service's price. */
function factsFor(language: "hi" | "en", id: TemplateId): MessageFacts {
  return id === "menu"
    ? facts(language, { services: [{ name: language === "hi" ? "हेयरकट" : "haircut", priceInr: 450 }, { name: language === "hi" ? "फेशियल" : "facial", priceInr: 900 }] })
    : facts(language);
}

test("every template exists in every language", () => {
  for (const language of LANGUAGES) assert.deepEqual(Object.keys(TEMPLATES[language]).sort(), [...ids].sort(), language);
});

test("drift check: every template, in both languages, passes the outgoing check against the record it was rendered from", () => {
  for (const language of LANGUAGES) {
    for (const id of ids) {
      const text = render(id, factsFor(language, id));
      const result = checkMessage(text, factsFor(language, id));
      assert.deepEqual(result.problems, [], `${language}/${id}: ${text}`);
    }
  }
});

test("the product's own examples render exactly as written", () => {
  assert.equal(render("quote_and_link", facts("en")), "Our haircut is ₹450. Tue 10 Nov, 6:00 pm is free. Pay a ₹200 deposit to confirm: https://rzp.io/l/plink3 (I'll hold the slot for 15 minutes.)");
  assert.equal(render("quote_and_link", facts("hi")), "हमारा हेयरकट ₹450 है। मंगलवार, 10 नवंबर, शाम 6:00 बजे खाली है। ₹200 जमा करके पक्का करें: https://rzp.io/l/plink3 (स्लॉट 15 मिनट के लिए रोका गया है।)");
});

// ---- mutations: change one value in a message that was fine, and the check must catch it ----

const mutations: { name: string; apply: (text: string) => string; skipMenu?: boolean }[] = [
  { name: "an amount is replaced by ANOTHER service's price", apply: (t) => t.replace("₹450", "₹900"), skipMenu: true }, // the menu legitimately lists both
  { name: "an amount is changed", apply: (t) => t.replace(/₹(\d+)/u, (_, n) => `₹${Number(n) + 50}`) },
  { name: "an amount is replaced by the customer's offer", apply: (t) => t.replace(/₹450/u, "₹300") },
  { name: "the time's am/pm or period is flipped", apply: (t) => t.replace("6:00 pm", "6:00 am").replace("शाम 6:00", "सुबह 6:00") },
  { name: "the minutes of the time are changed", apply: (t) => t.replace("6:00 pm", "6:30 pm").replace("6:00 बजे", "6:30 बजे") },
  { name: "the day of the month is changed", apply: (t) => t.replace("Tue 10 Nov", "Tue 11 Nov").replace("मंगलवार, 10 नवंबर", "मंगलवार, 11 नवंबर") },
  { name: "the weekday does not match the date", apply: (t) => t.replace("Tue 10 Nov", "Wed 10 Nov").replace("मंगलवार, 10", "बुधवार, 10") },
  { name: "the month is changed", apply: (t) => t.replace("10 Nov", "10 Dec").replace("10 नवंबर", "10 दिसंबर") },
  { name: "the payment link is swapped", apply: (t) => t.replace("https://rzp.io/l/plink3", "https://rzp.io/l/plink9") },
  { name: "an unexplained number is added", apply: (t) => `${t} 7` },
  { name: "the hold time is changed", apply: (t) => t.replace("15 minutes", "30 minutes").replace("15 मिनट", "30 मिनट") },
];

test("mutation check: changing any one value in any rendered template makes the check block it", () => {
  let tried = 0;
  for (const language of LANGUAGES) {
    for (const id of ids) {
      const original = render(id, factsFor(language, id));
      for (const m of mutations) {
        if (m.skipMenu && id === "menu") continue;
        const mutated = m.apply(original);
        if (mutated === original) continue; // this template has no such value
        tried++;
        assert.equal(checkMessage(mutated, factsFor(language, id)).ok, false, `${language}/${id}: "${m.name}" was not caught in: ${mutated}`);
      }
    }
  }
  assert.ok(tried > 300, `only ${tried} mutations were tried; the check would be vacuous`);
});

// ---- the specific failures the product names ----

test("a message that quotes the customer's price instead of the list price is blocked, in plain words", () => {
  const r = checkMessage("Sure, a haircut is ₹300.", facts("en"));
  assert.equal(r.ok, false);
  assert.match(r.problems[0], /The message says ₹300, but the record only has ₹200, ₹450\./);
});

test("another service's price is not this booking's price: a haircut at ₹900 is blocked, the facial's ₹900 is fine on the menu", () => {
  assert.equal(checkMessage("Our haircut is ₹900.", facts("en")).ok, false);
  assert.equal(checkMessage(render("menu", factsFor("en", "menu")), factsFor("en", "menu")).ok, true);
});

test("known limit: values are compared as a set, so a deposit and a price swapped between themselves still pass", () => {
  assert.equal(checkMessage("Pay a ₹450 deposit to confirm.", facts("en")).ok, true); // both ₹450 and ₹200 belong to this booking; see Deferred.md
});

test("a wrong time of day is blocked: सुबह 6:00 बजे when the record says 6:00 in the evening", () => {
  const r = checkMessage("आपकी बुकिंग मंगलवार, 10 नवंबर, सुबह 6:00 बजे है।", facts("hi"));
  assert.equal(r.ok, false);
  assert.match(r.problems.join(" "), /सुबह 6:00 बजे.*शाम 6:00 बजे/);
});

test("a date whose weekday and day disagree is blocked even though both parts exist elsewhere", () => {
  assert.equal(checkMessage("See you Wed 10 Nov at 6:00 pm", facts("en")).ok, false);
  assert.equal(checkMessage("See you Tue 10 Nov at 6:00 pm", facts("en")).ok, true);
});

test("Devanagari digits and Indian grouping read as the same numbers", () => {
  assert.equal(checkMessage("हेयरकट ₹४५०", facts("hi")).ok, true);
  assert.equal(checkMessage("हेयरकट ₹४००", facts("hi")).ok, false);
  const big = facts("en", { services: [{ name: "package", priceInr: 12500 }], priceInr: 12500 });
  assert.equal(checkMessage("The package is ₹12,500.", big).ok, true);
  assert.equal(checkMessage("The package is ₹12,000.", big).ok, false);
});

test("24-hour times, Rs. amounts and spelled-out quantities cannot be explained, so they are blocked", () => {
  assert.equal(checkMessage("See you at 18:00", facts("en")).ok, false);
  assert.equal(checkMessage("The haircut is Rs 450", facts("en")).ok, false); // an unexplained number: only ₹ amounts are understood
  assert.equal(checkMessage("The haircut is four hundred rupees", facts("en")).ok, false);
});

test("a link that is not the record's link is blocked, a bare domain link too", () => {
  assert.equal(checkMessage("Pay here: rzp.io/l/evil", facts("en")).ok, false);
  assert.equal(checkMessage("Pay here: https://rzp.io/l/plink3.", facts("en")).ok, true);
});

test("names and references the record holds may repeat, others may not", () => {
  const f = facts("en", { businessName: "Studio 54" });
  assert.equal(checkMessage("Welcome to Studio 54!", f).ok, true);
  assert.equal(checkMessage("Booking b-3 is yours, +919811111111.", f).ok, true);
  assert.equal(checkMessage("Booking b-4 is yours.", f).ok, false);
});

test("a template that needs something the record does not have refuses to write", () => {
  assert.throws(() => render("quote_and_link", facts("en", { link: undefined })), /needs "link" from the record/);
  assert.throws(() => render("booked", facts("hi", { slotMs: undefined })), /needs "slotMs"/);
});

test("no slot in the record means no date or time may appear", () => {
  const f = facts("en", { slotMs: undefined });
  assert.equal(checkMessage("Welcome! Tell me the day and time you want.", f).ok, true);
  assert.match(checkMessage("How about Tue 10 Nov?", f).problems[0], /no date for this conversation/);
});

test("a refused haggle states the price once, not twice (the mom test)", async () => {
  const { createWorld, CUSTOMER } = await import("../src/harness.ts");
  for (const [language, ask] of [["hi", "कल शाम 6 बजे हेयरकट, 300 में हो जाएगा?"], ["en", "Can I get a haircut tomorrow at 6pm for 300?"]] as const) {
    const world = createWorld();
    await world.say(ask);
    const reply = world.lastTextTo(CUSTOMER);
    assert.equal((reply.match(/₹450/gu) ?? []).length, 1, `${language}: ${reply}`);
    assert.ok(reply.includes("₹200"), `${language}: the deposit is still quoted: ${reply}`);
  }
});
