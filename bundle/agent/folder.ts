// An agent someone else wrote ("bring your own agent"): its folder on the server, and how `geometer agent add` makes one from flags or a settings file.
//
//   agents/<name>/agent.json      which of Razorpay, WhatsApp and Calendar the agent calls, the shop's own WhatsApp number id and calendar id, and the caps that settings do not carry
//   agents/<name>/settings.json   the SAME settings file the templates use (templates/commerce/bookings/src/settings.ts), checked by the same validator. Guard's limits come from it exactly as
//                                 they do for a template: the deposit, the refund limit. Guard has no rule for prices or opening hours, so those two are kept in the file (the report's
//                                 policy digest covers them) but nothing in Guard checks them for an agent we did not write.
//
// No code here runs the agent. Geometer never rebuilds or hosts it (plan decision 5): the folder only says what to put in front of the services it calls.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { rupeesToPaise } from "../../modules/payments/guard-limits.ts";
import { validateSettings } from "../../templates/commerce/bookings/src/settings.ts";
import { LANGUAGES } from "../../modules/language/languages.ts";
import type { Settings } from "../../templates/commerce/bookings/src/settings.ts";
import type { Language } from "../../modules/language/languages.ts";
import { serverPaths } from "../lib/server.ts";
import { stableJson, writeAtomic } from "../lib/util.ts";

/** The three services a first-slice agent can call: the ones the templates already use. */
export const AGENT_UPSTREAMS = ["razorpay", "whatsapp", "calendar"] as const;
export type AgentUpstream = (typeof AGENT_UPSTREAMS)[number];

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
  caps?: AgentCaps;
  createdAt: string;
}

