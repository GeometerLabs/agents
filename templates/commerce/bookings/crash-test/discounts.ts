// The crash-test situations of the discount authority (E1, decision 64, 24 Nov 2026; go/internal/discounts), for a Bookings shop that turns discounts on (its settings have a
// "discounts" block: a floor per service and the cap the agent may take off alone, a percentage and rupees, the lower wins). They run on the shop's own Go program and its own
// numbers, from the contract cases (contract/discounts.contract.test.ts):
//   1. within the cap the agent agrees by itself: the record says the agent gave it, the owner is not asked, and what is asked of the customer is still the deposit;
//   2. beyond the cap nothing is held and the owner gets one card bound to the exact price and its code; only the owner's yes with that code makes the deposit request;
//   3. below the floor it is refused by the rule, and the owner is not asked.
// Judged from the record (the `discount` lines and who decided) and from what the payment service or the owner's UPI ledger was asked for, never from the words.
import { checker } from "../../../../modules/crash-test/situations.ts";
import type { Situation } from "../../../../modules/crash-test/situations.ts";
import { MONTH_NAMES } from "../../../../modules/language/format.ts";
import { capabilitiesOf } from "../../../../modules/payments/providers/index.ts";
import { CUSTOMER } from "../src/harness.ts";
import type { GoWorld as World } from "./go-world.ts";
import { createGoWorld } from "./go-world.ts";
import { atWords } from "./says.ts";
import type { Shop, Slot } from "./shop.ts";

type Built = Situation | { id: string; title: string; skip: string };

