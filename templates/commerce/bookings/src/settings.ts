// A business's settings: everything a builder changes to tailor the Bookings pathway. No code, only this file.
// Validation is written by hand and says what is wrong in plain words, so a builder can fix it without a manual.
import { isValidTimeZone, parseClock } from "../../../../modules/core/time.ts";
import { LANGUAGES, LANGUAGE_NAMES } from "../../../../modules/language/languages.ts";
import type { Language } from "../../../../modules/language/languages.ts";
import { readApprovers } from "../../../../modules/approvals/people.ts";
import type { ApproversSettings } from "../../../../modules/approvals/people.ts";
import { readPaymentSettings } from "../../../../modules/payments/upi/settings.ts";
import type { PaymentSettings } from "../../../../modules/payments/upi/settings.ts";

const languageList = () => LANGUAGES.map((l) => `"${l}" (${LANGUAGE_NAMES[l]})`).join(", ");

export type WeekdayKey = "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat"; // same order as Date#getDay()
export const WEEKDAY_KEYS: readonly WeekdayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export interface Service {
  id: string;
  /** What customers call it, per language. The first name is the one the agent says; the rest are synonyms. */
  names: Partial<Record<Language, string[]>>;
  /** Whole rupees. This is also the floor: the agent never quotes or agrees below it. */
  priceInr: number;
  durationMinutes: number;
}

export interface OpeningHours { open: string; close: string } // "10:00", "20:00"

export interface Settings {
  name: string;
  address?: string;
  timezone: string;
  services: Service[];
  openingHours: Record<WeekdayKey, OpeningHours | null>; // null = closed that day
  slotMinutes: number; // bookings start on this grid
  bufferMinutes: number; // gap kept after each booking
  deposit: { amountInr: number; holdMinutes: number };
  cancellation: {
    /** Cancel at least this long before the start and the deposit is refunded; later and the owner decides. */
    windowHours: number;
    /** The agent refunds up to and including this amount alone; anything above needs the owner. */
    refundLimitInr: number;
  };
  languages: Language[]; // customer-facing; the first is the default
  owner: { whatsapp: string; language: Language };
  /** Others who may approve a refund Guard holds, and the amount above which two must (B37, modules/approvals/people.ts). Left out: the owner alone. */
  approvers?: ApproversSettings;
  reminders: { hoursBefore: number[] };
  /**
   * How customers pay the deposit (modules/payments/upi/settings.ts): "upi", the shop's own UPI ID, marked paid by the owner; or "razorpay", the shop's own account.
   * Left out: Razorpay, as every shop was before UPI (B33), and the parsed settings leave it out too, so a shop set up before stays byte for byte the same.
   */
  payment?: PaymentSettings;
}

export type SettingsResult = { ok: true; settings: Settings } | { ok: false; errors: string[] };

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isWhole = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

