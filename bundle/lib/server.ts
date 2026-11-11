// A server folder, and the server's own settings (geometer.json). Everything the bundle reads or writes lives under one folder:
//
//   geometer.json            this server: its id, domain, fleet address, snapshot place, the model (written by `init`)
//   shops/<shop>/            DESIRED STATE. settings.json, runtime.json, pathway.lock. The panel (or `shop add`) writes these.
//   agents/<agent>/          an agent someone else wrote, behind the same Guards: agent.json (which services, which numbers) and settings.json (`agent add` writes these).
//   secrets-inbox/<shop>/    secrets handed in (razorpay_key, whatsapp_token, ...). The deployer moves each into the one container that needs it and deletes it.
//   requests/<shop>.stop.json  a request to stop a shop; the deployer acts, shows `stopped` in status, then removes it (the panel writes these)
//   exports/<shop>/          record.json and bookings.json for the monthly report, without customers' numbers (the deployer writes these)
//   panel/                   the panel's own data (accounts, drafts, papers); the panel writes it, the deployer never reads it
//   status/<shop>.json       RESULTS the deployer writes for the panel: last deploy, "N of M limits proven", versions, last backup and drill, the cost meter's counts.
//   fleet/<shop>.json        fleet's last answer about the shop (plan, allowance, innovator, button mode). Written by ops, the one folder it can write; read by the deployer and the panel.
//   shops/<shop>/report.json  optional: who the owner's monthly report says set the shop up (see readShop). owner.json, the panel's attribution, is read for the same.
//   state/                   the deployer's own memory: Guard bundle versions, stopped shops, lock history, backup times.
//   generated/               compose.yaml, Caddyfile, per-container config. Rewritten on every deploy; never edited by hand.
//   secrets/                 one folder per container, mounted into that container only. Parent mode 0700.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseLock } from "../../modules/runtime/config.ts";
import { KINDS, kindFor, kindNames } from "./kinds.ts";
import { parseAssignmentFile, parseOwner, parseReportFile, resolvePreparedBy } from "../panel/contract.ts";
import { readAnswerFile } from "./fleet.ts";
import { serverIdProblem, shopNameProblem } from "./util.ts";
import { SELF_HOSTED_PROVIDER, isBuilderRate } from "../../modules/understanding/rates.ts";
import type { BuilderRate } from "../../modules/understanding/rates.ts";

export const BUNDLE_VERSION = "0.1.0";

/** What the monthly message says for who set the shop up when nothing says: no report.json and no owner.json (a shop made by `shop add` with no `--prepared-by`). */
export const DEFAULT_PREPARED_BY = "your builder";

/** Where a Guard's upstream is. `tls: false` is for the stand-ins in a test: a real deploy always talks TLS to the provider. */
export interface Upstream { host: string; tls: boolean }

export interface ModelConfig {
  /** "openai" (chat completions: OpenAI, Gemini's compatible endpoint, Sarvam, Groq) or "anthropic" (Messages). */
  wire: "openai" | "anthropic";
  /** The one model every shop on this server may ask for. Guard refuses any other name. */
  model: string;
  /** The provider's host:port. Default api.openai.com:443 / api.anthropic.com:443. */
  upstream?: string;
  /** The provider's path for the call, if it is not the OpenAI / Anthropic default (for example /v1beta/openai/chat/completions). */
  path?: string;
  /** A cap for the whole server, counted by the model Guard. Default 2000 calls a day. */
  callsPerDay?: number;
  /** B73, optional and for a builder's own server only: a model the builder hosts, in place of a hosted provider. See SelfHostedModel. */
  selfHosted?: SelfHostedModel;
  /**
   * The provider's name as the rate table (modules/understanding/rates/) writes it, for the record and the price of each call ("deepinfra"). Left out, the bundle
   * names it from the upstream's host (generate/guards.ts `modelProvider`): api.openai.com is openai, api.anthropic.com anthropic, and so on; a model the builder
   * hosts is always "self-hosted". Needed only for a provider at another address.
   */
  provider?: string;
}

