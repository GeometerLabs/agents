// The monthly running-cost line for one shop (B26), in the rules the owner's Lorelei project uses for its cost calculator:
//  - exact arithmetic: every amount is a whole number of micropaise (a millionth of a paisa) in a BigInt, so INR 0.115 a message is 11,500,000
//    and nothing is a floating-point guess; each line is rounded UP once, to the next whole paisa, and the total is the sum of those lines;
//  - an unknown price is "unknown", never INR 0: a line whose price is missing has no amount and the total says it is a subtotal;
//  - "early estimate" until the record has real usage;
//  - prices come from a dated, versioned file (bundle/prices/<date>.json) that says where every rate was read and how sure we are.
// This file has no words in any language: it returns the numbers and the reasons, and views.ts says them in the shop's language.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import type { Settings } from "../../pathways/bookings/src/settings.ts";

export const QUALITIES = ["assumed", "conflicting", "second-hand", "official-undated", "official"] as const; // weakest first
export type Quality = (typeof QUALITIES)[number];
export type Currency = "INR" | "USD" | "EUR";

export interface Rate {
  currency?: Currency;
  /** Whole micro-units of `currency` (1,000,000 = one rupee, dollar or euro) for `per`. */
  micro?: number;
  basisPoints?: number;
  per: string;
  freePerMonth?: number;
  quality: Quality;
  source: string;
  read: string;
  note: string;
}
export interface Exchange { paisePerUnit: number; quality: Quality; source: string; read: string; note: string }
export interface PriceList { date: string; file: string; sha256: string; rates: Record<string, Rate>; exchange: Partial<Record<Currency, Exchange>> }

export const PRICES_DIR = new URL("../prices/", import.meta.url);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/u;
const isWhole = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const goodSource = (s: unknown) => typeof s === "string" && (/^https:\/\/\S+$/u.test(s) || /^docs\//u.test(s));

/** Read and check one price list. The file name is its date, and the date inside must say the same, so a copied-and-edited file is caught. */
export function loadPriceList(file: string): PriceList {
  const text = readFileSync(file, "utf8");
  let raw: unknown;
  try { raw = JSON.parse(text); } catch (e) { throw new Error(`The price list ${file} is not valid JSON: ${(e as Error).message}`); }
  const problems: string[] = [];
  if (!isObj(raw) || raw.format !== "geometer-price-list/1") throw new Error(`${file} is not a Geometer price list (format "geometer-price-list/1").`);
  const nameDate = /^(\d{4}-\d{2}-\d{2})\.json$/u.exec(basename(file))?.[1];
  if (!nameDate || raw.date !== nameDate) problems.push(`its date ${JSON.stringify(raw.date)} must equal the date in its file name (${nameDate ?? "YYYY-MM-DD.json"})`);
  const rates = isObj(raw.rates) ? raw.rates : {};
  const checkOne = (id: string, r: unknown, exchange: boolean) => {
    if (!isObj(r)) { problems.push(`${id} must be an object`); return; }
    if (!(QUALITIES as readonly string[]).includes(r.quality as string)) problems.push(`${id} must say how sure we are (quality: ${QUALITIES.join(", ")})`);
    if (!goodSource(r.source)) problems.push(`${id} must say where it was read (an https address, or a docs/ path for a Geometer document)`);
    if (typeof r.read !== "string" || !ISO_DAY.test(r.read)) problems.push(`${id} must say the day it was read (YYYY-MM-DD)`);
    if (typeof r.note !== "string" || r.note.trim() === "") problems.push(`${id} needs a note`);
    if (exchange) { if (!isWhole(r.paisePerUnit) || r.paisePerUnit === 0) problems.push(`${id} needs paisePerUnit, a whole number above zero`); return; }
    const money = r.currency !== undefined || r.micro !== undefined;
    if (money === (r.basisPoints !== undefined)) problems.push(`${id} must have either a currency and micro amount or basisPoints, not both and not neither`);
    if (money && (!["INR", "USD", "EUR"].includes(r.currency as string) || !isWhole(r.micro))) problems.push(`${id} needs a currency (INR, USD or EUR) and a whole micro amount`);
    if (r.basisPoints !== undefined && !isWhole(r.basisPoints)) problems.push(`${id} needs basisPoints as a whole number`);
    if (typeof r.per !== "string") problems.push(`${id} must say what it is per`);
  };
  for (const [id, r] of Object.entries(rates)) checkOne(id, r, false);
  const exchange = isObj(raw.exchange) ? raw.exchange : {};
  for (const [id, r] of Object.entries(exchange)) checkOne(`exchange.${id}`, r, true);
  if (problems.length > 0) throw new Error(`The price list ${basename(file)} needs fixing:\n- ${problems.join("\n- ")}`);
  return { date: raw.date as string, file, sha256: createHash("sha256").update(text).digest("hex"), rates: rates as Record<string, Rate>, exchange: exchange as PriceList["exchange"] };
}

/** The newest price list in a folder (the file names are dates). */
export function latestPriceList(dir: string = PRICES_DIR.pathname): PriceList {
  const files = readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/u.test(f)).sort();
  if (files.length === 0) throw new Error(`There is no price list in ${dir}. Cost lines cannot be worked out without one.`);
  return loadPriceList(join(dir, files[files.length - 1]));
}

