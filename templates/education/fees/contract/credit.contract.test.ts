// The credit book (the Fees adult variant, decision 63; go/internal/fees credit.go), as the outside sees it: the shop's khata on the example hardware shop
// (settings/hardware-credit.example.json: a UPI shop, three people in the book at setup, reminders at 10:00 at most every 7 days and 4 a month, the owner's language Kannada).
//
// What it holds, each a case below:
//   - nothing reaches a customer before the owner's tap, not even weeks later; the tap sends only the first question; reminders go only after the customer's yes;
//   - the owner writes the book in words ("Ravi owes 1,500"; a name the book does not know waits for its number), on WhatsApp and on the owner's page;
//   - cash at the counter is the owner's mark ("Ravi paid 1500"), recorded as marked paid by the owner, and a reminder after a recorded payment is ZERO; a part leaves a reminder for the rest;
//   - the month's cap is per calendar month for a running account; STOP, or "no" to the first question, ends every message; a customer who writes first gets nothing about the account;
//   - who owes what is the owner's alone (their WhatsApp, their page, never a number on the page); an entry above the most one account may show is refused;
//   - on the wire, the words are an adult's about their own account, in their language; the monthly report counts what was paid after a reminder, and 0 reminders after a payment.
// Fakes mode runs on the test clock (Mon 2 Nov 2026, 09:00 in India) and is observed through the record; the guards case reads the words the WhatsApp stand-in was sent.
import { after, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DAY, MIN, at, contract, lines, makeCentre, sleep } from "./harness.ts";
import type { Centre, CentreOptions, Line } from "./harness.ts";

const OWNER = "+919845000000";
const RAMESH = "+919845011111", SURESH = "+919845022222", ANIL = "+919845033333", RAVI = "+919845044444";

const centres: Centre[] = [];
after(async () => { for (const c of centres) await c.cleanup(); });

/** The example credit shop, started, its three people opened from the settings. */
async function creditShop(o: CentreOptions = {}): Promise<Centre> {
  const c = await makeCentre({ example: "credit", ...o }); centres.push(c);
  await c.start();
  await c.waitFor(() => lines(c, "credit_add", "confirmed").length === 3, "the settings' three accounts opened");
  await c.started();
  return c;
}

const templatesOf = (l: Line): string[] => (l.refs.templates ?? "").split("+");
/** Confirmed sends of a template (to anyone, or about one number). */
const sentOf = (c: Centre, template: string, about?: string): Line[] => lines(c, "send_message", "confirmed").filter((l) => templatesOf(l).includes(template) && (about === undefined || l.conversation === about));
/** Every message that went to a customer (not the owner). */
const toCustomer = (c: Centre, phone?: string): Line[] => lines(c, "send_message", "confirmed").filter((l) => l.refs.to === "customer" && (phone === undefined || l.conversation === phone));
/** Let the beat run a few times at the clock as it is. */
const beats = () => sleep(2500);
/** The owner taps the Ask button of an account ("credit-ask:c-4"), as WhatsApp hands a button reply on. */
const tapAsk = (c: Centre, ref: string) => c.inbound(OWNER, "Ask", { reply: { id: `credit-ask:${ref}`, kind: "button" } });

