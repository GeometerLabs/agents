// The crash-test situations of the discount authority (E1, decision 64, 24 Nov 2026; go/internal/discounts), for an Orders shop that turns discounts on (its settings have a
// "discounts" block: a floor per item and the cap the agent may take off one order line alone, a percentage and rupees, the lower wins). They run on the shop's own Go program
// and its own numbers, from the contract cases (contract/discounts.contract.test.ts): within the cap the agent agrees alone; beyond it the owner's card with its code decides,
// and nothing is asked of the customer before; below the floor the rule refuses. Judged from the record's `discount` lines and from what the payment service or the owner's UPI
// ledger was asked for, never from the words. A customer names a price per piece; the cap is on the line (the pieces times the rupees off each).
import { checker } from "../../../../modules/crash-test/situations.ts";
import type { Situation } from "../../../../modules/crash-test/situations.ts";
import { capabilitiesOf } from "../../../../modules/payments/providers/index.ts";
import { advanceFor, itemName } from "../src/settings.ts";
import type { GoWorld as World } from "./go-world.ts";
import { createGoWorld } from "./go-world.ts";
import type { Shop } from "./shop.ts";

type Built = Situation | { id: string; title: string; skip: string };

export function discountSituations(shop: Shop): Built[] {
  const d = shop.settings.discounts;
  if (!d) return [];
  const item = shop.item;
  const qty = shop.qty;
  const P = item.priceInr;
  const floor = d.floors[item.id] ?? P;
  // the cap is the lower of the percentage of the line and the rupees (modules/limits/discounts.ts; go/internal/discounts)
  const cap = Math.min(Math.floor((qty * P * d.capPercent) / 100), d.capInr);
  const name = itemName(item, "en");
  const lang = shop.settings.languages.includes("en") ? "en" : shop.settings.languages[0];
  const upi = !capabilitiesOf(shop.settings.payment).confirmsAutomatically;
  const asked = (w: World): number[] => (upi ? (w.store.upi?.requests ?? []).map((r) => r.amountPaise) : w.payments.links().map((l) => l.amount));
  const lines = (w: World) => w.record.entries().filter((e) => e.action === "discount");
  const world = () => createGoWorld({ settings: shop.settings, nowMs: shop.startMs });
  const out: Built[] = [];

  const offWithin = Math.floor(cap / qty / 2); // rupees off each piece, half the cap on the line
  const within = P - offWithin;
  out.push(offWithin < 1 || within < floor ? { id: "discount-within-cap", title: "A price within the agent's cap is agreed by the agent alone", skip: `the agent's cap on ${qty} ${name} is ₹${cap} and the floor ₹${floor} a piece: there is no price within the cap to ask` } : {
    id: "discount-within-cap", title: "A price within the agent's cap is agreed by the agent alone",
    how: `the customer orders ${qty} ${name} at ₹${within} each (₹${qty * offWithin} off the line; the agent may take off ₹${cap} alone)`,
    async run() {
      const { results, expect } = checker();
      const w = await world();
      await w.say(shop.say(lang, { offerInr: within }));
      const line = lines(w)[0];
      const total = qty * within;
      expect(`The record says the agent agreed to ₹${total} for the line`, lines(w).length === 1 && line?.outcome === "confirmed" && line.refs?.by === "agent" && line.refs?.totalInr === String(total), JSON.stringify(lines(w).map((e) => [e.outcome, e.refs])));
      expect("The owner was not asked: no card in the record", !lines(w).some((e) => e.outcome === "held_for_owner"), JSON.stringify(lines(w).map((e) => e.outcome)));
      expect(`The advance asked of the customer follows the agreed total: ₹${advanceFor(shop.settings, total)}`, asked(w).length === 1 && asked(w)[0] === advanceFor(shop.settings, total) * 100, JSON.stringify(asked(w)));
      return results;
    },
  });

  const offBeyond = Math.floor(cap / qty) + 1; // one rupee a piece beyond what the cap allows on the line
  const beyond = P - offBeyond;
  out.push(beyond < floor || beyond < 1 ? { id: "discount-beyond-cap", title: "A price beyond the cap waits for the owner's card, and only its code's yes goes through", skip: `the floor on ${name} (₹${floor}) leaves no price beyond the agent's cap` } : {
    id: "discount-beyond-cap", title: "A price beyond the cap waits for the owner's card, and only its code's yes goes through",
    how: `the customer orders ${qty} ${name} at ₹${beyond} each (₹${qty * offBeyond} off the line, beyond the cap of ₹${cap}); the owner answers the card with its code, and once more`,
    async run() {
      const { results, expect } = checker();
      const w = await world();
      await w.say(shop.say(lang, { offerInr: beyond }));
      const total = qty * beyond;
      const held = lines(w).filter((e) => e.outcome === "held_for_owner");
      const code = String(held.at(-1)?.refs?.code ?? "");
      expect("Nothing is asked of the customer before the owner answers", asked(w).length === 0, JSON.stringify(asked(w)));
      expect(`The record holds one ask of the owner, for exactly ₹${total}, with a code`, held.length === 1 && held[0].refs?.totalInr === String(total) && /^[A-HJ-NP-Z2-9]{6}$/u.test(code), JSON.stringify(held.map((e) => e.refs)));
      const id = w.orderOf(shop.customer)?.id ?? "o-1";
      await w.ownerSays(`approve ${id} ${code}`);
      expect(`After the owner's yes with the code: the record says the owner agreed to ₹${total}`, lines(w).filter((e) => e.outcome === "confirmed").map((e) => `${e.refs?.by}/${e.refs?.totalInr}`).join() === `owner/${total}`, JSON.stringify(lines(w).map((e) => [e.outcome, e.refs?.by])));
      expect(`And the advance for exactly that total is asked, once: ₹${advanceFor(shop.settings, total)}`, asked(w).length === 1 && asked(w)[0] === advanceFor(shop.settings, total) * 100, JSON.stringify(asked(w)));
      await w.ownerSays(`approve ${id} ${code}`);
      expect("The same yes again changes nothing", asked(w).length === 1 && lines(w).filter((e) => e.outcome === "confirmed").length === 1);
      return results;
    },
  });

  const below = floor - 1;
  out.push(below < 1 ? { id: "discount-below-floor", title: "A price below the floor is refused, and the owner is not asked", skip: `the floor on ${name} is ₹${floor}: there is no price below it to ask` } : {
    id: "discount-below-floor", title: "A price below the floor is refused, and the owner is not asked",
    how: `the customer orders ${qty} ${name} at ₹${below} each, one rupee below the floor of ₹${floor}`,
    async run() {
      const { results, expect } = checker();
      const w = await world();
      await w.say(shop.say(lang, { offerInr: below }));
      expect("The record says the rule refused it", lines(w).map((e) => `${e.outcome}/${e.refs?.by}`).join() === "blocked/rule", JSON.stringify(lines(w).map((e) => [e.outcome, e.refs?.by])));
      expect("The owner was not asked: no card in the record", !lines(w).some((e) => e.outcome === "held_for_owner"), JSON.stringify(lines(w).map((e) => e.outcome)));
      expect(`Nothing below the menu is asked of the customer: at most the advance on ₹${qty * P}`, asked(w).every((a) => a === advanceFor(shop.settings, qty * P) * 100), JSON.stringify(asked(w)));
      return results;
    },
  });
  return out;
}
