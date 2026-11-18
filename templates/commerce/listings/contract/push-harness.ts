// What the contract needs to test a shop's web push: a FAKE push Guard (the HTTP server the runtime posts each encrypted push to, modules/push/sender.ts), a browser that can open
// what it is sent (the other end of RFC 8291), and the one edit to a shop's folder that turns push on (runtime.json `services.push`, as the deployer writes it). A separate file so
// harness.ts stays as it is; both runtimes (LISTINGS_IMPL=ts|go) read the same runtime.json, so this serves both.
import { createServer } from "node:http";
import type { Server } from "node:http";
import { createECDH, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decryptPush, readVapidHeader, vapidVerifies } from "../../../../modules/push/crypto.ts";
import type { PushCall } from "../../../../modules/push/hosts.ts";
import type { Shop } from "./harness.ts";

/** One call the fake Guard heard: the route, the credential the runtime presented, and the JSON it posted. */
export interface GuardCall { path: string; authorization: string | undefined; call: PushCall }

export interface FakeGuard {
  url: string;
  /** Every call, oldest first. */
  calls: GuardCall[];
  /** What the Guard answers to the next calls (default 201, a push service's "created"); the body names a reason when `reason` is given (a Guard's own refusal). */
  answer: { status: number; reason?: string };
  close(): Promise<void>;
}

export async function startFakeGuard(): Promise<FakeGuard> {
  const guard: FakeGuard = { url: "", calls: [], answer: { status: 201 }, close: async () => undefined };
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      let call = {} as PushCall;
      try { call = JSON.parse(Buffer.concat(chunks).toString("utf8")) as PushCall; } catch { /* leave empty: the test sees it */ }
      guard.calls.push({ path: req.url ?? "", authorization: req.headers.authorization, call });
      res.writeHead(guard.answer.status, { "content-type": "application/json" });
      res.end(JSON.stringify(guard.answer.reason ? { reason_code: guard.answer.reason } : { ok: true }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  guard.url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  guard.close = () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); });
  return guard;
}

/** The credential the runtime presents to the Guard, as services.push.agentTokenFile names it. */
export const GUARD_TOKEN = "guard-agent-credential";

/** Turn push on for a shop that has not started yet: runtime.json names the push Guard, and the credential file beside the shop's secrets. */
export function enablePush(shop: Shop, guard: FakeGuard): void {
  const file = join(shop.client, "runtime.json");
  const runtime = JSON.parse(readFileSync(file, "utf8")) as { services: Record<string, unknown> };
  const tokenFile = join(shop.root, "secrets", "push_agent_token");
  writeFileSync(tokenFile, GUARD_TOKEN);
  runtime.services = { ...runtime.services, push: { baseUrl: guard.url, agentTokenFile: tokenFile } };
  writeFileSync(file, JSON.stringify(runtime));
}

/** A phone's browser: a P-256 key and an auth secret, a subscription at one of the push services the Guard allows, and the means to open what is sent to it. */
export interface SoftBrowser {
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
  /** The words and tag a call to the Guard carries, opened with this browser's key (throws for a push meant for another browser). */
  open(call: PushCall): { title: string; body: string; tag: string };
}

export function softBrowser(host = "fcm.googleapis.com"): SoftBrowser {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = randomBytes(16);
  const keys = { privateKey: ecdh.getPrivateKey(), publicKey: ecdh.getPublicKey(), auth };
  return {
    subscription: { endpoint: `https://${host}/fcm/send/${randomBytes(18).toString("base64url")}`, keys: { p256dh: keys.publicKey.toString("base64url"), auth: auth.toString("base64url") } },
    open: (call) => JSON.parse(decryptPush(Buffer.from(call.body, "base64url"), keys).toString("utf8")) as { title: string; body: string; tag: string },
  };
}

/** Does this call's VAPID header carry a signature that verifies under the shop's public key (the one the `key` op gives), for the push service named in the call? */
export function vapidChecks(call: PushCall, publicKey: string): boolean {
  const v = readVapidHeader(call.vapid ?? "");
  if (!v || v.k !== publicKey || !vapidVerifies(v.t, publicKey)) return false;
  const claims = JSON.parse(Buffer.from(v.t.split(".")[1], "base64url").toString("utf8")) as { aud: string; exp: number; sub: string };
  return claims.aud === `https://${call.host}` && claims.exp > Date.now() / 1000 && /^https?:\/\//u.test(claims.sub);
}
