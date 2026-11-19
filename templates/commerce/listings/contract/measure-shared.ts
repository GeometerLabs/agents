// Measures the Go SHARED process (many listings-only shops in one process): cold start to /readyz (the process answers; the first look at the folders may still be going), cold start
// until every shop is held, and the process's resident memory after the start and after a few requests per shop. Not a test: it prints a table. (Until 19 Nov 2026 it measured the
// TypeScript shared process beside it, decision 61's figures; that runtime was deleted in wave 1b.)
//
//   node templates/commerce/listings/contract/measure-shared.ts           N = 1, 10, 100, one process at a time
//   node templates/commerce/listings/contract/measure-shared.ts 10        one size
//
// RSS is `ps -o rss=` of the shared process itself (a child process of a quarantined shop would not be counted, and none is made here). The load is light on purpose: three requests
// per shop, one after another.
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { haveGo, makeRoot, startHost, writeShop } from "./shared-harness.ts";
import type { ShopFolder } from "./shared-harness.ts";

const rssMb = (pid: number): number => Number(execFileSync("ps", ["-o", "rss=", "-p", String(pid)]).toString().trim()) / 1024;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function cell(n: number) {
  const root = makeRoot();
  const shops: Record<string, ShopFolder> = {};
  for (let i = 0; i < n; i++) { const name = `shop-${String(i).padStart(3, "0")}`; shops[name] = writeShop(root, name); }
  const host = await startHost(root, { shops, expect: n, scanSeconds: 30 });
  try {
    await sleep(1000);
    const afterStart = rssMb(host.pid);
    for (const name of Object.keys(shops)) {
      await host.call(name, "/readyz");
      await host.call(name, "/internal/channel/listings");
      await host.call(name, "/status");
    }
    await sleep(1000);
    return { impl: "go", shops: n, coldToReadyzMs: Math.round(host.readyMs), coldToAllHeldMs: Math.round(host.heldMs), rssAfterStartMb: Math.round(afterStart), rssAfterRequestsMb: Math.round(rssMb(host.pid)) };
  } finally { await host.stop(); rmSync(root.dir, { recursive: true, force: true }); }
}

const [nArg] = process.argv.slice(2);
const sizes = nArg ? [Number(nArg)] : [1, 10, 100];
const rows = [];
if (!haveGo()) { console.error("go/bin/listings-shared is not built (cd go && go build -o bin/listings-shared ./cmd/listings-shared)"); process.exit(1); }
for (const n of sizes) {
  const r = await cell(n);
  rows.push(r);
  console.log(JSON.stringify(r));
}
console.log("\nimpl  shops  cold to /readyz (ms)  cold to all shops held (ms)  RSS after start (MB)  RSS after requests (MB)");
for (const r of rows) console.log(`${r.impl.padEnd(4)}  ${String(r.shops).padStart(5)}  ${String(r.coldToReadyzMs).padStart(18)}  ${String(r.coldToAllHeldMs).padStart(26)}  ${String(r.rssAfterStartMb).padStart(20)}  ${String(r.rssAfterRequestsMb).padStart(23)}`);
