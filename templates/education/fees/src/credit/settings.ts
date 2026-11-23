// The credit book, the adult variant of the Fees package (decision 63, the shop starter's first job): the `creditBook` block of a shop's settings, and its reader.
//
// Why a block of Fees and not a template of its own: the credit book is the shop's *khata* (who owes what), and Fees already has everything it needs: reminders that stop
// when a payment is recorded, the owner-marked UPI payment and the gateway's payment record, the owner's cash mark, the books and the monthly report. What changes is
// WHO owes (an adult customer about their own account, added by the owner in words, not a student's monthly fee) and WHEN reminders go (only after the customer said yes).
// A shop without the block is exactly the Fees centre it was: nothing of the credit book runs for it, and its settings tree is unchanged.
//
// The block holds what an Operator sets in one sitting with the owner: the most one account may show, how often a reminder may go, and who owes what today. People the owner
// adds later ("Ramesh owes 2,400" on WhatsApp or the owner's page) are conversation state (the store's `credit` member), not settings, because the owner says them.
//
//   "creditBook": {
//     "maxPerPersonInr": 50000,   the most one person's account may show, and so the most a payment link is ever for (Guard's bound); NOT a credit ceiling (E4, not approved)
//     "remindEveryDays": 7,       a reminder at most this often (1 to 60; default 7), at the shop's reminder hour, never more than reminders.maxPerMonth in a month
//     "people": [ { "name": "Ramesh", "phone": "+919845012345", "amountInr": 2400, "language": "hi" } ]   who owes what on the day the shop starts (at most 300)
//   }
//
// With the block, the settings have no batches and no students (a credit shop bills no month), no late fee, no rule for joining mid-month and no Classes, and the waiver
// limit is 0: every discount a customer asks about goes to the owner. Each refusal is said in plain words, as the rest of the settings are.
import { LANGUAGES } from "../../../../../modules/language/languages.ts";
import type { Language } from "../../../../../modules/language/languages.ts";

/** One person's opening balance: entered once, at setup, and opened as their account's first entry the first time the agent runs. */
export interface CreditPerson { name: string; phone: string; amountInr: number; language?: Language }

export interface CreditBookSettings {
  maxPerPersonInr: number;
  remindEveryDays: number;
  people: CreditPerson[];
}

export const CREDIT_DEFAULT_MAX_INR = 50_000;
export const CREDIT_DEFAULT_EVERY_DAYS = 7;
export const CREDIT_PEOPLE_MAX = 300;
/** The batch id a credit account's entry carries in the store (due.ts `batchId`): never a real batch, since a credit shop has none. */
export const CREDIT_BATCH = "credit";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isWhole = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const PHONE = /^\+\d{10,15}$/;

/** What the rest of the settings said, for the checks that need it. */
export interface CreditContext { languages: Language[]; ownerWhatsapp?: string; input: Obj }

