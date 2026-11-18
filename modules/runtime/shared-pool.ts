// The POOL of worker threads behind the shared process (modules/runtime/shared.ts; the thread's own side is shared-worker.ts). Why it exists: shops on one process share its event loop
// and its memory, so one shop that loops forever or eats memory stops them all. A thread per shop would stop that but costs about 33 MB each (measured on Node 26: a thread that loads the
// listings start code and opens an HTTP server takes about 33 MB and 0.17 s), which does not fit hundreds of shops on a 4 GB server. So: a SMALL pool of K threads, each hosting many shops, and
// a way to find the shop that hurts a thread and move it out:
//
//   - a thread that runs out of memory (its own `resourceLimits`) exits; one whose event loop is blocked stops answering the main thread's pings and is terminated (that stops even a busy
//     loop). Either way ONLY that thread's shops are out, briefly: they get a quick 503 with Retry-After while the thread is started again and its shops with it.
//   - WHO WAS IT: the thread publishes the shop whose code is running in a shared slot, which the main thread can read while the thread is stuck. That shop gets a STRIKE; when no shop is
//     named, every shop of that thread with a request in flight does. 2 strikes in 30 minutes move the shop to a QUARANTINE thread of its own with half the memory; 3 failures there in an
//     hour PAUSE it: its pages say "back soon", the process names it (log, /readyz, /shared/shops) and it is tried again after 6 hours or when its files change.
// Every number is a named constant below (and can be overridden per pool, which the tests do to run in tens of milliseconds).
import { Worker } from "node:worker_threads";
import type { HeldShop, ShopPaths } from "./shared.ts";

/** How many threads host the shared shops. 4: a thread is about 33 MB on its own, so four are ~130 MB of fixed cost and a crash takes a quarter of the shops, not all of them. */
export const DEFAULT_WORKERS = 4;
/** A pool thread's old-generation heap limit (MB). 256: far above what a few hundred listing shops use together, low enough that a leak ends one thread before the server swaps. */
export const DEFAULT_WORKER_MB = 256;
/** A quarantine thread's limit (MB): it holds one shop that has already hurt a thread twice, so it gets half. */
export const DEFAULT_QUARANTINE_MB = 128;
/** How often the main thread pings each thread (ms), and how long without an answer is "blocked" (ms). 2 s and 10 s: a busy shop answers a ping in microseconds, so 10 s is five missed pings, not one slow GC. */
export const PING_MS = 2_000;
export const DEAD_AFTER_MS = 10_000;
/** A strike is forgotten after this long (ms), and this many within it move a shop to quarantine. 30 minutes and 2: one bad request is bad luck, two close together is the shop. */
export const STRIKE_WINDOW_MS = 30 * 60_000;
export const STRIKES_TO_QUARANTINE = 2;
/** Failures in quarantine within this long (ms) pause the shop. 1 hour and 3: it had its own thread and still failed again and again. */
export const QUARANTINE_WINDOW_MS = 60 * 60_000;
export const FAILURES_TO_PAUSE = 3;
/** A paused shop is tried again after this long (ms), if its files did not change first. 6 hours: long enough to stop the churn and the noise, short enough that nobody has to remember it. */
export const PAUSE_MS = 6 * 60 * 60_000;
/** The first wait before a lost thread is started again (ms), doubling to MAX_RESTART_DELAY_MS; reset once a thread has lived RESTART_RESET_MS. A thread that dies on arrival must not spin. */
export const RESTART_DELAY_MS = 250;
export const MAX_RESTART_DELAY_MS = 30_000;
export const RESTART_RESET_MS = 60_000;
/** How long a request to a shop's own server may take before the router gives up with a 503 (ms). Listing pages are quick; a hang must never hold a visitor for the front's whole minute. */
export const PROXY_TIMEOUT_MS = 10_000;
/** How long a thread may take to start or to stop one shop (ms). */
export const START_WAIT_MS = 30_000;
export const STOP_WAIT_MS = 10_000;

const WORKER_FILE = new URL("./shared-worker.ts", import.meta.url);

