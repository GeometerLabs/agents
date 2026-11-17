// The Stock orders sell guide (sell/): a guide and a one-page sheet in English, Hindi, Malayalam and Kannada. A smaller cousin of Orders' sell-guide test: it checks that every
// file is there and made from its source and the price list in force, that the same 11 sections and the same amounts are in every language, that no banned word or emoji is in
// any of them, that the one claim about money is word for word in all four, and that the machine-written banner is where the rules put it (a heading note in a guide, an HTML
// comment in a sheet so the owner's printed copy stays clean). It does not drive a demo: the walkthrough in section 4 is tested by the agent's own tests. The spec is ../../../SELL-GUIDE.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { bannedIn } from "../../../../modules/report/claims.ts";
import { LANGUAGES } from "../../../../modules/language/languages.ts";
import type { Language } from "../../../../modules/language/languages.ts";
import { stale } from "../../../../prices/render.ts";

const SELL = new URL("../sell/", import.meta.url);
const guide = (l: Language) => readFileSync(new URL(`guide.${l}.md`, SELL), "utf8");
const sheet = (l: Language) => readFileSync(new URL(`one-pager.${l}.html`, SELL), "utf8");
const TRANSLATED = LANGUAGES.filter((l) => l !== "en");

/** The one claim about money, word for word, in each language. */
const CLAIM: Record<Language, string> = {
  en: "No order goes to a supplier without your yes, and it is always the exact order you saw.",
  hi: "आपकी हाँ के बिना कोई ऑर्डर सप्लायर के पास नहीं जाता, और वह हमेशा वही ऑर्डर होता है जो आपने देखा।",
  ml: "നിങ്ങളുടെ അനുമതി ഇല്ലാതെ ഒരു ഓർഡറും വിതരണക്കാരന് പോകില്ല, പോകുന്നത് എപ്പോഴും നിങ്ങൾ കണ്ട അതേ ഓർഡർ തന്നെയാണ്.",
  kn: "ನಿಮ್ಮ ಒಪ್ಪಿಗೆ ಇಲ್ಲದೆ ಯಾವ ಆರ್ಡರ್ ಕೂಡ ಪೂರೈಕೆದಾರರಿಗೆ ಹೋಗುವುದಿಲ್ಲ, ಮತ್ತು ಅದು ಯಾವಾಗಲೂ ನೀವು ನೋಡಿದ ಅದೇ ಆರ್ಡರ್.",
};
/** The date the guide and the sheets are written for, in each language. It changes whenever the status in section 11 changes. */
const DATE: Record<Language, string> = { en: "17 November 2026", hi: "17 नवंबर 2026", ml: "17 നവംബർ 2026", kn: "17 ನವೆಂಬರ್ 2026" };

/** Words this brief bans on top of the report's lists (the report's BANNED already holds safe, guarantee, certified, earn, income in every language). */
const EXTRA_BANNED = [/\bproves?\b/i, /\bbots?\b/i, /founder/i, /founding/i, /100 ?%/];
const extraBanned = (text: string): string[] => EXTRA_BANNED.filter((re) => re.test(text)).map((re) => re.source);
/** Banned words from every language's list, whatever language the file is in. */
const banned = (text: string): string[] => [...new Set(LANGUAGES.flatMap((l) => bannedIn(text, l)))];
/** A sheet as the owner reads it: no style block, no comment. */
const visible = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<!--[\s\S]*?-->/g, "");
const rupees = (text: string) => [...new Set((text.match(/₹\s?\d[\d,]*/g) ?? []).map((x) => x.replace(/[\s,]/g, "")))].sort();

/** The numbered `## N. Title` sections (a `#` line inside a code block is not a heading). */
function sections(text: string): { n: number; body: string }[] {
  const out: { n: number; body: string }[] = [];
  let fence = false;
  for (const line of text.split("\n")) {
    if (line.startsWith("```")) fence = !fence;
    const m = fence ? null : /^## (\d+)\. /.exec(line);
    if (m) out.push({ n: Number(m[1]), body: "" });
    else if (out.length > 0) out[out.length - 1].body += `${line}\n`;
  }
  return out;
}

test("sell guide: every language has a guide and a one-page sheet, each made from its source and the price list in force", () => {
  assert.ok(LANGUAGES.length >= 4);
  for (const l of LANGUAGES) {
    for (const name of [`guide.${l}.md`, `guide.${l}.src.md`, `one-pager.${l}.html`]) {
      assert.ok(existsSync(new URL(name, SELL)), `sell/${name} is missing: a template is not ready to sell until its guide is`);
      assert.ok(readFileSync(new URL(name, SELL), "utf8").length > 1000, `sell/${name} is almost empty`);
    }
    assert.ok(!guide(l).includes("{{"), `guide.${l}.md still has a placeholder`);
  }
  // Not stale against the .src.md and the price list in force: run `node prices/render.ts` to make them again.
  assert.deepEqual(stale().filter((f) => f.startsWith("templates/commerce/stock-orders/")), []);
});

