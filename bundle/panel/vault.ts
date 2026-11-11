// Encryption at rest for everything the panel itself keeps (accounts, invites, drafts, the record of which secrets arrived, the audit trail):
// AES-256-GCM from node:crypto, one fresh 12-byte nonce per write, the record's name as additional authenticated data (so a file copied over
// another one fails to open), and the key in a FILE named by the environment, outside the data folder it protects. Hosted mode (Geometer's
// partner server) refuses to start without it; a builder's own server may use it too.
//
//   geo1.<base64url(nonce 12 | ciphertext | tag 16)>
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";

// Thrown when a record cannot be opened (wrong key, tampered, or no key given), so callers can tell it from an ordinary read error.
export class VaultError extends Error { override name = "VaultError"; }

export interface Vault {
  readonly encrypted: boolean;
  seal(plain: string, aad: string): string;
  /** Throws a VaultError (a plain sentence) when the text was changed, belongs to another record, or the key is not the one it was sealed with. */
  open(sealed: string, aad: string): string;
  /** A secret derived from the key for one purpose, for example the cookie signing key. Null without a key. */
  derive(purpose: string): Buffer | null;
}

const PREFIX = "geo1.";

export const plainVault: Vault = {
  encrypted: false,
  seal: (plain) => plain,
  open: (sealed) => {
    if (sealed.startsWith(PREFIX)) throw new VaultError("This record is encrypted, but the panel was started without its data key (PANEL_DATA_KEY_FILE).");
    return sealed;
  },
  derive: () => null,
};

// Builds the encrypt/decrypt pair for one data key; each write uses a fresh nonce and binds the record's name, so a file moved to another name fails to open.
export function createVault(key: Buffer): Vault {
  if (key.length !== 32) throw new VaultError("The data key must be 32 bytes (64 hex characters, or 44 base64 characters).");
  return {
    encrypted: true,
    seal(plain, aad) {
      const nonce = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, nonce);
      cipher.setAAD(Buffer.from(aad));
      const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
      return PREFIX + Buffer.concat([nonce, body, cipher.getAuthTag()]).toString("base64url");
    },
    open(sealed, aad) {
      if (!sealed.startsWith(PREFIX)) throw new VaultError(`${aad} is not encrypted, but this panel keeps everything encrypted. It was changed or replaced outside the panel, so it is not used.`);
      const raw = Buffer.from(sealed.slice(PREFIX.length), "base64url");
      if (raw.length < 12 + 16) throw new VaultError(`${aad} is damaged, so it is not used.`);
      try {
        const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
        decipher.setAAD(Buffer.from(aad));
        decipher.setAuthTag(raw.subarray(raw.length - 16));
        return Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]).toString("utf8");
      } catch {
        throw new VaultError(`${aad} could not be opened: it was changed, it belongs to another record, or the data key is not the one it was written with.`);
      }
    },
    derive: (purpose) => Buffer.from(hkdfSync("sha256", key, Buffer.alloc(0), `geometer-panel/${purpose}`, 32)),
  };
}

/**
 * Read the data key from its file. The file must be 32 bytes as hex, base64 or raw; must NOT be inside the data folder it protects (a copy of
 * the folder would carry its own key); and must not be readable by other users on this machine.
 */
export function loadKeyFile(file: string, dataDir: string): Buffer {
  const path = resolve(file);
  if (!existsSync(path)) throw new VaultError(`The data key file ${path} is not there. Make one with: node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))" > ${path} && chmod 600 ${path}`);
  const real = realpathSync(path);
  const data = existsSync(dataDir) ? realpathSync(dataDir) : resolve(dataDir);
  if (real === data || real.startsWith(data + sep) || dirname(real) === data) throw new VaultError(`The data key file ${path} is inside the panel's data folder ${data}. Keep it somewhere else, so a copy of the folder is not a copy of its key.`);
  if (process.platform !== "win32" && (statSync(real).mode & 0o077) !== 0) throw new VaultError(`The data key file ${path} can be read by other users of this machine. Run: chmod 600 ${path}`);
  const text = readFileSync(real);
  const asText = text.toString("utf8").trim();
  if (/^[0-9a-fA-F]{64}$/u.test(asText)) return Buffer.from(asText, "hex");
  if (/^[A-Za-z0-9+/_-]{43}=?$/u.test(asText)) return Buffer.from(asText, "base64");
  if (text.length === 32) return text;
  throw new VaultError(`The data key file ${path} must hold 32 bytes: 64 hex characters, 44 base64 characters, or 32 raw bytes.`);
}
