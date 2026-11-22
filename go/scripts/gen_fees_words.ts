// Writes the words the Go Fees runtime says to parents and owners, from the TypeScript (wave 3, decision 61):
//   go/internal/fees/words/<lang>.json.gz   for en, hi, ml, kn: every message of templates/education/fees/src/language/templates.ts (with Classes' src/classes/words.ts) with
//                                           `{slot}` where a value of the record goes, how "where to pay" is written (a link, or a UPI link with the centre's UPI ID), one line of a
//                                           family reminder and of the next-classes answer, the WhatsApp templates (meta-templates.ts) with how each slot is filled, and the
//                                           button labels (interactive.ts)
//   go/internal/fees/reading.json           the word lists of the rule parser (rule-parser.ts FEE_WORDS) and of Classes' contact words (classes/parse.ts CLASS_WORDS)
// Run with node from the repository root:   node go/scripts/gen_fees_words.ts        (add --check to only compare with the committed files)
//
// The method is go/scripts/gen_bookings_words.ts's: each template is RENDERED with probe facts and each probe's own text is turned back into a `{slot}`; which facts a message
// needs is found by taking each away and seeing whether the real function refuses (`need` throws), and the slots must read exactly those facts. Three values are not plain
// text around a fact, so each is carried as a pattern of its own and checked here against the real function on other values: `{payTo}` (templates.ts payTo: the link, or the
// link with "(UPI ID ..., payee)" for a UPI centre), `{family}` (familyLines: one line per open fee, joined with " | ") and `{classLines}` (classes/words.ts classLines). Nothing
// a parent reads is typed twice; `words-fresh` fails when a committed file is out of date. Dates, times and rupees are the shared formats (go/internal/language/formats.json).
import { gunzipSync, gzipSync } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TEMPLATES, TEMPLATE_NAMES, familyLines, payTo, render } from "../../templates/education/fees/src/language/templates.ts";
import type { FamilyLine, MessageFacts, TemplateId } from "../../templates/education/fees/src/language/templates.ts";
import { META_TEMPLATES, parametersFor } from "../../templates/education/fees/src/language/meta-templates.ts";
import { LABELS } from "../../templates/education/fees/src/language/interactive.ts";
import { classLines } from "../../templates/education/fees/src/classes/words.ts";
import { FEE_WORDS } from "../../templates/education/fees/src/adapters/rule-parser.ts";
import { CLASS_WORDS } from "../../templates/education/fees/src/classes/parse.ts";
import { formatDate, formatInr, formatTime } from "../../modules/language/format.ts";
import { localParts } from "../../modules/core/time.ts";
import type { MetaTemplate } from "../../modules/language/meta-templates.ts";
import { LANGUAGES } from "../../modules/language/languages.ts";
import type { Language } from "../../modules/language/languages.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, "..", "..");
const TZ = "Asia/Kolkata";
const DUE_MS = Date.UTC(2026, 10, 4, 18, 30); // Thu 5 Nov 2026 at midnight in India
const CLASS_MS = Date.UTC(2026, 10, 9, 11, 30); // Mon 9 Nov 2026, 5:00 pm in India
const OTHER_MS = Date.UTC(2026, 9, 21, 18, 30); // Thu 22 Oct 2026

type Fact = keyof MessageFacts;
type Bag = Record<string, string>;

