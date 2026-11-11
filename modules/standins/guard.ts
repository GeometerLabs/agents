// A stub Guard in front of a gateway's stand-in: it speaks Guard's documented shapes (monorepo docs/guard-for-pathways.md) for the
// refund route, so the runtime, the approvals relay and the tests can be run end to end without the real Guard. It is not Guard:
// the behaviour it has is the model in modules/payments/guard-model.ts (built from the generated spec), which is checked against the
// real binary in test/approvals-guard-binary.test.ts. Every other route is passed through to the stand-in unchanged.
//
// Two ports, as in a real deployment:
//   the agent port   the runtime's only way out: a refund above the spec's threshold is held (202), a held one is sent again after an approval;
//   the admin port   GET /admin/reviews (an approver's bearer token) and POST /admin/notify (a body signed with the owner's secret).
// Neither ever sends the stand-in an approval: the call is forwarded with the body it came with.
import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { createGuardModel } from "../payments/guard-model.ts";
import type { GuardModel } from "../payments/guard-model.ts";
import type { Clock } from "../core/clock.ts";
import type { LimitsSpec } from "../payments/guard-limits.ts";

export interface StubGuardConfig {
  clock: Clock;
  /** The service behind it, for example the stand-ins' URL. */
  upstreamUrl: string;
  /** The generated limits spec: the threshold and the approval time are read from it, as Guard reads them from the bundle. */
  spec: LimitsSpec;
  /** Use this model instead of a new one, so something else in the same process (a payments fake) shares the same holds. */
  model?: GuardModel;
  /** The agent id the review queue names. */
  agentId?: string;
  /** If given, every call on the agent port must carry it as `Authorization: Bearer ...`; otherwise any caller is let in. */
  agentToken?: string;
  /** The owner as an approver: its id and the secret that signs a notification. */
  approver: { id: string; secret: string };
  /** B37: the other people who may approve, each signing with their own secret (the model is given the same directory). */
  others?: { id: string; secret: string }[];
  /** The bearer token that may read GET /admin/reviews (an approver's credential). */
  readToken: string;
}

export interface RunningStubGuard {
  agentUrl: string;
  adminUrl: string;
  model: GuardModel;
  /** Every call that reached the agent port: method, path, and the body as it came. */
  calls: { method: string; path: string; body: string }[];
  /** Every notification that was accepted, in order. */
  accepted: { approval: string; decision: string; approver: string }[];
  /** How many notifications were refused, and why (signature, time, nonce, approver). */
  refused: string[];
  /** The kill switch: every call on the agent port is answered 503 guard_unavailable until it is off. */
  killSwitch(on: boolean): void;
  /** The next refund that would be sent gets this instead: Guard cannot reach the service, or the answer is lost after it was sent. */
  failNext(how: "unreachable" | "outcome_unknown"): void;
  close(): Promise<void>;
}

const FIVE_MINUTES = 5 * 60_000;

function readRaw(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text), ...headers });
  res.end(text);
}

