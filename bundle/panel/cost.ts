// The monthly running-cost line for one shop (B26), in the rules the owner's Lorelei project uses for its cost calculator:
//  - exact arithmetic: every amount is a whole number of micropaise (a millionth of a paisa) in a BigInt, so INR 0.115 a message is 11,500,000
//    and nothing is a floating-point guess; each line is rounded UP once, to the next whole paisa, and the total is the sum of those lines;
//  - an unknown price is "unknown", never INR 0: a line whose price is missing has no amount and the total says it is a subtotal;
//  - "early estimate" until the record has real usage;
//  - prices come from a dated, versioned file (prices/<date>.json at the repo's root, the only place a price is written) that says where every rate was read and how sure we are.
// This file has no words in any language: it returns the numbers and the reasons, and views.ts says them in the shop's language.
import { gatewayOf } from "../../modules/payments/providers/index.ts";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import type { Settings } from "../../templates/commerce/bookings/src/settings.ts";
import type { PlanName } from "./contract.ts";

export const QUALITIES = ["assumed", "conflicting", "second-hand", "official-undated", "official"] as const; // weakest first
export type Quality = (typeof QUALITIES)[number];
export type Currency = "INR" | "USD" | "EUR";

export interface Rate {
  currency?: Currency;
  /** Whole micro-units of `currency` (1,000,000 = one rupee, dollar or euro) for `per`. */
  micro?: number;
  /** A share, in basis points (10,000 = 100%). */
  basisPoints?: number;
  /** A plain whole number (messages a month, shops, places): the one form that is neither money nor a share. */
  count?: number;
  per: string;
  freePerMonth?: number;
  quality: Quality;
  source: string;
  read: string;
  note: string;
}
export interface Exchange { paisePerUnit: number; quality: Quality; source: string; read: string; note: string }
/** "in-force" is what a list without a status means. A "proposed" list waits for the owner's yes: the running-cost line never uses it (latestPriceList), and the panel only shows its plans, labelled proposed. */
export type ListStatus = "in-force" | "proposed";
export interface PriceList { date: string; file: string; sha256: string; status: ListStatus; /** Where the proposal is written (a docs/ path or an https address). Only on a proposed list. */ proposal?: string; rates: Record<string, Rate>; exchange: Partial<Record<Currency, Exchange>> }

/** The repo's one price folder (prices/README.md): every price list, never edited after it is committed. */
export const PRICES_DIR = new URL("../../prices/", import.meta.url);

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
    if ([money, r.basisPoints !== undefined, r.count !== undefined].filter(Boolean).length !== 1) problems.push(`${id} must have exactly one of: a currency and micro amount, basisPoints, or count`);
    if (money && (!["INR", "USD", "EUR"].includes(r.currency as string) || !isWhole(r.micro))) problems.push(`${id} needs a currency (INR, USD or EUR) and a whole micro amount`);
    if (r.basisPoints !== undefined && !isWhole(r.basisPoints)) problems.push(`${id} needs basisPoints as a whole number`);
    if (r.count !== undefined && !isWhole(r.count)) problems.push(`${id} needs count as a whole number`);
    if (typeof r.per !== "string") problems.push(`${id} must say what it is per`);
  };
  for (const [id, r] of Object.entries(rates)) checkOne(id, r, false);
  const exchange = isObj(raw.exchange) ? raw.exchange : {};
  for (const [id, r] of Object.entries(exchange)) checkOne(`exchange.${id}`, r, true);
  if (raw.status !== undefined && raw.status !== "in-force" && raw.status !== "proposed") problems.push('its status must be "in-force" or "proposed" (leave it out for in-force)');
  if (raw.status === "proposed" && !goodSource(raw.proposal)) problems.push("a proposed list must say where the proposal is written (proposal: an https address, or a docs/ path)");
  if (raw.status !== "proposed" && raw.proposal !== undefined) problems.push("only a proposed list has a proposal");
  if (problems.length > 0) throw new Error(`The price list ${basename(file)} needs fixing:\n- ${problems.join("\n- ")}`);
  const status: ListStatus = raw.status === "proposed" ? "proposed" : "in-force";
  return { date: raw.date as string, file, sha256: createHash("sha256").update(text).digest("hex"), status, ...(status === "proposed" ? { proposal: raw.proposal as string } : {}), rates: rates as Record<string, Rate>, exchange: exchange as PriceList["exchange"] };
}

