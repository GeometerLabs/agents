// Vector cases for go/internal/guard: the shared HTTP client and Guard's answers told apart (modules/core/http.ts, faults.ts). Each case runs the TypeScript `createHttp` against a
// scripted server; the Go client must send the same bytes and read the same answer. Also the byte helpers the Go clients rely on (JSON.stringify, encodeURIComponent, URLSearchParams).
import { createHttp } from "../../../modules/core/http.ts";
import { recordCase } from "../lib/record.ts";
import type { Case, Scripted } from "../lib/record.ts";
import { guardNames, guardReply, ok, status } from "./fixtures.ts";

interface Req { method: "GET" | "POST" | "PATCH" | "DELETE"; path: string; query?: [string, string][]; body?: unknown; bodyText?: string; form?: [string, string][]; headers?: Record<string, string> }

/** One request through createHttp; the reply (status, body, replayed) or the error is the outcome. */
async function viaHttp(name: string, replies: Scripted[], req: Req, opts: { timeoutMs?: number; agentToken?: string; baseSuffix?: string; closed?: boolean } = {}): Promise<Case> {
  return recordCase(name, replies, async (base) => {
    const http = createHttp(base, "Test", opts.timeoutMs, opts.agentToken);
    const r = await http.request(req.method, req.path, {
      ...(req.query ? { query: Object.fromEntries(req.query) } : {}), ...(req.body !== undefined ? { body: req.body } : {}), ...(req.bodyText !== undefined ? { rawBody: req.bodyText } : {}),
      ...(req.form ? { form: Object.fromEntries(req.form) } : {}), ...(req.headers ? { headers: req.headers } : {}),
    });
    return r;
  }, { baseSuffix: opts.baseSuffix, closed: opts.closed, config: { request: req, timeoutMs: opts.timeoutMs ?? 0, agentToken: opts.agentToken ?? "", baseSuffix: opts.baseSuffix ?? "", closed: opts.closed ?? false } });
}