/**
 * B73: a model the builder hosts (their own model server, or Geometer's model gateway in front of it), reached by the server's one model Guard exactly as a hosted
 * provider is: the same model pin, the same calls-per-day cap, the same kill switch, the key handed in with `geometer model-key` (for the gateway, the token its
 * `token issue` printed). Only `wire: "openai"`: the gateway and the common model servers speak OpenAI-compatible chat completions.
 */
export interface SelfHostedModel {
  /** The API root, as an OpenAI client takes it: `https://models.example.in/v1` (the call goes to <url>/chat/completions). Plain http only to a private address. */
  url: string;
  /** The builder's own price, US dollars per million tokens (the numbers in the gateway's own config, if they run it). Left out: the calls are counted with no price. */
  rate?: BuilderRate;
}

/** Private IPv4 ranges (RFC 1918): the only places a self-hosted model may be reached over plain http, so its key never crosses the internet unencrypted. The panel's model form checks with the same pattern. */
export const PRIVATE_IPV4 = /^(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})$/u;

/** Where the model Guard sends a self-hosted model's calls: host:port, whether it talks TLS, and the chat-completions path. Undefined for a hosted provider. */
export function selfHostedTarget(m: Pick<ModelConfig, "selfHosted">): { host: string; tls: boolean; path: string } | undefined {
  if (!m.selfHosted) return undefined;
  const u = new URL(m.selfHosted.url);
  const tls = u.protocol === "https:";
  return { host: `${u.hostname}:${u.port || (tls ? "443" : "80")}`, tls, path: `${u.pathname.replace(/\/+$/u, "")}/chat/completions` };
}

/** Every problem with geometer.json's `model.selfHosted`, in plain words. `hosted`: this is Geometer's partner server. */
function selfHostedProblems(model: Record<string, unknown>, hosted: boolean): string[] {
  const raw = model.selfHosted;
  if (raw === undefined) return [];
  const shape = '"model.selfHosted" must say {"url": "https://<your model server or gateway>/v1"}, with "rate": {"inputUsdPerMillion": <number>, "outputUsdPerMillion": <number>} if you want its calls priced.';
  // Geometer's partner server: Geometer pays the AI there and caps it from its own price list (ai.cap), so a rate set on the server would decide the cap.
  if (hosted) return ['"model.selfHosted" is for a builder\'s own server. On Geometer\'s partner server (panel mode "hosted") the model is Geometer\'s, and its AI cap is priced from Geometer\'s list.'];
  if (!isObj(raw)) return [shape];
  const problems: string[] = [];
  const unknown = Object.keys(raw).filter((k) => k !== "url" && k !== "rate");
  if (unknown.length > 0) problems.push(`"model.selfHosted" has ${unknown.map((k) => `"${k}"`).join(", ")}, which it does not know. It takes "url" and "rate"; the key is handed in with \`geometer model-key\`, never written here.`);
  if (model.wire !== "openai") problems.push('"model.selfHosted" needs "wire": "openai" (OpenAI-compatible chat completions, which the model gateway, vLLM, llama.cpp\'s server and Ollama speak).');
  if (model.upstream !== undefined || model.path !== undefined) problems.push('"model.selfHosted.url" says where the model is, so leave out "model.upstream" and "model.path".');
  let url: URL | undefined;
  try { url = typeof raw.url === "string" ? new URL(raw.url) : undefined; } catch { url = undefined; }
  if (!url || (url.protocol !== "https:" && url.protocol !== "http:")) problems.push(shape);
  else if (url.username || url.password || url.search || url.hash) problems.push('"model.selfHosted.url" must not hold a user name, a password, a query or a #fragment: the key is handed in with `geometer model-key`, never written in geometer.json.');
  else if (url.protocol === "http:" && !PRIVATE_IPV4.test(url.hostname)) problems.push(`"model.selfHosted.url" is plain http to ${url.hostname}, so the model's key would travel unencrypted. Use https, or the model server's private address (10.x, 172.16-31.x or 192.168.x) on your own network. (127.0.0.1 is the model Guard's own container, not this machine.)`);
  if (raw.rate !== undefined && !isBuilderRate(raw.rate)) problems.push('"model.selfHosted.rate" must be {"inputUsdPerMillion": <number>, "outputUsdPerMillion": <number>}: your own price in US dollars per million tokens, 0 or more. Leave it out and the calls are counted with no price.');
  return problems;
}

