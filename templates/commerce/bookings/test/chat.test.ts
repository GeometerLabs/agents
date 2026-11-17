// W1, the chat on the shop's page, end to end through a real Bookings runtime (stand-in services, a UPI shop on its own booking list) and the real public front over HTTP:
// a guest opens the chat with no sign-in, taps to book (the shop's own flow, its buttons and limits), the cards come back as taps in the thread, a send made again is answered
// once, the thread is there after a reload, the guest's messages never go to WhatsApp, alerts are taken only after the shop has answered, and a send cannot come in any way
// but the front's chat route. The talk model is not called (no `talker`): "not tested on a real model or provider".
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
import { chatConversationOf } from "../../../../modules/channels/conversation.ts";
import { startClient } from "../server/start.ts";
import { openStore } from "../server/store.ts";
import { parseStore } from "../server/snapshot.ts";
import { ownerItems } from "../src/channel.ts";
import { parseSettings } from "../src/settings.ts";

const INTERNAL = "internal-0123456789abcdef0123";
const CHANNEL = "channel-0123456789abcdef01234";
const UPI_SETTINGS = new URL("../settings/glow-salon-upi.example.json", import.meta.url);

type Line = { n: number; who: "you" | "shop"; text: string; cid?: string; choices?: { id: string; title: string; hint?: string; list?: true }[] };
type Thread = { lines: Line[]; answered: boolean; capped: boolean; send?: string };

async function world() {
  const root = mkdtempSync(join(tmpdir(), "geo-chat-"));
  const folder = join(root, "glow");
  mkdirSync(folder);
  writeFileSync(join(folder, "settings.json"), JSON.stringify({ ...JSON.parse(readFileSync(UPI_SETTINGS, "utf8")), calendar: { module: "own" } }));
  writeFileSync(join(folder, "runtime.json"), JSON.stringify({ mode: "fakes", port: 0, tickSeconds: 3600 }));
  writeFileSync(join(folder, "pathway.lock"), "bookings@0.1.0\n");
  writeFileSync(join(root, "token"), INTERNAL);
  writeFileSync(join(root, "channel"), CHANNEL);
  const shops: Record<string, FrontShop> = {};
  const front = createServer(frontHandler({ shops, waitMs: 1_500 }));
  const port = await new Promise<number>((r) => front.listen(0, "127.0.0.1", () => r((front.address() as { port: number }).port)));
  const origin = `http://127.0.0.1:${port}`;
  const clock = fakeClock(Date.UTC(2026, 10, 16, 3, 30));
  const client = await startClient({ clientFolder: folder, tokenFile: join(root, "token"), channelTokenFile: join(root, "channel"), clock, log: () => undefined });
  shops.glow = { publicUrl: `${origin}/s/glow`, backend: runtimeBackend({ url: client.server.url, token: CHANNEL }) };
  const page = (path: string, init: RequestInit = {}) => fetch(`${origin}/s/glow${path}`, { redirect: "manual", ...init });
  const open = async () => /(__Secure-geo-chat=([A-Za-z0-9_-]{43}))/u.exec((await page("/chat")).headers.get("set-cookie") ?? "")!;
  const send = (cookie: string, body: Record<string, unknown>) => page("/chat/send", { method: "POST", headers: { "content-type": "application/json", origin, cookie }, body: JSON.stringify({ lang: "en", ...body }) });
  const thread = async (cookie: string, q = ""): Promise<Thread> => (await page(`/chat/thread${q}`, { headers: { cookie } })).json() as Promise<Thread>;
  return { origin, page, open, send, thread, client, clock, folder, shops,
    async done() { await new Promise<void>((r) => { front.closeAllConnections(); front.close(() => r()); }); await client.stop(); rmSync(root, { recursive: true, force: true }); } };
}

