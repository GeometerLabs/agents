// What a native reader sees of the panel's words: every line, with its English meaning beside it, in the same style as sections 1 to 6 of
// REVIEW-ml.md and REVIEW-kn.md. The section is APPENDED to those sheets (section 7). scripts/review-sheet.ts in the pathway writes sections 1 to 6; the
// whole sheet is made by:
//   node bundle/panel/review-sheet.ts ml > templates/commerce/bookings/REVIEW-ml.md
//   node bundle/panel/review-sheet.ts kn > templates/commerce/bookings/REVIEW-kn.md
// and test/words.test.ts fails when a committed sheet is behind the words.
import { GATEWAYS } from "../../modules/payments/providers/index.ts";
import { LANGUAGE_NAMES } from "../../modules/language/languages.ts";
import type { Language } from "../../modules/language/languages.ts";
import { WORDS } from "./languages.ts";
import { SAMPLE_ARGS } from "./words.ts";
import { HEALTH_SAMPLE_ARGS, HEALTH_WORDS } from "./words-health.ts";
import { AGENT_SAMPLE_ARGS, AGENT_WORDS } from "./words-agents.ts";
import { loadVoteRound } from "./votes.ts";
import { WORDS as PAGES_BLOCK_WORDS } from "./views-pages.ts";
import { WORDS as DOOR_WORDS } from "../services/door-pages.ts";
import { FIRST_WORDS } from "../../modules/channels/words-owner-first.ts";
import { PERSONALITIES, SMALL_TALK } from "../../modules/assistant/personality.ts";
import { cardQuestion, write as writeAssistant } from "../../modules/assistant/words.ts";
import type { MessageData } from "../../modules/assistant/words.ts";
import { NOTE_LABELS } from "../../modules/assistant/words-memory.ts";
import { limitReviewLines } from "../../modules/assistant/limits-card.ts";
import { LIMIT_WORDS } from "../../modules/limits/chat-limit-kinds.ts";
import { WORDS as LIMITS_PANEL_WORDS } from "./views-limits.ts";
import { OWNER_MONEY } from "../../modules/channels/words-money.ts";
import { STOCK_WORDS } from "../../modules/channels/words-stock.ts";
import { STOCK_PANEL_WORDS } from "./stock.ts";
import { WORDS as LIMITS_OWNER_WORDS } from "../../modules/channels/owner-limits-page.ts";
import { CHAT, QUICK } from "../../modules/channels/words-chat.ts";
import { CHAT_MORE } from "../../modules/channels/words-chat-more.ts";
import { CHAT_GUEST } from "../../modules/channels/chat-guest.ts";

/**
 * Stock orders (17 Nov 2026): the owner page's words for what waits (ids "stock.owner.*"), the phone setup's forms and refusals and the shop page's lines (ids "stock.panel.*"), each with
 * made-up values so a native reviewer reads whole sentences. The card for a supplier order and the two limits' words are with "card.stock-orders.*" and "limits.assistant.*".
 */
const stockSamples: Record<string, unknown[]> = {
  "stock.owner.approve": ["Ravi Traders", "10 box hair colour", "₹12,000"], "stock.owner.silent": ["Ravi Traders", "po-3: 10 box hair colour"], "stock.owner.receive": ["Ravi Traders", "po-3: 10 box hair colour"], "stock.owner.unsure": ["Ravi Traders", "po-3"], "stock.owner.refused": ["Ravi Traders", "po-3", "10:30"],
  "stock.panel.problems.tooManySuppliers": [12], "stock.panel.problems.supplierBad": [2], "stock.panel.problems.supplierTwice": [2, "Ravi Traders"], "stock.panel.problems.numberTwice": [2],
  "stock.panel.problems.tooManyLines": [40], "stock.panel.problems.lineBad": [3], "stock.panel.problems.lineSupplier": [3, "Ravi"], "stock.panel.problems.priceBad": [3], "stock.panel.problems.reorderBad": [3],
  "stock.panel.problems.lineTwice": [3], "stock.panel.problems.capAbovePrice": ["₹1,200"], "stock.panel.shop.messages.line": [6],
};
const stockFlat = (language: Language): Map<string, string> => flatWords({ stock: { owner: STOCK_WORDS[language], panel: STOCK_PANEL_WORDS[language] } }, stockSamples);
import { CHATS_LIST_WORDS } from "../../modules/channels/chats-list.ts";

