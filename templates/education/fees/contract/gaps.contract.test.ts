// THE MONEY GAPS of the Fees contract (23 Nov 2026, stream FG): money, limit, approval, licence, recovery and class-access behaviour that, until now, only a TypeScript unit
// test in templates/education/fees/test/ checked. The TypeScript runtime and its unit tests are to be deleted (decision 61), and the owner's rule is that the only check on
// money, limits, approvals, the licence or recovery is never pruned, so each is held here on both runtimes. go/TRIAL.md "go-fees-gaps-23nov" maps every unit test to the case
// that holds it now. The unit test each case comes from is named on it. Expected words are the TypeScript's own (src/language/templates.ts, modules/assistant/words.ts).
//
// Guards centres run on the real clock with their two earlier months open (harness GUARDS_MONTH: f-1 Meera's September, ₹1,500; f-2 Rohan's, ₹1,800); fakes centres on the
// test clock (Mon 2 Nov 2026, 09:00 in India).
import { after, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EXAMPLES, OWNER_NUMBER, REPO, ROHAN, SHARMA, at, contract, lease, lines, makeCentre, sends, sleep } from "./harness.ts";
import type { Centre, CentreOptions } from "./harness.ts";
import { fixture } from "../../../commerce/bookings/contract/guards.ts";
import { LICENCE_RULE } from "../../../../modules/licence/rules.ts";

const centres: Centre[] = [];
after(async () => { for (const c of centres) await c.cleanup(); });

/** A guards centre, its two earlier months open. */
async function centre(o: CentreOptions = {}): Promise<Centre> {
  const c = await makeCentre({ mode: "guards", ...o }); centres.push(c);
  await c.start();
  await c.waitFor(() => lines(c, "open_fee", "confirmed").length === 2, "the two earlier months opened");
  return c;
}
async function boot(o: CentreOptions = {}): Promise<Centre> { const c = await makeCentre(o); centres.push(c); await c.start(); return c; }
const ASSISTANT = { assistant: {} };
const texts = (c: Centre, to: string): string[] => c.sent(to).map((m) => m.text);
const last = (c: Centre, to: string): string => texts(c, to).at(-1) ?? "";
const cards = (c: Centre) => c.sent(OWNER_NUMBER).filter((m) => m.interactive?.buttons?.some((b: { id: string }) => b.id.startsWith("card-")));
const links = (c: Centre) => c.guards!.standins.fakes.payments.links();
const linkOf = (c: Centre, ref: string) => links(c).find((l) => l.reference_id === ref);
const refundCalls = (c: Centre) => c.guards!.of("payments", "POST", /\/refund$/u);
async function deliver(c: Centre, events: unknown[]): Promise<void> {
  assert.equal((await c.events(events.map((event) => ({ kind: "payment_event", event })))).status, 200);
  await c.settle();
}
/** Rohan's September paid in full on its link (f-2.1) at a Razorpay centre. */
async function rohanPaid(o: CentreOptions = {}): Promise<Centre> {
  const c = await centre({ example: "razorpay", ...o });
  await c.inbound(ROHAN, "pay");
  await deliver(c, c.guards!.pay(linkOf(c, "f-2.1")!.id));
  assert.deepEqual((await c.status()).fees, { open: 1, paid: 1 });
  return c;
}
async function recover(c: Centre, id: string, action: string, caseId: string): Promise<void> {
  assert.equal((await c.call("/internal/recover", { body: { id, case: caseId, action } })).status, 200);
  await c.settle();
}
/** The example centre's students as the file has them, so a test can change one (an array in `settings` replaces the whole list). */
const students = (example: keyof typeof EXAMPLES): Record<string, unknown>[] =>
  (JSON.parse(readFileSync(join(REPO, "templates", "education", "fees", "settings", EXAMPLES[example]), "utf8")) as { students: Record<string, unknown>[] }).students;