describe("nothing before the owner's tap, and no reminder before the customer's yes", () => {
  contract("the book opens from the settings; three weeks pass and no customer is sent anything", async () => {
    const c = await creditShop();
    assert.deepEqual(lines(c, "credit_add", "confirmed").map((l) => l.refs.by), ["settings", "settings", "settings"]);
    assert.deepEqual(lines(c, "credit_add", "confirmed").map((l) => l.refs.amountPaise), ["240000", "785000", "60000"]);
    c.advance(21 * DAY);
    await beats();
    assert.deepEqual(toCustomer(c), [], "no message to any customer without the owner's tap");
    assert.deepEqual(lines(c, "credit_consent"), []);
    // and the record never kept a number as a ref: each line names the account
    for (const l of lines(c, "credit_add")) assert.match(l.refs.account, /^c-\d+$/u);
  });

  contract("'Ravi owes 1,500' waits for his number; the number writes it; the tap sends only the first question; his yes starts a reminder 7 days on at 10:00; the owner's mark stops every reminder after it", async () => {
    const c = await creditShop();
    await c.inbound(OWNER, "Ravi owes 1,500");
    assert.equal(sentOf(c, "owner_credit_need_number").length, 1, "the owner is asked for the number");
    assert.equal(lines(c, "credit_add", "confirmed").length, 3, "nothing written without a number");
    await c.inbound(OWNER, "Ravi 98450 44444");
    assert.equal(lines(c, "credit_account", "confirmed").length, 1);
    const entry = lines(c, "credit_add", "confirmed").at(-1)!;
    assert.equal(entry.conversation, RAVI); assert.equal(entry.refs.amountPaise, "150000"); assert.equal(entry.refs.by, "owner"); assert.equal(entry.refs.account, "c-4");
    assert.equal(sentOf(c, "owner_credit_added", RAVI).length, 1, "read back to the owner, with the Ask button");
    assert.deepEqual(toCustomer(c, RAVI), [], "nothing to Ravi yet");
    // a week with no tap: nothing
    c.advance(8 * DAY); await beats();
    assert.deepEqual(toCustomer(c, RAVI), []);
    await tapAsk(c, "c-4");
    assert.deepEqual(toCustomer(c, RAVI).map((l) => l.refs.templates), ["credit_consent_ask"], "the tap sends the first question, and only it");
    assert.equal(sentOf(c, "owner_credit_asked", RAVI).length, 1);
    c.advance(8 * DAY); await beats();
    assert.deepEqual(sentOf(c, "credit_reminder", RAVI), [], "no reminder without the yes");
    await c.inbound(RAVI, "yes");
    assert.equal(lines(c, "credit_consent", "confirmed").filter((l) => l.refs.step === "yes").length, 1);
    assert.equal(sentOf(c, "credit_consent_yes", RAVI).length, 1);
    assert.equal(sentOf(c, "owner_credit_yes", RAVI).length, 1);
    // the yes came on Mon 18 Nov; the first reminder is 7 days on, at 10:00: Wed 25 Nov 10:00 (the clock is at 18 Nov 09:00 + the seconds the test took)
    c.goto(at(25, 9, 58)); await beats();
    assert.deepEqual(sentOf(c, "credit_reminder", RAVI), [], "not before 10:00 on the seventh day");
    c.goto(at(25, 10, 1));
    await c.waitFor(() => sentOf(c, "credit_reminder", RAVI).length === 1, "the first reminder");
    await c.inbound(OWNER, "Ravi paid 1500");
    const mark = lines(c, "owner_marked_paid", "confirmed").at(-1)!;
    assert.equal(mark.refs.via, "cash"); assert.equal(mark.refs.markedBy, "owner"); assert.equal(mark.refs.amountPaise, "150000");
    assert.equal(sentOf(c, "credit_received", RAVI).length, 1, "the receipt, in the credit book's words");
    assert.equal(sentOf(c, "owner_credit_cleared", RAVI).length, 1);
    // a month on: the record shows the account paid, so not one reminder after the payment
    c.advance(35 * DAY); await beats();
    const after = lines(c, "send_message").filter((l) => l.seq > mark.seq && templatesOf(l).includes("credit_reminder") && l.outcome === "confirmed");
    assert.deepEqual(after, [], "a reminder sent after a recorded payment: zero");
  });
});