export interface AgentFolder {
  name: string;
  agentText: string;
  agent: AgentFile | undefined;
  settingsText: string;
  settings: Settings | undefined;
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
  const known = ["cwd", "whatsappPath", "razorpayPath", "says", "bookedWords", "startSeconds", "situationSeconds"];
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
  return { errors, agent: { schema: 1, name, upstreams: list, ...(typeof raw.run === "string" ? { run: raw.run } : {}), ...(typeof raw.version === "string" ? { version: raw.version } : {}), ...(driver ? { driver } : {}),...(list.includes("whatsapp") ? { whatsapp: { phoneNumberId: whatsapp!.phoneNumberId as string, ...(typeof whatsapp!.forwardTo === "string" ? { forwardTo: whatsapp!.forwardTo } : {}) } } : {}), ...(list.includes("calendar") ? { calendar: { calendarId: calendar!.calendarId as string } } : {}), ...(Object.keys(caps).length > 0 ? { caps } : {}), createdAt: raw.createdAt as string } };
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
      const checked = validateSettings(JSON.parse(settingsText));
      if (checked.ok) settings = checked.settings; else problems.push(...checked.errors.map((e) => `settings.json: ${e}`));
    } catch (e) { problems.push(`settings.json is not valid JSON: ${(e as Error).message}`); }
  }
  return { name, agentText, agent, settingsText, settings, problems };
}

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
export function agentFromFlags(name: string, flags: AgentFlags, readFile: (path: string) => string, now: Date): { agentText: string; settingsText: string; agent: AgentFile; settings: Settings } {
  const upstreams = (flags.upstreams ?? AGENT_UPSTREAMS.join(",")).split(",").map((s) => s.trim()).filter(Boolean);
  const bad = upstreams.filter((u) => !(AGENT_UPSTREAMS as readonly string[]).includes(u));
  if (bad.length > 0) throw new Error(`I don't know the service${bad.length > 1 ? "s" : ""} ${bad.map((b) => `"${b}"`).join(", ")}. This first version can put Guard in front of: ${AGENT_UPSTREAMS.join(", ")}. (Any other web service is on the list of things not built yet.)`);
  if (new Set(upstreams).size !== upstreams.length) throw new Error("--upstreams names the same service twice.");
  const list = upstreams as AgentUpstream[];
  // a refund the owner has to approve is asked on WhatsApp, through the shop's WhatsApp Guard: without it nobody could ever be asked
  if (list.includes("razorpay") && !list.includes("whatsapp")) throw new Error("A refund above the limit waits for the owner's answer on WhatsApp, so an agent that calls Razorpay needs --upstreams to include whatsapp as well.");

  let settings: Settings;
  let settingsText: string;
  if (flags.settings) {
    const raw = (() => { try { return JSON.parse(readFile(flags.settings!)) as unknown; } catch (e) { throw new Error(`${flags.settings} could not be read as JSON: ${(e as Error).message}`); } })();
    const checked = validateSettings(raw);
    if (!checked.ok) throw new Error(`The settings file needs fixing:\n- ${checked.errors.join("\n- ")}`);
    settings = checked.settings;
    settingsText = stableJson(raw);
    // the settings and the services must agree on how money is taken: a gateway Guard is made only for a shop whose settings chose the gateway (B71)
    const gatewayChosen = (settings as { payment?: { module?: string } }).payment?.module === "razorpay";
    if (gatewayChosen && !list.includes("razorpay")) throw new Error("The settings file says the shop takes payments on its own Razorpay account, but --upstreams does not include razorpay. Add it, or change \"payment\" in the file to the shop's UPI ID.");
    if (!gatewayChosen && list.includes("razorpay")) throw new Error("--upstreams includes razorpay, but the settings file does not choose it (\"payment\": {\"module\": \"razorpay\"}). Guard is put in front of a gateway only for a shop that chose it.");
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
    if (list.includes("razorpay") && (deposit === undefined || refundLimit === undefined)) throw new Error("Say the deposit and the refund limit in rupees: --deposit 200 --refund-limit 200 (or give a settings file with --settings). Guard enforces both on the payment link and the refund.");
    if (!flags["owner-whatsapp"]) throw new Error("Say the owner's WhatsApp number: --owner-whatsapp +919800000001. It is the only number whose replies can approve a refund.");
    // B71: how customers pay. A gateway only when --upstreams names it; otherwise the shop's own UPI ID, asked for here, never a gateway nobody chose.
    if (list.includes("razorpay") && (flags["upi-id"] !== undefined || flags.payee !== undefined)) throw new Error("--upstreams includes razorpay, so the shop takes payments on its own Razorpay account: leave out --upi-id and --payee.");
    if (!list.includes("razorpay") && (flags["upi-id"] === undefined || flags.payee === undefined)) throw new Error("Say how this shop's customers pay. UPI is the default and needs no gateway account: --upi-id <the shop's own UPI ID, for example glowsalon@okicici> --payee \"<the name customers see>\". A shop with its own Razorpay account adds razorpay to --upstreams instead.");
    const payment = list.includes("razorpay") ? { module: "razorpay" } : { module: "upi", upi: { id: flags["upi-id"], payee: flags.payee } };
    const raw = {
      name: businessName, timezone: flags.timezone ?? "Asia/Kolkata", languages: [language],
      services: [{ id: "service", names: { [language]: [businessName] }, priceInr: priceFloor ?? deposit ?? 1, durationMinutes: 30 }],
      openingHours: { mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: null }, slotMinutes: 30, bufferMinutes: 0,
      deposit: { amountInr: deposit ?? 1, holdMinutes: 15 }, cancellation: { windowHours: 24, refundLimitInr: refundLimit ?? 0 },
      owner: { whatsapp: flags["owner-whatsapp"], language }, reminders: { hoursBefore: [] }, payment,
    };
    const checked = validateSettings(raw);
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
    ...(flags.run ? { run: flags.run } : {}), ...(flags.version ? { version: flags.version } : {}),
    ...(Object.keys(caps).length > 0 ? { caps } : {}), createdAt: now.toISOString(),
  };
  const checked = parseAgentFile(raw, name);
  if (!checked.agent) throw new Error(`These need fixing:\n- ${checked.errors.join("\n- ")}`);
  return { agentText: stableJson(raw), settingsText, agent: checked.agent, settings };
}

/** The refund cap in paise, for the template's spec (agent.json carries rupees). */
export const refundCapPaise = (rupees: number): number => rupeesToPaise(rupees);
