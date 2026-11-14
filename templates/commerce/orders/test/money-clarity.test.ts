// Money clarity (batch 4, 14 Nov 2026) for an Orders shop, end to end through a real runtime and the real public front over HTTP, and the item-1 leftovers that were
// untested: the payment gateway on the order page, and a refund Guard holds on the owner's page.
//   * a gateway (Razorpay) shop's page has a payment link and NOTHING of the UPI parts: no "I have paid", no UPI reference, no deposit card for the owner (the gateway confirms
//     by itself; a press of "I have paid" made up by hand marks nothing and asks nobody);
//   * a UPI shop's owner list splits "customers say they have paid" from "waiting for payment", with the order's reference and the UPI reference (digits only);
//   * the UPI box's script runs by a nonce and a policy that allows only the page's own address;
//   * a refund Guard holds is listed on the owner's page from the approvals relay and answered there with exactly the digest shown: the page passes the owner's yes or no on
//     to the relay, never refunds by itself, and a stale digest is the relay's to refuse.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeClock } from "../../../../modules/core/clock.ts";
import { frontHandler } from "../../../../modules/channels/front.ts";
import type { FrontShop } from "../../../../modules/channels/front.ts";
import { runtimeBackend } from "../../../../modules/channels/backend.ts";
import { OWNER_LINK_FILE, newOwnerToken, ownerLinkFile } from "../../../../modules/channels/owner-link.ts";
import { ORDER_OPERATIONS } from "../../../../modules/channels/order-ops.ts";
import { ORDER_API_ROUTES } from "../../../../modules/channels/api.ts";
import { ORDER_TOOLS } from "../../../../modules/channels/mcp.ts";
import { openStore } from "../server/store.ts";
import { startClient } from "../server/start.ts";
import { parseStore } from "../server/snapshot.ts";
import { parseSettings } from "../src/settings.ts";

const INTERNAL = "internal-0123456789abcdef0123";
const CHANNEL = "channel-0123456789abcdef01234";
const SETTINGS = new URL("../settings/annapurna-tiffins.example.json", import.meta.url);
const GATEWAY_SETTINGS = new URL("../settings/annapurna-tiffins-razorpay.example.json", import.meta.url);
const OWNER = "+919800000001";
const TYPED = "+919811111111";
/** Tomorrow, from the fake clock's Monday 16 Nov 2026, 09:00 in Kochi. */
const TOMORROW = "2026-11-17";

