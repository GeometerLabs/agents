// Secrets are files, each in the folder of the one container that needs it (secrets/<container>/), and the secrets intake that moves what the panel was
// handed into those folders. File modes: every folder under secrets/ is 0755 and every file 0644 so a container's own non-root user can read it, while
// secrets/ itself is 0700, so no other user of the machine can get to any of them. Docker mounts one container's folder into that container only.
import { hkdfSync } from "node:crypto";
import { chownSync, existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { serverPaths } from "./server.ts";
import { OWN_API } from "../../modules/payments/providers/index.ts";
import { ensureDir, mintSecret, mintSigningKey, writeAtomic } from "./util.ts";
import type { Problem } from "./util.ts";

// The path of one secret inside the one container's folder that needs it; Docker mounts only that folder into that container.
export const secretFile = (dir: string, container: string, ...rest: string[]) => join(serverPaths(dir).secrets, container, ...rest);

/** Make `secrets/` private to this machine's user and each container's folder readable inside its container. */
export function prepareSecretsRoot(dir: string): void {
  ensureDir(serverPaths(dir).secrets, 0o700);
}

// ---- the shop's fingerprint key (B69) -----------------------------------------------------------------------------------------------------------------------
//
// One key per shop (or own agent), 32 random bytes as hex, made the first time it is needed: at deploy, or by the next export job for a shop made before B69, so such a shop gets one
// and nothing crashes. secrets/person-keys/<shop> is 0600: only the deployer's user and the root job containers read it; it is mounted read-only into the export and snapshot jobs only.
// The panel gets a copy (0600, secrets/panel/person-keys/<shop>) to match a person it is asked about. Containers that must not hold the key itself get a key derived from it for their
// one purpose: the runtime its record key (the inputs' digest and message ids, secrets/rt-<shop>/record_key), ops a label key for an own agent (secrets/ops/<agent>/label_key). Those two
// are 0644 like every other file a container's fixed user must read (see the top of this file); a copy of the key itself never is.
// Knowing a derived key shows nothing about the key it came from, or about the person fingerprints the key makes. The snapshot job writes the key into the nightly manifest (backup/snapshot.ts), and `restore` puts it back.

/** The one copy of a shop's key every other is made from. Deleting it, or letting a new machine mint another, leaves the shop unable to match the fingerprints it already handed out. */
export const personKeyFile = (dir: string, shop: string) => secretFile(dir, "person-keys", shop);
export const RECORD_KEY_FILE = "record_key";
/** What a shop's fingerprint key looks like on disk. */
export const PERSON_KEY = /^[0-9a-f]{64}$/u;
export const AGENT_LABEL_KEY_FILE = "label_key";

/** What one key derives for: a container that must not hold the shop's key itself gets a key made from it for this purpose only. The label in the HKDF must not change, or every digest and label made so far stops matching. */
export const derivedKey = (keyHex: string, purpose: "record" | "label" | "id"): string => Buffer.from(hkdfSync("sha256", Buffer.from(keyHex, "hex"), Buffer.alloc(0), `geometer/${purpose}-key/1`, 32)).toString("hex");

/**
 * A name for a key that opens nothing: the snapshot's seal (kept in the clear) carries it, and the weekly drill compares it with the live key's, so it can say the snapshot
 * holds the key this server uses without either key leaving its file. A purpose of its own, so it is never one of the derived keys above. 16 hex digits tell two keys apart.
 */
export const keyIdOf = (keyHex: string): string => derivedKey(keyHex, "id").slice(0, 16);

/** The shop's key, made if it has none. 0600. */
export function ensurePersonKey(dir: string, shop: string): string {
  return ensureSecret(personKeyFile(dir, shop), mintSecret, 0o600);
}

/** The key's copies for a shop: the runtime's derived record key, and the panel's copy of the key (only when the panel is on). */
export function ensureShopPersonKeys(dir: string, shop: string, runtimeFolder: string, panelOn: boolean): void {
  const key = ensurePersonKey(dir, shop);
  writeSecretFile(secretFile(dir, runtimeFolder, RECORD_KEY_FILE), derivedKey(key, "record"));
  if (panelOn) writeSecretFile(secretFile(dir, "panel", "person-keys", shop), key, 0o600);
}

/**
 * A restore's key goes back in place of the one here, because the record it came with was fingerprinted under it. Its copies are rewritten. On a new machine the first deploy made another
 * key, which nothing has used: it is kept beside (returned: the name), never deleted. Returns undefined when the key was already the one in place.
 */
export function restorePersonKey(dir: string, shop: string, keyHex: string, runtimeFolder: string, panelOn: boolean, stamp: string): string | undefined {
  const kept = putBackPersonKey(dir, shop, keyHex, stamp);
  ensureShopPersonKeys(dir, shop, runtimeFolder, panelOn);
  return kept;
}

/** The key itself put back, the one it replaces kept beside (its name returned). Its copies are the caller's: a shop's runtime and panel copies, or an agent's label key. */
function putBackPersonKey(dir: string, name: string, keyHex: string, stamp: string): string | undefined {
  if (!PERSON_KEY.test(keyHex)) throw new Error("The fingerprint key in this snapshot is not a key, so it was not put back.");
  const path = personKeyFile(dir, name);
  const have = readSecretFile(path);
  let kept: string | undefined;
  if (have && have !== keyHex) { kept = `${name}.before-restore-${stamp}`; writeSecretFile(`${path}.before-restore-${stamp}`, have, 0o600); }
  if (have !== keyHex) writeSecretFile(path, keyHex, 0o600);
  return kept;
}

/**
 * An agent someone else wrote (B51): its key put back as a shop's is, and its label key made again from it in ops' folder (ops reads the file at each record pass). No
 * runtime copy and no panel copy: an agent has no runtime, and the panel's own-agent page (12 Nov 2026) matches no person, so it needs no key.
 */
export function restoreAgentKey(dir: string, agent: string, keyHex: string, stamp: string): string | undefined {
  const kept = putBackPersonKey(dir, agent, keyHex, stamp);
  ensureAgentLabelKey(dir, agent);
  return kept;
}

/** An own agent's label key in ops' folder (agent/facts.ts labels a reference that looks like a number; the deployer's fold labels it the same way). */
export function ensureAgentLabelKey(dir: string, agent: string): string {
  const label = derivedKey(ensurePersonKey(dir, agent), "label");
  writeSecretFile(secretFile(dir, "ops", agent, AGENT_LABEL_KEY_FILE), label);
  return label;
}

// ---- the server's paper signing key (the panel's), and the runtime's copy for the owner's WhatsApp report (item 17b) ------------------------------------------

/** The server's one paper signing key: an Ed25519 private key in PEM (modules/report/sign.ts loadPrivateKey). The panel signs go-live certificates, monthly reports and evidence packs with it, and fleet's public list of signers names it (lib/signer-claim.ts). */
export const panelSigningKeyFile = (dir: string) => secretFile(dir, "panel", "signing_key");
/** The same key as the shop runtime reads it (secrets/rt-<shop>/report_signing_key, /run/secrets/report_signing_key inside), for the owner's WhatsApp monthly report. lib/report-key.ts puts it there. */
export const RUNTIME_SIGNING_KEY_FILE = "report_signing_key";

/** The panel's signing key, made the first time it is needed (the panel's first start, or the first shop's deploy): 0600, as loadPrivateKey insists. */
export function ensurePanelSigningKey(dir: string): string {
  return ensureSecret(panelSigningKeyFile(dir), mintSigningKey, 0o600);
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

// The trimmed value, or undefined if the file is absent; trimming drops the newline an editor or `echo` adds.
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

/** The credential file of an agent's own gateway API Guard (B71 step 6, generate/guards.ts ownApiGuardDef): the whole Authorization header value, as handed in. */
export const OWN_API_SECRET = "gateway_authorization";

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
  // Item 11b: a shop whose WhatsApp goes through Gupshup. Its Guard sends this whole Authorization value to partner.gupshup.io, exactly as handed in: Gupshup's partner
  // app token goes as it is (no "Bearer"), and a newer universal token as Gupshup says to send it. It fills the same file as whatsapp_token: a shop has one provider.
  gupshup_authorization: {
    to: (shop) => [`g-${shop}-whatsapp`, "whatsapp_authorization"],
    check: (t) => (/^(?:[A-Za-z]+ )?[^\s]{16,}$/u.test(t.trim()) ? undefined : "gupshup_authorization must be the whole Authorization value Gupshup asks for, on one line: the partner app token as Gupshup shows it (or a word like Bearer, one space, and the token)."),
  },
  // Item 11c: a shop on its OWN Gupshup account (self-serve). Its Guard sends this API key as the `apikey` header to api.gupshup.io; the file is the same one, a shop has one provider.
  gupshup_apikey: {
    to: (shop) => [`g-${shop}-whatsapp`, "whatsapp_authorization"],
    check: (t) => (/^[^\s]{16,200}$/u.test(t.trim()) ? undefined : "gupshup_apikey must be the shop's Gupshup API key as Gupshup shows it, on one line, with no spaces."),
  },
  // B71 step 6: an agent's own gateway API. Its Authorization header, whole and as handed in ("Bearer ..." or "Basic ..."), for that Guard only: no module here knows the API's key shape
  gateway_authorization: {
    to: (shop) => [`g-${shop}-${OWN_API}`, OWN_API_SECRET],
    check: (t) => (/^[A-Za-z]+ [^\s]{8,}$/u.test(t.trim()) ? undefined : "gateway_authorization must be your API's whole Authorization header value on one line, for example Bearer sk_live_... or Basic ...."),
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

/**
 * The model's key, for the model Guard only: Anthropic's as it is (Guard sends it as x-api-key), any OpenAI-compatible one (a model the builder hosts too) as a
 * bearer header. The file's name depends on the wire, so the model must be chosen first. Used by `geometer model-key` and by the panel's first run (server-settings.ts).
 */
export function writeModelKey(dir: string, wire: "openai" | "anthropic", key: string): void {
  prepareSecretsRoot(dir);
  if (wire === "anthropic") writeSecretFile(secretFile(dir, "g-model", "model_api_key"), key);
  else writeSecretFile(secretFile(dir, "g-model", "model_authorization"), `Bearer ${key}`);
}

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