/** `model.provider`: a short name the rate table could use. "self-hosted" belongs to `selfHosted` alone, and a model the builder hosts takes no other name. */
function providerProblems(model: Record<string, unknown>): string[] {
  const p = model.provider;
  if (p === undefined) return [];
  if (typeof p !== "string" || !/^[a-z][a-z0-9-]{0,39}$/u.test(p)) return ['"model.provider" must be a short lowercase name, as the rate table writes it (for example "deepinfra"). Leave it out for api.openai.com or api.anthropic.com.'];
  if (model.selfHosted !== undefined && p !== SELF_HOSTED_PROVIDER) return [`"model.provider" cannot be "${p}" for a model you host: its calls are "${SELF_HOSTED_PROVIDER}", priced only at your own rate.`];
  if (model.selfHosted === undefined && p === SELF_HOSTED_PROVIDER) return [`"model.provider" "${SELF_HOSTED_PROVIDER}" is for a model you host: add "model.selfHosted" with its URL.`];
  return [];
}

export interface BackupConfig {
  /** Where the nightly snapshots go: an s3:// URL (Google Cloud Storage's S3 interface, Backblaze, R2, MinIO; with `endpoint`) or a folder. A folder on this server's own disk is not off the server. */
  snapshots: { url: string; endpoint?: string; region?: string; keepDays?: number };
  /** The age public key (`age1...`) snapshots are encrypted to. The matching secret key is kept somewhere else (it is only needed to restore). */
  ageRecipient: string;
}

export interface ServerConfig {
  schema: 1;
  id: string;
  /** The builder's domain (HTTPS certificates come automatically). `localhost` or an IP address means a local certificate. */
  domain: string;
  reviewedBy: string;
  guardImage: string;
  /** The image the bundle's own programs run in. */
  appImage: string;
  /**
   * Geometer's fleet: where heartbeats go and the deployment key's file. `deploymentId` is the id fleet knows this server by, only when it differs from `id`: a server
   * set up with pairing skipped and paired later (follow-up 8, 12 Nov 2026) keeps its own `id` (its compose project, volumes and model Guard are named from it, and
   * renaming would leave its data behind), while heartbeats, leases, extensions, the Guards' `[licence]` and the paper-signer claim use fleet's (fleetIdOf).
   */
  fleet?: { url: string; keyFile: string; deploymentId?: string };
  /** How long a held refund waits for the owner, in hours. The one setting behind Guard's bundle AND the words in the owner's message. */
  approvalHours: number;
  model: ModelConfig;
  backup?: BackupConfig;
  /** First two numbers of the private address range the bundle's networks use. Default 10.231. */
  network: { base: string };
  /** For a test: another host for a provider's Guard. */
  upstreams?: Partial<Record<"razorpay" | "whatsapp" | "calendar" | "model", Upstream>>;
  limits: { razorpayLinksPerHour: number; whatsappMessagesPerHour: number; calendarEventsCreatedPerHour: number; calendarEventsDeletedPerDay: number };
  /** The open panel container. "own": a builder's server (invitations from the panel); "hosted": Geometer's partner server (the data key is required). */
  panel: { enabled: boolean; mode: "own" | "hosted" };
  /** Publish Caddy's ports on these host ports. Default 80 and 443. */
  ports: { http: number; https: number };
  /** Seconds between heartbeats. Fleet's contract says 60; a test makes it shorter. */
  heartbeatSeconds: number;
  /**
   * Fleet's licence lease (B13): the public half of fleet's lease key (or keys, while one is rotated), 64 hex characters each, as fleet's `licence key show` prints
   * them. Pinned here at `init --licence-key` (pairing gives it), never taken from a lease. `init` requires it and the deploy refuses a server without it (decision 39,
   * monorepo ADR-0070): a release's Guard runs a shop only under the lease. Optional here only so an older folder still loads and is told what to do.
   */
  licence?: { keys: string[] };
}

