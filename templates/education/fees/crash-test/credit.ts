// The crash-test situations of a shop that keeps a credit book (the Fees adult variant, decision 63's job 1; go/internal/fees credit.go). They run on the shop's own Go program
// and on its own settings: the people already in the book at setup, its reminder hour and interval. Like every situation they judge from the record the program keeps (which
// message went to whom, confirmed by the stand-in WhatsApp), never from what the program said it did. From the credit book's contract cases (contract/credit.contract.test.ts):
//   1. nothing reaches a customer before the owner's tap, not even weeks later;
//   2. the owner's tap sends the first question and only it, and no reminder goes before the customer's yes;
//   3. after the yes, a reminder goes on the day the interval is up, at the reminder hour, not before;
//   4. after a payment the owner marks ("<name> paid <amount>"), not one reminder more.
import { caseAskedSituation } from "../../../../modules/crash-test/case-asked.ts";
import { DAY, MINUTE, addDays, localParts, zonedToMs } from "../../../../modules/core/time.ts";
import { checker } from "../../../../modules/crash-test/situations.ts";
import type { Situation, Skipped } from "../../../../modules/crash-test/situations.ts";
import type { Settings } from "../src/settings.ts";
import { createGoWorld } from "./go-world.ts";
import type { GoWorld as World } from "./go-world.ts";

