// Sending the waiting pushes (plan item 11h, decision 45): each one encrypted for its phone (RFC 8291) and signed with the shop's VAPID key (RFC 8292) here, on the
// shop's runtime, then handed to the shop's push Guard as a small JSON (hosts.ts PushCall). Guard checks the push service's host against its exact list and counts
// the push against the shop's daily caps; only then does the server's push sender (bundle/services/push.ts) make the real request. So every push goes out through
// a Guard, and nothing on the way (Guard, the push sender, the push service) can read what it says.
//
// It runs outside the agent's steps, on its own short timer and when a push is queued (`kick`), because an alert must never hold a booking's step up, and a push
// service that is down must not fail one. What came of each push is kept in the push store (store.ts): sent, gone (the phone dropped the subscription: it is
// forgotten), refused (Guard's rules or a daily count: never tried again), or tried again later with a growing wait.
import type { Clock } from "../core/clock.ts";
import { encryptPush, vapidHeader } from "./crypto.ts";
import { PUSH_ROUTES } from "./hosts.ts";
import type { PushCall } from "./hosts.ts";
import type { PushStore, Waiting } from "./store.ts";

/** Where the shop's push Guard is and the credential this runtime presents to it (runtime.json services.push). */
export interface PushGuard { baseUrl: string; agentToken?: string }

/** What a phone's service worker receives, inside the encryption: the words and a tag. The worker opens its own page when tapped; no address travels. */
export interface PushPayload { title: string; body: string; tag: string }

/** How long a push service may keep an owner's alert (a day: the owner's app lists everything anyway) and a customer's (12 hours). */
export const OWNER_TTL_S = 24 * 60 * 60;
export const CUSTOMER_TTL_S = 12 * 60 * 60;

/** The words, cut to fit a phone's notification. */
export const fitNotification = (text: string, max = 300): string => {
  const one = text.replace(/\s+/gu, " ").trim();
  return [...one].length <= max ? one : `${[...one].slice(0, max - 1).join("")}…`;
};

export function createPushSender(o: { store: PushStore; guard: PushGuard | undefined; subject: () => string | undefined; clock: Clock; log?: (line: string) => void; fetchImpl?: typeof fetch; everyMs?: number }) {
  const log = o.log ?? (() => undefined);
  const fetchImpl = o.fetchImpl ?? fetch;
  let running: Promise<void> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;

  /** One push, through the Guard. The Guard's own answers (403 refused, 502 provider unreachable) and the push service's (201, 404, 410, 413, 429) are told apart. */
  async function one(w: Waiting): Promise<void> {
    const now = o.clock.now();
    const subject = o.subject();
    if (!o.guard || !subject) { o.store.settle(w.id, "later", now); return; }
    const payload: PushPayload = { title: w.title, body: w.body, tag: w.tag };
    let body: Buffer;
    try { body = encryptPush(Buffer.from(JSON.stringify(payload)), { p256dh: w.sub.p256dh, auth: w.sub.auth }, { padTo: 128 }); }
    catch (e) { log(`A push could not be encrypted (${(e as Error).message}); the phone's subscription is dropped.`); o.store.drop(w.sub.id, "bad_keys", now); return; }
    const call: PushCall = {
      host: w.sub.host, path: w.sub.path, sub: w.sub.id,
      ttl: w.kind === "owner" ? OWNER_TTL_S : CUSTOMER_TTL_S, urgency: w.kind === "owner" ? "high" : "normal",
      // one topic per phone and kind: a phone that was offline gets the newest alert, not a pile (its page lists everything anyway)
      topic: `${w.kind}-${w.sub.id}`,
      vapid: vapidHeader(o.store.vapid(), { audience: `https://${w.sub.host}`, subject, nowS: Math.floor(now / 1000) }),
      body: body.toString("base64url"),
    };
    let status = 0;
    let reason: string | undefined;
    try {
      const r = await fetchImpl(`${o.guard.baseUrl.replace(/\/+$/u, "")}${w.kind === "owner" ? PUSH_ROUTES.owner : PUSH_ROUTES.customer}`, {
        method: "POST", headers: { "content-type": "application/json", ...(o.guard.agentToken ? { authorization: `Bearer ${o.guard.agentToken}` } : {}) },
        body: JSON.stringify(call), signal: AbortSignal.timeout(20_000),
      });
      status = r.status;
      const text = await r.text().catch(() => "");
      reason = /"reason_code"\s*:\s*"([a-z_]+)"/u.exec(text)?.[1];
    } catch { status = 0; }
    const at = o.clock.now();
    if (status >= 200 && status < 300) return o.store.settle(w.id, "sent", at, status);
    if (status === 404 || status === 410) { o.store.drop(w.sub.id, "gone", at); return o.store.settle(w.id, "gone", at, status); }
    // Guard's refusal: its rules or a daily count. Not tried again (the count is the point); the owner's app still lists what waits.
    if (status === 403) { log(`A push was refused by the push Guard (${reason ?? "refused"}).`); return o.store.settle(w.id, "refused", at, status); }
    if (status === 400 || status === 413) return o.store.settle(w.id, "failed", at, status);
    return o.store.settle(w.id, "later", at, status);
  }

  /** Asked for while a pass was running: that pass may have read the queue before the new push, so one more pass follows it (one, however often it is asked). */
  let next: Promise<void> | undefined;
  /** Send what is due, one at a time (a shop has few phones), then tidy. Never two passes at once: asked while one runs, the answer is the pass that follows it. */
  function pass(): Promise<void> {
    if (running) return (next ??= running.then(() => { next = undefined; return pass(); }));
    const p = (async () => {
      try {
        for (const w of o.store.due(o.clock.now())) await one(w);
        o.store.tidy(o.clock.now());
      } catch (e) { log(`The push sender stopped a pass: ${(e as Error).message}`); }
    })();
    // cleared once it settles, even when it had nothing to wait for (an async function with no await finishes before it is assigned)
    running = p;
    void p.finally(() => { if (running === p) running = undefined; });
    return p;
  }

  return {
    /** Send what is due now (and wait for it): after a push is queued, and on the timer. */
    pass,
    kick(): void { void pass(); },
    start(): void { timer ??= setInterval(() => void pass(), o.everyMs ?? 15_000); timer.unref?.(); },
    async stop(): Promise<void> { if (timer) clearInterval(timer); timer = undefined; await running; },
  };
}
export type PushSender = ReturnType<typeof createPushSender>;
