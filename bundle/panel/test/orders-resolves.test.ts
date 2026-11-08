// Everywhere the panel decides by template, a shop whose lock says `orders@…` is an Orders shop. Each assertion is one a shop that fell back to Bookings would fail: the kind of the shop,
// the hand check and its digest, the cases the export is read for (the unfinished-work list, the case list, the papers), the monthly report, the shop page, and the setup drafts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { KINDS } from "../../lib/kinds.ts";
import { runBusyMonth } from "../../../templates/commerce/orders/report/example-month.ts";
import { WORDS } from "../languages.ts";
import { createDocuments } from "../documents.ts";
import { createGoLive } from "../golive.ts";
import { inboxFor, optionsFor } from "../inbox.ts";
import { createPapers } from "../papers.ts";
import { createShops } from "../shops.ts";
import { openStores } from "../server.ts";
import { accountIdOf, boot, NOW } from "./helpers.ts";
import type { Boot } from "./helpers.ts";

const TEMPLATE = new URL("../../../templates/commerce/orders/", import.meta.url).pathname;

/** An Orders shop on the server, the way `shop add --template orders` makes one: the template's example settings, the pin, and a runtime.json with no calendar. */
function addOrdersShop(b: Boot, id: string, ownerId?: string): void {
  const shop = join(b.dir, "shops", id);
  mkdirSync(shop, { recursive: true });
  cpSync(join(TEMPLATE, "settings", "annapurna-tiffins.example.json"), join(shop, "settings.json"));
  writeFileSync(join(shop, "pathway.lock"), "orders@0.1.0\n");
  writeFileSync(join(shop, "runtime.json"), JSON.stringify({ mode: "live", tickSeconds: 30, services: { payments: {}, messaging: { phoneNumberId: "100000000000001" }, timeoutMs: 20000 } }));
  if (ownerId) writeFileSync(join(shop, "owner.json"), JSON.stringify({ schema: 1, accountId: ownerId, accountName: "Divya", role: "partner", createdAt: "2026-11-01T10:00:00Z", template: "orders" }));
}
function exportOrders(b: Boot, shop: string, orders: unknown[], entries: unknown[]): void {
  const dir = join(b.dir, "exports", shop);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "record.json"), JSON.stringify(entries));
  writeFileSync(join(dir, "orders.json"), JSON.stringify(orders));
}

test("an orders@ lock is an Orders shop in every place the panel decides by template", async () => {
  const month = await runBusyMonth();
  const entries = month.world.record.entries();
  const orders = [...month.world.store.orders.values()];
  const b = await boot({}, { signing: true });
  try {
    const arjun = await b.account("arjun", "builder");
    const divya = await b.account("divya", "partner");
    addOrdersShop(b, "annapurna", accountIdOf(b, "divya"));
    exportOrders(b, "annapurna", orders, entries);
    const { store } = openStores(b.config);
    const shops = createShops(b.config, store);

    // the shop: its kind, its settings read by Orders' own check, its folder accepted by Orders' own check
    assert.equal(shops.kind("annapurna"), "orders");
    const settings = shops.settings("annapurna");
    assert.deepEqual(settings.menu.map((i: { id: string }) => i.id), ["veg-thali", "chicken-meal", "curd"]);
    assert.deepEqual(shops.checkFolder(settings, shops.runtime("annapurna")!, "orders@0.1.0", true, { pathway: "orders", version: "0.1.0" }), []);

    // the hand check and its digest are Orders'
    const live = createGoLive(b.config, shops, store);
    const ran = await live.run("annapurna");
    assert.ok(ran && ran.hand.total > 0 && ran.hand.held === ran.hand.total, JSON.stringify(ran?.hand));
    assert.equal(ran.settingsDigest, KINDS.orders.papers.policyDigest(settings));
    assert.equal(ran.hand.total, KINDS.orders.papers.summariseRun(await KINDS.orders.papers.runOn(settings)).total);

    // the cases of the export: the orders are read, not the (empty) bookings
    const papers = createPapers(b.config, shops, createDocuments(store), () => NOW);
    const one = orders.find((o) => o.state === "completed")!;
    const dispute = papers.dispute("annapurna", one.id, "en");
    assert.ok(dispute.map((p) => p.file).includes(`case-${one.id}.json`), "the record of one order is made");
    assert.ok(papers.statement("annapurna", one.customer, "en").length === 2, "a customer's statement is made from the orders");
    assert.ok(papers.identity("annapurna", "en").full.length === 2);
    const cases = (await arjun.get("/shops/annapurna/papers")).plain;
    assert.ok(cases.includes(one.id), "the case list holds the shop's orders");

    // the unfinished-work list reads orders.json: an order waiting for its advance whose payment could not be read
    addOrdersShop(b, "stuck");
    const stuck = { id: "o-99", customer: "p-aaaaaaaaaaaa", language: "en", state: "awaiting_advance", lines: [{ itemId: "veg-thali", qty: 1 }], advanceInr: 60, totalInr: 120, handledPayments: [], pending: [], dateNeedsConfirmation: false, awaitingAddress: false };
    exportOrders(b, "stuck", [stuck], [{ seq: 1, time: new Date(NOW - 5 * 3_600_000).toISOString(), conversation: "c-aaaaaaaaaaaa", booking: "o-99", action: "record_payment", inputsDigest: "0", outcome: "failed", decisions: [], language: "en", notes: "", refs: {} }]);
    const inbox = inboxFor(shops, "stuck", NOW, optionsFor());
    assert.deepEqual(inbox.items.map((i) => [i.kind, i.caseId]), [["payment_unrecorded", "o-99"]]);
    assert.ok(WORDS.en.inbox.kinds.payment_unrecorded("o-99", "", 0, "").length > 0);

    // the monthly report is the Orders report, and the shop page is an Orders shop's page
    const made = await divya.post("/shops/annapurna/report", { month: "2026-11" }, "/shops/annapurna");
    assert.equal(made.status, 303, made.text.slice(0, 300));
    const report = JSON.parse(createDocuments(store).get("annapurna", "monthly/2026-11/report-2026-11.json")!);
    assert.equal(report.document.pathway.name, "orders");
    assert.equal(report.document.orders.taken, 7, "the busy month's seven orders, counted from the export");
    const page = (await divya.get("/shops/annapurna")).plain;
    assert.ok(page.includes(WORDS.en.ordersShop.summaryMenu) && page.includes("veg thali") && page.includes(WORDS.en.ordersShop.activity.taken), page.slice(0, 300));
    assert.ok(!page.includes('class="cost"') && !page.includes(WORDS.en.shop.summaryServices) && !page.includes(WORDS.en.shop.deposits));

    // changing it (a draft with the Orders form), and starting a new one
    const edit = await divya.post("/shops/annapurna/edit", {}, "/shops/annapurna");
    const editPage = (await divya.get(`/setup/${edit.location!.split("/")[2]}/1`)).plain;
    assert.ok(editPage.includes('name="menu"') && editPage.includes("veg thali, 120, 12") && !editPage.includes("svc_name_0"), "the edit form is the Orders one");
    const draft = (await divya.post("/setup", { template: "orders" }, "/setup")).location!.split("/")[2];
    assert.ok(!openStores(b.config).store.read<Record<string, unknown>>(`drafts/${draft}.json`)!.fees && Boolean(openStores(b.config).store.read<Record<string, unknown>>(`drafts/${draft}.json`)!.orders), "the new draft holds the Orders form");
  } finally { await b.close(); }
});
