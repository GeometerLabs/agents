// Measures a listings-only runtime from the outside, on the same machine and the same kind of shop folder: cold start, resident memory (idle, after 50 warm-up requests, with 200
// listings), and the latency of 500 feed and 500 check requests. Not a test: it prints one JSON line.
//
//   LISTINGS_IMPL=ts node templates/commerce/listings/contract/measure.ts
//   LISTINGS_IMPL=go node templates/commerce/listings/contract/measure.ts
//
// RSS comes from `ps -o rss=` (kilobytes of resident memory of the shop's own process). The requests are made one after another over one keep-alive connection by Node's fetch, the
// same client for both runtimes, so the client's own cost is the same on both sides.
import { execFileSync } from "node:child_process";
import { IMPL, PAGE, makeShop } from "./harness.ts";
import type { Shop } from "./harness.ts";

const pidOf = (s: Shop): number => s.pid()!;
const rssMb = (pid: number): number => Number(execFileSync("ps", ["-o", "rss=", "-p", String(pid)]).toString().trim()) / 1024;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pct = (xs: number[], p: number): number => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };

async function timed(n: number, f: () => Promise<unknown>): Promise<{ p50: number; p95: number; max: number; mean: number }> {
  const ms: number[] = [];
  for (let i = 0; i < n; i++) { const t = performance.now(); await f(); ms.push(performance.now() - t); }
  return { p50: pct(ms, 50), p95: pct(ms, 95), max: Math.max(...ms), mean: ms.reduce((a, b) => a + b, 0) / ms.length };
}

const out: Record<string, unknown> = { impl: IMPL };
const op = async (s: Shop, id: string, body: Record<string, unknown>) => { const r = await s.call("/internal/channel/owner-listing", { owner: s.owner, body: { id, op: body } }); if (r.status !== 200) throw new Error(JSON.stringify(r.body)); };

// cold start: the process spawned until /healthz answers, on a fresh folder (the store is made) and on a used one, five times each
const starts: number[] = [];
for (let i = 0; i < 5; i++) { const s = await makeShop(); const t = performance.now(); await s.start(); starts.push(performance.now() - t); await s.stop(); s.cleanup(); }
out.coldStartFreshMs = { median: pct(starts, 50), min: Math.min(...starts), max: Math.max(...starts) };

const s = await makeShop();
const t0 = performance.now();
await s.start();
out.firstStartMs = performance.now() - t0;
await sleep(1500);
const pid = pidOf(s);
out.rssIdleMb = rssMb(pid);
const feed = () => s.call("/internal/channel/shop-feed", { body: { page: PAGE, name: "Glow Pets", languages: ["en"] } });
const check = () => s.call("/internal/channel/shop-check", { body: { page: PAGE, ids: ["l-1", "l-2", "l-3"] } });
const owner = () => s.call("/internal/channel/owner-listing", { owner: s.owner });
await op(s, "sw", { op: "shop", visible: true, town: "Thrissur" });
await s.settle();
for (let i = 0; i < 17; i++) { await feed(); await check(); await owner(); }   // 51 requests
await sleep(500);
out.rssAfter50Mb = rssMb(pid);
// 200 listings in the store: 50 live at a time (the shop's own limit), each lot sold and the next published
let n = 0;
for (let lot = 0; lot < 4; lot++) {
  for (let i = 0; i < 50; i++) { n += 1; await op(s, `p-${n}`, { op: "publish_form", category: "home", title: `Brass lamp number ${n}`, priceInr: 450 + n, qty: 3, photos: [] }); }
  await s.settle();
  if (lot < 3) { for (let i = 0; i < 50; i++) await op(s, `s-${n - 49 + i}`, { op: "sold", id: `l-${n - 49 + i}` }); await s.settle(); }
}
const v = (await owner()).body;
out.listingsInStore = n; out.liveListings = v.liveCount;
await sleep(500);
out.rssWith200Mb = rssMb(pid);
out.feedMs = await timed(500, feed);
out.checkMs = await timed(500, check);
out.ownerListMs = await timed(200, owner);
await sleep(300);
out.rssAfterLoadMb = rssMb(pid);
out.feedBytes = (await feed()).bytes.length;
await s.stop(); s.cleanup();
console.log(JSON.stringify(out));
