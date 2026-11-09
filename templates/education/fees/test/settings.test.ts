// The settings: the two example centres are valid, and every mistake a builder can make is said in plain words.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { highestDueInr, parseSettings, validateSettings } from "../src/settings.ts";

const raw = (name: string) => JSON.parse(readFileSync(new URL(`../settings/${name}.example.json`, import.meta.url), "utf8"));
const errorsOf = (change: (s: any) => void, base = "bright-tuition"): string[] => {
  const s = raw(base);
  change(s);
  const r = validateSettings(s);
  assert.equal(r.ok, false);
  return r.ok ? [] : r.errors;
};

test("both example centres are valid, and the defaults are filled in", () => {
  const bright = parseSettings(raw("bright-tuition"));
  assert.equal(bright.batches.length, 3);
  assert.equal(bright.students.length, 5);
  assert.deepEqual(bright.languages, ["hi", "en", "ml", "kn"]);
  assert.equal(highestDueInr(bright), 1800 + 100, "the dearest fee with its late fee");
  const maths = parseSettings(raw("maths-circle"));
  assert.deepEqual([maths.lateFeeInr, maths.waiver.limitInr, maths.partPayments.allowed], [0, 0, false]);
  const small = raw("bright-tuition");
  delete small.reminders; delete small.partPayments; delete small.waiver; delete small.lateFeeInr; delete small.languages;
  for (const st of small.students) delete st.language;
  for (const b of small.batches) { delete b.names.ml; delete b.names.kn; }
  const s = parseSettings(small);
  assert.deepEqual(s.reminders, { daysFromDue: [-3, 0, 5], hour: 10, maxPerMonth: 3 });
  assert.deepEqual([s.waiver.limitInr, s.lateFeeInr, s.partPayments], [0, 0, { allowed: true, minInr: 100 }]);
  assert.deepEqual(s.languages, ["hi", "en"]);
});

test("a mistake is said in plain words, with what to do about it", () => {
  assert.match(errorsOf((s) => { delete s.name; }).join("\n"), /Add the centre's name/);
  assert.match(errorsOf((s) => { s.due.day = 31; }).join("\n"), /due day.*between 1 and 28/);
  assert.match(errorsOf((s) => { s.students[0].batch = "class-11"; }).join("\n"), /needs a batch \("batch"\) that is one of the ids in "batches"/);
  assert.match(errorsOf((s) => { s.students[0].parent = "9811111111"; }).join("\n"), /starting with \+ and the country code/);
  assert.match(errorsOf((s) => { s.students[0].parent = s.owner.whatsapp; }).join("\n"), /the parent's number is the owner's/);
  assert.match(errorsOf((s) => { s.students.push({ ...s.students[0] }); }).join("\n"), /listed twice for the same parent number/);
  assert.match(errorsOf((s) => { s.students[0].language = "ta"; }).join("\n"), /must be one of the centre's languages/);
  assert.match(errorsOf((s) => { s.batches[0].monthlyFeeInr = 12.5; }).join("\n"), /monthly fee in whole rupees/);
  assert.match(errorsOf((s) => { s.batches[1].names.en = ["class 8"]; }).join("\n"), /used by both/);
  assert.match(errorsOf((s) => { delete s.batches[0].names.ml; }).join("\n"), /at least one name in Malayalam/);
  assert.match(errorsOf((s) => { s.lateFeeInr = 5000; }).join("\n"), /never more than the cheapest monthly fee/);
  assert.match(errorsOf((s) => { s.waiver.limitInr = 2000; }).join("\n"), /never more than the cheapest monthly fee/);
  assert.match(errorsOf((s) => { s.reminders.daysFromDue = [-3, -3]; }).join("\n"), /listed twice/);
  assert.match(errorsOf((s) => { s.reminders.daysFromDue = [-30]; }).join("\n"), /between -14 and 60/);
  assert.match(errorsOf((s) => { s.reminders.hour = 3; }).join("\n"), /between 6 and 21/);
  assert.match(errorsOf((s) => { s.partPayments.minInr = 5000; }).join("\n"), /never more than the cheapest monthly fee/);
  assert.match(errorsOf((s) => { delete s.refund; }).join("\n"), /Add the refund limit/);
  assert.match(errorsOf((s) => { s.surprise = 1; }).join("\n"), /I don't know what "surprise" means/);
});

test("the payment module: UPI needs the centre's own UPI ID and payee name, checked in plain words; Razorpay has neither; no block is refused and asks for the UPI ID (B33, B71)", () => {
  const upi = parseSettings(raw("bright-tuition-upi"));
  assert.deepEqual(upi.payment, { module: "upi", upi: { id: "brighttuition@oksbi", payee: "Bright Tuition" } });
  assert.deepEqual(parseSettings(raw("bright-tuition")).payment, { module: "razorpay" });
  // B71: a file with no block is never a gateway centre; it is told to give the centre's own UPI ID
  assert.match(errorsOf((s) => { delete s.payment; }).join("\n"), /Add how customers pay \("payment"\)\. UPI is the default/);
  assert.match(errorsOf((s) => { s.payment = { module: "upi" }; }).join("\n"), /needs its UPI ID and the payee name/);
  assert.match(errorsOf((s) => { s.payment = { module: "upi", upi: { id: "brighttuition", payee: "Bright Tuition" } }; }).join("\n"), /payment\.upi\.id.*needs an @/);
  assert.match(errorsOf((s) => { s.payment = { module: "upi", upi: { id: "bt@oksbi", payee: "" } }; }).join("\n"), /payment\.upi\.payee.*payee name/);
  assert.match(errorsOf((s) => { s.payment = { module: "razorpay", upi: { id: "bt@oksbi", payee: "B" } }; }).join("\n"), /A Razorpay shop has no UPI ID/);
  assert.match(errorsOf((s) => { s.payment = { module: "paytm" }; }).join("\n"), /not one I know/);
});

test("parseSettings throws one error that lists every problem", () => {
  const s = raw("bright-tuition");
  delete s.name; s.due.day = 40;
  assert.throws(() => parseSettings(s), /These settings need fixing:\n- .*\n- /s);
});
