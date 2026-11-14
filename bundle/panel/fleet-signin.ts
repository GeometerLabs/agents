// Signing in to the panel on Geometer's partner server with the geometer.dev account (plan decision 53; the monorepo's ADR-0071 and apps/fleet/src/panel-ticket.ts
// have the format). Only in hosted mode, and only for local partners: a builder's own server keeps its invitations and passphrases, and a SHOP OWNER never signs in
// through Geometer or Firebase (owners keep the setup QR and their passkey, owner-signin).
//
// How it goes. A partner signed in on geometer.dev presses "Open your panel"; fleet checks they are a partner and not paused, and hands the page a one-use TICKET
// in a link to <panel>/signin/<ticket>. Opening the link shows a page here (nothing is used up by opening it, so a link preview cannot spend it); pressing its button
// is a same-origin POST that checks the ticket again, spends it, and signs the person in to the panel account kept for that partner, made on their first visit.
//
// What is checked, offline, with nothing new shared: the ticket is "gp1.<kid>.<payload>.<sig>", an Ed25519 signature by fleet's LICENCE key over the exact bytes
// "gp1.<kid>.<payload>". The server pinned that key's public half at `init` (geometer.json `licence.keys`), and the panel reads that file: no new secret reaches
// the panel and the panel never calls fleet. Then the payload: kind "panel"; `aud` must be THIS server's id in fleet (geometer.json `fleet.deploymentId`, else
// `id`: the same id the heartbeat names); `exp` not past and `iat` not ahead (a minute's leeway for clocks), and no ticket that claims to live longer than
// MAX_LIFE_S; `jti` not seen before (kept, hashed, until its ticket's `exp`, in the panel's own encrypted store, so a restart does not forget it). `sub` is the
// partner's id in fleet: the panel keeps ONE account per partner id, so one partner's ticket can never open another's account, and the role model is unchanged
// (a partner sees only the shops they set up).
//
// The threat model, in short, is in Explanation.md ("Partners sign in with geometer.dev; a reset link for a forgotten passphrase").
import { createHash, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { kidOf, keysFromHex, publicKeyFromRaw } from "../../modules/licence/token.ts";
import type { Store } from "./store.ts";

export const TICKET_PREFIX = "gp1";
/** A ticket's shape: the prefix, a key id, a short payload, a 64-byte signature. Anything else is refused before any work. */
export const TICKET = /^gp1\.[0-9a-f]{16}\.[A-Za-z0-9_-]{16,1024}\.[A-Za-z0-9_-]{86}$/u;
/** Leeway for the two clocks, in seconds. */
const SKEW_S = 60;
/** No ticket fleet makes lives longer than this, so a longer one is refused even when its signature is good. */
export const MAX_LIFE_S = 900;

export type TicketProblem = "shape" | "not-set-up" | "unknown-key" | "signature" | "payload" | "audience" | "expired" | "early" | "too-long" | "used";
export interface Ticket { partner: string; jti: string; exp: number }

/** What this server is to fleet, read from geometer.json when a ticket arrives (so a server paired after the panel started is seen): the pinned keys and its id. */
export function readFleetIdentity(serverDir: string): { keys: Buffer[]; audience: string } | undefined {
  try {
    const g = JSON.parse(readFileSync(join(resolve(serverDir), "geometer.json"), "utf8")) as { id?: unknown; fleet?: { deploymentId?: unknown }; licence?: { keys?: unknown } };
    const keys = Array.isArray(g.licence?.keys) ? keysFromHex(g.licence!.keys.filter((k): k is string => typeof k === "string")) : [];
    const audience = typeof g.fleet?.deploymentId === "string" && g.fleet.deploymentId !== "" ? g.fleet.deploymentId : typeof g.id === "string" ? g.id : "";
    return keys.length > 0 && audience !== "" ? { keys, audience } : undefined;
  } catch { return undefined; }
}

const unb64url = (text: string): Buffer | undefined => { const b = Buffer.from(text, "base64url"); return b.toString("base64url") === text ? b : undefined; };

/** Check a ticket's signature and payload (not whether it was used: see `createTicketLedger`). Never throws. */
export function checkTicket(ticket: string, o: { keys: readonly Buffer[]; audience: string; nowS: number }): { ok: true; ticket: Ticket } | { ok: false; problem: TicketProblem } {
  if (!TICKET.test(ticket)) return { ok: false, problem: "shape" };
  const [prefix, kid, body, sig] = ticket.split(".");
  const key = o.keys.find((k) => k.length === 32 && kidOf(k) === kid);
  if (!key) return { ok: false, problem: "unknown-key" };
  const payloadBytes = unb64url(body);
  const sigBytes = unb64url(sig);
  if (!payloadBytes || !sigBytes || sigBytes.length !== 64) return { ok: false, problem: "shape" };
  if (!verify(null, Buffer.from(`${prefix}.${kid}.${body}`, "ascii"), publicKeyFromRaw(key), sigBytes)) return { ok: false, problem: "signature" };
  let p: Record<string, unknown>;
  try { p = JSON.parse(payloadBytes.toString("utf8")) as Record<string, unknown>; } catch { return { ok: false, problem: "payload" }; }
  if (typeof p !== "object" || p === null || p.v !== 1 || p.kind !== "panel" || typeof p.aud !== "string" || typeof p.sub !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(p.sub)
    || typeof p.jti !== "string" || !/^[A-Za-z0-9_-]{16,64}$/u.test(p.jti) || !Number.isSafeInteger(p.iat) || !Number.isSafeInteger(p.exp)) return { ok: false, problem: "payload" };
  if (p.aud !== o.audience) return { ok: false, problem: "audience" };
  const iat = p.iat as number, exp = p.exp as number;
  if (exp - iat > MAX_LIFE_S || exp <= iat) return { ok: false, problem: "too-long" };
  if (iat > o.nowS + SKEW_S) return { ok: false, problem: "early" };
  if (exp + SKEW_S <= o.nowS) return { ok: false, problem: "expired" };
  return { ok: true, ticket: { partner: p.sub, jti: p.jti, exp } };
}

/** The tickets already spent, by the sha256 of their `jti`, each kept until its ticket would have run out anyway. In the panel's store (encrypted in hosted mode). */
export function createTicketLedger(store: Store, nowS: () => number) {
  const FILE = "spent-tickets.json";
  const hash = (jti: string) => createHash("sha256").update(jti).digest("hex");
  const load = () => store.read<{ schema: 1; spent: { h: string; exp: number }[] }>(FILE)?.spent ?? [];
  return {
    spent: (jti: string): boolean => load().some((s) => s.h === hash(jti)),
    /** Spend a ticket once: false when it was spent before. The old entries go as each is written. */
    spend(t: Ticket): boolean {
      const now = nowS();
      const live = load().filter((s) => s.exp + SKEW_S > now);
      if (live.some((s) => s.h === hash(t.jti))) return false;
      store.write(FILE, { schema: 1, spent: [...live, { h: hash(t.jti), exp: t.exp }] });
      return true;
    },
  };
}
