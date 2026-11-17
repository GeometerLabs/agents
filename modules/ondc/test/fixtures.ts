// Neutral fixtures for the module's own tests: a small food shop, a salon and a purchase order written straight in the neutral types (types.ts), with no template behind them.
// The tests that run the real example shops through each template's view are in each template's test/ondc.test.ts (the modules boundary test forbids importing a template here).
import type { BookingIn, Catalogue, OndcFacts, OrderIn, Party, PurchaseIn } from "../types.ts";

export const NOW = Date.UTC(2026, 10, 17, 6, 30); // 17 Nov 2026, 12:00 in India
export const LUNCH = { id: "lunch", fromMs: Date.UTC(2026, 10, 18, 6, 30), toMs: Date.UTC(2026, 10, 18, 7, 30) }; // 18 Nov, 12:00 to 13:00 IST

/** Everything ONDC asks for that no shop holds today, filled in: the mapping should then have only the gaps that no shop setting can close. */
export const FILLED: OndcFacts = {
  domain: "ONDC:RET11", cityCode: "std:0484", gps: "10.0158,76.3419", address: { locality: "Kakkanad", city: "Kochi", state: "Kerala", areaCode: "682030" },
  gstin: "32AAAAA0000A1Z5", pan: "AAAAA0000A", fssai: "11111111111111", phone: "9000000001", email: "shop@example.invalid", description: "A small test shop", logoUrl: "https://example.invalid/logo.png",
  imageUrls: ["https://example.invalid/shop.png"], rating: "4", serviceRadiusKm: 5, timeToShip: "PT45M", tat: "PT60M", returnPolicy: { returnable: false, window: "PT0S", sellerPicksUp: false },
  bank: { accountNo: "0000000000", ifsc: "TEST0000001", beneficiary: "Test Shop", bankName: "Test Bank", branchName: "Test Branch" }, finderFee: { type: "percent", value: "3" },
  items: { thali: { description: "A test thali", imageUrl: "https://example.invalid/thali.png", vegetarian: true }, curd: { description: "Curd", imageUrl: "https://example.invalid/curd.png", vegetarian: true } },
  categories: [{ id: "1", name: "Meals", description: "Meals" }],
  serviceCategoryIds: ["SRV11-1"], creds: [{ id: "c1", type: "licence" }],
};

export const shop = (ondc?: OndcFacts): Party => ({ id: "shop-1", name: "Test Tiffins", address: "14 Temple Road, Kakkanad, Kochi", timezone: "Asia/Kolkata", ...(ondc ? { ondc } : {}) });

export const catalogue = (ondc?: OndcFacts): Catalogue => ({
  seller: shop(ondc), nowMs: NOW, cancellationWindowHours: 6,
  items: [
    { id: "thali", name: "Veg thali", pricePaise: 12000, kind: "goods", available: 12, maxPerOrder: 10 },
    { id: "curd", name: "Curd", pricePaise: 2050, kind: "goods", available: 0, maxPerOrder: 10 },
  ],
  slots: [{ id: "lunch", mode: "pickup", from: "12:00", to: "13:00" }, { id: "lunch-home", mode: "delivery", from: "12:30", to: "13:30" }],
  areas: ["Kakkanad"],
});

/** An order of 2 thalis and a curd: 24000 + 2050 = 26050 paise, half in advance. */
export function order(state: string, over: Partial<OrderIn> = {}, ondc?: OndcFacts): OrderIn {
  const paid = state === "confirmed" || state === "completed";
  return {
    seller: shop(ondc), ref: "o-7", state, mode: "pickup", slot: LUNCH,
    lines: [{ itemId: "thali", name: "Veg thali", qty: 2, unitPaise: 12000 }, { itemId: "curd", name: "Curd", qty: 1, unitPaise: 2050 }],
    totalPaise: 26050, payments: [{ kind: "advance", amountPaise: 13025, paid, by: "owner-marked", reference: "o-7" }, { kind: "balance", amountPaise: 13025, paid: false }],
    holdIso: "PT30M", cancellationWindowHours: 6, createdMs: NOW - 3_600_000, nowMs: NOW, ...over,
  };
}

export function booking(state: string, over: Partial<BookingIn> = {}, ondc?: OndcFacts): BookingIn {
  return {
    seller: shop(ondc), ref: "b-3", state, service: { id: "haircut", name: "Haircut", pricePaise: 45000, durationMinutes: 45 }, startMs: Date.UTC(2026, 10, 18, 5, 0), endMs: Date.UTC(2026, 10, 18, 5, 45),
    payments: [{ kind: "advance", amountPaise: 20000, paid: state !== "awaiting_deposit", by: "provider", reference: "b-3" }, { kind: "balance", amountPaise: 25000, paid: false }],
    holdIso: "PT15M", cancellationWindowHours: 24, createdMs: NOW - 3_600_000, nowMs: NOW, ...over,
  };
}

export function purchase(state: string, over: Partial<PurchaseIn> = {}, ondc?: OndcFacts): PurchaseIn {
  return {
    buyer: shop(ondc), ref: "po-2", state, ack: "none", receipt: "none", paidOutside: false, supplier: { id: "ravi", name: "Ravi Traders" }, item: { id: "colour", name: "Hair colour", unit: "box" },
    qty: 10, receivedQty: 0, unitPaise: 45000, totalPaise: 450000, createdMs: NOW - 86_400_000, nowMs: NOW, ...over,
  };
}
export const SUPPLIER_IDS = { providerId: "P1", locationId: "L1", itemId: "I1", fulfillmentId: "F1" };