export type ReviewLanguage = "hi" | "ml" | "kn";
export interface Row { id: string; text: string; english: string }

/** Every sentence of a word set, by path ("shop.stopTitle"); a phrase that takes values is shown with the sample values in SAMPLE_ARGS. */
export function flatWords(w: object, samples: Record<string, unknown[]> = SAMPLE_ARGS): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (value: unknown, path: string): void => {
    if (typeof value === "string") out.set(path, value);
    else if (typeof value === "function") out.set(path, (value as (...a: unknown[]) => string)(...(samples[path] ?? [])));
    else if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${path}.${i + 1}`));
    else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) walk(v, path ? `${path}.${k}` : k);
  };
  walk(w, "");
  return out;
}

/**
 * Each gateway's own words (B71: they live in its folder, modules/payments/providers/<name>/words.ts), under the ids "payment.<id>.*", so they reach the same native
 * reviewer as the rest of the panel. Their sample arguments are the same as before the move.
 */
function gatewaysFlat(language: Language): Map<string, string> {
  const out = new Map<string, string>();
  for (const g of GATEWAYS) {
    const samples = { [`payment.${g.id}.accounts.webhookUrl`]: [`https://shops.example.com/hooks/glow-salon/${g.id}`], [`payment.${g.id}.checks.confirmed`]: ["Live"] };
    for (const [id, text] of flatWords({ payment: { [g.id]: g.gateway!.setup.words[language] } }, samples)) out.set(id, text);
  }
  return out;
}

/** The health and margin pages and the template vote (words-health.ts), under the ids "health.*", and the vote's candidate templates under "vote.option.*" (vote-options.json). */
function healthFlat(language: Language): Map<string, string> {
  const out = flatWords({ health: HEALTH_WORDS[language] }, HEALTH_SAMPLE_ARGS);
  for (const o of loadVoteRound().options) out.set(`vote.option.${o.id}`, o.label[language]);
  return out;
}

/** The own-agent pages (words-agents.ts, 12 Nov 2026), under the ids "agents.*". */
const agentsFlat = (language: Language): Map<string, string> => flatWords({ agents: AGENT_WORDS[language] }, AGENT_SAMPLE_ARGS);

/**
 * Item 11i: the shop assistant's small talk for each personality (modules/assistant/personality.ts: the greeting, and the morning summary's opening and sign-off,
 * which are also in each personality's WhatsApp template), under the ids "personality.<personality>.*", so a native reader checks them with the rest. {name} and
 * {shop} stay as they are: the assistant's name and the shop's.
 */
const personalityFlat = (language: Language): Map<string, string> => flatWords({ personality: Object.fromEntries(PERSONALITIES.map((p) => [p, SMALL_TALK[p][language]])) });

/**
 * Block M (17 Nov 2026): what the shop's assistant says about its memory and the owner's talk (modules/assistant/words-memory.ts), the Remember / No buttons, and the cards
 * worded for Fees and Orders (a fee's balance and an order's advance, not a "deposit"), under the ids "memory.*", "card.<skill>.*" and "refusal.<skill>.*". Each is written with made-up values, so
 * a native reviewer reads whole sentences; the note's own words, ids and amounts are filled in by the assistant and never translated.
 */
