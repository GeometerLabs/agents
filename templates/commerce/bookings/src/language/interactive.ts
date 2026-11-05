// WhatsApp reply buttons and list messages for Bookings: the words, the ids, the list of services and of free times, and how a tap becomes an Intent with no model.
// Meta's limits, the message type and the checks are shared (modules/language/interactive.ts). The ids are the ones this file makes:
//   yes, no            Yes / No buttons on a read-back
//   cancel             "Cancel booking": asks "are you sure" first (cancel_yes cancels, keep leaves it)
//   owner              "Talk to the owner": tells the owner, once an hour for the same customer
//   menu               back to the list of services
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

// ---- the words ------------------------------------------------------------------------------------------------------------------

export interface Labels extends CommonLabels {
  cancel: string; cancelYes: string; keep: string; pickService: string; pickTime: string;
}

/** Machine-written; the Malayalam and Kannada must be read by a native speaker before a real shop sees them (REVIEW-ml.md, REVIEW-kn.md). No number appears in any label. Yes, no and "talk to the owner" are the shared ones. */
export const LABELS: Record<Language, Labels> = {
  en: { ...COMMON_LABELS.en, cancel: "Cancel booking", cancelYes: "Yes, cancel", keep: "No, keep it", pickService: "Pick a service", pickTime: "Pick a time" },
  hi: { ...COMMON_LABELS.hi, cancel: "बुकिंग रद्द करें", cancelYes: "हाँ, रद्द करें", keep: "नहीं, रहने दें", pickService: "सेवा चुनें", pickTime: "समय चुनें" },
  ml: { ...COMMON_LABELS.ml, cancel: "ബുക്കിംഗ് റദ്ദാക്കൂ", cancelYes: "അതെ, റദ്ദാക്കൂ", keep: "ബുക്കിംഗ് നിലനിർത്തൂ", pickService: "സേവനം തിരഞ്ഞെടുക്കൂ", pickTime: "സമയം തിരഞ്ഞെടുക്കൂ" },
  kn: { ...COMMON_LABELS.kn, cancel: "ಬುಕಿಂಗ್ ರದ್ದು", cancelYes: "ಹೌದು, ರದ್ದು", keep: "ಹಾಗೇ ಇರಲಿ", pickService: "ಸೇವೆ ಆಯ್ಕೆಮಾಡಿ", pickTime: "ಸಮಯ ಆಯ್ಕೆಮಾಡಿ" },
};

// ---- the ids --------------------------------------------------------------------------------------------------------------------

export const ID = { ...COMMON_ID, cancel: "cancel", cancelYes: "cancel_yes", keep: "keep", menu: "menu" } as const;
export type ButtonId = "yes" | "no" | "cancel" | "cancelYes" | "keep" | "owner";

export const serviceRowId = (serviceId: string) => `svc:${serviceId}`;
export const slotRowId = (startMs: number) => `slot:${startMs}`;

/** The buttons named, in the language, in this order. */
export function buttonsFor(language: Language, ids: ButtonId[]): Choice[] {
  const labels = LABELS[language];
  const title: Record<ButtonId, string> = { yes: labels.yes, no: labels.no, cancel: labels.cancel, cancelYes: labels.cancelYes, keep: labels.keep, owner: labels.owner };
  return ids.map((id) => ({ id: ID[id], title: clip(title[id], LIMITS.buttonTitle) }));
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

