// The Bookings sell guide (sell/): a guide and a one-page sheet in every language the pathway speaks, the same 11 sections in
// the same order, the same amounts and numbers everywhere, none of the words the claim rules ban, and the screen words and the
// demo steps it teaches checked against the demo itself. The spec every pathway copies is ../../SELL-GUIDE.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { applyLanguage } from "../demo/personalise.ts";
import { createDemo } from "../demo/session.ts";
import { uiFor } from "../demo/strings.ts";
import { recordRows, summaryLines, waitingCards, workDone } from "../demo/view.ts";
import { bannedIn } from "../../../modules/report/claims.ts";
import { glowSalon } from "../src/harness.ts";
import { hoursOn, validateSettings } from "../src/settings.ts";
import { LANGUAGES } from "../../../modules/language/languages.ts";
import type { Settings } from "../src/settings.ts";
import type { Language } from "../../../modules/language/languages.ts";
import { runOn } from "../crash-test/situations.ts";
import { zonedToMs } from "../../../modules/core/time.ts";

const SELL = new URL("../sell/", import.meta.url);
const SPEC = new URL("../../SELL-GUIDE.md", import.meta.url);
const NOW = zonedToMs({ year: 2026, month: 11, day: 3 }, { hour: 10, minute: 0 }, "Asia/Kolkata"); // Tue 3 Nov, 10:00 in India
const guide = (l: Language) => readFileSync(new URL(`guide.${l}.md`, SELL), "utf8");
const sheet = (l: Language) => readFileSync(new URL(`one-pager.${l}.html`, SELL), "utf8");
const TRANSLATED = LANGUAGES.filter((l) => l !== "en");

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

