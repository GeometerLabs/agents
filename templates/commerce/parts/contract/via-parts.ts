// Running a template's OWN contract suite through the shop of several parts (decision 65): "each part's contract cases still pass through the router". The Orders, Fees and
// Stock orders contract harnesses read CONTRACT_PARTS: when it is set, the shop they make is a parts shop (go/cmd/parts, or PARTS_GO_BIN) whose first part (CONTRACT_PARTS=first)
// or last part (CONTRACT_PARTS=last) is the template under test, on exactly the settings the test made, beside the other two parts; every event the test sends goes through the
// router, and the test reads the shop over HTTP and from agent.db as before. Unset: the template's own program, as always.
//
// The other parts (`companions`) are small and quiet: nothing in them writes to anyone on its own (the credit book's person has not been asked, Stock orders' one item counts
// nothing, the hold's item is not counted), their numbers are none a contract test uses, and their names are in all four languages, so a test that changes the shop's languages
// does not make them refuse to start.
import { readFileSync } from "node:fs";
import { asParts } from "../src/settings.ts";
import type { PartName } from "../src/settings.ts";

/** The parts template's version (pathway.lock `parts@<version>`). */
export const PARTS_VERSION = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;

/** CONTRACT_PARTS: "first" or "last", or undefined (the template's own program). */
export const VIA_PARTS: "first" | "last" | undefined = process.env.CONTRACT_PARTS === "first" || process.env.CONTRACT_PARTS === "last" ? process.env.CONTRACT_PARTS : process.env.CONTRACT_PARTS ? (() => { throw new Error(`CONTRACT_PARTS is "${process.env.CONTRACT_PARTS}": say "first" or "last".`); })() : undefined;

const names4 = (en: string): Record<string, string[]> => ({ en: [en], hi: [en], ml: [en], kn: [en] });

/** The two quiet parts beside the one under test. */
export function companions(under: PartName): Record<string, Record<string, unknown>> {
  const all: Record<PartName, Record<string, unknown>> = {
    fees: {
      creditBook: { maxPerPersonInr: 50000, remindEveryDays: 7, people: [{ name: "Companion Kumar", phone: "+919700000077", amountInr: 100 }] },
      reminders: { hour: 10, maxPerMonth: 4 }, partPayments: { allowed: true, minInr: 100 }, refund: { limitInr: 500 },
      payment: { module: "upi", upi: { id: "companion@okaxis", payee: "Companion" } },
    },
    "stock-orders": {
      items: [{ id: "companion-wire", names: names4("companion wire") }],
      units: [{ id: "roll", names: names4("roll") }],
      suppliers: [{ id: "companion-supplies", name: "Companion Supplies", aliases: [], whatsapp: "+919700000088", language: "en", approved: true }],
      catalogue: [{ item: "companion-wire", supplier: "companion-supplies", unit: "roll", priceInr: 900, reorderQty: 2 }],
      limits: { maxPerOrderInr: 12000, monthlyBudgetInr: 20000, maxQuantity: 200 }, followUpHours: [4, 24],
    },
    orders: {
      menu: [{ id: "companion-switch", names: names4("companion switch"), priceInr: 50, dailyStock: 3 }],
      orders: { maxPerDay: 50, maxItemsPerOrder: 5, daysAhead: 2 }, cutoff: { daysBefore: 0, time: "18:00" },
      pickup: { slots: [{ id: "companion-evening", from: "16:00", to: "19:00", names: names4("companion evening") }] },
      advance: { mode: "none" }, cancellation: { windowHours: 0 }, refund: { limitInr: 0 },
      payment: { module: "upi", upi: { id: "companion@okaxis", payee: "Companion" } }, owner: { approveOverInr: 0 },
    },
  };
  const out: Record<string, Record<string, unknown>> = {};
  for (const [name, block] of Object.entries(all)) if (name !== under) out[name] = block;
  return out;
}

/** The settings.json of a parts shop whose part `under` is the test's own settings, first or last, beside the companions. */
export function viaParts(under: PartName, settings: Record<string, unknown>): Record<string, unknown> {
  return asParts(under, settings, { others: companions(under), first: VIA_PARTS !== "last" });
}

// ---- a case a parts shop does not run ----------------------------------------------------------------------------------------------------------------------------------------
// A parts shop takes no payment gateway (settings.ts), so a contract case of a gateway shop cannot run through it: the harness says so and the case is SKIPPED with that reason
// (never passed). The contract wrapper runs each case inside `track`, so `notThroughParts` can mark the running case skipped from inside the harness.
import { AsyncLocalStorage } from "node:async_hooks";
import type { TestContext } from "node:test";

const running = new AsyncLocalStorage<TestContext>();
class NotThroughParts extends Error {}

/** Run a contract case so that `notThroughParts` can skip it. */
export async function track(t: TestContext, fn: () => Promise<void> | void): Promise<void> {
  try { await running.run(t, async () => { await fn(); }); } catch (e) { if (!(e instanceof NotThroughParts)) throw e; }
}

/** Skip the running case: it is one a parts shop does not run (`why`). Throws, so nothing after it in the case runs. */
export function notThroughParts(why: string): never {
  running.getStore()?.skip(`not run through the parts shop: ${why}`);
  throw new NotThroughParts(why);
}

/** The settings a parts shop cannot take: a payment gateway. */
export function gatewayOf(settings: Record<string, unknown>): boolean {
  return (settings.payment as { module?: unknown } | undefined)?.module === "razorpay";
}
