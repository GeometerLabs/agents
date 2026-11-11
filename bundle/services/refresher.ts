// The Google token refresher. Google's access tokens last about an hour. For each shop it holds the shop's service-account key (the shop's calendar is
// shared with that account), exchanges a signed assertion for a short-lived token, writes `Bearer <token>` to a file only that shop's Calendar Guard reads,
// and asks that Guard to read it again (POST /admin/reload with its admin token). The runtime never sees the key or the token.
//
// Since 12 Nov 2026 (follow-up 2) it also renews Gupshup app tokens for the shops whose WhatsApp Guard is "renewed" (gupshup-tokens.ts; config `gupshup`), with the
// same discipline, and its /healthz says how each is doing (no token), which ops passes on to the panel's unfinished-work list.
//
// Token discipline: a token is never logged and is never part of a URL; the exchange is tried once per round and a failure waits (1 min, then doubling to
// 10) rather than being repeated at once; the service-account key file is only ever read, never rewritten; if the provider ever sends a refresh credential
// with the token it is not stored here, because this flow has none to keep (the key is the long-lived credential).
import { createSign } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { writeAtomic } from "../lib/util.ts";
import { createGupshupRenewer } from "./gupshup-tokens.ts";
import type { GupshupRenewalConfig } from "./gupshup-tokens.ts";

export interface RefresherShopConfig { serviceAccountFile: string; guardAdminUrl: string; adminTokenFile: string }
/** `gupshup`: the shops whose Gupshup app token this refresher renews (follow-up 2); left out on a server with none, which keeps its config as it was. */
export interface RefresherConfig { outDir: string; refreshMinutes: number; scope: string; shops: Record<string, RefresherShopConfig>; gupshup?: GupshupRenewalConfig }

const b64url = (data: string | Buffer) => Buffer.from(data).toString("base64url");

/** The signed assertion Google's token endpoint wants (RFC 7523). */
export function signAssertion(account: { client_email: string; private_key: string; token_uri: string }, scope: string, nowSeconds: number): string {
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: account.client_email, scope, aud: account.token_uri, iat: nowSeconds, exp: nowSeconds + 3600 }));
  const signature = createSign("RSA-SHA256").update(`${head}.${claims}`).sign(account.private_key);
  return `${head}.${claims}.${b64url(signature)}`;
}

export type TokenResult = { ok: true; token: string; expiresInSeconds: number } | { ok: false; why: string };

/** One exchange, one attempt. `why` is a few plain words and never the response body (which could echo a credential). */
export async function exchange(accountFile: string, scope: string, fetchFn: typeof fetch = fetch, now: () => number = Date.now): Promise<TokenResult> {
  let account: { client_email: string; private_key: string; token_uri: string };
  try { account = JSON.parse(readFileSync(accountFile, "utf8")); } catch { return { ok: false, why: "the service account key could not be read" }; }
  try {
    const body = new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: signAssertion(account, scope, Math.floor(now() / 1000)) });
    const r = await fetchFn(account.token_uri, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(15_000) });
    if (!r.ok) { await r.body?.cancel(); return { ok: false, why: `the token endpoint answered ${r.status}` }; }
    const j = await r.json() as { access_token?: unknown; expires_in?: unknown };
    if (typeof j.access_token !== "string" || j.access_token.length < 10 || typeof j.expires_in !== "number") return { ok: false, why: "the token endpoint's answer had no token in it" };
    return { ok: true, token: j.access_token, expiresInSeconds: j.expires_in };
  } catch (e) { return { ok: false, why: `the token endpoint could not be reached (${(e as { cause?: { code?: string } }).cause?.code ?? (e as Error).name})` }; }
}

export interface Refresher { refreshAll(): Promise<void>; start(): void; stop(): void; healthy(): boolean; state(): Record<string, { expiresAt: number | null; lastError: string | null }> }

