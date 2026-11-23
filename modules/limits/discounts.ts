// The discount authority's settings block (E1, decision 64, 24 Nov 2026), checked once for every template that sells at a list price (Bookings' services, Orders'
// items; the Service desk's estimates and Quotes later). The owner sets, per item or service, a FLOOR (the agent never agrees below it) and, for the whole shop, a CAP
// the agent may take off alone: a percentage and a rupee amount, the lower of the two wins. Above the cap the owner is asked with a card bound to the exact total.
//
//   "discounts": { "capPercent": 10, "capInr": 100, "floors": { "haircut": 400 } }
//
// OFF BY DEFAULT: with no "discounts" block the list price is the floor and every discount is refused, as before; an item or service not named in "floors" keeps its
// list price as its floor too. Only the settings check lives in TypeScript (the panel and the deployer validate with it); the decision itself runs in the shops'
// Go runtimes (go/internal/discounts), one copy, no duplicate here. The Go reader says the same sentences in the same order; go/scripts/gen_bookings_settings.ts and
// gen_orders_settings.ts write the vectors that hold the two equal.
//
// The rupee cap is for one ask (the whole discount on that line, quantity included), not per unit: "₹100 off alone" means ₹100 off what the customer pays.

/** The checked block. `floors` keeps the file's order. */
export interface DiscountSettings {
  capPercent: number;
  capInr: number;
  floors: Record<string, number>;
}

/** What a floor is checked against: the template's items or services and their list prices. */
export interface Priced { id: string; priceInr: number }

/** The most a percentage cap may be, and a rupee cap: a cap above these is a typo, not a policy. */
export const MAX_CAP_PERCENT = 90;
export const MAX_CAP_INR = 100_000;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isWhole = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

/**
 * Reads the "discounts" block, pushing plain-words problems onto `errors`. `undefined` when the block is left out (the authority is off) or has a problem.
 * `what` names the things priced ("service", "item"); `least` is a lower bound every floor must respect, with its name (Bookings: the deposit, since Guard holds the
 * deposit link to exactly the deposit and a booking is never agreed for less than it).
 */
export function readDiscounts(v: unknown, items: readonly Priced[], what: string, errors: string[], least?: { inr: number; name: string }): DiscountSettings | undefined {
  if (v === undefined) return undefined;
  if (!isObj(v)) {
    errors.push(`"discounts" must be an object, for example {"capPercent": 10, "capInr": 100, "floors": {"${items[0]?.id ?? what}": ${items[0]?.priceInr ?? 100}}}. Leave it out to refuse every discount.`);
    return undefined;
  }
  const before = errors.length;
  for (const key of Object.keys(v)) {
    if (!["capPercent", "capInr", "floors"].includes(key)) errors.push(`I don't know what "${key}" means in the discounts. Allowed: capPercent, capInr, floors.`);
  }
  const capPercent = v.capPercent;
  if (!isWhole(capPercent) || capPercent < 0 || capPercent > MAX_CAP_PERCENT) {
    errors.push(`The most the agent may take off alone, as a percentage ("discounts.capPercent"), must be a whole number from 0 to ${MAX_CAP_PERCENT}.`);
  }
  const capInr = v.capInr;
  if (!isWhole(capInr) || capInr < 0 || capInr > MAX_CAP_INR) {
    errors.push(`The most the agent may take off alone, in rupees ("discounts.capInr"), must be a whole number from 0 to ${MAX_CAP_INR}.`);
  }
  const floors: Record<string, number> = {};
  if (!isObj(v.floors) || Object.keys(v.floors).length === 0) {
    errors.push(`"discounts.floors" must name at least one ${what} and its lowest price in whole rupees, for example {"${items[0]?.id ?? what}": ${items[0]?.priceInr ?? 100}}.`);
  } else {
    for (const [id, floor] of Object.entries(v.floors)) {
      const item = items.find((i) => i.id === id);
      if (!item) errors.push(`"discounts.floors" names "${id}", which is not one of the ${what}s.`);
      else if (!isWhole(floor) || floor < 1) errors.push(`The lowest price for "${id}" ("discounts.floors") must be a whole number of rupees, 1 or more.`);
      else if (floor > item.priceInr) errors.push(`The lowest price for "${id}" (₹${floor}) is above its list price (₹${item.priceInr}). It must be at or below the list price.`);
      else if (least && floor < least.inr) errors.push(`The lowest price for "${id}" (₹${floor}) is below ${least.name} (₹${least.inr}). Raise it to at least ${least.name}.`);
      else floors[id] = floor;
    }
  }
  if (errors.length > before) return undefined;
  return { capPercent: capPercent as number, capInr: capInr as number, floors };
}
