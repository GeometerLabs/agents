// The four languages: the same sentences in every one, the values filled in as given, the right script, no claim a count cannot back, and the
// REVIEW sheets for Malayalam and Kannada carrying every line.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LANGUAGES } from "../../../modules/language/languages.ts";
import type { Language } from "../../../modules/language/languages.ts";
import { REVIEW_STATE, WORDS, isDraftLanguage } from "../languages.ts";
import { flatWords, panelReviewSection } from "../review.ts";
import { SAMPLE_ARGS } from "../words.ts";

const english = flatWords(WORDS.en);
const BLOCK: Record<string, RegExp> = { hi: /[ऀ-ॿ]/u, ml: /[ഀ-ൿ]/u, kn: /[ಀ-೿]/u };
/** Lines that are the same in every language on purpose: a brand, an address, a number. */
const SAME_ON_PURPOSE = new Set(["appName"]);

test("every language has exactly the sentences English has", () => {
  assert.ok(english.size > 250, `English has ${english.size} lines`);
  for (const l of LANGUAGES) {
    const mine = flatWords(WORDS[l]);
    assert.deepEqual([...mine.keys()].sort(), [...english.keys()].sort(), `${l}: lines missing or extra`);
  }
});

test("a sentence that takes values says them exactly as given: amounts, numbers, names, dates and addresses are never translated", () => {
  for (const l of LANGUAGES) {
    const mine = flatWords(WORDS[l]);
    for (const [path, args] of Object.entries(SAMPLE_ARGS)) {
      const text = mine.get(path);
      assert.ok(text !== undefined, `${l}: ${path} is missing`);
      const en = english.get(path) ?? "";
      for (const a of args) {
        if (typeof a === "boolean" || a === "") continue;
        // A number the English sentence itself turns into another (the Gupshup credential's hours, said as days) is checked as what English
        // shows: every language writes the same figures English does, so a derived "5" is never translated either.
        if (typeof a === "number" && !en.includes(String(a))) {
          const figures = (t: string) => (t.match(/\d[\d,.]*/gu) ?? []).sort();
          assert.ok(figures(en).length > 0, `en: ${path} drops ${a}: it must show it, or a number made from it, but says: ${en}`);
          assert.deepEqual(figures(text), figures(en), `${l}: ${path} must show the figures English shows (${figures(en).join(", ")}), but says: ${text}`);
          continue;
        }
        assert.ok(text.includes(String(a)), `${l}: ${path} must show ${JSON.stringify(a)} as given, but says: ${text}`);
      }
    }
  }
});

test("Hindi, Malayalam and Kannada are written in their own script, and are not English left in place", () => {
  for (const l of ["hi", "ml", "kn"] as const) {
    const mine = flatWords(WORDS[l]);
    const unchanged: string[] = [];
    const noScript: string[] = [];
    for (const [path, text] of mine) {
      if (text === "" || SAME_ON_PURPOSE.has(path)) continue;
      if (text === english.get(path)) unchanged.push(path);
      else if (!BLOCK[l].test(text)) noScript.push(path);
    }
    assert.ok(unchanged.length <= 6, `${l}: still English: ${unchanged.join(", ")}`);
    assert.ok(noScript.length <= 6, `${l}: no ${l} letters in: ${noScript.join(", ")}`);
  }
});

test("only English is the source; the other three carry a review marker, say so on the page, and have a draft note of their own", () => {
  assert.deepEqual(REVIEW_STATE, { en: "source", hi: "machine-written", ml: "machine-written", kn: "machine-written" });
  assert.equal(isDraftLanguage("en"), false);
  assert.equal(WORDS.en.draftNote, "");
  for (const l of ["hi", "ml", "kn"] as const) {
    assert.ok(isDraftLanguage(l));
    assert.ok(BLOCK[l].test(WORDS[l].draftNote), `${l}: the draft note is in ${l}`);
    assert.ok(WORDS[l].languageName.length > 0 && BLOCK[l].test(WORDS[l].languageName), `${l}: the language is named in itself`);
  }
});

test("the words count and state; none of them says a shop is safe, guaranteed or certified", () => {
  for (const [path, text] of english) assert.ok(!/\b(safe|safely|guarantee[ds]?|certified|100%|secure)\b/iu.test(text), `${path}: "${text}"`);
  const limits = [...english].filter(([p]) => p.startsWith("setup.limits."));
  assert.equal(limits.length, 7, "seven limits, each in one sentence");
  for (const l of LANGUAGES) for (const [path, text] of flatWords(WORDS[l])) if (path.startsWith("setup.limits.")) assert.ok(!/[.!?।]\s+\S/u.test(text), `${l}: ${path} is one sentence: ${text}`);
});

