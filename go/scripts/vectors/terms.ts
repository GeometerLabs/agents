// Vector files for go/internal/terms (the shop terms, modules/terms): the GENERATED WORDS (words.json: the four languages' terms with {slots}, the buttons and answers, the two
// patterns that read "terms" and "I agree", all rendered by the real TypeScript so nothing the owner reads is typed twice) and the vectors that hold the Go code to the TypeScript's
// answers (the text and digest for many shops, readTermsFile on many inputs, the two patterns on a corpus, the owner's side run through scripted conversations).
// Run through go/scripts/gen_guard_vectors.ts; `--check` there fails when words.json is out of date with modules/terms/terms.ts.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LANGUAGES } from "../../../modules/language/languages.ts";
import type { Language } from "../../../modules/language/languages.ts";
import { AGREE_PREFIX, LATER_ID, TERMS_AGREED_ACTION, TERMS_REVIEW_STATE, TERMS_SENT_ACTION, TERMS_VERSION, TERMS_WORDS, isAgreeWords, isTermsRequest, readTermsFile, termsDigest, termsText } from "../../../modules/terms/terms.ts";
import type { TermsFile } from "../../../modules/terms/terms.ts";
import { formatInr } from "../../../modules/language/format.ts";
import { handleOwnerTerms } from "../../../modules/terms/owner.ts";

// The two patterns are private constants of terms.ts; their literal source is read from the file (a loud error when the declaration changes shape), and checked against the
// functions' own answers on the corpus below before anything is written.
const SOURCE = readFileSync(fileURLToPath(new URL("../../../modules/terms/terms.ts", import.meta.url)), "utf8");
function literal(name: string): { source: string; flags: string } {
  const m = new RegExp(`const ${name} = /(.+)/([a-z]*);`, "u").exec(SOURCE);
  if (!m) throw new Error(`terms.ts no longer declares "const ${name} = /.../flags;" the way go/scripts/vectors/terms.ts reads it`);
  return { source: m[1], flags: m[2] };
}

const S = (name: string) => `\uE000${name}\uE001`; // sentinels: private-use characters that never occur in the words
const slot = (text: string, names: string[]) => { let out = text; for (const n of names) out = out.replaceAll(S(n), `{${n}}`); return out; };
const FORMAT_MONTHLY = 1111111, FORMAT_SETUP = 2222222; // numbers whose formatted rupees ("₹11,11,111") cannot occur in the words

export function wordsPack(): unknown {
  const bodies: Record<string, string> = {};
  const words: Record<string, unknown> = {};
  for (const lang of LANGUAGES) {
    // the two prices are rendered as numbers whose formatted rupees ("₹11,11,111") cannot occur in the words, and turned into slots after
    const file: TermsFile = { schema: 1, partnerName: S("partner"), partnerPhone: S("phone"), monthlyInr: 1111111, setupInr: 2222222 };
    const text = termsText(lang, S("shop"), file);
    const body = slot(text, ["shop", "partner", "phone"]).replaceAll(formatInr(1111111), "{monthly}").replaceAll(formatInr(2222222), "{setup}");
    if (/[\uE000\uE001]/u.test(body) || !body.includes("{monthly}") || !body.includes("{setup}")) throw new Error("the terms were not turned into slots");
    bodies[lang] = body;
    const w = TERMS_WORDS[lang as Language];
    words[lang] = { ask: slot(w.ask(S("v")), ["v"]), agree: w.agree, later: w.later, done: slot(w.done(S("v")), ["v"]), askFirst: w.askFirst, ok: w.ok, already: slot(w.already(S("v")), ["v"]) };
  }
  return {
    constants: { version: TERMS_VERSION, sentAction: TERMS_SENT_ACTION, agreedAction: TERMS_AGREED_ACTION, agreePrefix: AGREE_PREFIX, laterId: LATER_ID, reviewState: TERMS_REVIEW_STATE },
    request: literal("REQUEST"), agree: literal("AGREE"), bodies, words,
  };
}

// ---- the vectors ----------------------------------------------------------------------------------------------------------------------