describe("what the owner's chat refuses to do with money (test/assistant-money)", () => {
  contract("a cancel's second tap does nothing; a fee no longer open cannot be cancelled; a fee with nothing paid has nothing to refund", async () => {
    const c = await centre({ settings: ASSISTANT });
    await c.inbound(OWNER_NUMBER, "cancel f-2");
    const card = cards(c).at(-1)!;
    await c.tap(card.interactive.buttons[0].id, { from: OWNER_NUMBER });
    assert.deepEqual((await c.status()).fees, { open: 1, closed: 1 });
    const waived = lines(c, "waive_fee", "confirmed").length;
    const before = cards(c).length;
    await c.tap(card.interactive.buttons[0].id, { from: OWNER_NUMBER });
    assert.equal(lines(c, "waive_fee", "confirmed").length, waived, "a second tap waives nothing more");
    assert.equal(cards(c).length, before, "and makes no new card");
    await c.inbound(OWNER_NUMBER, "cancel f-2");
    assert.equal(last(c, OWNER_NUMBER), "f-2 is already cancelled, done or expired.");
    await c.inbound(OWNER_NUMBER, "refund f-1");
    assert.equal(last(c, OWNER_NUMBER), "Nothing was paid on f-1, so there is nothing to refund.");
    assert.equal(cards(c).length, before, "no card for either");
  });

  contract("nothing is offered while the fee has something waiting for the owner; money the owner marked received by hand is never refunded from the chat", async () => {
    const c = await centre({ settings: ASSISTANT });
    await c.inbound(ROHAN, "please waive ₹500"); // above the ₹100 waiver limit: it waits for the owner
    await c.inbound(OWNER_NUMBER, "cancel f-2");
    assert.equal(last(c, OWNER_NUMBER), "f-2 is in the middle of something (a refund being checked). Try again a little later.");
    assert.equal(lines(c, "waive_fee").length, 0);
    // Meera's fee marked paid in cash from the owner's page: nothing a payments service could give back
    const cash = ((await c.ownerView()).body.cash as { case: string; digest: string }[]).find((x) => x.case === "f-1")!;
    await c.ownerAction("cash", "f-1", cash.digest);
    assert.deepEqual((await c.status()).fees, { open: 1, paid: 1 });
    const before = cards(c).length;
    await c.inbound(OWNER_NUMBER, "refund f-1");
    assert.equal(last(c, OWNER_NUMBER), "Nothing was paid on f-1, so there is nothing to refund.");
    assert.equal(cards(c).length, before);
    assert.equal(lines(c, "upi_refund_owed").length, 0);
  });
});

