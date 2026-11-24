// The parts shop's settings, as the deployer and the panel check them (src/settings.ts), and the union of its parts' WhatsApp templates (src/whatsapp.ts). Pure: no program.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { asParts, partSettings, validateSettings } from "../src/settings.ts";
import { partsMetaTemplates, unionOfTemplates } from "../src/whatsapp.ts";

const starter = JSON.parse(readFileSync(new URL("../settings/ganesh-electricals-starter.example.json", import.meta.url), "utf8")) as Record<string, any>;
const hold = JSON.parse(readFileSync(new URL("../../orders/settings/ganesh-electricals-hold.example.json", import.meta.url), "utf8")) as Record<string, any>;

test("the starter shop is three parts, each checked by its own template", () => {
  const r = validateSettings(starter);
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(r.settings.parts.map((p) => p.name), ["fees", "stock-orders", "orders"]);
  assert.equal(r.settings.owner.whatsapp, "+919800000001");
  assert.equal(r.settings.parts[2].settings.owner.approveOverInr, 0, "the Orders part's own owner member joins the shop's owner");
});

test("refused: an unknown part, a key the shop sets once, an owner member in both, a payment gateway, a carried part that is not one", () => {
  const bad = (change: (s: any) => void): string[] => { const s = structuredClone(starter); change(s); const r = validateSettings(s); return r.ok ? [] : r.errors; };
  assert.match(bad((s) => { s.parts.bookings = {}; }).join("\n"), /"bookings" is not a template/u);
  assert.match(bad((s) => { s.parts.orders.name = "Other"; }).join("\n"), /parts\.orders: "name" is the shop's/u);
  assert.match(bad((s) => { s.parts.orders.owner.whatsapp = "+919800000002"; }).join("\n"), /"owner\.whatsapp" is the shop's/u);
  assert.match(bad((s) => { s.parts.fees.payment = { module: "razorpay" }; }).join("\n"), /takes UPI payments/u);
  assert.match(bad((s) => { s.carried = "orders-old"; }).join("\n"), /"carried" names "orders-old"/u);
  assert.match(bad((s) => { s.parts.fees.creditBook.maxPerPersonInr = -1; }).join("\n"), /^parts\.fees: /mu, "a part's own problem is said with its part");
});

test("asParts makes one template's settings a part, and partSettings gives them back as the template reads them", () => {
  const parts = asParts("orders", hold, { others: { fees: starter.parts.fees }, carried: true });
  assert.equal(parts.carried, "orders");
  assert.deepEqual(Object.keys(parts.parts as object), ["orders", "fees"]);
  const back = partSettings(parts, "orders", (parts.parts as any).orders);
  assert.ok(back.ok);
  assert.deepEqual(back.file, hold, "the part reads exactly the single shop's settings");
  assert.ok(validateSettings(parts).ok);
});

test("the shop's WhatsApp templates are the union of its parts', each once; the same name with other words is a conflict", () => {
  const all = partsMetaTemplates(["fees", "stock-orders", "orders"]);
  const names = all.map((t) => t.name);
  assert.equal(new Set(names).size, names.length, "each template once");
  for (const p of ["fees", "orders", "stock-orders"] as const) for (const t of partsMetaTemplates([p])) assert.ok(names.includes(t.name), `${p}'s ${t.name} is in the union`);
  const u = unionOfTemplates([[{ name: "a", language: "en", text: "x" }], [{ name: "a", language: "en", text: "x" }, { name: "a", language: "hi", text: "y" }], [{ name: "a", language: "en", text: "z" }]]);
  assert.equal(u.templates.length, 2);
  assert.equal(u.conflicts.length, 1);
});
