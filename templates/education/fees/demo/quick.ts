// The Fees agent's hosted demo shop (modules/demo/quick.ts draws the page): Bright Tuition Centre, the example centre, on the Razorpay example settings so a parent can
// pay with test money. The agent is the real one on the template's own in-memory stand-ins. The visitor is a parent (one of the example families, whose own language is
// the demo's language), and the other tab is the owner's WhatsApp. The first reminder is due on the first morning, so the demo opens with it already sent.
import { formatInr } from "../../../../modules/language/format.ts";
import type { Language } from "../../../../modules/language/languages.ts";
import type { QuickShop } from "../../../../modules/demo/quick.ts";
import { readFileSync } from "node:fs";
import { createWorld } from "../src/harness.ts";
import { parseSettings } from "../src/settings.ts";

/** The example families by language: the parent's number (in the settings' roll) and the student whose fee is the one to pay. */
const FAMILY: Record<Language, { parent: string; student: string; tab: string; chips: string[] }> = {
  en: { parent: "+919844444444", student: "Rohan Mehta", tab: "Parent", chips: ["I already paid the fee", "STOP"] },
  hi: { parent: "+919811111111", student: "Aarav Sharma", tab: "अभिभावक", chips: ["मैंने फ़ीस भर दी है", "STOP"] },
  ml: { parent: "+919822222222", student: "Meera Nair", tab: "രക്ഷിതാവ്", chips: ["ഞാൻ ഫീസ് അടച്ചു", "STOP"] },
  kn: { parent: "+919833333333", student: "Kiran Gowda", tab: "ಪೋಷಕರು", chips: ["ನಾನು ಫೀಸ್ ಕಟ್ಟಿದ್ದೇನೆ", "STOP"] },
};

export async function feesShop(language: Language): Promise<QuickShop> {
  const raw = JSON.parse(readFileSync(new URL("../settings/bright-tuition.example.json", import.meta.url), "utf8"));
  raw.owner = { ...raw.owner, language }; // the owner reads the demo in the language chosen
  const settings = parseSettings(raw);
  const world = createWorld({ settings });
  const f = FAMILY[language];
  await world.advance(24 * 60); // the day before the reminder day: the reminders go out as the first morning ends
  return {
    world, shopName: settings.name, language, timezone: settings.timezone, customer: f.parent, customerTab: f.tab, chips: f.chips,
    payable: () => { const link = world.linkFor(f.student); return link?.status === "created" ? { label: formatInr(link.amount / 100) } : undefined; },
    payNow: () => world.pays(f.student),
  };
}
