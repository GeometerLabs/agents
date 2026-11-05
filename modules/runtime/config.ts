// A client's folder, read and checked: clients/<name>/settings.json (the business), runtime.json (how this agent runs) and
// pathway.lock (which pathway version it is pinned to). Every problem is said in plain words, all at once, so a builder can
// fix the folder without a manual. Nothing secret lives here: the internal token is a file named in the environment, and the
// service keys are never in the runtime at all (Guard holds them).
//
// Everything in runtime.json is the same for every template except WHICH services it calls (Bookings: payments, calendar and messaging; Fees: payments and messaging).
// A template says that in a `ServiceShape`, and gives its own settings check to `loadClientFolder`.
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { LANGUAGES } from "../language/languages.ts";
import type { Language } from "../language/languages.ts";
import { DEFAULT_PORT } from "./http.ts";

/**
 * One service a template calls, as runtime.json names it. Each base URL is a Guard instance in front of that service. `agentTokenFile`: a file holding the credential THIS
 * agent presents to that Guard (what Guard calls the agent's token; Guard removes it before it forwards). It is not a key to the service. Left out, no Authorization header
 * is sent. A relative path is measured from the client folder. The one more field some services need (the calendar's id, the WhatsApp number's id) sits beside them.
 */
export interface ServiceConfig { baseUrl: string; agentTokenFile?: string; [extra: string]: string | undefined }

/** Which services a template calls, and the one extra field each needs. */
export type ServiceShape = readonly { name: string; extra?: string }[];

export const BOOKINGS_SERVICES: ServiceShape = [{ name: "payments" }, { name: "calendar", extra: "calendarId" }, { name: "messaging", extra: "phoneNumberId" }];
export const FEES_SERVICES: ServiceShape = [{ name: "payments" }, { name: "messaging", extra: "phoneNumberId" }];

/** Where the live adapters should call: the services the template names, and how long to wait for any one of them. */
export type LiveServicesConfig = { [service: string]: ServiceConfig | number | undefined } & { timeoutMs?: number };

/**
 * Step 2 of the understanding: the small language model that reads a message the decision model was unsure of (the same fields as `ModelConfig` in
 * src/adapters/model-llm.ts). Left out: no language model. A key is never written in runtime.json. Either `baseUrl` is a Guard in front of the provider and
 * Guard holds the key (with `agentTokenFile` if Guard asks the agent for a credential), or `keyEnv` NAMES an environment variable (for example DEEPINFRA_API_KEY)
 * that holds the provider's key: it is read once at start, sent as a bearer token only to this one address, and never logged.
 */
export interface ParserConfig {
  wire: "openai" | "anthropic";
  baseUrl: string;
  model: string;
  timeoutMs?: number;
  /** A file holding the credential THIS agent presents to that Guard (as for services.*.agentTokenFile). Guard refuses a call with none. A relative path is measured from the client folder. */
  agentTokenFile?: string;
  /** Who the provider is, for the record and the price list ("deepinfra"). Default: the address's host. */
  provider?: string;
  /** The name of the environment variable that holds the provider's key. Left out: no key is sent from here. */
  keyEnv?: string;
}

/** Step 1: a System One decision model. Laya runs on the shop's own server (a local address, no key); Jev is hosted (an address, and a key in the named environment variable). */
export interface DecisionConfig {
  provider: "laya" | "jev" | "system-one";
  baseUrl: string;
  model: string;
  keyEnv?: string;
  /** How likely the chosen option must be; below it the message goes to step 2. Default 0.75. */
  threshold?: number;
  /** The languages this model is trusted with. Default ["hi", "en"]: Malayalam and Kannada go to step 2 until the eval says otherwise. */
  languages?: Language[];
  timeoutMs?: number;
}

/** The shop's monthly AI allowance for steps 1 and 2. Either one reached puts the shop in button mode until the month ends. */
export interface AllowanceConfig { messages?: number; costInr?: number }

/**
 * The monthly report to the owner on WhatsApp (report/monthly-job.ts). The block is what switches it on: without it nothing is made and nothing is sent, so a pathway that
 * learns to send it never starts messaging owners by itself. Both `preparedBy` and `pageBaseUrl` are needed, because the message names who set the agent up and gives the
 * address of the full page. Every path is measured from the client folder.
 */
