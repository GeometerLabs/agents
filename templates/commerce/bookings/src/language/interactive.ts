// WhatsApp reply buttons and list messages for Bookings: the words, the ids, the list of services and of free times, and how a tap becomes an Intent with no model.
// Meta's limits, the message type and the checks are shared (modules/language/interactive.ts). The ids are the ones this file makes:
//   yes, no            Yes / No buttons on a read-back
//   cancel             "Cancel booking": asks "are you sure" first (cancel_yes cancels, keep leaves it)
//   owner              "Talk to the owner": tells the owner, once an hour for the same customer
//   menu               back to the list of services
//   paid               "I have paid" (a UPI shop, B33): the owner is asked to look; nothing is marked paid
//   upi-received:<code>, upi-refunded:<code>, upi-kept:<code>   the owner's buttons for a UPI payment or refund (modules/payments/owner-marked/owner.ts)
//   svc:<service id>   a row of the list of services
//   slot:<epoch ms>    a row of the list of free times
// A forged or old id changes nothing the typed word would not: a slot is checked against the opening hours and the calendar like any typed time, and an id
// that names no service of the shop is read as ordinary text.
import type { Language } from "../../../../../modules/language/languages.ts";
import { COMMON_ID, COMMON_LABELS, LIMITS, clip } from "../../../../../modules/language/interactive.ts";
import type { Choice, CommonLabels, InteractiveMessage } from "../../../../../modules/language/interactive.ts";
import { formatDate, formatInr, formatTime } from "../../../../../modules/language/format.ts";
import { localParts } from "../../../../../modules/core/time.ts";
import { serviceName } from "../settings.ts";
import type { Service, Settings } from "../settings.ts";
import type { Intent } from "../adapters/model.ts";
import { ownerMarkChoices } from "../../../../../modules/payments/owner-marked/buttons.ts";

// ---- the words ------------------------------------------------------------------------------------------------------------------

export interface Labels extends CommonLabels {
  cancel: string; cancelYes: string; keep: string; pickService: string; pickTime: string;
  /** UPI shops (B33): the customer's "I have paid", and the owner's "Received", "Refund sent" and "Kept for booking". */
  paid: string; received: string; refundSent: string; keptForBooking: string;
}

/** Machine-written; the Malayalam and Kannada must be read by a native speaker before a real shop sees them (REVIEW-ml.md, REVIEW-kn.md). No number appears in any label. Yes, no and "talk to the owner" are the shared ones. */
export const LABELS: Record<Language, Labels> = {
  en: { ...COMMON_LABELS.en, cancel: "Cancel booking", cancelYes: "Yes, cancel", keep: "No, keep it", pickService: "Pick a service", pickTime: "Pick a time", paid: "I have paid", received: "Received", refundSent: "Refund sent", keptForBooking: "Kept for booking" },
  hi: { ...COMMON_LABELS.hi, cancel: "बुकिंग रद्द करें", cancelYes: "हाँ, रद्द करें", keep: "नहीं, रहने दें", pickService: "सेवा चुनें", pickTime: "समय चुनें", paid: "मैंने पैसे भेजे", received: "मिल गया", refundSent: "रिफंड भेज दिया", keptForBooking: "बुकिंग के लिए रखा" },
  ml: { ...COMMON_LABELS.ml, cancel: "ബുക്കിംഗ് റദ്ദാക്കൂ", cancelYes: "അതെ, റദ്ദാക്കൂ", keep: "ബുക്കിംഗ് നിലനിർത്തൂ", pickService: "സേവനം തിരഞ്ഞെടുക്കൂ", pickTime: "സമയം തിരഞ്ഞെടുക്കൂ", paid: "ഞാൻ പണമടച്ചു", received: "കിട്ടി", refundSent: "റീഫണ്ട് അയച്ചു", keptForBooking: "ബുക്കിംഗിനായി വെച്ചു" },
  kn: { ...COMMON_LABELS.kn, cancel: "ಬುಕಿಂಗ್ ರದ್ದು", cancelYes: "ಹೌದು, ರದ್ದು", keep: "ಹಾಗೇ ಇರಲಿ", pickService: "ಸೇವೆ ಆಯ್ಕೆಮಾಡಿ", pickTime: "ಸಮಯ ಆಯ್ಕೆಮಾಡಿ", paid: "ನಾನು ಪಾವತಿಸಿದ್ದೇನೆ", received: "ಬಂದಿದೆ", refundSent: "ರೀಫಂಡ್ ಕಳುಹಿಸಿದೆ", keptForBooking: "ಬುಕಿಂಗ್‌ಗೆ ಇಟ್ಟಿದೆ" },
};

