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
import { DAY_FEATURES } from "../../modules/assistant/words-budget.ts";
import type { MessageData } from "../../modules/assistant/words.ts";
import { NOTE_LABELS } from "../../modules/assistant/words-memory.ts";
import { limitReviewLines } from "../../modules/assistant/limits-card.ts";
import { listingReviewLines } from "../../modules/listings/words.ts";
import { stockReviewLines } from "../../modules/stock/words.ts";
import { LIMIT_WORDS } from "../../modules/limits/chat-limit-kinds.ts";
import { WORDS as LIMITS_PANEL_WORDS } from "./views-limits.ts";
import { OWNER_MONEY } from "../../modules/channels/words-money.ts";
import { STOCK_WORDS } from "../../modules/channels/words-stock.ts";
import { STOCK_PANEL_WORDS } from "./stock.ts";
import { LISTINGS_PANEL_WORDS } from "./listings.ts";
import { CLASSES_WORDS } from "./words-classes.ts";
import { PRESET_WORDS } from "./words-presets.ts";
import { KEEP_WORDS } from "./words-keep.ts";
import { PANEL_LEAVE } from "./words-leave.ts";
import { LEAVE_PAGE } from "../../modules/channels/words-leave.ts";
import { PHONE_TEMPLATES, PRESETS_DIR, loadPresets, presetTexts } from "./presets.ts";
import { WORDS as LIMITS_OWNER_WORDS } from "../../modules/channels/owner-limits-page.ts";
import { WORDS as PHONES_WORDS } from "../../modules/channels/owner-phones-page.ts";
import { CODES_ALERT, LOST_HELP, NEW_PHONE_ALERT, REMOVED_ALERT } from "../../modules/channels/owner-phones.ts";
import { OWNER_CHANGE_ALERT, REMOVAL_ALERT } from "../../modules/channels/owner-signin.ts";
import { CHAT, QUICK, forKind } from "../../modules/channels/words-chat.ts";
import { IDENTITY } from "../../modules/channels/words-chat-identity.ts";
import { CHAT_MORE } from "../../modules/channels/words-chat-more.ts";
import { CHAT_GUEST } from "../../modules/channels/chat-guest.ts";
import { DIRECTORY_SAMPLES, DIRECTORY_WORDS } from "../../modules/discovery/words.ts";

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
/** The listings-only shop's phone form and checks page (18 Nov 2026; listings.ts), under the ids "listingsShop.panel.*". Strings only, so no sample arguments. */
const listingsShopFlat = (language: Language): Map<string, string> => flatWords({ listingsShop: { panel: LISTINGS_PANEL_WORDS[language] } }, {});
/** The Classes part of the Fees phone form (17 Nov 2026; words-classes.ts), under the ids "classes.*", each refusal with a made-up row and batch. */
const classesFlat = (language: Language): Map<string, string> => flatWords({ classes: CLASSES_WORDS[language] }, {
  "classes.problems.tooMany": [60], "classes.problems.lineBad": [2], "classes.problems.batch": [2, "Class 8"], "classes.problems.day": [2], "classes.problems.time": [2], "classes.problems.minutes": [2], "classes.problems.twice": [2],
});
/**
 * The first set-up question (17 Nov 2026; words-presets.ts and bundle/panel/presets/*.json): its words under "preset.words.*", then each trade's name under "preset.<id>.name" and each
 * example name the form is filled with under "preset.<id>.prefill.*", so a native reader checks what an Operator sees on the first screen and in the first form.
 */
const presetsFlat = (language: Language): Map<string, string> => {
  const out = flatWords({ preset: { words: PRESET_WORDS[language] } });
  for (const p of loadPresets(PRESETS_DIR, PHONE_TEMPLATES)) for (const [id, text] of presetTexts(p, language)) out.set(id, text);
  return out;
};
/**
 * "Leave with your shop" (block S, 18 Nov 2026): the assistant's four answers (ids "leave.assistant.*"), the owner's page part with its two buttons and the file's states
 * ("leave.page.*"), and the Operator's panel lines, including what fleet was told and the stranded list ("leave.panel.*"), each with made-up values.
 */
