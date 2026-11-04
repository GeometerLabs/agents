// A server folder, and the server's own settings (geometer.json). Everything the bundle reads or writes lives under one folder:
//
//   geometer.json            this server: its id, domain, fleet address, backup target, the model (written by `init`)
//   shops/<shop>/            DESIRED STATE. settings.json, runtime.json, pathway.lock. The panel (or `shop add`) writes these.
//   agents/<agent>/          an agent someone else wrote, behind the same Guards: agent.json (which services, which numbers) and settings.json (`agent add` writes these).
//   secrets-inbox/<shop>/    secrets handed in (razorpay_key, whatsapp_token, ...). The deployer moves each into the one container that needs it and deletes it.
//   requests/<shop>.stop.json  a request to stop a shop; the deployer acts, shows `stopped` in status, then removes it (the panel writes these)
//   exports/<shop>/          record.json and bookings.json for the monthly report, without customers' numbers (the deployer writes these)
//   panel/                   the panel's own data (accounts, drafts, papers); the panel writes it, the deployer never reads it
//   status/<shop>.json       RESULTS the deployer writes for the panel: last deploy, "N of M limits proven", versions, last backup and drill.
//   state/                   the deployer's own memory: Guard bundle versions, stopped shops, lock history, backup times.
//   generated/               compose.yaml, Caddyfile, per-container config. Rewritten on every deploy; never edited by hand.
//   secrets/                 one folder per container, mounted into that container only. Parent mode 0700.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { validateSettings } from "../../pathways/bookings/src/settings.ts";
import type { Settings } from "../../pathways/bookings/src/settings.ts";
import { parseLock } from "../../pathways/bookings/server/config.ts";
import { serverIdProblem, shopNameProblem } from "./util.ts";

export const BUNDLE_VERSION = "0.1.0";

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
}

export interface BackupConfig {
  /** Litestream's target for the runtime databases: an s3:// URL (Google Cloud Storage's S3 interface, Backblaze, R2, MinIO). */
  stream: { url: string; endpoint?: string; region?: string };
  /** Where the nightly snapshots go: a different place from the stream. An s3:// URL (with `endpoint`) or a folder on this machine. */
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
  fleet?: { url: string; keyFile: string };
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
}

export const DEFAULT_GUARD_IMAGE = "geo-guard:0.1.0-alpha.2-pathways.1";
export const DEFAULT_APP_IMAGE = "node:26-alpine";
export const LITESTREAM_IMAGE = "litestream/litestream:0.5.17-scratch";
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
export function loadServer(dir: string): ServerConfig {
  const path = serverPaths(dir).config;
  if (!existsSync(path)) throw new Error(`${path} is not there. Run \`node bundle/geometer.ts init <folder> ...\` to make a server folder.`);
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(path, "utf8")); } catch (e) { throw new Error(`${path} is not valid JSON: ${(e as Error).message}`); }
  const result = parseServer(raw);
  if (result.errors.length > 0) throw new Error(`geometer.json needs fixing:\n- ${result.errors.join("\n- ")}`);
  return result.config;
}

