// Item 11h in the panel (decisions 45 and 46): the owner's sign-in without WhatsApp. The Operator shows a setup QR code (one use, that shop only, 15 minutes) and prints a
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
import { createServer } from "node:http";
import { mkdirSync } from "node:fs";
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
    assert.equal((await other.post("/shops/glow-salon/owner-setup", {}, "/shops")).status, 404, "another Operator's shop is a 404");
  } finally { await b.close(); }
});

test("a shop with no WhatsApp: no WhatsApp check, and not ready to go live until the owner has signed in and one phone has alerts on", async () => {
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
    assert.ok(goLive.unmet("glow-salon", settings).includes("owner-signin"), "showing the QR is not enough any more: the runtime must count a passkey and a phone with alerts");
    // batch 3: what the runtime counted when the checks ran (go/internal/runtime /status ownerAccess), kept with the stored checks
    const stored = (ownerAccess?: { passkeys: number; alertPhones: number }) => store.write("checks/glow-salon.json", { at: new Date().toISOString(), settingsDigest: "x", hand: { total: 1, held: 1, failed: 0, notTested: 0 }, connections: null, ...(ownerAccess ? { ownerAccess } : {}) });
    stored({ passkeys: 1, alertPhones: 0 });
    assert.ok(goLive.unmet("glow-salon", settings).includes("owner-signin"), "a passkey but no phone with alerts: still held back");
    stored({ passkeys: 0, alertPhones: 1 });
    assert.ok(goLive.unmet("glow-salon", settings).includes("owner-signin"), "alerts but no passkey: still held back");
    stored({ passkeys: 1, alertPhones: 1 });
    assert.ok(!goLive.unmet("glow-salon", settings).includes("owner-signin"), "one passkey and one phone with alerts: that condition is met");
    assert.ok(!goLive.unmet("other", shops.settings("other")).includes("owner-signin"), "a shop with WhatsApp is not asked for it");
    void arjun;
  } finally { await b.close(); }
});

test("the accounts step's \"Start without WhatsApp for now\": nothing about WhatsApp is asked, and the shop's runtime.json names no messaging (Bookings)", async () => {
  const { setUp, STEP1, STEP2, STEP3 } = await import("./flow.ts");
  const b = await boot({ publicUrl: "https://shops.example.test" });
  try {
    const divya = await b.account("divya", "partner");
    const f = await setUp(b, divya, [STEP1, STEP2, STEP3, { waNone: "1", payMod: "upi", upiId: "hosahalli@okicici", upiPayee: "Hosahalli Beauty" }]);
    const saved = await divya.post(`/setup/${f.draft}/save`, {}, `/setup/${f.draft}/6`);
    assert.equal(saved.location, `/setup/${f.draft}/6`, saved.plain.slice(0, 300));
    const runtime = JSON.parse(readFileSync(join(b.dir, "shops", f.shop, "runtime.json"), "utf8"));
    assert.equal(runtime.services.messaging, undefined, "no WhatsApp: no messaging service");
    assert.ok(!f.replies.some((r) => /secret-missing|WhatsApp token/u.test(r)), "no WhatsApp key was asked for");
    const checks = await divya.get(`/setup/${f.draft}/6`);
    assert.match(checks.plain, /No WhatsApp: the owner signs in with their fingerprint/u, "the checks step says what the owner needs instead");
  } finally { await b.close(); }
});