export const DEFAULT_GUARD_IMAGE = "geo-guard:0.1.0-alpha.2-pathways.1";
export const DEFAULT_APP_IMAGE = "node:26-alpine";
export const CADDY_IMAGE = "caddy:2.8.4-alpine";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function serverPaths(dir: string) {
  const root = resolve(dir);
  return {
    root,
    config: join(root, "geometer.json"),
    shops: join(root, "shops"),
    shop: (name: string) => join(root, "shops", name),
    /** Agents we did not write ("bring your own agent"): agents/<name>/agent.json and settings.json. Beside shops/, not inside it: the panel and the shop loops never see them. */
    agents: join(root, "agents"),
    agent: (name: string) => join(root, "agents", name),
    secretsInbox: join(root, "secrets-inbox"),
    inbox: (name: string) => join(root, "secrets-inbox", name),
    status: join(root, "status"),
    /** Fleet's answers, written by ops (the one folder it can write); the deployer and the panel read them. */
    fleet: join(root, "fleet"),
    fleetAnswer: (name: string) => join(root, "fleet", `${name}.json`),
    requests: join(root, "requests"),
    stopRequest: (name: string) => join(root, "requests", `${name}.stop.json`),
    exports: join(root, "exports"),
    exportsOf: (name: string) => join(root, "exports", name),
    panel: join(root, "panel"),
    statusFile: (name: string) => join(root, "status", `${name}.json`),
    state: join(root, "state"),
    generated: join(root, "generated"),
    secrets: join(root, "secrets"),
    desiredHash: (name: string) => join(root, "state", "applied", `${name}.json`),
  };
}

/** Read and check geometer.json. Every problem is said in plain words, all at once. */
/**
 * The id fleet knows this server by: `fleet.deploymentId` for a server paired after it was set up (follow-up 8), otherwise its own `id`. Every place that speaks to
 * fleet or checks fleet's signed words uses this (the heartbeat, the lease and extensions, the Guards' `[licence]`, the paper-signer claim); everything local (the
 * compose project, volumes, the model Guard's tenant) keeps `id`.
 */
export const fleetIdOf = (server: Pick<ServerConfig, "id" | "fleet">): string => server.fleet?.deploymentId ?? server.id;

export function loadServer(dir: string): ServerConfig {
  const path = serverPaths(dir).config;
  if (!existsSync(path)) throw new Error(`${path} is not there. Run \`node bundle/geometer.ts init <folder> ...\` to make a server folder.`);
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(path, "utf8")); } catch (e) { throw new Error(`${path} is not valid JSON: ${(e as Error).message}`); }
  const result = parseServer(raw);
  if (result.errors.length > 0) throw new Error(`geometer.json needs fixing:\n- ${result.errors.join("\n- ")}`);
  return result.config;
}

