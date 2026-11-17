// The plan for running the crash-test situations on one shop's own settings: which line the scripted owner orders, how many, what they write for each case, and the
// quantities the limits situations need (two orders that together are over the budget, one over the cap). Nothing here decides whether the agent is right; it only picks
// the facts the situations are built from, so the same situation runs on a salon, a retailer or an input dealer. A situation the settings cannot express is named and
// not counted (skipped, with the reason).
import { itemOf, nameIn, supplierOf, unitOf } from "../src/settings.ts";
import type { Line, Settings, Supplier } from "../src/settings.ts";

export interface Plan {
  settings: Settings;
  /** The line the usual order is for (the first of an approved supplier), its supplier and the words for it in English. */
  line: Line;
  supplier: Supplier;
  item: string;
  unit: string;
  qty: number;
  totalInr: number;
  /** A second line of another item or supplier, or undefined when the catalogue has only one. */
  other: Line | undefined;
  /** An item and supplier that come in two units (box and piece), or undefined. */
  twoUnits: { item: string; supplier: Supplier; lines: Line[] } | undefined;
  /** A quantity for the main line whose total is within the cap, and twice it is over the month's budget; or undefined. */
  raceQty: number | undefined;
  /** A quantity for the main line whose total is over the cap; or undefined when no allowed quantity is. */
  capQty: number | undefined;
  /** A supplier on the list who is not approved and has a line, or undefined. */
  paused: { supplier: Supplier; line: Line } | undefined;
  /** A line with no reorder quantity, and one with one. */
  noReorder: Line | undefined;
  withReorder: Line | undefined;
  /** What the owner writes for a request. */
  say(o?: { qty?: number; line?: Line; noUnit?: boolean; noSupplier?: boolean }): string;
}

const en = (s: Settings, l: Line) => ({ item: nameIn(itemOf(s, l.item).names, "en"), unit: nameIn(unitOf(s, l.unit).names, "en"), supplier: supplierOf(s, l.supplier).name });

export function planShop(settings: Settings): { plan: Plan } | { problem: string } {
  const approved = settings.catalogue.filter((l) => supplierOf(settings, l.supplier).approved);
  if (approved.length === 0) return { problem: "no catalogue line belongs to an approved supplier" };
  const line = approved[0];
  const supplier = supplierOf(settings, line.supplier);
  const price = line.priceInr;
  const qty = Math.min(line.reorderQty ?? 2, settings.limits.maxQuantity, Math.max(1, Math.floor(settings.limits.maxPerOrderInr / price)));
  const other = approved.find((l) => l.item !== line.item || l.supplier !== line.supplier);
  const grouped = new Map<string, Line[]>();
  for (const l of approved) grouped.set(`${l.item}~${l.supplier}`, [...(grouped.get(`${l.item}~${l.supplier}`) ?? []), l]);
  /** A line that is the only one for its item from its supplier: "low" names it without a question about the unit. */
  const alone = (l: Line) => (grouped.get(`${l.item}~${l.supplier}`) ?? []).length === 1 && approved.filter((x) => x.item === l.item).length === 1;
  const two = [...grouped.values()].find((ls) => ls.length > 1);
  const raceQty = Math.floor(settings.limits.maxPerOrderInr / price);
  const race = raceQty >= 1 && raceQty <= settings.limits.maxQuantity && raceQty * price * 2 > settings.limits.monthlyBudgetInr ? raceQty : undefined;
  const capQty = Math.floor(settings.limits.maxPerOrderInr / price) + 1;
  const pausedLine = settings.catalogue.find((l) => !supplierOf(settings, l.supplier).approved);
  const t = en(settings, line);
  return {
    plan: {
      settings, line, supplier, item: t.item, unit: t.unit, qty, totalInr: (Math.round(price * 100) * qty) / 100, other,
      twoUnits: two ? { item: two[0].item, supplier: supplierOf(settings, two[0].supplier), lines: two } : undefined,
      raceQty: race, capQty: capQty <= settings.limits.maxQuantity ? capQty : undefined,
      paused: pausedLine ? { supplier: supplierOf(settings, pausedLine.supplier), line: pausedLine } : undefined,
      noReorder: approved.find((l) => l.reorderQty === undefined && alone(l)), withReorder: approved.find((l) => l.reorderQty !== undefined && alone(l)),
      say(o = {}) {
        const l = o.line ?? line;
        const w = en(settings, l);
        return `order ${o.qty ?? qty}${o.noUnit ? "" : ` ${w.unit}`} ${w.item}${o.noSupplier ? "" : ` from ${w.supplier}`}`;
      },
    },
  };
}
