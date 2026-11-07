// A UPI payment request: the shop's own UPI ID, its name, the exact amount and the reference, as a `upi://pay` link. For every template.
//
// Geometer never onboards a shop onto a payment provider and never holds shop or customer money. With UPI the customer pays the shop's own UPI ID from
// their own UPI app; nothing here can see that payment. What this file makes is the request the customer's app opens, pre-filled.
//
// The rules followed (NPCI, "UPI Linking Specifications", version 1.6, November 2017, section 1.2 and the notes after 1.4):
//  - the link is `upi://pay?` and then `name=value` pairs joined by `&`;
//  - `pa` (the payee's UPI ID) and `pn` (the payee's name) are mandatory; `am` (the amount, "in decimal format") is mandatory for a request with an amount,
//    and with no `mam` the payer's app does not let the amount be changed; `cu` is the currency, and "INR" is the only value; `tn` is a short note;
//  - a space is written `%20` (never `+`), as RFC 3986 section 2.1 percent-encoding, and so is every other character a value cannot carry as it is.
// What is left out on purpose, and why (Explanation.md, "UPI"):
//  - `tr` (a transaction reference) is "mandatory for merchant transactions". A partner shop's UPI ID is often a personal one, and payment apps may refuse or
//    flag a merchant-style request to a personal UPI ID, so the reference travels in `tn` instead. A shop with a business UPI ID can be given `tr` later;
//  - `mc`, `mode`, `orgid` and `sign` belong to a merchant's signed request, which needs a merchant account with a bank. Without `sign` the payer's app may
//    say that the source of the request could not be verified; that is expected for a request like this, and it is why "paid" is the owner's word, not ours.
// The link never carries the owner's one-use code: it is the customer's, and the code is the owner's.

/** What a UPI ID looks like: a name, `@`, the handle of the payment app or bank. 2 to 256 characters before the `@` (letters, digits, `.`, `-`, `_`), 2 to 64 after (a letter, then letters or digits). */
const VPA_RE = /^[a-z0-9._-]{2,256}@[a-z][a-z0-9]{1,64}$/u;

/** The payee name is printed by the payer's app: keep it short, and on one line. */
export const PAYEE_NAME_MAX = 50;
/** A note longer than this is cut by many apps. */
export const NOTE_MAX = 50;
/** The largest amount one request may be for, in rupees: far above any deposit or fee these templates take, so a slip of the keyboard is caught. */
export const MAX_AMOUNT_INR = 100_000;

/** The UPI ID as it is kept and shown: trimmed and in lower case (UPI IDs are not case-sensitive). */
export const normaliseVpa = (vpa: string): string => vpa.trim().toLowerCase();

/** What is wrong with this UPI ID, in plain words, or null. */
export function vpaProblem(vpa: unknown): string | null {
  if (typeof vpa !== "string" || vpa.trim() === "") return "Add the shop's UPI ID, for example glowsalon@okicici.";
  const v = normaliseVpa(vpa);
  if (!v.includes("@")) return `"${vpa.trim()}" is not a UPI ID: it needs an @ and the app's or bank's name after it, for example glowsalon@okicici.`;
  if (!VPA_RE.test(v)) return `"${vpa.trim()}" is not a UPI ID. Before the @: letters, digits, dots, dashes or underscores (at least 2). After the @: the app's or bank's name, letters and digits, starting with a letter.`;
  return null;
}

/** What is wrong with this payee name, in plain words, or null. */
export function payeeProblem(name: unknown): string | null {
  if (typeof name !== "string" || name.trim() === "") return "Add the name the customer should see in their UPI app (the payee name), for example Glow Salon.";
  if (/[\p{Cc}\n\r\t]/u.test(name)) return "The payee name must be on one line.";
  if ([...name.trim()].length > PAYEE_NAME_MAX) return `The payee name is longer than ${PAYEE_NAME_MAX} characters. Use the short name the shop's UPI app shows.`;
  return null;
}

/** "200.00": the amount as `am` carries it, in rupees with two decimals. */
export function amountText(amountPaise: number): string {
  if (!Number.isInteger(amountPaise) || amountPaise <= 0) throw new Error("A UPI request is for a whole number of paise above zero.");
  return `${Math.floor(amountPaise / 100)}.${String(amountPaise % 100).padStart(2, "0")}`;
}

/** RFC 3986 percent-encoding of a value: a space is %20. `@` is left as it is in `pa`, as NPCI's own examples write it. */
const encode = (value: string, keep = ""): string => {
  let out = encodeURIComponent(value).replace(/[!'()*]/gu, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  for (const c of keep) out = out.replaceAll(encodeURIComponent(c), c);
  return out;
};

export interface UpiRequestFields {
  /** The shop's UPI ID. */
  vpa: string;
  /** The name the customer's app shows. */
  payee: string;
  /** The exact amount, in paise. */
  amountPaise: number;
  /** A short note: the booking or fee reference ("Glow Salon b-3"). Never the owner's code. */
  note: string;
}

/** The `upi://pay` link for one request. Throws, in plain words, if a field is not one a UPI app would take. */
export function upiPayLink(r: UpiRequestFields): string {
  const vpaIssue = vpaProblem(r.vpa);
  if (vpaIssue) throw new Error(vpaIssue);
  const payeeIssue = payeeProblem(r.payee);
  if (payeeIssue) throw new Error(payeeIssue);
  if (r.amountPaise > MAX_AMOUNT_INR * 100) throw new Error(`A UPI request here is for at most ₹${MAX_AMOUNT_INR}.`);
  const note = [...r.note.replace(/\s+/gu, " ").trim()].slice(0, NOTE_MAX).join("");
  const pairs: [string, string][] = [["pa", encode(normaliseVpa(r.vpa), "@")], ["pn", encode(r.payee.trim())], ["am", amountText(r.amountPaise)], ["cu", "INR"]];
  if (note !== "") pairs.splice(3, 0, ["tn", encode(note)]);
  return `upi://pay?${pairs.map(([k, v]) => `${k}=${v}`).join("&")}`;
}

/** Read a `upi://pay` link back into its fields (decoded). For the tests, and for anything that must check a link it is shown. */
export function readUpiLink(link: string): Record<string, string> | null {
  const m = /^upi:\/\/pay\?(.*)$/u.exec(link);
  if (!m) return null;
  const out: Record<string, string> = {};
  for (const pair of m[1].split("&")) {
    const i = pair.indexOf("=");
    if (i <= 0) return null;
    out[pair.slice(0, i)] = decodeURIComponent(pair.slice(i + 1));
  }
  return out;
}
