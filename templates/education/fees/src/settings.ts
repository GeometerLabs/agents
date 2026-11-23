// A centre's settings: everything a builder changes to tailor the Fees pathway. No code, only this file.
// Validation is written by hand and says what is wrong in plain words, so a builder can fix it without a manual.
import { readAssistantSettings } from "../../../../modules/assistant/settings.ts";
import type { AssistantSettings } from "../../../../modules/assistant/settings.ts";
import { LANGUAGES, LANGUAGE_NAMES } from "../../../../modules/language/languages.ts";
import type { Language } from "../../../../modules/language/languages.ts";
import { readApprovers } from "../../../../modules/approvals/people.ts";
import type { ApproversSettings } from "../../../../modules/approvals/people.ts";
import { isValidTimeZone } from "../../../../modules/core/time.ts";
import { BACK_DUES_MAX, JOINING_RULES, parseJoined } from "./joining.ts";
import type { BackDue, JoiningRule } from "./joining.ts";
import { readClasses } from "./classes/settings.ts";
import type { ClassesSettings } from "./classes/settings.ts";
import { readCreditBook } from "./credit/settings.ts";
import type { CreditBookSettings } from "./credit/settings.ts";
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
  /**
   * The day the student joined, "2026-11-18". Read only when the centre's rule for a part month is not "usual" (`joiningMidMonth`), so a centre that sets no rule is
   * not changed by it. Left out: nothing special.
   */
  joined?: string;
  /** Earlier months still unpaid when the agent started, entered by the owner: each is opened once as a fee of its own, carried and reminded (src/joining.ts). */
  backDues?: BackDue[];
  /** Classes only: the student is 18 or over, so the contact ("parent") is the student's own number and no parent's consent is asked. Left out: a child, with a parent. */
  adult?: boolean;
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
  /**
   * What a student who joins after the 1st owes for the joining month (src/joining.ts): "usual" (today's behaviour, the default), "full", "prorata" (the days left, as a
   * share of the month) or "nextMonth". Needs the student's `joined` date.
   */
  joiningMidMonth?: JoiningRule;
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
   * How parents pay (modules/payments/providers/index.ts): "upi", the centre's own UPI ID, marked paid by the owner; or a gateway's id (a provider folder with an API), the centre's own account.
   * Required (B71): a file without it is refused and asked for the UPI ID, never read as a gateway centre.
   */
  payment: PaymentSettings;
  owner: { whatsapp: string; language: Language };
  /** Others who may approve a refund Guard holds, and the amount above which two must (B37, modules/approvals/people.ts). Left out: the owner alone. */
  approvers?: ApproversSettings;
  /**
   * Classes (owner decision 50, src/classes/): the timetable, the class link's lead time and the material file limit. Left out: the centre is exactly the Fees centre it was,
   * and no code of src/classes/ runs for it.
   */
  classes?: ClassesSettings;
  /** Item 11e: the shop's assistant (the owner's conversation, the morning line, the character; modules/assistant/settings.ts). Left out: no assistant, as before. */
  assistant?: AssistantSettings;
  /**
   * The credit book (decision 63, src/credit/): the shop's *khata*, an adult variant of Fees. With it, `batches` and `students` are empty (a credit shop bills no month) and
   * `due` is not asked for. Left out: the centre is exactly the Fees centre it was, and nothing of src/credit/ runs for it.
   */
  creditBook?: CreditBookSettings;
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

  unknownKeys(input, ["name", "address", "timezone", "languages", "batches", "students", "due", "joiningMidMonth", "lateFeeInr", "reminders", "partPayments", "waiver", "refund", "payment", "owner", "approvers", "assistant", "classes", "creditBook"], "the settings", errors);
  // the credit book (src/credit/settings.ts): with it there are no batches, no students and no due day to ask for; what it refuses is said at the end, by its own reader
  const credit = input.creditBook !== undefined;

  const name = input.name;
  if (typeof name !== "string" || name.trim() === "") errors.push("Add the centre's name (\"name\").");
  const address = input.address;
  if (address !== undefined && typeof address !== "string") errors.push("The address (\"address\") must be text.");
  const timezone = input.timezone ?? "Asia/Kolkata";
  if (typeof timezone !== "string" || !isValidTimeZone(timezone)) errors.push(`The time zone ${JSON.stringify(timezone)} is not one I know. Use a name like "Asia/Kolkata".`);

  const languages = readLanguages(input.languages, errors);
  const batches = credit ? [] : readBatches(input.batches, languages, errors);
  const owner = readOwner(input.owner, errors);
  const students = credit ? [] : readStudents(input.students, batches, languages, owner?.whatsapp, errors);
  const joiningMidMonth = input.joiningMidMonth ?? "usual";
  if (!JOINING_RULES.includes(joiningMidMonth as JoiningRule)) errors.push(`The rule for a student who joins mid-month ("joiningMidMonth") must be one of ${JOINING_RULES.map((r) => `"${r}"`).join(", ")}.`);

  const cheapest = batches.length > 0 ? Math.min(...batches.map((b) => b.monthlyFeeInr)) : undefined;
  const due = credit && input.due === undefined ? { day: 1, graceDays: 0 } : readDue(input.due, errors);
  const lateFeeInr = input.lateFeeInr === undefined ? 0 : readWhole(input.lateFeeInr, "the late fee (\"lateFeeInr\")", 0, cheapest ?? 1_000_000, errors, cheapest !== undefined ? `a late fee is never more than the cheapest monthly fee (₹${cheapest})` : undefined);
  const reminders = readReminders(input.reminders, errors);
  const partPayments = readPartPayments(input.partPayments, cheapest, errors);
  const waiver = readLimit(input.waiver, "waiver", "the waiver limit (\"waiver.limitInr\")", cheapest, "waiver", errors);
  const refund = readLimit(input.refund, "refund", "the refund limit (\"refund.limitInr\")", undefined, "refund", errors, true);
  const payment = readPayment(input.payment, errors);
  const approvers = readApprovers(input.approvers, { ownerWhatsapp: owner?.whatsapp, refundLimitInr: refund?.limitInr }, errors);
  if (approvers) for (const p of approvers.people) if (students.some((s) => s.parent === p.whatsapp)) errors.push(`approvers: ${p.id}'s number is a parent's. A person who approves refunds answers from their own number, not a parent's.`);

  const assistant = readAssistantSettings(input.assistant, errors);
  const classes = credit ? undefined : readClasses(input.classes, batches, errors);
  const creditBook = readCreditBook(input.creditBook, { languages, ownerWhatsapp: owner?.whatsapp, input }, errors);
  if (errors.length > 0) return { ok: false, errors };
  const settings: Settings = {
    name: (name as string).trim(), timezone: timezone as string, languages, batches, students,
    due: due as Settings["due"], lateFeeInr: lateFeeInr as number, reminders: reminders as Settings["reminders"],
    partPayments: partPayments as Settings["partPayments"], waiver: waiver as Settings["waiver"], refund: refund as Settings["refund"],
    payment: payment as Settings["payment"], owner: owner as Settings["owner"],
  };
  if (joiningMidMonth !== "usual") settings.joiningMidMonth = joiningMidMonth as JoiningRule; // left out when "usual": a centre that sets nothing keeps its settings as they were
  if (typeof address === "string") settings.address = address;
  if (approvers) settings.approvers = approvers;
  if (assistant) settings.assistant = assistant;
  if (classes) settings.classes = classes;
  if (creditBook) settings.creditBook = creditBook;
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

