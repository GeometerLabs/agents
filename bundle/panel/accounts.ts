// Accounts, passphrases and invites. Two roles: a builder sees every shop on the server; a partner sees only the shops they set up. Nobody signs
// themselves up: an account exists only because someone with the server (or, on a builder's own server, a builder) made an invite link, and the
// link works once. Passphrases are hashed with scrypt (node:crypto), each with its own salt; invite tokens are kept only as a sha256.
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { ScryptOptions } from "node:crypto";
import type { Store } from "./store.ts";
import { LANGUAGES } from "../../modules/language/languages.ts";
import type { Language } from "../../modules/language/languages.ts";

export type Role = "builder" | "partner";
export const ROLES: readonly Role[] = ["builder", "partner"];

export interface Account { id: string; handle: string; name: string; role: Role; language: Language; hash: string; sessionVersion: number; createdAt: string; invitedBy: string }
export interface Invite { id: string; tokenHash: string; role: Role; note: string; createdBy: string; createdAt: string; expiresAt: string; usedAt?: string; usedBy?: string }

const SCRYPT = { N: 16384, r: 8, p: 1 } as const;
const KEYLEN = 64;
const scryptAsync = (pw: string, salt: Buffer, opts: ScryptOptions): Promise<Buffer> => new Promise((resolve, reject) => scrypt(pw, salt, KEYLEN, opts, (e, key) => (e ? reject(e) : resolve(key))));

export async function hashPassphrase(passphrase: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(passphrase.normalize("NFKC"), salt, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

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

export type RedeemResult = { ok: true; account: Account } | { ok: false; reason: "invite-unknown" | "invite-used" | "invite-expired" | "handle-bad" | "handle-taken" | "name-bad" | "language-bad" | PassphraseProblem };

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

    async redeem(token: string, o: { handle: string; name: string; passphrase: string; language: string }): Promise<RedeemResult> {
      const invite = findInvite(token);
      if (!invite) return { ok: false, reason: "invite-unknown" };
      if (invite.usedAt) return { ok: false, reason: "invite-used" };
      if (Date.parse(invite.expiresAt) <= now()) return { ok: false, reason: "invite-expired" };
      const handle = o.handle.trim().toLowerCase();
      const name = o.name.trim();
      if (!HANDLE.test(handle)) return { ok: false, reason: "handle-bad" };
      if (name === "" || name.length > 80) return { ok: false, reason: "name-bad" };
      if (!(LANGUAGES as readonly string[]).includes(o.language)) return { ok: false, reason: "language-bad" };
      const problem = passphraseProblem(o.passphrase, handle);
      if (problem) return { ok: false, reason: problem };
      if (load().some((a) => a.handle === handle)) return { ok: false, reason: "handle-taken" };
      const hash = await hashPassphrase(o.passphrase);
      // Re-read after the slow hash: another redeem of the same invite may have won while this one was hashing.
      const fresh = findInvite(token);
      if (!fresh || fresh.usedAt) return { ok: false, reason: "invite-used" };
      if (load().some((a) => a.handle === handle)) return { ok: false, reason: "handle-taken" };
      const account: Account = { id: `acc_${randomBytes(8).toString("hex")}`, handle, name, role: invite.role, language: o.language as Language, hash, sessionVersion: 1, createdAt: iso(now()), invitedBy: invite.createdBy };
      save([...load(), account]);
      saveInvites(loadInvites().map((i) => (i.id === invite.id ? { ...i, usedAt: iso(now()), usedBy: account.id } : i)));
      return { ok: true, account };
    },

    async authenticate(handle: string, passphrase: string): Promise<Account | undefined> {
      const account = load().find((a) => a.handle === handle.trim().toLowerCase());
      dummy ??= hashPassphrase("not-a-real-passphrase");
      const ok = await verifyPassphrase(passphrase.slice(0, 200), account?.hash ?? (await dummy));
      return ok ? account : undefined;
    },

    /** Everyone signed in as this account is signed out. */
    bumpSessions(id: string): void { save(load().map((a) => (a.id === id ? { ...a, sessionVersion: a.sessionVersion + 1 } : a))); },
    setLanguage(id: string, language: Language): void { save(load().map((a) => (a.id === id ? { ...a, language } : a))); },
  };
}

export type Accounts = ReturnType<typeof createAccounts>;