const listFiles = (dir: string): string[] => readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/u.test(f)).sort();

/** The newest price list in a folder (the file names are dates) that is NOT proposed. A proposal never prices a shop's running costs until the owner says yes, so decision 13's flat fee stays live. */
export function latestPriceList(dir: string = PRICES_DIR.pathname): PriceList {
  const files = listFiles(dir);
  if (files.length === 0) throw new Error(`There is no price list in ${dir}. Cost lines cannot be worked out without one.`);
  for (const file of files.reverse()) {
    const list = loadPriceList(join(dir, file));
    if (list.status !== "proposed") return list;
  }
  throw new Error(`Every price list in ${dir} is only proposed. Cost lines need one that is in force.`);
}

/** The newest proposed list that is dated after the in-force one, or null. The panel shows a shop's plan from it, labelled proposed. */
export function latestProposedPriceList(dir: string = PRICES_DIR.pathname): PriceList | null {
  const inForce = latestPriceList(dir);
  const newest = listFiles(dir).at(-1);
  if (newest === undefined || newest.slice(0, -".json".length) <= inForce.date) return null;
  const list = loadPriceList(join(dir, newest));
  return list.status === "proposed" ? list : null;
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

/**
 * What Geometer charges for one shop a month, before GST, from the price list: the one rule the shop page's cost line (monthlyCost), its plan block (plan.ts) and
 * the health page (health.ts) all use, so the three agree. Two price lists (owner, 9 Nov): a shop on Geometer's server pays its plan's fee (`plan.<plan>.fee`;
 * a list older than the plans has the flat `geometer.fee` instead); a shop on a builder's own server pays the builder licence (`licence.builder.fee`), whatever
 * its plan. The licence is per live client business, and fleet bills it once for the shops a builder groups into one business; the panel cannot see that
 * grouping, so it counts each shop as its own business, as fleet does for a shop with none named. `id` is the rate it used or would use; `fee` is null when
 * the list does not have it (unknown, never INR 0, and a builder is never shown a plan fee instead), and there is no id when a hosted shop has no plan.
 */
export function chargeOf(prices: PriceList, plan: PlanName | null, builder: boolean): { id: string; licence: boolean; fee: ReturnType<typeof microPaise> } | null {
  if (builder) return { id: "licence.builder.fee", licence: true, fee: microPaise(prices, "licence.builder.fee") };
  if (!plan) return null;
  const planId = `plan.${plan}.fee`;
  const id = prices.rates[planId] ? planId : prices.rates["geometer.fee"] ? "geometer.fee" : planId;
  return { id, licence: false, fee: microPaise(prices, id) };
}

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
}

/** Ours. Said on the page as assumptions. */
export const DEFAULT_ASSUMPTIONS: Assumptions = { bookingsPerMonth: 40, serviceRepliesPerBooking: 6, ownerNoticesPerBooking: 1 };

/** What the shop's agent does decides the plan: it takes a deposit (and so gives refunds), which is Business; or no money moves, which is Basic. Operations is fleet's call. */
export function planFromSettings(settings: Settings): "basic" | "business" {
  return settings.deposit && settings.deposit.amountInr > 0 ? "business" : "basic";
}

export interface CostInput {
  settings: Settings;
  /** The plan fleet reports for this shop. Left out: worked out from the settings (planFromSettings). */
  plan?: PlanName;
  /** The shop runs on a builder's own server: Geometer's line is the builder licence, whatever the plan (chargeOf). */
  builder?: boolean;
  /** Bookings counted from the record this month. Left out: the line is an early estimate from `assumptions.bookingsPerMonth`. */
  observedBookings?: number;
  assumptions?: Partial<Assumptions>;
  /** "gupshup" or "360dialog". Left out: the provider's own fee is unknown. */
  whatsappProvider?: string;
  /** This shop's share of the server, in paise a month. Left out: unknown until the bundle measures it. */
  hostingSharePaise?: number;
}