/** A UPI tiffin shop (Annapurna, the example) whose chicken meal has only `chicken` a day, its runtime on a free port with a fake clock, and the front in front of it. */
async function world(o: { chicken?: number; assistant?: boolean; gateway?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), "geo-orders-channels-"));
  const folder = join(root, "annapurna");
  const base = JSON.parse(readFileSync(o.gateway ? GATEWAY_SETTINGS : SETTINGS, "utf8"));
  base.menu = base.menu.map((i: { id: string; dailyStock: number }) => (i.id === "chicken-meal" && o.chicken !== undefined ? { ...i, dailyStock: o.chicken } : i));
  if (o.assistant) base.assistant = {};
  mkdirSync(folder);
  writeFileSync(join(folder, "settings.json"), JSON.stringify(base));
  writeFileSync(join(folder, "runtime.json"), JSON.stringify({ mode: "fakes", port: 0, tickSeconds: 3600 }));
  writeFileSync(join(folder, "pathway.lock"), "orders@0.1.0\n");
  writeFileSync(join(root, "token"), INTERNAL);
  writeFileSync(join(root, "channel"), CHANNEL);
  const shops: Record<string, FrontShop> = {};
  const front = createServer(frontHandler({ shops, waitMs: 1_500 }));
  const port = await new Promise<number>((r) => front.listen(0, "127.0.0.1", () => r((front.address() as { port: number }).port)));
  const origin = `http://127.0.0.1:${port}`;
  const clock = fakeClock(Date.UTC(2026, 10, 16, 3, 30));
  const lines: string[] = [];
  const client = await startClient({ clientFolder: folder, tokenFile: join(root, "token"), channelTokenFile: join(root, "channel"), clock, log: (l) => lines.push(l) });
  shops.annapurna = { publicUrl: `${origin}/s/annapurna`, backend: runtimeBackend({ url: client.server.url, token: CHANNEL }), kind: "orders" };
  const page = (path: string, init: RequestInit = {}) => fetch(`${origin}/s/annapurna${path}`, { redirect: "manual", ...init });
  const form = (path: string, fields: Record<string, string>) => page(path, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin }, body: new URLSearchParams(fields).toString() });
  const api = (path: string, body?: unknown) => page(`/api/v1${path}`, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const mcp = async (method: string, params: unknown, id = 1) => (await page("/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) })).json() as Promise<{ result: { structuredContent: Record<string, unknown>; isError: boolean; tools?: { name: string }[] }; error?: unknown }>;
  const record = () => { const s = openStore(join(folder, "data")); try { return s.loadState().record; } finally { s.close(); } };
  const store = () => { const s = openStore(join(folder, "data")); try { return parseStore(s.loadState().snapshot!); } finally { s.close(); } };
  const ownerToken = newOwnerToken();
  writeFileSync(join(folder, OWNER_LINK_FILE), JSON.stringify(ownerLinkFile(ownerToken, new Date(clock.now()))));
  return {
    origin, page, form, api, mcp, record, store, lines, client, clock, folder, ownerToken, shops, settings: parseSettings(base),
    /** The owner's WhatsApp message, as the inbox would hand it to the runtime (the internal token), and the step run. */
    async ownerSays(text: string, id = `wamid.owner-${text.length}-${clock.now()}`) {
      const r = await fetch(`${client.server.url}/internal/events`, { method: "POST", headers: { authorization: `Bearer ${INTERNAL}` }, body: JSON.stringify({ events: [{ kind: "message", message: { id, from: OWNER, text, timestamp: clock.now() } }] }) });
      assert.equal(r.status, 200);
      await client.runtime.idle();
    },
    async done() { await new Promise<void>((r) => { front.closeAllConnections(); front.close(() => r()); }); await client.stop(); rmSync(root, { recursive: true, force: true }); },
  };
}


const handleOf = (location: string | null): string => /\/order\/([A-Za-z0-9_-]{32})/u.exec(location ?? "")?.[1] ?? "";
const nonceOf = (html: string): string => /name="nonce" value="([A-Za-z0-9_-]{32})"/u.exec(html)?.[1] ?? "";
type World = Awaited<ReturnType<typeof world>>;

/** A customer orders two veg thali for tomorrow's lunch on the page; returns the order's handle. */
async function order(w: World): Promise<string> {
  const menu = await (await w.page(`/?lang=en&date=${TOMORROW}`)).text();
  const posted = await w.form("/order", { date: TOMORROW, slot: "lunch", "qty_veg-thali": "2", name: "Asha", phone: "98111 11111", lang: "en", nonce: nonceOf(menu) });
  const handle = handleOf(posted.headers.get("location"));
  assert.ok(handle);
  await w.client.runtime.idle();
  return handle;
}
const ownerHtml = async (w: World) => (await w.page(`/o/${w.ownerToken}?lang=en`)).text();

test("gateway shop: the order page has the payment link and none of the UPI parts, and a made-up \"I have paid\" marks nothing and asks nobody", async () => {
  const w = await world({ gateway: true });
  try {
    const handle = await order(w);
    const html = await (await w.page(`/order/${handle}?lang=en`)).text();
    assert.match(html, /held until/u);
    assert.match(html, /<a class="btn full" href="https?:[^"]+" rel="noreferrer">Pay ₹120<\/a>/u, "the gateway's own link, for the advance");
    for (const gone of [/data-upi/u, /upi:\/\/pay/u, /name="upi_ref"/u, /I have paid/u, /Copy UPI ID/u, /<script/u]) assert.doesNotMatch(html, gone, `a gateway page has no ${gone}`);
    const csp = (await w.page(`/order/${handle}?lang=en`)).headers.get("content-security-policy") ?? "";
    assert.ok(!csp.includes("script-src"), "no script, so the plain policy and the page's own meta refresh");
    // owner: nothing to mark (the gateway confirms by itself)
    const owner = await ownerHtml(w);
    assert.doesNotMatch(owner, /should pay/u);
    assert.doesNotMatch(owner, /Waiting for payment/u);
    // a press of "I have paid" made up by hand: the view does not offer it, so the page sends nothing and the record has no claim
    await w.form(`/order/${handle}/paid`, { lang: "en", upi_ref: "412345678901" });
    await w.client.runtime.idle();
    assert.ok(!w.record().some((e) => e.action === "upi_paid_claim" || e.action === "owner_marked_paid"), "nothing claimed, nothing marked");
    assert.ok(!w.lines.some((l) => l.startsWith(`[stand-in WhatsApp] to ${OWNER}`) && /paid/u.test(l)), "the owner was not asked");
  } finally { await w.done(); }
});

test("UPI shop: waiting for payment apart from customers who say they paid, with the order's reference and the UPI reference; the page's script is by a nonce", async () => {
  const w = await world();
  try {
    const handle = await order(w);
    const res = await w.page(`/order/${handle}?lang=en`);
    const html = await res.text();
    const nonce = /<script nonce="([^"]+)">/u.exec(html)?.[1];
    const csp = res.headers.get("content-security-policy") ?? "";
    assert.ok(nonce && csp.includes(`script-src 'nonce-${nonce}'`) && !/connect-src[^;]*'self'/u.test(csp), "a nonce script, and no 'self' to connect to");
    assert.match(html, /data-copy="annapurna@okicici"[^>]* hidden>Copy UPI ID</u);
    assert.match(html, /<noscript><meta http-equiv="refresh" content="15"><\/noscript>/u);
    assert.match(html, /<summary>Payment did not go through\?<\/summary>/u);
    let owner = await ownerHtml(w);
    assert.match(owner, /<h2>Waiting for payment<\/h2>/u);
    assert.match(owner, /Reference o-1 \(it is in the UPI note\)/u);
    const before = /name="case" value="o-1"><input type="hidden" name="digest" value="([0-9a-f]{32})"/u.exec(owner)?.[1];
    await w.form(`/order/${handle}/paid`, { lang: "en", upi_ref: "512345678901" });
    await w.client.runtime.idle();
    owner = await ownerHtml(w);
    assert.match(owner, /<h2>Customers say they have paid<\/h2>/u);
    assert.match(owner, /UPI reference 512345678901\./u);
    assert.equal(/name="case" value="o-1"><input type="hidden" name="digest" value="([0-9a-f]{32})"/u.exec(owner)?.[1], before, "the claim is not in the digest");
    const customer = await (await w.page(`/order/${handle}?lang=en`)).text();
    assert.match(customer, /You said you have paid\. The shop will look in its UPI app\./u);
    assert.match(customer, /usually takes about 30 minutes/u);
  } finally { await w.done(); }
});

