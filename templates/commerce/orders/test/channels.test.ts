// Item 11h end to end, through a real Orders runtime (stand-in services, a UPI shop) and the real public front over HTTP: the menu page, an order's page, the ordering
// API, the MCP endpoint and the owner's page. What it shows: an order from the page runs through the agent's own `proceed` (the same checks, hold and owner-marked
// advance as a WhatsApp order) in its own conversation, with the shop's own prices whatever the form says; nothing is ever sent to the typed number; a part marked on
// WhatsApp and the rest pressed on the owner's page confirm it, bound to what the page showed; two customers for the last of an item get one hold; an AI assistant
// can order through MCP but cannot mark a payment or approve a refund; and what waits for the owner is the same on the page and in the assistant's "what needs me".
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
import { ordersSkill } from "../src/assistant.ts";
import { parseSettings } from "../src/settings.ts";
import { exportShop } from "../../../../bundle/backup/export.ts";

const INTERNAL = "internal-0123456789abcdef0123";
const CHANNEL = "channel-0123456789abcdef01234";
const SETTINGS = new URL("../settings/annapurna-tiffins.example.json", import.meta.url);
const OWNER = "+919800000001";
const TYPED = "+919811111111";
/** Tomorrow, from the fake clock's Monday 16 Nov 2026, 09:00 in Kochi. */
const TOMORROW = "2026-11-17";

/** A UPI tiffin shop (Annapurna, the example) whose chicken meal has only `chicken` a day, its runtime on a free port with a fake clock, and the front in front of it. */
async function world(o: { chicken?: number; assistant?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), "geo-orders-channels-"));
  const folder = join(root, "annapurna");
  const base = JSON.parse(readFileSync(SETTINGS, "utf8"));
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
    origin, page, form, api, mcp, record, store, lines, client, clock, folder, ownerToken, settings: parseSettings(base),
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