describe("parts, the month's cap and the owner's list", () => {
  contract("a part leaves a reminder for the rest; the cap is per calendar month (2 in November, then December's); 'who owes' is the owner's list", async () => {
    const c = await creditShop({ settings: { creditBook: { remindEveryDays: 1 }, reminders: { hour: 10, maxPerMonth: 2 } } });
    await c.inbound(OWNER, "ask Ramesh");
    assert.deepEqual(toCustomer(c, RAMESH).map((l) => l.refs.templates), ["credit_consent_ask"]);
    await c.inbound(RAMESH, "ಹೌದು"); // yes, in Kannada
    await c.waitFor(() => lines(c, "credit_consent", "confirmed").some((l) => l.refs.step === "yes"), "Ramesh's yes");
    await c.inbound(OWNER, "Ramesh paid 400");
    assert.equal(sentOf(c, "credit_part_received", RAMESH).length, 1, "a part: the receipt says what is left");
    assert.equal(sentOf(c, "owner_credit_paid", RAMESH).length, 1);
    c.goto(at(3, 10, 1)); await c.waitFor(() => sentOf(c, "credit_reminder", RAMESH).length === 1, "the reminder for the rest");
    c.goto(at(4, 10, 1)); await c.waitFor(() => sentOf(c, "credit_reminder", RAMESH).length === 2, "the second");
    // a held message's line names no template (the say path writes who it was for and the decisions): the cap's block on Ramesh's number is the third
    c.goto(at(5, 10, 1)); await c.waitFor(() => lines(c, "send_message", "blocked").some((l) => l.conversation === RAMESH && l.decisions.some((d) => d.ruleId === "reminder-cap" && d.verdict === "block")), "the third held by the month's cap");
    assert.equal(sentOf(c, "credit_reminder", RAMESH).length, 2);
    c.goto(at(1, 10, 1, 12)); await c.waitFor(() => sentOf(c, "credit_reminder", RAMESH).length === 3, "December's first");
    await beats();
    assert.equal(sentOf(c, "credit_reminder", RAMESH).length, 3, "after the gap, one reminder and the next a full interval on: no run of reminders on the next beats");
    await c.inbound(OWNER, "who owes");
    assert.equal(sentOf(c, "owner_credit_list").length, 1, "the list goes to the owner");
    assert.ok(toCustomer(c).every((l) => !templatesOf(l).includes("owner_credit_list")));
  });
});

describe("STOP, no, and a customer who writes first", () => {
  contract("a customer who writes before the tap gets nothing and the owner is told; 'no' to the first question is STOP; STOP ends every message; the owner's tap after it sends nothing", async () => {
    const c = await creditShop();
    await c.inbound(SURESH, "hello, how much do I owe?");
    assert.deepEqual(toCustomer(c, SURESH), [], "nothing about the account before the yes");
    assert.equal(sentOf(c, "owner_credit_wrote", SURESH).length, 1, "the owner is told");
    await c.inbound(OWNER, "ask Anil");
    await c.inbound(ANIL, "no");
    assert.equal(lines(c, "opt_out", "confirmed").filter((l) => l.conversation === ANIL).length, 1, "'no' to the first question ends the messages");
    assert.equal(sentOf(c, "owner_credit_opted_out", ANIL).length, 1);
    await c.inbound(OWNER, "ask Anil");
    assert.equal(sentOf(c, "owner_credit_stopped", ANIL).length, 1);
    await c.inbound(OWNER, "ask Ramesh");
    await c.inbound(RAMESH, "STOP");
    await c.inbound(RAMESH, "yes");
    c.advance(30 * DAY); await beats();
    assert.deepEqual(toCustomer(c, ANIL).map((l) => l.refs.templates), ["credit_consent_ask"], "Anil: the first question only");
    assert.deepEqual(toCustomer(c, RAMESH).map((l) => l.refs.templates), ["credit_consent_ask"], "Ramesh: the first question only, nothing after STOP");
  });
});