export function createRefresher(config: RefresherConfig, deps: { fetch?: typeof fetch; now?: () => number; log?: (line: string) => void } = {}): Refresher {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? (() => undefined);
  const f = deps.fetch ?? fetch;
  const shops: Record<string, { expiresAt: number | null; lastError: string | null; failures: number; nextAt: number; tried: boolean }> = Object.fromEntries(Object.keys(config.shops).map((s) => [s, { expiresAt: null, lastError: null, failures: 0, nextAt: 0, tried: false }]));
  let timer: ReturnType<typeof setInterval> | undefined;
  let running = false;
  // Each shop's folder exists from the start, token or no token: a Calendar Guard mounts its own sub-folder of the token volume, and Docker cannot even create
  // the container if the folder is missing. A shop whose key does not work then has a Guard that cannot start (no token file), and no other shop is held back.
  for (const name of Object.keys(config.shops)) { try { mkdirSync(join(config.outDir, name), { recursive: true, mode: 0o755 }); } catch { /* the first exchange will say */ } }

  async function refresh(name: string): Promise<void> {
    const c = config.shops[name]; const s = shops[name];
    const t = await exchange(c.serviceAccountFile, config.scope, f, now);
    s.tried = true;
    if (!t.ok) {
      s.lastError = t.why; s.failures++;
      s.nextAt = now() + Math.min(10, 2 ** (s.failures - 1)) * 60_000; // one try now, then 1, 2, 4, 8, 10, 10 ... minutes: never a tight loop on a credential
      log(`${name}: no new Google token (${t.why}); trying again in ${Math.round((s.nextAt - now()) / 60_000)} min`);
      return;
    }
    const target = join(config.outDir, name, "authorization");
    mkdirSync(dirname(target), { recursive: true });
    writeAtomic(target, `Bearer ${t.token}`, 0o644);
    s.expiresAt = now() + t.expiresInSeconds * 1000; s.lastError = null; s.failures = 0;
    // About every `refreshMinutes`, and always before the token runs out.
    s.nextAt = now() + Math.min(config.refreshMinutes * 60_000, Math.max(60_000, t.expiresInSeconds * 1000 - 5 * 60_000));
    const adminToken = existsSync(c.adminTokenFile) ? readFileSync(c.adminTokenFile, "utf8").trim() : "";
    try {
      const r = await f(`${c.guardAdminUrl.replace(/\/+$/u, "")}/admin/reload`, { method: "POST", headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" }, body: "{}", signal: AbortSignal.timeout(10_000) });
      await r.body?.cancel();
      log(`${name}: new Google token written (valid ${Math.round(t.expiresInSeconds / 60)} min); the Calendar Guard ${r.ok ? "read it" : `answered ${r.status} to the reload`}`);
    } catch { log(`${name}: new Google token written; the Calendar Guard is not up yet (it reads the file when it starts)`); }
  }

  async function refreshAll(force = true) {
    if (running) return;
    running = true;
    try { for (const name of Object.keys(config.shops)) if (force || now() >= shops[name].nextAt) await refresh(name); } finally { running = false; }
  }

  return {
    refreshAll: () => refreshAll(true),
    start() { void refreshAll(true); timer = setInterval(() => void refreshAll(false), 15_000); },
    stop() { if (timer) clearInterval(timer); },
    // Healthy once every shop has been tried. A shop whose key is broken has no token file, so only ITS Calendar Guard cannot start; the others are not held back.
    healthy: () => Object.values(shops).every((s) => s.tried),
    state: () => Object.fromEntries(Object.entries(shops).map(([n, s]) => [n, { expiresAt: s.expiresAt, lastError: s.lastError }])),
  };
}

if (import.meta.main) {
  const config = JSON.parse(readFileSync(process.env.CONFIG ?? "/etc/geometer/refresher.json", "utf8")) as RefresherConfig;
  const refresher = createRefresher(config, { log: (line) => console.error(line) });
  const gupshup = config.gupshup && Object.keys(config.gupshup.shops).length > 0 ? createGupshupRenewer(config.gupshup, { log: (line) => console.error(line) }) : undefined;
  const server = createServer((req, res) => {
    if (req.url === "/healthz") {
      const ok = refresher.healthy() && (gupshup?.healthy() ?? true);
      res.writeHead(ok ? 200 : 503, { "content-type": "application/json" });
      // `gupshup`: each renewed shop's state (times and plain words, never a token), for ops to pass on to the panel's unfinished-work list
      res.end(JSON.stringify({ ok, shops: Object.fromEntries(Object.entries(refresher.state()).map(([n, s]) => [n, { valid: s.expiresAt !== null && s.expiresAt > Date.now(), lastError: s.lastError }])), ...(gupshup ? { gupshup: gupshup.state() } : {}) }));
      return;
    }
    res.writeHead(404); res.end();
  });
  server.listen(Number(process.env.PORT ?? 8791), process.env.HOST ?? "127.0.0.1");
  refresher.start();
  // every 7 s: a token due is renewed at once, and the per-minute limit inside tick() spreads a first start's mints over a minute or two
  if (gupshup) { void gupshup.tick(); const gupshupTimer = setInterval(() => void gupshup.tick(), 7_000); for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => clearInterval(gupshupTimer)); }
  console.error(`Google token refresher for ${Object.keys(config.shops).length} shop(s), every ${config.refreshMinutes} minutes and before a token runs out.`);
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { refresher.stop(); server.close(() => process.exit(0)); });
}
