// Writes go/internal/assistant/testdata/customer-talk-vectors.json: what the TypeScript makes of a customer's talk (modules/assistant/talk-check.ts checkTalk, talk-types.ts readTalkAnswer,
// talk-prompt.ts customerPrompt) for a set of answers a model might give, so the Go checks (internal/assistant/talk.go CheckTalk, talkcustomer.go) are proved equal on the same ones. The
// cases are talk-check.test.ts's own, plus the words of each claim, completion and banned list in four languages, the shapes a model's JSON can take, and each prompt. Run from the
// repository root:   node go/scripts/gen_customer_talk_vectors.ts        (add --check to only compare with the committed file)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkTalk } from "../../modules/assistant/talk-check.ts";
import type { CheckInput } from "../../modules/assistant/talk-check.ts";
import { customerPrompt } from "../../modules/assistant/talk-prompt.ts";
import { readTalkAnswer } from "../../modules/assistant/talk-types.ts";
import type { TalkSource } from "../../modules/assistant/talk-types.ts";
import { formatSlot } from "../../modules/language/format.ts";
import { LANGUAGES } from "../../modules/language/languages.ts";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "internal", "assistant", "testdata", "customer-talk-vectors.json");
const TZ = "Asia/Kolkata";
const FREE = Date.UTC(2026, 10, 17, 10, 30);
const base: TalkSource[] = [
  { id: "n-1", kind: "note", text: "Haircuts are 10% off on Tuesdays." },
  { id: "s:svc", kind: "setting", text: "Haircut: ₹300, 30 minutes.", amountsInr: [300], literals: ["Haircut"] },
  { id: "s:policy", kind: "setting", text: "The deposit is refundable if you cancel 24 hours before." },
  { id: "r:free", kind: "record", text: `Next free time: ${formatSlot(FREE, TZ, "en")}.`, momentsMs: [FREE] },
  { id: "n-5", kind: "note", text: "Free tea with every haircut." },
  { id: "s:l-1", kind: "setting", text: "Listing l-1. Category: pets. A kitten. Price: ₹8,000. The owner says: vaccinated.", amountsInr: [8000], literals: ["kitten"] },
  { id: "s:l-2", kind: "setting", text: "Listing l-2. Category: pets. A puppy. Price: ₹5,000.", amountsInr: [5000] },
];
type S = { text: string; sources: string[] };
const cases: { name: string; role: "owner" | "customer"; sentences: S[]; scope: TalkSource[]; speakerText: string; speakerLanguage: string; links: string[]; literals: string[]; maxChars: number; momentsAt: number }[] = [];
const add = (name: string, sentences: S[], more: Partial<(typeof cases)[number]> = {}) => cases.push({ name, role: "customer", sentences, scope: base, speakerText: "how much?", speakerLanguage: "en", links: [], literals: ["Glow Salon"], maxChars: 400, momentsAt: FREE, ...more });