export interface ReportConfig {
  /** Who set the agent up, as the owner should read it ("Divya, local partner"). Read again when it changes, like `ai`. */
  preparedBy: string;
  /** Whether this builder or partner has the Innovator badge (fleet's answer for the shop). Read again when it changes. Default false. */
  innovator?: boolean;
  /** Where the full page is served from: https, no trailing slash. The runtime writes each month's page into `pagesDir/<random name>/`; whatever serves that folder read-only, with no folder listing, is at this address. */
  pageBaseUrl: string;
  /** Default `<dataDir>/reports`. */
  pagesDir: string;
  /** What the numbers were counted from. Default: "stand-in" in fakes mode, "test-mode" in live mode (say "live" only when real money moves). */
  source?: "live" | "test-mode";
  /** The Ed25519 private key (PEM) that signs the report and its certificate. Left out, they are not signed and say so. */
  signingKeyFile?: string;
  /** A go-live certificate (go-live-certificate.json) for the report to read. Left out, the report says none was given. */
  goLiveFile?: string;
}

export interface RuntimeConfig {
  mode: "fakes" | "live";
  host: string;
  port: number;
  dataDir: string; // absolute
  tickSeconds: number;
  services?: LiveServicesConfig;
  parser?: ParserConfig;
  decision?: DecisionConfig;
  /** "buttons" turns every model step off for this shop (written by the bundle from fleet's heartbeat answer). Read again on every message, so it takes effect without a restart. Default "on". */
  ai?: "on" | "buttons";
  allowance?: AllowanceConfig;
  /** Minutes of button mode after a model step fails. Default 5. */
  pauseMinutes?: number;
  report?: ReportConfig;
}

export interface ClientFolder<Settings = unknown> {
  name: string;
  folder: string;
  settings: Settings;
  runtime: RuntimeConfig;
  lock: { pathway: string; version: string };
}

/** A problem with the client's folder or the way the runtime was started. The message is meant to be shown as it is. */
export class ClientError extends Error {}

