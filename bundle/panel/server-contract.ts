// The server's own settings, as files the panel and the deployer share (plan item 14b, part 2: the panel's first run). The panel never writes geometer.json
// (it is mounted read-only into the panel); it writes a REQUEST, and the host-side deployer (bundle/server-settings.ts) checks it, writes geometer.json and
// says what happened in a status file, the same pattern as a shop's desired state and its status. Keys go through the same write-only inbox as a shop's.
//
//   <server>/requests/_server.model.json    panel      the model every shop's agent uses (geometer.json `model`): a hosted provider, or one the builder hosts (B73)
//   <server>/requests/_server.backup.json   panel      where the nightly snapshots go, and the age public key they are encrypted to (geometer.json `backup`)
//   <server>/secrets-inbox/_server/<name>   panel      model_key, backup_key ("<access key id>:<secret>"), google_service_account.json. Written, never read back.
//   <server>/status/_server.json            deployer   each request applied or refused (with why), which keys are in place (never a key), the backup's test write
//
// "_server" can never be a shop's name (a shop's name starts with a letter or a digit), so none of these files is mistaken for a shop's.
// Who uses this file: panel/server-setup.ts (the panel's side), bundle/server-settings.ts (the deployer's side) and their tests.
import { join, resolve } from "node:path";
import { isObj } from "./contract.ts";
import { PRIVATE_IPV4 } from "../lib/server.ts";
import { SELF_HOSTED_PROVIDER, isBuilderRate } from "../../modules/understanding/rates.ts";
import type { BuilderRate } from "../../modules/understanding/rates.ts";

export const SERVER_NAME = "_server";
export const SERVER_SECRET_NAMES = ["model_key", "backup_key", "google_service_account.json", "speech_key"] as const;
export type ServerSecretName = (typeof SERVER_SECRET_NAMES)[number];

// Folders for the server-settings requests, status and key inbox, from one root so panel and deployer name the same files.
export function serverSettingsPaths(dir: string) {
  const root = resolve(dir);
  return {
    modelRequest: join(root, "requests", `${SERVER_NAME}.model.json`),
    backupRequest: join(root, "requests", `${SERVER_NAME}.backup.json`),
    inbox: join(root, "secrets-inbox", SERVER_NAME),
    status: join(root, "status", `${SERVER_NAME}.json`),
    config: join(root, "geometer.json"),
  };
}

/** geometer.json's `model`, as the panel may choose it: lib/server.ts `ModelConfig`'s fields the panel sets, B73's `selfHosted` and `provider` included. */
export interface ModelChoice {
  wire: "openai" | "anthropic";
  /** The one model name every shop may ask for; the model Guard refuses any other. */
  model: string;
  /** Another OpenAI-compatible provider: its host:port and the chat path (Gemini's OpenAI endpoint, Sarvam, Groq). Left out: OpenAI's or Anthropic's own. */
  upstream?: string;
  path?: string;
  /** The provider's name as the rate table writes it ("deepinfra"), for a provider at another address. */
  provider?: string;
  /** A model the builder hosts (B73): its API root, and their own price. Only with wire "openai". */
  selfHosted?: { url: string; rate?: BuilderRate };
}

/** geometer.json's `backup`, as the panel may choose it: an S3-compatible bucket only (a folder on this server is not a backup). */
export interface BackupChoice { url: string; endpoint?: string; region?: string; ageRecipient: string }

export interface Requester { id: string; name: string; role: "builder" | "partner" }
export interface ServerModelRequest { schema: 1; requestId: string; requestedAt: string; requestedBy: Requester; model: ModelChoice }
export interface ServerBackupRequest { schema: 1; requestId: string; requestedAt: string; requestedBy: Requester; backup: BackupChoice }

/** What happened to one request. `message` is the deployer's plain sentence (English: the server's own settings are a builder's page). */
export interface Outcome { requestId: string; state: "applied" | "refused" | "waiting"; at: string; message: string }

