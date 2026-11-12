// Item 11d end to end, through a real Bookings runtime (stand-in services, a UPI shop on its own booking list) and the real public front over HTTP: the booking page,
// the booking API, the MCP endpoint and the owner's private page. What it shows: a booking from the page goes through the same step, hold, limits and owner-marked
// deposit as a WhatsApp booking, under its own conversation, and nothing is ever sent to the number typed on the form; the owner's press is bound to exactly what the
// page showed; the channel token can do nothing else; two customers for the last slot get one hold; and the per-number limit holds.
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
const OWNER = "+919000000000";

/** A UPI shop on its own booking list, its runtime on a free port with a fake clock (Monday 16 Nov 2026, 09:00 in Kochi), and the front in front of it. */
async function world() {
  const root = mkdtempSync(join(tmpdir(), "geo-channels-"));
  const folder = join(root, "glow");
  const settings = { ...JSON.parse(readFileSync(UPI_SETTINGS, "utf8")), calendar: { module: "own" } };
  const { mkdirSync } = await import("node:fs");
  mkdirSync(folder);
  writeFileSync(join(folder, "settings.json"), JSON.stringify(settings));
  writeFileSync(join(folder, "runtime.json"), JSON.stringify({ mode: "fakes", port: 0, tickSeconds: 3600 }));
  writeFileSync(join(folder, "pathway.lock"), "bookings@0.1.0\n");
  writeFileSync(join(root, "token"), INTERNAL);
  writeFileSync(join(root, "channel"), CHANNEL);
  const clock = fakeClock(Date.UTC(2026, 10, 16, 3, 30));
  const lines: string[] = [];
  const client = await startClient({ clientFolder: folder, tokenFile: join(root, "token"), channelTokenFile: join(root, "channel"), clock, log: (l) => lines.push(l) });
  const shops: Record<string, FrontShop> = {};
  const front = createServer(frontHandler({ shops, waitMs: 1_500 }));
  const port = await new Promise<number>((r) => front.listen(0, "127.0.0.1", () => r((front.address() as { port: number }).port)));
  const origin = `http://127.0.0.1:${port}`;
  shops.glow = { publicUrl: `${origin}/s/glow`, backend: runtimeBackend({ url: client.server.url, token: CHANNEL }) };
  const page = (path: string, init: RequestInit = {}) => fetch(`${origin}/s/glow${path}`, { redirect: "manual", ...init });
  const form = (path: string, fields: Record<string, string>) => page(path, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin }, body: new URLSearchParams(fields).toString() });
  const api = (path: string, body?: unknown) => page(`/api/v1${path}`, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const record = () => { const s = openStore(join(folder, "data")); try { return s.loadState().record; } finally { s.close(); } };
  const ownerToken = newOwnerToken();
  const linkOwner = () => writeFileSync(join(folder, OWNER_LINK_FILE), JSON.stringify(ownerLinkFile(ownerToken, new Date(clock.now()))));
  return {
    origin, page, form, api, record, lines, client, clock, folder, ownerToken, linkOwner,
    async done() { await new Promise<void>((r) => { front.closeAllConnections(); front.close(() => r()); }); await client.stop(); rmSync(root, { recursive: true, force: true }); },
  };
}

/** The start times the page offers for a service, from its radio buttons. */
const startsOn = (html: string): number[] => [...html.matchAll(/name="start" value="(\d+)"/gu)].map((m) => Number(m[1]));
const handleOf = (location: string | null): string => /\/b\/([A-Za-z0-9_-]{32})/u.exec(location ?? "")?.[1] ?? "";

