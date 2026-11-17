// "Limits, tightened by a tap" on the owner's side of the assistant (17 Nov 2026; modules/Explanation.md). The owner says a rule ("refunds above ₹500 need my OK"); the
// rules read WHICH declared limit and WHAT value from the words (a model may only name the limit, never a value); the backend checks the value is STRICTLY tighter
// than the limit in force now (a pending change counts); a card shows the current and the proposed rule; and only the owner's tap makes a Pending change, which the
// runtime obeys at once (it is only stricter) while the deployer writes the settings file Guard's spec is made from and reports back. Used by conversation.ts (the
// "limit" kind and the beat), wire.ts (which builds it for each agent) and words.ts (the card's line and the owner's words for each state).
//
// It reuses the card binding unchanged: this is an OwnerSkill named "limits" whose `prepare` reads the limit in force NOW, so a card made when the limit was ₹1,000 has
// another digest if a change landed before the tap (cards.ts judgeCard: "changed"; nothing is done and a new card is made). Loosening is never done here: the chat only
// ever asks for "tighten", and a request that would loosen is answered with the way to do it (the owner's own app, behind their passkey).
//
// The words the owner reads are in four languages; Hindi, Malayalam and Kannada are machine-written and are on the review sheets (bundle/panel/review.ts).
import { canon } from "../language/format.ts";
import { wordRe } from "../language/dates.ts";
import type { Language } from "../language/languages.ts";
import { applyInForce, inForce, judgeChange, limitBase, limitNamed } from "../limits/chat-limits.ts";
import type { ChatLimit, LimitChange } from "../limits/chat-limits.ts";
import type { Outcome } from "../record/record.ts";
import { amountOf } from "./intents.ts";
import type { CardAction, AssistantState } from "./state.ts";
import { assistantOf, nextId } from "./state.ts";
import type { Executed, OwnerSkill, Prepared, Proposal } from "./skill.ts";

/** The record's name for a limit change; one line when it is made (pending) and one when it settles (confirmed or failed). */
export const LIMIT_CHANGE_ACTION = "limit_change";

/** What a card and a message need of one limit, in every language (so words.ts needs nothing from a template). */
export interface LimitView { id: string; unit: ChatLimit["unit"]; zeroIsOff: boolean; name: Record<Language, string>; rule: Record<Language, string> }
export const viewOf = (l: ChatLimit): LimitView => ({ id: l.id, unit: l.unit, zeroIsOff: l.zeroIsOff === true, name: l.name, rule: l.rule });

/** The card's data: the rule with the proposed value, and the value now. */
export interface LimitCardView extends LimitView { now: number; to: number }

/** What the owner is told about a limit, besides the card. */
export type LimitSay =
  | { what: "pending"; limit: LimitView; to: number }
  | { what: "active"; limit: LimitView; to: number }
  | { what: "failed"; limit: LimitView; from: number; why?: string }
  | { what: "not_tighter"; limit: LimitView; now: number; to: number }
  | { what: "need_value"; limit: LimitView }
  | { what: "which"; limits: readonly LimitView[] }
  | { what: "loosen_app" };

/** The facts writer words.ts passes (structurally: this file must not import words.ts, which imports this one). */
export interface LimitWriter { inr(paise: number): string; n(count: number): string; lit(text: string): string }

// ---- the words ----------------------------------------------------------------------------------------------------------------------------------------------

/** A value as the owner reads it: rupees for an amount, the number for a count, "never" for a big-order amount of 0. */
function valueText(v: Pick<LimitView, "unit" | "zeroIsOff">, value: number, language: Language, w: LimitWriter): string {
  if (v.zeroIsOff && value === 0) return NEVER[language];
  return v.unit === "inr" ? w.inr(value * 100) : w.n(value);
}
const NEVER: Record<Language, string> = { en: "never", hi: "कभी नहीं", ml: "ഒരിക്കലും ഇല്ല", kn: "ಎಂದಿಗೂ ಇಲ್ಲ" };
/** The rule with its value put in: "Refunds above ₹500 need your approval". */
const ruleText = (v: LimitView, value: number, language: Language, w: LimitWriter): string => v.rule[language].replace("{v}", valueText(v, value, language, w));

