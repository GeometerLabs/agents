// What a call costs, from a small dated rate table. Prices are US dollars per million tokens, from the economics note (docs/product/
// economics-and-pricing.md section 3.2, which took them from third-party trackers and the Laya page: check each provider's own price page before
// a real invoice). An estimate is not a bill: the provider's own invoice is the truth, and this is for the allowance and the cost meter.
//
// Money is counted in micro-rupees (millionths of a rupee) so small prices stay whole numbers: one DeepSeek call of 2,000 tokens in and 150 out
// is about 34,000 micro-rupees (3.4 paise). A price that is not in the table is UNKNOWN (null), never 0: a free-looking number would hide a cost.
// A rate is used from its `from` date until a later rate for the same provider and model replaces it, so an old record keeps the price it had.
import type { TokenUsage } from "./model.ts";

/** Rupees per US dollar, from the economics note's own arithmetic (₹0.0055 for 1,500 tokens at $0.042 a million, ₹0.034 for a 2,000 + 150 token call). */
export const INR_PER_USD = { rate: 87, from: "2026-11-05", note: "the exchange rate the economics note used; change it here when the owner updates that note" } as const;

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
  source: string;
}

export const RATES: readonly Rate[] = [
  { provider: "rules", model: "*", from: "2026-11-05", inputUsdPerMillion: 0, outputUsdPerMillion: 0, source: "the rule parser runs inside the agent and costs nothing per message" },
  { provider: "laya", model: "*", from: "2026-11-05", inputUsdPerMillion: 0, outputUsdPerMillion: 0, source: "Laya runs on the shop server's own CPU (economics section 3.2): no price per call, only the server it already uses" },
  { provider: "jev", model: "*", from: "2026-11-05", inputUsdPerMillion: 0.042, outputUsdPerMillion: 0.042, source: "$0.042 per million tokens, as quoted on the Laya page (economics section 3.2)" },
  { provider: "deepinfra", model: /deepseek.*v4\.1.*flash/iu, from: "2026-11-05", inputUsdPerMillion: 0.16, outputUsdPerMillion: 0.48, cachedInputUsdPerMillion: 0.004, source: "DeepSeek V4.1 Flash, DeepInfra Flex tier (economics section 3.2); check deepinfra.com before choosing" },
];

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
  return Math.max(0, Math.ceil(microUsd * INR_PER_USD.rate - 1e-9));
}
