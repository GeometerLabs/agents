// The owner-control helpers every runtime contract needs, written once (moved here from the listings owner-control contract so the Bookings contract uses the same ones): a
// phone registering a passkey with a grant (the Operator's QR, a recovery code, an "add a phone" link, Geometer's reset QR), signing in with it, the phones page, what the panel's
// probe sees, the Operator's grants file as the panel writes it, and the record lines the tick writes. They take the shop through the structural type below, so a listings shop and
// a Bookings shop both fit. The passkey itself is the soft authenticator (modules/channels/test/soft-authenticator.ts).
import assert from "node:assert/strict";
import { SETUP_MS, REMOVAL_WAIT_MS, recoveryHash, setupHash } from "../../channels/owner-grants.ts";
import { newSoftPasskey, softRegister, softSignin } from "../../channels/test/soft-authenticator.ts";
import type { SoftPasskey } from "../../channels/test/soft-authenticator.ts";
import type { Answer, CallOptions } from "./runtime-process.ts";

/** What a shop handle must offer for these helpers: HTTP, its clock, its record and its log. */
export interface OwnerShop {
  setup: string;
  call(path: string, o?: Omit<CallOptions, "token"> & { token?: string | null }): Promise<Answer>;
  now(): number;
  record(): { action: string; outcome: string; refs: Record<string, string> }[];
  log(): string;
}
export type Grant = { kind: "setup"; token: string } | { kind: "recovery"; code: string };
export const qr = (token: string): Grant => ({ kind: "setup", token });
export const code = (c: string): Grant => ({ kind: "recovery", code: c });
export const iso = (t: number): string => new Date(t).toISOString();
export const MIN = 60_000;

/** The helpers for a shop whose owner pages live under `ownerBase` (the passkey's relying party is that address's host and origin). */
export function ownerKit(ownerBase: string) {
  const rp = { rpId: new URL(ownerBase).hostname, origin: new URL(ownerBase).origin };

  /** The Operator's file as the panel writes it, every time taken from the shop's clock: a QR (15 minutes), a card, a request. */
  function grants(s: OwnerShop, o: { token?: string; expiresAt?: string; codes?: string[]; pending?: { askedAt: number; by?: string }; passkeysBefore?: string } = {}): Record<string, unknown> {
    const now = s.now();
    return {
      schema: 1,
      ...(o.token ? { setup: { sha256: setupHash(o.token), createdAt: iso(now), expiresAt: o.expiresAt ?? iso(now + SETUP_MS) } } : {}),
      ...(o.codes ? { recovery: { codes: o.codes.map(recoveryHash), createdAt: iso(now) } } : {}),
      ...(o.passkeysBefore ? { passkeysBefore: o.passkeysBefore } : {}),
      ...(o.pending ? { pendingRemoval: { askedBy: o.pending.by ?? "Divya", askedAt: iso(o.pending.askedAt), effectiveAt: iso(o.pending.askedAt + REMOVAL_WAIT_MS) } } : {}),
    };
  }
  const passkey = (s: OwnerShop, op: string, extra: Record<string, unknown> = {}) => s.call("/internal/channel/owner-passkey", { body: { op, ...extra } });
  const grantState = async (s: OwnerShop, g: Grant): Promise<string> => (await passkey(s, "grant_state", { grant: g })).body.state;
  /** A phone registers with a grant. */
  async function register(s: OwnerShop, g: Grant, ua = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"): Promise<{ phone: SoftPasskey; session: string }> {
    const ro = await passkey(s, "register_options", { grant: g });
    assert.equal(ro.status, 200, `register_options: ${JSON.stringify(ro.body)}`);
    const phone = newSoftPasskey(rp.rpId);
    const r = await passkey(s, "register", { grant: g, response: softRegister(phone, ro.body.options, rp.origin), ua });
    assert.equal(r.status, 200, `register: ${JSON.stringify(r.body)}`);
    return { phone, session: r.body.session as string };
  }
  /** How many passkeys the shop offers at sign-in now (0: the passkey button is not shown). */
  const offered = async (s: OwnerShop): Promise<number> => (await passkey(s, "signin_options")).body.count;
  /** A phone signs in with its passkey: the status, and the new session on 200. */
  async function signin(s: OwnerShop, phone: SoftPasskey): Promise<{ status: number; session?: string }> {
    const so = await passkey(s, "signin_options");
    if (!so.body.options) return { status: 0 };
    const r = await passkey(s, "signin", { response: softSignin(phone, so.body.options, rp.origin) });
    return { status: r.status, ...(r.status === 200 ? { session: r.body.session as string } : {}) };
  }
  /** Is this session good now? (The inbox's question, with the internal token.) */
  const good = async (s: OwnerShop, session: string): Promise<boolean> => (await s.call("/internal/owner-session", { session })).status === 204;
  const phones = (s: OwnerShop, session: string | undefined, body: Record<string, unknown>, owner?: string) => s.call("/internal/channel/owner-phones", { ...(session ? { session } : {}), ...(owner ? { owner } : {}), body });
  /** The owner's phones page data, for the phone that holds `session`. */
  async function list(s: OwnerShop, session: string): Promise<any> {
    const r = await phones(s, session, { op: "list" });
    assert.equal(r.status, 200, `list: ${JSON.stringify(r.body)}`);
    return r.body;
  }
  /** What the panel's probe sees (/status, the internal token): the passkeys, whether the shop is locked, and the Operator's pending request. */
  const panel = async (s: OwnerShop): Promise<{ passkeys: number; alertPhones: number; locked?: boolean; removal?: { askedBy: string; effectiveAt: string } }> => (await s.call("/status")).body.ownerAccess;
  /** The record's owner_session lines with this `what` (the tick writes the request notices). */
  const lines = (s: OwnerShop, what: string) => s.record().filter((r) => r.action === "owner_session" && r.refs.what === what);
  /** Wait until the tick has written `n` lines with this `what` (a 1-second tick), then a little more, to see that no second one comes. */
  async function told(s: OwnerShop, what: string, n = 1): Promise<void> {
    for (let i = 0; i < 100 && lines(s, what).length < n; i++) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 2500)); // two more ticks
    assert.equal(lines(s, what).length, n, `${what} lines in the record:\n${s.log()}`);
  }
  /** Within a minute of the expected moment (the panel shows effectiveAt as an ISO time). */
  const near = (actual: string | number | undefined, expected: number, what: string): void => {
    const t = typeof actual === "string" ? Date.parse(actual) : actual;
    assert.ok(t !== undefined && Math.abs(t - expected) < MIN, `${what}: ${actual === undefined ? "none" : iso(t!)}, expected about ${iso(expected)}`);
  };
  return { rp, grants, passkey, grantState, register, offered, signin, good, phones, list, panel, lines, told, near };
}