/**
 * The shop's model budget (decision 60, 18 Nov 2026): what the assistant tells the owner when most of the month's budget is used, when it is used up, when a feature's day is used
 * (one line per feature) and when a listing cannot be written for either reason (ids "budget.assistant.*"). The Operator's two lines are with "plan.budget.*" in the panel's words.
 */
const budgetFlat = (language: Language): Map<string, string> => {
  const out = new Map<string, string>();
  const back = { year: 2026, month: 12, day: 1 };
  for (const line of ["warn", "full", "listing_month"] as const) out.set(`budget.assistant.${line}`, writeAssistant("budget_line", { line, backOn: back }, language, "Asia/Kolkata").text);
  for (const feature of DAY_FEATURES) out.set(`budget.assistant.day.${feature}`, writeAssistant("budget_line", { line: "day", feature }, language, "Asia/Kolkata").text);
  return out;
};
const leaveFlat = (language: Language): Map<string, string> => {
  const out = new Map<string, string>();
  for (const id of ["leave_file_asked", "leave_file_again", "leave_operator_asked", "leave_operator_again"] as const) out.set(`leave.assistant.${id}`, writeAssistant(id, {}, language, "Asia/Kolkata").text);
  for (const [id, text] of flatWords({ page: LEAVE_PAGE[language] }, { "page.fileReady": ["21 Nov, 3:30 pm"] })) out.set(`leave.${id}`, text);
  const sample: Record<string, unknown[]> = {
    "panel.fileAsked": ["18 Nov"], "panel.fileReady": ["21 Nov"], "panel.fileProblem": ["The record is not ready yet."], "panel.operatorAsked": ["18 Nov"], "panel.operatorClock": [9],
    "panel.strandedRow": ["Glow Salon", "1 Nov", "Divya"], "panel.fleetTold": ["Ravi Digital"], "panel.fleetRefused": ["That Operator does not serve here yet."], "panel.fleetNoId": ["Ravi Digital"],
  };
  for (const [id, text] of flatWords({ panel: PANEL_LEAVE[language] }, sample)) out.set(`leave.${id}`, text);
  return out;
};
/** What the save says when a student's earlier details could not be carried over (words-keep.ts), under the id "keep.lost". */
const keepFlat = (language: Language): Map<string, string> => flatWords({ keep: KEEP_WORDS[language] }, { "keep.lost": ["Rahul"] });
import { CHATS_LIST_WORDS } from "../../modules/channels/chats-list.ts";

/**
 * Block S (18 Nov 2026): the directory's search page and the page that states the fair order (modules/discovery/words.ts), under the ids "directory.*", each line with a made-up value where it
 * takes one. Hindi, Malayalam and Kannada are machine-written and wait here for a native reader.
 */