const memoryFlat = (language: Language): Map<string, string> => {
  const out = new Map<string, string>();
  const say = <K extends keyof MessageData>(id: K, data: MessageData[K]) => out.set(`memory.${id}`, writeAssistant(id, data, language, "Asia/Kolkata").text);
  const note = { id: "n-3", text: "closed on Sunday", kind: "fact", audience: "owner" as const };
  say("note_saved", { id: "n-3", text: "closed on Sunday", audience: "owner", undoable: true });
  say("note_proposal", { text: "closed on Sunday", audience: "everyone" });
  say("note_declined", {}); say("notes_list", { notes: [note, { ...note, id: "n-4", audience: "everyone" }] }); say("note_forgotten", { id: "n-3" }); say("note_undone", { id: "n-3" });
  say("note_unknown", { id: "n-9" }); say("note_full", { max: 80 }); say("note_too_long", { max: 280 }); say("note_need_words", {}); say("note_not_a_limit", { id: "n-3" });
  say("talk_fallback", { waiting: 2, today: 5 }); say("talk_off", {});
  out.set("memory.button.remember", NOTE_LABELS[language].yes); out.set("memory.button.no", NOTE_LABELS[language].no);
  const card = (skill: string, kind: string, amountPaise: number) => cardQuestion({ kind, skill, who: "Priya", ref: skill === "fees" ? "f-3" : "o-5", what: skill === "fees" ? "November 2026" : "2 cakes", amountPaise, code: "K7M2QX", hasNo: true }, language, "Asia/Kolkata");
  // the supplier-order card of Stock orders: a cancel (no money moves) and the approval of an order
  out.set("card.stock-orders.cancel", card("stock-orders", "cancel", 0)); out.set("card.stock-orders.approve", card("stock-orders", "order", 1_200_000));
  for (const skill of ["fees", "orders"]) { out.set(`card.${skill}.cancel_money`, card(skill, "cancel", 150_000)); out.set(`card.${skill}.cancel_none`, card(skill, "cancel", 0)); out.set(`card.${skill}.refund`, card(skill, "refund", 50_000)); }
  // The two refusals that name the money going back, worded for Fees (a payment) and Orders (an advance); Bookings' say "deposit" and are on the main sheet.
  for (const skill of ["fees", "orders"]) for (const why of ["already_back", "cancel_first"] as const) out.set(`refusal.${skill}.${why}`, writeAssistant("refusal", { why, ref: skill === "fees" ? "f-3" : "o-5", skill }, language, "Asia/Kolkata").text);
  return out;
};

/**
 * The words added for the owner's first sign-in and who to call (14 Nov 2026), under the ids "owner.first.*" (the passkey page's Chrome and screen-lock lines, the alerts'
 * second step, the Operator bar, the shop's links), "door.*" (the door's error pages) and "pages.block.*" (the panel's shop page block, its QR page and recovery card),
 * so they reach the same native reviewer. Values a phrase takes are shown with a sample.
 */
const firstSamples: Record<string, unknown[]> = {
  "owner.first.alertsOn": [2], "owner.first.partner": ["Divya"], "door.help": ["Divya"],
  "pages.block.live": ["https://pages.example/glow-salon"], "pages.block.problem": ["that name is taken"], "pages.block.setupNote": ["10:30 UTC"], "pages.block.recoveryOn": ["2026-11-14"], "pages.block.cardOwner": ["https://pages.example/glow-salon/owner/recover"],
};
/** "Limits, tightened by a tap" (17 Nov 2026): the limits' names and rules, the card and every message about a limit (ids "limits.assistant.*"), the panel's list of changes ("limits.panel.*") and the owner's limits page ("limits.owner.*"). */
const limitsFlat = (language: Language): Map<string, string> => flatWords({ limits: { assistant: limitReviewLines(language, LIMIT_WORDS), panel: LIMITS_PANEL_WORDS[language], owner: LIMITS_OWNER_WORDS[language] } }, { "limits.owner.range": ["₹0", "₹5,000"] });
const firstFlat = (language: Language): Map<string, string> => flatWords({ owner: { first: FIRST_WORDS[language] }, door: DOOR_WORDS[language], pages: { block: PAGES_BLOCK_WORDS[language] } }, firstSamples);

/** Fees, 17 Nov 2026: the owner page's rupee box for a fee received only in part, in cash (modules/channels/words-money.ts), under the ids "owner.money.cashPart*". */
const cashPartFlat = (language: Language): Map<string, string> => new Map([["owner.money.cashPartLabel", OWNER_MONEY[language].cashPartLabel], ["owner.money.cashPartButton", OWNER_MONEY[language].cashPartButton]]);

