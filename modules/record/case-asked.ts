// A case asked about from another conversation (25 Nov 2026, refund-paths): someone writes from a number (or a page chat) that holds no case of the shop, and names a
// case's reference ("b-3", "B3", "booking 3", "f-3.2", a receipt's number "RCT/26-27/0007") or a payment id the shop's record holds (a gateway's "pay_..." or the UPI
// reference a customer typed). A family member who paid, or the customer on a new phone, is the usual reason; someone trying references is the other.
//
// What a template does with a match (each template's agent, the same in its Go twin): one plain reply, "this case cannot be shown to this number; the owner has been
// told and will reach you", with no fact of the case in it; the owner told once (a WhatsApp template, so it reaches them outside their window) at most once an hour per
// asking conversation and case; one record line, CASE_ASKED. Nothing of the case changes and no money moves. A reference the shop does not hold matches nothing here,
// so the template answers as it always did, and the owner hears nothing: guessing references gives nothing away.
//
// This file is the part every template shares: reading the references out of the words, the keys the record ties to a case, and the hourly limit read from the
// record (so a restart keeps it). The Go twin is go/internal/runtime/caseasked.go, held equal by go/internal/runtime/testdata/caseasked-vectors.json
// (go/scripts/gen_caseasked_vectors.ts).
//
// How the words are read, so that Go reads them the same (RE2 has no look-behind, so neither side uses one):
//  1. plain() (modules/language/format.ts: composed Unicode, Indian digits as 0-9), then ASCII letters made lower case (only ASCII: the keys are ASCII, and Go's and
//     JavaScript's full-Unicode lower-casing differ at the edges).
//  2. Cut into tokens at every character that is not a letter, a mark, a digit or one of - # . / _ ; each token loses the - # . / it starts or ends with.
//  3. In this order, the first that the shop holds wins: a receipt's number (RCT, BILL or CN, the year, the serial: modules/accounting/numbers.ts); a reference in
//     the short form (the template's letter, an optional - or #, the number, and an optional ".2" or ".b" part: "b-3", "B3", "f-3.2", "o-5.b"); a token that is one of
//     the record's keys (a payment id, a link's reference); and, only when the caller allows it (`words`), a word form ("booking 3", "order no 12", "बुकिंग 3").
//     The word form is left to the caller because "booking 3 pm" or "order 2 dosa" is a new customer's request, not a reference: a template allows it only when its
//     reading found nothing to do.
import { HOUR } from "../core/time.ts";
import { plain } from "../language/format.ts";
import type { RecordEntry } from "./record.ts";

/** The record line of one ask: the asking conversation, `booking` null (the case's own lines stay the case's customer's), `refs.case` the case, `refs.via` how it was named. */
export const CASE_ASKED = "case_asked_elsewhere";
/** The owner is told at most once in this time about the same asking conversation and case. */
export const CASE_ASKED_EVERY_MS = HOUR;

/** How a template's cases are named: the letter of its references ("b") and the words a customer puts before the number, in each language, lower case. */
export interface CaseForms { prefix: string; words: readonly string[] }
export type NamedVia = "receipt" | "reference" | "payment";
export interface Named { case: string; via: NamedVia }