export type LineId = "whatsapp" | "whatsapp-provider" | "gateway" | "geometer" | "hosting";
export type LineState = "amount" | "unknown";
/** Who pays whom. Geometer passes nothing through: its own line is the shop's plan (the AI model is in it, up to the allowance), and it never handles anyone else's money. */
export type Payer = "builder-pays-whatsapp-provider" | "shop-pays-gateway" | "builder-pays-geometer" | "builder-pays-licence" | "hosting";
export type Caveat =
  | "early-estimate" | "assumed-exchange-rate" | "provider-not-chosen" | "provider-not-priced" | "fee-not-priced" | "hosting-not-measured"
  | "payment-link-fee-conflict" | "whatsapp-rate-second-hand" | "no-gateway-fee";

export interface CostLine {
  id: LineId;
  payer: Payer;
  state: LineState;
  /** Whole paise, rounded up once. Null exactly when the state is "unknown". */
  paise: number | null;
  /** The numbers behind it (counts, never money), so "Show what we did" can list them. */
  quantities: Record<string, number>;
  /** The price-list rates it used. */
  uses: string[];
  /** The least sure rate it used. */
  quality: Quality | null;
  /** Only on Geometer's line, when it is priced from a plan. */
  plan?: PlanName;
  /** Only on Geometer's line, when it is the builder licence (a shop on a builder's own server). */
  licence?: true;
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
  /** The shop's gateway by its own display name (B71), for the words that name it ("{gateway}'s fee"); left out for a shop with none. */
  gateway?: string;
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

  const known = (id: LineId, payer: Payer, micro: bigint, quantities: Record<string, number>, uses: string[], quality: Quality): CostLine =>
    ({ id, payer, state: "amount", paise: paiseOf(micro), quantities, uses, quality });
  const unknown = (id: LineId, payer: Payer, quantities: Record<string, number> = {}, uses: string[] = []): CostLine =>
    ({ id, payer, state: "unknown", paise: null, quantities, uses, quality: null });

  // 1. WhatsApp messages, Meta's fee: reminders and owner notices are utility templates; replies inside the window are free up to a monthly number.
  {
    const utility = microPaise(prices, "whatsapp.in.utility");
    const service = microPaise(prices, "whatsapp.in.service");
    const templates = bookings * (reminders + BigInt(a.ownerNoticesPerBooking));
    const replies = bookings * BigInt(a.serviceRepliesPerBooking);
    const free = BigInt(prices.rates["whatsapp.in.service"]?.freePerMonth ?? 0);
    const paidReplies = replies > free ? replies - free : 0n;
    const quantities = { templates: Number(templates), serviceReplies: Number(replies), freeServiceReplies: Number(free), paidServiceReplies: Number(paidReplies) };
    if (!utility || !service) lines.push(unknown("whatsapp", "builder-pays-whatsapp-provider", quantities, ["whatsapp.in.utility", "whatsapp.in.service"]));
    else {
      lines.push(known("whatsapp", "builder-pays-whatsapp-provider", templates * utility.value + paidReplies * service.value, quantities, ["whatsapp.in.utility", "whatsapp.in.service"], weakest(utility.quality, service.quality)));
      if (QUALITIES.indexOf(weakest(utility.quality, service.quality)) <= QUALITIES.indexOf("second-hand")) caveats.add("whatsapp-rate-second-hand");
    }
  }

