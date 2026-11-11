// An agent someone else wrote ("bring your own agent"): its folder on the server, and how `geometer agent add` makes one from flags or a settings file.
//
//   agents/<name>/agent.json      the services the agent calls (one payment module from modules/payments/providers, UPI by default; WhatsApp; Calendar), the shop's own WhatsApp
//                                 number id and calendar id, and the caps that settings do not carry
//   agents/<name>/settings.json   the SAME settings file the templates use (templates/commerce/bookings/src/settings.ts), checked by the same validator. Guard's limits come from it exactly as
//                                 they do for a template: the deposit, the refund limit. Guard has no rule for prices or opening hours, so those two are kept in the file (the report's
//                                 policy digest covers them) but nothing in Guard checks them for an agent we did not write.
//   agents/<name>/gateway-draft.json, gateway-accept.json
//                                 only for an agent that takes money through its own gateway's API (B71 step 6, "own-api"): the companies kit's draft of that API and the file in
//                                 which the builder kept the rules (companies/openapi-to-spec.ts). The Guard's spec is built from the two on every plan, so an edited draft is refused.
//
// No code here runs the agent. Geometer never rebuilds or hosts it (plan decision 5): the folder only says what to put in front of the services it calls.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { rupeesToPaise } from "../../modules/payments/guard-limits.ts";
import { DEFAULT_PROVIDER, OWN_API, PAYMENT_MODULES, providerById } from "../../modules/payments/providers/index.ts";
import { validateSettings } from "../../templates/commerce/bookings/src/settings.ts";
import { LANGUAGES } from "../../modules/language/languages.ts";
import type { Settings } from "../../templates/commerce/bookings/src/settings.ts";
import type { Language } from "../../modules/language/languages.ts";
import { serverPaths } from "../lib/server.ts";
import { stableJson, writeAtomic } from "../lib/util.ts";

/**
 * The services an agent can call (B71): any payment module in modules/payments/providers (a gateway gets a Guard in front of its API; an owner-marked one, UPI, is the
 * desk, modules/payments/owner-marked/desk.ts), the agent's own gateway API with no module ("own-api", a Guard with the spec its builder reviewed), WhatsApp and
 * Calendar. Exactly one way to take money; UPI when --upstreams is left out.
 */
export const AGENT_UPSTREAMS: readonly string[] = [...PAYMENT_MODULES, OWN_API, "whatsapp", "calendar"];
export type AgentUpstream = string;
/** What `agent add` uses when --upstreams is left out: the default payment module (UPI: no gateway account), WhatsApp and Calendar. */
export const DEFAULT_UPSTREAMS: readonly string[] = [DEFAULT_PROVIDER.id, "whatsapp", "calendar"];

/** How an agent takes money, as everything about agents asks it: a Guard in front of an API (a gateway module, or its own API), or the owner marks it (the desk). */
export interface AgentPayment { id: string; displayName: string; guarded: boolean; ownerMarked: boolean }
const OWN_API_PAYMENT: AgentPayment = { id: OWN_API, displayName: "your own gateway's API", guarded: true, ownerMarked: false };
const paymentOf = (u: string): AgentPayment | undefined => {
  if (u === OWN_API) return OWN_API_PAYMENT;
  const p = providerById(u);
  return p ? { id: p.id, displayName: p.displayName, guarded: p.gateway !== undefined, ownerMarked: p.ownerMarked !== undefined } : undefined;
};
/** The upstreams that take money (one, in a good agent.json). */
const paymentUpstreamsIn = (upstreams: readonly string[]): AgentPayment[] => upstreams.map(paymentOf).filter((p) => p !== undefined);
/** The agent's one way to take money; the one question every agent reader asks, so none of them compares a provider's name. */
export const paymentUpstreamOf = (upstreams: readonly string[]): AgentPayment | undefined => paymentUpstreamsIn(upstreams)[0];
/** An own-API agent's host:port. A name or an address with its port; the scheme is always https (a test server's stand-in is the server's `upstreams` setting). */
const HOST_PORT = /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?:\d{1,5}$/u;