/** Read the block (undefined: the shop has no credit book). Problems are pushed in plain words; the value returned is best effort. */
export function readCreditBook(v: unknown, ctx: CreditContext, errors: string[]): CreditBookSettings | undefined {
  if (v === undefined) return undefined;
  if (!isObj(v)) { errors.push("The credit book (\"creditBook\") must look like {\"maxPerPersonInr\": 50000, \"remindEveryDays\": 7, \"people\": []}."); return undefined; }
  for (const key of Object.keys(v)) if (!["maxPerPersonInr", "remindEveryDays", "people"].includes(key)) errors.push(`I don't know what "${key}" means in the credit book. Allowed: maxPerPersonInr, remindEveryDays, people.`);
  const most = v.maxPerPersonInr === undefined ? CREDIT_DEFAULT_MAX_INR : v.maxPerPersonInr;
  const mostOk = isWhole(most) && most >= 1 && most <= 1_000_000;
  if (!mostOk) errors.push("The most one person's account may show (\"creditBook.maxPerPersonInr\") must be whole rupees from 1 to 1000000.");
  const every = v.remindEveryDays === undefined ? CREDIT_DEFAULT_EVERY_DAYS : v.remindEveryDays;
  if (!isWhole(every) || every < 1 || every > 60) errors.push("How often a reminder may go (\"creditBook.remindEveryDays\") must be a whole number of days from 1 to 60.");
  const people: CreditPerson[] = [];
  const list = v.people === undefined ? [] : v.people;
  if (!Array.isArray(list) || list.length > CREDIT_PEOPLE_MAX) errors.push(`Who owes what today ("creditBook.people") must be a list of at most ${CREDIT_PEOPLE_MAX}, each like {"name": "Ramesh", "phone": "+919800000000", "amountInr": 2400}.`);
  else {
    const names = new Set<string>();
    const phones = new Set<string>();
    list.forEach((raw, i) => {
      const label = isObj(raw) && typeof raw.name === "string" && raw.name.trim() !== "" ? `Person "${raw.name.trim()}"` : `Person number ${i + 1}`;
      if (!isObj(raw)) { errors.push(`${label} in the credit book must look like {"name": "Ramesh", "phone": "+919800000000", "amountInr": 2400}.`); return; }
      for (const key of Object.keys(raw)) if (!["name", "phone", "amountInr", "language"].includes(key)) errors.push(`I don't know what "${key}" means in ${label}. Allowed: name, phone, amountInr, language.`);
      const name = typeof raw.name === "string" ? raw.name.trim().replace(/\s+/gu, " ") : "";
      if (name === "" || name.length > 40 || /[\p{Cc}\d+]/u.test(name)) errors.push(`${label} needs a name ("name") of at most 40 letters, with no digits.`);
      const phone = raw.phone;
      const phoneOk = typeof phone === "string" && PHONE.test(phone);
      if (!phoneOk) errors.push(`${label} needs their WhatsApp number ("phone"), starting with + and the country code, then digits only, for example +919800000000.`);
      else if (phone === ctx.ownerWhatsapp) errors.push(`${label}: the number is the owner's. The owner's number is for the owner's replies, not for a customer.`);
      const amountOk = isWhole(raw.amountInr) && raw.amountInr >= 1 && (!mostOk || raw.amountInr <= (most as number));
      if (!amountOk) errors.push(`${label} needs what they owe today ("amountInr") in whole rupees, from 1 to the most one account may show.`);
      const language = raw.language;
      if (language !== undefined && (!LANGUAGES.includes(language as Language) || !ctx.languages.includes(language as Language))) errors.push(`${label}'s language ("language") must be one of the shop's languages: ${ctx.languages.map((l) => `"${l}"`).join(", ")}.`);
      if (name !== "" && names.has(name.toLowerCase())) errors.push(`${label} is in the credit book twice. Give each person a name the owner can tell apart, like "Ramesh K".`);
      if (phoneOk && phones.has(phone as string)) errors.push(`${label}'s number is another person's in the credit book. One number is one account.`);
      if (name !== "") names.add(name.toLowerCase());
      if (phoneOk) phones.add(phone as string);
      if (name !== "" && name.length <= 40 && !/[\p{Cc}\d+]/u.test(name) && phoneOk && amountOk) people.push({ name, phone: phone as string, amountInr: raw.amountInr as number, ...(typeof language === "string" && ctx.languages.includes(language as Language) ? { language: language as Language } : {}) });
    });
  }
  // what a credit shop does not have: each said once, in the settings' own words
  const input = ctx.input;
  if (input.batches !== undefined || input.students !== undefined) errors.push("A credit book (\"creditBook\") has no batches or students: leave \"batches\" and \"students\" out. Who owes what goes in \"creditBook.people\".");
  if (input.lateFeeInr !== undefined && input.lateFeeInr !== 0) errors.push("A credit book adds no late fee: leave \"lateFeeInr\" out.");
  if (input.joiningMidMonth !== undefined) errors.push("A credit book has no rule for joining mid-month: leave \"joiningMidMonth\" out.");
  if (input.classes !== undefined) errors.push("A credit book has no classes: leave \"classes\" out.");
  if (isObj(input.waiver) && input.waiver.limitInr !== 0) errors.push("In a credit book every discount a customer asks about goes to the owner: set the waiver limit (\"waiver.limitInr\") to 0, or leave \"waiver\" out.");
  return { maxPerPersonInr: mostOk ? (most as number) : CREDIT_DEFAULT_MAX_INR, remindEveryDays: isWhole(every) ? every : CREDIT_DEFAULT_EVERY_DAYS, people };
}
