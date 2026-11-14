// Money clarity (batch 4, 14 Nov 2026) for a Bookings shop, end to end through a real runtime (stand-in services, a UPI shop on its own booking list) and the real
// public front over HTTP. What it shows, each with the old behaviour beside the new:
//   * the owner's deposit list: a hold nobody has said they paid is "waiting for payment" (it used to look the same as a claimed one), a claimed one is listed first
//     with the booking reference and the UPI reference the customer typed (digits only; anything else is dropped and the claim still counts), and the customer's claim is
//     never part of the digest (so it cannot make the owner's own press stale);
//   * a payment after the hold ended: the hold that ended is listed ("time ran out: did money come?") for 48 hours, "received" is the same late mark as on WhatsApp (owed
//     back, with "keep" offered, never booked again by itself), and nothing else about the ledger changes;
//   * the customer's page: "I have paid" says how long a check takes and takes the UPI reference, the UPI box has the "payment did not go through?" fold, and on an expired
//     booking "paid after the time ended?" is acknowledged without claiming the shop has the money;
//   * the UPI page's one script (copy the UPI ID, open in Chrome on Android, look for a change without redrawing the QR) runs by a nonce and a content policy that allows
//     only the page's own address, and the page's meta refresh stays for a phone without the script (in <noscript>).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeClock } from "../../../../modules/core/clock.ts";
import { frontHandler } from "../../../../modules/channels/front.ts";
import type { FrontShop } from "../../../../modules/channels/front.ts";
import { runtimeBackend } from "../../../../modules/channels/backend.ts";
import { OWNER_LINK_FILE, newOwnerToken, ownerLinkFile } from "../../../../modules/channels/owner-link.ts";
import { openStore } from "../server/store.ts";
import { startClient } from "../server/start.ts";

const INTERNAL = "internal-0123456789abcdef0123";
const CHANNEL = "channel-0123456789abcdef01234";
const UPI_SETTINGS = new URL("../settings/glow-salon-upi.example.json", import.meta.url);
const TYPED = "+919811111111";
/** Where the runtime's sign-in links point (its pages.json), for the owner-app test. */
const RUNTIME_OWNER_BASE = "https://pages.example/glow-salon/owner";
const OWNER = "+919000000000";

/**
 * A UPI shop on its own booking list, its runtime on a free port with a fake clock (Monday 16 Nov 2026, 09:00 in Kochi), and the front in front of it. `extra` adds
 * settings (the shop's assistant, for the closed-day and app tests). `pages`: the shop has a pages file (item 11f), so the owner can sign in at <base>/owner.
 */
