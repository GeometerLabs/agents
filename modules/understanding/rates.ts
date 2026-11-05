// What a call costs, from the one dated table of model prices in rates/<date>.json. Prices are US dollars per million tokens, from the economics note
// (docs/product/economics-and-pricing.md section 3.2, which took them from third-party trackers and the Laya page) and, for the models the evaluation tries,
// from each provider's own page: check the provider's price page before a real invoice. An estimate is not a bill: the provider's own invoice is the truth, and
// this is for the allowance and the cost meter.
//
// The table is data, not code, and there is ONE of it: the runtime prices messages from it, the evaluation script prints its cost column from it, and the bundle's
// tests check every model price in a bundle price list against it. A file in rates/ is never edited after it is committed (a test pins its bytes): a changed price is
// a new file with a new date, and an old record keeps the price it had.
//
// Money is counted in micro-rupees (millionths of a rupee) so small prices stay whole numbers: one DeepSeek call of 2,000 tokens in and 150 out is about 34,000
// micro-rupees (3.4 paise). A price that is not in the table is UNKNOWN (null), never 0: a free-looking number would hide a cost. A rate is used from its `from`
// date until a later rate for the same provider and model replaces it.
//
// Each file is read with a literal path, one line per file. A test fails if a file in rates/ is not listed here, so a new dated file is added to FILES below in the
// same commit. The checks on a file are in rates-check.ts, so this file stays small. (The browser demo asks no model, so it does not carry this file or the router:
// a template's reading takes `chosenProbability` from model.ts for that reason.)
import { readFileSync } from "node:fs";
import type { Quality } from "./rates-check.ts";
import type { TokenUsage } from "./model.ts";

export interface Rate {
  provider: string;
  /** A model id, exactly; or a pattern, for a provider that renames versions. "*" is every model of the provider. */
  model: string | RegExp;
  /** The first day this price holds, "YYYY-MM-DD". */
  from: string;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  /** The price of input the provider read from its prompt cache, when it has one. */
  cachedInputUsdPerMillion?: number;
  /** Rupees to the dollar for this line, from its file. Left out: the newest file's. */
  inrPerUsd?: number;
  quality?: Quality;
  source: string;
}

/** One file of the table, as the runtime holds it. */
export interface RateList {
  date: string;
  inrPerUsd: number;
  rates: Rate[];
  /** Models a candidate may use that have no price, and why. They stay unknown. */
  notPriced: Record<string, string>;
}

/** One file of the table, as the runtime holds it. A file is checked by rates-check.ts (a test runs every committed file through it), not here. */
function listOf(text: string): RateList {
  const raw = JSON.parse(text) as { date: string; inrPerUsd: { rate: number }; rates: Record<string, string | number>[]; notPriced?: Record<string, string> };
  const rates: Rate[] = raw.rates.map((l) => ({
    provider: l.provider as string, model: l.modelPattern ? new RegExp(l.modelPattern as string, "iu") : (l.model as string), from: raw.date,
    inputUsdPerMillion: l.inputUsdPerMillion as number, outputUsdPerMillion: l.outputUsdPerMillion as number,
    ...(l.cachedInputUsdPerMillion !== undefined ? { cachedInputUsdPerMillion: l.cachedInputUsdPerMillion as number } : {}),
    inrPerUsd: raw.inrPerUsd.rate, quality: l.quality as Quality, source: l.source as string,
  }));
  return { date: raw.date, inrPerUsd: raw.inrPerUsd.rate, rates, notPriced: raw.notPriced ?? {} };
}

// One literal path per file (the browser build copies exactly these). Oldest first.
const FILES: readonly [string, string][] = [
  ["2026-11-05.json", readFileSync(new URL("rates/2026-11-05.json", import.meta.url), "utf8")],
];

/** The files of the table, oldest first. */
export const RATE_LISTS: readonly RateList[] = FILES.map(([name, text]) => {
  const list = listOf(text);
  if (name !== `${list.date}.json`) throw new Error(`modules/understanding/rates/${name} says its date is ${list.date}: a file is named for its date.`);
  return list;
}).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

/** Rupees per US dollar, from the newest file. */
export const INR_PER_USD = { rate: RATE_LISTS[RATE_LISTS.length - 1].inrPerUsd, from: RATE_LISTS[RATE_LISTS.length - 1].date, note: "from the newest file in rates/; change it in a new dated file when the owner updates the economics note" } as const;

export const RATES: readonly Rate[] = RATE_LISTS.flatMap((l) => l.rates);

const matches = (rate: Rate, provider: string, model: string): boolean =>
  rate.provider === provider && (rate.model === "*" || (typeof rate.model === "string" ? rate.model === model : rate.model.test(model)));

/** The rate in force on a day for this provider and model, or null when the table has none. */
export function rateFor(provider: string, model: string, day: string, table: readonly Rate[] = RATES): Rate | null {
  const found = table.filter((r) => matches(r, provider, model) && r.from <= day).sort((a, b) => (a.from < b.from ? 1 : a.from > b.from ? -1 : 0));
  return found[0] ?? null;
}

/** "YYYY-MM-DD" of a moment in UTC. The rate table is dated in days, and a day's edge does not matter for a price. */
export const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** What this call cost in micro-rupees, rounded up to a whole one; null when there is no rate. Cached input is priced at the cached rate when the rate has one. */
export function costMicroInr(rate: Rate | null, usage: TokenUsage): number | null {
  if (!rate) return null;
  const cached = Math.min(usage.cachedInputTokens ?? 0, usage.inputTokens);
  const cachedPrice = rate.cachedInputUsdPerMillion ?? rate.inputUsdPerMillion;
  const microUsd = (usage.inputTokens - cached) * rate.inputUsdPerMillion + cached * cachedPrice + usage.outputTokens * rate.outputUsdPerMillion; // tokens x dollars per million = millionths of a dollar
  return Math.max(0, Math.ceil(microUsd * (rate.inrPerUsd ?? INR_PER_USD.rate) - 1e-9));
}
