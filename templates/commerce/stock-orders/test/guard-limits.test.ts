// What Stock orders asks of the WhatsApp Guard: the owner and the approved suppliers are the only numbers a message may go to, and a paused supplier is out of the list.
import { test } from "node:test";
import assert from "node:assert/strict";
import { glowSalon } from "../src/harness.ts";
import { approvedRecipients } from "../src/guard-limits.ts";
import { whatsappSpec } from "../../../../bundle/generate/guards.ts";
import { KINDS, kindFor } from "../../../../bundle/lib/kinds.ts";

test("the owner and every approved supplier are in the list, in both spellings, and a paused supplier is not", () => {
  const s = glowSalon();
  const list = approvedRecipients(s);
  assert.ok(list.includes(s.owner.whatsapp) && list.includes(s.owner.whatsapp.replace(/\D/gu, "")));
  for (const sup of s.suppliers) assert.equal(list.includes(sup.whatsapp), sup.approved, sup.id);
});

test("the WhatsApp spec carries an exact approved-recipients rule only when it is given a list", () => {
  const id = { tenant: "glow-salon", name: "glow-salon-whatsapp", version: 1, reviewedBy: "test" };
  const plain = whatsappSpec(id, { phoneNumberId: "123", messagesPerHour: 60 });
  assert.ok(!plain.rules.some((r) => r.id === "approved-recipients-only"));
  const s = glowSalon();
  const spec = whatsappSpec(id, { phoneNumberId: "123", messagesPerHour: 60, recipients: approvedRecipients(s) });
  const rule = spec.rules.find((r) => r.id === "approved-recipients-only") as { field: string; match: string; operation: string; allowed_values: string[] };
  assert.deepEqual([rule.field, rule.match, rule.operation], ["to", "exact", "send"]);
  assert.deepEqual(rule.allowed_values, approvedRecipients(s));
});

test("the bundle knows the template: WhatsApp only, no gateway spec, its own limits and recipients", () => {
  const kind = kindFor("stock-orders")!;
  assert.equal(kind.id, "stock-orders");
  assert.deepEqual(kind.guards, ["whatsapp"]);
  assert.equal(kind.gatewaySpec, undefined);
  assert.deepEqual(kind.chatLimits.map((l) => l.id), ["order_cap", "monthly_budget"]);
  assert.deepEqual(kind.guardRecipients!(glowSalon()), approvedRecipients(glowSalon()));
  assert.ok(Object.keys(KINDS).includes("stock-orders"));
});