/** A pathway's own version: the number in its package.json. `packageJson` is that file's address, from the pathway's own server/config.ts (`new URL("../package.json", import.meta.url)`). */
export function pathwayVersion(packageJson: URL): string {
  return (JSON.parse(readFileSync(packageJson, "utf8")) as { version: string }).version;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

function unknownKeys(obj: Obj, allowed: string[], where: string, errors: string[]): void {
  for (const key of Object.keys(obj)) if (!allowed.includes(key)) errors.push(`I don't know what "${key}" means in ${where}. Allowed: ${allowed.join(", ")}.`);
}

function readService(raw: unknown, name: string, extra: string | undefined, errors: string[]): Obj | undefined {
  if (!isObj(raw)) { errors.push(`In "services", add "${name}" with its "baseUrl"${extra ? ` and "${extra}"` : ""}.`); return undefined; }
  unknownKeys(raw, extra ? ["baseUrl", extra, "agentTokenFile"] : ["baseUrl", "agentTokenFile"], `services.${name}`, errors);
  if (raw.agentTokenFile !== undefined && !isText(raw.agentTokenFile)) errors.push(`services.${name}.agentTokenFile must be the path of a file that holds this agent's credential for that Guard.`);
  if (!isText(raw.baseUrl) || !/^https?:\/\/\S+$/.test(raw.baseUrl)) errors.push(`services.${name}.baseUrl must be the address of the Guard in front of ${name}, starting with http:// or https://.`);
  if (extra && !isText(raw[extra])) errors.push(`services.${name}.${extra} is missing.`);
  return raw;
}

const NO_KEY = "No key goes in runtime.json: the base URL is a Guard in front of the model provider, and Guard holds the key.";

/** `parser`: which model reads the messages. Every refusal is in plain words and none repeats what was written, in case it was a key. */
function readParser(raw: unknown, folder: string, errors: string[]): ParserConfig | undefined {
  if (!isObj(raw)) { errors.push('"parser" must be an object like {"wire": "openai", "baseUrl": "https://your-guard.example/model/v1", "model": "<the model\'s name>"}. Leave it out and the built-in rules read the messages.'); return undefined; }
  const before = errors.length;
  const keyLike = Object.keys(raw).filter((k) => /^(api[_-]?key|key|access[_-]?token|auth[_-]?token|token|client[_-]?secret|secret|password|passwd|authorization|bearer)$/iu.test(k)); // whole names: maxTokens is no key
  for (const k of keyLike) errors.push(`parser.${k} is not allowed. ${NO_KEY}`);
  unknownKeys(Object.fromEntries(Object.entries(raw).filter(([k]) => !keyLike.includes(k))), ["wire", "baseUrl", "model", "timeoutMs", "agentTokenFile", "provider", "keyEnv"], "parser", errors);
  if (raw.agentTokenFile !== undefined && !isText(raw.agentTokenFile)) errors.push("parser.agentTokenFile must be the path of a file that holds this agent's credential for the model's Guard.");
  if (raw.wire !== "openai" && raw.wire !== "anthropic") errors.push('parser.wire must be "openai" (OpenAI-compatible chat completions, which Gemini, Groq and Sarvam also speak) or "anthropic" (the Anthropic Messages API).');
  let url: URL | undefined;
  try { url = isText(raw.baseUrl) ? new URL(raw.baseUrl) : undefined; } catch { url = undefined; }
  if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) errors.push("parser.baseUrl must be the address of the Guard in front of the model provider, starting with http:// or https://.");
  else if (url.username || url.password) errors.push(`parser.baseUrl must not hold a user name or password. ${NO_KEY}`);
  else if (url.search || url.hash) errors.push(`parser.baseUrl must not carry a query or a #fragment, which is where a key hides. ${NO_KEY}`);
  if (!isText(raw.model)) errors.push("parser.model must be the name of the model to ask, as the provider calls it.");
  if (raw.timeoutMs !== undefined && (!Number.isInteger(raw.timeoutMs) || (raw.timeoutMs as number) < 1)) errors.push("parser.timeoutMs must be a whole number of milliseconds. Left out, it waits 8000 before the rules read the message.");
  if (raw.provider !== undefined && (!isText(raw.provider) || !/^[a-z][a-z0-9-]{0,39}$/u.test(raw.provider))) errors.push('parser.provider must be a short lowercase name for the provider, for example "deepinfra".');
  readKeyEnv(raw.keyEnv, "parser", url, errors);
  if (raw.keyEnv !== undefined && raw.agentTokenFile !== undefined) errors.push("parser.keyEnv and parser.agentTokenFile are two ways to authenticate: use keyEnv for a provider reached directly, agentTokenFile for a Guard in front of it, not both.");
  if (errors.length > before) return undefined;
  const agentTokenFile = isText(raw.agentTokenFile) ? (isAbsolute(raw.agentTokenFile) ? raw.agentTokenFile : resolve(folder, raw.agentTokenFile)) : undefined;
  return { wire: raw.wire as ParserConfig["wire"], baseUrl: raw.baseUrl as string, model: raw.model as string, ...(raw.timeoutMs !== undefined ? { timeoutMs: raw.timeoutMs as number } : {}), ...(agentTokenFile ? { agentTokenFile } : {}), ...(raw.provider !== undefined ? { provider: raw.provider as string } : {}), ...(raw.keyEnv !== undefined ? { keyEnv: raw.keyEnv as string } : {}) };
}

const LOOPBACK = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/u;

/** `keyEnv` is the NAME of an environment variable. A key that would travel over plain http to another machine is refused. */
function readKeyEnv(raw: unknown, where: string, url: URL | undefined, errors: string[]): void {
  if (raw === undefined) return;
  if (!isText(raw) || !/^[A-Z][A-Z0-9_]{0,63}$/u.test(raw)) { errors.push(`${where}.keyEnv must be the NAME of an environment variable, like DEEPINFRA_API_KEY. The key itself never goes in runtime.json.`); return; }
  if (url && url.protocol === "http:" && !LOOPBACK.test(url.hostname)) errors.push(`${where}.keyEnv names a key, and ${where}.baseUrl is plain http to another machine, which would send the key unencrypted. Use https, or leave keyEnv out.`);
}

const KEY_LIKE = /^(api[_-]?key|key|access[_-]?token|auth[_-]?token|token|client[_-]?secret|secret|password|passwd|authorization|bearer)$/iu;