const NOW: Record<Language, string> = { en: "Now", hi: "अभी", ml: "ഇപ്പോൾ", kn: "ಈಗ" };
const PENDING: Record<Language, string> = {
  en: "Pending", hi: "प्रतीक्षा में", ml: "കാത്തിരിക്കുന്നു", kn: "ಬಾಕಿ ಇದೆ",
};
const ACTIVE: Record<Language, string> = { en: "Active", hi: "चालू", ml: "പ്രാബല്യത്തിൽ", kn: "ಜಾರಿಯಲ್ಲಿದೆ" };

/** The card's question: the proposed rule, and what is in force now. */
export function limitCardLine(c: LimitCardView, language: Language, w: LimitWriter): string {
  return `${ruleText(c, c.to, language, w)}. ${NOW[language]}: ${valueText(c, c.now, language, w)}.`;
}

/** Every other thing the owner is told about a limit. */
export function limitLine(s: LimitSay, language: Language, w: LimitWriter): string {
  switch (s.what) {
    case "pending": return PENDING_LINE[language](`${PENDING[language]}: ${ruleText(s.limit, s.to, language, w)}`);
    case "active": return `${ACTIVE[language]}: ${ruleText(s.limit, s.to, language, w)}.`;
    case "failed": return FAILED_LINE[language](ruleText(s.limit, s.from, language, w), s.why !== undefined ? w.lit(s.why) : undefined);
    case "not_tighter": return NOT_TIGHTER_LINE[language](s.limit.name[language], valueText(s.limit, s.now, language, w), valueText(s.limit, s.to, language, w));
    case "need_value": return NEED_VALUE_LINE[language](s.limit.name[language], s.limit.unit);
    case "which": return WHICH_LINE[language](s.limits.map((l) => w.lit(l.name[language])).join(", "));
    case "loosen_app": return LOOSEN_LINE[language];
  }
}

