// Measures the SHARED process (many listings-only shops in one process), TypeScript against Go, on the same machine and the same shop folders: cold start to /readyz, cold start until
// every shop is held, and the process's resident memory after the start and after a few requests per shop. Not a test: it prints a table.
//
//   node templates/commerce/listings/contract/measure-shared.ts                 N = 1, 10, 100, both implementations, one process at a time
//   node templates/commerce/listings/contract/measure-shared.ts ts 10           one cell
//
// RSS is `ps -o rss=` of the shared process itself (the TypeScript worker threads live inside it, so they are counted; a Go child process of a quarantined shop would not be, and none
// is made here). The load is light on purpose: three requests per shop, one after another. TypeScript runs with SHARED_WORKERS=4, the container's default.
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { haveGo, makeRoot, startHost, writeShop } from "./shared-harness.ts";
import type { Impl, ShopFolder } from "./shared-harness.ts";

const rssMb = (pid: number): number => Number(execFileSync("ps", ["-o", "rss=", "-p", String(pid)]).toString().trim()) / 1024;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function cell(impl: Impl, n: number) {
  const root = makeRoot();
  const shops: Record<string, ShopFolder> = {};
  for (let i = 0; i < n; i++) { const name = `shop-${String(i).padStart(3, "0")}`; shops[name] = writeShop(root, name); }
  const t0 = performance.now();
  // startHost returns when /readyz answered AND all n shops are held; time /readyz alone by polling a second connection is not possible before it returns, so it times both in one
  const host = await startHost(impl, root, { shops, expect: n, workers: 4, scanSeconds: 30 });
  const heldMs = performance.now() - t0;
  try {
    await sleep(1000);
    const afterStart = rssMb(host.pid);
    for (const name of Object.keys(shops)) {
      await host.call(name, "/readyz");
      await host.call(name, "/internal/channel/listings");
      await host.call(name, "/status");
    }
    await sleep(1000);
    return { impl, shops: n, coldToAllHeldMs: Math.round(heldMs), rssAfterStartMb: Math.round(afterStart), rssAfterRequestsMb: Math.round(rssMb(host.pid)) };
  } finally { await host.stop(); rmSync(root.dir, { recursive: true, force: true }); }
}

const [implArg, nArg] = process.argv.slice(2);
const impls = (implArg ? [implArg] : ["ts", "go"]) as Impl[];
const sizes = nArg ? [Number(nArg)] : [1, 10, 100];
const rows = [];
for (const n of sizes) for (const impl of impls) {
  if (impl === "go" && !haveGo()) { console.error("go/bin/listings-shared is not built; skipping Go"); continue; }
  const r = await cell(impl, n);
  rows.push(r);
  console.log(JSON.stringify(r));
}
console.log("\nimpl  shops  cold start to all held (ms)  RSS after start (MB)  RSS after requests (MB)");
for (const r of rows) console.log(`${r.impl.padEnd(4)}  ${String(r.shops).padStart(5)}  ${String(r.coldToAllHeldMs).padStart(28)}  ${String(r.rssAfterStartMb).padStart(20)}  ${String(r.rssAfterRequestsMb).padStart(23)}`);