test("an order from the page holds at the shop's own prices in its own conversation; a part marked on WhatsApp and the rest pressed on the owner's page confirm it", async () => {
  const w = await world();
  try {
    const menu = await (await w.page(`/?lang=en&date=${TOMORROW}`)).text();
    assert.match(menu, /veg thali/u, "the item as the settings name it");
    assert.match(menu, /₹120/u, "its price from the shop's settings");
    assert.match(menu, /name="slot" value="lunch"/u, "tomorrow's slots, pickup and delivery");
    assert.match(menu, /12 left/u, "what is left of each item that day");
    const nonce = nonceOf(menu);
    assert.ok(nonce, "the form carries its own nonce");

    // a forged price field changes nothing: the form's prices are never read
    const fields = { date: TOMORROW, slot: "lunch", "qty_veg-thali": "2", priceInr: "1", total: "1", name: "Asha", phone: "98111 11111", lang: "en", nonce };
    const posted = await w.form("/order", fields);
    assert.equal(posted.status, 303);
    const handle = handleOf(posted.headers.get("location"));
    assert.ok(handle, "the customer is sent to the order's own page");
    const twice = await w.form("/order", fields);
    assert.equal(handleOf(twice.headers.get("location")), handle, "a second tap on the same form lands on the same order");
    await w.client.runtime.idle();
    const held = await (await w.page(`/order/${handle}?lang=en`)).text();
    assert.match(held, /held until/u);
    assert.match(held, /Total: ₹240/u, "2 × ₹120, from the settings");
    assert.match(held, /Advance to pay now: ₹120/u, "the shop's 50% advance");
    assert.match(held, /upi:\/\/pay\?pa=annapurna@okicici/u, "the shop's own UPI ID");
    assert.match(held, /<svg/u, "with its QR code");

    const entries = w.record();
    const made = entries.find((e) => e.action === "channel_order" && e.outcome === "confirmed");
    assert.ok(made && made.conversation.startsWith("web:") && made.refs.channel === "web", "the record shows the order came from the page, in its own conversation");
    assert.ok(!JSON.stringify(made).includes("Asha") && !JSON.stringify(made).includes("9811111111"), "the name and number are kept only as the inputs' digest");
    assert.ok(entries.some((e) => e.action === "hold_stock" && e.outcome === "confirmed" && e.booking === made.booking), "held by the agent's own proceed, as a WhatsApp order");
    assert.ok(!entries.some((e) => e.conversation === TYPED), "no conversation is the typed number");
    assert.ok(!w.lines.some((l) => l.includes(`to ${TYPED}`)), "nothing was sent to the typed number on WhatsApp");
    const told = w.lines.find((l) => l.startsWith(`[stand-in WhatsApp] to ${OWNER}`) && l.includes("UPI payment to check"));
    assert.ok(told && told.includes(TYPED), "the owner was told, with the number the customer typed");
    const code = /received ([A-Z0-9]{4,8})"/u.exec(told!)?.[1];
    assert.ok(code, "the owner's one-use code");

    // the owner marks ₹50 on WhatsApp: not the whole advance, so the order stays held and the page asks for the rest
    await w.ownerSays(`received ${code} 50`);
    const part = await (await w.page(`/order/${handle}?lang=en`)).text();
    assert.match(part, /held until/u, "a part does not confirm it");
    assert.match(part, /Pay ₹70 to Annapurna Tiffins/u, "the page asks for what is left");
    assert.match(part, /am=70\.00/u, "and its UPI link carries that amount");

    // the owner's page: the advance still to mark, at what is left, bound to its digest
    const ownerHtml = await (await w.page(`/o/${w.ownerToken}?lang=en`)).text();
    assert.match(ownerHtml, /Asha, \+919811111111 \(shop page\) should pay ₹70 for 2 × veg thali, Tue 17 Nov, 12:00 pm/u);
    const digest = /name="action" value="received"><input type="hidden" name="case" value="(o-\d+)"><input type="hidden" name="digest" value="([0-9a-f]{32})"/u.exec(ownerHtml);
    assert.ok(digest);
    const state = await (await w.page(`/o/${w.ownerToken}/api/v1/state`)).json() as { waiting: { kind: string; amount_paise: number; case: string }[] };
    assert.deepEqual(state.waiting.map((x) => [x.kind, x.amount_paise, x.case]), [["deposit", 7_000, digest[1]]], "the same as JSON, for the owner's app");
    const stale = await w.form(`/o/${w.ownerToken}/answer`, { source: "runtime", action: "received", case: digest[1], digest: "f".repeat(32) });
    assert.match(stale.headers.get("location") ?? "", /n=changed/u, "a digest that is not what waits now does nothing");
    const pressed = await w.form(`/o/${w.ownerToken}/answer`, { source: "runtime", action: "received", case: digest[1], digest: digest[2] });
    assert.match(pressed.headers.get("location") ?? "", /n=done/u);
    await w.client.runtime.idle();
    const confirmed = await (await w.page(`/order/${handle}?lang=en`)).text();
    assert.match(confirmed, /Confirmed: pickup, Tue 17 Nov, 12:00 pm–1:00 pm/u);
    const after = w.record();
    assert.ok(after.some((e) => e.action === "owner_page_action" && e.outcome === "confirmed" && e.refs.channel === "owner_page"), "the record says the owner answered on the page");
    assert.equal(after.filter((e) => e.refs.markedBy === "owner" && e.booking === made.booking).length, 2, "two marks, both the owner's: the part on WhatsApp and the rest on the page");
    assert.ok(after.some((e) => e.action === "confirm_order" && e.outcome === "confirmed" && e.booking === made.booking), "confirmed only once the record held the whole advance");
    const again = await w.form(`/o/${w.ownerToken}/answer`, { source: "runtime", action: "received", case: digest[1], digest: digest[2] });
    assert.match(again.headers.get("location") ?? "", /n=changed/u, "the same press again counts nothing");
    const coming = await (await w.page(`/o/${w.ownerToken}?lang=en`)).text();
    assert.match(coming, /Coming orders/u);
    assert.match(coming, /2 × veg thali/u, "the confirmed order is in the owner's coming list");
  } finally { await w.done(); }
});