const directoryFlat = (language: Language): Map<string, string> => flatWords({ directory: DIRECTORY_WORDS[language] }, Object.fromEntries(Object.entries(DIRECTORY_SAMPLES).map(([k, v]) => [`directory.${k}`, v])));

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
  "pages.block.pending": ["Divya", "2026-11-21 10:00 UTC"], "pages.block.resetLine": ["2026-11-19", "the owner lost every phone"],
};
/** "Limits, tightened by a tap" (17 Nov 2026): the limits' names and rules, the card and every message about a limit (ids "limits.assistant.*"), the panel's list of changes ("limits.panel.*") and the owner's limits page ("limits.owner.*"). */
/** Block S (18 Nov 2026): every line about listings (modules/listings/words.ts): the storefront, the owner's listings page, the card, the morning question, the refusals; ids "listings.*". */
const listingsFlat = (language: Language): Map<string, string> => new Map(Object.entries(listingReviewLines(language)).map(([k, v]) => [`listings.${k}`, v]));
/** The shop's stock count (block S phase A3; modules/stock/words.ts): the owner's Stock page, "running low", the reorder question and the morning line's part, under the ids "stockline.*" ("stock.*" is Stock orders'). */
const stocklineFlat = (language: Language): Map<string, string> => new Map(Object.entries(stockReviewLines(language)).map(([k, v]) => [`stockline.${k}`, v]));
const limitsFlat = (language: Language): Map<string, string> => flatWords({ limits: { assistant: limitReviewLines(language, LIMIT_WORDS), panel: LIMITS_PANEL_WORDS[language], owner: LIMITS_OWNER_WORDS[language] } }, { "limits.owner.range": ["₹0", "₹5,000"] });
/**
 * "No Operator holds a shop hostage" (19 Nov 2026): the owner's "Phones that can open your shop" page, its banners and refusals (ids "phones.*"), the push alerts for a new phone
 * and for the Operator's request (ids "phones.alert.*") and the one line for an owner who lost everything (id "phones.lostHelp", shown only on Geometer's Operator server). The
 * panel's own new lines are under "pages.block.*" (locked, askRemove, pending, resetLine ...).
 */
const phonesFlat = (language: Language): Map<string, string> => {
  const out = flatWords({ phones: PHONES_WORDS[language] }, {
    "phones.added": ["19 Nov 2026"], "phones.lastUsed": ["19 Nov, 3:42 pm"], "phones.removeAsk": ["Android, Chrome"], "phones.addHow": ["4:30 pm"], "phones.codesHave": ["19 Nov 2026"],
    "phones.bannerNew": ["19 Nov, 3:42 pm", "Android, Chrome"], "phones.bannerRequest": ["Divya", "21 Nov, 10:00 am"], "phones.bannerOwner": ["21 Nov, 10:00 am"], "phones.bannerCodesMade": ["19 Nov, 3:42 pm", "Android, Chrome"], "phones.bannerRemoved": ["19 Nov, 3:42 pm", "Android, Chrome"],
  });
  out.set("phones.lostHelp", LOST_HELP[language]);
  out.set("phones.alert.newPhone", NEW_PHONE_ALERT(Date.UTC(2026, 10, 19, 10, 12), "Android, Chrome")[language]);
  out.set("phones.alert.request", REMOVAL_ALERT("Divya")[language]);
  out.set("phones.alert.ownerChange", OWNER_CHANGE_ALERT[language]);
  out.set("phones.alert.codes", CODES_ALERT(Date.UTC(2026, 10, 19, 10, 12), "Android, Chrome")[language]);
  out.set("phones.alert.removed", REMOVED_ALERT(Date.UTC(2026, 10, 19, 10, 12), "Android, Chrome")[language]);
  return out;
};
const firstFlat = (language: Language): Map<string, string> => flatWords({ owner: { first: FIRST_WORDS[language] }, door: DOOR_WORDS[language], pages: { block: PAGES_BLOCK_WORDS[language] } }, firstSamples);

/** Fees, 17 Nov 2026: the owner page's rupee box for a fee received only in part, in cash (modules/channels/words-money.ts), under the ids "owner.money.cashPart*". */
const cashPartFlat = (language: Language): Map<string, string> => new Map([["owner.money.cashPartLabel", OWNER_MONEY[language].cashPartLabel], ["owner.money.cashPartButton", OWNER_MONEY[language].cashPartButton]]);

/**
 * W1, the chat on the shop's page (17 Nov 2026): the page's words and the three quick taps of each template (modules/channels/words-chat.ts), under the ids "chat.*" and
 * "chat.quick.<kind>.*"; W1b adds the moments, hold to talk and "Chat with us" ("chat.more.*", words-chat-more.ts) and the owner's "Chat guest" (chat.guest). The panel's signboard
 * paint names are in the panel's own words (setup.character.paint*), so they are already in section 7.
 */
