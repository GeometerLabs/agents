// Writes what the Go Orders monthly report (go/internal/ordersreport) takes from the TypeScript as DATA, made by RUNNING it, never retyped:
//   ordersreport/words/words.json.gz
//     strings    templates/commerce/orders/report/strings.ts STRINGS in four languages. A word that is a function of its arguments is carried as a template with {0}, {1} ... slots
//                (internal/slots) after lib_words.ts has checked on other values that it does nothing but put its arguments in; one that does more fails here and must be described by hand.
//                Four entries are NOT carried because Go already has them from other generated files (the generator asserts they are the very same values): checkGenuine, settledByWord,
//                settledBySomeone (internal/report words) and moneyBlock (internal/accounting words). Of the go-live certificate's words (`cert`) only `held` is carried: the monthly
//                report says it in its go-live lines; the rest (cutoff, advance and so on branch on numbers and booleans) belong to the certificate's page, which the CLI and the deployer
//                make and stay TypeScript.
//     plans      src/plans/report.ts PLAN_REPORT_WORDS (the plans' block of the page), four languages
//     facts      the lists and constants the report data reads: the rule ids, "not counted" (and a UPI shop's swap), the sources, the hand check's "not tested" lists, the languages, the
//                message status action, the pathway name and version (package.json), the digest of Annapurna Tiffins' settings (what a go-live certificate that ran on the example says),
//                ORDERS_LEGACY (the books' map of Orders' older action names) and the four WhatsApp templates (name, badge, upi, wording per language)
//     moneyLabels / sample inputs are not here: they are code.
// Run from the repository root:  node go/scripts/gen_orders_report_words.ts   (--check only compares; words-fresh.test.ts fails when it was not run after a change to the report's words)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { LANGUAGES } from "../../modules/language/languages.ts";
import { MONEY_BLOCK_WORDS } from "../../modules/accounting/report-block.ts";
import { CHECK_GENUINE, SETTLED_BY_SOMEONE, SETTLED_BY_WORD } from "../../modules/report/text.ts";
import { MESSAGE_STATUS_ENTRY } from "../../modules/unfinished/registry.ts";
import { NOT_COUNTED, PATHWAY, RULE_IDS, SOURCES, UPI_NOT_COUNTED, checkedPolicyDigest } from "../../templates/commerce/orders/report/data.ts";
import { STRINGS } from "../../templates/commerce/orders/report/strings.ts";
import { REPORT_TEMPLATES } from "../../templates/commerce/orders/report/whatsapp.ts";
import { NOT_TESTED, UPI_NOT_TESTED } from "../../templates/commerce/orders/crash-test/not-tested.ts";
import { ORDERS_LEGACY } from "../../templates/commerce/orders/src/accounting.ts";
import { PLAN_REPORT_WORDS } from "../../templates/commerce/orders/src/plans/report.ts";
import { pack, slotted } from "./lib_words.ts";

const here = dirname(fileURLToPath(import.meta.url));
const INTERNAL = join(here, "..", "internal");
export const OUT = INTERNAL;

/** Words Go gets from elsewhere: they must be the very same values the strings carry. */
const SHARED = ["checkGenuine", "settledByWord", "settledBySomeone", "moneyBlock"] as const;

/** One value of the strings: text stays text, a function becomes a template with slots (checked), a group is walked. */
function carry(value: unknown, where: string): unknown {
  if (typeof value === "string") return value;
  if (typeof value === "function") return slotted(value as (...a: string[]) => string, (value as { length: number }).length);
  if (value && typeof value === "object" && !Array.isArray(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, carry(v, `${where}.${k}`)]));
  throw new Error(`${where}: a word of a kind this generator does not carry`);
}

function strings(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const l of LANGUAGES) {
    const s = STRINGS[l] as unknown as Record<string, unknown>;
    if (s.checkGenuine !== CHECK_GENUINE[l] || s.settledByWord !== SETTLED_BY_WORD[l] || s.settledBySomeone !== SETTLED_BY_SOMEONE[l] || s.moneyBlock !== MONEY_BLOCK_WORDS[l]) {
      throw new Error(`the strings of ${l} no longer take checkGenuine, settledByWord, settledBySomeone and moneyBlock from the shared words: Go reads those from internal/report and internal/accounting`);
    }
    const mine = Object.fromEntries(Object.entries(s).filter(([k]) => !(SHARED as readonly string[]).includes(k) && k !== "cert"));
    out[l] = { ...(carry(mine, l) as object), cert: { held: carry((s.cert as { held: unknown }).held, `${l}.cert.held`) } };
  }
  return out;
}

function facts(): unknown {
  return {
    languages: LANGUAGES,
    pathway: PATHWAY,
    checkedPolicyDigest: checkedPolicyDigest(),
    ruleIds: RULE_IDS,
    notCounted: NOT_COUNTED,
    // B71 part 2: a UPI shop's report swaps these lines (data.ts UPI_NOT_COUNTED, exported for this generator)
    upiNotCounted: UPI_NOT_COUNTED,
    sources: SOURCES,
    notTested: NOT_TESTED.map((n) => n.id),
    upiNotTested: UPI_NOT_TESTED.map((n) => n.id),
    messageStatusEntry: MESSAGE_STATUS_ENTRY,
    legacy: ORDERS_LEGACY,
    templates: REPORT_TEMPLATES.map((t) => ({ name: t.name, badge: t.badge, upi: t.upi === true, bodies: t.bodies })),
  };
}

function words(): Buffer { return pack({ strings: strings(), plans: PLAN_REPORT_WORDS, facts: facts() }); }

export function generate(): Map<string, Buffer> { return new Map([["ordersreport/words/words.json.gz", words()]]); }

/** Compares the UNPACKED text, not the gzip bytes (those may differ between zlib versions). */
export function staleFiles(root = INTERNAL): string[] {
  return [...generate()].filter(([name, data]) => !existsSync(join(root, name)) || gunzipSync(readFileSync(join(root, name))).toString("utf8") !== gunzipSync(data).toString("utf8")).map(([name]) => name);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--check")) {
    const stale = staleFiles();
    if (stale.length) { console.error(`out of date: ${stale.join(", ")}  (run node go/scripts/gen_orders_report_words.ts)`); process.exit(1); }
  } else {
    for (const [name, data] of generate()) { mkdirSync(dirname(join(INTERNAL, name)), { recursive: true }); writeFileSync(join(INTERNAL, name), data); }
  }
}