/** The probe facts: every optional fact present, each with a text of its own that cannot occur in the words. `upi` adds the centre's UPI ID and payee. */
function probe(language: Language, upi: boolean): MessageFacts {
  return {
    language, timeZone: TZ, businessName: "qzbusiness", studentName: "qzstudent", batchName: "qzbatch", monthLabel: "qzmonth",
    feeInr: 7770001, lateFeeInr: 7770002, balanceInr: 7770003, paidInr: 7770004, receivedInr: 7770005, waiverInr: 7770006, refundInr: 7770007, waiverLimitInr: 7770008,
    dueMs: DUE_MS, graceDays: 8801, link: "https://qzlink.example/pay", dueRef: "qzref", requestRef: "qzreq", customerPhone: "+919000000001", approvalCode: "QZCODE",
    approvalHours: 8802, approvalsLeft: 8803, upiCode: "QZUPICODE", partner: "qzpartner", openFeesCount: 8804, pageLink: "https://qzpage.example/f/qz",
    payee: "qzpayee", ...(upi ? { upiId: "qzupi@bank" } : {}), // payTo reads the payee only with a UPI ID; the QR caption names it anyway
    family: [familyLine("a")],
    classMs: CLASS_MS, classLink: "https://qzclass.example/j", materialLink: "https://qzmaterial.example/m", roster: "qzroster", doubtText: "qzdoubt",
    classLines: [{ studentName: "qzlinestudent", batchName: "qzlinebatch", startMs: CLASS_MS }],
    leadMinutes: 8805, presentCount: 8806, absentCount: 8807, notedCount: 8808, waitingCount: 8809, sentCount: 8810, heldCount: 8811,
  };
}

const familyLine = (tag: string): FamilyLine => ({ studentName: `qzfam${tag}student`, batchName: `qzfam${tag}batch`, monthLabel: `qzfam${tag}month`, balanceInr: 7770090, dueMs: OTHER_MS, link: `https://qzfam${tag}.example/pay`, dueRef: `qzfam${tag}ref` });

/** Every fact `need()` can ask for. */
const NEEDED: Fact[] = ["studentName", "batchName", "monthLabel", "feeInr", "lateFeeInr", "balanceInr", "paidInr", "receivedInr", "waiverInr", "refundInr", "waiverLimitInr", "dueMs", "graceDays", "link", "dueRef", "requestRef", "customerPhone", "approvalCode", "approvalHours", "approvalsLeft", "payee", "upiCode", "partner", "openFeesCount", "pageLink", "family", "classMs", "classLink", "materialLink", "roster", "doubtText", "classLines", "leadMinutes", "presentCount", "absentCount", "notedCount", "waitingCount", "sentCount", "heldCount"];

/** The slots, in the order they are looked for: [the probe's text, the slot's name]. */
function slotTable(f: MessageFacts): [string, string][] {
  const rupees = (k: "feeInr" | "lateFeeInr" | "balanceInr" | "paidInr" | "receivedInr" | "waiverInr" | "refundInr" | "waiverLimitInr"): [string, string] => [formatInr(f[k] as number), k];
  const counts = (["graceDays", "approvalHours", "approvalsLeft", "openFeesCount", "leadMinutes", "presentCount", "absentCount", "notedCount", "waitingCount", "sentCount", "heldCount"] as const).map((k): [string, string] => [String(f[k]), k]);
  const texts = (["businessName", "studentName", "batchName", "monthLabel", "dueRef", "requestRef", "customerPhone", "approvalCode", "upiCode", "partner", "pageLink", "classLink", "materialLink", "roster", "doubtText", "link"] as const).map((k): [string, string] => [String(f[k]), k]);
  const t: [string, string][] = [
    [familyLines(f), "family"], [classLines(f), "classLines"], [payTo(f), "payTo"],
    [formatDate(localParts(DUE_MS, TZ), f.language), "dueDate"], [formatDate(localParts(CLASS_MS, TZ), f.language), "classDate"], [formatTime(localParts(CLASS_MS, TZ), f.language), "classTime"],
    ...(["feeInr", "lateFeeInr", "balanceInr", "paidInr", "receivedInr", "waiverInr", "refundInr", "waiverLimitInr"] as const).map(rupees),
    ...counts, ...texts,
    [f.payee!, "payee"], ...(f.upiId ? [[f.upiId, "upiId"] as [string, string]] : []),
  ];
  return t.sort((a, b) => b[0].length - a[0].length);
}

/** The fact each slot reads, as a refusal names it. `payTo` reads the link (and a UPI centre's payee); `dueDate` reads dueMs; the class date and time read classMs. */
const FACT: Record<string, Fact | null> = {
  family: "family", classLines: "classLines", payTo: "link", dueDate: "dueMs", classDate: "classMs", classTime: "classMs", businessName: null, upiId: null, payee: "payee",
  ...Object.fromEntries(NEEDED.map((k) => [k, k])),
};