export function parseServer(raw: unknown): { config: ServerConfig; errors: string[]; notes: string[] } {
  const errors: string[] = [];
  const o = isObj(raw) ? raw : {};
  if (!isObj(raw)) errors.push("geometer.json must be an object.");
  const text = (key: string, fallback?: string): string => {
    const v = o[key] ?? fallback;
    if (typeof v !== "string" || v.trim() === "") { errors.push(`"${key}" is missing.`); return ""; }
    return v;
  };
  const id = text("id");
  const idProblem = id ? serverIdProblem(id) : undefined;
  if (idProblem) errors.push(idProblem);
  const domain = text("domain");
  const reviewedBy = text("reviewedBy");
  if (reviewedBy && !/^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/u.test(reviewedBy)) errors.push('"reviewedBy" must be an id: letters, digits and . _ : / @ + -.');
  const approvalHours = o.approvalHours ?? 24;
  if (typeof approvalHours !== "number" || !Number.isInteger(approvalHours) || approvalHours < 1 || approvalHours > 168) errors.push('"approvalHours" must be a whole number of hours from 1 to 168 (Guard allows at most seven days).');
  // "model" may be left out until the first shop: the one-step install (install.sh, plan item 14b) makes the folder before the panel's first run asks for the model.
  // A deploy refuses until it is chosen (deploy.ts, serverProblems). When it is there it must be whole.
  const model = isObj(o.model) ? o.model : undefined;
  if (o.model !== undefined && (!model || (model.wire !== "openai" && model.wire !== "anthropic") || typeof model.model !== "string" || model.model === "")) errors.push('"model" must say {"wire": "openai" or "anthropic", "model": "<the one model name every shop may ask for>"}.');
  if (model) errors.push(...selfHostedProblems(model, isObj(o.panel) && o.panel.mode === "hosted"), ...providerProblems(model));
  const network = isObj(o.network) ? o.network : {};
  const base = typeof network.base === "string" ? network.base : "10.231";
  if (!/^\d{1,3}\.\d{1,3}$/u.test(base)) errors.push('"network.base" must be the first two numbers of a private range, like "10.231".');
  const limits = isObj(o.limits) ? o.limits : {};
  const limit = (key: string, fallback: number): number => {
    const v = limits[key] ?? fallback;
    if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 1) { errors.push(`"limits.${key}" must be a whole number above zero.`); return fallback; }
    return v;
  };
  const licence = isObj(o.licence) ? o.licence : undefined;
  const licenceKeys = licence && Array.isArray(licence.keys) ? licence.keys : undefined;
  if (o.licence !== undefined && (!licenceKeys || licenceKeys.length === 0 || licenceKeys.length > 4 || !licenceKeys.every((k) => typeof k === "string" && /^[0-9a-f]{64}$/u.test(k)))) errors.push('"licence" must say {"keys": ["<64 hex characters>"]}: the public half of fleet\'s licence key, as fleet\'s `licence key show` prints it (one to four keys).');
  const fleet = isObj(o.fleet) ? o.fleet : undefined;
  if (o.fleet !== undefined && (!fleet || typeof fleet.url !== "string" || typeof fleet.keyFile !== "string")) errors.push('"fleet" must say {"url": "https://...", "keyFile": "<a file that holds this server\'s deployment key>"}.');
  if (fleet && typeof fleet.url === "string" && !/^https:\/\//u.test(fleet.url) && !/^http:\/\/(localhost|127\.0\.0\.1|host\.docker\.internal)/u.test(fleet.url)) errors.push('"fleet.url" must be https:// (the deployment key is a bearer secret).');
  const fleetId = fleet?.deploymentId;
  if (fleetId !== undefined && (typeof fleetId !== "string" || serverIdProblem(fleetId))) errors.push('"fleet.deploymentId" must be the server id fleet gave this server when it was paired (pairing.json).');
  const config: ServerConfig = {
    schema: 1, id, domain, reviewedBy,
    guardImage: typeof o.guardImage === "string" ? o.guardImage : DEFAULT_GUARD_IMAGE,
    appImage: typeof o.appImage === "string" ? o.appImage : DEFAULT_APP_IMAGE,
    ...(fleet && typeof fleet.url === "string" && typeof fleet.keyFile === "string" ? { fleet: { url: fleet.url, keyFile: fleet.keyFile, ...(typeof fleetId === "string" && !serverIdProblem(fleetId) ? { deploymentId: fleetId } : {}) } } : {}),
    approvalHours: typeof approvalHours === "number" ? approvalHours : 24,
    model: (model ?? { wire: "openai", model: "" }) as unknown as ModelConfig,
    ...(isObj(o.backup) ? { backup: o.backup as unknown as BackupConfig } : {}),
    network: { base },
    ...(isObj(o.upstreams) ? { upstreams: o.upstreams as ServerConfig["upstreams"] } : {}),
    limits: { razorpayLinksPerHour: limit("razorpayLinksPerHour", 60), whatsappMessagesPerHour: limit("whatsappMessagesPerHour", 200), calendarEventsCreatedPerHour: limit("calendarEventsCreatedPerHour", 30), calendarEventsDeletedPerDay: limit("calendarEventsDeletedPerDay", 20) },
    panel: { enabled: isObj(o.panel) ? o.panel.enabled === true : false, mode: isObj(o.panel) && o.panel.mode === "hosted" ? "hosted" : "own" },
    heartbeatSeconds: typeof o.heartbeatSeconds === "number" && o.heartbeatSeconds >= 5 ? o.heartbeatSeconds : 60,
    ...(licenceKeys && licenceKeys.every((k) => typeof k === "string") ? { licence: { keys: licenceKeys as string[] } } : {}),
    ports: { http: isObj(o.ports) && Number.isInteger(o.ports.http) ? o.ports.http as number : 80, https: isObj(o.ports) && Number.isInteger(o.ports.https) ? o.ports.https as number : 443 },
  };
  const notes: string[] = [];
  if (config.backup) {
    const b = config.backup as Partial<BackupConfig> & { stream?: unknown };
    if (!isObj(b.snapshots) || typeof b.snapshots.url !== "string" || typeof b.ageRecipient !== "string" || !/^age1[02-9ac-hj-np-z]{58}$/u.test(b.ageRecipient)) errors.push('"backup" must say {"snapshots": {"url": "s3://..." or a folder}, "ageRecipient": "age1..."}.');
    // a server set up before 9 Nov 2026 names the continuous copy's bucket: it is no longer used, and said so rather than silently ignored
    if (b.stream !== undefined) { const { stream: _unused, ...rest } = b; notes.push(STREAM_NOTE); config.backup = rest as BackupConfig; }
  }
  return { config, errors, notes };
}

