// Writes go/internal/stockorders/testdata/settings-vectors.json: the Glow salon example settings and many mutations of it (each a hostile or sloppy file an owner or a builder might
// write) through the TypeScript's validateSettings (templates/commerce/stock-orders/src/settings.ts), so the Go settings reader (go/internal/stockorders/settings.go) is held to the
// same plain-words problems IN THE SAME ORDER, and for a file that passes, the same checked tree (the object the monthly report digests). The `assistant` block's own sentences
// (modules/assistant/settings.ts readAssistantSettings and character.ts readCharacter) are in here too: a wrong block is refused, with those words.
// Each case carries the file's TEXT (JSON.stringify of the mutation), so the order of a file's keys, which the unknown-key sentences list, is the same on both sides.
// Run from the repository root:   node go/scripts/gen_stockorders_settings.ts        (add --check to only compare with the committed file; words-fresh runs the check too)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateSettings } from "../../templates/commerce/stock-orders/src/settings.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const OUT = join(here, "..", "internal", "stockorders", "testdata", "settings-vectors.json");
const SETTINGS_FILE = join(here, "..", "..", "templates", "commerce", "stock-orders", "settings", "glow-salon.example.json");

type Mut = [name: string, change: (s: Record<string, any>) => void];
const MUTATIONS: Mut[] = [
  ["as it is", () => {}],
  ["a name with spaces round it", (s) => { s.name = "  Glow Unisex Salon \t"; }],
  ["no name and a name that is a number", (s) => { delete s.name; }],
  ["a blank name", (s) => { s.name = "   "; }],
  ["an address that is not text", (s) => { s.address = 5; }],
  ["no address", (s) => { delete s.address; }],
  ["a bad time zone", (s) => { s.timezone = "Mars/Olympus"; }],
  ["a time zone that is not text", (s) => { s.timezone = 5; }],
  ["a null time zone", (s) => { s.timezone = null; }],
  ["unknown keys in the order the file names them", (s) => { s.zeta = 1; s.alpha = 2; s.catalogue[0].colour = "red"; s.owner.email = "x"; }],
  ["no languages", (s) => { delete s.languages; }],
  ["languages with an unknown one, one twice and a number", (s) => { s.languages = ["en", "fr", "en", 5, "hi"]; }],
  ["one language: the names of the other are dropped", (s) => { s.languages = ["en"]; }],
  ["an owner that is not an object", (s) => { s.owner = "me"; }],
  ["an owner with a bad number", (s) => { s.owner.whatsapp = "98123"; }],
  ["an owner with a language that is not the shop's", (s) => { s.owner.language = "kn"; }],
  ["an owner with no language", (s) => { delete s.owner.language; }],
  ["an owner with an unknown key", (s) => { s.owner.name = "x"; }],
  ["no items and no units", (s) => { delete s.items; delete s.units; }],
  ["an empty item list", (s) => { s.items = []; }],
  ["an item that is not an object", (s) => { s.items.push(5); }],
  ["an item with a bad id", (s) => { s.items[0].id = "Hair Colour"; }],
  ["two items share an id", (s) => { s.items[1].id = s.items[0].id; }],
  ["an item with no names", (s) => { delete s.items[0].names; }],
  ["an item name that is empty", (s) => { s.items[0].names.en = ["  "]; }],
  ["an item's names with an unknown language and a name that is not a list", (s) => { s.items[0].names.fr = ["couleur"]; s.items[1].names.en = "shampoo"; }],
  ["a unit with a bad id", (s) => { s.units[0].id = "Box!"; }],
  ["two units share an id", (s) => { s.units[1].id = s.units[0].id; }],
  ["no suppliers", (s) => { delete s.suppliers; }],
  ["a supplier that is not an object", (s) => { s.suppliers.push("ravi"); }],
  ["a supplier with a bad id, no name and a bad number", (s) => { s.suppliers[0] = { id: "Ravi", whatsapp: "12" }; }],
  ["a supplier with no name", (s) => { delete s.suppliers[0].name; }],
  ["two suppliers share an id", (s) => { s.suppliers[1].id = s.suppliers[0].id; }],
  ["two suppliers share a number", (s) => { s.suppliers[1].whatsapp = s.suppliers[0].whatsapp; }],
  ["a supplier whose aliases are not a list", (s) => { s.suppliers[0].aliases = "ravi"; }],
  ["a supplier alias that is blank", (s) => { s.suppliers[0].aliases = ["ravi", " "]; }],
  ["a supplier with a language that does not exist", (s) => { s.suppliers[0].language = "fr"; }],
  ["a supplier with no language takes the first", (s) => { delete s.suppliers[0].language; }],
  ["a supplier whose approved is not true or false", (s) => { s.suppliers[0].approved = "yes"; }],
  ["a supplier that is paused", (s) => { s.suppliers[0].approved = false; }],
  ["a supplier with an unknown key", (s) => { s.suppliers[0].rating = 5; }],
  ["no catalogue", (s) => { delete s.catalogue; }],
  ["an empty catalogue", (s) => { s.catalogue = []; }],
  ["a catalogue line that is not an object", (s) => { s.catalogue.push(7); }],
  ["a line naming an unknown item, supplier and unit", (s) => { s.catalogue[0].item = "nothing"; s.catalogue[0].supplier = "nobody"; s.catalogue[0].unit = "crate"; }],
  ["a line with a price of 0, a price with three decimals and a price that is text", (s) => { s.catalogue[0].priceInr = 0; s.catalogue[1].priceInr = 10.123; s.catalogue[2].priceInr = "40"; }],
  ["a price with two decimals", (s) => { s.catalogue[1].priceInr = 37.5; }],
  ["a reorder quantity of 0, one that is not whole and one that is text", (s) => { s.catalogue[0].reorderQty = 0; s.catalogue[1].reorderQty = 2.5; s.catalogue[2].reorderQty = "6"; }],
  ["the same line twice", (s) => { s.catalogue.push({ ...s.catalogue[0] }); }],
  ["a price above the per-order cap", (s) => { s.catalogue[0].priceInr = 13000; }],
  ["a cap above the budget", (s) => { s.limits.maxPerOrderInr = 25000; }],
  ["a price above the cap with the cap above the budget", (s) => { s.catalogue[0].priceInr = 13000; s.limits.maxPerOrderInr = 25000; }],
  ["no limits", (s) => { delete s.limits; }],
  ["limits that are not an object", (s) => { s.limits = 5; }],
  ["limits not whole rupees", (s) => { s.limits.maxPerOrderInr = 120.5; s.limits.monthlyBudgetInr = 20000.25; }],
  ["limits of 0 and text", (s) => { s.limits.maxPerOrderInr = 0; s.limits.monthlyBudgetInr = "20000"; }],
  ["a maximum quantity of 0, one that is not whole and one that is left out", (s) => { s.limits.maxQuantity = 0; }],
  ["a maximum quantity that is not whole", (s) => { s.limits.maxQuantity = 2.5; }],
  ["no maximum quantity takes 500", (s) => { delete s.limits.maxQuantity; }],
  ["limits with an unknown key", (s) => { s.limits.maxPerDay = 3; }],
  ["follow-up hours left out", (s) => { delete s.followUpHours; }],
  ["follow-up hours out of order", (s) => { s.followUpHours = [24, 4]; }],
  ["follow-up hours that are empty", (s) => { s.followUpHours = []; }],
  ["follow-up hours that are not whole", (s) => { s.followUpHours = [4, 12.5]; }],
  ["follow-up hours of one", (s) => { s.followUpHours = [1]; }],
  ["an empty assistant block turns it on", (s) => { s.assistant = {}; }],
  ["an assistant block that is null", (s) => { s.assistant = null; }],
  ["an assistant block that is not an object", (s) => { s.assistant = true; }],
  ["an assistant block with an unknown key", (s) => { s.assistant = { voice: "x" }; }],
  ["a morning line off", (s) => { s.assistant = { morning: false }; }],
  ["a morning line at 07:30", (s) => { s.assistant = { morning: { at: "07:30" } }; }],
  ["a morning line at 25:00", (s) => { s.assistant = { morning: { at: "25:00" } }; }],
  ["a morning line that is a string", (s) => { s.assistant = { morning: "08:00" }; }],
  ["a talk setting for customers off", (s) => { s.assistant = { talk: { customers: false } }; }],
  ["a talk setting for customers on", (s) => { s.assistant = { talk: { customers: true } }; }],
  ["a talk setting that is wrong", (s) => { s.assistant = { talk: { customers: "no" } }; }],
  ["a talk setting with an unknown key", (s) => { s.assistant = { talk: { owner: false } }; }],
  ["a character with a name, a style and a personality", (s) => { s.assistant = { character: { name: "  Mithra ", style: "clay", personality: "warm", seed: "glow-salon-3f2a1c-4" } }; }],
  ["a character that is not an object", (s) => { s.assistant = { character: "Mithra" }; }],
  ["a character with the old look key and a voice", (s) => { s.assistant = { character: { look: "x", voice: "y" } }; }],
  ["a character name with digits", (s) => { s.assistant = { character: { name: "Mithra2" } }; }],
  ["a character name that is a number", (s) => { s.assistant = { character: { name: 5 } }; }],
  ["a character style that does not exist", (s) => { s.assistant = { character: { style: "oil" } }; }],
  ["a character seed that is wrong", (s) => { s.assistant = { character: { seed: "Not Valid!" } }; }],
  ["a character colour that is not in the palette", (s) => { s.assistant = { character: { colour: "123456" } }; }],
  ["a character paint that is not one", (s) => { s.assistant = { character: { paint: "purple" } }; }],
  ["a character personality that is not one", (s) => { s.assistant = { character: { personality: "grumpy" } }; }],
  ["a character with everything wrong and the cap above the budget", (s) => { s.assistant = { morning: "x", talk: 1, character: { name: "1", style: "z", seed: "!", colour: "q", paint: "r", personality: "s", look: 1 } }; s.limits.maxPerOrderInr = 25000; }],
  ["settings that are not an object", (s) => { for (const k of Object.keys(s)) delete s[k]; }],
];

export function generate(): string {
  const base = JSON.parse(readFileSync(SETTINGS_FILE, "utf8"));
  const cases = MUTATIONS.map(([name, change]) => {
    const s = JSON.parse(JSON.stringify(base));
    change(s);
    const input = name === "settings that are not an object" ? [] : s;
    const text = JSON.stringify(input);
    const r = validateSettings(JSON.parse(text));
    return r.ok ? { name, text, ok: true, tree: JSON.parse(JSON.stringify(r.settings)) } : { name, text, ok: false, errors: r.errors };
  });
  return `${JSON.stringify({ cases }, null, 1)}\n`;
}

export function stale(file = OUT): boolean {
  try { return readFileSync(file, "utf8") !== generate(); } catch { return true; }
}

if (import.meta.main) {
  if (process.argv.includes("--check")) {
    if (stale()) { console.error(`${OUT} is out of date: run node go/scripts/gen_stockorders_settings.ts`); process.exit(1); }
    console.log("stock-orders settings vectors are fresh");
  } else { mkdirSync(dirname(OUT), { recursive: true }); writeFileSync(OUT, generate()); console.log(`wrote ${OUT}`); }
}
