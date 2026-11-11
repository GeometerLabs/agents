// The Fees sell guide (sell/): a guide and a one-page sheet in every language the pathway speaks, the same 11 sections in the same order, the same amounts and
// numbers everywhere, none of the words the claim rules ban, the walkthrough it teaches quoted exactly as the script prints it, and every number it gives about the
// example centre and about the hand check compared with the real thing. The spec every pathway copies is ../../../SELL-GUIDE.md.
//
// One deliberate difference from Bookings: the walkthrough shows a different child in each language (Rohan Mehta in English, Anaya Sharma in Hindi, and so on), so the
// quoted printout in section 4 differs in names and amounts from language to language. The quotes sit in ```text blocks, and the "same amounts and numbers" checks
// read the guide without those blocks. The blocks are checked on their own, against what walk() prints for that language.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { bannedIn } from "../../../../modules/report/claims.ts";
import { LANGUAGES } from "../../../../modules/language/languages.ts";
import type { Language } from "../../../../modules/language/languages.ts";
import { NOT_TESTED } from "../crash-test/not-tested.ts";
import { MARKERS, SAYS } from "../crash-test/says.ts";
import { runOn } from "../crash-test/situations.ts";
import { STRINGS } from "../report/strings.ts";
import { WALK_DISCOUNT_INR, printed, walk } from "../scripts/walkthrough.ts";
import { brightTuition } from "../src/harness.ts";
import { parseSettings } from "../src/settings.ts";
import { dayWords, formatRate, listInForce, stale } from "../../../../prices/render.ts";

const SELL = new URL("../sell/", import.meta.url);
const SPEC = new URL("../../../SELL-GUIDE.md", import.meta.url);
const guide = (l: Language) => readFileSync(new URL(`guide.${l}.md`, SELL), "utf8");
const sheet = (l: Language) => readFileSync(new URL(`one-pager.${l}.html`, SELL), "utf8");
const TRANSLATED = LANGUAGES.filter((l) => l !== "en");
/** The date the guide and the sheets are written for, in each language. It changes whenever the status in section 11 changes. */
const DATE: Record<Language, string> = { en: "5 November 2026", hi: "5 नवंबर 2026", ml: "5 നവംബർ 2026", kn: "5 ನವೆಂಬರ್ 2026" };

// ---- reading a guide ---------------------------------------------------------------------------------------------------

interface Section { n: number; title: string; body: string }

/** The numbered `## N. Title` sections (a `#` line inside a code block is not a heading). */
function sections(text: string): Section[] {
  const out: Section[] = [];
  let fence = false;
  for (const line of text.split("\n")) {
    if (line.startsWith("```")) fence = !fence;
    const m = fence ? null : /^## (\d+)\. (.+)$/.exec(line);
    if (m) out.push({ n: Number(m[1]), title: m[2], body: "" });
    else if (out.length > 0) out[out.length - 1].body += `${line}\n`;
  }
  return out;
}