const PENDING_LINE: Record<Language, (head: string) => string> = {
  en: (h) => `${h}. It already applies here, and I'll tell you when it is Active.`,
  hi: (h) => `${h}। यह यहाँ अभी से लागू है, और चालू होते ही मैं बता दूँगा।`,
  ml: (h) => `${h}. ഇത് ഇവിടെ ഇപ്പോൾ തന്നെ ബാധകമാണ്, പ്രാബല്യത്തിൽ വരുമ്പോൾ ഞാൻ അറിയിക്കാം.`,
  kn: (h) => `${h}. ಇದು ಇಲ್ಲಿ ಈಗಲೇ ಅನ್ವಯಿಸುತ್ತದೆ, ಜಾರಿಗೆ ಬಂದಾಗ ನಾನು ತಿಳಿಸುತ್ತೇನೆ.`,
};
const FAILED_LINE: Record<Language, (previous: string, why?: string) => string> = {
  en: (p, why) => `That did not go through${why ? ` (${why})` : ""}. The previous limit is still in force: ${p}. You can try again.`,
  hi: (p, why) => `यह नहीं हो पाया${why ? ` (${why})` : ""}। पहले वाली सीमा ही लागू है: ${p}। आप फिर कोशिश कर सकते हैं।`,
  ml: (p, why) => `ഇത് നടന്നില്ല${why ? ` (${why})` : ""}. മുമ്പത്തെ പരിധി തന്നെ ഇപ്പോഴും പ്രാബല്യത്തിൽ: ${p}. വീണ്ടും ശ്രമിക്കാം.`,
  kn: (p, why) => `ಇದು ಆಗಲಿಲ್ಲ${why ? ` (${why})` : ""}. ಹಿಂದಿನ ಮಿತಿಯೇ ಈಗಲೂ ಜಾರಿಯಲ್ಲಿದೆ: ${p}. ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಬಹುದು.`,
};
const NOT_TIGHTER_LINE: Record<Language, (name: string, now: string, to: string) => string> = {
  en: (n, now, to) => `Your ${n} is ${now} now, so ${to} would loosen it, not tighten it. I only tighten from here; to loosen, open your own app and sign in with your passkey.`,
  hi: (n, now, to) => `आपकी ${n} अभी ${now} है, इसलिए ${to} इसे कसने की जगह ढीला करेगा। मैं यहाँ से सिर्फ़ कसता हूँ; ढीला करने के लिए अपना ऐप खोलें और पासकी से साइन इन करें।`,
  ml: (n, now, to) => `നിങ്ങളുടെ ${n} ഇപ്പോൾ ${now} ആണ്, അതിനാൽ ${to} അത് കർശനമാക്കുകയല്ല, അയവുള്ളതാക്കുകയാണ്. ഞാൻ ഇവിടെ നിന്ന് കർശനമാക്കാൻ മാത്രമേ ചെയ്യൂ; അയവ് വരുത്താൻ നിങ്ങളുടെ ആപ്പ് തുറന്ന് പാസ്‌കീ ഉപയോഗിച്ച് സൈൻ ഇൻ ചെയ്യുക.`,
  kn: (n, now, to) => `ನಿಮ್ಮ ${n} ಈಗ ${now} ಇದೆ, ಆದ್ದರಿಂದ ${to} ಅದನ್ನು ಬಿಗಿಗೊಳಿಸುವುದಿಲ್ಲ, ಸಡಿಲಗೊಳಿಸುತ್ತದೆ. ನಾನು ಇಲ್ಲಿಂದ ಬಿಗಿಗೊಳಿಸುವುದನ್ನು ಮಾತ್ರ ಮಾಡುತ್ತೇನೆ; ಸಡಿಲಗೊಳಿಸಲು ನಿಮ್ಮ ಆ್ಯಪ್ ತೆರೆದು ಪಾಸ್‌ಕೀಯಿಂದ ಸೈನ್ ಇನ್ ಮಾಡಿ.`,
};
const NEED_VALUE_LINE: Record<Language, (name: string, unit: ChatLimit["unit"]) => string> = {
  en: (n, unit) => `What should your ${n} be? ${unit === "inr" ? "Say it with a rupee amount, like ₹500." : "Say the number."}`,
  hi: (n, unit) => `आपकी ${n} कितनी होनी चाहिए? ${unit === "inr" ? "रुपये की राशि के साथ बताइए, जैसे ₹500।" : "संख्या बताइए।"}`,
  ml: (n, unit) => `നിങ്ങളുടെ ${n} എത്ര ആയിരിക്കണം? ${unit === "inr" ? "രൂപയുടെ തുകയോടെ പറയുക, ഉദാഹരണം ₹500." : "സംഖ്യ പറയുക."}`,
  kn: (n, unit) => `ನಿಮ್ಮ ${n} ಎಷ್ಟು ಇರಬೇಕು? ${unit === "inr" ? "ರೂಪಾಯಿ ಮೊತ್ತದೊಂದಿಗೆ ಹೇಳಿ, ಉದಾಹರಣೆಗೆ ₹500." : "ಸಂಖ್ಯೆ ಹೇಳಿ."}`,
};
const WHICH_LINE: Record<Language, (names: string) => string> = {
  en: (n) => `Which limit do you mean? I can tighten: ${n}. For anything else, I'll keep it as a note instead.`,
  hi: (n) => `आप कौन सी सीमा की बात कर रहे हैं? मैं ये कस सकता हूँ: ${n}। बाकी के लिए मैं उसे नोट के रूप में रख लूँगा।`,
  ml: (n) => `ഏത് പരിധിയാണ് ഉദ്ദേശിക്കുന്നത്? എനിക്ക് ഇവ കർശനമാക്കാം: ${n}. മറ്റെന്തിനും ഞാൻ അത് ഒരു കുറിപ്പായി സൂക്ഷിക്കാം.`,
  kn: (n) => `ಯಾವ ಮಿತಿಯನ್ನು ಹೇಳುತ್ತಿದ್ದೀರಿ? ನಾನು ಇವನ್ನು ಬಿಗಿಗೊಳಿಸಬಲ್ಲೆ: ${n}. ಉಳಿದದ್ದಕ್ಕೆ ಅದನ್ನು ಟಿಪ್ಪಣಿಯಾಗಿ ಇಟ್ಟುಕೊಳ್ಳುತ್ತೇನೆ.`,
};
const LOOSEN_LINE: Record<Language, string> = {
  en: "Loosening a limit is done in your own app, after you sign in with your passkey. I can only tighten one from here, with your tap.",
  hi: "सीमा को ढीला करना आपके अपने ऐप में होता है, पासकी से साइन इन करने के बाद। मैं यहाँ से आपके टैप पर सिर्फ़ कस सकता हूँ।",
  ml: "പരിധി അയവുള്ളതാക്കുന്നത് പാസ്‌കീ ഉപയോഗിച്ച് സൈൻ ഇൻ ചെയ്ത ശേഷം നിങ്ങളുടെ സ്വന്തം ആപ്പിലാണ്. നിങ്ങളുടെ ടാപ്പോടെ ഇവിടെ നിന്ന് കർശനമാക്കാൻ മാത്രമേ എനിക്ക് കഴിയൂ.",
  kn: "ಮಿತಿಯನ್ನು ಸಡಿಲಗೊಳಿಸುವುದು ಪಾಸ್‌ಕೀಯಿಂದ ಸೈನ್ ಇನ್ ಆದ ಮೇಲೆ ನಿಮ್ಮ ಸ್ವಂತ ಆ್ಯಪ್‌ನಲ್ಲಿ ಆಗುತ್ತದೆ. ನಿಮ್ಮ ಟ್ಯಾಪ್‌ನೊಂದಿಗೆ ನಾನು ಇಲ್ಲಿಂದ ಬಿಗಿಗೊಳಿಸಬಲ್ಲೆ ಮಾತ್ರ.",
};

