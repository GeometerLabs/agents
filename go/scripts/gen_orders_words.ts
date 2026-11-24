// Writes the words the Go Orders runtime says to customers and owners, and the vectors that prove the Go twin equal to the TypeScript (wave W4, decision 61):
//   go/internal/orders/words/<lang>.json.gz            for en, hi, ml, kn: every message of templates/commerce/orders/src/language/templates.ts (with the plan messages of
//                                                      src/plans/templates.ts) with `{slot}` where a value of the record goes, the composite values (the window, how the order is
//                                                      collected, what is left to pay, where to pay), the WhatsApp templates (meta-templates.ts) with how each slot is filled, the
//                                                      button and list labels and ids (interactive.ts), Meta's limits, and the constants of exampleFacts
//   go/internal/orders/words/testdata/render-vectors.json.gz   every message of every language rendered from four varied sets of facts and from those facts with each
//                                                      needed fact taken away, each with the outgoing check's verdict
//   go/internal/orders/words/testdata/words-vectors.json.gz    the WhatsApp parameters, templateMessage and submissions, labels, buttons, lists, the owner's mark buttons, exampleFacts
// Run with node from the repository root:   node go/scripts/gen_orders_words.ts        (add --check to only compare with the committed files)
//
// Why a generator and not a retyped table: the words are written once, in TypeScript, in four languages, and Go must say the same thing byte for byte. Each template is a function
// of the order's facts, so it is RENDERED here with probe facts (a name like "qzitems", an amount like 7770002, an instant) and each probe's own text is turned back into a
// `{slot}`; the Go side only substitutes. Four values are not one fact but a small rule over several, so they are slots of their own whose wording is found by asking the real
// helpers (exported from templates.ts for this): {when} (the order's day and window), {cutAt}, {how} ("pickup" or "delivery to <area>"), {rest} (nothing, or what is paid on
// collection) and {payTo} (the link, with the shop's UPI ID after it on a UPI shop), with {upiNote} the sentence a UPI shop's message ends with. A message is written twice, with
// and without a UPI ID, and the two are folded into one text with those slots. Which facts a message needs is found by taking each away (`need` throws), so the Go side refuses
// the same messages, naming the same first missing fact; the vectors prove the order. The Node that made the committed data: v26.10.0.
import { gunzipSync, gzipSync } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TEMPLATES, TEMPLATE_NAMES, render, when, day, cutAt, how, payTo, rest } from "../../templates/commerce/orders/src/language/templates.ts";
import type { MessageFacts, TemplateId } from "../../templates/commerce/orders/src/language/templates.ts";
import { META_TEMPLATES, exampleFacts, metaSubmissions, parametersFor, templateMessage } from "../../templates/commerce/orders/src/language/meta-templates.ts";
import { ID, LABELS, buttonsFor, itemList, itemRowId, ownerMarkButtons, slotList, slotRowId } from "../../templates/commerce/orders/src/language/interactive.ts";
import type { ButtonId } from "../../templates/commerce/orders/src/language/interactive.ts";
import { checkMessage } from "../../templates/commerce/orders/src/language/check.ts";
import { checkMessageMatchesRecord } from "../../templates/commerce/orders/src/limits.ts";
import { annapurna, sweetCrumbs } from "../../templates/commerce/orders/src/harness.ts";
import { itemName } from "../../templates/commerce/orders/src/settings.ts";
import type { Settings } from "../../templates/commerce/orders/src/settings.ts";
import { LIMITS, clip } from "../../modules/language/interactive.ts";
import { formatDate, formatInr, formatTime } from "../../modules/language/format.ts";
import { localParts } from "../../modules/core/time.ts";
import { MARK_BUTTON } from "../../modules/payments/owner-marked/owner.ts";
import { fillBody, metaBody } from "../../modules/language/meta-templates.ts";
import type { MetaTemplate } from "../../modules/language/meta-templates.ts";
import { LANGUAGES } from "../../modules/language/languages.ts";
import type { Language } from "../../modules/language/languages.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, "..", "..");
const OUT = "go/internal/orders/words";
const TZ = "Asia/Kolkata";
const MIN = 60_000;
const SLOT_FROM = Date.UTC(2026, 10, 10, 12, 30); // Tue 10 Nov 2026, 6:00 pm in India
const SLOT_TO = SLOT_FROM + 90 * MIN; // 7:30 pm
const DATE_MS = Date.UTC(2026, 10, 12, 18, 30); // Fri 13 Nov, midnight in India
const CUTOFF = Date.UTC(2026, 10, 9, 14, 30); // Mon 9 Nov, 8:00 pm
const PLAN_FROM = Date.UTC(2026, 10, 15, 18, 30); // Mon 16 Nov
const PLAN_TO = Date.UTC(2026, 11, 14, 18, 30); // Tue 15 Dec
const PAID_MS = Date.UTC(2026, 10, 3, 6, 0); // Tue 3 Nov: the day a UPI refund's payment was marked (25 Nov 2026)

