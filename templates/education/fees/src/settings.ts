// A centre's settings: everything a builder changes to tailor the Fees pathway. No code, only this file.
// Validation is written by hand and says what is wrong in plain words, so a builder can fix it without a manual.
import { LANGUAGES, LANGUAGE_NAMES } from "../../../../modules/language/languages.ts";
import type { Language } from "../../../../modules/language/languages.ts";
import { readApprovers } from "../../../../modules/approvals/people.ts";
import type { ApproversSettings } from "../../../../modules/approvals/people.ts";
import { isValidTimeZone } from "../../../../modules/core/time.ts";
import { readPaymentSettings } from "../../../../modules/payments/providers/index.ts";
import type { PaymentSettings } from "../../../../modules/payments/providers/index.ts";

const languageList = () => LANGUAGES.map((l) => `"${l}" (${LANGUAGE_NAMES[l]})`).join(", ");

export interface Batch {
  id: string;
  /** What parents call it, per language. The first name is the one the agent says; the rest are synonyms. */
  names: Partial<Record<Language, string[]>>;
  /** Whole rupees a month. This is what a payment link is made for; the agent never asks for more (plus the late fee, when there is one). */
  monthlyFeeInr: number;
}

export interface Student {
  name: string;
  /** The parent's WhatsApp number, with + and the country code. */
  parent: string;
  batchId: string;
  /** The language this parent is written to. Left out: the centre's first language. */
  language?: Language;
}

export interface Settings {
  name: string;
  address?: string;
  timezone: string;
  /** Parent-facing; the first is the default. */
  languages: Language[];
  batches: Batch[];
  students: Student[];
  due: {
    /** The day of the month the fee is due, 1 to 28. */
    day: number;
    /** Days after the due day before a late fee is added. */
    graceDays: number;
  };
  /** Whole rupees added once when the grace days are over and the fee is still not paid. 0: no late fee. */
  lateFeeInr: number;
  reminders: {
    /** Days from the due day: -3 is three days before, 0 the due day, 5 five days after. The first one also opens the month's fee. */
    daysFromDue: number[];
    /** The hour of the day a reminder goes, 6 to 21, in the centre's time zone. */
    hour: number;
    /** The most reminders for one student's fee in a month. */
    maxPerMonth: number;
  };
  partPayments: {
    allowed: boolean;
    /** The least a first part payment may be, in whole rupees. */
    minInr: number;
  };
  /** The most the agent takes off one student's month on its own. A request above it goes to the owner, who approves that exact amount or not. 0: every request goes to the owner. */
  waiver: { limitInr: number };
  /** The agent refunds up to and including this amount alone (an overpayment); anything above needs the owner (Guard holds it). */
  refund: { limitInr: number };
  /**
   * How parents pay (modules/payments/providers/index.ts): "upi", the centre's own UPI ID, marked paid by the owner; or "razorpay", the centre's own account.
   * Required (B71): a file without it is refused and asked for the UPI ID, never read as a gateway centre.
   */
  payment: PaymentSettings;
  owner: { whatsapp: string; language: Language };
  /** Others who may approve a refund Guard holds, and the amount above which two must (B37, modules/approvals/people.ts). Left out: the owner alone. */
  approvers?: ApproversSettings;
}

export type SettingsResult = { ok: true; settings: Settings } | { ok: false; errors: string[] };

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isWhole = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const PHONE = /^\+\d{10,15}$/;

