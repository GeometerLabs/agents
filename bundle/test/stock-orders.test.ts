// Stock orders in the bundle and the shared modules: the panel finds it and has a phone setup for it, the setup's forms make settings the template accepts, the words exist in four
// languages, its unfinished-work kinds read a purchase order's own fields, the ask card lists it, and an export of its store is not mistaken for Orders'.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { discoverTemplates } from "../panel/templates.ts";
import { SETUPS, setupOf, reportOf } from "../panel/setups.ts";
import { STOCK_PANEL_WORDS, applyStockBusiness, applyStockRules, buildStockSettings, catalogueLine, newStockDraft, runtimeForStock, stockDraftFromShop, supplierLine } from "../panel/stock.ts";
import { WORDS } from "../panel/words.ts";
import { LANGUAGES } from "../../modules/language/languages.ts";
import { glowSalon } from "../../templates/commerce/stock-orders/src/harness.ts";
import { validateRuntimeConfig } from "../../templates/commerce/stock-orders/server/config.ts";
import { createObligationRegistry } from "../../modules/unfinished/registry.ts";
import { BUILT_IN } from "../../modules/unfinished/builtin.ts";
import { CARD_TEMPLATES, LIST } from "../../modules/ask-card/list.ts";
import { askCardFor, staleCards } from "../../modules/ask-card/render.ts";
import { STOCK_WORDS } from "../../modules/channels/words-stock.ts";
import { orderCapLimit, monthlyBudgetLimit } from "../../modules/limits/chat-limit-kinds.ts";

const TEMPLATES = fileURLToPath(new URL("../../templates", import.meta.url));
const example = glowSalon();

test("the panel finds Stock orders on its own, with its phone setup and its report", () => {
  const t = discoverTemplates(TEMPLATES).find((x) => x.id === "stock-orders")!;
  assert.ok(t, "template.json is found");
  assert.equal(t.setup, "stock-orders");
  assert.deepEqual(t.accounts, ["whatsapp"]);
  assert.ok(t.steps.includes("deposit") && t.steps.includes("character"));
  assert.ok(setupOf("stock-orders") === SETUPS["stock-orders"]);
  assert.ok(reportOf("stock-orders") !== reportOf("bookings"));
});

test("the forms read a supplier and a catalogue line, and an owner's typing becomes settings the template accepts", () => {
  assert.deepEqual(supplierLine("Ravi Traders, +91 98765 00001"), { name: "Ravi Traders", number: "+919876500001" });
  assert.equal(supplierLine("Ravi Traders"), undefined);
  assert.deepEqual(catalogueLine("hair colour, Ravi Traders, box, 1200, 10"), { item: "hair colour", supplier: "Ravi Traders", unit: "box", price: "1200", reorder: "10" });
  const template = { id: "stock-orders", version: "0.1.0", setup: "stock-orders", steps: [], accounts: [], folder: "", settingsExample: "" } as never;
  const draft = newStockDraft("glow", "acct", template, example, "2026-11-17");
  const w = WORDS.en;
  assert.deepEqual(applyStockBusiness(draft, { name: "Glow Salon", address: "Thrissur", suppliers: "Ravi Traders, +919876500001\nMeena Mart, +919876500002", catalogue: "hair colour, Ravi Traders, box, 1200, 10\nshampoo, Meena Mart, bottle, 180" }, w).problems, []);
  assert.deepEqual(applyStockRules(draft, { maxPerOrderInr: "12000", monthlyBudgetInr: "20000" }, w).problems, []);
  draft.ownerNumber = "+919812300001"; draft.ownerLanguage = "en"; draft.primaryLanguage = "en";
  const built = buildStockSettings(draft, example);
  assert.equal(built.ok, true, built.ok ? "" : built.errors.join("; "));
  if (built.ok) { assert.equal(built.settings.catalogue.length, 2); assert.equal(built.settings.suppliers.length, 2); assert.equal(built.settings.limits.monthlyBudgetInr, 20000); }
});

