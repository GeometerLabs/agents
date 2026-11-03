// The monthly running-cost line: exact arithmetic, unknown is never zero, a dated and pinned price list.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { glowSalon } from "../../../pathways/bookings/src/harness.ts";
import { PRICES_DIR, formatRupees, latestPriceList, loadPriceList, monthlyCost } from "../cost.ts";
import type { CostLine, PriceList } from "../cost.ts";

const prices = latestPriceList();
const settings = glowSalon();
const line = (c: { lines: CostLine[] }, id: CostLine["id"]) => c.lines.find((l) => l.id === id)!;

// The sha256 of each committed price list. A price list is never edited after it is committed; a new price is a new file, and a new line here.
const PINNED: Record<string, string> = {
  "2026-11-03.json": "0d77094e78500264c426f4e587f61299ad0d8bda7f450631306a6e15fa6db64f",
  "2026-11-04.json": "597287996446b11e0b09d649aa1c3c1248408b1b8c2d1204f183f6bbc13215cc",
};

test("the newest price list is the one dated 2026-11-04, and the bytes of every list are pinned: a changed price is a new file", () => {
  assert.equal(prices.date, "2026-11-04");
  const files = readdirSync(PRICES_DIR).filter((f) => f.endsWith(".json")).sort();
  assert.deepEqual(files, Object.keys(PINNED), "a price list is in bundle/prices that is not pinned here (or the reverse)");
  for (const file of files) {
    const actual = createHash("sha256").update(readFileSync(new URL(file, PRICES_DIR))).digest("hex");
    assert.equal(actual, PINNED[file], `bundle/prices/${file} was edited. Never edit a price list after it is committed: add a new file with a new date.`);
  }
});

test("every rate names its source, the day it was read (not after the list's own day) and how sure we are", () => {
  for (const [id, r] of Object.entries(prices.rates)) {
    assert.match(r.source, /^(https:\/\/|docs\/)/u, id);
    assert.match(r.read, /^\d{4}-\d{2}-\d{2}$/u, id);
    assert.ok(r.read <= prices.date, `${id} was read after the list's date`);
    assert.ok(r.note.length > 20, id);
  }
  assert.deepEqual([prices.rates["geometer.fee"].source, prices.rates["geometer.fee"].read, prices.rates["geometer.fee"].micro], ["https://geometer.dev/pricing", "2026-11-04", 199_000_000]);
  assert.equal(prices.rates["whatsapp.in.utility"].quality, "second-hand");
  assert.equal(prices.rates["razorpay.platform-fee"].quality, "conflicting");
  assert.equal(prices.exchange.USD?.quality, "assumed");
});

test("a price list is refused when its date is not its file name's, or a rate has no source or no quality", () => {
  const dir = mkdtempSync(join(tmpdir(), "geo-prices-"));
  const write = (name: string, value: unknown) => { const p = join(dir, name); writeFileSync(p, JSON.stringify(value)); return p; };
  const good = { format: "geometer-price-list/1", date: "2026-12-01", exchange: {}, rates: { "x.y": { currency: "INR", micro: 5, per: "message", quality: "official", source: "https://example.com/p", read: "2026-12-01", note: "a note" } } };
  assert.equal(loadPriceList(write("2026-12-01.json", good)).date, "2026-12-01");
  assert.throws(() => loadPriceList(write("2026-12-02.json", good)), /date .* must equal the date in its file name/u);
  assert.throws(() => loadPriceList(write("2026-12-01.json", { ...good, rates: { a: { ...good.rates["x.y"], source: "my head" } } })), /where it was read/u);
  assert.throws(() => loadPriceList(write("2026-12-01.json", { ...good, rates: { a: { ...good.rates["x.y"], quality: "sure" } } })), /how sure we are/u);
  assert.throws(() => loadPriceList(write("2026-12-01.json", { ...good, rates: { a: { ...good.rates["x.y"], micro: 1.5 } } })), /whole micro amount/u);
  assert.throws(() => loadPriceList(write("2026-12-01.json", { format: "other" })), /not a Geometer price list/u);
});

