// Money clarity (batch 4, 14 Nov 2026) for a Fees centre, end to end through a real runtime and the real public front over HTTP, and the item-1 leftovers that were
// untested: the payment gateway on the parent's page, and a refund Guard holds on the owner's page.
//   * the owner can mark an open fee paid by hand (cash, or a bank transfer the agent cannot see): the mark is the owner's, for the whole balance, written to the record the way
//     the owner's UPI mark is (so the rules that read "the record shows the money" see it: the parent is told it was received, reminders stop), it is bound to the fee as
//     shown (a stale or a second press does nothing), it closes a gateway link still open, and the money can never be refunded through a payments service (there is none for it);
//   * "I have paid" takes the UPI reference (digits) and the owner's card shows it, with when the parent said so;
//   * a gateway (Razorpay) centre's parent page has the payment link and none of the UPI parts;
//   * a refund Guard holds is listed from the approvals relay on the owner's page and answered with exactly the digest shown, never refunded by the page itself.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeClock } from "../../../../modules/core/clock.ts";
import { zonedToMs } from "../../../../modules/core/time.ts";
import { frontHandler } from "../../../../modules/channels/front.ts";
import type { FrontShop } from "../../../../modules/channels/front.ts";
import { runtimeBackend } from "../../../../modules/channels/backend.ts";
import { OWNER_LINK_FILE, newOwnerToken, ownerLinkFile } from "../../../../modules/channels/owner-link.ts";
import { openStore } from "../server/store.ts";
import { parseStore } from "../server/snapshot.ts";
import { startClient } from "../server/start.ts";
import { parseSettings } from "../src/settings.ts";

const INTERNAL = "internal-0123456789abcdef0123";
const CHANNEL = "channel-0123456789abcdef01234";
const SETTINGS = new URL("../settings/bright-tuition-upi.example.json", import.meta.url);
const GATEWAY_SETTINGS = new URL("../settings/bright-tuition.example.json", import.meta.url);
const OWNER = "+919000000000";
const SHARMA = "+919811111111"; // Aarav and Anaya's parent (Hindi)
const NAIR = "+919822222222"; // Meera's parent (Malayalam)
const MEHTA = "+919844444444"; // Rohan's parent (English)
/** Where the runtime's pages file says the centre's page is (https only); the parent's link is read out of the reminder and opened on this test's own front. */
const PAGE_BASE = "https://partners.example/s/bright";

/** A UPI centre with a page, its runtime on a free port with a fake clock (Sun 1 Nov 2026, 09:00 in Kochi), and the front in front of it. */
async function world(o: { gateway?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), "geo-fees-channels-"));
  const folder = join(root, "bright");
  const settings = { ...JSON.parse(readFileSync(o.gateway ? GATEWAY_SETTINGS : SETTINGS, "utf8")), assistant: {} };
  mkdirSync(folder);
  writeFileSync(join(folder, "settings.json"), JSON.stringify(settings));
  writeFileSync(join(folder, "runtime.json"), JSON.stringify({ mode: "fakes", port: 0, tickSeconds: 3600 }));
  writeFileSync(join(folder, "pathway.lock"), "fees@0.1.0\n");
  writeFileSync(join(folder, "pages.json"), JSON.stringify({ schema: 1, base: PAGE_BASE, ownerBase: `${PAGE_BASE}/owner` }));
  writeFileSync(join(root, "token"), INTERNAL);
  writeFileSync(join(root, "channel"), CHANNEL);
  const shops: Record<string, FrontShop> = {};
  const front = createServer(frontHandler({ shops, waitMs: 1_500 }));
  const port = await new Promise<number>((r) => front.listen(0, "127.0.0.1", () => r((front.address() as { port: number }).port)));
  const origin = `http://127.0.0.1:${port}`;
  const clock = fakeClock(zonedToMs({ year: 2026, month: 11, day: 1 }, { hour: 9, minute: 0 }, "Asia/Kolkata"));
  const lines: string[] = [];
  const start = () => startClient({ clientFolder: folder, tokenFile: join(root, "token"), channelTokenFile: join(root, "channel"), clock, log: (l) => lines.push(l) });
  let client = await start();
  const attach = () => { shops.bright = { publicUrl: `${origin}/s/bright`, backend: runtimeBackend({ url: client.server.url, token: CHANNEL }), kind: "fees" }; };
  attach();
  const page = (path: string, init: RequestInit = {}) => fetch(`${origin}/s/bright${path}`, { redirect: "manual", ...init });
  const form = (path: string, fields: Record<string, string>) => page(path, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin }, body: new URLSearchParams(fields).toString() });
  const record = () => { const s = openStore(join(folder, "data")); try { return s.loadState().record; } finally { s.close(); } };
  const store = () => { const s = openStore(join(folder, "data")); try { return parseStore(s.loadState().snapshot!); } finally { s.close(); } };
  const ownerToken = newOwnerToken();
  writeFileSync(join(folder, OWNER_LINK_FILE), JSON.stringify(ownerLinkFile(ownerToken, new Date(clock.now()))));
  /** The links sent to a parent so far, in order, read out of the stand-in WhatsApp's lines. */
  const linksTo = (parent: string): string[] => lines.filter((l) => l.startsWith(`[stand-in WhatsApp] to ${parent}:`)).flatMap((l) => [...l.matchAll(/https:\/\/partners\.example\/s\/bright\/f\/([A-Za-z0-9_-]{32})/gu)].map((m) => m[1]));
  return {
    origin, page, form, record, store, lines, clock, folder, ownerToken, linksTo, shops, settings: parseSettings(settings),
    /** A parent writes to the centre on WhatsApp, as the inbox would hand it to the runtime. */
    async parentSays(from: string, text: string, id = `wamid.parent-${text.length}-${clock.now()}`) {
      const r = await fetch(`${client.server.url}/internal/events`, { method: "POST", headers: { authorization: `Bearer ${INTERNAL}` }, body: JSON.stringify({ events: [{ kind: "message", message: { id, from, text, timestamp: clock.now() } }] }) });
      assert.equal(r.status, 200);
      await client.runtime.idle();
    },
    get client() { return client; },
    /** Time passes to `ms` and the clock's beat runs (a step). */
    async tickAt(ms: number) { clock.set(ms); await client.runtime.tick(); await client.runtime.idle(); },
    /** The process stops and starts again over the same folder: only what was saved is left. */
    async restart() { await client.stop(); client = await start(); attach(); },
    async ownerPage() { return (await page(`/o/${ownerToken}?lang=en`)).text(); },
    async done() { await new Promise<void>((r) => { front.closeAllConnections(); front.close(() => r()); }); await client.stop(); rmSync(root, { recursive: true, force: true }); },
  };
}