/** The most any one payment link can be for, in rupees: the dearest batch's fee with the late fee on top; in a credit book, the most one account may show. */
export const highestDueInr = (settings: Settings): number => settings.creditBook ? settings.creditBook.maxPerPersonInr : Math.max(...settings.batches.map((b) => b.monthlyFeeInr)) + settings.lateFeeInr;

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
    unknownKeys(raw, ["name", "parent", "batch", "language", "joined", "backDues", "adult"], label, errors);
    const studentName = typeof raw.name === "string" ? raw.name.trim() : "";
    if (studentName === "") errors.push(`${label} needs a name ("name").`);
    if (typeof raw.parent !== "string" || !PHONE.test(raw.parent)) errors.push(`${label} needs the parent's WhatsApp number ("parent"), starting with + and the country code, then digits only, for example +919800000000.`);
    else if (raw.parent === ownerNumber) errors.push(`${label}: the parent's number is the owner's. The owner's number is for the owner's replies, not for a parent.`);
    if (typeof raw.batch !== "string" || !batches.some((b) => b.id === raw.batch)) errors.push(`${label} needs a batch ("batch") that is one of the ids in "batches".`);
    if (raw.language !== undefined && (!LANGUAGES.includes(raw.language as Language) || !languages.includes(raw.language as Language))) errors.push(`${label}'s language ("language") must be one of the centre's languages: ${languages.map((l) => `"${l}"`).join(", ")}.`);
    if (raw.joined !== undefined && (typeof raw.joined !== "string" || parseJoined(raw.joined) === undefined)) errors.push(`${label}'s joining day ("joined") must be a real date written like 2026-11-18.`);
    const backDues = readBackDues(raw.backDues, label, batches.find((b) => b.id === raw.batch), errors);
    if (raw.adult !== undefined && typeof raw.adult !== "boolean") errors.push(`${label}'s "adult" must be true or false.`);
    if (studentName !== "" && typeof raw.parent === "string") {
      const key = `${raw.parent}|${studentName.toLowerCase()}`;
      if (seen.has(key)) errors.push(`${label} is listed twice for the same parent number.`);
      seen.add(key);
    }
    if (studentName !== "" && typeof raw.parent === "string" && PHONE.test(raw.parent) && typeof raw.batch === "string" && batches.some((b) => b.id === raw.batch)) {
      students.push({ name: studentName, parent: raw.parent, batchId: raw.batch, ...(raw.language ? { language: raw.language as Language } : {}), ...(typeof raw.joined === "string" ? { joined: raw.joined } : {}), ...(backDues.length > 0 ? { backDues } : {}), ...(raw.adult === true ? { adult: true } : {}) });
    }
  });
  return students;
}

