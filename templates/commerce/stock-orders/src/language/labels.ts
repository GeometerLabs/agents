// The words on the buttons and list of the interactive messages, per language. A button's title is at most 20 characters and carries no number (modules/language/interactive.ts).
// Machine-written like the rest; they are on the review sheets. A tap carries an id, never these words, so nothing is read from them.
import type { Language } from "../../../../../modules/language/languages.ts";

export interface Labels { approve: string; decline: string; supplierYes: string; supplierNo: string; choose: string }

export const LABELS: Record<Language, Labels> = {
  en: { approve: "Approve", decline: "Decline", supplierYes: "OK", supplierNo: "Cannot supply", choose: "Choose" },
  hi: { approve: "मंज़ूर करें", decline: "मना करें", supplierYes: "ठीक है", supplierNo: "नहीं दे सकते", choose: "चुनें" },
  ml: { approve: "അനുവദിക്കൂ", decline: "വേണ്ട", supplierYes: "ശരി", supplierNo: "നൽകാൻ കഴിയില്ല", choose: "തിരഞ്ഞെടുക്കൂ" },
  kn: { approve: "ಒಪ್ಪಿ", decline: "ಬೇಡ", supplierYes: "ಸರಿ", supplierNo: "ಪೂರೈಸಲಾಗದು", choose: "ಆರಿಸಿ" },
};

/** The ids of the supplier's buttons and of a list row; a tap is read by looking the id up. */
export const supplierButtonId = (answer: "ack" | "nack", ref: string): string => `${answer}:${ref}`;
export const pickId = (index: number): string => `pick:${index}`;