async function world(extra: Record<string, unknown> = {}, o: { pages?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), "geo-channels-"));
  const folder = join(root, "glow");
  const settings = { ...JSON.parse(readFileSync(UPI_SETTINGS, "utf8")), calendar: { module: "own" }, ...extra };
  const { mkdirSync } = await import("node:fs");
  mkdirSync(folder);
  writeFileSync(join(folder, "settings.json"), JSON.stringify(settings));
  writeFileSync(join(folder, "runtime.json"), JSON.stringify({ mode: "fakes", port: 0, tickSeconds: 3600 }));
  writeFileSync(join(folder, "pathway.lock"), "bookings@0.1.0\n");
  writeFileSync(join(root, "token"), INTERNAL);
  writeFileSync(join(root, "channel"), CHANNEL);
  // the front first, so its address is known for the pages file the runtime reads at start
  const shops: Record<string, FrontShop> = {};
  const front = createServer(frontHandler({ shops, waitMs: 1_500 }));
  const port = await new Promise<number>((r) => front.listen(0, "127.0.0.1", () => r((front.address() as { port: number }).port)));
  const origin = `http://127.0.0.1:${port}`;
  // the front's pages file names this test's own address; the runtime's (pages.json, https only) names where its sign-in links point, which a session is bound to
  const pagesFile = { schema: 1, base: `${origin}/s/glow`, ownerBase: `${origin}/s/glow/owner`, slug: "glow-salon", url: "https://pages.example/glow-salon" };
  if (o.pages) writeFileSync(join(folder, "pages.json"), JSON.stringify({ schema: 1, base: "https://partners.example/s/glow", ownerBase: RUNTIME_OWNER_BASE, slug: "glow-salon", url: "https://pages.example/glow-salon" }));
  const clock = fakeClock(Date.UTC(2026, 10, 16, 3, 30));
  const lines: string[] = [];
  const client = await startClient({ clientFolder: folder, tokenFile: join(root, "token"), channelTokenFile: join(root, "channel"), clock, log: (l) => lines.push(l) });
  shops.glow = { publicUrl: `${origin}/s/glow`, backend: runtimeBackend({ url: client.server.url, token: CHANNEL }), ...(o.pages ? { pages: () => pagesFile as never } : {}) };
  const page = (path: string, init: RequestInit = {}) => fetch(`${origin}/s/glow${path}`, { redirect: "manual", ...init });
  const form = (path: string, fields: Record<string, string>) => page(path, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin }, body: new URLSearchParams(fields).toString() });
  const api = (path: string, body?: unknown) => page(`/api/v1${path}`, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const record = () => { const s = openStore(join(folder, "data")); try { return s.loadState().record; } finally { s.close(); } };
  const ownerToken = newOwnerToken();
  const linkOwner = () => writeFileSync(join(folder, OWNER_LINK_FILE), JSON.stringify(ownerLinkFile(ownerToken, new Date(clock.now()))));
  return {
    origin, page, form, api, record, lines, client, clock, folder, ownerToken, linkOwner, ownerBase: pagesFile.ownerBase,
    /** The owner's WhatsApp message, as the inbox would hand it to the runtime (the internal token), and the step run. */
    async ownerSays(text: string, id = `wamid.owner-${text.length}-${clock.now()}`) {
      const r = await fetch(`${client.server.url}/internal/events`, { method: "POST", headers: { authorization: `Bearer ${INTERNAL}` }, body: JSON.stringify({ events: [{ kind: "message", message: { id, from: OWNER, text, timestamp: clock.now() } }] }) });
      assert.equal(r.status, 200);
      await client.runtime.idle();
    },
    async done() { await new Promise<void>((r) => { front.closeAllConnections(); front.close(() => r()); }); await client.stop(); rmSync(root, { recursive: true, force: true }); },
  };
}


const startsOn = (html: string): number[] => [...html.matchAll(/name="start" value="(\d+)"/gu)].map((m) => Number(m[1]));
const handleOf = (location: string | null): string => /\/b\/([A-Za-z0-9_-]{32})/u.exec(location ?? "")?.[1] ?? "";
type World = Awaited<ReturnType<typeof world>>;

/** A customer books the first free haircut on the page; returns the booking's handle (its page is held, with the UPI box). */
async function book(w: World, phone = "98111 11111"): Promise<string> {
  const slots = await (await w.page("/?lang=en&service=haircut")).text();
  const nonce = /name="nonce" value="([A-Za-z0-9_-]{32})"/u.exec(slots)?.[1] ?? "";
  const posted = await w.form("/book", { service: "haircut", start: String(startsOn(slots)[0]), name: "Asha", phone, lang: "en", nonce });
  const handle = handleOf(posted.headers.get("location"));
  assert.ok(handle);
  await w.client.runtime.idle();
  return handle;
}
const ownerHtml = async (w: World) => (await w.page(`/o/${w.ownerToken}?lang=en`)).text();

