// The cost meter's counting (B45): from a shop's record entries to cumulative totals, as counts. Pure: no files, no clock, nothing from the pathway.
// It runs inside the export job (backup/export.ts), which already reads every record entry of every shop every 15 minutes, so it needs no change to the
// runtime. The totals go into status/<shop>.json under `usage`; ops turns them into the heartbeat's deltas (services/heartbeat.ts).
//
// COUNTS ONLY. Nothing here reads a message's words: an entry's `inputsDigest`, `notes` and `conversation` are never looked at, and the result holds numbers.
//
// What it reads is deliberately narrow, and the two adapters below are the ONLY places that know the record's field names:
//   understandingOf(entry)   the fields the `understanding` branch (templates/commerce/bookings) adds to the record for each understood message
//   whatsappTypeOf(entry)    which of Meta's three message types an outgoing message is, from what the record already holds today
// Aligned with that branch's real names (5 Nov, when it merged): the pathway writes them in the record entry's `refs`, as strings, so FIELDS.container is "refs"
// and the numbers are read from decimal strings. The names are listed in templates/commerce/bookings/Explanation.md, "Understanding record fields (for the cost meter)".

import { LANGUAGES } from "../../modules/language/languages.ts";
import type { Language } from "../../modules/language/languages.ts";

export const STEPS = ["rules", "decision", "model"] as const;
export type Step = (typeof STEPS)[number];

/**
 * THE ONE PLACE THE RECORD'S NEW FIELD NAMES ARE WRITTEN DOWN. The pathway adds, for each understood customer message: the step that read it, the provider and
 * model, the tokens in and out, and the estimated cost in micro-rupees, in the entry's `refs` (the record's existing map of strings; a cost that has no price in the
 * pathway's rate table is left out, and is counted here as `unpriced`: unknown, never 0). They are looked for first inside the object called `container` on the entry, and then on the
 * entry itself. The tests use them through this constant, so a rename here is followed by every test.
 */
export const FIELDS = {
  container: "refs",
  step: "step",
  provider: "provider",
  model: "model",
  inputTokens: "inputTokens",
  outputTokens: "outputTokens",
  costMicroInr: "costMicroInr",
} as const;

/** `costMicroInr` is null when the record gives no usable cost for the message: the call had no price in the rate table, so what it cost is UNKNOWN (never 0). */
export interface Understanding { step: Step; provider?: string; model?: string; inputTokens: number; outputTokens: number; costMicroInr: number | null }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
/** A whole number of 0 or more, as a number or as the decimal string the record's refs hold it in. Anything else is null (never NaN, negative or a fraction). */
const wholeOrNull = (v: unknown): number | null => {
  const n = typeof v === "string" && /^\d{1,15}$/u.test(v) ? Number(v) : v;
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : null;
};
/** A count of tokens: one that is missing or wrong is 0 tokens. (A missing COST is not 0: see costMicroInr.) */
const whole = (v: unknown): number => wholeOrNull(v) ?? 0;

/**
 * What the record says about how one customer message was understood, or undefined when it says nothing usable (an older runtime, a rules-only runtime, a
 * field of the wrong type). Undefined means "the rules read it, for free": the caller counts the message as `rules`. A step this file does not know is
 * undefined too, never guessed. A message with a step but no usable cost has `costMicroInr: null`: unpriced, which the caller counts apart from the spend.
 */
export function understandingOf(entry: unknown): Understanding | undefined {
  if (!isObj(entry)) return undefined;
  const nested = entry[FIELDS.container];
  const knownStep = (o: Record<string, unknown>) => typeof o[FIELDS.step] === "string" && (STEPS as readonly string[]).includes(o[FIELDS.step] as string);
  const source = isObj(nested) && knownStep(nested) ? nested : entry; // a record's refs is always an object, and an older entry's has no step: then the entry itself is looked at
  const step = source[FIELDS.step];
  if (typeof step !== "string" || !(STEPS as readonly string[]).includes(step)) return undefined;
  const text = (v: unknown) => (typeof v === "string" && v.length > 0 && v.length <= 80 ? v : undefined);
  const provider = text(source[FIELDS.provider]);
  const model = text(source[FIELDS.model]);
  return {
    step: step as Step,
    ...(provider ? { provider } : {}), ...(model ? { model } : {}),
    inputTokens: whole(source[FIELDS.inputTokens]), outputTokens: whole(source[FIELDS.outputTokens]), costMicroInr: wholeOrNull(source[FIELDS.costMicroInr]),
  };
}