/** Check a settings object (usually parsed from JSON), fill in the defaults and say what is wrong in plain words. */
export function validateSettings(input: unknown): SettingsResult {
  const errors: string[] = [];
  if (!isObj(input)) return { ok: false, errors: ["The settings must be an object with the business's name, services, hours and so on."] };

  unknownKeys(input, ["name", "address", "timezone", "services", "openingHours", "slotMinutes", "bufferMinutes", "deposit", "cancellation", "languages", "owner", "approvers", "reminders", "payment"], "the settings", errors);

  const name = input.name;
  if (typeof name !== "string" || name.trim() === "") errors.push("Add the business's name (\"name\").");

  const address = input.address;
  if (address !== undefined && typeof address !== "string") errors.push("The address (\"address\") must be text.");

  const timezone = input.timezone ?? "Asia/Kolkata";
  if (typeof timezone !== "string" || !isValidTimeZone(timezone)) {
    errors.push(`The time zone ${JSON.stringify(timezone)} is not one I know. Use a name like "Asia/Kolkata".`);
  }

  const languages = readLanguages(input.languages, errors);
  const slotMinutes = readWhole(input.slotMinutes, "the slot length (\"slotMinutes\")", 5, 240, errors);
  const bufferMinutes = input.bufferMinutes === undefined ? 0 : readWhole(input.bufferMinutes, "the buffer time (\"bufferMinutes\")", 0, 240, errors);
  const services = readServices(input.services, languages, errors);
  const openingHours = readHours(input.openingHours, errors);
  const deposit = readDeposit(input.deposit, services, errors);
  const cancellation = readCancellation(input.cancellation, errors);
  const owner = readOwner(input.owner, errors);
  const approvers = readApprovers(input.approvers, { ownerWhatsapp: owner?.whatsapp, refundLimitInr: cancellation?.refundLimitInr }, errors);
  const reminders = readReminders(input.reminders, errors);
  const payment = readPaymentSettings(input.payment, errors);

  if (errors.length > 0) return { ok: false, errors };
  const settings: Settings = {
    name: (name as string).trim(),
    timezone: timezone as string,
    services,
    openingHours: openingHours as Settings["openingHours"],
    slotMinutes: slotMinutes as number,
    bufferMinutes: bufferMinutes as number,
    deposit: deposit as Settings["deposit"],
    cancellation: cancellation as Settings["cancellation"],
    languages,
    owner: owner as Settings["owner"],
    reminders,
  };
  if (typeof address === "string") settings.address = address;
  if (approvers) settings.approvers = approvers;
  if (payment) settings.payment = payment;
  return { ok: true, settings };
}

/** Like validateSettings, but throws one error that lists every problem. For scripts and tests. */
export function parseSettings(input: unknown): Settings {
  const result = validateSettings(input);
  if (!result.ok) throw new Error(`These settings need fixing:\n- ${result.errors.join("\n- ")}`);
  return result.settings;
}

// ---- helpers other modules use ---------------------------------------------------------------------------------

/** The name the agent says for a service in a language, falling back to the first language that has one. */
export function serviceName(service: Service, language: Language): string {
  return service.names[language]?.[0] ?? service.names.en?.[0] ?? service.names.hi?.[0] ?? service.names.ml?.[0] ?? service.names.kn?.[0] ?? service.id;
}

/** Opening and closing time as minutes since midnight for a weekday (0 = Sunday), or null when closed. */
export function hoursOn(settings: Settings, weekday: number): { open: number; close: number } | null {
  const h = settings.openingHours[WEEKDAY_KEYS[weekday]];
  if (!h) return null;
  return { open: parseClock(h.open) as number, close: parseClock(h.close) as number };
}

// ---- readers: each pushes plain-words problems and returns a best-effort value ---------------------------------

function unknownKeys(obj: Obj, allowed: string[], where: string, errors: string[]): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) errors.push(`I don't know what "${key}" means in ${where}. Allowed: ${allowed.join(", ")}.`);
  }
}

function readWhole(v: unknown, label: string, min: number, max: number, errors: string[]): number | undefined {
  if (!isWhole(v)) {
    errors.push(`Set ${label} as a whole number, for example ${Math.max(min, 1)}.`);
    return undefined;
  }
  if (v < min || v > max) {
    errors.push(`${capitalise(label)} must be between ${min} and ${max}, not ${v}.`);
    return undefined;
  }
  return v;
}

function readLanguages(v: unknown, errors: string[]): Language[] {
  if (v === undefined) return ["hi", "en"];
  if (!Array.isArray(v) || v.length === 0) {
    errors.push("List at least one customer language (\"languages\"), for example [\"hi\", \"en\"].");
    return ["hi", "en"];
  }
  const out: Language[] = [];
  for (const l of v) {
    if (!LANGUAGES.includes(l as Language)) errors.push(`The language ${JSON.stringify(l)} is not supported yet. Use one of ${languageList()}.`);
    else if (out.includes(l as Language)) errors.push(`The language "${l}" is listed twice.`);
    else out.push(l as Language);
  }
  return out.length > 0 ? out : ["hi", "en"];
}

