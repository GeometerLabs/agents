// The crash-test situations of a shop that keeps items for pickup with no advance (the pickup hold, advance "none"; 24 Nov 2026, decision 63's job 3). They run on the shop's
// own Go program (go/internal/orders agent_hold.go) and on its own settings: the item with the fewest a day is the one that can run out, the first pickup slot that is still
// open on the world's first day (or the next day the shop takes orders for) is the time asked for. Like every situation they judge from the record the program keeps and the
// stand-in WhatsApp's outbox, never from what the program said it did. From the hold's contract cases (contract/hold.contract.test.ts):
//   1. the owner's tap comes before any "held for you": the customer is told the shop is asked, the owner gets the card, and only the owner's yes holds the item; no money;
//   2. one hold for the last unit: two customers ask for the last ones, the owner says yes to both, only the first is held and the second hears "we usually carry it";
//   3. collected once: staff mark it collected, and a second mark changes nothing;
//   4. the pickup time ends: the hold is let go once, and the customer and the owner are told once.
import { HOUR, MINUTE, addDays, localParts, zonedToMs } from "../../../../modules/core/time.ts";
import type { LocalDate } from "../../../../modules/core/time.ts";
import { checker } from "../../../../modules/crash-test/situations.ts";
import { caseAskedSituation } from "../../../../modules/crash-test/case-asked.ts";
import type { Situation, Skipped } from "../../../../modules/crash-test/situations.ts";
import type { Language } from "../../../../modules/language/languages.ts";
import { itemName } from "../src/settings.ts";
import type { MenuItem, Settings, Slot } from "../src/settings.ts";
import { createGoWorld } from "./go-world.ts";
import type { GoWorld as World } from "./go-world.ts";
import { momentsOf } from "./shop.ts";

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const PICKUP_WORD: Record<Language, string> = { en: "pickup", hi: "पिकअप", ml: "പിക്കപ്പ്", kn: "ಪಿಕಪ್" };
const clock12 = (hhmm: string): string => { const [h, m] = hhmm.split(":").map(Number); return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`; };

/** Customers of the hold situations. */
const ASHA = "+919844444444";
const RAVI = "+919855555555";

/** The hold situations for a shop with advance "none", and the ones its settings cannot express. */
export function holdSituations(settings: Settings): { situations: Situation[]; skipped: Skipped[] } {
  const tz = settings.timezone;
  const startMs = zonedToMs({ year: 2026, month: 11, day: 9 }, { hour: 10, minute: 0 }, tz);
  const today = localParts(startMs, tz);
  // the customer writes English when the shop speaks it (the hold's reader reads every language the shop speaks; English is the one every shop's item names are sure to read)
  const lang: Language = settings.languages.includes("en") ? "en" : settings.languages[0];
  // a slot, and its day, that is still open to ask for when the world starts and ends before the next day's orders: the first that fits, today first
  let pick: { date: LocalDate; slot: Slot; endMs: number } | undefined;
  for (let k = 0; k <= settings.orders.daysAhead && !pick; k++) {
    const date = addDays(today, k);
    for (const slot of settings.pickup.slots) {
      const m = momentsOf(settings, date, slot);
      if (m.cutoffMs > startMs + 30 * MINUTE && m.endMs > startMs + HOUR) { pick = { date, slot, endMs: m.endMs }; break; }
    }
  }
  if (!pick) return { situations: [], skipped: [{ id: "hold", title: "The pickup hold", reason: "no pickup slot within the days the shop takes orders for is still open to ask for" }] };
  const { date, slot, endMs } = pick;
  // the item that can run out first: the fewest a day (on Ganesh Electricals' example, the MCB 16A, one a day)
  const last: MenuItem = [...settings.menu].sort((a, b) => a.dailyStock - b.dailyStock)[0];
  const ask = (qty: number, item: MenuItem = last): string => `${qty} ${itemName(item, lang)} ${date.day} ${MONTHS[date.month - 1]} ${clock12(slot.from)} ${PICKUP_WORD[lang]}`;
  const world = (): Promise<World> => createGoWorld({ settings, nowMs: startMs });
  /** The templates the record shows sent to this person (confirmed by the messaging service), in order: language-free, the record names the template. */
  const templatesTo = (w: World, who: string, to: "customer" | "owner" = "customer"): string[] =>
    w.record.entries().filter((e) => e.conversation === who && e.outcome === "confirmed" && e.refs?.templates !== undefined && e.refs.to === to).flatMap((e) => String(e.refs.templates).split("+"));
  const toOwner = (w: World): string[] => w.record.entries().filter((e) => e.outcome === "confirmed" && e.refs?.templates !== undefined && e.refs.to === "owner").flatMap((e) => String(e.refs.templates).split("+"));
  const holdLines = (w: World, step: string): number => w.record.entries().filter((e) => e.action === "pickup_hold" && e.outcome === "confirmed" && e.refs?.step === step).length;
  /** No money anywhere: no link, no payment, no owner-marked request, no books line. */
  const noMoney = (w: World): boolean => w.payments.links().length === 0 && !w.record.entries().some((e) => ["create_advance_link", "record_payment", "upi_paid_claim", "upi_request_closed", "refund"].includes(e.action) || e.refs?.amountPaise !== undefined || e.refs?.entryId !== undefined);
  const at = `${clock12(slot.from)} on ${date.day} ${MONTHS[date.month - 1]}`;
  const name = itemName(last, "en");

  const situations: Situation[] = [
    {
      id: "hold-owner-first", title: "\"Held for you\" comes only after the owner's yes, and no money moves",
      how: `a customer asks the shop to keep 1 ${name} for ${at}; the owner answers "approve" afterwards`,
      async run() {
        const { results, expect } = checker();
        const w = await world();
        await w.say(ask(1), { from: ASHA });
        expect("Before the owner answers, the customer is told the shop is asked, never that it is held", templatesTo(w, ASHA).join() === "hold_asked_shop", templatesTo(w, ASHA).join());
        expect("The owner got the card to say yes or no", toOwner(w).includes("owner_hold_ask"), toOwner(w).join());
        expect("Nothing is held yet", holdLines(w, "held") === 0);
        await w.ownerSays("approve o-1");
        expect("After the owner's yes the customer hears it is held, once", templatesTo(w, ASHA).filter((t) => t === "hold_held").length === 1 && templatesTo(w, ASHA).indexOf("hold_held") > templatesTo(w, ASHA).indexOf("hold_asked_shop"), templatesTo(w, ASHA).join());
        expect("The record holds one hold, held", holdLines(w, "held") === 1, String(holdLines(w, "held")));
        expect("No payment link, payment, owner-marked request or books line was made", noMoney(w), JSON.stringify(w.payments.links()));
        return results;
      },
    },
    {
      id: "hold-last-unit", title: "One hold for the last unit: two customers ask, only the first is held",
      how: `the shop has ${last.dailyStock} ${name} a day; one customer asks for ${last.dailyStock}, a second for 1 more, and the owner says yes to both`,
      async run() {
        const { results, expect } = checker();
        const w = await world();
        await w.say(ask(last.dailyStock), { from: ASHA });
        await w.say(ask(1), { from: RAVI });
        await w.ownerSays("approve o-1");
        await w.ownerSays("approve o-2");
        expect("The first customer hears it is held", templatesTo(w, ASHA).at(-1) === "hold_held", templatesTo(w, ASHA).join());
        expect("The second hears the shop usually carries it, and is not told it is held", templatesTo(w, RAVI).at(-1) === "hold_usually" && !templatesTo(w, RAVI).includes("hold_held"), templatesTo(w, RAVI).join());
        expect("The record holds one hold, not two", holdLines(w, "held") === 1, String(holdLines(w, "held")));
        expect("No money moved", noMoney(w));
        return results;
      },
    },
    {
      id: "hold-collected-once", title: "A hold is marked collected once",
      how: `a customer's 1 ${name} is held; staff mark it collected, and then mark it again`,
      async run() {
        const { results, expect } = checker();
        const w = await world();
        await w.say(ask(1), { from: ASHA });
        await w.ownerSays("approve o-1");
        await w.ownerSays("collected o-1");
        expect("The owner is told it was collected", toOwner(w).at(-1) === "owner_hold_collected", toOwner(w).join());
        expect("The record has it collected once, and the order completed", holdLines(w, "collected") === 1 && w.record.entries().some((e) => e.action === "complete_order" && e.booking === "o-1"));
        await w.ownerSays("collected o-1");
        expect("A second mark changes nothing: still collected once, and the owner is told there is no hold", holdLines(w, "collected") === 1 && toOwner(w).at(-1) === "owner_hold_none", toOwner(w).join());
        expect("No money moved", noMoney(w));
        return results;
      },
    },
    {
      id: "hold-ends", title: "When the pickup time ends, the hold is let go once",
      how: `a customer's ${last.dailyStock} ${name} are held for ${at}; the shop's clock passes the end of the slot, and beats again`,
      async run() {
        const { results, expect } = checker();
        const w = await world();
        await w.say(ask(last.dailyStock), { from: ASHA });
        await w.ownerSays("approve o-1");
        expect("Held", templatesTo(w, ASHA).at(-1) === "hold_held", templatesTo(w, ASHA).join());
        w.clock.set(endMs + MINUTE);
        await w.tick();
        expect("The customer is told once that the hold ended", templatesTo(w, ASHA).filter((t) => t === "hold_ended").length === 1, templatesTo(w, ASHA).join());
        expect("The owner is told", toOwner(w).includes("owner_hold_ended"), toOwner(w).join());
        expect("The unit was let go once", w.record.entries().filter((e) => e.action === "release_stock" && e.booking === "o-1").length === 1);
        await w.tick();
        expect("A later beat lets nothing go twice", w.record.entries().filter((e) => e.action === "release_stock" && e.booking === "o-1").length === 1 && templatesTo(w, ASHA).filter((t) => t === "hold_ended").length === 1);
        return results;
      },
    },
    // 25 Nov 2026 (modules/crash-test/case-asked.ts): a held item named from a number that holds no order; the customer's ask opens the order
    caseAskedSituation({
      noun: "order", world,
      open: async (w) => { await w.say(ask(1), { from: ASHA }); return { ref: "o-1", customer: ASHA }; },
      state: (w, ref) => { const x = w.store.orders.get(ref); return JSON.stringify([x?.state, x?.holdExpiresAt ?? null]); },
      customerTemplate: "case_other_number", ownerTemplate: "owner_case_other_number",
      ask: (ref) => `Where is ${ref.toUpperCase().replace("-", "")}? My mother asked for it`, falseRef: "o-9",
    }),
  ];
  return { situations, skipped: [] };
}