/** Check a settings object (usually parsed from JSON), fill in the defaults and say what is wrong in plain words. */
export function validateSettings(input: unknown): SettingsResult {
  const errors: string[] = [];
  if (!isObj(input)) return { ok: false, errors: ["The settings must be an object with the centre's name, batches, students and so on."] };

  unknownKeys(input, ["name", "address", "timezone", "languages", "batches", "students", "due", "lateFeeInr", "reminders", "partPayments", "waiver", "refund", "payment", "owner", "approvers"], "the settings", errors);

  const name = input.name;
  if (typeof name !== "string" || name.trim() === "") errors.push("Add the centre's name (\"name\").");
  const address = input.address;
  if (address !== undefined && typeof address !== "string") errors.push("The address (\"address\") must be text.");
  const timezone = input.timezone ?? "Asia/Kolkata";
  if (typeof timezone !== "string" || !isValidTimeZone(timezone)) errors.push(`The time zone ${JSON.stringify(timezone)} is not one I know. Use a name like "Asia/Kolkata".`);

  const languages = readLanguages(input.languages, errors);
  const batches = readBatches(input.batches, languages, errors);
  const owner = readOwner(input.owner, errors);
  const students = readStudents(input.students, batches, languages, owner?.whatsapp, errors);
  const cheapest = batches.length > 0 ? Math.min(...batches.map((b) => b.monthlyFeeInr)) : undefined;
  const due = readDue(input.due, errors);
  const lateFeeInr = input.lateFeeInr === undefined ? 0 : readWhole(input.lateFeeInr, "the late fee (\"lateFeeInr\")", 0, cheapest ?? 1_000_000, errors, cheapest !== undefined ? `a late fee is never more than the cheapest monthly fee (₹${cheapest})` : undefined);
  const reminders = readReminders(input.reminders, errors);
  const partPayments = readPartPayments(input.partPayments, cheapest, errors);
  const waiver = readLimit(input.waiver, "waiver", "the waiver limit (\"waiver.limitInr\")", cheapest, "waiver", errors);
  const refund = readLimit(input.refund, "refund", "the refund limit (\"refund.limitInr\")", undefined, "refund", errors, true);
  const payment = readPayment(input.payment, errors);
  const approvers = readApprovers(input.approvers, { ownerWhatsapp: owner?.whatsapp, refundLimitInr: refund?.limitInr }, errors);
  if (approvers) for (const p of approvers.people) if (students.some((s) => s.parent === p.whatsapp)) errors.push(`approvers: ${p.id}'s number is a parent's. A person who approves refunds answers from their own number, not a parent's.`);

  if (errors.length > 0) return { ok: false, errors };
  const settings: Settings = {
    name: (name as string).trim(), timezone: timezone as string, languages, batches, students,
    due: due as Settings["due"], lateFeeInr: lateFeeInr as number, reminders: reminders as Settings["reminders"],
    partPayments: partPayments as Settings["partPayments"], waiver: waiver as Settings["waiver"], refund: refund as Settings["refund"],
    payment: payment as Settings["payment"], owner: owner as Settings["owner"],
  };
  if (typeof address === "string") settings.address = address;
  if (approvers) settings.approvers = approvers;
  return { ok: true, settings };
}

/** Like validateSettings, but throws one error that lists every problem. For scripts and tests. */
export function parseSettings(input: unknown): Settings {
  const result = validateSettings(input);
  if (!result.ok) throw new Error(`These settings need fixing:\n- ${result.errors.join("\n- ")}`);
  return result.settings;
}

// ---- helpers other files use ---------------------------------------------------------------------------------------

/** The name the agent says for a batch in a language, falling back to the first language that has one. */
export function batchName(batch: Batch, language: Language): string {
  return batch.names[language]?.[0] ?? batch.names.en?.[0] ?? batch.names.hi?.[0] ?? batch.names.ml?.[0] ?? batch.names.kn?.[0] ?? batch.id;
}

export const batchOf = (settings: Settings, student: Student): Batch => settings.batches.find((b) => b.id === student.batchId)!;

/** The most any one payment link can be for, in rupees: the dearest batch's fee with the late fee on top. */
export const highestDueInr = (settings: Settings): number => Math.max(...settings.batches.map((b) => b.monthlyFeeInr)) + settings.lateFeeInr;

/** The least any one payment link can be for, in rupees. A link is made for what is still owed, which can be a rupee. */
export const LOWEST_LINK_INR = 1;

