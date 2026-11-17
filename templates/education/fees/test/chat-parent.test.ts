// W2, a parent's chat on their private fee page (17 Nov 2026), through a real Fees runtime (stand-in services, a UPI centre with a pages file) and the real public front over HTTP.
// What it shows: the chat opened from a parent's own link talks about THAT parent's open fees and no other parent's (nor a student's name beyond their own children's, nor a number);
// nothing goes to WhatsApp and no payment link is made from it; the same chat is there after a new link; a made-up link opens nothing; a public guest on the same centre still gets the
// public line and no fee at all; and the talk's own read (assistant.ts publicContext) is given only that parent's open fee as "their child". Written 17 Nov, not run when written.
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
import { chatConversationOf } from "../../../../modules/channels/conversation.ts";
import { parentChatHash } from "../../../../modules/channels/handle.ts";
import { openStore } from "../server/store.ts";
import { parseStore } from "../server/snapshot.ts";
import { startClient } from "../server/start.ts";
import { feesSkill } from "../src/assistant.ts";
import { parentOfChat, parentRef } from "../src/channel.ts";
import { openDues } from "../src/due.ts";
import { parseSettings } from "../src/settings.ts";

const INTERNAL = "internal-0123456789abcdef0123";
const CHANNEL = "channel-0123456789abcdef01234";
const SETTINGS = new URL("../settings/bright-tuition-upi.example.json", import.meta.url);
const SHARMA = "+919811111111"; // Aarav and Anaya's parent
const NAIR = "+919822222222"; // Meera's parent
const PAGE_BASE = "https://partners.example/s/bright";
const FIRST_REMINDER = zonedToMs({ year: 2026, month: 11, day: 2 }, { hour: 10, minute: 0 }, "Asia/Kolkata");

async function world() {
  const root = mkdtempSync(join(tmpdir(), "geo-fees-chat-"));
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
  const client = await startClient({ clientFolder: folder, tokenFile: join(root, "token"), channelTokenFile: join(root, "channel"), clock, log: (l) => lines.push(l) });
  shops.bright = { publicUrl: `${origin}/s/bright`, backend: runtimeBackend({ url: client.server.url, token: CHANNEL }), kind: "fees" };
  const get = (path: string, headers: Record<string, string> = {}) => fetch(`${origin}/s/bright${path}`, { redirect: "manual", headers });
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) => fetch(`${origin}/s/bright${path}`, { method: "POST", redirect: "manual", headers: { "content-type": "application/json", origin, ...headers }, body: JSON.stringify(body) });
  const store = () => { const s = openStore(join(folder, "data")); try { return parseStore(s.loadState().snapshot!); } finally { s.close(); } };
  /** The links sent to a parent so far, read out of the stand-in WhatsApp's lines. */
  const linksTo = (parent: string): string[] => lines.filter((l) => l.startsWith(`[stand-in WhatsApp] to ${parent}:`)).flatMap((l) => [...l.matchAll(/https:\/\/partners\.example\/s\/bright\/f\/([A-Za-z0-9_-]{32})/gu)].map((m) => m[1]!));
  const toParent = (parent: string): number => lines.filter((l) => l.startsWith(`[stand-in WhatsApp] to ${parent}:`)).length;
  return {
    origin, get, post, store, lines, linksTo, toParent, settings: parseSettings(settings), client,
    async tickAt(ms: number) { clock.set(ms); await client.runtime.tick(); await client.runtime.idle(); },
    async done() { await new Promise<void>((r) => { front.closeAllConnections(); front.close(() => r()); }); await client.stop(); rmSync(root, { recursive: true, force: true }); },
  };
}

type Thread = { lines: { who: string; text: string }[] };
/** A parent writes in their chat, the runtime's queue runs, and the thread is read back. */
async function ask(w: Awaited<ReturnType<typeof world>>, link: string, text: string, id: string): Promise<Thread> {
  const sent = await w.post(`/f/${link}/chat/send`, { id, text, lang: "en" });
  assert.equal(sent.status, 200);
  await w.client.runtime.idle();
  return await (await w.get(`/f/${link}/chat/thread`)).json() as Thread;
}
const shopText = (t: Thread) => t.lines.filter((l) => l.who === "shop").map((l) => l.text).join("\n");

