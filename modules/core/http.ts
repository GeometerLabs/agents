// The one way the live adapters talk HTTP. They hold no keys: they send no Authorization header, ever. Each adapter points at a
// base URL, which in production is a Guard instance in front of that one service (Guard adds the credential) and in a test is a
// stand-in. The same code runs against all of them; only the base URL changes.
//
// What a failure means for the agent (the agent looks before it retries, so the difference matters):
//  - no reply (timeout, a connection cut after the request went out): the call MAY have happened, so a TimeoutError;
//  - the connection was refused or the host is unknown: nothing was sent, so a NotSentError (an ApiError, 503). A task's step that meets one waits for that Guard
//    (`waitsForGuard` in faults.ts says which failures wait and why; modules/runtime/guard-wait.ts does the waiting);
//  - an answer with a `guard` object: GUARD decided, and it is never the service's reply, whatever its HTTP status (a held call is
//    a 202). It becomes one of the GuardError kinds in faults.ts, below, in ONE place (`classify`), before any adapter reads a body;
//  - a 200 with `Guard-Replayed: true`: the service's first reply, from Guard's record. It comes back marked `replayed`;
//  - anything else is the service's own reply, passed through as it was: the adapters read it, and any other non-2xx is theirs to
//    turn into an ApiError.
import { GuardAlreadyDoneError, GuardConflictError, GuardDeniedError, GuardError, GuardHeldError, GuardOutcomeUnknownError, GuardRefusedError, GuardSuspendedError, GuardUnauthenticatedError, GuardUnavailableError, NotSentError, TimeoutError } from "./faults.ts";
import type { GuardInfo, SentCall } from "./faults.ts";

export const DEFAULT_TIMEOUT_MS = 10_000;

export interface HttpReply {
  status: number;
  body: unknown;
  /** True when Guard answered from its record instead of sending again (`Guard-Replayed: true`): this is the service's FIRST reply. */
  replayed?: boolean;
}

export interface HttpRequestOptions {
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  /** The exact bytes to send as the body, instead of serialising `body`. A call Guard held is sent again with the bytes it was held with: Guard binds an approval to the call's digest, and `60000` is not `"60000"`. */
  rawBody?: string;
  /** More request headers. Only words for Guard itself go here (`Geo-Requested-By`, which Guard strips before it forwards); never a key of the service. */
  headers?: Record<string, string>;
}

export interface Http {
  /** Returns the service's own reply whatever its status. Throws when there is no reply, when the connection is refused, and for every answer that is Guard's rather than the service's. */
  request(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, options?: HttpRequestOptions): Promise<HttpReply>;
}

/** The base URL is joined by plain concatenation, so a path prefix on it (http://localhost:8790/razorpay) is kept. */
export function joinUrl(baseUrl: string, path: string, query: Record<string, string | number | undefined> = {}): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined) params.set(k, String(v));
  const qs = params.toString();
  return baseUrl.replace(/\/+$/u, "") + path + (qs ? `?${qs}` : "");
}

/** A base URL that holds a password or key is refused: keys belong to Guard, not to the runtime. */
export function checkBaseUrl(baseUrl: string, what: string): string {
  let u: URL;
  try { u = new URL(baseUrl); } catch { throw new Error(`${what}: "${baseUrl}" is not a web address.`); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error(`${what}: the base URL must start with http:// or https://.`);
  if (u.username || u.password) throw new Error(`${what}: the base URL must not hold a user name or password. Keys belong to Guard, not to the runtime.`);
  if (u.search || u.hash) throw new Error(`${what}: the base URL must not have a query or fragment.`);
  return baseUrl;
}

// ---- Guard's answers, told apart in one place ------------------------------------------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The `guard` object of a body, if it is Guard's. Both `decision` and `code` must be words: a service's own body that happens to have a `guard` key is not Guard. */
export function guardObject(body: unknown): GuardInfo | undefined {
  const g = isRecord(body) ? body.guard : undefined;
  if (!isRecord(g) || typeof g.decision !== "string" || typeof g.code !== "string") return undefined;
  return {
    decision: g.decision, code: g.code, sent: typeof g.sent === "string" ? g.sent : "no", retry: typeof g.retry === "string" ? g.retry : "no",
    ...(typeof g.reason_code === "string" ? { reason_code: g.reason_code } : {}),
    ...(typeof g.reason === "string" ? { reason: g.reason } : {}), ...(g.detail !== undefined ? { detail: g.detail } : {}),
  };
}

const milliseconds = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d{1,16}$/u.test(v) ? Number(v) : NaN;
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
};

/** A limit's refusal and a rule's are the same status and the same code; only the words of the reason tell them apart ("limit <id> would be exceeded ..."). */
function refusalKind(reason: string | undefined): { kind: "rule" | "limit"; ruleId?: string } {
  const limit = /^limit\s+(\S+)\s+would be exceeded/iu.exec(reason ?? "");
  if (limit) return { kind: "limit", ruleId: limit[1] };
  const rule = /^([A-Za-z0-9][A-Za-z0-9._:/@+-]*):\s/u.exec(reason ?? "");
  return { kind: "rule", ...(rule ? { ruleId: rule[1] } : {}) };
}

/**
 * Is this answer Guard's decision, and if so which? Returns the error to throw, or undefined when the answer is the service's own
 * (including a replay, which `replayed` reports). Pure, so the tests can feed it the bodies in guard-for-pathways.md.
 * Anything with a `guard` object that this code does not know is still a GuardError: a decision Guard made is never read as a success.
 */