/** The one fixed line when a card's yes finds the limit is no longer tightened by the value (another change landed first). */
export const NOT_TIGHTER_REFUSAL: Record<Language, string> = {
  en: "That value no longer tightens the limit in force now, so nothing was changed. Loosening is done in your own app, with your passkey.",
  hi: "यह मान अब लागू सीमा को कसता नहीं, इसलिए कुछ नहीं बदला। ढीला करना आपके अपने ऐप में पासकी से होता है।",
  ml: "ഈ മൂല്യം ഇപ്പോൾ പ്രാബല്യത്തിലുള്ള പരിധിയെ കർശനമാക്കുന്നില്ല, അതിനാൽ ഒന്നും മാറ്റിയില്ല. അയവ് വരുത്തുന്നത് നിങ്ങളുടെ സ്വന്തം ആപ്പിൽ പാസ്‌കീ ഉപയോഗിച്ചാണ്.",
  kn: "ಈ ಮೌಲ್ಯ ಈಗ ಜಾರಿಯಲ್ಲಿರುವ ಮಿತಿಯನ್ನು ಬಿಗಿಗೊಳಿಸುವುದಿಲ್ಲ, ಆದ್ದರಿಂದ ಏನೂ ಬದಲಾಗಲಿಲ್ಲ. ಸಡಿಲಗೊಳಿಸುವುದು ನಿಮ್ಮ ಸ್ವಂತ ಆ್ಯಪ್‌ನಲ್ಲಿ ಪಾಸ್‌ಕೀಯಿಂದ ಆಗುತ್ತದೆ.",
};

// ---- reading the owner's words ------------------------------------------------------------------------------------------------------------------------------

export type LimitRead =
  | { kind: "ok"; limit: ChatLimit; to: number }
  | { kind: "need_value"; limit: ChatLimit }
  | { kind: "which" };