export interface ServerStatus {
  schema: 1;
  updatedAt: string;
  requests: { model?: Outcome; backup?: Outcome };
  /** Which keys the deployer has put in place, and when. Never a key, and never any part of one. `google.clientEmail` is the address calendars are shared with. */
  keys: { model?: { at: string }; backup?: { at: string }; google?: { at: string; clientEmail: string }; /** Voice notes (B29): the speech provider's key is in place (never the key). */ speech?: { at: string } };
  /** A key handed in that the deployer could not use yet, or at all, said by name (never by value). */
  inbox?: { name: ServerSecretName; message: string }[];
  /** The bucket test: an object written, read back and deleted with the key handed in. */
  backupTest?: { at: string; ok: boolean; detail: string };
}

export interface Problem { field: string; message: string }

const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,99}$/u;
const HOST_PORT = /^(?=.{1,253}:)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]:\d{1,5}$/u;
const CHAT_PATH = /^\/[A-Za-z0-9._~/-]{1,200}$/u;
const PROVIDER = /^[a-z][a-z0-9-]{0,39}$/u;
const AGE_RECIPIENT = /^age1[02-9ac-hj-np-z]{58}$/u;
const BUCKET_URL = /^s3:\/\/[a-z0-9][a-z0-9.-]{1,61}[a-z0-9](\/[A-Za-z0-9._-]+)*\/?$/u;
const REGION = /^[a-z0-9][a-z0-9-]{0,39}$/u;


/** Every problem with a model choice, by field. Shape only: whether the provider answers is the first shop's deploy's business. */
export function modelChoiceProblems(raw: unknown): Problem[] {
  const p: Problem[] = [];
  if (!isObj(raw)) return [{ field: "model", message: "There is no model to choose." }];
  const known = ["wire", "model", "upstream", "path", "provider", "selfHosted"];
  const unknown = Object.keys(raw).filter((k) => !known.includes(k));
  if (unknown.length > 0) p.push({ field: "model", message: `The model's settings have ${unknown.map((k) => `"${k}"`).join(", ")}, which this panel does not set.` });
  if (raw.wire !== "openai" && raw.wire !== "anthropic") p.push({ field: "wire", message: 'The way the model is spoken to must be "openai" (OpenAI-compatible) or "anthropic".' });
  if (typeof raw.model !== "string" || !MODEL_NAME.test(raw.model)) p.push({ field: "model", message: "The model's name is missing, or has spaces or other characters a model name does not have." });
  if (raw.upstream !== undefined && (typeof raw.upstream !== "string" || !HOST_PORT.test(raw.upstream))) p.push({ field: "upstream", message: "The provider's address must be its host and port, like generativelanguage.googleapis.com:443." });
  if (raw.path !== undefined && (typeof raw.path !== "string" || !CHAT_PATH.test(raw.path))) p.push({ field: "path", message: "The chat path must start with / and hold no spaces, like /v1beta/openai/chat/completions." });
  if (raw.provider !== undefined && (typeof raw.provider !== "string" || !PROVIDER.test(raw.provider))) p.push({ field: "provider", message: 'The provider\'s name is a short lowercase name, like "deepinfra".' });
  if (raw.selfHosted !== undefined) {
    const s = raw.selfHosted;
    if (raw.wire !== "openai") p.push({ field: "wire", message: "A model you host is spoken to as OpenAI-compatible chat completions: choose openai." });
    if (raw.upstream !== undefined || raw.path !== undefined) p.push({ field: "selfHosted.url", message: "A model you host is reached at its own address: leave out the provider's address and path." });
    if (raw.provider !== undefined && raw.provider !== SELF_HOSTED_PROVIDER) p.push({ field: "provider", message: `A model you host is always "${SELF_HOSTED_PROVIDER}".` });
    let url: URL | undefined;
    try { url = isObj(s) && typeof s.url === "string" ? new URL(s.url) : undefined; } catch { url = undefined; }
    if (!isObj(s) || Object.keys(s).some((k) => k !== "url" && k !== "rate") || !url || (url.protocol !== "https:" && url.protocol !== "http:")) p.push({ field: "selfHosted.url", message: "Your model server's address must look like https://models.example.in/v1." });
    else if (url.username || url.password || url.search || url.hash) p.push({ field: "selfHosted.url", message: "Your model server's address must not hold a name, a password, a ? or a #: the key goes in its own field." });
    else if (url.protocol === "http:" && !PRIVATE_IPV4.test(url.hostname)) p.push({ field: "selfHosted.url", message: `Plain http to ${url.hostname} would send the model's key unencrypted. Use https, or the model server's private address (10.x, 172.16-31.x or 192.168.x).` });
    if (isObj(s) && s.rate !== undefined && !isBuilderRate(s.rate)) p.push({ field: "selfHosted.rate", message: "Your own price is two numbers of 0 or more: US dollars per million input tokens and per million output tokens." });
  } else if (raw.provider === SELF_HOSTED_PROVIDER) p.push({ field: "provider", message: `"${SELF_HOSTED_PROVIDER}" is for a model you host: give its address.` });
  return p;
}