/**
 * W1, the chat on the shop's page (17 Nov 2026): the page's words and the three quick taps of each template (modules/channels/words-chat.ts), under the ids "chat.*" and
 * "chat.quick.<kind>.*"; W1b adds the moments, hold to talk and "Chat with us" ("chat.more.*", words-chat-more.ts) and the owner's "Chat guest" (chat.guest). The panel's signboard
 * paint names are in the panel's own words (setup.character.paint*), so they are already in section 7.
 */
const chatFlat = (language: Language): Map<string, string> => flatWords({ chat: { ...CHAT[language], more: CHAT_MORE[language], guest: CHAT_GUEST[language], quick: Object.fromEntries(Object.entries(QUICK).map(([kind, q]) => [kind, q.label[language]])) } }, { "chat.closed": ["10:00–20:00"], "chat.kept": [30] });

/** W3, the chat page's lines about the Streetlist app (17 Nov 2026): the "Your chats" link and the install prompt (modules/channels/chats-list.ts), under the ids "chat.list.*". The Streetlist site's /chats page has the same lines plus its own (its docs/Review-words.md). */
const chatListFlat = (language: Language): Map<string, string> => flatWords({ chat: { list: CHATS_LIST_WORDS[language] } });

// Every non-empty line of the panel's words in one language with its English meaning beside it, for the native reviewer's sheet.
export function panelRows(language: ReviewLanguage): Row[] {
  const mine = new Map([...flatWords(WORDS[language]), ...gatewaysFlat(language), ...healthFlat(language), ...agentsFlat(language), ...personalityFlat(language), ...memoryFlat(language), ...firstFlat(language), ...limitsFlat(language), ...cashPartFlat(language), ...chatFlat(language), ...stockFlat(language), ...chatListFlat(language)]);
  const english = new Map([...flatWords(WORDS.en), ...gatewaysFlat("en"), ...healthFlat("en"), ...agentsFlat("en"), ...personalityFlat("en"), ...memoryFlat("en"), ...firstFlat("en"), ...limitsFlat("en"), ...cashPartFlat("en"), ...chatFlat("en"), ...stockFlat("en"), ...chatListFlat("en")]);
  return [...mine].filter(([, text]) => text !== "").map(([id, text]) => ({ id, text, english: english.get(id) ?? "" }));
}

const cell = (text: string) => text.replace(/\|/gu, "\\|").replace(/\n/gu, " ");
const REVIEWER = "Native reviewer: OK / change to …";

// Section 7 of the REVIEW sheet, appended by review-sheet.ts to the sections the template's own script writes.
export function panelReviewSection(language: ReviewLanguage): string {
  const name = LANGUAGE_NAMES[language];
  const rows = panelRows(language);
  return [
    "## 7. The panel and the phone setup", "",
    `Everything an Operator or builder reads in the panel, in ${name}: signing in, the shop's status and its monthly cost line, and the six setup steps (the business, the deposit and cancellation, languages, connecting the shop's accounts, the shop's assistant, the checks). The "personality.*" lines are the shop assistant's small talk in its three personalities: {shop} is the shop's name and {name} the assistant's own name, which the Operator may leave out. Amounts, dates, phone numbers and names are filled in by the panel and never translated; the samples below use made-up ones. The limits are each written as one sentence of what the shop gains: those seven lines (and the two "when it says booked" and "you stay in charge" lines) are the ones in the product's pricing document, so a change there is a change here. The certificate line "Held N of M" and "Show what we did" are in section 6.`, "",
    "What to look for first: (1) is each line something a shop owner or a young Operator on a cheap phone would understand in ten seconds; (2) are the words for deposit, refund, calendar, booking and limits the everyday ones; (3) do the instructions for connecting WhatsApp, the calendar and a payment gateway read as steps a person could follow with the real screens in front of them; (4) never a word that sounds like a guarantee (the panel counts and states facts; it does not say anything is safe or certified); (5) the names kept in Latin letters on purpose (WhatsApp, a payment gateway's name, Google Calendar, Guard, Geometer).", "",
    `| Id | Text (${name}) | Meaning (English) | ${REVIEWER} |`, "| --- | --- | --- | --- |",
    ...rows.map((r) => `| \`${r.id}\` | ${cell(r.text)} | ${cell(r.english)} |  |`), "",
  ].join("\n");
}
