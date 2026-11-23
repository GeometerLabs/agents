// A UPI centre's money (the default payment module), on the wire (guards mode: the WhatsApp Guard is the only one; a UPI centre has no payments Guard). The parent pays the
// centre's own UPI ID; a payment counts ONLY when the owner marks it received from their own number with the one-use code the agent sent only to them: by the words
// ("received K7M2QX"), the Received button, or a press on their page bound to what it showed. A code counts once; an unknown code counts nothing; a part leaves the rest owed on
// a new request; more than was owed is a refund the owner owes, marked sent the same way; cash is the owner's mark from their page. "I have paid", a screenshot or the parent's
// words mark nothing: the owner is asked to look. A waiver within the limit is applied and the owner told; above it the owner is asked for that amount ("approve q-1").
// The fees are the students' earlier unpaid months (harness GUARDS_MONTH): Meera's September (₹1,500, f-1) and Rohan's (₹1,800, f-2).
import { after, describe } from "node:test";
import assert from "node:assert/strict";
import { MEERA, OWNER_NUMBER, ROHAN, contract, lines, makeCentre } from "./harness.ts";
import type { Centre, CentreOptions } from "./harness.ts";

const centres: Centre[] = [];
after(async () => { for (const c of centres) await c.cleanup(); });

/** A UPI centre on the wire, its two earlier months open (f-1 Meera, f-2 Rohan). */
async function upiCentre(o: CentreOptions = {}): Promise<Centre> {
  const c = await makeCentre({ mode: "guards", ...o }); centres.push(c);
  await c.start();
  await c.waitFor(() => lines(c, "open_fee", "confirmed").length === 2, "the two earlier months opened");
  return c;
}

const texts = (c: Centre, to: string): string[] => c.sent(to).map((m) => m.text);
const last = (c: Centre, to: string): string => texts(c, to).at(-1) ?? "";
/** The newest one-use code the owner was given for `fee` ("received K7M2QX" or "refunded K7M2QX" in the owner's message). */
function codeFor(c: Centre, fee: string, word: "received" | "refunded" = "received"): string {
  const re = new RegExp(`${word} ([A-Z0-9]{4,})`, "u");
  for (const t of texts(c, OWNER_NUMBER).reverse()) { if (!t.includes(`(fee ${fee})`) && !t.includes(fee)) continue; const m = re.exec(t); if (m) return m[1]; }
  throw new Error(`the owner was given no "${word}" code for ${fee}: ${JSON.stringify(texts(c, OWNER_NUMBER))}`);
}

