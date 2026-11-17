// Writes the review sheet a native speaker fills in: every message the Stock orders agent sends in a language, with when it is sent and what it means, and the words on its
// buttons. Hindi, Malayalam and Kannada are all machine-written, so all three get a sheet.
//   node templates/commerce/stock-orders/scripts/review-sheet.ts hi > templates/commerce/stock-orders/REVIEW-hi.md   (and ml, kn)
// The sheet is made from the templates and labels themselves, so it cannot drift from what the agent really says; a test (test/review-sheet.test.ts) fails when a committed
// sheet is missing a line. The owner's typed words ("received po-3", "paid po-3", "cancel po-3") are the same in every language and are left in Latin letters; the reader
// (src/reading.ts) also understands the words listed there, which a reviewer may extend.
import { pathToFileURL } from "node:url";
import { LANGUAGE_NAMES } from "../../../../modules/language/languages.ts";
import { MONTH_NAMES, WEEKDAY_NAMES } from "../../../../modules/language/format.ts";
import { glowSalon } from "../src/harness.ts";
import { LABELS } from "../src/language/labels.ts";
import { exampleFacts } from "../src/language/meta-templates.ts";
import { STATE_WORDS, TEMPLATES, render } from "../src/language/templates.ts";
import type { MessageFacts, TemplateId } from "../src/language/templates.ts";
import { reportStringRows, sampleOwnerText } from "../report/review.ts";
import { sampleMessage } from "../report/whatsapp.ts";

export type ReviewLanguage = "hi" | "ml" | "kn";

/** When each message is sent, in a line, so the reviewer knows what the owner or the supplier has just done. */
const WHEN: Record<TemplateId, string> = {
  supplier_order: "To the supplier: the order itself, as a WhatsApp template (the supplier has usually not written in the last day)",
  supplier_check: "To the supplier: a silent supplier is asked again about the same order (a reminder, not a new order)",
  supplier_which: "To the supplier: a bare OK while several orders wait for their answer",
  supplier_unclear: "To the supplier: their message was not an OK or a NO",
  supplier_thanks_yes: "To the supplier: their OK is noted",
  supplier_thanks_no: "To the supplier: their NO is noted",
  card: "To the owner: the order for approval, with the budget, and the code to approve or decline",
  card_changed: "To the owner: the order changed since a card was shown, so the new card follows",
  card_closed: "To the owner: a card that was answered or replaced is used again",
  card_expired: "To the owner: a card ran out (a day) and nothing was sent",
  card_unknown: "To the owner: a code that no card has",
  order_declined: "To the owner: the owner declined; nothing was sent",
  order_approved: "To the owner: approved, the budget reserved, sending now",
  sent_ok: "To the owner: the order message went to the supplier",
  sent_unknown: "To the owner: WhatsApp did not confirm the order message; it will not be sent again",
  send_failed: "To the owner: WhatsApp refused the order message; nothing went out",
  send_blocked: "To the owner: a check held the order message back (for example the supplier asked for no more messages)",
  owner_supplier_accepted: "To the owner: the supplier said OK (a template; it says this is not delivery)",
  owner_supplier_declined: "To the owner: the supplier said NO (a template); the budget is released",
  owner_supplier_silent: "To the owner: no answer after the last follow-up (a template)",
  owner_supplier_stopped: "To the owner: a supplier asked for no more messages",
  received_full: "To the owner: all of the order is marked received (the owner's own mark)",
  received_part: "To the owner: part of the order is marked received",
  received_wrong: "To the owner: the wrong item is marked",
  receive_too_many: "To the owner: more marked received than is still to come",
  order_not_open: "To the owner: a command that cannot apply to the order now, with what it is waiting on",
  paid_outside_noted: "To the owner: the owner's note that they paid outside the chat",
  cannot_change: "To the owner: an approved order cannot be changed",
  cancelled: "To the owner: an order is cancelled before it went to the supplier",
  cannot_cancel: "To the owner: an order already with the supplier cannot be cancelled here",
  no_such_order: "To the owner: an order number the agent does not have",
  ask_line: "To the owner: more than one way to order an item; a list of the ways follows",
  ask_qty: "To the owner: how many (a low-stock mark with no usual quantity)",
  item_unknown: "To the owner: an item that is not in the catalogue, with what can be ordered",
  blocked_supplier: "To the owner: the supplier is not on the approved list, or is paused",
  blocked_cap: "To the owner: the order is above the most one order may be worth",
  blocked_budget: "To the owner: the order is more than is left of the month's budget",
  blocked_qty: "To the owner: a quantity above the most one order may have (a typing slip)",
  already_open: "To the owner: a low-stock mark for something already on order",
  status: "To the owner: the open orders and the month's budget",
  status_empty: "To the owner: no open orders, and the month's budget",
  didnt_understand: "To the owner: the message was not understood, with examples",
  owner_message_held: "To the owner: a message about an order was held back because it did not match the record",
};

