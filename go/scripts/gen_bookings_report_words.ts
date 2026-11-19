// Writes what the Go Bookings monthly report (go/internal/bookingsreport) takes from the TypeScript as DATA, made by RUNNING it, never retyped:
//   bookingsreport/words/words.json.gz
//     strings    templates/commerce/bookings/report/strings.ts STRINGS in four languages. A word that is a function of its arguments is carried as a template with {0}, {1} ... slots
//                (internal/slots) after lib_words.ts has checked on other values that it does nothing but put its arguments in; one that does more fails here and must be described by hand.
//                Five entries are NOT carried because Go already has them from other generated files (the generator asserts they are the very same values): innovator, checkGenuine,
//                settledByWord, settledBySomeone (internal/report words) and moneyBlock (internal/accounting words).
//     facts      the lists and constants the report data reads: the rule ids, "not counted", the sources, the hand check's "not tested" lists, which payment modules confirm by
//                themselves (and which one a shop with an unknown module is read as), the message status action, the languages, the pathway name and version (package.json), the
//                digest of Glow Salon's settings (what a go-live certificate that ran on the example says), and the four WhatsApp templates (name, badge, upi, wording per language)
//     moneyLabels / sample inputs are not here: they are code.
// Run from the repository root:  node go/scripts/gen_bookings_report_words.ts   (--check only compares; words-fresh.test.ts fails when it was not run after a change to the report's words)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { LANGUAGES } from "../../modules/language/languages.ts";
import { MONEY_BLOCK_WORDS } from "../../modules/accounting/report-block.ts";
import { CHECK_GENUINE, INNOVATOR, SETTLED_BY_SOMEONE, SETTLED_BY_WORD } from "../../modules/report/text.ts";
import { MESSAGE_STATUS_ENTRY } from "../../modules/unfinished/registry.ts";
import { DEFAULT_PROVIDER, PROVIDERS } from "../../modules/payments/providers/index.ts";
import { NOT_COUNTED, PATHWAY, RULE_IDS, SOURCES, checkedPolicyDigest } from "../../templates/commerce/bookings/report/data.ts";
import { STRINGS } from "../../templates/commerce/bookings/report/strings.ts";
import { REPORT_TEMPLATES } from "../../templates/commerce/bookings/report/whatsapp.ts";
import { HAND_RUN, NOT_TESTED, STAND_IN_SERVICES, UPI_NOT_TESTED } from "../../templates/commerce/bookings/crash-test/not-tested.ts";
import { pack, slotted } from "./lib_words.ts";

const here = dirname(fileURLToPath(import.meta.url));
const INTERNAL = join(here, "..", "internal");
export const OUT = INTERNAL;

/** Words Go gets from elsewhere: they must be the very same values the strings carry. */
const SHARED = ["innovator", "checkGenuine", "settledByWord", "settledBySomeone", "moneyBlock"] as const;

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
    if (s.innovator !== INNOVATOR[l] || s.checkGenuine !== CHECK_GENUINE[l] || s.settledByWord !== SETTLED_BY_WORD[l] || s.settledBySomeone !== SETTLED_BY_SOMEONE[l] || s.moneyBlock !== MONEY_BLOCK_WORDS[l]) {
      throw new Error(`the strings of ${l} no longer take innovator, checkGenuine, settledByWord, settledBySomeone and moneyBlock from the shared words: Go reads those from internal/report and internal/accounting`);
    }
    out[l] = Object.fromEntries(Object.entries(s).filter(([k]) => !(SHARED as readonly string[]).includes(k)).map(([k, v]) => [k, carry(v, `${l}.${k}`)]));
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
    sources: SOURCES,
    notTested: NOT_TESTED.map((n) => ({ id: n.id, forOwner: n.forOwner })),
    upiNotTested: UPI_NOT_TESTED.map((n) => ({ id: n.id, forOwner: n.forOwner })),
    standInServices: STAND_IN_SERVICES,
    handRun: HAND_RUN,
    messageStatusEntry: MESSAGE_STATUS_ENTRY,
    // capabilitiesOf(payment): the provider with this module's id, else the default provider's (an unknown module or none is read as the default, never as a gateway)
    payments: { defaultProvider: DEFAULT_PROVIDER.id, confirmsAutomatically: Object.fromEntries(PROVIDERS.map((p) => [p.id, p.capabilities.confirmsAutomatically])) },
    templates: REPORT_TEMPLATES.map((t) => ({ name: t.name, badge: t.badge, upi: t.upi === true, bodies: t.bodies })),
  };
}

function words(): Buffer { return pack({ strings: strings(), facts: facts() }); }

export function generate(): Map<string, Buffer> { return new Map([["bookingsreport/words/words.json.gz", words()]]); }

/** Compares the UNPACKED text, not the gzip bytes (those may differ between zlib versions). */
export function staleFiles(root = INTERNAL): string[] {
  return [...generate()].filter(([name, data]) => !existsSync(join(root, name)) || gunzipSync(readFileSync(join(root, name))).toString("utf8") !== gunzipSync(data).toString("utf8")).map(([name]) => name);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--check")) {
    const stale = staleFiles();
    if (stale.length) { console.error(`out of date: ${stale.join(", ")}  (run node go/scripts/gen_bookings_report_words.ts)`); process.exit(1); }
  } else {
    for (const [name, data] of generate()) { mkdirSync(dirname(join(INTERNAL, name)), { recursive: true }); writeFileSync(join(INTERNAL, name), data); }
  }
}
