// Writes go/internal/stockorders/testdata/vectors.json: what the TypeScript of Stock orders makes of real facts and real words, for the Go twin to be proved equal on:
//   - every message (src/language/templates.ts render) in en, hi, ml, kn, from the example shop's own order, with the outgoing check's verdict over it (limits.ts
//     checkMessageMatchesRecord): the Go side renders from words.json and must write the same text, which the check must allow;
//   - the owner's words read by the rules (src/reading.ts readOwnerText, quantityIn) over a list of phrases in four languages.
// Run from the repository root:   node go/scripts/gen_stockorders_vectors.ts        (add --check to only compare with the committed file; words-fresh runs the check too)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LANGUAGES } from "../../modules/language/languages.ts";
import { render } from "../../templates/commerce/stock-orders/src/language/templates.ts";
import type { MessageFacts, TemplateId } from "../../templates/commerce/stock-orders/src/language/templates.ts";
import { checkMessageMatchesRecord } from "../../templates/commerce/stock-orders/src/limits.ts";
import { parseSettings } from "../../templates/commerce/stock-orders/src/settings.ts";
import { quantityIn, readOwnerText } from "../../templates/commerce/stock-orders/src/reading.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const OUT = join(here, "..", "internal", "stockorders", "testdata", "vectors.json");
const SETTINGS_FILE = join(here, "..", "..", "templates", "commerce", "stock-orders", "settings", "glow-salon.example.json");

const IDS: TemplateId[] = ["supplier_order", "supplier_check", "supplier_which", "supplier_unclear", "supplier_thanks_yes", "supplier_thanks_no", "card", "card_changed", "card_closed",
  "card_expired", "card_unknown", "order_declined", "order_approved", "sent_ok", "sent_unknown", "send_failed", "send_blocked", "owner_supplier_accepted", "owner_supplier_declined",
  "owner_supplier_silent", "owner_supplier_stopped", "received_full", "received_part", "received_wrong", "receive_too_many", "order_not_open", "paid_outside_noted", "cannot_change",
  "cancelled", "cannot_cancel", "no_such_order", "ask_line", "ask_qty", "item_unknown", "blocked_supplier", "blocked_cap", "blocked_budget", "blocked_qty", "already_open", "status",
  "status_empty", "didnt_understand", "owner_message_held"];

const NAMES: Record<string, [string, string]> = { en: ["hair colour", "box"], hi: ["हेयर कलर", "डिब्बा"], ml: ["ഹെയർ കളർ", "ബോക്സ്"], kn: ["ಹೇರ್ ಕಲರ್", "ಬಾಕ್ಸ್"] };

function factsIn(language: (typeof LANGUAGES)[number]): MessageFacts {
  const [itemName, unitName] = NAMES[language];
  return {
    language, timeZone: "Asia/Kolkata", businessName: "Glow Unisex Salon", supplierName: "Ravi Traders", itemName, unitName, qty: 12, unitPriceInr: 175.5, totalInr: 2106,
    orderRef: "po-7", code: "K7M2QX", budgetInr: 20000, reservedInr: 4500, leftInr: 13394, capInr: 12000, receivedQty: 4, moreQty: 8, saidQty: 13, maxQty: 200, hours: 24,
    monthLabel: "Nov 2026", stateWord: "sent, no answer yet", options: ["hair colour", "shampoo"], refs: ["po-7", "po-8"], example: "order 10 box hair colour from Ravi Traders",
    lines: [{ ref: "po-7", itemName, unitName, supplierName: "Ravi Traders", qty: 12, receivedQty: 4, totalInr: 2106, stateWord: "part received" }],
  };
}

const PHRASES = [
  "order 10 boxes of hair colour from Ravi Traders", "order 10 hair colour", "shampoo from ravi is low", "order hair oil from meena", "received po-3", "received po-3 6", "wrong po-3",
  "paid po-3", "cancel po-3", "send po-3", "change po-3 12", "status", "what is open", "good morning", "order 5 soap", "order 10 boxes of hair colour from Sharma Stores",
  "order 201 bottles of shampoo from ravi", "send me 10 boxes of hair colour", "received", "monthly budget at most ₹15000", "order twelve towels from meena", "order 1,000 towels",
  "po 12 received 4", "हेयर कलर खत्म", "रवि से 10 डिब्बा हेयर कलर मंगाओ", "ഷാംപൂ തീർന്നു", "ಶಾಂಪೂ ಮುಗಿದಿದೆ", "order ₹450 hair colour 3 box", "order 10.5 towels", "order 2x towels",
];

export function generate(): string {
  const settings = parseSettings(JSON.parse(readFileSync(SETTINGS_FILE, "utf8")));
  const messages = LANGUAGES.flatMap((language) => IDS.map((id) => {
    const facts = factsIn(language);
    const text = render(id, facts);
    return { language, id, text, check: checkMessageMatchesRecord({ text, facts }).verdict };
  }));
  const readings = PHRASES.map((text) => ({ text, reading: readOwnerText(settings, text), qty: quantityIn(text) ?? null }));
  return `${JSON.stringify({ settings: JSON.parse(readFileSync(SETTINGS_FILE, "utf8")), facts: Object.fromEntries(LANGUAGES.map((l) => [l, factsIn(l)])), messages, readings }, null, 1)}\n`;
}

export function stale(file = OUT): boolean {
  try { return readFileSync(file, "utf8") !== generate(); } catch { return true; }
}

if (import.meta.main) {
  if (process.argv.includes("--check")) {
    if (stale()) { console.error(`${OUT} is out of date: run node go/scripts/gen_stockorders_vectors.ts`); process.exit(1); }
    console.log("stock-orders vectors are fresh");
  } else { mkdirSync(dirname(OUT), { recursive: true }); writeFileSync(OUT, generate()); console.log(`wrote ${OUT}`); }
}
