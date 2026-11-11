// Gupshup token renewal (follow-up 2, 12 Nov 2026). Runs inside the token refresher (refresher.ts), beside the Google tokens, for every shop on Gupshup whose
// WhatsApp Guard is "renewed": no static `gupshup_authorization` was handed in for it, and the server holds a Gupshup Universal Token (`geometer gupshup-token`).
// Gupshup's contract is in modules/messaging/gupshup.ts (read 12 Nov 2026); none of it has been run against the real service.
//
// WHO HOLDS WHAT. The long-lived credential is the Universal Token (UT, 24 hours to 60 days), kept only in the refresher's own secrets folder
// (secrets/refresher/_server/gupshup_universal_token). A UT acts for the whole Gupshup partner, so it is never given to a Guard, a runtime or the panel, and it belongs
// only on a server run by that partner: Geometer's own partner server for the pilot's shops, or a builder who is a Gupshup partner in their own name. A builder's server
// is never given Geometer's UT (renewal for those would be fleet minting app tokens for them: Deferred.md). Minting a new UT needs the partner admin's email and client
// secret, which stay with the person: they hand in a new UT before the old one ends, and this file says when that is (from the UT's own `exp`).
//
// WHAT IS WRITTEN, WHERE. For each renewed shop a Universal App Token (UAT: one app, at most 24 hours) is minted with the UT and written as the whole Authorization
// value to <outDir>/<shop>/authorization: the `gupshup-auth` volume, whose <shop> sub-folder only that shop's WhatsApp Guard mounts (read-only, at /run/gupshup; its
// `[upstream_headers]` reads ${file:/run/gupshup/authorization}). Then that Guard is asked to read it again (POST /admin/reload with its own admin token), as the
// Google refresher does. Beside it, renewal.json keeps when the token ends (no secret), so a restart of the refresher does not mint again (3 active per app at most).
//
// WHEN. Each UAT is asked for 23 hours (Gupshup's longest is 24; the hour is room for the two clocks), and renewed once it has 8 hours left: one new token about every
// 15 hours, at most two alive at once, one spare under Gupshup's three. At most 8 mints in any minute (Gupshup allows 10), so a server's first start mints its shops in
// a burst and the rest a minute later. A failure waits 1, 2, 4, 8, then 10 minutes between tries, never a tight loop on a credential.
//
// WHEN IT FAILS. Never a silent stop: the token in use keeps working until it ends (at least 8 hours after the first failure), and the state below says so from the
// first failure. ops reads it from the refresher's /healthz and writes fleet/_renewals.json, which the panel's unfinished-work list shows (and the heartbeat counts as
// open work, so Geometer sees it too); the refresher's log says it each time. When the UT itself is within 7 days of its end, the same list says to hand in a new one.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GUPSHUP_APP_ID, GUPSHUP_APP_TOKEN_ROUTE, GUPSHUP_UAT_MAX_MS, GUPSHUP_UAT_MINTS_PER_MINUTE } from "../../modules/messaging/gupshup.ts";
import { writeAtomic } from "../lib/util.ts";

/** How long each app token is asked for: Gupshup's longest (24 h) less an hour for the clocks. */
export const UAT_LIFETIME_MS = GUPSHUP_UAT_MAX_MS - 3_600_000;
/** Renew once a token has this long left: about every 15 hours, at most two alive at once. */
export const UAT_RENEW_BEFORE_MS = 8 * 3_600_000;
/** At most this many mints in any 60 seconds: under Gupshup's 10 a minute, with room for a retry it does not see. */
export const MINTS_PER_MINUTE = GUPSHUP_UAT_MINTS_PER_MINUTE - 2;
/** Gupshup's partner API (the refresher reaches it on the egress network, as it reaches Google's token endpoint). */
export const GUPSHUP_PARTNER_URL = "https://partner.gupshup.io";

export interface GupshupShopConfig { appId: string; guardAdminUrl: string; adminTokenFile: string }
export interface GupshupRenewalConfig {
  /** The `gupshup-auth` volume inside the refresher: one sub-folder per shop. */
  outDir: string;
  /** The Universal Token, as handed in. */
  universalTokenFile: string;
  /** How the app token goes in the Authorization header: "bearer" (the default: Gupshup's newer tokens are JWTs it takes as Bearer when minting) or "bare". Not documented. */
  header: "bearer" | "bare";
  shops: Record<string, GupshupShopConfig>;
  /** A test's stand-in for Gupshup; left out, Gupshup's partner API. */
  baseUrl?: string;
}

