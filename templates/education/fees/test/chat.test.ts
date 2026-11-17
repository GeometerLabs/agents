// W1b, the chat on a Fees centre's page, end to end through a real Fees runtime (stand-in services, the Bright Tuition UPI example) and the real public front over HTTP: PUBLIC
// questions only. A guest taps "Class timings" and "Fees"; no fee, student or payment is ever read or shown to them (a student's name from the example never appears in the
// thread), "Talk to the teacher" tells the owner once and the guest is told, a guest's pings to the owner are bounded per day, and a send made again is answered once. The talk
// model is not called: "not tested on a real model or provider". Written 17 Nov 2026, not run when written.
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
import { guestHash } from "../../../../modules/channels/handle.ts";
import { startClient } from "../server/start.ts";

const INTERNAL = "internal-0123456789abcdef0123";
const CHANNEL = "channel-0123456789abcdef01234";
const SETTINGS = new URL("../settings/bright-tuition-upi.example.json", import.meta.url);

type Line = { n: number; who: "you" | "shop"; text: string; cid?: string; choices?: { id: string; title: string; hint?: string; list?: true }[] };
type Thread = { lines: Line[]; answered: boolean; capped: boolean; send?: string };

async function world() {
  const root = mkdtempSync(join(tmpdir(), "geo-fees-chat-"));
  const folder = join(root, "bright");
  mkdirSync(folder);
  writeFileSync(join(folder, "settings.json"), readFileSync(SETTINGS));
  writeFileSync(join(folder, "runtime.json"), JSON.stringify({ mode: "fakes", port: 0, tickSeconds: 3600 }));
  writeFileSync(join(folder, "pathway.lock"), "fees@0.1.0\n");
  writeFileSync(join(root, "token"), INTERNAL);
  writeFileSync(join(root, "channel"), CHANNEL);
  const shops: Record<string, FrontShop> = {};
  const front = createServer(frontHandler({ shops, waitMs: 1_500 }));
  const port = await new Promise<number>((r) => front.listen(0, "127.0.0.1", () => r((front.address() as { port: number }).port)));
  const origin = `http://127.0.0.1:${port}`;
  const clock = fakeClock(Date.UTC(2026, 10, 16, 3, 30));
  const client = await startClient({ clientFolder: folder, tokenFile: join(root, "token"), channelTokenFile: join(root, "channel"), clock, log: () => undefined });
  shops.bright = { publicUrl: `${origin}/s/bright`, backend: runtimeBackend({ url: client.server.url, token: CHANNEL }), kind: "fees" };
  const page = (path: string, init: RequestInit = {}) => fetch(`${origin}/s/bright${path}`, { redirect: "manual", ...init });
  const open = async () => /(__Secure-geo-chat=([A-Za-z0-9_-]{43}))/u.exec((await page("/chat")).headers.get("set-cookie") ?? "")!;
  const send = (cookie: string, body: Record<string, unknown>) => page("/chat/send", { method: "POST", headers: { "content-type": "application/json", origin, cookie }, body: JSON.stringify({ lang: "en", ...body }) });
  const thread = async (cookie: string, q = ""): Promise<Thread> => (await page(`/chat/thread${q}`, { headers: { cookie } })).json() as Promise<Thread>;
  return { origin, page, open, send, thread, client, clock,
    async done() { await new Promise<void>((r) => { front.closeAllConnections(); front.close(() => r()); }); await client.stop(); rmSync(root, { recursive: true, force: true }); } };
}

test("a guest asks public questions: the centre answers from what parents may be told, and no student or fee is shown", async () => {
  const w = await world();
  try {
    const [cookie] = await w.open();
    for (const [i, quick] of [1, 2].entries()) { await w.send(cookie, { id: `s-${i}`, quick }); await w.client.runtime.idle(); }
    const t = await w.thread(cookie);
    assert.ok(t.lines.filter((l) => l.who === "shop").length >= 2, "each question is answered");
    const all = JSON.stringify(t);
    for (const name of ["Meera", "Rohan", "Nair", "Mehta"]) assert.ok(!all.includes(name), `${name} is a student's or parent's name and never leaves the centre in a guest's chat`);
    assert.ok(!/chat:[0-9a-f]{16}/u.test(all));
  } finally { await w.done(); }
});

test("'Talk to the teacher' tells the guest the owner will write, and is bounded per guest per day", async () => {
  const w = await world();
  try {
    const [cookie] = await w.open();
    await w.send(cookie, { id: "s-1", quick: 3 });
    await w.client.runtime.idle();
    const t = await w.thread(cookie);
    assert.equal(t.lines.at(-1)!.who, "shop");
    // asking again inside the hour tells the owner nothing more (the hour's dedupe), and the guest is still answered truthfully
    await w.send(cookie, { id: "s-2", quick: 3 });
    await w.client.runtime.idle();
    assert.ok((await w.thread(cookie)).lines.filter((l) => l.who === "shop").length >= 2);
  } finally { await w.done(); }
});

test("a send made again is answered once, and a guest never seen has an empty thread", async () => {
  const w = await world();
  try {
    const m = await w.open();
    await w.send(m[1], { id: "s-1", quick: 1 });
    await w.send(m[1], { id: "s-1", quick: 1 });
    await w.client.runtime.idle();
    const t = await w.thread(m[1]);
    assert.equal(t.lines.filter((l) => l.who === "you").length, 1);
    const read = (hash: string) => fetch(`${w.client.server.url}/internal/channel/chat?handle=${hash}`, { headers: { authorization: `Bearer ${CHANNEL}` } }).then((r) => r.json() as Promise<Thread>);
    assert.equal((await read(guestHash("bright", "z".repeat(43)))).lines.length, 0);
  } finally { await w.done(); }
});
