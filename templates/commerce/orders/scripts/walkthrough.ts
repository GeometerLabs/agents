// A walkthrough a partner can run before a visit, and read out to a shop owner: one customer's order at Annapurna Tiffins (a made-up tiffin service, UPI), on the stand-in
// services (test money, nothing real is sent), printed as the conversation the customer and the owner would see.
//   node templates/commerce/orders/scripts/walkthrough.ts [--lang hi|en|ml|kn]        (default: hi)
// The five steps are the ones the sell guide teaches (sell/guide.en.md, section 4): an order for tomorrow's lunch with its advance request, "I have paid" with nothing marked,
// the owner marks the advance received and the order is confirmed, a customer asking for a lower price, and a cancellation with the refund the owner sends. The words are
// what the agent really sends; none is typed in advance. The customer's lines are written by the shop's plan (crash-test/shop.ts), so the same sentence works in each language.
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { LANGUAGES, LANGUAGE_NAMES } from "../../../../modules/language/languages.ts";
import type { Language } from "../../../../modules/language/languages.ts";
import { UsageError, main } from "../../../../modules/report/cli.ts";
import { planShop } from "../crash-test/shop.ts";
import type { Shop } from "../crash-test/shop.ts";
import { annapurna, createWorld } from "../src/harness.ts";
import type { World } from "../src/harness.ts";
import { parseSettings } from "../src/settings.ts";
import type { Settings } from "../src/settings.ts";

/** The customer each language is shown with (their number tells the agent nothing: it goes by what they write). */
export const WALK_CUSTOMER: Record<Language, string> = { en: "+919844444444", hi: "+919811111111", ml: "+919822222222", kn: "+919866666666" };
/** A second customer, who asks for a lower price. */
export const WALK_HAGGLER = "+919833333333";
/** The price the second customer asks for, in rupees: below the menu price of ₹120. */
export const WALK_OFFER_INR = 90;
/** How many veg thalis the first customer orders. */
export const WALK_QTY = 2;

/** What the customer writes to say they have paid, and to cancel, by language. */
export const WALK_SAYS: Record<Language, { paid: string; cancel: string }> = {
  en: { paid: "I have paid", cancel: "cancel my order" },
  hi: { paid: "मैंने पेमेंट कर दिया", cancel: "ऑर्डर रद्द करें" },
  ml: { paid: "ഞാൻ പണം അടച്ചു", cancel: "ഓർഡർ റദ്ദാക്കൂ" },
  kn: { paid: "ನಾನು ಪಾವತಿಸಿದ್ದೇನೆ", cancel: "ಆರ್ಡರ್ ರದ್ದು ಮಾಡಿ" },
};

/** The example shop with the names Malayalam and Kannada customers use for its three items, so the walkthrough can be shown in all four languages. */
export function walkSettings(): Settings {
  const base = annapurna();
  const more: Record<string, { ml: string[]; kn: string[] }> = {
    "veg-thali": { ml: ["വെജ് താലി"], kn: ["ವೆಜ್ ಥಾಲಿ"] },
    "chicken-meal": { ml: ["ചിക്കൻ മീൽ"], kn: ["ಚಿಕನ್ ಮೀಲ್"] },
    curd: { ml: ["തൈര്"], kn: ["ಮೊಸರು"] },
  };
  return parseSettings({ ...base, languages: ["en", "hi", "ml", "kn"], menu: base.menu.map((m) => ({ ...m, names: { ...m.names, ...more[m.id] } })) });
}

export type Speaker = "customer" | "agent" | "owner" | "agent to owner";
export interface Step {
  /** What this step shows, in one plain line (English). */
  title: string;
  /** The lines of the conversation in this step, in order. */
  lines: { from: Speaker; text: string }[];
}

/** Runs the five steps for a language and returns what was said, and the world it was said in. */
export async function walk(language: Language): Promise<{ world: World; shop: Shop; steps: Step[]; customer: string }> {
  const settings = walkSettings();
  const planned = planShop(settings);
  if ("problem" in planned) throw new Error(planned.problem);
  const shop = planned.shop;
  const customer = WALK_CUSTOMER[language];
  const w = createWorld({ settings, nowMs: shop.startMs });
  const steps: Step[] = [];
  const seen = new Map<string, number>();
  /** The messages a number has been sent since the last look. */
  const fresh = (number: string, from: "agent" | "agent to owner"): Step["lines"] => {
    const all = w.messaging.sentTo(number).map((m) => m.text);
    const n = seen.get(number) ?? 0;
    seen.set(number, all.length);
    return all.slice(n).map((text) => ({ from, text }));
  };
  const lookAt = (who: string) => [...fresh(who, "agent"), ...fresh(w.owner, "agent to owner")];

  const order = shop.say(language, { qty: WALK_QTY });
  await w.say(order, { from: customer });
  steps.push({ title: "The customer orders for tomorrow's lunch. The agent works out the total and the advance, holds the stock, and tells the owner what to look for in their UPI app", lines: [{ from: "customer", text: order }, ...lookAt(customer)] });

  const claim = WALK_SAYS[language].paid;
  await w.say(claim, { from: customer });
  steps.push({ title: "The customer says they paid, but the owner has marked nothing. The agent will not take their word for it or a screenshot: it asks the customer to wait and tells the owner", lines: [{ from: "customer", text: claim }, ...lookAt(customer)] });

  const code = w.upiRequest(customer)!.code;
  await w.ownerMarksReceived(customer);
  steps.push({ title: "The owner sees the money in their own UPI app and marks the advance received. Only then is the order confirmed, and the owner is told what to prepare", lines: [{ from: "owner", text: `received ${code}` }, ...lookAt(customer)] });

  const lower = shop.say(language, { qty: WALK_QTY, offerInr: WALK_OFFER_INR });
  await w.say(lower, { from: WALK_HAGGLER });
  steps.push({ title: `A second customer asks for the veg thali at ₹${WALK_OFFER_INR}. The menu price is ₹120, and the agent does not go below it`, lines: [{ from: "customer", text: lower }, ...fresh(WALK_HAGGLER, "agent"), ...fresh(w.owner, "agent to owner")] });

  const cancel = WALK_SAYS[language].cancel;
  await w.say(cancel, { from: customer });
  const asked = [{ from: "customer" as const, text: cancel }, ...lookAt(customer)];
  const refundCode = w.upiRefunds(customer).find((r) => r.code !== null)?.code ?? "";
  await w.ownerMarksRefund(customer);
  steps.push({ title: "The first customer cancels more than 6 hours before the slot. The advance is owed back: the owner sends it from their own UPI app and marks it sent, and only then is the customer told", lines: [...asked, { from: "owner", text: `refunded ${refundCode}` }, ...lookAt(customer)] });
  return { world: w, shop, steps, customer };
}

const SPEAKER: Record<Speaker, string> = { customer: "Customer", agent: "Agent to the customer", owner: "Owner", "agent to owner": "Agent to the owner" };

/** The walkthrough as the script prints it. */
export function printed(language: Language, steps: Step[]): string {
  const out = [`Annapurna Tiffins, an order in ${LANGUAGE_NAMES[language]}. Stand-in services and test money: nothing real is sent.`, ""];
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