/** `decision`: step 1, a System One decision model. */
function readDecision(raw: unknown, errors: string[]): DecisionConfig | undefined {
  if (!isObj(raw)) { errors.push('"decision" must be an object like {"provider": "laya", "baseUrl": "http://127.0.0.1:8080", "model": "laya"}. Leave it out and no decision model is asked.'); return undefined; }
  const before = errors.length;
  const keyLike = Object.keys(raw).filter((k) => KEY_LIKE.test(k));
  for (const k of keyLike) errors.push(`decision.${k} is not allowed. Name the environment variable that holds the key in decision.keyEnv; the key itself never goes in runtime.json.`);
  unknownKeys(Object.fromEntries(Object.entries(raw).filter(([k]) => !keyLike.includes(k))), ["provider", "baseUrl", "model", "keyEnv", "threshold", "languages", "timeoutMs"], "decision", errors);
  if (raw.provider !== "laya" && raw.provider !== "jev" && raw.provider !== "system-one") errors.push('decision.provider must be "laya" (on the shop\'s own server), "jev" (hosted) or "system-one" (any other server that speaks the same API).');
  let url: URL | undefined;
  try { url = isText(raw.baseUrl) ? new URL(raw.baseUrl) : undefined; } catch { url = undefined; }
  if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) errors.push("decision.baseUrl must be the address of the decision model, starting with http:// or https://.");
  else if (url.username || url.password || url.search || url.hash) errors.push("decision.baseUrl must not hold a user name, a password, a query or a #fragment, which is where a key hides. Use decision.keyEnv.");
  if (!isText(raw.model)) errors.push("decision.model must be the name the server serves the model under, for example laya.");
  if (raw.provider === "jev" && !isText(raw.keyEnv)) errors.push('decision.provider "jev" is hosted and needs decision.keyEnv: the name of the environment variable that holds the key. Without the key the step stays off.');
  readKeyEnv(raw.keyEnv, "decision", url, errors);
  if (raw.threshold !== undefined && (typeof raw.threshold !== "number" || !(raw.threshold > 0.5 && raw.threshold <= 1))) errors.push("decision.threshold must be a number above 0.5 and up to 1: how likely the chosen option must be. Default 0.75.");
  if (raw.languages !== undefined && (!Array.isArray(raw.languages) || raw.languages.length === 0 || !raw.languages.every((l) => LANGUAGES.includes(l as Language)))) errors.push(`decision.languages must list languages from ${LANGUAGES.join(", ")}. Default ["hi", "en"].`);
  if (raw.timeoutMs !== undefined && (!Number.isInteger(raw.timeoutMs) || (raw.timeoutMs as number) < 1)) errors.push("decision.timeoutMs must be a whole number of milliseconds. Default 3000.");
  if (errors.length > before) return undefined;
  return {
    provider: raw.provider as DecisionConfig["provider"], baseUrl: raw.baseUrl as string, model: raw.model as string,
    ...(raw.keyEnv !== undefined ? { keyEnv: raw.keyEnv as string } : {}), ...(raw.threshold !== undefined ? { threshold: raw.threshold as number } : {}),
    ...(raw.languages !== undefined ? { languages: raw.languages as Language[] } : {}), ...(raw.timeoutMs !== undefined ? { timeoutMs: raw.timeoutMs as number } : {}),
  };
}

function readAllowance(raw: unknown, errors: string[]): AllowanceConfig | undefined {
  if (!isObj(raw)) { errors.push('"allowance" must be an object like {"messages": 3000, "costInr": 30}: this month\'s most messages the decision and language models may read, and their most estimated cost in rupees.'); return undefined; }
  const before = errors.length;
  unknownKeys(raw, ["messages", "costInr"], "allowance", errors);
  if (raw.messages !== undefined && (!Number.isInteger(raw.messages) || (raw.messages as number) < 0)) errors.push("allowance.messages must be a whole number of messages, 0 or more.");
  if (raw.costInr !== undefined && (typeof raw.costInr !== "number" || !(raw.costInr >= 0) || !Number.isFinite(raw.costInr))) errors.push("allowance.costInr must be a number of rupees, 0 or more.");
  if (raw.messages === undefined && raw.costInr === undefined) errors.push('"allowance" needs "messages", "costInr" or both.');
  if (errors.length > before) return undefined;
  return { ...(raw.messages !== undefined ? { messages: raw.messages as number } : {}), ...(raw.costInr !== undefined ? { costInr: raw.costInr as number } : {}) };
}