test("two customers for the last chicken meal get one hold: the second is told it is sold out and nothing is held for it", async () => {
  const w = await world({ chicken: 1 });
  try {
    const order = (phone: string) => w.api("/orders", { items: [{ item_id: "chicken-meal", qty: 1 }], date: TOMORROW, way: "pickup", slot_id: "lunch", name: "Ravi", phone, language: "en" });
    const [a, b] = await Promise.all([order("+919811111112"), order("+919811111113")]);
    const answers = [await a.json(), await b.json()] as { status: string; handle: string; messages?: { text: string }[] }[];
    await w.client.runtime.idle();
    const states = await Promise.all(answers.map(async (x) => ((await (await w.api(`/orders/${x.handle}`)).json()) as { status: string; messages: { text: string }[] })));
    assert.deepEqual(states.map((s) => s.status).sort(), ["held", "not_held"], "one hold, one refusal");
    const refused = states.find((s) => s.status === "not_held")!;
    assert.ok(refused.messages.some((m) => /sold out/iu.test(m.text)), `the second is told why, on its page: ${JSON.stringify(refused.messages)}`);
    const list = await (await w.api(`/items?language=en`)).json() as { days: { date: string; left: Record<string, number> }[] };
    assert.equal(list.days.find((d) => d.date === TOMORROW)!.left["chicken-meal"], 0, "and the menu shows none left that day");
    assert.equal(w.record().filter((e) => e.action === "hold_stock" && e.outcome === "confirmed").length, 1);
  } finally { await w.done(); }
});

test("an AI assistant orders through MCP within the shop's limits, and is refused what only the owner may do", async () => {
  const w = await world({ chicken: 2 });
  try {
    const tools = await w.mcp("tools/list", {});
    assert.deepEqual(tools.result.tools!.map((t) => t.name), [...ORDER_OPERATIONS], "the same operations as the API");
    assert.deepEqual(Object.keys(ORDER_API_ROUTES), [...ORDER_OPERATIONS]);
    assert.deepEqual(ORDER_TOOLS.map((t) => t.name), [...ORDER_OPERATIONS]);
    assert.ok(!ORDER_TOOLS.some((t) => /mark|approve|refund/u.test(t.name)), "no tool marks a payment or approves a refund");
    for (const forbidden of ["mark_paid", "approve_refund", "confirm_order"]) {
      const r = await w.mcp("tools/call", { name: forbidden, arguments: {} }) as unknown as { error: { code: number } };
      assert.equal(r.error.code, -32602, `there is no ${forbidden}`);
    }
    const listed = await w.mcp("tools/call", { name: "list_items", arguments: { language: "en" } });
    assert.equal((listed.result.structuredContent.items as { price_inr: number }[])[0].price_inr, 120, "the shop's own prices");

    // a refusal is a tool result the assistant can read: an item the menu lacks, too many items, a delivery outside the list
    const bad = async (args: Record<string, unknown>) => (await w.mcp("tools/call", { name: "start_order", arguments: { date: TOMORROW, way: "pickup", slot_id: "lunch", name: "Meera", phone: "+919811111115", language: "en", items: [{ item_id: "veg-thali", qty: 1 }], ...args } })).result.structuredContent as { status: string; reason?: string };
    assert.equal((await bad({ items: [{ item_id: "caviar", qty: 1 }] })).reason, "unknown_item");
    assert.equal((await bad({ items: [{ item_id: "veg-thali", qty: 11 }] })).reason, "too_many_items");
    assert.equal((await bad({ way: "delivery", slot_id: "lunch-home", address: "Marine Drive" })).reason, "outside_area");
    assert.equal((await bad({ way: "delivery", slot_id: "lunch" })).status, undefined, "a pickup slot for a delivery without an address is refused before anything is sent");
    const tooFar = await bad({ date: "2026-12-30" });
    assert.equal(tooFar.reason, "bad_date");

    const started = await w.mcp("tools/call", { name: "start_order", arguments: { items: [{ item_id: "chicken-meal", qty: 2 }], date: TOMORROW, way: "delivery", slot_id: "lunch-home", address: "Flat 4, Kakkanad", name: "Meera", phone: "+919811111114", language: "en" } });
    assert.equal(started.result.isError, false);
    const order = started.result.structuredContent as { handle: string; status: string; total_inr: number; area: string };
    assert.equal(order.status, "held");
    assert.equal(order.total_inr, 320, "2 × ₹160, the shop's price");
    assert.equal(order.area, "Kakkanad", "the place on the shop's list; the address itself stays with the owner");
    assert.ok(!JSON.stringify(order).includes("Flat 4"), "the address as typed is never in an answer");
    const pay = (await w.mcp("tools/call", { name: "payment_instructions", arguments: { handle: order.handle } })).result.structuredContent as { payment: { kind: string; amount_inr: number } };
    assert.deepEqual([pay.payment.kind, pay.payment.amount_inr], ["upi", 160], "the 50% advance, by UPI to the shop");
    const made = w.record().find((e) => e.action === "channel_order" && e.outcome === "confirmed")!;
    assert.ok(made.conversation.startsWith("mcp:") && made.refs.channel === "mcp", "the record names the MCP endpoint");

    // a wrong handle learns nothing; the assistant cancels the held order (nothing was paid, so nothing is owed back)
    const wrong = await w.mcp("tools/call", { name: "order_status", arguments: { handle: "A".repeat(32) } });
    assert.equal(wrong.result.isError, true);
    const cancelled = (await w.mcp("tools/call", { name: "cancel_order", arguments: { handle: order.handle } })).result.structuredContent as { status: string };
    assert.equal(cancelled.status, "cancelled");
    assert.ok(!w.lines.some((l) => l.includes("to +919811111114")), "nothing reached the typed number");
  } finally { await w.done(); }
});

