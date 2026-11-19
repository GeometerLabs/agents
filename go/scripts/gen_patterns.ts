// Writes internal/language/patterns.json: the regular expressions the Go runtime reads the owner's words with, as the TypeScript BUILT them (each RegExp's own `.source` and
// `.flags`, so the template literals, the word lists, the longest-first sorting and the Malayalam and Kannada stems are evaluated by the real TypeScript, never retyped), and
// internal/language/testdata/pattern-vectors.json: what JavaScript finds with each of them in a corpus of phrases, for the Go matcher (internal/language/regex.go) to be proved
// equal on. Run with node from the repository root:   node go/scripts/gen_patterns.ts          (add --check to only compare with the committed files)
//
// Why: the TypeScript patterns lean on look-behind and look-ahead to find a whole word in Indian scripts, which Go's RE2 has neither of. The Go side splits each source at its
// top-level `|` and checks the edges by hand (regex.go), so `matchAll` and `replace` give what JavaScript gives ("ten twenty" is two matches, not one). The test `words-fresh`
// (templates/commerce/listings/contract/words-fresh.test.ts) fails when a committed file is out of date with the TypeScript.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DAY_AFTER_RE, MONTH_RES, NEXT_RE, THIS_RE, TODAY_RE, TOMORROW_RE, WEEKDAY_RES, YESTERDAY_RE } from "../../modules/language/dates.ts";
import { GUEST_WORDS, KIND_RES, REF_RE } from "../../modules/assistant/intents.ts";
import { COMPLETION, LINK as TALK_LINK, LONG_DIGITS, NUMBER_WORDS, PERCENT } from "../../modules/assistant/talk-check.ts";
import { AMOUNT_RE, DATE_RE, QUANTITY_STEM_RE, QUANTITY_WORD_RE, TIME_RE, TRAILING_PUNCTUATION, UPI_RE, URL_RE } from "../../modules/language/check.ts";
import { FOR_CUSTOMERS, GOAL_WORDS, INSTRUCTION_WORDS } from "../../modules/assistant/notes.ts";
import { EMAIL, LINK, NAME_AFTER_INTRO, PHONE, SURNAME } from "../../modules/understanding/redact.ts";
import { canon } from "../../modules/language/format.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const OUT = join(here, "..", "internal", "language");

/** Every pattern the Go runtime matches, by name: the TypeScript's own RegExp objects. */
function patterns(): Map<string, RegExp> {
  const p = new Map<string, RegExp>();
  WEEKDAY_RES.forEach((re, d) => p.set(`dates.weekday.${d}`, re)); // 0 = Sunday
  MONTH_RES.forEach((re, m) => p.set(`dates.month.${m + 1}`, re));
  p.set("dates.day_after", DAY_AFTER_RE).set("dates.tomorrow", TOMORROW_RE).set("dates.today", TODAY_RE).set("dates.yesterday", YESTERDAY_RE);
  p.set("dates.next", NEXT_RE).set("dates.this", THIS_RE);
  for (const [kind, re] of KIND_RES) p.set(`intents.kind.${kind}`, re);
  p.set("intents.ref", REF_RE).set("intents.guest", GUEST_WORDS);
  p.set("talk.number_words", NUMBER_WORDS).set("talk.completion", COMPLETION).set("talk.percent", PERCENT).set("talk.link", TALK_LINK).set("talk.long_digits", LONG_DIGITS);
  p.set("check.date", DATE_RE).set("check.time", TIME_RE).set("check.trailing", TRAILING_PUNCTUATION).set("check.url", URL_RE).set("check.upi", UPI_RE).set("check.amount", AMOUNT_RE);
  p.set("check.quantity_word", QUANTITY_WORD_RE).set("check.quantity_stem", QUANTITY_STEM_RE);
  p.set("notes.for_customers", FOR_CUSTOMERS).set("notes.goal", GOAL_WORDS).set("notes.instruction", INSTRUCTION_WORDS);
  p.set("redact.email", EMAIL).set("redact.link", LINK).set("redact.phone", PHONE).set("redact.name", NAME_AFTER_INTRO);
  // SURNAME is sticky (/y: it must match where the name ended): handed over as the same source anchored at the start, which is what sticky means for one exec
  p.set("redact.surname", new RegExp(`^(?:${SURNAME.source})`, SURNAME.flags.replace("y", "")));
  return p;
}

