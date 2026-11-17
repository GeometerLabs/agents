// Stock orders' view for the ONDC mapping (modules/ondc): a purchase order, the BUYER's side, as the neutral type. Small and read-only: no change to how Stock orders behaves.
// `clientId` is the buyer's id for the mapping (the settings hold none). The supplier's own ONDC ids are not held by any shop, so none are given: the mapping reports them as a gap.
// The supplier's WhatsApp number is not passed on at all. Money is already paise here.
import type { Party, PurchaseIn } from "../../../../modules/ondc/types.ts";
import type { Settings } from "./settings.ts";
import type { PurchaseOrder } from "./order.ts";

export const buyerParty = (settings: Settings, clientId: string): Party => ({ id: clientId, name: settings.name, ...(settings.address ? { address: settings.address } : {}), timezone: settings.timezone });

export function purchaseIn(settings: Settings, o: PurchaseOrder, clientId: string, nowMs: number): PurchaseIn {
  const supplier = settings.suppliers.find((s) => s.id === o.supplier);
  const item = settings.items.find((i) => i.id === o.item);
  const unit = settings.units.find((u) => u.id === o.unit);
  return {
    buyer: buyerParty(settings, clientId), ref: o.id, state: o.state, ack: o.ack, receipt: o.receipt, paidOutside: o.paidOutsideMs !== undefined,
    supplier: { id: o.supplier, name: supplier?.name ?? o.supplier },
    item: { id: o.item, name: item?.names.en[0] ?? o.item, unit: unit?.names.en[0] ?? o.unit },
    qty: o.qty, receivedQty: o.receivedQty, unitPaise: o.unitPaise, totalPaise: o.totalPaise, createdMs: o.createdMs, nowMs,
  };
}
