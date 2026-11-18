// One WORKER THREAD of the shared process's pool (modules/runtime/shared-pool.ts starts it; modules/runtime/shared.ts says why there is a pool). It hosts a set of shops: for each
// "start" message it runs the shop's own start (the module named in workerData.startModule, the same code a shop run alone uses), which opens the shop's store and puts the shop's own
// HTTP server on the loopback address, inside this thread. The router in the main thread forwards to that port exactly as it would for a shop in its own process.
//
// Three jobs besides hosting:
//   - ANSWER PINGS. The main thread pings every few seconds; a thread whose event loop is blocked (an endless loop, a pathological regex) cannot answer, and the main thread
//     terminates it after a while. That is the whole point of a thread: the main thread, and the other workers, keep going.
//   - SAY WHICH SHOP IS RUNNING. A shared slot (a SharedArrayBuffer the main thread also holds) is set to the shop whose code is running now and cleared when it stops. If this thread
//     is stuck, the main thread reads the slot and so knows WHICH shop to blame, instead of striking every shop that lives here. The shop is found through AsyncLocalStorage (the shop's
//     start runs inside `who.run(idx, ...)`, and Node carries the value through its timers, sockets and promises), and the slot is written from async_hooks `before`/`after`, which
//     fire around EVERY callback, a promise continuation after an `await` included (a request handler is mostly continuations, so wrapping only the handler would miss them).
//   - KEEP A THROW OR A REJECTION FROM KILLING THE THREAD: the same containment the main thread has for in-process shops; it is reported to the main thread, which counts it as a bad look.
import { AsyncLocalStorage, createHook } from "node:async_hooks";
import { parentPort, workerData } from "node:worker_threads";

interface Held { server: { port: number }; stop(): Promise<void> }
type StartFn = (paths: unknown, listen: { host: string; port: number }, log: (line: string) => void) => Promise<Held>;

const port = parentPort!;
const slot = new Int32Array((workerData as { sab: SharedArrayBuffer }).sab);
/** The index (given by the main thread, per worker) of the shop this async work belongs to. */
const who = new AsyncLocalStorage<number>();
// the slot holds index + 1, so 0 means "no shop" (nothing of a shop is running: the thread is idle or answering a ping)
createHook({
  before() { const s = who.getStore(); if (s !== undefined) Atomics.store(slot, 0, s + 1); },
  after() { Atomics.store(slot, 0, 0); },
}).enable();
/** Run `fn` as shop `idx`: the slot is set for its synchronous part too (the hooks only see callbacks that start later), and the store follows everything it starts. */
const asShop = <T>(idx: number, fn: () => T): T => { Atomics.store(slot, 0, idx + 1); try { return who.run(idx, fn); } finally { Atomics.store(slot, 0, 0); } };

const start = ((await import((workerData as { startModule: string }).startModule)) as { start: StartFn }).start;
const shops = new Map<number, Held>();

port.on("message", (m: { t: string; id?: number; idx?: number; paths?: unknown }) => {
  if (m.t === "ping") { port.postMessage({ t: "pong" }); return; }
  const idx = m.idx!;
  if (m.t === "start") {
    asShop(idx, () => start(m.paths, { host: "127.0.0.1", port: 0 }, (line) => port.postMessage({ t: "log", line })))
      .then((held) => { shops.set(idx, held); port.postMessage({ t: "started", id: m.id, port: held.server.port }); })
      .catch((e: Error) => port.postMessage({ t: "failed", id: m.id, why: String(e?.message ?? e).split("\n")[0] }));
  } else if (m.t === "stop") {
    const held = shops.get(idx);
    shops.delete(idx);
    // the step in hand finishes and the store is closed before "stopped" is sent: the main thread waits for it before it says the shop is gone
    (held ? asShop(idx, () => held.stop()) : Promise.resolve())
      .catch(() => undefined)
      .then(() => port.postMessage({ t: "stopped", id: m.id }));
  }
});

// what escapes every try is kept off the thread's back (a thread that dies takes its other shops down for a moment) and reported, charged to the shop it came from when that can be told
const contain = (kind: string) => (e: unknown): void => port.postMessage({ t: "bad", idx: who.getStore(), kind, why: String((e as Error)?.message ?? e).split("\n")[0] });
process.on("unhandledRejection", contain("an unhandled rejection"));
process.on("uncaughtException", contain("an uncaught exception"));

port.postMessage({ t: "ready" });