/** What a section is made of, so a translation cannot quietly drop a row, a step or a checklist item. */
function shape(body: string) {
  const lines = body.split("\n");
  const count = (re: RegExp) => lines.filter((l) => re.test(l)).length;
  return { subheads: count(/^### /), tableRows: count(/^\s*\|/), checklist: count(/^- \[ \] /), steps: count(/^\d+\. /), codeFences: count(/^```/) };
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
const rupees = (text: string) => new Set((text.match(/₹\s?\d[\d,]*/g) ?? []).map((x) => x.replace(/[\s,]/g, "")));
const numbers = (text: string) => new Set((text.match(/\d[\d,]*/g) ?? []).map((x) => x.replace(/,/g, "")));
const same = (a: Set<string>, b: Set<string>) => assert.deepEqual([...a].sort(), [...b].sort());

// ---- the files and the sections ----------------------------------------------------------------------------------------

test("sell guide: every language the pathway speaks has a guide and a one-page sheet", () => {
  assert.ok(LANGUAGES.length >= 4);
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
  const titles = sections(guide("en")).map((s) => [s.n, s.title] as const);
  assert.deepEqual(titles, rows);
});

test("sell guide: every section has the same shape in every language (rows, steps, checklist items)", () => {
  const master = sections(guide("en"));
  for (const l of TRANSLATED) {
    const other = sections(guide(l));
    for (const s of master) assert.deepEqual(shape(other[s.n - 1].body), shape(s.body), `${l}: section ${s.n} does not have the same shape as the English`);
  }
});

test("sell guide: the first three sentences are exactly three, and the checklist has its eight items", () => {
  for (const l of LANGUAGES) {
    const found = sections(guide(l));
    const three = found[2].body.split("\n").filter((x) => /^\d+\. /.test(x));
    assert.equal(three.length, 3, `${l}: section 3 must give exactly three sentences`);
    for (const line of three) {
      assert.ok(/^\d+\. "[^"]+"$/.test(line), `${l}: each sentence is written as a quoted script`);
      assert.ok(!/[.?!।]\s/.test(line.slice(4, -1)), `${l}: each of the three is ONE sentence (join with a comma, not a full stop): ${line}`);
    }
    assert.equal(shape(found[7].body).checklist, 8, `${l}: the setup visit checklist has 8 items`);
    assert.ok(shape(found[6].body).tableRows >= 12, `${l}: the "Never say" table has its rows`);
    assert.ok(shape(found[4].body).subheads >= 8, `${l}: section 5 answers at least the 8 required questions`);
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

// ---- amounts and numbers ------------------------------------------------------------------------------------------------

test("sell guide: the ₹ amounts are the same set in every guide, section by section, and match the plan's figures", () => {
  const en = guide("en");
  // GTM plan, section 2: Geometer's founding fee ₹199 (₹199 to ₹499 later), the shop ₹999 to ₹1,999 a month and ₹1,999 to ₹2,999 setup, WhatsApp ₹100 to ₹300 at cost.
  // The example shop is Glow Salon: haircut ₹450, a customer asking ₹300, deposit and refund limit ₹200, Razorpay's fee on that deposit about ₹5.
  same(rupees(en), new Set(["₹100", "₹199", "₹200", "₹300", "₹450", "₹499", "₹5", "₹999", "₹1999", "₹2999"]));
  for (const l of TRANSLATED) {
    same(rupees(guide(l)), rupees(en));
    const master = sections(en);
    const other = sections(guide(l));
    for (const s of master) same(rupees(other[s.n - 1].body), rupees(s.body));
  }
  for (const l of LANGUAGES) {
    for (const text of [guide(l), visible(sheet(l))]) {
      assert.ok(!/\b(Rs\.?|INR)\s?\d|\d\s?(रुपये|रुपए|रु\.|രൂപ|ರೂಪಾಯಿ|ರೂ\.)/u.test(text), `${l}: write every amount with its own ₹ sign, in Western digits`);
    }
  }
});

test("sell guide: every number is the same in every language", () => {
  for (const l of TRANSLATED) same(numbers(guide(l)), numbers(guide("en")));
});

// ---- the demo the guide teaches -----------------------------------------------------------------------------------------

// What the guide tells a partner to type in Malayalam and Kannada, where the demo's suggestions are in English. When the shop is
// closed tomorrow (Glow Salon: Sundays, so on a Saturday) the guide says to write "the day after tomorrow" instead of "tomorrow".
const TYPED: Partial<Record<Language, { book: string; haggle: string; tomorrow: string; dayAfter: string }>> = {
  ml: { book: "നാളെ വൈകുന്നേരം 6 മണിക്ക് ഹെയർകട്ട് വേണം", haggle: "നാളെ വൈകുന്നേരം 6 മണിക്ക് ഹെയർകട്ട്, ₹300-ന് ചെയ്യാമോ?", tomorrow: "നാളെ", dayAfter: "മറ്റന്നാൾ" },
  kn: { book: "ನಾಳೆ ಸಂಜೆ 6 ಗಂಟೆಗೆ ಹೇರ್ ಕಟ್ ಬೇಕು", haggle: "ನಾಳೆ ಸಂಜೆ 6 ಗಂಟೆಗೆ ಹೇರ್ ಕಟ್ ಬೇಕು, ₹300ಕ್ಕೆ ಮಾಡ್ತೀರಾ?", tomorrow: "ನಾಳೆ", dayAfter: "ನಾಡಿದ್ದು" },
};
const DAY = 24 * 60 * 60 * 1000;

function shop(l: Language) {
  const applied = applyLanguage(glowSalon(), l);
  assert.ok(applied.ok);
  return applied.settings;
}

test("sell guide: the guide quotes the demo's own screen words (the buttons, tabs and owner lines, as each language shows them)", () => {
  for (const l of LANGUAGES) {
    const text = guide(l);
    const ui = uiFor(l);
    const quoted = [ui.banner, ui.tabCustomer, ui.tabOwner, ui.tabRecord, ui.setup, ui.reset, ui.time1d, ui.cancel, ui.showRecord, ui.approve, ui.deny,
      ui.payButton("₹200"), ui.askRefund("₹200"), ui.reasonLate(24), ui.bookingsOk(1), ui.discountRefused([300]), ui.notChecked];
    for (const words of quoted) assert.ok(text.includes(words), `${l}: the guide must quote the demo's words exactly: ${words}`);
    const chips = createDemo(shop(l), NOW).chips().map((c) => c.text);
    const typed = TYPED[l];
    for (const words of typed ? [typed.book, typed.haggle, `"${typed.tomorrow}"`, `"${typed.dayAfter}"`] : [chips[0], chips[1]]) assert.ok(text.includes(words), `${l}: the guide must quote what to tap or type: ${words}`);
  }
});

test("sell guide: the four demo steps the guide teaches do what it says, in every language, whatever day of the week the partner starts", async () => {
  for (let k = 0; k < 7; k++) { // the demo clock starts on the real date: Glow Salon is closed on Sundays, so a Saturday is different
    const start = NOW + k * DAY;
    for (const l of LANGUAGES) {
      const ui = uiFor(l);
      const settings = shop(l);
      const typed = TYPED[l];
      const where = `${l}, start day +${k}`;
      const tomorrow = new Date(start + DAY).toLocaleDateString("en-US", { weekday: "short", timeZone: settings.timezone });
      const closedTomorrow = hoursOn(settings, ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(tomorrow)) === null;
      const say = (text: string) => (typed && closedTomorrow ? text.replace(typed.tomorrow, typed.dayAfter) : text); // the guide's rule for the sentences you type
      const chips = createDemo(settings, start).chips().map((c) => c.text);
      const book = say(typed?.book ?? chips[0]);
      const haggle = say(typed?.haggle ?? chips[1]);

      // 1. A customer books and pays a test deposit.
      let demo = createDemo(settings, start);
      await demo.say(book);
      assert.ok(demo.payTarget(), `${where}: a deposit link is waiting`);
      await demo.pay(1);
      assert.ok(summaryLines(demo).some((x) => x.text === ui.bookingsOk(1)), `${where}: the owner sees the booking is in the calendar`);

      // 2. The customer haggles and is refused.
      demo = createDemo(settings, start); // "Start again"
      await demo.say(haggle);
      assert.ok(demo.customerLog.some((b) => b.who === "agent" && b.text.includes("₹450")), `${where}: the agent states the real price`);
      assert.ok(summaryLines(demo).some((x) => x.text === ui.discountRefused([300])), `${where}: the owner sees it said no to ₹300`);

      // 3. A refund it can't give alone asks the owner. The guide: tap "1 day passes" again if the booking is still more than a day away.
      demo = createDemo(settings, start);
      await demo.say(book);
      await demo.pay(1);
      let taps = 0;
      const booking = () => [...demo.world.store.bookings.values()].at(-1)!;
      do { await demo.advance(1440); taps++; } while (booking().startMs - demo.world.clock.now() >= DAY && taps < 5);
      assert.ok(taps <= 2, `${where}: it never takes more than two taps of "1 day passes" (the guide says two on a Saturday)`);
      await demo.cancel(); // "Cancel the booking"
      const cards = waitingCards(demo);
      assert.equal(cards.length, 1, `${where}: one question is waiting`);
      assert.equal(cards[0].title, ui.askRefund("₹200"));
      assert.equal(cards[0].reason, ui.reasonLate(24));
      assert.deepEqual(cards[0].buttons.map((b) => b.label), [ui.approve, ui.deny]);
      await demo.owner("approve", cards[0].ref); // the owner taps "Approve"
      assert.equal(waitingCards(demo).length, 0);

      // 4. "Show what we did": the record and the work-done line are there.
      assert.ok(recordRows(demo).length > 0);
      assert.ok(workDone(demo).length > 0);
    }
  }
});

test("sell guide: the demo command in the guide is a real one", () => {
  const server = readFileSync(new URL("../demo/server.ts", import.meta.url), "utf8");
  assert.ok(server.includes('"--lang"'));
  for (const l of LANGUAGES) {
    assert.ok(guide(l).includes("node pathways/bookings/demo/server.ts"), `${l}: the guide gives the command`);
    assert.ok(guide(l).includes("--lang"), `${l}: the guide shows how to start the demo in the owner's language`);
    assert.ok(/http:\/\/192\.168\.\d+\.\d+:8787/.test(guide(l)), `${l}: the guide shows what the Wi-Fi address looks like`);
  }
  assert.ok(existsSync(new URL("../demo/server.ts", import.meta.url)));
});

// ---- the banner on machine-written translations ---------------------------------------------------------------------------

test("sell guide: the Hindi, Malayalam and Kannada guides carry the machine-written banner with the date; the English master does not", () => {
  for (const l of TRANSLATED) {
    const top = guide(l).split("\n").slice(0, 6).join("\n");
    assert.ok(/Machine-written/.test(top), `${l}: banner missing`);
    assert.ok(/native speaker/.test(top), `${l}: banner must say it needs a native speaker's review`);
    assert.ok(/3 November 2026/.test(top), `${l}: banner must carry the date`);
  }
  assert.ok(!/Machine-written/.test(guide("en").split("\n").slice(0, 6).join("\n")));
});

test("one-pagers: the Hindi, Malayalam and Kannada sheets carry the same banner as an HTML comment (not printed on the owner's copy); the English does not", () => {
  for (const l of TRANSLATED) {
    const comment = /<!--([\s\S]*?)-->/.exec(sheet(l).slice(0, 400))?.[1] ?? "";
    for (const part of [/Machine-written/, /native speaker/, /3 November 2026/]) assert.ok(part.test(comment), `one-pager.${l}.html: the banner comment must say ${part}`);
  }
  assert.ok(!/Machine-written/.test(sheet("en")));
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
    assert.ok(/3 November 2026|3 नवंबर 2026|3 നവംബർ 2026|3 ನವೆಂಬರ್ 2026/.test(html), `${name}: the not-checked line is dated`);
  }
  const en = sheet("en");
  for (const promise of ["It can't go below your prices.", "It asks you before any refund over your limit.", "Every month you see what it did, including mistakes."]) assert.ok(en.includes(promise), promise);
});

test("one-pagers: the same layout in every language, and the same amounts and numbers", () => {
  const css = (html: string) => /<style>([\s\S]*?)<\/style>/.exec(html)?.[1];
  assert.ok(css(sheet("en")));
  for (const l of TRANSLATED) {
    assert.equal(css(sheet(l)), css(sheet("en")), `one-pager.${l}.html must use the same CSS as the English`);
    same(rupees(visible(sheet(l))), rupees(visible(sheet("en"))));
    same(numbers(visible(sheet(l))), numbers(visible(sheet("en"))));
  }
  same(rupees(visible(sheet("en"))), new Set(["₹200", "₹300", "₹450"]));
});

// ---- variants: a guide that changes only what differs (../../SELL-GUIDE.md, "Variants") --------------------------------------
// The equipment-rental variant of the Bookings guide: sell/variants/equipment-rental.<lang>.md. It keeps the main guide's section
// numbers, covers only the sections that differ, points to the main guide for the rest, and is held to the same rules.

const VARIANT_SECTIONS_ALLOWED = [1, 3, 4, 5, 6, 7, 8, 11];
const VARIANT_SECTIONS_REQUIRED = [1, 3, 4, 5, 6, 8];
const variant = (l: Language) => readFileSync(new URL(`variants/equipment-rental.${l}.md`, SELL), "utf8");
const RENTAL_FILE = "pathways/bookings/settings/equipment-rental.example.json";
const rentalSettings = () => {
  const result = validateSettings(JSON.parse(readFileSync(new URL("../settings/equipment-rental.example.json", import.meta.url), "utf8")));
  assert.ok(result.ok);
  return result.settings;
};

test("variant guide: every language has the equipment-rental variant, and it points to the main guide in its own language", () => {
  for (const l of LANGUAGES) {
    assert.ok(existsSync(new URL(`variants/equipment-rental.${l}.md`, SELL)), `variants/equipment-rental.${l}.md is missing`);
    assert.ok(variant(l).length > 3000, `${l}: the variant is almost empty`);
    assert.ok(variant(l).includes(`(../guide.${l}.md)`), `${l}: the variant must link to the main guide it changes`);
    assert.ok(existsSync(new URL(`guide.${l}.md`, SELL)));
  }
});

test("variant guide: only sections that differ, with the main guide's numbers, the same in every language, and nothing empty", () => {
  const master = sections(variant("en")).map((s) => s.n);
  for (const n of VARIANT_SECTIONS_REQUIRED) assert.ok(master.includes(n), `section ${n} is required`);
  assert.deepEqual(master, [...master].sort((a, b) => a - b), "the sections are out of order");
  for (const n of master) assert.ok(VARIANT_SECTIONS_ALLOWED.includes(n), `section ${n} is not a section a variant restates`);
  for (const l of LANGUAGES) {
    const found = sections(variant(l));
    assert.deepEqual(found.map((s) => s.n), master, `${l}: a different set of sections from the English`);
    for (const s of found) assert.ok(s.body.trim().length > 40, `${l}: section ${s.n} is empty`);
  }
});

test("variant guide: every section has the same shape in every language (rows, steps, checklist items, code blocks)", () => {
  const master = sections(variant("en"));
  for (const l of TRANSLATED) {
    const other = sections(variant(l));
    master.forEach((s, i) => assert.deepEqual(shape(other[i].body), shape(s.body), `${l}: section ${s.n} does not have the same shape as the English`));
  }
});

test("variant guide: the first three sentences are exactly three, each one sentence; the setup checklist and the questions are there", () => {
  for (const l of LANGUAGES) {
    const found = sections(variant(l));
    const by = (n: number) => found.find((s) => s.n === n)!;
    const three = by(3).body.split("\n").filter((x) => /^\d+\. /.test(x));
    assert.equal(three.length, 3, `${l}: section 3 must give exactly three sentences`);
    for (const line of three) {
      assert.ok(/^\d+\. "[^"]+"$/.test(line), `${l}: each sentence is written as a quoted script`);
      assert.ok(!/[.?!।]\s/.test(line.slice(4, -1)), `${l}: each of the three is ONE sentence: ${line}`);
    }
    assert.ok(shape(by(8).body).checklist >= 6, `${l}: the rental setup checklist has its items`);
    assert.ok(shape(by(5).body).subheads >= 7, `${l}: section 5 answers the rental questions`);
    assert.ok(shape(by(7).body).tableRows >= 6, `${l}: the "Never say" rows for rental`);
    assert.equal(shape(by(4).body).tableRows, 6, `${l}: the demo table has its four steps`);
  }
});

test("variant guide: no banned word in any language (the Never say column is the one place that quotes them)", () => {
  assert.ok(banned(variant("en")).length > 0, "the English variant quotes a banned phrase in section 7, so the skip is in use");
  for (const l of LANGUAGES) assert.deepEqual(banned(checked(variant(l))), [], `variants/equipment-rental.${l}.md`);
});

test("variant guide: the ₹ amounts are the same set in every language, section by section, and are the ones the shop and the plan give", () => {
  const en = variant("en");
  // The GTM figures the main guide uses (₹199, ₹999 to ₹1,999, ₹1,999 to ₹2,999), the example shop's price ₹3,200, deposit and refund limit ₹1,000,
  // the demo's haggle ₹2,130, and Razorpay's fee on a ₹1,000 deposit, about ₹24.
  same(rupees(en), new Set(["₹24", "₹199", "₹999", "₹1000", "₹1999", "₹2130", "₹2999", "₹3200"]));
  for (const l of TRANSLATED) {
    same(rupees(variant(l)), rupees(en));
    const master = sections(en);
    const other = sections(variant(l));
    master.forEach((s, i) => same(rupees(other[i].body), rupees(s.body)));
  }
  for (const l of LANGUAGES) assert.ok(!/\b(Rs\.?|INR)\s?\d|\d\s?(रुपये|रुपए|रु\.|രൂപ|ರೂಪಾಯಿ|ರೂ\.)/u.test(variant(l)), `${l}: write every amount with its own ₹ sign, in Western digits`);
});

test("variant guide: every number is the same in every language", () => {
  for (const l of TRANSLATED) same(numbers(variant(l)), numbers(variant("en")));
});

test("variant guide: the Hindi, Malayalam and Kannada variants carry the machine-written banner with the date; the English does not", () => {
  for (const l of TRANSLATED) {
    const top = variant(l).split("\n").slice(0, 6).join("\n");
    assert.ok(/Machine-written/.test(top), `${l}: banner missing`);
    assert.ok(/native speaker/.test(top), `${l}: banner must say it needs a native speaker's review`);
    assert.ok(/3 November 2026/.test(top), `${l}: banner must carry the date`);
  }
  assert.ok(!/Machine-written/.test(variant("en").split("\n").slice(0, 6).join("\n")));
});

test("variant guide: what it says about the example shop and the check is what the settings and the hand check say today", async () => {
  const shop = rentalSettings();
  const run = await runOn(shop);
  assert.deepEqual([run.results.filter((r) => r.held).length, run.results.length, run.skipped.length], [33, 33, 0]);
  assert.deepEqual(run.results.filter((r) => r.situation.leftOut).map((r) => r.situation.id), ["outside-hours"]);
  const [job] = shop.services;
  assert.deepEqual([job.priceInr, shop.deposit.amountInr, shop.cancellation.refundLimitInr, shop.deposit.holdMinutes, shop.cancellation.windowHours, shop.slotMinutes], [3200, 1000, 1000, 30, 24, 120]);
  assert.equal(Math.max(...shop.services.map((s) => s.durationMinutes)), 8 * 60, "the longest job is 8 hours");
  assert.deepEqual(shop.reminders.hoursBefore, [24]);
  assert.ok(WEEKDAYS_ALL_OPEN(shop), "the example is open every day, which is why the closed-day request is left out");
  assert.ok(variant("en").includes(`${run.results.length} of ${run.results.length} situations held`));
  // the same count is quoted in two READMEs: they must not drift from the real run either
  for (const readme of ["../../../README.md", "../README.md"]) {
    assert.ok(readFileSync(new URL(readme, import.meta.url), "utf8").includes(`${run.results.length} of ${run.results.length} situations`), `${readme} quotes the example's count`);
  }
  for (const l of LANGUAGES) {
    const text = variant(l);
    assert.ok(text.includes(RENTAL_FILE) && existsSync(new URL(`../${RENTAL_FILE.replace("pathways/bookings/", "")}`, import.meta.url)), `${l}: the example file it names exists`);
    assert.ok(text.includes("hand-check.ts --settings"), `${l}: the check on the shop's own settings is the real command`);
    assert.ok(text.includes(String(run.results.length)), `${l}: the count`);
  }
  const server = readFileSync(new URL("../demo/server.ts", import.meta.url), "utf8");
  assert.ok(server.includes('"--settings"') && server.includes('"--lang"'));
  const handCheck = readFileSync(new URL("../scripts/hand-check.ts", import.meta.url), "utf8");
  assert.ok(handCheck.includes("settings: { type: \"string\" }"));
});

const WEEKDAYS_ALL_OPEN = (s: Settings) => [0, 1, 2, 3, 4, 5, 6].every((d) => hoursOn(s, d) !== null);

// What the variant tells a partner to type in Kannada, where the demo's suggestions are in English with the machine's name in Kannada.
const RENTAL_TYPED_KN = {
  book: "ನಾಳೆ ಮಧ್ಯಾಹ್ನ 12 ಗಂಟೆಗೆ ರೋಟಾವೇಟರ್ ಟ್ರ್ಯಾಕ್ಟರ್ ಅರ್ಧ ದಿನ ಬೇಕು",
  haggle: "ನಾಳೆ ಮಧ್ಯಾಹ್ನ 12 ಗಂಟೆಗೆ ರೋಟಾವೇಟರ್ ಟ್ರ್ಯಾಕ್ಟರ್ ಅರ್ಧ ದಿನ, ₹2130ಕ್ಕೆ ಮಾಡ್ತೀರಾ?",
};

test("variant guide: the variant quotes the demo's own screen words and suggestions, as the demo shows them for the example shop", () => {
  for (const l of LANGUAGES) {
    const demoLanguage: Language = l === "hi" ? "hi" : "kn"; // the example speaks Kannada and Hindi: those are the two demos
    const ui = uiFor(demoLanguage);
    const text = variant(l);
    const quoted = [ui.tabCustomer, ui.tabOwner, ui.tabRecord, ui.setup, ui.reset, ui.time1d, ui.cancel, ui.showRecord, ui.approve, ui.deny,
      ui.payButton("₹1,000"), ui.askRefund("₹1,000"), ui.reasonLate(24), ui.bookingsOk(1), ui.discountRefused([2130]), ui.banner];
    for (const words of quoted) assert.ok(text.includes(words), `${l}: the variant must quote the demo's words exactly: ${words}`);
  }
  const hindi = applyLanguage(rentalSettings(), "hi");
  assert.ok(hindi.ok);
  const chips = createDemo(hindi.settings, NOW).chips().map((c) => c.text);
  assert.ok(variant("hi").includes(chips[0]) && variant("hi").includes(chips[1]), "the Hindi variant quotes the demo's first two suggestions");
  assert.ok(variant("kn").includes(RENTAL_TYPED_KN.book) && variant("kn").includes(RENTAL_TYPED_KN.haggle), "the Kannada variant quotes the sentences to type");
});

test("variant guide: the four demo steps it teaches do what it says on the example shop, in Hindi and in Kannada, whatever day the partner starts", async () => {
  for (let k = 0; k < 7; k++) {
    const start = NOW + k * DAY;
    for (const demoLanguage of ["hi", "kn"] as const) {
      const applied = applyLanguage(rentalSettings(), demoLanguage);
      assert.ok(applied.ok);
      const settings = applied.settings;
      const ui = uiFor(demoLanguage);
      const where = `${demoLanguage}, start day +${k}`;
      const chips = createDemo(settings, start).chips().map((c) => c.text);
      const book = demoLanguage === "kn" ? RENTAL_TYPED_KN.book : chips[0];
      const haggle = demoLanguage === "kn" ? RENTAL_TYPED_KN.haggle : chips[1];
      assert.ok(chips[1].includes("2130"), `${where}: the demo's own haggle is ₹2130, the figure the variant quotes`);

      let demo = createDemo(settings, start);
      await demo.say(book);
      assert.ok(demo.payTarget(), `${where}: a deposit link is waiting`);
      await demo.pay(1);
      assert.ok(summaryLines(demo).some((x) => x.text === ui.bookingsOk(1)), `${where}: the owner sees the booking is in the calendar`);

      demo = createDemo(settings, start);
      await demo.say(haggle);
      assert.ok(demo.customerLog.some((b) => b.who === "agent" && b.text.includes("₹3,200")), `${where}: the agent states the real price`);
      assert.ok(summaryLines(demo).some((x) => x.text === ui.discountRefused([2130])), `${where}: the owner sees it said no to ₹2,130`);

      demo = createDemo(settings, start);
      await demo.say(book);
      await demo.pay(1);
      await demo.advance(1440); // "1 day passes", once
      const booking = [...demo.world.store.bookings.values()].at(-1)!;
      assert.ok(booking.startMs - demo.world.clock.now() < DAY, `${where}: one tap of "1 day passes" is enough, as the variant says`);
      await demo.cancel();
      const cards = waitingCards(demo);
      assert.equal(cards.length, 1, `${where}: one question is waiting`);
      assert.equal(cards[0].title, ui.askRefund("₹1,000"));
      assert.equal(cards[0].reason, ui.reasonLate(24));
      assert.deepEqual(cards[0].buttons.map((b) => b.label), [ui.approve, ui.deny]);
      await demo.owner("approve", cards[0].ref);
      assert.equal(waitingCards(demo).length, 0);
      assert.ok(recordRows(demo).length > 0 && workDone(demo).length > 0);
    }
  }
});
