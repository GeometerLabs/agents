// Measures the directory service from the outside, on the same machine and the same data: cold start (spawn until /healthz answers, on a fresh folder), idle resident memory with 40 fake
// shops of 20 listings each read, memory after 200 searches, and the latency of 300 searches (shops answering at once). Not a test: it prints one JSON line.
//
//   node modules/discovery/contract/measure.ts      (the binary at DIRECTORY_GO_BIN, default go/bin/directory; the TypeScript service it was compared with is gone)
//
// RSS comes from `ps -o rss=` (the service's own process). The requests are made one after another by Node's fetch, the same client for both runtimes.
import { execFileSync } from "node:child_process";
import { IMPL, fakeShop, item, makeDirectory, sleep, startFakeDoor, until } from "./harness.ts";

const rssMb = (pid: number): number => Number(execFileSync("ps", ["-o", "rss=", "-p", String(pid)]).toString().trim()) / 1024;
const pct = (xs: number[], p: number): number => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
const shops = Array.from({ length: 40 }, (_, i) => {
  const s = fakeShop(`shop-${i}`, { name: `Shop ${i}`, town: i % 2 ? "Thrissur" : "Kochi", lat: String(9.9 + i / 50), lon: "76.2" });
  s.items = Array.from({ length: 20 }, (_, j) => item(s.page, `i-${j}`, { title: { en: `Kitten number ${j}`, ml: "പൂച്ചക്കുട്ടി", hi: "बिल्ली" }, category: j % 3 ? "pets" : "home" }));
  return s;
});
const door = await startFakeDoor(...shops);
const out: Record<string, unknown> = { impl: IMPL, shops: shops.length, items: shops.length * 20 };
const starts: number[] = [];
for (let i = 0; i < 5; i++) {
  const d = await makeDirectory({ door, feeds: [] });
  const t = performance.now(); await d.start(); starts.push(performance.now() - t); await d.stop();
}
out.coldStartFreshMs = { median: pct(starts, 50), min: Math.min(...starts), max: Math.max(...starts) };
const d = await makeDirectory({ door, feeds: shops.map((s) => s.feedUrl) });
await d.start();
await until("every feed read", () => (d.db().prepare("SELECT COUNT(*) AS n FROM feeds WHERE checked_at IS NOT NULL").get() as { n: number }).n === shops.length, 60_000);
await sleep(1500);
const pid = d.pid()!;
out.rssIdleMb = rssMb(pid);
const who = d.visitor();
const search = (i: number) => d.call(`/search?format=json&q=${["kitten", "പൂച്ച", "billi", "pets"][i % 4]}&lat=10.5&lon=76.2`, { who: `${who}-${i}` });
for (let i = 0; i < 200; i++) await search(i);
await sleep(500);
out.rssAfter200SearchesMb = rssMb(pid);
const ms: number[] = [];
for (let i = 0; i < 300; i++) { const t = performance.now(); await search(1000 + i); ms.push(performance.now() - t); }
out.searchMs = { p50: pct(ms, 50), p95: pct(ms, 95), max: Math.max(...ms) };
await sleep(300);
out.rssAfterLoadMb = rssMb(pid);
await d.stop();
await door.close();
console.log(JSON.stringify(out));