add("grounded", [{ text: "A Haircut is ₹300.", sources: ["s:svc"] }, { text: "How can I help?", sources: [] }]);
add("check1 missing", [{ text: "Hello.", sources: ["n-99"] }]);
add("check1 owner only", [{ text: "Hello.", sources: ["n-2"] }]);
add("amount wrong", [{ text: "A Haircut is ₹350.", sources: ["s:svc"] }]);
add("percent wrong", [{ text: "Haircuts are 20% off on Tuesdays.", sources: ["n-1"] }]);
add("percent right", [{ text: "Haircuts are 10% off on Tuesdays.", sources: ["n-1"] }]);
add("number from a source not named", [{ text: "A Haircut is ₹300.", sources: ["n-1"] }]);
add("free time other", [{ text: `The next free time is ${formatSlot(FREE + 3_600_000, TZ, "en")}.`, sources: ["r:free"] }]);
add("free time same", [{ text: `The next free time is ${formatSlot(FREE, TZ, "en")}.`, sources: ["r:free"] }]);
add("free time in hindi", [{ text: `अगला खाली समय ${formatSlot(FREE, TZ, "hi")} है।`, sources: ["r:free"] }], { speakerText: "समय कब है?", speakerLanguage: "hi" });
add("number word", [{ text: "It costs half the usual price.", sources: ["s:svc"] }]);
add("phone", [{ text: "Call me on 9876543210.", sources: [] }]);
for (const text of ["The owner guarantees this.", "We promise it will be ready.", "The owner says it is fine.", "It is free for you.", "You get a discount.", "We will refund you.", "I can waive the deposit.", "Definitely, it is a sure thing.", "We'll do it, no charge.", "free tea? no, a free haircut", "There is free time at five.", "free slot tomorrow", "100% sure", "complimentary tea", "cashback offer", "on the house", "half price today", "20 % off"]) add(`claim: ${text}`, [{ text, sources: [] }]);
add("record does not back a claim", [{ text: "It is free for you.", sources: ["r:free"] }]);
add("note backs its own kind", [{ text: "There is free tea with every haircut.", sources: ["n-5"] }]);
add("note does not back another kind", [{ text: "It is guaranteed.", sources: ["n-5"] }]);
add("owner may say discount", [{ text: "A discount on Tuesdays could fill the quiet day.", sources: [] }], { role: "owner", maxChars: 600 });
for (const text of ["यह गारंटी है", "मुफ़्त मिलेगा", "मुफ्त मिलेगा", "ഉറപ്പാണ്", "ഇളവ് ഉണ്ട്", "ಖಾತರಿ ಇದೆ", "ರಿಯಾಯಿತಿ ಸಿಗುತ್ತದೆ", "हम करेंगे", "मालिक ने कहा है", "ഞങ്ങൾ ചെയ്യും", "ಮಾಲೀಕರು ಹೇಳಿದ್ದಾರೆ", "छूट मिलेगी", "ഉറപ്പ് നൽകുന്നു"]) {
  const speaker = text;
  add(`claim words: ${text}`, [{ text, sources: [] }], { speakerText: speaker });
}
for (const text of ["आपका हेयरकट बुक हो गया", "रिफंड कर दिया", "ബുക്ക് ചെയ്തു", "റദ്ദാക്കി", "ಬುಕ್ ಮಾಡಲಾಗಿದೆ", "ಕಳುಹಿಸಲಾಗಿದೆ", "Your haircut is booked.", "It is confirmed.", "The refund was sent.", "I cancelled it.", "Payment received and paid.", "It is rescheduled.", "To confirm, tap Book."]) add(`completion: ${text}`, [{ text, sources: ["s:svc"] }], { speakerText: text });
add("completion owner", [{ text: "Your booking is confirmed.", sources: [] }], { role: "owner", maxChars: 600 });
add("stray link", [{ text: "Pay at https://evil.example/pay now.", sources: [] }]);
add("own link", [{ text: "See https://glow.example/book for times.", sources: [] }], { links: ["https://glow.example/book"] });
add("own link bare", [{ text: "See glow.example/book for times.", sources: [] }], { links: ["https://glow.example/book"] });
add("other link with own domain", [{ text: "See glow.example/other for times.", sources: [] }], { links: ["https://glow.example/book"] });
add("too long", [{ text: "x".repeat(401), sources: [] }]);
add("exactly long enough", [{ text: "x".repeat(400), sources: [] }]);
add("hindi to english speaker", [{ text: "यह जवाब हिंदी में है", sources: [] }]);
add("english to hindi speaker", [{ text: "This is English.", sources: [] }], { speakerText: "हेयरकट कितने का है?", speakerLanguage: "hi" });
add("hindi to hindi speaker", [{ text: "Haircut ₹300 का है।", sources: ["s:svc"] }], { speakerText: "हेयरकट कितने का है?", speakerLanguage: "hi" });
add("malayalam speaker", [{ text: "ഹെയർകട്ട് ₹300 ആണ്.", sources: ["s:svc"] }], { speakerText: "ഹെയർകട്ടിന് എത്രയാണ്?", speakerLanguage: "ml" });
add("kannada speaker", [{ text: "ಹೇರ್‌ಕಟ್ ₹300.", sources: ["s:svc"] }], { speakerText: "ಹೇರ್‌ಕಟ್ ಎಷ್ಟು?", speakerLanguage: "kn" });
add("safe and certified", [{ text: "It is safe and certified.", sources: [] }]);
for (const text of ["It is risk free.", "A secure booking.", "A proven method.", "You will earn more.", "सुरक्षित है", "ഗ്യാരണ്ടി", "ಸುರಕ്ಷಿತ", "Safety first", "Unsafe roads", "a safeguard", "profit", "revenue today", "income"]) add(`banned: ${text}`, [{ text, sources: [] }], { speakerText: text });
add("pet health unsaid", [{ text: "The puppy is vaccinated.", sources: ["s:l-2"] }]);
add("pet health said", [{ text: "The owner says the kitten is vaccinated.", sources: ["s:l-1"] }]);
add("pet health named but a note", [{ text: "The puppy is healthy.", sources: ["s:l-1"] }]);
add("pet price", [{ text: "The kitten is ₹8,000.", sources: ["s:l-1"] }]);
add("two sentences second bad", [{ text: "A Haircut is ₹300.", sources: ["s:svc"] }, { text: "It is guaranteed.", sources: ["s:svc"] }]);
add("number in a sentence of a source of the other", [{ text: "A Haircut is ₹300 and 30 minutes.", sources: ["s:svc"] }]);
add("deposit hours", [{ text: "The deposit is refundable if you cancel 24 hours before.", sources: ["s:policy"] }]);
add("deposit hours wrong", [{ text: "The deposit is refundable if you cancel 48 hours before.", sources: ["s:policy"] }]);
add("the shop's name", [{ text: "Welcome to Glow Salon.", sources: [] }]);
add("a date", [{ text: "Come on Tue 17 Nov.", sources: [] }]);
add("a time", [{ text: "Come at 6:00 pm.", sources: [] }]);