const REPORT_KEYS = ["preparedBy", "innovator", "pageBaseUrl", "pagesDir", "source", "signingKeyFile", "goLiveFile"];
const NAME_LIMIT = 120;

/** What the owner is shown as the name of who set the agent up: some text, one line, not very long. */
export const validName = (v: unknown): v is string => isText(v) && v.length <= NAME_LIMIT && !/[\n\r\t]/u.test(v);

/** `report`: the monthly report to the owner. */
function readReport(raw: unknown, folder: string, dataDir: string, errors: string[]): ReportConfig | undefined {
  if (!isObj(raw)) { errors.push('"report" must be an object like {"preparedBy": "Divya, local partner", "pageBaseUrl": "https://reports.example.com/r"}. Leave it out and no monthly report is sent to the owner.'); return undefined; }
  const before = errors.length;
  unknownKeys(raw, REPORT_KEYS, "report", errors);
  if (!validName(raw.preparedBy)) errors.push(`report.preparedBy must be the name the owner should read for who set the agent up, on one line, up to ${NAME_LIMIT} characters. The monthly message says it.`);
  if (raw.innovator !== undefined && typeof raw.innovator !== "boolean") errors.push("report.innovator must be true or false.");
  let url: URL | undefined;
  try { url = isText(raw.pageBaseUrl) ? new URL(raw.pageBaseUrl) : undefined; } catch { url = undefined; }
  if (!url || url.protocol !== "https:") errors.push("report.pageBaseUrl must be the https address the report pages are served from, like https://reports.example.com/r. WhatsApp fetches and shows a link only if it is https.");
  else if (url.username || url.password || url.search || url.hash) errors.push("report.pageBaseUrl must not hold a user name, a password, a query or a #fragment.");
  else if ((raw.pageBaseUrl as string).endsWith("/")) errors.push("report.pageBaseUrl must not end with a slash.");
  if (raw.source !== undefined && raw.source !== "live" && raw.source !== "test-mode") errors.push('report.source must be "live" or "test-mode". Left out, it is test-mode (a report that says test money when it was real is a smaller mistake than the other way round).');
  for (const key of ["pagesDir", "signingKeyFile", "goLiveFile"]) if (raw[key] !== undefined && !isText(raw[key])) errors.push(`report.${key} must be a path.`);
  if (errors.length > before) return undefined;
  const at = (p: string) => (isAbsolute(p) ? p : resolve(folder, p));
  return {
    preparedBy: (raw.preparedBy as string).trim(), pageBaseUrl: raw.pageBaseUrl as string, pagesDir: raw.pagesDir !== undefined ? at(raw.pagesDir as string) : join(dataDir, "reports"),
    ...(raw.innovator !== undefined ? { innovator: raw.innovator as boolean } : {}), ...(raw.source !== undefined ? { source: raw.source as "live" | "test-mode" } : {}),
    ...(raw.signingKeyFile !== undefined ? { signingKeyFile: at(raw.signingKeyFile as string) } : {}), ...(raw.goLiveFile !== undefined ? { goLiveFile: at(raw.goLiveFile as string) } : {}),
  };
}

