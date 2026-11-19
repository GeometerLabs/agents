// Writes what the Go books (go/internal/accounting) and their HTML (go/internal/accounting/render) take from the TypeScript as DATA, made by RUNNING it, never retyped:
//   accounting/words/words.json.gz  the owner's Money words (OWNER_MONEY_WORDS) and the customer document's words (DOC) in four languages, the "Money this month" block's words
//                                   (MONEY_BLOCK_WORDS), the machine-written note of each language (PAGE[l].machine), and the two style sheets the document page prints (CUSTOMER_CSS of
//                                   modules/channels/look.ts and DOC_CSS of document-page.ts). A word that is a function of its arguments is carried as a template with {0}, {1} ... slots, or as
//                                   {one, other} for a count, after lib_words.ts has checked on other values that it does nothing but put its arguments in; a word that does more fails here.
// Run from the repository root:  node go/scripts/gen_books_words.ts   (--check only compares; the test words-fresh fails when it was not run after a change to the words)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { LANGUAGES } from "../../modules/language/languages.ts";
import { OWNER_MONEY_WORDS } from "../../modules/accounting/words-owner.ts";
import { DOC } from "../../modules/accounting/words-documents.ts";
import { MONEY_BLOCK_WORDS } from "../../modules/accounting/report-block.ts";
import { DOC_CSS } from "../../modules/accounting/document-page.ts";
import { CUSTOMER_CSS } from "../../modules/channels/look.ts";
import { PAGE } from "../../modules/channels/words.ts";
import { counted, pack, slotted } from "./lib_words.ts";

const here = dirname(fileURLToPath(import.meta.url));
const INTERNAL = join(here, "..", "internal");
export const OUT = INTERNAL;

function owner(l: (typeof LANGUAGES)[number]): unknown {
  const w = OWNER_MONEY_WORDS[l];
  const count = (n: keyof typeof w) => counted((x) => (w[n] as (n: number) => string)(x));
  const s = (n: keyof typeof w, arity: number) => slotted((...a) => (w[n] as (...a: string[]) => string)(...a), arity);
  return {
    machine: w.machine, title: w.title, today: w.today, month: w.month, received: w.received, givenBack: w.givenBack, kept: w.kept, charges: w.charges, stillToCome: w.stillToCome,
    payments: count("payments"), refunds: count("refunds"), fees: count("fees"),
    byWordTitle: w.byWordTitle, byWordRow: s("byWordRow", 2), owedTitle: w.owedTitle, owedNone: w.owedNone, owedUpi: s("owedUpi", 1), owedService: s("owedService", 1),
    notMatchedTitle: w.notMatchedTitle, notMatchedNone: w.notMatchedNone, payoutsUnchecked: w.payoutsUnchecked,
    upiClaim: s("upiClaim", 2), gateway: s("gateway", 3), gatewayHeld: s("gatewayHeld", 2), notThrough: s("notThrough", 1), untold: s("untold", 2), aCase: w.aCase,
    accountantTitle: w.accountantTitle, accountantNote: w.accountantNote, thisMonth: w.thisMonth, lastMonth: w.lastMonth, thisYear: s("thisYear", 1),
    fileJournal: w.fileJournal, fileDocuments: w.fileDocuments, fileReadme: w.fileReadme, fileSettlements: w.fileSettlements, fileTallyMasters: w.fileTallyMasters, fileTallyVouchers: w.fileTallyVouchers,
    shareWhatsapp: w.shareWhatsapp, shareText: s("shareText", 1), scope: w.scope,
  };
}

function doc(l: (typeof LANGUAGES)[number]): unknown {
  const w = DOC[l];
  return {
    title: w.title, amountLabel: w.amountLabel, number: w.number, date: w.date, forLabel: w.forLabel, person: w.person, phone: w.phone, paidBy: w.paidBy, howKnown: w.howKnown,
    method: w.method, evidence: w.evidence, ownerMarkRefund: w.ownerMarkRefund, cites: slotted((n, d) => w.cites(n, d), 2), legend: w.legend, footer: slotted((s) => w.footer(s), 1),
    printHint: w.printHint, receipts: w.receipts,
  };
}

function words(): Buffer {
  return pack({
    languages: LANGUAGES,
    owner: Object.fromEntries(LANGUAGES.map((l) => [l, owner(l)])),
    doc: Object.fromEntries(LANGUAGES.map((l) => [l, doc(l)])),
    block: MONEY_BLOCK_WORDS,
    machine: Object.fromEntries(LANGUAGES.map((l) => [l, PAGE[l].machine])),
    css: { customer: CUSTOMER_CSS, doc: DOC_CSS },
  });
}

export function generate(): Map<string, Buffer> { return new Map([["accounting/words/words.json.gz", words()]]); }

/** Compares the UNPACKED text, not the gzip bytes (those may differ between zlib versions). */
export function staleFiles(root = INTERNAL): string[] {
  return [...generate()].filter(([name, data]) => !existsSync(join(root, name)) || gunzipSync(readFileSync(join(root, name))).toString("utf8") !== gunzipSync(data).toString("utf8")).map(([name]) => name);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--check")) {
    const stale = staleFiles();
    if (stale.length) { console.error(`out of date: ${stale.join(", ")}  (run node go/scripts/gen_books_words.ts)`); process.exit(1); }
  } else {
    for (const [name, data] of generate()) { mkdirSync(dirname(join(INTERNAL, name)), { recursive: true }); writeFileSync(join(INTERNAL, name), data); }
  }
}
