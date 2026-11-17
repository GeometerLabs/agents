// Reading the owner's words: item, supplier, unit, quantity and the commands, by rules only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readOwnerText, quantityIn } from "../src/reading.ts";
import { glowSalon } from "../src/harness.ts";

const s = glowSalon();

test("a request names the item, supplier, unit and number", () => {
  const r = readOwnerText(s, "order 10 boxes of hair colour from Ravi Traders");
  assert.deepEqual([r.kind, (r as any).item, (r as any).supplier, (r as any).unit, (r as any).qty], ["order", "hair-colour", "ravi-traders", "box", 10]);
});

test("no unit is read when none is written, and a supplier not on the list is named as unknown", () => {
  const r = readOwnerText(s, "order 10 hair colour from Sharma Stores") as any;
  assert.equal(r.unit, undefined);
  assert.equal(r.unknownSupplier, "sharma stores");
});

test("a low-stock mark and the commands about an order", () => {
  assert.equal((readOwnerText(s, "shampoo from ravi is low") as any).lowStock, true);
  assert.deepEqual(readOwnerText(s, "received po-3 6"), { kind: "command", command: "receive", ref: "po-3", qty: 6 });
  assert.equal((readOwnerText(s, "wrong po-2") as any).command, "wrong");
  assert.equal((readOwnerText(s, "paid po-2") as any).command, "paid");
  assert.equal((readOwnerText(s, "cancel po-2") as any).command, "cancel");
  assert.equal(readOwnerText(s, "status").kind, "status");
  assert.equal(readOwnerText(s, "good morning").kind, "other");
});

test("the number skips an order number and a price", () => {
  assert.equal(quantityIn("change po-3 to 12"), 12);
  assert.equal(quantityIn("order hair colour at ₹450"), undefined);
  assert.equal(quantityIn("order ten boxes"), 10);
});
