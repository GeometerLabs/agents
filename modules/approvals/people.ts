// Who may approve a refund Guard is holding, when it is more than the owner (B37, Guard's ADR-0061): the shop's other people, each with their own WhatsApp
// number and language, and the amount above which two different people must approve. The same for every template; a template's settings carry it as
// "approvers", and nothing changes for a shop without it (the owner alone, exactly as before).
//
//   "approvers": { "people": [{ "id": "ravi", "whatsapp": "+919800000002", "language": "hi" }], "twoAboveInr": 2000 }
//
// What each piece means, and where it goes:
//   - the owner is always one of the approvers. In Guard's directory a shop with other people names the owner `owner` (OWNER_APPROVER) and each person by
//     their own id; every one of them signs their own answers with their own secret (bundle/generate/guards.ts writes the roles, the bundle the secrets).
//   - up to `twoAboveInr` (or for every amount, without it) one approval is enough. The owner is asked, as before, unless the owner asked for the refund
//     themselves: then the others are asked instead, because the person who asked never approves it (the runtime names them in Geo-Requested-By).
//   - above `twoAboveInr`, two different people must approve, and any one of them saying no refuses it.
import { LANGUAGES } from "../language/languages.ts";
import type { Language } from "../language/languages.ts";

/** The owner's id in Guard's approver directory, in a shop that has other approvers. (A shop of the owner alone keeps the bundle's `owner-<shop>`.) */
export const OWNER_APPROVER = "owner";
/** At most this many people besides the owner. Guard allows 20 approvals per role; a WhatsApp ask per person is the cost that matters here. */
export const MAX_PEOPLE = 6;

export interface ApproverPerson { id: string; whatsapp: string; language: Language }
export interface ApproversSettings {
  /** Everyone besides the owner who may approve a held refund, each answering from their own number. */
  people: ApproverPerson[];
  /** Refunds above this many rupees need two different people. Left out: one person for every amount. */
  twoAboveInr?: number;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const digits = (s: string) => s.replace(/\D/gu, "");
/** An id Guard accepts and a person can read: lower-case letters, digits and hyphens, starting with a letter. Never "owner". */
const PERSON_ID = /^[a-z][a-z0-9-]{0,31}$/u;

/**
 * `approvers` from a template's settings, checked. `numbers` are the shop's own numbers no person may use (the owner's, the business's), and
 * `refundLimitInr` is the amount up to which the agent refunds alone: Guard holds anything above it, so `twoAboveInr` cannot be below it.
 * Every problem goes into `errors` in plain words; undefined when there is nothing (or something wrong).
 */
export function readApprovers(v: unknown, o: { ownerWhatsapp?: string; refundLimitInr?: number; where?: string }, errors: string[]): ApproversSettings | undefined {
  if (v === undefined) return undefined;
  const where = o.where ?? "approvers";
  const before = errors.length;
  if (!isObj(v)) { errors.push(`"${where}" must look like {"people": [{"id": "ravi", "whatsapp": "+919800000002", "language": "hi"}], "twoAboveInr": 2000}. Leave it out and the owner alone approves.`); return undefined; }
  for (const key of Object.keys(v)) if (key !== "people" && key !== "twoAboveInr") errors.push(`I don't know what "${key}" means in "${where}". Allowed: people, twoAboveInr.`);
  const list = v.people;
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_PEOPLE) {
    errors.push(`"${where}.people" must list 1 to ${MAX_PEOPLE} people besides the owner, each with an id, a WhatsApp number and a language.`);
    return undefined;
  }
  const people: ApproverPerson[] = [];
  const ids = new Set<string>();
  const numbers = new Set<string>(o.ownerWhatsapp ? [digits(o.ownerWhatsapp)] : []);
  list.forEach((p, i) => {
    const at = `${where}.people[${i}]`;
    if (!isObj(p)) { errors.push(`${at} must be {"id": "ravi", "whatsapp": "+919800000002", "language": "hi"}.`); return; }
    for (const key of Object.keys(p)) if (!["id", "whatsapp", "language"].includes(key)) errors.push(`I don't know what "${key}" means in ${at}. Allowed: id, whatsapp, language.`);
    const id = p.id;
    if (typeof id !== "string" || !PERSON_ID.test(id) || id === OWNER_APPROVER) errors.push(`${at}.id must be a short name in lower-case letters, digits and hyphens, starting with a letter (for example "ravi"), and not "${OWNER_APPROVER}".`);
    else if (ids.has(id)) errors.push(`${at}.id "${id}" is listed twice: each person has their own id.`);
    else ids.add(id);
    const whatsapp = p.whatsapp;
    if (typeof whatsapp !== "string" || !/^\+\d{10,15}$/u.test(whatsapp)) errors.push(`${at}.whatsapp must start with + and the country code, then digits only, for example +919800000002.`);
    else if (numbers.has(digits(whatsapp))) errors.push(`${at}.whatsapp is already the owner's or another person's number: each person answers from their own phone.`);
    else numbers.add(digits(whatsapp));
    const language = p.language ?? "en";
    if (!LANGUAGES.includes(language as Language)) errors.push(`${at}.language must be one of ${LANGUAGES.join(", ")}.`);
    if (typeof id === "string" && typeof whatsapp === "string" && LANGUAGES.includes(language as Language)) people.push({ id, whatsapp, language: language as Language });
  });
  let twoAboveInr: number | undefined;
  if (v.twoAboveInr !== undefined) {
    const n = v.twoAboveInr;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > 10_000_000) errors.push(`"${where}.twoAboveInr" must be a whole number of rupees: refunds above it need two different people.`);
    else if (o.refundLimitInr !== undefined && n < o.refundLimitInr) errors.push(`"${where}.twoAboveInr" (₹${n}) is below the refund limit (₹${o.refundLimitInr}). Up to the refund limit the agent refunds alone, so two people can only be asked above it: make it ₹${o.refundLimitInr} or more.`);
    else twoAboveInr = n;
  }
  if (errors.length > before) return undefined;
  return { people, ...(twoAboveInr !== undefined ? { twoAboveInr } : {}) };
}

/** The numbers whose code replies are the approvals relay's, never the agent's: the other approvers (the owner's own messages are the agent's commands too). */
export function approverNumbers(a: ApproversSettings | undefined): Set<string> {
  return new Set((a?.people ?? []).map((p) => digits(p.whatsapp)));
}

/** Who the runtime names in Geo-Requested-By when the owner asked for a refund: the owner, but only in a shop with other approvers (with the owner alone, nobody could approve it). */
export const ownerAsked = (a: ApproversSettings | undefined): string[] | undefined => (a ? [OWNER_APPROVER] : undefined);
