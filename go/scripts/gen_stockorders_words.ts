// Writes go/internal/stockorders/words.json: every word the Go Stock orders runtime says or reads, from the TypeScript (decision 61, wave 2), so nothing is typed twice:
//   - each message of templates/commerce/stock-orders/src/language/templates.ts in en, hi, ml, kn, with `{fact}` where a value of the record goes, and which facts it needs;
//   - the status list's row, the state words, the button labels, the WhatsApp templates (meta-templates.ts: name, the message it carries, its body and how each slot is filled);
//   - the stock count's lines to the owner's app (modules/stock/words.ts) and the reader's word lists and patterns (src/reading.ts), as regular-expression sources the Go side
//     compiles with internal/language (the JavaScript matcher).
// Each template is a function of the order's facts, so it is RENDERED here with probe facts (a name like "qzitem", an amount like 7770001) and each probe's own text is turned back
// into a `{slot}`; the Go side only substitutes. Which facts a message needs is found by taking each fact away and seeing whether the function refuses (`need` throws).
// Run from the repository root:   node go/scripts/gen_stockorders_words.ts        (add --check to only compare with the committed file; words-fresh runs the check too)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LANGUAGES } from "../../modules/language/languages.ts";
import type { Language } from "../../modules/language/languages.ts";
import { MONTH_NAMES } from "../../modules/language/format.ts";
import { STOCK_LINE_WORDS } from "../../modules/stock/words.ts";
import { STATE_WORDS, TEMPLATE_NAMES, money, render } from "../../templates/commerce/stock-orders/src/language/templates.ts";
import type { MessageFacts, TemplateId } from "../../templates/commerce/stock-orders/src/language/templates.ts";
import { META_TEMPLATES, parametersFor } from "../../templates/commerce/stock-orders/src/language/meta-templates.ts";
import { LABELS } from "../../templates/commerce/stock-orders/src/language/labels.ts";
import { ENGLISH_NUMBERS, WORDS } from "../../templates/commerce/stock-orders/src/reading.ts";
import { wordRe } from "../../modules/language/dates.ts";
import { REPORT_TEMPLATE_NAMES } from "../../templates/commerce/stock-orders/report/whatsapp.ts";

export const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "internal", "stockorders", "words.json");

const TEXT = { businessName: "qzbusiness", supplierName: "qzsupplier", itemName: "qzitem", unitName: "qzunit", orderRef: "qzref", code: "QZCODE", monthLabel: "qzmonth", stateWord: "qzstate", example: "qzexample" } as const;
const AMOUNT = { unitPriceInr: 7770001, totalInr: 7770002, budgetInr: 7770003, reservedInr: 7770004, leftInr: 7770005, capInr: 7770006, limitInr: 7770007 } as const;
const COUNT = { qty: 8801, receivedQty: 8802, moreQty: 8803, saidQty: 8804, maxQty: 8805, hours: 8806 } as const;
const ROW = { ref: "qzrowref", itemName: "qzrowitem", unitName: "qzrowunit", supplierName: "qzrowsup", qty: 8811, receivedQty: 8812, totalInr: 7770011, stateWord: "qzrowstate" };

function probe(language: Language): MessageFacts {
  return { language, timeZone: "Asia/Kolkata", ...TEXT, ...AMOUNT, ...COUNT, options: ["qzopta", "qzoptb"], refs: ["qzrefa", "qzrefb"], lines: [ROW] } as MessageFacts;
}
/** The probes in the order they are looked for, longest text first so one probe is never found inside another: [text, slot]. */
function table(f: MessageFacts): [string, string][] {
  const t: [string, string][] = [];
  for (const k of Object.keys(TEXT)) t.push([String((f as Record<string, unknown>)[k]), k]);
  for (const k of Object.keys(AMOUNT)) t.push([money((f as Record<string, number>)[k]), k]);
  for (const k of Object.keys(COUNT)) t.push([String((f as Record<string, number>)[k]), k]);
  t.push(["qzopta, qzoptb", "options"], ["qzrefa, qzrefb", "refs"]);
  return t.sort((a, b) => b[0].length - a[0].length);
}
function toSlots(text: string, t: [string, string][]): string {
  let out = text;
  for (const [p, slot] of t) out = out.split(p).join(`{${slot}}`);
  if (/qz|QZ|777\d{4}|88\d\d/u.test(out)) throw new Error(`a probe was left in: ${out}`);
  return out;
}
const OPTIONAL = new Set(["options", "refs", "lines"]);