/** The credit book's situations, and the ones these settings cannot express. */
export function creditSituations(settings: Settings): { situations: Situation[]; skipped: Skipped[] } {
  const book = settings.creditBook!;
  const person = book.people[0];
  if (!person) return { situations: [], skipped: [{ id: "credit", title: "The credit book", reason: "nobody is in the book at setup, so there is no account to ask about" }] };
  const tz = settings.timezone;
  const startMs = zonedToMs({ year: 2026, month: 11, day: 2 }, { hour: 9, minute: 0 }, tz);
  const every = book.remindEveryDays;
  const hour = settings.reminders.hour;
  const world = async (): Promise<World> => {
    const w = await createGoWorld({ settings, nowMs: startMs });
    // the book opens from the settings on the program's first steps: every person written once, by the settings
    await w.waitFor("the book's accounts opened from the settings", () => lines(w, "credit_add", "confirmed").length >= book.people.length);
    return w;
  };
  const lines = (w: World, action: string, outcome?: string) => w.record.entries().filter((e) => e.action === action && (outcome === undefined || e.outcome === outcome));
  const templatesOf = (e: { refs?: Record<string, string> }): string[] => String(e.refs?.templates ?? "").split("+");
  /** Messages that went (confirmed) to a customer, not the owner: to one number, or to anyone. */
  const toCustomer = (w: World, phone?: string) => lines(w, "send_message", "confirmed").filter((e) => e.refs?.to === "customer" && (phone === undefined || e.conversation === phone));
  const sentOf = (w: World, template: string, about?: string) => lines(w, "send_message", "confirmed").filter((e) => templatesOf(e).includes(template) && (about === undefined || e.conversation === about));
  /** The owner asks for the person's yes, in the owner's command words (Latin letters, as every owner command). */
  const ask = (w: World) => w.ownerSays(`ask ${person.name}`);
  const nextBeat = async (w: World, ms: number) => { w.clock.set(ms); await w.tick(); };
  const reminderAt = (fromMs: number, minutes: number): number => { const d = addDays(localParts(fromMs, tz), every); return zonedToMs(d, { hour, minute: 0 }, tz) + minutes * MINUTE; };

  const situations: Situation[] = [
    {
      id: "credit-nothing-before-tap", title: "Nothing reaches a customer before the owner's tap, not even three weeks later",
      how: `the book opens with ${book.people.length} people from the settings; the shop's clock moves on three weeks`,
      async run() {
        const { results, expect } = checker();
        const w = await world();
        expect(`The book holds the ${book.people.length} people of the settings, each written once`, lines(w, "credit_add", "confirmed").filter((e) => e.refs?.by === "settings").length === book.people.length);
        await nextBeat(w, w.clock.now() + 21 * DAY);
        expect("No message to any customer without the owner's tap", toCustomer(w).length === 0, toCustomer(w).map((e) => e.refs?.templates).join());
        expect("No first question was asked", lines(w, "credit_consent").length === 0);
        return results;
      },
    },
    {
      id: "credit-tap-first-question", title: "The owner's tap sends the first question and only it; no reminder before the customer's yes",
      how: `the owner asks ${person.name}; the clock moves on past the reminder interval (${every} days) with no answer`,
      async run() {
        const { results, expect } = checker();
        const w = await world();
        await ask(w);
        expect(`${person.name} got the first question and nothing else`, toCustomer(w, person.phone).map((e) => e.refs?.templates).join() === "credit_consent_ask", toCustomer(w, person.phone).map((e) => e.refs?.templates).join());
        expect("Nobody else got anything", toCustomer(w).every((e) => e.conversation === person.phone));
        await nextBeat(w, w.clock.now() + (every + 1) * DAY);
        expect("No reminder without the yes", sentOf(w, "credit_reminder").length === 0);
        return results;
      },
    },
    {
      id: "credit-reminder-after-yes", title: "After the customer's yes, a reminder goes when the interval is up, at the reminder hour, not before",
      how: `the owner asks ${person.name}, who says yes; the clock reaches two minutes before ${hour}:00 on the ${every}th day, then one minute after`,
      async run() {
        const { results, expect } = checker();
        const w = await world();
        await ask(w);
        await w.say("yes", { from: person.phone });
        const yesAt = w.clock.now();
        expect("The yes is in the record, and the customer and the owner were told", lines(w, "credit_consent", "confirmed").some((e) => e.refs?.step === "yes") && sentOf(w, "credit_consent_yes", person.phone).length === 1 && sentOf(w, "owner_credit_yes", person.phone).length === 1);
        await nextBeat(w, reminderAt(yesAt, -2));
        expect(`No reminder before ${hour}:00 on the ${every}th day`, sentOf(w, "credit_reminder", person.phone).length === 0);
        await nextBeat(w, reminderAt(yesAt, 1));
        expect("Then exactly one reminder", sentOf(w, "credit_reminder", person.phone).length === 1, String(sentOf(w, "credit_reminder", person.phone).length));
        return results;
      },
    },
    {
      id: "credit-none-after-payment", title: "After a payment the owner marks, not one reminder more",
      how: `${person.name} says yes and is reminded once; the owner writes "${person.name} paid ${person.amountInr}"; the clock moves on five weeks`,
      async run() {
        const { results, expect } = checker();
        const w = await world();
        await ask(w);
        await w.say("yes", { from: person.phone });
        await nextBeat(w, reminderAt(w.clock.now(), 1));
        expect("One reminder before the payment", sentOf(w, "credit_reminder", person.phone).length === 1);
        await w.ownerSays(`${person.name} paid ${person.amountInr}`);
        const mark = lines(w, "owner_marked_paid", "confirmed").at(-1);
        expect(`The owner's mark is the payment record: cash, marked by the owner, ₹${person.amountInr}`, mark?.refs?.via === "cash" && mark?.refs?.markedBy === "owner" && mark?.refs?.amountPaise === String(person.amountInr * 100), JSON.stringify(mark?.refs));
        expect("The customer got the receipt", sentOf(w, "credit_received", person.phone).length === 1);
        const seq = w.record.entries().length;
        for (let week = 1; week <= 5; week++) await nextBeat(w, w.clock.now() + 7 * DAY);
        const after = w.record.entries().slice(seq).filter((e) => e.action === "send_message" && e.outcome === "confirmed" && templatesOf(e).includes("credit_reminder"));
        expect("Reminders sent after the recorded payment: zero", after.length === 0, String(after.length));
        return results;
      },
    },
    // 25 Nov 2026 (modules/crash-test/case-asked.ts): an account named from a number that holds none, in the credit book's own words; the owner's entry opens the account's fee
    caseAskedSituation({
      noun: "account", world,
      open: async (w) => {
        const theirs = () => [...w.store.dues.values()].reverse().find((d) => d.customer === person.phone)?.id;
        if (!theirs()) await w.ownerSays(`${person.name} owes 500`); // the settings' amount opened one already, unless it was zero
        const ref = theirs() ?? "f-1";
        return { ref, customer: person.phone };
      },
      state: (w, ref) => { const d = w.store.dues.get(ref); return JSON.stringify([d?.state, d?.payments.length ?? 0]); },
      customerTemplate: "credit_case_other_number", ownerTemplate: "owner_credit_case_other_number",
      ask: (ref) => `What about ${ref}? It is my father's account`, falseRef: "f-99",
    }),
  ];
  return { situations, skipped: [] };
}