const FILES: TermsFile[] = [
  { schema: 1, partnerName: "Divya", partnerPhone: "+919800000000", monthlyInr: 700, setupInr: 1500 },
  { schema: 1, partnerName: "Ravi Kumar", partnerPhone: "+91 98765 43210", monthlyInr: 0, setupInr: 0 },
  { schema: 1, partnerName: "ദിവ്യ", partnerPhone: "+919800000001", monthlyInr: 1234567, setupInr: 10_000_000 },
  { schema: 1, partnerName: "दिव्या {shop}", partnerPhone: "{phone}", monthlyInr: 999, setupInr: 100000 },
  { schema: 1, partnerName: "ದಿವ್ಯಾ $& $1 {v}", partnerPhone: "x", monthlyInr: 12345, setupInr: 99 },
];
const SHOPS = ["Glow Salon", "Shop {partner} & Co", "दुकान", "കട", "ಅಂಗಡಿ", "A \"quoted\" <b>shop</b> $& $1 \\ \n line", "😀 Cafe", ""];

const CORPUS = ["terms", "Terms", "TERMS", "  terms  ", "terms.", "terms!?", "terms ...", "terms ", " terms", "﻿terms", " terms　", "terms\n", "terms please", "my terms", "term", "terms of service", "शर्तें", "शर्ते", "शर्तें।", "शर्तें!", "നിബന്ധനകൾ", "നിബന്ധനകള്‍", "ನಿಯಮಗಳು", "ನಿಯಮಗಳು.", "ನಿಯಮ",
  "I agree", "i agree.", "I AGREE!", "agree", "Agree.", "  agree  ", "I  agree", "I agree.!", "I agree!?", "i agree please", "I do not agree", "disagree", "ok", "yes", "👍", "haan", "approve b-1", "agreed",
  "मैं सहमत हूँ", "मैं सहमत हूं", "सहमत", "मैं सहमत हूँ।", "मैं सहमत हूँ!", "ഞാൻ സമ്മതിക്കുന്നു", "സമ്മതിക്കുന്നു", "സമ്മതിക്കുന്നു.", "ನಾನು ಒಪ್ಪುತ್ತೇನೆ", "ಒಪ್ಪುತ್ತೇನೆ", "ಒಪ್ಪುತ್ತೇನೆ!", "", " ", "\n", "ſ", "termsK", "TERMſ", "ınfo", "İ agree", "ı agree", "I agree\u0085", "I agree ", "I agree᠎", "tERmS", "ＴＥＲＭＳ"];