/** What `check`, `deploy` and `status` say about a geometer.json that still names "backup.stream" (a server set up before 9 Nov 2026). */
export const STREAM_NOTE = 'geometer.json still names "backup.stream", the bucket of the continuous copy (Litestream). The bundle no longer makes that copy: the nightly snapshot is the backup, and the stream bucket and its key are not used. Take "stream" out of geometer.json to stop this note; the bucket can then be emptied and deleted.';

/** The plain notes about this server's geometer.json (none when it cannot be read: loadServer says why). */
export function serverNotes(dir: string): string[] {
  try { return parseServer(JSON.parse(readFileSync(serverPaths(dir).config, "utf8"))).notes; } catch { return []; }
}

/** Has this server chosen its one model yet? A folder made by the one-step install has not, until the panel's first run (or the builder by hand) says which. */
export const modelChosen = (server: Pick<ServerConfig, "model">): boolean => server.model.model !== "";

/** What `deploy`, `check` and `model-key` say while no model is chosen. */
export const NO_MODEL = 'No model is chosen for this server yet, and every shop\'s agent needs one. The panel\'s first run asks for it; by hand, put "model": {"wire": "openai", "model": "gpt-4o-mini"} (or "anthropic" and its model) in geometer.json, then hand in its key with `geometer model-key <file>`.';

/** Is this domain one a public certificate authority could never give a certificate to? Then Caddy makes its own (`tls internal`). */
export const isLocalDomain = (domain: string): boolean => domain === "localhost" || domain.endsWith(".localhost") || domain.endsWith(".local") || domain.endsWith(".internal") || /^\d{1,3}(\.\d{1,3}){3}$/u.test(domain);