type Fact = string; // a key of MessageFacts, or "plan.meals" | "plan.fromMs" | "plan.toMs"
type Bag = Record<string, string>;

/** The probe facts: every optional fact present, each with a text of its own that cannot occur in the words (lower-case "qz..." names, amounts of seven digits, counts of four). */
function probe(language: Language, upi: boolean): MessageFacts {
  const f: MessageFacts = {
    language, timeZone: TZ, businessName: "qzbusiness",
    menu: [{ name: "qzmenuone", priceInr: 7770011 }, { name: "qzmenutwo", priceInr: 7770012 }],
    itemsText: "qzitems", quantities: [8811, 8812], itemName: "qzitem", priceInr: 7770001, leftCount: 8801,
    totalInr: 7770002, advanceInr: 7770003, balanceInr: 7770004, refundInr: 7770005, markedInr: 7770006, leftInr: 7770007,
    dateMs: DATE_MS, slotFromMs: SLOT_FROM, slotToMs: SLOT_TO, cutoffMs: CUTOFF,
    mode: "delivery", area: "qzarea", address: "qzaddress", areas: ["qzplaceone", "qzplacetwo"],
    link: "https://qzlink.example/pay", holdMinutes: 8802, windowHours: 8803, maxItems: 8804, orderRef: "qzref", customerPhone: "+919000000001",
    approvalCode: "QZCODE", approvalHours: 8805, approvalsLeft: 8806, payee: "qzpayee", upiCode: "QZUPICODE", partner: "qzpartner", upcomingCount: 8807,
    offeredInr: 7770008, discountCode: "QZDISCODE",
    plan: { meals: 8808, fromMs: PLAN_FROM, toMs: PLAN_TO },
    askerPhone: "+919000000009", paidAtMs: PAID_MS, upiNote: "qzpaidnote",
  };
  if (upi) f.upiId = "qzupi@bank";
  return f;
}

/** Every fact `need()` can ask for (dateMs and upiId are not: a message does not refuse without them). */
const NEEDED: Fact[] = ["itemsText", "itemName", "priceInr", "leftCount", "totalInr", "advanceInr", "balanceInr", "refundInr", "markedInr", "leftInr", "slotFromMs", "slotToMs", "cutoffMs", "mode", "area", "address", "areas", "link", "holdMinutes", "windowHours", "maxItems", "orderRef", "customerPhone", "approvalCode", "approvalHours", "approvalsLeft", "payee", "upiCode", "partner", "upcomingCount", "plan", "plan.meals", "plan.fromMs", "plan.toMs", "offeredInr", "discountCode", "askerPhone", "paidAtMs", "upiNote"];

const dateOf = (ms: number, language: Language) => formatDate(localParts(ms, TZ), language);
const clockOf = (ms: number, language: Language) => formatTime(localParts(ms, TZ), language);

/** The slots, in the order they are looked for: [the probe's text, the slot's name]. Longest first, so a composite is found before the pieces it holds. */
function slotTable(f: MessageFacts): [string, string][] {
  const rupees = (k: "priceInr" | "totalInr" | "advanceInr" | "balanceInr" | "refundInr" | "markedInr" | "leftInr" | "offeredInr"): [string, string] => [formatInr(f[k] as number), k];
  const t: [string, string][] = [
    [f.menu.map((i) => `${i.name} ${formatInr(i.priceInr)}`).join(", "), "menuList"],
    [when(f), "when"], [cutAt(f), "cutAt"], [how(f), "how"], [rest(f), "rest"], [day(f), "day"],
    [dateOf(PLAN_FROM, f.language), "planFrom"], [dateOf(PLAN_TO, f.language), "planTo"], [dateOf(PAID_MS, f.language), "paidDate"],
    // 25 Nov 2026: the UPI refund's note is the slot "paidNote" ("upiNote" is this file's UPI sentence), the asker's number "askerPhone"
    [f.upiNote!, "paidNote"], [f.askerPhone!, "askerPhone"],
    [f.link!, "link"],
    rupees("priceInr"), rupees("totalInr"), rupees("advanceInr"), rupees("balanceInr"), rupees("refundInr"), rupees("markedInr"), rupees("leftInr"), rupees("offeredInr"),
    [String(f.leftCount), "leftCount"], [String(f.holdMinutes), "holdMinutes"], [String(f.windowHours), "windowHours"], [String(f.maxItems), "maxItems"], [String(f.approvalHours), "approvalHours"],
    [String(f.approvalsLeft), "approvalsLeft"], [String(f.upcomingCount), "upcomingCount"], [String(f.plan!.meals), "meals"],
    [f.itemsText!, "itemsText"], [f.itemName!, "itemName"], [f.address!, "address"], [f.areas!.join(", "), "areas"], [f.orderRef!, "orderRef"], [f.customerPhone!, "customerPhone"],
    [f.approvalCode!, "approvalCode"], [f.discountCode!, "discountCode"], [f.upiCode!, "upiCode"], [f.payee!, "payee"], [f.partner!, "partner"], [f.businessName, "businessName"],
  ];
  if (f.upiId) { t.push([f.upiId, "upiId"]); t.push([payTo(f), "payTo"]); }
  return t.sort((a, b) => b[0].length - a[0].length);
}