test("a parent's chat talks about that parent's own open fees only; nothing goes to WhatsApp and no payment link is made", async () => {
  const w = await world();
  try {
    await w.tickAt(FIRST_REMINDER - 3_600_000); // the first beat: nothing is due yet
    await w.tickAt(FIRST_REMINDER);
    const [sharma] = w.linksTo(SHARMA); const [nair] = w.linksTo(NAIR);
    assert.ok(sharma && nair && sharma !== nair);
    const whatsappBefore = [w.toParent(SHARMA), w.toParent(NAIR)];

    const mine = await ask(w, sharma, "what do I owe", "p-1");
    const said = shopText(mine);
    assert.match(said, /Aarav/u, "their own child, by name, in their own private chat");
    assert.match(said, /Anaya/u);
    assert.doesNotMatch(said, /Meera|Rohan|Kiran/u, "nobody else's child");
    assert.doesNotMatch(said, /https?:\/\//u, "no payment link is made in the chat: paying is the fee page's own box");
    assert.doesNotMatch(said, /9198222|9198444|9198333/u, "no other parent's number");
    assert.deepEqual([w.toParent(SHARMA), w.toParent(NAIR)], whatsappBefore, "nothing went to WhatsApp");

    const hers = await ask(w, nair, "fees", "p-2");
    assert.match(shopText(hers), /Meera/u);
    assert.doesNotMatch(shopText(hers), /Aarav|Anaya|Rohan|Kiran/u);
    assert.deepEqual(mine.lines.filter((l) => l.who === "you").map((l) => l.text), ["what do I owe"], "the two threads are two threads");

    // the parent's own words reach the owner by the parent's number, and the answer comes back in the chat
    const owner = await ask(w, sharma, "talk to the owner", "p-3");
    assert.match(shopText(owner), /owner/iu);
  } finally { await w.done(); }
});

test("a new link finds the same chat (the thread is the parent's, not the link's); a made-up link opens nothing", async () => {
  const w = await world();
  try {
    await w.tickAt(FIRST_REMINDER - 3_600_000);
    await w.tickAt(FIRST_REMINDER);
    const [sharma] = w.linksTo(SHARMA);
    const before = await ask(w, sharma!, "what do I owe", "p-1");
    const store = w.store();
    const parent = Object.keys(store.parentLinks ?? {}).find((p) => p === SHARMA)!;
    assert.equal(parentOfChat(store, chatConversationOf(parentChatHash(parentRef(parent)))), SHARMA);
    assert.equal((await w.get(`/f/${"Z".repeat(32)}/chat`)).status, 404);
    assert.equal((await w.get(`/f/${"Z".repeat(32)}/chat/thread`)).status, 404);
    assert.equal((await w.post(`/f/${"Z".repeat(32)}/chat/send`, { id: "p-9", text: "hi", lang: "en" })).status, 404);
    assert.ok(before.lines.length >= 2);
  } finally { await w.done(); }
});

test("a public guest on the same centre still gets the public line and no fee, no student and no number", async () => {
  const w = await world();
  try {
    await w.tickAt(FIRST_REMINDER - 3_600_000);
    await w.tickAt(FIRST_REMINDER);
    const open = await w.get("/chat?lang=en");
    const cookie = /(__Secure-geo-chat=[A-Za-z0-9_-]{43})/u.exec(open.headers.get("set-cookie") ?? "")![1]!;
    assert.equal((await w.post("/chat/send", { id: "g-1", text: "what is the fee for Aarav", lang: "en" }, { cookie })).status, 200);
    await w.client.runtime.idle();
    const thread = await (await w.get("/chat/thread", { cookie })).json() as Thread;
    const said = shopText(thread);
    assert.match(said, /This chat answers questions about the centre/u);
    assert.doesNotMatch(said, /Aarav|Anaya|Meera|Rohan|Kiran|₹|\+91/u);
  } finally { await w.done(); }
});

test("the talk's own read for a parent's chat is that parent's open fee only, as 'their child' (no student's name), and a public guest's has none", async () => {
  const w = await world();
  try {
    await w.tickAt(FIRST_REMINDER - 3_600_000);
    await w.tickAt(FIRST_REMINDER);
    const store = w.store();
    const skill = feesSkill({ settings: w.settings, store, nowMs: () => FIRST_REMINDER, optedOut: () => false });
    const conversationOf = (parent: string) => chatConversationOf(parentChatHash(parentRef(parent)));
    const caseOf = (parent: string) => skill.publicContext!(conversationOf(parent), FIRST_REMINDER).sources.find((s) => s.id === "r:case");
    const sharmaDue = openDues(store, SHARMA)[0]!; const nairDue = openDues(store, NAIR)[0]!;
    assert.ok(caseOf(SHARMA)!.text.includes(sharmaDue.id) && !caseOf(SHARMA)!.text.includes(nairDue.id));
    assert.ok(caseOf(NAIR)!.text.includes(nairDue.id) && !caseOf(NAIR)!.text.includes(sharmaDue.id));
    assert.doesNotMatch(caseOf(SHARMA)!.text, /Aarav|Anaya/u, "the model is told 'their child', never a name");
    assert.equal(skill.publicContext!(chatConversationOf("0".repeat(64)), FIRST_REMINDER).sources.find((s) => s.id === "r:case"), undefined, "a public guest has no fee in the talk's read");
  } finally { await w.done(); }
});