/** Check runtime.json's contents for a template that calls the services in `shape`. `folder` is what a relative dataDir is measured from. */
export function readRuntimeConfig(input: unknown, folder: string, shape: ServiceShape): { ok: true; config: RuntimeConfig } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isObj(input)) return { ok: false, errors: ['runtime.json must be an object like {"mode": "fakes"}.'] };
  unknownKeys(input, ["mode", "host", "port", "dataDir", "tickSeconds", "services", "parser", "decision", "ai", "allowance", "pauseMinutes", "report"], "runtime.json", errors);

  if (input.mode !== "fakes" && input.mode !== "live") errors.push('Set "mode" to "fakes" (stand-in services, for a local run) or "live" (real services through Guard).');
  const host = input.host ?? "127.0.0.1";
  if (!isText(host)) errors.push('"host" must be an address like "127.0.0.1".');
  const port = input.port ?? DEFAULT_PORT;
  if (!Number.isInteger(port) || (port as number) < 0 || (port as number) > 65535) errors.push('"port" must be a whole number from 0 to 65535 (0 picks a free one).');
  const dataDir = input.dataDir ?? "data";
  if (!isText(dataDir)) errors.push('"dataDir" must be a folder name. A relative one is measured from the client folder.');
  const tickSeconds = input.tickSeconds ?? 30;
  if (typeof tickSeconds !== "number" || !(tickSeconds >= 1) || !Number.isFinite(tickSeconds)) errors.push('"tickSeconds" must be a number of seconds, 1 or more. Holds expire and reminders go out on this beat.');

  let services: LiveServicesConfig | undefined;
  if (input.services !== undefined || input.mode === "live") {
    const s = isObj(input.services) ? input.services : undefined;
    const names = shape.map((x) => x.name);
    const wanted = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
    if (!s) errors.push(`Live mode needs "services": where Guard stands in front of ${wanted.replace("calendar", "the calendar")}.`);
    else {
      unknownKeys(s, [...names, "timeoutMs"], "services", errors);
      const read = shape.map((x) => readService(s[x.name], x.name, x.extra, errors));
      if (s.timeoutMs !== undefined && (!Number.isInteger(s.timeoutMs) || (s.timeoutMs as number) < 1)) errors.push("services.timeoutMs must be a whole number of milliseconds.");
      const where = (o: Obj | undefined) => (o && isText(o.agentTokenFile) ? { ...o, agentTokenFile: isAbsolute(o.agentTokenFile) ? o.agentTokenFile : resolve(folder, o.agentTokenFile) } : o);
      if (read.every((x) => x !== undefined)) services = { ...Object.fromEntries(shape.map((x, i) => [x.name, where(read[i])])), ...(s.timeoutMs !== undefined ? { timeoutMs: s.timeoutMs as number } : {}) } as unknown as LiveServicesConfig;
    }
  }

  const parser = input.parser !== undefined ? readParser(input.parser, folder, errors) : undefined;
  const decision = input.decision !== undefined ? readDecision(input.decision, errors) : undefined;
  if (input.ai !== undefined && input.ai !== "on" && input.ai !== "buttons") errors.push('"ai" must be "on" (the default) or "buttons" (no AI: the agent reads with the rules and answers with buttons and lists).');
  const allowance = input.allowance !== undefined ? readAllowance(input.allowance, errors) : undefined;
  if (input.pauseMinutes !== undefined && (!Number.isInteger(input.pauseMinutes) || (input.pauseMinutes as number) < 1 || (input.pauseMinutes as number) > 1440)) errors.push('"pauseMinutes" must be a whole number of minutes from 1 to 1440: how long the agent uses buttons after a model step fails. Default 5.');

  const report = input.report !== undefined && isText(dataDir) ? readReport(input.report, folder, isAbsolute(dataDir) ? dataDir : resolve(folder, dataDir), errors) : undefined;

  if (errors.length > 0) return { ok: false, errors };
  const dir = dataDir as string;
  return { ok: true, config: { mode: input.mode as "fakes" | "live", host: host as string, port: port as number, dataDir: isAbsolute(dir) ? dir : resolve(folder, dir), tickSeconds: tickSeconds as number, ...(services ? { services } : {}), ...(parser ? { parser } : {}), ...(decision ? { decision } : {}), ...(input.ai !== undefined ? { ai: input.ai as "on" | "buttons" } : {}), ...(allowance ? { allowance } : {}), ...(input.pauseMinutes !== undefined ? { pauseMinutes: input.pauseMinutes as number } : {}), ...(report ? { report } : {}) } };
}

/** pathway.lock holds one line, `bookings@0.1.0` (blank lines and # comments are allowed). */
export function parseLock(text: string): { pathway: string; version: string } {
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l !== "" && !l.startsWith("#"));
  const m = /^([a-z][a-z0-9-]*)@(\d+\.\d+\.\d+(?:[-+][\w.]+)?)$/.exec(lines[0] ?? "");
  if (!m) throw new ClientError('pathway.lock must say which pathway version this client is pinned to, on one line, like "bookings@0.1.0".');
  if (lines.length > 1) throw new ClientError("pathway.lock lists more than one line. This runtime cannot load modules yet, so it will not start with a lock that asks for them.");
  return { pathway: m[1], version: m[2] };
}

