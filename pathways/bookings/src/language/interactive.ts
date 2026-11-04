// WhatsApp reply buttons and list messages: what the agent can offer, in four languages, and how a tap becomes an Intent with no model.
//
// A button or list row has a fixed id. When the customer taps it, WhatsApp sends that id back (webhooks.ts keeps it), and `intentFromReply` turns it into
// an Intent by looking it up: no words are read, so no model is asked and nothing is guessed. The ids are the ones this file makes:
//   yes, no            Yes / No buttons on a read-back
//   cancel             "Cancel booking": asks "are you sure" first (cancel_yes cancels, keep leaves it)
//   owner              "Talk to the owner": tells the owner, once an hour for the same customer
//   menu               back to the list of services
//   svc:<service id>   a row of the list of services
//   slot:<epoch ms>    a row of the list of free times
// A forged or old id changes nothing the typed word would not: a slot is checked against the opening hours and the calendar like any typed time, and an id
// that names no service of the shop is read as ordinary text.
//
// The limits are Meta's (Cloud API, interactive messages, read 5 Nov 2026): 3 reply buttons, each title up to 20 characters; a list of up to 10 rows, each
// title up to 24 characters and each description up to 72, and a list button up to 20; a body up to 1024; an id up to 256 (200 for a row). Button and list
// labels are machine-written like the other Malayalam and Kannada, and are on the review sheets.
import { serviceName } from "../settings.ts";
import type { Language, Service, Settings } from "../settings.ts";
import { localParts } from "../time.ts";
import type { Intent } from "../adapters/model.ts";
import { formatDate, formatInr, formatTime } from "./format.ts";

export const LIMITS = { buttons: 3, buttonTitle: 20, rows: 10, rowTitle: 24, rowDescription: 72, listButton: 20, body: 1024, id: 200 } as const;

export interface Choice { id: string; title: string; description?: string }

/** What goes out: the body WhatsApp shows, and either up to 3 buttons or one list. */
export interface InteractiveMessage {
  body: string;
  buttons?: Choice[];
  list?: { button: string; rows: Choice[] };
}

/** The whole message as plain text: the body, then each option on its own line. This is what the outgoing check reads and what the outbox keeps. */
export function interactiveText(m: InteractiveMessage): string {
  const rows = m.list?.rows ?? [];
  return [m.body, ...rows.map((r) => (r.description ? `${r.title}: ${r.description}` : r.title))].join("\n");
}

/** The first thing wrong with a message against Meta's limits, in plain words, or null. */
export function interactiveProblem(m: InteractiveMessage): string | null {
  const length = (s: string) => [...s].length; // characters, not UTF-16 units: Malayalam and Kannada letters are one each
  if (m.body.trim() === "" || length(m.body) > LIMITS.body) return `the body must be 1 to ${LIMITS.body} characters`;
  if ((m.buttons ? 1 : 0) + (m.list ? 1 : 0) !== 1) return "give either buttons or a list";
  const ids = new Set<string>();
  const check = (c: Choice, titleMax: number, descMax: number): string | null => {
    if (c.id === "" || length(c.id) > LIMITS.id) return `an id must be 1 to ${LIMITS.id} characters`;
    if (ids.has(c.id)) return `the id ${c.id} is used twice`;
    ids.add(c.id);
    if (c.title.trim() === "" || length(c.title) > titleMax) return `the title "${c.title}" must be 1 to ${titleMax} characters`;
    if (c.description !== undefined && (c.description === "" || length(c.description) > descMax)) return `the description of "${c.title}" must be 1 to ${descMax} characters`;
    return null;
  };
  if (m.buttons) {
    if (m.buttons.length < 1 || m.buttons.length > LIMITS.buttons) return `a message has 1 to ${LIMITS.buttons} buttons`;
    for (const b of m.buttons) { if (b.description !== undefined) return "a button has no description"; const p = check(b, LIMITS.buttonTitle, 0); if (p) return p; }
  }
  if (m.list) {
    if (m.list.button.trim() === "" || length(m.list.button) > LIMITS.listButton) return `the list button must be 1 to ${LIMITS.listButton} characters`;
    if (m.list.rows.length < 1 || m.list.rows.length > LIMITS.rows) return `a list has 1 to ${LIMITS.rows} rows`;
    for (const r of m.list.rows) { const p = check(r, LIMITS.rowTitle, LIMITS.rowDescription); if (p) return p; }
  }
  return null;
}

/** Cut a label to fit, with an ellipsis. Labels written for this file already fit; a shop's own service name might not. */
export function clip(text: string, max: number): string {
  const chars = [...text.trim()];
  return chars.length <= max ? chars.join("") : `${chars.slice(0, max - 1).join("")}…`;
}

// ---- the words ------------------------------------------------------------------------------------------------------------------

export interface Labels {
  yes: string; no: string; cancel: string; cancelYes: string; keep: string; owner: string; pickService: string; pickTime: string;
}

/** Machine-written; the Malayalam and Kannada must be read by a native speaker before a real shop sees them (REVIEW-ml.md, REVIEW-kn.md). No number appears in any label. */
export const LABELS: Record<Language, Labels> = {
  en: { yes: "Yes", no: "No", cancel: "Cancel booking", cancelYes: "Yes, cancel", keep: "No, keep it", owner: "Talk to the owner", pickService: "Pick a service", pickTime: "Pick a time" },
  hi: { yes: "हाँ", no: "नहीं", cancel: "बुकिंग रद्द करें", cancelYes: "हाँ, रद्द करें", keep: "नहीं, रहने दें", owner: "मालिक से बात करें", pickService: "सेवा चुनें", pickTime: "समय चुनें" },
  ml: { yes: "ശരി", no: "അല്ല", cancel: "ബുക്കിംഗ് റദ്ദാക്കൂ", cancelYes: "അതെ, റദ്ദാക്കൂ", keep: "ബുക്കിംഗ് നിലനിർത്തൂ", owner: "ഉടമയോട് സംസാരിക്കണം", pickService: "സേവനം തിരഞ്ഞെടുക്കൂ", pickTime: "സമയം തിരഞ്ഞെടുക്കൂ" },
  kn: { yes: "ಹೌದು", no: "ಇಲ್ಲ", cancel: "ಬುಕಿಂಗ್ ರದ್ದು", cancelYes: "ಹೌದು, ರದ್ದು", keep: "ಹಾಗೇ ಇರಲಿ", owner: "ಮಾಲೀಕರೊಂದಿಗೆ ಮಾತು", pickService: "ಸೇವೆ ಆಯ್ಕೆಮಾಡಿ", pickTime: "ಸಮಯ ಆಯ್ಕೆಮಾಡಿ" },
};

// ---- the ids --------------------------------------------------------------------------------------------------------------------

export const ID = { yes: "yes", no: "no", cancel: "cancel", cancelYes: "cancel_yes", keep: "keep", owner: "owner", menu: "menu" } as const;
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