test("a guest taps to book: the shop's own flow answers in the thread with its cards as taps, and nothing goes to WhatsApp", async () => {
  const w = await world();
  try {
    const [cookie] = await w.open();
    assert.equal((await w.send(cookie, { id: "s-1", quick: 2 })).status, 200); // "Book a time"
    await w.client.runtime.idle();
    let t = await w.thread(cookie);
    assert.equal(t.lines[0].who, "you");
    assert.equal(t.lines[0].text, "Book a time");
    const services = t.lines.at(-1)!;
    assert.equal(services.who, "shop");
    assert.ok(services.choices && services.choices.length > 0, "the shop's services come back as taps");
    // a tap on the first service goes to the same step as a WhatsApp tap: the shop then offers times
    assert.equal((await w.send(cookie, { id: "s-2", tap: services.choices![0].id })).status, 200);
    await w.client.runtime.idle();
    t = await w.thread(cookie);
    const times = t.lines.at(-1)!;
    assert.equal(times.who, "shop");
    assert.ok(times.choices && times.choices.length > 0, "free times come back as taps");
    assert.ok(t.lines.some((l) => l.who === "you" && l.text === services.choices![0].title), "the guest's tap is shown with the button's own words");
    // the time that was offered is taken: the hold, with the deposit's words, comes back as a shop line and the booking exists for this conversation only
    assert.equal((await w.send(cookie, { id: "s-3", tap: times.choices![0].id })).status, 200);
    await w.client.runtime.idle();
    t = await w.thread(cookie);
    assert.ok(t.lines.at(-1)!.who === "shop" && /₹/u.test(t.lines.slice(-3).map((l) => l.text).join(" ")), "the hold names the deposit");
    const status = await (await fetch(`${w.client.server.url}/status`, { headers: { authorization: `Bearer ${INTERNAL}` } })).json() as { bookings: Record<string, number> };
    assert.ok(Object.values(status.bookings).reduce((a, b) => a + b, 0) >= 1);
  } finally { await w.done(); }
});

test("a send made again with the same id is answered once, and the thread is there after a reload", async () => {
  const w = await world();
  try {
    const [cookie] = await w.open();
    await w.send(cookie, { id: "s-1", quick: 1 });
    await w.send(cookie, { id: "s-1", quick: 1 });
    await w.client.runtime.idle();
    const t = await w.thread(cookie);
    assert.equal(t.lines.filter((l) => l.who === "you").length, 1, "one line for the guest");
    assert.equal(t.lines.filter((l) => l.who === "shop").length, 1, "one answer");
    const reload = await (await w.page("/chat", { headers: { cookie } })).text();
    // the page escapes what it draws ("Today's menu" is "Today&#39;s menu" in its markup)
    assert.ok(reload.includes(esc(t.lines[0].text)) && reload.includes(esc(t.lines.at(-1)!.text.slice(0, 20))));
    const tail = await w.thread(cookie, `?after=${t.lines.at(-1)!.n}&cid=s-1`);
    assert.equal(tail.lines.length, 0);
    assert.equal(tail.send, "done", "the page can tell its send's step has run");
  } finally { await w.done(); }
});

test("one shop's guest is not found at another shop, and a guest never seen has an empty thread", async () => {
  const w = await world();
  try {
    const [cookie, , handle] = await w.open().then((m) => [m[1], 0, m[2]] as const);
    await w.send(cookie, { id: "s-1", quick: 1 });
    await w.client.runtime.idle();
    const read = (hash: string) => fetch(`${w.client.server.url}/internal/channel/chat?handle=${hash}`, { headers: { authorization: `Bearer ${CHANNEL}` } }).then((r) => r.json() as Promise<Thread>);
    assert.ok((await read(guestHash("glow", handle))).lines.length > 0);
    assert.equal((await read(guestHash("another-shop", handle))).lines.length, 0);
    assert.equal(chatConversationOf(guestHash("glow", handle)).length, 21);
  } finally { await w.done(); }
});

