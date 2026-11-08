// Several people who approve a refund (B37, modules/approvals/people.ts): an Orders shop takes the same `approvers` settings as Bookings and Fees, the owner is named as the one
// who asked when they ask for a refund, and another approver's code reply belongs to the approvals relay, not to the agent.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateSettings } from "../src/settings.ts";
import { createWorld, annapurnaRazorpay } from "../src/harness.ts";
import { TEMPLATES } from "../src/language/templates.ts";

const raw = () => JSON.parse(readFileSync(new URL("../settings/annapurna-tiffins-razorpay.example.json", import.meta.url), "utf8"));
const people = [{ id: "approver-1", whatsapp: "+919800000077", language: "en" }];

test("approvers are read like Bookings' and Fees': a person, and the amount above which two must approve", () => {
  const ok = validateSettings({ ...raw(), approvers: { people, twoAboveInr: 1000 } });
  assert.ok(ok.ok && ok.settings.approvers?.people[0].whatsapp === "+919800000077");
  const same = validateSettings({ ...raw(), approvers: { people: [{ ...people[0], whatsapp: raw().owner.whatsapp }] } });
  assert.ok(!same.ok, "the owner is not another approver");
  assert.ok(validateSettings(raw()).ok && !("approvers" in (validateSettings(raw()) as { settings: object }).settings), "a shop of the owner alone has none");
});

test("another approver's code reply is the relay's: the agent says nothing and records nothing", async () => {
  const w = createWorld({ settings: { ...annapurnaRazorpay(), approvers: { people } } as never });
  const before = w.record.entries().length;
  await w.agent.handle({ kind: "message", message: w.messaging.receive("+919800000077", "approve K7M2QX") });
  assert.equal(w.record.entries().length, before);
  assert.equal(w.textsTo("+919800000077").length, 0);
});

test("the three words to a person when a refund needs several people exist in all four languages", () => {
  for (const language of ["en", "hi", "ml", "kn"] as const) {
    const facts = { language, timeZone: "Asia/Kolkata", businessName: "X", menu: [], customerPhone: "+919811111111", refundInr: 120, approvalsLeft: 1 };
    for (const id of ["owner_approval_waiting", "owner_approval_closed", "owner_approval_refused", "owner_refund_settled"] as const) assert.ok(TEMPLATES[language][id](facts).includes("₹120"), `${language} ${id}`);
  }
});