/** The address the world reaches this server at: https, the builder's domain, and the port only when it is not 443. */
export const publicUrl = (server: Pick<ServerConfig, "domain" | "ports">): string => `https://${server.domain}${server.ports.https === 443 ? "" : `:${server.ports.https}`}`;

export function listShops(dir: string): string[] {
  const shops = serverPaths(dir).shops;
  if (!existsSync(shops)) return [];
  return readdirSync(shops, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name).sort();
}

/** What the panel writes in runtime.json. The deployer owns where things are (hosts, ports, folders, token files); the panel owns who things are. */
export interface PanelRuntime {
  mode?: string;
  tickSeconds?: number;
  services?: {
    payments?: Record<string, unknown>;
    calendar?: { calendarId?: string } & Record<string, unknown>;
    messaging?: { phoneNumberId?: string } & Record<string, unknown>;
    timeoutMs?: number;
  };
  parser?: { wire?: string; model?: string; timeoutMs?: number } & Record<string, unknown>;
  [key: string]: unknown;
}

/** shops/<shop>/pins.json, written by the panel after its connection checks: the ids the providers confirmed. None is a secret. The generator pins the Guards to THESE. */
export interface Pins {
  whatsapp?: { phoneNumberId: string };
  calendar?: { calendarId: string };
  /** B71: the gateway key the panel's check confirmed, and whose (the provider's id). Only for a shop that chose a gateway. */
  gateway?: { provider: string; keyId: string; mode: "test" | "live" };
}

export interface ShopFolder {
  name: string;
  settingsText: string;
  pinsText: string;
  pins: Pins;
  /** The settings, checked by the template the shop's pathway.lock names, and in that template's own shape. */
  settings: any;
  runtime: PanelRuntime;
  lock: { pathway: string; version: string } | undefined;
  lockText: string;
  /**
   * Fleet's last word on this shop's AI (fleet/<shop>.json, written by ops): "buttons" only when fleet said so for a shop that has a plan. Anything else (no file,
   * an unreadable one, "normal", no plan) is undefined, and then nothing is added to the shop's runtime config. It is read from fleet's folder, never from
   * the panel's runtime.json, which the panel rewrites.
   */
  fleetAi?: "buttons";
  /**
   * Fleet's last word on the month's AI cap (fleet/<shop>.json): "off" only when fleet said so for a shop that has a plan; then the generated runtime config gets
   * `"model": "off"` and the shop's language model is left out. Anything else is undefined and adds nothing, as for `fleetAi`.
   */
  fleetModel?: "off";
  /**
   * Who the owner's monthly report says set the shop up: shops/<shop>/report.json if it has one, else the panel's attribution (owner.json: "Divya, local partner"), else
   * DEFAULT_PREPARED_BY. `preparedBySource` says which, so a deploy can tell the builder when it had to fall back.
   */
  preparedBy: string;
  preparedBySource: "assignment.json" | "report.json" | "owner.json" | "default";
  /** Fleet's last word on whether this shop's builder or partner has the Innovator badge (fleet/<shop>.json). False when fleet has said nothing readable. */
  innovator: boolean;
  /** Plain-words problems reading the folder (missing file, bad JSON, bad settings). */
  problems: string[];
}