test("the benefit lines are the ones in the pricing document, in all four languages", () => {
  const OUT: Record<Language, { price: string; booked: string; language: string; charge: string }> = {
    en: { price: "It can't go below your prices, and it asks you before any refund.", booked: "When it says booked, the slot is in your calendar and the deposit is in your account.", language: "Your customers are answered in their language, with the right price and date.", charge: "You stay in charge from your phone." },
    hi: { price: "यह आपकी कीमतों से कम नहीं जा सकता, और कोई भी रिफंड देने से पहले आपसे पूछता है।", booked: "जब यह \"बुक हो गया\" कहता है, तब स्लॉट आपके कैलेंडर में होता है और डिपॉज़िट आपके खाते में।", language: "आपके ग्राहकों को उनकी भाषा में जवाब मिलता है, सही कीमत और तारीख के साथ।", charge: "आपके फ़ोन से, फ़ैसला हमेशा आपके हाथ में रहता है।" },
    ml: { price: "ഇതിന് നിങ്ങളുടെ വിലയിൽ താഴെ പോകാനാവില്ല, ഏത് റീഫണ്ടിനും മുമ്പ് നിങ്ങളോട് ചോദിക്കും.", booked: "ഇത് \"ബുക്ക് ആയി\" എന്ന് പറയുമ്പോൾ, സ്ലോട്ട് നിങ്ങളുടെ കലണ്ടറിലും ഡെപ്പോസിറ്റ് നിങ്ങളുടെ അക്കൗണ്ടിലും ഉണ്ടാകും.", language: "നിങ്ങളുടെ ഉപഭോക്താക്കൾക്ക് അവരുടെ ഭാഷയിൽ, ശരിയായ വിലയും തീയതിയും സഹിതം മറുപടി കിട്ടും.", charge: "നിങ്ങളുടെ ഫോണിലൂടെ, തീരുമാനം എപ്പോഴും നിങ്ങളുടേതാണ്." },
    kn: { price: "ಇದು ನಿಮ್ಮ ಬೆಲೆಗಿಂತ ಕಡಿಮೆ ಹೋಗಲಾರದು, ಯಾವುದೇ ರೀಫಂಡ್‌ಗೆ ಮೊದಲು ನಿಮ್ಮನ್ನು ಕೇಳುತ್ತದೆ.", booked: "ಇದು \"ಬುಕ್ ಆಯಿತು\" ಎಂದಾಗ, ಸ್ಲಾಟ್ ನಿಮ್ಮ ಕ್ಯಾಲೆಂಡರ್‌ನಲ್ಲಿ ಮತ್ತು ಡೆಪಾಸಿಟ್ ನಿಮ್ಮ ಖಾತೆಯಲ್ಲಿ ಇರುತ್ತದೆ.", language: "ನಿಮ್ಮ ಗ್ರಾಹಕರಿಗೆ ಅವರ ಭಾಷೆಯಲ್ಲಿ, ಸರಿಯಾದ ಬೆಲೆ ಮತ್ತು ದಿನಾಂಕದೊಂದಿಗೆ ಉತ್ತರ ಸಿಗುತ್ತದೆ.", charge: "ನಿಮ್ಮ ಫೋನ್‌ನಿಂದಲೇ, ತೀರ್ಮಾನ ಯಾವಾಗಲೂ ನಿಮ್ಮ ಕೈಯಲ್ಲಿ." },
  };
  for (const l of LANGUAGES) {
    const w = WORDS[l].setup.limits;
    assert.equal(w.price, OUT[l].price, `${l}: price line`);
    assert.equal(w.booked, OUT[l].booked, `${l}: booked line`);
    assert.equal(w.language, OUT[l].language, `${l}: language line`);
    assert.equal(w.charge, OUT[l].charge, `${l}: charge line`);
  }
});

for (const language of ["ml", "kn"] as const) {
  test(`REVIEW-${language}.md carries every line of the panel's ${language} words, as section 7`, () => {
    const committed = readFileSync(new URL(`../../../templates/commerce/bookings/REVIEW-${language}.md`, import.meta.url), "utf8");
    const section = panelReviewSection(language);
    assert.ok(committed.includes("## 7. The panel and the phone setup"), "section 7 is there");
    // Reviewers fill the last column, so compare the cells before it, row by row.
    const cellsOf = (line: string) => line.split(/(?<!\\)\|/u).slice(1, -1).map((c) => c.trim());
    const tail = committed.slice(committed.indexOf("## 7. The panel and the phone setup")).trimEnd().split("\n");
    const wanted = section.trimEnd().split("\n");
    assert.equal(tail.length, wanted.length, "section 7 is a different length: run  node bundle/panel/review-sheet.ts " + language + " > templates/commerce/bookings/REVIEW-" + language + ".md  (and keep any reviewer notes)");
    wanted.forEach((line, i) => {
      if (!line.startsWith("|")) assert.equal(tail[i], line, `line ${i + 1} of section 7`);
      else assert.deepEqual(cellsOf(tail[i]).slice(0, -1), cellsOf(line).slice(0, -1), `line ${i + 1} of section 7`);
    });
  });
}
