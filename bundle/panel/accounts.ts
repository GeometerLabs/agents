// Accounts, passphrases and invites. Two roles: a builder sees every shop on the server; a partner sees only the shops they set up. Nobody signs
// themselves up: an account exists only because someone with the server (or, on a builder's own server, a builder) made an invite link, and the
// link works once. Passphrases are hashed with scrypt (node:crypto), each with its own salt; invite tokens are kept only as a sha256.
//
// Two more ways in, both narrow:
//  - On Geometer's partner server (hosted mode), a local partner signs in with their geometer.dev account (fleet-signin.ts, plan decision 53). Their account here
//    is made on their first visit from fleet's partner id (`fleetPartner`), one account per partner id, always role "partner". It has NO passphrase: its hash
//    is a marker scrypt never matches, so the sign-in form can never open it, and a pause in fleet (no new ticket) is enough to keep the person out.
//  - A RESET link (made on the command line by whoever runs the server: `geometer panel reset <handle>`) lets a person with a passphrase choose a new one. It works
//    once, runs out, is kept only as a sha256, and signs every session of that account out. An account that signs in with geometer.dev has nothing to reset.
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { ScryptOptions } from "node:crypto";
import type { Store } from "./store.ts";
import { LANGUAGES } from "../../modules/language/languages.ts";
import type { Language } from "../../modules/language/languages.ts";
import { companyOf } from "./contract.ts";

export type Role = "builder" | "partner";
export const ROLES: readonly Role[] = ["builder", "partner"];

export interface Account {
  id: string; handle: string; name: string; company?: string; role: Role; language: Language; hash: string; sessionVersion: number; createdAt: string; invitedBy: string;
  /** Hosted mode: the partner's id in fleet, for an account that signs in with geometer.dev (fleet-signin.ts). Such an account has no passphrase. */
  fleetPartner?: string;
}
/** A one-time link to choose a new passphrase. Only the token's sha256 is kept. */
export interface Reset { id: string; tokenHash: string; accountId: string; createdAt: string; expiresAt: string; usedAt?: string }
/** The hash of an account with no passphrase (it signs in with geometer.dev): not scrypt, so verifyPassphrase never matches it. */
export const NO_PASSPHRASE = "geometer-signin";
export interface Invite { id: string; tokenHash: string; role: Role; note: string; createdBy: string; createdAt: string; expiresAt: string; usedAt?: string; usedBy?: string }

const SCRYPT = { N: 16384, r: 8, p: 1 } as const;
const KEYLEN = 64;
const scryptAsync = (pw: string, salt: Buffer, opts: ScryptOptions): Promise<Buffer> => new Promise((resolve, reject) => scrypt(pw, salt, KEYLEN, opts, (e, key) => (e ? reject(e) : resolve(key))));