/** The pack: each pattern's source and flags, and the order the owner's kinds are tried in (intents.ts KIND_RES). */
function pack(): string {
  const out: Record<string, { source: string; flags: string }> = {};
  for (const [name, re] of patterns()) out[name] = { source: re.source, flags: re.flags };
  return JSON.stringify({ kinds: KIND_RES.map(([k]) => k), patterns: out }, null, 1) + "\n";
}

// ---- the vectors ---------------------------------------------------------------------------------------------------------------------------------------------

/** Phrases every pattern is run over: each kind and date word in four languages, words glued to other letters, and the cases where a match next to a match matters. */
const CORPUS = [
  "ten twenty", "ten, twenty and thirty", "tenth", "often ten", "half-price", "twenty-ten", "Ten Twenty", "दस बीस", "दसवां", "പത്ത് ഇരുപത്", "പത്തിന്", "ಹತ್ತು ಇಪ್ಪತ್ತು", "ಹತ್ತುಸಾವಿರ",
  "a dozen eggs, half a dozen", "double or triple", "tentwenty", "10 twenty", "twenty1", "₹ten",
  "help", "what can you do", "मदद", "madad", "സഹായം", "ಸಹಾಯ", "undo", "revert", "वापस लो", "wapas lo", "പഴയപടി", "ಹಿಂದಿನಂತೆ", "limit", "limits", "unlimited", "लिमिट", "പരിധി", "പരിധിയിൽ", "ಮಿತಿ",
  "what needs me", "anything for me", "approve", "मेरे लिए क्या है", "എനിക്ക് എന്താണ് ബാക്കി", "ನನಗೆ ಏನು ಬಾಕಿ", "money today", "how much came in", "आज कितना आया", "ഇന്ന് എത്ര കിട്ടി", "ಇಂದು ಎಷ್ಟು ಬಂತು",
  "money tomorrow", "money day after tomorrow", "money yesterday", "paisa kal", "money on 16 nov", "money monday", "cancel b-14", "cancel B-14", "b-14 रद्द करो", "refund b-14", "refund ₹500 to b-3",
  "ab-14", "b-1234567", "b-14b-15", "b-14 and b-15", "chat guest 3", "tell chat guest 3 and chat guest 44 we open", "xchat guest 3", "chat guest 1234567",
  "message b-14 Running 15 minutes late", "tell b-14 we are closed tomorrow", "b-14 ko bolo ki deri hogi", "tell me tomorrow's bookings", "orders", "order", "reorder", "bookings", "who owes fees",
  "close sunday", "closed", "enclosed", "holiday", "reopen sunday", "move b-14 to 5pm", "removed", "hello", "thanks", "", "   ",
  "tomorrow", "kal", "kalpana", "aaj", "aajkal", "today", "todays", "नाളെ", "നാളെ", "നാളെയ്ക്ക്", "ನಾಳೆ", "ನಾಳೆಗೆ", "ഇന്ന്", "ഇന്നത്തെ", "ಇಂದು", "ഇന്നലെ പണം", "ನಿನ್ನೆ ಹಣ", "money yesterday and today",
  "day after tomorrow", "मंगलवार", "next tuesday", "this tuesday", "next  tuesday", "agle mangalvar", "अगले मंगलवार", "इस मंगलवार", "അടുത്ത ചൊവ്വാഴ്ച", "ഈ ചൊവ്വ", "ಮುಂದಿನ ಮಂಗಳವಾರ", "ಈ ಮಂಗಳವಾರ",
  "money tuesday", "tue", "tues", "tuesdays", "money इतवार", "paisa shaniwar", "പണം ഞായറാഴ്ച", "ഞായറാഴ്ചയ്ക്ക്", "ಹಣ ಸೋಮವಾರ", "ಸೋಮವಾರದಂದು",
  "money 3 may", "money may i think", "money nov 16", "money 16th of november", "money 25 dec", "money 5 नवम्बर", "പണം 10 നവംബർ", "ಹಣ ನವೆಂಬರ್ 10", "decimal", "march on", "jan feb mar",
  "next", "nextday next ", "this ", "x this ", "അടുത്ത ", "ഈ ",
  "for customers: we deliver free", "tell customers - open on sunday", "customers may be told we open at ten", "ग्राहकों के लिए: रविवार बंद", "ഉപഭോക്താക്കൾക്ക് ഞായർ അവധി", "ಗ್ರಾಹಕರಿಗೆ ರಜೆ",
  "call me on +91 98111 11111 or 9811111111", "mail ravi@example.com", "see https://x.example/a?b=1 and www.example.in", "my name is Ravi Kumar and I want", "Myself Anil here", "मेरा नाम रवि है", "എന്റെ പേര് രവി", "ನನ್ನ ಹೆಸರು ರವಿ", "rename is fine", " Kumar", "15-11-2026 at 6:30", "०९८११ १११११ १",
  "Your kittens are booked and paid.", "बुक हो गया", "ബുക്ക് ചെയ്തു", "half price today, 20% off, 15 per cent", "visit shop.in/x or https://a.example/b.", "call 98 111 11111", "Tue 10 Nov, 6:00 pm", "मंगलवार, 10 नवंबर, शाम 6:00 बजे",
  "₹1,200 and ₹ 8000.50", "two hundred rupees", "ഇരുന്നൂറ്", "upi://pay?pa=x@y&am=10.", "it is done", "confirmedly",
  "my goal is ten sales", "goal: 20 a day", "goals", "लक्ष्य: दस", "लक्ष्यabc", "always greet", "never discount", "don't promise", "please be kind", "pleased", "हमेशा नमस्ते", "कभी नहीं",
];