export function parseServer(raw: unknown): { config: ServerConfig; errors: string[] } {
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
  const model = isObj(o.model) ? o.model : undefined;
  if (!model || (model.wire !== "openai" && model.wire !== "anthropic") || typeof model.model !== "string" || model.model === "") errors.push('"model" must say {"wire": "openai" or "anthropic", "model": "<the one model name every shop may ask for>"}.');
  const network = isObj(o.network) ? o.network : {};
  const base = typeof network.base === "string" ? network.base : "10.231";
  if (!/^\d{1,3}\.\d{1,3}$/u.test(base)) errors.push('"network.base" must be the first two numbers of a private range, like "10.231".');
  const limits = isObj(o.limits) ? o.limits : {};
  const limit = (key: string, fallback: number): number => {
    const v = limits[key] ?? fallback;
    if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 1) { errors.push(`"limits.${key}" must be a whole number above zero.`); return fallback; }
    return v;
  };
  const fleet = isObj(o.fleet) ? o.fleet : undefined;
  if (o.fleet !== undefined && (!fleet || typeof fleet.url !== "string" || typeof fleet.keyFile !== "string")) errors.push('"fleet" must say {"url": "https://...", "keyFile": "<a file that holds this server\'s deployment key>"}.');
  if (fleet && typeof fleet.url === "string" && !/^https:\/\//u.test(fleet.url) && !/^http:\/\/(localhost|127\.0\.0\.1|host\.docker\.internal)/u.test(fleet.url)) errors.push('"fleet.url" must be https:// (the deployment key is a bearer secret).');
  const config: ServerConfig = {
    schema: 1, id, domain, reviewedBy,
    guardImage: typeof o.guardImage === "string" ? o.guardImage : DEFAULT_GUARD_IMAGE,
    appImage: typeof o.appImage === "string" ? o.appImage : DEFAULT_APP_IMAGE,
    ...(fleet && typeof fleet.url === "string" && typeof fleet.keyFile === "string" ? { fleet: { url: fleet.url, keyFile: fleet.keyFile } } : {}),
    approvalHours: typeof approvalHours === "number" ? approvalHours : 24,
    model: (model ?? { wire: "openai", model: "" }) as unknown as ModelConfig,
    ...(isObj(o.backup) ? { backup: o.backup as unknown as BackupConfig } : {}),
    network: { base },
    ...(isObj(o.upstreams) ? { upstreams: o.upstreams as ServerConfig["upstreams"] } : {}),
    limits: { razorpayLinksPerHour: limit("razorpayLinksPerHour", 60), whatsappMessagesPerHour: limit("whatsappMessagesPerHour", 200), calendarEventsCreatedPerHour: limit("calendarEventsCreatedPerHour", 30), calendarEventsDeletedPerDay: limit("calendarEventsDeletedPerDay", 20) },
    panel: { enabled: isObj(o.panel) ? o.panel.enabled === true : false, mode: isObj(o.panel) && o.panel.mode === "hosted" ? "hosted" : "own" },
    heartbeatSeconds: typeof o.heartbeatSeconds === "number" && o.heartbeatSeconds >= 5 ? o.heartbeatSeconds : 60,
    ports: { http: isObj(o.ports) && Number.isInteger(o.ports.http) ? o.ports.http as number : 80, https: isObj(o.ports) && Number.isInteger(o.ports.https) ? o.ports.https as number : 443 },
  };
  if (config.backup) {
    const b = config.backup as Partial<BackupConfig>;
    if (!isObj(b.stream) || typeof b.stream.url !== "string" || !isObj(b.snapshots) || typeof b.snapshots.url !== "string" || typeof b.ageRecipient !== "string" || !/^age1[02-9ac-hj-np-z]{58}$/u.test(b.ageRecipient)) errors.push('"backup" must say {"stream": {"url": "s3://..."}, "snapshots": {"url": "s3://..." or a folder}, "ageRecipient": "age1..."}.');
    else if (b.stream.url === b.snapshots.url) errors.push('"backup.snapshots" must be a different place from "backup.stream": a copy in the same place is one copy.');
  }
  return { config, errors };
}

/** Is this domain one a public certificate authority could never give a certificate to? Then Caddy makes its own (`tls internal`). */
export const isLocalDomain = (domain: string): boolean => domain === "localhost" || domain.endsWith(".localhost") || domain.endsWith(".local") || domain.endsWith(".internal") || /^\d{1,3}(\.\d{1,3}){3}$/u.test(domain);

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
  razorpay?: { keyId: string; mode: "test" | "live" };
}

export interface ShopFolder {
  name: string;
  settingsText: string;
  pinsText: string;
  pins: Pins;
  settings: Settings | undefined;
  runtime: PanelRuntime;
  lock: { pathway: string; version: string } | undefined;
  lockText: string;
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
  let settings: Settings | undefined;
  if (settingsText) {
    try {
      const checked = validateSettings(JSON.parse(settingsText));
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
      if (isObj(p.razorpay) && typeof p.razorpay.keyId === "string" && (p.razorpay.mode === "test" || p.razorpay.mode === "live")) pins.razorpay = { keyId: p.razorpay.keyId, mode: p.razorpay.mode };
    } catch (e) { problems.push(`pins.json is not usable: ${(e as Error).message}`); }
  }
  const lockText = read("pathway.lock");
  let lock: { pathway: string; version: string } | undefined;
  if (lockText) { try { lock = parseLock(lockText); } catch (e) { problems.push((e as Error).message); } }
  return { name, settingsText, pinsText, pins, settings, runtime, lock, lockText, problems };
}