const JSONS = ['{"schema":1,"partnerName":"Divya","partnerPhone":"+919800000000","monthlyInr":700,"setupInr":1500}', '{"schema":1,"partnerName":"  Divya  ","partnerPhone":" +91 ","monthlyInr":700.0,"setupInr":1.5e3}',
  '{"schema":1.0,"partnerName":"D","partnerPhone":"1","monthlyInr":0,"setupInr":0}', '{"schema":1e0,"partnerName":"D","partnerPhone":"1","monthlyInr":7e2,"setupInr":15E2}',
  '{"schema":2,"partnerName":"D","partnerPhone":"1","monthlyInr":1,"setupInr":1}', '{"schema":"1","partnerName":"D","partnerPhone":"1","monthlyInr":1,"setupInr":1}', '{"partnerName":"D","partnerPhone":"1","monthlyInr":1,"setupInr":1}',
  '{"schema":1,"partnerName":"","partnerPhone":"1","monthlyInr":1,"setupInr":1}', '{"schema":1,"partnerName":"   ","partnerPhone":"1","monthlyInr":1,"setupInr":1}', '{"schema":1,"partnerName":"\\u00a0\\ufeff","partnerPhone":"1","monthlyInr":1,"setupInr":1}',
  '{"schema":1,"partnerName":"D","partnerPhone":"","monthlyInr":1,"setupInr":1}', '{"schema":1,"partnerName":5,"partnerPhone":"1","monthlyInr":1,"setupInr":1}', '{"schema":1,"partnerName":"D","partnerPhone":null,"monthlyInr":1,"setupInr":1}',
  '{"schema":1,"partnerName":"D","partnerPhone":"1","monthlyInr":-1,"setupInr":1}', '{"schema":1,"partnerName":"D","partnerPhone":"1","monthlyInr":1,"setupInr":1.5}', '{"schema":1,"partnerName":"D","partnerPhone":"1","monthlyInr":10000000,"setupInr":10000001}',
  '{"schema":1,"partnerName":"D","partnerPhone":"1","monthlyInr":10000000,"setupInr":10000000}', '{"schema":1,"partnerName":"D","partnerPhone":"1","monthlyInr":"1","setupInr":1}', '{"schema":1,"partnerName":"D","partnerPhone":"1","monthlyInr":1}',
  '{"schema":1,"partnerName":"D","partnerPhone":"1","monthlyInr":1e400,"setupInr":1}', '{"schema":1,"partnerName":"D","partnerPhone":"1","monthlyInr":true,"setupInr":1}',
  JSON.stringify({ schema: 1, partnerName: "x".repeat(60), partnerPhone: "1", monthlyInr: 1, setupInr: 1 }), JSON.stringify({ schema: 1, partnerName: "x".repeat(61), partnerPhone: "1", monthlyInr: 1, setupInr: 1 }),
  JSON.stringify({ schema: 1, partnerName: "😀".repeat(30), partnerPhone: "1", monthlyInr: 1, setupInr: 1 }), JSON.stringify({ schema: 1, partnerName: "😀".repeat(31), partnerPhone: "1", monthlyInr: 1, setupInr: 1 }),
  JSON.stringify({ schema: 1, partnerName: "D", partnerPhone: "1".repeat(30), monthlyInr: 1, setupInr: 1 }), JSON.stringify({ schema: 1, partnerName: "D", partnerPhone: "1".repeat(31), monthlyInr: 1, setupInr: 1 }),
  JSON.stringify({ schema: 1, partnerName: " ".repeat(5) + "D" + " ".repeat(60), partnerPhone: "1", monthlyInr: 1, setupInr: 1 }),
  '{"schema":1,"partnerName":"a\\u0000b","partnerPhone":"1","monthlyInr":1,"setupInr":1}', '{"schema":1,"partnerName":"a\\nb","partnerPhone":"1","monthlyInr":1,"setupInr":1}', '{"schema":1,"partnerName":"a\\u007fb","partnerPhone":"1","monthlyInr":1,"setupInr":1}',
  '{"schema":1,"partnerName":"a\\u0085b","partnerPhone":"1","monthlyInr":1,"setupInr":1}', '{"schema":1,"partnerName":"a\\u00a0b","partnerPhone":"1","monthlyInr":1,"setupInr":1}', '{"schema":1,"partnerName":"a\\u200bb","partnerPhone":"1","monthlyInr":1,"setupInr":1}', '{"schema":1,"partnerName":"a\\u2028b","partnerPhone":"1","monthlyInr":1,"setupInr":1}',
  '{"schema":1,"partnerName":"D","partnerPhone":"1","monthlyInr":1,"setupInr":1,"extra":"dropped"}', '{"schema":1,"schema":2,"partnerName":"D","partnerPhone":"1","monthlyInr":1,"setupInr":1}', '[]', 'null', '5', '"x"', 'true', '{}'];

const plain = (v: unknown): any => (v === undefined ? null : JSON.parse(JSON.stringify(v)));

export function termsVectors(): unknown {
  const texts: unknown[] = [];
  for (const file of FILES) for (const shop of SHOPS) for (const lang of LANGUAGES) { const text = termsText(lang, shop, file); texts.push({ lang, shop, file, text, digest: termsDigest(text) }); }
  const reads = JSONS.map((json) => ({ json, out: plain(readTermsFile(JSON.parse(json))) }));
  const patterns = CORPUS.map((text) => ({ text, request: isTermsRequest(text), agree: isAgreeWords(text) }));
  // the generated patterns, evaluated here from their own source, must give what the functions give: the check that the literal was read right
  const rq = literal("REQUEST"), ag = literal("AGREE");
  for (const c of patterns) if (new RegExp(rq.source, rq.flags).test(c.text) !== c.request || new RegExp(ag.source, ag.flags).test(c.text) !== c.agree) throw new Error(`the pattern read from terms.ts disagrees with its function on ${JSON.stringify(c.text)}`);
  return { texts, reads, patterns };
}

