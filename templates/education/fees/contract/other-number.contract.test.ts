// A fee (or a credit account) asked about from another number, and where a UPI refund goes back to (25 Nov 2026, refund-paths; modules/record/case-asked.ts, ledger.ts
// refundSource), on the Go centre over HTTP and files. Someone at a number that holds no fee names one: one line that shows nothing of it, the owner told once an hour (the
// approved template), a record line with the fee in refs.case and no other number, nothing changed. A reference the centre does not hold gets the usual answer and the owner
// hears nothing. A UPI refund names the account the money came from by its note, amount and day. The credit book does the same with an account's words.
import { after, describe } from "node:test";
import assert from "node:assert/strict";
import { MEERA, OWNER_NUMBER, ROHAN, contract, lines, makeCentre } from "./harness.ts";
import { ownRefs } from "../../../commerce/parts/contract/via-parts.ts";
import type { Centre, CentreOptions } from "./harness.ts";

const centres: Centre[] = [];
after(async () => { for (const c of centres) await c.cleanup(); });
const STRANGER = "+919877777777";
const NOT_SHOWN = "I can't show that fee to this number. I have told the owner, and they will contact you.";

/** A UPI centre on the wire, its two earlier months open (f-1 Meera, f-2 Rohan). */
async function upiCentre(o: CentreOptions = {}): Promise<Centre> {
  const c = await makeCentre({ mode: "guards", ...o }); centres.push(c);
  await c.start();
  await c.waitFor(() => lines(c, "open_fee", "confirmed").length === 2, "the two earlier months opened");
  return c;
}
const texts = (c: Centre, to: string): string[] => c.sent(to).map((m) => m.text);

describe("a fee named from a number that holds none", () => {
  contract("a real reference: one line that shows nothing, the owner told once an hour, a record line with no other number, and nothing changed", async () => {
    const c = await upiCentre();
    const ownerBefore = c.sent(OWNER_NUMBER).length;
    await c.inbound(STRANGER, "what about F1? I am her uncle");
    assert.deepEqual(texts(c, STRANGER), [NOT_SHOWN]);
    assert.doesNotMatch(texts(c, STRANGER)[0], /Meera|₹|98222|f-1/iu, "nothing of the fee reaches the asker");
    const told = c.sent(OWNER_NUMBER).slice(ownerBefore);
    assert.equal(told.length, 1);
    assert.equal(told[0].templateName, "owner_fee_asked_elsewhere");
    assert.equal(told[0].text, `Someone at ${STRANGER} asks about fee f-1 (parent ${MEERA}). Check before you help.`);
    const asked = lines(c, "case_asked_elsewhere");
    assert.equal(asked.length, 1);
    assert.deepEqual([asked[0].outcome, asked[0].booking, asked[0].conversation], ["confirmed", null, STRANGER]);
    assert.deepEqual(ownRefs(asked[0].refs), { case: "f-1", via: "reference", to: "owner" }); // through the parts program the line also names its part
    assert.doesNotMatch(asked[0].notes + JSON.stringify(asked[0].refs), /9822222222/u, "no other number in the line");
    await c.inbound(STRANGER, "fee f-1");
    assert.equal(texts(c, STRANGER).at(-1), NOT_SHOWN);
    assert.equal(c.sent(OWNER_NUMBER).length, ownerBefore + 1, "at most once an hour per asker and fee");
    assert.deepEqual((await c.status()).fees, { open: 2 }, "the fees are as they were");
  });

  contract("a reference the centre does not hold: the usual answer, and the owner hears nothing", async () => {
    const c = await upiCentre();
    const ownerBefore = c.sent(OWNER_NUMBER).length;
    await c.inbound(STRANGER, "what about f-9?");
    assert.notEqual(texts(c, STRANGER).at(-1), NOT_SHOWN);
    assert.equal(c.sent(OWNER_NUMBER).length, ownerBefore);
    assert.equal(lines(c, "case_asked_elsewhere").length, 0);
  });
});

describe("a UPI refund goes back to the account that paid", () => {
  contract("more than was owed: the owner's message names the payment's note (the link's reference), amount and day, and keeps the parent as the person to tell", async () => {
    const c = await upiCentre();
    await c.inbound(ROHAN, "pay");
    const code = /received ([A-Z0-9]{4,})/u.exec(texts(c, OWNER_NUMBER).reverse().find((t) => t.includes("f-2") && /received [A-Z0-9]{4,}/u.test(t))!)![1];
    await c.inbound(OWNER_NUMBER, `received ${code} 2300`);
    const refund = texts(c, OWNER_NUMBER).find((t) => t.startsWith("Refund to send:"));
    assert.ok(refund, JSON.stringify(texts(c, OWNER_NUMBER)));
    assert.match(refund!, /^Refund to send: ₹500 back to the account that paid you ₹2,300 on [A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2} with the note f-2\.\d+ \(parent \+919844444444, fee f-2\)\. Find that payment in your UPI app and send it back to that account\./u);
    assert.doesNotMatch(refund!, /by UPI to parent/u);
  });
});

describe("the credit book", () => {
  contract("an account named from a number that holds none: the account's words, nothing shown, the owner told with the account's name", async () => {
    const c = await makeCentre({ example: "credit" }); centres.push(c);
    await c.start();
    await c.waitFor(() => lines(c, "credit_add", "confirmed").length === 3, "the settings' three accounts opened");
    await c.started();
    const fee = c.record().map((l) => l.booking).find((b): b is string => typeof b === "string" && /^f-\d+$/u.test(b));
    assert.ok(fee, "an account's entry is a fee");
    await c.inbound(STRANGER, `what about ${fee}?`);
    const sent = lines(c, "send_message", "confirmed");
    assert.ok(sent.some((l) => l.conversation === STRANGER && (l.refs.templates ?? "").split("+").includes("credit_case_other_number")), JSON.stringify(sent.filter((l) => l.conversation === STRANGER).map((l) => l.refs)));
    assert.ok(sent.some((l) => l.refs.to === "owner" && (l.refs.templates ?? "").split("+").includes("owner_credit_case_other_number")));
    assert.equal(lines(c, "case_asked_elsewhere", "confirmed").length, 1);
  });
});