// scrypt with a fresh random salt per passphrase, so two equal passphrases look different on disk and a stolen file is slow to guess against.
export async function hashPassphrase(passphrase: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(passphrase.normalize("NFKC"), salt, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

// Compares in constant time so the check does not leak how much of a guess was right.
export async function verifyPassphrase(passphrase: string, stored: string): Promise<boolean> {
  const [kind, n, r, p, salt, hash] = stored.split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const want = Buffer.from(hash, "base64url");
  const got = await scryptAsync(passphrase.normalize("NFKC"), Buffer.from(salt, "base64url"), { N: Number(n), r: Number(r), p: Number(p) });
  return got.length === want.length && timingSafeEqual(got, want);
}

/** Checked once, in the form's language by the caller: a code, not a sentence. */
export type PassphraseProblem = "short" | "long" | "same-as-handle";
export const MIN_PASSPHRASE = 10;
// Returns a code (not a sentence) for why a passphrase is refused, so the caller can say it in the form's language.
export function passphraseProblem(passphrase: string, handle: string): PassphraseProblem | undefined {
  if ([...passphrase].length < MIN_PASSPHRASE) return "short";
  if (passphrase.length > 200) return "long";
  if (passphrase.toLowerCase() === handle.toLowerCase()) return "same-as-handle";
  return undefined;
}

export const HANDLE = /^[a-z0-9][a-z0-9._-]{2,39}$/u;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
// A hash to compare against when the handle is unknown, so a wrong handle takes as long as a wrong passphrase.
let dummy: Promise<string> | undefined;

export type RedeemResult = { ok: true; account: Account } | { ok: false; reason: "invite-unknown" | "invite-used" | "invite-expired" | "handle-bad" | "handle-taken" | "name-bad" | "company-bad" | "language-bad" | PassphraseProblem };
export type ResetResult = { ok: true; account: Account } | { ok: false; reason: "reset-unknown" | "reset-used" | "reset-expired" | PassphraseProblem };
export type FleetAccountResult = { ok: true; account: Account; made: boolean } | { ok: false; reason: "name-bad" | "company-bad" | "language-bad" };

/** Thrown by the command-line helpers (reset, link) with a sentence for whoever runs the server. */
export class AccountError extends Error {}

// The account and invite store over the panel's data folder. `now` is injectable so tests can expire invites without waiting; invites are single-use and only their sha256 is stored.
export function createAccounts(store: Store, now: () => number = Date.now) {
  const load = () => store.read<{ schema: 1; accounts: Account[] }>("accounts.json")?.accounts ?? [];
  const save = (accounts: Account[]) => store.write("accounts.json", { schema: 1, accounts });
  const loadInvites = () => store.read<{ schema: 1; invites: Invite[] }>("invites.json")?.invites ?? [];
  const saveInvites = (invites: Invite[]) => store.write("invites.json", { schema: 1, invites });
  const iso = (ms: number) => new Date(ms).toISOString();
  const findInvite = (token: string) => {
    const hash = sha256(token);
    return loadInvites().find((i) => i.tokenHash === hash);
  };
  const loadResets = () => store.read<{ schema: 1; resets: Reset[] }>("resets.json")?.resets ?? [];
  const saveResets = (resets: Reset[]) => store.write("resets.json", { schema: 1, resets });
  const findReset = (token: string) => { const hash = sha256(token); return loadResets().find((r) => r.tokenHash === hash); };
  /** A free sign-in name made from a fleet partner id (only shown to whoever runs the server). */
  const handleFor = (partner: string): string => {
    const base = partner.toLowerCase().replace(/[^a-z0-9._-]/gu, "-").replace(/^[^a-z0-9]+/u, "").slice(0, 36).padEnd(3, "0");
    const taken = new Set(load().map((a) => a.handle));
    if (!taken.has(base)) return base;
    for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
  };

  return {
    list: (): Account[] => load(),
    byId: (id: string): Account | undefined => load().find((a) => a.id === id),
    byHandle: (handle: string): Account | undefined => load().find((a) => a.handle === handle.trim().toLowerCase()),
    count: (): number => load().length,

    /** The token is returned once and never kept: only its sha256 is. */
    createInvite(o: { role: Role; note: string; createdBy: string; ttlHours?: number }): { token: string; invite: Invite } {
      const token = randomBytes(24).toString("base64url");
      const invite: Invite = { id: `inv_${randomBytes(6).toString("hex")}`, tokenHash: sha256(token), role: o.role, note: o.note.slice(0, 120), createdBy: o.createdBy, createdAt: iso(now()), expiresAt: iso(now() + (o.ttlHours ?? 72) * 3_600_000) };
      saveInvites([...loadInvites().filter((i) => !i.usedAt && Date.parse(i.expiresAt) > now() - 30 * 86_400_000), invite]);
      return { token, invite };
    },

    inviteStatus(token: string): "ok" | "used" | "expired" | "unknown" {
      const i = findInvite(token);
      if (!i) return "unknown";
      if (i.usedAt) return "used";
      return Date.parse(i.expiresAt) <= now() ? "expired" : "ok";
    },
    inviteRole: (token: string): Role | undefined => findInvite(token)?.role,

    async redeem(token: string, o: { handle: string; name: string; company?: string; passphrase: string; language: string }): Promise<RedeemResult> {
      const invite = findInvite(token);
      if (!invite) return { ok: false, reason: "invite-unknown" };
      if (invite.usedAt) return { ok: false, reason: "invite-used" };
      if (Date.parse(invite.expiresAt) <= now()) return { ok: false, reason: "invite-expired" };
      const handle = o.handle.trim().toLowerCase();
      const name = o.name.trim();
      if (!HANDLE.test(handle)) return { ok: false, reason: "handle-bad" };
      if (name === "" || name.length > 80) return { ok: false, reason: "name-bad" };
      // the company or business name is optional: empty means none, anything else must be a usable one-line name
      const typed = (o.company ?? "").trim();
      const company = companyOf(typed);
      if (typed !== "" && !company) return { ok: false, reason: "company-bad" };
      if (!(LANGUAGES as readonly string[]).includes(o.language)) return { ok: false, reason: "language-bad" };
      const problem = passphraseProblem(o.passphrase, handle);
      if (problem) return { ok: false, reason: problem };
      if (load().some((a) => a.handle === handle)) return { ok: false, reason: "handle-taken" };
      const hash = await hashPassphrase(o.passphrase);
      // Re-read after the slow hash: another redeem of the same invite may have won while this one was hashing.
      const fresh = findInvite(token);
      if (!fresh || fresh.usedAt) return { ok: false, reason: "invite-used" };
      if (load().some((a) => a.handle === handle)) return { ok: false, reason: "handle-taken" };
      const account: Account = { id: `acc_${randomBytes(8).toString("hex")}`, handle, name, ...(company ? { company } : {}), role: invite.role, language: o.language as Language, hash, sessionVersion: 1, createdAt: iso(now()), invitedBy: invite.createdBy };
      save([...load(), account]);
      saveInvites(loadInvites().map((i) => (i.id === invite.id ? { ...i, usedAt: iso(now()), usedBy: account.id } : i)));
      return { ok: true, account };
    },

    async authenticate(handle: string, passphrase: string): Promise<Account | undefined> {
      const found = load().find((a) => a.handle === handle.trim().toLowerCase());
      // an account that signs in with geometer.dev is never opened by a passphrase; it is checked against the dummy, so it takes as long as any wrong guess
      const account = found?.fleetPartner === undefined && found?.hash !== NO_PASSPHRASE ? found : undefined;
      dummy ??= hashPassphrase("not-a-real-passphrase");
      const ok = await verifyPassphrase(passphrase.slice(0, 200), account?.hash ?? (await dummy));
      return ok ? account : undefined;
    },

    // ---- geometer.dev sign-in (hosted mode; fleet-signin.ts) ----------------------------------------------------------------------------------------------
    byFleetPartner: (partner: string): Account | undefined => load().find((a) => a.fleetPartner === partner),
    /**
     * The account of a fleet partner who has just shown a good ticket: the one kept for that partner id, or a new one (their first visit) with the name, company
     * and language they gave. Always role "partner", never a passphrase.
     */
    fromFleet(partner: string, o: { name: string; company?: string; language: string }): FleetAccountResult {
      const existing = load().find((a) => a.fleetPartner === partner);
      if (existing) return { ok: true, account: existing, made: false };
      const name = o.name.replace(/\s+/gu, " ").trim();
      if (name === "" || name.length > 80) return { ok: false, reason: "name-bad" };
      const typed = (o.company ?? "").trim();
      const company = companyOf(typed);
      if (typed !== "" && !company) return { ok: false, reason: "company-bad" };
      if (!(LANGUAGES as readonly string[]).includes(o.language)) return { ok: false, reason: "language-bad" };
      const account: Account = {
        id: `acc_${randomBytes(8).toString("hex")}`, handle: handleFor(partner), name, ...(company ? { company } : {}), role: "partner", language: o.language as Language,
        hash: NO_PASSPHRASE, sessionVersion: 1, createdAt: iso(now()), invitedBy: "geometer", fleetPartner: partner,
      };
      save([...load(), account]);
      return { ok: true, account, made: true };
    },
    /**
     * Whoever runs the server ties an existing partner account to a fleet partner id (`geometer panel link-partner`), so a partner who was invited before keeps their
     * shops when they start signing in with geometer.dev. From then on that account signs in only with geometer.dev: its passphrase is removed and every session ends.
     */
    linkFleet(handle: string, partner: string): Account {
      if (!/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(partner)) throw new AccountError(`"${partner}" is not a partner id in fleet (fleet's partner list shows them).`);
      const account = load().find((a) => a.handle === handle.trim().toLowerCase());
      if (!account) throw new AccountError(`There is no account "${handle}" on this panel.`);
      if (account.role !== "partner") throw new AccountError(`"${account.handle}" is a builder's account: only a partner's account signs in with geometer.dev.`);
      const other = load().find((a) => a.fleetPartner === partner && a.id !== account.id);
      if (other) throw new AccountError(`Fleet partner ${partner} already has the account "${other.handle}" here.`);
      const linked: Account = { ...account, fleetPartner: partner, hash: NO_PASSPHRASE, sessionVersion: account.sessionVersion + 1 };
      save(load().map((a) => (a.id === account.id ? linked : a)));
      saveResets(loadResets().filter((r) => r.accountId !== account.id)); // a reset link for it would have nothing left to reset
      return linked;
    },

    // ---- passphrase reset -------------------------------------------------------------------------------------------------------------------------------
    /** A one-time link to choose a new passphrase, for an account that has one. The token is returned once and never kept: only its sha256 is. */
    createReset(handle: string, ttlHours = 72): { token: string; reset: Reset; account: Account } {
      const account = load().find((a) => a.handle === handle.trim().toLowerCase());
      if (!account) throw new AccountError(`There is no account "${handle}" on this panel. The sign-in names are listed by: geometer panel accounts`);
      if (account.fleetPartner !== undefined || account.hash === NO_PASSPHRASE) throw new AccountError(`"${account.handle}" signs in with their geometer.dev account and has no passphrase to reset.`);
      const token = randomBytes(24).toString("base64url");
      const reset: Reset = { id: `rst_${randomBytes(6).toString("hex")}`, tokenHash: sha256(token), accountId: account.id, createdAt: iso(now()), expiresAt: iso(now() + ttlHours * 3_600_000) };
      // one open link per account: a new one replaces the last; used and old ones are dropped
      saveResets([...loadResets().filter((r) => r.accountId !== account.id && !r.usedAt && Date.parse(r.expiresAt) > now()), reset]);
      return { token, reset, account };
    },
    resetStatus(token: string): "ok" | "used" | "expired" | "unknown" {
      const r = findReset(token);
      if (!r || !load().some((a) => a.id === r.accountId)) return "unknown";
      if (r.usedAt) return "used";
      return Date.parse(r.expiresAt) <= now() ? "expired" : "ok";
    },
    /** The account a reset link is for (to greet the person by name), while the link is good. */
    resetAccount(token: string): Account | undefined { const r = findReset(token); return r && !r.usedAt && Date.parse(r.expiresAt) > now() ? load().find((a) => a.id === r.accountId) : undefined; },
    /** Set the new passphrase and spend the link. Every session of the account ends; the caller signs this one in again. */
    async redeemReset(token: string, passphrase: string): Promise<ResetResult> {
      const r = findReset(token);
      const account = r ? load().find((a) => a.id === r.accountId) : undefined;
      if (!r || !account) return { ok: false, reason: "reset-unknown" };
      if (r.usedAt) return { ok: false, reason: "reset-used" };
      if (Date.parse(r.expiresAt) <= now()) return { ok: false, reason: "reset-expired" };
      const problem = passphraseProblem(passphrase, account.handle);
      if (problem) return { ok: false, reason: problem };
      const hash = await hashPassphrase(passphrase);
      // read again after the slow hash: the same link may have been used meanwhile
      const fresh = findReset(token);
      if (!fresh || fresh.usedAt) return { ok: false, reason: "reset-used" };
      const updated: Account = { ...account, hash, sessionVersion: account.sessionVersion + 1 };
      save(load().map((a) => (a.id === account.id ? updated : a)));
      saveResets(loadResets().map((x) => (x.id === r.id ? { ...x, usedAt: iso(now()) } : x)));
      return { ok: true, account: updated };
    },

    /** Everyone signed in as this account is signed out. */
    bumpSessions(id: string): void { save(load().map((a) => (a.id === id ? { ...a, sessionVersion: a.sessionVersion + 1 } : a))); },
    setLanguage(id: string, language: Language): void { save(load().map((a) => (a.id === id ? { ...a, language } : a))); },
  };
}

export type Accounts = ReturnType<typeof createAccounts>;
