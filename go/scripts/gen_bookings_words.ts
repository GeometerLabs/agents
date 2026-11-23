// Writes the words the Go Bookings runtime says to customers and owners, and the formats every Go template shares, from the TypeScript (wave 2, decision 61):
//   go/internal/bookings/words/<lang>.json.gz   for en, hi, ml, kn: every message of templates/commerce/bookings/src/language/templates.ts with `{slot}` where a value of the
//                                               record goes, the WhatsApp templates (meta-templates.ts) with how each of their slots is filled, the button and list labels
//                                               (interactive.ts) and Meta's limits, the owner's day list
//   go/internal/language/formats.json           how modules/language/format.ts writes a date and a time of day, per language (shared: Orders and Fees will read the same file)
// Run with node from the repository root:   node go/scripts/gen_bookings_words.ts        (add --check to only compare with the committed files)
//
// Why a generator and not a retyped table: the words are written once, in TypeScript, in four languages, and Go must say the same thing byte for byte. Each template is a function
// of the booking's facts, so it is RENDERED here with probe facts (a name like "qzservice", an amount like 7770002, an instant) and each probe's own text is turned back into a
// `{slot}`; the Go side only substitutes. The slots are named after the fact they come from (`{depositInr}` is the rupee text of depositInr, `{slot}` the date and time of
// slotMs, `{Service}` the service name opening an English sentence). Which facts a message needs is found by taking each fact away and seeing whether the real function refuses
// (`need` throws), so the Go side refuses the same messages. Nothing the customer reads is typed twice; the test `words-fresh` fails when a committed file is out of date.
//
// Dates and times need no Intl: format.ts writes them from its own tables (weekday and month names, the day-part words); the tables are carried as data (formats.json), found by
// writing a date for each weekday and month and a time for each hour. The only Intl in the path is the time zone (localParts) and the rupee grouping (toLocaleString "en-IN"); Go
// does both itself (its time zone database, language.FormatInr) and the tests prove them equal on every case of templates-vectors.json. The Node that made the committed data: v26.10.0.
import { gunzipSync, gzipSync } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TEMPLATES, TEMPLATE_NAMES, render } from "../../templates/commerce/bookings/src/language/templates.ts";
import type { MessageFacts, TemplateId } from "../../templates/commerce/bookings/src/language/templates.ts";
import { META_TEMPLATES, parametersFor } from "../../templates/commerce/bookings/src/language/meta-templates.ts";
import { LABELS } from "../../templates/commerce/bookings/src/language/interactive.ts";
import { LIMITS } from "../../modules/language/interactive.ts";
import { formatDate, formatInr, formatSlot, formatTime, groupPhone } from "../../modules/language/format.ts";
import { WEEKDAY_NAMES, MONTH_NAMES } from "../../modules/language/format.ts";
import { localParts } from "../../modules/core/time.ts";
import type { MetaTemplate } from "../../modules/language/meta-templates.ts";
import { LANGUAGES } from "../../modules/language/languages.ts";
import type { Language } from "../../modules/language/languages.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, "..", "..");
const TZ = "Asia/Kolkata";
const SLOT_MS = Date.UTC(2026, 10, 10, 12, 30); // Tue 10 Nov 2026, 6:00 pm in India

type Fact = keyof MessageFacts;
type Bag = Record<string, string>;

/** The probe facts: every optional fact present, each with a text of its own that cannot occur in the words (lower-case "qz..." names, amounts of seven digits, counts of four). */
function probe(language: Language): MessageFacts {
  return {
    language, timeZone: TZ, businessName: "qzbusiness",
    services: [{ name: "qzsvcone", priceInr: 7770011 }, { name: "qzsvctwo", priceInr: 7770012 }],
    serviceName: "qzservice", priceInr: 7770001, depositInr: 7770002, refundInr: 7770003, slotMs: SLOT_MS,
    link: "https://qzlink.example/pay", pageLink: "https://qzpage.example/b/qz", holdMinutes: 8801, windowHours: 8802, bookingRef: "qzref",
    customerPhone: "+919000000001", approvalCode: "QZCODE", approvalHours: 8803, approvalsLeft: 8804, upiId: "qzupi@bank", payee: "qzpayee",
    upiCode: "QZUPICODE", markedInr: 7770004, leftInr: 7770005, partner: "qzpartner", upcomingCount: 8805,
    offeredInr: 7770006, discountCode: "QZDISCODE",
  };
}

/** Every fact `need()` can ask for. */
const NEEDED: Fact[] = ["serviceName", "priceInr", "depositInr", "refundInr", "slotMs", "link", "pageLink", "holdMinutes", "windowHours", "bookingRef", "customerPhone", "approvalCode", "approvalHours", "approvalsLeft", "upiId", "payee", "upiCode", "markedInr", "leftInr", "partner", "upcomingCount", "offeredInr", "discountCode"];

