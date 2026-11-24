// How many template parts a shop's plan allows (decision 65, owner 24 Nov 2026: "one shop can run several template parts, thats what the higher tier price slab is for"). Which
// slab allows how many parts is NOT decided (docs product/economics-and-pricing.md is the place): this builds no number in. The limit is ONE setting, read where every other
// plan number is read, the price list in force: the rate `plan.<plan>.parts` (a `count`). A list with no such rate, a shop with no plan at fleet (a builder's own server), or a
// plan that is not one: no limit. The deploy (lib/server.ts readShop) and the panel's "add a part" both ask `partsProblem`, the one rule.

/** The part of a price list this needs (bundle/panel/cost.ts PriceList satisfies it). */
export interface PartsRates { rates: Record<string, { count?: number } | undefined> }

/** The number of parts the plan allows, or undefined: no limit. */
export function partsLimitFor(plan: string | null | undefined, list: PartsRates | undefined): number | undefined {
  if (!plan || !list) return undefined;
  const n = list.rates[`plan.${plan}.parts`]?.count;
  return typeof n === "number" && Number.isInteger(n) && n >= 1 ? n : undefined;
}

/** Why `count` parts is one too many for the plan, in plain words; undefined when it is within the limit (or there is none). */
export function partsProblem(count: number, plan: string | null | undefined, limit: number | undefined): string | undefined {
  if (limit === undefined || count <= limit) return undefined;
  return `This shop runs ${count} parts and its plan (${plan}) allows ${limit}. Take a part out, or move the shop to a plan that allows ${count}.`;
}