describe("Guard's answers on a refund (test/agent, licence, full-chain)", () => {
  contract("409 already_done on the owner's 'approve q-1': done by the word of the person at the server, recorded with who said so, the owner told plainly, never sent again", async () => {
    const c = await rohanPaid();
    await c.inbound(ROHAN, "please refund ₹400");
    c.guards!.payments.answer(fixture("guard-responses.json").already_done, { times: 1, match: (x) => x.method === "POST" && /\/refund$/u.test(x.path) });
    await c.inbound(OWNER_NUMBER, "approve q-1");
    assert.equal(refundCalls(c).length, 1);
    assert.equal(c.guards!.standins.fakes.payments.refunds().length, 0, "nothing reached the provider");
    const done = lines(c, "refund", "confirmed");
    assert.equal(done.length, 1);
    assert.equal(done[0].refs.confirmedBy, "operator:owner");
    assert.ok(texts(c, OWNER_NUMBER).includes(`Refund done: ₹400 for ${ROHAN}. The person who set up your agent checked it and marked it as made, so it is not sent a second time.`), texts(c, OWNER_NUMBER).slice(-3).join("\n---\n"));
    assert.deepEqual((await c.status()).refunds, { waitingForOwner: 0, beingSentAgain: 0, needBuilder: { total: 0 } }, "not a problem for the builder");
    await sleep(2200); await c.settle();
    assert.equal(refundCalls(c).length, 1, "never sent again");
  });

  contract("a refund held above the limit that the owner refuses at Guard is never sent, and the parent is told", async () => {
    const c = await rohanPaid();
    await c.inbound(ROHAN, "please refund the fee");
    assert.equal(refundCalls(c)[0]?.status, 202, "held by the Guard");
    const [review] = c.guards!.stub.model.reviews("x", true);
    assert.equal(c.guards!.stub.model.decide(review.id, false, "owner-contract").status, 200);
    await c.events([{ kind: "approval_decision", approval: review.id, decision: "deny", id: "d-1" }]); await c.settle();
    assert.equal(c.guards!.standins.fakes.payments.refunds().length, 0);
    assert.equal(last(c, ROHAN), "The owner has decided not to refund this payment.");
    assert.deepEqual((await c.status()).refunds, { waitingForOwner: 0, beingSentAgain: 0, needBuilder: { total: 0 } });
    assert.deepEqual((await c.status()).fees, { open: 1, paid: 1 }, "the fee stays paid");
  });

  contract("Guard refuses the fee link for the licence (402) while the centre's file says 'in order': each link is asked for once, nothing is reminded without one, and a parent who asks is told to contact the centre", async () => {
    const c = await makeCentre({ mode: "guards", example: "razorpay" }); centres.push(c);
    c.guards!.payments.answer(fixture("guard-responses.json").suspended, { match: (x) => x.method === "POST" && /^\/v1\/payment_links$/u.test(x.path) });
    await c.start();
    await c.waitFor(() => lines(c, "open_fee", "confirmed").length === 2, "the two earlier months opened");
    const rohans = () => c.guards!.of("payments", "POST", /^\/v1\/payment_links$/u).filter((x) => String(x.body.reference_id ?? "").startsWith("f-2."));
    await sleep(2200); await c.settle();
    const asked = rohans().length; // 1 when the reminder hour (06:00 in India) has passed today, else 0
    assert.ok(asked <= 1);
    assert.ok(!texts(c, ROHAN).some((t) => /https?:\/\//u.test(t)), "no reminder without a link");
    await sleep(2200); await c.settle();
    assert.equal(rohans().length, asked, "a reminder Guard held back is passed over, not tried again at the next beat");
    await c.inbound(ROHAN, "I want to pay");
    assert.equal(rohans().length, asked + 1, "the parent's own request is asked once");
    assert.equal(last(c, ROHAN), "Online fee payment is paused for now. Please contact Bright Tuition Centre directly.");
    const link = lines(c, "create_fee_link").filter((l) => l.booking === "f-2").at(-1)!;
    assert.equal(link.outcome, "blocked");
    assert.equal(link.decisions[0].ruleId, LICENCE_RULE);
    assert.deepEqual((await c.status()).fees, { open: 2 }, "nothing is settled or kept to send later");
  });

  contract("in the wind-down a payment on a link sent earlier is still counted, and the parent gets the receipt", async () => {
    const c = await centre({ example: "razorpay" });
    await c.inbound(ROHAN, "pay");
    const link = linkOf(c, "f-2.1")!;
    c.writeLicence(lease("wind_down"));
    await c.waitFor(async () => (await c.call("/internal/channel/offer")).body.shop.paused === true, "the wind-down in force");
    await deliver(c, c.guards!.pay(link.id));
    assert.deepEqual((await c.status()).fees, { open: 1, paid: 1 });
    assert.match(last(c, ROHAN), /^Thank you! Bright Tuition Centre has received ₹1,800/u);
  });
});

describe("other approvers (B37)", () => {
  const RAVI = "+919800000002";
  contract("with an approvers block the owner's refund names the owner to Guard (Geo-Requested-By); another approver's reply to the relay gets no reply and no record", async () => {
    const c = await rohanPaid({ settings: { approvers: { people: [{ id: "ravi", whatsapp: RAVI, language: "en" }] } } });
    await c.inbound(ROHAN, "please refund ₹400");
    await c.inbound(OWNER_NUMBER, "approve q-1");
    const sent = refundCalls(c);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].headers["geo-requested-by"], "owner", "Guard is told the owner asked, so it does not ask the owner to approve their own refund");
    const before = c.record().length;
    await c.inbound(RAVI, "approve K7M2QX");
    await c.inbound(RAVI, "Approve", { reply: { id: "appr-approve:K7M2QX", kind: "button" } });
    assert.equal(c.record().length, before, "the relay's, not the centre's: nothing in the record");
    assert.deepEqual(c.sent(RAVI), [], "and no reply");
  });

  contract("without an approvers block the owner's refund names no one", async () => {
    const c = await rohanPaid();
    await c.inbound(ROHAN, "please refund ₹400");
    await c.inbound(OWNER_NUMBER, "approve q-1");
    assert.equal(refundCalls(c)[0].headers["geo-requested-by"], undefined);
  });
});