export async function guardCases(): Promise<Case[]> {
  const get: Req = { method: "GET", path: "/v1/x" };
  const out: Case[] = [];
  // every Guard answer, read as the one error it is (or as the service's own reply)
  for (const n of guardNames) out.push(await viaHttp(`guard answer: ${n}`, [guardReply(n)], { method: "POST", path: "/v1/payments/pay_1/refund", body: { amount: 100 } }));
  // Guard's words that the fixtures do not carry: odd shapes of the guard object
  const shapes: [string, Scripted][] = [
    ["a guard object with no code is the service's own", status(200, { guard: { decision: "deny" }, id: 1 })],
    ["a guard object that is not an object is the service's own", status(200, { guard: "yes" })],
    ["an unknown code is still a Guard error", status(403, { error: "no", guard: { decision: "deny", code: "something_new", reason: "r" } })],
    ["hold with the approval in the header only", { status: 202, headers: { "guard-held": " ap-1 " }, body: { guard: { decision: "hold", code: "held_for_approval" } } }],
    ["hold with expires_at_ms as a digit string", status(202, { guard: { decision: "hold", code: "held_for_approval", detail: { approval: "ap-2", expires_at_ms: "1793712060824" } } })],
    ["hold with a bad expires_at_ms", status(202, { guard: { decision: "hold", code: "held_for_approval", detail: { approval: "ap-2", expires_at_ms: -5 } } })],
    ["hold with an empty approval and no header", status(202, { guard: { decision: "hold", code: "held_for_approval", detail: { approval: "" } } })],
    ["outcome unknown by the header alone", { status: 502, headers: { "guard-outcome": "Unknown" }, body: { guard: { decision: "deny", code: "other" } } }],
    ["busy with a retry-after that is not a number", { status: 503, headers: { "retry-after": "soon" }, body: { guard: { decision: "deny", code: "busy" } } }],
    ["busy with retry-after 2.5", { status: 503, headers: { "retry-after": " 2.5 " }, body: { guard: { decision: "deny", code: "busy" } } }],
    ["a refusal by rule id in the reason", status(403, { error: "refused", guard: { decision: "deny", code: "refused_by_policy", reason: "deposit-amount: amount 5 is below the lowest allowed value, 10" } })],
    ["a refusal with a limit reason in capitals", status(403, { error: "refused", guard: { decision: "deny", code: "refused_by_policy", reason: "LIMIT links-per-hour WOULD BE EXCEEDED (60 of 60)" } })],
    ["a refusal with no reason uses the error words", status(403, { error: "refused by the Guard: x", guard: { decision: "deny", code: "refused_by_policy" } })],
    ["no error and no reason: the status in words", status(418, { guard: { decision: "deny", code: "something_else" } })],
    ["an empty reason is a reason", status(403, { error: 5, guard: { decision: "deny", code: "refused_by_policy", reason: "" } })],
    ["denied with a detail", status(403, { error: "no", guard: { decision: "deny", code: "refused_by_policy", reason_code: "denied_by_approver", detail: { approval: "ap-9", denied_at_ms: 1793700000000, until_ms: 1793786400000 } } })],
    ["already done with a long intent", status(409, { error: "done", guard: { decision: "deny", code: "conflict", reason_code: "already_done", detail: { confirmed_by: "operator:" + "x".repeat(300), intent: "intent:abc" } } })],
    ["suspended by reason_code only", status(402, { error: "off", guard: { decision: "deny", code: "refused_by_policy", reason_code: "subscription_suspended", detail: { state: "wind_down", operation: "create_link" } } })],
  ];
  for (const [n, r] of shapes) out.push(await viaHttp(`guard shape: ${n}`, [r], { method: "POST", path: "/v1/payments/pay_1/refund", body: { amount: 100 } }));

  // the service's own replies and failures
  out.push(await viaHttp("a plain 200 with a JSON body", [ok({ id: "x", n: 12, f: 1.5 })], get));
  out.push(await viaHttp("a 204 with no body", [{ status: 204 }], get));
  out.push(await viaHttp("a 404 with a JSON error", [status(404, { error: { description: "gone" } })], get));
  out.push(await viaHttp("a non-JSON 502 is cut at 200 characters", [{ status: 502, text: "<html>" + "é".repeat(150) + "😀".repeat(40) + "</html>" }], get));
  out.push(await viaHttp("a non-JSON 200 is a lost reply", [{ status: 200, text: "OK, done" }], get));
  out.push(await viaHttp("a half-read JSON 200 (two values) is a lost reply", [{ status: 200, text: "{} {}" }], get));
  out.push(await viaHttp("a JSON array body", [ok([1, 2, 3])], get));
  out.push(await viaHttp("a reply that never comes is a timeout", [{ hang: true }], get, { timeoutMs: 150 }));
  out.push(await viaHttp("a cut connection is a timeout", [{ cut: true }], get));
  out.push(await viaHttp("nothing listens: not sent", [], get, { closed: true }));

  // the request's bytes
  out.push(await viaHttp("an agent token is sent as a bearer", [ok({})], get, { agentToken: "agent-secret" }));
  out.push(await viaHttp("no agent token, no Authorization", [ok({})], get));
  out.push(await viaHttp("a path prefix on the base URL is kept", [ok({})], { ...get, path: "/v1/payments/pay_1" }, { baseSuffix: "/razorpay/" }));
  out.push(await viaHttp("the query keeps its order and encodes as a form", [ok({})], { ...get, query: [["z", "1"], ["a", "x y"], ["m", "a&b=c~*'()!é"], ["empty", ""]] }));
  out.push(await viaHttp("a JSON body", [ok({})], { method: "POST", path: "/v1/p", body: { amount: 60000, description: "Cut & colour <b>é</b>     \u0008 \u007f", n: null } }));
  out.push(await viaHttp("a raw body is sent as it is", [ok({})], { method: "POST", path: "/v1/p", bodyText: "{\"amount\":\"60000\" }" }));
  out.push(await viaHttp("a form body", [ok({})], { method: "POST", path: "/v1/p", form: [["a", "1 2"], ["b", "é&"]] }));
  out.push(await viaHttp("reserved headers are ignored, others lower-cased", [ok({})], { method: "POST", path: "/v1/p", body: {}, headers: { Authorization: "Bearer x", "Content-Type": "text/plain", Accept: "x", "Geo-Requested-By": "a,b", "X-Test": "1", Host: "evil" } }, { agentToken: "tok" }));
  return out;
}

/** What JSON.stringify, encodeURIComponent and URLSearchParams give on awkward text: the Go helpers must give the same. */
export function byteVectors(): unknown {
  const texts = ["plain", "a&b<c>d", "x y z", "\\u2028 literally", "tab\there\nnew\r\u0008\u000c\u0001\u001f\u007f", "quote\" back\\slash", "é ü 日本語 😀", "a b+c/d?e#f", "@:;,=$&+", "~*'()!-_.", "%41", ""];
  return {
    json: texts.map((s) => ({ s, out: JSON.stringify({ s }) })),
    component: texts.map((s) => ({ s, out: encodeURIComponent(s) })),
    query: texts.map((s) => ({ s, out: new URLSearchParams({ k: s }).toString() })),
    reemit: ["{ \"b\": 1, \"a\": [1, 2.0, -0, 1e2, 1.5e-7, 12345678901234567890], \"2\": \"x\", \"1\": null }", "{\"k\":1,\"j\":2,\"k\":3}", "[ ]", "{\"s\":\"a&b<c>\\u2028\\u00e9\\ud83d\\ude00\"}", " \"top\" ", "{\"01\":1,\"1\":2,\"x\":{\"b\":true,\"a\":false}}", "123456789012345678", "0.1", "1e21", "1E+25", "0.000001", "0.0000001", "-1.25e3"].map((i) => ({ in: i, out: JSON.stringify(JSON.parse(i)) })),
  };
}