// ---- readers: each pushes plain-words problems and returns a best-effort value ---------------------------------------

function unknownKeys(obj: Obj, allowed: string[], where: string, errors: string[]): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) errors.push(`I don't know what "${key}" means in ${where}. Allowed: ${allowed.join(", ")}.`);
  }
}

function readWhole(v: unknown, label: string, min: number, max: number, errors: string[], why?: string): number | undefined {
  if (!isWhole(v)) { errors.push(`Set ${label} as a whole number, for example ${Math.max(min, 1)}.`); return undefined; }
  if (v < min || v > max) { errors.push(`${label.charAt(0).toUpperCase() + label.slice(1)} must be between ${min} and ${max}, not ${v}${why ? ` (${why})` : ""}.`); return undefined; }
  return v;
}

function readLanguages(v: unknown, errors: string[]): Language[] {
  if (v === undefined) return ["hi", "en"];
  if (!Array.isArray(v) || v.length === 0) { errors.push("List at least one parent language (\"languages\"), for example [\"hi\", \"en\"]."); return ["hi", "en"]; }
  const out: Language[] = [];
  for (const l of v) {
    if (!LANGUAGES.includes(l as Language)) errors.push(`The language ${JSON.stringify(l)} is not supported yet. Use one of ${languageList()}.`);
    else if (out.includes(l as Language)) errors.push(`The language "${l}" is listed twice.`);
    else out.push(l as Language);
  }
  return out.length > 0 ? out : ["hi", "en"];
}

function readBatches(v: unknown, languages: Language[], errors: string[]): Batch[] {
  if (!Array.isArray(v) || v.length === 0) { errors.push("Add at least one batch or class (\"batches\") with a name and a monthly fee in rupees."); return []; }
  const batches: Batch[] = [];
  const seenIds = new Set<string>();
  const seenNames = new Map<string, string>();
  v.forEach((raw, i) => {
    const label = isObj(raw) && typeof raw.id === "string" ? `Batch "${raw.id}"` : `Batch number ${i + 1}`;
    if (!isObj(raw)) { errors.push(`${label} must be an object with id, names and monthlyFeeInr.`); return; }
    unknownKeys(raw, ["id", "names", "monthlyFeeInr"], label, errors);
    const id = raw.id;
    if (typeof id !== "string" || !/^[a-z0-9-]+$/.test(id)) errors.push(`${label} needs an id made of lowercase letters, digits and dashes, for example "class-10".`);
    else if (seenIds.has(id)) errors.push(`Two batches share the id "${id}". Each id must be different.`);
    else seenIds.add(id);

    const names: Batch["names"] = {};
    if (!isObj(raw.names)) {
      errors.push(`${label} needs "names": what parents call it, per language, for example {"en": ["Class 10"], "hi": ["कक्षा 10"]}.`);
    } else {
      unknownKeys(raw.names, [...LANGUAGES], `${label}'s names`, errors);
      for (const lang of languages) {
        const list = raw.names[lang];
        if (!Array.isArray(list) || list.length === 0 || !list.every((n) => typeof n === "string" && n.trim() !== "")) {
          errors.push(`${label} needs at least one name in ${LANGUAGE_NAMES[lang]} ("${lang}"), because parents can write in it.`);
          continue;
        }
        names[lang] = list.map((n: string) => n.trim());
        for (const n of names[lang]!) {
          const key = n.toLowerCase();
          const other = seenNames.get(key);
          if (other !== undefined && other !== String(id)) errors.push(`The name "${n}" is used by both "${other}" and "${String(id)}", so the agent could not tell which one a parent means.`);
          else seenNames.set(key, String(id));
        }
      }
    }
    if (!isWhole(raw.monthlyFeeInr) || raw.monthlyFeeInr < 1 || raw.monthlyFeeInr > 1_000_000) errors.push(`${label} needs a monthly fee in whole rupees ("monthlyFeeInr"), for example 1500.`);
    if (typeof id === "string" && isWhole(raw.monthlyFeeInr) && raw.monthlyFeeInr >= 1 && raw.monthlyFeeInr <= 1_000_000) batches.push({ id, names, monthlyFeeInr: raw.monthlyFeeInr });
  });
  return batches;
}

