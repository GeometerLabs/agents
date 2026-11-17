// Streetlist's push relay (W3, 17 Nov 2026; plan next-phase.md section 1a, "The talk on every door"): the one place that holds the Streetlist app's push key and signs with it.
//
// WHY THERE IS ONE KEY. A phone that installs the Streetlist app has ONE service worker, at streetlist.in's root, shared by every shop's chat, and a browser gives a worker
// one push subscription made for one key. So the app subscribes once with Streetlist's public key, and each shop the customer allows alerts for is handed that same
// subscription. A shop never holds the key, so a shop cannot sign: its runtime encrypts each alert for the phone itself (RFC 8291, modules/push, exactly as for a phone
// on its own key) and asks THIS to sign (RFC 8292) and post it.
//
// WHAT IT SEES. Only what the push sender always saw: the push service's host, the subscription's path (the endpoint), and ciphertext it cannot open (it holds no
// decryption key and never imports the decryption code). It reads no words, no name, no phone number.
//
// WHERE IT RUNS. In the server's push sender (services/push.ts), not in the door. Why: the runtime reaches only its own Guards, and the push Guard reaches only the sender,
// on the `push` network (generate/compose.ts); the door sits on the `pages` network, is reachable from the internet through Caddy, and handles builders' traffic, so it is the
// worst place for a signing key. The sender is already the one container that reaches the push services, only behind a shop's push Guard (host allowlist, daily caps).
// This file is the pure part (checks, limits, signing, the key file); push.ts calls it.
//
// WHAT IT WILL SIGN. A call that is well formed (modules/push/hosts.ts pushCallProblem), names a shop this server runs, is for a push service on the exact list, and is within
// the shop's limits. It signs and posts in ONE step and never hands the signed header back: a VAPID signature is bound only to the push service's origin, so a header that
// came back out would work for every Streetlist subscription at that service until it expired. Its claims are built here (`aud` from the checked host, a short `exp`), never
// from the call. Its own refusals are 400 (a call that is not one) or 429 (a limit); never 401, 403, 404 or 410, because the runtime's sender reads those as "the phone's
// subscription is dead" and would drop a good phone.
//
// THE SECRET. The private key is a file handed in like the server's other keys (secrets/push/streetlist_vapid.json, 0600, mounted read-only at /run/secrets); it is never in
// the repository. `node bundle/services/relay.ts make-key <file>` makes one (it refuses to overwrite). Only the PUBLIC half goes into geometer.json (`pushRelay.publicKey`),
// which generates each shop's runtime.json so the chat page can subscribe phones with it.
import { chmodSync, existsSync, openSync, readFileSync, writeSync, closeSync } from "node:fs";
import { createPrivateKey, createPublicKey } from "node:crypto";
import { newVapidKeys, vapidHeader } from "../../modules/push/crypto.ts";
import type { VapidKeys } from "../../modules/push/crypto.ts";
import { pushCallProblem } from "../../modules/push/hosts.ts";
import type { PushCall } from "../../modules/push/hosts.ts";

/** How long a signature lasts: a push is posted within seconds, so 15 minutes (RFC 8292 allows up to 24 hours). */
export const RELAY_SIGNATURE_S = 15 * 60;

/** The limits, per shop: a small shop's alerts are few, and Guard's own daily caps are the lasting backstop (these are in memory and restart with the sender). */
export interface RelayLimits { perShopPerMinute: number; perShopPerDay: number; perPhonePerDay: number }
export const RELAY_LIMITS: RelayLimits = { perShopPerMinute: 60, perShopPerDay: 1500, perPhonePerDay: 50 };

export type RelayAnswer =
  | { ok: true; call: PushCall & { vapid: string } }
  | { ok: false; status: 400 | 429 | 503; error: string };

export interface Relay {
  /** Check, count and sign one call. On `ok`, `call` is the same call with the signed header, for the sender to post and never to return. */
  sign(call: PushCall): RelayAnswer;
  /** The public half of the key, as the pages subscribe with it. */
  publicKey: string;
  /** The shops it signs for. */
  shops: readonly string[];
}