/** Caps that settings do not carry. Left out, the template's defaults (and the server's, for the three counts) are used. */
export interface AgentCaps {
  refundInrPerDay?: number;
  refundsPerDay?: number;
  linksPerHour?: number;
  messagesPerHour?: number;
  eventsCreatedPerHour?: number;
  eventsDeletedPerDay?: number;
}
const CAP_KEYS: (keyof AgentCaps)[] = ["refundInrPerDay", "refundsPerDay", "linksPerHour", "messagesPerHour", "eventsCreatedPerHour", "eventsDeletedPerDay"];

/**
 * How the crash test drives the agent (README, "A crash test for your agent"). All of it is optional: the defaults suit an agent that takes the webhooks of WhatsApp and Razorpay at
 * the paths below and understands the English lines below. None of it reaches a Guard.
 */
export interface AgentDriver {
  /** Where the run command starts: an absolute folder, or one relative to agents/<name>/. Default: agents/<name>/. */
  cwd?: string;
  /** Where the agent takes the WhatsApp webhooks (Meta's format, signed with the app secret). Default /webhooks/whatsapp. */
  whatsappPath?: string;
  /** Where the agent takes Razorpay's webhooks (signed with the webhook secret). Default /webhooks/razorpay. */
  razorpayPath?: string;
  /** What the scripted customer writes. A list is sent one message after the other. `{offer}` and `{claim}` are filled in with amounts that are on no price list. */
  says?: { book?: string | string[]; cancel?: string; haggle?: string; refundMore?: string };
  /** A regular expression (case-insensitive) for the words your agent uses to say a booking is made. Default \b(booked|confirmed)\b. */
  bookedWords?: string;
  /**
   * The same for saying a refund was made (crash-test/driver.ts DEFAULT_REFUNDED_WORDS: "is refunded", "has been refunded", "refund is done", ...). The situations where the
   * owner says no, or never answers, check that no message to the customer says it.
   */
  refundedWords?: string;
  /** How long the agent has to start answering (default 20 seconds) and how long one situation may take (default 40). */
  startSeconds?: number;
  situationSeconds?: number;
}

export interface AgentFile {
  schema: 1;
  name: string;
  upstreams: AgentUpstream[];
  /** The command that starts the agent for the crash test (`sh -c`). `{version}` is replaced by `version`, which is also in the environment as GEOMETER_AGENT_VERSION. */
  run?: string;
  /** Whatever the builder calls this version of the agent: a git commit, an image tag. Geometer does not look inside it. */
  version?: string;
  driver?: AgentDriver;
  whatsapp?: {
    phoneNumberId: string;
    /** Where the shop's own agent takes its WhatsApp webhooks. Geometer's inbox checks each one, keeps the owner's replies to approval requests, and passes the rest on untouched. */
    forwardTo?: string;
  };
  calendar?: { calendarId: string };
  /** Only for an agent whose upstreams name own-api: where its own gateway's API is (host:port, https). Its rules are the reviewed spec beside agent.json. */
  ownApi?: { upstream: string };
  caps?: AgentCaps;
  createdAt: string;
}