describe("the owner's page, the limits and the numbers", () => {
  contract("the page lists who owes what with no number; Ask is bound to the account as shown; words typed on the page are read as on WhatsApp; the public page names nobody", async () => {
    const c = await creditShop();
    const view = await c.ownerView();
    assert.equal(view.status, 200);
    const rows = view.body.credit as { ref: string; name: string; amountPaise: number; consent: string; askable: boolean; digest: string }[];
    assert.deepEqual(rows.map((r) => [r.name, r.amountPaise, r.consent, r.askable]), [["Suresh Electricals", 785000, "none", true], ["Ramesh", 240000, "none", true], ["Anil", 60000, "none", true]]);
    assert.ok(!JSON.stringify(rows).includes("98450"), "no number on the page's list");
    const ramesh = rows.find((r) => r.name === "Ramesh")!;
    await c.ownerAction("credit_ask", ramesh.ref, ramesh.digest);
    assert.deepEqual(toCustomer(c, RAMESH).map((l) => l.refs.templates), ["credit_consent_ask"]);
    await c.ownerAction("credit_ask", ramesh.ref, ramesh.digest);
    assert.equal(lines(c, "owner_page_action", "blocked").length, 1, "the same press again does nothing: the account is no longer as shown");
    assert.equal(toCustomer(c, RAMESH).length, 1);
    const typed = await c.channelEvents([{ kind: "owner_message", id: "page-words-1", text: "Mohan 98450 55555 owes 300" }], { owner: true });
    assert.equal(typed.status, 200); await c.settle();
    assert.equal(lines(c, "credit_add", "confirmed").at(-1)!.conversation, "+919845055555");
    const offer = await c.call("/internal/channel/offer");
    const shown = JSON.stringify(offer.body);
    for (const who of ["Ramesh", "Suresh", "Anil", "Mohan", "98450"]) assert.ok(!shown.includes(who), `the shop's public page shows ${who}`);
  });

  contract("an entry above the most one account may show is refused; 'paid' above what is owed writes nothing; a number the book cannot place is answered with the help line", async () => {
    const c = await creditShop();
    await c.inbound(OWNER, "Ramesh owes 60000");
    const refused = lines(c, "credit_add", "blocked").at(-1)!;
    assert.ok(refused.decisions.some((d) => d.ruleId === "credit-account-max" && d.verdict === "block"));
    assert.equal(sentOf(c, "owner_credit_too_much", RAMESH).length, 1);
    await c.inbound(OWNER, "Anil paid 5000");
    assert.equal(sentOf(c, "owner_credit_paid_too_much", ANIL).length, 1);
    assert.deepEqual(lines(c, "owner_marked_paid"), [], "nothing marked");
    await c.inbound(OWNER, "call 98450 12345 tomorrow");
    assert.equal(sentOf(c, "owner_credit_help").length, 1, "a number in words the book cannot read is answered by the book, never handed on");
    assert.deepEqual(toCustomer(c), []);
  });
});

describe("on the wire", () => {
  contract("the first question and the answers are an adult's about their own account, in their language; the pay link is the shop's UPI for exactly what is owed; nothing went before the tap", async () => {
    const c = await makeCentre({ mode: "guards", example: "credit" }); centres.push(c);
    await c.start();
    await c.waitFor(() => lines(c, "credit_add", "confirmed").length === 3, "the three accounts opened");
    assert.deepEqual([RAMESH, SURESH, ANIL].flatMap((p) => c.sent(p)), [], "nothing on the wire before a tap");
    await c.inbound(OWNER, "ask Suresh Electricals");
    const ask = c.sent(SURESH).map((m) => m.text).at(-1) ?? "";
    assert.match(ask, /^Hello Suresh Electricals, this is Sri Lakshmi Hardware\. Our book shows ₹7,850 to pay on your account\. May we send you payment reminders on WhatsApp\?/u);
    for (const word of ["student", "parent", "child", "fee"]) assert.ok(!ask.toLowerCase().includes(word), `the first question says "${word}"`);
    // the first question went outside the customer's window, so as a WhatsApp template (no buttons): the customer types the answer
    await c.inbound(SURESH, "YES");
    assert.match(c.sent(SURESH).at(-1)!.text, /will send you a reminder now and then while something is owed on your account/u);
    await c.inbound(SURESH, "please send the payment link");
    const pay = c.sent(SURESH).at(-1)!.text;
    assert.match(pay, /^Pay ₹7,850 on your account at Sri Lakshmi Hardware here: /u);
    assert.match(pay, /upi:\/\/pay\?pa=srilakshmihw(%40|@)oksbi/u); assert.match(pay, /am=7850/u);
    // "I have paid" marks nothing: the owner is asked to look, with a one-use code; the owner's "received <code>" is the payment record, and only then the receipt
    await c.inbound(SURESH, "I have paid");
    assert.deepEqual(lines(c, "owner_marked_paid"), [], "the customer's word marks nothing");
    const ownerTexts = () => c.sent(OWNER).map((m) => m.text);
    const code = /received ([A-Z0-9]{4,})/u.exec(ownerTexts().filter((t) => t.includes("Suresh Electricals")).reverse().find((t) => /received [A-Z0-9]{4,}/u.test(t)) ?? "")?.[1];
    assert.ok(code, `the owner was given a code: ${JSON.stringify(ownerTexts())}`);
    await c.inbound(OWNER, `received ${code} 2000`);
    const marked = lines(c, "owner_marked_paid", "confirmed").at(-1)!;
    assert.equal(marked.refs.markedBy, "owner"); assert.equal(marked.refs.amountPaise, "200000");
    assert.match(c.sent(SURESH).at(-1)!.text, /has recorded ₹2,000 paid on your account\. ₹5,850 is still to pay/u);
    await c.inbound(OWNER, "who owes");
    const list = c.sent(OWNER).map((m) => m.text).find((t) => t.includes("Suresh Electricals ₹5,850")) ?? "";
    assert.match(list, /Suresh Electricals ₹5,850, Ramesh ₹2,400, Anil ₹600/u, "the owner's list, largest first, in the owner's language");
    assert.ok(!list.includes("98450"), "no number in the list");
    // Ramesh (Kannada) is asked in Kannada
    await c.inbound(OWNER, "ask Ramesh");
    assert.match(c.sent(RAMESH).at(-1)!.text, /^ನಮಸ್ಕಾರ Ramesh, ಇದು Sri Lakshmi Hardware\. .*₹2,400/u);
  });
});

