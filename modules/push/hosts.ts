// Where a shop's web pushes may go, and how the runtime hands one to its push Guard (plan item 11h, decision 45). One place for the names the runtime's sender
// (sender.ts), the subscription check (store.ts), the push Guard's spec (bundle/generate/guards.ts pushSpec) and the server's push sender
// (bundle/services/push.ts) all use, so the host a browser subscribes at, the host Guard allows and the host the sender reaches are the same list.

/**
 * The push services, exactly. Chrome, Edge and Samsung Internet on Android (and Chrome on a computer) subscribe at Google's FCM; Firefox at Mozilla's; Safari on
 * an iPhone (iOS 16.4 or later, the app added to the home screen) and on a Mac at Apple's. Edge on Windows uses hosts that vary (`*.notify.windows.com`), which
 * an exact list cannot name: it is not covered (modules/Deferred.md).
 */
export const PUSH_HOSTS: readonly string[] = ["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"];

/** The push Guard's two operations: a push to the owner, and one to a customer who allowed it. Two, so the licence can hold back the customers' and never the owner's. */
export const PUSH_OPERATIONS = { owner: "push_owner", customer: "push_customer" } as const;
/** The JSON routes the runtime posts to the push Guard, one per operation; Guard passes them on to the server's push sender as they are. */
export const PUSH_ROUTES = { owner: "/v1/push/owner", customer: "/v1/push/customer" } as const;

/**
 * What the runtime posts to its push Guard (and Guard passes to the push sender): the push service's host (the field Guard's allowlist checks, and the only
 * place the sender takes the host from), the subscription's path, its short id (Guard's per-phone count), how long the push service may keep it, the VAPID
 * header, and the encrypted body in base64url.
 */
export interface PushCall { host: string; path: string; sub: string; ttl: number; urgency: "very-low" | "low" | "normal" | "high"; topic?: string; vapid: string; body: string }

/** Why a push call is refused before anything goes out, or null. The runtime's sender and the server's push sender both ask. */
export function pushCallProblem(c: unknown): string | null {
  const o = c as Partial<PushCall> | undefined;
  if (!o || typeof o !== "object") return "the body must be a JSON object";
  if (typeof o.host !== "string" || !PUSH_HOSTS.includes(o.host)) return "host is not a push service this server sends to";
  if (typeof o.path !== "string" || !/^\/[A-Za-z0-9._~%:/?=&+-]{1,1000}$/u.test(o.path) || o.path.startsWith("//") || o.path.includes("/../") || o.path.includes("@")) return "path is not a push subscription's path";
  if (typeof o.sub !== "string" || !/^[0-9a-f]{12}$/u.test(o.sub)) return "sub is a subscription's short id";
  if (!Number.isInteger(o.ttl) || (o.ttl as number) < 0 || (o.ttl as number) > 28 * 24 * 3600) return "ttl is 0 to 28 days in seconds";
  if (!["very-low", "low", "normal", "high"].includes(o.urgency as string)) return "urgency is very-low, low, normal or high";
  if (o.topic !== undefined && (typeof o.topic !== "string" || !/^[A-Za-z0-9_-]{1,32}$/u.test(o.topic))) return "topic is up to 32 base64url characters";
  if (typeof o.vapid !== "string" || !/^vapid t=[A-Za-z0-9_.-]+, k=[A-Za-z0-9_-]+$/u.test(o.vapid) || o.vapid.length > 1000) return "vapid is the VAPID Authorization header";
  if (typeof o.body !== "string" || !/^[A-Za-z0-9_-]{1,5600}$/u.test(o.body)) return "body is the encrypted message in base64url, at most 4 KB";
  return null;
}