/** Phrasing that says "a limit" without the word: "above", "more than", "at most", "a day", in the four languages. */
const PHRASING = wordRe(["above", "over", "more than", "exceeding", "exceeds", "at most", "no more than", "up to", "maximum", "max", "a day", "per day", "से ऊपर", "से ज़्यादा", "से ज्यादा", "से अधिक", "ज़्यादा से ज़्यादा", "रोज़", "ന് മുകളിൽ", "ന് മേൽ", "ൽ കൂടുതൽ", "പരമാവധി", "ദിവസം", "ಕ್ಕಿಂತ ಹೆಚ್ಚು", "ಗರಿಷ್ಠ", "ದಿನಕ್ಕೆ", "limit", "limits", "सीमा", "लिमिट", "പരിധി", "ലിമിറ്റ്", "ಮಿತಿ", "ಲಿಮಿಟ್"], "iu");

/** What the limits' words say about a limit in this text: each declared limit that is named, with how many of its words are in the text. */
function named(text: string, declared: readonly ChatLimit[]): { limit: ChatLimit; score: number }[] {
  const t = canon(text);
  return declared.map((limit) => ({ limit, score: limit.words.filter((w) => wordRe([w], "iu").test(t)).length })).filter((m) => m.score > 0).sort((a, b) => b.score - a.score);
}

/**
 * Does this look like the owner stating a rule about a limit ("refunds above ₹500 need my OK", "at most 20 orders a day")? The reading in intents.ts asks this before the
 * kind words, so a rule with no case reference is not taken for a refund or a list. It only says "maybe a limit": `readLimitRequest` then decides which one, if any.
 */
export function looksLikeLimitRule(text: string, declared: readonly ChatLimit[]): boolean {
  const t = canon(text);
  return /\d/u.test(t) && PHRASING.test(t) && named(t, declared).length > 0;
}

/**
 * Which declared limit the owner means and what value, from the words alone. An amount needs a rupee sign or word (a bare number is never money); a count is the first
 * whole number left once any amount is taken out. The value is never a model's: `forced` is the limit a talk model named (by id), which only picks among the declared ones.
 */
export function readLimitRequest(text: string, declared: readonly ChatLimit[], forced?: string): LimitRead {
  const t = canon(text);
  const hits = named(t, declared);
  const limit = forced !== undefined ? limitNamed(declared, forced) : hits.length > 0 && (hits.length === 1 || hits[0].score > hits[1].score) ? hits[0].limit : undefined;
  if (!limit) return { kind: "which" };
  if (limit.unit === "inr") {
    const paise = amountOf(t);
    if (paise === undefined || paise % 100 !== 0) return { kind: "need_value", limit };
    return { kind: "ok", limit, to: paise / 100 };
  }
  const count = /(?<![\p{L}\p{N}₹.,])(\d{1,6})(?![\p{N}])/u.exec(t.replace(/(?:₹|rs\.?|inr)\s*[\d,]+/giu, " "));
  return count ? { kind: "ok", limit, to: Number(count[1]) } : { kind: "need_value", limit };
}

// ---- the skill ----------------------------------------------------------------------------------------------------------------------------------------------

export interface LimitsDeps {
  declared: readonly ChatLimit[];
  /** The live settings object the agent reads; what is in force is put into it (limits/chat-limits.ts applyInForce). */
  settings: object;
  store: { assistant?: AssistantState };
  nowMs(): number;
  /** The record's line (the template's writer; the case is none). */
  log(action: string, outcome: Outcome, inputs: unknown, refs: Record<string, string>, notes?: string): void;
}

/** The case reference a limit card carries: "limit:refund_limit". routing.refs matches it, so the one card path finds the skill. */
export const limitCase = (id: string): string => `limit:${id}`;

