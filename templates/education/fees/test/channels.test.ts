// Item 11h end to end, through a real Fees runtime (stand-in services, a UPI centre with a pages file) and the real public front over HTTP: the fee reminder with each
// parent's private link, the parent's page, a payment's confirmation page and the owner's page. What it shows: a parent's link opens only that parent's students; a
// typed number, a made-up link and a switched-off link open nothing; the link survives a restart; the owner sends a new one from their page; "I have paid" on the
// page asks the owner to look and marks nothing, and the confirmation page says "confirmed" only once the owner's mark is on the record; and what waits for the
// owner is the same on their page and in the assistant's "what needs me".
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
import { feesSkill } from "../src/assistant.ts";
import { parseSettings } from "../src/settings.ts";

const INTERNAL = "internal-0123456789abcdef0123";
const CHANNEL = "channel-0123456789abcdef01234";
const SETTINGS = new URL("../settings/bright-tuition-upi.example.json", import.meta.url);
const OWNER = "+919000000000";
const SHARMA = "+919811111111"; // Aarav and Anaya's parent (Hindi)
const NAIR = "+919822222222"; // Meera's parent (Malayalam)
const MEHTA = "+919844444444"; // Rohan's parent (English)
/** Where the runtime's pages file says the centre's page is (https only); the parent's link is read out of the reminder and opened on this test's own front. */
const PAGE_BASE = "https://partners.example/s/bright";