/** The slots, in the order they are looked for: [the probe's text, the slot's name]. The fact a slot reads (and so what a refusal names) is in `FACT`. */
function slotTable(f: MessageFacts): [string, string][] {
  const rupees = (k: "priceInr" | "depositInr" | "refundInr" | "markedInr" | "leftInr" | "offeredInr"): [string, string] => [formatInr(f[k] as number), k];
  const t: [string, string][] = [
    [`${f.services[0].name} ${formatInr(f.services[0].priceInr)}, ${f.services[1].name} ${formatInr(f.services[1].priceInr)}`, "menuList"],
    [formatSlot(SLOT_MS, TZ, f.language), "slot"],
    [f.link!, "link"], [f.pageLink!, "pageLink"],
    rupees("priceInr"), rupees("depositInr"), rupees("refundInr"), rupees("markedInr"), rupees("leftInr"), rupees("offeredInr"),
    [String(f.holdMinutes), "holdMinutes"], [String(f.windowHours), "windowHours"], [String(f.approvalHours), "approvalHours"], [String(f.approvalsLeft), "approvalsLeft"], [String(f.upcomingCount), "upcomingCount"],
    [groupPhone(f.customerPhone!), "customerPhone"], [f.customerPhone!, "customerPhoneRaw"],
    [f.upiCode!, "upiCode"], [f.approvalCode!, "approvalCode"], [f.discountCode!, "discountCode"], [f.upiId!, "upiId"], [f.payee!, "payee"], [f.partner!, "partner"], [f.bookingRef!, "bookingRef"], [f.businessName, "businessName"],
    ["Qzservice", "Service"], [f.serviceName!, "serviceName"],
  ];
  return t.sort((a, b) => b[0].length - a[0].length);
}

/** The fact each slot reads, as a refusal names it. */
const FACT: Record<string, Fact | null> = {
  menuList: null, slot: "slotMs", link: "link", pageLink: "pageLink", priceInr: "priceInr", depositInr: "depositInr", refundInr: "refundInr", markedInr: "markedInr", leftInr: "leftInr",
  holdMinutes: "holdMinutes", windowHours: "windowHours", approvalHours: "approvalHours", approvalsLeft: "approvalsLeft", upcomingCount: "upcomingCount", customerPhone: "customerPhone",
  customerPhoneRaw: "customerPhone", upiCode: "upiCode", offeredInr: "offeredInr", discountCode: "discountCode", approvalCode: "approvalCode", upiId: "upiId", payee: "payee", partner: "partner", bookingRef: "bookingRef", businessName: null,
  Service: "serviceName", serviceName: "serviceName", dayList: null,
};

/** A probe's text turned into slots. Throws when braces are left over (a word that looks like a slot) so a slot is never confused with a word. */
function slotted(text: string, f: MessageFacts, what: string): string {
  let out = text;
  for (const [probeText, name] of slotTable(f)) out = out.split(probeText).join(`{${name}}`);
  const bare = out.replace(/\{[A-Za-z]+\}/gu, "");
  if (/[{}]/u.test(bare)) throw new Error(`${what}: a brace is left in the words: ${out}`);
  if (/qz|Qz|QZ/u.test(bare)) throw new Error(`${what}: a probe was left in: ${out}`);
  return out;
}

/** The facts a message cannot be written without, found by taking each away (the real `need` throws), in the order the slots name them. */
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

function templates(language: Language): { t: Bag; day: unknown } {
  const f = probe(language);
  const t: Bag = {};
  for (const id of Object.keys(TEMPLATES[language]) as TemplateId[]) {
    if (id === "owner_day_bookings") { t[id] = "{dayList}"; continue; }
    const text = render(id, f);
    const slotsText = slotted(text, f, `${language} ${id}`);
    const used = new Set([...slotsText.matchAll(/\{([A-Za-z]+)\}/gu)].map((m) => FACT[m[1]]).filter((x): x is Fact => !!x));
    const needs = requiredFacts(language, id, f, text);
    if ([...used].sort().join() !== needs.sort().join()) throw new Error(`${language} ${id}: the slots read ${[...used]} but the message needs ${needs}`);
    t[id] = slotsText;
  }
  return { t, day: dayWords(language) };
}