test("a booking from the page goes through the same hold and owner-marked deposit, in its own conversation; the owner's page confirms it; nothing reaches the typed number", async () => {
  const w = await world();
  try {
    const home = await (await w.page("/?lang=en")).text();
    assert.match(home, /Haircut/u);
    assert.match(home, /₹450/u, "the price from the shop's settings");
    const slots = await (await w.page("/?lang=en&service=haircut")).text();
    const starts = startsOn(slots);
    assert.ok(starts.length > 0, "free times are offered");
    assert.equal(starts[0], Date.UTC(2026, 10, 16, 5, 0), "the first is 10:30, the first grid time after the hour the customer needs to pay");

    const nonce = /name="nonce" value="([A-Za-z0-9_-]{32})"/u.exec(slots)?.[1] ?? "";
    assert.ok(nonce, "the form carries its own nonce");
    const posted = await w.form("/book", { service: "haircut", start: String(starts[0]), name: "Asha", phone: "98111 11111", lang: "en", nonce });
    assert.equal(posted.status, 303);
    const handle = handleOf(posted.headers.get("location"));
    assert.ok(handle, "the customer is sent to the booking's own page");
    const twice = await w.form("/book", { service: "haircut", start: String(starts[0]), name: "Asha", phone: "98111 11111", lang: "en", nonce });
    assert.equal(handleOf(twice.headers.get("location")), handle, "a second tap on the same form lands on the same booking");
    await w.client.runtime.idle();
    const held = await (await w.page(`/b/${handle}?lang=en`)).text();
    assert.match(held, /held until/u);
    assert.match(held, /upi:\/\/pay\?pa=glowsalon@okicici/u, "the UPI link carries the shop's own UPI ID");
    assert.match(held, /₹200/u, "the deposit from the settings");
    assert.match(held, /<svg/u, "with its QR code");

    const entries = w.record();
    const made = entries.find((e) => e.action === "channel_booking" && e.outcome === "confirmed");
    assert.ok(made && made.conversation.startsWith("web:") && made.refs.channel === "web", "the record shows the booking came from the page, in its own conversation");
    assert.ok(!JSON.stringify(made).includes("Asha") && !JSON.stringify(made).includes("9811111111"), "the name and number are kept only as the inputs' digest");
    assert.ok(entries.some((e) => e.action === "hold_slot" && e.outcome === "confirmed" && e.booking === made.booking), "held by the same step a WhatsApp booking takes");
    assert.ok(!entries.some((e) => e.conversation === TYPED), "no conversation is the typed number");
    assert.ok(!w.lines.some((l) => l.includes(`to ${TYPED}`)), "nothing was sent to the typed number on WhatsApp");
    assert.ok(w.lines.some((l) => l.startsWith(`[stand-in WhatsApp] to ${OWNER}`) && l.includes("+919811111111")), "the owner was told, with the number the customer typed");

    // the owner's page: refused without a link; with it, the deposit to mark, bound to its digest
    assert.equal((await w.page(`/o/${w.ownerToken}`)).status, 403, "no link file: no owner page");
    w.linkOwner();
    const ownerHtml = await (await w.page(`/o/${w.ownerToken}?lang=en`)).text();
    assert.match(ownerHtml, /Asha, \+919811111111 \(booking page\) should pay ₹200/u);
    const digest = /name="action" value="received"><input type="hidden" name="case" value="(b-\d+)"><input type="hidden" name="digest" value="([0-9a-f]{32})"/u.exec(ownerHtml);
    assert.ok(digest);
    const state = await (await w.page(`/o/${w.ownerToken}/api/v1/state`)).json() as { version: number; waiting: { source: string; kind: string; case: string; digest: string; amount_paise: number }[] };
    assert.equal(state.version, 1);
    assert.deepEqual(state.waiting.map((x) => [x.source, x.kind, x.amount_paise]), [["runtime", "deposit", 20_000]], "the same state as JSON, for the owner's app");
    assert.equal(state.waiting[0].digest, digest[2]);
    const stale = await w.form(`/o/${w.ownerToken}/answer`, { source: "runtime", action: "received", case: digest[1], digest: "f".repeat(32) });
    assert.match(stale.headers.get("location") ?? "", /n=changed/u, "a digest that is not what waits now does nothing");
    const pressed = await w.form(`/o/${w.ownerToken}/answer`, { source: "runtime", action: "received", case: digest[1], digest: digest[2] });
    assert.match(pressed.headers.get("location") ?? "", /n=done/u);
    await w.client.runtime.idle();
    const booked = await (await w.page(`/b/${handle}?lang=en`)).text();
    assert.match(booked, /Booked: Mon 16 Nov, 10:30 am/u);
    const after = w.record();
    assert.ok(after.some((e) => e.action === "owner_page_action" && e.outcome === "confirmed" && e.refs.channel === "owner_page"), "the record says the owner answered on the page");
    assert.ok(after.some((e) => e.action === "upi_marked_received" || (e.refs.markedBy === "owner" && e.booking === made.booking)), "recorded as the owner's mark, as from WhatsApp");
    assert.ok(after.some((e) => e.action === "confirm_booking" && e.outcome === "confirmed" && e.booking === made.booking));
    const again = await w.form(`/o/${w.ownerToken}/answer`, { source: "runtime", action: "received", case: digest[1], digest: digest[2] });
    assert.match(again.headers.get("location") ?? "", /n=changed/u, "the same press again counts nothing");

    // revoked: the runtime refuses the link from its own file
    rmSync(join(w.folder, OWNER_LINK_FILE));
    assert.equal((await w.page(`/o/${w.ownerToken}`)).status, 403);
  } finally { await w.done(); }
});

