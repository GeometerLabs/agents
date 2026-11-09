// The Orders sell guide (sell/): a guide and a one-page sheet in every language, the same 11 sections in the same order, the same amounts and numbers everywhere, none of the
// words the claim rules ban, the walkthrough it teaches quoted exactly as the script prints it, and every number it gives about the example shop and about the hand check
// compared with the real thing. The spec every template copies is ../../../SELL-GUIDE.md.
//
// Two deliberate differences from Fees. The phone demo is not built for Orders, and a test below fails the day it is (then the guide must change). And the walkthrough's UPI codes
// are random on every run, so the quoted printout is compared with the code, the link and nothing else made the same. The report lines section 9 and the sheets name are the UPI shop's, in the report's own words (report/strings.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { bannedIn } from "../../../../modules/report/claims.ts";
import { LANGUAGES } from "../../../../modules/language/languages.ts";
import type { Language } from "../../../../modules/language/languages.ts";
import { NOT_TESTED, UPI_NOT_TESTED, notTestedOf } from "../crash-test/not-tested.ts";
import { runOn } from "../crash-test/situations.ts";
import { STRINGS } from "../report/strings.ts";
import { WALK_OFFER_INR, WALK_QTY, printed, walk, walkSettings } from "../scripts/walkthrough.ts";
import { annapurna, annapurnaRazorpay } from "../src/harness.ts";
import { dayWords, formatRate, listInForce, stale } from "../../../../prices/render.ts";

const SELL = new URL("../sell/", import.meta.url);
const SPEC = new URL("../../../SELL-GUIDE.md", import.meta.url);
const guide = (l: Language) => readFileSync(new URL(`guide.${l}.md`, SELL), "utf8");
const sheet = (l: Language) => readFileSync(new URL(`one-pager.${l}.html`, SELL), "utf8");
const TRANSLATED = LANGUAGES.filter((l) => l !== "en");
/** The date the guide and the sheets are written for, in each language. It changes whenever the status in section 11 changes. */
const DATE: Record<Language, string> = { en: "8 November 2026", hi: "8 नवंबर 2026", ml: "8 നവംബർ 2026", kn: "8 ನವೆಂಬರ್ 2026" };

/** The one claim about money, word for word, and the help line, one fixed wording per language. */
const CLAIMS: Record<Language, string> = {
  en: "No order confirmed without the payment record (or your confirmation for UPI); every refund tracked.",
  hi: "भुगतान के रिकॉर्ड (UPI में आपकी पुष्टि) के बिना कोई ऑर्डर पक्का नहीं होता; हर रिफंड का हिसाब।",
  ml: "പേയ്‌മെന്റ് രേഖ (UPI ആണെങ്കിൽ നിങ്ങളുടെ ഉറപ്പ്) ഇല്ലാതെ ഒരു ഓർഡറും ഉറപ്പിക്കില്ല; ഓരോ റീഫണ്ടിനും കണക്കുണ്ട്.",
  kn: "ಪಾವತಿ ದಾಖಲೆ (UPI ಆದರೆ ನಿಮ್ಮ ಖಚಿತಪಡಿಸುವಿಕೆ) ಇಲ್ಲದೆ ಯಾವ ಆರ್ಡರ್‌ ಅನ್ನೂ ಖಚಿತಪಡಿಸುವುದಿಲ್ಲ; ಪ್ರತಿ ರೀಫಂಡ್‌ನ ಲೆಕ್ಕ ಇರುತ್ತದೆ.",
};
const HELP: Record<Language, string> = {
  en: "Write to support. A person answers.",
  hi: "सपोर्ट को लिखिए। एक इंसान जवाब देता है।",
  ml: "സപ്പോർട്ടിന് എഴുതൂ. ഒരാൾ മറുപടി തരും.",
  kn: "ಸಪೋರ್ಟ್‌ಗೆ ಬರೆಯಿರಿ. ಒಬ್ಬ ವ್ಯಕ್ತಿ ಉತ್ತರಿಸುತ್ತಾರೆ.",
};

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

