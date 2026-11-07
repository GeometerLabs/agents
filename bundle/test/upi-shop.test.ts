// A shop that takes UPI, marked paid by the owner (plan B33): no Razorpay Guard is generated for it, the deploy asks for no Razorpay key and no Razorpay webhook
// secret, its inbox sends the owner's messages to the runtime only (no approvals relay: no refund is ever held for its owner), and the client folder it is given
// is one its template's runtime accepts with no payment service.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deploy } from "../deploy.ts";
import { planShop } from "../generate/shop.ts";
import { loadClient } from "../../templates/commerce/bookings/server/config.ts";
import { panelRuntime, serverConfig, tempServer } from "./helpers.ts";
import { secretsFor, world } from "./world.ts";

const UPI_SETTINGS = readFileSync(new URL("../../templates/commerce/bookings/settings/glow-salon-upi.example.json", import.meta.url), "utf8");
/** A UPI shop's runtime.json as the panel writes it: no payment service. */
const upiRuntime = () => { const r = panelRuntime() as Record<string, any>; delete r.services.payments; return r as ReturnType<typeof panelRuntime>; };

test("planning a UPI shop: no Razorpay Guard, no payment service in its runtime, and its money counted as live (the owner's real marks)", () => {
  const t = tempServer({ "glow-salon": upiRuntime() });
  try {
    writeFileSync(join(t.paths.shop("glow-salon"), "settings.json"), UPI_SETTINGS);
    const p = planShop(serverConfig(), t.shop("glow-salon"));
    assert.deepEqual(p.problems, []);
    assert.deepEqual(p.guards.map((g) => g.kind), ["whatsapp", "calendar"]);
    const services = (p.runtime as { services: Record<string, unknown> }).services;
    assert.equal("payments" in services, false);
    assert.equal((p.runtime as { report?: { source: string } }).report?.source, "live");
  } finally { t.done(); }
});

test("deploying a UPI shop asks for no Razorpay key or webhook secret, runs no relay for it, and gives it a client folder its runtime accepts", async () => {
  const w = world({ "glow-salon": upiRuntime() });
  try {
    writeFileSync(join(w.paths.shop("glow-salon"), "settings.json"), UPI_SETTINGS);
    const { razorpay_key: _key, razorpay_webhook_secret: _hook, ...handIn } = secretsFor("glow-salon");
    w.handIn("glow-salon", handIn);
    const [r] = await deploy(w.ctx);
    assert.equal(r.shop, "glow-salon");
    assert.ok(!existsSync(join(w.paths.generated, "guards", "g-glow-salon-razorpay")), "no Razorpay Guard is generated");
    assert.ok(!existsSync(join(w.paths.secrets, "g-glow-salon-razorpay", "razorpay_authorization")), "no Razorpay key is held");
    assert.ok(!existsSync(join(w.paths.secrets, "rt-glow-salon", "agent_razorpay")));
    assert.ok(existsSync(join(w.paths.secrets, "inbox", "glow-salon", "razorpay_webhook_secret")), "the inbox's Razorpay route gets a secret nobody holds, so nothing can be signed for it");
    const inbox = JSON.parse(readFileSync(join(w.paths.generated, "inbox", "inbox.json"), "utf8"));
    assert.equal(inbox.shops["glow-salon"].relayUrl, undefined, "the owner's messages go to the runtime only");
    const relay = JSON.parse(readFileSync(join(w.paths.generated, "relay", "relay.json"), "utf8"));
    assert.equal(relay.shops["glow-salon"], undefined, "no approvals relay: no refund is held for a UPI shop's owner");
    const compose = readFileSync(join(w.paths.generated, "compose.yaml"), "utf8");
    assert.ok(!compose.includes("g-glow-salon-razorpay"), "no Razorpay Guard container");
    const client = loadClient(join(w.paths.generated, "shops", "glow-salon", "client"));
    assert.equal(client.settings.payment?.module, "upi");
    assert.equal(client.runtime.services?.payments, undefined);
  } finally { w.done(); }
});

test("a Razorpay shop still needs its payment service in live mode, and says so plainly", () => {
  const t = tempServer({ "glow-salon": upiRuntime() });
  try {
    const folder = join(t.paths.shop("glow-salon"));
    const runtime = JSON.parse(readFileSync(join(folder, "runtime.json"), "utf8"));
    writeFileSync(join(folder, "runtime.json"), JSON.stringify({ ...runtime, mode: "live", host: "127.0.0.1", port: 8787, dataDir: "/tmp/x", tickSeconds: 30, services: { ...runtime.services, calendar: { baseUrl: "http://g:8080", calendarId: "c@x" }, messaging: { baseUrl: "http://g:8080", phoneNumberId: "123456789012345" } } }));
    assert.throws(() => loadClient(folder), /add "payments".*this shop takes Razorpay/su);
  } finally { t.done(); }
});