function readServices(v: unknown, languages: Language[], errors: string[]): Service[] {
  if (!Array.isArray(v) || v.length === 0) {
    errors.push("Add at least one service (\"services\") with a name, a price in rupees and a duration.");
    return [];
  }
  const services: Service[] = [];
  const seenIds = new Set<string>();
  const seenNames = new Map<string, string>();
  v.forEach((raw, i) => {
    const label = isObj(raw) && typeof raw.id === "string" ? `Service "${raw.id}"` : `Service number ${i + 1}`;
    if (!isObj(raw)) { errors.push(`${label} must be an object with id, names, priceInr and durationMinutes.`); return; }
    unknownKeys(raw, ["id", "names", "priceInr", "durationMinutes"], label, errors);
    const id = raw.id;
    if (typeof id !== "string" || !/^[a-z0-9-]+$/.test(id)) errors.push(`${label} needs an id made of lowercase letters, digits and dashes, for example "haircut".`);
    else if (seenIds.has(id)) errors.push(`Two services share the id "${id}". Each id must be different.`);
    else seenIds.add(id);

    const names: Service["names"] = {};
    if (!isObj(raw.names)) {
      errors.push(`${label} needs "names": what customers call it, per language, for example {"en": ["haircut"], "hi": ["हेयरकट"]}.`);
    } else {
      unknownKeys(raw.names, [...LANGUAGES], `${label}'s names`, errors);
      for (const lang of languages) {
        const list = raw.names[lang];
        if (!Array.isArray(list) || list.length === 0 || !list.every((n) => typeof n === "string" && n.trim() !== "")) {
          errors.push(`${label} needs at least one name in ${LANGUAGE_NAMES[lang]} ("${lang}"), because customers can write in it.`);
          continue;
        }
        names[lang] = list.map((n: string) => n.trim());
        for (const n of names[lang]!) {
          const key = n.toLowerCase();
          const other = seenNames.get(key);
          if (other !== undefined && other !== String(id)) errors.push(`The name "${n}" is used by both "${other}" and "${String(id)}", so the agent could not tell which one a customer means.`);
          else seenNames.set(key, String(id));
        }
      }
    }
    if (!isWhole(raw.priceInr) || raw.priceInr < 1) errors.push(`${label} needs a price in whole rupees (\"priceInr\"), for example 450. This is also the lowest price the agent will ever agree to.`);
    if (!isWhole(raw.durationMinutes) || raw.durationMinutes < 5 || raw.durationMinutes > 480) errors.push(`${label} needs a duration in whole minutes (\"durationMinutes\"), between 5 and 480.`);
    if (typeof id === "string" && isWhole(raw.priceInr) && isWhole(raw.durationMinutes)) {
      services.push({ id, names, priceInr: raw.priceInr, durationMinutes: raw.durationMinutes });
    }
  });
  return services;
}

function readHours(v: unknown, errors: string[]): Settings["openingHours"] | undefined {
  if (!isObj(v)) {
    errors.push("Add the opening hours (\"openingHours\") for each weekday, for example \"mon\": {\"open\": \"10:00\", \"close\": \"20:00\"}, or null for a closed day.");
    return undefined;
  }
  unknownKeys(v, [...WEEKDAY_KEYS], "the opening hours", errors);
  const out = {} as Settings["openingHours"];
  const problemsBefore = errors.length;
  let anyOpen = false;
  for (const day of WEEKDAY_KEYS) {
    const h = v[day];
    if (h === undefined || h === null) { out[day] = null; continue; }
    if (!isObj(h) || typeof h.open !== "string" || typeof h.close !== "string") {
      errors.push(`The hours for "${day}" must be {"open": "10:00", "close": "20:00"} or null when closed.`);
      continue;
    }
    const open = parseClock(h.open);
    const close = parseClock(h.close);
    if (open === null || close === null) errors.push(`The hours for "${day}" must be written as 24-hour times like "10:00" or "20:30".`);
    else if (open >= close) errors.push(`On "${day}" the opening time ${h.open} must be earlier than the closing time ${h.close}.`);
    else { out[day] = { open: h.open, close: h.close }; anyOpen = true; }
  }
  if (!anyOpen && errors.length === problemsBefore) errors.push("The business is closed every day. Open it on at least one weekday.");
  return out;
}

