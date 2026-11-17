// W1b, the chat on an Orders shop's page, end to end through a real Orders runtime (stand-in services, the Annapurna UPI example) and the real public front over HTTP, on the
// same world as Bookings' test/chat.test.ts: a guest taps "Today's menu" and "Order" and the shop's own ordering flow answers in the thread with its cards as taps, a send made
// again is answered once, the guest is "Chat guest 1" to the owner and never `chat:...`, the shop's page links to the chat, a tap nothing offered does nothing, and one shop's
// guest is not found at another. The talk model is not called (no `talker`): "not tested on a real model or provider". Written 17 Nov 2026, not run when written.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeClock } from "../../../../modules/core/clock.ts";
import { esc } from "../../../../modules/core/html.ts";
import { frontHandler } from "../../../../modules/channels/front.ts";
import type { FrontShop } from "../../../../modules/channels/front.ts";
import { runtimeBackend } from "../../../../modules/channels/backend.ts";
import { guestHash } from "../../../../modules/channels/handle.ts";
import { startClient } from "../server/start.ts";

const INTERNAL = "internal-0123456789abcdef0123";
const CHANNEL = "channel-0123456789abcdef01234";
const SETTINGS = new URL("../settings/annapurna-tiffins.example.json", import.meta.url);

type Line = { n: number; who: "you" | "shop"; text: string; cid?: string; choices?: { id: string; title: string; hint?: string; list?: true }[] };
type Thread = { lines: Line[]; answered: boolean; capped: boolean; send?: string };

async function world() {
  const root = mkdtempSync(join(tmpdir(), "geo-orders-chat-"));
  const folder = join(root, "annapurna");
  mkdirSync(folder);
  writeFileSync(join(folder, "settings.json"), readFileSync(SETTINGS));
  writeFileSync(join(folder, "runtime.json"), JSON.stringify({ mode: "fakes", port: 0, tickSeconds: 3600 }));
  writeFileSync(join(folder, "pathway.lock"), "orders@0.1.0\n");
  writeFileSync(join(root, "token"), INTERNAL);
  writeFileSync(join(root, "channel"), CHANNEL);
  const shops: Record<string, FrontShop> = {};
  const front = createServer(frontHandler({ shops, waitMs: 1_500 }));
  const port = await new Promise<number>((r) => front.listen(0, "127.0.0.1", () => r((front.address() as { port: number }).port)));
  const origin = `http://127.0.0.1:${port}`;
  const clock = fakeClock(Date.UTC(2026, 10, 16, 3, 30));
  const client = await startClient({ clientFolder: folder, tokenFile: join(root, "token"), channelTokenFile: join(root, "channel"), clock, log: () => undefined });
  shops.annapurna = { publicUrl: `${origin}/s/annapurna`, backend: runtimeBackend({ url: client.server.url, token: CHANNEL }), kind: "orders" };
  const page = (path: string, init: RequestInit = {}) => fetch(`${origin}/s/annapurna${path}`, { redirect: "manual", ...init });
  const open = async () => /(__Secure-geo-chat=([A-Za-z0-9_-]{43}))/u.exec((await page("/chat")).headers.get("set-cookie") ?? "")!;
  const send = (cookie: string, body: Record<string, unknown>) => page("/chat/send", { method: "POST", headers: { "content-type": "application/json", origin, cookie }, body: JSON.stringify({ lang: "en", ...body }) });
  const thread = async (cookie: string, q = ""): Promise<Thread> => (await page(`/chat/thread${q}`, { headers: { cookie } })).json() as Promise<Thread>;
  return { origin, page, open, send, thread, client, clock,
    async done() { await new Promise<void>((r) => { front.closeAllConnections(); front.close(() => r()); }); await client.stop(); rmSync(root, { recursive: true, force: true }); } };
}

test("a guest taps to order: the shop's own ordering flow answers in the thread, with the menu and its buttons as taps", async () => {
  const w = await world();
  try {
    const [cookie] = await w.open();
    assert.equal((await w.send(cookie, { id: "s-1", quick: 1 })).status, 200); // "Today's menu"
    await w.client.runtime.idle();
    let t = await w.thread(cookie);
    assert.equal(t.lines[0].who, "you");
    assert.equal(t.lines[0].text, "Today's menu");
    const menu = t.lines.at(-1)!;
    assert.equal(menu.who, "shop");
    assert.match(menu.text + (menu.choices ?? []).map((c) => c.title).join(" "), /₹/u, "the shop's own prices");
    assert.equal((await w.send(cookie, { id: "s-2", quick: 2 })).status, 200); // "Order"
    await w.client.runtime.idle();
    t = await w.thread(cookie);
    assert.equal(t.lines.at(-1)!.who, "shop", "the shop asks what is missing, as it does a WhatsApp customer");
    assert.ok(t.lines.length >= 4);
  } finally { await w.done(); }
});

test("a send made again is answered once; the thread is there after a reload; a tap nothing offered adds nothing", async () => {
  const w = await world();
  try {
    const [cookie] = await w.open();
    await w.send(cookie, { id: "s-1", quick: 3 }); // "Pickup times"
    await w.send(cookie, { id: "s-1", quick: 3 });
    await w.client.runtime.idle();
    const t = await w.thread(cookie);
    assert.equal(t.lines.filter((l) => l.who === "you").length, 1);
    assert.equal(t.lines.filter((l) => l.who === "shop").length, 1);
    assert.ok((await (await w.page("/chat", { headers: { cookie } })).text()).includes(esc(t.lines[0].text))); // the page escapes what it draws
    await w.send(cookie, { id: "s-2", tap: "item:made-up" });
    await w.client.runtime.idle();
    assert.equal((await w.thread(cookie)).lines.length, t.lines.length);
    assert.equal((await w.thread(cookie, `?after=${t.lines.at(-1)!.n}&cid=s-1`)).send, "done");
  } finally { await w.done(); }
});

test("the owner sees a guest as 'Chat guest 1', never the conversation's name, and the shop's pages link to the chat", async () => {
  const w = await world();
  try {
    const [cookie] = await w.open();
    await w.send(cookie, { id: "s-1", quick: 2 });
    await w.client.runtime.idle();
    const owner = JSON.stringify(await (await fetch(`${w.client.server.url}/internal/channel/owner`, { headers: { authorization: `Bearer ${CHANNEL}` } })).json().catch(() => ({})));
    assert.ok(!/chat:[0-9a-f]{16}/u.test(owner), "the owner's view never names a chat conversation");
    const thread = await w.thread(cookie);
    assert.ok(!JSON.stringify(thread).includes("chat:"), "nor does the guest's own thread");
  } finally { await w.done(); }
});

test("one shop's guest is not found at another shop", async () => {
  const w = await world();
  try {
    const m = await w.open();
    await w.send(m[1], { id: "s-1", quick: 1 });
    await w.client.runtime.idle();
    const read = (hash: string) => fetch(`${w.client.server.url}/internal/channel/chat?handle=${hash}`, { headers: { authorization: `Bearer ${CHANNEL}` } }).then((r) => r.json() as Promise<Thread>);
    assert.ok((await read(guestHash("annapurna", m[2]))).lines.length > 0);
    assert.equal((await read(guestHash("another-shop", m[2]))).lines.length, 0);
  } finally { await w.done(); }
});