const chatFlat = (language: Language): Map<string, string> => flatWords({ chat: { ...CHAT[language], more: CHAT_MORE[language], guest: CHAT_GUEST[language], quick: Object.fromEntries(Object.entries(QUICK).map(([kind, q]) => [kind, q.label[language]])) } }, { "chat.closed": ["10:00–20:00"], "chat.kept": [30] });

/**
 * A Fees chat says "centre" where the others say "shop" (18 Nov 2026; modules/channels/words-chat.ts forKind), and since 19 Nov a Fees chat says "fee page" and an Orders chat
 * "order" where the lines say "booking": the lines that change, in full, under the ids "chat.centre.*" (Fees) and "chat.orders.*" (Orders), with ".more.", ".id." and ".first." as
 * for the shop's lines, so a native reader judges each sentence as a whole. Bookings keeps the plain lines, so it has no ids of its own.
 */
const chatKindFlat = (language: Language): Map<string, string> => {
  const out = new Map<string, string>();
  const tables: Array<[string, object]> = [["", CHAT[language]], ["more.", CHAT_MORE[language]], ["id.", IDENTITY[language]], ["first.", { shopCall: FIRST_WORDS[language].shopCall }]];
  for (const [kind, name] of [["fees", "centre"], ["orders", "orders"]] as const) {
    for (const [prefix, table] of tables) {
      const samples = { closed: ["10:00–20:00"], kept: [30] };
      const was = flatWords(table, samples), now = flatWords(forKind(kind, language, table), samples);
      for (const [id, text] of now) if (text !== was.get(id)) out.set(`chat.${name}.${prefix}${id}`, text);
    }
  }
  return out;
};

/** W3, the chat page's lines about the Streetlist app (17 Nov 2026): the "Your chats" link and the install prompt (modules/channels/chats-list.ts), under the ids "chat.list.*". The Streetlist site's /chats page has the same lines plus its own (its docs/Review-words.md). */
const chatListFlat = (language: Language): Map<string, string> => flatWords({ chat: { list: CHATS_LIST_WORDS[language] } });

/** W2, keep this chat, open it on a new phone, delete my chat and a parent's chat (17 Nov 2026; modules/channels/words-chat-identity.ts), under the ids "chat.id.*". The two WhatsApp link templates are in modules/channels/chat-link-templates.json. */
const chatIdentityFlat = (language: Language): Map<string, string> => flatWords({ chat: { id: IDENTITY[language] } });

// Every non-empty line of the panel's words in one language with its English meaning beside it, for the native reviewer's sheet.
export function panelRows(language: ReviewLanguage): Row[] {
  const mine = new Map([...flatWords(WORDS[language]), ...gatewaysFlat(language), ...healthFlat(language), ...agentsFlat(language), ...personalityFlat(language), ...memoryFlat(language), ...firstFlat(language), ...limitsFlat(language), ...phonesFlat(language), ...listingsFlat(language), ...cashPartFlat(language), ...chatFlat(language), ...chatKindFlat(language), ...stockFlat(language), ...listingsShopFlat(language), ...classesFlat(language), ...presetsFlat(language), ...keepFlat(language), ...leaveFlat(language), ...budgetFlat(language), ...chatListFlat(language), ...chatIdentityFlat(language), ...stocklineFlat(language), ...directoryFlat(language)]);
  const english = new Map([...flatWords(WORDS.en), ...gatewaysFlat("en"), ...healthFlat("en"), ...agentsFlat("en"), ...personalityFlat("en"), ...memoryFlat("en"), ...firstFlat("en"), ...limitsFlat("en"), ...phonesFlat("en"), ...listingsFlat("en"), ...cashPartFlat("en"), ...chatFlat("en"), ...chatKindFlat("en"), ...stockFlat("en"), ...listingsShopFlat("en"), ...classesFlat("en"), ...presetsFlat("en"), ...keepFlat("en"), ...leaveFlat("en"), ...budgetFlat("en"), ...chatListFlat("en"), ...chatIdentityFlat("en"), ...stocklineFlat("en"), ...directoryFlat("en")]);
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
