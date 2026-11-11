// Makes the "What to ask the shop for" card from the one list in list.ts (B72). Three readers:
//   - the panel, through askCardFor(template, language): plain data to show on screen;
//   - partners, through the Markdown files this script writes beside each template's sell guide (sell/ask-card.<lang>.md);
//   - the review sheet, through askCardRows(language): the same lines with their English, so a native reader sees them.
//
//   node modules/ask-card/render.ts            writes the twelve cards (3 templates x 4 languages)
//   node modules/ask-card/render.ts --check    writes nothing; fails and names every card that is behind the list
//
// Why generated files at all: a partner prints or opens the card without the panel, and a test (test/ask-card.test.ts) fails when a file is not what the list makes, so the
// card on paper and the card on screen cannot say different things.
import { readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { LANGUAGES } from "../language/languages.ts";
import type { Language } from "../language/languages.ts";
import { CARD_REVIEW_STATE, CARD_TEMPLATES, HEADS, INTRO, LIST, NOTE, OPTIONAL_LABEL, REVIEW_BANNER, TEMPLATE_NAMES, TITLE } from "./list.ts";
import type { CardTemplate } from "./list.ts";

export { CARD_REVIEW_STATE, CARD_TEMPLATES, CARD_WRITTEN } from "./list.ts";
export type { CardTemplate } from "./list.ts";

export const REPO = fileURLToPath(new URL("../..", import.meta.url));

/** Where each template's sell guide lives, so its card sits beside it. */
const SELL_DIR: Record<CardTemplate, string> = {
  bookings: "templates/commerce/bookings/sell",
  orders: "templates/commerce/orders/sell",
  fees: "templates/education/fees/sell",
};

export interface CardItem {
  /** Stable name of the line (list.ts), for anything that points at one line. */
  id: string;
  group: "always" | "template";
  /** True when only some shops need it; the condition is in `what`. */
  optional: boolean;
  what: string;
  why: string;
}

export interface Card {
  template: CardTemplate;
  language: Language;
  /** "What to ask the shop for", with the template's name. */
  title: string;
  intro: string;
  /** The headings of the two groups of items, and the tag an optional item carries, all in the card's language. */
  heads: { always: string; template: string };
  optionalLabel: string;
  items: CardItem[];
  /** What the partner must not promise. */
  note: string;
  /** "machine-written" for Hindi, Malayalam and Kannada until a native reader signs them off; the panel shows a banner for it. */
  review: "source" | "machine-written";
  /** The banner lines to show with a machine-written card (empty for English). */
  reviewBanner: string[];
}

/** The card for a template in a language, as plain data. This is what the panel calls. */
export function askCardFor(template: CardTemplate, language: Language): Card {
  return {
    template,
    language,
    title: `${TITLE[language]}: ${TEMPLATE_NAMES[template][language]}`,
    intro: INTRO[language],
    heads: { always: HEADS.always[language], template: HEADS.template[language] },
    optionalLabel: OPTIONAL_LABEL[language],
    items: LIST[template].map((i) => ({ id: i.id, group: i.group, optional: i.optional === true, what: i.what[language], why: i.why[language] })),
    note: NOTE[language],
    review: CARD_REVIEW_STATE[language],
    reviewBanner: REVIEW_BANNER[language],
  };
}

/** The card as Markdown: a checklist the partner ticks with the owner. */
export function renderMarkdown(card: Card): string {
  const lines: string[] = [`# ${card.title}`, ""];
  if (card.review === "machine-written") {
    for (const b of card.reviewBanner) lines.push(`> ${b}`);
    lines.push("");
  }
  lines.push(card.intro, "");
  for (const group of ["always", "template"] as const) {
    lines.push(`## ${card.heads[group]}`, "");
    for (const item of card.items.filter((i) => i.group === group)) {
      lines.push(`- [ ] **${item.optional ? `(${card.optionalLabel}) ` : ""}${item.what}**`, `  ${item.why}`);
    }
    lines.push("");
  }
  lines.push(`> ${card.note}`, "");
  lines.push(`<!-- Made by modules/ask-card/render.ts from modules/ask-card/list.ts. Edit that file, then run: node modules/ask-card/render.ts -->`);
  return `${lines.join("\n")}\n`;
}

/** Where the card for a template and language is written (relative to the repo root). */
export const cardPath = (template: CardTemplate, language: Language): string => `${SELL_DIR[template]}/ask-card.${language}.md`;

/** Every card file the list makes: its path and its text. */
export function cardFiles(): { path: string; text: string }[] {
  return CARD_TEMPLATES.flatMap((t) => LANGUAGES.map((l) => ({ path: cardPath(t, l), text: renderMarkdown(askCardFor(t, l)) })));
}

/** The card files that are not what the list makes (missing, or edited by hand). Empty when every card is current. */
export function staleCards(root: string = REPO): string[] {
  return cardFiles().flatMap(({ path, text }) => {
    let now: string | undefined;
    try { now = readFileSync(join(root, path), "utf8"); } catch { /* not made yet */ }
    return now === text ? [] : [path];
  });
}

export interface ReviewRow { id: string; text: string; english: string }

/**
 * The card's lines for a native reader of the review sheet (Malayalam or Kannada; Hindi has no sheet): each line's id, its text in the language and its English.
 * The ids are "askcard.<template>.<item>.what|why" and "askcard.<part>", so the panel can register them in the sheet exactly as it does its own words.
 */
export function askCardRows(language: Exclude<Language, "en" | "hi">): ReviewRow[] {
  const rows: ReviewRow[] = [];
  const add = (id: string, text: string, english: string) => rows.push({ id, text, english });
  add("askcard.title", TITLE[language], TITLE.en);
  add("askcard.intro", INTRO[language], INTRO.en);
  add("askcard.optional", OPTIONAL_LABEL[language], OPTIONAL_LABEL.en);
  add("askcard.head.always", HEADS.always[language], HEADS.always.en);
  add("askcard.head.template", HEADS.template[language], HEADS.template.en);
  add("askcard.note", NOTE[language], NOTE.en);
  for (const t of CARD_TEMPLATES) {
    add(`askcard.${t}.name`, TEMPLATE_NAMES[t][language], TEMPLATE_NAMES[t].en);
    for (const i of LIST[t]) {
      add(`askcard.${t}.${i.id}.what`, i.what[language], i.what.en);
      add(`askcard.${t}.${i.id}.why`, i.why[language], i.why.en);
    }
  }
  return rows;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes("--check")) {
    const behind = staleCards();
    if (behind.length > 0) { console.error(`Not made from the list: ${behind.join(", ")}. Run: node modules/ask-card/render.ts`); process.exit(1); }
    console.log("Every ask card is made from modules/ask-card/list.ts.");
  } else {
    for (const { path, text } of cardFiles()) { writeFileSync(join(REPO, path), text); console.log(relative(REPO, join(REPO, path))); }
  }
}