export function classify(status: number, headers: { get(name: string): string | null }, body: unknown, call: SentCall): GuardError | undefined {
  const guard = guardObject(body);
  if (!guard) return undefined;
  const words = isRecord(body) && typeof body.error === "string" ? body.error : guard.reason ?? `Guard answered ${status}.`;
  const reason = guard.reason ?? words;
  if (guard.decision === "hold" || guard.code === "held_for_approval") {
    const detail = isRecord(guard.detail) ? guard.detail : {};
    const header = headers.get("guard-held")?.trim();
    const approval = typeof detail.approval === "string" && detail.approval.length > 0 ? detail.approval : header ? header : null;
    return new GuardHeldError(status, words, guard, call, approval, milliseconds(detail.expires_at_ms));
  }
  // the licence (B13, ADR-0062): Guard's own refusal, a 402, not a policy denial. The runtime's own licence refusal, made outside it: never retried, never queued.
  if (guard.code === "subscription_suspended" || guard.reason_code === "subscription_suspended") return new GuardSuspendedError(status, words, guard, call);
  if (guard.code === "outcome_unknown" || guard.decision === "unknown" || headers.get("guard-outcome")?.toLowerCase() === "unknown") return new GuardOutcomeUnknownError(status, words, guard, call);
  if (guard.code === "guard_unavailable" || guard.code === "busy" || guard.code === "provider_unreachable") {
    const header = headers.get("retry-after");
    const after = header === null || header.trim() === "" ? NaN : Number(header);
    return new GuardUnavailableError(status, words, guard, call, Number.isFinite(after) && after >= 0 ? after : undefined);
  }
  if (guard.code === "unauthenticated") return new GuardUnauthenticatedError(status, words, guard, call);
  // a settled repeat (ADR-0060): the same code as "the same action with other arguments", told apart by reason_code. Done, by a person's word.
  if (guard.code === "conflict" && guard.reason_code === "already_done") return new GuardAlreadyDoneError(status, words, guard, call);
  if (guard.code === "conflict") return new GuardConflictError(status, words, guard, call);
  // a person said no to this exact call (monorepo ADR-0061 addendum, 12 Nov 2026): the same code as any refusal, told apart by reason_code. The owner's no.
  if (guard.code === "refused_by_policy" && guard.reason_code === "denied_by_approver") return new GuardDeniedError(status, words, guard, call);
  if (guard.code === "refused_by_policy") {
    const { kind, ruleId } = refusalKind(reason);
    return new GuardRefusedError(status, words, guard, call, kind, ruleId);
  }
  return new GuardError(status, words, guard, call);
}

const NOT_SENT = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH", "ERR_INVALID_URL"]);

/** Node's fetch wraps the real cause in `error.cause`. */
function causeCode(e: unknown): string | undefined {
  const cause = (e as { cause?: { code?: string } } | undefined)?.cause;
  return cause?.code ?? (e as { code?: string } | undefined)?.code;
}

/**
 * `agentToken` is the credential a Guard asks of the AGENT (`Authorization: Bearer ...`), never a key of the service: Guard removes it
 * before it forwards the call. It is off unless given, so a runtime pointed at a stand-in sends no Authorization header at all.
 */
export function createHttp(baseUrl: string, what: string, timeoutMs: number = DEFAULT_TIMEOUT_MS, agentToken?: string): Http {
  checkBaseUrl(baseUrl, what);
  return {
    async request(method, path, options = {}) {
      const url = joinUrl(baseUrl, path, options.query);
      const headers: Record<string, string> = { accept: "application/json" };
      for (const [k, v] of Object.entries(options.headers ?? {})) if (!/^(authorization|host|content-type|content-length|accept)$/iu.test(k)) headers[k.toLowerCase()] = v;
      if (agentToken) headers.authorization = `Bearer ${agentToken}`;
      let body: string | undefined;
      if (options.rawBody !== undefined) { body = options.rawBody; headers["content-type"] = "application/json"; }
      else if (options.body !== undefined) { body = JSON.stringify(options.body); headers["content-type"] = "application/json"; }
      let response: Response;
      try {
        response = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(timeoutMs) });
      } catch (e) {
        const code = causeCode(e);
        if (code && NOT_SENT.has(code)) throw new NotSentError(`${what}: could not connect (${code}).`, code);
        throw new TimeoutError(what); // timed out, or the connection was cut after the request left: it may have happened
      }
      let text: string;
      try { text = await response.text(); } catch { throw new TimeoutError(what); } // the reply broke off half way
      let parsed: unknown;
      if (text.length > 0) {
        try { parsed = JSON.parse(text); } catch {
          if (response.ok) throw new TimeoutError(what); // a 2xx we cannot read is a lost reply
          parsed = { raw: text.slice(0, 200) };
        }
      }
      const call: SentCall = { method, path, ...(body !== undefined ? { body } : {}) };
      const decided = classify(response.status, response.headers, parsed, call); // Guard's decision, before any adapter reads the body
      if (decided) throw decided;
      const replayed = response.status >= 200 && response.status < 300 && response.headers.get("guard-replayed")?.toLowerCase() === "true";
      return { status: response.status, body: parsed, ...(replayed ? { replayed: true } : {}) };
    },
  };
}

// Replies from services are untyped by nature; adapters narrow with the helpers below instead of trusting a shape.
export type Json = Record<string, any>;
// The plain-object check the narrowing helpers share; arrays are excluded because a service returning a list where an object is expected is a fault, not data.
export const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
// Returns [] for anything else so a missing list in a reply reads as empty rather than crashing the adapter.
export const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
// Narrows a reply field to a string or undefined, never coercing, so a wrong type in a reply is treated as absent.
export const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
// Rejects NaN and Infinity as well as non-numbers, because an amount that is not finite must never reach money code.
export const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