/** The first reminder day of November: 2 Nov, 10:00 in Kochi (the due day is the 5th, the first reminder three days before). */
const FIRST_REMINDER = zonedToMs({ year: 2026, month: 11, day: 2 }, { hour: 10, minute: 0 }, "Asia/Kolkata");
/** The answer form on the owner's page for this action and case: its digest. */
const digestOn = (html: string, action: string, ref: string): string | undefined => new RegExp(`name="action" value="${action}"><input type="hidden" name="case" value="${ref}"><input type="hidden" name="digest" value="([0-9a-f]{32})"`, "u").exec(html)?.[1];
type World = Awaited<ReturnType<typeof world>>;

/** The first reminders go out; returns Rohan's parent's private link and Rohan's fee id. */
async function remindMehta(w: World): Promise<{ link: string; dueId: string; parentHtml: string }> {
  await w.tickAt(w.clock.now());
  await w.tickAt(FIRST_REMINDER);
  const link = w.linksTo(MEHTA)[0];
  assert.ok(link);
  const parentHtml = await (await w.page(`/f/${link}?lang=en`)).text();
  const dueId = /name="due" value="(f-\d+)"/u.exec(parentHtml)?.[1];
  assert.ok(dueId);
  return { link, dueId: dueId!, parentHtml };
}

test("the same page's other choice: a bank transfer is marked as the bank's money, with via \"bank\"", async () => {
  const w = await world();
  try {
    const { dueId } = await remindMehta(w);
    const owner = await w.ownerPage();
    const digest = digestOn(owner, "bank", dueId);
    assert.ok(digest, "the bank press carries the digest of the fee as shown");
    const done = await w.form(`/o/${w.ownerToken}/answer`, { source: "runtime", action: "bank", case: dueId, digest: digest! });
    assert.match(done.headers.get("location") ?? "", /n=done/u);
    await w.client.runtime.idle();
    const mark = w.record().find((e) => e.action === "owner_marked_paid" && e.booking === dueId);
    assert.ok(mark && mark.refs.via === "bank" && mark.refs.method === "bank" && mark.refs.money === "received" && mark.refs.amountPaise === "180000", "recorded as the owner's mark by bank transfer, in the books as bank money");
    assert.ok(w.record().some((e) => e.action === "settle_fee" && e.booking === dueId && e.outcome === "confirmed"), "settled from the record, as for cash");
  } finally { await w.done(); }
});

