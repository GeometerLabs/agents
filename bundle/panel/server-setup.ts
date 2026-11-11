// The panel's side of its first run on a builder's server (plan item 14b, part 2): the server's own settings, which install.sh leaves for the panel.
//
// Who uses it: server.ts's /server routes (a builder, on their own server only; never on Geometer's hosted panel). What it does:
//   - the model every shop's agent uses: a hosted provider (OpenAI, Anthropic, another OpenAI-compatible one) or a model the builder hosts (B73), as a REQUEST
//     the deployer applies to geometer.json (server-contract.ts), with the model's key through the write-only inbox;
//   - the backup bucket: its address, its key (write-only), and the age key the snapshots are encrypted to. The panel makes that key pair here, keeps the
//     secret half sealed in its own store, shows it to the builder until they confirm it is somewhere else, and then deletes it: after that only the public half
//     is on the server, as the bundle's rule is (the secret half is needed only to restore). A builder who has an age key already gives its public half instead;
//   - a server-wide Google key, optional, for shops that hand in none of their own.
// It reads geometer.json and status/_server.json (both read-only here) to show where each step stands. It never reads a key back.
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { generateIdentity } from "../backup/age.ts";
import type { Account } from "./accounts.ts";
import type { PanelConfig } from "./config.ts";
import { checkSecret, createServerInbox } from "./secrets.ts";
import { backupChoiceProblems, modelChoiceProblems, parseBackupRequest, parseModelRequest, parseServerStatus, serverKeyShapeOk, serverSettingsPaths } from "./server-contract.ts";
import type { BackupChoice, ModelChoice, Problem, ServerBackupRequest, ServerModelRequest, ServerStatus } from "./server-contract.ts";
import type { Store } from "./store.ts";

/** The backup key pair the panel made, as its store keeps it. `identity` (the secret half) is there only until the builder confirms they have it elsewhere. */
interface HeldBackupKey { recipient: string; madeAt: string; identity?: string; confirmedAt?: string; own?: boolean }

export interface ServerSetupView {
  serverId: string;
  model?: ModelChoice;
  backup?: BackupChoice;
  status?: ServerStatus;
  /** Requests written and not yet taken by the deployer (it looks every few seconds; longer means the deployer is not running). */
  pending: { model?: ServerModelRequest; backup?: ServerBackupRequest };
  receipts: Partial<Record<"model_key" | "backup_key" | "google_service_account.json", string>>;
  backupKey?: { recipient: string; madeAt: string; held: boolean; confirmedAt?: string; own: boolean };
  /** Every step done: a model and its key, the bucket tested, and no secret half left on the server. */
  done: boolean;
}

const BACKUP_KEY = "server/backup-key.json";
/** How many characters at the end of the secret half the builder types back to confirm they have it: enough to show it was copied, not a second copy. */
export const CONFIRM_CHARS = 6;