// ---- the arithmetic -----------------------------------------------------------------------------------------------------

const MICRO = 1_000_000n; // micropaise in one paisa
const ceilDiv = (a: bigint, b: bigint): bigint => (a + b - 1n) / b;

/** One rate as micropaise per its unit, or null when the list cannot say it in rupees (a dollar price with no exchange rate in the list). */
export function microPaise(list: PriceList, id: string): { value: bigint; quality: Quality; assumedRate: boolean } | null {
  const r = list.rates[id];
  if (!r || r.micro === undefined || r.currency === undefined) return null;
  if (r.currency === "INR") return { value: BigInt(r.micro) * 100n, quality: r.quality, assumedRate: false }; // 1 micro-rupee = 100 micropaise
  const ex = list.exchange[r.currency];
  if (!ex) return null;
  return { value: BigInt(r.micro) * BigInt(ex.paisePerUnit), quality: weakest(r.quality, ex.quality), assumedRate: ex.quality === "assumed" };
}

function weakest(...q: Quality[]): Quality {
  return q.reduce((a, b) => (QUALITIES.indexOf(a) <= QUALITIES.indexOf(b) ? a : b));
}

export const paiseOf = (micro: bigint): number => Number(ceilDiv(micro, MICRO));

/** "₹188.80", "₹1,25,000.00": paise as rupees with Indian grouping. */
export function formatRupees(paise: number): string {
  const rupees = Math.floor(paise / 100);
  const rest = String(paise % 100).padStart(2, "0");
  return `₹${rupees.toLocaleString("en-IN")}.${rest}`;
}

// ---- the line ---------------------------------------------------------------------------------------------------------------

export interface Assumptions {
  /** How many bookings a month, until the record has real ones. */
  bookingsPerMonth: number;
  /** Replies the agent sends inside the 24-hour window for one booking (service messages). */
  serviceRepliesPerBooking: number;
  /** Notices to the owner as templates, per booking (a held refund, a late cancellation, a calendar problem). */
  ownerNoticesPerBooking: number;
  /** Customer messages the model reads for one booking. */
  modelCallsPerBooking: number;
  modelInputTokensPerCall: number;
  modelOutputTokensPerCall: number;
}

/** Ours, except the token counts, which are the research's example of a booking message (600 in, 100 out). Said on the page as assumptions. */
export const DEFAULT_ASSUMPTIONS: Assumptions = {
  bookingsPerMonth: 40, serviceRepliesPerBooking: 6, ownerNoticesPerBooking: 1, modelCallsPerBooking: 6, modelInputTokensPerCall: 600, modelOutputTokensPerCall: 100,
};

export interface CostInput {
  settings: Settings;
  /** Bookings counted from the record this month. Left out: the line is an early estimate from `assumptions.bookingsPerMonth`. */
  observedBookings?: number;
  assumptions?: Partial<Assumptions>;
  /** The model the server's model Guard allows (priced as model.<name>.input and .output). Left out, or not in the price list: unknown. */
  model?: string;
  /** What the model costs the shop's plan before it is passed through, in paise a month. Left out: unknown (nobody has set the allowance). */
  modelAllowancePaise?: number;
  /** "gupshup" or "360dialog". Left out: the provider's own fee is unknown. */
  whatsappProvider?: string;
  /** This shop's share of the server, in paise a month. Left out: unknown until the bundle measures it. */
  hostingSharePaise?: number;
}

export type LineId = "whatsapp" | "whatsapp-provider" | "model" | "razorpay" | "hosting";
export type LineState = "amount" | "included" | "unknown";
export type Payer = "passed-through" | "shop-pays-razorpay" | "hosting";
export type Caveat =
  | "early-estimate" | "assumed-exchange-rate" | "provider-not-chosen" | "provider-not-priced" | "allowance-not-set" | "model-not-priced" | "hosting-not-measured"
  | "payment-link-fee-conflict" | "whatsapp-rate-second-hand";

