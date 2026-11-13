// Item 11h in the panel (decisions 45 and 46): the owner's sign-in without WhatsApp. The partner shows a setup QR code (one use, that shop only, 15 minutes) and prints a
// recovery card (five one-use codes); both are shown once and only their hashes are written, for the deployer to hand to the shop's runtime. "Remove the owner's
// passkeys" is there for a lost phone. A shop with no WhatsApp number is not ready to go live until the owner's QR has been shown.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { grantInFile, readOwnerGrants } from "../../../modules/channels/owner-grants.ts";
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { createGoLive } from "../golive.ts";
import { createShops } from "../shops.ts";
import { createStore } from "../store.ts";
import { createVault } from "../vault.ts";
import { boot } from "./helpers.ts";

test("the setup QR and the recovery card are shown once, kept as hashes, for this shop only; a new one replaces the old; removing the passkeys clears both", async () => {
  const b = await boot({ publicUrl: "https://shops.example.test" });
  try {
    const arjun = await b.account("arjun", "builder");
    b.addShop("glow-salon", { name: "Glow Salon" });
    const now0 = () => (b.config.now ?? Date.now)(); // the panel's own clock: the QR runs out 15 minutes after it was made, by that clock
    const page = await arjun.get("/shops/glow-salon");
    assert.match(page.plain, /The owner's sign-in/u);
    assert.match(page.plain, /Show the setup QR code/u);

    const qr = await arjun.post("/shops/glow-salon/owner-setup", {}, "/shops/glow-salon");
    assert.equal(qr.status, 200);
    const token = /https:\/\/shops\.example\.test\/s\/glow-salon\/owner\/setup\/([A-Za-z0-9_-]{43})/u.exec(qr.text)?.[1];
    assert.ok(token, "the QR's address is the owner view's own, shown once");
    assert.match(qr.text, /<svg/u, "as a QR code");
    assert.match(qr.plain, /Works once, for this shop only/u);
    const file = join(b.dir, "shops", "glow-salon", "owner-grants.json");
    const stored = readFileSync(file, "utf8");
    assert.ok(!stored.includes(token), "only its hash is kept");
    assert.ok(!b.logs.some((l) => l.includes(token)), "never logged");
    assert.equal(grantInFile({ kind: "setup", token }, readOwnerGrants(stored), now0()), "valid");

    const card = await arjun.post("/shops/glow-salon/owner-recovery", {}, "/shops/glow-salon");
    const codes = [...card.text.matchAll(/<li>([23456789A-HJ-NP-Z]{5}-[23456789A-HJ-NP-Z]{5})<\/li>/gu)].map((m) => m[1]);
    assert.equal(codes.length, 5, "five codes to print");
    assert.match(card.plain, /Lost your phone\? Open https:\/\/shops\.example\.test\/s\/glow-salon\/owner\/recover/u);
    const withCard = readOwnerGrants(readFileSync(file, "utf8"));
    assert.ok(codes.every((c) => grantInFile({ kind: "recovery", code: c }, withCard, now0()) === "valid"));
    assert.ok(!readFileSync(file, "utf8").includes(codes[0].replace("-", "")), "codes as hashes only");
    assert.equal(grantInFile({ kind: "setup", token }, withCard, now0()), "valid", "the card leaves the QR as it was");

    const again = await arjun.post("/shops/glow-salon/owner-setup", {}, "/shops/glow-salon");
    const second = /\/owner\/setup\/([A-Za-z0-9_-]{43})/u.exec(again.text)![1];
    const now = readOwnerGrants(readFileSync(file, "utf8"));
    assert.equal(grantInFile({ kind: "setup", token }, now, now0()), "unknown", "a new QR stops the old one");
    assert.equal(grantInFile({ kind: "setup", token: second }, now, now0()), "valid");

    const removed = await arjun.post("/shops/glow-salon/owner-passkeys/remove", {}, "/shops/glow-salon");
    assert.equal(removed.status, 303);
    const after = readOwnerGrants(readFileSync(file, "utf8"))!;
    assert.ok(after.passkeysBefore, "every passkey made before now stops working");
    assert.equal(grantInFile({ kind: "setup", token: second }, after, now0()), "unknown");
    assert.equal(grantInFile({ kind: "recovery", code: codes[0] }, after, now0()), "unknown");

    const other = await b.account("divya", "partner");
    assert.equal((await other.post("/shops/glow-salon/owner-setup", {}, "/shops")).status, 404, "another partner's shop is a 404");
  } finally { await b.close(); }
});

test("a shop with no WhatsApp: no WhatsApp check, and not ready to go live until the owner's setup QR has been shown", async () => {
  const b = await boot({ publicUrl: "https://shops.example.test" });
  try {
    await b.account("arjun", "builder");
    b.addShop("glow-salon", { name: "Glow Salon" });
    const runtimeFile = join(b.dir, "shops", "glow-salon", "runtime.json");
    const runtime = JSON.parse(readFileSync(runtimeFile, "utf8"));
    delete runtime.services.messaging;
    writeFileSync(runtimeFile, JSON.stringify(runtime));
    const store = createStore(mkdtempSync(join(tmpdir(), "geo-golive-")), createVault(randomBytes(32)));
    const shops = createShops(b.config, store);
    const goLive = createGoLive(b.config, shops, store);
    const settings = shops.settings("glow-salon");
    assert.ok(goLive.unmet("glow-salon", settings).includes("owner-signin"), "no WhatsApp and no QR shown yet: the owner could not be reached");
    const arjun = await b.account("arjun2", "builder");
    b.addShop("other", { name: "Other" });
    writeFileSync(join(b.dir, "shops", "glow-salon", "owner-grants.json"), JSON.stringify({ schema: 1, setup: { sha256: "a".repeat(64), createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString() } }));
    assert.ok(!goLive.unmet("glow-salon", settings).includes("owner-signin"), "once the QR was shown, that condition is met");
    assert.ok(!goLive.unmet("other", shops.settings("other")).includes("owner-signin"), "a shop with WhatsApp is not asked for it");
    void arjun;
  } finally { await b.close(); }
});