const cell = (text: string) => text.replace(/\|/gu, "\\|").replace(/\n/gu, " ");
const table = (head: string[], rows: string[][]) => [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`)].join("\n");
const REVIEWER = "Native reviewer: OK / change to …";
const WEEKDAYS_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** The facts a sample message is written from: the example shop's first order, 10 boxes, three more orders' worth in the status list. */
export function sampleFacts(language: "en" | ReviewLanguage): MessageFacts {
  const shop = glowSalon();
  const base = exampleFacts(shop, language);
  return {
    ...base, receivedQty: 4, moreQty: 6, saidQty: 9, maxQty: shop.limits.maxQuantity, capInr: shop.limits.maxPerOrderInr,
    stateWord: STATE_WORDS[language].sent, options: [base.itemName!], example: `order 10 ${base.unitName} ${base.itemName} from ${base.supplierName}`,
    choices: [{ supplierName: base.supplierName!, unitName: base.unitName!, priceInr: base.unitPriceInr! }],
    lines: [{ ref: "po-3", itemName: base.itemName!, unitName: base.unitName!, supplierName: base.supplierName!, qty: base.qty!, receivedQty: 0, totalInr: base.totalInr!, stateWord: STATE_WORDS[language].accepted }],
  };
}

/** The whole sheet for a language, as Markdown. */
export function reviewSheet(language: ReviewLanguage): string {
  const name = LANGUAGE_NAMES[language];
  const ids = Object.keys(TEMPLATES[language]) as TemplateId[];
  const head = ["Template id", "When it is sent", `Text (${name})`, "Meaning (the English template)", REVIEWER];
  const rows = (pick: (id: TemplateId) => boolean) => ids.filter(pick).map((id): string[] => [`\`${id}\``, WHEN[id], render(id, sampleFacts(language)), render(id, sampleFacts("en")), ""]);
  const toSupplier = (id: TemplateId) => id.startsWith("supplier_");
  const out: string[] = [];
  out.push(`# Review sheet: ${name} (${language}), Stock orders`, "");
  out.push("> **Machine-written. Waiting for a native speaker's review before any real shop sees it.**", "");
  out.push(`Every line below is what the Stock orders agent says in ${name}. In the last column write **OK**, or **change to …** with the wording you would use. Sample values are Glow Unisex Salon's (a made-up salon): 10 boxes of hair colour at ₹450 a box from Ravi Traders, a total of ₹4,500.`, "");
  out.push("What to look for first: (1) is each message polite, short and something a salon owner and a wholesaler would really send to each other; (2) are \"order\", \"supplier\", \"budget\", \"approve\", \"box\" and \"received\" the words people use; (3) the owner's typed words \"yes CODE\", \"no CODE\", \"received po-3\", \"paid po-3\", \"cancel po-3\" and \"send po-3\" stay in Latin letters, as they are typed.", "");
  out.push("Amounts are always written as ₹4,500 with Western digits; items, units, quantities, suppliers and order numbers are filled in from the shop's record, never translated.", "");
  out.push(`## 1. Messages to the supplier (${ids.filter(toSupplier).length})`, "", "The order and every ask after it are WhatsApp templates (the supplier has usually not written for a day). Meta approves the wording once, so the wording here is what is submitted.", "", table(head, rows(toSupplier)), "");
  out.push(`## 2. Messages to the owner (${ids.filter((id) => !toSupplier(id)).length})`, "", table(head, rows((id) => !toSupplier(id))), "");
  out.push("### The words for what an order is waiting on (the status list)", "", table(["Id", `Text (${name})`, "Meaning (English)", REVIEWER], (Object.keys(STATE_WORDS.en) as (keyof typeof STATE_WORDS.en)[]).map((key) => [`\`${key}\``, STATE_WORDS[language][key], STATE_WORDS.en[key], ""])), "");
  out.push("### The words on the buttons and the list", "", "A button is at most 20 letters and a label never carries an amount. A tap carries an id, so no one's words are read from these.", "");
  out.push(table(["Id", `Text (${name})`, "Meaning (English)", REVIEWER], (Object.keys(LABELS.en) as (keyof typeof LABELS.en)[]).map((key) => [`\`${key}\``, LABELS[language][key], LABELS.en[key], ""])), "");
  out.push("## 3. Months and weekdays as the agent writes them", "", table(["Weekday", `Written in ${name}`, REVIEWER], WEEKDAY_NAMES[language].map((w, i) => [WEEKDAYS_EN[i], w, ""])), "", table(["Month", `Written in ${name}`, REVIEWER], MONTH_NAMES[language].map((m, i) => [MONTHS_EN[i], m, ""])), "");
  out.push("The agent names the month of the budget in English letters (\"Nov 2026\") in every language; a reviewer may ask for the local name.", "");
  out.push("## 4. The monthly report", "");
  out.push("The report says how many orders were placed, answered by the supplier, received in full or in part, and how much of the budget was used. It never says an order was paid unless the owner marked it.", "");
  out.push("### The monthly report on WhatsApp, with sample numbers", "", "```text", sampleMessage(language), "```", "");
  out.push("### The owner's text, with sample numbers", "", "```text", sampleOwnerText(language), "```", "");
  out.push("### Every word and phrase of the report", "");
  out.push(table(["Id", `Text (${name})`, "Meaning (English)", REVIEWER], reportStringRows(language).map((r) => [`\`${r.id}\``, r.text, r.english, ""])), "");
  return out.join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const language = process.argv[2];
  if (language !== "hi" && language !== "ml" && language !== "kn") {
    console.error("Say which language: node templates/commerce/stock-orders/scripts/review-sheet.ts hi   (or ml, kn)");
    process.exitCode = 1;
  } else {
    console.log(reviewSheet(language));
  }
}