test("sell guide: the 11 numbered sections are there, in order, in every guide, with the same steps, rows and the same amounts", () => {
  const en = sections(guide("en"));
  assert.deepEqual(en.map((s) => s.n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  const count = (body: string, re: RegExp) => (body.match(re) ?? []).length;
  for (const l of TRANSLATED) {
    const found = sections(guide(l));
    assert.deepEqual(found.map((s) => s.n), en.map((s) => s.n), `${l}: the sections`);
    found.forEach((s, i) => {
      assert.equal(count(s.body, /^\d+\. /gm), count(en[i].body, /^\d+\. /gm), `${l}: section ${s.n} has the same numbered items`);
      assert.equal(count(s.body, /^\|/gm), count(en[i].body, /^\|/gm), `${l}: section ${s.n} has the same table rows`);
      assert.equal(count(s.body, /^### /gm), count(en[i].body, /^### /gm), `${l}: section ${s.n} has the same sub-headings`);
    });
    assert.deepEqual(rupees(guide(l)), rupees(guide("en")), `${l}: the same ₹ amounts as the English`);
  }
});

test("sell guide: no emoji anywhere", () => {
  for (const l of LANGUAGES) {
    assert.ok(!/\p{Extended_Pictographic}/u.test(guide(l)), `guide.${l}.md`);
    assert.ok(!/\p{Extended_Pictographic}/u.test(sheet(l)), `one-pager.${l}.html`);
  }
});

test("sell guide: no banned word in any guide or sheet, in any language", () => {
  // The check itself finds the words, in each script.
  assert.deepEqual(banned("It is safe and guaranteed."), ["\\bsafe", "guarant"]);
  for (const word of ["यह सुरक्षित है", "ഇത് സുരക്ഷിതമാണ്", "ಇದು ಸುರಕ್ಷಿತ"]) assert.equal(banned(word).length, 1, word);
  assert.deepEqual(extraBanned("it proves a bot by the founder, 100%"), ["\\bproves?\\b", "\\bbots?\\b", "founder", "100 ?%"]);
  for (const l of LANGUAGES) {
    for (const [name, text] of [[`guide.${l}.md`, guide(l)], [`one-pager.${l}.html`, visible(sheet(l))]] as const) {
      assert.deepEqual(banned(text), [], name);
      assert.deepEqual(extraBanned(text), [], `${name} (the words this brief bans)`);
    }
  }
});

test("sell guide: the one claim about money is word for word in every guide and every sheet, and the English calls the local person the Operator", () => {
  for (const l of LANGUAGES) {
    assert.ok(guide(l).includes(CLAIM[l]), `${l}: the guide carries the claim`);
    assert.ok(visible(sheet(l)).includes(CLAIM[l]), `${l}: the sheet carries the claim`);
  }
  assert.ok(guide("en").includes("Operator"), "the English guide calls the local person the Operator");
});

test("sell guide: the guides and sheets are dated 17 November 2026 and say it is not live anywhere", () => {
  for (const l of LANGUAGES) {
    assert.ok(guide(l).split("\n").slice(0, 12).join("\n").includes(DATE[l]), `${l}: the opening lines say when the guide was written`);
    assert.ok(sections(guide(l))[10].body.includes(DATE[l]), `${l}: section 11 is dated ${DATE[l]}`);
    assert.ok(visible(sheet(l)).includes(DATE[l]), `${l}: the sheet's not-checked line is dated ${DATE[l]}`);
    assert.ok(/checks were run by hand|हाथ से की गई|കൈകൊണ്ട് ചെയ്തു|ಕೈಯಿಂದ ಮಾಡಲಾಯಿತು/.test(visible(sheet(l))), `${l}: the sheet says the checks were run by hand`);
  }
});

test("sell guide: the Hindi, Malayalam and Kannada guides carry the machine-written banner with the date; the English master does not", () => {
  for (const l of TRANSLATED) {
    const top = guide(l).split("\n").slice(0, 6).join("\n");
    assert.ok(/Machine-written/.test(top), `${l}: banner missing`);
    assert.ok(/native speaker/.test(top), `${l}: banner must say it needs a native speaker's review`);
    assert.ok(top.includes("17 November 2026"), `${l}: banner must carry the date`);
  }
  assert.ok(!/Machine-written/.test(guide("en").split("\n").slice(0, 6).join("\n")));
});

test("one-pagers: the Hindi, Malayalam and Kannada sheets carry the same banner as an HTML comment (not printed on the owner's copy); the English does not", () => {
  for (const l of TRANSLATED) {
    const comment = /<!--([\s\S]*?)-->/.exec(sheet(l).slice(0, 400))?.[1] ?? "";
    for (const part of [/Machine-written/, /native speaker/, /17 November 2026/]) assert.ok(part.test(comment), `one-pager.${l}.html: the banner comment must say ${part}`);
    assert.ok(!/Machine-written/.test(visible(sheet(l))), `one-pager.${l}.html: the banner is not printed`);
  }
  assert.ok(!/Machine-written/.test(sheet("en")));
});

test("one-pagers: self-contained (no script, address, font, image or style sheet), the same layout and the same amounts in every language", () => {
  const css = (html: string) => /<style>([\s\S]*?)<\/style>/.exec(html)?.[1];
  assert.ok(css(sheet("en")));
  for (const l of LANGUAGES) {
    const html = sheet(l);
    assert.ok(!/<script|https?:\/\/|<img|<link|@import|@font-face|url\(/i.test(html), `one-pager.${l}.html pulls in something from outside`);
    assert.ok(html.startsWith("<!doctype html>"), `one-pager.${l}.html has a doctype`);
    assert.ok(html.includes(`<html lang="${l}">`), `one-pager.${l}.html names its language`);
    assert.equal(css(html), css(sheet("en")), `one-pager.${l}.html must use the same CSS as the English`);
    assert.equal((html.match(/<li class="promise">/g) ?? []).length, 3, `one-pager.${l}.html: three things to check`);
    assert.equal((html.match(/<li class="step">/g) ?? []).length, 4, `one-pager.${l}.html: one example of four steps`);
    assert.ok(html.includes('<span class="fill">'), `one-pager.${l}.html: a place for the name and phone`);
    assert.deepEqual(rupees(visible(html)), ["₹450", "₹4500"], `one-pager.${l}.html: only the example shop's amounts, no price typed by hand`);
  }
});