// Owner's item 2 ("no Operator holds a shop hostage"): once the shop's runtime says the owner holds a passkey, the panel refuses the setup QR and the card with a plain line,
// and "remove the owner's passkeys" becomes a REQUEST (a pendingRemoval in the file, never a passkeysBefore) that the owner sees and the runtime times. The panel only asks the
// runtime (a stand-in answering /status here); the runtime's own refusal, whatever the panel does, is tested in modules/channels/test/owner-control.test.ts.
test("the owner holds a passkey: the panel refuses the setup QR and the card, and turns 'remove the passkeys' into a request that waits", async () => {
  const access: { locked: boolean; removal?: { askedBy: string; effectiveAt: string } } = { locked: false };
  const runtime = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/readyz") return void res.end(JSON.stringify({ ok: true }));
    if (req.url === "/status" && req.headers.authorization === "Bearer runtime-token") return void res.end(JSON.stringify({ ownerAccess: { passkeys: access.locked ? 1 : 0, alertPhones: 0, ...access } }));
    res.statusCode = 401; res.end("{}");
  });
  await new Promise<void>((r) => runtime.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(runtime.address() as { port: number }).port}`;
  const tokenDir = mkdtempSync(join(tmpdir(), "geo-token-"));
  mkdirSync(tokenDir, { recursive: true });
  writeFileSync(join(tokenDir, "glow-salon"), "runtime-token\n", { mode: 0o600 });
  const b = await boot({ publicUrl: "https://shops.example.test", runtimeUrl: url, runtimeTokenFile: join(tokenDir, "{shop}") });
  try {
    const arjun = await b.account("arjun", "builder");
    b.addShop("glow-salon", { name: "Glow Salon" });
    const file = join(b.dir, "shops", "glow-salon", "owner-grants.json");
    // not locked: everything as it was
    assert.match((await arjun.get("/shops/glow-salon")).plain, /Show the setup QR code/u);
    assert.equal((await arjun.post("/shops/glow-salon/owner-setup", {}, "/shops/glow-salon")).status, 200);

    // locked: no QR, no card, a plain line, and nothing written
    access.locked = true;
    const before = readFileSync(file, "utf8");
    const page = (await arjun.get("/shops/glow-salon")).plain;
    assert.match(page, /The owner now holds their own sign-in\. A new phone is added from the owner's app, or with the owner's recovery codes\./u);
    assert.doesNotMatch(page, /Show the setup QR code|Print a recovery card/u);
    assert.match(page, /Ask to remove the owner's passkeys/u);
    for (const route of ["owner-setup", "owner-recovery"]) {
      const r = await arjun.post(`/shops/glow-salon/${route}`, {}, "/shops/glow-salon");
      assert.deepEqual([r.status, r.location], [303, "/shops/glow-salon?pages=locked"], route);
    }
    assert.equal(readFileSync(file, "utf8"), before, "nothing was written");
    assert.match((await arjun.get("/shops/glow-salon?pages=locked")).plain, /The owner now holds their own sign-in/u);

    // "remove the passkeys" is a request: who asked, when, when it would take effect; no passkeysBefore
    const asked = await arjun.post("/shops/glow-salon/owner-passkeys/remove", {}, "/shops/glow-salon");
    assert.deepEqual([asked.status, asked.location], [303, "/shops/glow-salon?pages=requested"]);
    const written = readOwnerGrants(readFileSync(file, "utf8"))!;
    assert.equal(written.passkeysBefore, undefined, "the panel never removes a passkey by itself now");
    assert.equal(written.pendingRemoval?.askedBy, "ARJUN");
    assert.equal(Date.parse(written.pendingRemoval!.effectiveAt) - Date.parse(written.pendingRemoval!.askedAt), 48 * 60 * 60_000);
    assert.match((await arjun.get("/shops/glow-salon?pages=requested")).plain, /Asked\. The owner sees it in their app now/u);

    // the runtime has seen it: the page shows who asked and when, offers no second request, and a press changes nothing
    access.removal = { askedBy: "ARJUN", effectiveAt: "2026-11-21T10:00:00.000Z" };
    const waiting = (await arjun.get("/shops/glow-salon")).plain;
    assert.match(waiting, /ARJUN asked to remove the owner's passkeys\. It happens on 2026-11-21 10:00 UTC unless the owner cancels\./u);
    assert.doesNotMatch(waiting, /Ask to remove the owner's passkeys/u);
    const same = readFileSync(file, "utf8");
    await arjun.post("/shops/glow-salon/owner-passkeys/remove", {}, "/shops/glow-salon");
    assert.equal(readFileSync(file, "utf8"), same, "a second press does not restart the wait");
  } finally { await b.close(); await new Promise<void>((r) => { runtime.closeAllConnections(); runtime.close(() => r()); }); }
});

test("Geometer's reset shows the Operator one line in the panel: the day and the reason", async () => {
  const b = await boot({ publicUrl: "https://shops.example.test" });
  try {
    const arjun = await b.account("arjun", "builder");
    b.addShop("glow-salon", { name: "Glow Salon" });
    assert.doesNotMatch((await arjun.get("/shops/glow-salon")).plain, /Geometer reset the owner's sign-in/u);
    mkdirSync(join(b.dir, "status", "owner-reset"), { recursive: true });
    writeFileSync(join(b.dir, "status", "owner-reset", "glow-salon.json"), JSON.stringify({ schema: 1, at: "2026-11-19T09:30:00.000Z", reason: "the owner lost every phone", by: "Naval" }));
    assert.match((await arjun.get("/shops/glow-salon")).plain, /Geometer reset the owner's sign-in on 2026-11-19: the owner lost every phone/u);
  } finally { await b.close(); }
});