test("the per-number limit holds on the page, and what waits for the owner is the same on their page and in the assistant's \"what needs me\"", async () => {
  const w = await world({ assistant: true });
  try {
    const order = (slot: string, qty: number) => w.api("/orders", { items: [{ item_id: "veg-thali", qty }], date: TOMORROW, way: "pickup", slot_id: slot, name: "Asha", phone: TYPED, language: "en" });
    const first = await (await order("lunch", 1)).json() as { status: string };
    const second = await (await order("dinner", 1)).json() as { status: string };
    const third = await (await order("lunch", 2)).json() as { status: string; reason: string };
    assert.deepEqual([first.status, second.status], ["held", "held"]);
    assert.deepEqual([third.status, third.reason], ["refused", "phone_busy"], "two unpaid orders per typed number");

    const state = await (await w.page(`/o/${w.ownerToken}/api/v1/state`)).json() as { waiting: { kind: string; case: string; amount_paise: number }[] };
    const skill = ordersSkill({ settings: w.settings, store: w.store(), nowMs: () => w.clock.now(), optedOut: () => false });
    assert.deepEqual(skill.waiting().map((i) => [i.kind, i.case, i.amountPaise]).sort(), state.waiting.map((x) => [x.kind, x.case, x.amount_paise]).sort(), "the assistant's list is the owner page's list");
    assert.equal(state.waiting.length, 2, "both advances wait for the owner's mark");
    assert.ok(skill.waiting().every((i) => i.who === "Asha"), "the owner knows the customer by the name they typed");

    // the cases export leaves the shop's volume: a page order's typed number goes only as a fingerprint, and its name and handle not at all (bundle/backup/export.ts)
    const out = join(w.folder, "export");
    const key = join(w.folder, "person-key");
    writeFileSync(key, "0f".repeat(32), { mode: 0o600 });
    const exported = exportShop({ name: "annapurna", db: join(w.folder, "data", "agent.db"), out, personKeyFile: key });
    assert.ok(exported.ok && exported.orders === 2, JSON.stringify(exported));
    const orders = readFileSync(join(out, "orders.json"), "utf8");
    assert.doesNotMatch(orders, /9811111111|Asha|"handle"/u, "no typed number, name or handle in the export");
    assert.match(orders, /"contact":\s*\{\s*"phone":\s*"p-[0-9a-f]+"/u, "the number as a fingerprint, so a person's statement can still find it");
  } finally { await w.done(); }
});
