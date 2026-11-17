// The five checks a talk reply passes before anything is sent (modules/assistant/talk-check.ts): sources exist and are in scope; numbers, dates and percentages only from the
// sentence's own sources; claims and commitments need a note for everyone or a setting that says the same; completion words are refused; only the shop's own link and number,
// the length cap and the speaker's language.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkTalk, claimKindsOf } from "../talk-check.ts";
import type { CheckInput } from "../talk-check.ts";
import type { TalkSource } from "../talk-types.ts";
import { formatSlot } from "../../language/format.ts";

const TZ = "Asia/Kolkata";
const FREE = Date.UTC(2026, 10, 17, 10, 30);
const scope: TalkSource[] = [
  { id: "n-1", kind: "note", text: "Haircuts are 10% off on Tuesdays." },
  { id: "s:svc", kind: "setting", text: "Haircut: ₹300, 30 minutes.", amountsInr: [300], literals: ["Haircut"] },
  { id: "s:policy", kind: "setting", text: "The deposit is refundable if you cancel 24 hours before." },
  { id: "r:free", kind: "record", text: `Next free time: ${formatSlot(FREE, TZ, "en")}.`, momentsMs: [FREE] },
];
const input = (sentences: { text: string; sources: string[] }[], more: Partial<CheckInput> = {}): CheckInput => ({
  role: "customer", answer: { sentences, askOwner: false }, scope, speakerText: "how much?", speakerLanguage: "en", timeZone: TZ, links: [], literals: ["Glow Salon"], maxChars: 400, ...more,
});
const check = (sentences: { text: string; sources: string[] }[], more: Partial<CheckInput> = {}) => checkTalk(input(sentences, more));
const failed = (r: ReturnType<typeof checkTalk>) => (r.ok ? 0 : r.check);

test("a grounded sentence passes, and so does a courtesy with no sources", () => {
  assert.equal(check([{ text: "A Haircut is ₹300.", sources: ["s:svc"] }, { text: "How can I help?", sources: [] }]).ok, true);
});

test("check 1: a source that does not exist, or is not in this speaker's scope, fails", () => {
  assert.equal(failed(check([{ text: "Hello.", sources: ["n-99"] }])), 1);
  // an owner-only note is simply not in a customer's scope: naming it fails
  assert.equal(failed(check([{ text: "Hello.", sources: ["n-2"] }])), 1);
});

test("check 2: a number, amount, date, time or percentage not in the sentence's own sources fails", () => {
  assert.equal(failed(check([{ text: "A Haircut is ₹350.", sources: ["s:svc"] }])), 2);
  assert.equal(failed(check([{ text: "Haircuts are 20% off on Tuesdays.", sources: ["n-1"] }])), 2);
  assert.equal(check([{ text: "Haircuts are 10% off on Tuesdays.", sources: ["n-1"] }]).ok, true);
  // a number backed by a source the sentence does NOT name is not backed: sources are per sentence
  assert.equal(failed(check([{ text: "A Haircut is ₹300.", sources: ["n-1"] }])), 2);
  assert.equal(failed(check([{ text: `The next free time is ${formatSlot(FREE + 3_600_000, TZ, "en")}.`, sources: ["r:free"] }])), 2);
  assert.equal(check([{ text: `The next free time is ${formatSlot(FREE, TZ, "en")}.`, sources: ["r:free"] }]).ok, true, "\"free time\" is availability, not a free offer");
  assert.equal(failed(check([{ text: "It costs half the usual price.", sources: ["s:svc"] }])), 2, "a number word with no source");
  assert.equal(failed(check([{ text: "Call me on 9876543210.", sources: [] }])), 2);
});

test("check 3: claims and commitments to a customer need a note for everyone or a setting that says the same", () => {
  for (const text of ["The owner guarantees this.", "We promise it will be ready.", "The owner says it is fine.", "It is free for you.", "You get a discount.", "We will refund you.", "I can waive the deposit."]) {
    assert.equal(failed(check([{ text, sources: [] }])), 3, text);
  }
  // a record read is not a promise: citing it does not back a claim
  assert.equal(failed(check([{ text: "It is free for you.", sources: ["r:free"] }])), 3);
  // a note that says the same thing does
  const withNote = { scope: [...scope, { id: "n-5", kind: "note" as const, text: "Free tea with every haircut." }] };
  assert.equal(check([{ text: "There is free tea with every haircut.", sources: ["n-5"] }], withNote).ok, true);
  // but not for another kind of claim: the free-tea note does not back a guarantee
  assert.equal(failed(check([{ text: "It is guaranteed.", sources: ["n-5"] }], withNote)), 3);
  // the owner's own talk is the owner's: a claim word there is not refused by check 3
  assert.equal(check([{ text: "A discount on Tuesdays could fill the quiet day.", sources: [] }], { role: "owner" }).ok, true);
});

test("claim and completion words in Hindi, Malayalam and Kannada", () => {
  const claims = ["यह गारंटी है", "मुफ़्त मिलेगा", "ഉറപ്പാണ്", "ഇളവ് ഉണ്ട്", "ಖಾತರಿ ಇದೆ", "ರಿಯಾಯಿತಿ ಸಿಗುತ್ತದೆ"];
  for (const text of claims) assert.ok(claimKindsOf(text).length > 0, text);
  const done = ["आपका हेयरकट बुक हो गया", "रिफंड कर दिया", "ബുക്ക് ചെയ്തു", "റദ്ദാക്കി", "ಬುಕ್ ಮಾಡಲಾಗಿದೆ", "ಕಳುಹಿಸಲಾಗಿದೆ"];
  for (const text of done) assert.equal(failed(check([{ text, sources: [] }], { speakerText: text })), 4, text);
});

test("check 4: words that say something was done are refused, whatever they rest on", () => {
  for (const text of ["Your haircut is booked.", "It is confirmed.", "The refund was sent.", "I cancelled it.", "Payment received and paid."]) assert.equal(failed(check([{ text, sources: ["s:svc"] }, ])), 4, text);
  assert.equal(failed(check([{ text: "Your booking is confirmed.", sources: [] }], { role: "owner" })), 4, "the owner's talk too");
  assert.equal(check([{ text: "To confirm, tap Book.", sources: [] }]).ok, true, "\"confirm\" alone is an invitation, not a report");
});

test("check 5: only the shop's own link, no phone number, the length cap, the speaker's language", () => {
  assert.equal(failed(check([{ text: "Pay at https://evil.example/pay now.", sources: [] }])), 2, "a stray link fails the number and link check first");
  assert.equal(check([{ text: "See https://glow.example/book for times.", sources: [] }], { links: ["https://glow.example/book"] }).ok, true);
  assert.equal(failed(check([{ text: "x".repeat(401), sources: [] }])), 5);
  assert.equal(failed(check([{ text: "यह जवाब हिंदी में है", sources: [] }])), 5, "an English speaker gets English");
  assert.equal(failed(check([{ text: "This is English.", sources: [] }], { speakerText: "हेयरकट कितने का है?", speakerLanguage: "hi" })), 5, "a Hindi speaker gets Hindi");
  assert.equal(check([{ text: "Haircut ₹300 का है।", sources: ["s:svc"] }], { speakerText: "हेयरकट कितने का है?", speakerLanguage: "hi" }).ok, true);
});

test("a customer's reply with a safety or guarantee word is refused even with a source that has it nowhere", () => {
  assert.equal(failed(check([{ text: "It is safe and certified.", sources: [] }])), 3);
});