/** One shop's renewal, as /healthz says it and ops passes on. Times in epoch ms; `lastError` is a few plain words, never a token or a reply body. */
export interface RenewalState {
  validUntil: number | null;
  lastError: string | null;
  /** Since when renewing has failed without a success in between; null while it works. */
  failingSince: number | null;
  /** When the universal token itself ends, from its own `exp` (read, not checked); null when it says none or cannot be read. */
  credentialValidUntil: number | null;
}

export type MintResult = { ok: true; token: string; id: string } | { ok: false; why: string };

/** One UAT, one attempt. `why` is a few plain words and never the response body. */
export async function mintAppToken(o: { baseUrl: string; appId: string; universalToken: string; name: string; expiryMs: number; fetchFn?: typeof fetch }): Promise<MintResult> {
  if (!GUPSHUP_APP_ID.test(o.appId)) return { ok: false, why: "the shop's Gupshup app id is not an app id" };
  const path = GUPSHUP_APP_TOKEN_ROUTE.replace("{app_id}", encodeURIComponent(o.appId));
  try {
    const r = await (o.fetchFn ?? fetch)(`${o.baseUrl.replace(/\/+$/u, "")}${path}`, {
      method: "POST", headers: { authorization: `Bearer ${o.universalToken}`, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ name: o.name, expiry: String(o.expiryMs) }), redirect: "error", signal: AbortSignal.timeout(15_000),
    });
    const j = await r.json().catch(() => undefined) as { status?: unknown; token?: unknown; id?: unknown; message?: unknown } | undefined;
    if (r.status === 200 && j?.status === "success" && typeof j.token === "string" && j.token.length >= 16 && !/\s/u.test(j.token)) return { ok: true, token: j.token, id: typeof j.id === "string" ? j.id : "" };
    if (r.status === 401) return { ok: false, why: "Gupshup did not accept the universal token (it may have ended or been revoked): hand in a new one with `geometer gupshup-token <file>`" };
    if (r.status === 403) return { ok: false, why: "Gupshup has not turned these tokens on for this partner" };
    if (r.status === 409) return { ok: false, why: "Gupshup says this app already has 3 active tokens (or one by this name)" };
    if (r.status === 429) return { ok: false, why: "Gupshup says too many token requests just now" };
    // Gupshup's own words on a 400 are plain (a name or an expiry it refused); they are kept short and never contain the token we sent
    const said = typeof j?.message === "string" && !j.message.includes(o.universalToken) ? `: ${j.message.slice(0, 120)}` : "";
    return { ok: false, why: `Gupshup answered ${r.status}${said}` };
  } catch (e) { return { ok: false, why: `Gupshup could not be reached (${(e as { cause?: { code?: string } }).cause?.code ?? (e as Error).name})` }; }
}

/** The `exp` of a JWT, in epoch ms, read WITHOUT checking its signature: only to say before the universal token ends. Undefined when it has none. */
export function jwtExpiryMs(token: string): number | undefined {
  const part = token.split(".")[1];
  if (!part) return undefined;
  try {
    const exp = (JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as { exp?: unknown }).exp;
    return typeof exp === "number" && Number.isFinite(exp) && exp > 0 ? exp * 1000 : undefined;
  } catch { return undefined; }
}

export interface GupshupRenewer { tick(force?: boolean): Promise<void>; healthy(): boolean; state(): Record<string, RenewalState> }