  // 2. The WhatsApp provider's own fee: unknown until one is chosen, and unknown if the list cannot say it in rupees.
  {
    const messages = bookings * (2n * BigInt(a.serviceRepliesPerBooking) + reminders + BigInt(a.ownerNoticesPerBooking)); // customers' messages come in about as often as replies go out
    const quantities = { messages: Number(messages) };
    const provider = input.whatsappProvider;
    if (provider === undefined) { lines.push(unknown("whatsapp-provider", "builder-pays-whatsapp-provider", quantities)); caveats.add("provider-not-chosen"); }
    else {
      const id = `whatsapp.provider.${provider}`;
      const rate = prices.rates[id];
      const m = microPaise(prices, id);
      if (!rate || !m) { lines.push(unknown("whatsapp-provider", "builder-pays-whatsapp-provider", quantities, [id])); caveats.add("provider-not-priced"); }
      else {
        const count = rate.per === "message" ? messages : 1n; // a flat fee per number a month is one number
        lines.push(known("whatsapp-provider", "builder-pays-whatsapp-provider", count * m.value, rate.per === "message" ? quantities : { numbers: 1 }, [id], m.quality));
        if (m.assumedRate) caveats.add("assumed-exchange-rate");
      }
    }
  }

  // 3. The gateway's fee, for a shop that chose one (B71): its folder names the price list's ids (for one: a share of each deposit and GST on that fee, paid by the
  // shop to the gateway, not returned when the deposit is refunded). A UPI shop (B33) pays customers' money straight to its own UPI ID: no gateway, so no line, and a note.
  const gateway = gatewayOf(input.settings.payment);
  if (!gateway) caveats.add("no-gateway-fee");
  else {
    const [feeId, gstId] = gateway.gateway!.feeRates;
    const fee = prices.rates[feeId];
    const gst = prices.rates[gstId];
    const deposit = BigInt(input.settings.deposit.amountInr) * 100n; // paise
    const quantities = { payments: Number(bookings), depositPaise: Number(deposit) };
    if (!fee?.basisPoints || gst?.basisPoints === undefined) lines.push(unknown("gateway", "shop-pays-gateway", quantities, [feeId, gstId]));
    else {
      // fee = deposit x bps / 10,000; GST = fee x gstBps / 10,000. Kept exact in micropaise: x MICRO first, divide once at the end.
      const bps = BigInt(fee.basisPoints);
      const gstBps = BigInt(gst.basisPoints);
      const exact = (bookings * deposit * bps * (10_000n + gstBps) * MICRO) / (10_000n * 10_000n);
      const quality = weakest(fee.quality, gst.quality);
      lines.push(known("gateway", "shop-pays-gateway", exact, quantities, [feeId, gstId], quality));
      if (fee.quality === "conflicting") caveats.add("payment-link-fee-conflict");
    }
  }

  // 4. Geometer's line for this shop (chargeOf): on Geometer's server, the shop's plan, one monthly amount before GST with the AI model in it up to the plan's
  // allowance (extra messages and WhatsApp are passed on from the partner's balance and are not in this line); on a builder's own server, the builder licence,
  // whatever the plan, with the builder's own AI key. It does not depend on bookings. The plan is the one fleet reports, or else the one the shop's settings point
  // to: a deposit means Business, no money moving means Basic. It is read from the price list like every other rate, so a changed price is a new list. A list
  // without the rate makes the line unknown, never INR 0.
  {
    const plan = input.plan ?? planFromSettings(input.settings);
    const charge = chargeOf(prices, plan, input.builder === true);
    const payer: Payer = charge?.licence ? "builder-pays-licence" : "builder-pays-geometer";
    const tags = { ...(charge?.licence ? { licence: true as const } : charge?.id === "geometer.fee" ? {} : { plan }) };
    if (!charge?.fee) { lines.push({ ...unknown("geometer", payer, { shops: 1 }, [charge?.id ?? `plan.${plan}.fee`]), ...tags }); caveats.add("fee-not-priced"); }
    else {
      lines.push({ ...known("geometer", payer, charge.fee.value, { shops: 1 }, [charge.id], charge.fee.quality), ...tags });
      if (charge.fee.assumedRate) caveats.add("assumed-exchange-rate");
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
    bookings: Number(bookings), assumptions: a, lines, total: { paise: total, complete: unknownIds.length === 0, unknown: unknownIds }, caveats: [...caveats], ...(gateway ? { gateway: gateway.displayName } : {}),
  };
}