/** What a section is made of, so a translation cannot quietly drop a row, a step, a checklist item or a quoted printout. */
function shape(body: string) {
  const lines = body.split("\n");
  const count = (re: RegExp) => lines.filter((l) => re.test(l)).length;
  return { subheads: count(/^### /), tableRows: count(/^\s*\|/), checklist: count(/^- \[ \] /), steps: count(/^\d+\. /), codeFences: count(/^```/) };
}

/** The text without the ``` blocks (the printout quotes, which are different children and amounts in each language, and the commands). */
function withoutFences(text: string): string {
  let fence = false;
  return text.split("\n").filter((line) => {
    if (line.startsWith("```")) { fence = !fence; return false; }
    return !fence;
  }).join("\n");
}

/** The lines inside the ``` blocks of one kind (```text or ```sh). */
function fencedLines(text: string, kind: string): string[] {
  const out: string[] = [];
  let current: string | undefined;
  for (const line of text.split("\n")) {
    if (line.startsWith("```")) { current = current === undefined ? line.slice(3).trim() : undefined; continue; }
    if (current === kind && line.trim() !== "") out.push(line);
  }
  return out;
}

/** The text a banned-word check reads: the whole file, except the first column of the "Never say" table (section 7), which has to quote the words. */
function checked(text: string): string {
  let inNeverSay = false;
  return text.split("\n").map((line) => {
    const h = /^## (\d+)\. /.exec(line);
    if (h) inNeverSay = h[1] === "7";
    return inNeverSay && line.startsWith("|") ? line.replace(/^\|[^|]*\|/, "|") : line;
  }).join("\n");
}

/** Banned words from every language's list (the report's own BANNED), whatever language the file is in. */
const banned = (text: string): string[] => [...new Set(LANGUAGES.flatMap((l) => bannedIn(text, l)))];
const visible = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<!--[\s\S]*?-->/g, "");
/** The sheet without its chat bubbles: a bubble is the product's own words, and they name the class in words in Malayalam ("പത്താം ക്ലാസ്") and in digits in the others. */
const withoutBubbles = (html: string) => visible(html).replace(/<p class="bubble[^"]*">[\s\S]*?<\/p>/g, "");
const rupees = (text: string) => new Set((text.match(/₹\s?\d[\d,]*/g) ?? []).map((x) => x.replace(/[\s,]/g, "")));
const numbers = (text: string) => new Set((text.match(/\d[\d,]*/g) ?? []).map((x) => x.replace(/,/g, "")));
const same = (a: Set<string>, b: Set<string>) => assert.deepEqual([...a].sort(), [...b].sort());
const inr = (n: number) => `₹${n.toLocaleString("en-US")}`;
const section = (l: Language, n: number) => sections(guide(l))[n - 1].body;

// ---- the files and the sections ----------------------------------------------------------------------------------------

test("sell guide: every language the pathway speaks has a guide and a one-page sheet", () => {
  assert.ok(LANGUAGES.length >= 4);
  assert.deepEqual([...brightTuition().languages].sort(), [...LANGUAGES].sort(), "the example centre speaks every language, so every language needs its guide");
  for (const l of LANGUAGES) {
    for (const name of [`guide.${l}.md`, `one-pager.${l}.html`]) {
      assert.ok(existsSync(new URL(name, SELL)), `sell/${name} is missing: a pathway is not ready to sell until its guide is`);
      assert.ok(readFileSync(new URL(name, SELL), "utf8").length > 1000, `sell/${name} is almost empty`);
    }
  }
});

test("sell guide: the 11 numbered sections are there, in order, in every guide", () => {
  for (const l of LANGUAGES) {
    const found = sections(guide(l));
    assert.equal(found.length, 11, `${l}: expected 11 numbered sections, found ${found.length}`);
    assert.deepEqual(found.map((s) => s.n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], `${l}: the sections are out of order`);
    for (const s of found) assert.ok(s.body.trim().length > 40, `${l}: section ${s.n} is empty`);
  }
});

test("sell guide: the English headings are the ones SELL-GUIDE.md names", () => {
  const spec = readFileSync(SPEC, "utf8");
  const rows = [...spec.matchAll(/^\| (\d+) \| ([^|]+?) \| /gm)].map((m) => [Number(m[1]), m[2]] as const);
  assert.equal(rows.length, 11);
  // Two titles change, on purpose: "shop" in section 1 (this guide writes "centre" for the place a parent's child goes to), and section 4, which says
  // "to the owner" because Fees has no demo on the owner's phone, only a walkthrough on the partner's laptop (the heading must not claim more than is true today).
  const titles = sections(guide("en")).map((s) => [s.n, s.title.replace("centre", "shop").replace("Show it to the owner", "Show it on the owner's own phone")] as const);
  assert.deepEqual(titles, rows);
});

test("sell guide: every section has the same shape in every language (rows, steps, checklist items, quoted printouts)", () => {
  const master = sections(guide("en"));
  for (const l of TRANSLATED) {
    const other = sections(guide(l));
    for (const s of master) assert.deepEqual(shape(other[s.n - 1].body), shape(s.body), `${l}: section ${s.n} does not have the same shape as the English`);
  }
});

test("sell guide: the first three sentences are exactly three, the demo has five steps, and the checklist, the questions and the Never say rows are all there", () => {
  for (const l of LANGUAGES) {
    const found = sections(guide(l));
    const three = found[2].body.split("\n").filter((x) => /^\d+\. /.test(x));
    assert.equal(three.length, 3, `${l}: section 3 must give exactly three sentences`);
    for (const line of three) {
      assert.ok(/^\d+\. "[^"]+"$/.test(line), `${l}: each sentence is written as a quoted script`);
      assert.ok(!/[.?!।]\s/.test(line.slice(4, -1)), `${l}: each of the three is ONE sentence (join with a comma, not a full stop): ${line}`);
    }
    assert.equal(shape(found[3].body).steps, 5, `${l}: the walkthrough has five steps`);
    assert.equal(shape(found[7].body).checklist, 9, `${l}: the setup visit checklist has 9 items`);
    assert.ok(shape(found[6].body).tableRows >= 14, `${l}: the "Never say" table has its rows`);
    // the 8 questions SELL-GUIDE.md requires, and the Fees ones: cash, "I paid", discounts, refunds, STOP, reminders after payment, "is this AI"
    assert.ok(shape(found[4].body).subheads >= 15, `${l}: section 5 answers the 8 required questions and the Fees ones`);
  }
});

test("sell guide: no emoji anywhere", () => {
  for (const l of LANGUAGES) {
    assert.ok(!/\p{Extended_Pictographic}/u.test(guide(l)), `guide.${l}.md`);
    assert.ok(!/\p{Extended_Pictographic}/u.test(sheet(l)), `one-pager.${l}.html`);
  }
});

// ---- the words the claim rules ban -------------------------------------------------------------------------------------

test("sell guide: no banned word in any guide or sheet, in any language (the Never say column is the one place that quotes them)", () => {
  // The check itself: it finds the words, in each script, and it does skip the first column of section 7 and nothing else.
  assert.deepEqual(banned("It is safe and guaranteed."), ["\\bsafe", "guarant"]);
  for (const word of ["यह सुरक्षित है", "ഇത് സുരക്ഷിതമാണ്", "ಇದು ಸುರಕ್ಷಿತ"]) assert.equal(banned(word).length, 1, word);
  const sample = "## 7. Never say\n| Never say | Why |\n| \"It's safe.\" | Say it is guaranteed. |\n";
  assert.deepEqual(banned(checked(sample)), ["guarant"]);
  assert.ok(banned(guide("en")).length > 0, "the English guide quotes the banned phrases in section 7, so the skip is in use");

  for (const l of LANGUAGES) {
    assert.deepEqual(banned(checked(guide(l))), [], `guide.${l}.md`);
    assert.deepEqual(banned(visible(sheet(l))), [], `one-pager.${l}.html`);
  }
});

// ---- the UPI option (B33) ----------------------------------------------------------------------------------------------------

test("sell guide: every guide teaches the UPI option, each carries the one allowed UPI claim, and none says a UPI payment is checked automatically", () => {
  const CLAIMS: Record<Language, string> = {
    en: "No fee marked paid without your confirmation; every refund tracked.",
    hi: "आपके पक्का किए बिना कोई फ़ीस चुकाई हुई दर्ज नहीं होती; हर रिफंड का हिसाब।",
    ml: "നിങ്ങൾ ഉറപ്പിക്കാതെ ഒരു ഫീസും അടച്ചതായി രേഖപ്പെടുത്തില്ല; ഓരോ റീഫണ്ടിനും കണക്കുണ്ട്.",
    kn: "ನೀವು ಖಚಿತಪಡಿಸದೆ ಯಾವ ಶುಲ್ಕವನ್ನೂ ಪಾವತಿಯಾಗಿದೆ ಎಂದು ದಾಖಲಿಸುವುದಿಲ್ಲ; ಪ್ರತಿ ರೀಫಂಡ್‌ನ ಲೆಕ್ಕ ಇರುತ್ತದೆ.",
  };
  // "checked automatically", as a claim, in each language (the "Never say" column quotes it, so it is skipped there like the banned words)
  const AUTO: Record<Language, string> = { en: "checked automatically", hi: "अपने आप जाँचा", ml: "തനിയെ പരിശോധിക്കപ്പെടും", kn: "ತಾನಾಗಿ ಪರಿಶೀಲಿಸಲಾಗುತ್ತದೆ" };
  for (const l of LANGUAGES) {
    const text = guide(l);
    assert.ok(text.includes("UPI"), `${l}: the guide mentions UPI`);
    assert.ok(text.includes(CLAIMS[l]), `${l}: the guide carries the UPI claim`);
    assert.ok(!checked(text).replaceAll("not checked automatically", "").includes(AUTO[l]), `${l}: the guide does not say a UPI payment is ${AUTO[l]}`);
    assert.ok(!text.includes("B33"), `${l}: UPI is no longer described as not built`);
  }
  assert.ok(guide("en").includes('tap "Received"'), "the owner taps Received");
});

// ---- amounts and numbers ------------------------------------------------------------------------------------------------

// ---- the price figures: from the price list in force (prices/), through each guide's source file and prices/render.ts --------------------------------------
const LIST = listInForce();
/** A rate as the guides write it ("₹149", "2%", "3,000"). */
const price = (id: string): string => formatRate(id, LIST.rates[id]);
const asSet = (ids: string[]) => ids.map((id) => price(id).replace(/[\s,]/gu, ""));
/** Razorpay's fee and the GST on it, on an amount, to the rupee: what "about ₹N" in the guide must say. */
const razorpayOn = (inr: number): number => Math.round((inr * LIST.rates["razorpay.platform-fee"].basisPoints! * (10_000 + LIST.rates["razorpay.gst-on-fee"].basisPoints!)) / 10_000 / 10_000);

test("sell guide: every guide is made from its source file and the price list in force (run node prices/render.ts after a new list)", () => {
  assert.deepEqual(stale().filter((f) => f.startsWith("templates/education/fees/")), []);
  for (const l of LANGUAGES) assert.ok(existsSync(new URL(`../sell/guide.${l}.src.md`, import.meta.url)), `${l}: the source file is there`);
});

test("sell guide: the ₹ amounts are the same set in every guide, section by section: the price list's, and the example centre's", () => {
  const en = guide("en");
  // From the price list in force: the Business plan, extra messages, the builder licence, the suggested centre price and setup, and WhatsApp at cost for a Business centre.
  // The example centre is Bright Tuition Centre: fees ₹1,200, ₹1,500 and ₹1,800, a late fee, waiver limit and part-payment minimum of ₹100 and ₹300, refund limit ₹500; the
  // parent's ₹300 request; and Razorpay's fee on a ₹1,200 fee. (The quoted printouts are left out: see the top.)
  const fromList = asSet(["plan.business.fee", "overage.extra", "licence.builder.fee", "guide.business.shop-min", "guide.business.shop-max", "guide.business.setup-min", "guide.business.setup-max", "guide.business.whatsapp"]);
  same(rupees(withoutFences(en)), new Set([...fromList, "₹100", "₹300", "₹500", "₹1200", "₹1500", "₹1800", `₹${razorpayOn(1200)}`]));
  assert.ok(en.includes(`On a ₹1,200 fee that is about ₹${razorpayOn(1200)}.`), "the Razorpay example is the list's fee and GST on ₹1,200");
  for (const l of TRANSLATED) {
    same(rupees(withoutFences(guide(l))), rupees(withoutFences(en)));
    const master = sections(en);
    const other = sections(guide(l));
    for (const s of master) same(rupees(withoutFences(other[s.n - 1].body)), rupees(withoutFences(s.body)));
  }
  for (const l of LANGUAGES) {
    for (const text of [guide(l), visible(sheet(l))]) {
      assert.ok(!/\b(Rs\.?|INR)\s?\d|\d\s?(रुपये|रुपए|रु\.|രൂപ|ರೂಪಾಯಿ|ರೂ\.)/u.test(text), `${l}: write every amount with its own ₹ sign, in Western digits`);
    }
  }
});

test("sell guide: every number is the same in every language", () => {
  for (const l of TRANSLATED) same(numbers(withoutFences(guide(l))), numbers(withoutFences(guide("en"))));
});

test("sell guide: section 6 gives the Business plan, the builder licence and WhatsApp on the centre's bill from the list in force, in every language, and no first-100 price or own-server discount", () => {
  for (const l of LANGUAGES) {
    const s6 = section(l, 6);
    for (const id of ["plan.business.fee", "plan.business.allowance", "overage.extra", "licence.builder.fee", "guide.business.shop-min", "guide.business.shop-max", "guide.business.setup-min", "guide.business.setup-max", "guide.business.whatsapp", "innovator.places", "razorpay.platform-fee"]) assert.ok(s6.includes(price(id)), `${l}: section 6 must give ${id} (${price(id)})`);
    for (const wanted of ["15", dayWords(LIST.date)]) assert.ok(s6.includes(wanted), `${l}: section 6 must give ${wanted}`);
    // The 4 Nov flat fee was ₹199, written by hand. Since decision 36 (10 Nov) the builder licence is ₹199 too, and it reaches a guide only through
    // {{licence.builder.fee}}. So the ₹199 check reads the source: a hand-written ₹199 there is the old fee; a ₹199 in the made guide is the list's licence.
    assert.ok(!/₹\s?199\b/u.test(readFileSync(new URL(`guide.${l}.src.md`, SELL), "utf8")), `${l}: no old flat fee written by hand (a price comes from the list: {{id}})`);
    assert.ok(!/40\s?%|half (the )?plan|आधी कीमत|വിലയുടെ പകുതി|ಬೆಲೆಯ ಅರ್ಧ/u.test(guide(l)), `${l}: no first-100 discount, no own-server discount`);
  }
});

// ---- the walkthrough the guide teaches ------------------------------------------------------------------------------------

/**
 * One line of the printout, with the numbers that the stand-in services make up (the payment link and the receipt) made the same. The guide still quotes the
 * stand-in's old link (rzp.io) and the walkthrough prints the neutral one (B71); either is the link.
 */
const plain = (line: string) => line.replace(/https:\/\/(?:rzp\.io\/l\/plink|pay\.example\/req_)\d+/g, "LINK").replace(/\bf-\d+\b/g, "RECEIPT").replace(/\s+/g, " ").trim();

test("sell guide: section 4 quotes the walkthrough exactly as the script prints it, in every language (only the link and the receipt number are free)", async () => {
  for (const l of LANGUAGES) {
    const { steps } = await walk(l);
    const text = printed(l, steps);
    const printedLines = text.split("\n").filter((x) => x.startsWith("   ")).map(plain);
    const body = section(l, 4);
    assert.deepEqual(fencedLines(body, "text").map(plain), printedLines, `${l}: the quoted lines must be the walkthrough's lines, in order`);
    // the first line of the printout, which says it is test money
    assert.ok(body.includes("Stand-in services and test money: nothing real is sent."), `${l}: the guide quotes the printout's own "test money" line`);
    // the two lines the brief names for every language: the reminder, and the receipt
    const quoted = fencedLines(body, "text");
    assert.ok(quoted.some((x) => x.includes(MARKERS[l].reminder)), `${l}: the reminder is quoted`);
    assert.ok(quoted.some((x) => x.includes(MARKERS[l].received)), `${l}: the receipt is quoted`);
    assert.ok(quoted.some((x) => x.endsWith(": approve q-1")), `${l}: the owner's reply "approve q-1" is quoted`);
    assert.ok(quoted.includes("   (nothing is sent)") || quoted.includes("(nothing is sent)"), `${l}: step 5 shows that nothing is sent`);
  }
});

test("sell guide: the walkthrough the guide teaches does what the five steps say, on the stand-ins' own records", async () => {
  // The walkthrough's own test checks each step in each language. Here: the numbers the guide's prose gives for it.
  const settings = brightTuition();
  assert.equal(WALK_DISCOUNT_INR, 300, "the guide says the parent asks for ₹300 off");
  assert.equal(settings.waiver.limitInr, 100, "the guide says that is above the ₹100 limit");
  for (const l of LANGUAGES) {
    assert.ok(SAYS[l].discountOff(WALK_DISCOUNT_INR).includes("300"));
    assert.ok(section(l, 4).includes("300") && section(l, 4).includes("100"), `${l}: section 4 gives the ₹300 request and the ₹100 limit`);
  }
});

test("sell guide: the walkthrough command in the guide is a real one", () => {
  const script = readFileSync(new URL("../scripts/walkthrough.ts", import.meta.url), "utf8");
  assert.ok(script.includes('lang: { type: "string" }'));
  for (const l of LANGUAGES) {
    const commands = fencedLines(section(l, 4), "sh");
    assert.ok(commands.some((c) => c.startsWith("node templates/education/fees/scripts/walkthrough.ts --lang en")), `${l}: the guide gives the English command`);
    assert.ok(commands.some((c) => c.startsWith("node templates/education/fees/scripts/walkthrough.ts --lang hi")), `${l}: the guide gives the command for the owner's language`);
    assert.ok(commands.every((c) => /^node templates\/education\/fees\/scripts\/walkthrough\.ts --lang (en|hi)( |$)/.test(c)));
    assert.ok(commands.some((c) => c.includes("also ml, kn")), `${l}: the guide says ml and kn are there too`);
  }
  assert.ok(existsSync(new URL("../scripts/walkthrough.ts", import.meta.url)));
});

// ---- what the guide says does not exist yet: when it is built, this fails, and the guide has to change -----------------------

test("sell guide: what the guide says is not built yet is still not built (build the phone demo, then change sections 4 and 11)", () => {
  for (const missing of ["demo"]) {
    assert.ok(!existsSync(new URL(`../${missing}`, import.meta.url)), `templates/education/fees/${missing} exists now: the guide still says there is no phone demo for Fees`);
  }
  const script = readFileSync(new URL("../scripts/hand-check.ts", import.meta.url), "utf8");
  assert.ok(script.includes('settings: { type: "string" }'), "the guide tells the partner to run the hand check on the centre's own settings file");
  for (const l of LANGUAGES) {
    assert.ok(section(l, 8).includes("hand-check.ts --settings"), `${l}: the real command for the check on a centre's own settings`);
    assert.ok(section(l, 8).includes("templates/education/fees/whatsapp-templates.json") && existsSync(new URL("../whatsapp-templates.json", import.meta.url)), `${l}: the list of messages Meta must approve exists`);
    assert.ok(section(l, 8).includes("templates/education/fees/settings/bright-tuition.example.json") && existsSync(new URL("../settings/bright-tuition.example.json", import.meta.url)));
    assert.ok(section(l, 11).includes("REVIEW-ml.md") && section(l, 11).includes("REVIEW-kn.md"), `${l}: section 11 names the review sheets`);
  }
  for (const file of ["REVIEW-ml.md", "REVIEW-kn.md"]) assert.ok(existsSync(new URL(`../${file}`, import.meta.url)), file);
  const templates = JSON.parse(readFileSync(new URL("../whatsapp-templates.json", import.meta.url), "utf8")) as { language: string }[];
  assert.deepEqual([...new Set(templates.map((t) => t.language))].sort(), [...LANGUAGES].sort(), "the list of messages Meta must approve is in all four languages");
});

// ---- the example centre's numbers ------------------------------------------------------------------------------------------

test("sell guide: the example centre's numbers in section 8 are the ones in bright-tuition.example.json", () => {
  const raw = JSON.parse(readFileSync(new URL("../settings/bright-tuition.example.json", import.meta.url), "utf8"));
  const fees: number[] = raw.batches.map((b: { monthlyFeeInr: number }) => b.monthlyFeeInr);
  const [first, second, third, fourth]: number[] = raw.reminders.daysFromDue.map((d: number) => Math.abs(d));
  assert.deepEqual(fees, [1200, 1500, 1800]);
  assert.deepEqual([raw.due.day, raw.due.graceDays, raw.lateFeeInr, raw.reminders.hour, raw.reminders.maxPerMonth, raw.partPayments.minInr, raw.waiver.limitInr, raw.refund.limitInr], [5, 5, 100, 10, 4, 300, 100, 500]);
  assert.equal(raw.partPayments.allowed, true);

  // the English table says each of them in words
  const table = (l: Language) => section(l, 8).split("\n").filter((x) => /^\s*\|/.test(x)).join("\n");
  const en = table("en");
  for (const fee of fees) assert.ok(en.includes(inr(fee)), `English table: ${inr(fee)}`);
  for (const words of [
    `The ${raw.due.day}th.`, `${raw.due.graceDays} days.`, `${inr(raw.lateFeeInr)}, after the grace days`, `${first} days before, on the due day, and ${third} and ${fourth} days after, at ${raw.reminders.hour}:00. At most ${raw.reminders.maxPerMonth} a month.`,
    `Yes, from ${inr(raw.partPayments.minInr)}.`, `Up to ${inr(raw.waiver.limitInr)} in total.`, `${inr(raw.refund.limitInr)}. A refund is never more than the payment on record.`,
  ]) assert.ok(en.includes(words), `English table: ${words}`);
  assert.equal(second, 0, "the second reminder day is the due day itself");

  // every language has all of them as numbers
  const want = [...fees, raw.due.day, raw.due.graceDays, raw.lateFeeInr, first, third, fourth, raw.reminders.hour, raw.reminders.maxPerMonth, raw.partPayments.minInr, raw.waiver.limitInr, raw.refund.limitInr].map(String);
  for (const l of LANGUAGES) {
    const found = numbers(table(l));
    for (const n of want) assert.ok(found.has(n), `${l}: the setup table must give ${n}`);
    same(found, numbers(en));
  }
});

// ---- the hand check -----------------------------------------------------------------------------------------------------

test("sell guide: the hand-check numbers in section 11 and on the sheets are the ones a real run gives today", async () => {
  const bright = await runOn(brightTuition());
  const held = bright.results.filter((r) => r.held).length;
  const total = bright.results.length;
  const checks = bright.results.reduce((n, r) => n + r.checks.length, 0);
  const notTested = NOT_TESTED.length; // the hand check's own "NOT TESTED" list, not the situations it could not run
  assert.deepEqual([held, total, bright.skipped.length], [26, 26, 0], "a situation fails or was added: the guide, the sheets and the READMEs quote these numbers, so change them together");
  assert.deepEqual([checks, notTested], [209, 12]);

  const maths = parseSettings(JSON.parse(readFileSync(new URL("../settings/maths-circle.example.json", import.meta.url), "utf8")));
  const second = await runOn(maths);
  const mHeld = second.results.filter((r) => r.held).length;
  const mTotal = second.results.length;
  assert.deepEqual([mHeld, mTotal, second.skipped.length], [23, 23, 3]);

  const en = section("en", 11);
  assert.ok(en.includes(`${held} of ${total} situations (${checks} checks), with ${notTested} listed as not tested`));
  assert.ok(en.includes(`it holds ${mHeld} of ${mTotal}, with ${second.skipped.length} not run on those settings`));
  assert.ok(en.includes("As of 5 November 2026"));
  for (const l of LANGUAGES) {
    const found = numbers(section(l, 11));
    for (const n of [held, total, checks, notTested, mHeld, second.skipped.length]) assert.ok(found.has(String(n)), `${l}: section 11 must give ${n}`);
    assert.ok(numbers(visible(sheet(l))).has(String(held)), `one-pager.${l}.html gives the ${held}`);
  }
  assert.ok(visible(sheet("en")).includes(`${held} of ${total} situations held`));
});

// ---- the machine-written banner, the date ------------------------------------------------------------------------------------

test("sell guide: the Hindi, Malayalam and Kannada guides carry the machine-written banner with the date; the English master does not", () => {
  for (const l of TRANSLATED) {
    const top = guide(l).split("\n").slice(0, 6).join("\n");
    assert.ok(/Machine-written/.test(top), `${l}: banner missing`);
    assert.ok(/native speaker/.test(top), `${l}: banner must say it needs a native speaker's review`);
    assert.ok(top.includes("5 November 2026"), `${l}: banner must carry the date`);
  }
  assert.ok(!/Machine-written/.test(guide("en").split("\n").slice(0, 6).join("\n")));
});

test("sell guide: every guide says the same dated thing about today in section 11 and in its first lines", () => {
  for (const l of LANGUAGES) {
    assert.ok(section(l, 11).includes(DATE[l]), `${l}: section 11 is dated ${DATE[l]}`);
    assert.ok(guide(l).split("\n").slice(0, 12).join("\n").includes(DATE[l]), `${l}: the opening lines say when the guide was written`);
  }
});

test("one-pagers: the Hindi, Malayalam and Kannada sheets carry the same banner as an HTML comment (not printed on the owner's copy); the English does not", () => {
  for (const l of TRANSLATED) {
    const comment = /<!--([\s\S]*?)-->/.exec(sheet(l).slice(0, 400))?.[1] ?? "";
    for (const part of [/Machine-written/, /native speaker/, /5 November 2026/]) assert.ok(part.test(comment), `one-pager.${l}.html: the banner comment must say ${part}`);
  }
  assert.ok(!/Machine-written/.test(sheet("en")));
});

// ---- the report's own words ----------------------------------------------------------------------------------------------------

const LABELS = ["collected", "stillToCollect", "givenBack", "takenOff", "remindersSent", "wasAsked", "stoppedByLimits", "notChecked"] as const;

test("sell guide: section 9 and the sheets name the monthly report's lines in the report's own words, in each language", () => {
  for (const l of LANGUAGES) {
    const words = STRINGS[l].label;
    const nine = section(l, 9);
    for (const key of [...LABELS, "approved", "saidNo"] as const) assert.ok(nine.includes(words[key]), `${l}: section 9 must name the report line "${words[key]}"`);
    const html = sheet(l);
    for (const key of LABELS) assert.ok(html.includes(`<li>${words[key]}<span class="num"></span></li>`), `one-pager.${l}.html: the report line "${words[key]}"`);
  }
});

test("one-pagers: the not-checked line is the report's short form, in the report's own words, with the date and the run", () => {
  for (const l of LANGUAGES) {
    const html = sheet(l);
    const line = /<div class="not-checked">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? "";
    const s = STRINGS[l];
    assert.ok(line.startsWith(`<b>${s.label.notChecked}</b> (${DATE[l]}): `), `${l}: the line starts with the report's "Not checked" label and the date`);
    for (const key of ["cash", "upi", "whatsapp", "razorpay", "review"] as const) assert.ok(line.includes(s.notChecked[key]), `${l}: ${s.notChecked[key]}`);
    assert.ok(line.includes(s.handRun), `${l}: the line says the checks were run by hand`);
  }
});

// ---- the one-page sheets ---------------------------------------------------------------------------------------------------

test("one-pagers: no script, no external address, font, image or style sheet", () => {
  for (const l of LANGUAGES) {
    const html = sheet(l);
    const name = `one-pager.${l}.html`;
    assert.ok(!/<script/i.test(html), `${name}: no <script>`);
    assert.ok(!/<[^>]+\son[a-z]+\s*=/i.test(html), `${name}: no event handlers`);
    assert.ok(!/javascript:/i.test(html), `${name}: no javascript: address`);
    assert.ok(!/(https?:)?\/\/[a-z0-9]/i.test(html), `${name}: no external address`);
    for (const re of [/\burl\s*\(/i, /@import/i, /@font-face/i, /<link\b/i, /<img\b/i, /<iframe\b/i, /<object\b/i, /<embed\b/i, /\bsrc\s*=/i, /\bhref\s*=/i]) assert.ok(!re.test(html), `${name}: ${re}`);
    assert.ok(/<meta charset="utf-8">/i.test(html) && /name="viewport"/.test(html), `${name}: charset and phone viewport`);
    assert.ok(new RegExp(`<html lang="${l}">`).test(html), `${name}: <html lang="${l}"> so the right script font is chosen`);
    assert.ok(/@page\s*\{[^}]*size:\s*A4/.test(html) && /@media print/.test(html), `${name}: prints on A4`);
  }
});

test("one-pagers: one example, three things to check, a place for the name and phone, and the not-checked line", () => {
  for (const l of LANGUAGES) {
    const html = sheet(l);
    const count = (cls: string) => (html.match(new RegExp(`class="[^"]*\\b${cls}\\b[^"]*"`, "g")) ?? []).length;
    const name = `one-pager.${l}.html`;
    assert.equal(count("step"), 4, `${name}: the example is 4 steps`);
    assert.equal(count("promise"), 3, `${name}: three things the owner can check`);
    assert.ok(count("fill") >= 4, `${name}: spaces for the name, the phone and the two prices`);
    assert.equal(count("not-checked"), 1, `${name}: the not-checked line`);
    assert.ok(visible(html).includes(DATE[l]), `${name}: the not-checked line is dated`);
    // the example's two chat bubbles are the product's own words: the reminder (a helper bubble) and the parent asking for ₹300 off
    assert.ok(html.includes(`class="bubble helper">${MARKERS[l].reminder}`), `${name}: the helper's bubble is the product's reminder`);
    assert.ok(html.includes(`<p class="bubble">${SAYS[l].discountOff(WALK_DISCOUNT_INR)}</p>`), `${name}: the parent's bubble is what the product reads as a request for ₹300 off`);
    assert.ok(html.includes("approve q-1"), `${name}: the owner's reply`);
  }
  const en = sheet("en");
  for (const promise of ["A fee the payment record shows paid gets no reminder.", "It can't take off more than your limit without asking you.", "Every month you see what it did, including mistakes."]) assert.ok(en.includes(promise), promise);
  assert.ok(en.includes("Fee reminder from Bright Tuition Centre. Rohan Mehta's class 10 fee for Nov 2026 is ₹1,800, due on Thu 5 Nov. Pay here: [link] Reply STOP if you do not want these reminders."), "the English bubble is the walkthrough's reminder");
});

test("one-pagers: the same layout in every language, and the same amounts and numbers", () => {
  const css = (html: string) => /<style>([\s\S]*?)<\/style>/.exec(html)?.[1];
  assert.ok(css(sheet("en")));
  for (const l of TRANSLATED) {
    assert.equal(css(sheet(l)), css(sheet("en")), `one-pager.${l}.html must use the same CSS as the English`);
    same(rupees(visible(sheet(l))), rupees(visible(sheet("en"))));
    same(numbers(withoutBubbles(sheet(l))), numbers(withoutBubbles(sheet("en"))));
  }
  same(rupees(visible(sheet("en"))), new Set(["₹100", "₹300", "₹500", "₹1800"]));
});

// ---- the words the guide takes from the product -------------------------------------------------------------------------------

test("sell guide: every guide quotes the owner's reply, STOP and the Guard code, as the product says them", () => {
  for (const l of LANGUAGES) {
    const text = guide(l);
    assert.ok(text.includes("approve q-1") && text.includes("deny q-1"), `${l}: the owner's replies`);
    assert.ok(text.includes("STOP"), `${l}: STOP`);
    assert.ok(text.includes("Guard"), `${l}: Guard holds a large refund`);
    assert.ok(text.includes("Razorpay") && text.includes("Meta"), `${l}: the platforms are named`);
  }
});