export function createGupshupRenewer(config: GupshupRenewalConfig, deps: { fetch?: typeof fetch; now?: () => number; log?: (line: string) => void } = {}): GupshupRenewer {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? (() => undefined);
  const f = deps.fetch ?? fetch;
  const baseUrl = config.baseUrl ?? GUPSHUP_PARTNER_URL;
  type S = { validUntil: number | null; lastError: string | null; failingSince: number | null; failures: number; nextAt: number; tried: boolean };
  const shops: Record<string, S> = {};
  const mintedAt: number[] = []; // the mints of the last minute, for Gupshup's limit
  let running = false;
  for (const name of Object.keys(config.shops)) {
    const dir = join(config.outDir, name);
    // the folder exists from the start, token or no token: the shop's WhatsApp Guard mounts it, and Docker cannot make the container without it
    try { mkdirSync(dir, { recursive: true, mode: 0o755 }); } catch { /* the first mint will say */ }
    // a token minted before a restart is kept until it is due: minting again would only use up Gupshup's three active tokens
    let validUntil: number | null = null;
    try {
      const kept = JSON.parse(readFileSync(join(dir, "renewal.json"), "utf8")) as { validUntil?: unknown };
      if (typeof kept.validUntil === "number" && existsSync(join(dir, "authorization"))) validUntil = kept.validUntil;
    } catch { /* none yet */ }
    const fresh = validUntil !== null && validUntil - UAT_RENEW_BEFORE_MS > now();
    shops[name] = { validUntil, lastError: null, failingSince: null, failures: 0, nextAt: fresh ? (validUntil as number) - UAT_RENEW_BEFORE_MS : 0, tried: fresh };
  }

  const universalToken = (): string => (existsSync(config.universalTokenFile) ? readFileSync(config.universalTokenFile, "utf8").trim() : "");

  async function renew(name: string): Promise<void> {
    const c = config.shops[name]; const s = shops[name];
    const ut = universalToken();
    const at = now();
    mintedAt.push(at);
    const expiryMs = at + UAT_LIFETIME_MS;
    // a name of its own each time: Gupshup refuses a name an active token already has
    const r = ut === "" ? { ok: false as const, why: "no Gupshup universal token was handed in (`geometer gupshup-token <file>`)" } : await mintAppToken({ baseUrl, appId: c.appId, universalToken: ut, name: `geometer-${name}-${at}`, expiryMs, fetchFn: f });
    s.tried = true;
    if (!r.ok) {
      s.lastError = r.why; s.failures++; s.failingSince ??= at;
      s.nextAt = at + Math.min(10, 2 ** (s.failures - 1)) * 60_000;
      const left = s.validUntil === null ? "there is no token in use" : s.validUntil > at ? `the one in use ends in ${Math.round((s.validUntil - at) / 60_000)} min` : "the one in use has ended: nothing goes out through Gupshup now";
      log(`${name}: ALERT no new Gupshup token (${r.why}); ${left}; trying again in ${Math.round((s.nextAt - at) / 60_000)} min`);
      return;
    }
    const dir = join(config.outDir, name);
    mkdirSync(dir, { recursive: true });
    writeAtomic(join(dir, "authorization"), config.header === "bare" ? r.token : `Bearer ${r.token}`, 0o644);
    writeAtomic(join(dir, "renewal.json"), `${JSON.stringify({ validUntil: expiryMs, mintedAt: at, tokenId: r.id })}\n`, 0o644);
    s.validUntil = expiryMs; s.lastError = null; s.failingSince = null; s.failures = 0;
    s.nextAt = expiryMs - UAT_RENEW_BEFORE_MS;
    const adminToken = existsSync(c.adminTokenFile) ? readFileSync(c.adminTokenFile, "utf8").trim() : "";
    try {
      const reload = await f(`${c.guardAdminUrl.replace(/\/+$/u, "")}/admin/reload`, { method: "POST", headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" }, body: "{}", signal: AbortSignal.timeout(10_000) });
      await reload.body?.cancel();
      log(`${name}: new Gupshup app token written (ends ${new Date(expiryMs).toISOString()}); the WhatsApp Guard ${reload.ok ? "read it" : `answered ${reload.status} to the reload`}`);
    } catch { log(`${name}: new Gupshup app token written; the WhatsApp Guard is not up yet (it reads the file when it starts)`); }
  }

  async function tick(force = false): Promise<void> {
    if (running) return;
    running = true;
    try {
      for (const name of Object.keys(config.shops)) {
        if (!force && now() < shops[name].nextAt) continue;
        while (mintedAt.length > 0 && now() - mintedAt[0] >= 60_000) mintedAt.shift();
        if (mintedAt.length >= MINTS_PER_MINUTE) break; // the next tick goes on: never faster than Gupshup allows
        await renew(name);
      }
    } finally { running = false; }
  }

  return {
    tick,
    // healthy once every shop has been tried, as for Google: a shop whose token could not be minted has no file, so only ITS WhatsApp Guard cannot start
    healthy: () => Object.values(shops).every((s) => s.tried),
    state: () => {
      const credential = jwtExpiryMs(universalToken()) ?? null;
      return Object.fromEntries(Object.entries(shops).map(([n, s]) => [n, { validUntil: s.validUntil, lastError: s.lastError, failingSince: s.failingSince, credentialValidUntil: credential }]));
    },
  };
}