function readDeposit(v: unknown, services: Service[], errors: string[]): Settings["deposit"] | undefined {
  if (!isObj(v)) { errors.push("Add the deposit (\"deposit\"): the amount in rupees, for example {\"amountInr\": 200}."); return undefined; }
  unknownKeys(v, ["amountInr", "holdMinutes"], "the deposit", errors);
  const amountInr = readWhole(v.amountInr, "the deposit amount (\"deposit.amountInr\")", 1, 1_000_000, errors);
  const holdMinutes = v.holdMinutes === undefined ? 15 : readWhole(v.holdMinutes, "how long a slot is held (\"deposit.holdMinutes\")", 1, 240, errors);
  const cheapest = services.length > 0 ? Math.min(...services.map((s) => s.priceInr)) : undefined;
  if (amountInr !== undefined && cheapest !== undefined && amountInr > cheapest) {
    errors.push(`The deposit (₹${amountInr}) is more than the cheapest service (₹${cheapest}). Lower the deposit so it never exceeds a price.`);
  }
  return amountInr === undefined || holdMinutes === undefined ? undefined : { amountInr, holdMinutes };
}

function readCancellation(v: unknown, errors: string[]): Settings["cancellation"] | undefined {
  if (!isObj(v)) { errors.push("Add the cancellation rule (\"cancellation\"): {\"windowHours\": 24, \"refundLimitInr\": 200}."); return undefined; }
  unknownKeys(v, ["windowHours", "refundLimitInr"], "the cancellation rule", errors);
  const windowHours = readWhole(v.windowHours, "the cancellation window (\"cancellation.windowHours\")", 0, 720, errors);
  const refundLimitInr = readWhole(v.refundLimitInr, "the refund limit (\"cancellation.refundLimitInr\")", 0, 1_000_000, errors);
  return windowHours === undefined || refundLimitInr === undefined ? undefined : { windowHours, refundLimitInr };
}

function readOwner(v: unknown, errors: string[]): Settings["owner"] | undefined {
  if (!isObj(v)) { errors.push("Add the owner (\"owner\") with their WhatsApp number, for example {\"whatsapp\": \"+919800000000\"}."); return undefined; }
  unknownKeys(v, ["whatsapp", "language"], "the owner", errors);
  const whatsapp = v.whatsapp;
  if (typeof whatsapp !== "string" || !/^\+\d{10,15}$/.test(whatsapp)) {
    errors.push("The owner's WhatsApp number (\"owner.whatsapp\") must start with + and the country code, then digits only, for example +919800000000.");
  }
  const language = v.language ?? "en";
  const languageOk = LANGUAGES.includes(language as Language);
  if (!languageOk) errors.push(`The owner's language ("owner.language") must be one of ${languageList()}.`);
  return typeof whatsapp === "string" && languageOk ? { whatsapp, language: language as Language } : undefined;
}

function readReminders(v: unknown, errors: string[]): Settings["reminders"] {
  if (v === undefined) return { hoursBefore: [24, 2] };
  if (!isObj(v)) { errors.push("The reminders (\"reminders\") must look like {\"hoursBefore\": [24, 2]}."); return { hoursBefore: [24, 2] }; }
  unknownKeys(v, ["hoursBefore"], "the reminders", errors);
  const list = v.hoursBefore ?? [24, 2];
  if (!Array.isArray(list) || !list.every((h) => isWhole(h) && h >= 1 && h <= 168)) {
    errors.push("Reminder times (\"reminders.hoursBefore\") must be a list of whole hours before the booking, between 1 and 168, for example [24, 2].");
    return { hoursBefore: [24, 2] };
  }
  if (new Set(list).size !== list.length) errors.push("A reminder time is listed twice in \"reminders.hoursBefore\".");
  return { hoursBefore: [...list].sort((a: number, b: number) => b - a) };
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