/** Read one shop's desired state. Never throws: what is wrong comes back as `problems`. */
export function readShop(dir: string, name: string): ShopFolder {
  const folder = serverPaths(dir).shop(name);
  const problems: string[] = [];
  const nameProblem = shopNameProblem(name);
  if (nameProblem) problems.push(nameProblem);
  const read = (file: string): string => {
    const path = join(folder, file);
    if (!existsSync(path)) { problems.push(`${file} is missing in ${folder}.`); return ""; }
    return readFileSync(path, "utf8");
  };
  const settingsText = read("settings.json");
  // The template is the one the lock names. A lock that is missing or unreadable is said below, in its place; until then the settings are judged as Bookings' have always been.
  let named: string | undefined;
  try { named = parseLock(readFileSync(join(folder, "pathway.lock"), "utf8")).pathway; } catch { /* said below */ }
  const kind = named === undefined ? KINDS.bookings : kindFor(named);
  let settings: any;
  if (settingsText && kind) {
    try {
      const checked = kind.validateSettings(JSON.parse(settingsText));
      if (checked.ok) settings = checked.settings; else problems.push(...checked.errors.map((e) => `settings.json: ${e}`));
    } catch (e) { problems.push(`settings.json is not valid JSON: ${(e as Error).message}`); }
  }
  let runtime: PanelRuntime = {};
  const runtimeText = read("runtime.json");
  if (runtimeText) {
    try { const parsed: unknown = JSON.parse(runtimeText); if (isObj(parsed)) runtime = parsed as PanelRuntime; else problems.push("runtime.json must be an object."); } catch (e) { problems.push(`runtime.json is not valid JSON: ${(e as Error).message}`); }
  }
  // pins.json is optional: without it the ids in runtime.json are used
  const pinsPath = join(folder, "pins.json");
  const pinsText = existsSync(pinsPath) ? readFileSync(pinsPath, "utf8") : "";
  const pins: Pins = {};
  if (pinsText) {
    try {
      const p: unknown = JSON.parse(pinsText);
      if (!isObj(p) || p.schema !== 1) throw new Error("it is not a pins file (schema 1)");
      if (isObj(p.whatsapp) && typeof p.whatsapp.phoneNumberId === "string") pins.whatsapp = { phoneNumberId: p.whatsapp.phoneNumberId };
      if (isObj(p.calendar) && typeof p.calendar.calendarId === "string") pins.calendar = { calendarId: p.calendar.calendarId };
      if (isObj(p.gateway) && typeof p.gateway.provider === "string" && typeof p.gateway.keyId === "string" && (p.gateway.mode === "test" || p.gateway.mode === "live")) pins.gateway = { provider: p.gateway.provider, keyId: p.gateway.keyId, mode: p.gateway.mode };
    } catch (e) { problems.push(`pins.json is not usable: ${(e as Error).message}`); }
  }
  // who set the shop up, for the owner's monthly report: report.json (a person's word), else owner.json (the panel's attribution), else a plain default
  const optional = (file: string): string | undefined => { const path = join(folder, file); return existsSync(path) ? readFileSync(path, "utf8") : undefined; };
  const reportText = optional("report.json");
  const reportFile = parseReportFile(reportText);
  if (reportText !== undefined && !reportFile) problems.push('report.json is not usable: it must be {"schema": 1, "preparedBy": "Divya, local partner"}, the name on one line, up to 120 characters.');
  const ownerFile = parseOwner(optional("owner.json"));
  const assignment = parseAssignmentFile(optional("assignment.json"));
  const by = resolvePreparedBy({ ...(reportFile ? { report: reportFile } : {}), ...(ownerFile ? { owner: ownerFile } : {}), ...(assignment ? { assignment } : {}) });
  const lockText = read("pathway.lock");
  let lock: { pathway: string; version: string } | undefined;
  if (lockText) { try { lock = parseLock(lockText); } catch (e) { problems.push((e as Error).message); } }
  if (lock && !kind) problems.push(`pathway.lock is pinned to "${lock.pathway}", which this bundle does not run. It runs: ${kindNames()}.`);
  const answer = readAnswerFile(serverPaths(dir).fleetAnswer(name));
  const fleetAi = answer?.ai === "buttons" && answer.plan !== null ? "buttons" as const : undefined;
  const fleetModel = answer?.model === "off" && answer.plan !== null ? "off" as const : undefined;
  return { name, settingsText, pinsText, pins, settings, runtime, lock, lockText, ...(fleetAi ? { fleetAi } : {}), ...(fleetModel ? { fleetModel } : {}), preparedBy: by?.name ?? DEFAULT_PREPARED_BY, preparedBySource: by?.source ?? "default", innovator: answer?.innovator === true, problems };
}
