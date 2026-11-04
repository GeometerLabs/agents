// The cost meter's counting (B45): from a shop's record entries to cumulative totals, as counts. Pure: no files, no clock, nothing from the pathway.
// It runs inside the export job (backup/export.ts), which already reads every record entry of every shop every 15 minutes, so it needs no change to the
// runtime. The totals go into status/<shop>.json under `usage`; ops turns them into the heartbeat's deltas (services/heartbeat.ts).
//
// COUNTS ONLY. Nothing here reads a message's words: an entry's `inputsDigest`, `notes` and `conversation` are never looked at, and the result holds numbers.
//
// What it reads is deliberately narrow, and the two adapters below are the ONLY places that know the record's field names:
//   understandingOf(entry)   the fields the `understanding` branch (pathways/bookings) adds to the record for each understood message
//   whatsappTypeOf(entry)    which of Meta's three message types an outgoing message is, from what the record already holds today
// When that branch merges, align FIELDS (and nothing else) with its real names.

export const STEPS = ["rules", "decision", "model"] as const;
export type Step = (typeof STEPS)[number];

/**
 * THE ONE PLACE THE RECORD'S NEW FIELD NAMES ARE GUESSED. The `understanding` branch adds, for each understood customer message: the step that read it,
 * the provider and model, the tokens in and out, and the estimated cost in micro-rupees. They are looked for first inside an object called `container`
 * on the entry, and then on the entry itself. Align these names at merge; the tests use them through this constant, so they follow.
 */
export const FIELDS = {
  container: "understanding",
  step: "step",
  provider: "provider",
  model: "model",
  inputTokens: "inputTokens",
  outputTokens: "outputTokens",
  costMicroInr: "costMicroInr",
} as const;

export interface Understanding { step: Step; provider?: string; model?: string; inputTokens: number; outputTokens: number; costMicroInr: number }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const whole = (v: unknown): number => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : 0);

/**
 * What the record says about how one customer message was understood, or undefined when it says nothing usable (an older runtime, a rules-only runtime, a
 * field of the wrong type). Undefined means "the rules read it, for free": the caller counts the message as `rules`. A step this file does not know is
 * undefined too, never guessed.
 */
export function understandingOf(entry: unknown): Understanding | undefined {
  if (!isObj(entry)) return undefined;
  const nested = entry[FIELDS.container];
  const source = isObj(nested) ? nested : entry;
  const step = source[FIELDS.step];
  if (typeof step !== "string" || !(STEPS as readonly string[]).includes(step)) return undefined;
  const text = (v: unknown) => (typeof v === "string" && v.length > 0 && v.length <= 80 ? v : undefined);
  const provider = text(source[FIELDS.provider]);
  const model = text(source[FIELDS.model]);
  return {
    step: step as Step,
    ...(provider ? { provider } : {}), ...(model ? { model } : {}),
    inputTokens: whole(source[FIELDS.inputTokens]), outputTokens: whole(source[FIELDS.outputTokens]), costMicroInr: whole(source[FIELDS.costMicroInr]),
  };
}

export type WhatsappType = "service" | "utility" | "marketing";

/**
 * Meta's type of an outgoing message, from what the record holds today (`refs.to`, `refs.templates`): a notice to the owner, or a reminder, is a utility
 * template (charged even inside the 24-hour window); every other reply is a service message (free up to 1,000 a month per number). The record does not say
 * whether the window was open, so an owner's notice sent as plain text inside the owner's window is counted as utility: the estimate leans high, not low.
 * The agent sends no marketing message, so "marketing" is only here for the day a template does. Only a message that was sent counts: `confirmed`, or
 * `unconfirmed` (it left, and the provider's outbox could not be read back); a blocked, failed or held one cost nothing.
 */
export function whatsappTypeOf(entry: unknown): WhatsappType | undefined {
  if (!isObj(entry) || (entry.action !== "send_message" && entry.action !== "voice_note_reply")) return undefined;
  if (entry.outcome !== "confirmed" && entry.outcome !== "unconfirmed") return undefined;
  const refs = isObj(entry.refs) ? entry.refs : {};
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
  modelMicroInr: number;
  whatsapp: {
    service: number; utility: number; marketing: number;
    /** Gross, GST included, before the month's free replies; 0 when `estimated` is false. */
    estMicroInr: number;
    /** False when a rate the counts need is missing from the price lists: the estimate is then 0, never a guess. */
    estimated: boolean;
  };
}

export function summarizeUsage(entries: readonly unknown[], rates: UsageRates): UsageTotals {
  const t: UsageTotals = { messages: 0, byStep: { rules: 0, decision: 0, model: 0 }, modelMicroInr: 0, whatsapp: { service: 0, utility: 0, marketing: 0, estMicroInr: 0, estimated: true } };
  for (const entry of entries) {
    if (isCustomerMessage(entry)) {
      const u = understandingOf(entry);
      t.messages++;
      t.byStep[u?.step ?? "rules"]++;
      t.modelMicroInr += u?.costMicroInr ?? 0;
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
