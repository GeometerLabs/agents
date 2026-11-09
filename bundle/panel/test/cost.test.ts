// The monthly running-cost line: exact arithmetic, unknown is never zero, a dated and pinned price list.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { glowSalon } from "../../../templates/commerce/bookings/src/harness.ts";
import { RATES } from "../../../modules/understanding/rates.ts";
import { PRICES_DIR, formatRupees, latestPriceList, loadPriceList, monthlyCost, planFromSettings } from "../cost.ts";
import type { CostLine, PriceList } from "../cost.ts";

// The arithmetic below is checked on the list of 9 Nov, by name: a dated list never changes, so these numbers hold whatever list comes into force later.
const prices = loadPriceList(new URL("2026-11-09.json", PRICES_DIR).pathname);
const settings = glowSalon();
const line = (c: { lines: CostLine[] }, id: CostLine["id"]) => c.lines.find((l) => l.id === id)!;

// The sha256 of each committed price list. A price list is never edited after it is committed; a new price is a new file, and a new line here.
const PINNED: Record<string, string> = {
  "2026-11-03.json": "0d77094e78500264c426f4e587f61299ad0d8bda7f450631306a6e15fa6db64f",
  "2026-11-04.json": "6c495979cdaf40194c811e6f9716ec1286afc02a8003418c5e68bb913d8a156d",
  "2026-11-05.json": "3af9b56ca2cfac974e363acf31263b21d437e9c9e28e3575adcfc50a3b88e2b9", // the proposal: latestPriceList skips it (see plans.test.ts)
  "2026-11-07.json": "1534f0af36e98c1ca35ee22c9e219e59240248c5396021521a4d90278fb2444a", // the owner's decision of 5 Nov
  "2026-11-09.json": "19b0afdba0f6538839895cc9dad59b0f51cd80e49044a9fafde9f3866d085f04", // the owner's decision of 9 Nov: two price lists, partners and builders
};

test("the panel reads the newest dated list that is not a proposal, and the bytes of every list are pinned: a changed price is a new file", () => {
  const files = readdirSync(PRICES_DIR).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/u.test(f)).sort();
  const newestInForce = [...files].reverse().find((f) => loadPriceList(new URL(f, PRICES_DIR).pathname).status !== "proposed");
  assert.equal(`${latestPriceList().date}.json`, newestInForce);
  assert.deepEqual(files, Object.keys(PINNED), "a price list is in prices/ that is not pinned here (or the reverse): add its sha256 to PINNED");
  for (const file of files) {
    const actual = createHash("sha256").update(readFileSync(new URL(file, PRICES_DIR))).digest("hex");
    assert.equal(actual, PINNED[file], `prices/${file} was edited. Never edit a price list after it is committed: add a new file with a new date (node prices/new.ts <date>).`);
  }
});

test("every rate names its source, the day it was read (not after the list's own day) and how sure we are", () => {
  for (const [id, r] of Object.entries(prices.rates)) {
    assert.match(r.source, /^(https:\/\/|docs\/)/u, id);
    assert.match(r.read, /^\d{4}-\d{2}-\d{2}$/u, id);
    assert.ok(r.read <= prices.date, `${id} was read after the list's date`);
    assert.ok(r.note.length > 20, id);
  }
  assert.equal(prices.rates["geometer.fee"], undefined, "a plan replaces the flat fee of the 4 Nov list");
  assert.deepEqual(["basic", "business", "operations"].map((p) => [prices.rates[`plan.${p}.fee`].source, prices.rates[`plan.${p}.fee`].micro]), [["docs/product/economics-and-pricing.md", 149_000_000], ["docs/product/economics-and-pricing.md", 299_000_000], ["docs/product/economics-and-pricing.md", 999_000_000]]);
  assert.equal(prices.rates["licence.builder.fee"].micro, 149_000_000, "the builder licence: INR 149 a live client business a month, flat");
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
  assert.deepEqual([line(c, "gateway").paise, line(c, "gateway").payer], [40 * 472, "shop-pays-gateway"]);
  // Geometer's line is the shop's plan: Glow Salon takes a deposit, so it is Business, INR 299 before GST, and the AI model is in it: no model line, nothing passed through, nothing that depends on bookings.
  assert.deepEqual([line(c, "geometer").state, line(c, "geometer").paise, line(c, "geometer").payer, line(c, "geometer").uses, line(c, "geometer").plan], ["amount", 29900, "builder-pays-geometer", ["plan.business.fee"], "business"]);
  assert.deepEqual(c.lines.map((l) => l.id), ["whatsapp", "whatsapp-provider", "gateway", "geometer", "hosting"]);
  assert.deepEqual(c.lines.map((l) => l.payer), ["builder-pays-whatsapp-provider", "builder-pays-whatsapp-provider", "shop-pays-gateway", "builder-pays-geometer", "hosting"]);
  // No provider is chosen and nothing has measured the hosting: those two are unknown, not zero.
  for (const id of ["whatsapp-provider", "hosting"] as const) assert.deepEqual([line(c, id).state, line(c, id).paise], ["unknown", null], id);
  assert.deepEqual(c.total, { paise: 1380 + 18880 + 29900, complete: false, unknown: ["whatsapp-provider", "hosting"] });
  assert.ok(c.caveats.includes("early-estimate") && c.caveats.includes("provider-not-chosen") && c.caveats.includes("hosting-not-measured"));
  assert.ok(c.caveats.includes("payment-link-fee-conflict") && c.caveats.includes("whatsapp-rate-second-hand") && !c.caveats.includes("fee-not-priced"));
  assert.deepEqual(c.priceList.date, "2026-11-09");
});