function messages(language: Language): Record<string, { text: string; needs: string[] }> {
  const f = probe(language);
  const t = table(f);
  const out: Record<string, { text: string; needs: string[] }> = {};
  for (const id of TEMPLATE_IDS) {
    let text = render(id, f);
    // the status list's rows: one probe row, written by the row template on the Go side
    if (id === "status") text = text.replace(rowLine(language), "{lines}");
    const needs: string[] = [];
    for (const k of [...Object.keys(TEXT), ...Object.keys(AMOUNT), ...Object.keys(COUNT), "options", "refs", "lines"]) {
      if (OPTIONAL.has(k) || k === "businessName") continue;
      const g = { ...f } as Record<string, unknown>;
      delete g[k];
      try { render(id, g as unknown as MessageFacts); } catch { needs.push(k); }
    }
    out[id] = { text: toSlots(text, t), needs };
  }
  return out;
}

/** The one probe row as the status template writes it. */
function rowLine(language: Language): string {
  const withRow = render("status", { ...probe(language), lines: [ROW] });
  const without = render("status", { ...probe(language), lines: [] });
  // the row is what the first text has where the second has nothing
  let i = 0;
  while (i < without.length && withRow[i] === without[i]) i++;
  return withRow.slice(i, i + withRow.length - without.length);
}
function rowTemplate(language: Language): string {
  return rowLine(language).split(ROW.ref).join("{ref}").split(money(ROW.totalInr)).join("{totalInr}").split(ROW.itemName).join("{itemName}").split(ROW.unitName).join("{unitName}")
    .split(ROW.supplierName).join("{supplierName}").split(ROW.stateWord).join("{stateWord}").split(String(ROW.qty)).join("{qty}");
}

const TEMPLATE_IDS: TemplateId[] = [
  "supplier_order", "supplier_check", "supplier_which", "supplier_unclear", "supplier_thanks_yes", "supplier_thanks_no",
  "card", "card_changed", "card_closed", "card_expired", "card_unknown", "order_declined", "order_approved",
  "sent_ok", "sent_unknown", "send_failed", "send_blocked", "owner_supplier_accepted", "owner_supplier_declined", "owner_supplier_silent", "owner_supplier_stopped",
  "received_full", "received_part", "received_wrong", "receive_too_many", "order_not_open", "paid_outside_noted", "cannot_change", "cancelled", "cannot_cancel", "no_such_order",
  "ask_line", "ask_qty", "item_unknown", "blocked_supplier", "blocked_cap", "blocked_budget", "blocked_qty", "already_open", "status", "status_empty", "didnt_understand", "owner_message_held",
];

function meta(language: Language): { name: string; usedFor: string; audience: string; body: string; params: string[] }[] {
  const f = probe(language);
  const t = table(f);
  return META_TEMPLATES.map((m) => {
    const values = parametersFor(m, language, f);
    const params = values.map((v) => { const hit = t.find(([p]) => p === v); if (!hit) throw new Error(`a template value ${v} is no probe`); return hit[1]; });
    return { name: m.name, usedFor: m.usedFor, audience: m.audience, body: m.bodies[language], params };
  });
}

function stockLines(language: Language): Record<string, string> {
  const w = STOCK_LINE_WORDS[language];
  return {
    unitRefused: w.unitRefused("qzname", "qzunit").split("qzname").join("{name}").split("qzunit").join("{unit}"),
    runningLow: w.runningLow("qzname", 8821).split("qzname").join("{name}").split("8821").join("{n}"),
    reorderAsk: w.reorderAsk("qzname", 8821, "qzsupplier").split("qzname").join("{name}").split("8821").join("{n}").split("qzsupplier").join("{supplier}"),
  };
}

export function generate(): string {
  const languages: Record<string, unknown> = {};
  for (const l of LANGUAGES) {
    languages[l] = { t: messages(l), row: rowTemplate(l), state: STATE_WORDS[l], labels: LABELS[l], meta: meta(l), stock: stockLines(l) };
  }
  const reading = {
    words: Object.fromEntries(Object.entries(WORDS).map(([k, v]) => [k, wordRe(v, "u", false).source])),
    englishNumbers: ENGLISH_NUMBERS,
  };
  return `${JSON.stringify({ generic: TEMPLATE_NAMES, reportTemplates: REPORT_TEMPLATE_NAMES, monthsEn: MONTH_NAMES.en, languages, reading }, null, 1)}\n`;
}

export function stale(file = OUT): boolean {
  try { return readFileSync(file, "utf8") !== generate(); } catch { return true; }
}

if (import.meta.main) {
  if (process.argv.includes("--check")) {
    if (stale()) { console.error(`${OUT} is out of date: run node go/scripts/gen_stockorders_words.ts`); process.exit(1); }
    console.log("stock-orders words are fresh");
  } else { mkdirSync(dirname(OUT), { recursive: true }); writeFileSync(OUT, generate()); console.log(`wrote ${OUT}`); }
}
