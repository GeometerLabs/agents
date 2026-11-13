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
import { PERSONALITIES, SMALL_TALK } from "../../modules/assistant/personality.ts";

export type ReviewLanguage = "ml" | "kn";
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

// Every non-empty line of the panel's words in one language with its English meaning beside it, for the native reviewer's sheet.
export function panelRows(language: ReviewLanguage): Row[] {
  const mine = new Map([...flatWords(WORDS[language]), ...gatewaysFlat(language), ...healthFlat(language), ...agentsFlat(language), ...personalityFlat(language)]);
  const english = new Map([...flatWords(WORDS.en), ...gatewaysFlat("en"), ...healthFlat("en"), ...agentsFlat("en"), ...personalityFlat("en")]);
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
    `Everything a partner or builder reads in the panel, in ${name}: signing in, the shop's status and its monthly cost line, and the six setup steps (the business, the deposit and cancellation, languages, connecting the shop's accounts, the shop's assistant, the checks). The "personality.*" lines are the shop assistant's small talk in its three personalities: {shop} is the shop's name and {name} the assistant's own name, which the partner may leave out. Amounts, dates, phone numbers and names are filled in by the panel and never translated; the samples below use made-up ones. The limits are each written as one sentence of what the shop gains: those seven lines (and the two "when it says booked" and "you stay in charge" lines) are the ones in the product's pricing document, so a change there is a change here. The certificate line "Held N of M" and "Show what we did" are in section 6.`, "",
    "What to look for first: (1) is each line something a shop owner or a young partner on a cheap phone would understand in ten seconds; (2) are the words for deposit, refund, calendar, booking and limits the everyday ones; (3) do the instructions for connecting WhatsApp, the calendar and a payment gateway read as steps a person could follow with the real screens in front of them; (4) never a word that sounds like a guarantee (the panel counts and states facts; it does not say anything is safe or certified); (5) the names kept in Latin letters on purpose (WhatsApp, a payment gateway's name, Google Calendar, Guard, Geometer).", "",
    `| Id | Text (${name}) | Meaning (English) | ${REVIEWER} |`, "| --- | --- | --- | --- |",
    ...rows.map((r) => `| \`${r.id}\` | ${cell(r.text)} | ${cell(r.english)} |  |`), "",
  ].join("\n");
}