/** The facts each slot reads, as a refusal names them, in the order the slot asks. */
const FACTS: Record<string, (f: MessageFacts) => Fact[]> = {
  menuList: () => [], businessName: () => [], upiNote: () => [],
  itemsText: () => ["itemsText"], itemName: () => ["itemName"], priceInr: () => ["priceInr"], totalInr: () => ["totalInr"], advanceInr: () => ["advanceInr"], balanceInr: () => ["balanceInr"],
  refundInr: () => ["refundInr"], markedInr: () => ["markedInr"], leftInr: () => ["leftInr"], offeredInr: () => ["offeredInr"], discountCode: () => ["discountCode"],
  when: () => ["slotFromMs", "slotToMs"], cutAt: () => ["cutoffMs"], day: (f) => (f.dateMs !== undefined ? [] : ["slotFromMs"]),
  how: (f) => (f.mode === "pickup" ? ["mode"] : ["mode", "area"]), rest: () => ["balanceInr", "mode"], payTo: (f) => (f.upiId ? ["link", "payee"] : ["link"]),
  planFrom: () => ["plan", "plan.fromMs"], planTo: () => ["plan", "plan.toMs"], meals: () => ["plan", "plan.meals"],
  leftCount: () => ["leftCount"], holdMinutes: () => ["holdMinutes"], windowHours: () => ["windowHours"], maxItems: () => ["maxItems"], approvalHours: () => ["approvalHours"],
  approvalsLeft: () => ["approvalsLeft"], upcomingCount: () => ["upcomingCount"], address: () => ["address"], areas: () => ["areas"], orderRef: () => ["orderRef"],
  customerPhone: () => ["customerPhone"], askerPhone: () => ["askerPhone"], paidDate: () => ["paidAtMs"], paidNote: () => ["upiNote"], approvalCode: () => ["approvalCode"], upiCode: () => ["upiCode"], payee: () => ["payee"], partner: () => ["partner"], link: () => ["link"], upiId: () => [],
};

/** A probe's text turned into slots. Throws when braces are left over (a word that looks like a slot) or a probe is left in, so a slot is never confused with a word. */
function slotted(text: string, f: MessageFacts, what: string): string {
  let out = text;
  for (const [probeText, name] of slotTable(f)) out = out.split(probeText).join(`{${name}}`);
  const bare = out.replace(/\{[A-Za-z]+\}/gu, "");
  if (/[{}]/u.test(bare)) throw new Error(`${what}: a brace is left in the words: ${out}`);
  if (/qz|Qz|QZ/u.test(bare)) throw new Error(`${what}: a probe was left in: ${out}`);
  return out;
}

/** `facts` without one fact (a plan's member is "plan.meals"). */
function without(f: MessageFacts, keys: readonly Fact[]): MessageFacts {
  const g = { ...f } as Record<string, unknown>;
  // a plan's members first, so taking away "plan" itself leaves the plan absent (not an empty one)
  for (const key of [...keys].sort((a, b) => Number(b.startsWith("plan.")) - Number(a.startsWith("plan.")))) {
    if (key.startsWith("plan.")) { const p = { ...(g.plan as object) } as Record<string, unknown>; delete p[key.slice(5)]; g.plan = p; } else delete g[key];
  }
  return g as unknown as MessageFacts;
}

/** The facts a message cannot be written without, found by taking each away (the real `need` throws). */
function requiredFacts(language: Language, id: TemplateId, withProbe: MessageFacts, text: string): Set<Fact> {
  const required = new Set<Fact>();
  for (const key of NEEDED) {
    try {
      const got = render(id, without(withProbe, [key]));
      if (got !== text) throw new Error(`${language} ${id}: without ${key} the message changes instead of being refused`);
    } catch (e) {
      if (String((e as Error).message).includes(`needs "${key}"`)) required.add(key);
      else throw e;
    }
  }
  return required;
}

interface Folded { text: string; upiNote: string; readOrder: Fact[]; needs: Fact[] }

