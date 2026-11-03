// Secrets are files, each in the folder of the one container that needs it (secrets/<container>/), and the secrets intake that moves what the panel was
// handed into those folders. File modes: every folder under secrets/ is 0755 and every file 0644 so a container's own non-root user can read it, while
// secrets/ itself is 0700, so no other user of the machine can get to any of them. Docker mounts one container's folder into that container only.
import { chownSync, existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { serverPaths } from "./server.ts";
import { ensureDir, writeAtomic } from "./util.ts";
import type { Problem } from "./util.ts";

export const secretFile = (dir: string, container: string, ...rest: string[]) => join(serverPaths(dir).secrets, container, ...rest);

/** Make `secrets/` private to this machine's user and each container's folder readable inside its container. */
export function prepareSecretsRoot(dir: string): void {
  ensureDir(serverPaths(dir).secrets, 0o700);
}

/** `mode` 0600 is for what a program insists on being private to its user (the panel's keys); the panel then runs as the user who wrote them (see panelUser). */
export function writeSecretFile(path: string, value: string, mode = 0o644): void {
  ensureDirsFor(path);
  writeAtomic(path, value.endsWith("\n") ? value : `${value}\n`, mode);
  const owner = panelOwner();
  if (mode === 0o600 && owner) chownSync(path, owner.uid, owner.gid);
}

/**
 * The user the panel container runs as: whoever runs the deployer, so that the files the panel writes (mode 0600, as the panel insists) are the deployer's own to read and
 * the files the deployer writes for it (its keys, 0600) are the panel's. A deployer running as root cannot hand a root-run panel its files, so then the panel
 * runs as the node image's user (1000) and the files made for it are given to that user.
 */
export function panelUser(): { uid: number; gid: number } {
  const uid = process.getuid?.() ?? 1000; const gid = process.getgid?.() ?? 1000;
  return uid === 0 ? { uid: 1000, gid: 1000 } : { uid, gid };
}
const panelOwner = (): { uid: number; gid: number } | undefined => ((process.getuid?.() ?? 1000) === 0 ? panelUser() : undefined);

function ensureDirsFor(path: string): void {
  const parts = path.split("/");
  const at = parts.lastIndexOf("secrets");
  // every folder from secrets/<container> down is world-readable (the secrets/ folder itself stays 0700)
  for (let i = at + 2; i < parts.length; i++) ensureDir(parts.slice(0, i).join("/"), 0o755);
}

export function readSecretFile(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, "utf8").trim() : undefined;
}

/** The value in the file, or, if there is none, make one, write it and return it. A token is made once and kept. */
export function ensureSecret(path: string, make: () => string, mode?: number): string {
  const have = readSecretFile(path);
  if (have) return have;
  const value = make();
  writeSecretFile(path, value, mode);
  return value;
}

/**
 * What the panel may hand in (secrets-inbox/<shop>/<name>), where each goes, and what it becomes. The runtime never sees any of them: a provider's
 * credential goes only to that shop's Guard for that provider, a webhook secret only to the inbox, the Google key only to the token refresher.
 */
export const INTAKE: Record<string, { to: (shop: string) => string[]; make?: (text: string) => string; check: (text: string) => string | undefined }> = {
  razorpay_key: {
    to: (shop) => [`g-${shop}-razorpay`, "razorpay_authorization"],
    make: (t) => `Basic ${Buffer.from(t.trim()).toString("base64")}`,
    check: (t) => (/^[^:\s]+:[^\s]+$/u.test(t.trim()) ? undefined : "razorpay_key must be the key id and the key secret joined by a colon, on one line (rzp_test_...:...)."),
  },
  whatsapp_token: {
    to: (shop) => [`g-${shop}-whatsapp`, "whatsapp_authorization"],
    make: (t) => `Bearer ${t.trim()}`,
    check: (t) => (t.trim().length >= 16 && !/\s/u.test(t.trim()) ? undefined : "whatsapp_token must be the access token, on one line, with no spaces."),
  },
  razorpay_webhook_secret: { to: (shop) => ["inbox", shop, "razorpay_webhook_secret"], check: (t) => (t.trim().length >= 8 ? undefined : "razorpay_webhook_secret is too short.") },
  whatsapp_app_secret: { to: (shop) => ["inbox", shop, "whatsapp_app_secret"], check: (t) => (t.trim().length >= 8 ? undefined : "whatsapp_app_secret is too short.") },
  whatsapp_verify_token: { to: (shop) => ["inbox", shop, "whatsapp_verify_token"], check: (t) => (t.trim().length >= 8 ? undefined : "whatsapp_verify_token is too short.") },
  whatsapp_path_token: { to: (shop) => ["inbox", shop, "whatsapp_path_token"], check: (t) => (/^[A-Za-z0-9_-]{16,}$/u.test(t.trim()) ? undefined : "whatsapp_path_token must be 16 or more of A-Z a-z 0-9 _ -.") },
  "google_service_account.json": {
    to: (shop) => ["refresher", shop, "google_service_account.json"],
    check: (t) => {
      try {
        const j = JSON.parse(t) as Record<string, unknown>;
        return typeof j.client_email === "string" && typeof j.private_key === "string" && typeof j.token_uri === "string" ? undefined : "google_service_account.json must be the service account's key file (client_email, private_key, token_uri).";
      } catch { return "google_service_account.json is not valid JSON."; }
    },
  },
};

/** Move every file in secrets-inbox/<shop>/ to where it belongs and delete it from the inbox. A file that fails its check stays and is named. */
export function takeSecrets(dir: string, shop: string): { moved: string[]; problems: Problem[]; unknown: string[] } {
  const inbox = join(serverPaths(dir).secretsInbox, shop);
  const moved: string[] = []; const problems: Problem[] = []; const unknown: string[] = [];
  if (!existsSync(inbox)) return { moved, problems, unknown };
  for (const name of readdirSync(inbox)) {
    if (name.startsWith(".")) continue;
    const rule = INTAKE[name];
    if (!rule) { unknown.push(name); continue; }
    const text = readFileSync(join(inbox, name), "utf8");
    const problem = rule.check(text);
    if (problem) { problems.push({ rule: "secrets-intake", message: `${shop}: ${problem} (left in the inbox, not used)` }); continue; }
    writeSecretFile(secretFile(dir, ...rule.to(shop)), rule.make ? rule.make(text) : text.trim());
    rmSync(join(inbox, name));
    moved.push(name);
  }
  return { moved, problems, unknown };
}
