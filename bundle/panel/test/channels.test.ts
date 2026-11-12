// Item 11d in the panel: a Bookings shop's page shows its booking page link, the QR code for the counter, the MCP endpoint, and the owner's approvals link, which the
// partner makes (shown once, only its hash kept) and switches off. Another partner's shop is a 404, as everywhere in the panel.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ownerTokenMatches, readOwnerLink } from "../../../modules/channels/owner-link.ts";
import { boot } from "./helpers.ts";

test("the shop page shows the booking page, its QR, the MCP endpoint; the owner's link is made once, kept only as a hash, and switched off", async () => {
  const b = await boot({ publicUrl: "http://shops.example.test" });
  try {
    const arjun = await b.account("arjun", "builder");
    b.addShop("glow-salon", { name: "Glow Salon" });
    const page = await arjun.get("/shops/glow-salon");
    assert.ok(page.text.includes("http://shops.example.test/s/glow-salon/"), "the booking page's address");
    assert.ok(page.text.includes("http://shops.example.test/s/glow-salon/mcp"), "the MCP endpoint");
    assert.match(page.text, /<svg[^>]*aria-label="http:\/\/shops\.example\.test\/s\/glow-salon\/"/u, "the QR code of the booking page");
    assert.match(page.plain, /The owner's approvals link<\/b>: Off\./u);

    const made = await arjun.post("/shops/glow-salon/owner-link", {}, "/shops/glow-salon");
    assert.equal(made.status, 200);
    const link = /http:\/\/shops\.example\.test\/s\/glow-salon\/o\/([A-Za-z0-9_-]{43})/u.exec(made.text);
    assert.ok(link, "the link is shown once");
    const file = join(b.dir, "shops", "glow-salon", "owner-link.json");
    const stored = readFileSync(file, "utf8");
    assert.ok(!stored.includes(link[1]), "only its hash is kept");
    assert.ok(ownerTokenMatches(link[1], readOwnerLink(stored)));
    assert.ok(!b.logs.some((l) => l.includes(link[1])), "the link is never logged");
    assert.match((await arjun.get("/shops/glow-salon")).plain, /The owner's approvals link<\/b>: On, made /u);

    const again = await arjun.post("/shops/glow-salon/owner-link", {}, "/shops/glow-salon");
    const second = /\/o\/([A-Za-z0-9_-]{43})/u.exec(again.text)![1];
    assert.ok(!ownerTokenMatches(link[1], readOwnerLink(readFileSync(file, "utf8"))), "a new link replaces the old one");
    assert.ok(ownerTokenMatches(second, readOwnerLink(readFileSync(file, "utf8"))));

    const off = await arjun.post("/shops/glow-salon/owner-link/revoke", {}, "/shops/glow-salon");
    assert.equal(off.status, 303);
    assert.equal(existsSync(file), false, "switched off: the file is gone, and the deployer takes the copies away at its next pass");

    const other = await b.account("meera", "partner");
    assert.equal((await other.post("/shops/glow-salon/owner-link", {}, "/shops")).status, 404, "not her shop");
  } finally { await b.close(); }
});

// Item 11h: an Orders shop and a Fees centre have the same block, in their own words: Orders with its MCP endpoint, Fees without (a parent's fees are reached only by
// their private link), and both with the owner's link the partner makes.
test("an Orders shop's and a Fees centre's page block, and the owner's link for both", async () => {
  const b = await boot({ publicUrl: "http://shops.example.test" });
  try {
    const arjun = await b.account("arjun", "builder");
    const repo = join(import.meta.dirname, "..", "..", "..");
    for (const [id, pathway, settings] of [["annapurna", "orders", "templates/commerce/orders/settings/annapurna-tiffins.example.json"], ["bright", "fees", "templates/education/fees/settings/bright-tuition-upi.example.json"]] as const) {
      b.addShop(id);
      writeFileSync(join(b.dir, "shops", id, "settings.json"), readFileSync(join(repo, settings), "utf8"));
      writeFileSync(join(b.dir, "shops", id, "pathway.lock"), `${pathway}@0.1.0\n`);
      writeFileSync(join(b.dir, "shops", id, "runtime.json"), JSON.stringify({ mode: "live", tickSeconds: 30, services: { payments: {}, messaging: { phoneNumberId: "123456789012345" }, timeoutMs: 20000 } }));
    }
    const orders = await arjun.get("/shops/annapurna");
    assert.ok(orders.text.includes("http://shops.example.test/s/annapurna/"), "the shop page's address");
    assert.ok(orders.text.includes("http://shops.example.test/s/annapurna/mcp"), "its MCP endpoint");
    assert.match(orders.plain, /Shop page \(orders\)/u);
    const fees = await arjun.get("/shops/bright");
    assert.ok(fees.text.includes("http://shops.example.test/s/bright/"), "the centre's page");
    assert.ok(!fees.text.includes("http://shops.example.test/s/bright/mcp"), "no MCP for fees");
    assert.match(fees.plain, /never opens anyone's fees/u);
    for (const id of ["annapurna", "bright"]) {
      const made = await arjun.post(`/shops/${id}/owner-link`, {}, `/shops/${id}`);
      assert.equal(made.status, 200, id);
      assert.match(made.text, new RegExp(`/s/${id}/o/[A-Za-z0-9_-]{43}`, "u"), `${id}: the owner's link, shown once`);
    }
  } finally { await b.close(); }
});