/** A UPI centre with a page, its runtime on a free port with a fake clock (Sun 1 Nov 2026, 09:00 in Kochi), and the front in front of it. */
async function world() {
  const root = mkdtempSync(join(tmpdir(), "geo-fees-channels-"));
  const folder = join(root, "bright");
  const settings = { ...JSON.parse(readFileSync(SETTINGS, "utf8")), assistant: {} };
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
    origin, page, form, record, store, lines, clock, folder, ownerToken, linksTo, settings: parseSettings(settings),
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

/** The answer form on the owner's page for this action and case (or parent ref): its digest. */
const digestOn = (html: string, action: string, ref: string): string | undefined => new RegExp(`name="action" value="${action}"><input type="hidden" name="case" value="${ref}"><input type="hidden" name="digest" value="([0-9a-f]{32})"`, "u").exec(html)?.[1];

test("each parent's link, from the reminder, opens only their own students; a typed number, a made-up link and a switched-off link open nothing; a new link survives a restart", async () => {
  const w = await world();
  try {
    await w.tickAt(w.clock.now()); // the agent's first beat: nothing is due yet
    await w.tickAt(FIRST_REMINDER);
    const sharma = w.linksTo(SHARMA);
    assert.equal(sharma.length, 2, "two reminders, one for each of the Sharmas' children");
    assert.equal(sharma[0], sharma[1], "with the same link: one per parent, made once in the step");
    const nair = w.linksTo(NAIR);
    assert.equal(nair.length, 1);
    assert.notEqual(nair[0], sharma[0], "each parent has their own link");
    assert.ok(w.lines.some((l) => l.startsWith(`[stand-in WhatsApp] to ${SHARMA}:`) && l.includes("कृपया इसे किसी से साझा न करें")), "the Hindi reminder says not to share it");
    const saved = w.store().parentLinks!;
    assert.ok(!JSON.stringify(saved).includes(sharma[0]), "the saved state keeps only the links' hashes");
    assert.ok(!JSON.stringify(w.record()).includes(sharma[0]), "and so does the record");

    const theirs = await (await w.page(`/f/${sharma[0]}?lang=en`)).text();
    assert.match(theirs, /Aarav Sharma/u);
    assert.match(theirs, /Anaya Sharma/u);
    assert.doesNotMatch(theirs, /Meera|Kiran|Rohan/u, "nobody else's children");
    assert.match(theirs, /upi:\/\/pay\?pa=brighttuition@oksbi/u, "how to pay, to the centre's own UPI ID");
    const hers = await (await w.page(`/f/${nair[0]}?lang=en`)).text();
    assert.match(hers, /Meera Nair/u);
    assert.doesNotMatch(hers, /Aarav|Anaya|Kiran|Rohan/u);

    // a typed number, its digits, a made-up link of the right shape: nothing, and nothing learned
    for (const path of [`/f/${SHARMA}`, "/f/9811111111", `/f/${"A".repeat(32)}`]) {
      const r = await w.page(path);
      assert.equal(r.status, 404, path);
      assert.doesNotMatch(await r.text(), /Aarav|Anaya|₹/u, path);
    }
    const centre = await (await w.page(`/?lang=en&phone=${encodeURIComponent(SHARMA)}`)).text();
    assert.doesNotMatch(centre, /Aarav|<form/u, "the centre's page takes no number and shows no one's fees");
    assert.equal((await w.page("/api/v1/fees")).status, 404, "no API for fees");
    assert.equal((await w.page("/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 404, "no MCP for fees");

    // the owner's page: the parents and their links; the Sharmas' is switched off
    const ownerHtml = await w.ownerPage();
    assert.match(ownerHtml, /Parents and their private links/u);
    const sharmaRef = /Aarav Sharma, Anaya Sharma[^]*?name="action" value="revoke_link"><input type="hidden" name="case" value="(p-[0-9a-f]{12})"/u.exec(ownerHtml)?.[1];
    assert.ok(sharmaRef, "the Sharmas' row with its switch-off button");
    const revoked = await w.form(`/o/${w.ownerToken}/answer`, { source: "runtime", action: "revoke_link", case: sharmaRef!, digest: digestOn(ownerHtml, "revoke_link", sharmaRef!)! });
    assert.match(revoked.headers.get("location") ?? "", /n=(done|sent)/u);
    await w.client.runtime.idle();
    assert.equal((await w.page(`/f/${sharma[0]}`)).status, 404, "a switched-off link opens nothing, at once");
    assert.equal((await w.page(`/f/${nair[0]}`)).status, 200, "and another parent's still works");
    assert.ok(w.record().some((e) => e.action === "parent_link" && e.refs.revoked === "yes"), "the record says the owner switched it off");

    // the owner sends a new one: it goes to the parent's WhatsApp, and works
    const again = await w.ownerPage();
    const sent = await w.form(`/o/${w.ownerToken}/answer`, { source: "runtime", action: "send_link", case: sharmaRef!, digest: digestOn(again, "send_link", sharmaRef!)! });
    assert.match(sent.headers.get("location") ?? "", /n=(done|sent)/u);
    await w.client.runtime.idle();
    const fresh = w.linksTo(SHARMA).at(-1)!;
    assert.notEqual(fresh, sharma[0], "a new link");
    assert.equal((await w.page(`/f/${fresh}`)).status, 200);
    assert.equal((await w.page(`/f/${sharma[0]}`)).status, 404, "the old one still opens nothing");
    const stale = await w.form(`/o/${w.ownerToken}/answer`, { source: "runtime", action: "send_link", case: sharmaRef!, digest: digestOn(again, "send_link", sharmaRef!)! });
    assert.match(stale.headers.get("location") ?? "", /n=changed/u, "the same press again sends nothing: the link is not as that page showed it");

    // a restart: the link is in the saved state, so it still opens the same page
    await w.restart();
    const after = await (await w.page(`/f/${fresh}?lang=en`)).text();
    assert.match(after, /Aarav Sharma/u, "the link survives a restart");
  } finally { await w.done(); }
});

test("\"I have paid\" on the page asks the owner to look and marks nothing; the confirmation page says confirmed only once the owner's mark is on the record", async () => {
  const w = await world();
  try {
    await w.tickAt(w.clock.now());
    await w.tickAt(FIRST_REMINDER);
    const link = w.linksTo(MEHTA)[0];
    assert.ok(link, "Rohan's parent got a reminder with their link");
    const parentHtml = await (await w.page(`/f/${link}?lang=en`)).text();
    assert.match(parentHtml, /Still to pay: ₹1,800/u, "the class 10 fee from the settings");
    const dueId = /name="due" value="(f-\d+)"/u.exec(parentHtml)?.[1];
    const nonce = /name="nonce" value="([A-Za-z0-9_-]{32})"/u.exec(parentHtml)?.[1];
    assert.ok(dueId && nonce);
    const toParentBefore = w.lines.filter((l) => l.startsWith(`[stand-in WhatsApp] to ${MEHTA}:`)).length;
    const pressed = await w.form(`/f/${link}/paid`, { due: dueId!, nonce: nonce!, lang: "en" });
    assert.equal(pressed.status, 303);
    const confirmPath = new URL(pressed.headers.get("location")!).pathname.replace("/s/bright", "");
    assert.match(confirmPath, /^\/fee\/[A-Za-z0-9_-]{32}$/u, "the parent is sent to the payment's own confirmation page");
    const twice = await w.form(`/f/${link}/paid`, { due: dueId!, nonce: nonce!, lang: "en" });
    assert.equal(new URL(twice.headers.get("location")!).pathname.replace("/s/bright", ""), confirmPath, "a double tap is one press");
    await w.client.runtime.idle();
    const waiting = await (await w.page(`${confirmPath}?lang=en`)).text();
    assert.match(waiting, /has not confirmed it yet/u);
    assert.doesNotMatch(waiting, /Confirmed/u, "nothing is confirmed on the parent's word");
    assert.equal(w.lines.filter((l) => l.startsWith(`[stand-in WhatsApp] to ${MEHTA}:`)).length, toParentBefore, "the page is the answer: no WhatsApp reply to the parent");
    assert.ok(w.lines.some((l) => l.startsWith(`[stand-in WhatsApp] to ${OWNER}:`) && l.includes(`Parent ${MEHTA} says they have paid Rohan Mehta's`)), "the owner is asked to look");
    assert.ok(!w.record().some((e) => e.action === "settle_fee"), "nothing is marked paid");

    // the owner's page lists it, and the assistant's "what needs me" lists the same; the owner presses Received
    const ownerHtml = await w.ownerPage();
    assert.match(ownerHtml, /Rohan Mehta, \+919844444444 should pay ₹1,800 for class 10, November 2026/u);
    const state = await (await w.page(`/o/${w.ownerToken}/api/v1/state`)).json() as { waiting: { kind: string; case: string; amount_paise: number }[] };
    const skill = feesSkill({ settings: w.settings, store: w.store(), nowMs: () => w.clock.now(), optedOut: () => false });
    assert.deepEqual(skill.waiting().map((i) => [i.kind, i.case, i.amountPaise]), state.waiting.map((x) => [x.kind, x.case, x.amount_paise]), "the assistant's list is the owner page's list");
    assert.deepEqual(state.waiting.map((x) => [x.kind, x.case, x.amount_paise]), [["deposit", dueId, 180_000]], "only the claimed fee waits for the owner: the others wait for their parents");
    const done = await w.form(`/o/${w.ownerToken}/answer`, { source: "runtime", action: "received", case: dueId!, digest: digestOn(ownerHtml, "received", dueId!)! });
    assert.match(done.headers.get("location") ?? "", /n=done/u);
    await w.client.runtime.idle();
    const confirmed = await (await w.page(`${confirmPath}?lang=en`)).text();
    assert.match(confirmed, /Confirmed: the centre's record shows Rohan Mehta's November 2026 fee paid \(₹1,800\)/u);
    const paidPage = await (await w.page(`/f/${link}?lang=en`)).text();
    assert.match(paidPage, /Paid\. The centre's record shows it\./u);
    const entries = w.record();
    assert.ok(entries.some((e) => e.action === "channel_fee" && e.outcome === "confirmed" && e.refs.op === "fee_paid"), "the record says the parent pressed it on their page");
    assert.ok(entries.some((e) => e.refs.markedBy === "owner" && e.booking === dueId), "marked by the owner, as from WhatsApp");
    assert.ok(entries.some((e) => e.action === "settle_fee" && e.booking === dueId), "settled from the record");
    assert.ok(w.lines.some((l) => l.startsWith(`[stand-in WhatsApp] to ${MEHTA}:`) && l.includes("has received ₹1,800 for Rohan Mehta's")), "and the parent gets the usual receipt");
    assert.equal((await (await w.page(`/o/${w.ownerToken}/api/v1/state`)).json() as { waiting: unknown[] }).waiting.length, 0, "nothing waits for the owner now");
  } finally { await w.done(); }
});

test("a waiver a parent asked for on WhatsApp waits on the owner's page and in \"what needs me\", and the owner's press there answers it", async () => {
  const w = await world();
  try {
    await w.tickAt(w.clock.now());
    await w.tickAt(FIRST_REMINDER);
    const r = await fetch(`${w.client.server.url}/internal/events`, { method: "POST", headers: { authorization: `Bearer ${INTERNAL}` }, body: JSON.stringify({ events: [{ kind: "message", message: { id: "wamid.parent-discount", from: MEHTA, text: "please give a discount of 300", timestamp: w.clock.now() } }] }) });
    assert.equal(r.status, 200);
    await w.client.runtime.idle();
    const state = await (await w.page(`/o/${w.ownerToken}/api/v1/state`)).json() as { waiting: { kind: string; case: string; amount_paise: number }[] };
    assert.deepEqual(state.waiting.map((x) => [x.kind, x.amount_paise]), [["waiver", 30_000]]);
    const skill = feesSkill({ settings: w.settings, store: w.store(), nowMs: () => w.clock.now(), optedOut: () => false });
    assert.deepEqual(skill.waiting().map((i) => [i.kind, i.case, i.amountPaise]), state.waiting.map((x) => [x.kind, x.case, x.amount_paise]));
    const ownerHtml = await w.ownerPage();
    assert.match(ownerHtml, /Rohan Mehta's parent asked to take ₹300 off class 10, November 2026/u);
    const dueId = state.waiting[0].case;
    const pressed = await w.form(`/o/${w.ownerToken}/answer`, { source: "runtime", action: "deny", case: dueId, digest: digestOn(ownerHtml, "deny", dueId)! });
    assert.match(pressed.headers.get("location") ?? "", /n=done/u);
    await w.client.runtime.idle();
    assert.ok(w.record().some((e) => e.action === "owner_page_action" && e.outcome === "confirmed" && e.refs.channel === "owner_page"), "pressed on the owner's page");
    assert.equal(w.store().dues.get(dueId)!.waiverDenied, true, "the owner's no, as from WhatsApp");
  } finally { await w.done(); }
});
