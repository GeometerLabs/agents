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

// ---- what differs by design ------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * A parts shop's /status counts its cases under "cases", by part ("orders:confirmed"); a single-part shop counts its own under its template's name ("orders"). Through the
 * parts program, the harness's status() gives the test the part's own counts under its template's name as well, read from "cases" (nothing else of the answer changes).
 */
export function partStatus(body: any, part: string, casesName: string): any {
  if (!VIA_PARTS || !body || typeof body !== "object" || typeof body.cases !== "object") return body;
  const own: Record<string, number> = {};
  for (const [key, n] of Object.entries(body.cases as Record<string, number>)) if (key.startsWith(`${part}:`)) own[key.slice(part.length + 1)] = n;
  return { ...body, [casesName]: own };
}

/**
 * The cases of a template's own suite that test what a parts shop is not, by design, with the reason: they are SKIPPED through the parts program (never passed). Each reason is
 * a decision 65 design point (bundle/Explanation.md), not a fault.
 */
export const BY_DESIGN: Record<string, { match: RegExp; why: string; last?: boolean }[]> = {
  common: [
    { match: /a folder pinned to another version or another pathway/u, why: "it writes a single template's pathway.lock and settings.json into the folder itself; a parts shop's folder is pinned to parts@ and its settings are the parts'" },
    { match: /^in (en|hi|ml|kn)[:,] /u, why: "the differential test compares the settings file and the demo's single-template shop step for step; a parts shop's file wraps it as one part" },
    { match: /^with the owner in (en|hi|ml|kn): /u, why: "the differential test compares the settings file and the demo's single-template shop step for step; a parts shop's file wraps it as one part" },
    { match: /a restart on new settings|approval-matches-order: the catalogue.s price moved after the card|an item taken off the menu while an order for it is open/u, why: "it rewrites the folder's settings.json as a single template's and starts again" },
    { match: /the public offer names the shop only|a method that is not the route's is 405, an unknown path 404, and the routes of a booking/u, why: "the shop's public offer is its customer part's (the first Orders or Fees part in the shop's order)" },
    { match: /the owner's page refuses a stranger and a wrong link, and opens with the owner's link/u, why: "it compares the owner's page whole; a parts shop's page is one page joined over its parts" },
    { match: /made once on the first morning of the next month/u, why: "each part makes its own monthly report, so the shop's report folders are one per part" },
    { match: /settings the template refuses stop the start/u, why: "it writes a single template's settings.json into the folder itself" },
    { match: /the saved state is the TypeScript runtime's, member for member/u, why: "a parts shop's saved state keeps the part's members under parts.<name>" },
    { match: /the morning line counts/u, why: "a parts shop's morning line is the shop's, over every part (the other parts' lines are in it)" },
    { match: /'move CODE' from the owner's number is one record line/u, why: "it compares the line's refs whole; a parts shop's lines also carry refs.part" },
    // the shop's page and chat are its customer part's (the hold's when there is one); a Fees part beside it has no centre page, no parent's private link and no chat here
    { last: true, match: /the centre's page says what it is|the chat opened from a parent's link|a guest's question gets the chat's fixed line|the parent was sent|only that parent's students and fees|a link survives a restart|a press on another parent's fee|'I have paid' marks nothing: a confirmation page|'show how to pay' makes the UPI request|the page lists the centre, every parent once|a reminder is pushed to the parent's page conversation|STOP ends every message to that parent, and with them the pushes|nothing opens before the first reminder moment|a UPI centre started on go and started again on go/u, why: "the shop's page and chat are its customer part's, the first Orders or Fees part in the shop's order (here an earlier one); a Fees part that is not it has no centre page, private links or chat in this shop (bundle Deferred.md)" },
    { last: true, match: /a code nobody was given does nothing|words it cannot read get examples, never a guess|the talk box and a card's answer on a centre without the assistant/u, why: "the owner's words no part claims (a card code no part made, words no part reads) are answered by the shop's first part, here an earlier one; the router never guesses whose they are" },
    { match: /names its cases/u, why: "a parts shop's /status names its cases \"cases\", by part" },
    { match: /one report folder appears/u, why: "each part sends its own monthly report, so a parts shop's report folder has one per part" },
    { match: /Stock page offers/u, why: "the shop's one Stock page offers every part's items, the other parts' too" },
    
  ],
};

/** A record line's refs as the template's own program writes them: through the parts program every line also carries refs.part (the part that wrote it), left out here. */
export function ownRefs(refs: Record<string, string>): Record<string, string> {
  if (!VIA_PARTS) return refs;
  const { part: _part, ...own } = refs;
  return own;
}

/** The by-design reason this case is not run through the parts program, or undefined. */
export function byDesign(name: string): string | undefined {
  if (!VIA_PARTS) return undefined;
  // `last`: by design only when the part runs LAST (then an earlier part is the shop's page: CONTRACT_PARTS=last)
  return BY_DESIGN.common.find((d) => (!d.last || VIA_PARTS === "last") && d.match.test(name))?.why;
}

/**
 * The same for a case a suite starts with node's test() itself (outside its harness's contract()): its skip, when it runs through the parts program, by design. These cases
 * run a gateway (Razorpay) shop, which a parts shop does not take.
 */
export const gatewayCaseThroughParts = (): string | undefined => (VIA_PARTS ? "not run through the parts shop, by design: it runs a payment gateway (Razorpay) shop, which a shop of several parts does not take" : undefined);