/** One message, with and without a UPI ID, folded into one text; the facts it reads in reading order, and the facts it needs. */
function fold(language: Language, id: TemplateId): Folded {
  const fb = probe(language, false), fu = probe(language, true);
  const tb = render(id, fb), tu = render(id, fu);
  const what = `${language} ${id}`;
  let sb = slotted(tb, fb, what);
  const su = slotted(tu, fu, what);
  let text = su, upiNote = "";
  if (sb !== su) {
    // the message says where to pay (payTo), and perhaps ends with the UPI shop's sentence
    if (su.includes("{link}")) throw new Error(`${what}: the message names the link on its own and through payTo`);
    sb = sb.split("{link}").join("{payTo}");
    if (!su.startsWith(sb)) throw new Error(`${what}: the UPI wording is not the usual wording plus an ending:\n${sb}\n${su}`);
    upiNote = su.slice(sb.length);
    text = sb + (upiNote ? "{upiNote}" : "");
  }
  const slots = [...text.matchAll(/\{([A-Za-z]+)\}/gu)].map((m) => m[1]);
  const read: Fact[] = [];
  for (const s of slots) {
    if (!(s in FACTS)) throw new Error(`${what}: no facts known for the slot {${s}}`);
    for (const k of FACTS[s](fu)) if (!read.includes(k)) read.push(k);
  }
  const needs = new Set([...requiredFacts(language, id, fb, tb), ...requiredFacts(language, id, fu, tu)]);
  if ([...read].sort().join() !== [...needs].sort().join()) throw new Error(`${what}: the slots read ${read} but the message needs ${[...needs]}`);
  return { text, upiNote, readOrder: read, needs: [...needs] };
}

/** The composite wording: how the window, the cut-off, the way of collecting, the rest to pay and where to pay are written, found by asking the real helpers. */
function composites(language: Language): Bag {
  const f = probe(language, true);
  const piece = (text: string, pairs: [string, string][], what: string): string => {
    let out = text;
    for (const [from, to] of pairs.sort((a, b) => b[0].length - a[0].length)) out = out.split(from).join(to);
    if (/qz/iu.test(out.replace(/\{[A-Za-z]+\}/gu, ""))) throw new Error(`${language} ${what}: a probe was left in: ${out}`);
    return out;
  };
  const c: Bag = {};
  c.when = piece(when(f), [[dateOf(SLOT_FROM, language), "{fromDate}"], [clockOf(SLOT_FROM, language), "{fromTime}"], [clockOf(SLOT_TO, language), "{toTime}"]], "when");
  c.cutAt = piece(cutAt(f), [[dateOf(CUTOFF, language), "{cutDate}"], [clockOf(CUTOFF, language), "{cutTime}"]], "cutAt");
  c.howPickup = how({ ...f, mode: "pickup" });
  c.howDelivery = piece(how({ ...f, mode: "delivery" }), [["qzarea", "{area}"]], "how");
  if (!c.howDelivery.includes("{area}")) throw new Error(`${language}: how does not name the area`);
  const balance: [string, string] = [formatInr(f.balanceInr!), "{balanceInr}"];
  c.restPickup = piece(rest({ ...f, mode: "pickup" }), [balance], "rest pickup");
  c.restDelivery = piece(rest({ ...f, mode: "delivery" }), [balance], "rest delivery");
  const paid = rest({ ...f, mode: "pickup", balanceInr: 0 });
  if (paid !== rest({ ...f, mode: "delivery", balanceInr: 0 })) throw new Error(`${language}: the paid-in-full line differs by mode`);
  c.restPaid = paid;
  c.payToUpi = piece(payTo(f), [[f.link!, "{link}"], [f.upiId!, "{upiId}"], [f.payee!, "{payee}"]], "payTo");
  return c;
}

function templates(language: Language, ids: TemplateId[]): { t: Bag; c: Bag; info: Record<string, Folded> } {
  const t: Bag = {};
  const info: Record<string, Folded> = {};
  let note: string | null = null;
  for (const id of ids) {
    const r = fold(language, id);
    t[id] = r.text;
    info[id] = r;
    if (r.upiNote) { if (note !== null && note !== r.upiNote) throw new Error(`${language}: the UPI sentence differs between messages`); note = r.upiNote; }
  }
  const c = composites(language);
  c.upiNote = note ?? "";
  return { t, c, info };
}