export function discountSituations(shop: Shop, slot: Slot | undefined): Built[] {
  const d = shop.settings.discounts;
  if (!d) return [];
  const ids = ["discount-within-cap", "discount-beyond-cap", "discount-below-floor"] as const;
  const titles = { "discount-within-cap": "A price within the agent's cap is agreed by the agent alone", "discount-beyond-cap": "A price beyond the cap waits for the owner's card, and only its code's yes goes through", "discount-below-floor": "A price below the floor is refused, and the owner is not asked" };
  if (!slot) return ids.map((id) => ({ id, title: titles[id], skip: "the shop has no day in the next two weeks with a time that fits the service on its slot grid" }));
  const service = shop.service;
  const P = service.priceInr;
  const D = shop.depositInr;
  const floor = d.floors[service.id] ?? P;
  // the cap is the lower of the percentage of the price and the rupees (modules/limits/discounts.ts; go/internal/discounts); prices are picked well inside each side of it
  const cap = Math.min(Math.floor((P * d.capPercent) / 100), d.capInr);
  const name = service.names.en?.[0] ?? service.id.replace(/-/g, " ");
  const words = (price: number) => `${name} on ${slot.day} ${MONTH_NAMES.en[slot.month - 1].slice(0, 3)} at ${atWords("en", slot.minutes)} for ${price}`;
  const upi = !capabilitiesOf(shop.settings.payment).confirmsAutomatically;
  /** What the customer was asked to pay so far (paise): the payment links, or a UPI shop's requests in the owner's ledger. */
  const asked = (w: World): number[] => (upi ? (w.store.upi?.requests ?? []).map((r) => r.amountPaise) : w.payments.links().map((l) => l.amount));
  const lines = (w: World) => w.record.entries().filter((e) => e.action === "discount");
  const world = () => createGoWorld({ settings: shop.settings });
  const out: Built[] = [];

  const within = Math.max(1, Math.floor(cap / 2));
  out.push(cap < 1 || P - within < floor ? { id: ids[0], title: titles[ids[0]], skip: `the agent's cap on this shop's ${name} is ₹${cap} and its floor ₹${floor}: there is no price within the cap to ask` } : {
    id: ids[0], title: titles[ids[0]], how: `the customer asks for the ${name} at ₹${P - within} (₹${within} off ₹${P}; the agent may take off ₹${cap} alone)`,
    async run() {
      const { results, expect } = checker();
      const w = await world();
      await w.say(words(P - within));
      const line = lines(w)[0];
      expect(`The record says the agent agreed to ₹${P - within}, ₹${within} off`, lines(w).length === 1 && line?.outcome === "confirmed" && line.refs?.by === "agent" && line.refs?.discountInr === String(within) && line.refs?.totalInr === String(P - within), JSON.stringify(lines(w).map((e) => [e.outcome, e.refs])));
      expect("The owner was not asked: no card in the record", !lines(w).some((e) => e.outcome === "held_for_owner"), JSON.stringify(lines(w).map((e) => e.outcome)));
      expect(`What the customer is asked to pay now is the deposit, ₹${D}`, asked(w).length === 1 && asked(w)[0] === D * 100, JSON.stringify(asked(w)));
      return results;
    },
  });

  const beyond = P - cap - 1;
  out.push(beyond < floor || beyond < 1 ? { id: ids[1], title: titles[ids[1]], skip: `the floor on this shop's ${name} (₹${floor}) leaves no price beyond the agent's cap (₹${cap} off ₹${P})` } : {
    id: ids[1], title: titles[ids[1]], how: `the customer asks for the ${name} at ₹${beyond} (₹${cap + 1} off: one rupee beyond the cap); the owner answers the card with its code, and once more`,
    async run() {
      const { results, expect } = checker();
      const w = await world();
      await w.say(words(beyond));
      const held = lines(w).filter((e) => e.outcome === "held_for_owner");
      const code = String(held.at(-1)?.refs?.code ?? "");
      expect("Nothing is asked of the customer before the owner answers", asked(w).length === 0, JSON.stringify(asked(w)));
      expect(`The record holds one ask of the owner, for exactly ₹${beyond}, with a code`, held.length === 1 && held[0].refs?.totalInr === String(beyond) && /^[A-HJ-NP-Z2-9]{6}$/u.test(code), JSON.stringify(held.map((e) => e.refs)));
      expect("The owner got the card, and it names its code", w.textsTo(w.owner).some((t) => t.includes(code)), w.textsTo(w.owner).join(" | "));
      await w.ownerSays("approve b-1");
      expect("A yes without the card's code does nothing", asked(w).length === 0 && lines(w).filter((e) => e.outcome === "confirmed").length === 0);
      await w.ownerSays(`approve b-1 ${code}`);
      expect(`After the owner's yes with the code: the record says the owner agreed to ₹${beyond}`, lines(w).filter((e) => e.outcome === "confirmed").map((e) => `${e.refs?.by}/${e.refs?.totalInr}`).join() === `owner/${beyond}`, JSON.stringify(lines(w).map((e) => [e.outcome, e.refs?.by])));
      expect(`And the customer is asked for the deposit, ₹${D}, once`, asked(w).length === 1 && asked(w)[0] === D * 100, JSON.stringify(asked(w)));
      await w.ownerSays(`approve b-1 ${code}`);
      expect("The same yes again changes nothing", asked(w).length === 1 && lines(w).filter((e) => e.outcome === "confirmed").length === 1);
      return results;
    },
  });

  const below = floor - 1;
  out.push(below < 1 ? { id: ids[2], title: titles[ids[2]], skip: `the floor on this shop's ${name} is ₹${floor}: there is no price below it to ask` } : {
    id: ids[2], title: titles[ids[2]], how: `the customer asks for the ${name} at ₹${below}, one rupee below the floor of ₹${floor}`,
    async run() {
      const { results, expect } = checker();
      const w = await world();
      await w.say(words(below));
      expect("The record says the rule refused it", lines(w).map((e) => `${e.outcome}/${e.refs?.by}`).join() === "blocked/rule", JSON.stringify(lines(w).map((e) => [e.outcome, e.refs?.by])));
      expect("The owner was not asked: no card in the record", !lines(w).some((e) => e.outcome === "held_for_owner"), JSON.stringify(lines(w).map((e) => e.outcome)));
      expect(`Nothing below the list is asked of the customer: at most the deposit, ₹${D}`, asked(w).every((a) => a === D * 100), JSON.stringify(asked(w)));
      expect(`The customer was told the list price, ₹${P}`, w.textsTo(CUSTOMER).some((t) => t.includes(`₹${P.toLocaleString("en-IN")}`)), w.textsTo(CUSTOMER).join(" | "));
      return results;
    },
  });
  return out;
}
