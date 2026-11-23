// Writes what the Go Stock orders monthly report (go/internal/stockordersreport) takes from the TypeScript as DATA, made by RUNNING it, never retyped:
//   stockordersreport/words/words.json.gz
//     strings    templates/commerce/stock-orders/report/strings.ts STRINGS in four languages. A word that is a function of its arguments is carried as a template with {0}, {1} ...
//                slots (internal/slots) after lib_words.ts has checked on other values that it does nothing but put its arguments in; one that does more fails here and must be
//                described by hand. `checkGenuine` is NOT carried (Go has it from internal/report's own generated words; the generator asserts it is the very same value). Of the go-live
//                certificate's words (`cert`) only `held` is carried: the monthly report says it in its go-live lines; the rest belong to the certificate's page, which the CLI and the
//                deployer make and stay TypeScript (Deferred.md).
//     facts      what data.ts, text.ts and whatsapp.ts take from other TypeScript files: the rule ids, "not counted", the sources, the hand check's "not tested" ids, the languages, the
//                pathway name and version (package.json), the digest of Glow Unisex Salon's settings (what a go-live certificate that ran on the example says), and the two WhatsApp
//                templates (name, badge, wording per language).
// Run from the repository root:  node go/scripts/gen_stockorders_report_words.ts   (--check only compares; words-fresh.test.ts fails when it was not run after a change to the report's words)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { LANGUAGES } from "../../modules/language/languages.ts";
import { CHECK_GENUINE } from "../../modules/report/text.ts";
import { NOT_COUNTED, PATHWAY, RULE_IDS, SOURCES, checkedPolicyDigest } from "../../templates/commerce/stock-orders/report/data.ts";
import { STRINGS } from "../../templates/commerce/stock-orders/report/strings.ts";
import { REPORT_TEMPLATES } from "../../templates/commerce/stock-orders/report/whatsapp.ts";
import { notTestedOf } from "../../templates/commerce/stock-orders/crash-test/not-tested.ts";
import { glowSalon } from "../../templates/commerce/stock-orders/src/harness.ts";
import { pack, slotted } from "./lib_words.ts";

const here = dirname(fileURLToPath(import.meta.url));
const INTERNAL = join(here, "..", "internal");
export const OUT = INTERNAL;

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
    if (s.checkGenuine !== CHECK_GENUINE[l]) throw new Error(`the strings of ${l} no longer take checkGenuine from the shared words: Go reads it from internal/report`);
    const mine = Object.fromEntries(Object.entries(s).filter(([k]) => k !== "checkGenuine" && k !== "cert"));
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
    sources: SOURCES,
    notTested: notTestedOf(glowSalon()).map((n) => n.id),
    templates: REPORT_TEMPLATES.map((t) => ({ name: t.name, badge: t.badge, bodies: t.bodies })),
  };
}

function words(): Buffer { return pack({ strings: strings(), facts: facts() }); }

export function generate(): Map<string, Buffer> { return new Map([["stockordersreport/words/words.json.gz", words()]]); }

/** Compares the UNPACKED text, not the gzip bytes (those may differ between zlib versions). */
export function staleFiles(root = INTERNAL): string[] {
  return [...generate()].filter(([name, data]) => !existsSync(join(root, name)) || gunzipSync(readFileSync(join(root, name))).toString("utf8") !== gunzipSync(data).toString("utf8")).map(([name]) => name);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--check")) {
    const stale = staleFiles();
    if (stale.length) { console.error(`out of date: ${stale.join(", ")}  (run node go/scripts/gen_stockorders_report_words.ts)`); process.exit(1); }
  } else {
    for (const [name, data] of generate()) { mkdirSync(dirname(join(INTERNAL, name)), { recursive: true }); writeFileSync(join(INTERNAL, name), data); }
  }
}