export interface CostLine {
  id: LineId;
  payer: Payer;
  state: LineState;
  /** Whole paise, rounded up once. Null exactly when the state is "unknown". 0 when "included". */
  paise: number | null;
  /** For an "unknown" model line or an "included" one: what the usage would cost before the allowance, when it can be worked out. */
  usagePaise?: number;
  /** The numbers behind it (counts, never money), so "Show what we did" can list them. */
  quantities: Record<string, number>;
  /** The price-list rates it used. */
  uses: string[];
  /** The least sure rate it used. */
  quality: Quality | null;
}

export interface MonthlyCost {
  priceList: { date: string; sha256: string };
  basis: "early-estimate" | "from-record";
  bookings: number;
  assumptions: Assumptions;
  lines: CostLine[];
  /** The sum of the known lines. `complete` is false when a line is unknown: then it is a subtotal and must be called one. */
  total: { paise: number; complete: boolean; unknown: LineId[] };
  caveats: Caveat[];
}

const need = (n: number | undefined, fallback: number): number => (n !== undefined && Number.isSafeInteger(n) && n >= 0 ? n : fallback);

export function monthlyCost(input: CostInput, prices: PriceList): MonthlyCost {
  const a: Assumptions = { ...DEFAULT_ASSUMPTIONS };
  for (const key of Object.keys(DEFAULT_ASSUMPTIONS) as (keyof Assumptions)[]) a[key] = need(input.assumptions?.[key], DEFAULT_ASSUMPTIONS[key]);
  const observed = input.observedBookings !== undefined && Number.isSafeInteger(input.observedBookings) && input.observedBookings >= 0;
  const bookings = BigInt(observed ? (input.observedBookings as number) : a.bookingsPerMonth);
  const reminders = BigInt(input.settings.reminders.hoursBefore.length);
  const caveats = new Set<Caveat>();
  if (!observed) caveats.add("early-estimate");
  const lines: CostLine[] = [];

  const known = (id: LineId, payer: Payer, micro: bigint, quantities: Record<string, number>, uses: string[], quality: Quality, extra: Partial<CostLine> = {}): CostLine =>
    ({ id, payer, state: "amount", paise: paiseOf(micro), quantities, uses, quality, ...extra });
  const unknown = (id: LineId, payer: Payer, quantities: Record<string, number> = {}, uses: string[] = [], extra: Partial<CostLine> = {}): CostLine =>
    ({ id, payer, state: "unknown", paise: null, quantities, uses, quality: null, ...extra });

  // 1. WhatsApp messages, Meta's fee: reminders and owner notices are utility templates; replies inside the window are free up to a monthly number.
  {
    const utility = microPaise(prices, "whatsapp.in.utility");
    const service = microPaise(prices, "whatsapp.in.service");
    const templates = bookings * (reminders + BigInt(a.ownerNoticesPerBooking));
    const replies = bookings * BigInt(a.serviceRepliesPerBooking);
    const free = BigInt(prices.rates["whatsapp.in.service"]?.freePerMonth ?? 0);
    const paidReplies = replies > free ? replies - free : 0n;
    const quantities = { templates: Number(templates), serviceReplies: Number(replies), freeServiceReplies: Number(free), paidServiceReplies: Number(paidReplies) };
    if (!utility || !service) lines.push(unknown("whatsapp", "passed-through", quantities, ["whatsapp.in.utility", "whatsapp.in.service"]));
    else {
      lines.push(known("whatsapp", "passed-through", templates * utility.value + paidReplies * service.value, quantities, ["whatsapp.in.utility", "whatsapp.in.service"], weakest(utility.quality, service.quality)));
      if (QUALITIES.indexOf(weakest(utility.quality, service.quality)) <= QUALITIES.indexOf("second-hand")) caveats.add("whatsapp-rate-second-hand");
    }
  }

  // 2. The WhatsApp provider's own fee: unknown until one is chosen, and unknown if the list cannot say it in rupees.
  {
    const messages = bookings * (2n * BigInt(a.serviceRepliesPerBooking) + reminders + BigInt(a.ownerNoticesPerBooking)); // customers' messages come in about as often as replies go out
    const quantities = { messages: Number(messages) };
    const provider = input.whatsappProvider;
    if (provider === undefined) { lines.push(unknown("whatsapp-provider", "passed-through", quantities)); caveats.add("provider-not-chosen"); }
    else {
      const id = `whatsapp.provider.${provider}`;
      const rate = prices.rates[id];
      const m = microPaise(prices, id);
      if (!rate || !m) { lines.push(unknown("whatsapp-provider", "passed-through", quantities, [id])); caveats.add("provider-not-priced"); }
      else {
        const count = rate.per === "message" ? messages : 1n; // a flat fee per number a month is one number
        lines.push(known("whatsapp-provider", "passed-through", count * m.value, rate.per === "message" ? quantities : { numbers: 1 }, [id], m.quality));
        if (m.assumedRate) caveats.add("assumed-exchange-rate");
      }
    }
  }

  // 3. Model usage against the included allowance.
  {
    const calls = bookings * BigInt(a.modelCallsPerBooking);
    const inTokens = calls * BigInt(a.modelInputTokensPerCall);
    const outTokens = calls * BigInt(a.modelOutputTokensPerCall);
    const quantities = { calls: Number(calls), inputTokens: Number(inTokens), outputTokens: Number(outTokens) };
    const inId = `model.${input.model}.input`;
    const outId = `model.${input.model}.output`;
    const pin = input.model === undefined ? null : microPaise(prices, inId);
    const pout = input.model === undefined ? null : microPaise(prices, outId);
    if (!pin || !pout) { lines.push(unknown("model", "passed-through", quantities, input.model === undefined ? [] : [inId, outId])); caveats.add("model-not-priced"); }
    else {
      const usage = ceilDiv(inTokens * pin.value + outTokens * pout.value, 1_000_000n); // the rates are per million tokens
      const quality = weakest(pin.quality, pout.quality);
      if (pin.assumedRate || pout.assumedRate) caveats.add("assumed-exchange-rate");
      if (input.modelAllowancePaise === undefined) { lines.push(unknown("model", "passed-through", quantities, [inId, outId], { usagePaise: paiseOf(usage), quality })); caveats.add("allowance-not-set"); }
      else {
        const allowance = BigInt(need(input.modelAllowancePaise, 0)) * MICRO;
        const over = usage > allowance ? usage - allowance : 0n;
        lines.push(over === 0n
          ? { id: "model", payer: "passed-through", state: "included", paise: 0, usagePaise: paiseOf(usage), quantities, uses: [inId, outId], quality }
          : known("model", "passed-through", over, quantities, [inId, outId], quality, { usagePaise: paiseOf(usage) }));
      }
    }
  }

  // 4. Razorpay's fee: 2% of each deposit and 18% GST on that fee, paid by the shop to Razorpay, and not returned when the deposit is refunded.
  {
    const fee = prices.rates["razorpay.platform-fee"];
    const gst = prices.rates["razorpay.gst-on-fee"];
    const deposit = BigInt(input.settings.deposit.amountInr) * 100n; // paise
    const quantities = { payments: Number(bookings), depositPaise: Number(deposit) };
    if (!fee?.basisPoints || gst?.basisPoints === undefined) lines.push(unknown("razorpay", "shop-pays-razorpay", quantities, ["razorpay.platform-fee", "razorpay.gst-on-fee"]));
    else {
      // fee = deposit x bps / 10,000; GST = fee x gstBps / 10,000. Kept exact in micropaise: x MICRO first, divide once at the end.
      const bps = BigInt(fee.basisPoints);
      const gstBps = BigInt(gst.basisPoints);
      const exact = (bookings * deposit * bps * (10_000n + gstBps) * MICRO) / (10_000n * 10_000n);
      const quality = weakest(fee.quality, gst.quality);
      lines.push(known("razorpay", "shop-pays-razorpay", exact, quantities, ["razorpay.platform-fee", "razorpay.gst-on-fee"], quality));
      if (fee.quality === "conflicting") caveats.add("payment-link-fee-conflict");
    }
  }

  // 5. This shop's share of the server: a setting until the bundle measures it.
  if (input.hostingSharePaise === undefined) { lines.push(unknown("hosting", "hosting")); caveats.add("hosting-not-measured"); }
  else lines.push({ id: "hosting", payer: "hosting", state: "amount", paise: need(input.hostingSharePaise, 0), quantities: {}, uses: [], quality: null });

  const unknownIds = lines.filter((l) => l.state === "unknown").map((l) => l.id);
  const total = lines.reduce((sum, l) => sum + (l.paise ?? 0), 0);
  return {
    priceList: { date: prices.date, sha256: prices.sha256 },
    basis: observed ? "from-record" : "early-estimate",
    bookings: Number(bookings), assumptions: a, lines, total: { paise: total, complete: unknownIds.length === 0, unknown: unknownIds }, caveats: [...caveats],
  };
}