test("the UPI page: copy and Chrome buttons, the fold, a quiet check for change by nonce, no QR repaint; the meta refresh stays only without the script", async () => {
  const w = await world();
  try {
    const handle = await book(w);
    const res = await w.page(`/b/${handle}?lang=en`);
    const html = await res.text();
    const csp = res.headers.get("content-security-policy") ?? "";
    const nonce = /<script nonce="([^"]+)">/u.exec(html)?.[1];
    assert.ok(nonce, "the held UPI page has its one script, by a nonce");
    assert.ok(csp.includes(`script-src 'nonce-${nonce}'`) && /connect-src http:\/\/[^;]*\/b\/[A-Za-z0-9_-]{32}(;| |$)/u.test(csp) && !/connect-src[^;]*'self'/u.test(csp), "the policy allows that script, and the page's own address to connect to, never 'self' (the pages origin is shared by every shop)");
    assert.match(html, /data-copy="glowsalon@okicici"[^>]* hidden>Copy UPI ID</u, "copy UPI ID, hidden until the script runs");
    assert.match(html, /data-chrome href="intent:\/\/[^"]*#Intent;scheme=http;package=com\.android\.chrome;end"[^>]* hidden>Open in Chrome</u);
    assert.match(html, /<noscript><meta http-equiv="refresh" content="15"><\/noscript>/u, "without the script the page still looks again, as before");
    assert.ok(!/<meta http-equiv="refresh"/u.test(html.replace(/<noscript>.*?<\/noscript>/gu, "")), "with the script there is no unconditional refresh (it redrew the QR)");
    assert.match(html, /data-poll="[^"]+\/b\/[^"]+" data-state="held:::\d+"/u, "the marker the script compares");
    assert.match(html, /<details class="fold"><summary>Payment did not go through\?<\/summary>[\s\S]*do not pay again[\s\S]*Try again/u, "the fold says to look in the bank app first, then offers the retry");
    assert.match(html, /name="upi_ref"/u);
    assert.match(html, /usually takes about 30 minutes/u);
    // not held (a link shop's page, a booked page) has no script and keeps the plain policy
    const home = await w.page("/?lang=en");
    assert.ok(!(home.headers.get("content-security-policy") ?? "").includes("script-src"), "the booking page itself still runs no script");
  } finally { await w.done(); }
});

test("the owner's deposit list: waiting for payment apart from customers who say they paid, with the booking reference and the UPI reference; the claim is not in the digest", async () => {
  const w = await world();
  try {
    w.linkOwner();
    const handle = await book(w);
    let owner = await ownerHtml(w);
    assert.match(owner, /<h2>Waiting for payment<\/h2>/u, "a hold nobody has said they paid is only waiting");
    assert.ok(!/Customers say they have paid/u.test(owner));
    assert.match(owner, /Reference b-1 \(it is in the UPI note\)/u, "the booking reference, which is the UPI note");
    const digestBefore = /name="case" value="b-1"><input type="hidden" name="digest" value="([0-9a-f]{32})"/u.exec(owner)?.[1];
    assert.ok(digestBefore);

    // a reference that is not digits is dropped; the claim itself still counts
    await w.form(`/b/${handle}/paid`, { lang: "en", upi_ref: "see my screenshot <b>" });
    await w.client.runtime.idle();
    owner = await ownerHtml(w);
    assert.match(owner, /<h2>Customers say they have paid<\/h2>/u);
    assert.ok(!/Waiting for payment<\/h2>/u.test(owner), "now it is listed first, not as waiting");
    assert.ok(!/UPI reference/u.test(owner) && !/screenshot/u.test(owner), "a typed sentence never reaches the owner's page");
    const digestAfter = /name="case" value="b-1"><input type="hidden" name="digest" value="([0-9a-f]{32})"/u.exec(owner)?.[1];
    assert.equal(digestAfter, digestBefore, "the customer's claim is not in the digest, so it cannot make the owner's own press stale");

    await w.form(`/b/${handle}/paid`, { lang: "en", upi_ref: " 412345678901 " });
    await w.client.runtime.idle();
    owner = await ownerHtml(w);
    assert.match(owner, /UPI reference 412345678901\./u);
    assert.match(owner, /Says paid/u);
    const customer = await (await w.page(`/b/${handle}?lang=en`)).text();
    assert.match(customer, /You said you have paid\. The shop will look in its UPI app\./u);
    assert.match(customer, /usually takes about 30 minutes/u, "the customer is told how long a check takes");
    assert.ok(!/name="upi_ref"/u.test(customer), "and the form is gone once it is pressed");
    assert.ok(w.record().some((e) => e.action === "upi_paid_claim" && e.outcome === "confirmed"), "the owner was asked to look, as before");
    assert.ok(!w.record().some((e) => e.action === "owner_marked_paid"), "nothing was marked paid by the claim");
  } finally { await w.done(); }
});