// ---- the owner's side, through scripted conversations --------------------------------------------------------------------------------

interface Scenario { name: string; setup: TermsFile | null; shopName: string; ownerNumber: string; ownerLanguage: Language; interactive: boolean; failText: number[]; failInteractive: boolean; messages: { id: string; text: string; reply?: { id: string } }[] }

async function runScenario(s: Scenario) {
  const sent: unknown[] = [];
  const logged: unknown[] = [];
  const entries: { action: string; outcome: string; refs: Record<string, string> }[] = [];
  let textCalls = 0;
  const messaging: any = {
    sendText: async (to: string, body: string) => { const n = textCalls++; const failed = s.failText.includes(n); sent.push({ kind: "text", to, body, ...(failed ? { failed: true } : {}) }); if (failed) throw new Error("boom"); },
  };
  if (s.interactive) messaging.sendInteractive = async (to: string, m: unknown) => { sent.push({ kind: "interactive", to, message: plain(m), ...(s.failInteractive ? { failed: true } : {}) }); if (s.failInteractive) throw new Error("no buttons today"); };
  const deps = {
    setup: s.setup ?? undefined, shopName: s.shopName, ownerNumber: s.ownerNumber, ownerLanguage: s.ownerLanguage, messaging, record: { entries: () => entries } as any,
    log: (action: string, outcome: "confirmed" | "failed" | "blocked", inputs: unknown, more: { notes?: string; refs?: Record<string, string> }) => { logged.push(plain({ action, outcome, inputs, notes: more.notes, refs: more.refs })); entries.push({ action, outcome, refs: more.refs ?? {} }); },
  };
  const handled: boolean[] = [];
  for (const m of s.messages) handled.push(await handleOwnerTerms(m as any, deps));
  return { ...s, handled, sent, logged };
}

