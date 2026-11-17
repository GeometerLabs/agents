// Bookings through the ONDC mapping (modules/ondc): the Glow Salon example and the equipment-rental variant, their services and bookings turned into neutral types by src/ondc.ts and
// then into ONDC's services messages. Here and not in modules/ondc/test because a module test may not import a template. It holds: every required field of the services contract is
// present or its gap reported, exact money, a quote that adds up, every Bookings state mapped (read from booking.ts, so a new state fails here first), a round trip through the
// inbound reader, and exactly the gaps these shops have.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { services } from "../../../../modules/ondc/index.ts";
import { servicesOnSearch, servicesOrder } from "../../../../modules/ondc/contract.ts";
import { statesOf, statusOf } from "../../../../modules/ondc/states.ts";
import { audit, SAMPLE_CALLER } from "../../../../modules/ondc/verify.ts";
import { glowSalon } from "../src/harness.ts";
import { parseSettings } from "../src/settings.ts";
import type { Settings } from "../src/settings.ts";
import { createStore, newDraft, register } from "../src/booking.ts";
import type { Booking, BookingState } from "../src/booking.ts";
import { bookingIn, catalogueOf } from "../src/ondc.ts";

const NOW = Date.UTC(2026, 10, 17, 6, 30);
const rental = (): Settings => parseSettings(JSON.parse(readFileSync(new URL("../settings/equipment-rental.example.json", import.meta.url), "utf8")));
const SHOPS: [string, () => Settings][] = [["glow salon", glowSalon], ["equipment rental", rental]];
const keys = (o: { gaps: { missing: string }[] }) => o.gaps.map((g) => g.missing);
const stateNames = (): string[] => [...readFileSync(new URL("../src/booking.ts", import.meta.url), "utf8").match(/export type BookingState =([^;]+);/u)![1].matchAll(/"([a-z_]+)"/gu)].map((m) => m[1]);

function make(settings: Settings, state: BookingState): Booking {
  const b = register(createStore(), newDraft("+919800000009", "en"));
  b.state = state;
  b.serviceId = settings.services[0].id;
  b.startMs = Date.UTC(2026, 10, 18, 5, 0);
  b.endMs = b.startMs + settings.services[0].durationMinutes * 60_000;
  return b;
}

test("every state of Bookings maps to ONDC, read from booking.ts so a new state fails here", () => {
  assert.deepEqual([...statesOf("bookings")].sort(), stateNames().sort());
});

test("the services catalogue of each example: required fields, exact money, the gaps these shops have", () => {
  for (const [name, load] of SHOPS) {
    const settings = load();
    const out = services.onSearch(catalogueOf(settings, "client-1", NOW), SAMPLE_CALLER);
    const a = audit(out, servicesOnSearch, false);
    assert.deepEqual({ missing: a.missing, money: a.money }, { missing: [], money: [] }, name);
    assert.deepEqual(keys(out), ["city_code", "item_images", "service_category", "service_creds", "service_domain", "shop_address_parts", "shop_description", "shop_gps"].sort(), name);
    const items = (out.message.catalog as any).providers[0].items as any[];
    assert.deepEqual(items.map((i) => i.price.value), settings.services.map((s) => String(s.priceInr)), name);
    assert.deepEqual(items.map((i) => i.quantity.unitized.measure.value), settings.services.map((s) => String(s.durationMinutes)), name);
  }
  assert.equal(catalogueOf(rental(), "c", NOW).items.some((i) => i.resource !== undefined), rental().services.some((s) => s.resource !== undefined));
});

test("every state, every stage: the booking is a scheduled fulfillment with its deposit and balance; states with no order say nothing", () => {
  for (const [name, load] of SHOPS) {
    const settings = load();
    for (const state of stateNames() as BookingState[]) {
      const view = bookingIn(settings, make(settings, state), "client-1", NOW)!;
      const none = statusOf("bookings", state).stage === "none";
      const stages = state === "cancelled" || state === "expired" ? (["on_cancel"] as const) : (["on_select", "on_init", "on_confirm", "on_status"] as const);
      for (const stage of stages) {
        const out = services.bookingMessage(view, stage, SAMPLE_CALLER);
        if (none) { assert.equal(out, null, `${name} ${state}`); continue; }
        const a = audit(out!, servicesOrder(stage), false);
        assert.deepEqual({ missing: a.missing, money: a.money, sums: a.sums, flags: out!.flags }, { missing: [], money: [], sums: true, flags: [] }, `${name} ${state} ${stage}`);
        const o = out!.message.order as any;
        const range = o.fulfillments[0].stops[0].time.range;
        assert.deepEqual([range.start, range.end], ["2026-11-18T05:00:00.000Z", new Date(make(settings, state).endMs!).toISOString()]);
        // the quote's lines add up to its price (the services quote has no ONDC "title_type", so it is summed here)
        assert.equal(o.quote.breakup.reduce((n: number, l: any) => n + Number(l.price.value) * 100, 0), Number(o.quote.price.value) * 100);
      }
    }
  }
});

test("money and states in exact words: the deposit is PRE-FULFILLMENT, the rest is ON-FULFILLMENT, a booking waiting for its deposit is CREATED", () => {
  const settings = glowSalon(); // haircut 450, deposit 200
  const conf = services.bookingMessage(bookingIn(settings, make(settings, "confirmed"), "client-1", NOW)!, "on_confirm", SAMPLE_CALLER)!;
  const o = conf.message.order as any;
  assert.deepEqual(o.payments.map((p: any) => [p.type, p.status, p.params.amount]), [["PRE-FULFILLMENT", "PAID", "200"], ["ON-FULFILLMENT", "NOT-PAID", "250"]]);
  assert.equal(o.quote.price.value, "450");
  assert.equal(o.status, "ACCEPTED");
  const held = services.bookingMessage(bookingIn(settings, make(settings, "awaiting_deposit"), "client-1", NOW)!, "on_init", SAMPLE_CALLER)!.message.order as any;
  assert.deepEqual([held.status, held.payments[0].status], ["CREATED", "NOT-PAID"]);
  const gap = keys(conf);
  assert.deepEqual(gap, ["finder_fee", "record_times", "service_category", "service_domain", "service_form", "settlement_account", "shop_address_parts", "shop_gps", "shop_phone", "tax_breakup"].sort());
  const r = rental();
  const price = r.services[0].priceInr;
  assert.equal((services.bookingMessage(bookingIn(r, make(r, "confirmed"), "client-1", NOW)!, "on_confirm", SAMPLE_CALLER)!.message.order as any).quote.price.value, String(price)); // the rental's deposit is capped by its price
});

test("a booking with no service or time yet is not a neutral booking", () => {
  const settings = glowSalon();
  const b = register(createStore(), newDraft("+919800000009", "en"));
  assert.equal(bookingIn(settings, b, "client-1", NOW), undefined);
});
