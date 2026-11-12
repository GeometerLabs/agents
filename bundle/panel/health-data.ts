// Puts one shop's health together for the pages (B32): the exported record, the deployer's status, fleet's last answer, the licence, the unfinished-work list and the
// person's own entries, through the same functions the shop page uses. Which shops a person may see is shops.find / shops.visibleTo, as everywhere.
import type { UnfinishedOptions } from "../../modules/unfinished/index.ts";
import type { Account } from "./accounts.ts";
import { monthOf, readExport } from "./activity.ts";
import type { PanelConfig } from "./config.ts";
import type { PriceList } from "./cost.ts";
import { planFromSettings } from "./cost.ts";
import { attentionOf, marginOf, monthUsage, planFeePaise, runningCostItems } from "./health.ts";
import type { EntryStore } from "./health.ts";
import { inboxFor } from "./inbox.ts";
import { licenceView } from "./licence.ts";
import type { Shops } from "./shops.ts";
import type { ShopHealth } from "./views-health.ts";

const DEFAULT_ZONE = "Asia/Kolkata";

// Gathers the inputs of a shop's health (record, status, fleet, licence, to-do items, the person's entries) in one place, so the overview and the single-shop page cannot compute different answers.
export function createHealthData(deps: { config: PanelConfig; shops: Shops; entries: EntryStore; prices: PriceList; now: () => number; unfinished: UnfinishedOptions }) {
  const { config, shops, entries, prices, now, unfinished } = deps;
  return {
    month: (zone: string = DEFAULT_ZONE): string => monthOf(now(), zone),
    /** One shop, for one person. The caller has already checked the person may see the shop. */
    shop(account: Account, id: string): ShopHealth {
      const settings = shops.settings(id);
      const zone = settings?.timezone ?? DEFAULT_ZONE;
      const month = monthOf(now(), zone);
      const fleet = shops.fleet(id);
      const read = shops.status(id);
      const data = readExport(shops.paths.exports(id));
      const inbox = inboxFor(shops, id, now(), unfinished);
      const mine = entries.read(account.id, id);

      const plan = fleet?.plan ?? (settings && shops.kind(id) === "bookings" ? planFromSettings(settings) : null);

      const items = runningCostItems({
        plan: planFeePaise({ plan, prices, builder: config.mode === "own" }), // a panel on a builder's own server: the builder licence
        whatsappFromShopWallet: (shops.runtime(id) as { services?: { messaging?: { provider?: unknown } } } | undefined)?.services?.messaging?.provider === "gupshup-selfserve",
        usage: monthUsage(data, month, zone, prices), modelIncluded: config.mode === "hosted", entries: mine, month,
      });
      const margin = marginOf(mine?.pricePaise ?? null, items, mine?.setupFeePaise ?? null);
      const licence = licenceView(read.ok ? read.status.licence : undefined, fleet?.licence, now());
      const attention = attentionOf({ items: inbox.items, recordShared: inbox.asOf !== undefined, status: read.ok ? read.status : undefined, fleet, licence: licence?.state, nowMs: now() });
      return { id, name: settings?.name ?? id, attention, margin, entries: mine };
    },
    /** Every shop this person may see: those that need a look first, then by name. */
    all(account: Account): ShopHealth[] {
      return shops.visibleTo(account).map((s) => this.shop(account, s.id)).sort((a, b) => Number(b.attention.needs) - Number(a.attention.needs) || a.name.localeCompare(b.name));
    },
  };
}
export type HealthData = ReturnType<typeof createHealthData>;