test("the forms refuse in plain words: no suppliers, a line naming no supplier, a cap above the budget, a cap below the dearest line", () => {
  const draft = newStockDraft("glow", "acct", { id: "stock-orders", version: "0.1.0", setup: "stock-orders", steps: [], accounts: [], folder: "", settingsExample: "" } as never, example, "2026-11-17");
  const w = WORDS.en;
  assert.ok(applyStockBusiness(draft, { name: "Glow", suppliers: "", catalogue: "" }, w).problems.length >= 2);
  assert.ok(applyStockBusiness(draft, { name: "Glow", suppliers: "Ravi, +919876500001", catalogue: "tape, Nobody, roll, 10" }, w).problems.some((p) => p.includes("Nobody")));
  applyStockBusiness(draft, { name: "Glow", suppliers: "Ravi, +919876500001", catalogue: "tape, Ravi, roll, 500" }, w);
  assert.ok(applyStockRules(draft, { maxPerOrderInr: "9000", monthlyBudgetInr: "5000" }, w).problems.length > 0);
  assert.ok(applyStockRules(draft, { maxPerOrderInr: "100", monthlyBudgetInr: "5000" }, w).problems.some((p) => p.includes("500")));
});

test("a saved shop becomes a draft and builds the same settings back", () => {
  const meta = {} as never;
  const draft = stockDraftFromShop("glow", "acct", "stock-orders", "glow", example, undefined, meta, "2026-11-17");
  const built = buildStockSettings(draft, example);
  assert.equal(built.ok, true, built.ok ? "" : built.errors.join("; "));
  if (built.ok) { assert.deepEqual(built.settings.suppliers.map((s) => [s.id, s.whatsapp]), example.suppliers.map((s) => [s.id, s.whatsapp])); assert.equal(built.settings.catalogue.length, example.catalogue.length); }
});

test("its runtime.json has WhatsApp and nothing else, and passes the template's own check", () => {
  const rt = runtimeForStock("123456789");
  assert.deepEqual(Object.keys(rt.services as object).sort(), ["messaging", "timeoutMs"]);
  const checked = validateRuntimeConfig({ ...rt, services: { messaging: { baseUrl: "http://guard:8080", phoneNumberId: "123456789" } } }, "/tmp");
  assert.equal(checked.ok, true);
});

test("every word of the setup, the owner's page and the limits exists in four languages", () => {
  for (const l of LANGUAGES) {
    assert.ok(STOCK_PANEL_WORDS[l].business.suppliersHelp && STOCK_WORDS[l].tagApprove && WORDS[l].setUp !== undefined, l);
    assert.equal(typeof STOCK_PANEL_WORDS[l].problems.capAbovePrice("₹1"), "string");
    assert.ok(orderCapLimit("a.b", () => ({ min: 1, max: 2 })).name[l] && monthlyBudgetLimit("a.b", () => ({ min: 1, max: 2 })).rule[l].includes("{v}"));
  }
});

test("the two unfinished-work kinds read a purchase order's own fields and leave when it is answered or received", () => {
  const registry = createObligationRegistry(BUILT_IN);
  const now = 100 * 24 * 3_600_000;
  const cases = [
    { id: "po-1", state: "sent", pending: [], ack: "none", silentToldMs: now - 1_000 },
    { id: "po-2", state: "sent", pending: [], ack: "accepted", receipt: "none", sentMs: now - 8 * 24 * 3_600_000 },
    { id: "po-3", state: "sent", pending: [], ack: "accepted", receipt: "full", sentMs: now - 8 * 24 * 3_600_000 },
    { id: "po-4", state: "sent", pending: [], ack: "accepted", receipt: "none", sentMs: now - 1_000 },
  ];
  const found = registry.detect({ template: "stock-orders", entries: [], cases, nowMs: now, options: { approvalWaitMs: 12 * 3_600_000, graceMs: 600_000 } }).found;
  assert.deepEqual(found.map((f) => [f.kind, f.caseId]).sort(), [["goods_not_received", "po-2"], ["supplier_no_answer", "po-1"]]);
  const other = registry.detect({ template: "orders", entries: [], cases, nowMs: now, options: { approvalWaitMs: 12 * 3_600_000, graceMs: 600_000 } }).found;
  assert.deepEqual(other.filter((f) => ["supplier_no_answer", "goods_not_received"].includes(f.kind)), [], "Orders never lists them");
});

test("the ask card lists Stock orders in four languages without a UPI line, and its files are made from the list", () => {
  assert.ok(CARD_TEMPLATES.includes("stock-orders"));
  assert.ok(!LIST["stock-orders"].some((i) => i.id === "upi"));
  for (const l of LANGUAGES) assert.ok(askCardFor("stock-orders", l).items.length >= 4, l);
  assert.deepEqual(staleCards().filter((p) => p.includes("stock-orders")), []);
});