/** Every problem with a backup choice, by field. Whether the bucket takes the key is the deployer's test write. */
export function backupChoiceProblems(raw: unknown): Problem[] {
  const p: Problem[] = [];
  if (!isObj(raw)) return [{ field: "backup", message: "There is no backup place to set." }];
  const unknown = Object.keys(raw).filter((k) => !["url", "endpoint", "region", "ageRecipient"].includes(k));
  if (unknown.length > 0) p.push({ field: "backup", message: `The backup settings have ${unknown.map((k) => `"${k}"`).join(", ")}, which this panel does not set.` });
  if (typeof raw.url !== "string" || !BUCKET_URL.test(raw.url)) p.push({ field: "url", message: "The bucket must be written s3://bucket-name or s3://bucket-name/folder (lowercase bucket name)." });
  if (raw.endpoint !== undefined) {
    let ok = false;
    try { const u = new URL(String(raw.endpoint)); ok = u.protocol === "https:" && u.origin === String(raw.endpoint).replace(/\/+$/u, ""); } catch { ok = false; }
    if (!ok) p.push({ field: "endpoint", message: "The storage service's address must be https and nothing else, like https://storage.googleapis.com." });
  }
  if (raw.region !== undefined && (typeof raw.region !== "string" || !REGION.test(raw.region))) p.push({ field: "region", message: "The region is a short name like asia-south1 or auto." });
  if (typeof raw.ageRecipient !== "string" || !AGE_RECIPIENT.test(raw.ageRecipient)) p.push({ field: "ageRecipient", message: "The backup key's public half must be an age key: age1 and 58 more letters and digits." });
  return p;
}

/** A model or bucket key's shape, checked by name and never repeated in a message. Google's file is checked by the shops' intake (secrets.ts). */
export function serverKeyShapeOk(name: "model_key" | "backup_key" | "speech_key", value: string): boolean {
  const v = value.trim();
  if (name === "speech_key") return /^[^\s]{8,400}$/u.test(v); // one line, no spaces: the speech provider's key as it shows it
  if (name === "model_key") return /^[^\s]{8,4000}$/u.test(v);
  return /^[^:\s]{3,200}:[^\s]{8,400}$/u.test(v);
}

const requester = (v: unknown): v is Requester => isObj(v) && typeof v.id === "string" && typeof v.name === "string" && (v.role === "builder" || v.role === "partner");
const header = (r: Record<string, unknown>): boolean => r.schema === 1 && typeof r.requestId === "string" && /^[a-z0-9_]{6,64}$/u.test(r.requestId) && typeof r.requestedAt === "string" && requester(r.requestedBy);

// Checks a "use this model" request file before the deployer acts on it; anything malformed is ignored rather than half applied.
export function parseModelRequest(text: string | undefined): ServerModelRequest | undefined {
  try { const r: unknown = text === undefined ? undefined : JSON.parse(text); return isObj(r) && header(r) && isObj(r.model) ? r as unknown as ServerModelRequest : undefined; } catch { return undefined; }
}
// Checks a backup-destination request file; same reason as parseModelRequest.
export function parseBackupRequest(text: string | undefined): ServerBackupRequest | undefined {
  try { const r: unknown = text === undefined ? undefined : JSON.parse(text); return isObj(r) && header(r) && isObj(r.backup) ? r as unknown as ServerBackupRequest : undefined; } catch { return undefined; }
}
// Reads the deployer's account of what happened to those requests; undefined means "no answer yet", which the page shows as waiting.
export function parseServerStatus(text: string | undefined): ServerStatus | undefined {
  try { const r: unknown = text === undefined ? undefined : JSON.parse(text); return isObj(r) && r.schema === 1 && typeof r.updatedAt === "string" && isObj(r.requests) && isObj(r.keys) ? r as unknown as ServerStatus : undefined; } catch { return undefined; }
}