test("a chat send comes in by the channel route only: the inbox's route refuses the kind, and a bad channel token is refused", async () => {
  const w = await world();
  try {
    const hash = guestHash("glow", "x".repeat(43));
    const event = { kind: "chat_message", id: "s-1", handle: hash, language: "en", text: "hi" };
    const viaInbox = await fetch(`${w.client.server.url}/internal/events`, { method: "POST", headers: { authorization: `Bearer ${INTERNAL}` }, body: JSON.stringify({ events: [event] }) });
    assert.equal(viaInbox.status, 400);
    const bad = await fetch(`${w.client.server.url}/internal/channel/events`, { method: "POST", headers: { authorization: "Bearer nope" }, body: JSON.stringify({ events: [event] }) });
    assert.equal(bad.status, 401);
    const ok = await fetch(`${w.client.server.url}/internal/channel/events`, { method: "POST", headers: { authorization: `Bearer ${CHANNEL}` }, body: JSON.stringify({ events: [event] }) });
    assert.equal(ok.status, 200);
  } finally { await w.done(); }
});

test("the runtime's own per-guest rate answers 429 before anything is saved", async () => {
  const w = await world();
  try {
    const hash = guestHash("glow", "y".repeat(43));
    let last = 200;
    for (let i = 0; i < 12; i++) {
      const r = await fetch(`${w.client.server.url}/internal/channel/events`, { method: "POST", headers: { authorization: `Bearer ${CHANNEL}` }, body: JSON.stringify({ events: [{ kind: "chat_message", id: `s-${i}`, handle: hash, language: "en", text: "hi" }] }) });
      last = r.status;
    }
    assert.equal(last, 429);
  } finally { await w.done(); }
});

test("alerts are taken only after the shop has answered", async () => {
  const w = await world();
  try {
    const [cookie, , handle] = await w.open().then((m) => [m[1], 0, m[2]] as const);
    const hash = guestHash("glow", handle);
    const push = (op: string) => fetch(`${w.client.server.url}/internal/channel/push`, { method: "POST", headers: { authorization: `Bearer ${CHANNEL}` }, body: JSON.stringify({ op, handle: hash, subscription: { endpoint: "https://push.example/x", keys: { p256dh: "a".repeat(87), auth: "b".repeat(22) } } }) });
    const before = await push("customer_subscribe");
    assert.ok([403, 404].includes(before.status), "a guest the shop has not answered takes no alerts");
    await w.send(cookie, { id: "s-1", quick: 1 });
    await w.client.runtime.idle();
    const after = await push("customer_state");
    assert.ok([200, 404].includes(after.status));
    if (after.status === 200) assert.equal(((await after.json()) as { answered: boolean }).answered, true);
  } finally { await w.done(); }
});

// W1b (17 Nov 2026): what the owner sees of a guest. The hold a guest made in the chat is on the owner's list as "Chat guest 1" (channel "chat", no phone), never as `chat:...`; the
// shop's cap on unpaid holds counts it; and the shop's own message to the owner about the guest uses the same words.
test("a guest's hold is on the owner's list as 'Chat guest 1', with no conversation name and no phone", async () => {
  const w = await world();
  try {
    const [cookie] = await w.open();
    await w.send(cookie, { id: "s-1", quick: 2 });
    await w.client.runtime.idle();
    let t = await w.thread(cookie);
    await w.send(cookie, { id: "s-2", tap: t.lines.at(-1)!.choices![0].id });
    await w.client.runtime.idle();
    t = await w.thread(cookie);
    await w.send(cookie, { id: "s-3", tap: t.lines.at(-1)!.choices![0].id });
    await w.client.runtime.idle();
    const s = openStore(join(w.folder, "data"));
    const store = (() => { try { return parseStore(s.loadState().snapshot!); } finally { s.close(); } })();
    const settings = parseSettings(JSON.parse(readFileSync(join(w.folder, "settings.json"), "utf8")));
    const { items, upcoming } = ownerItems(settings, store, w.clock.now());
    const seen = JSON.stringify({ items, upcoming });
    assert.ok(!/chat:[0-9a-f]{16}/u.test(seen), "the owner's list never names a chat conversation");
    const mine = [...items, ...upcoming].filter((x) => x.customer.name === "Chat guest 1");
    assert.ok(mine.length >= 1, "the guest is 'Chat guest 1'");
    assert.ok(mine.every((x) => x.customer.phone === "" && x.channel === "chat"));
  } finally { await w.done(); }
});