describe("with the shop's assistant on", () => {
  contract("the book's words are the book's before the assistant's; a number is never handed on; the assistant still answers what is not the book's, over credit accounts", async () => {
    const c = await makeCentre({ mode: "guards", example: "credit", settings: { assistant: {} } }); centres.push(c);
    await c.start();
    await c.waitFor(() => lines(c, "credit_add", "confirmed").length === 3, "the three accounts opened");
    await c.inbound(OWNER, "who owes");
    assert.match(c.sent(OWNER).at(-1)!.text, /Suresh Electricals ₹7,850, Ramesh ₹2,400, Anil ₹600/u, "the book's list, not the assistant's");
    await c.inbound(OWNER, "please call 98450 12345 tomorrow about the delivery");
    assert.equal(sentOf(c, "owner_credit_help").length, 1, "a number the book cannot place gets the book's help line");
    const before = c.sent(OWNER).length;
    await c.inbound(OWNER, "what needs me");
    assert.ok(c.sent(OWNER).length > before, "the assistant answered what is not the book's");
    assert.deepEqual(c.tasks().filter((t) => t.state === "failed"), [], "no step failed over a credit account");
  });
});

describe("the monthly report", () => {
  contract("November's report counts what was paid after a reminder and the reminders after a recorded payment (0), and names nobody", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "credit-report-")), "reports");
    mkdirSync(dir, { recursive: true });
    const c = await creditShop({ settings: { creditBook: { remindEveryDays: 1 } }, runtime: { report: { preparedBy: "Ravi, local Operator", innovator: false, pageBaseUrl: "https://reports.example/r", pagesDir: dir, source: "test-mode" } } });
    await c.inbound(OWNER, "ask Ramesh");
    await c.inbound(RAMESH, "yes");
    c.goto(at(3, 10, 1)); await c.waitFor(() => sentOf(c, "credit_reminder", RAMESH).length === 1, "a reminder");
    c.advance(30 * MIN);
    await c.inbound(OWNER, "Ramesh paid 1000");
    c.goto(at(4, 10, 1)); await c.waitFor(() => sentOf(c, "credit_reminder", RAMESH).length === 2, "the reminder for the rest");
    await c.inbound(OWNER, "Ramesh paid 1400");
    const folders = () => (existsSync(dir) ? readdirSync(dir).filter((f) => readdirSync(join(dir, f)).some((x) => x.startsWith("report-"))) : []);
    c.goto(at(1, 9, 30, 12));
    await c.waitFor(() => folders().length === 1, "one report folder");
    await sleep(1500);
    const folder = join(dir, folders()[0]);
    const text = readFileSync(join(folder, "report-2026-11.json"), "utf8");
    const doc = JSON.parse(text) as Record<string, any>;
    const report = (doc.document ?? doc) as Record<string, any>;
    assert.deepEqual(report.credit, { owedAtStart: { count: 0, paise: 0 }, collectedAfterReminder: { count: 2, paise: 240000 }, remindersSent: 2, remindersAfterPaid: 0 });
    for (const f of readdirSync(folder)) {
      const t = readFileSync(join(folder, f), "utf8");
      for (const who of ["Ramesh", "Suresh", "Anil", "98450"]) assert.ok(!t.includes(who), `${f} names ${who}`);
    }
  });
});