describe("paid only when the owner marks it", () => {
  contract("a parent asks to pay: the UPI link for exactly what is owed; the owner is told what to look for, with a code; 'received <code>' settles the fee and the parent gets the receipt", async () => {
    const c = await upiCentre();
    await c.inbound(ROHAN, "please send the payment link");
    const pay = last(c, ROHAN);
    assert.match(pay, /Pay ₹1,800 for Rohan Mehta's class 10 fee for Sep 2026 here:/u);
    assert.match(pay, /upi:\/\/pay\?pa=brighttuition%40oksbi|upi:\/\/pay\?pa=brighttuition@oksbi/u, "the centre's own UPI ID");
    assert.match(pay, /am=1800/u, "for exactly what is owed");
    const code = codeFor(c, "f-2");
    assert.deepEqual((await c.status()).fees, { open: 2 });
    await c.inbound(OWNER_NUMBER, `received ${code}`);
    assert.match(last(c, ROHAN), /^Thank you! Bright Tuition Centre \(UPI\) has received ₹1,800 for Rohan Mehta's class 10 fee for Sep 2026\. Nothing more is due\. Your receipt number is f-2\./u);
    assert.deepEqual((await c.status()).fees, { open: 1, paid: 1 });
    const marked = lines(c, "owner_marked_paid", "confirmed");
    assert.equal(marked.length, 1);
    assert.deepEqual([marked[0].booking, marked[0].refs.amountPaise, marked[0].refs.markedBy], ["f-2", "180000", "owner"]);
    assert.equal(lines(c, "settle_fee", "confirmed").length, 1);
    // the same code again counts nothing, and the owner is told it was already counted
    const before = texts(c, ROHAN).length;
    await c.inbound(OWNER_NUMBER, `received ${code}`);
    assert.equal(lines(c, "owner_marked_paid").length, 1, "counted once");
    assert.equal(texts(c, ROHAN).length, before, "the parent hears nothing more");
    assert.ok(lines(c, "upi_owner_reply", "blocked").length >= 1);
    // a code the agent never gave counts nothing either
    await c.inbound(OWNER_NUMBER, "received ZZZZ99");
    assert.equal(lines(c, "owner_marked_paid").length, 1);
    assert.equal(lines(c, "upi_owner_reply", "blocked").length, 2);
  });

  contract("'I have paid' marks nothing: the parent is thanked, the owner asked to look with the Received button; a tap on it settles the fee", async () => {
    const c = await upiCentre();
    await c.inbound(OWNER_NUMBER, "hello"); // the owner's window is open: the agent's notices come with buttons
    await c.inbound(ROHAN, "I have already paid the fees");
    assert.deepEqual((await c.status()).fees, { open: 2 }, "the parent's word marks nothing");
    const claim = lines(c, "upi_paid_claim");
    assert.equal(claim.length, 1);
    assert.equal(claim[0].refs.via, "words");
    const asked = c.sent(OWNER_NUMBER).filter((m) => m.interactive).at(-1)!;
    assert.match(asked.text, /Parent \+919844444444 says they have paid Rohan Mehta's Sep 2026 fee \(fee f-2\)\. A screenshot is not proof/u);
    const button = asked.interactive.buttons.find((b: { id: string }) => b.id.startsWith("upi-received:"));
    assert.ok(button, "the Received button carries the one-use code");
    await c.tap(button.id, { from: OWNER_NUMBER });
    assert.deepEqual((await c.status()).fees, { open: 1, paid: 1 });
    assert.match(last(c, ROHAN), /has received ₹1,800/u);
  });

  contract("a part marked leaves the rest owed on a new request (and a new code); the rest marked settles the fee", async () => {
    const c = await upiCentre();
    await c.inbound(ROHAN, "pay");
    await c.inbound(OWNER_NUMBER, `received ${codeFor(c, "f-2")} 1000`);
    assert.deepEqual((await c.status()).fees, { open: 2 });
    assert.match(texts(c, ROHAN).join("\n"), /₹1,000/u, "the parent is told what was received");
    const requests = lines(c, "upi_request", "confirmed").filter((l) => l.booking === "f-2");
    assert.deepEqual(requests.map((l) => l.refs.amountPaise), ["180000", "80000"], "a new request for exactly the rest");
    await c.inbound(OWNER_NUMBER, `received ${codeFor(c, "f-2")}`);
    assert.deepEqual((await c.status()).fees, { open: 1, paid: 1 });
    assert.deepEqual(lines(c, "owner_marked_paid").map((l) => l.refs.amountPaise), ["100000", "80000"]);
  });

  contract("more than was owed is owed back by the owner (the agent never sends it); 'refunded <code>' marks it sent and only then is the parent told", async () => {
    const c = await upiCentre();
    await c.inbound(ROHAN, "pay");
    await c.inbound(OWNER_NUMBER, `received ${codeFor(c, "f-2")} 2300`);
    assert.deepEqual((await c.status()).fees, { open: 1, paid: 1 });
    const owed = lines(c, "upi_refund_owed", "held_for_owner");
    assert.equal(owed.length, 1);
    assert.equal(owed[0].refs.amountPaise, "50000");
    assert.match(texts(c, ROHAN).join("\n"), /₹500/u, "the parent is told ₹500 will come back from the centre");
    const code = codeFor(c, "f-2", "refunded");
    await c.inbound(OWNER_NUMBER, `refunded ${code}`);
    assert.equal(lines(c, "upi_refund_marked_done", "confirmed").length, 1);
    assert.match(last(c, ROHAN), /₹500/u);
    await c.inbound(OWNER_NUMBER, `refunded ${code}`);
    assert.equal(lines(c, "upi_refund_marked_done").length, 1, "marked once");
  });

  contract("a screenshot is read as 'I paid' (never as proof); a 'received' from a parent's number is not a mark", async () => {
    const c = await upiCentre();
    await c.inbound(ROHAN, "pay");
    const code = codeFor(c, "f-2");
    await c.inbound(MEERA, `received ${code}`);
    assert.equal(lines(c, "owner_marked_paid").length, 0, "only the owner's number marks");
    await c.inbound(ROHAN, "", { extra: { image: true } });
    const claim = lines(c, "upi_paid_claim");
    assert.equal(claim.at(-1)!.refs.via, "screenshot");
    assert.deepEqual((await c.status()).fees, { open: 2 });
  });
});

describe("the owner's page for a UPI centre", () => {
  contract("a fee a parent says is paid is listed with Received (no code shown); the press with its digest settles it, a stale digest does nothing", async () => {
    const c = await upiCentre();
    assert.deepEqual((await c.ownerView()).body.items, [], "a fee nobody claimed waits for the parent, not the owner");
    await c.inbound(ROHAN, "I paid");
    const view = (await c.ownerView()).body;
    assert.equal(view.kind, "fees");
    const item = view.items.find((i: { case: string }) => i.case === "f-2");
    assert.ok(item);
    assert.deepEqual([item.kind, item.amountPaise, item.actions], ["deposit", 180000, ["received"]]);
    assert.equal(item.customer.name, "Rohan Mehta");
    assert.ok(!JSON.stringify(view).includes(codeFor(c, "f-2")), "the one-use code is never on the page");
    await c.ownerAction("received", "f-2", "0".repeat(32));
    assert.deepEqual((await c.status()).fees, { open: 2 }, "a stale digest does nothing");
    assert.equal(lines(c, "owner_page_action", "blocked").length, 1);
    await c.ownerAction("received", "f-2", item.digest);
    assert.deepEqual((await c.status()).fees, { open: 1, paid: 1 });
    assert.deepEqual((await c.ownerView()).body.items, []);
  });

  contract("'paid another way?': the owner marks cash from the page (whole or a part), the parent gets the receipt, the request is closed", async () => {
    const c = await upiCentre();
    const cash = (await c.ownerView()).body.cash as { case: string; digest: string; amountPaise: number; student: string }[];
    assert.deepEqual(cash.map((x) => [x.case, x.amountPaise, x.student]), [["f-1", 150000, "Meera Nair"], ["f-2", 180000, "Rohan Mehta"]]);
    const meera = cash[0];
    await c.ownerAction("cash", "f-1", meera.digest, { amountPaise: 50000 });
    assert.deepEqual((await c.status()).fees, { open: 2 }, "a part leaves the fee open");
    const next = ((await c.ownerView()).body.cash as typeof cash).find((x) => x.case === "f-1")!;
    assert.equal(next.amountPaise, 100000);
    await c.ownerAction("cash", "f-1", meera.digest);
    assert.equal(lines(c, "owner_marked_paid").length, 1, "the old digest marks nothing more");
    await c.ownerAction("bank", "f-1", next.digest);
    assert.deepEqual((await c.status()).fees, { open: 1, paid: 1 });
    assert.deepEqual(lines(c, "owner_marked_paid").map((l) => [l.refs.via, l.refs.amountPaise]), [["cash", "50000"], ["bank", "100000"]]);
    assert.match(last(c, MEERA), /1,000|1,500/u, "Meera's parent is told it was received (in Malayalam)");
  });
});

describe("a waiver", () => {
  contract("within the limit it is applied, the request made again for the new balance, and the owner told; above it the owner is asked for that amount and 'approve q-1' applies it", async () => {
    const c = await upiCentre();
    await c.inbound(ROHAN, "can you give a discount of ₹100");
    assert.equal(lines(c, "waive_fee", "confirmed").length, 1);
    assert.match(last(c, ROHAN), /^Done\. ₹100 is taken off Rohan Mehta's fee for Sep 2026\. ₹1,700 is now to pay:/u);
    assert.ok(lines(c, "upi_request", "confirmed").some((l) => l.booking === "f-2" && l.refs.amountPaise === "170000"));
    await c.inbound(ROHAN, "please waive ₹500 more");
    const held = lines(c, "waiver_request", "held_for_owner");
    assert.equal(held.length, 1);
    assert.equal(held[0].refs.request, "q-1");
    assert.match(last(c, OWNER_NUMBER), /Approval needed: \+919844444444 asks to take ₹500 off Rohan Mehta's class 10 fee for Sep 2026\./u);
    const item = (await c.ownerView()).body.items.find((i: { kind: string }) => i.kind === "waiver");
    assert.deepEqual([item.case, item.amountPaise, item.actions], ["f-2", 50000, ["approve", "deny"]]);
    await c.inbound(OWNER_NUMBER, "approve q-1");
    assert.equal(lines(c, "waive_fee", "confirmed").length, 2);
    assert.match(last(c, ROHAN), /₹1,200 is now to pay/u);
    await c.inbound(OWNER_NUMBER, "approve q-1");
    assert.equal(lines(c, "waive_fee").length, 2, "answered once");
    assert.ok(lines(c, "owner_decision", "blocked").length >= 1);
  });

  contract("the owner's 'deny q-1' leaves the fee as it was, and the parent asking again is told no without asking the owner again", async () => {
    const c = await upiCentre();
    await c.inbound(ROHAN, "please waive ₹500");
    await c.inbound(OWNER_NUMBER, "deny q-1");
    assert.equal(lines(c, "waive_fee").length, 0);
    const asked = texts(c, OWNER_NUMBER).filter((t) => t.startsWith("Approval needed")).length;
    await c.inbound(ROHAN, "please waive ₹500");
    assert.equal(texts(c, OWNER_NUMBER).filter((t) => t.startsWith("Approval needed")).length, asked, "the owner is not asked again");
    assert.equal(lines(c, "waiver_request").length, 1);
  });
});