/** A key file's content, checked: the private key is a P-256 key and the public key is its own. Throws in plain words. */
export function parseRelayKeys(text: string): VapidKeys {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error("The relay key file is not JSON."); }
  const k = raw as Partial<VapidKeys> | null;
  const jwk = k?.privateJwk;
  if (!k || typeof k.publicKey !== "string" || !jwk || jwk.kty !== "EC" || jwk.crv !== "P-256" || typeof jwk.x !== "string" || typeof jwk.y !== "string" || typeof jwk.d !== "string") throw new Error("The relay key file must hold {privateJwk, publicKey}, a P-256 key.");
  const derived = createPublicKey(createPrivateKey({ key: jwk, format: "jwk" })).export({ format: "jwk" }) as { x: string; y: string };
  const raw65 = Buffer.concat([Buffer.from([4]), Buffer.from(derived.x, "base64url"), Buffer.from(derived.y, "base64url")]).toString("base64url");
  if (raw65 !== k.publicKey) throw new Error("The relay key file's public key is not the public half of its private key.");
  return { privateJwk: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, d: jwk.d }, publicKey: k.publicKey };
}

/** Reads and checks the key file. */
export const readRelayKeys = (file: string): VapidKeys => parseRelayKeys(readFileSync(file, "utf8"));

/** Makes a new key file, 0600, refusing to overwrite one. Returns the public key to put in geometer.json (`pushRelay.publicKey`). */
export function makeRelayKeyFile(file: string): string {
  if (existsSync(file)) throw new Error(`${file} already exists; a new key would orphan every phone subscribed to the old one. Move it away on purpose first.`);
  const keys = newVapidKeys();
  const fd = openSync(file, "wx", 0o600);
  try { writeSync(fd, `${JSON.stringify(keys)}\n`); } finally { closeSync(fd); }
  chmodSync(file, 0o600);
  return keys.publicKey;
}

export function createRelay(o: { keys: VapidKeys; shops: readonly string[]; subject: string; now?: () => number; limits?: Partial<RelayLimits> }): Relay {
  const now = o.now ?? Date.now;
  const limits = { ...RELAY_LIMITS, ...o.limits };
  const known = new Set(o.shops);
  /** Times of the calls signed, by "shop" and by "shop/phone", pruned as they age out. */
  const seen = new Map<string, number[]>();
  const DAY = 86_400_000;
  const within = (key: string, ms: number, t: number): number[] => (seen.get(key) ?? []).filter((x) => t - x < ms);
  const take = (key: string, ms: number, cap: number, t: number): boolean => { const list = within(key, ms, t); if (list.length >= cap) { seen.set(key, list); return false; } return true; };
  const note = (key: string, t: number): void => { const list = within(key, DAY, t); list.push(t); seen.set(key, list); };
  let swept = 0;

  return {
    publicKey: o.keys.publicKey,
    shops: [...known],
    sign(call) {
      // a call that is not one (shape, host list, path, ttl, topic, body size): the same check the sender makes for every push, here with `relay` instead of `vapid`
      const problem = pushCallProblem(call);
      if (problem) return { ok: false, status: 400, error: problem };
      const shop = call.relay;
      if (shop === undefined) return { ok: false, status: 400, error: "this is not a relay call" };
      if (!known.has(shop)) return { ok: false, status: 400, error: "that shop is not one this server runs" };
      const t = now();
      if (t - swept > 60_000) { swept = t; for (const [k, v] of seen) { const keep = v.filter((x) => t - x < DAY); if (keep.length) seen.set(k, keep); else seen.delete(k); } }
      const phone = `${shop}/${call.sub}`;
      if (!take(`shop ${shop}`, 60_000, limits.perShopPerMinute, t) || !take(`shop ${shop}`, DAY, limits.perShopPerDay, t) || !take(`phone ${phone}`, DAY, limits.perPhonePerDay, t)) {
        return { ok: false, status: 429, error: "too many pushes for this shop just now" };
      }
      note(`shop ${shop}`, t);
      note(`phone ${phone}`, t);
      const vapid = vapidHeader(o.keys, { audience: `https://${call.host}`, subject: o.subject, nowS: Math.floor(t / 1000), ttlS: RELAY_SIGNATURE_S });
      const { relay: _shop, ...rest } = call;
      return { ok: true, call: { ...rest, vapid } };
    },
  };
}

if (import.meta.main) {
  const [command, file] = process.argv.slice(2);
  if (command !== "make-key" || !file) { console.error("Usage: node bundle/services/relay.ts make-key <file>   (makes Streetlist's push key file, 0600; prints the public key for geometer.json pushRelay.publicKey)"); process.exit(2); }
  try { console.log(makeRelayKeyFile(file)); } catch (e) { console.error((e as Error).message); process.exit(1); }
}