test("the channel token can send only channel events, and an owner's press needs the owner's link at the runtime itself", async () => {
  const w = await world();
  try {
    const url = w.client.server.url;
    const asChannel = (path: string, body: unknown, extra: Record<string, string> = {}) => fetch(`${url}${path}`, { method: "POST", headers: { authorization: `Bearer ${CHANNEL}`, "content-type": "application/json", ...extra }, body: JSON.stringify(body) });
    const message = { events: [{ kind: "message", message: { id: "wamid.x", from: OWNER, text: "received ABCD23", timestamp: w.clock.now() } }] };
    assert.equal((await asChannel("/internal/events", message)).status, 401, "the channel token is not the inbox's");
    assert.equal((await asChannel("/internal/channel/events", message)).status, 400, "a WhatsApp message is not a channel event");
    const press = { events: [{ kind: "owner_action", id: "o-1", action: "received", case: "b-1", digest: "0".repeat(32) }] };
    assert.equal((await asChannel("/internal/channel/events", press)).status, 403, "no owner's link, no owner's press");
    const viaInbox = await fetch(`${url}/internal/channel/events`, { method: "POST", headers: { authorization: `Bearer ${INTERNAL}` }, body: JSON.stringify(press) });
    assert.equal(viaInbox.status, 401, "and the inbox's token cannot use the channel's routes");
  } finally { await w.done(); }
});

test("two customers for the last free time at the same moment: one hold, and the other is told the time is taken", async () => {
  const w = await world();
  try {
    const slots = (await (await w.api("/slots?service=facial")).json()) as { days: { slots: { start: string }[] }[] };
    const start = slots.days[0].slots[0].start;
    const [a, b] = await Promise.all([
      w.api("/bookings", { service_id: "facial", start, name: "Asha", phone: "9811111111", language: "en" }),
      w.api("/bookings", { service_id: "facial", start, name: "Ravi", phone: "9822222222", language: "en" }),
    ]);
    await w.client.runtime.idle();
    const views = await Promise.all([a, b].map(async (r) => { const v = await r.json() as { handle: string }; return (await (await w.api(`/bookings/${v.handle}`)).json()) as { status: string; messages: { text: string }[] }; }));
    assert.deepEqual(views.map((v) => v.status).sort(), ["held", "not_held"], "exactly one holds the time");
    assert.match(views.find((v) => v.status === "not_held")!.messages.map((m) => m.text).join(" "), /taken|not free|available/iu);
  } finally { await w.done(); }
});

test("one number may hold two unpaid times from the page; a third is refused, and says why", async () => {
  const w = await world();
  try {
    const slots = (await (await w.api("/slots?service=beard-trim")).json()) as { days: { slots: { start: string }[] }[] };
    const times = slots.days.flatMap((d) => d.slots.map((s) => s.start)).slice(0, 3);
    const statuses: string[] = [];
    for (const start of times) {
      const r = await (await w.api("/bookings", { service_id: "beard-trim", start, name: "Asha", phone: "+91 98111 11111" })).json() as { handle: string };
      await w.client.runtime.idle();
      statuses.push(((await (await w.api(`/bookings/${r.handle}`)).json()) as { status: string; reason?: string }).status);
    }
    assert.deepEqual(statuses, ["held", "held", "refused"]);
  } finally { await w.done(); }
});

test("an AI assistant books, reads the payment instructions and cancels through the MCP endpoint, and cannot mark anything paid", async () => {
  const w = await world();
  try {
    const rpc = async (method: string, params: unknown, id = 1) => (await (await w.page("/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) })).json()) as { result: { structuredContent?: Record<string, unknown>; isError?: boolean; tools?: { name: string }[]; protocolVersion?: string } };
    assert.equal((await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } })).result.protocolVersion, "2025-06-18");
    assert.ok(!(await rpc("tools/list", {})).result.tools!.some((t) => /paid|approve|refund/u.test(t.name)), "no tool can mark a payment or approve a refund");
    const free = (await rpc("tools/call", { name: "free_slots", arguments: { service_id: "haircut" } })).result.structuredContent as { days: { slots: { start: string }[] }[] };
    const started = (await rpc("tools/call", { name: "start_booking", arguments: { service_id: "haircut", start: free.days[0].slots[2].start, name: "Meena", phone: "9833333333" } })).result.structuredContent as { handle: string; status: string };
    assert.equal(started.status, "held");
    const pay = (await rpc("tools/call", { name: "payment_instructions", arguments: { handle: started.handle } })).result.structuredContent as { payment: { upi_link: string; amount_paise: number; pay_to: { upi_id: string } } };
    assert.equal(pay.payment.amount_paise, 20_000);
    assert.equal(pay.payment.pay_to.upi_id, "glowsalon@okicici");
    const made = w.record().find((e) => e.action === "channel_booking" && e.outcome === "confirmed");
    assert.equal(made?.refs.channel, "mcp", "the record says an assistant made it");
    const cancelled = (await rpc("tools/call", { name: "cancel_booking", arguments: { handle: started.handle } })).result.structuredContent as { status: string };
    assert.equal(cancelled.status, "cancelled");
    const wrong = (await rpc("tools/call", { name: "booking_status", arguments: { handle: "x".repeat(32) } })).result;
    assert.equal(wrong.isError, true, "an unknown handle is not found, whatever it is");
  } finally { await w.done(); }
});
