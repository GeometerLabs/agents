// Signed cookie sessions and CSRF tokens. The cookie holds who, which session version, when it ends and a random value; it is signed with
// HMAC-SHA256 so it cannot be forged or changed, HttpOnly so a page cannot read it, SameSite=Strict so another site cannot send it, and Secure
// (with the __Host- prefix) whenever the panel is served over HTTPS. A form carries a token derived from the cookie's random value; a POST
// without the matching token is refused. Signing out everywhere raises the account's session version, which kills every cookie at once.
import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

export interface Session { accountId: string; version: number; expiresAt: number; nonce: string }
export interface SessionOptions { secure: boolean; maxAgeSeconds?: number; now?: () => number }

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const equal = (a: string, b: string) => { const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

export function createSessions(secret: Buffer, options: SessionOptions) {
  const now = options.now ?? Date.now;
  const maxAge = options.maxAgeSeconds ?? 12 * 3600;
  const key = Buffer.from(hkdfSync("sha256", secret, Buffer.alloc(0), "geometer-panel/cookies", 32));
  const sign = (purpose: string, value: string) => createHmac("sha256", key).update(`${purpose}:${value}`).digest("base64url");
  const names = { session: options.secure ? "__Host-geo" : "geo", pre: options.secure ? "__Host-geo_pre" : "geo_pre", lang: "geo_lang" };
  const attrs = (age: number) => `Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${options.secure ? "; Secure" : ""}`;
  const cookieValue = (header: string | undefined, name: string): string | undefined => {
    for (const part of (header ?? "").split(";")) {
      const eq = part.indexOf("=");
      if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
    }
    return undefined;
  };

  return {
    names,
    /** The Set-Cookie header value for a new session. */
    issue(accountId: string, version: number): { setCookie: string; session: Session } {
      const session: Session = { accountId, version, expiresAt: now() + maxAge * 1000, nonce: randomBytes(16).toString("base64url") };
      const payload = b64(JSON.stringify(session));
      return { setCookie: `${names.session}=v1.${payload}.${sign("session", payload)}; ${attrs(maxAge)}`, session };
    },
    /** The session in a Cookie header, or undefined when it is missing, changed, expired or from an older sign-in. */
    read(cookieHeader: string | undefined): Session | undefined {
      const raw = cookieValue(cookieHeader, names.session);
      const m = /^v1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/u.exec(raw ?? "");
      if (!m || !equal(sign("session", m[1]), m[2])) return undefined;
      try {
        const s = JSON.parse(Buffer.from(m[1], "base64url").toString("utf8")) as Session;
        return typeof s.accountId === "string" && Number.isInteger(s.version) && typeof s.nonce === "string" && s.expiresAt > now() ? s : undefined;
      } catch { return undefined; }
    },
    clear: () => `${names.session}=; ${attrs(0)}`,
    /** The hidden field of a signed-in form. */
    csrf: (s: Session) => sign("csrf", s.nonce),
    csrfOk: (s: Session, submitted: string | undefined) => submitted !== undefined && equal(sign("csrf", s.nonce), submitted),

    /** For the login and invite forms, where nobody is signed in yet: a signed random value in a cookie, and the same value's token in the form. */
    pre(cookieHeader: string | undefined): { setCookie?: string; token: string; nonce: string } {
      const raw = cookieValue(cookieHeader, names.pre);
      const m = /^v1\.([A-Za-z0-9_-]{16,})\.([A-Za-z0-9_-]+)$/u.exec(raw ?? "");
      if (m && equal(sign("pre", m[1]), m[2])) return { token: sign("precsrf", m[1]), nonce: m[1] };
      const nonce = randomBytes(16).toString("base64url");
      return { setCookie: `${names.pre}=v1.${nonce}.${sign("pre", nonce)}; ${attrs(3600)}`, token: sign("precsrf", nonce), nonce };
    },
    preOk(cookieHeader: string | undefined, submitted: string | undefined): boolean {
      const raw = cookieValue(cookieHeader, names.pre);
      const m = /^v1\.([A-Za-z0-9_-]{16,})\.([A-Za-z0-9_-]+)$/u.exec(raw ?? "");
      return !!m && equal(sign("pre", m[1]), m[2]) && submitted !== undefined && equal(sign("precsrf", m[1]), submitted);
    },
    langCookie: (language: string) => `${names.lang}=${language}; Path=/; SameSite=Lax; Max-Age=31536000${options.secure ? "; Secure" : ""}`,
    readLang: (cookieHeader: string | undefined) => cookieValue(cookieHeader, names.lang),
  };
}

export type Sessions = ReturnType<typeof createSessions>;
