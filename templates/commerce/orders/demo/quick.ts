// The Orders agent's hosted demo shop (modules/demo/quick.ts draws the page): Annapurna Tiffins, the example shop, on the UPI example settings, as an Operator's shop mostly is: the customer taps "I have paid" and the owner (the other tab)
// marks the money received, as the guide's walkthrough shows. Nothing is paid in the page. The agent is the real one, on the template's own in-memory stand-ins; the visitor is a customer, and the other tab is the owner's WhatsApp.
// What this file adds is only the choice of language (every language the agent speaks, so the same shop can be shown in any) and the customer's words to try.
import { readFileSync } from "node:fs";
import { LANGUAGES } from "../../../../modules/language/languages.ts";
import type { Language } from "../../../../modules/language/languages.ts";
import type { QuickShop } from "../../../../modules/demo/quick.ts";
import { AMIT, createWorld } from "../src/harness.ts";
import { parseSettings } from "../src/settings.ts";

/**
 * The words a customer might start with, per language: a greeting (the agent answers with its menu) and one whole order, written the way the crash-test plan writes it
 * (crash-test/shop.ts `say`, so it is a sentence the agent reads): two veg thalis for tomorrow's lunch, pickup. The demo's clock starts on Monday 9 November 2026.
 */
const CHIPS: Record<Language, string[]> = {
  en: ["Hi", "2 veg thali 10 nov 12:00 pm pickup"],
  hi: ["नमस्ते", "2 वेज थाली 10 nov 12:00 pm पिकअप"],
  ml: ["ഹലോ", "2 veg thali 10 nov 12:00 pm പിക്കപ്പ്"],
  kn: ["ನಮಸ್ಕಾರ", "2 veg thali 10 nov 12:00 pm ಪಿಕಪ್"],
};

/** What Malayalam and Kannada customers call the example menu's three items (the settings file names them in English and Hindi only; the same names the walkthrough uses). */
const MORE_NAMES: Record<string, { ml: string[]; kn: string[] }> = {
  "veg-thali": { ml: ["വെജ് താലി"], kn: ["ವೆಜ್ ಥಾಲಿ"] },
  "chicken-meal": { ml: ["ചിക്കൻ മീൽ"], kn: ["ಚಿಕನ್ ಮೀಲ್"] },
  curd: { ml: ["തൈര്"], kn: ["ಮೊಸರು"] },
};

export async function ordersShop(language: Language): Promise<QuickShop> {
  const raw = JSON.parse(readFileSync(new URL("../settings/annapurna-tiffins.example.json", import.meta.url), "utf8"));
  raw.languages = [language, ...LANGUAGES.filter((l) => l !== language)];
  raw.owner = { ...raw.owner, language };
  for (const item of raw.menu) item.names = { ...item.names, ...MORE_NAMES[item.id] };
  for (const item of raw.menu) for (const l of raw.languages) item.names[l] ??= [...item.names.en];
  const settings = parseSettings(raw);
  const world = createWorld({ settings });
  return {
    world, shopName: settings.name, language, timezone: settings.timezone, customer: AMIT, chips: CHIPS[language],
    payable: () => undefined, // a UPI shop has no payment link to pay in the page: the owner marks the money received
  };
}