function slotted(text: string, f: MessageFacts, what: string): string {
  let out = text;
  for (const [probeText, name] of slotTable(f)) out = out.split(probeText).join(`{${name}}`);
  const bare = out.replace(/\{[A-Za-z]+\}/gu, "");
  if (/[{}]/u.test(bare)) throw new Error(`${what}: a brace is left in the words: ${out}`);
  if (/qz|Qz|QZ/u.test(bare)) throw new Error(`${what}: a probe was left in: ${out}`);
  return out;
}

/** The facts a message cannot be written without, found by taking each away (the real `need` throws). */
function requiredFacts(language: Language, id: TemplateId, withProbe: MessageFacts, text: string): Fact[] {
  const required = new Set<Fact>();
  for (const key of NEEDED) {
    const f = { ...withProbe } as Record<string, unknown>;
    delete f[key];
    try {
      const got = render(id, f as unknown as MessageFacts);
      if (got !== text) throw new Error(`${language} ${id}: without ${key} the message changes instead of being refused`);
    } catch (e) {
      if (String((e as Error).message).includes(`needs "${key}"`)) required.add(key);
      else throw e;
    }
  }
  return [...required];
}

function templates(language: Language): Bag {
  const f = probe(language, false);
  const u = probe(language, true);
  const t: Bag = {};
  for (const id of Object.keys(TEMPLATES[language]) as TemplateId[]) {
    const text = render(id, f);
    const slots = slotted(text, f, `${language} ${id}`);
    // a UPI centre's words are the same with `{payTo}` written the UPI way, and nothing else changes
    if (slotted(render(id, u), u, `${language} ${id} (UPI)`) !== slots) throw new Error(`${language} ${id}: a UPI centre's words differ by more than {payTo}`);
    const used = new Set([...slots.matchAll(/\{([A-Za-z]+)\}/gu)].map((m) => FACT[m[1]]).filter((x): x is Fact => !!x));
    const needs = requiredFacts(language, id, f, text);
    if ([...used].sort().join() !== needs.sort().join()) throw new Error(`${language} ${id}: the slots read ${[...used]} but the message needs ${needs}`);
    t[id] = slots;
  }
  return t;
}

/** payTo, familyLines and classLines as patterns, checked against the real functions on two values each. */
function patterns(language: Language): Bag {
  const f = probe(language, false);
  const u = probe(language, true);
  const one = (facts: MessageFacts, text: string, extra: [string, string][]): string => {
    let out = text;
    for (const [p, n] of [...extra, ...slotTable(facts).filter(([, n]) => !["family", "classLines", "payTo"].includes(n))].sort((a, b) => b[0].length - a[0].length)) out = out.split(p).join(`{${n}}`);
    if (/qz|Qz|QZ/u.test(out.replace(/\{[A-Za-z]+\}/gu, ""))) throw new Error(`${language}: a probe was left in a pattern: ${out}`);
    return out;
  };
  const line = familyLine("a");
  const lineSlots: [string, string][] = [[line.studentName, "studentName"], [line.batchName, "batchName"], [line.monthLabel, "monthLabel"], [formatInr(line.balanceInr), "balanceInr"], [formatDate(localParts(line.dueMs, TZ), language), "dueDate"], [line.link, "link"], [line.dueRef, "dueRef"]];
  const familyLink = one(f, familyLines({ ...f, family: [line] }), lineSlots);
  const familyUpi = one(u, familyLines({ ...u, family: [line] }), lineSlots);
  const cl = { studentName: "qzlinestudent", batchName: "qzlinebatch", startMs: CLASS_MS };
  const classLine = one(f, classLines({ ...f, classLines: [cl] }), [[cl.studentName, "studentName"], [cl.batchName, "batchName"]]);
  const out = { payToLink: one(f, payTo(f), []), payToUpi: one(u, payTo(u), []), familyLink, familyUpi, familyJoin: " | ", classLine, classJoin: " | " };
  // the Go side rebuilds two lines the way it will; it must give what TypeScript writes
  const two = [familyLine("a"), { ...familyLine("b"), dueMs: DUE_MS }];
  for (const [facts, pattern] of [[f, familyLink], [u, familyUpi]] as const) {
    const made = two.map((l) => pattern.replace("{studentName}", l.studentName).replace("{batchName}", l.batchName).replace("{monthLabel}", l.monthLabel).replace("{balanceInr}", formatInr(l.balanceInr))
      .replace("{dueDate}", formatDate(localParts(l.dueMs, TZ), language)).replace("{link}", l.link).replace("{dueRef}", l.dueRef).replace("{upiId}", facts.upiId ?? "").replace("{payee}", facts.payee ?? "")).join(" | ");
    if (made !== familyLines({ ...facts, family: two })) throw new Error(`${language}: the family lines are not rebuilt the way Go builds them`);
  }
  if (out.payToLink !== "{link}" || !out.payToUpi.startsWith("{link}")) throw new Error(`${language}: payTo is not the link first`);
  return out;
}