function readStudents(v: unknown, batches: Batch[], languages: Language[], ownerNumber: string | undefined, errors: string[]): Student[] {
  if (!Array.isArray(v) || v.length === 0) { errors.push("Add the students (\"students\"), each with a name, the parent's WhatsApp number and the batch."); return []; }
  const students: Student[] = [];
  const seen = new Set<string>();
  v.forEach((raw, i) => {
    const label = isObj(raw) && typeof raw.name === "string" ? `Student "${raw.name}"` : `Student number ${i + 1}`;
    if (!isObj(raw)) { errors.push(`${label} must be an object with name, parent and batch.`); return; }
    unknownKeys(raw, ["name", "parent", "batch", "language"], label, errors);
    const studentName = typeof raw.name === "string" ? raw.name.trim() : "";
    if (studentName === "") errors.push(`${label} needs a name ("name").`);
    if (typeof raw.parent !== "string" || !PHONE.test(raw.parent)) errors.push(`${label} needs the parent's WhatsApp number ("parent"), starting with + and the country code, then digits only, for example +919800000000.`);
    else if (raw.parent === ownerNumber) errors.push(`${label}: the parent's number is the owner's. The owner's number is for the owner's replies, not for a parent.`);
    if (typeof raw.batch !== "string" || !batches.some((b) => b.id === raw.batch)) errors.push(`${label} needs a batch ("batch") that is one of the ids in "batches".`);
    if (raw.language !== undefined && (!LANGUAGES.includes(raw.language as Language) || !languages.includes(raw.language as Language))) errors.push(`${label}'s language ("language") must be one of the centre's languages: ${languages.map((l) => `"${l}"`).join(", ")}.`);
    if (studentName !== "" && typeof raw.parent === "string") {
      const key = `${raw.parent}|${studentName.toLowerCase()}`;
      if (seen.has(key)) errors.push(`${label} is listed twice for the same parent number.`);
      seen.add(key);
    }
    if (studentName !== "" && typeof raw.parent === "string" && PHONE.test(raw.parent) && typeof raw.batch === "string" && batches.some((b) => b.id === raw.batch)) {
      students.push({ name: studentName, parent: raw.parent, batchId: raw.batch, ...(raw.language ? { language: raw.language as Language } : {}) });
    }
  });
  return students;
}

function readDue(v: unknown, errors: string[]): Settings["due"] | undefined {
  if (!isObj(v)) { errors.push("Add when the fee is due (\"due\"): {\"day\": 5, \"graceDays\": 5}."); return undefined; }
  unknownKeys(v, ["day", "graceDays"], "the due rule", errors);
  const day = readWhole(v.day, "the due day (\"due.day\")", 1, 28, errors, "days after the 28th are not in every month");
  const graceDays = v.graceDays === undefined ? 0 : readWhole(v.graceDays, "the grace days (\"due.graceDays\")", 0, 30, errors);
  return day === undefined || graceDays === undefined ? undefined : { day, graceDays };
}