/** What a section is made of, so a translation cannot quietly drop a row, a step, a checklist item, a bullet or a quoted printout. */
function shape(body: string) {
  const lines = body.split("\n");
  const count = (re: RegExp) => lines.filter((l) => re.test(l)).length;
  return { subheads: count(/^### /), tableRows: count(/^\s*\|/), checklist: count(/^- \[ \] /), steps: count(/^\d+\. /), bullets: count(/^\s*- (?!\[ \])/), codeFences: count(/^```/) };
}

/** The text without the ``` blocks (the printout quotes, and the commands). */
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
/** More words this brief bans in prose. The quoted printouts are the product's own sentences ("A screenshot is not proof of payment"), so they are left out of this check. */
const EXTRA_BANNED = [/\bproves?\b/i, /proof of/i, /founding/i, /founder/i, /communal/i, /100 ?%/, /\bguarantee/i];
const extraBanned = (text: string): string[] => EXTRA_BANNED.filter((re) => re.test(text)).map((re) => re.source);
const visible = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<!--[\s\S]*?-->/g, "");
/** The sheet without its chat bubbles: a bubble is the product's own words, and they name the item in each script. */
const withoutBubbles = (html: string) => visible(html).replace(/<p class="bubble[^"]*">[\s\S]*?<\/p>/g, "");
const rupees = (text: string) => new Set((text.match(/₹\s?\d[\d,]*/g) ?? []).map((x) => x.replace(/[\s,]/g, "")));
const numbers = (text: string) => new Set((text.match(/\d[\d,]*/g) ?? []).map((x) => x.replace(/,/g, "")));
const same = (a: Set<string>, b: Set<string>) => assert.deepEqual([...a].sort(), [...b].sort());
const inr = (n: number) => `₹${n.toLocaleString("en-US")}`;
const section = (l: Language, n: number) => sections(guide(l))[n - 1].body;

// ---- the files and the sections ----------------------------------------------------------------------------------------

test("sell guide: every language has a guide and a one-page sheet, and the walkthrough shop speaks them all", () => {
  assert.ok(LANGUAGES.length >= 4);
  assert.deepEqual([...walkSettings().languages].sort(), [...LANGUAGES].sort());
  for (const l of annapurna().languages) assert.ok(LANGUAGES.includes(l));
  for (const l of LANGUAGES) {
    for (const name of [`guide.${l}.md`, `one-pager.${l}.html`]) {
      assert.ok(existsSync(new URL(name, SELL)), `sell/${name} is missing: a template is not ready to sell until its guide is`);
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
  // One title changes, on purpose: section 4 says "to the owner" because Orders has no demo on the owner's phone, only a walkthrough on the partner's laptop (the heading must not
  // claim more than is true today).
  const titles = sections(guide("en")).map((s) => [s.n, s.title.replace("Show it to the owner", "Show it on the owner's own phone")] as const);
  assert.deepEqual(titles, rows);
});

test("sell guide: every section has the same shape in every language (rows, steps, checklist items, bullets, quoted printouts)", () => {
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
      assert.ok(!/[.?!।]\s/.test(line.slice(4, -1)), `${l}: each of the three is ONE sentence (join with a comma or a colon, not a full stop): ${line}`);
    }
    assert.equal(shape(found[3].body).steps, 5, `${l}: the walkthrough has five steps`);
    assert.equal(shape(found[7].body).checklist, 9, `${l}: the setup visit checklist has 9 items`);
    assert.ok(shape(found[6].body).tableRows >= 14, `${l}: the "Never say" table has its rows`);
    // the 8 questions SELL-GUIDE.md requires, and the Orders ones: "I paid", lower price, stock, cut-off, cancel, STOP, UPI, the rest of the price, "is this AI"
    assert.ok(shape(found[4].body).subheads >= 15, `${l}: section 5 answers the 8 required questions and the Orders ones`);
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
  assert.deepEqual(extraBanned("proof of payment, founding founder, communal, 100%, it proves"), ["\\bproves?\\b", "proof of", "founding", "founder", "communal", "100 ?%"]);
  const sample = "## 7. Never say\n| Never say | Why |\n| \"It's safe.\" | Say it is guaranteed. |\n";
  assert.deepEqual(banned(checked(sample)), ["guarant"]);
  assert.ok(banned(guide("en")).length > 0, "the English guide quotes the banned phrases in section 7, so the skip is in use");

  for (const l of LANGUAGES) {
    assert.deepEqual(banned(checked(guide(l))), [], `guide.${l}.md`);
    assert.deepEqual(extraBanned(checked(withoutFences(guide(l)))), [], `guide.${l}.md (the words this brief bans)`);
    assert.deepEqual(banned(visible(sheet(l))), [], `one-pager.${l}.html`);
    assert.deepEqual(extraBanned(visible(sheet(l))), [], `one-pager.${l}.html (the words this brief bans)`);
  }
});

// ---- the one claim about money, the help line -------------------------------------------------------------------------------

test("sell guide: every guide carries the one allowed claim about money word for word, the help line, and does not say a UPI payment is checked automatically", () => {
  // "checked automatically", as a claim, in each language (the "Never say" column quotes it, so it is skipped there like the banned words)
  const AUTO: Record<Language, string> = { en: "checked automatically", hi: "अपने आप जाँचा", ml: "തനിയെ പരിശോധിക്കപ്പെടും", kn: "ತಾನಾಗಿ ಪರಿಶೀಲಿಸಲಾಗುತ್ತದೆ" };
  for (const l of LANGUAGES) {
    const text = guide(l);
    assert.ok(text.includes("UPI"), `${l}: the guide mentions UPI`);
    assert.ok(text.includes(CLAIMS[l]), `${l}: the guide carries the claim`);
    assert.ok(section(l, 5).includes(CLAIMS[l]), `${l}: the UPI answer in section 5 carries the claim`);
    assert.ok(text.split(CLAIMS[l]).length - 1 >= 3, `${l}: the claim is in the opening, in section 5 and in section 7`);
    assert.ok(text.includes(HELP[l]), `${l}: the help line`);
    assert.ok(section(l, 10).includes(HELP[l]) && section(l, 5).includes(HELP[l]), `${l}: the help line in sections 5 and 10`);
    assert.ok(!checked(text).replaceAll("not checked automatically", "").includes(AUTO[l]), `${l}: the guide does not say a UPI payment is ${AUTO[l]}`);
  }
  assert.ok(guide("en").includes('tap "Received"'), "the owner taps Received");
  assert.ok(visible(sheet("en")).includes(HELP.en) && TRANSLATED.every((l) => visible(sheet(l)).includes(HELP[l])), "the help line is on every sheet");
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
  assert.deepEqual(stale().filter((f) => f.startsWith("templates/commerce/orders/")), []);
  for (const l of LANGUAGES) assert.ok(existsSync(new URL(`../sell/guide.${l}.src.md`, import.meta.url)), `${l}: the source file is there`);
});

test("sell guide: the ₹ amounts are the same set in every guide, section by section: the price list's, and the example shop's", () => {
  const en = guide("en");
  // From the price list in force: the Business plan, extra messages, the builder licence, the suggested shop price and setup, and WhatsApp at cost for a Business shop.
  // The example shop is Annapurna Tiffins: ₹120, ₹160 and ₹20, an approval line of ₹1,000, a refund limit of ₹300; the walkthrough order of ₹240 with a ₹120 advance.
  // (The quoted printouts are left out: see the top.)
  const fromList = asSet(["plan.business.fee", "overage.extra", "licence.builder.fee", "guide.business.shop-min", "guide.business.shop-max", "guide.business.setup-min", "guide.business.setup-max", "guide.business.whatsapp"]);
  same(rupees(withoutFences(en)), new Set([...fromList, "₹1000", "₹120", "₹160", "₹20", "₹240", "₹300"]));
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

test("sell guide: section 6 gives the Business plan, the builder licence and WhatsApp on the shop's bill from the list in force, in every language, and no first-100 price or own-server discount", () => {
  for (const l of LANGUAGES) {
    const s6 = section(l, 6);
    for (const id of ["plan.business.fee", "plan.business.allowance", "overage.extra", "licence.builder.fee", "guide.business.shop-min", "guide.business.shop-max", "guide.business.setup-min", "guide.business.setup-max", "guide.business.whatsapp", "innovator.places", "razorpay.platform-fee"]) assert.ok(s6.includes(price(id)), `${l}: section 6 must give ${id} (${price(id)})`);
    for (const wanted of ["15", dayWords(LIST.date)]) assert.ok(s6.includes(wanted), `${l}: section 6 must give ${wanted}`);
    assert.ok(!/₹\s?199\b|40\s?%|half (the )?plan|आधी कीमत|വിലയുടെ പകുതി|ಬೆಲೆಯ ಅರ್ಧ/u.test(guide(l)), `${l}: no old flat fee, no first-100 discount, no own-server discount`);
  }
  assert.ok(section("en", 6).includes("Business plan"));
});

// ---- the walkthrough the guide teaches ------------------------------------------------------------------------------------

/** One line of the printout, with what the stand-in services make up (the UPI link and the owner's codes, new on every run) made the same. */
const plain = (line: string) => line.replace(/upi:\/\/\S+/g, "LINK").replace(/\b(received|refunded) [A-Z0-9]{6}\b/g, "$1 CODE").replace(/\s+/g, " ").trim();

test("sell guide: section 4 quotes the walkthrough exactly as the script prints it, in every language (only the UPI link and the owner's codes are free)", async () => {
  for (const l of LANGUAGES) {
    const { steps } = await walk(l);
    const text = printed(l, steps);
    const printedLines = text.split("\n").filter((x) => x.startsWith("   ")).map(plain);
    const body = section(l, 4);
    assert.deepEqual(fencedLines(body, "text").map(plain), printedLines, `${l}: the quoted lines must be the walkthrough's lines, in order`);
    assert.ok(body.includes("Stand-in services and test money: nothing real is sent."), `${l}: the guide quotes the printout's own "test money" line`);
    const quoted = fencedLines(body, "text");
    assert.ok(quoted.some((x) => /: received [A-Z0-9]{6}$/.test(x)), `${l}: the owner's "received" reply is quoted`);
    assert.ok(quoted.some((x) => /: refunded [A-Z0-9]{6}$/.test(x)), `${l}: the owner's "refunded" reply is quoted`);
    assert.ok(quoted.some((x) => x.includes("Refund to send")), `${l}: the refund the owner owes is quoted`);
  }
});

test("sell guide: the numbers the guide's prose gives for the walkthrough are the walkthrough's own", async () => {
  const { shop } = await walk("en");
  assert.equal(WALK_QTY, 2);
  assert.equal(WALK_OFFER_INR, 90);
  assert.equal(shop.item.priceInr * WALK_QTY, 240, "the guide says ₹240");
  assert.equal(shop.advanceInr, 120, "the guide says ₹120 in advance");
  assert.equal(shop.settings.advance.holdMinutes, 30, "the guide says the stock is held for 30 minutes");
  assert.equal(shop.settings.cancellation.windowHours, 6);
  for (const l of LANGUAGES) {
    const four = section(l, 4);
    assert.ok(four.includes("₹240") && four.includes("₹120"), `${l}: section 4 gives the ₹240 order and the ₹120 advance`);
    assert.ok(four.includes("30"), `${l}: section 4 gives the 30 minutes`);
  }
});

test("sell guide: the walkthrough command in the guide is a real one", () => {
  const script = readFileSync(new URL("../scripts/walkthrough.ts", import.meta.url), "utf8");
  assert.ok(script.includes('lang: { type: "string" }'));
  for (const l of LANGUAGES) {
    const commands = fencedLines(section(l, 4), "sh");
    assert.ok(commands.some((c) => c.startsWith("node templates/commerce/orders/scripts/walkthrough.ts --lang en")), `${l}: the guide gives the English command`);
    assert.ok(commands.some((c) => c.startsWith("node templates/commerce/orders/scripts/walkthrough.ts --lang hi")), `${l}: the guide gives the command for the owner's language`);
    assert.ok(commands.every((c) => /^node templates\/commerce\/orders\/scripts\/walkthrough\.ts --lang (en|hi)( |$)/.test(c)));
    assert.ok(commands.some((c) => c.includes("also ml, kn")), `${l}: the guide says ml and kn are there too`);
  }
});

// ---- what the guide says does not exist yet: when it is built, this fails, and the guide has to change -----------------------

test("sell guide: what the guide says is not built yet is still not built (build the phone demo, then change sections 4 and 11), and what it says is built is", () => {
  const orders = (path: string) => new URL(`../${path}`, import.meta.url);
  assert.ok(!existsSync(orders("demo")), "templates/commerce/orders/demo exists now: the guide still says there is no phone demo for Orders");
  for (const built of ["scripts/go-live-certificate.ts", "scripts/client-report.ts", "report/strings.ts", "approvals/relay.ts", "whatsapp-templates.json"]) assert.ok(existsSync(orders(built)), `${built}: the guide says it is built`);
  for (const l of LANGUAGES) {
    assert.ok(section(l, 8).includes("hand-check.ts --settings") && section(l, 8).includes("templates/commerce/orders/whatsapp-templates.json"), `${l}: the real commands and files`);
    assert.ok(section(l, 8).includes("templates/commerce/orders/settings/annapurna-tiffins.example.json"));
    assert.ok(section(l, 8).includes("go-live-certificate.ts --settings <your file> --lang <en, hi, ml or kn> --out <folder>"), `${l}: the go-live certificate command`);
  }
  const certScript = readFileSync(orders("scripts/go-live-certificate.ts"), "utf8");
  for (const option of ["settings", "lang", "out"]) assert.ok(certScript.includes(`${option}: { type: "string" }`), `go-live-certificate.ts takes --${option}`);
  const script = readFileSync(orders("scripts/hand-check.ts"), "utf8");
  assert.ok(script.includes('settings: { type: "string" }'), "the guide tells the partner to run the hand check on the shop's own settings file");
  assert.ok(existsSync(orders("settings/annapurna-tiffins.example.json")));
});

// ---- the example shop's numbers ------------------------------------------------------------------------------------------

test("sell guide: the example shop's numbers in section 8 are the ones in annapurna-tiffins.example.json", () => {
  const raw = JSON.parse(readFileSync(new URL("../settings/annapurna-tiffins.example.json", import.meta.url), "utf8"));
  const [thali, chicken, curd] = raw.menu;
  assert.deepEqual([thali.priceInr, thali.dailyStock, chicken.priceInr, chicken.dailyStock, curd.priceInr, curd.dailyStock], [120, 12, 160, 8, 20, 30]);
  const [lunch, dinner] = raw.pickup.slots;
  const [lunchHome, dinnerHome] = raw.delivery.slots;
  assert.deepEqual([raw.cutoff.daysBefore, raw.cutoff.time, lunch.cutoff.daysBefore, lunch.cutoff.time, dinner.cutoff.daysBefore, dinner.cutoff.time], [1, "20:00", 0, "09:00", 0, "15:00"]);
  assert.deepEqual([lunch.from, lunch.to, dinner.from, dinner.to, lunchHome.from, lunchHome.to, dinnerHome.from, dinnerHome.to], ["12:00", "13:00", "19:00", "20:00", "12:30", "13:30", "19:30", "20:30"]);
  assert.deepEqual(raw.delivery.area, ["Kakkanad", "Edappally", "Infopark"]);
  assert.deepEqual([raw.advance.mode, raw.advance.percent, raw.advance.holdMinutes, raw.orders.maxPerDay, raw.orders.maxItemsPerOrder, raw.cancellation.windowHours, raw.refund.limitInr, raw.owner.approveOverInr], ["part", 50, 30, 8, 10, 6, 300, 1000]);
  assert.equal(raw.payment.module, "upi");

  const table = (l: Language) => section(l, 8).split("\n").filter((x) => /^\s*\|/.test(x)).join("\n");
  const en = table("en");
  for (const words of [
    `Veg thali ${inr(thali.priceInr)}, chicken meal ${inr(chicken.priceInr)}, curd ${inr(curd.priceInr)}.`,
    `${thali.dailyStock} veg thalis, ${chicken.dailyStock} chicken meals and ${curd.dailyStock} curd cups a day.`,
    "20:00 the evening before. For lunch, 09:00 the same day. For dinner, 15:00 the same day.",
    "Pickup: lunch 12:00 to 13:00, dinner 19:00 to 20:00. Delivery: lunch 12:30 to 13:30, dinner 19:30 to 20:30.",
    "Kakkanad, Edappally, Infopark.",
    `Half (${raw.advance.percent}%), and the order is held for ${raw.advance.holdMinutes} minutes.`,
    `At most ${raw.orders.maxPerDay} orders a day and ${raw.orders.maxItemsPerOrder} items in one order.`,
    `Up to ${raw.cancellation.windowHours} hours before the slot. Later, you decide.`,
    `${inr(raw.refund.limitInr)}. A refund is never more than the advance paid.`,
    `${inr(raw.owner.approveOverInr)}. Above that, the order waits for you before any payment is asked.`,
  ]) assert.ok(en.includes(words), `English table: ${words}`);

  // every language has all of them as numbers
  const want = [thali.priceInr, chicken.priceInr, curd.priceInr, thali.dailyStock, chicken.dailyStock, curd.dailyStock, 20, 15, "09", 12, 13, 19, 30, 50, 8, 10, 6, raw.refund.limitInr, raw.owner.approveOverInr].map(String);
  for (const l of LANGUAGES) {
    const found = numbers(table(l));
    for (const n of want) assert.ok(found.has(n), `${l}: the setup table must give ${n}`);
    same(found, numbers(en));
    assert.ok(table(l).includes("Kakkanad, Edappally, Infopark"), `${l}: the delivery area`);
  }
});

// ---- the hand check -----------------------------------------------------------------------------------------------------

test("sell guide: the hand-check numbers in section 11 and on the sheets are the ones a real run gives today", async () => {
  const upi = await runOn(annapurna());
  const uHeld = upi.results.filter((r) => r.held).length;
  const uTotal = upi.results.length;
  const uChecks = upi.results.reduce((n, r) => n + r.checks.length, 0);
  const uNotTested = notTestedOf(annapurna()).length;
  assert.deepEqual([uHeld, uTotal, upi.skipped.length, uChecks, uNotTested], [17, 17, 2, 82, 14], "a situation fails or was added: the guide and the sheets quote these numbers, so change them together");

  const razorpay = await runOn(annapurnaRazorpay());
  const rHeld = razorpay.results.filter((r) => r.held).length;
  const rTotal = razorpay.results.length;
  const rChecks = razorpay.results.reduce((n, r) => n + r.checks.length, 0);
  assert.deepEqual([rHeld, rTotal, razorpay.skipped.length, rChecks, notTestedOf(annapurnaRazorpay()).length], [18, 18, 1, 89, 14]);

  const en = section("en", 11);
  assert.ok(en.includes(`holds ${uHeld} of ${uTotal} situations (${uChecks} checks), with ${uNotTested} listed as not tested and ${upi.skipped.length} not run on those settings`));
  assert.ok(en.includes(`it holds ${rHeld} of ${rTotal} (${rChecks} checks), with ${razorpay.skipped.length} not run on those settings`));
  assert.ok(en.includes("As of 8 November 2026"));
  for (const l of LANGUAGES) {
    const found = numbers(section(l, 11));
    for (const n of [uHeld, uTotal, uChecks, uNotTested, upi.skipped.length, rHeld, rChecks, razorpay.skipped.length]) assert.ok(found.has(String(n)), `${l}: section 11 must give ${n}`);
    assert.ok(numbers(visible(sheet(l))).has(String(uHeld)), `one-pager.${l}.html gives the ${uHeld}`);
  }
  assert.ok(visible(sheet("en")).includes(`${uHeld} of ${uTotal} situations held`));
});

test("sell guide: section 11 lists everything the hand check does not cover, one line each, in every language", () => {
  const all = [...NOT_TESTED, ...UPI_NOT_TESTED];
  assert.equal(new Set(all.map((n) => n.id)).size, all.length);
  for (const l of LANGUAGES) {
    const bullets = section(l, 11).split("\n").filter((x) => /^- /.test(x));
    assert.equal(bullets.length, all.length, `${l}: section 11 lists the ${all.length} lines of crash-test/not-tested.ts (a UPI shop has 14 of them, a Razorpay shop 14)`);
  }
  const en = section("en", 11).toLowerCase();
  for (const word of ["whatsapp", "webhook", "native speaker", "restart", "last portion", "upi app", "pickup or delivery", "made, collected or delivered", "confirmed order"]) assert.ok(en.includes(word), `English section 11 names: ${word}`);
});

// ---- the report's own words ----------------------------------------------------------------------------------------------------

test("sell guide: section 9 and the sheets name the monthly report's lines in the report's own words (a UPI shop's), in each language", () => {
  for (const l of LANGUAGES) {
    const s = STRINGS[l];
    const words = [s.upiLabel.collected, s.label.stillToCollect, s.upiLabel.givenBack, s.label.ordersTaken, s.label.cancelled, s.label.wasAsked, s.label.approved, s.label.saidNo, s.label.stoppedByLimits, s.label.notChecked];
    const nine = section(l, 9);
    for (const w of words) assert.ok(nine.includes(w), `${l}: section 9 must name the report line "${w}"`);
    const html = sheet(l);
    for (const w of [s.upiLabel.collected, s.label.stillToCollect, s.upiLabel.givenBack, s.label.ordersTaken, s.label.cancelled, s.label.wasAsked, s.label.stoppedByLimits, s.label.notChecked]) {
      assert.ok(html.includes(`<li>${w}<span class="num"></span></li>`), `one-pager.${l}.html: the report line "${w}"`);
    }
  }
});

// ---- the machine-written banner, the date ------------------------------------------------------------------------------------

test("sell guide: the Hindi, Malayalam and Kannada guides carry the machine-written banner with the date; the English master does not", () => {
  for (const l of TRANSLATED) {
    const top = guide(l).split("\n").slice(0, 6).join("\n");
    assert.ok(/Machine-written/.test(top), `${l}: banner missing`);
    assert.ok(/native speaker/.test(top), `${l}: banner must say it needs a native speaker's review`);
    assert.ok(top.includes("8 November 2026"), `${l}: banner must carry the date`);
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
    for (const part of [/Machine-written/, /native speaker/, /8 November 2026/]) assert.ok(part.test(comment), `one-pager.${l}.html: the banner comment must say ${part}`);
  }
  assert.ok(!/Machine-written/.test(sheet("en")));
});

// ---- the one-page sheets ---------------------------------------------------------------------------------------------------

test("one-pagers: the not-checked line is dated, says the checks were run by hand, and names what was not checked", () => {
  for (const l of LANGUAGES) {
    const html = sheet(l);
    const line = /<div class="not-checked">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? "";
    assert.ok(line.startsWith(`<b>${STRINGS[l].label.notChecked}</b> (${DATE[l]}): `), `${l}: the line starts with the "Not checked" label and the date`);
    assert.ok(line.includes(STRINGS[l].handRun), `${l}: the line says the checks were run by hand`);
    assert.ok(line.includes("WhatsApp") && line.includes("UPI") && line.includes("17 of 17"), `${l}: the line names real WhatsApp, a real UPI app and the count`);
    assert.equal(line.split(" · ").length, 6, `${l}: six things not checked`);
  }
});

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

test("one-pagers: one example, three things to check, a place for the name and phone, and the not-checked line", async () => {
  for (const l of LANGUAGES) {
    const html = sheet(l);
    const count = (cls: string) => (html.match(new RegExp(`class="[^"]*\\b${cls}\\b[^"]*"`, "g")) ?? []).length;
    const name = `one-pager.${l}.html`;
    assert.equal(count("step"), 4, `${name}: the example is 4 steps`);
    assert.equal(count("promise"), 3, `${name}: three things the owner can check`);
    assert.ok(count("fill") >= 4, `${name}: spaces for the name, the phone and the two prices`);
    assert.equal(count("not-checked"), 1, `${name}: the not-checked line`);
    assert.ok(visible(html).includes(DATE[l]), `${name}: the not-checked line is dated`);
    // the example's two chat bubbles are the product's own words, as the walkthrough prints them: the customer's order and the helper's answer (the UPI link made a placeholder)
    const { steps } = await walk(l);
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    assert.ok(html.includes(`<p class="bubble">${esc(steps[0].lines[0].text)}</p>`), `${name}: the customer's bubble is the walkthrough's order`);
    assert.ok(html.includes(`<p class="bubble helper">${esc(steps[0].lines[1].text.replace(/upi:\/\/\S+/, "[link]"))}</p>`), `${name}: the helper's bubble is the walkthrough's answer`);
    assert.ok(html.includes("Received"), `${name}: the owner's button`);
  }
  assert.ok(visible(sheet("en")).includes("2 × veg thali for Tue 10 Nov, 12:00 pm to 1:00 pm, pickup. Total ₹240. To confirm, pay ₹120 here: [link] (UPI ID annapurna@okicici, Annapurna Tiffins)"));
  const en = sheet("en");
  for (const promise of ["No order is confirmed until you mark the advance received.", "It can't go below your prices or past your stock.", "A refund never goes out on the agent's word."]) assert.ok(en.includes(promise), promise);
});

test("one-pagers: the same layout in every language, and the same amounts and numbers", () => {
  const css = (html: string) => /<style>([\s\S]*?)<\/style>/.exec(html)?.[1];
  assert.ok(css(sheet("en")));
  for (const l of TRANSLATED) {
    assert.equal(css(sheet(l)), css(sheet("en")), `one-pager.${l}.html must use the same CSS as the English`);
    same(rupees(visible(sheet(l))), rupees(visible(sheet("en"))));
    same(numbers(withoutBubbles(sheet(l))), numbers(withoutBubbles(sheet("en"))));
  }
  same(rupees(visible(sheet("en"))), new Set(["₹120", "₹240"]));
});

// ---- the words the guide takes from the product -------------------------------------------------------------------------------

test("sell guide: every guide quotes the owner's replies, STOP and the buttons, as the product says them", () => {
  for (const l of LANGUAGES) {
    const text = guide(l);
    assert.ok(text.includes("approve o-1") && text.includes("deny o-1"), `${l}: the owner's replies`);
    assert.ok(text.includes("STOP"), `${l}: STOP`);
    assert.ok(text.includes('"Received"') && text.includes('"Refund sent"'), `${l}: the owner's two buttons`);
    assert.ok(text.includes("Razorpay") && text.includes("Meta"), `${l}: the platforms are named`);
  }
});
