// WhatsApp reply buttons and list messages, for every template: Meta's limits, the message type, the checks, and the words every template shares.
//
// A button or list row has a fixed id. When the customer taps it, WhatsApp sends that id back (webhooks.ts keeps it), and the template turns it into an
// intent by looking it up: no words are read, so no model is asked and nothing is guessed. A template makes its own ids and labels on top of this file
// (Bookings: templates/commerce/bookings/src/language/interactive.ts; Fees: templates/education/fees/src/language/interactive.ts). A forged or old id changes nothing the
// typed word would not.
//
// The limits are Meta's (Cloud API, interactive messages, read 5 Nov 2026): 3 reply buttons, each title up to 20 characters; a list of up to 10 rows, each
// title up to 24 characters and each description up to 72, and a list button up to 20; a body up to 1024; an id up to 256 (200 for a row). Button and list
// labels are machine-written like the other Malayalam and Kannada, and are on the review sheets.
import type { Language } from "./languages.ts";

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

// ---- the words every template shares ---------------------------------------------------------------------------------------------

export interface CommonLabels { yes: string; no: string; owner: string }

/** Machine-written; the Malayalam and Kannada must be read by a native speaker before a real shop sees them (REVIEW-ml.md, REVIEW-kn.md). No number appears in any label. */
export const COMMON_LABELS: Record<Language, CommonLabels> = {
  en: { yes: "Yes", no: "No", owner: "Talk to the owner" },
  hi: { yes: "हाँ", no: "नहीं", owner: "मालिक से बात करें" },
  ml: { yes: "ശരി", no: "അല്ല", owner: "ഉടമയോട് സംസാരിക്കണം" },
  kn: { yes: "ಹೌದು", no: "ಇಲ್ಲ", owner: "ಮಾಲೀಕರೊಂದಿಗೆ ಮಾತು" },
};

/** The ids of the buttons every template has. A tap on one of them is read by looking the id up. */
export const COMMON_ID = { yes: "yes", no: "no", owner: "owner" } as const;