export type WhatsappType = "service" | "utility" | "marketing";

/**
 * Meta's type of an outgoing message, from what the record holds today (`refs.to`, `refs.templates`): a notice to the owner, or a reminder, is a utility
 * template (charged even inside the 24-hour window); every other reply is a service message (free up to 1,000 a month per number). The monthly report to the
 * owner (B54, `refs.report` = the month) is a message to the owner like any other: its ending entry is counted here as utility, and the claim written before it
 * (outcome `attempted`) is not counted; a test feeds this the entries the job really writes. The record does not say
 * whether the window was open, so an owner's notice sent as plain text inside the owner's window is counted as utility: the estimate leans high, not low.
 * The agent sends no marketing message, so "marketing" is only here for the day a template does. Only a message that was sent counts: `confirmed`, or
 * `unconfirmed` (it left, and the provider's outbox could not be read back); a blocked, failed or held one cost nothing.
 */
export function whatsappTypeOf(entry: unknown): WhatsappType | undefined {
  if (!isObj(entry) || (entry.action !== "send_message" && entry.action !== "voice_note_reply")) return undefined;
  if (entry.outcome !== "confirmed" && entry.outcome !== "unconfirmed") return undefined;
  const refs = isObj(entry.refs) ? entry.refs : {};
  if (refs.channel !== undefined) return undefined; // item 11d: kept for a booking page, never sent on WhatsApp, so never on Meta's bill
  if (refs.to === "owner") return "utility";
  const templates = typeof refs.templates === "string" ? refs.templates.split("+") : [];
  return templates.includes("reminder") ? "utility" : "service";
}

/** A customer's message the agent handled: logged `receive_message`, confirmed. A repeated delivery is logged `blocked` and is not a message. */
export const isCustomerMessage = (entry: unknown): boolean => isObj(entry) && entry.action === "receive_message" && entry.outcome === "confirmed";

// ---- the estimate ------------------------------------------------------------------------------------------------------------------------------------------

/** What the estimate needs from a price list: only these four rates, each in whole micro-rupees or basis points. A rate that is not there is undefined, never 0. */
export interface UsageRates { serviceMicroInr?: number; utilityMicroInr?: number; marketingMicroInr?: number; gstBasisPoints?: number }
/** The shape of a price list that matters here (bundle/panel/cost.ts PriceList satisfies it), so this file needs nothing else. */
export interface RateSource { rates: Record<string, { currency?: string; micro?: number; basisPoints?: number }> }

/** The four rates from the first list that has each one, newest first: the in-force list has the utility and service rates, the proposed one adds marketing and GST. */
export function usageRatesFrom(listsNewestFirst: readonly RateSource[]): UsageRates {
  const micro = (id: string) => { for (const l of listsNewestFirst) { const r = l.rates[id]; if (r && r.currency === "INR" && r.micro !== undefined) return r.micro; } return undefined; };
  const bp = (id: string) => { for (const l of listsNewestFirst) { const r = l.rates[id]; if (r && r.basisPoints !== undefined) return r.basisPoints; } return undefined; };
  return { serviceMicroInr: micro("whatsapp.in.service"), utilityMicroInr: micro("whatsapp.in.utility"), marketingMicroInr: micro("whatsapp.in.marketing"), gstBasisPoints: bp("whatsapp.in.gst") };
}