/** A refund Guard holds, as the relay shows it to the owner's page. The stand-in relay judges a press by the digest exactly as the real one does: a press with another digest changes nothing. */
function standInRelay(w: World) {
  const ask = { approval: "ap-7", digest: "a".repeat(32), amountPaise: 90_000, customerPhone: "+919811111111", booking: "o-4", slotMs: undefined, untilMs: Date.UTC(2026, 10, 17, 6, 0), serviceName: "veg thali" };
  const decided: { approval: string; digest: string; decision: string }[] = [];
  w.shops.annapurna.relay = {
    asks: async () => (decided.length === 0 ? [ask] : []),
    decide: async (_owner, approval, digest, decision) => { if (digest !== ask.digest || approval !== ask.approval) return "changed"; decided.push({ approval, digest, decision }); return "recorded"; },
  };
  return { ask, decided };
}

test("a refund Guard holds is on the Orders owner's page, answered with exactly the digest shown; the page never refunds by itself, and a stale answer changes nothing", async () => {
  const w = await world();
  try {
    const relay = standInRelay(w);
    const owner = await ownerHtml(w);
    assert.match(owner, /Refund to approve|refund/iu);
    assert.match(owner, /₹900/u, "the amount Guard holds");
    const forms = [...owner.matchAll(/name="source" value="relay"><input type="hidden" name="action" value="(approve|deny)"><input type="hidden" name="case" value="ap-7"><input type="hidden" name="digest" value="([0-9a-f]{32})"/gu)];
    assert.deepEqual(forms.map((m) => [m[1], m[2]]), [["approve", relay.ask.digest], ["deny", relay.ask.digest]], "both answers, each carrying the digest of what the page showed");
    const stale = await w.form(`/o/${w.ownerToken}/answer`, { source: "relay", action: "approve", case: "ap-7", digest: "b".repeat(32) });
    assert.match(stale.headers.get("location") ?? "", /n=changed/u, "what was shown is not what Guard holds now: nothing is approved");
    assert.deepEqual(relay.decided, []);
    const entriesBefore = w.record().length;
    const yes = await w.form(`/o/${w.ownerToken}/answer`, { source: "relay", action: "approve", case: "ap-7", digest: relay.ask.digest });
    assert.match(yes.headers.get("location") ?? "", /n=done/u);
    assert.deepEqual(relay.decided, [{ approval: "ap-7", digest: relay.ask.digest, decision: "approve" }], "passed to the relay once, as the owner pressed it");
    assert.ok(!w.record().slice(entriesBefore).some((e) => /refund/u.test(e.action)), "the runtime did not refund anything: the relay and Guard carry it out");
    assert.doesNotMatch(await ownerHtml(w), /name="case" value="ap-7"/u, "answered: it is gone from the page");
    // a shop with no relay (no Guard holds refunds) refuses a relay answer at the front
    delete w.shops.annapurna.relay;
    const none = await w.form(`/o/${w.ownerToken}/answer`, { source: "relay", action: "approve", case: "ap-7", digest: relay.ask.digest });
    assert.match(none.headers.get("location") ?? "", /n=changed/u);
  } finally { await w.done(); }
});