export interface PoolOptions {
  /** A file URL of the module that exports `start(paths, listen, log)`: the template's own start for one shop. It is imported INSIDE each thread (a function cannot cross into one). */
  startModule: string;
  workers?: number; workerMb?: number; quarantineMb?: number;
  pingMs?: number; deadAfterMs?: number; restartDelayMs?: number; proxyTimeoutMs?: number; startWaitMs?: number; stopWaitMs?: number;
  strikeWindowMs?: number; strikesToQuarantine?: number; quarantineWindowMs?: number; failuresToPause?: number; pauseMs?: number;
}
export interface PoolHooks {
  now(): number;
  log(line: string): void;
  /** A shop threw or rejected where nothing caught it (the thread kept running): one bad look for that shop. */
  bad(name: string): void;
  /** A shop could not be started again after its thread was: let it go and try it after the usual back-off. */
  lost(name: string, why: string): void;
}
export interface PoolStatus { workers: { id: string; quarantine: boolean; running: boolean; shops: string[] }[]; quarantined: string[]; paused: string[] }
export interface Pool {
  /** Start one shop in a thread (a quarantine thread when it is quarantined). `fingerprint` changing forgets its strikes and its pause: someone fixed it. */
  start(paths: ShopPaths, fingerprint: string): Promise<HeldShop>;
  status(): PoolStatus;
  close(): Promise<void>;
}

/** What the pool remembers about a shop by name, so a shop that is stopped and started again does not get a clean sheet; dropped when its fingerprint (its files) changes. */
interface Memory { fingerprint: string; strikes: number[]; failures: number[]; quarantined: boolean; pausedUntil: number; timer?: NodeJS.Timeout }
type State = "starting" | "up" | "restarting" | "paused";
interface Rec { name: string; idx: number; paths: ShopPaths; w: W; state: State; epoch: number; inflight: number; held: HeldShop }
interface W {
  id: string; quarantine: boolean; sab: SharedArrayBuffer; slot: Int32Array; recs: Map<string, Rec>; idxNames: string[];
  worker?: Worker; ready: Promise<boolean>; markReady: (ok: boolean) => void; lastPong: number; spawnedAt: number; restarts: number; closing: boolean; restartTimer?: NodeJS.Timeout;
  pending: Map<number, { resolve(m: any): void; reject(e: Error): void; timer: NodeJS.Timeout }>; nextId: number;
}