export interface UsageTotals {
  /** Cumulative over the whole record. */
  messages: number;
  byStep: Record<Step, number>;
  /** What the messages with a price cost. It leaves out the `unpriced` ones, so it is a floor, not the whole spend, whenever `unpriced` is above 0. */
  modelMicroInr: number;
  /**
   * Messages a step read whose cost the record does not give (the call had no price in the rate table). Their cost is unknown, so they are counted here and not as
   * spend. Optional because a status file written before this count has none: absent means "not counted", never "none". It stays in the shop's status file and the
   * panel; the heartbeat does not carry it yet, because fleet refuses a field it does not know (bundle/Deferred.md has the change).
   */
  unpriced?: number;
  whatsapp: {
    service: number; utility: number; marketing: number;
    /** Gross, GST included, before the month's free replies; 0 when `estimated` is false. */
    estMicroInr: number;
    /** False when a rate the counts need is missing from the price lists: the estimate is then 0, never a guess. */
    estimated: boolean;
  };
  /**
   * Monthly reports the owner received (B54): the record's report message, `send_message` with `refs.report` (the month), that WhatsApp showed back (`confirmed`). The
   * certificate document that may follow it (`refs.reportFile`) is not a report. For fleet's First report sent badge (heartbeat `since_last.reports_sent`). Optional
   * because a status file written before this count has none: absent means "not counted", and then the heartbeat leaves the field out.
   */
  reportsSent?: number;
  /**
   * Messages sent to customers (never the owner's), read back from WhatsApp (`confirmed`), by the language they were written in (the record entry's `language`). A UPI
   * QR picture is logged as its own `send_message` beside the words (`refs.image`) and is not counted, so one reply counts once. Sent to fleet as counts
   * (heartbeat `usage.replies_by_language`). Optional, like `reportsSent`.
   */
  repliesByLanguage?: Record<Language, number>;
}

/** The monthly report message to the owner, read back from WhatsApp. */
export const isReportSent = (entry: unknown): boolean => isObj(entry) && entry.action === "send_message" && entry.outcome === "confirmed" && isObj(entry.refs) && typeof entry.refs.report === "string";

/** A message to a customer that WhatsApp showed back, in one of the four languages: its language, or undefined. */
export function replyLanguageOf(entry: unknown): Language | undefined {
  if (!isObj(entry) || (entry.action !== "send_message" && entry.action !== "voice_note_reply") || entry.outcome !== "confirmed") return undefined;
  const refs = isObj(entry.refs) ? entry.refs : {};
  if (refs.to !== "customer" || refs.image !== undefined || refs.channel !== undefined) return undefined; // a picture goes beside the words (the reply counts once); a booking page's words are not WhatsApp replies
  return (LANGUAGES as readonly unknown[]).includes(entry.language) ? (entry.language as Language) : undefined;
}

// Counts a shop's record entries into totals (messages, model use, WhatsApp kinds, languages). Pure so the 15-minute export can call it on every entry without side effects; the rates only price what is counted.
export function summarizeUsage(entries: readonly unknown[], rates: UsageRates): UsageTotals {
  const t: UsageTotals = { messages: 0, byStep: { rules: 0, decision: 0, model: 0 }, modelMicroInr: 0, unpriced: 0, whatsapp: { service: 0, utility: 0, marketing: 0, estMicroInr: 0, estimated: true }, reportsSent: 0, repliesByLanguage: { hi: 0, en: 0, ml: 0, kn: 0 } };
  for (const entry of entries) {
    if (isReportSent(entry)) t.reportsSent = (t.reportsSent ?? 0) + 1;
    const language = replyLanguageOf(entry);
    if (language) t.repliesByLanguage![language]++;
    if (isCustomerMessage(entry)) {
      const u = understandingOf(entry);
      t.messages++;
      t.byStep[u?.step ?? "rules"]++;
      if (u && u.costMicroInr === null) t.unpriced = (t.unpriced ?? 0) + 1; // unknown, never 0: counted apart, so the meter can say "and N calls with no price"
      else t.modelMicroInr += u?.costMicroInr ?? 0; // no understanding at all: the rules read it, for free
      continue;
    }
    const type = whatsappTypeOf(entry);
    if (type) t.whatsapp[type]++;
  }
  t.whatsapp = { ...t.whatsapp, ...estimate(t.whatsapp, rates) };
  return t;
}

function estimate(counts: Record<WhatsappType, number>, rates: UsageRates): { estMicroInr: number; estimated: boolean } {
  const rate: Record<WhatsappType, number | undefined> = { service: rates.serviceMicroInr, utility: rates.utilityMicroInr, marketing: rates.marketingMicroInr };
  const needed = (Object.keys(rate) as WhatsappType[]).filter((k) => counts[k] > 0);
  if (needed.some((k) => rate[k] === undefined) || (needed.length > 0 && rates.gstBasisPoints === undefined)) return { estMicroInr: 0, estimated: false };
  const net = needed.reduce((sum, k) => sum + BigInt(counts[k]) * BigInt(rate[k] as number), 0n);
  const gross = (net * (10_000n + BigInt(rates.gstBasisPoints ?? 0)) + 9_999n) / 10_000n; // rounded up once
  return { estMicroInr: gross > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(gross), estimated: true };
}