/** The WhatsApp templates: the name and the audience, the message it carries the words of, and the body with `{slot}`s; and how each slot is filled (a slot expression over the same facts). */
function metaWords(language: Language): { meta: unknown[]; metaSlots: Bag } {
  const f = probe(language, true); // a UPI shop's facts, so a slot filled with payTo is told from one filled with the bare link
  const names = new Set<string>();
  if (new Set(META_TEMPLATES.map((m) => m.usedFor)).size !== META_TEMPLATES.length) throw new Error("two WhatsApp templates carry the same message: the Go side takes the first, the TypeScript map the last");
  const meta = META_TEMPLATES.map((m: MetaTemplate<TemplateId>) => {
    for (const s of m.bodies[language].matchAll(/\{([A-Za-z]+)\}/gu)) names.add(s[1]);
    // an image header needs Meta's example picture handle at submission: no Orders template has one, and the Go side does not write one
    if (m.header) throw new Error(`${m.name} has a header: the Go submissions do not write one`);
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

/** The constants of exampleFacts, found by asking it for two shops: what is the shop's own differs, what is written in the function is the same. */
function exampleWords(language: Language): unknown {
  const a = annapurna(), b = sweetCrumbs();
  const ea = exampleFacts(a, language), eb = exampleFacts(b, language);
  const keys = ["address", "link", "orderRef", "customerPhone", "approvalCode", "approvalHours", "approvalsLeft", "upiCode", "partner", "upcomingCount", "leftInr", "mode", "discountCode", "askerPhone", "upiNote"] as const;
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (ea[k] !== eb[k]) throw new Error(`exampleFacts ${k} differs between shops: it is not a constant`);
    out[k] = ea[k];
  }
  if (b.delivery) throw new Error("the second example shop delivers: the default area is not found");
  out.defaultArea = eb.area;
  const item = a.menu[0];
  const first = itemName(item, language);
  const m = /^(\d+) × (.*)$/u.exec(ea.itemsText!);
  if (!m || m[2] !== first) throw new Error(`exampleFacts itemsText is not "<n> × <item>": ${ea.itemsText}`);
  out.itemsText = ea.itemsText!.replace(first, "{item}");
  out.qty = Number(m[1]);
  if (ea.totalInr !== item.priceInr * out.qty!) throw new Error("exampleFacts totalInr is not the price times the quantity");
  if (ea.plan?.meals !== eb.plan?.meals) throw new Error("exampleFacts plan meals differ");
  out.meals = ea.plan!.meals;
  const ymd = (ms: number) => { const p = localParts(ms, a.timezone); return [p.year, p.month, p.day]; };
  out.date = ymd(ea.dateMs!);
  out.cutoffDate = ymd(ea.cutoffMs!);
  out.planToDate = ymd(ea.plan!.toMs!);
  // 25 Nov 2026: a UPI refund's payment, marked on a fixed day at a fixed time of day in the shop's zone
  out.paidDate = ymd(ea.paidAtMs!);
  const paid = localParts(ea.paidAtMs!, a.timezone);
  out.paidClock = `${String(paid.hour).padStart(2, "0")}:${String(paid.minute).padStart(2, "0")}`;
  if (JSON.stringify(ymd(eb.paidAtMs!)) !== JSON.stringify(out.paidDate)) throw new Error("exampleFacts paidAtMs differs between shops");
  // E1: the price asked is the item's price less a constant
  if (ea.priceInr !== item.priceInr || ea.itemName !== first || item.priceInr - ea.offeredInr! !== b.menu[0].priceInr - eb.offeredInr!) throw new Error("exampleFacts' discount facts are not the item's price less a constant");
  out.offeredLess = item.priceInr - ea.offeredInr!;
  if (JSON.stringify(ymd(eb.dateMs!)) !== JSON.stringify(out.date)) throw new Error("exampleFacts date differs between shops");
  return out;
}

/** The labels and what the list builders write around a value: the id of a row, the title of a window. */
function interactiveWords(language: Language): Record<string, unknown> {
  // the title is `<from> – <to>` cut to a row's limit: the pattern is read from English (which fits) and every language's title must be that pattern, cut the same way
  const row = (l: Language) => slotList([{ id: "qzid", fromMs: SLOT_FROM, toMs: SLOT_TO }], TZ, l).rows[0];
  const en = row("en");
  const slotTitle = en.title.replace(clockOf(SLOT_FROM, "en"), "{from}").replace(clockOf(SLOT_TO, "en"), "{to}");
  if (!slotTitle.includes("{from}") || !slotTitle.includes("{to}")) throw new Error(`a window's title is not "<from> – <to>": ${en.title}`);
  const one = row(language);
  if (clip(slotTitle.replace("{from}", clockOf(SLOT_FROM, language)).replace("{to}", clockOf(SLOT_TO, language)), LIMITS.rowTitle) !== one.title) throw new Error(`${language}: a window's title is not the pattern, cut`);
  if (slotRowId("qzid") !== one.id) throw new Error("slotList does not use slotRowId");
  return {
    labels: LABELS[language], limits: LIMITS, ids: ID, markIds: MARK_BUTTON,
    rowIds: { item: itemRowId("qzid").replace("qzid", "{id}"), slot: slotRowId("qzid").replace("qzid", "{id}") }, slotTitle,
  };
}

/** One language's pack. */
function pack(language: Language, made: { t: Bag; c: Bag }): unknown {
  const { t, c } = made;
  // generic: the names a message that is none of the approved templates goes out under (templates.ts TEMPLATE_NAMES), the same in every language
  return { lang: language, t, c, ...metaWords(language), ...interactiveWords(language), generic: TEMPLATE_NAMES, example: exampleWords(language) };
}

// ---- the vectors ---------------------------------------------------------------------------------------------------------------

/** Four varied sets of facts, every fact present unless said: pickup and a part advance; delivery on a UPI shop with nothing left to pay and no `dateMs`; big numbers, a UPI ID that is empty and zeros; UTC and a late hour. */
function factSets(language: Language): MessageFacts[] {
  const base = (over: Partial<MessageFacts>): MessageFacts => ({ ...probeless(language), ...over });
  const a = base({});
  const b = base({
    mode: "delivery", area: "Kakkanad", upiId: "glowfoods@okicici", payee: "Glow Foods", balanceInr: 0, totalInr: 500, advanceInr: 500, refundInr: 500, link: "upi://pay?pa=glowfoods@okicici&pn=Glow%20Foods&am=500",
    slotFromMs: Date.UTC(2026, 10, 11, 4, 30), slotToMs: Date.UTC(2026, 10, 11, 7, 30), cutoffMs: Date.UTC(2026, 10, 10, 14, 30),
  });
  delete (b as { dateMs?: number }).dateMs;
  const c = base({
    totalInr: 1234567, advanceInr: 617284, balanceInr: 617283, refundInr: 617284, priceInr: 99, markedInr: 100000, leftInr: 0, leftCount: 0, holdMinutes: 0, windowHours: 0, maxItems: 1, approvalsLeft: 0, upiId: "",
    itemsText: "1 × Veg thali", menu: [{ name: "Veg thali", priceInr: 99 }], areas: [], orderRef: "o-12", customerPhone: "+14155550123",
    slotFromMs: Date.UTC(2026, 11, 31, 18, 30), slotToMs: Date.UTC(2027, 0, 1, 0, 0), cutoffMs: Date.UTC(2026, 11, 30, 18, 30), dateMs: Date.UTC(2026, 11, 31, 18, 30),
    plan: { meals: 1, fromMs: Date.UTC(2026, 11, 31, 18, 30), toMs: Date.UTC(2027, 0, 30, 18, 30) }, slotChoices: [],
  });
  const d = base({
    timeZone: "UTC", mode: "delivery", area: "Edappally", balanceInr: 150, totalInr: 450, advanceInr: 300, refundInr: 300, priceInr: 225, menu: [],
    slotFromMs: Date.UTC(2026, 6, 4, 0, 5), slotToMs: Date.UTC(2026, 6, 4, 12, 0), cutoffMs: Date.UTC(2026, 6, 3, 23, 59), dateMs: Date.UTC(2026, 6, 4, 0, 0),
    plan: { meals: 22, fromMs: Date.UTC(2026, 6, 4, 0, 0), toMs: Date.UTC(2026, 7, 3, 0, 0) },
  });
  return [a, b, c, d];
}

/** The usual facts of an order, every one present (a believable order of an example shop, in the language). */
function probeless(language: Language): MessageFacts {
  return {
    language, timeZone: TZ, businessName: "Annapurna Tiffins",
    menu: [{ name: "Veg thali", priceInr: 180 }, { name: "Curd", priceInr: 30 }, { name: "Idli (4)", priceInr: 60 }],
    itemsText: "2 × Veg thali, 1 × Curd", quantities: [2, 1], itemName: "Veg thali", priceInr: 180, leftCount: 3,
    totalInr: 390, advanceInr: 120, balanceInr: 270, refundInr: 120, markedInr: 120, leftInr: 270,
    dateMs: Date.UTC(2026, 10, 11, 18, 30), slotFromMs: Date.UTC(2026, 10, 12, 6, 30), slotToMs: Date.UTC(2026, 10, 12, 7, 30), cutoffMs: Date.UTC(2026, 10, 11, 14, 30),
    slotChoices: [{ fromMs: Date.UTC(2026, 10, 12, 6, 30), toMs: Date.UTC(2026, 10, 12, 7, 30) }, { fromMs: Date.UTC(2026, 10, 12, 12, 30), toMs: Date.UTC(2026, 10, 12, 13, 30) }],
    mode: "pickup", area: "Kakkanad", address: "Flat 4, Lake View Apartments, Kakkanad", areas: ["Kakkanad", "Edappally", "Infopark"],
    link: "https://rzp.io/i/example", holdMinutes: 15, windowHours: 4, maxItems: 10, orderRef: "o-3", customerPhone: "+919811111111",
    approvalCode: "K7M2QX", approvalHours: 24, approvalsLeft: 1, payee: "Annapurna Tiffins", upiCode: "P4XR9T", partner: "Divya, Sri Sai Digital", upcomingCount: 4,
    plan: { meals: 22, fromMs: Date.UTC(2026, 10, 15, 18, 30), toMs: Date.UTC(2026, 11, 14, 18, 30) },
    offeredInr: 160, discountCode: "Q7RM2X",
    askerPhone: "+919822222222", paidAtMs: Date.UTC(2026, 10, 3, 6, 0), upiNote: "o-3", // 25 Nov 2026: the asker, and a UPI refund's payment
  };
}

interface RenderVector { id: string; language: Language; facts: number; without?: string[]; text?: string; error?: string; check?: { ok: boolean; problems: string[] }; decision?: unknown; mutated?: { text: string; check: { ok: boolean; problems: string[] }; decision: unknown } }

/** A tail that states an amount, a time, a date and a count the record does not hold: the check must name each. */
const TAIL = " Total ₹9,999 at 11:11 pm on Mon 1 Jan, 7777 more.";

function renderVectors(ids: TemplateId[], info: Record<Language, Record<string, Folded>>): { facts: MessageFacts[]; vectors: RenderVector[] } {
  const facts: MessageFacts[] = [];
  const vectors: RenderVector[] = [];
  for (const language of LANGUAGES) facts.push(...factSets(language));
  const at = (language: Language, variant: number) => LANGUAGES.indexOf(language) * 4 + variant;
  const verdict = (text: string, f: MessageFacts) => { const r = checkMessage(text, f); return { ok: r.ok, problems: r.problems }; };
  const attempt = (id: TemplateId, f: MessageFacts): { text?: string; error?: string } => {
    try { return { text: render(id, f) }; } catch (e) { return { error: (e as Error).message }; }
  };
  for (const language of LANGUAGES) {
    for (const id of ids) {
      for (let v = 0; v < 4; v++) {
        const f = facts[at(language, v)];
        const r = attempt(id, f);
        if (r.text === undefined) throw new Error(`${language} ${id} set ${v}: the fact set cannot write the message: ${r.error}`);
        vectors.push({ id, language, facts: at(language, v), text: r.text, check: verdict(r.text, f), decision: checkMessageMatchesRecord({ text: r.text, facts: f }),
          mutated: { text: r.text + TAIL, check: verdict(r.text + TAIL, f), decision: checkMessageMatchesRecord({ text: r.text + TAIL, facts: f }) } });
      }
      const m = info[language][id];
      const order = m.readOrder;
      const cases: { variant: number; keys: string[] }[] = [];
      for (const variant of [0, 1]) {
        for (const k of m.needs) cases.push({ variant, keys: [k] });
        for (let j = 0; j < order.length; j++) cases.push({ variant, keys: order.slice(j) });
      }
      cases.push({ variant: 0, keys: ["dateMs"] }, { variant: 1, keys: ["slotFromMs"] }, { variant: 1, keys: ["slotFromMs", "slotToMs", "cutoffMs", "mode"] }, { variant: 0, keys: ["area", "upiId", "payee"] });
      const seen = new Set<string>();
      for (const c of cases) {
        const key = `${c.variant}|${[...c.keys].sort().join(",")}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const f = without(facts[at(language, c.variant)], c.keys);
        const r = attempt(id, f);
        vectors.push({ id, language, facts: at(language, c.variant), without: c.keys, ...r });
      }
    }
  }
  return { facts, vectors };
}

const SHOP_NAMES = ["annapurna", "sweet"] as const;

/** The small part of the settings the Go words read (words.Shop). */
function shopOf(s: Settings): unknown {
  return {
    name: s.name, timezone: s.timezone, menu: s.menu.map((i) => ({ id: i.id, names: i.names, priceInr: i.priceInr })), advancePercent: s.advance.percent,
    pickupFrom: s.pickup.slots[0].from, pickupTo: s.pickup.slots[0].to, cutoffTime: s.cutoff.time, deliveryArea: s.delivery?.area[0] ?? "", windowHours: s.cancellation.windowHours,
  };
}

/** A shop with a long menu and long names, to cut at the list's limits. */
function longMenuShop(): Settings {
  const s = annapurna();
  const names = (n: number) => ({ en: [`Item number ${n} with a very long name that cannot fit a row`], hi: [`आइटम ${n} जिसका नाम बहुत लंबा है और पंक्ति में नहीं समाएगा`], ml: [], kn: undefined });
  return { ...s, menu: Array.from({ length: 12 }, (_, i) => ({ ...s.menu[0], id: `it-${i + 1}`, names: names(i + 1) as never, priceInr: 100 + i * 1111 })) };
}

function wordsVectors(factsAll: MessageFacts[]): unknown {
  const shops: [string, Settings][] = [["annapurna", annapurna()], ["sweet", sweetCrumbs()]];
  const out: Record<string, unknown[]> = { meta: [], templateMessage: [], example: [], submissions: [], labels: [], buttons: [], ownerMarks: [], itemList: [], slotList: [], clip: [], names: [] };
  for (const language of LANGUAGES) {
    const li = LANGUAGES.indexOf(language) * 4;
    for (const m of META_TEMPLATES) {
      for (let v = 0; v < 4; v++) {
        const f = factsAll[li + v];
        let params: string[] | { error: string };
        try { params = parametersFor(m, language, f); } catch (e) { params = { error: (e as Error).message }; }
        const entry: Record<string, unknown> = { name: m.name, language, facts: li + v, parameters: params };
        if (Array.isArray(params)) { const body = metaBody(m.bodies[language]); entry.body = body; entry.filled = fillBody(body, params); }
        out.meta.push(entry);
        const generic = m.audience === "owner" ? TEMPLATE_NAMES.owner : TEMPLATE_NAMES.customer;
        const text = render(m.usedFor, f);
        for (const [what, t] of [["same", text], ["changed", `${text} `]] as const) out.templateMessage.push({ name: m.name, language, facts: li + v, what, ids: [m.usedFor], text: t, generic, out: templateMessage({ ids: [m.usedFor], language, facts: f, text: t, generic }) });
        out.templateMessage.push({ name: m.name, language, facts: li + v, what: "two", ids: [m.usedFor, "kept"], text, generic, out: templateMessage({ ids: [m.usedFor, "kept"], language, facts: f, text, generic }) });
      }
    }
    out.templateMessage.push({ name: "none", language, facts: li, what: "other", ids: ["menu"], text: render("menu", factsAll[li]), generic: TEMPLATE_NAMES.customer, out: templateMessage({ ids: ["menu"], language, facts: factsAll[li], text: render("menu", factsAll[li]), generic: TEMPLATE_NAMES.customer }) });
    for (const [shopName, s] of shops) out.example.push({ shop: shopName, language, out: exampleFacts(s, language) });
    out.labels.push({ language, out: LABELS[language] });
    const sets: ButtonId[][] = [["yes", "no"], ["cancel", "keep"], ["cancelYes", "keep", "owner"], ["pickup", "delivery"], ["paid", "owner", "yes"], ["no"]];
    for (const ids of sets) out.buttons.push({ language, ids, out: buttonsFor(language, ids) });
    for (const amount of [200, 1250, 99.5, 0, 125000]) out.ownerMarks.push({ language, kind: "received", code: "K7M2QX", amountInr: amount, out: ownerMarkButtons(language, { kind: "received", code: "K7M2QX", amountInr: amount }) });
    for (const keepAllowed of [true, false]) out.ownerMarks.push({ language, kind: "refund", code: "K7M2QX", keepAllowed, out: ownerMarkButtons(language, { kind: "refund", code: "K7M2QX", keepAllowed }) });
    for (const [shopName, s] of [...shops, ["long", longMenuShop()] as [string, Settings]]) out.itemList.push({ shop: shopName, shopData: shopOf(s), language, out: itemList(s, language) });
    const windows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `w-${i + 1}`, fromMs: Date.UTC(2026, 10, 12, 4 + i, 30), toMs: Date.UTC(2026, 10, 12, 5 + i, i % 2 ? 0 : 30) }));
    for (const [n, zone] of [[3, TZ], [10, TZ], [12, "UTC"], [1, "America/New_York"], [0, TZ]] as [number, string][]) out.slotList.push({ language, zone, windows: windows(n), out: slotList(windows(n), zone, language) });
  }
  for (const [shopName, s] of shops) out.submissions.push({ shop: shopName, shopData: shopOf(s), out: metaSubmissions(s) });
  for (const text of ["", "  hi  ", "x".repeat(20), "x".repeat(21), "x".repeat(24), "x".repeat(25), "चाय और बिस्कुट का बहुत लंबा नाम यहाँ", "🍛🍛🍛🍛🍛🍛🍛🍛🍛🍛🍛🍛🍛🍛🍛🍛🍛🍛🍛🍛🍛🍛🍛🍛", "  padded  ", "á".repeat(14)]) {
    for (const max of [1, 2, 20, 24]) out.clip.push({ text, max, out: clip(text, max) });
  }
  for (const [shopName, s] of shops) for (const language of LANGUAGES) for (const it of s.menu) out.names.push({ shop: shopName, item: it.id, language, out: itemName(it, language) });
  return out;
}

/** Every file, by its path from the repository root, as its uncompressed text. */
export function generate(): Map<string, string> {
  const out = new Map<string, string>();
  const ids = Object.keys(TEMPLATES.en) as TemplateId[];
  for (const l of LANGUAGES) if (Object.keys(TEMPLATES[l]).join() !== ids.join()) throw new Error(`${l}: the messages are not the same as English's, in the same order`);
  const info = {} as Record<Language, Record<string, Folded>>;
  for (const l of LANGUAGES) {
    const made = templates(l, ids);
    info[l] = made.info;
    out.set(`${OUT}/${l}.json.gz`, JSON.stringify(pack(l, made)) + "\n");
  }
  const { facts, vectors } = renderVectors(ids, info);
  out.set(`${OUT}/testdata/render-vectors.json.gz`, JSON.stringify({ node: process.version, facts, vectors }) + "\n");
  out.set(`${OUT}/testdata/words-vectors.json.gz`, JSON.stringify({ node: process.version, shops: SHOP_NAMES, ...(wordsVectors(facts) as object) }) + "\n");
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