test("Glow Salon, 40 bookings a month: the line, to the paisa", () => {
  const c = monthlyCost({ settings }, prices);
  assert.equal(c.basis, "early-estimate");
  assert.equal(c.bookings, 40);
  // 40 bookings x (2 reminders + 1 owner notice) = 120 utility templates at 11.5 paise = 1,380 paise. 240 replies are inside the 1,000 free ones.
  assert.deepEqual([line(c, "whatsapp").state, line(c, "whatsapp").paise, line(c, "whatsapp").quantities.templates, line(c, "whatsapp").quantities.paidServiceReplies], ["amount", 1380, 120, 0]);
  // 40 deposits of Rs 200: fee 400 paise + 18% GST 72 paise = 472 each.
  assert.deepEqual([line(c, "razorpay").paise, line(c, "razorpay").payer], [40 * 472, "shop-pays-razorpay"]);
  // Geometer's fee is flat, INR 199 (the founding price), and the AI model is in it: no model line, nothing passed through, nothing that depends on bookings.
  assert.deepEqual([line(c, "geometer").state, line(c, "geometer").paise, line(c, "geometer").payer, line(c, "geometer").uses], ["amount", 19900, "builder-pays-geometer", ["geometer.fee"]]);
  assert.deepEqual(c.lines.map((l) => l.id), ["whatsapp", "whatsapp-provider", "razorpay", "geometer", "hosting"]);
  assert.deepEqual(c.lines.map((l) => l.payer), ["builder-pays-whatsapp-provider", "builder-pays-whatsapp-provider", "shop-pays-razorpay", "builder-pays-geometer", "hosting"]);
  // No provider is chosen and nothing has measured the hosting: those two are unknown, not zero.
  for (const id of ["whatsapp-provider", "hosting"] as const) assert.deepEqual([line(c, id).state, line(c, id).paise], ["unknown", null], id);
  assert.deepEqual(c.total, { paise: 1380 + 18880 + 19900, complete: false, unknown: ["whatsapp-provider", "hosting"] });
  assert.ok(c.caveats.includes("early-estimate") && c.caveats.includes("provider-not-chosen") && c.caveats.includes("hosting-not-measured"));
  assert.ok(c.caveats.includes("payment-link-fee-conflict") && c.caveats.includes("whatsapp-rate-second-hand") && !c.caveats.includes("fee-not-priced"));
  assert.deepEqual(c.priceList.date, "2026-11-04");
});

test("Geometer's fee comes from the price list and nowhere else: a changed fee changes the line, in rupees it needs no exchange rate, and a list without it is unknown, never INR 0", () => {
  const fee = prices.rates["geometer.fee"];
  const dearer: PriceList = { ...prices, rates: { ...prices.rates, "geometer.fee": { ...fee, micro: 299_000_000 } } };
  assert.equal(line(monthlyCost({ settings }, dearer), "geometer").paise, 29900);
  assert.equal(line(monthlyCost({ settings, observedBookings: 500 }, prices), "geometer").paise, 19900, "flat: bookings do not change it");
  assert.equal(line(monthlyCost({ settings }, { ...prices, exchange: {} }), "geometer").paise, 19900);
  const inDollars: PriceList = { ...prices, rates: { ...prices.rates, "geometer.fee": { ...fee, currency: "USD", micro: 3_000_000 } } };
  const usd = monthlyCost({ settings }, inDollars);
  assert.equal(line(usd, "geometer").paise, 27000); // US$3 at the list's assumed INR 90
  assert.ok(usd.caveats.includes("assumed-exchange-rate"));
  const { "geometer.fee": _gone, ...without } = prices.rates;
  const unpriced = monthlyCost({ settings }, { ...prices, rates: without });
  assert.deepEqual([line(unpriced, "geometer").state, line(unpriced, "geometer").paise], ["unknown", null]);
  assert.ok(unpriced.caveats.includes("fee-not-priced") && unpriced.total.unknown.includes("geometer"));
  const older = loadPriceList(new URL("2026-11-03.json", PRICES_DIR).pathname); // the list before the flat fee existed
  assert.equal(line(monthlyCost({ settings }, older), "geometer").paise, null, "an old list says unknown for a rate it never had");
});

test("each line is rounded up once, to the next paisa: three templates are 34.5 paise, so 35, not 34 and not 3 x 12", () => {
  const c = monthlyCost({ settings, assumptions: { bookingsPerMonth: 1, ownerNoticesPerBooking: 1 }, observedBookings: 1 }, prices);
  assert.equal(line(c, "whatsapp").paise, 35);
});