describe("money a webhook did not bring, or that is not the centre's (test/agent, recovery, money-clarity)", () => {
  contract("a payment event for a link the centre never made is ignored in the record and settles nothing", async () => {
    const c = await centre({ example: "razorpay" });
    await deliver(c, [{ id: "evt_x", event: "request.paid", created_at: 1, payload: { request: { id: "plink_unknown", reference_id: "zzz" } } }]);
    assert.ok(lines(c, "receive_payment_event", "blocked").some((l) => l.notes.includes("no fee has this payment link")), c.record().map((l) => `${l.action}/${l.outcome}: ${l.notes}`).join("\n"));
    assert.deepEqual((await c.status()).fees, { open: 2 });
    assert.equal(lines(c, "record_payment").length, 0);
  });

  contract("recheck_payment counts a payment the webhook never brought, by reading the payments service's own list", async () => {
    const c = await centre({ example: "razorpay" });
    await c.inbound(ROHAN, "pay");
    c.guards!.pay(linkOf(c, "f-2.1")!.id); // the money moved; the webhook is never delivered
    assert.deepEqual((await c.status()).fees, { open: 2 });
    await recover(c, "r-1", "recheck_payment", "f-2");
    assert.deepEqual((await c.status()).fees, { open: 1, paid: 1 });
    assert.equal(lines(c, "record_payment", "confirmed").filter((l) => l.booking === "f-2").length, 1);
    const rec = lines(c, "recovery").filter((l) => l.refs.recovery === "r-1");
    assert.deepEqual(rec.map((l) => l.outcome), ["attempted", "confirmed"]);
    assert.deepEqual(rec[0].refs, { action: "recheck_payment", recovery: "r-1" });
  });

  contract("a recovery that does not fit (nothing waits, no refund problem, a Bookings action) is refused in the record and changes nothing", async () => {
    const c = await centre({ example: "razorpay" });
    const before = await c.status();
    const sent = texts(c, OWNER_NUMBER).length + texts(c, ROHAN).length;
    await recover(c, "r-1", "ask_owner_again", "f-2");
    await recover(c, "r-2", "recheck_refund", "f-2");
    await recover(c, "r-3", "retry_booking", "f-2");
    assert.deepEqual(lines(c, "recovery").map((l) => l.outcome), ["blocked", "blocked", "blocked"]);
    assert.deepEqual((await c.status()).fees, before.fees);
    assert.equal(texts(c, OWNER_NUMBER).length + texts(c, ROHAN).length, sent);
    assert.equal(lines(c, "refund").length, 0);
  });

  contract("a gateway centre's owner marks cash from the page: the fee is paid and its open payment link is closed, so it cannot be paid twice", async () => {
    const c = await centre({ example: "razorpay" });
    await c.inbound(ROHAN, "pay");
    const link = linkOf(c, "f-2.1")!;
    const cash = ((await c.ownerView()).body.cash as { case: string; digest: string }[]).find((x) => x.case === "f-2");
    assert.ok(cash, "a gateway centre's owner can mark cash too");
    await c.ownerAction("cash", "f-2", cash!.digest);
    assert.deepEqual((await c.status()).fees, { open: 1, paid: 1 });
    assert.ok(lines(c, "cancel_fee_link", "confirmed").some((l) => l.booking === "f-2"), "the link that could still be paid is closed");
    assert.equal(linkOf(c, "f-2.1")!.status, "cancelled");
    assert.equal(link.id, linkOf(c, "f-2.1")!.id);
  });

  contract("a cash or bank mark that is not whole rupees, is nothing, or is more than is owed marks nothing (test/cash-part)", async () => {
    const c = await centre();
    const cash = ((await c.ownerView()).body.cash as { case: string; digest: string }[]).find((x) => x.case === "f-2")!;
    for (const amountPaise of [0, 50, 12_345, 180_100]) {
      const a = await c.ownerAction("cash", "f-2", cash.digest, { amountPaise });
      assert.ok(a.status === 200 || a.status === 400, `${amountPaise}: ${a.status}`);
    }
    assert.equal(lines(c, "owner_marked_paid").length, 0);
    assert.deepEqual((await c.status()).fees, { open: 2 });
    assert.ok(lines(c, "owner_page_action", "blocked").length >= 1, "the one more than owed is refused in the record");
  });
});