// The first-run logic behind the /server pages: validates the model and backup forms, writes REQUESTS for the deployer (the panel never edits geometer.json) and passes keys on into the inbox. `now` is injectable for tests.
export function createServerSetup(config: PanelConfig, store: Store, now: () => number = Date.now) {
  const p = serverSettingsPaths(config.serverDir);
  const inbox = createServerInbox(config.serverDir, store, now);
  const iso = () => new Date(now()).toISOString();
  const readText = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : undefined);
  const requestId = (kind: string) => `${kind}_${randomBytes(8).toString("hex")}`;
  const by = (a: Account) => ({ id: a.id, name: a.name, role: a.role });
  const writeRequest = (path: string, value: unknown) => {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = join(dirname(path), `.${randomBytes(6).toString("hex")}.tmp`);
    writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o644 });
    renameSync(tmp, path);
  };

  function config_(): { id?: string; model?: ModelChoice; backup?: BackupChoice } {
    try {
      const g = JSON.parse(readText(p.config) ?? "{}") as { id?: string; model?: ModelChoice; backup?: { snapshots?: { url?: string; endpoint?: string; region?: string }; ageRecipient?: string } };
      const s = g.backup?.snapshots;
      return {
        ...(typeof g.id === "string" ? { id: g.id } : {}),
        ...(g.model && typeof g.model.model === "string" && g.model.model !== "" ? { model: g.model } : {}),
        ...(s?.url && g.backup?.ageRecipient ? { backup: { url: s.url, ...(s.endpoint ? { endpoint: s.endpoint } : {}), ...(s.region ? { region: s.region } : {}), ageRecipient: g.backup.ageRecipient } } : {}),
      };
    } catch { return {}; }
  }

  const held = (): HeldBackupKey | undefined => store.read<HeldBackupKey>(BACKUP_KEY);

  const api = {
    view(): ServerSetupView {
      const c = config_();
      const status = parseServerStatus(readText(p.status));
      const k = held();
      const receipts = inbox.receipts();
      const done = Boolean(c.model && status?.keys.model && c.backup && status?.keys.backup && status.backupTest?.ok && !(k?.identity));
      return {
        serverId: c.id ?? "",
        ...(c.model ? { model: c.model } : {}), ...(c.backup ? { backup: c.backup } : {}), ...(status ? { status } : {}),
        pending: { ...(parseModelRequest(readText(p.modelRequest)) ? { model: parseModelRequest(readText(p.modelRequest)) } : {}), ...(parseBackupRequest(readText(p.backupRequest)) ? { backup: parseBackupRequest(readText(p.backupRequest)) } : {}) },
        receipts,
        ...(k ? { backupKey: { recipient: k.recipient, madeAt: k.madeAt, held: k.identity !== undefined, ...(k.confirmedAt ? { confirmedAt: k.confirmedAt } : {}), own: k.own === true } } : {}),
        done,
      };
    },

    /**
     * The model, from the form: `kind` openai | anthropic | other (another OpenAI-compatible provider: `upstream`, `path`, `provider`) | own (a model the builder
     * hosts: `url`, and their price `rateIn`/`rateOut` per million tokens). `key`, if given, is the model's key, handed in through the write-only inbox.
     */
    requestModel(form: Record<string, string | undefined>, account: Account): { ok: true } | { ok: false; problems: Problem[] } {
      const t = (k: string) => (form[k] ?? "").trim();
      const kind = t("kind");
      let choice: ModelChoice;
      if (kind === "anthropic") choice = { wire: "anthropic", model: t("model") };
      else if (kind === "other") choice = { wire: "openai", model: t("model"), upstream: t("upstream").toLowerCase(), ...(t("path") ? { path: t("path") } : {}), ...(t("provider") ? { provider: t("provider").toLowerCase() } : {}) };
      else if (kind === "own") {
        const rate = t("rateIn") !== "" || t("rateOut") !== "" ? { inputUsdPerMillion: Number(t("rateIn") || "NaN"), outputUsdPerMillion: Number(t("rateOut") || "NaN") } : undefined;
        choice = { wire: "openai", model: t("model"), selfHosted: { url: t("url").replace(/\/+$/u, ""), ...(rate ? { rate } : {}) } };
      } else if (kind === "openai") choice = { wire: "openai", model: t("model") };
      else return { ok: false, problems: [{ field: "kind", message: "Choose where the model is." }] };
      const problems = modelChoiceProblems(choice);
      const key = t("key");
      if (key !== "" && !serverKeyShapeOk("model_key", key)) problems.push({ field: "key", message: "The key has spaces or line breaks, or is too short: copy it again, whole." });
      if (problems.length > 0) return { ok: false, problems };
      const request: ServerModelRequest = { schema: 1, requestId: requestId("model"), requestedAt: iso(), requestedBy: by(account), model: choice };
      writeRequest(p.modelRequest, request);
      if (key !== "") inbox.put("model_key", key); // the deployer keeps it waiting until the model above is applied (the key's file depends on the wire)
      return { ok: true };
    },

    /**
     * The backup place, from the form: `url` (s3://bucket/folder), `endpoint`, `region`, `bucketKey` (access-key-id:secret, write-only), and the key the snapshots
     * are encrypted to: `age` = new (the panel makes a pair and keeps the secret half until it is confirmed elsewhere) or own (`ageRecipient`, an age1 public key).
     */
    requestBackup(form: Record<string, string | undefined>, account: Account): { ok: true; madeKey: boolean } | { ok: false; problems: Problem[] } {
      const t = (k: string) => (form[k] ?? "").trim();
      const k = held();
      const own = t("age") === "own";
      const problems: Problem[] = [];
      // a pair made here and not yet confirmed may already have snapshots encrypted to it: it is never dropped silently
      if (own && k?.identity) problems.push({ field: "ageRecipient", message: "This server still holds the secret half of the backup key it made for you. Save it and confirm it first; then you can use a key of your own." });
      // undefined: a new pair is made below. A pair made here before (held or confirmed) is used again rather than replaced.
      let recipient: string | undefined = own ? t("ageRecipient") : k && !k.own ? k.recipient : undefined;
      const choice = { url: t("url"), ...(t("endpoint") ? { endpoint: t("endpoint").replace(/\/+$/u, "") } : {}), ...(t("region") ? { region: t("region") } : {}) };
      problems.push(...backupChoiceProblems({ ...choice, ageRecipient: recipient ?? "" }).filter((x) => recipient !== undefined || x.field !== "ageRecipient"));
      const bucketKey = t("bucketKey");
      if (bucketKey !== "" && !serverKeyShapeOk("backup_key", bucketKey)) problems.push({ field: "bucketKey", message: "The bucket's key must be the access key id, a colon, and the secret, on one line." });
      if (bucketKey === "" && !inbox.receipts().backup_key) problems.push({ field: "bucketKey", message: "The bucket's key is needed once: the access key id, a colon, and the secret." });
      if (problems.length > 0) return { ok: false, problems };
      let madeKey = false;
      if (recipient === undefined) {
        // a new pair: the secret half is sealed in the panel's store (with its data key) until the builder confirms they have it elsewhere
        const pair = generateIdentity();
        store.write(BACKUP_KEY, { recipient: pair.recipient, identity: pair.identity, madeAt: iso() } satisfies HeldBackupKey);
        recipient = pair.recipient;
        madeKey = true;
      } else if (own) store.write(BACKUP_KEY, { recipient, madeAt: iso(), own: true } satisfies HeldBackupKey);
      const request: ServerBackupRequest = { schema: 1, requestId: requestId("backup"), requestedAt: iso(), requestedBy: by(account), backup: { ...choice, ageRecipient: recipient } satisfies BackupChoice };
      writeRequest(p.backupRequest, request);
      if (bucketKey !== "") inbox.put("backup_key", bucketKey);
      return { ok: true, madeKey };
    },

    /** Test the bucket again: the same settings asked for once more, so the deployer writes, reads back and deletes a test object again. */
    retestBackup(account: Account): boolean {
      const c = config_();
      if (!c.backup) return false;
      writeRequest(p.backupRequest, { schema: 1, requestId: requestId("backup"), requestedAt: iso(), requestedBy: by(account), backup: c.backup } satisfies ServerBackupRequest);
      return true;
    },

    /** A server-wide Google service account (optional), through the write-only inbox. Returns the address calendars are shared with, or a problem. */
    putGoogle(text: string): { ok: true; clientEmail: string } | { ok: false } {
      const checked = checkSecret("google_service_account.json", text);
      if (!checked.ok || !checked.clientEmail) return { ok: false };
      inbox.put("google_service_account.json", checked.text);
      return { ok: true, clientEmail: checked.clientEmail };
    },

    /** The backup key's secret half, only while the panel still holds it (before the builder confirms it is elsewhere). */
    backupSecret(): string | undefined { return held()?.identity; },

    /**
     * The builder says the secret half is off this server: they type its last characters back (which shows they have a copy, without the panel asking for the
     * whole key again). Then the panel deletes it, and stops offering it. Returns false when the characters do not match, or there is nothing held.
     */
    confirmBackupKey(lastChars: string): boolean {
      const k = held();
      if (!k?.identity) return false;
      const want = k.identity.trim().slice(-CONFIRM_CHARS).toUpperCase();
      if (lastChars.trim().toUpperCase() !== want) return false;
      store.write(BACKUP_KEY, { recipient: k.recipient, madeAt: k.madeAt, confirmedAt: iso() } satisfies HeldBackupKey);
      return true;
    },
  };
  return api;
}

export type ServerSetup = ReturnType<typeof createServerSetup>;