/** The owner's day list (templates.ts dayList): the heading and the "none" line of each day, and one row, found by writing the list for one booking; checked against two. */
function dayWords(language: Language): unknown {
  const f = probe(language);
  const time = formatTime(localParts(SLOT_MS, TZ), language);
  const row = (n: string, phone: string) => ({ slotMs: SLOT_MS, serviceName: n, customerPhone: phone, ref: "b-1" });
  const out: Record<string, unknown> = { heading: {}, none: {}, row: "" };
  for (const day of ["today", "tomorrow"] as const) {
    out.none = { ...(out.none as object), [day]: render("owner_day_bookings", { ...f, day, dayBookings: [] }) };
    const one = render("owner_day_bookings", { ...f, day, dayBookings: [row("qzrowsvc", "+919000000002")] }).split("\n");
    if (one.length !== 2) throw new Error(`${language}: the day list is not a heading and a row`);
    out.heading = { ...(out.heading as object), [day]: one[0] };
    const shape = one[1].replace(time, "{time}").replace("qzrowsvc", "{service}").replace("+91 90000 00002", "{phone}");
    if (out.row !== "" && out.row !== shape) throw new Error(`${language}: the day list's row differs between days`);
    out.row = shape;
  }
  // the reconstruction Go does must give what TypeScript writes for two bookings
  const two = [row("qzrowsvc", "+919000000002"), row("qzother", "+919000000003")];
  const want = render("owner_day_bookings", { ...f, day: "tomorrow", dayBookings: two });
  const made = [(out.heading as Bag).tomorrow, ...two.map((r) => (out.row as string).replace("{time}", time).replace("{service}", r.serviceName).replace("{phone}", groupPhone(r.customerPhone)))].join("\n");
  if (made !== want) throw new Error(`${language}: the day list is not rebuilt the way Go builds it:\n${made}\n${want}`);
  return out;
}

/** The WhatsApp templates: the name and the audience, the message it carries the words of, and the body with `{slot}`s; and how each slot is filled (a slot expression over the same facts). */
function metaWords(language: Language): { meta: unknown[]; metaSlots: Bag } {
  const f = probe(language);
  const names = new Set<string>();
  const meta = META_TEMPLATES.map((m: MetaTemplate<TemplateId>) => {
    for (const s of m.bodies[language].matchAll(/\{([A-Za-z]+)\}/gu)) names.add(s[1]);
    // an image header needs Meta's example picture handle at submission (HEADER_HANDLE_TO_UPLOAD): no Bookings template has one, and the Go side does not write one
    if (m.header) throw new Error(`${m.name} has a header: the Go submissions do not write one yet (go/internal/bookings/Deferred.md)`);
    return { name: m.name, usedFor: m.usedFor, audience: m.audience, body: m.bodies[language] };
  });
  // a slot's value is `VALUE[name](facts)` in meta-templates.ts (not exported): ask `parametersFor` through a template that is that slot alone
  const metaSlots: Bag = {};
  for (const name of [...names].sort()) {
    const one: MetaTemplate<TemplateId> = { name: "probe", usedFor: "menu", audience: "customer", bodies: { en: `{${name}}`, hi: `{${name}}`, ml: `{${name}}`, kn: `{${name}}` } };
    const value = parametersFor(one, language, f)[0];
    const expr = slotted(value, f, `${language} meta slot ${name}`);
    if (!/^\{[A-Za-z]+\}$/u.test(expr)) throw new Error(`${language} meta slot ${name} is not one slot: ${expr}`);
    metaSlots[name] = expr.slice(1, -1);
  }
  return { meta, metaSlots };
}

/** One language's pack. */
function pack(language: Language): unknown {
  const { t, day } = templates(language);
  // generic: the three template names a message that is none of the approved templates goes out under (templates.ts TEMPLATE_NAMES), the same in every language
  return { lang: language, t, day, ...metaWords(language), labels: LABELS[language], limits: LIMITS, generic: TEMPLATE_NAMES };
}

/** How format.ts writes a date and a time of day, as data: the names, whether a comma follows the weekday, and each hour's time with `{mm}` for the minutes. */
function formats(): unknown {
  const out: Record<string, unknown> = {};
  for (const l of LANGUAGES) {
    const comma = formatDate({ year: 2026, month: 11, day: 10 }, l).includes(",");
    for (let wd = 0; wd < 7; wd++) {
      const want = comma ? `${WEEKDAY_NAMES[l][wd]}, ${15 + wd} ${MONTH_NAMES[l][10]}` : `${WEEKDAY_NAMES[l][wd]} ${15 + wd} ${MONTH_NAMES[l][10]}`;
      if (formatDate({ year: 2026, month: 11, day: 15 + wd }, l) !== want) throw new Error(`${l}: formatDate is not "weekday, day month"`);
    }
    const time: Bag = {};
    for (let h = 0; h < 24; h++) {
      time[String(h)] = formatTime({ hour: h, minute: 59 }, l).replace(":59", ":{mm}");
      for (const m of [0, 7, 30, 59]) if (formatTime({ hour: h, minute: m }, l) !== time[String(h)].replace("{mm}", String(m).padStart(2, "0"))) throw new Error(`${l}: formatTime is not hour-by-hour with the minutes in two digits`);
    }
    out[l] = { weekdays: WEEKDAY_NAMES[l], months: MONTH_NAMES[l], comma, time };
  }
  return out;
}

/** Every file, by its path from the repository root, as its uncompressed text. */
export function generate(): Map<string, string> {
  const out = new Map<string, string>();
  for (const l of LANGUAGES) out.set(`go/internal/bookings/words/${l}.json.gz`, JSON.stringify(pack(l)) + "\n");
  out.set("go/internal/language/formats.json", JSON.stringify(formats(), null, 1) + "\n");
  return out;
}

/** The committed files that are out of date (a .gz is compared by its unpacked text: the bytes may differ between zlib versions). */
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
