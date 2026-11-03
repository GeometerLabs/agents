// The one way the live adapters talk HTTP. They hold no keys: they send no Authorization header, ever. Each adapter points at a
// base URL, which in production is a Guard instance in front of that one service (Guard adds the credential) and in a test is a
// stand-in. The same code runs against all of them; only the base URL changes.
//
// What a failure means for the agent (the agent looks before it retries, so the difference matters):
//  - no reply (timeout, a connection cut after the request went out): the call MAY have happened, so a TimeoutError;
//  - the connection was refused or the host is unknown: nothing was sent, so an ApiError (503);
//  - any other non-2xx answer: an ApiError with that status.
import { ApiError, TimeoutError } from "../faults.ts";

export const DEFAULT_TIMEOUT_MS = 10_000;

export interface HttpReply { status: number; body: unknown }

export interface Http {
  /** Returns the reply whatever its status; only "no reply" and "could not connect" throw. */
  request(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, options?: { query?: Record<string, string | number | undefined>; body?: unknown }): Promise<HttpReply>;
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

const NOT_SENT = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH", "ERR_INVALID_URL"]);

/** Node's fetch wraps the real cause in `error.cause`. */
function causeCode(e: unknown): string | undefined {
  const cause = (e as { cause?: { code?: string } } | undefined)?.cause;
  return cause?.code ?? (e as { code?: string } | undefined)?.code;
}

export function createHttp(baseUrl: string, what: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): Http {
  checkBaseUrl(baseUrl, what);
  return {
    async request(method, path, options = {}) {
      const url = joinUrl(baseUrl, path, options.query);
      const headers: Record<string, string> = { accept: "application/json" };
      let body: string | undefined;
      if (options.body !== undefined) { body = JSON.stringify(options.body); headers["content-type"] = "application/json"; }
      let response: Response;
      try {
        response = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(timeoutMs) });
      } catch (e) {
        const code = causeCode(e);
        if (code && NOT_SENT.has(code)) throw new ApiError(503, `${what}: could not connect (${code}).`);
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
      return { status: response.status, body: parsed };
    },
  };
}

export type Json = Record<string, any>;
export const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
export const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
export const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