test("once more than 1,000 replies a month are sent, the rest cost the same as a utility message", () => {
  const c = monthlyCost({ settings, observedBookings: 200 }, prices); // 200 x 6 = 1,200 replies: 200 over
  assert.equal(line(c, "whatsapp").quantities.paidServiceReplies, 200);
  assert.equal(line(c, "whatsapp").paise, (200 * 3 + 200) * 11.5);
});

test("a provider that bills in dollars is converted at the list's assumed rate and says so; one in euros the same", () => {
  const g = monthlyCost({ settings, whatsappProvider: "gupshup" }, prices);
  assert.equal(line(g, "whatsapp-provider").paise, 600 * 9); // 40 x (2x6 + 2 + 1) = 600 messages at US$0.001 = 9 paise each
  assert.ok(g.caveats.includes("assumed-exchange-rate"));
  assert.ok(!g.caveats.includes("provider-not-chosen"));
  const d = monthlyCost({ settings, whatsappProvider: "360dialog" }, prices);
  assert.equal(line(d, "whatsapp-provider").paise, 490_000); // EUR 49 a number a month at an assumed INR 100 per euro
  assert.deepEqual(line(d, "whatsapp-provider").quantities, { numbers: 1 });
});

test("a provider the list has no price for is unknown, and so is a dollar price when the list has no exchange rate", () => {
  const p = monthlyCost({ settings, whatsappProvider: "interakt" }, prices);
  assert.deepEqual([line(p, "whatsapp-provider").state, line(p, "whatsapp-provider").paise], ["unknown", null]);
  assert.ok(p.caveats.includes("provider-not-priced"));
  const noExchange: PriceList = { ...prices, exchange: {} };
  const q = monthlyCost({ settings, whatsappProvider: "gupshup" }, noExchange);
  assert.equal(line(q, "whatsapp-provider").paise, null);
});

test("when every price is known the total is complete; real bookings from the record make it 'from the record', not an early estimate", () => {
  const c = monthlyCost({ settings, whatsappProvider: "gupshup", hostingSharePaise: 5000, observedBookings: 12 }, prices);
  assert.equal(c.basis, "from-record");
  assert.equal(c.bookings, 12);
  assert.ok(!c.caveats.includes("early-estimate"));
  assert.deepEqual([c.total.complete, c.total.unknown], [true, []]);
  assert.equal(c.total.paise, c.lines.reduce((s, l) => s + (l.paise ?? 0), 0));
  assert.equal(line(c, "hosting").paise, 5000);
});

test("no line is ever zero by being unknown", () => {
  for (const input of [{}, { whatsappProvider: "gupshup" }, { whatsappProvider: "nobody" }, { hostingSharePaise: 0 }]) {
    for (const l of monthlyCost({ settings, ...input }, prices).lines) assert.equal(l.state === "unknown", l.paise === null, `${l.id}: only an unknown line has no amount`);
  }
});

test("rupees are written with Indian grouping and two places", () => {
  assert.equal(formatRupees(18880), "₹188.80");
  assert.equal(formatRupees(5), "₹0.05");
  assert.equal(formatRupees(12_500_000), "₹1,25,000.00");
});

test("a model price in the eval's models.json is the same as the price list's (the next step is to make the eval read the list)", () => {
  const models = JSON.parse(readFileSync(new URL("../../../pathways/bookings/eval/models.json", import.meta.url), "utf8")) as { candidates: { name: string; priceInputPerMillion: number | null; priceOutputPerMillion: number | null }[] };
  let compared = 0;
  for (const c of models.candidates) {
    const input = prices.rates[`model.${c.name}.input`];
    const output = prices.rates[`model.${c.name}.output`];
    if (c.priceInputPerMillion === null) continue; // models.json is behind the list here; the list is the better source
    assert.equal(input?.micro, Math.round(c.priceInputPerMillion * 1_000_000), c.name);
    assert.equal(output?.micro, Math.round((c.priceOutputPerMillion as number) * 1_000_000), c.name);
    compared++;
  }
  assert.ok(compared >= 2);
});