test("a payment after the hold ended is listed for the owner with refund or keep, and the customer's page says what happens without saying the shop has the money", async () => {
  const w = await world();
  try {
    w.linkOwner();
    const handle = await book(w);
    // the hold (60 minutes) runs out; the next tick expires it
    w.clock.advance(61 * 60_000);
    await w.client.runtime.tick(); await w.client.runtime.idle();
    const expired = await (await w.page(`/b/${handle}?lang=en`)).text();
    assert.match(expired, /The hold ended before the deposit was confirmed/u);
    assert.match(expired, /Paid after the time ended\?[\s\S]*refund it or book you again/u, "the customer may say money left their account as the time ran out");
    assert.ok(!/<script/u.test(expired), "no script here");

    // the owner's list: the ended hold, "did money come?" (it used to show nothing at all)
    let owner = await ownerHtml(w);
    assert.match(owner, /Time ran out: did money come\?/u);
    assert.match(owner, /may have paid ₹200 for [^<]* after the time ended/u);
    assert.match(owner, /After Yes you choose: refund it, or keep it/u);

    // the customer presses "I have paid" with the UPI reference: acknowledged, and listed first for the owner
    await w.form(`/b/${handle}/paid`, { lang: "en", upi_ref: "512345678901" });
    await w.client.runtime.idle();
    const ack = await (await w.page(`/b/${handle}?lang=en`)).text();
    assert.match(ack, /We have noted your payment\. The shop will check it, then refund it or book you again\./u);
    assert.ok(!/have your payment|money is safe|safe/iu.test(ack), "never says the shop has the money, which only the owner can see in their UPI app");
    owner = await ownerHtml(w);
    assert.match(owner, /<h2>Customers say they have paid<\/h2>[\s\S]*Time ran out[\s\S]*UPI reference 512345678901/u);
    assert.ok(w.lines.some((l) => l.startsWith(`[stand-in WhatsApp] to ${OWNER}`) && /says they've paid|says they have paid/iu.test(l)), "the owner was also asked on WhatsApp, as for any claim");

    // "Yes, received" is the late mark: owed back, with "keep" offered, never booked again by itself
    const press = /name="action" value="received"><input type="hidden" name="case" value="(b-\d+)"><input type="hidden" name="digest" value="([0-9a-f]{32})"/u.exec(owner);
    assert.ok(press, "the Yes button");
    const done = await w.form(`/o/${w.ownerToken}/answer`, { source: "runtime", action: "received", case: press![1], digest: press![2] });
    assert.match(done.headers.get("location") ?? "", /n=done/u);
    await w.client.runtime.idle();
    owner = await ownerHtml(w);
    assert.ok(!/Time ran out: did money come/u.test(owner), "answered once");
    assert.match(owner, /Refund to send[\s\S]*name="action" value="kept"/u, "the refund card follows, with keep offered");
    const after = await (await w.page(`/b/${handle}?lang=en`)).text();
    assert.match(after, /The hold ended/u, "not booked again by itself");
    assert.ok(w.record().some((e) => e.action === "owner_marked_paid" && e.refs.markedBy === "owner"), "recorded as the owner's mark, as from WhatsApp");
    assert.ok(w.record().some((e) => e.action === "upi_refund_owed"), "owed back");
  } finally { await w.done(); }
});

test("an expired hold nobody mentions stops being listed after 48 hours (old holds are not listed for ever)", async () => {
  const w = await world();
  try {
    w.linkOwner();
    await book(w);
    w.clock.advance(61 * 60_000);
    await w.client.runtime.tick(); await w.client.runtime.idle();
    assert.match(await ownerHtml(w), /Time ran out/u, "within 48 hours");
    w.clock.advance(49 * 3_600_000);
    await w.client.runtime.tick(); await w.client.runtime.idle();
    assert.ok(!/Time ran out/u.test(await ownerHtml(w)), "after 48 hours with no claim it is no longer listed");
  } finally { await w.done(); }
});