test("Geometer's plan comes from the price list and nowhere else: the plan follows what the agent does, a changed price changes the line, and a list without it is unknown, never INR 0", () => {
  const noDeposit = { ...settings, deposit: { ...settings.deposit, amountInr: 0 } };
  assert.deepEqual([planFromSettings(settings), planFromSettings(noDeposit)], ["business", "basic"], "a deposit is Business, no money moving is Basic");
  assert.deepEqual([line(monthlyCost({ settings: noDeposit }, prices), "geometer").paise, line(monthlyCost({ settings: noDeposit }, prices), "geometer").plan], [14900, "basic"]);
  assert.equal(line(monthlyCost({ settings, plan: "operations" }, prices), "geometer").paise, 99900, "fleet's plan wins over the settings");
  const fee = prices.rates["plan.business.fee"];
  const dearer: PriceList = { ...prices, rates: { ...prices.rates, "plan.business.fee": { ...fee, micro: 399_000_000 } } };
  assert.equal(line(monthlyCost({ settings }, dearer), "geometer").paise, 39900);
  assert.equal(line(monthlyCost({ settings, observedBookings: 500 }, prices), "geometer").paise, 29900, "flat: bookings do not change it");
  assert.equal(line(monthlyCost({ settings }, { ...prices, exchange: {} }), "geometer").paise, 29900);
  const inDollars: PriceList = { ...prices, rates: { ...prices.rates, "plan.business.fee": { ...fee, currency: "USD", micro: 3_000_000 } } };
  const usd = monthlyCost({ settings }, inDollars);
  assert.equal(line(usd, "geometer").paise, 28200); // US$3 at the list's assumed INR 94
  assert.ok(usd.caveats.includes("assumed-exchange-rate"));
  const { "plan.business.fee": _gone, ...without } = prices.rates;
  const unpriced = monthlyCost({ settings }, { ...prices, rates: without });
  assert.deepEqual([line(unpriced, "geometer").state, line(unpriced, "geometer").paise], ["unknown", null]);
  assert.ok(unpriced.caveats.includes("fee-not-priced") && unpriced.total.unknown.includes("geometer"));
  const flat = loadPriceList(new URL("2026-11-04.json", PRICES_DIR).pathname); // the list before the plans: its flat fee still prices a month it was in force for
  assert.deepEqual([line(monthlyCost({ settings }, flat), "geometer").paise, line(monthlyCost({ settings }, flat), "geometer").plan], [19900, undefined]);
  const older = loadPriceList(new URL("2026-11-03.json", PRICES_DIR).pathname); // the list before any fee existed
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
  assert.equal(line(g, "whatsapp-provider").paise, 5640); // 40 x (2x6 + 2 + 1) = 600 messages at US$0.001 = 9.4 paise each at the list's INR 94
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

test("every model price in a bundle price list says what the one model rate table says (modules/understanding/rates/): the lists carry no second copy that could drift", () => {
  let compared = 0;
  for (const file of readdirSync(PRICES_DIR).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/u.test(f)).sort()) {
    const list = loadPriceList(new URL(file, PRICES_DIR).pathname);
    for (const [id, r] of Object.entries(list.rates)) {
      const m = /^model\.(.+)\.(input|output)$/u.exec(id);
      if (!m) continue;
      const rate = RATES.find((x) => x.model === m[1]);
      assert.ok(rate, `${file} prices ${m[1]}, which the rate table has no line for: the table is the one source for model prices`);
      assert.equal(r.currency, "USD", `${file} ${id}`);
      assert.equal(r.micro, Math.round((m[2] === "input" ? rate.inputUsdPerMillion : rate.outputUsdPerMillion) * 1_000_000), `${file} ${id} differs from the rate table`);
      compared++;
    }
  }
  assert.ok(compared >= 16, `${compared} model prices compared`); // four models, input and output, in the lists of 3, 4 and 5 Nov
});