export function createPool(o: PoolOptions, hooks: PoolHooks): Pool {
  const { now, log } = hooks;
  const K = Math.max(1, o.workers ?? DEFAULT_WORKERS);
  const t = {
    ping: o.pingMs ?? PING_MS, dead: o.deadAfterMs ?? DEAD_AFTER_MS, restart: o.restartDelayMs ?? RESTART_DELAY_MS, proxy: o.proxyTimeoutMs ?? PROXY_TIMEOUT_MS,
    startWait: o.startWaitMs ?? START_WAIT_MS, stopWait: o.stopWaitMs ?? STOP_WAIT_MS, strikeWindow: o.strikeWindowMs ?? STRIKE_WINDOW_MS, strikes: o.strikesToQuarantine ?? STRIKES_TO_QUARANTINE,
    qWindow: o.quarantineWindowMs ?? QUARANTINE_WINDOW_MS, pauseAfter: o.failuresToPause ?? FAILURES_TO_PAUSE, pause: o.pauseMs ?? PAUSE_MS,
  };
  const pool: W[] = [];
  const quarantine = new Map<string, W>();
  const recs = new Map<string, Rec>();
  const memory = new Map<string, Memory>();
  let closed = false;

  const mem = (name: string): Memory => { let m = memory.get(name); if (!m) { m = { fingerprint: "", strikes: [], failures: [], quarantined: false, pausedUntil: 0 }; memory.set(name, m); } return m; };
  const recent = (list: number[], window: number): number[] => list.filter((at) => now() - at < window);

  function makeW(id: string, isQuarantine: boolean): W {
    const sab = new SharedArrayBuffer(4);
    const w: W = { id, quarantine: isQuarantine, sab, slot: new Int32Array(sab), recs: new Map(), idxNames: [], ready: Promise.resolve(false), markReady: () => undefined, lastPong: 0, spawnedAt: 0, restarts: 0, closing: false, pending: new Map(), nextId: 1 };
    return w;
  }
  const newIdx = (w: W, name: string): number => w.idxNames.push(name) - 1;
  const leastLoaded = (): W => {
    if (pool.length < K) { const w = makeW(`w${pool.length}`, false); pool.push(w); return w; }
    return pool.reduce((a, b) => (b.recs.size < a.recs.size ? b : a));
  };
  const quarantineOf = (name: string): W => { let w = quarantine.get(name); if (!w) { w = makeW(`q-${name}`, true); quarantine.set(name, w); } return w; };

  function spawn(w: W): void {
    Atomics.store(w.slot, 0, 0);
    const worker = new Worker(WORKER_FILE, {
      workerData: { sab: w.sab, startModule: o.startModule },
      // the memory limit that makes a leak end ONE thread: V8 stops the thread with an out-of-memory error instead of growing until the server swaps
      resourceLimits: { maxOldGenerationSizeMb: w.quarantine ? (o.quarantineMb ?? DEFAULT_QUARANTINE_MB) : (o.workerMb ?? DEFAULT_WORKER_MB) },
    });
    w.worker = worker; w.lastPong = w.spawnedAt = now();
    w.ready = new Promise<boolean>((ok) => { w.markReady = ok; });
    worker.on("message", (m) => onMessage(w, m));
    worker.on("error", (e) => log(`worker ${w.id}: ${(e as Error).message.split("\n")[0]}`)); // an "exit" always follows; this only keeps the error from being thrown
    worker.on("exit", () => lost(w, worker));
  }
  const ensure = async (w: W): Promise<void> => { if (!w.worker && !w.closing) spawn(w); if (!(await w.ready) || !w.worker) throw new Error("its worker thread is not running"); };

  function onMessage(w: W, m: { t: string; id?: number; idx?: number; line?: string; why?: string; kind?: string }): void {
    if (m.t === "ready") w.markReady(true);
    else if (m.t === "pong") w.lastPong = now();
    else if (m.t === "log") log(m.line!);
    else if (m.t === "bad") {
      const name = m.idx === undefined ? undefined : w.idxNames[m.idx];
      log(`${name ?? "(no shop)"}: ${m.kind}: ${m.why}`);
      if (name) hooks.bad(name);
    } else if (m.id !== undefined) {
      const p = w.pending.get(m.id);
      if (p) { clearTimeout(p.timer); w.pending.delete(m.id); m.t === "failed" ? p.reject(new Error(m.why)) : p.resolve(m); }
    }
  }
  /** Ask a thread something and wait for its answer; a thread that is lost, or does not answer in time, rejects. */
  function ask(w: W, msg: Record<string, unknown>, waitMs: number): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = w.nextId++;
      const timer = setTimeout(() => { w.pending.delete(id); reject(new Error("its worker thread did not answer in time")); }, waitMs);
      w.pending.set(id, { resolve, reject, timer });
      w.worker!.postMessage({ ...msg, id });
    });
  }
  const failPending = (w: W): void => { for (const p of w.pending.values()) { clearTimeout(p.timer); p.reject(new Error("its worker thread stopped")); } w.pending.clear(); };

  async function startRec(rec: Rec): Promise<void> {
    await ensure(rec.w);
    const r = await ask(rec.w, { t: "start", idx: rec.idx, paths: rec.paths }, t.startWait);
    if (recs.get(rec.name) !== rec) { await ask(rec.w, { t: "stop", idx: rec.idx }, t.stopWait).catch(() => undefined); return; } // let go while it was starting: never leave it running unheld
    rec.held.server.port = r.port;
    rec.state = "up";
  }

  /** A thread is gone (out of memory, terminated by the watchdog, or died). Find who to blame, give the shops a quick 503, and start the thread again. */
  function lost(w: W, which: Worker): void {
    if (w.worker !== which) return;
    w.worker = undefined;
    w.markReady(false);
    failPending(w);
    if (w.closing || closed) return;
    // WHO: the shop in the slot when the thread stopped (the slot is not cleared by a thread that died mid-callback); none there: every shop with a request in flight
    const idx = Atomics.load(w.slot, 0);
    const running = idx > 0 ? [w.idxNames[idx - 1]] : [...w.recs.values()].filter((r) => r.inflight > 0 && r.state === "up").map((r) => r.name);
    for (const r of w.recs.values()) if (r.state === "up") { r.state = "restarting"; r.held.server.port = 0; r.epoch++; r.inflight = 0; }
    for (const name of running) if (name) strike(name, w);
    log(`worker ${w.id}: lost${running.length ? `; blamed: ${running.join(", ")}` : ""}; its ${w.recs.size} shop(s) are started again, the other workers go on.`);
    w.restarts = now() - w.spawnedAt > RESTART_RESET_MS ? 1 : w.restarts + 1;
    const delay = Math.min(MAX_RESTART_DELAY_MS, t.restart * 2 ** (w.restarts - 1));
    w.restartTimer = setTimeout(() => { w.restartTimer = undefined; void restart(w); }, delay);
    w.restartTimer.unref();
  }

  function strike(name: string, w: W): void {
    const m = mem(name);
    if (w.quarantine) {
      m.failures = recent([...m.failures, now()], t.qWindow);
      if (m.failures.length >= t.pauseAfter) pause(name, `it failed ${m.failures.length} times on a thread of its own within ${Math.round(t.qWindow / 60_000)} minutes`);
    } else {
      m.strikes = recent([...m.strikes, now()], t.strikeWindow);
      if (m.strikes.length >= t.strikesToQuarantine) { m.quarantined = true; log(`${name}: it brought a worker down ${m.strikes.length} times within ${Math.round(t.strikeWindow / 60_000)} minutes; it now runs on a worker of its own, with less memory.`); }
    }
  }

  function pause(name: string, why: string): void {
    const m = mem(name);
    m.pausedUntil = now() + t.pause; m.failures = [];
    log(`${name}: PAUSED: ${why}. Its pages say "back soon"; it is tried again in ${Math.round(t.pause / 3_600_000)} hours or when its files change. The Operator should look at it.`);
    const rec = recs.get(name);
    if (rec) { rec.w.recs.delete(name); rec.state = "paused"; rec.held.server.port = 0; armResume(rec); retire(rec.w); }
  }
  function armResume(rec: Rec): void {
    const m = mem(rec.name);
    clearTimeout(m.timer);
    m.timer = setTimeout(() => void resume(rec), Math.max(0, m.pausedUntil - now()));
    m.timer.unref();
  }
  async function resume(rec: Rec): Promise<void> {
    if (recs.get(rec.name) !== rec || closed) return;
    const m = mem(rec.name);
    // on probation: it comes back on its quarantine thread with two failures already counted, so one more failure pauses it again at once
    m.pausedUntil = 0; m.failures = [now(), now()]; m.quarantined = true;
    rec.w = quarantineOf(rec.name); rec.idx = newIdx(rec.w, rec.name); rec.w.recs.set(rec.name, rec); rec.state = "restarting"; rec.epoch++;
    log(`${rec.name}: tried again after its pause.`);
    await startRec(rec).catch((e: Error) => giveUp(rec, e.message));
  }
  function giveUp(rec: Rec, why: string): void {
    if (recs.get(rec.name) !== rec) return;
    recs.delete(rec.name); rec.w.recs.delete(rec.name); retire(rec.w);
    hooks.lost(rec.name, `it could not be started again (${why})`);
  }
  /** A quarantine thread lives only as long as its shop is on it. */
  function retire(w: W): void {
    if (!w.quarantine || w.recs.size > 0) return;
    w.closing = true; clearTimeout(w.restartTimer); quarantine.delete(w.id.slice(2));
    void w.worker?.terminate();
  }

  /** After a thread was lost: move shops whose memory says "quarantined" to threads of their own, start the thread again, and start its shops in it. */
  async function restart(w: W): Promise<void> {
    if (w.closing || closed) return;
    const touched = new Set<W>([w]);
    for (const rec of [...w.recs.values()]) {
      if (!mem(rec.name).quarantined || w.quarantine) continue;
      w.recs.delete(rec.name);
      rec.w = quarantineOf(rec.name); rec.idx = newIdx(rec.w, rec.name); rec.w.recs.set(rec.name, rec); touched.add(rec.w);
    }
    await Promise.all([...touched].map(async (x) => {
      if (x.recs.size === 0) return;
      await Promise.all([...x.recs.values()].filter((r) => r.state === "restarting").map((r) => startRec(r).catch((e: Error) => giveUp(r, e.message))));
    }));
  }

  // the watchdog: a thread that has not answered for DEAD_AFTER is blocked (or stuck in a loop); terminate() stops even a busy loop, and the "exit" it causes does the rest
  const watchdog = setInterval(() => {
    for (const w of [...pool, ...quarantine.values()]) {
      if (!w.worker) continue;
      if (now() - w.lastPong > t.dead) { log(`worker ${w.id}: it has not answered for ${(t.dead / 1000).toFixed(1)} s; it is stopped.`); void w.worker.terminate(); }
      else w.worker.postMessage({ t: "ping" });
    }
  }, t.ping);
  watchdog.unref();

  return {
    async start(paths, fingerprint) {
      const name = paths.name;
      if (recs.has(name)) throw new Error("it is already held");
      let m = memory.get(name);
      if (m && m.fingerprint !== fingerprint) { clearTimeout(m.timer); memory.delete(name); m = undefined; } // its files changed: a clean sheet
      m = mem(name); m.fingerprint = fingerprint;
      const w = m.quarantined ? quarantineOf(name) : leastLoaded();
      const rec: Rec = { name, idx: newIdx(w, name), paths, w, state: "starting", epoch: 0, inflight: 0, held: undefined as unknown as HeldShop };
      rec.held = {
        server: { port: 0 }, timeoutMs: t.proxy,
        down: () => (rec.state === "up" ? undefined : rec.state === "paused" ? "paused" : "restarting"),
        track: () => { const epoch = rec.epoch; rec.inflight++; let done = false; return () => { if (!done) { done = true; if (epoch === rec.epoch) rec.inflight--; } }; },
        async stop() {
          clearTimeout(mem(name).timer);
          const w2 = rec.w;
          if (recs.get(name) === rec) recs.delete(name);
          w2.recs.delete(name);
          if (rec.state === "up" && w2.worker) {
            try { await ask(w2, { t: "stop", idx: rec.idx }, t.stopWait); } catch {
              // the thread is blocked or gone: stopping it is the only way to be sure the store is closed before the shop is named gone
              if (w2.worker) await new Promise<void>((done) => { w2.worker!.once("exit", () => done()); void w2.worker!.terminate(); });
            }
          }
          rec.state = "restarting";
          retire(w2);
        },
      };
      recs.set(name, rec); w.recs.set(name, rec);
      if (m.pausedUntil > now()) { rec.state = "paused"; armResume(rec); retire(w); return rec.held; }
      try { await startRec(rec); } catch (e) {
        if (rec.state === "paused") return rec.held; // it was paused while starting (its start is what kept stopping the thread)
        recs.delete(name); w.recs.delete(name); retire(w);
        throw e;
      }
      return rec.held;
    },
    status: () => ({
      workers: [...pool, ...quarantine.values()].map((w) => ({ id: w.id, quarantine: w.quarantine, running: !!w.worker, shops: [...w.recs.keys()].sort() })),
      quarantined: [...memory].filter(([n, m]) => m.quarantined && recs.has(n)).map(([n]) => n).sort(),
      paused: [...recs.values()].filter((r) => r.state === "paused").map((r) => r.name).sort(),
    }),
    async close() {
      closed = true;
      clearInterval(watchdog);
      for (const m of memory.values()) clearTimeout(m.timer);
      const all = [...pool, ...quarantine.values()];
      await Promise.all(all.map(async (w) => { w.closing = true; clearTimeout(w.restartTimer); failPending(w); await w.worker?.terminate(); }));
    },
  };
}
