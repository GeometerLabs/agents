// Item 11d in the panel: a Bookings shop's page shows its booking page link, the QR code for the counter, the MCP endpoint, and the owner's approvals link, which the
// partner makes (shown once, only its hash kept) and switches off. Another partner's shop is a 404, as everywhere in the panel.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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