describe("the daily settlement read (accounting/settlements.ts, Deferred until 23 Nov 2026)", () => {
  contract("a Razorpay centre reads each settled day once, up to yesterday in India; a UPI centre reads none", async () => {
    const c = await centre({ example: "razorpay" });
    const read = () => lines(c, "settlements_read", "confirmed");
    await c.waitFor(() => read().length > 0, "the settlement read");
    await sleep(2200); await c.settle();
    const days = read().map((l) => l.refs.day);
    assert.equal(new Set(days).size, days.length, "each day once");
    const india = new Date(Date.now() + 330 * 60_000 - 86_400_000);
    assert.equal(days.sort().at(-1), india.toISOString().slice(0, 10), "the newest is yesterday in India");
    assert.equal(c.guards!.of("payments", "GET", /^\/v1\/settlements\/recon\/combined$/u).length, days.length, "one read of the provider for each day");
    const upi = await centre();
    await sleep(1200); await upi.settle();
    assert.equal(lines(upi, "settlements_read").length, 0);
  });
});

describe("the month and the joining day (test/family-and-joining)", () => {
  contract("joiningMidMonth prorata: a student who joined on the 20th, first seen on the 25th, is charged the 11 days left, once, due on the joining day, with no late fee yet", async () => {
    const list = students("upi").map((s) => (s.name === "Kiran Gowda" ? { ...s, joined: "2026-11-20" } : s));
    const c = await boot({ settings: { joiningMidMonth: "prorata", students: list } });
    await c.started();
    c.goto(at(25, 11));
    const kiran = () => lines(c, "open_fee", "confirmed").filter((l) => l.conversation === "+919833333333" && l.refs.month === "2026-11");
    await c.waitFor(() => kiran().length === 1, "Kiran's November fee");
    await sleep(2200);
    assert.equal(kiran().length, 1, "once");
    const [fee] = kiran();
    assert.deepEqual([fee.refs.amountPaise, fee.refs.partMonth, fee.refs.joined], ["44000", "prorata", "2026-11-20"], "₹1,200 × 11 / 30 = ₹440");
    assert.equal(lines(c, "add_late_fee").filter((l) => l.booking === fee.booking).length, 0, "no late fee yet");
  });
});

describe("the class-access rule and the back dues (test/classes)", () => {
  /** A guards Classes centre with a PDF in class 10's folder, Rohan's private link sent. */
  async function materialCentre(settings: Record<string, unknown> = {}): Promise<{ c: Centre; hash: string }> {
    const c = await makeCentre({ mode: "guards", example: "classes", settings }); centres.push(c);
    const folder = join(c.client, "materials", "class-10");
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "algebra.pdf"), "%PDF-1.4 algebra");
    await c.start();
    await c.waitFor(() => lines(c, "open_fee", "confirmed").length === 2, "the two earlier months opened");
    await c.inbound(ROHAN, "hello");
    const row = ((await c.ownerView()).body.parents as { phone: string; ref: string; digest: string }[]).find((p) => p.phone === ROHAN)!;
    await c.ownerAction("send_link", row.ref, row.digest);
    return { c, hash: c.linkOf(ROHAN)!.hash };
  }
  const material = (c: Centre, hash: string) => c.call(`/internal/channel/material?link=${hash}&batch=class-10`);

  contract("with oldDuesStopLink an unpaid back due past its grace days closes the material like any fee; marked paid, it opens", async () => {
    // Rohan's September is a back due past its grace days; by default it does not stop the class link or the material (classes.contract.test.ts reads it then)
    const { c, hash } = await materialCentre({ classes: { oldDuesStopLink: true } });
    assert.equal((await material(c, hash)).status, 404, "the stricter rule: the back due blocks");
    const cash = ((await c.ownerView()).body.cash as { case: string; digest: string }[]).find((x) => x.case === "f-2")!;
    await c.ownerAction("cash", "f-2", cash.digest);
    assert.equal((await material(c, hash)).status, 200, "paid, it opens");
  });

  contract("STOP means STOP: a contact who stopped is sent no class link and no question", async () => {
    const c = await boot({ example: "classes" });
    await c.started();
    await c.inbound(ROHAN, "STOP");
    await c.inbound(OWNER_NUMBER, "link class 10 https://meet.example/abc-defg-hij");
    c.goto(at(2, 16, 31));
    await c.waitFor(() => sends(c, SHARMA).some((l) => l.refs.templates === "class_consent_ask"), "the class's messages to the others");
    await sleep(2200);
    assert.deepEqual(sends(c, ROHAN).filter((l) => l.outcome === "confirmed" && String(l.refs.templates).startsWith("class_")), [], "nothing of Classes to Rohan");
  });
});