/** The WhatsApp templates and how each of their slots is filled (a slot of the message). */
function metaWords(language: Language): { meta: unknown[]; metaSlots: Bag } {
  const f = probe(language, false);
  const names = new Set<string>();
  const meta = META_TEMPLATES.map((m: MetaTemplate<TemplateId>) => {
    for (const s of m.bodies[language].matchAll(/\{([A-Za-z]+)\}/gu)) names.add(s[1]);
    if (m.header) throw new Error(`${m.name} has a header: the Go submissions do not write one yet`);
    return { name: m.name, usedFor: m.usedFor, audience: m.audience, body: m.bodies[language] };
  });
  const metaSlots: Bag = {};
  for (const name of [...names].sort()) {
    const one: MetaTemplate<TemplateId> = { name: "probe", usedFor: "fee_menu", audience: "customer", bodies: { en: `{${name}}`, hi: `{${name}}`, ml: `{${name}}`, kn: `{${name}}` } };
    const value = parametersFor(one, language, f)[0];
    const expr = slotted(value, f, `${language} meta slot ${name}`);
    if (!/^\{[A-Za-z]+\}$/u.test(expr)) throw new Error(`${language} meta slot ${name} is not one slot: ${expr}`);
    metaSlots[name] = expr.slice(1, -1);
  }
  return { meta, metaSlots };
}

function pack(language: Language): unknown {
  return { lang: language, t: templates(language), patterns: patterns(language), ...metaWords(language), labels: LABELS[language], generic: TEMPLATE_NAMES };
}

/** Every file, by its path from the repository root, as its uncompressed text. */
export function generate(): Map<string, string> {
  const out = new Map<string, string>();
  for (const l of LANGUAGES) out.set(`go/internal/fees/words/${l}.json.gz`, JSON.stringify(pack(l)) + "\n");
  // the word lists the rule parser and Classes' contact words read (rule-parser.ts FEE_WORDS, classes/parse.ts CLASS_WORDS), which the Go side builds with language.WordRe as they do
  out.set("go/internal/fees/reading.json", JSON.stringify({ fee: FEE_WORDS, classes: CLASS_WORDS }, null, 1) + "\n");
  return out;
}

/** The committed files that are out of date (a .gz is compared by its unpacked text). */
export function staleFiles(root = ROOT, files = generate()): string[] {
  const stale: string[] = [];
  for (const [name, text] of files) {
    let have = "";
    try { const raw = readFileSync(join(root, name)); have = (name.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8"); } catch { /* missing */ }
    if (have !== text) stale.push(name);
  }
  return stale;
}

if (import.meta.main) {
  const files = generate();
  if (process.argv.includes("--check")) {
    const stale = staleFiles(ROOT, files);
    for (const name of stale) console.error(`stale: ${name}`);
    process.exitCode = stale.length ? 1 : 0;
  } else {
    for (const [name, text] of files) {
      mkdirSync(dirname(join(ROOT, name)), { recursive: true });
      writeFileSync(join(ROOT, name), name.endsWith(".gz") ? gzipSync(Buffer.from(text), { level: 9, mtime: 0 } as never) : text);
    }
    console.log(`wrote ${files.size} files`);
  }
}