/**
 * Read and check a whole client folder, and refuse if it is pinned to another version of the pathway than `running`. The template gives its own check of settings.json
 * and its own shape of services.
 */
export function loadClientFolder<Settings>(folder: string, running: { pathway: string; version: string }, template: { validateSettings: (input: unknown) => { ok: true; settings: Settings } | { ok: false; errors: string[] }; services: ServiceShape }): ClientFolder<Settings> {
  const dir = resolve(folder);
  const file = (name: string) => {
    const path = join(dir, name);
    if (!existsSync(path)) throw new ClientError(`I could not find ${name} in ${dir}. A client folder needs settings.json, runtime.json and pathway.lock.`);
    return readFileSync(path, "utf8");
  };
  const json = (name: string): unknown => {
    try { return JSON.parse(file(name)); } catch (e) { if (e instanceof ClientError) throw e; throw new ClientError(`${name} in ${dir} is not valid JSON: ${(e as Error).message}`); }
  };

  const lock = parseLock(file("pathway.lock"));
  if (lock.pathway !== running.pathway || lock.version !== running.version) {
    throw new ClientError(`This client is pinned to ${lock.pathway}@${lock.version} (pathway.lock), but this runtime is ${running.pathway}@${running.version}. It will not start on a different version. Run the version it is pinned to, or change the pin once that version has passed the crash test with this client's settings.`);
  }
  const settings = template.validateSettings(json("settings.json"));
  if (!settings.ok) throw new ClientError(`These settings need fixing (settings.json):\n- ${settings.errors.join("\n- ")}`);
  const runtime = readRuntimeConfig(json("runtime.json"), dir, template.services);
  if (!runtime.ok) throw new ClientError(`runtime.json needs fixing:\n- ${runtime.errors.join("\n- ")}`);
  return { name: basename(dir), folder: dir, settings: settings.settings, runtime: runtime.config, lock };
}

/**
 * The outside switch: does this client's runtime.json say `"ai": "buttons"` right now? The file is looked at again whenever it has changed (by its modified time), so the bundle
 * can write the answer from fleet's heartbeat while the agent runs and the next message obeys it. A file that cannot be read or is not valid JSON for a moment (a write in the
 * middle) leaves the last answer standing; it never turns the switch off by accident.
 */
export function aiOverrideReader(folder: string, initial: "auto" | "buttons" = "auto"): () => "auto" | "buttons" {
  const file = join(resolve(folder), "runtime.json");
  let last = initial;
  let seen = -1;
  return () => {
    try {
      const modified = statSync(file).mtimeMs;
      if (modified !== seen) {
        const ai = (JSON.parse(readFileSync(file, "utf8")) as Obj).ai;
        last = ai === "buttons" ? "buttons" : "auto";
        seen = modified;
      }
    } catch { /* keep the last answer */ }
    return last;
  };
}

/**
 * The report's two live settings, `preparedBy` and `innovator`: read again whenever runtime.json has changed (by its modified time), like the outside switch, so the bundle can
 * write fleet's answer for the shop while the agent runs and the next report obeys it. A file that cannot be read for a moment, or that holds something unusable, leaves the
 * last answer standing; a badge is never granted or taken away by a half-written file.
 */
export function reportOptionsReader(folder: string, initial: { preparedBy: string; innovator?: boolean }): () => { preparedBy: string; innovator: boolean } {
  const file = join(resolve(folder), "runtime.json");
  let last = { preparedBy: initial.preparedBy, innovator: initial.innovator === true };
  let seen = -1;
  return () => {
    try {
      const modified = statSync(file).mtimeMs;
      if (modified !== seen) {
        const report = (JSON.parse(readFileSync(file, "utf8")) as Obj).report;
        if (isObj(report)) last = { preparedBy: validName(report.preparedBy) ? report.preparedBy.trim() : last.preparedBy, innovator: typeof report.innovator === "boolean" ? report.innovator : last.innovator };
        seen = modified;
      }
    } catch { /* keep the last answer */ }
    return last;
  };
}