export function createLimits(d: LimitsDeps) {
  const base = limitBase(d.declared, d.settings);
  const changes = (): LimitChange[] => assistantOf(d.store).limitChanges;
  const inForceNow = (l: ChatLimit): number | undefined => (base[l.id] === undefined ? undefined : inForce(l, base[l.id], changes()));

  /** The chat's check: strictly tighter than what is in force now, inside the hard bounds. */
  function check(l: ChatLimit, to: number) {
    if (base[l.id] === undefined) return { ok: false as const, why: "not_whole" as const, from: 0 };
    return judgeChange(l, { settings: d.settings, base: base[l.id], changes: changes(), to, direction: "tighten" });
  }

  const skill: OwnerSkill = {
    name: "limits",
    routing: { refs: /^limit:[a-z_]+$/u, buttonPrefixes: [], words: {}, liveCaseOf: () => undefined },
    waiting: () => [],
    problems: () => 0,
    prepare(p: Proposal): Prepared {
      if (p.kind !== "limit") return { ok: false, why: "not_here" };
      const l = limitNamed(d.declared, p.case.slice("limit:".length));
      if (!l) return { ok: false, why: "no_case" };
      const r = check(l, p.to);
      if (!r.ok) return { ok: false, why: "limit_not_tighter" };
      const action: CardAction = { kind: "limit", skill: "limits", case: p.case, fields: { limit: l.id, path: l.path, now: r.from, to: p.to } };
      return { ok: true, action, shown: { who: "", what: l.id, amountPaise: l.unit === "inr" ? p.to * 100 : 0, limit: { ...viewOf(l), now: r.from, to: p.to } } };
    },
    async execute(action: CardAction): Promise<Executed> {
      const l = limitNamed(d.declared, String(action.fields.limit));
      const to = Number(action.fields.to);
      if (!l) return { ok: false, note: "failed" };
      // checked again as it is now: the digest matched, but this is the one place a change is made
      const r = check(l, to);
      if (!r.ok) return { ok: false, note: "failed" };
      const s = assistantOf(d.store);
      const change: LimitChange = { id: nextId(s, "l"), limit: l.id, path: l.path, from: r.from, to, direction: "tighten", by: "owner_chat", state: "pending", atMs: d.nowMs() };
      s.limitChanges.push(change);
      applyInForce(d.declared, d.settings, base, s.limitChanges);
      d.log(LIMIT_CHANGE_ACTION, "unconfirmed", { limit: l.id }, { limit: l.id, path: l.path, change: change.id, from: String(r.from), to: String(to), direction: "tighten", by: "owner_chat", state: "pending" },
        "the owner tapped yes; the runtime obeys the tighter value now and the deployer is asked to put it in the settings Guard's spec is made from");
      return { ok: true, note: "done" };
    },
  };

  /** What to tell the owner about a request, before any card: undefined when a card can be made. */
  function say(read: LimitRead): LimitSay | undefined {
    if (read.kind === "which") return { what: "which", limits: d.declared.map(viewOf) };
    if (read.kind === "need_value") return { what: "need_value", limit: viewOf(read.limit) };
    const r = check(read.limit, read.to);
    if (r.ok) return undefined;
    return r.why === "not_tighter" ? { what: "not_tighter", limit: viewOf(read.limit), now: r.from, to: read.to } : { what: "which", limits: d.declared.map(viewOf) };
  }

  /** Changes that settled since the owner was last told, each with the words; marked told. Called on the beat (conversation.ts onTick). */
  function unannounced(): { change: LimitChange; say: LimitSay }[] {
    const out: { change: LimitChange; say: LimitSay }[] = [];
    for (const c of changes()) {
      if (c.state === "pending" || c.told) continue;
      const l = limitNamed(d.declared, c.limit);
      if (!l) { c.told = true; continue; }
      c.told = true;
      out.push({ change: c, say: c.state === "active" ? { what: "active", limit: viewOf(l), to: c.to } : { what: "failed", limit: viewOf(l), from: c.from, ...(c.why ? { why: c.why } : {}) } });
    }
    return out;
  }

  return { skill, read: (text: string, forced?: string) => readLimitRequest(text, d.declared, forced), say, unannounced, inForceNow, declared: d.declared, looksLikeRule: (text: string) => looksLikeLimitRule(text, d.declared) };
}
export type Limits = ReturnType<typeof createLimits>;
