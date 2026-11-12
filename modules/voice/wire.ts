// The HTTP the speech and media calls need and modules/core/http.ts does not do: a multipart body going out (the audio) and raw bytes coming back (the audio), with
// the same Guard classification as every other live adapter (core/http.ts `classify`): an answer with a `guard` object is Guard's decision, never the provider's reply.
// Like core/http.ts it holds no key: the base URL is a Guard in front of the provider, `agentToken` is only this agent's credential for that Guard.
// Short timeouts on purpose (voice calls never wait on a down Guard: see voice.ts), so a slow provider costs the customer one line asking to type, not the shop's queue.
import { NotSentError, TimeoutError } from "../core/faults.ts";
import type { SentCall } from "../core/faults.ts";
import { checkBaseUrl, classify, joinUrl } from "../core/http.ts";

export interface WireReply { status: number; contentType: string; bytes: Uint8Array; /** The body read as JSON, when it is JSON. */ json?: unknown }

export interface WireOptions {
  query?: Record<string, string | number | undefined>;
  /** Sent as a JSON body. */
  json?: unknown;
  /** Sent as multipart/form-data (the audio is one part). */
  form?: FormData;
  /** The most bytes of a reply to accept; more is cut off as an error (a download is never allowed to fill memory). */
  maxBytes?: number;
}

export interface Wire { request(method: "GET" | "POST", path: string, options?: WireOptions): Promise<WireReply> }

const NOT_SENT = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH", "ERR_INVALID_URL"]);

export function createWire(baseUrl: string, what: string, timeoutMs: number, agentToken?: string): Wire {
  checkBaseUrl(baseUrl, what);
  return {
    async request(method, path, o = {}) {
      const url = joinUrl(baseUrl, path, o.query);
      const headers: Record<string, string> = {};
      if (agentToken) headers.authorization = `Bearer ${agentToken}`;
      let body: string | FormData | undefined;
      if (o.form) body = o.form;
      else if (o.json !== undefined) { body = JSON.stringify(o.json); headers["content-type"] = "application/json"; }
      let res: Response;
      try { res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(timeoutMs) }); }
      catch (e) {
        const cause = (e as { cause?: { code?: string } }).cause?.code;
        if (cause && NOT_SENT.has(cause)) throw new NotSentError(`${what}: could not connect (${cause}).`, cause);
        throw new TimeoutError(what);
      }
      const contentType = res.headers.get("content-type") ?? "";
      const max = o.maxBytes ?? 16 * 1024 * 1024;
      const declared = Number(res.headers.get("content-length") ?? 0);
      if (declared > max) throw new TimeoutError(`${what} (the reply was larger than ${max} bytes)`);
      let bytes: Uint8Array;
      try { bytes = new Uint8Array(await res.arrayBuffer()); } catch { throw new TimeoutError(what); }
      if (bytes.length > max) throw new TimeoutError(`${what} (the reply was larger than ${max} bytes)`);
      let json: unknown;
      if (/json/iu.test(contentType) || bytes[0] === 0x7b) { try { json = JSON.parse(new TextDecoder().decode(bytes)); } catch { json = undefined; } }
      const call: SentCall = { method, path };
      const decided = classify(res.status, res.headers, json, call);
      if (decided) throw decided;
      return { status: res.status, contentType, bytes, ...(json !== undefined ? { json } : {}) };
    },
  };
}
