// The walkthrough a partner shows an owner (scripts/walkthrough.ts) does what the sell guide says it does, in every language, on the example centre: the reminder with
// its link, "I already paid" with nothing on record, a discount that goes to the owner, the payment and its receipt, and no reminder once paid. Judged from the
// stand-ins' own records, not from the text it printed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { LANGUAGES } from "../../../../modules/language/languages.ts";
import { MARKERS } from "../crash-test/says.ts";
import { WALK, WALK_DISCOUNT_INR, printed, walk } from "../scripts/walkthrough.ts";
import { balancePaise } from "../src/due.ts";

for (const language of LANGUAGES) {
  test(`walkthrough in ${language}: five steps, each doing what the guide says, and the stand-ins' records agree`, async () => {
    const { world: w, steps } = await walk(language);
    const { student, parent } = WALK[language];
    assert.equal(steps.length, 5);
    const [reminder, claim, discount, paid, later] = steps;

    assert.equal(reminder.lines.length, 1);
    assert.ok(reminder.lines[0].text.startsWith(MARKERS[language].reminder), reminder.lines[0].text);
    assert.match(reminder.lines[0].text, /https:\/\/pay\.example\/req_\d+/);

    assert.deepEqual(claim.lines.map((l) => l.from), ["parent", "agent", "agent to owner"]);
    assert.ok(claim.lines[1].text.includes(MARKERS[language].cannotSee), claim.lines[1].text);

    assert.deepEqual(discount.lines.map((l) => l.from), ["parent", "agent", "agent to owner", "owner", "agent"]);
    assert.ok(discount.lines[3].text === "approve q-1");
    assert.match(discount.lines[4].text, /₹/);

    assert.deepEqual(paid.lines.map((l) => l.from), ["agent"]);
    assert.ok(paid.lines[0].text.includes(MARKERS[language].received), paid.lines[0].text);

    assert.deepEqual(later.lines, [], "no reminder goes out for a fee the record shows paid");

    // the stand-ins' own records
    const due = w.dueOf(student)!;
    assert.equal(due.state, "paid");
    assert.equal(due.waivedInr, WALK_DISCOUNT_INR);
    assert.equal(balancePaise(due), 0);
    const link = w.payments.links().find((l) => l.id === due.currentLinkId)!;
    assert.equal(link.payments.reduce((n, p) => n + p.amount, 0), (due.feeInr - WALK_DISCOUNT_INR) * 100, "the parent paid the fee less the ₹300 the owner took off");
    assert.equal(w.payments.refunds().length, 0);
    const sentAfterPaid = w.messaging.sentTo(parent).filter((m) => m.text.includes(student) && m.text.startsWith(MARKERS[language].reminder)).length;
    assert.equal(sentAfterPaid, 1, "one reminder for this fee in the whole walk: the first");
  });
}

test("the printed walkthrough names its language, says it is stand-in services and test money, and numbers its steps", async () => {
  const { steps } = await walk("ml");
  const text = printed("ml", steps);
  assert.match(text, /^Bright Tuition Centre, a month of fees in Malayalam\. Stand-in services and test money: nothing real is sent\./);
  for (let i = 1; i <= 5; i++) assert.ok(text.includes(`\n${i}. `));
  assert.ok(text.includes("(nothing is sent)"));
});