function readReminders(v: unknown, errors: string[]): Settings["reminders"] | undefined {
  if (v === undefined) return { daysFromDue: [-3, 0, 5], hour: 10, maxPerMonth: 3 };
  if (!isObj(v)) { errors.push("The reminders (\"reminders\") must look like {\"daysFromDue\": [-3, 0, 5], \"hour\": 10, \"maxPerMonth\": 3}."); return undefined; }
  unknownKeys(v, ["daysFromDue", "hour", "maxPerMonth"], "the reminders", errors);
  const list = v.daysFromDue ?? [-3, 0, 5];
  let daysFromDue: number[] | undefined;
  if (!Array.isArray(list) || list.length === 0 || !list.every((d) => isWhole(d) && d >= -14 && d <= 60)) {
    errors.push("Reminder days (\"reminders.daysFromDue\") must be a list of whole days from the due day, between -14 and 60, for example [-3, 0, 5]: three days before, on the day and five days after.");
  } else if (new Set(list).size !== list.length) {
    errors.push("A reminder day is listed twice in \"reminders.daysFromDue\".");
  } else daysFromDue = [...list].sort((a: number, b: number) => a - b);
  const hour = v.hour === undefined ? 10 : readWhole(v.hour, "the reminder hour (\"reminders.hour\")", 6, 21, errors);
  const maxPerMonth = v.maxPerMonth === undefined ? (daysFromDue?.length ?? 3) : readWhole(v.maxPerMonth, "the most reminders a month (\"reminders.maxPerMonth\")", 1, 12, errors);
  return daysFromDue === undefined || hour === undefined || maxPerMonth === undefined ? undefined : { daysFromDue, hour, maxPerMonth };
}

function readPartPayments(v: unknown, cheapest: number | undefined, errors: string[]): Settings["partPayments"] | undefined {
  const fallback = { allowed: true, minInr: Math.min(100, cheapest ?? 100) };
  if (v === undefined) return fallback;
  if (!isObj(v)) { errors.push("The part payments (\"partPayments\") must look like {\"allowed\": true, \"minInr\": 100}."); return undefined; }
  unknownKeys(v, ["allowed", "minInr"], "the part payments", errors);
  if (v.allowed !== undefined && typeof v.allowed !== "boolean") errors.push("\"partPayments.allowed\" must be true or false.");
  const minInr = v.minInr === undefined ? fallback.minInr : readWhole(v.minInr, "the least a part payment may be (\"partPayments.minInr\")", 1, cheapest ?? 1_000_000, errors, cheapest !== undefined ? `it is never more than the cheapest monthly fee (₹${cheapest})` : undefined);
  return minInr === undefined ? undefined : { allowed: v.allowed !== false, minInr };
}

function readLimit(v: unknown, key: "waiver" | "refund", label: string, max: number | undefined, where: string, errors: string[], required = false): { limitInr: number } | undefined {
  if (v === undefined && !required) return { limitInr: 0 };
  if (!isObj(v)) { errors.push(`Add the ${where} limit ("${key}"): {"limitInr": ${key === "waiver" ? 0 : 500}}.`); return undefined; }
  unknownKeys(v, ["limitInr"], `the ${where} limit`, errors);
  const limitInr = readWhole(v.limitInr, label, 0, max ?? 1_000_000, errors, max !== undefined ? `it is never more than the cheapest monthly fee (₹${max})` : undefined);
  return limitInr === undefined ? undefined : { limitInr };
}

/** The shared reader (B71): no block, or an empty one, is refused and asked for the UPI ID. Before B71 both were read as Razorpay. */
function readPayment(v: unknown, errors: string[]): Settings["payment"] | undefined {
  return readPaymentSettings(isObj(v) && Object.keys(v).length === 0 ? undefined : v, errors);
}

function readOwner(v: unknown, errors: string[]): Settings["owner"] | undefined {
  if (!isObj(v)) { errors.push("Add the owner (\"owner\") with their WhatsApp number, for example {\"whatsapp\": \"+919800000000\"}."); return undefined; }
  unknownKeys(v, ["whatsapp", "language"], "the owner", errors);
  const whatsapp = v.whatsapp;
  if (typeof whatsapp !== "string" || !PHONE.test(whatsapp)) errors.push("The owner's WhatsApp number (\"owner.whatsapp\") must start with + and the country code, then digits only, for example +919800000000.");
  const language = v.language ?? "en";
  const languageOk = LANGUAGES.includes(language as Language);
  if (!languageOk) errors.push(`The owner's language ("owner.language") must be one of ${languageList()}.`);
  return typeof whatsapp === "string" && PHONE.test(whatsapp) && languageOk ? { whatsapp, language: language as Language } : undefined;
}