const bearer = (req: IncomingMessage) => /^bearer\s+(\S+)$/iu.exec(String(req.headers.authorization ?? ""))?.[1];
const same = (a: string | undefined, b: string) => a !== undefined && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// Starts a local stand-in for Guard so adapters can be tested through the same hop they have in production, including held and blocked answers.
export async function startStubGuard(config: StubGuardConfig): Promise<RunningStubGuard> {
  const model = config.model ?? createGuardModel(config.spec, config.clock);
  const agentId = config.agentId ?? "runtime-glow-salon";
  const calls: RunningStubGuard["calls"] = [];
  const accepted: RunningStubGuard["accepted"] = [];
  const refused: string[] = [];
  const nonces = new Set<string>();
  let killed = false;
  let failure: "unreachable" | "outcome_unknown" | undefined;
  // The refund route is the spec's own (B71: whichever gateway the spec is for): the route of the operation the owner's approval rule is about, its {param} the payment.
  const refundOp = (config.spec.rules as { id: string; operation: string }[]).find((r) => r.id === "refund-needs-owner")?.operation;
  const refundRoute = (config.spec.routes as { method: string; path: string; operation: string }[]).find((r) => r.operation === refundOp);
  if (!refundRoute) throw new Error("The spec has no route for its refund operation, so this stub Guard cannot stand in front of it.");
  const refundPath = new RegExp(`^${refundRoute.path.replace(/[.*+?^$()|[\]\\]/gu, "\\$&").replace(/\\?\{[^}]+\\?\}/gu, "([^/?]+)")}$`, "u");

  const decision = (code: string, sent: string, retry: string, reason?: string, detail: unknown = null) => ({ decision: code === "outcome_unknown" ? "unknown" : code === "held_for_approval" ? "hold" : "deny", code, sent, retry, ...(reason ? { reason } : {}), detail });

  async function forward(req: IncomingMessage, res: ServerResponse, path: string, raw: Buffer): Promise<{ status: number; text: string } | undefined> {
    try {
      const response = await fetch(config.upstreamUrl.replace(/\/+$/u, "") + path, {
        method: req.method, headers: { ...(raw.length > 0 ? { "content-type": String(req.headers["content-type"] ?? "application/json") } : {}), accept: "application/json" },
        body: raw.length > 0 ? raw : undefined, signal: AbortSignal.timeout(8_000),
      });
      return { status: response.status, text: await response.text() };
    } catch {
      return undefined;
    }
  }

  const agentServer: Server = createServer(async (req, res) => {
    const raw = await readRaw(req);
    const path = req.url ?? "/";
    calls.push({ method: req.method ?? "", path, body: raw.toString("utf8") });
    if (config.agentToken !== undefined && !same(bearer(req), config.agentToken)) {
      json(res, 401, { error: "authentication required: a per-agent credential issued by this Guard", guard: decision("unauthenticated", "no", "no") });
      return;
    }
    if (killed) { json(res, 503, { error: "refused by the Guard: kill switch engaged: test", guard: decision("guard_unavailable", "no", "later", "kill switch engaged: test") }); return; }

    const refund = req.method === refundRoute.method ? refundPath.exec(path) : null;
    if (!refund) {
      const answer = await forward(req, res, path, raw);
      if (!answer) { json(res, 502, { error: "refused by the Guard: the provider is unreachable; nothing was sent", guard: decision("provider_unreachable", "no", "later", "the provider is unreachable; nothing was sent") }); return; }
      res.writeHead(answer.status, { "content-type": "application/json" });
      res.end(answer.text);
      return;
    }

    const paymentId = decodeURIComponent(refund[1]);
    let body: unknown;
    try { body = JSON.parse(raw.toString("utf8")); } catch { body = undefined; }
    if (typeof body !== "object" || body === null) { json(res, 403, { error: "refused by the Guard: the body is not readable JSON", guard: decision("refused_by_policy", "no", "no", "the body is not readable JSON") }); return; }

    // B37: who asked for it, as the agent names them. Guard keeps it out of the call (and never forwards it: `forward` sends no header of the caller's)
    const header = String(req.headers["geo-requested-by"] ?? "");
    const requestedBy = header ? header.split(",").map((s) => s.trim()) : undefined;
    if (requestedBy && (requestedBy.length > 8 || requestedBy.some((r) => !/^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/u.test(r)))) { json(res, 400, { error: "refused by the Guard: Geo-Requested-By must be approver ids separated by commas", guard: decision("bad_request", "no", "no", "Geo-Requested-By must be approver ids separated by commas") }); return; }
    const d = model.decideRefund(paymentId, body, requestedBy);
    switch (d.kind) {
      case "hold": {
        const reason = "refund-needs-owner: above the threshold: a person must approve this exact call";
        json(res, 202, { error: `held by the Guard: ${reason}`, guard: decision("held_for_approval", "no", "after_approval", reason, { approval: d.approval, status: "pending", expires_at_ms: d.expiresAtMs }) }, { "guard-held": d.approval });
        return;
      }
      case "hold_uncertain":
        json(res, 202, { error: "held by the Guard: an earlier attempt has an unknown outcome and the provider could not be asked; the Guard will not repeat it", guard: decision("held_for_approval", "no", "after_approval", undefined, { approval: null, status: "pending", expires_at_ms: null }) }, { "guard-held": "" });
        return;
      case "replay":
        res.writeHead(200, { "content-type": "application/json", "guard-replayed": "true", "guard-reason": "the recorded reply is returned and nothing is sent again" });
        res.end(JSON.stringify(d.reply));
        return;
      case "conflict": json(res, 409, { error: `refused by the Guard: ${d.reason}`, guard: decision("conflict", "no", "no", d.reason) }); return;
      case "already_done": json(res, 409, { error: `refused by the Guard: ${d.reason}`, guard: { decision: "deny", code: "conflict", reason_code: "already_done", sent: "no", retry: "no", reason: d.reason, detail: d.detail } }); return;
      case "refused": json(res, 403, { error: `refused by the Guard: ${d.reason}`, guard: decision("refused_by_policy", "no", "no", d.reason) }); return;
      case "pass": break;
    }

    if (failure === "unreachable") {
      failure = undefined;
      json(res, 502, { error: "refused by the Guard: the provider is unreachable (Connection refused); nothing was sent", guard: decision("provider_unreachable", "no", "later", "the provider is unreachable (Connection refused); nothing was sent") });
      return;
    }
    const answer = await forward(req, res, path, raw);
    if (failure === "outcome_unknown" || !answer) {
      failure = undefined;
      model.recordUnknown(paymentId, body);
      const reason = "outcome unknown: the request may or may not have reached the provider. The action may have happened; it is not repeated automatically";
      json(res, 504, { error: `refused by the Guard: ${reason}`, guard: decision("outcome_unknown", "unknown", "do_not_repeat", reason) }, { "guard-outcome": "unknown" });
      return;
    }
    if (answer.status >= 200 && answer.status < 300) {
      try { model.recordSent(paymentId, body, JSON.parse(answer.text)); } catch { model.recordUnknown(paymentId, body); }
    } else if (answer.status >= 500) {
      model.recordUnknown(paymentId, body, answer.status); // a provider 5xx may have happened: passed through as it came, and a repeat is held
    }
    res.writeHead(answer.status, { "content-type": "application/json" });
    res.end(answer.text);
  });

  const adminServer: Server = createServer(async (req, res) => {
    const raw = await readRaw(req);
    const path = (req.url ?? "/").split("?")[0];
    const now = config.clock.now();

    if (req.method === "POST" && path === "/admin/notify") {
      const refuse = (status: number, why: string, message: string) => { refused.push(why); json(res, status, { error: message }); };
      let body: any;
      try { body = JSON.parse(raw.toString("utf8")); } catch { return refuse(400, "not json", "approval and decision are required"); }
      const signer = [config.approver, ...(config.others ?? [])].find((p) => p.id === body?.approver);
      if (!signer) return refuse(401, "approver", "unknown approver: the notification is not accepted");
      const expected = createHmac("sha256", signer.secret).update(raw).digest("hex");
      if (!same(String(req.headers["x-geo-signature"] ?? ""), expected)) return refuse(401, "signature", "signature does not verify: the notification is not accepted and no approval changed");
      const at = Number(body.at_ms);
      if (!Number.isFinite(at)) return refuse(401, "time", "the notification has no time: it is not accepted");
      if (Math.abs(now - at) > FIVE_MINUTES) return refuse(401, "time", "the notification is dated outside five minutes of this Guard's clock: it is not accepted");
      if (typeof body.nonce !== "string" || body.nonce.length < 1 || body.nonce.length > 128) return refuse(401, "nonce", "the notification has no nonce: it is not accepted");
      if (nonces.has(body.nonce)) return refuse(401, "nonce", "this nonce was already used: the notification is not accepted");
      nonces.add(body.nonce);
      if (typeof body.approval !== "string" || (body.decision !== "approve" && body.decision !== "deny")) return refuse(400, "fields", "approval and decision are required");
      const decided = model.decide(body.approval, body.decision === "approve", signer.id);
      if (decided.status !== 200) return refuse(decided.status, `state ${decided.status}`, decided.error);
      accepted.push({ approval: body.approval, decision: body.decision, approver: signer.id });
      const a = decided.approval;
      // a single owner's answer reads as it always did; a vote (B37) is the request itself: its state, the number needed and the votes so far (`approve` a boolean)
      const several = a.needed !== undefined ? { approvals_needed: a.needed, votes: (a.votes ?? []).map((v) => ({ approver: v.approver, approve: v.approve, role: v.role, at_ms: String(v.atMs) })) } : {};
      json(res, 200, { id: a.id, state: a.needed !== undefined ? a.state : body.decision === "approve" ? "approved" : "denied", approver: a.approver ?? signer.id, role: "shop-owner", operation: "refund", tool: config.spec.tool, expires_at_ms: String(a.expiresAtMs), ...several });
      return;
    }
    if (!same(bearer(req), config.readToken)) { json(res, 401, { error: "an admin or approver credential is required (agent credentials do not work here)" }); return; }
    if (req.method === "GET" && path === "/admin/reviews") { json(res, 200, { reviews: model.reviews(agentId, true), warnings: [] }); return; }
    json(res, 404, { error: "no such route" });
  });

  const listen = (server: Server) => new Promise<number>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => resolve((server.address() as { port: number }).port)); });
  const [agentPort, adminPort] = [await listen(agentServer), await listen(adminServer)];
  const close = (server: Server) => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); });
  return {
    agentUrl: `http://127.0.0.1:${agentPort}`, adminUrl: `http://127.0.0.1:${adminPort}`, model, calls, accepted, refused,
    killSwitch(on) { killed = on; },
    failNext(how) { failure = how; },
    close: async () => { await Promise.all([close(agentServer), close(adminServer)]); },
  };
}