test("the owner marks a fee paid in cash from the page: bound to the fee as shown, the parent is told it was received, reminders stop, and it can never be refunded through a payments service", async () => {
  const w = await world();
  try {
    const { link, dueId } = await remindMehta(w);
    // before: nobody claimed it, so it was not on the owner's list of things to answer, and there was no way to mark it at all
    let owner = await w.ownerPage();
    assert.doesNotMatch(owner, /should pay ₹1,800/u, "an unclaimed fee is not a thing waiting for an answer");
    assert.match(owner, /<h2>Paid in cash or by bank\?<\/h2><details class="fold"><summary>If a parent paid you another way, mark it here\./u, "the folded list of open fees");
    assert.match(owner, /Rohan Mehta, class 10, Nov 2026[\s\S]*Paid ₹1,800 in cash[\s\S]*Paid ₹1,800 by bank transfer/u, "two choices: cash and bank transfer");
    const digest = digestOn(owner, "cash", dueId);
    assert.ok(digest, "the press carries the digest of the fee as shown");
    const state = await (await w.page(`/o/${w.ownerToken}/api/v1/state`)).json() as { cash: { case: string; amount_paise: number; actions: string[] }[]; waiting: unknown[] };
    assert.deepEqual(state.cash.find((c) => c.case === dueId), { source: "runtime", case: dueId, digest, student: "Rohan Mehta", what: "class 10, Nov 2026", amount_paise: 180_000, actions: ["cash", "bank"] }, "the same list as JSON, for the owner's app");

    const stale = await w.form(`/o/${w.ownerToken}/answer`, { source: "runtime", action: "cash", case: dueId, digest: "f".repeat(32) });
    assert.match(stale.headers.get("location") ?? "", /n=changed/u, "a digest that is not the fee as shown does nothing");
    assert.ok(!w.record().some((e) => e.action === "owner_marked_paid"), "nothing marked yet");

    const toParentBefore = w.lines.filter((l) => l.startsWith(`[stand-in WhatsApp] to ${MEHTA}:`)).length;
    const done = await w.form(`/o/${w.ownerToken}/answer`, { source: "runtime", action: "cash", case: dueId, digest: digest! });
    assert.match(done.headers.get("location") ?? "", /n=done/u);
    await w.client.runtime.idle();
    const entries = w.record();
    const mark = entries.find((e) => e.action === "owner_marked_paid" && e.booking === dueId);
    assert.ok(mark && mark.refs.markedBy === "owner" && mark.refs.via === "cash" && mark.refs.amountPaise === "180000", "recorded as the owner's mark, by hand, for the whole balance");
    assert.ok(mark.refs.money === "received" && mark.refs.method === "cash" && mark.refs.evidence === "owner_mark" && mark.refs.for === "fee", "and in the books as cash received for the fee");
    assert.ok(entries.some((e) => e.action === "settle_fee" && e.booking === dueId && e.outcome === "confirmed"), "settled from the record, as for any payment");
    assert.ok(w.lines.filter((l) => l.startsWith(`[stand-in WhatsApp] to ${MEHTA}:`)).length > toParentBefore && w.lines.some((l) => l.startsWith(`[stand-in WhatsApp] to ${MEHTA}:`) && l.includes("has received ₹1,800 for Rohan Mehta's")), "the parent is told it was received");
    assert.match(await (await w.page(`/f/${link}?lang=en`)).text(), /Paid\. The centre&#39;s record shows it\./u);
    owner = await w.ownerPage();
    assert.ok(!owner.includes(`name="case" value="${dueId}"`) || !/Paid ₹1,800 in cash[\s\S]*Rohan Mehta/u.test(owner), "gone from the list");
    const again = await w.form(`/o/${w.ownerToken}/answer`, { source: "runtime", action: "cash", case: dueId, digest: digest! });
    assert.match(again.headers.get("location") ?? "", /n=changed/u, "the same press again marks nothing twice");
    assert.equal(w.record().filter((e) => e.action === "owner_marked_paid" && e.booking === dueId).length, 1);

    // later reminders stop (the rules read the record, which now shows the money) ...
    const toMehta = () => w.lines.filter((l) => l.startsWith(`[stand-in WhatsApp] to ${MEHTA}:`)).length;
    const beforeTick = toMehta();
    await w.tickAt(FIRST_REMINDER + 3 * 24 * 3_600_000);
    assert.equal(toMehta(), beforeTick, "no reminder goes out for a fee the record shows paid");
    // ... and a refund the parent asks for is never sent to a payments service for this money: there is none, and the owner gives cash back by hand
    await w.parentSays(MEHTA, "I want 500 rupees refunded");
    const refundCalls = w.record().filter((e) => e.action === "refund" && e.outcome === "confirmed");
    assert.equal(refundCalls.length, 0, "no refund went out for money no payments service holds");
    assert.ok(w.store().dues.get(dueId)!.payments.every((p) => p.id.startsWith("cash-") && p.linkId === "cash"));
  } finally { await w.done(); }
});

test("a gateway centre: the cash mark closes the fee's open payment link, and the parent's page has the link and none of the UPI parts", async () => {
  const w = await world({ gateway: true });
  try {
    const { link, dueId, parentHtml } = await remindMehta(w);
    assert.match(parentHtml, /<a class="btn full" href="https?:[^"]+" rel="noreferrer">Pay ₹1,800<\/a>/u, "the gateway's link");
    for (const gone of [/data-upi/u, /upi:\/\/pay/u, /Copy UPI ID/u, /<script/u]) assert.doesNotMatch(parentHtml, gone);
    const owner = await w.ownerPage();
    const digest = digestOn(owner, "cash", dueId);
    assert.ok(digest, "a gateway centre's owner can mark cash too");
    assert.ok(w.store().dues.get(dueId)!.links.length > 0, "a payment link is open");
    await w.form(`/o/${w.ownerToken}/answer`, { source: "runtime", action: "cash", case: dueId, digest: digest! });
    await w.client.runtime.idle();
    assert.equal(w.store().dues.get(dueId)!.state, "paid");
    assert.ok(w.record().some((e) => e.action === "cancel_fee_link" && e.booking === dueId && e.outcome === "confirmed"), "the link that could still be paid is closed");
    assert.match(await (await w.page(`/f/${link}?lang=en`)).text(), /Paid\./u);
  } finally { await w.done(); }
});

test("\"I have paid\" takes the UPI reference (digits only) and the owner's card shows it, with when the parent said so; the parent is told how long a check takes", async () => {
  const w = await world();
  try {
    const { link, dueId, parentHtml } = await remindMehta(w);
    assert.match(parentHtml, /name="upi_ref"/u);
    assert.match(parentHtml, /usually takes about 30 minutes/u);
    const nonce = /name="nonce" value="([A-Za-z0-9_-]{32})"/u.exec(parentHtml)![1];
    await w.form(`/f/${link}/paid`, { due: dueId, nonce, lang: "en", upi_ref: "612345678901" });
    await w.client.runtime.idle();
    const owner = await w.ownerPage();
    assert.match(owner, /<h2>Customers say they have paid<\/h2>/u);
    assert.match(owner, /Said they paid at [^<]*\. UPI reference 612345678901\./u);
    // a reference that is not digits is dropped; the claim still counts
    const w2 = await world();
    try {
      const m = await remindMehta(w2);
      const n2 = /name="nonce" value="([A-Za-z0-9_-]{32})"/u.exec(m.parentHtml)![1];
      await w2.form(`/f/${m.link}/paid`, { due: m.dueId, nonce: n2, lang: "en", upi_ref: "my screenshot" });
      await w2.client.runtime.idle();
      const o2 = await w2.ownerPage();
      assert.match(o2, /Customers say they have paid/u);
      assert.doesNotMatch(o2, /UPI reference|screenshot/u);
    } finally { await w2.done(); }
  } finally { await w.done(); }
});

test("a refund Guard holds is on the Fees owner's page, answered with exactly the digest shown; the page never refunds by itself, and a stale answer changes nothing", async () => {
  const w = await world();
  try {
    const ask = { approval: "ap-9", digest: "c".repeat(32), amountPaise: 250_000, customerPhone: MEHTA, booking: null, untilMs: w.clock.now() + 3_600_000 };
    const decided: string[] = [];
    w.shops.bright.relay = {
      asks: async () => (decided.length === 0 ? [ask] : []),
      decide: async (_o, approval, digest, decision) => { if (approval !== ask.approval || digest !== ask.digest) return "changed"; decided.push(decision); return "recorded"; },
    };
    const owner = await w.ownerPage();
    assert.match(owner, /₹2,500/u, "the amount Guard holds");
    assert.match(owner, /name="source" value="relay"><input type="hidden" name="action" value="approve"><input type="hidden" name="case" value="ap-9"><input type="hidden" name="digest" value="c{32}"/u);
    const before = w.record().length;
    const stale = await w.form(`/o/${w.ownerToken}/answer`, { source: "relay", action: "deny", case: "ap-9", digest: "d".repeat(32) });
    assert.match(stale.headers.get("location") ?? "", /n=changed/u);
    assert.deepEqual(decided, []);
    const no = await w.form(`/o/${w.ownerToken}/answer`, { source: "relay", action: "deny", case: "ap-9", digest: ask.digest });
    assert.match(no.headers.get("location") ?? "", /n=done/u);
    assert.deepEqual(decided, ["deny"], "the owner's no, passed on once");
    assert.ok(!w.record().slice(before).some((e) => /refund/u.test(e.action)), "the page did not refund anything");
    assert.doesNotMatch(await w.ownerPage(), /ap-9/u);
  } finally { await w.done(); }
});