const checks = cases.map((c) => {
  const input: CheckInput = { role: c.role, answer: { sentences: c.sentences, askOwner: false }, scope: c.scope, speakerText: c.speakerText, speakerLanguage: c.speakerLanguage as CheckInput["speakerLanguage"], timeZone: TZ, links: c.links, literals: c.literals, maxChars: c.maxChars };
  const r = checkTalk(input);
  return { ...c, scope: undefined, result: r.ok ? { ok: true, text: r.text, amounts: [...r.facts.amountsInr].sort((a, b) => a - b), counts: [...r.facts.counts].sort((a, b) => a - b), moments: [...r.facts.momentsMs], literals: [...r.facts.literals] } : { ok: false, check: r.check } };
});

// what a model's JSON comes to when it is read (talk-types.ts readTalkAnswer for the customer's turn)
const answers: unknown[] = [
  { sentences: [{ text: "Hello", sources: ["s:svc"] }], ask_owner: false }, { sentences: [{ text: "Hello", sources: null }], ask_owner: true }, { sentences: [{ text: "  Hello  ", sources: ["a", "a", "b"] }], ask_owner: "true" },
  { sentences: [] }, { sentences: [{ text: "x", sources: [] }, { text: "y", sources: [] }, { text: "z", sources: [] }, { text: "x", sources: [] }, { text: "y", sources: [] }, { text: "z", sources: [] }, { text: "x", sources: [] }, { text: "y", sources: [] }, { text: "z", sources: [] }] },
  { sentences: [{ text: "", sources: [] }] }, { sentences: [{ text: "   ", sources: [] }] }, { sentences: [{ text: 5, sources: [] }] }, { sentences: [{ text: "ok", sources: [1] }] }, { sentences: [{ text: "ok", sources: "s:svc" }] }, { sentences: [{ text: "ok" }] },
  { sentences: "hello" }, "just words", null, [], 7, { sentences: [{ text: "ok", sources: [] }], note: { kind: "fact", text: "free tea" }, limit: "cancellation.refundLimitInr" }, { sentences: [{ text: "ok", sources: [] }], ask_owner: true, extra: 1 },
  { sentences: [null] }, { sentences: [[]] },
];
const reads = answers.map((raw) => ({ raw, answer: readTalkAnswer(raw, "customer") }));

const prompts: { shop: string; charName: string; personality: string; language: string; sources: TalkSource[]; system: string }[] = [];
for (const language of LANGUAGES) for (const personality of ["warm", "cheerful", "brief"] as const) for (const charName of ["", "Mithra"]) {
  const sources = [base[0], base[1]];
  prompts.push({ shop: "Glow {sources} Salon", charName, personality, language, sources, system: customerPrompt({ shop: { name: "Glow {sources} Salon", character: { ...(charName ? { name: charName } : {}), personality } }, language, sources }).system });
}
prompts.push({ shop: "Glow Salon", charName: "", personality: "warm", language: "en", sources: [], system: customerPrompt({ shop: { name: "Glow Salon", character: { personality: "warm" } }, language: "en", sources: [] }).system });

const text = `${JSON.stringify({ scope: base, timeZone: TZ, checks, reads, prompts }, null, 1)}\n`;
if (process.argv.includes("--check")) {
  if (readFileSync(OUT, "utf8") !== text) { console.error(`${OUT} is out of date: run node go/scripts/gen_customer_talk_vectors.ts`); process.exit(1); }
  console.log("customer talk vectors are fresh");
} else { writeFileSync(OUT, text); console.log(`wrote ${OUT}: ${checks.length} checks, ${reads.length} reads, ${prompts.length} prompts`); }