export interface AgentFolder {
  name: string;
  agentText: string;
  agent: AgentFile | undefined;
  settingsText: string;
  settings: Settings | undefined;
  /** An own-API agent's reviewed spec, as the two files the companies kit works from: the draft (its bytes are what the accept file names) and the accept file. */
  ownApi?: { draftText: string; acceptText: string };
  /** Plain-words problems reading the folder (missing file, bad JSON, bad settings). */
  problems: string[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** A version is one word: it goes into the run command and into file names, so nothing a shell would read as more than a word. */
export const AGENT_VERSION = /^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,63}$/u;
const PATH_START = /^\/[A-Za-z0-9._~\/%-]*$/u;

/** agent.json's `driver`, checked. Every problem is said in plain words. */
function parseDriver(raw: unknown, errors: string[]): AgentDriver | undefined {
  if (!isObj(raw)) { errors.push('agent.json: "driver" must be an object.'); return undefined; }
  const driver: AgentDriver = {};
  const known = ["cwd", "whatsappPath", "razorpayPath", "says", "bookedWords", "refundedWords", "startSeconds", "situationSeconds"];
  for (const k of Object.keys(raw)) if (!known.includes(k)) errors.push(`agent.json: I don't know what driver.${k} means. Allowed: ${known.join(", ")}.`);
  if (raw.cwd !== undefined) { if (typeof raw.cwd === "string" && raw.cwd.trim() !== "") driver.cwd = raw.cwd; else errors.push('agent.json: "driver.cwd" must be a folder.'); }
  for (const k of ["whatsappPath", "razorpayPath"] as const) {
    if (raw[k] === undefined) continue;
    if (typeof raw[k] === "string" && PATH_START.test(raw[k] as string)) driver[k] = raw[k] as string;
    else errors.push(`agent.json: "driver.${k}" must be a path on your agent that starts with /.`);
  }
  if (raw.bookedWords !== undefined) {
    try { if (typeof raw.bookedWords !== "string" || raw.bookedWords === "") throw new Error("not text"); new RegExp(raw.bookedWords, "iu"); driver.bookedWords = raw.bookedWords; } catch { errors.push('agent.json: "driver.bookedWords" must be a regular expression, for example "\\b(booked|confirmed)\\b".'); }
  }
  if (raw.refundedWords !== undefined) {
    try { if (typeof raw.refundedWords !== "string" || raw.refundedWords === "") throw new Error("not text"); new RegExp(raw.refundedWords, "iu"); driver.refundedWords = raw.refundedWords; } catch { errors.push('agent.json: "driver.refundedWords" must be a regular expression, for example "\\b(is|has been) refunded\\b".'); }
  }
  for (const k of ["startSeconds", "situationSeconds"] as const) {
    if (raw[k] === undefined) continue;
    if (typeof raw[k] === "number" && Number.isInteger(raw[k]) && (raw[k] as number) >= 1 && (raw[k] as number) <= 600) driver[k] = raw[k] as number;
    else errors.push(`agent.json: "driver.${k}" must be a whole number of seconds from 1 to 600.`);
  }
  if (raw.says !== undefined) {
    if (!isObj(raw.says)) errors.push('agent.json: "driver.says" must be an object.');
    else {
      const says: NonNullable<AgentDriver["says"]> = {};
      const line = (v: unknown) => typeof v === "string" && v.trim() !== "" && v.length <= 500;
      for (const [k, v] of Object.entries(raw.says)) {
        if (k === "book" && (line(v) || (Array.isArray(v) && v.length >= 1 && v.length <= 5 && v.every(line)))) says.book = v as string | string[];
        else if ((k === "cancel" || k === "haggle" || k === "refundMore") && line(v)) says[k] = v as string;
        else errors.push(`agent.json: driver.says.${k} must be one line of what the customer writes (book may be a list of up to 5); the names are book, cancel, haggle, refundMore.`);
      }
      driver.says = says;
    }
  }
  return driver;
}

/** Check agent.json. Every problem is said in plain words, all at once. */
export function parseAgentFile(raw: unknown, name: string): { agent?: AgentFile; errors: string[] } {
  const errors: string[] = [];
  if (!isObj(raw)) return { errors: ["agent.json must be an object."] };
  if (raw.schema !== 1) errors.push("agent.json: \"schema\" must be 1.");
  if (raw.name !== name) errors.push(`agent.json names the agent ${JSON.stringify(raw.name)}, but its folder is ${name}.`);
  const upstreams = Array.isArray(raw.upstreams) ? raw.upstreams : [];
  if (upstreams.length === 0 || !upstreams.every((u) => (AGENT_UPSTREAMS as readonly unknown[]).includes(u)) || new Set(upstreams).size !== upstreams.length) errors.push(`agent.json: "upstreams" must list some of ${AGENT_UPSTREAMS.join(", ")}, each once.`);
  const list = upstreams as AgentUpstream[];
  if (paymentUpstreamsIn(list).length > 1) errors.push(`agent.json: "upstreams" names more than one payment module (${paymentUpstreamsIn(list).map((p) => p.id).join(", ")}): a shop takes money one way.`);
  const ownApi = isObj(raw.ownApi) ? raw.ownApi : undefined;
  if (list.includes(OWN_API) && !(ownApi && typeof ownApi.upstream === "string" && HOST_PORT.test(ownApi.upstream))) errors.push(`agent.json: "ownApi.upstream" must be where your own gateway's API is, as host:port (for example api.example.com:443). Its Guard calls it over https.`);
  if (!list.includes(OWN_API) && raw.ownApi !== undefined) errors.push(`agent.json: "ownApi" is only for an agent whose upstreams name ${OWN_API}.`);
  const whatsapp = isObj(raw.whatsapp) ? raw.whatsapp : undefined;
  const calendar = isObj(raw.calendar) ? raw.calendar : undefined;
  if (list.includes("whatsapp") && !(whatsapp && typeof whatsapp.phoneNumberId === "string" && /^\d{6,20}$/u.test(whatsapp.phoneNumberId))) errors.push('agent.json: "whatsapp.phoneNumberId" must be the shop\'s own WhatsApp phone number id (digits only). The WhatsApp Guard allows exactly that one and refuses every other.');
  if (list.includes("calendar") && !(calendar && typeof calendar.calendarId === "string" && calendar.calendarId.trim() !== "")) errors.push('agent.json: "calendar.calendarId" must be the shop\'s own Google calendar. The calendar Guard allows exactly that one and refuses every other.');
  if (whatsapp?.forwardTo !== undefined && !(typeof whatsapp.forwardTo === "string" && /^https:\/\//u.test(whatsapp.forwardTo))) errors.push('agent.json: "whatsapp.forwardTo" must be an https:// address (the agent\'s own WhatsApp webhook).');
  const caps: AgentCaps = {};
  if (raw.caps !== undefined) {
    if (!isObj(raw.caps)) errors.push('agent.json: "caps" must be an object.');
    else for (const [k, v] of Object.entries(raw.caps)) {
      if (!CAP_KEYS.includes(k as keyof AgentCaps)) errors.push(`agent.json: I don't know what the cap "${k}" means. Allowed: ${CAP_KEYS.join(", ")}.`);
      else if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 1) errors.push(`agent.json: the cap "${k}" must be a whole number above zero.`);
      else caps[k as keyof AgentCaps] = v;
    }
  }
  if (raw.run !== undefined && !(typeof raw.run === "string" && raw.run.trim() !== "" && raw.run.length <= 1000 && !/[\n\r]/u.test(raw.run))) errors.push('agent.json: "run" must be the one-line command that starts your agent for the crash test.');
  if (raw.version !== undefined && !(typeof raw.version === "string" && AGENT_VERSION.test(raw.version))) errors.push('agent.json: "version" must be one word, such as a git commit (abc1234) or an image tag (v2): up to 64 letters, digits and . _ : @ + -.');
  const driver = raw.driver === undefined ? undefined : parseDriver(raw.driver, errors);
  if (typeof raw.createdAt !== "string" || Number.isNaN(Date.parse(raw.createdAt))) errors.push('agent.json: "createdAt" must be a time.');
  if (errors.length > 0) return { errors };
  return { errors, agent: { schema: 1, name, upstreams: list, ...(typeof raw.run === "string" ? { run: raw.run } : {}), ...(typeof raw.version === "string" ? { version: raw.version } : {}), ...(driver ? { driver } : {}),...(list.includes("whatsapp") ? { whatsapp: { phoneNumberId: whatsapp!.phoneNumberId as string, ...(typeof whatsapp!.forwardTo === "string" ? { forwardTo: whatsapp!.forwardTo } : {}) } } : {}), ...(list.includes("calendar") ? { calendar: { calendarId: calendar!.calendarId as string } } : {}), ...(list.includes(OWN_API) ? { ownApi: { upstream: ownApi!.upstream as string } } : {}), ...(Object.keys(caps).length > 0 ? { caps } : {}), createdAt: raw.createdAt as string } };
}

/** Read one agent's folder. Never throws: what is wrong comes back as `problems`. */
export function readAgent(dir: string, name: string): AgentFolder {
  const folder = serverPaths(dir).agent(name);
  const problems: string[] = [];
  const read = (file: string): string => {
    const path = join(folder, file);
    if (!existsSync(path)) { problems.push(`${file} is missing in ${folder}.`); return ""; }
    return readFileSync(path, "utf8");
  };
  const agentText = read("agent.json");
  let agent: AgentFile | undefined;
  if (agentText) {
    try { const checked = parseAgentFile(JSON.parse(agentText), name); if (checked.agent) agent = checked.agent; else problems.push(...checked.errors); } catch (e) { problems.push(`agent.json is not valid JSON: ${(e as Error).message}`); }
  }
  const settingsText = read("settings.json");
  let settings: Settings | undefined;
  if (settingsText) {
    try {
      const checked = validateSettings(JSON.parse(settingsText), { ownApi: true });
      if (checked.ok) settings = checked.settings; else problems.push(...checked.errors.map((e) => `settings.json: ${e}`));
    } catch (e) { problems.push(`settings.json is not valid JSON: ${(e as Error).message}`); }
  }
  // the settings and the services must agree on how money is taken: a Guard is made only for the way the settings chose (B71)
  const paying = agent ? paymentUpstreamOf(agent.upstreams) : undefined;
  const chosen = (settings as { payment?: { module?: string } } | undefined)?.payment?.module;
  if (paying && chosen !== undefined && chosen !== paying.id) problems.push(`settings.json says customers pay with "${chosen}", but agent.json's upstreams name ${paying.id}. Make them the same.`);
  const ownApi = paying?.id === OWN_API ? { draftText: read(OWN_API_FILES.draft), acceptText: read(OWN_API_FILES.accept) } : undefined;
  return { name, agentText, agent, settingsText, settings, ...(ownApi ? { ownApi } : {}), problems };
}

/** Where an own-API agent's reviewed spec is kept, beside agent.json (the companies kit's two files, byte for byte as the builder gave them). */
export const OWN_API_FILES = { draft: "gateway-draft.json", accept: "gateway-accept.json" } as const;

/**
 * `agent set <name> --run "<command>" --version <v>`: the two things about the agent that only the crash test uses. They live in agent.json, so a builder can also edit the file;
 * this checks what was typed the way the file is checked. A change here is not a deploy (see agentGuardPart).
 */
export function setAgent(dir: string, name: string, change: { run?: string; version?: string }): AgentFolder {
  const folder = readAgent(dir, name);
  if (!folder.agent) throw new Error(`${name}'s folder cannot be read: ${folder.problems.join(" ")}`);
  const raw = JSON.parse(folder.agentText) as Record<string, unknown>;
  if (change.run !== undefined) raw.run = change.run;
  if (change.version !== undefined) raw.version = change.version;
  const checked = parseAgentFile(raw, name);
  if (!checked.agent) throw new Error(`These need fixing:\n- ${checked.errors.join("\n- ")}`);
  writeAtomic(join(serverPaths(dir).agent(name), "agent.json"), stableJson(raw));
  return readAgent(dir, name);
}

/**
 * agent.json as the Guards see it: without the keys only the crash test reads (`run`, `version`, `driver`). A new version of the agent is not a new Guard, so it must not look like
 * a change to be deployed (the deployer would apply it, unchecked, the moment it is saved). An agent.json with none of the keys is returned byte for byte as it is.
 */
export function agentGuardPart(agentText: string): string {
  let raw: unknown;
  try { raw = JSON.parse(agentText); } catch { return agentText; }
  if (!isObj(raw) || !("run" in raw || "version" in raw || "driver" in raw)) return agentText;
  const { run: _run, version: _version, driver: _driver, ...rest } = raw;
  return stableJson(rest);
}

// The agent folder names on this server; dot-folders are skipped so hidden working folders are never treated as agents.
export function listAgents(dir: string): string[] {
  const agents = serverPaths(dir).agents;
  if (!existsSync(agents)) return [];
  return readdirSync(agents, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name).sort();
}

// ---- `agent add`: from flags -------------------------------------------------------------------------------------------------------------

/** The flags `agent add` takes (all strings, as parsed). */
export interface AgentFlags {
  settings?: string; upstreams?: string; "owner-whatsapp"?: string; "owner-language"?: string; "business-name"?: string; deposit?: string; "refund-limit"?: string; "price-floor"?: string;
  hours?: string; timezone?: string; "whatsapp-number-id"?: string; "calendar-id"?: string; "forward-whatsapp-to"?: string;
  /** How the shop's customers pay when the agent calls no gateway (B71): the shop's own UPI ID and the name customers see. */
  "upi-id"?: string; payee?: string;
  /** B71 step 6, --upstreams own-api: the companies kit's draft of the agent's own gateway API, the accept file the builder filled in, and where the API is (host:port). */
  "gateway-draft"?: string; "gateway-accept"?: string; "gateway-upstream"?: string;
  /** For the crash test (README, "A crash test for your agent"): the command that starts the agent, and the version it is at. */
  run?: string; version?: string;
  "refund-inr-per-day"?: string; "refunds-per-day"?: string; "links-per-hour"?: string; "messages-per-hour"?: string; "events-per-hour"?: string; "events-deleted-per-day"?: string;
}

const whole = (flag: string, text: string | undefined): number | undefined => {
  if (text === undefined) return undefined;
  if (!/^\d+$/u.test(text) || !Number.isSafeInteger(Number(text))) throw new Error(`--${flag} must be a whole number, not "${text}".`);
  return Number(text);
};

/**
 * agent.json and settings.json from what the builder typed. With `--settings <file>` the file is the settings (the same format the templates use; nothing else about money or
 * hours is taken from flags). Without it, a one-service settings file is made from `--deposit`, `--refund-limit`, `--price-floor`, `--hours`, `--owner-whatsapp` and the rest,
 * then checked by the same validator, so a number the templates would refuse is refused here in the same words.
 */
export function agentFromFlags(name: string, flags: AgentFlags, readFile: (path: string) => string, now: Date): { agentText: string; settingsText: string; agent: AgentFile; settings: Settings; ownApi?: { draftText: string; acceptText: string } } {
  const upstreams = (flags.upstreams ?? DEFAULT_UPSTREAMS.join(",")).split(",").map((s) => s.trim()).filter(Boolean);
  const bad = upstreams.filter((u) => !(AGENT_UPSTREAMS as readonly string[]).includes(u));
  if (bad.length > 0) throw new Error(`I don't know the service${bad.length > 1 ? "s" : ""} ${bad.map((b) => `"${b}"`).join(", ")}. An agent can call: ${AGENT_UPSTREAMS.join(", ")}. (Any other web service is on the list of things not built yet.)`);
  if (new Set(upstreams).size !== upstreams.length) throw new Error("--upstreams names the same service twice.");
  const list = upstreams as AgentUpstream[];
  const paying = paymentUpstreamsIn(list);
  if (paying.length !== 1) throw new Error(`Say how this shop's customers pay: --upstreams names exactly one of ${[...PAYMENT_MODULES, OWN_API].join(", ")} (${DEFAULT_PROVIDER.id} is the default and needs no gateway account).`);
  const module = paying[0]!;
  // the owner is asked on WhatsApp: to approve a refund above the limit (a gateway), or to mark money received and refunds sent (UPI). Without it nobody could ever be asked
  if (!list.includes("whatsapp")) throw new Error(`The owner is asked on WhatsApp (${module.ownerMarked ? "to mark each payment received and each refund sent" : "to approve a refund above the limit"}), so --upstreams must include whatsapp as well.`);
  const ownApi = module.id === OWN_API ? ownApiFromFlags(flags, readFile) : undefined;
  if (!ownApi && (flags["gateway-draft"] !== undefined || flags["gateway-accept"] !== undefined || flags["gateway-upstream"] !== undefined)) throw new Error(`--gateway-draft, --gateway-accept and --gateway-upstream are for an agent whose --upstreams name ${OWN_API}.`);

  let settings: Settings;
  let settingsText: string;
  if (flags.settings) {
    const raw = (() => { try { return JSON.parse(readFile(flags.settings!)) as unknown; } catch (e) { throw new Error(`${flags.settings} could not be read as JSON: ${(e as Error).message}`); } })();
    const checked = validateSettings(raw, { ownApi: true });
    if (!checked.ok) throw new Error(`The settings file needs fixing:\n- ${checked.errors.join("\n- ")}`);
    settings = checked.settings;
    settingsText = stableJson(raw);
    // the settings and the services must agree on how money is taken: a gateway Guard is made only for a shop whose settings chose the gateway (B71)
    const chosen = (settings as { payment?: { module?: string } }).payment?.module;
    if (chosen !== module.id) throw new Error(`The settings file says customers pay with "${chosen}", but --upstreams names ${module.id}. Make them the same: a gateway's Guard is made only for a shop that chose that gateway.`);
  } else {
    const businessName = flags["business-name"] ?? name;
    const language = (flags["owner-language"] ?? "en") as Language;
    if (!(LANGUAGES as readonly string[]).includes(language)) throw new Error(`--owner-language must be one of ${LANGUAGES.join(", ")}.`);
    const hours = /^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/u.exec(flags.hours ?? "10:00-20:00");
    if (!hours) throw new Error('--hours must look like 10:00-20:00 (the same hours every day except Sunday). For other hours use --settings with a settings file.');
    const day = { open: hours[1].padStart(5, "0"), close: hours[2].padStart(5, "0") };
    const deposit = whole("deposit", flags.deposit);
    const refundLimit = whole("refund-limit", flags["refund-limit"]);
    const priceFloor = whole("price-floor", flags["price-floor"]);
    if (deposit === undefined || refundLimit === undefined) throw new Error(`Say the deposit and the refund limit in rupees: --deposit 200 --refund-limit 200 (or give a settings file with --settings). ${module.ownerMarked ? "The deposit is what each request asks for, and the owner owes back no more than was marked." : module.id === OWN_API ? "Your own API's limits are the ones you kept in the accept file; these two go in the settings the report reads." : "Guard enforces both on the payment link and the refund."}`);
    if (!flags["owner-whatsapp"]) throw new Error("Say the owner's WhatsApp number: --owner-whatsapp +919800000001. It is the only number whose replies can approve a refund.");
    // B71: how customers pay is the payment module --upstreams names. A gateway needs nothing more here; the owner-marked module (UPI) needs the shop's own UPI ID.
    if (!module.ownerMarked && (flags["upi-id"] !== undefined || flags.payee !== undefined)) throw new Error(`--upstreams names ${module.id}, so the shop takes payments on its own account there: leave out --upi-id and --payee.`);
    if (module.ownerMarked && (flags["upi-id"] === undefined || flags.payee === undefined)) throw new Error(`Say where this shop's customers pay. ${module.displayName} needs no gateway account: --upi-id <the shop's own UPI ID, for example glowsalon@okicici> --payee "<the name customers see>". A shop with its own gateway account names it in --upstreams instead.`);
    const payment = module.ownerMarked ? { module: module.id, upi: { id: flags["upi-id"], payee: flags.payee } } : { module: module.id };
    const raw = {
      name: businessName, timezone: flags.timezone ?? "Asia/Kolkata", languages: [language],
      services: [{ id: "service", names: { [language]: [businessName] }, priceInr: priceFloor ?? deposit ?? 1, durationMinutes: 30 }],
      openingHours: { mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: null }, slotMinutes: 30, bufferMinutes: 0,
      deposit: { amountInr: deposit ?? 1, holdMinutes: 15 }, cancellation: { windowHours: 24, refundLimitInr: refundLimit ?? 0 },
      owner: { whatsapp: flags["owner-whatsapp"], language }, reminders: { hoursBefore: [] }, payment,
    };
    const checked = validateSettings(raw, { ownApi: true });
    if (!checked.ok) throw new Error(`These settings need fixing:\n- ${checked.errors.join("\n- ")}`);
    settings = checked.settings;
    settingsText = stableJson(raw);
  }

  if (list.includes("whatsapp") && !flags["whatsapp-number-id"]) throw new Error("Say the shop's own WhatsApp phone number id: --whatsapp-number-id 123456789012345. The WhatsApp Guard allows exactly that one.");
  if (list.includes("calendar") && !flags["calendar-id"]) throw new Error("Say the shop's own Google calendar: --calendar-id name@group.calendar.google.com. The calendar Guard allows exactly that one.");
  const caps: AgentCaps = {};
  for (const [flag, key] of [["refund-inr-per-day", "refundInrPerDay"], ["refunds-per-day", "refundsPerDay"], ["links-per-hour", "linksPerHour"], ["messages-per-hour", "messagesPerHour"], ["events-per-hour", "eventsCreatedPerHour"], ["events-deleted-per-day", "eventsDeletedPerDay"]] as const) {
    const v = whole(flag, flags[flag]);
    if (v !== undefined) { if (v < 1) throw new Error(`--${flag} must be at least 1.`); caps[key] = v; }
  }
  const raw = {
    schema: 1, name, upstreams: list,
    ...(list.includes("whatsapp") ? { whatsapp: { phoneNumberId: flags["whatsapp-number-id"], ...(flags["forward-whatsapp-to"] ? { forwardTo: flags["forward-whatsapp-to"] } : {}) } } : {}),
    ...(list.includes("calendar") ? { calendar: { calendarId: flags["calendar-id"] } } : {}),
    ...(ownApi ? { ownApi: { upstream: ownApi.upstream } } : {}),
    ...(flags.run ? { run: flags.run } : {}), ...(flags.version ? { version: flags.version } : {}),
    ...(Object.keys(caps).length > 0 ? { caps } : {}), createdAt: now.toISOString(),
  };
  const checked = parseAgentFile(raw, name);
  if (!checked.agent) throw new Error(`These need fixing:\n- ${checked.errors.join("\n- ")}`);
  return { agentText: stableJson(raw), settingsText, agent: checked.agent, settings, ...(ownApi ? { ownApi: { draftText: ownApi.draftText, acceptText: ownApi.acceptText } } : {}) };
}

/** --gateway-draft, --gateway-accept, --gateway-upstream, read as given. Whether the two files make a spec Guard can enforce is the plan's question (plan.ts, ownApiSpec). */
function ownApiFromFlags(flags: AgentFlags, readFile: (path: string) => string): { draftText: string; acceptText: string; upstream: string } {
  const draft = flags["gateway-draft"], accept = flags["gateway-accept"], upstream = flags["gateway-upstream"];
  if (!draft || !accept || !upstream) throw new Error(`An agent that takes money through its own gateway's API needs the reviewed rules for it. Make them with the companies kit (node companies/openapi-to-spec.ts draft <openapi.json> --out draft.json, then fill in the accept file) and pass --gateway-draft draft.json --gateway-accept accept.json --gateway-upstream <host:port of the API>.`);
  if (!HOST_PORT.test(upstream)) throw new Error(`--gateway-upstream must be host:port, for example api.example.com:443.`);
  const text = (path: string, what: string) => { try { return readFile(path); } catch (e) { throw new Error(`${what} at ${path} could not be read: ${(e as Error).message}`); } };
  return { draftText: text(draft, "The draft"), acceptText: text(accept, "The accept file"), upstream };
}

/** The refund cap in paise, for the template's spec (agent.json carries rupees). */
export const refundCapPaise = (rupees: number): number => rupeesToPaise(rupees);