type Hit = [number, string, ...(string | null)[]];

function vectors(): string {
  const out: Record<string, { text: string; hits: Hit[]; replaced: string }[]> = {};
  const texts = [...new Set(CORPUS.flatMap((t) => [t, canon(t)]))];
  for (const [name, re] of patterns()) {
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
    const rows: { text: string; hits: Hit[]; replaced: string }[] = [];
    for (const text of texts) {
      const hits: Hit[] = [...text.matchAll(g)].map((m) => [m.index, ...[...m].map((x) => x ?? null)] as Hit);
      if (hits.length) rows.push({ text, hits, replaced: text.replace(g, "<$&>") });
    }
    out[name] = rows;
  }
  return JSON.stringify({ corpus: texts, vectors: out }) + "\n";
}

/** Every generated file's text, by its path under internal/language. */
export function generate(): Map<string, string> {
  return new Map([["patterns.json", pack()], [join("testdata", "pattern-vectors.json"), vectors()]]);
}

/** The generated files in `dir` that differ from a fresh render. */
export function staleFiles(dir: string, files = generate()): string[] {
  const stale: string[] = [];
  for (const [name, text] of files) {
    let have = "";
    try { have = readFileSync(join(dir, name), "utf8"); } catch { /* missing */ }
    if (have !== text) stale.push(name);
  }
  return stale;
}

if (import.meta.main) {
  const files = generate();
  if (process.argv.includes("--check")) {
    const stale = staleFiles(OUT, files);
    for (const name of stale) console.error(`stale: ${name}`);
    process.exitCode = stale.length ? 1 : 0;
  } else {
    for (const [name, text] of files) { mkdirSync(dirname(join(OUT, name)), { recursive: true }); writeFileSync(join(OUT, name), text); }
    console.log(`wrote ${files.size} files to ${OUT}`);
  }
}
