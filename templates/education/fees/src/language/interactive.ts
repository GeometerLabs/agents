// WhatsApp reply buttons for Fees: the words, the ids, and how a tap becomes an Intent with no model.
// Meta's limits, the message type and the checks are shared (modules/language/interactive.ts). The ids are the ones this file makes:
//   pay:<fee>    "Pay now": send the payment link for this fee again
//   paid:<fee>   "I have paid": look at the payment record, and say what it shows
//   owner        "Talk to the owner": tells the owner, once an hour for the same parent
//   yes, no      the shared Yes / No
// <fee> is the fee's reference ("f-3"), so a parent with two children is not asked "which one?". A forged or old id changes nothing the typed word would
// not: the agent looks the fee up among the parent's own, and an id that names none of them is read as ordinary text.
import type { Language } from "../../../../../modules/language/languages.ts";
import { COMMON_ID, COMMON_LABELS, LIMITS, clip } from "../../../../../modules/language/interactive.ts";
import type { Choice, CommonLabels } from "../../../../../modules/language/interactive.ts";
import type { Intent } from "../adapters/model.ts";

export interface Labels extends CommonLabels { pay: string; paid: string }

/** Machine-written; the Malayalam and Kannada must be read by a native speaker before a real centre sees them (REVIEW-ml.md, REVIEW-kn.md). No number appears in any label. */
export const LABELS: Record<Language, Labels> = {
  en: { ...COMMON_LABELS.en, pay: "Pay now", paid: "I have paid" },
  hi: { ...COMMON_LABELS.hi, pay: "अभी भुगतान करें", paid: "मैंने भर दिया" },
  ml: { ...COMMON_LABELS.ml, pay: "ഇപ്പോൾ അടയ്ക്കാം", paid: "അടച്ചുകഴിഞ്ഞു" },
  kn: { ...COMMON_LABELS.kn, pay: "ಈಗ ಪಾವತಿಸಿ", paid: "ಪಾವತಿಸಿದ್ದೇನೆ" },
};

export const ID = { ...COMMON_ID, pay: "pay", paid: "paid" } as const;
export type ButtonId = "yes" | "no" | "owner" | "pay" | "paid";

export const payRowId = (dueId: string) => `pay:${dueId}`;
export const paidRowId = (dueId: string) => `paid:${dueId}`;

/** The buttons named, in the language, in this order. `dueId` is the fee the pay and paid buttons are about. */
export function buttonsFor(language: Language, ids: ButtonId[], dueId?: string): Choice[] {
  const labels = LABELS[language];
  const make = (id: ButtonId): Choice => {
    if (id === "pay") return { id: dueId ? payRowId(dueId) : ID.pay, title: clip(labels.pay, LIMITS.buttonTitle) };
    if (id === "paid") return { id: dueId ? paidRowId(dueId) : ID.paid, title: clip(labels.paid, LIMITS.buttonTitle) };
    return { id: ID[id], title: clip(labels[id], LIMITS.buttonTitle) };
  };
  return ids.map(make);
}

/** The Intent a button id stands for, or null when the id is none of ours (an old message, or a forged one): the title is then read as ordinary words. */
export function intentFromReply(id: string): Intent | null {
  if (id === ID.yes) return { kind: "yes" };
  if (id === ID.no) return { kind: "no" };
  if (id === ID.owner) return { kind: "owner" };
  const tied = /^(pay|paid):(f-\d{1,9})$/u.exec(id);
  if (tied) return { kind: tied[1] as "pay" | "paid", dueId: tied[2] };
  if (id === ID.pay) return { kind: "pay" };
  if (id === ID.paid) return { kind: "paid" };
  return null;
}
