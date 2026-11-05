// A walkthrough a partner can run before a visit, and read out to a centre owner: one parent's month at Bright Tuition Centre, on the stand-in services (test money,
// nothing real is sent), printed as the conversation the parent and the owner would see.
//   node pathways/fees/scripts/walkthrough.ts [--lang hi|en|ml|kn]        (default: hi)
// The five steps are the ones the sell guide teaches (sell/guide.en.md, section 4): the reminder with its payment link, "I already paid" when the record shows
// nothing, a discount that goes to the owner, the payment and the receipt, and no reminder once paid. The words are what the agent really sends; none is typed in advance.
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { LANGUAGES, LANGUAGE_NAMES } from "../../../modules/language/languages.ts";
import type { Language } from "../../../modules/language/languages.ts";
import { UsageError, main } from "../../../modules/report/cli.ts";
import { SAYS } from "../crash-test/says.ts";
import { KIRAN_PARENT, MEERA_PARENT, ROHAN_PARENT, SHARMA_PARENT, createWorld } from "../src/harness.ts";
import type { World } from "../src/harness.ts";

/** The student and the parent each language is shown with, in the example centre's own settings. */
export const WALK: Record<Language, { student: string; parent: string }> = {
  en: { student: "Rohan Mehta", parent: ROHAN_PARENT },
  hi: { student: "Anaya Sharma", parent: SHARMA_PARENT },
  ml: { student: "Meera Nair", parent: MEERA_PARENT },
  kn: { student: "Kiran Gowda", parent: KIRAN_PARENT },
};

/** How much the parent asks to have taken off: above the example centre's limit of ₹100, so it goes to the owner. */
export const WALK_DISCOUNT_INR = 300;

export type Speaker = "parent" | "agent" | "owner" | "agent to owner";
export interface Step {
  /** What this step shows, in one plain line (English). */
  title: string;
  /** The lines of the conversation in this step, in order. */
  lines: { from: Speaker; text: string }[];
}

/** Runs the five steps for a language and returns what was said, and the world it was said in. */
export async function walk(language: Language): Promise<{ world: World; steps: Step[] }> {
  const { student, parent } = WALK[language];
  const w = createWorld();
  const steps: Step[] = [];
  const seen = new Map<string, number>();
  /** The messages a number has been sent since the last look, about this student's fee only (a parent with two children is also written to about the other). */
  const fresh = (number: string, from: "agent" | "agent to owner"): Step["lines"] => {
    const all = w.messaging.sentTo(number).map((m) => m.text);
    const n = seen.get(number) ?? 0;
    seen.set(number, all.length);
    return all.slice(n).filter((text) => text.includes(student) || number === w.owner).map((text) => ({ from, text }));
  };
  const lookAt = () => [...fresh(parent, "agent"), ...fresh(w.owner, "agent to owner")];

  await w.goto({ year: 2026, month: 11, day: 2 });
  steps.push({ title: "The first reminder goes out on its own, in the parent's language, with a payment link for exactly this fee", lines: fresh(parent, "agent") });
  fresh(w.owner, "agent to owner");

  const claim = SAYS[language].paid;
  await w.say(claim, { from: parent });
  steps.push({ title: "The parent says they already paid, but the payment record shows nothing. The agent will not take their word for it: it says what it can see, and tells the owner", lines: [{ from: "parent", text: claim }, ...lookAt()] });

  const ask = SAYS[language].discountOff(WALK_DISCOUNT_INR);
  await w.say(ask, { from: parent });
  const asked = [{ from: "parent" as const, text: ask }, ...lookAt()];
  await w.ownerSays("approve q-1");
  steps.push({ title: `The parent asks for ₹${WALK_DISCOUNT_INR} off. That is above the centre's ₹100 limit, so the agent cannot do it itself: the owner is asked, and approves that exact amount, and the parent gets a new link for the new amount`, lines: [...asked, { from: "owner", text: "approve q-1" }, ...lookAt()] });

  w.pays(student);
  await w.deliverPaymentEvents();
  steps.push({ title: "The parent pays through the new link. The agent reads the payment from the payments service's own record, and only then sends the receipt", lines: lookAt() });

  await w.goto({ year: 2026, month: 11, day: 5 });
  await w.goto({ year: 2026, month: 11, day: 10 });
  await w.goto({ year: 2026, month: 11, day: 15 });
  steps.push({ title: "The due day, the grace days and the later reminder days all pass. Nothing is sent about a fee that the record shows paid", lines: lookAt() });
  return { world: w, steps };
}

const SPEAKER: Record<Speaker, string> = { parent: "Parent", agent: "Agent to the parent", owner: "Owner", "agent to owner": "Agent to the owner" };

/** The walkthrough as the script prints it. */
export function printed(language: Language, steps: Step[]): string {
  const out = [`Bright Tuition Centre, a month of fees in ${LANGUAGE_NAMES[language]}. Stand-in services and test money: nothing real is sent.`, ""];
  steps.forEach((s, i) => {
    out.push(`${i + 1}. ${s.title}`);
    if (s.lines.length === 0) out.push("   (nothing is sent)");
    for (const l of s.lines) out.push(`   ${SPEAKER[l.from]}: ${l.text.replace(/\n/g, "\n      ")}`);
    out.push("");
  });
  return out.join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(async () => {
    let args;
    try { args = parseArgs({ args: process.argv.slice(2), options: { lang: { type: "string" } } }); } catch (e) { throw new UsageError((e as Error).message); }
    const language = (args.values.lang ?? "hi") as Language;
    if (!(LANGUAGES as readonly string[]).includes(language)) throw new UsageError(`Say the language: --lang ${LANGUAGES.join(" | ")}`);
    console.log(printed(language, (await walk(language)).steps));
  });
}