/** Words that may stand between the case's word and its number ("booking no 3", "बुकिंग नंबर 3"). */
const FILLERS = new Set(["no", "number", "num", "nr", "ref", "id", "नंबर", "नम्बर", "संख्या", "നമ്പർ", "നം", "ಸಂಖ್ಯೆ", "ನಂಬರ್"]);
const TOKEN_CHAR = /[\p{L}\p{M}\p{N}\-#./_]/u;
const EDGE = /^[-#./]+|[-#./]+$/gu;
const RECEIPT = /^(rct|bill|cn)\/?(\d{2})-(\d{2})\/?(\d{1,6})$/u;
const SHORT = /^([a-z])[-#]?(\d{1,7})(?:\.(\d{1,4}|[a-z]))?$/u;
const DIGITS = /^\d{1,7}$/u;
/** A key shorter than this is never matched as a token: "b-3" style references have their own rule, and short ids would match ordinary words. */
const MIN_KEY = 6;

/** ASCII letters lower case, nothing else changed (see the file's head). */
const asciiLower = (s: string): string => s.replace(/[A-Z]/gu, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
/** A key as namedCase compares it: what a template adds to recordKeys (a UPI reference a customer typed) goes through this. */
export const caseKey = asciiLower;

/** The words as tokens (rules 1 and 2 above). */
export function tokensOf(text: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (const ch of asciiLower(plain(text))) {
    if (TOKEN_CHAR.test(ch)) { cur += ch; continue; }
    if (cur) out.push(cur);
    cur = "";
  }
  if (cur) out.push(cur);
  return out.map((t) => t.replace(EDGE, "")).filter((t) => t.length > 0);
}

/**
 * The keys the record ties to a case: each line's link reference (`refs.reference`, "f-3.2", "o-5.b"), document number (`refs.doc`, a receipt or a refund note) and
 * payment id (`refs.paymentId`, a gateway's "pay_..."), lower case, to the line's case. A line with no case gives nothing.
 */
export function recordKeys(entries: readonly RecordEntry[]): Map<string, string> {
  const keys = new Map<string, string>();
  for (const e of entries) {
    if (!e.booking) continue;
    for (const k of ["reference", "doc", "paymentId"]) {
      const v = e.refs[k];
      if (typeof v === "string" && v !== "") keys.set(asciiLower(v), e.booking);
    }
  }
  return keys;
}

/** The receipt's number in the form the record writes it ("RCT/26-27/0007"), from a token, or null. */
function receiptKey(token: string): string | null {
  const m = RECEIPT.exec(token);
  if (!m) return null;
  return `${m[1]}/${m[2]}-${m[3]}/${m[4].padStart(4, "0")}`;
}

/**
 * The case these words name, or null (rule 3 above). `isCase` says whether the shop holds a case by this id ("b-3"); `keys` are the record's keys (recordKeys) and
 * any the template adds (a UPI reference a customer typed), lower case. Only a case the shop holds is ever returned.
 */
export function namedCase(text: string, o: { forms: CaseForms; isCase: (id: string) => boolean; keys: ReadonlyMap<string, string>; words: boolean }): Named | null {
  const tokens = tokensOf(text);
  const prefix = asciiLower(o.forms.prefix);
  const caseOfKey = (key: string): string | undefined => { const c = o.keys.get(key); return c !== undefined && o.isCase(c) ? c : undefined; };
  for (const t of tokens) {
    const r = receiptKey(t);
    const c = r ? caseOfKey(r) : undefined;
    if (c) return { case: c, via: "receipt" };
  }
  for (const t of tokens) {
    const m = SHORT.exec(t);
    if (!m || m[1] !== prefix) continue;
    const base = `${prefix}-${Number(m[2])}`;
    const whole = m[3] !== undefined ? `${base}.${m[3]}` : base;
    const c = o.isCase(whole) ? whole : caseOfKey(whole) ?? (o.isCase(base) ? base : undefined);
    if (c) return { case: c, via: "reference" };
  }
  for (const t of tokens) {
    if (t.length < MIN_KEY) continue;
    const c = caseOfKey(t);
    if (c) return { case: c, via: "payment" };
  }
  if (!o.words) return null;
  const words = new Set(o.forms.words.map(asciiLower));
  for (let i = 0; i < tokens.length; i++) {
    if (!words.has(tokens[i])) continue;
    let j = i + 1;
    if (j < tokens.length && FILLERS.has(tokens[j])) j++;
    if (j >= tokens.length || !DIGITS.test(tokens[j])) continue;
    const id = `${prefix}-${Number(tokens[j])}`;
    if (o.isCase(id)) return { case: id, via: "reference" };
  }
  return null;
}

/** Was the owner told about this asking conversation and this case within the last CASE_ASKED_EVERY_MS? Read from the record, so a restart keeps it. */
export function toldLately(entries: readonly RecordEntry[], conversation: string, caseId: string, nowMs: number): boolean {
  return entries.some((e) => e.action === CASE_ASKED && e.outcome === "confirmed" && e.conversation === conversation && e.refs.case === caseId && nowMs - Date.parse(e.time) < CASE_ASKED_EVERY_MS);
}
