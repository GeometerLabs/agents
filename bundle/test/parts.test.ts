// A shop of several parts in the bundle (decision 65): KINDS.parts checks the starter shop by every part's own check, has one WhatsApp Guard and no gateway, lets its WhatsApp
// Guard write to any number when a part writes to customers (and only to the fixed list of a shop of Stock orders alone), declares each part's limits under the part's own id and
// path, and reads its runtime.json as Fees and Orders do; the WhatsApp spec made with no list has no allowlist.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { KINDS, guardsOf } from "../lib/kinds.ts";
import { whatsappSpec } from "../generate/guards.ts";

const starter = JSON.parse(readFileSync(new URL("../../templates/commerce/parts/settings/ganesh-electricals-starter.example.json", import.meta.url), "utf8"));

test("KINDS.parts: the starter shop is checked by each part's own template, one WhatsApp Guard, no gateway", () => {
  const k = KINDS.parts;
  const r = k.validateSettings(starter);
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(guardsOf(k, r.settings), ["whatsapp"]);
  assert.equal(k.gatewaySpec, undefined);
  assert.equal(k.casesName, "cases");
  assert.ok(k.validateRuntimeConfig({ mode: "live", host: "0.0.0.0", port: 8780, dataDir: "/home/node/data", tickSeconds: 30, services: { messaging: { baseUrl: "http://g:8080", phoneNumberId: "100000000000001" }, timeoutMs: 20000 } }, "/tmp").ok);
});

test("the WhatsApp Guard writes to any number when a part writes to customers; a shop of Stock orders alone keeps its fixed list", () => {
  const k = KINDS.parts;
  const r = k.validateSettings(starter);
  assert.ok(r.ok);
  assert.equal(k.guardRecipients!(r.settings), undefined, "the hold and the credit book write to customers");
  const spec = whatsappSpec({ tenant: "t", version: 1, reviewedBy: "r" } as never, { phoneNumberId: "100000000000001", messagesPerHour: 100 });
  assert.ok(!JSON.stringify(spec).includes("approved-recipients-only"), "no list, no allowlist");
  const stockOnly = k.validateSettings({ ...starter, parts: { "stock-orders": starter.parts["stock-orders"] } });
  assert.ok(stockOnly.ok);
  const list = k.guardRecipients!(stockOnly.settings);
  assert.ok(list.includes("+919800000001") && list.includes("+919876500001") && list.length === KINDS["stock-orders"].guardRecipients!(stockOnly.settings.parts[0].settings).length, "the owner and the approved supplier, as Stock orders' own list");
});

test("each part's limits are its own, under its own id and path", () => {
  const ids = KINDS.parts.chatLimits.map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes("orders_refund_limit") && ids.includes("fees_refund_limit") && ids.includes("stock_orders_order_cap"));
  for (const l of KINDS.parts.chatLimits) assert.match(l.path, /^parts\.(fees|orders|stock-orders)\./u);
  const cap = KINDS.parts.chatLimits.find((l) => l.id === "stock_orders_order_cap")!;
  assert.ok(cap.bounds(starter).min >= 900, "its bounds read the part's own settings (never below the dearest catalogue line)");
});