async function ownerScenarios(): Promise<unknown[]> {
  const file = FILES[0];
  const base = { setup: file, shopName: "Glow Salon", ownerNumber: "+919811111111", ownerLanguage: "en" as Language, interactive: true, failText: [], failInteractive: false };
  const idFor = (lang: Language, f: TermsFile = file, shop = "Glow Salon", prefix = true) => (prefix ? AGREE_PREFIX : "") + termsDigest(termsText(lang, shop, f)).slice(0, 12);
  const out: Scenario[] = [];
  const add = (name: string, over: Partial<Scenario>) => out.push({ name, ...base, messages: [], ...over } as Scenario);
  let n = 0;
  const msg = (text: string, reply?: string) => ({ id: `wamid.${++n}`, text, ...(reply !== undefined ? { reply: { id: reply } } : {}) });
  add("off: no terms file, nothing is taken", { setup: null, messages: [msg("terms"), msg("I agree"), msg("x", LATER_ID)] });
  for (const lang of LANGUAGES) {
    const asks = lang === "en" ? "terms" : lang === "hi" ? "शर्तें" : lang === "ml" ? "നിബന്ധനകൾ" : "ನಿಯಮಗಳು";
    const agrees = lang === "en" ? "I agree" : lang === "hi" ? "मैं सहमत हूँ" : lang === "ml" ? "ഞാൻ സമ്മതിക്കുന്നു" : "ನಾನು ಒಪ್ಪುತ್ತೇನೆ";
    add(`${lang}: asked, then agreed by typing, then again`, { ownerLanguage: lang, messages: [msg(asks), msg(agrees), msg(agrees)] });
    add(`${lang}: asked, then agreed by the button`, { ownerLanguage: lang, messages: [msg(asks), msg("", idFor(lang)), msg("", idFor(lang))] });
  }
  add("agreeing before the terms were sent", { messages: [msg("I agree")] });
  add("the button before the terms were sent", { messages: [msg("", idFor("en"))] });
  add("the button of other terms (a stale digest)", { messages: [msg("terms"), msg("", `${AGREE_PREFIX}abcdefabcdef`)] });
  add("the button with a short or empty digest", { messages: [msg("terms"), msg("", AGREE_PREFIX), msg("", `${AGREE_PREFIX}${idFor("en", file, "Glow Salon", false).slice(0, 5)}`)] });
  add("later, then asked, then later again", { messages: [msg("", LATER_ID), msg("terms"), msg("", LATER_ID)] });
  add("a tap that is neither agree nor later is not taken", { messages: [msg("", "something-else"), msg("terms", "something-else")] });
  add("a tap with the words of an agreement is the tap that counts", { messages: [msg("terms"), msg("I agree", "other-button")] });
  add("a tap with the words 'terms' is not a request", { messages: [msg("terms", "other-button")] });
  add("other words are not taken", { messages: [msg("ok"), msg("yes"), msg("hello"), msg("disagree"), msg("👍")] });
  add("no buttons: the question and the agree words go as plain text", { interactive: false, messages: [msg("terms"), msg("I agree")] });
  add("the terms fail to send", { failText: [0], messages: [msg("terms"), msg("I agree")] });
  add("the question fails to send (no buttons)", { interactive: false, failText: [1], messages: [msg("terms"), msg("I agree")] });
  add("the buttons fail to send", { failInteractive: true, messages: [msg("terms"), msg("I agree")] });
  add("the answer fails to send but the agreement is recorded (buttons: the answer is the second text)", { failText: [1], messages: [msg("terms"), msg("I agree")] });
  add("the answer fails to send but the agreement is recorded (no buttons: the third text)", { interactive: false, failText: [2], messages: [msg("terms"), msg("I agree")] });
  add("a changed price needs new terms", { messages: [msg("terms")] });
  add("a language the terms have no row for is not taken", { ownerLanguage: "fr" as Language, messages: [msg("terms")] });
  const res: unknown[] = [];
  for (const s of out) {
    if (s.name === "a language the terms have no row for is not taken") { try { res.push(await runScenario(s)); } catch (e) { res.push({ ...s, throws: (e as Error).name }); } continue; }
    res.push(await runScenario(s));
  }
  // a conversation where the terms change between the asking and the agreeing: the second run has other prices, same record
  const entries: any[] = [];
  const sent: unknown[] = [];
  const logged: unknown[] = [];
  const dep = (f: TermsFile) => ({ setup: f, shopName: "Glow Salon", ownerNumber: "+919811111111", ownerLanguage: "en" as Language, messaging: { sendText: async (to: string, body: string) => { sent.push({ kind: "text", to, body }); }, sendInteractive: async (to: string, m: unknown) => { sent.push({ kind: "interactive", to, message: plain(m) }); } } as any, record: { entries: () => entries } as any,
    log: (action: string, outcome: any, inputs: unknown, more: any) => { logged.push(plain({ action, outcome, inputs, notes: more.notes, refs: more.refs })); entries.push({ action, outcome, refs: more.refs ?? {} }); } });
  const changed = { ...file, monthlyInr: 800 };
  const steps: { setup: TermsFile; m: { id: string; text: string; reply?: { id: string } } }[] = [{ setup: file, m: msg("terms") }, { setup: changed, m: msg("I agree") }, { setup: changed, m: msg("", idFor("en", file)) }, { setup: changed, m: msg("terms") }, { setup: changed, m: msg("", idFor("en", changed)) }];
  const handled: boolean[] = [];
  for (const st of steps) handled.push(await handleOwnerTerms(st.m as any, dep(st.setup)));
  res.push({ name: "the terms change between asking and agreeing", changing: true, steps, handled, sent, logged });
  return res;
}

export async function files(): Promise<[string, unknown][]> {
  return [["terms/words.json", wordsPack()], ["terms/testdata/terms-vectors.json", { ...(termsVectors() as object), owner: await ownerScenarios() }]];
}