// ---- the ids --------------------------------------------------------------------------------------------------------------------

export const ID = { ...COMMON_ID, cancel: "cancel", cancelYes: "cancel_yes", keep: "keep", menu: "menu", paid: "paid" } as const;
export type ButtonId = "yes" | "no" | "cancel" | "cancelYes" | "keep" | "owner" | "paid";

export const serviceRowId = (serviceId: string) => `svc:${serviceId}`;
export const slotRowId = (startMs: number) => `slot:${startMs}`;

/** The buttons named, in the language, in this order. */
export function buttonsFor(language: Language, ids: ButtonId[]): Choice[] {
  const labels = LABELS[language];
  const title: Record<ButtonId, string> = { yes: labels.yes, no: labels.no, cancel: labels.cancel, cancelYes: labels.cancelYes, keep: labels.keep, owner: labels.owner, paid: labels.paid };
  return ids.map((id) => ({ id: ID[id], title: clip(title[id], LIMITS.buttonTitle) }));
}

/** The owner's buttons for a UPI payment ("Received ₹200") or a refund ("Refund sent", and "Kept for booking" where that is offered). Each carries its one-use code. */
export function ownerMarkButtons(language: Language, a: { kind: "received"; code: string; amountInr: number } | { kind: "refund"; code: string; keepAllowed: boolean }): Choice[] {
  return ownerMarkChoices(LABELS[language], a);
}

/** The list of the shop's services, with the price on each row and, last, a row to reach the owner. At most 9 services fit beside it; a tenth is reached by typing its name. */
export function serviceList(settings: Settings, language: Language): NonNullable<InteractiveMessage["list"]> {
  const rows: Choice[] = settings.services.slice(0, LIMITS.rows - 1).map((s: Service) => ({ id: serviceRowId(s.id), title: clip(serviceName(s, language), LIMITS.rowTitle), description: formatInr(s.priceInr) }));
  rows.push({ id: ID.owner, title: clip(LABELS[language].owner, LIMITS.rowTitle) });
  return { button: clip(LABELS[language].pickService, LIMITS.listButton), rows };
}

/** The list of free times: the time as the row's title and the day as its description, and a last row to reach the owner. At most 9 times. */
export function slotList(slots: readonly number[], timeZone: string, language: Language): NonNullable<InteractiveMessage["list"]> {
  const rows: Choice[] = slots.slice(0, LIMITS.rows - 1).map((startMs) => {
    const p = localParts(startMs, timeZone);
    return { id: slotRowId(startMs), title: clip(formatTime(p, language), LIMITS.rowTitle), description: clip(formatDate(p, language), LIMITS.rowDescription) };
  });
  rows.push({ id: ID.owner, title: clip(LABELS[language].owner, LIMITS.rowTitle) });
  return { button: clip(LABELS[language].pickTime, LIMITS.listButton), rows };
}

// ---- a tap becomes an Intent ------------------------------------------------------------------------------------------------------

/** The Intent a button or list id stands for, or null when the id is none of ours (an old message, or a forged one): the title is then read as ordinary words. */
export function intentFromReply(id: string, settings: Settings): Intent | null {
  if (id === ID.yes) return { kind: "yes" };
  if (id === ID.no) return { kind: "no" };
  if (id === ID.cancel) return { kind: "cancel", ask: true };
  if (id === ID.cancelYes) return { kind: "cancel" };
  if (id === ID.keep) return { kind: "keep" };
  if (id === ID.owner) return { kind: "owner" };
  if (id === ID.menu) return { kind: "greeting" };
  if (id === ID.paid) return { kind: "paid" };
  const service = /^svc:([a-z0-9-]{1,60})$/u.exec(id);
  if (service) return settings.services.some((s) => s.id === service[1]) ? { kind: "book", serviceId: service[1] } : null;
  const slot = /^slot:(\d{1,15})$/u.exec(id);
  if (slot) {
    const startMs = Number(slot[1]);
    if (!Number.isSafeInteger(startMs)) return null;
    const p = localParts(startMs, settings.timezone);
    // the very minute, as a calendar date and a time with am/pm, so nothing is left to read back or to guess
    return { kind: "book", date: { kind: "calendar", day: p.day, month: p.month }, time: { hour: p.hour % 12 === 0 ? 12 : p.hour % 12, minute: p.minute, period: p.hour < 12 ? "am" : "pm" } };
  }
  return null;
}

