// A client's folder, read and checked: clients/<name>/settings.json (the business), runtime.json (how this agent runs) and
// pathway.lock (which pathway version it is pinned to). Every problem is said in plain words, all at once, so a builder can
// fix the folder without a manual. Nothing secret lives here: the internal token is a file named in the environment, and the
// service keys are never in the runtime at all (Guard holds them).
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { validateSettings } from "../src/settings.ts";
import { LANGUAGES } from "../../../modules/language/languages.ts";
import type { Settings } from "../src/settings.ts";
import type { Language } from "../../../modules/language/languages.ts";
import { DEFAULT_PORT } from "./server.ts";
import { PATHWAY } from "./runtime.ts";

/** Where the live adapters should call. Each base URL is a Guard instance in front of that service. */
export interface LiveServicesConfig {
  // `agentTokenFile`: a file holding the credential THIS agent presents to that Guard (what Guard calls the agent's token; Guard removes it before it
  // forwards). It is not a key to the service. Left out, no Authorization header is sent. A relative path is measured from the client folder.
  payments: { baseUrl: string; agentTokenFile?: string };
  calendar: { baseUrl: string; calendarId: string; agentTokenFile?: string };
  messaging: { baseUrl: string; phoneNumberId: string; agentTokenFile?: string };
  timeoutMs?: number;
}

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
}

export interface ClientFolder {
  name: string;
  folder: string;
  settings: Settings;
  runtime: RuntimeConfig;
  lock: { pathway: string; version: string };
}

/** A problem with the client's folder or the way the runtime was started. The message is meant to be shown as it is. */
export class ClientError extends Error {}

export function pathwayVersion(): string {
  return (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;
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

/** Check runtime.json's contents. `folder` is what a relative dataDir is measured from. */
export function validateRuntimeConfig(input: unknown, folder: string): { ok: true; config: RuntimeConfig } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isObj(input)) return { ok: false, errors: ['runtime.json must be an object like {"mode": "fakes"}.'] };
  unknownKeys(input, ["mode", "host", "port", "dataDir", "tickSeconds", "services", "parser", "decision", "ai", "allowance", "pauseMinutes"], "runtime.json", errors);

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
    if (!s) errors.push('Live mode needs "services": where Guard stands in front of payments, the calendar and messaging.');
    else {
      unknownKeys(s, ["payments", "calendar", "messaging", "timeoutMs"], "services", errors);
      const payments = readService(s.payments, "payments", undefined, errors);
      const calendar = readService(s.calendar, "calendar", "calendarId", errors);
      const messaging = readService(s.messaging, "messaging", "phoneNumberId", errors);
      if (s.timeoutMs !== undefined && (!Number.isInteger(s.timeoutMs) || (s.timeoutMs as number) < 1)) errors.push("services.timeoutMs must be a whole number of milliseconds.");
      const where = (o: Obj | undefined) => (o && isText(o.agentTokenFile) ? { ...o, agentTokenFile: isAbsolute(o.agentTokenFile) ? o.agentTokenFile : resolve(folder, o.agentTokenFile) } : o);
      if (payments && calendar && messaging) services = { payments: where(payments), calendar: where(calendar), messaging: where(messaging), ...(s.timeoutMs !== undefined ? { timeoutMs: s.timeoutMs as number } : {}) } as unknown as LiveServicesConfig;
    }
  }

  const parser = input.parser !== undefined ? readParser(input.parser, folder, errors) : undefined;
  const decision = input.decision !== undefined ? readDecision(input.decision, errors) : undefined;
  if (input.ai !== undefined && input.ai !== "on" && input.ai !== "buttons") errors.push('"ai" must be "on" (the default) or "buttons" (no AI: the agent reads with the rules and answers with buttons and lists).');
  const allowance = input.allowance !== undefined ? readAllowance(input.allowance, errors) : undefined;
  if (input.pauseMinutes !== undefined && (!Number.isInteger(input.pauseMinutes) || (input.pauseMinutes as number) < 1 || (input.pauseMinutes as number) > 1440)) errors.push('"pauseMinutes" must be a whole number of minutes from 1 to 1440: how long the agent uses buttons after a model step fails. Default 5.');

  if (errors.length > 0) return { ok: false, errors };
  const dir = dataDir as string;
  return { ok: true, config: { mode: input.mode as "fakes" | "live", host: host as string, port: port as number, dataDir: isAbsolute(dir) ? dir : resolve(folder, dir), tickSeconds: tickSeconds as number, ...(services ? { services } : {}), ...(parser ? { parser } : {}), ...(decision ? { decision } : {}), ...(input.ai !== undefined ? { ai: input.ai as "on" | "buttons" } : {}), ...(allowance ? { allowance } : {}), ...(input.pauseMinutes !== undefined ? { pauseMinutes: input.pauseMinutes as number } : {}) } };
}

/** pathway.lock holds one line, `bookings@0.1.0` (blank lines and # comments are allowed). */
export function parseLock(text: string): { pathway: string; version: string } {
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l !== "" && !l.startsWith("#"));
  const m = /^([a-z][a-z0-9-]*)@(\d+\.\d+\.\d+(?:[-+][\w.]+)?)$/.exec(lines[0] ?? "");
  if (!m) throw new ClientError('pathway.lock must say which pathway version this client is pinned to, on one line, like "bookings@0.1.0".');
  if (lines.length > 1) throw new ClientError("pathway.lock lists more than one line. This runtime cannot load modules yet, so it will not start with a lock that asks for them.");
  return { pathway: m[1], version: m[2] };
}

/** Read and check a whole client folder, and refuse if it is pinned to another version of the pathway than this one. */
export function loadClient(folder: string, running: { pathway: string; version: string } = { pathway: PATHWAY, version: pathwayVersion() }): ClientFolder {
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
  const settings = validateSettings(json("settings.json"));
  if (!settings.ok) throw new ClientError(`These settings need fixing (settings.json):\n- ${settings.errors.join("\n- ")}`);
  const runtime = validateRuntimeConfig(json("runtime.json"), dir);
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