/** A student's earlier unpaid months: "2026-09" and a whole-rupee amount each, never more than the dearest batch's fee (a payment link is bounded by it, see highestDueInr). */
function readBackDues(v: unknown, label: string, batch: Batch | undefined, errors: string[]): BackDue[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > BACK_DUES_MAX) { errors.push(`${label}'s earlier unpaid months ("backDues") must be a list of at most ${BACK_DUES_MAX}, each like {"month": "2026-09", "amountInr": 1500}.`); return []; }
  const out: BackDue[] = [];
  for (const item of v) {
    const ok = isObj(item) && typeof item.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/u.test(item.month) && isWhole(item.amountInr) && item.amountInr >= 1 && item.amountInr <= (batch?.monthlyFeeInr ?? 1_000_000);
    if (!ok) { errors.push(`${label} has an earlier unpaid month ("backDues") that is not like {"month": "2026-09", "amountInr": 1500} (the amount is whole rupees, at most the batch's monthly fee).`); continue; }
    const entry = item as { month: string; amountInr: number };
    if (out.some((x) => x.month === entry.month)) errors.push(`${label} lists the earlier month ${entry.month} twice in "backDues".`);
    else out.push({ month: entry.month, amountInr: entry.amountInr });
  }
  return out;
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

/** The shared reader (B71): no block, or an empty one, is refused and asked for the UPI ID. Before B71 both were read as the gateway. */
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
